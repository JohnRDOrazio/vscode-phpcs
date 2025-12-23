/*---------------------------------------------------------------------------------------------
 * Copyright (c) John R. D'Orazio. All rights reserved.
 * Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import * as assert from 'assert';
import { Diagnostic, DiagnosticSeverity, CodeActionKind, CodeActionParams } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';

import {
	hasPhpcsDiagnostics,
	getPhpcsDiagnostics,
	createFixAllInFileAction,
	createFullDocumentEdit,
	generateCodeActions,
	PHPCBF_FIX_FILE_COMMAND,
} from '../src/code-actions';

suite('Code Actions', () => {

	const createTestDocument = (content: string, uri: string = 'file:///test.php'): TextDocument => {
		return TextDocument.create(uri, 'php', 1, content);
	};

	const createPhpcsDiagnostic = (message: string, line: number = 1): Diagnostic => {
		return {
			range: {
				start: { line: line - 1, character: 0 },
				end: { line: line - 1, character: 10 },
			},
			message,
			severity: DiagnosticSeverity.Error,
			source: 'phpcs',
		};
	};

	const createOtherDiagnostic = (message: string, line: number = 1): Diagnostic => {
		return {
			range: {
				start: { line: line - 1, character: 0 },
				end: { line: line - 1, character: 10 },
			},
			message,
			severity: DiagnosticSeverity.Error,
			source: 'other-linter',
		};
	};

	suite('hasPhpcsDiagnostics', () => {

		test('should return true when there are PHPCS diagnostics', () => {
			const diagnostics = [createPhpcsDiagnostic('Error 1')];
			assert.strictEqual(hasPhpcsDiagnostics(diagnostics), true);
		});

		test('should return false when there are no PHPCS diagnostics', () => {
			const diagnostics = [createOtherDiagnostic('Error 1')];
			assert.strictEqual(hasPhpcsDiagnostics(diagnostics), false);
		});

		test('should return false for empty array', () => {
			assert.strictEqual(hasPhpcsDiagnostics([]), false);
		});

		test('should return true when mixed diagnostics include PHPCS', () => {
			const diagnostics = [
				createOtherDiagnostic('Other error'),
				createPhpcsDiagnostic('PHPCS error'),
			];
			assert.strictEqual(hasPhpcsDiagnostics(diagnostics), true);
		});

	});

	suite('getPhpcsDiagnostics', () => {

		test('should filter only PHPCS diagnostics', () => {
			const diagnostics = [
				createOtherDiagnostic('Other error'),
				createPhpcsDiagnostic('PHPCS error 1'),
				createPhpcsDiagnostic('PHPCS error 2'),
			];
			const result = getPhpcsDiagnostics(diagnostics);
			assert.strictEqual(result.length, 2);
			assert.ok(result.every(d => d.source === 'phpcs'));
		});

		test('should return empty array when no PHPCS diagnostics', () => {
			const diagnostics = [createOtherDiagnostic('Other error')];
			const result = getPhpcsDiagnostics(diagnostics);
			assert.strictEqual(result.length, 0);
		});

	});

	suite('createFixAllInFileAction', () => {

		test('should create action when there are PHPCS diagnostics', () => {
			const document = createTestDocument('<?php echo 1;');
			const diagnostics = [createPhpcsDiagnostic('Error 1')];
			const action = createFixAllInFileAction(document, diagnostics);

			assert.ok(action);
			assert.ok(action!.title.includes('PHPCBF'));
			assert.strictEqual(action!.kind, CodeActionKind.QuickFix);
			assert.ok(action!.command);
			assert.strictEqual(action!.command!.command, PHPCBF_FIX_FILE_COMMAND);
		});

		test('should return null when no PHPCS diagnostics', () => {
			const document = createTestDocument('<?php echo 1;');
			const diagnostics = [createOtherDiagnostic('Error 1')];
			const action = createFixAllInFileAction(document, diagnostics);

			assert.strictEqual(action, null);
		});

		test('should return null for empty diagnostics', () => {
			const document = createTestDocument('<?php echo 1;');
			const action = createFixAllInFileAction(document, []);

			assert.strictEqual(action, null);
		});

		test('should include document URI in command arguments', () => {
			const uri = 'file:///path/to/test.php';
			const document = createTestDocument('<?php echo 1;', uri);
			const diagnostics = [createPhpcsDiagnostic('Error 1')];
			const action = createFixAllInFileAction(document, diagnostics);

			assert.ok(action);
			assert.ok(action!.command);
			assert.deepStrictEqual(action!.command!.arguments, [uri]);
		});

	});

	suite('createFullDocumentEdit', () => {

		test('should create edit for single-line document', () => {
			const document = createTestDocument('<?php echo 1;');
			const newContent = '<?php echo 2;';
			const edit = createFullDocumentEdit(document, newContent);

			assert.strictEqual(edit.newText, newContent);
			assert.strictEqual(edit.range.start.line, 0);
			assert.strictEqual(edit.range.start.character, 0);
		});

		test('should create edit for multi-line document', () => {
			const content = '<?php\necho 1;\necho 2;\n';
			const document = createTestDocument(content);
			const newContent = '<?php\necho "fixed";\n';
			const edit = createFullDocumentEdit(document, newContent);

			assert.strictEqual(edit.newText, newContent);
			assert.strictEqual(edit.range.start.line, 0);
			assert.strictEqual(edit.range.start.character, 0);
			// Last line is index 3 (empty line after trailing newline)
			assert.strictEqual(edit.range.end.line, 3);
		});

	});

	suite('generateCodeActions', () => {

		test('should return empty array when no PHPCS diagnostics in document', () => {
			const document = createTestDocument('<?php echo 1;');
			const params: CodeActionParams = {
				textDocument: { uri: document.uri },
				range: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } },
				context: { diagnostics: [] },
			};
			const actions = generateCodeActions(params, document, []);

			assert.strictEqual(actions.length, 0);
		});

		test('should return action when PHPCS diagnostics in range', () => {
			const document = createTestDocument('<?php echo 1;');
			const diagnostic = createPhpcsDiagnostic('Error 1');
			const params: CodeActionParams = {
				textDocument: { uri: document.uri },
				range: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } },
				context: { diagnostics: [diagnostic] },
			};
			const actions = generateCodeActions(params, document, [diagnostic]);

			assert.strictEqual(actions.length, 1);
			assert.ok(actions[0].title.includes('PHPCBF'));
		});

		test('should not return action when only other diagnostics in range', () => {
			const document = createTestDocument('<?php echo 1;');
			const phpcsDiag = createPhpcsDiagnostic('PHPCS error');
			const otherDiag = createOtherDiagnostic('Other error');
			const params: CodeActionParams = {
				textDocument: { uri: document.uri },
				range: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } },
				context: { diagnostics: [otherDiag] }, // Only other diagnostic in range
			};
			const actions = generateCodeActions(params, document, [phpcsDiag, otherDiag]);

			// No action because context.diagnostics doesn't include PHPCS
			assert.strictEqual(actions.length, 0);
		});

	});

	suite('PHPCBF_FIX_FILE_COMMAND', () => {

		test('should be a valid command string', () => {
			assert.strictEqual(typeof PHPCBF_FIX_FILE_COMMAND, 'string');
			assert.ok(PHPCBF_FIX_FILE_COMMAND.length > 0);
		});

	});

});
