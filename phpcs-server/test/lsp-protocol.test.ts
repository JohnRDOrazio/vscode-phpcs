/* --------------------------------------------------------------------------------------------
 * Copyright (c) John R. D'Orazio. All rights reserved.
 * Licensed under the MIT License. See License.md in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
"use strict";

import * as assert from 'assert';
import * as cp from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
	ConfigurationRequest,
	createProtocolConnection,
	DidOpenTextDocumentNotification,
	ExitNotification,
	InitializedNotification,
	InitializeRequest,
	ProtocolConnection,
	RegistrationRequest,
	PublishDiagnosticsNotification,
	PublishDiagnosticsParams,
	ShutdownRequest,
	StreamMessageReader,
	StreamMessageWriter,
	TextDocumentSyncKind,
} from 'vscode-languageserver-protocol/node';

import { PHPCBF_FIX_FILE_COMMAND } from '../src/code-actions';

/**
 * These tests speak the wire protocol to a real server process.
 *
 * Everything else in this suite calls the server's internals directly, so the
 * protocol layer itself — the handshake, the advertised capabilities, the
 * configuration round trip, diagnostics arriving as notifications — had no
 * coverage at all. That is the layer a protocol major such as LSP 3.18 moves,
 * and the layer a green CI run said nothing about.
 *
 * The server is started from its TypeScript source over stdio rather than from
 * the esbuild bundle, so these do not depend on a build step.
 */

const SERVER_ROOT = path.join(__dirname, '..');
const SERVER_ENTRY = path.join(SERVER_ROOT, 'src', 'server.ts');

interface ServerHandle {
	child: cp.ChildProcessWithoutNullStreams;
	connection: ProtocolConnection;
}

function startServer(): ServerHandle {
	const child = cp.spawn(
		process.execPath,
		['--import', 'tsx', SERVER_ENTRY, '--stdio'],
		{ cwd: SERVER_ROOT, stdio: 'pipe' }
	) as cp.ChildProcessWithoutNullStreams;

	const connection = createProtocolConnection(
		new StreamMessageReader(child.stdout),
		new StreamMessageWriter(child.stdin)
	);
	// A real client answers dynamic registration. Without this the server's
	// registration promise rejects with "Unhandled method
	// client/registerCapability" and the unhandled rejection takes the whole
	// server process down — which is how this harness first failed.
	// The response type is void, so accepting means returning nothing.
	connection.onRequest(RegistrationRequest.type, () => { /* accepted */ });

	connection.listen();
	return { child, connection };
}

async function stopServer(server: ServerHandle): Promise<void> {
	try {
		// Bounded: a server still busy linting may not answer shutdown promptly,
		// and a teardown that waits forever turns one slow test into a suite-wide
		// timeout. The kill below is the backstop either way.
		await Promise.race([
			server.connection.sendRequest(ShutdownRequest.type, undefined),
			new Promise(resolve => setTimeout(resolve, 2000)),
		]);
		server.connection.sendNotification(ExitNotification.type);
	} catch {
		// The process may already be gone.
	}
	server.connection.dispose();
	if (server.child.exitCode === null) {
		server.child.kill();
	}
}

function initializeParams(withConfiguration: boolean) {
	return {
		processId: process.pid,
		rootUri: null,
		workspaceFolders: null,
		capabilities: withConfiguration
			? { workspace: { configuration: true, workspaceFolders: true } }
			: {},
	};
}

/** Locate PHPCS the same way integration.test.ts does. */
function findPhpcs(): string | null {
	const candidates = [process.env.PHPCS_PATH, 'phpcs', 'vendor/bin/phpcs', './vendor/bin/phpcs']
		.filter(Boolean) as string[];
	for (const candidate of candidates) {
		try {
			const result = cp.spawnSync(candidate, ['--version'], { encoding: 'utf8', timeout: 10000 });
			if ((result.stdout || '').match(/version \d+\.\d+\.\d+/i)) {
				return candidate;
			}
		} catch {
			// try the next candidate
		}
	}
	return null;
}

