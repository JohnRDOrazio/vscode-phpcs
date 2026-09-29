/*---------------------------------------------------------------------------------------------
 * Copyright (c) 2026 John Romano D'Orazio. All rights reserved.
 * Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PhpcsLinter } from '../src/linter';
import { PhpcbfFixer } from '../src/fixer';

/**
 * The executable path must reach the OS as a path, never as shell code.
 * Workspace folder names, Composer's vendor-dir and relative settings joined
 * to the workspace root all end up in it.
 */
suite('Executable version detection', () => {
	const VERSION_LINE = 'PHP_CodeSniffer version 3.13.6 (stable) by Squiz and PHPCSStandards';

	let tmpDir: string;
	let marker: string;

	setup(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'phpcs-executable-path-'));
		marker = path.join(tmpDir, 'shell-was-run');
		process.env.PHPCS_TEST_MARKER = marker;
	});

	teardown(() => {
		delete process.env.PHPCS_TEST_MARKER;
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	/**
	 * Create a fake executable printing the PHPCS version line, inside a
	 * directory whose name is a shell command substitution.
	 */
	function makeExecutableInHostileDirectory(name: string): string {
		const dir = path.join(tmpDir, 'proj$(touch "$PHPCS_TEST_MARKER")', 'vendor', 'bin');
		fs.mkdirSync(dir, { recursive: true });
		const file = path.join(dir, name);
		fs.writeFileSync(file, `#!/bin/sh\nprintf '%s\\n' '${VERSION_LINE}'\n`);
		fs.chmodSync(file, 0o755);
		return file;
	}

	test('PhpcsLinter.create should not pass the executable path through a shell', async function () {
		// cmd.exe does not expand $(...), and " is not allowed in Windows file names
		if (process.platform === 'win32') {
			this.skip();
		}

		const executable = makeExecutableInHostileDirectory('phpcs');
		const linter = await PhpcsLinter.create(executable);

		assert.ok(linter instanceof PhpcsLinter);
		assert.strictEqual(fs.existsSync(marker), false, 'The command substitution in the path was executed');
	});

	test('PhpcbfFixer.create should not pass the executable path through a shell', async function () {
		if (process.platform === 'win32') {
			this.skip();
		}

		const executable = makeExecutableInHostileDirectory('phpcbf');
		const fixer = await PhpcbfFixer.create(executable);

		assert.ok(fixer instanceof PhpcbfFixer);
		assert.strictEqual(fixer.getExecutableVersion(), '3.13.6');
		assert.strictEqual(fs.existsSync(marker), false, 'The command substitution in the path was executed');
	});

	/**
	 * Create a fake executable that prints an error to STDERR and exits 3.
	 */
	function makeFailingExecutable(): string {
		if (process.platform === 'win32') {
			const file = path.join(tmpDir, 'failing.cmd');
			fs.writeFileSync(file, ['@echo off', '1>&2 echo PHP Warning: broken install', 'exit /b 3'].join('\r\n'));
			return file;
		}
		const file = path.join(tmpDir, 'failing');
		fs.writeFileSync(file, "#!/bin/sh\nprintf '%s\\n' 'PHP Warning: broken install' >&2\nexit 3\n");
		fs.chmodSync(file, 0o755);
		return file;
	}

	test('PhpcsLinter.create should reject when --version exits non-zero, reporting STDERR', async () => {
		const executable = makeFailingExecutable();
		await assert.rejects(
			() => PhpcsLinter.create(executable),
			(error: Error) => error.message.includes('Unable to locate phpcs') && error.message.includes('broken install')
		);
	});

	test('PhpcbfFixer.create should reject when --version exits non-zero, reporting STDERR', async () => {
		const executable = makeFailingExecutable();
		await assert.rejects(
			() => PhpcbfFixer.create(executable),
			(error: Error) => error.message.includes('Unable to locate phpcbf') && error.message.includes('broken install')
		);
	});

	test('PhpcsLinter.create should reject a path that does not exist', async () => {
		await assert.rejects(
			() => PhpcsLinter.create(path.join(tmpDir, 'missing-phpcs')),
			(error: Error) => error.message.includes('Unable to locate phpcs')
		);
	});

	test('PhpcbfFixer.create should reject a path that does not exist', async () => {
		await assert.rejects(
			() => PhpcbfFixer.create(path.join(tmpDir, 'missing-phpcbf')),
			(error: Error) => error.message.includes('Unable to locate phpcbf')
		);
	});
});
