/* --------------------------------------------------------------------------------------------
 * Copyright (c) 2026 John Romano D'Orazio. All rights reserved.
 * Licensed under the MIT License. See License.md in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
"use strict";

import * as assert from 'assert';
import * as cp from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
	ApplyWorkspaceEditRequest,
	CodeActionRequest,
	ConfigurationRequest,
	createProtocolConnection,
	DidChangeConfigurationNotification,
	DidChangeTextDocumentNotification,
	DidCloseTextDocumentNotification,
	DidOpenTextDocumentNotification,
	DidSaveTextDocumentNotification,
	DocumentFormattingRequest,
	ExitNotification,
	InitializedNotification,
	InitializeRequest,
	ProtocolConnection,
	RegistrationRequest,
	PublishDiagnosticsNotification,
	PublishDiagnosticsParams,
	ExecuteCommandRequest,
	ShowMessageRequest,
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

	// Wait for the child to exit of its own accord before resorting to a signal.
	// V8 writes its coverage profile on clean exit only, so a SIGTERM here throws
	// away everything the server did — which is how this suite first appeared to
	// add twelve tests and no coverage at all.
	const exitedCleanly = await new Promise<boolean>(resolve => {
		if (server.child.exitCode !== null) {
			resolve(true);
			return;
		}
		const timer = setTimeout(() => resolve(false), 5000);
		server.child.once('exit', () => { clearTimeout(timer); resolve(true); });
	});

	server.connection.dispose();
	if (!exitedCleanly) {
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

/**
 * A server that has completed the handshake and is answering configuration
 * requests, plus the plumbing to drive documents through it.
 *
 * The client side has to answer more than configuration: the server registers
 * capabilities dynamically and applies PHPCBF fixes through workspace/applyEdit,
 * and an unanswered request there is not a failed assertion — it is a hung test.
 */
/** The settings a real client would send, with room to vary one at a time. */
function clientSettings(tmpDir: string, phpcsPath: string, overrides: Record<string, unknown> = {}) {
	return {
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
		phpcbfEnable: true,
		// Left null on purpose: the server derives phpcbf from executablePath,
		// which is a path the client never has to compute.
		phpcbfExecutablePath: null,
		phpcbfOnSave: false,
		phpcbfTimeout: 60,
		...overrides,
	};
}

class LiveServer {
	private readonly diagnostics: PublishDiagnosticsParams[] = [];
	private readonly waiters: Array<{ match: (p: PublishDiagnosticsParams) => boolean; resolve: (p: PublishDiagnosticsParams) => void }> = [];
	public readonly appliedEdits: any[] = [];

	private constructor(private readonly server: ServerHandle) {}

	static async start(settings: Record<string, unknown>): Promise<LiveServer> {
		const live = new LiveServer(startServer());
		const { connection } = live.server;

		connection.onRequest(ConfigurationRequest.type, params => params.items.map(() => settings));
		// The server surfaces lint failures through window/showMessageRequest.
		// Leaving it unanswered rejects the server's pending promise and the
		// unhandled rejection kills the process, so the failure that gets
		// reported is "server died", not the error it was trying to report.
		connection.onRequest(ShowMessageRequest.type, () => null);
		connection.onRequest(ApplyWorkspaceEditRequest.type, params => {
			live.appliedEdits.push(params.edit);
			return { applied: true };
		});
		connection.onNotification(PublishDiagnosticsNotification.type, params => {
			const index = live.waiters.findIndex(w => w.match(params));
			if (index >= 0) {
				live.waiters.splice(index, 1)[0].resolve(params);
			} else {
				live.diagnostics.push(params);
			}
		});

		await connection.sendRequest(InitializeRequest.type, initializeParams(true) as any);
		connection.sendNotification(InitializedNotification.type, {});
		return live;
	}

	get connection(): ProtocolConnection {
		return this.server.connection;
	}

	open(uri: string, text: string): void {
		this.connection.sendNotification(DidOpenTextDocumentNotification.type, {
			textDocument: { uri, languageId: 'php', version: 1, text },
		});
	}

