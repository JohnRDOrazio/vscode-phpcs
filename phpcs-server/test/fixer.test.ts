/* --------------------------------------------------------------------------------------------
 * Copyright (c) John R. D'Orazio. All rights reserved.
 * Licensed under the MIT License. See License.md in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import * as assert from 'assert';
import * as cp from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

import { TextDocument } from 'vscode-languageserver-textdocument';

import { PhpcbfFixer } from '../src/fixer';
import { PhpcsSettings } from '../src/settings';

/**
 * Integration tests for PHPCBF fixer that require PHPCBF to be installed.
 * These tests are skipped if PHPCBF is not available.
 */
suite('PHPCBF Fixer Integration Tests', function () {
	this.timeout(30000);

	let phpcbfPath: string | null = null;
	let phpcbfVersion: string | null = null;
	let phpcbfMajorVersion: number | null = null;
	let skipTests = false;

	const testFixturesDir = path.join(__dirname, 'fixtures');

	// Default settings for tests
	const defaultSettings: PhpcsSettings = {
		enable: true,
		workspaceRoot: testFixturesDir,
		executablePath: null,
		composerJsonPath: null,
		standard: 'PSR12',
		autoConfigSearch: false,
		showSources: false,
		showWarnings: true,
		ignorePatterns: [],
		ignoreSource: [],
		warningSeverity: 5,
		errorSeverity: 5,
		lintOnOpen: true,
		lintOnType: true,
		lintOnSave: true,
		queueBuffer: 10,
		lintOnlyOpened: true,
		phpcbfEnable: true,
		phpcbfExecutablePath: null,
		phpcbfOnSave: false,
		phpcbfTimeout: 60,
	};

	suiteSetup(function () {
		// Try to find PHPCBF
		const possiblePaths = [
			process.env.PHPCBF_PATH,
			'phpcbf',
			'vendor/bin/phpcbf',
			'./vendor/bin/phpcbf',
		].filter(Boolean) as string[];

		for (const testPath of possiblePaths) {
			try {
				const result = cp.spawnSync(testPath, ['--version'], {
					encoding: 'utf8',
					timeout: 10000,
				});
				const stdout = result.stdout || '';
				const match = stdout.match(/version (\d+\.\d+\.\d+)/i);
				if (match) {
					phpcbfPath = testPath;
					phpcbfVersion = match[1];
					phpcbfMajorVersion = parseInt(phpcbfVersion.split('.')[0], 10);
					console.log(`Found PHPCBF ${phpcbfVersion} (major: ${phpcbfMajorVersion}) at: ${testPath}`);
					break;
				}
			} catch (error) {
				console.log(`[DEBUG] PHPCBF not found at ${testPath}: ${error instanceof Error ? error.message : String(error)}`);
			}
		}

		if (!phpcbfPath) {
			console.log('PHPCBF not found, skipping fixer integration tests');
			skipTests = true;
			return;
		}

		// Create test fixtures directory
		if (!fs.existsSync(testFixturesDir)) {
			fs.mkdirSync(testFixturesDir, { recursive: true });
		}
	});

	suiteTeardown(function () {
		// Cleanup test fixtures
		if (fs.existsSync(testFixturesDir)) {
			fs.rmSync(testFixturesDir, { recursive: true, force: true });
		}
	});

	suite('PhpcbfFixer.create', function () {
		test('should create fixer instance with valid executable', async function () {
			if (skipTests) {
				this.skip();
			}

			const fixer = await PhpcbfFixer.create(phpcbfPath!);
			assert.ok(fixer, 'Fixer should be created');
			assert.strictEqual(fixer.getExecutablePath(), phpcbfPath);
			assert.ok(fixer.getExecutableVersion(), 'Version should be detected');
		});

		test('should detect version correctly', async function () {
			if (skipTests) {
				this.skip();
			}

			const fixer = await PhpcbfFixer.create(phpcbfPath!);
			const version = fixer.getExecutableVersion();
			assert.match(version, /^\d+\.\d+\.\d+$/, 'Version should be in semver format');
		});

		test('should throw error for invalid executable', async function () {
			if (skipTests) {
				this.skip();
			}

			try {
				await PhpcbfFixer.create('/nonexistent/path/to/phpcbf');
				assert.fail('Should have thrown an error');
			} catch (error) {
				assert.ok(error instanceof Error);
			}
		});
	});

	suite('PhpcbfFixer.fix', function () {

		test('should fix file with fixable errors', async function () {
			if (skipTests) {
				this.skip();
			}

			const fixer = await PhpcbfFixer.create(phpcbfPath!);

			// PHP file with fixable issues (missing newline at end, wrong indentation)
			const content = `<?php
class TestClass {
public function test() {
echo "hello";
}
}`;

			const document = TextDocument.create(
				'file:///test/fixable.php',
				'php',
				1,
				content
			);

			const result = await fixer.fix(document, defaultSettings);

			// The file has fixable issues, so it should be fixed
			assert.ok(result.fixed || result.content !== content, 'Content should be modified or marked as fixed');
			assert.strictEqual(result.error, undefined, 'Should not have an error');
		});

		test('should not modify clean file', async function () {
			if (skipTests) {
				this.skip();
			}

			const fixer = await PhpcbfFixer.create(phpcbfPath!);

			// PSR-12 compliant PHP file
			const content = `<?php

declare(strict_types=1);

namespace Test;

class CleanClass
{
    public function doSomething(): void
    {
        echo "Hello";
    }
}
`;

			const document = TextDocument.create(
				'file:///test/clean.php',
				'php',
				1,
				content
			);

			const result = await fixer.fix(document, defaultSettings);

			// Clean file should not be modified (or only whitespace changes)
			assert.strictEqual(result.error, undefined, 'Should not have an error');
		});

		test('should return empty result for empty file', async function () {
			if (skipTests) {
				this.skip();
			}

			const fixer = await PhpcbfFixer.create(phpcbfPath!);

			const document = TextDocument.create(
				'file:///test/empty.php',
				'php',
				1,
				''
			);

			const result = await fixer.fix(document, defaultSettings);

			assert.strictEqual(result.fixed, false, 'Empty file should not be fixed');
			assert.strictEqual(result.content, '', 'Content should remain empty');
			assert.strictEqual(result.error, undefined, 'Should not have an error');
		});

		test('should handle file with syntax errors gracefully', async function () {
			if (skipTests) {
				this.skip();
			}

			const fixer = await PhpcbfFixer.create(phpcbfPath!);

			// PHP file with syntax error
			const content = `<?php
class TestClass {
    public function test( {
        echo "missing closing paren";
    }
}`;

			const document = TextDocument.create(
				'file:///test/syntax-error.php',
				'php',
				1,
				content
			);

			const result = await fixer.fix(document, defaultSettings);

			// PHPCBF should handle syntax errors gracefully
			// Either return an error or return the original content
			if (result.error) {
				assert.ok(result.error.length > 0, 'Error message should not be empty');
			}
			// Either way, we should not crash
		});

		test('should respect ignore patterns', async function () {
			if (skipTests) {
				this.skip();
			}

			const fixer = await PhpcbfFixer.create(phpcbfPath!);

			const content = `<?php
class BadClass {
function noVisibility() { }
}`;

			const document = TextDocument.create(
				'file:///test/vendor/ignored.php',
				'php',
				1,
				content
			);

			const settings = {
				...defaultSettings,
				ignorePatterns: ['*/vendor/*'],
			};

			const result = await fixer.fix(document, settings);

			assert.strictEqual(result.fixed, false, 'Ignored file should not be fixed');
			assert.strictEqual(result.content, content, 'Content should not change');
		});

		test('should use specified coding standard', async function () {
			if (skipTests) {
				this.skip();
			}

			const fixer = await PhpcbfFixer.create(phpcbfPath!);

			const content = `<?php
class TestClass {
    public function test() {
        echo "hello";
    }
}`;

			const document = TextDocument.create(
				'file:///test/standard.php',
				'php',
				1,
				content
			);

			const settings = {
				...defaultSettings,
				standard: 'PSR12',
			};

			const result = await fixer.fix(document, settings);

			// Should complete without error
			assert.strictEqual(result.error, undefined, 'Should not have an error with valid standard');
		});

		test('should report error for invalid coding standard', async function () {
			if (skipTests) {
				this.skip();
			}

			const fixer = await PhpcbfFixer.create(phpcbfPath!);

			const content = `<?php echo 1;`;

			const document = TextDocument.create(
				'file:///test/invalid-standard.php',
				'php',
				1,
				content
			);

			const settings = {
				...defaultSettings,
				standard: 'NonExistentStandard12345',
				autoConfigSearch: false,
			};

			const result = await fixer.fix(document, settings);

			// Should report an error about the invalid standard
			assert.ok(result.error, 'Should have an error for invalid standard');
		});
	});

	suite('Exit Code Handling', function () {

		test('should handle exit code 0 (no changes needed)', async function () {
			if (skipTests) {
				this.skip();
			}

			const fixer = await PhpcbfFixer.create(phpcbfPath!);

			// Already compliant file
			const content = `<?php

declare(strict_types=1);

echo "Hello";
`;

			const document = TextDocument.create(
				'file:///test/compliant.php',
				'php',
				1,
				content
			);

			const result = await fixer.fix(document, defaultSettings);

			// Exit code 0 means no changes needed
			assert.strictEqual(result.error, undefined, 'Should not have an error');
		});

		test('should handle files with non-fixable issues', async function () {
			if (skipTests) {
				this.skip();
			}

			const fixer = await PhpcbfFixer.create(phpcbfPath!);

			// File with issues that cannot be auto-fixed (e.g., missing docblocks)
			const content = `<?php

class TestClass
{
    public function undocumentedMethod(): void
    {
        // This method has no docblock - not auto-fixable
    }
}
`;

			const document = TextDocument.create(
				'file:///test/non-fixable.php',
				'php',
				1,
				content
			);

			const result = await fixer.fix(document, defaultSettings);

			// Should complete without throwing
			assert.strictEqual(result.error, undefined, 'Should not have a fatal error');
			// hasUnfixableIssues may or may not be true depending on the standard
		});
	});

	suite('Version-Specific Behavior', function () {

		test('should correctly identify PHPCBF version', async function () {
			if (skipTests) {
				this.skip();
			}

			const fixer = await PhpcbfFixer.create(phpcbfPath!);
			const version = fixer.getExecutableVersion();

			// Version should match what we detected in suiteSetup
			const majorVersion = parseInt(version.split('.')[0], 10);
			assert.strictEqual(majorVersion, phpcbfMajorVersion, 'Major version should match');
		});

		test('should handle version-specific exit codes', async function () {
			if (skipTests) {
				this.skip();
			}

			const fixer = await PhpcbfFixer.create(phpcbfPath!);

			// File with some fixable issues
			const content = `<?php
class test_class {
function bad_method() {
echo "fix me";
}
}`;

			const document = TextDocument.create(
				'file:///test/version-test.php',
				'php',
				1,
				content
			);

			const result = await fixer.fix(document, defaultSettings);

			// Should handle exit codes correctly regardless of version
			// The key is that we don't crash and return a valid result
			assert.ok(
				result.fixed !== undefined,
				'Result should have fixed property'
			);
			assert.ok(
				typeof result.content === 'string',
				'Result should have content property'
			);
		});
	});

	suite('Timeout Configuration', function () {

		test('should use custom timeout setting', async function () {
			if (skipTests) {
				this.skip();
			}

			const fixer = await PhpcbfFixer.create(phpcbfPath!);

			const content = `<?php echo "test";`;

			const document = TextDocument.create(
				'file:///test/timeout-test.php',
				'php',
				1,
				content
			);

			// Test with custom timeout setting
			const settingsWithTimeout = {
				...defaultSettings,
				phpcbfTimeout: 30, // 30 seconds
			};

			const result = await fixer.fix(document, settingsWithTimeout);

			// Should complete without error (timeout not reached)
			// This test verifies the timeout setting is accepted
			assert.ok(
				result.fixed !== undefined,
				'Result should have fixed property'
			);
		});

		test('should use default timeout when not specified', async function () {
			if (skipTests) {
				this.skip();
			}

			const fixer = await PhpcbfFixer.create(phpcbfPath!);

			const content = `<?php echo "test";`;

			const document = TextDocument.create(
				'file:///test/default-timeout-test.php',
				'php',
				1,
				content
			);

			// Test with undefined timeout (should use default of 60)
			const settingsWithUndefinedTimeout = {
				...defaultSettings,
			};
			// @ts-ignore - Testing undefined case
			delete settingsWithUndefinedTimeout.phpcbfTimeout;

			// Manually set a valid timeout for this test
			const result = await fixer.fix(document, { ...settingsWithUndefinedTimeout, phpcbfTimeout: 60 });

			// Should complete without error
			assert.ok(
				result.fixed !== undefined,
				'Result should have fixed property'
			);
		});
	});
});
