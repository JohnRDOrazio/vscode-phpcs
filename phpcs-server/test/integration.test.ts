/* --------------------------------------------------------------------------------------------
 * Copyright (c) Ioannis Kappas. All rights reserved.
 * Licensed under the MIT License. See License.md in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import * as assert from 'assert';
import * as cp from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

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
				// PHPCS v3 and below: 1=errors, 2=warnings only
				assert.ok(
					errorResult.status !== null && [1, 2].includes(errorResult.status),
					`PHPCS v3 should return 1 or 2 for errors (got ${errorResult.status})`
				);
			}
		});
	});
});
