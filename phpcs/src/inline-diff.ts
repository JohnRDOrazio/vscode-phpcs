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
	languages,
	commands,
	EventEmitter,
	Event
} from "vscode";

import { PreviewDiffHunk } from "./protocol";

/**
 * Tracked hunk for preview.
 */
interface TrackedHunk {
	hunk: PreviewDiffHunk;
	index: number;
}

/**
 * CodeLens provider for per-hunk accept/reject actions.
 */
class HunkActionCodeLensProvider implements CodeLensProvider {
	private documentUri: string | null = null;
	private trackedHunks: TrackedHunk[] = [];
	private _onDidChangeCodeLenses = new EventEmitter<void>();
	public readonly onDidChangeCodeLenses: Event<void> = this._onDidChangeCodeLenses.event;

	public setHunks(uri: string, hunks: TrackedHunk[]): void {
		this.documentUri = uri;
		this.trackedHunks = hunks;
		this._onDidChangeCodeLenses.fire();
	}

	public clear(): void {
		this.documentUri = null;
		this.trackedHunks = [];
		this._onDidChangeCodeLenses.fire();
	}

	public refresh(): void {
		this._onDidChangeCodeLenses.fire();
	}

	public provideCodeLenses(document: TextDocument, _token: CancellationToken): CodeLens[] {
		if (this.documentUri !== document.uri.toString()) {
			return [];
		}

		const lenses: CodeLens[] = [];
		const topRange = new Range(0, 0, 0, 0);
		const totalCount = this.trackedHunks.length;

		// Status indicator at the top
		const statusText = `PHPCBF Preview: ${totalCount} change(s) to review`;
		lenses.push(new CodeLens(topRange, {
			title: statusText,
			command: '',
			tooltip: 'Review each change and click Accept or Reject'
		}));

		// Accept All button
		if (totalCount > 0) {
			lenses.push(new CodeLens(topRange, {
				title: '$(check-all) Accept All',
				command: 'phpcs.hunkAcceptAll',
				tooltip: 'Apply all changes'
			}));
		}

		// Cancel button
		lenses.push(new CodeLens(topRange, {
			title: '$(x) Cancel',
			command: 'phpcs.hunkCancel',
			tooltip: 'Cancel without applying any changes'
		}));

		// Per-hunk actions
		for (const tracked of this.trackedHunks) {
			const hunk = tracked.hunk;
			const line = hunk.originalStart;
			const range = new Range(line, 0, line, 0);

			// Accept button - applies this change immediately
			lenses.push(new CodeLens(range, {
				title: '$(check) Accept',
				command: 'phpcs.hunkAccept',
				arguments: [tracked.index],
				tooltip: 'Apply this change'
			}));

			// Accept all button - applies all changes
			lenses.push(new CodeLens(range, {
				title: '$(check-all) Accept all',
				command: 'phpcs.hunkAcceptAll',
				tooltip: 'Apply all changes'
			}));

			// Reject button - removes this change from preview
			lenses.push(new CodeLens(range, {
				title: '$(x) Reject',
				command: 'phpcs.hunkReject',
				arguments: [tracked.index],
				tooltip: 'Skip this change'
			}));
		}

		return lenses;
	}

	public dispose(): void {
		this._onDidChangeCodeLenses.dispose();
	}
}

/**
 * Manages inline diff preview decorations with per-hunk accept/reject actions.
 */
export class InlineDiffPreview implements Disposable {
	private deletionDecorationType: TextEditorDecorationType;
	private additionDecorationType: TextEditorDecorationType;
	private insertionDecorationType: TextEditorDecorationType;

	private activeEditor: TextEditor | null = null;
	private trackedHunks: TrackedHunk[] = [];

	// CodeLens support
	private codeLensProvider: HunkActionCodeLensProvider;
	private codeLensRegistration: Disposable | null = null;
	private commandRegistrations: Disposable[] = [];
	private pendingResolve: ((acceptedHunks: PreviewDiffHunk[]) => void) | null = null;

	constructor() {
		// Red background for deletions (lines being removed)
		this.deletionDecorationType = window.createTextEditorDecorationType({
			backgroundColor: 'rgba(255, 0, 0, 0.2)',
			isWholeLine: true,
			overviewRulerColor: new ThemeColor('editorOverviewRuler.deletedForeground'),
			overviewRulerLane: 1,
			before: {
				contentText: '−',
				color: 'rgba(255, 100, 100, 0.8)',
				margin: '0 8px 0 0'
			}
		});

		// Green background for showing replacement content inline
		this.additionDecorationType = window.createTextEditorDecorationType({
			isWholeLine: true,
		});

		// Green background for pure insertions (shown as a decoration on adjacent line)
		this.insertionDecorationType = window.createTextEditorDecorationType({
			backgroundColor: 'rgba(0, 200, 0, 0.2)',
			isWholeLine: true,
			overviewRulerColor: new ThemeColor('editorOverviewRuler.addedForeground'),
			overviewRulerLane: 1,
			before: {
				contentText: '+',
				color: 'rgba(0, 200, 0, 0.8)',
				margin: '0 8px 0 0'
			}
		});

		this.codeLensProvider = new HunkActionCodeLensProvider();
	}

