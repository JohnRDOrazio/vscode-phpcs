/*---------------------------------------------------------------------------------------------
 * Copyright (c) Ioannis Kappas. All rights reserved.
 * Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import * as assert from 'assert';
import * as semver from 'semver';

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
		 * Returns true if the stderr content should throw an error
		 */
		const shouldThrowOnStderr = (stderr: string, isV4: boolean): boolean => {
			if (stderr === '') {
				return false;
			}

			// Check for fatal errors (always throw)
			// Note: (?:PHP\s?)? makes the "PHP " prefix optional
			const fatalMatch = stderr.match(/^(?:PHP\s?)?FATAL\s?ERROR:\s?(.*)/i);
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
});
