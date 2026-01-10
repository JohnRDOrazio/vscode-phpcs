/* --------------------------------------------------------------------------------------------
 * Copyright (c) John R. D'Orazio. All rights reserved.
 * Licensed under the MIT License. See License.md in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
"use strict";

import {
	window,
	TextEditor,
	TextEditorDecorationType,
	Range,
	Position,
	DecorationOptions,
	ThemeColor,
	Disposable,
	CodeLensProvider,
	CodeLens,
	TextDocument,
	CancellationToken,
	Command,
	languages,
	commands
} from "vscode";

/**
 * Represents a line change in a diff.
 */
interface LineChange {
	type: 'add' | 'delete' | 'modify';
	lineNumber: number;
	oldText?: string;
	newText?: string;
}

/**
 * Computes line-by-line diff between two texts.
 * Returns changes needed to transform original into fixed.
 */
function computeLineDiff(original: string, fixed: string): LineChange[] {
	const originalLines = original.split('\n');
	const fixedLines = fixed.split('\n');
	const changes: LineChange[] = [];

	// Simple LCS-based diff algorithm
	const lcs = computeLCS(originalLines, fixedLines);

	let origIdx = 0;
	let fixedIdx = 0;
	let lcsIdx = 0;

	while (origIdx < originalLines.length || fixedIdx < fixedLines.length) {
		if (lcsIdx < lcs.length &&
			origIdx < originalLines.length &&
			fixedIdx < fixedLines.length &&
			originalLines[origIdx] === lcs[lcsIdx] &&
			fixedLines[fixedIdx] === lcs[lcsIdx]) {
			// Lines match - no change
			origIdx++;
			fixedIdx++;
			lcsIdx++;
		} else if (fixedIdx < fixedLines.length &&
				   (lcsIdx >= lcs.length || fixedLines[fixedIdx] !== lcs[lcsIdx])) {
			// Line added in fixed
			changes.push({
				type: 'add',
				lineNumber: fixedIdx,
				newText: fixedLines[fixedIdx]
			});
			fixedIdx++;
		} else if (origIdx < originalLines.length &&
				   (lcsIdx >= lcs.length || originalLines[origIdx] !== lcs[lcsIdx])) {
			// Line deleted from original
			changes.push({
				type: 'delete',
				lineNumber: origIdx,
				oldText: originalLines[origIdx]
			});
			origIdx++;
		}
	}

	return changes;
}

/**
 * Compute Longest Common Subsequence of two line arrays.
 */
function computeLCS(a: string[], b: string[]): string[] {
	const m = a.length;
	const n = b.length;

	// Build LCS length table
	const dp: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

	for (let i = 1; i <= m; i++) {
		for (let j = 1; j <= n; j++) {
			if (a[i - 1] === b[j - 1]) {
				dp[i][j] = dp[i - 1][j - 1] + 1;
			} else {
				dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
			}
		}
	}

	// Backtrack to find LCS
	const lcs: string[] = [];
	let i = m, j = n;
	while (i > 0 && j > 0) {
		if (a[i - 1] === b[j - 1]) {
			lcs.unshift(a[i - 1]);
			i--;
			j--;
		} else if (dp[i - 1][j] > dp[i][j - 1]) {
			i--;
		} else {
			j--;
		}
	}

	return lcs;
}

/**
 * CodeLens provider for inline diff accept/reject actions.
 */
class DiffActionCodeLensProvider implements CodeLensProvider {
	private documentUri: string | null = null;
	private stats: { additions: number; deletions: number } = { additions: 0, deletions: 0 };
	private targetLine: number = 0;

	public setActiveDocument(
		uri: string,
		stats: { additions: number; deletions: number },
		targetLine?: number
	): void {
		this.documentUri = uri;
		this.stats = stats;
		this.targetLine = targetLine ?? 0;
	}

	public clearActiveDocument(): void {
		this.documentUri = null;
	}

