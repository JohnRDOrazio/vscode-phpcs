/*---------------------------------------------------------------------------------------------
 * Copyright (c) Ioannis Kappas. All rights reserved.
 * Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { realpathSync, findAsync } from '../src/base/node/extfs';

suite('extfs', () => {

	suite('realpathSync', () => {

		test('should return real path for existing file', () => {
			// Use this test file itself
			const testFile = __filename;
			const result = realpathSync(testFile);
			assert.ok(result.length > 0);
			assert.ok(fs.existsSync(result));
		});

		test('should return real path for existing directory', () => {
			const testDir = __dirname;
			const result = realpathSync(testDir);
			assert.ok(result.length > 0);
			assert.ok(fs.existsSync(result));
		});

		test('should throw for non-existent path', () => {
			const fakePath = path.join(__dirname, 'non-existent-file-12345.txt');
			assert.throws(() => {
				realpathSync(fakePath);
			});
		});

		test('should handle paths with . and ..', () => {
			const normalPath = path.join(__dirname, '..', 'test');
			const result = realpathSync(normalPath);
			assert.ok(result.length > 0);
			// Result should not contain .. after normalization
			assert.ok(!result.includes('..'));
		});

	});

	suite('findAsync', () => {

		let tempDir: string;

		suiteSetup(() => {
			// Create a temporary directory structure for testing
			tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'extfs-test-'));

			// Create subdirectories
			fs.mkdirSync(path.join(tempDir, 'subdir'));
			fs.mkdirSync(path.join(tempDir, 'subdir', 'nested'));

			// Create test files
			fs.writeFileSync(path.join(tempDir, 'phpcs.xml'), '<ruleset></ruleset>');
			fs.writeFileSync(path.join(tempDir, 'subdir', '.phpcs.xml'), '<ruleset></ruleset>');
		});

		suiteTeardown(() => {
			// Clean up temporary directory
			fs.rmSync(tempDir, { recursive: true, force: true });
		});

		test('should find file in parent directory', async () => {
			const result = await findAsync(tempDir, 'subdir', 'phpcs.xml');
			assert.ok(result !== null);
			assert.ok(result!.endsWith('phpcs.xml'));
		});

		test('should find file in current directory first', async () => {
			const result = await findAsync(tempDir, 'subdir', '.phpcs.xml');
			assert.ok(result !== null);
			assert.ok(result!.includes('subdir'));
		});

		test('should find file from array of names', async () => {
			const result = await findAsync(tempDir, 'subdir', ['.phpcs.xml', 'phpcs.xml']);
			assert.ok(result !== null);
		});

		test('should return null when file not found', async () => {
			const result = await findAsync(tempDir, 'subdir', 'nonexistent.xml');
			assert.strictEqual(result, null);
		});

		test('should search up directory tree', async () => {
			const result = await findAsync(tempDir, 'subdir/nested', 'phpcs.xml');
			assert.ok(result !== null);
			assert.ok(result!.endsWith('phpcs.xml'));
		});

		test('should throw on invalid parent parameter', async () => {
			await assert.rejects(async () => {
				await findAsync(null as any, 'subdir', 'phpcs.xml');
			}, /Invalid or no `parent` provided/);
		});

		test('should throw on invalid directory parameter', async () => {
			await assert.rejects(async () => {
				await findAsync(tempDir, null as any, 'phpcs.xml');
			}, /Invalid or no `directory` provided/);
		});

		test('should throw on invalid name parameter', async () => {
			await assert.rejects(async () => {
				await findAsync(tempDir, 'subdir', null as any);
			}, /Invalid or no `name` provided/);
		});

	});

});
