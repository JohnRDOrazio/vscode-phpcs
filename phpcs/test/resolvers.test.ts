/* --------------------------------------------------------------------------------------------
 * Copyright (c) 2026 John Romano D'Orazio. All rights reserved.
 * Licensed under the MIT License. See License.md in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
"use strict";

import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { GlobalPhpcsPathResolver } from '../src/resolvers/global-path-resolver';
import { ComposerPhpcsPathResolver } from '../src/resolvers/composer-path-resolver';
import { PhpcsPathResolver } from '../src/resolvers/path-resolver';

// The resolvers derive the binary name from the platform, so the fixtures have
// to agree with them or every assertion here passes on Linux and fails on the
// Windows leg of the build matrix.
const PHPCS_BINARY = /^win/.test(process.platform) ? 'phpcs.bat' : 'phpcs';

// Canonicalised deliberately. On macOS os.tmpdir() is /var/folders/…, a symlink
// to /private/var/folders/…, and ComposerPhpcsPathResolver runs the composer.json
// path through fs.realpathSync — so the resolver returns the real path while an
// uncanonicalised fixture would expect the symlinked one. Linux and Windows never
// show the difference, so this fails only on the macOS leg of the matrix.
function makeTempDir(): string {
	return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'phpcs-resolver-')));
}

function writeFile(filePath: string, contents: string): string {
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, contents);
	return filePath;
}

suite('GlobalPhpcsPathResolver', () => {
	let tmpDir: string;
	let originalPath: string | undefined;

	setup(() => {
		tmpDir = makeTempDir();
		originalPath = process.env.PATH;
	});

	teardown(() => {
		// Assigning undefined would set the string "undefined" on some Node
		// versions; delete then restore instead.
		if (originalPath === undefined) {
			delete process.env.PATH;
		} else {
			process.env.PATH = originalPath;
		}
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	test('resolves the executable from a directory on PATH', async () => {
		const expected = writeFile(path.join(tmpDir, PHPCS_BINARY), '');
		process.env.PATH = tmpDir;

		const resolved = await new GlobalPhpcsPathResolver().resolve();

		assert.strictEqual(resolved, expected);
	});

	test('returns null when the executable is on no PATH entry', async () => {
		process.env.PATH = tmpDir;

		const resolved = await new GlobalPhpcsPathResolver().resolve();

		assert.strictEqual(resolved, null);
	});

	test('scans every PATH entry, not just the first', async () => {
		const emptyDir = makeTempDir();
		const expected = writeFile(path.join(tmpDir, PHPCS_BINARY), '');
		const separator = /^win/.test(process.platform) ? ';' : ':';
		process.env.PATH = [emptyDir, tmpDir].join(separator);

		try {
			const resolved = await new GlobalPhpcsPathResolver().resolve();
			assert.strictEqual(resolved, expected);
		} finally {
			fs.rmSync(emptyDir, { recursive: true, force: true });
		}
	});

	// PATH is not guaranteed to be set — a bare `env -i node`, a service manager
	// with a scrubbed environment, or a test harness will all reach this. Before
	// the strictNullChecks pass this threw "Cannot read properties of undefined
	// (reading 'split')" instead of reporting that phpcs could not be found.
	test('returns null rather than throwing when PATH is unset', async () => {
		delete process.env.PATH;

		const resolved = await new GlobalPhpcsPathResolver().resolve();

		assert.strictEqual(resolved, null);
	});
});

suite('ComposerPhpcsPathResolver', () => {
	let tmpDir: string;

	setup(() => {
		tmpDir = makeTempDir();
	});

	teardown(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	function scaffoldProject(options: { composerJson?: object; withBinary?: boolean; dependency?: boolean } = {}): void {
		const { composerJson = {}, withBinary = true, dependency = true } = options;
		writeFile(path.join(tmpDir, 'composer.json'), JSON.stringify(composerJson));
		writeFile(
			path.join(tmpDir, 'composer.lock'),
			JSON.stringify({
				'packages-dev': dependency ? [{ name: 'squizlabs/php_codesniffer' }] : [{ name: 'phpunit/phpunit' }],
			})
		);
		if (withBinary) {
			writeFile(path.join(tmpDir, 'vendor', 'bin', PHPCS_BINARY), '');
		}
	}

	test('resolves the vendor binary when phpcs is a composer dependency', async () => {
		scaffoldProject();

		const resolved = await new ComposerPhpcsPathResolver(tmpDir, 'composer.json').resolve();

		assert.strictEqual(resolved, path.join(tmpDir, 'vendor', 'bin', PHPCS_BINARY));
	});

	test('returns null when the project declares no phpcs dependency', async () => {
		scaffoldProject({ dependency: false });

		const resolved = await new ComposerPhpcsPathResolver(tmpDir, 'composer.json').resolve();

		assert.strictEqual(resolved, null);
	});

	test('returns null when there is no composer project at all', async () => {
		const resolved = await new ComposerPhpcsPathResolver(tmpDir, 'composer.json').resolve();

		assert.strictEqual(resolved, null);
	});

	test('throws a directive error when the dependency is declared but not installed', async () => {
		scaffoldProject({ withBinary: false });

		await assert.rejects(
			() => new ComposerPhpcsPathResolver(tmpDir, 'composer.json').resolve(),
			/composer install/
		);
	});

	test('honours a custom config.vendor-dir', async () => {
		scaffoldProject({ composerJson: { config: { 'vendor-dir': 'custom-vendor' } }, withBinary: false });
		const expected = writeFile(path.join(tmpDir, 'custom-vendor', 'bin', PHPCS_BINARY), '');

		const resolved = await new ComposerPhpcsPathResolver(tmpDir, 'composer.json').resolve();

		assert.strictEqual(resolved, expected);
	});

	test('honours a custom config.bin-dir', async () => {
		scaffoldProject({ composerJson: { config: { 'bin-dir': 'custom-bin' } }, withBinary: false });
		const expected = writeFile(path.join(tmpDir, 'custom-bin', PHPCS_BINARY), '');

		const resolved = await new ComposerPhpcsPathResolver(tmpDir, 'composer.json').resolve();

		assert.strictEqual(resolved, expected);
	});

	// The second constructor argument is declared optional. Before the
	// strictNullChecks pass, omitting it threw from path.isAbsolute(undefined)
	// rather than falling back to the workspace root's own composer.json.
	test('defaults to the workspace root composer.json when no working path is given', async () => {
		scaffoldProject();

		const resolved = await new ComposerPhpcsPathResolver(tmpDir).resolve();

		assert.strictEqual(resolved, path.join(tmpDir, 'vendor', 'bin', PHPCS_BINARY));
	});

	test('accepts an absolute working path', async () => {
		scaffoldProject();

		const resolver = new ComposerPhpcsPathResolver(tmpDir, tmpDir);

		assert.strictEqual(resolver.workingPath, tmpDir);
	});
});

suite('PhpcsPathResolver', () => {
	let tmpDir: string;
	let originalPath: string | undefined;

	setup(() => {
		tmpDir = makeTempDir();
		originalPath = process.env.PATH;
	});

	teardown(() => {
		if (originalPath === undefined) {
			delete process.env.PATH;
		} else {
			process.env.PATH = originalPath;
		}
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	test('prefers the composer binary over one on PATH', async () => {
		writeFile(path.join(tmpDir, 'composer.json'), '{}');
		writeFile(path.join(tmpDir, 'composer.lock'), JSON.stringify({ packages: [{ name: 'squizlabs/php_codesniffer' }] }));
		const vendorBinary = writeFile(path.join(tmpDir, 'vendor', 'bin', PHPCS_BINARY), '');

		const globalDir = makeTempDir();
		writeFile(path.join(globalDir, PHPCS_BINARY), '');
		process.env.PATH = globalDir;

		try {
			const resolved = await new PhpcsPathResolver({ workspaceRoot: tmpDir, composerJsonPath: 'composer.json' }).resolve();
			assert.strictEqual(resolved, vendorBinary);
		} finally {
			fs.rmSync(globalDir, { recursive: true, force: true });
		}
	});

	test('falls back to PATH when there is no composer project', async () => {
		const expected = writeFile(path.join(tmpDir, PHPCS_BINARY), '');
		process.env.PATH = tmpDir;

		const resolved = await new PhpcsPathResolver({ workspaceRoot: null, composerJsonPath: 'composer.json' }).resolve();

		assert.strictEqual(resolved, expected);
	});

	test('throws a directive error when phpcs cannot be found anywhere', async () => {
		process.env.PATH = tmpDir;

		await assert.rejects(
			() => new PhpcsPathResolver({ workspaceRoot: null, composerJsonPath: 'composer.json' }).resolve(),
			/Unable to locate phpcs/
		);
	});
});