	/** Resolves with the next diagnostics matching `match`, or one already seen. */
	waitForDiagnostics(match: (p: PublishDiagnosticsParams) => boolean, timeoutMs = 20000): Promise<PublishDiagnosticsParams> {
		const seen = this.diagnostics.findIndex(match);
		if (seen >= 0) {
			return Promise.resolve(this.diagnostics.splice(seen, 1)[0]);
		}
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => reject(new Error('timed out waiting for diagnostics')), timeoutMs);
			this.waiters.push({ match, resolve: params => { clearTimeout(timer); resolve(params); } });
		});
	}

	async stop(): Promise<void> {
		await stopServer(this.server);
	}
}

/**
 * Writes the fixture and opens it.
 *
 * The document text reaches PHPCS over stdin, but the linter still access()es
 * the path first, so a document that exists only in memory lints to nothing —
 * silently, since the error goes to the log rather than the diagnostics.
 */
function writeAndOpen(live: LiveServer, dir: string, name: string, text: string): string {
	const filePath = path.join(dir, name);
	fs.writeFileSync(filePath, text);
	const uri = `file://${filePath}`;
	live.open(uri, text);
	return uri;
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

	// Everything below drives the handlers that unit tests cannot reach: they
	// only exist as responses to protocol messages. Together they are most of
	// what server.ts does.
	suite('document lifecycle', () => {
		let phpcsPath: string | null = null;
		let tmpDir: string;
		let live: LiveServer | null = null;

		suiteSetup(() => { phpcsPath = findPhpcs(); });
		setup(() => { tmpDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'phpcs-lsp-'))); });
		teardown(async () => {
			if (live) { await live.stop(); live = null; }
			fs.rmSync(tmpDir, { recursive: true, force: true });
		});

		const BAD = '<?php\nclass  Foo{\n public function bar(){}\n}\n';

		test('re-lints when the document changes', async function () {
			if (!phpcsPath) { this.skip(); }
			live = await LiveServer.start(clientSettings(tmpDir, phpcsPath!));
			const uri = writeAndOpen(live, tmpDir, 'change.php', BAD);
			const first = await live.waitForDiagnostics(p => p.uri === uri);
			assert.ok(first.diagnostics.length > 0);

			live.connection.sendNotification(DidChangeTextDocumentNotification.type, {
				textDocument: { uri, version: 2 },
				contentChanges: [{ text: '<?php\n\ndeclare(strict_types=1);\n' }],
			});

			const second = await live.waitForDiagnostics(p => p.uri === uri);
			assert.ok(
				second.diagnostics.length < first.diagnostics.length,
				'fixing the file should reduce the diagnostics republished on change'
			);
		});

		test('re-lints on save', async function () {
			if (!phpcsPath) { this.skip(); }
			live = await LiveServer.start(clientSettings(tmpDir, phpcsPath!));
			const uri = writeAndOpen(live, tmpDir, 'save.php', BAD);
			await live.waitForDiagnostics(p => p.uri === uri);

			live.connection.sendNotification(DidSaveTextDocumentNotification.type, {
				textDocument: { uri },
			});

			const republished = await live.waitForDiagnostics(p => p.uri === uri);
			assert.ok(republished.diagnostics.length > 0, 'save should republish diagnostics');
		});

		test('clears diagnostics when the document closes', async function () {
			if (!phpcsPath) { this.skip(); }
			live = await LiveServer.start(clientSettings(tmpDir, phpcsPath!));
			const uri = writeAndOpen(live, tmpDir, 'close.php', BAD);
			const opened = await live.waitForDiagnostics(p => p.uri === uri);
			assert.ok(opened.diagnostics.length > 0);

			live.connection.sendNotification(DidCloseTextDocumentNotification.type, {
				textDocument: { uri },
			});

			const cleared = await live.waitForDiagnostics(p => p.uri === uri && p.diagnostics.length === 0);
			assert.deepStrictEqual(cleared.diagnostics, [], 'closing must clear the squiggles it put there');
		});

		test('revalidates open documents when the configuration changes', async function () {
			if (!phpcsPath) { this.skip(); }
			live = await LiveServer.start(clientSettings(tmpDir, phpcsPath!));
			const uri = writeAndOpen(live, tmpDir, 'reconfigure.php', BAD);
			await live.waitForDiagnostics(p => p.uri === uri);

			live.connection.sendNotification(DidChangeConfigurationNotification.type, { settings: {} });

			const republished = await live.waitForDiagnostics(p => p.uri === uri);
			assert.ok(republished.diagnostics.length > 0, 'a configuration change should revalidate open documents');
		});
	});

	suite('code actions and fixing', () => {
		let phpcsPath: string | null = null;
		let tmpDir: string;
		let live: LiveServer | null = null;

		suiteSetup(() => { phpcsPath = findPhpcs(); });
		setup(() => { tmpDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'phpcs-lsp-'))); });
		teardown(async () => {
			if (live) { await live.stop(); live = null; }
			fs.rmSync(tmpDir, { recursive: true, force: true });
		});

		const BAD = '<?php\nclass  Foo{\n public function bar(){}\n}\n';

		test('offers code actions for a reported diagnostic', async function () {
			if (!phpcsPath) { this.skip(); }
			live = await LiveServer.start(clientSettings(tmpDir, phpcsPath!));
			const uri = writeAndOpen(live, tmpDir, 'actions.php', BAD);
			const published = await live.waitForDiagnostics(p => p.uri === uri);

			const actions: any = await live.connection.sendRequest(CodeActionRequest.type, {
				textDocument: { uri },
				range: published.diagnostics[0].range,
				context: { diagnostics: published.diagnostics },
			} as any);

			assert.ok(Array.isArray(actions) && actions.length > 0, 'expected at least one code action');
			assert.ok(
				actions.some((a: any) => a.command?.command === PHPCBF_FIX_FILE_COMMAND || a.kind),
				'expected the fix-file command or a kinded action'
			);
		});

		test('formatting returns the edits PHPCBF would make', async function () {
			if (!phpcsPath) { this.skip(); }
			live = await LiveServer.start(clientSettings(tmpDir, phpcsPath!));
			const uri = writeAndOpen(live, tmpDir, 'format.php', BAD);
			await live.waitForDiagnostics(p => p.uri === uri);

			const edits: any = await live.connection.sendRequest(DocumentFormattingRequest.type, {
				textDocument: { uri },
				options: { tabSize: 4, insertSpaces: true },
			} as any);

			assert.ok(Array.isArray(edits) && edits.length > 0, 'expected formatting edits from phpcbf');
			assert.ok(typeof edits[0].newText === 'string' && edits[0].range, 'edits must be well formed');
		});

		test('formatting returns nothing when phpcbf is disabled', async function () {
			if (!phpcsPath) { this.skip(); }
			live = await LiveServer.start(clientSettings(tmpDir, phpcsPath!, { phpcbfEnable: false }));
			const uri = writeAndOpen(live, tmpDir, 'disabled.php', BAD);
			await live.waitForDiagnostics(p => p.uri === uri);

			const edits: any = await live.connection.sendRequest(DocumentFormattingRequest.type, {
				textDocument: { uri },
				options: { tabSize: 4, insertSpaces: true },
			} as any);

			assert.deepStrictEqual(edits, [], 'phpcbfEnable=false must suppress formatting edits');
		});

		test('the fix-file command applies a workspace edit', async function () {
			if (!phpcsPath) { this.skip(); }
			live = await LiveServer.start(clientSettings(tmpDir, phpcsPath!));
			const uri = writeAndOpen(live, tmpDir, 'fixcmd.php', BAD);
			await live.waitForDiagnostics(p => p.uri === uri);

			await live.connection.sendRequest(ExecuteCommandRequest.type, {
				command: PHPCBF_FIX_FILE_COMMAND,
				arguments: [uri],
			} as any);

			assert.strictEqual(live.appliedEdits.length, 1, 'expected exactly one workspace edit');
			const changes = live.appliedEdits[0].changes ?? live.appliedEdits[0].documentChanges;
			assert.ok(changes, 'workspace edit carried no changes');
		});
	});
});
