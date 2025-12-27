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
import { StringResources as SR, format } from "./strings";

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

		/**
		 * Command handler for fixing the current file with PHPCBF.
		 * Validates that a PHP file is open and sends a fix request to the language server.
		 */
		const fixFileCommand = commands.registerCommand('phpcs.fixCurrentFile', async () => {
			const editor = window.activeTextEditor;
			if (!editor) {
				window.showWarningMessage(SR.NoActiveEditor);
				return;
			}

			if (editor.document.languageId !== 'php') {
				window.showWarningMessage(SR.PhpcbfOnlyPhpFiles);
				return;
			}

			const uri = editor.document.uri.toString();
			try {
				await window.withProgress(
					{
						location: ProgressLocation.Notification,
						title: SR.PhpcbfFixingFile,
						cancellable: false,
					},
					async () => {
						await client.sendRequest(ExecuteCommandRequest.type, {
							command: 'phpcs.fixFile',
							arguments: [uri],
						});
					}
				);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				window.showErrorMessage(format(SR.PhpcbfError, message));
			}
		});

		/**
		 * Command handler for fixing all PHP files in the workspace with PHPCBF.
		 * Shows a confirmation dialog, finds all PHP files, and processes them with progress reporting.
		 */
		const fixAllFilesCommand = commands.registerCommand('phpcs.fixWorkspace', async () => {
			const workspaceFolders = workspace.workspaceFolders;
			if (!workspaceFolders || workspaceFolders.length === 0) {
				window.showWarningMessage(SR.NoWorkspaceFolder);
				return;
			}

			// Confirm with user before fixing all files
			const confirm = await window.showWarningMessage(
				SR.ConfirmFixWorkspace,
				{ modal: true },
				SR.ConfirmYes,
				SR.ConfirmNo
			);

			if (confirm !== SR.ConfirmYes) {
				return;
			}

			// Find all PHP files in the workspace
			const phpFiles = await workspace.findFiles('**/*.php', '**/vendor/**');

			if (phpFiles.length === 0) {
				window.showInformationMessage(SR.NoPhpFilesFound);
				return;
			}

			// Show progress while fixing files
			await window.withProgress(
				{
					location: ProgressLocation.Notification,
					title: SR.PhpcbfFixingFiles,
					cancellable: true,
				},
				async (progress, token) => {
					let fixed = 0;
					let failed = 0;
					const total = phpFiles.length;

					for (let i = 0; i < phpFiles.length; i++) {
						if (token.isCancellationRequested) {
							window.showInformationMessage(
								format(SR.PhpcbfCancelled, fixed, total)
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
							format(SR.PhpcbfFixedWithFailures, fixed, failed)
						);
					} else {
						window.showInformationMessage(
							format(SR.PhpcbfFixedSuccess, fixed)
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
		window.showErrorMessage(format(SR.FailedToStartServer, message));
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