suite('LSP protocol', function () {
	// Starting a server process through tsx is slower than the in-process suites.
	this.timeout(30000);

	suite('handshake', () => {
		let server: ServerHandle;

		setup(() => {
			server = startServer();
		});

		teardown(async () => {
			await stopServer(server);
		});

		test('answers initialize with the capabilities the client relies on', async () => {
			const result: any = await server.connection.sendRequest(
				InitializeRequest.type,
				initializeParams(false) as any
			);

			const capabilities = result.capabilities;
			assert.ok(capabilities, 'initialize returned no capabilities');

			// Incremental sync plus willSaveWaitUntil is what makes phpcbfOnSave
			// possible; openClose is what delivers documents at all.
			assert.strictEqual(capabilities.textDocumentSync.openClose, true);
			assert.strictEqual(capabilities.textDocumentSync.change, TextDocumentSyncKind.Incremental);
			assert.strictEqual(capabilities.textDocumentSync.willSaveWaitUntil, true);

			assert.strictEqual(capabilities.codeActionProvider, true);
			assert.strictEqual(capabilities.documentFormattingProvider, true);
			assert.deepStrictEqual(
				capabilities.executeCommandProvider.commands,
				[PHPCBF_FIX_FILE_COMMAND],
				'the fix-file command must be advertised under the id the client sends'
			);
		});

		// Settings are fetched per document, not at initialize — getDocumentSettings
		// is what issues workspace/configuration, so opening a document is what
		// triggers it. Asserting on `initialized` alone would hang, which is how
		// this test was first written.
		test('requests the phpcs configuration, scoped, for an opened document', async () => {
			const asked = new Promise<any>(resolve => {
				server.connection.onRequest(ConfigurationRequest.type, params => {
					resolve(params);
					return params.items.map(() => ({}));
				});
			});

			await server.connection.sendRequest(InitializeRequest.type, initializeParams(true) as any);
			server.connection.sendNotification(InitializedNotification.type, {});

			const uri = 'file:///tmp/lsp-protocol-scope-check.php';
			server.connection.sendNotification(DidOpenTextDocumentNotification.type, {
				textDocument: { uri, languageId: 'php', version: 1, text: '<?php\n' },
			});

			const params = await asked;
			assert.ok(
				params.items.some((item: any) => item.section === 'phpcs'),
				'server did not ask for the phpcs configuration section'
			);
			assert.ok(
				params.items.some((item: any) => item.scopeUri === uri),
				'configuration request was not scoped to the opened document'
			);
		});
	});

	suite('shutdown', () => {
		test('exits cleanly on shutdown followed by exit', async () => {
			const server = startServer();
			await server.connection.sendRequest(InitializeRequest.type, initializeParams(false) as any);

			await server.connection.sendRequest(ShutdownRequest.type, undefined);
			server.connection.sendNotification(ExitNotification.type);

			const code = await new Promise<number | null>(resolve => {
				server.child.on('exit', resolve);
				setTimeout(() => resolve(-1), 10000);
			});
			server.connection.dispose();

			assert.strictEqual(code, 0, 'server did not exit 0 after shutdown/exit');
		});
	});

	// The full round trip: the client answers workspace/configuration, the server
	// lints with the settings it was handed, and diagnostics come back as a
	// notification. Requires a real PHPCS, so it skips where there is none —
	// the phpcs-integration matrix and the coverage job both provide one.
	suite('diagnostics round trip', () => {
		let phpcsPath: string | null = null;
		let tmpDir: string;

		suiteSetup(() => {
			phpcsPath = findPhpcs();
			if (!phpcsPath) {
				console.log('PHPCS not found, skipping the LSP diagnostics round trip');
			}
		});

		setup(() => {
			tmpDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'phpcs-lsp-')));
		});

		teardown(() => {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		});

		test('publishes diagnostics for a file that violates the standard', async function () {
			if (!phpcsPath) {
				this.skip();
			}

			const server = startServer();
			try {
				const diagnostics = new Promise<PublishDiagnosticsParams>(resolve => {
					server.connection.onNotification(PublishDiagnosticsNotification.type, resolve);
				});

				server.connection.onRequest(ConfigurationRequest.type, params =>
					params.items.map(() => ({
						enable: true,
						workspaceRoot: tmpDir,
						executablePath: phpcsPath,
						composerJsonPath: 'composer.json',
						standard: 'PSR12',
						autoConfigSearch: false,
						showSources: false,
						showWarnings: true,
						ignorePatterns: [],
						ignoreSource: [],
						warningSeverity: 5,
						errorSeverity: 5,
						lintOnType: true,
						lintOnOpen: true,
						lintOnSave: true,
						queueBuffer: 10,
						lintOnlyOpened: false,
						phpcbfEnable: false,
						phpcbfExecutablePath: null,
						phpcbfOnSave: false,
						phpcbfTimeout: 60,
					}))
				);

				await server.connection.sendRequest(InitializeRequest.type, initializeParams(true) as any);
				server.connection.sendNotification(InitializedNotification.type, {});

				// Deliberately non-conforming: no strict_types declaration and a
				// brace on the wrong line are both PSR12 violations.
				const filePath = path.join(tmpDir, 'violation.php');
				const contents = '<?php\nclass  Foo{\n public function bar(){}\n}\n';
				fs.writeFileSync(filePath, contents);

				server.connection.sendNotification(DidOpenTextDocumentNotification.type, {
					textDocument: {
						uri: `file://${filePath}`,
						languageId: 'php',
						version: 1,
						text: contents,
					},
				});

				const published = await diagnostics;
				assert.strictEqual(published.uri, `file://${filePath}`);
				assert.ok(
					published.diagnostics.length > 0,
					'expected at least one PSR12 diagnostic for a non-conforming file'
				);
			} finally {
				await stopServer(server);
			}
		});
	});
});
