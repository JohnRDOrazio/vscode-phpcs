/*---------------------------------------------------------------------------------------------
 * Copyright (c) Ioannis Kappas. All rights reserved.
 * Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import * as assert from 'assert';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { DiagnosticSeverity } from 'vscode-languageserver/node';

import {
	FATAL_ERROR_PATTERN,
	buildLintArguments,
	createDiagnosticFromMessage,
	extractFatalError,
	extractStdoutError,
	getV4ExitCodeError,
	isIgnorePatternMatch,
	parsePhpcsOutput,
	prepareFileText,
	shouldIgnoreFile,
	transformIgnorePattern,
} from '../src/linter-utils';

suite('Linter Utils', () => {

	suite('transformIgnorePattern', () => {

		test('should transform leading */ to **/', () => {
			assert.strictEqual(transformIgnorePattern('*/vendor'), '**/vendor');
		});

		test('should transform trailing /* to /**', () => {
			assert.strictEqual(transformIgnorePattern('vendor/*'), 'vendor/**');
		});

		test('should transform middle /*/ to /**/', () => {
			assert.strictEqual(transformIgnorePattern('path/*/file.php'), 'path/**/file.php');
		});

		test('should apply multiple transformations', () => {
			assert.strictEqual(transformIgnorePattern('*/vendor/*'), '**/vendor/**');
		});

		test('should not transform patterns without wildcards', () => {
			assert.strictEqual(transformIgnorePattern('vendor/file.php'), 'vendor/file.php');
		});

		test('should handle double wildcards', () => {
			assert.strictEqual(transformIgnorePattern('**/vendor/**'), '**/vendor/**');
		});

	});

	suite('isIgnorePatternMatch', () => {

		test('should match exact path', () => {
			assert.strictEqual(isIgnorePatternMatch('/path/to/file.php', '/path/to/file.php'), true);
		});

		test('should match with glob pattern', () => {
			assert.strictEqual(isIgnorePatternMatch('/path/to/file.php', '/path/to/*.php'), true);
		});

		test('should match vendor directory', () => {
			assert.strictEqual(isIgnorePatternMatch('/project/vendor/package/file.php', '**/vendor/**'), true);
		});

		test('should not match different paths', () => {
			assert.strictEqual(isIgnorePatternMatch('/other/path/file.php', '/path/to/*.php'), false);
		});

	});

	suite('shouldIgnoreFile', () => {

		test('should return true if file matches any pattern', () => {
			const patterns = ['**/vendor/**', '**/node_modules/**'];
			assert.strictEqual(shouldIgnoreFile('/project/vendor/file.php', patterns), true);
		});

		test('should return false if file matches no patterns', () => {
			const patterns = ['**/vendor/**', '**/node_modules/**'];
			assert.strictEqual(shouldIgnoreFile('/project/src/file.php', patterns), false);
		});

		test('should return false for empty patterns', () => {
			assert.strictEqual(shouldIgnoreFile('/project/file.php', []), false);
		});

	});

	suite('parsePhpcsOutput', () => {

		test('should parse valid PHPCS output', () => {
			const json = '{"totals":{"errors":1,"warnings":0},"files":{"/path/file.php":{"errors":1,"warnings":0,"messages":[]}}}';
			const result = parsePhpcsOutput(json);
			assert.ok(result.files);
			assert.ok(result.files['/path/file.php']);
		});

		test('should parse empty files', () => {
			const json = '{"totals":{"errors":0,"warnings":0},"files":{}}';
			const result = parsePhpcsOutput(json);
			assert.deepStrictEqual(result.files, {});
		});

		test('should throw on invalid JSON', () => {
			assert.throws(() => parsePhpcsOutput('invalid'), /invalid json/i);
		});

		test('should throw on empty string', () => {
			assert.throws(() => parsePhpcsOutput(''), /invalid json/i);
		});

		test('should parse STDIN key', () => {
			const json = '{"files":{"STDIN":{"errors":1,"messages":[]}}}';
			const result = parsePhpcsOutput(json);
			assert.ok(result.files['STDIN']);
		});

	});

	suite('buildLintArguments', () => {

		const baseOptions = {
			executableVersion: '3.7.2',
			showSources: false,
			showWarnings: true,
			errorSeverity: 5,
			warningSeverity: 5,
			ignorePatterns: [] as string[],
		};

		test('should include --report=json', () => {
			const args = buildLintArguments(baseOptions);
			assert.ok(args.includes('--report=json'));
		});

		test('should include -q for version >= 2.6.2', () => {
			const args = buildLintArguments({ ...baseOptions, executableVersion: '2.6.2' });
			assert.ok(args.includes('-q'));
		});

		test('should not include -q for version < 2.6.2', () => {
			const args = buildLintArguments({ ...baseOptions, executableVersion: '2.6.0' });
			assert.ok(!args.includes('-q'));
		});

		test('should include -s when showSources is true', () => {
			const args = buildLintArguments({ ...baseOptions, showSources: true });
			assert.ok(args.includes('-s'));
		});

		test('should include --encoding=UTF-8 for version >= 1.3.0', () => {
			const args = buildLintArguments({ ...baseOptions, executableVersion: '1.3.0' });
			assert.ok(args.includes('--encoding=UTF-8'));
		});

		test('should include standard when specified', () => {
			const args = buildLintArguments({ ...baseOptions, standard: 'PSR12' });
			assert.ok(args.includes('--standard=PSR12'));
		});

		test('should include ignore patterns for version >= 3.0.0', () => {
			const args = buildLintArguments({
				...baseOptions,
				filePath: '/path/file.php',
				ignorePatterns: ['vendor/*', 'node_modules/*'],
			});
			assert.ok(args.some(arg => arg.startsWith('--ignore=')));
		});

		test('should include stdin-path for version >= 2.6.0', () => {
			const args = buildLintArguments({
				...baseOptions,
				executableVersion: '2.6.0',
				filePath: '/path/file.php',
			});
			assert.ok(args.includes('--stdin-path=/path/file.php'));
		});

		test('should set warning-severity to 0 when showWarnings is false', () => {
			const args = buildLintArguments({ ...baseOptions, showWarnings: false });
			assert.ok(args.includes('--warning-severity=0'));
		});

		test('should end with stdin marker', () => {
			const args = buildLintArguments(baseOptions);
			assert.strictEqual(args[args.length - 1], '-');
		});

	});

	suite('prepareFileText', () => {

		test('should return original text for version >= 2.6.0', () => {
			const result = prepareFileText('<?php echo 1;', '/path/file.php', '2.6.0', '\n');
			assert.strictEqual(result, '<?php echo 1;');
		});

		test('should prepend filename for version >= 2.0.0 < 2.6.0', () => {
			const result = prepareFileText('<?php echo 1;', '/path/file.php', '2.5.0', '\n');
			assert.strictEqual(result, 'phpcs_input_file: /path/file.php\n<?php echo 1;');
		});

		test('should return original text for version < 2.0.0', () => {
			const result = prepareFileText('<?php echo 1;', '/path/file.php', '1.5.0', '\n');
			assert.strictEqual(result, '<?php echo 1;');
		});

		test('should return original text when filePath is undefined', () => {
			const result = prepareFileText('<?php echo 1;', undefined, '2.5.0', '\n');
			assert.strictEqual(result, '<?php echo 1;');
		});

	});

	suite('createDiagnosticFromMessage', () => {

		const createTestDocument = (content: string): TextDocument => {
			return TextDocument.create('file:///test.php', 'php', 1, content);
		};

		test('should create diagnostic with correct range', () => {
			const document = createTestDocument('<?php\necho $test;\n');
			const message = {
				message: 'Variable is undefined',
				source: 'Test.Rule',
				severity: 5,
				fixable: false,
				type: 'ERROR' as const,
				line: 2,
				column: 6,
			};
			const diagnostic = createDiagnosticFromMessage(document, message, false);
			assert.strictEqual(diagnostic.range.start.line, 1);
			assert.strictEqual(diagnostic.message, 'Variable is undefined');
		});

		test('should include source when showSources is true', () => {
			const document = createTestDocument('<?php\necho 1;\n');
			const message = {
				message: 'Test error',
				source: 'Test.Rule',
				severity: 5,
				fixable: false,
				type: 'ERROR' as const,
				line: 2,
				column: 1,
			};
			const diagnostic = createDiagnosticFromMessage(document, message, true);
			assert.ok(diagnostic.message.includes('(Test.Rule)'));
		});

		test('should set Warning severity for WARNING type', () => {
			const document = createTestDocument('<?php\necho 1;\n');
			const message = {
				message: 'Test warning',
				source: 'Test.Rule',
				severity: 5,
				fixable: false,
				type: 'WARNING' as const,
				line: 2,
				column: 1,
			};
			const diagnostic = createDiagnosticFromMessage(document, message, false);
			assert.strictEqual(diagnostic.severity, DiagnosticSeverity.Warning);
		});

		test('should set Error severity for ERROR type', () => {
			const document = createTestDocument('<?php\necho 1;\n');
			const message = {
				message: 'Test error',
				source: 'Test.Rule',
				severity: 5,
				fixable: false,
				type: 'ERROR' as const,
				line: 2,
				column: 1,
			};
			const diagnostic = createDiagnosticFromMessage(document, message, false);
			assert.strictEqual(diagnostic.severity, DiagnosticSeverity.Error);
		});

		test('should set source to phpcs', () => {
			const document = createTestDocument('<?php\n');
			const message = {
				message: 'Test',
				source: 'Test.Rule',
				severity: 5,
				fixable: false,
				type: 'ERROR' as const,
				line: 1,
				column: 1,
			};
			const diagnostic = createDiagnosticFromMessage(document, message, false);
			assert.strictEqual(diagnostic.source, 'phpcs');
		});

	});

	suite('extractFatalError', () => {

		test('should extract FATAL ERROR message', () => {
			const error = extractFatalError('FATAL ERROR: Out of memory');
			assert.strictEqual(error, 'Out of memory');
		});

		test('should extract PHP FATAL ERROR message', () => {
			const error = extractFatalError('PHP FATAL ERROR: Uncaught exception');
			assert.strictEqual(error, 'Uncaught exception');
		});

		test('should extract uncaught exception message', () => {
			const error = extractFatalError("FATAL ERROR: Uncaught exception 'Exception' with message 'Test error'");
			assert.strictEqual(error, 'Test error');
		});

		test('should return null for non-fatal message', () => {
			const error = extractFatalError('Processing file.php');
			assert.strictEqual(error, null);
		});

		test('should return null for empty string', () => {
			const error = extractFatalError('');
			assert.strictEqual(error, null);
		});

	});

	suite('extractStdoutError', () => {

		test('should extract ERROR message', () => {
			const error = extractStdoutError('ERROR: Some error occurred');
			assert.ok(error);
			assert.strictEqual(error!.message, 'Some error occurred');
		});

		test('should detect coding standard not installed', () => {
			const error = extractStdoutError('ERROR: the "PSR12" coding standard is not installed.');
			assert.ok(error);
			assert.strictEqual(error!.codingStandard, 'PSR12');
		});

		test('should return null for non-error output', () => {
			const error = extractStdoutError('{"files":{}}');
			assert.strictEqual(error, null);
		});

		test('should return null for empty string', () => {
			const error = extractStdoutError('');
			assert.strictEqual(error, null);
		});

	});

	suite('getV4ExitCodeError', () => {

		test('should return error for exit code 16', () => {
			const error = getV4ExitCodeError(16);
			assert.ok(error);
		});

		test('should return error for exit code 64', () => {
			const error = getV4ExitCodeError(64);
			assert.ok(error);
		});

		test('should return null for exit code 0', () => {
			assert.strictEqual(getV4ExitCodeError(0), null);
		});

		test('should return null for exit code 1', () => {
			assert.strictEqual(getV4ExitCodeError(1), null);
		});

		test('should return null for exit code 2', () => {
			assert.strictEqual(getV4ExitCodeError(2), null);
		});

		test('should return null for exit code 3', () => {
			assert.strictEqual(getV4ExitCodeError(3), null);
		});

		test('should return null for null exit code', () => {
			assert.strictEqual(getV4ExitCodeError(null), null);
		});

	});

	suite('FATAL_ERROR_PATTERN', () => {

		test('should match FATAL ERROR', () => {
			assert.ok('FATAL ERROR: test'.match(FATAL_ERROR_PATTERN));
		});

		test('should match PHP FATAL ERROR', () => {
			assert.ok('PHP FATAL ERROR: test'.match(FATAL_ERROR_PATTERN));
		});

		test('should be case insensitive', () => {
			assert.ok('fatal error: test'.match(FATAL_ERROR_PATTERN));
		});

		test('should not match regular ERROR', () => {
			assert.strictEqual('ERROR: test'.match(FATAL_ERROR_PATTERN), null);
		});

	});

});
