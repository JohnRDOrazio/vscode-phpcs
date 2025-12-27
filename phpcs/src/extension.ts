/* --------------------------------------------------------------------------------------------
 * Copyright (c) Ioannis Kappas. All rights reserved.
 * Licensed under the MIT License. See License.md in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
"use strict";

import * as path from "path";
import * as proto from "./protocol";

import {
	CancellationToken,
	commands,
	ExtensionContext,
	ProgressLocation,
	window,
	workspace
} from "vscode";

import {
	ExecuteCommandRequest,
	LanguageClient,
	LanguageClientOptions,
	Middleware,
	ServerOptions,
	TransportKind,
} from "vscode-languageclient/node";

import { ConfigurationParams } from "vscode-languageserver-protocol";

import { PhpcsStatus } from "./status";
import { PhpcsConfiguration } from "./configuration";

/**
 * Activates the extension: starts and configures the PHPCS language client, registers notifications and disposables.
 *
 * @param context - VS Code extension context used to register subscriptions and resolve extension paths
 */
export function activate(context: ExtensionContext) {

	let client: LanguageClient;
	let config: PhpcsConfiguration;

	// The server is implemented in node
	let serverModule = context.asAbsolutePath(path.join("dist", "server.js"));

	// The debug options for the server
	let debugOptions = { execArgv: ["--nolazy", "--inspect=6199"] };

	// If the extension is launch in debug mode the debug server options are use
	// Otherwise the run options are used
	let serverOptions: ServerOptions = {
		run: { module: serverModule, transport: TransportKind.ipc },
		debug: { module: serverModule, transport: TransportKind.ipc, options: debugOptions }
	};

	let middleware: Middleware = {
		workspace: {
			configuration: async (params: ConfigurationParams, token: CancellationToken, next: Function) => {
				return config.compute(params, token, next);
			}
		}
	};

	// Options to control the language client
	let clientOptions: LanguageClientOptions = {
		// Register the server for php documents
		documentSelector: [{ scheme: 'file', language: 'php' }],
		synchronize: {
			// Notify the server about file changes to PHPCS ruleset files in the workspace
			fileEvents: workspace.createFileSystemWatcher(
				"**/{phpcs.xml,phpcs.xml.dist,.phpcs.xml,.phpcs.xml.dist,phpcs.ruleset.xml,ruleset.xml}"
			)
		},
		middleware: middleware
	};

	// Create the language client.
	client = new LanguageClient("phpcs", "PHP Code Sniffer", serverOptions, clientOptions);

	// Register new proposed protocol if available.
	client.registerProposedFeatures();

	config = new PhpcsConfiguration(client);

	// Create the status monitor.
	let status = new PhpcsStatus();

	// Track whether the client has started successfully
	let clientStarted = false;

	// Start the client and register handlers only on success
	const startPromise = client.start().then(() => {
		clientStarted = true;
		config.initialize();
		client.onNotification(proto.DidStartValidateTextDocumentNotification.type, event => {
			status.startProcessing(event.textDocument.uri, event.buffered);
		});
		client.onNotification(proto.DidEndValidateTextDocumentNotification.type, event => {
			status.endProcessing(event.textDocument.uri, event.buffered);
		});

		// Register command: Fix current file with PHPCBF
		const fixFileCommand = commands.registerCommand('phpcs.fixFile', async () => {
			const editor = window.activeTextEditor;
			if (!editor) {
				window.showWarningMessage('No active editor. Open a PHP file to fix.');
				return;
			}

			if (editor.document.languageId !== 'php') {
				window.showWarningMessage('PHPCBF can only fix PHP files.');
				return;
			}

			const uri = editor.document.uri.toString();
			try {
				await client.sendRequest(ExecuteCommandRequest.type, {
					command: 'phpcs.fixFile',
					arguments: [uri],
				});
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				window.showErrorMessage(`PHPCBF error: ${message}`);
			}
		});

		// Register command: Fix all files in workspace with PHPCBF
		const fixAllFilesCommand = commands.registerCommand('phpcs.fixAllFiles', async () => {
			const workspaceFolders = workspace.workspaceFolders;
			if (!workspaceFolders || workspaceFolders.length === 0) {
				window.showWarningMessage('No workspace folder open.');
				return;
			}

			// Confirm with user before fixing all files
			const confirm = await window.showWarningMessage(
				'This will run PHPCBF on all PHP files in the workspace. Continue?',
				{ modal: true },
				'Yes',
				'No'
			);

			if (confirm !== 'Yes') {
				return;
			}

			// Find all PHP files in the workspace
			const phpFiles = await workspace.findFiles('**/*.php', '**/vendor/**');

			if (phpFiles.length === 0) {
				window.showInformationMessage('No PHP files found in the workspace.');
				return;
			}

			// Show progress while fixing files
			await window.withProgress(
				{
					location: ProgressLocation.Notification,
					title: 'PHPCBF: Fixing files',
					cancellable: true,
				},
				async (progress, token) => {
					let fixed = 0;
					let failed = 0;
					const total = phpFiles.length;

					for (let i = 0; i < phpFiles.length; i++) {
						if (token.isCancellationRequested) {
							window.showInformationMessage(
								`PHPCBF cancelled. Fixed ${fixed} of ${total} files.`
							);
							return;
						}

						const file = phpFiles[i];
						const uri = file.toString();
						const fileName = path.basename(file.fsPath);

						progress.report({
							message: `(${i + 1}/${total}) ${fileName}`,
							increment: (1 / total) * 100,
						});

						try {
							await client.sendRequest(ExecuteCommandRequest.type, {
								command: 'phpcs.fixFile',
								arguments: [uri],
							});
							fixed++;
						} catch {
							failed++;
						}
					}

					if (failed > 0) {
						window.showWarningMessage(
							`PHPCBF: Fixed ${fixed} files, ${failed} failed.`
						);
					} else {
						window.showInformationMessage(
							`PHPCBF: Successfully processed ${fixed} files.`
						);
					}
				}
			);
		});

		// Only register disposables after successful start
		context.subscriptions.push(status);
		context.subscriptions.push(config);
		context.subscriptions.push(fixFileCommand);
		context.subscriptions.push(fixAllFilesCommand);
	}).catch((error) => {
		const message = error instanceof Error ? error.message : String(error);
		window.showErrorMessage(`Failed to start PHPCS language server: ${message}`);
		console.error('Failed to start PHPCS language client:', error);
	});

	// Register disposal that safely stops the client
	context.subscriptions.push({
		dispose: async () => {
			// Wait for start to complete (success or failure) before stopping
			await startPromise.catch(() => {});
			if (clientStarted) {
				await client.stop();
			}
		}
	});
}