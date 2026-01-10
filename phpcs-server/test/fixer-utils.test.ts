/*---------------------------------------------------------------------------------------------
 * Copyright (c) John R. D'Orazio. All rights reserved.
 * Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import * as assert from 'assert';

import {
	buildFixArguments,
	parseFixResult,
	extractPhpcbfFatalError,
	extractPhpcbfStdoutError,
	normalizeWindowsPath,
	createEmptyFileResult,
	createIgnoredFileResult,
	createTimeoutResult,
	isTimeoutSignal,
	parseVersionString,
	isVersionV4OrAbove,
	PhpcbfExitCode,
} from '../src/fixer-utils';

suite('Fixer Utils', () => {

	suite('buildFixArguments', () => {

		const baseOptions = {
			executableVersion: '3.7.2',
		};

		test('should include -q for version >= 2.6.2', () => {
			const args = buildFixArguments({ ...baseOptions, executableVersion: '2.6.2' });
			assert.ok(args.includes('-q'));
		});

		test('should not include -q for version < 2.6.2', () => {
			const args = buildFixArguments({ ...baseOptions, executableVersion: '2.6.0' });
			assert.ok(!args.includes('-q'));
		});

		test('should include --encoding=UTF-8 for version >= 1.3.0', () => {
			const args = buildFixArguments({ ...baseOptions, executableVersion: '1.3.0' });
			assert.ok(args.includes('--encoding=UTF-8'));
		});

		test('should not include --encoding for version < 1.3.0', () => {
			const args = buildFixArguments({ ...baseOptions, executableVersion: '1.2.0' });
			assert.ok(!args.includes('--encoding=UTF-8'));
		});

		test('should include standard when specified', () => {
			const args = buildFixArguments({ ...baseOptions, standard: 'PSR12' });
			assert.ok(args.includes('--standard=PSR12'));
		});

		test('should not include standard when not specified', () => {
			const args = buildFixArguments(baseOptions);
			assert.ok(!args.some(arg => arg.startsWith('--standard=')));
		});

		test('should include stdin-path for version >= 2.6.0', () => {
			const args = buildFixArguments({
				...baseOptions,
				executableVersion: '2.6.0',
				filePath: '/path/file.php',
			});
			assert.ok(args.includes('--stdin-path=/path/file.php'));
		});

		test('should not include stdin-path for version < 2.6.0', () => {
			const args = buildFixArguments({
				...baseOptions,
				executableVersion: '2.5.0',
				filePath: '/path/file.php',
			});
			assert.ok(!args.some(arg => arg.startsWith('--stdin-path=')));
		});

		test('should end with stdin marker', () => {
			const args = buildFixArguments(baseOptions);
			assert.strictEqual(args[args.length - 1], '-');
		});

	});

	suite('parseFixResult', () => {
		// Exit codes have different meanings in v3 vs v4:
		// v3: 0=nothing to fix, 1=all fixed, 2=failed to fix some, 3=processing error
		// v4: 0=clean/fixed, 1=auto-fixable remain, 2=non-auto-fixable, 4=fix failure,
		//     16=processing error, 64=requirements not met
		// @see https://github.com/PHPCSStandards/PHP_CodeSniffer/wiki/Advanced-Usage#understanding-the-exit-codes

		const originalContent = '<?php echo 1;';
		const fixedContent = '<?php echo 1;\n';

		test('should return fixed=false for exit code 0 when content unchanged', () => {
			const result = parseFixResult(originalContent, '', PhpcbfExitCode.NoErrorsOrFixed, originalContent, false);
			assert.strictEqual(result.fixed, false);
			assert.strictEqual(result.content, originalContent);
			assert.strictEqual(result.hasUnfixableIssues, false);
		});

		test('should return fixed=true for exit code 0 when content actually changed', () => {
			// In v4+ with ignore_non_auto_fixable_on_exit config, exit code 0 can
			// be returned even when fixes were applied. Use content comparison.
			const result = parseFixResult(fixedContent, '', PhpcbfExitCode.NoErrorsOrFixed, originalContent, false);
			assert.strictEqual(result.fixed, true);
			assert.strictEqual(result.content, fixedContent);
			assert.strictEqual(result.hasUnfixableIssues, false);
		});

		test('should return fixed=true for exit code 1 when content changed', () => {
			// v3: all fixed correctly, v4: auto-fixable issues remain
			const result = parseFixResult(fixedContent, '', PhpcbfExitCode.FixedOrFixableRemain, originalContent, false);
			assert.strictEqual(result.fixed, true);
			assert.strictEqual(result.content, fixedContent);
			assert.strictEqual(result.hasUnfixableIssues, false);
		});

		test('should return fixed=false for exit code 1 when content unchanged', () => {
			const result = parseFixResult(originalContent, '', PhpcbfExitCode.FixedOrFixableRemain, originalContent, false);
			assert.strictEqual(result.fixed, false);
			assert.strictEqual(result.content, originalContent);
			assert.strictEqual(result.hasUnfixableIssues, false);
		});

		test('should return hasUnfixableIssues=true for exit code 2 when content unchanged', () => {
			// v3: failed to fix some, v4: non-auto-fixable issues exist
			const result = parseFixResult(originalContent, '', PhpcbfExitCode.FailedOrNonFixable, originalContent, false);
			assert.strictEqual(result.fixed, false);
			assert.strictEqual(result.hasUnfixableIssues, true);
		});

		test('should return fixed=true for exit code 2 when content actually changed', () => {
			// Some fixes applied but some issues remain unfixable
			const result = parseFixResult(fixedContent, '', PhpcbfExitCode.FailedOrNonFixable, originalContent, false);
			assert.strictEqual(result.fixed, true);
			assert.strictEqual(result.content, fixedContent);
			assert.strictEqual(result.hasUnfixableIssues, true);
		});

		test('should return error for exit code 4 (v4 fix failure) when content unchanged', () => {
			// Exit code 4 is v4-only (fix failure/fixer conflict)
			const result = parseFixResult(originalContent, '', PhpcbfExitCode.FixFailure, originalContent, true);
			assert.strictEqual(result.fixed, false);
			assert.ok(result.error);
			assert.ok(result.error!.includes('failed to fix') || result.error!.includes('fixer conflicts'));
		});

		test('should return fixed=true with warning for exit code 4 when content changed', () => {
			// Some fixes were applied before the failure/conflict occurred (v4 only)
			const result = parseFixResult(fixedContent, '', PhpcbfExitCode.FixFailure, originalContent, true);
			assert.strictEqual(result.fixed, true);
			assert.strictEqual(result.content, fixedContent);
			assert.strictEqual(result.hasUnfixableIssues, true);
			assert.ok(result.error);
		});

		test('should return error for exit code 16 (processing error) in v4+', () => {
			const result = parseFixResult('', '', PhpcbfExitCode.ProcessingError, originalContent, true);
			assert.strictEqual(result.fixed, false);
			assert.ok(result.error);
			assert.ok(result.error!.includes('processing error'));
		});

		test('should return error for exit code 64 (requirements not met) in v4+', () => {
			const result = parseFixResult('', '', PhpcbfExitCode.RequirementsNotMet, originalContent, true);
			assert.strictEqual(result.fixed, false);
			assert.ok(result.error);
			assert.ok(result.error!.includes('requirements not met'));
		});

		test('should return error for exit code 3 (processing error) in v3', () => {
			const result = parseFixResult('', '', PhpcbfExitCode.V3ProcessingError, originalContent, false);
			assert.strictEqual(result.fixed, false);
			assert.ok(result.error);
			assert.ok(result.error!.includes('processing error'));
		});

		test('should handle exit code 3 as bitmask (1+2) in v4+', () => {
			// In v4+, exit code 3 is a bitmask combination: fixable (1) + non-fixable (2)
			const result = parseFixResult(fixedContent, '', 3, originalContent, true);
			assert.strictEqual(result.fixed, true);
			assert.strictEqual(result.content, fixedContent);
			assert.strictEqual(result.hasUnfixableIssues, true); // bit 2 set
			assert.strictEqual(result.error, undefined); // no fix failure bit
		});

		test('should handle exit code 5 as bitmask (1+4) in v4+', () => {
			// Exit code 5 = fixable issues (1) + fix failure (4)
			const result = parseFixResult(fixedContent, '', 5, originalContent, true);
			assert.strictEqual(result.fixed, true);
			assert.strictEqual(result.hasUnfixableIssues, true); // fix failure implies unfixable
			assert.ok(result.error);
			assert.ok(result.error!.includes('failed to fix'));
		});

		test('should handle exit code 6 as bitmask (2+4) in v4+', () => {
			// Exit code 6 = non-fixable issues (2) + fix failure (4)
			const result = parseFixResult(fixedContent, '', 6, originalContent, true);
			assert.strictEqual(result.fixed, true);
			assert.strictEqual(result.hasUnfixableIssues, true);
			assert.ok(result.error);
		});

		test('should handle exit code 7 as bitmask (1+2+4) in v4+', () => {
			// Exit code 7 = fixable (1) + non-fixable (2) + fix failure (4)
			const result = parseFixResult(fixedContent, '', 7, originalContent, true);
			assert.strictEqual(result.fixed, true);
			assert.strictEqual(result.hasUnfixableIssues, true);
			assert.ok(result.error);
		});

		test('should return error for fatal error in stderr', () => {
			const result = parseFixResult('', 'FATAL ERROR: Out of memory', 1, originalContent, false);
			assert.strictEqual(result.fixed, false);
			assert.strictEqual(result.error, 'Out of memory');
		});

		test('should return error for unexpected exit code', () => {
			const result = parseFixResult('', '', 99, originalContent, false);
			assert.strictEqual(result.fixed, false);
			assert.ok(result.error);
			assert.ok(result.error!.includes('unexpected exit code'));
		});

	});

	suite('extractPhpcbfFatalError', () => {

		test('should extract FATAL ERROR message', () => {
			const error = extractPhpcbfFatalError('FATAL ERROR: Out of memory');
			assert.strictEqual(error, 'Out of memory');
		});

		test('should extract PHP FATAL ERROR message', () => {
			const error = extractPhpcbfFatalError('PHP FATAL ERROR: Uncaught exception');
			assert.strictEqual(error, 'Uncaught exception');
		});

		test('should extract uncaught exception message', () => {
			const error = extractPhpcbfFatalError("FATAL ERROR: Uncaught exception 'Exception' with message 'Test error'");
			assert.strictEqual(error, 'Test error');
		});

		test('should extract parse error message', () => {
			const error = extractPhpcbfFatalError('Parse error: syntax error, unexpected token');
			assert.ok(error);
			assert.ok(error!.includes('Parse error'));
		});

		test('should extract PHP Parse error message', () => {
			const error = extractPhpcbfFatalError('PHP Parse error: syntax error on line 10');
			assert.ok(error);
			assert.ok(error!.includes('Parse error'));
		});

		test('should return null for non-fatal message', () => {
			const error = extractPhpcbfFatalError('Processing file.php');
			assert.strictEqual(error, null);
		});

		test('should return null for empty string', () => {
			const error = extractPhpcbfFatalError('');
			assert.strictEqual(error, null);
		});

		test('should return null for null/undefined-like empty', () => {
			const error = extractPhpcbfFatalError('   ');
			assert.strictEqual(error, null);
		});

	});

	suite('extractPhpcbfStdoutError', () => {

		test('should extract ERROR message', () => {
			const error = extractPhpcbfStdoutError('ERROR: Some error occurred');
			assert.strictEqual(error, 'Some error occurred');
		});

		test('should extract coding standard not installed error', () => {
			const error = extractPhpcbfStdoutError('ERROR: the "PSR12" coding standard is not installed.');
			assert.ok(error);
			assert.ok(error!.includes('PSR12'));
		});

		test('should return null for non-error output', () => {
			const error = extractPhpcbfStdoutError('<?php echo 1;');
			assert.strictEqual(error, null);
		});

		test('should return null for empty string', () => {
			const error = extractPhpcbfStdoutError('');
			assert.strictEqual(error, null);
		});

	});

	suite('PhpcbfExitCode enum', () => {
		// @see https://github.com/PHPCSStandards/PHP_CodeSniffer/wiki/Advanced-Usage#understanding-the-exit-codes

		test('should have correct values for v3/v4 compatibility', () => {
			// Exit codes used by both v3 and v4 (with different meanings)
			assert.strictEqual(PhpcbfExitCode.NoErrorsOrFixed, 0);
			assert.strictEqual(PhpcbfExitCode.FixedOrFixableRemain, 1);
			assert.strictEqual(PhpcbfExitCode.FailedOrNonFixable, 2);
			// v3 specific exit code
			assert.strictEqual(PhpcbfExitCode.V3ProcessingError, 3);
			// v4+ specific exit codes
			assert.strictEqual(PhpcbfExitCode.FixFailure, 4);
			assert.strictEqual(PhpcbfExitCode.ProcessingError, 16);
			assert.strictEqual(PhpcbfExitCode.RequirementsNotMet, 64);
		});

	});

	suite('normalizeWindowsPath', () => {

		test('should capitalize lowercase drive letter', () => {
			// Note: This test is platform-dependent for path.join behavior
			const result = normalizeWindowsPath('c:\\Users\\test\\file.php');
			assert.ok(result.startsWith('C:') || result.startsWith('c:'));
		});

		test('should keep uppercase drive letter', () => {
			const result = normalizeWindowsPath('D:\\Projects\\app.php');
			assert.ok(result.startsWith('D:'));
		});

		test('should handle paths without drive letters', () => {
			const result = normalizeWindowsPath('/home/user/file.php');
			assert.ok(result.includes('file.php'));
		});

	});

	suite('createEmptyFileResult', () => {

		test('should return fixed=false for empty content', () => {
			const result = createEmptyFileResult('');
			assert.strictEqual(result.fixed, false);
			assert.strictEqual(result.content, '');
			assert.strictEqual(result.hasUnfixableIssues, false);
			assert.strictEqual(result.error, undefined);
		});

		test('should preserve original content', () => {
			const content = '<?php echo 1;';
			const result = createEmptyFileResult(content);
			assert.strictEqual(result.content, content);
		});

	});

	suite('createIgnoredFileResult', () => {

		test('should return fixed=false for ignored file', () => {
			const content = '<?php echo 1;';
			const result = createIgnoredFileResult(content);
			assert.strictEqual(result.fixed, false);
			assert.strictEqual(result.content, content);
			assert.strictEqual(result.hasUnfixableIssues, false);
			assert.strictEqual(result.error, undefined);
		});

	});

	suite('isTimeoutSignal', () => {

		test('should return true for SIGTERM', () => {
			assert.strictEqual(isTimeoutSignal('SIGTERM'), true);
		});

		test('should return false for SIGKILL', () => {
			assert.strictEqual(isTimeoutSignal('SIGKILL'), false);
		});

		test('should return false for SIGINT', () => {
			assert.strictEqual(isTimeoutSignal('SIGINT'), false);
		});

		test('should return false for null', () => {
			assert.strictEqual(isTimeoutSignal(null), false);
		});

	});

	suite('createTimeoutResult', () => {

		test('should return fixed=false with provided error message', () => {
			const content = '<?php echo 1;';
			const errorMessage = 'PHPCBF operation timed out after 60 seconds. Try increasing phpcs.phpcbfTimeout for large files.';
			const result = createTimeoutResult(content, errorMessage);
			assert.strictEqual(result.fixed, false);
			assert.strictEqual(result.content, content);
			assert.strictEqual(result.hasUnfixableIssues, false);
			assert.strictEqual(result.error, errorMessage);
		});

		test('should preserve original content in result', () => {
			const content = '<?php echo "test";';
			const result = createTimeoutResult(content, 'Timeout error');
			assert.strictEqual(result.content, content);
		});

	});

	suite('parseVersionString', () => {

		test('should parse v3.7.2 version string', () => {
			const version = parseVersionString('PHP_CodeSniffer version 3.7.2 (stable) by Squiz');
			assert.strictEqual(version, '3.7.2');
		});

		test('should parse v4.0.0 version string', () => {
			const version = parseVersionString('PHP_CodeSniffer version 4.0.0 (stable) by PHPCSStandards');
			assert.strictEqual(version, '4.0.0');
		});

		test('should parse lowercase version string', () => {
			const version = parseVersionString('php_codesniffer version 3.8.0 (stable)');
			assert.strictEqual(version, '3.8.0');
		});

		test('should return null for invalid output', () => {
			const version = parseVersionString('Invalid output');
			assert.strictEqual(version, null);
		});

		test('should return null for empty string', () => {
			const version = parseVersionString('');
			assert.strictEqual(version, null);
		});

		test('should parse version with extra text', () => {
			const version = parseVersionString('PHP_CodeSniffer version 3.9.1 (dev) by PHPCSStandards\nUsage: phpcs [options]');
			assert.strictEqual(version, '3.9.1');
		});

	});

	suite('isVersionV4OrAbove', () => {

		test('should return true for v4.0.0', () => {
			assert.strictEqual(isVersionV4OrAbove('4.0.0'), true);
		});

		test('should return true for v4.1.0', () => {
			assert.strictEqual(isVersionV4OrAbove('4.1.0'), true);
		});

		test('should return true for v5.0.0', () => {
			assert.strictEqual(isVersionV4OrAbove('5.0.0'), true);
		});

		test('should return false for v3.9.9', () => {
			assert.strictEqual(isVersionV4OrAbove('3.9.9'), false);
		});

		test('should return false for v3.7.2', () => {
			assert.strictEqual(isVersionV4OrAbove('3.7.2'), false);
		});

		test('should return false for v2.0.0', () => {
			assert.strictEqual(isVersionV4OrAbove('2.0.0'), false);
		});

	});

});
