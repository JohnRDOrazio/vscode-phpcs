/* --------------------------------------------------------------------------------------------
 * Copyright (c) 2026 John Romano D'Orazio. All rights reserved.
 * Licensed under the MIT License. See License.md in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import * as assert from 'assert';
import * as cp from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { URI } from 'vscode-uri';

import { PhpcsLinter } from '../src/linter';
import { PhpcsSettings } from '../src/settings';

/**
 * Integration tests that require PHPCS to be installed.
 * These tests are skipped if PHPCS is not available.
 */
suite('PHPCS Integration Tests', function () {
	this.timeout(30000);

	let phpcsPath: string | null = null;
	let phpcsVersion: string | null = null;
	let phpcsMajorVersion: number | null = null;
	let skipTests = false;

	suiteSetup(function () {
		// Try to find PHPCS
		const possiblePaths = [
			process.env.PHPCS_PATH,
			'phpcs',
			'vendor/bin/phpcs',
			'./vendor/bin/phpcs',
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
					phpcsPath = testPath;
					phpcsVersion = match[1];
					phpcsMajorVersion = parseInt(phpcsVersion.split('.')[0], 10);
					console.log(`Found PHPCS ${phpcsVersion} (major: ${phpcsMajorVersion}) at: ${testPath}`);
					break;
				}
			} catch (error) {
				// Log discovery failure and try next path
				console.log(`[DEBUG] PHPCS not found at ${testPath}: ${error instanceof Error ? error.message : String(error)}`);
			}
		}

		if (!phpcsPath) {
			console.log('PHPCS not found, skipping integration tests');
			skipTests = true;
		}
	});

	suite('Version Detection', function () {
		test('should detect PHPCS version correctly', function () {
			if (skipTests) {
				this.skip();
			}
			assert.ok(phpcsVersion, 'PHPCS version should be detected');
			assert.match(
				phpcsVersion!,
				/^\d+\.\d+\.\d+$/,
				'Version should be in semver format'
			);
		});

		test('should identify major version', function () {
			if (skipTests) {
				this.skip();
			}
			// NOTE: When PHPCS v5+ is released, update this range after verifying
			// compatibility in linter.ts (check isV4OrAbove() and exit code handling)
			assert.ok(
				phpcsMajorVersion! >= 1 && phpcsMajorVersion! <= 4,
				`Major version ${phpcsMajorVersion} should be between 1 and 4`
			);
			console.log(`PHPCS major version: ${phpcsMajorVersion}`);
		});
	});

	suite('Linting', function () {
		const testFixturesDir = path.join(__dirname, 'fixtures');
		const cleanPhpFile = path.join(testFixturesDir, 'clean.php');
		const errorPhpFile = path.join(testFixturesDir, 'with-errors.php');

		suiteSetup(function () {
			if (skipTests) {
				return;
			}

			// Create test fixtures directory and files
			if (!fs.existsSync(testFixturesDir)) {
				fs.mkdirSync(testFixturesDir, { recursive: true });
			}

			// Clean PHP file (PSR-12 compliant)
			fs.writeFileSync(
				cleanPhpFile,
				`<?php

declare(strict_types=1);

namespace Test;

class CleanClass
{
    public function doSomething(): void
    {
        echo "Hello";
    }
}
`
			);

			// PHP file with errors
			fs.writeFileSync(
				errorPhpFile,
				`<?php
class badClassName {
    function noVisibility() {
        echo "missing visibility";
    }
}
`
			);
		});

		suiteTeardown(function () {
			// Cleanup test fixtures
			if (fs.existsSync(testFixturesDir)) {
				fs.rmSync(testFixturesDir, { recursive: true, force: true });
			}
		});

		test('should return valid JSON output', function () {
			if (skipTests) {
				this.skip();
			}

			const result = cp.spawnSync(
				phpcsPath!,
				['--report=json', '--standard=PSR12', cleanPhpFile],
				{ encoding: 'utf8', timeout: 10000 }
			);

			// PHPCS should output valid JSON to stdout
			const stdout = result.stdout.trim();
			assert.ok(stdout.length > 0, 'Should have stdout output');

			let parsed;
			try {
				parsed = JSON.parse(stdout);
			} catch (e) {
				assert.fail(`Failed to parse JSON output: ${stdout}`);
			}

			assert.ok(parsed.totals !== undefined, 'Should have totals object');
			assert.ok(parsed.files !== undefined, 'Should have files object');
		});

		test('should detect errors in non-compliant code', function () {
			if (skipTests) {
				this.skip();
			}

			const result = cp.spawnSync(
				phpcsPath!,
				['--report=json', '--standard=PSR12', errorPhpFile],
				{ encoding: 'utf8', timeout: 10000 }
			);

			const stdout = result.stdout.trim();
			const parsed = JSON.parse(stdout);

			assert.ok(
				parsed.totals.errors > 0 || parsed.totals.warnings > 0,
				'Should detect errors or warnings in non-compliant code'
			);
		});

		test('should handle STDERR correctly for this PHPCS version', function () {
			if (skipTests) {
				this.skip();
			}

			const result = cp.spawnSync(
				phpcsPath!,
				['--report=json', '--standard=PSR12', cleanPhpFile],
				{ encoding: 'utf8', timeout: 10000 }
			);

			const stderr = result.stderr.trim();

			if (phpcsMajorVersion! >= 4) {
				// PHPCS v4 may output progress/debug info to STDERR
				// This should NOT cause the linter to fail
				console.log(`PHPCS v4 STDERR (if any): "${stderr}"`);
			} else {
				// PHPCS v3 and below should have empty STDERR for successful runs
				if (stderr.length > 0) {
					console.log(`PHPCS v${phpcsMajorVersion} STDERR: "${stderr}"`);
				}
			}

			// Regardless of version, we should get valid JSON from stdout
			const stdout = result.stdout.trim();
			assert.doesNotThrow(
				() => JSON.parse(stdout),
				'Should always produce valid JSON output'
			);
		});

		test('should return correct exit codes', function () {
			if (skipTests) {
				this.skip();
			}

			// Test clean file
			const cleanResult = cp.spawnSync(
				phpcsPath!,
				['--report=json', '--standard=PSR12', cleanPhpFile],
				{ encoding: 'utf8', timeout: 10000 }
			);

			assert.strictEqual(
				cleanResult.status,
				0,
				'Clean file should return exit code 0'
			);

			// Test file with errors
			const errorResult = cp.spawnSync(
				phpcsPath!,
				['--report=json', '--standard=PSR12', errorPhpFile],
				{ encoding: 'utf8', timeout: 10000 }
			);

			if (phpcsMajorVersion! >= 4) {
				// PHPCS v4: 1=fixable, 2=unfixable, 3=both
				assert.ok(
					errorResult.status !== null && [1, 2, 3].includes(errorResult.status),
					`PHPCS v4 should return 1, 2, or 3 for errors (got ${errorResult.status})`
				);
			} else {
				// PHPCS v3 and below: 1=errors found, 2=warnings only (no errors)
				assert.ok(
					errorResult.status !== null && [1, 2].includes(errorResult.status),
					`PHPCS v3 should return 1 (errors) or 2 (warnings only) for issues (got ${errorResult.status})`
				);
			}
		});
	});

	suite('PhpcsLinter.lint()', function () {
		let lintFixturesDir: string;
		let errorPhpFile: string;
		let cleanPhpFile: string;

		suiteSetup(function () {
			if (skipTests) {
				return;
			}

			lintFixturesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'phpcs-lint-integration-'));

			errorPhpFile = path.join(lintFixturesDir, 'with-errors.php');
			fs.writeFileSync(
				errorPhpFile,
				`<?php
class badClassName {
    function noVisibility() {
        echo "missing visibility";
    }
}
`
			);

			cleanPhpFile = path.join(lintFixturesDir, 'clean.php');
			fs.writeFileSync(
				cleanPhpFile,
				`<?php

declare(strict_types=1);

namespace Test;

class CleanClass
{
    public function doSomething(): void
    {
        echo "Hello";
    }
}
`
			);
		});

		suiteTeardown(function () {
			if (lintFixturesDir && fs.existsSync(lintFixturesDir)) {
				fs.rmSync(lintFixturesDir, { recursive: true, force: true });
			}
		});

		function makeSettings(overrides: Partial<PhpcsSettings> = {}): PhpcsSettings {
			return {
				enable: true,
				workspaceRoot: lintFixturesDir,
				executablePath: phpcsPath,
				composerJsonPath: null,
				standard: null,
				autoConfigSearch: false,
				showSources: false,
				showWarnings: true,
				ignorePatterns: [],
				extensions: [],
				ignoreSource: [],
				warningSeverity: 5,
				errorSeverity: 5,
				lintOnOpen: true,
				lintOnSave: true,
				lintOnType: true,
				queueBuffer: 10,
				lintOnlyOpened: true,
				phpcbfEnable: false,
				phpcbfExecutablePath: null,
				phpcbfOnSave: false,
				phpcbfTimeout: 60,
				...overrides,
			};
		}

		function makeDocument(filePath: string): TextDocument {
			return TextDocument.create(
				URI.file(filePath).toString(),
				'php',
				1,
				fs.readFileSync(filePath, 'utf8')
			);
		}

		test('should return empty diagnostics and null standard for an empty document', async function () {
			if (skipTests) {
				this.skip();
			}

			const linter = await PhpcsLinter.create(phpcsPath!);
			const emptyDocument = TextDocument.create(
				URI.file(path.join(lintFixturesDir, 'empty.php')).toString(),
				'php',
				1,
				''
			);
			const result = await linter.lint(emptyDocument, makeSettings());

			assert.deepStrictEqual(result, { diagnostics: [], standard: null });
		});

		test('should return diagnostics and the configured standard', async function () {
			if (skipTests) {
				this.skip();
			}

			const linter = await PhpcsLinter.create(phpcsPath!);
			const result = await linter.lint(
				makeDocument(errorPhpFile),
				makeSettings({ standard: 'PSR12' })
			);

			assert.strictEqual(result.standard, 'PSR12');
			assert.ok(
				result.diagnostics.length > 0,
				'Should produce diagnostics for non-compliant code'
			);
		});

		test('should lint a file with a listed extension via phpcs.extensions (issue #115)', async function () {
			if (skipTests) {
				this.skip();
			}

			// Drupal's .install files are PHP, but not in PHPCS's default extension list
			const installFile = path.join(lintFixturesDir, 'my_module.install');
			fs.copyFileSync(errorPhpFile, installFile);

			try {
				const linter = await PhpcsLinter.create(phpcsPath!);

				const skipped = await linter.lint(
					makeDocument(installFile),
					makeSettings({ standard: 'PSR12' })
				);
				assert.strictEqual(
					skipped.diagnostics.length,
					0,
					'PHPCS should skip the file when its extension is not configured'
				);

				const linted = await linter.lint(
					makeDocument(installFile),
					makeSettings({ standard: 'PSR12', extensions: ['module', 'install'] })
				);
				assert.ok(
					linted.diagnostics.length > 0,
					'Should produce diagnostics once the extension is configured'
				);
			} finally {
				fs.rmSync(installFile, { force: true });
			}
		});

		test('should tokenize a listed .js extension as PHP', async function () {
			if (skipTests) {
				this.skip();
			}

			// PHPCS 3.x tokenizes a bare `js` extension as JavaScript, which reads
			// `<?php` as operators and misses every class-level PHP sniff
			const jsFile = path.join(lintFixturesDir, 'php-classified.js');
			fs.copyFileSync(errorPhpFile, jsFile);

			try {
				const linter = await PhpcsLinter.create(phpcsPath!);
				const result = await linter.lint(
					makeDocument(jsFile),
					makeSettings({ standard: 'PSR12', showSources: true, extensions: ['js'] })
				);
				// LSP 3.18 widened Diagnostic.message to `string | MarkupContent`;
				// the linter always produces strings.
				const messages = result.diagnostics.map(diagnostic => diagnostic.message as string);

				assert.ok(
					messages.some(message => message.includes('Squiz.Classes.ValidClassName')),
					`Should run PHP sniffs on the file (got: ${messages.join(' | ')})`
				);
				assert.ok(
					!messages.some(message => message.includes('OperatorSpacing')),
					`Should not treat <?php as JavaScript operators (got: ${messages.join(' | ')})`
				);
			} finally {
				fs.rmSync(jsFile, { force: true });
			}
		});

		test('should keep linting .php files when phpcs.extensions lists other extensions', async function () {
			if (skipTests) {
				this.skip();
			}

			const linter = await PhpcsLinter.create(phpcsPath!);
			const result = await linter.lint(
				makeDocument(errorPhpFile),
				makeSettings({ standard: 'PSR12', extensions: ['module', 'install'] })
			);

			assert.ok(
				result.diagnostics.length > 0,
				'Listing extra extensions must not stop PHPCS from checking .php files'
			);
		});

		test('should return the auto-detected ruleset path as the standard', async function () {
			if (skipTests) {
				this.skip();
			}

			const rulesetPath = path.join(lintFixturesDir, '.phpcs.xml');
			fs.writeFileSync(
				rulesetPath,
				'<?xml version="1.0"?>\n<ruleset name="Test"><rule ref="PSR12"/></ruleset>\n'
			);

			try {
				const linter = await PhpcsLinter.create(phpcsPath!);
				const result = await linter.lint(
					makeDocument(errorPhpFile),
					makeSettings({ autoConfigSearch: true })
				);

				assert.strictEqual(result.standard, rulesetPath);
				assert.ok(
					result.diagnostics.length > 0,
					'Should produce diagnostics via the auto-detected ruleset'
				);
			} finally {
				fs.rmSync(rulesetPath, { force: true });
			}
		});

		test('should return empty diagnostics but the resolved standard for a clean document', async function () {
			if (skipTests) {
				this.skip();
			}

			const linter = await PhpcsLinter.create(phpcsPath!);
			const result = await linter.lint(
				makeDocument(cleanPhpFile),
				makeSettings({ standard: 'PSR12' })
			);

			assert.strictEqual(result.standard, 'PSR12');
			assert.deepStrictEqual(result.diagnostics, []);
		});
	});
});