	/**
	 * Update decorations based on current hunks.
	 */
	private updateDecorations(): void {
		if (!this.activeEditor) {
			return;
		}

		const deletionDecorations: DecorationOptions[] = [];
		const additionDecorations: DecorationOptions[] = [];
		const insertionDecorations: DecorationOptions[] = [];

		for (const tracked of this.trackedHunks) {
			const hunk = tracked.hunk;
			const startLine = hunk.originalStart;
			const endLine = hunk.originalStart + Math.max(hunk.originalLength, 1) - 1;
			const safeEndLine = Math.min(endLine, this.activeEditor.document.lineCount - 1);

			if (hunk.originalLength > 0 && hunk.modifiedLength > 0) {
				// Replacement: show deletion with inline preview of replacement
				const range = new Range(
					new Position(startLine, 0),
					new Position(safeEndLine, this.activeEditor.document.lineAt(safeEndLine).text.length)
				);
				const replacementPreview = hunk.modifiedLines[0]?.substring(0, 80) || '';
				const moreLines = hunk.modifiedLength > 1 ? ` (+${hunk.modifiedLength - 1} more)` : '';

				deletionDecorations.push({
					range,
					hoverMessage: `**Replace with:**\n\`\`\`\n${hunk.modifiedLines.join('\n')}\n\`\`\``,
					renderOptions: {
						after: {
							contentText: ` → ${replacementPreview}${moreLines}`,
							color: 'rgba(0, 180, 0, 0.9)',
							fontStyle: 'italic',
							backgroundColor: 'rgba(0, 180, 0, 0.15)',
							margin: '0 0 0 1em'
						}
					}
				});
			} else if (hunk.originalLength > 0) {
				// Pure deletion
				const range = new Range(
					new Position(startLine, 0),
					new Position(safeEndLine, this.activeEditor.document.lineAt(safeEndLine).text.length)
				);
				deletionDecorations.push({
					range,
					hoverMessage: `**Delete ${hunk.originalLength} line(s)**`
				});
			} else if (hunk.modifiedLength > 0) {
				// Pure insertion - show on the line before insertion point
				const insertLine = Math.max(0, startLine - 1);
				const lineText = this.activeEditor.document.lineAt(insertLine).text;
				const range = new Range(
					new Position(insertLine, 0),
					new Position(insertLine, lineText.length)
				);

				const insertPreview = hunk.modifiedLines.map(l => l.trim()).join(' ').substring(0, 60);
				const moreInfo = hunk.modifiedLength > 1 ? ` (${hunk.modifiedLength} lines)` : '';

				insertionDecorations.push({
					range,
					hoverMessage: `**Insert after this line:**\n\`\`\`\n${hunk.modifiedLines.join('\n')}\n\`\`\``,
					renderOptions: {
						after: {
							contentText: ` ↓ Insert: ${insertPreview}${moreInfo}`,
							color: 'rgba(0, 180, 0, 0.9)',
							fontStyle: 'italic',
							backgroundColor: 'rgba(0, 180, 0, 0.15)',
							margin: '0 0 0 1em'
						}
					}
				});
			}
		}

		this.activeEditor.setDecorations(this.deletionDecorationType, deletionDecorations);
		this.activeEditor.setDecorations(this.additionDecorationType, additionDecorations);
		this.activeEditor.setDecorations(this.insertionDecorationType, insertionDecorations);
	}

	/**
	 * Register commands for hunk actions.
	 */
	private registerCommands(): void {
		// Accept single hunk - immediately apply just this one
		this.commandRegistrations.push(
			commands.registerCommand('phpcs.hunkAccept', (index: number) => {
				if (this.pendingResolve && index >= 0 && index < this.trackedHunks.length) {
					const hunk = this.trackedHunks[index].hunk;
					// Clear decorations immediately before resolving
					this.clearDecorations();
					this.pendingResolve([hunk]);
					this.pendingResolve = null;
				}
			})
		);

		// Reject single hunk - remove from preview and continue
		this.commandRegistrations.push(
			commands.registerCommand('phpcs.hunkReject', (index: number) => {
				if (index >= 0 && index < this.trackedHunks.length) {
					// Remove this hunk from tracking
					this.trackedHunks.splice(index, 1);
					// Re-index remaining hunks
					this.trackedHunks.forEach((t, i) => t.index = i);

					if (this.trackedHunks.length === 0) {
						// No more hunks to review
						if (this.pendingResolve) {
							this.pendingResolve([]);
							this.pendingResolve = null;
						}
					} else {
						// Update display
						this.codeLensProvider.setHunks(
							this.activeEditor!.document.uri.toString(),
							this.trackedHunks
						);
						this.updateDecorations();
					}
				}
			})
		);

		// Accept all hunks - apply all remaining
		this.commandRegistrations.push(
			commands.registerCommand('phpcs.hunkAcceptAll', () => {
				if (this.pendingResolve) {
					const allHunks = this.trackedHunks.map(t => t.hunk);
					// Clear decorations immediately before resolving
					this.clearDecorations();
					this.pendingResolve(allHunks);
					this.pendingResolve = null;
				}
			})
		);

		// Cancel - close without applying
		this.commandRegistrations.push(
			commands.registerCommand('phpcs.hunkCancel', () => {
				if (this.pendingResolve) {
					this.pendingResolve([]);
					this.pendingResolve = null;
				}
			})
		);
	}