	public provideCodeLenses(document: TextDocument, _token: CancellationToken): CodeLens[] {
		if (this.documentUri !== document.uri.toString()) {
			return [];
		}

		// Position CodeLens at the target line (or line before it for visibility)
		const line = Math.max(0, this.targetLine);
		const range = new Range(line, 0, line, 0);

		const applyCommand: Command = {
			title: '✓ Apply Changes',
			command: 'phpcs.inlineDiffApply',
			tooltip: 'Apply PHPCBF fixes to this file'
		};

		const cancelCommand: Command = {
			title: '✗ Cancel',
			command: 'phpcs.inlineDiffCancel',
			tooltip: 'Cancel and restore original content'
		};

		const statsText = `PHPCBF Preview: ${this.stats.additions} addition(s), ${this.stats.deletions} deletion(s)`;
		const statsCommand: Command = {
			title: statsText,
			command: '',
			tooltip: 'Changes that will be applied'
		};

		return [
			new CodeLens(range, statsCommand),
			new CodeLens(range, applyCommand),
			new CodeLens(range, cancelCommand)
		];
	}
}

/**
 * Manages inline diff preview decorations in the editor.
 */
export class InlineDiffPreview implements Disposable {
	private additionDecorationType: TextEditorDecorationType;
	private deletionDecorationType: TextEditorDecorationType;
	private deletionLineDecorationType: TextEditorDecorationType;
	private activeEditor: TextEditor | null = null;
	private deletedLinesContent: Map<number, string> = new Map();

	// CodeLens support
	private codeLensProvider: DiffActionCodeLensProvider;
	private codeLensRegistration: Disposable | null = null;
	private applyCommandRegistration: Disposable | null = null;
	private cancelCommandRegistration: Disposable | null = null;
	private pendingResolve: ((value: boolean) => void) | null = null;
	private timeoutId: ReturnType<typeof setTimeout> | null = null;

	constructor() {
		// Green background for additions
		this.additionDecorationType = window.createTextEditorDecorationType({
			backgroundColor: new ThemeColor('diffEditor.insertedTextBackground'),
			isWholeLine: true,
			overviewRulerColor: new ThemeColor('editorOverviewRuler.addedForeground'),
			overviewRulerLane: 1
		});

		// Red background for deletions (shown as gutter indicator since line won't exist)
		this.deletionDecorationType = window.createTextEditorDecorationType({
			backgroundColor: new ThemeColor('diffEditor.removedTextBackground'),
			isWholeLine: true,
			overviewRulerColor: new ThemeColor('editorOverviewRuler.deletedForeground'),
			overviewRulerLane: 1
		});

		// For showing deleted content in gutter/after
		this.deletionLineDecorationType = window.createTextEditorDecorationType({
			after: {
				color: new ThemeColor('editorGutter.deletedBackground'),
				fontStyle: 'italic'
			},
			isWholeLine: true
		});

		this.codeLensProvider = new DiffActionCodeLensProvider();
	}

	/**
	 * Compute diff and apply decorations to the editor.
	 * @param editor The text editor
	 * @param originalContent The original file content
	 * @param fixedContent The fixed content from PHPCBF
	 * @returns Object with line counts and decorations applied
	 */
	private computeAndApplyDecorations(
		editor: TextEditor,
		originalContent: string,
		fixedContent: string
	): { additions: number; deletions: number } {
		this.deletedLinesContent.clear();
		const changes = computeLineDiff(originalContent, fixedContent);
		const additionDecorations: DecorationOptions[] = [];

		let additions = 0;
		let deletions = 0;

		const fixedLines = fixedContent.split('\n');

		for (const change of changes) {
			if (change.type === 'add') {
				additions++;
				const line = change.lineNumber;
				if (line < fixedLines.length) {
					additionDecorations.push({
						range: new Range(
							new Position(line, 0),
							new Position(line, fixedLines[line].length)
						),
						hoverMessage: '**Added line**'
					});
				}
			} else if (change.type === 'delete') {
				deletions++;
				this.deletedLinesContent.set(change.lineNumber, change.oldText || '');
			}
		}

		editor.setDecorations(this.additionDecorationType, additionDecorations);

		return { additions, deletions };
	}

