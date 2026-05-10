/*---------------------------------------------------------------------------------------------
 * Copyright (c) Ioannis Kappas. All rights reserved.
 * Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import * as assert from 'assert';
import * as semver from 'semver';
import { FATAL_ERROR_PATTERN } from '../src/linter';
import { transformIgnorePattern, isIgnorePatternMatch } from '../src/linter-utils';

/**
 * Tests for PHPCS version comparison logic used in linter.ts
 *
 * These tests verify the version comparison logic that determines
 * how STDERR and exit codes are handled for different PHPCS versions.
 */
suite('Linter Version Handling', () => {

	/**
	 * Test the isV4OrAbove logic using semver directly.
	 * This mirrors the logic in PhpcsLinter.isV4OrAbove()
	 */
	suite('isV4OrAbove logic', () => {
		const isV4OrAbove = (version: string): boolean => {
			return semver.gte(version, '4.0.0');
		};

		test('should return true for v4.0.0', () => {
			assert.strictEqual(isV4OrAbove('4.0.0'), true);
		});

		test('should return true for v4.0.1', () => {
			assert.strictEqual(isV4OrAbove('4.0.1'), true);
		});

		test('should return true for v4.1.0', () => {
			assert.strictEqual(isV4OrAbove('4.1.0'), true);
		});

		test('should return true for v5.0.0', () => {
			assert.strictEqual(isV4OrAbove('5.0.0'), true);
		});

		test('should return false for v3.9.9', () => {
			assert.strictEqual(isV4OrAbove('3.9.9'), false);
		});

		test('should return false for v3.7.2', () => {
			assert.strictEqual(isV4OrAbove('3.7.2'), false);
		});

		test('should return false for v2.9.0', () => {
			assert.strictEqual(isV4OrAbove('2.9.0'), false);
		});

		test('should return false for v1.0.0', () => {
			assert.strictEqual(isV4OrAbove('1.0.0'), false);
		});
	});

	/**
	 * Test STDERR handling logic for different PHPCS versions
	 */
	suite('STDERR handling logic', () => {

		/**
		 * Simulates the STDERR error detection logic from linter.ts
		 * Returns true if the stderr content should throw an error.
		 * Uses FATAL_ERROR_PATTERN imported from linter.ts to ensure consistency.
		 */
		const shouldThrowOnStderr = (stderr: string, isV4: boolean): boolean => {
			if (stderr === '') {
				return false;
			}

			// Check for fatal errors (always throw) - uses exported pattern from linter.ts
			const fatalMatch = stderr.match(FATAL_ERROR_PATTERN);
			if (fatalMatch) {
				return true;
			}

			// For v3 and below, any non-empty stderr is an error
			// For v4+, non-fatal stderr is just debug/progress output
			return !isV4;
		};

		test('should not throw on empty stderr (v3)', () => {
			assert.strictEqual(shouldThrowOnStderr('', false), false);
		});

		test('should not throw on empty stderr (v4)', () => {
			assert.strictEqual(shouldThrowOnStderr('', true), false);
		});

		test('should throw on fatal error (v3)', () => {
			// The regex requires FATAL ERROR at the start of stderr
			const stderr = 'FATAL ERROR: some critical error';
			assert.strictEqual(shouldThrowOnStderr(stderr, false), true);
		});

		test('should throw on fatal error (v4)', () => {
			// Fatal errors should always throw, regardless of version
			const stderr = 'FATAL ERROR: some critical error';
			assert.strictEqual(shouldThrowOnStderr(stderr, true), true);
		});

		test('should throw on PHP fatal error (v3)', () => {
			const stderr = 'PHP FATAL ERROR: Uncaught exception';
			assert.strictEqual(shouldThrowOnStderr(stderr, false), true);
		});

		test('should throw on PHP fatal error (v4)', () => {
			const stderr = 'PHP FATAL ERROR: Uncaught exception';
			assert.strictEqual(shouldThrowOnStderr(stderr, true), true);
		});

		test('should throw on non-fatal stderr content (v3)', () => {
			const stderr = 'Processing file.php';
			assert.strictEqual(shouldThrowOnStderr(stderr, false), true);
		});

		test('should NOT throw on non-fatal stderr content (v4)', () => {
			const stderr = 'Processing file.php';
			assert.strictEqual(shouldThrowOnStderr(stderr, true), false);
		});

		test('should NOT throw on progress output (v4)', () => {
			const stderr = '....';
			assert.strictEqual(shouldThrowOnStderr(stderr, true), false);
		});

		test('should NOT throw on debug output (v4)', () => {
			const stderr = 'Registered 10 sniffs';
			assert.strictEqual(shouldThrowOnStderr(stderr, true), false);
		});
	});

	/**
	 * Test exit code handling logic for PHPCS v4
	 */
	suite('Exit code handling (v4)', () => {

		/**
		 * Simulates exit code error detection for v4
		 * Returns error message if exit code indicates an error, null otherwise
		 */
		const getV4ExitCodeError = (exitCode: number | null): string | null => {
			if (exitCode === 16) {
				return 'Processing error';
			}
			if (exitCode === 64) {
				return 'Requirements not met';
			}
			// Exit codes 0, 1, 2, 3 are normal operation
			return null;
		};

		test('exit code 0 (clean) should not error', () => {
			assert.strictEqual(getV4ExitCodeError(0), null);
		});

		test('exit code 1 (auto-fixable issues) should not error', () => {
			assert.strictEqual(getV4ExitCodeError(1), null);
		});

		test('exit code 2 (non-auto-fixable issues) should not error', () => {
			assert.strictEqual(getV4ExitCodeError(2), null);
		});

		test('exit code 3 (mixed issues) should not error', () => {
			assert.strictEqual(getV4ExitCodeError(3), null);
		});

		test('exit code 16 (processing error) should error', () => {
			assert.strictEqual(getV4ExitCodeError(16), 'Processing error');
		});

		test('exit code 64 (requirements not met) should error', () => {
			assert.strictEqual(getV4ExitCodeError(64), 'Requirements not met');
		});

		test('exit code null should not error', () => {
			assert.strictEqual(getV4ExitCodeError(null), null);
		});

		test('unexpected exit codes should not error', () => {
			// Exit codes not defined by PHPCS v4 are treated as non-errors
			assert.strictEqual(getV4ExitCodeError(4), null);
			assert.strictEqual(getV4ExitCodeError(128), null);
		});
	});

	/**
	 * Test version string parsing (from --version output)
	 */
	suite('Version string parsing', () => {
		const versionPattern: RegExp = /^PHP_CodeSniffer version (\d+\.\d+\.\d+)/i;

		const parseVersion = (output: string): string | null => {
			const matches = output.match(versionPattern);
			return matches ? matches[1] : null;
		};

		test('should parse v3.7.2 version string', () => {
			const output = 'PHP_CodeSniffer version 3.7.2 (stable) by Squiz (http://www.squiz.net)';
			assert.strictEqual(parseVersion(output), '3.7.2');
		});

		test('should parse v4.0.0 version string', () => {
			const output = 'PHP_CodeSniffer version 4.0.0 (stable) by Squiz and PHPCSStandards';
			assert.strictEqual(parseVersion(output), '4.0.0');
		});

		test('should parse v4.0.1 version string', () => {
			const output = 'PHP_CodeSniffer version 4.0.1 (stable) by Squiz and PHPCSStandards';
			assert.strictEqual(parseVersion(output), '4.0.1');
		});

		test('should parse version with lowercase prefix', () => {
			const output = 'php_codesniffer version 3.5.0 (stable)';
			assert.strictEqual(parseVersion(output), '3.5.0');
		});

		test('should return null for invalid output', () => {
			const output = 'Invalid version string';
			assert.strictEqual(parseVersion(output), null);
		});

		test('should return null for empty output', () => {
			assert.strictEqual(parseVersion(''), null);
		});
	});

	/**
	 * Test ignore pattern matching logic using imported functions from linter-utils.ts
	 */
	suite('Ignore pattern matching', () => {

		test('should match exact file path', () => {
			assert.strictEqual(isIgnorePatternMatch('/path/to/file.php', '/path/to/file.php'), true);
		});

		test('should match with wildcard extension', () => {
			assert.strictEqual(isIgnorePatternMatch('/path/to/file.php', '/path/to/*.php'), true);
		});

		test('should match with double wildcard', () => {
			assert.strictEqual(isIgnorePatternMatch('/path/to/deep/file.php', '/path/**/*.php'), true);
		});

		test('should transform */pattern/* to **/pattern/**', () => {
			const pattern = '*/vendor/*';
			const transformed = transformIgnorePattern(pattern);
			// Both leading */ and trailing /* get transformed
			assert.strictEqual(transformed, '**/vendor/**');
		});

		test('should transform pattern/* to pattern/**', () => {
			const pattern = 'vendor/*';
			const transformed = transformIgnorePattern(pattern);
			assert.strictEqual(transformed, 'vendor/**');
		});

		test('should transform /*/  to /**/ in middle of pattern', () => {
			const pattern = 'path/*/file.php';
			const transformed = transformIgnorePattern(pattern);
			assert.strictEqual(transformed, 'path/**/file.php');
		});

		test('should not match unrelated paths', () => {
			assert.strictEqual(isIgnorePatternMatch('/other/path/file.php', '/path/to/*.php'), false);
		});

		test('should match vendor directory pattern', () => {
			assert.strictEqual(isIgnorePatternMatch('/project/vendor/package/file.php', '**/vendor/**'), true);
		});

		test('should match node_modules pattern', () => {
			assert.strictEqual(isIgnorePatternMatch('/project/node_modules/package/index.js', '**/node_modules/**'), true);
		});

	});

	/**
	 * Test JSON parsing logic (mirrors parseData in linter.ts)
	 */
	suite('JSON parsing', () => {

		const parseData = (text: string): { files: any } => {
			try {
				return JSON.parse(text) as { files: any };
			} catch (error) {
				throw new Error('Invalid json string received.');
			}
		};

		test('should parse valid PHPCS JSON output', () => {
			const json = '{"totals":{"errors":1,"warnings":0},"files":{"/path/file.php":{"errors":1,"warnings":0,"messages":[{"message":"Error","source":"Test.Rule","severity":5,"fixable":false,"type":"ERROR","line":1,"column":1}]}}}';
			const result = parseData(json);
			assert.ok(result.files);
			assert.ok(result.files['/path/file.php']);
		});

		test('should parse empty files object', () => {
			const json = '{"totals":{"errors":0,"warnings":0},"files":{}}';
			const result = parseData(json);
			assert.deepStrictEqual(result.files, {});
		});

		test('should throw on invalid JSON', () => {
			assert.throws(() => {
				parseData('not valid json');
			}, /Invalid json string received/);
		});

		test('should throw on empty string', () => {
			assert.throws(() => {
				parseData('');
			}, /Invalid json string received/);
		});

		test('should parse STDIN file key (PHPCS v1)', () => {
			const json = '{"totals":{"errors":1},"files":{"STDIN":{"errors":1,"messages":[]}}}';
			const result = parseData(json);
			assert.ok(result.files['STDIN']);
		});

	});

	/**
	 * Test diagnostic severity mapping
	 */
	suite('Diagnostic severity', () => {

		const mapSeverity = (type: string): string => {
			if (type === 'WARNING') {
				return 'Warning';
			}
			return 'Error';
		};

		test('should map ERROR to Error severity', () => {
			assert.strictEqual(mapSeverity('ERROR'), 'Error');
		});

		test('should map WARNING to Warning severity', () => {
			assert.strictEqual(mapSeverity('WARNING'), 'Warning');
		});

		test('should default to Error for unknown types', () => {
			assert.strictEqual(mapSeverity('UNKNOWN'), 'Error');
		});

	});

	/**
	 * Test FATAL_ERROR_PATTERN regex
	 */
	suite('FATAL_ERROR_PATTERN', () => {

		test('should match FATAL ERROR prefix', () => {
			const match = 'FATAL ERROR: Out of memory'.match(FATAL_ERROR_PATTERN);
			assert.ok(match);
			assert.strictEqual(match![1], 'Out of memory');
		});

		test('should match PHP FATAL ERROR prefix', () => {
			const match = 'PHP FATAL ERROR: Uncaught exception'.match(FATAL_ERROR_PATTERN);
			assert.ok(match);
			assert.strictEqual(match![1], 'Uncaught exception');
		});

		test('should match case-insensitively', () => {
			const match = 'fatal error: Something went wrong'.match(FATAL_ERROR_PATTERN);
			assert.ok(match);
		});

		test('should match PHP Fatal Error with space variations', () => {
			const match = 'PHP Fatal Error: test'.match(FATAL_ERROR_PATTERN);
			assert.ok(match);
		});

		test('should not match non-fatal messages', () => {
			const match = 'Processing file.php'.match(FATAL_ERROR_PATTERN);
			assert.strictEqual(match, null);
		});

		test('should not match ERROR without FATAL', () => {
			const match = 'ERROR: Some error'.match(FATAL_ERROR_PATTERN);
			assert.strictEqual(match, null);
		});

	});

});