	/**
	 * Cleanup command registrations.
	 */
	private cleanupCommands(): void {
		for (const reg of this.commandRegistrations) {
			reg.dispose();
		}
		this.commandRegistrations = [];
	}

	/**
	 * Show inline diff preview with per-hunk actions.
	 * @param editor The text editor
	 * @param originalContent The original file content
	 * @param hunks The diff hunks to preview
	 * @returns Promise that resolves to the list of accepted hunks
	 */
	public async showHunkPreview(
		editor: TextEditor,
		_originalContent: string,
		hunks: PreviewDiffHunk[]
	): Promise<PreviewDiffHunk[]> {
		// Clear any existing preview
		this.clearPreview();

		this.activeEditor = editor;

		// Initialize tracked hunks
		this.trackedHunks = hunks.map((hunk, index) => ({
			hunk,
			index
		}));

		// Register commands
		this.registerCommands();

		// Register CodeLens provider
		this.codeLensProvider.setHunks(editor.document.uri.toString(), this.trackedHunks);
		this.codeLensRegistration = languages.registerCodeLensProvider(
			{ scheme: 'file', language: 'php' },
			this.codeLensProvider
		);

		// Apply initial decorations
		this.updateDecorations();

		// Wait for user action
		return new Promise<PreviewDiffHunk[]>((resolve) => {
			this.pendingResolve = resolve;
		});
	}

	/**
	 * Legacy method for backward compatibility.
	 */
	public async showPreviewAndWait(
		editor: TextEditor,
		_originalContent: string,
		_fixedContent: string,
		_targetLine?: number
	): Promise<boolean> {
		this.clearPreview();
		this.activeEditor = editor;

		return new Promise<boolean>((resolve) => {
			this.commandRegistrations.push(
				commands.registerCommand('phpcs.inlineDiffApply', () => resolve(true))
			);
			this.commandRegistrations.push(
				commands.registerCommand('phpcs.inlineDiffCancel', () => resolve(false))
			);

			window.showInformationMessage(
				'PHPCBF Preview: Apply changes?',
				'Apply',
				'Cancel'
			).then(choice => resolve(choice === 'Apply'));
		});
	}

	/**
	 * Legacy method for backward compatibility.
	 */
	public showPreview(
		editor: TextEditor,
		_originalContent: string,
		_fixedContent: string
	): { additions: number; deletions: number } {
		this.activeEditor = editor;
		return { additions: 0, deletions: 0 };
	}

	/**
	 * Clear decorations and CodeLens without full cleanup.
	 * Used when accepting hunks to remove visual indicators before applying changes.
	 */
	private clearDecorations(): void {
		// Use window.activeTextEditor to ensure we get the current editor
		// This helps with VS Code's rendering refresh
		const editor = window.activeTextEditor || this.activeEditor;
		if (editor) {
			editor.setDecorations(this.deletionDecorationType, []);
			editor.setDecorations(this.additionDecorationType, []);
			editor.setDecorations(this.insertionDecorationType, []);
		}
		// Also clear on cached editor if different
		if (this.activeEditor && this.activeEditor !== editor) {
			this.activeEditor.setDecorations(this.deletionDecorationType, []);
			this.activeEditor.setDecorations(this.additionDecorationType, []);
			this.activeEditor.setDecorations(this.insertionDecorationType, []);
		}
		this.codeLensProvider.clear();
	}

	/**
	 * Clear all decorations and cleanup.
	 */
	public clearPreview(): void {
		this.clearDecorations();

		this.activeEditor = null;
		this.trackedHunks = [];

		if (this.codeLensRegistration) {
			this.codeLensRegistration.dispose();
			this.codeLensRegistration = null;
		}

		this.cleanupCommands();

		if (this.pendingResolve) {
			this.pendingResolve([]);
			this.pendingResolve = null;
		}
	}

	public dispose(): void {
		this.clearPreview();
		this.deletionDecorationType.dispose();
		this.additionDecorationType.dispose();
		this.insertionDecorationType.dispose();
		this.codeLensProvider.dispose();
	}
}

/**
 * Apply selected hunks to the original content.
 * Hunks are applied from bottom to top to preserve line numbers.
 */
export function applySelectedHunks(originalContent: string, hunks: PreviewDiffHunk[]): string {
	const lines = originalContent.split('\n');

	// Sort hunks by originalStart descending (apply from bottom to top)
	const sortedHunks = [...hunks].sort((a, b) => b.originalStart - a.originalStart);

	for (const hunk of sortedHunks) {
		lines.splice(hunk.originalStart, hunk.originalLength, ...hunk.modifiedLines);
	}

	return lines.join('\n');
}