	/**
	 * Clean up CodeLens registrations and pending state.
	 */
	private cleanupCodeLens(): void {
		// Clear timeout if active
		if (this.timeoutId) {
			clearTimeout(this.timeoutId);
			this.timeoutId = null;
		}

		// Cleanup CodeLens provider
		this.codeLensProvider.clearActiveDocument();
		if (this.codeLensRegistration) {
			this.codeLensRegistration.dispose();
			this.codeLensRegistration = null;
		}
		if (this.applyCommandRegistration) {
			this.applyCommandRegistration.dispose();
			this.applyCommandRegistration = null;
		}
		if (this.cancelCommandRegistration) {
			this.cancelCommandRegistration.dispose();
			this.cancelCommandRegistration = null;
		}
	}

	/**
	 * Show inline diff preview in the editor and wait for user decision.
	 * @param editor The text editor
	 * @param originalContent The original file content
	 * @param fixedContent The fixed content from PHPCBF
	 * @param targetLine Optional line number for positioning the CodeLens (0-indexed)
	 * @returns Promise that resolves to true if user accepts, false if cancels
	 */
	public async showPreviewAndWait(
		editor: TextEditor,
		originalContent: string,
		fixedContent: string,
		targetLine?: number
	): Promise<boolean> {
		// Clear any existing preview state to prevent race conditions
		if (this.pendingResolve) {
			this.pendingResolve(false);
			this.pendingResolve = null;
		}
		this.cleanupCodeLens();

		this.activeEditor = editor;

		// Compute and apply decorations
		const { additions, deletions } = this.computeAndApplyDecorations(
			editor,
			originalContent,
			fixedContent
		);

		// Register CodeLens provider and commands
		this.codeLensProvider.setActiveDocument(editor.document.uri.toString(), { additions, deletions }, targetLine);

		// Register commands for accept/cancel
		this.applyCommandRegistration = commands.registerCommand('phpcs.inlineDiffApply', () => {
			if (this.pendingResolve) {
				this.pendingResolve(true);
				this.pendingResolve = null;
			}
		});

		this.cancelCommandRegistration = commands.registerCommand('phpcs.inlineDiffCancel', () => {
			if (this.pendingResolve) {
				this.pendingResolve(false);
				this.pendingResolve = null;
			}
		});

		// Register CodeLens provider for PHP files
		this.codeLensRegistration = languages.registerCodeLensProvider(
			{ scheme: 'file', language: 'php' },
			this.codeLensProvider
		);

		// Wait for user decision with timeout (5 minutes)
		const timeoutMs = 300000;

		return new Promise<boolean>((resolve) => {
			this.pendingResolve = (value: boolean) => {
				if (this.timeoutId) {
					clearTimeout(this.timeoutId);
					this.timeoutId = null;
				}
				resolve(value);
			};

			this.timeoutId = setTimeout(() => {
				if (this.pendingResolve) {
					this.pendingResolve(false);
					this.pendingResolve = null;
				}
			}, timeoutMs);
		});
	}

	/**
	 * Show inline diff preview in the editor (without waiting for user decision).
	 * @param editor The text editor
	 * @param originalContent The original file content
	 * @param fixedContent The fixed content from PHPCBF
	 * @returns Object with line counts for display
	 */
	public showPreview(
		editor: TextEditor,
		originalContent: string,
		fixedContent: string
	): { additions: number; deletions: number } {
		this.activeEditor = editor;
		return this.computeAndApplyDecorations(editor, originalContent, fixedContent);
	}

	/**
	 * Clear all decorations and cleanup.
	 */
	public clearPreview(): void {
		if (this.activeEditor) {
			this.activeEditor.setDecorations(this.additionDecorationType, []);
			this.activeEditor.setDecorations(this.deletionDecorationType, []);
			this.activeEditor.setDecorations(this.deletionLineDecorationType, []);
		}
		this.activeEditor = null;
		this.deletedLinesContent.clear();

		// Cleanup CodeLens
		this.cleanupCodeLens();

		// Resolve any pending promise as cancelled
		if (this.pendingResolve) {
			this.pendingResolve(false);
			this.pendingResolve = null;
		}
	}

	public dispose(): void {
		this.clearPreview();
		this.additionDecorationType.dispose();
		this.deletionDecorationType.dispose();
		this.deletionLineDecorationType.dispose();
	}
}
