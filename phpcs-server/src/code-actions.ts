/* --------------------------------------------------------------------------------------------
 * Copyright (c) John R. D'Orazio. All rights reserved.
 * Licensed under the MIT License. See License.md in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import {
	CodeAction,
	CodeActionKind,
	CodeActionParams,
	Diagnostic,
	TextEdit,
} from 'vscode-languageserver/node';

import { TextDocument } from 'vscode-languageserver-textdocument';

/**
 * Code action command identifiers.
 */
export const PHPCBF_FIX_FILE_COMMAND = 'phpcs.fixFile';
export const PHPCBF_FIX_SINGLE_COMMAND = 'phpcs.fixSingleIssue';
export const PHPCBF_PREVIEW_COMMAND = 'phpcs.previewFixes';

/**
 * Data stored in a PHPCS diagnostic.
 */
export interface PhpcsDiagnosticData {
	fixable: boolean;
	source?: string;
}

/**
 * Check if a document has any PHPCS diagnostics.
 * @param diagnostics The diagnostics for the document
 * @returns True if there are PHPCS diagnostics
 */
export function hasPhpcsDiagnostics(diagnostics: Diagnostic[]): boolean {
	return diagnostics.some(d => d.source === 'phpcs');
}

/**
 * Get PHPCS diagnostics from a list of diagnostics.
 * @param diagnostics The diagnostics to filter
 * @returns Only PHPCS diagnostics
 */
export function getPhpcsDiagnostics(diagnostics: Diagnostic[]): Diagnostic[] {
	return diagnostics.filter(d => d.source === 'phpcs');
}

/**
 * Create a "Fix all issues in this file" code action.
 * @param document The text document
 * @param diagnostics The diagnostics in the requested range
 * @returns A code action for fixing all issues, or null if no PHPCS diagnostics
 */
export function createFixAllInFileAction(
	document: TextDocument,
	diagnostics: Diagnostic[]
): CodeAction | null {
	const phpcsDiagnostics = getPhpcsDiagnostics(diagnostics);

	if (phpcsDiagnostics.length === 0) {
		return null;
	}

	const action: CodeAction = {
		title: 'Fix all auto-fixable issues in this file (PHPCBF)',
		kind: CodeActionKind.QuickFix,
		diagnostics: phpcsDiagnostics,
		// We'll use a command that the server handles
		command: {
			title: 'Fix with PHPCBF',
			command: PHPCBF_FIX_FILE_COMMAND,
			arguments: [document.uri],
		},
	};

	return action;
}

/**
 * Create a text edit that replaces the entire document content.
 * @param document The text document
 * @param newContent The new content to replace with
 * @returns A text edit for the full document
 */
export function createFullDocumentEdit(
	document: TextDocument,
	newContent: string
): TextEdit {
	// Use positionAt to correctly handle all line ending styles (LF, CRLF)
	const start = document.positionAt(0);
	const end = document.positionAt(document.getText().length);

	return TextEdit.replace({ start, end }, newContent);
}

/**
 * Check if a diagnostic is marked as fixable.
 * @param diagnostic The diagnostic to check
 * @returns True if the diagnostic is fixable
 */
export function isDiagnosticFixable(diagnostic: Diagnostic): boolean {
	const data = diagnostic.data as PhpcsDiagnosticData | undefined;
	return data?.fixable === true;
}

/**
 * Create a code action for a fixable diagnostic that fixes only this specific issue.
 * Uses diff analysis to apply only the hunk(s) relevant to this diagnostic.
 * @param document The text document
 * @param diagnostic The diagnostic to fix
 * @returns A code action for fixing only this issue, or null if not fixable
 */
export function createFixOnlyThisIssueAction(
	document: TextDocument,
	diagnostic: Diagnostic
): CodeAction | null {
	if (!isDiagnosticFixable(diagnostic)) {
		return null;
	}

	const action: CodeAction = {
		title: 'Fix only this issue (PHPCBF)',
		kind: CodeActionKind.QuickFix,
		diagnostics: [diagnostic],
		isPreferred: false,
		command: {
			title: 'Fix single issue with PHPCBF',
			command: PHPCBF_FIX_SINGLE_COMMAND,
			arguments: [document.uri, diagnostic],
		},
	};

	return action;
}

/**
 * Create a "Preview fixes" code action that shows a diff preview.
 * @param document The text document
 * @param diagnostics The diagnostics in the document
 * @returns A code action for previewing fixes, or null if no PHPCS diagnostics
 */
export function createPreviewFixesAction(
	document: TextDocument,
	diagnostics: Diagnostic[]
): CodeAction | null {
	const phpcsDiagnostics = getPhpcsDiagnostics(diagnostics);

	if (phpcsDiagnostics.length === 0) {
		return null;
	}

	const action: CodeAction = {
		title: 'Preview fixes (PHPCBF)',
		kind: CodeActionKind.QuickFix,
		diagnostics: phpcsDiagnostics,
		command: {
			title: 'Preview PHPCBF fixes',
			command: PHPCBF_PREVIEW_COMMAND,
			arguments: [document.uri],
		},
	};

	return action;
}

/**
 * Generate code actions for a code action request.
 * @param params The code action parameters
 * @param document The text document
 * @param documentDiagnostics All diagnostics for the document (not just in range)
 * @returns Array of code actions
 */
export function generateCodeActions(
	params: CodeActionParams,
	document: TextDocument,
	documentDiagnostics: Diagnostic[]
): CodeAction[] {
	const actions: CodeAction[] = [];

	// Only provide code actions if there are PHPCS diagnostics in the document
	if (!hasPhpcsDiagnostics(documentDiagnostics)) {
		return actions;
	}

	// Check if any diagnostics in the requested range are from PHPCS
	const contextDiagnostics = params.context.diagnostics || [];
	const phpcsInContext = getPhpcsDiagnostics(contextDiagnostics);

	if (phpcsInContext.length === 0) {
		return actions;
	}

	// Add "Fix only this issue" for each fixable diagnostic in context
	for (const diagnostic of phpcsInContext) {
		const onlyThisAction = createFixOnlyThisIssueAction(document, diagnostic);
		if (onlyThisAction) {
			actions.push(onlyThisAction);
		}
	}

	// Add "Fix all issues in file" action
	const fixAllAction = createFixAllInFileAction(document, documentDiagnostics);
	if (fixAllAction) {
		actions.push(fixAllAction);
	}

	// Add "Preview fixes" action
	const previewAction = createPreviewFixesAction(document, documentDiagnostics);
	if (previewAction) {
		actions.push(previewAction);
	}

	return actions;
}
