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
	Range,
	Uri,
	window,
	workspace
} from "vscode";

import { PhpcbfDiffContentProvider, PHPCBF_DIFF_SCHEME } from "./diff-provider";
import { InlineDiffPreview, applySelectedHunks } from "./inline-diff";

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
 * Save document if phpcbfSaveOnFix setting is enabled and document is dirty.
 *
 * @param document - The document to save
 * @returns True if saved successfully or save not needed, false if save failed
 */
async function saveDocumentIfEnabled(document: { isDirty: boolean; save: () => Thenable<boolean> }): Promise<boolean> {
	const phpcsConfig = workspace.getConfiguration('phpcs');
	const saveOnFix = phpcsConfig.get<boolean>('phpcbfSaveOnFix', false);

	if (saveOnFix && document.isDirty) {
		return document.save();
	}
	return true;
}

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

	// Create and register the diff content provider for PHPCBF preview.
	const diffProvider = new PhpcbfDiffContentProvider();
	context.subscriptions.push(
		workspace.registerTextDocumentContentProvider(PHPCBF_DIFF_SCHEME, diffProvider)
	);
	context.subscriptions.push(diffProvider);

	// Create the inline diff preview manager.
	const inlineDiffPreview = new InlineDiffPreview();
	context.subscriptions.push(inlineDiffPreview);

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
		client.onNotification(proto.DidStartFixTextDocumentNotification.type, event => {
			status.startFixing(event.textDocument.uri);
		});
		client.onNotification(proto.DidEndFixTextDocumentNotification.type, event => {
			status.endFixing(event.textDocument.uri, event.fixed);
		});

		// Handle save document notification from server
		client.onNotification(proto.SaveDocumentNotification.type, async (params) => {
			const documentUri = Uri.parse(params.uri);

			// Try to find the document - first check active editor, then open documents
			let document = window.activeTextEditor?.document;
			if (!document || document.uri.toString() !== documentUri.toString()) {
				document = workspace.textDocuments.find(
					doc => doc.uri.toString() === documentUri.toString()
				);
			}

			if (document) {
				const saved = await saveDocumentIfEnabled(document);
				if (!saved) {
					console.warn('PHPCS: Failed to save document after fix');
				}
			}
		});

		// Handle diff preview request from server
		client.onRequest(proto.ShowDiffPreviewRequest.type, async (params) => {
			const originalUri = Uri.parse(params.uri);

			// Find the editor for this document
			const editor = window.visibleTextEditors.find(
				e => e.document.uri.toString() === originalUri.toString()
			);

			// If hunks are provided, use the per-hunk inline preview
			if (params.hunks && params.hunks.length > 0 && editor) {
				// Use params.originalContent for hunk application since that's what
				// the server used to compute the hunks. Using editor.document.getText()
				// could differ due to timing/sync issues, causing hunks to apply incorrectly.
				const originalContent = params.originalContent;

				try {
					// Show per-hunk preview with Accept/Reject for each change
					const acceptedHunks = await inlineDiffPreview.showHunkPreview(
						editor,
						originalContent,
						params.hunks
					);

					if (acceptedHunks.length === 0) {
						// User cancelled or rejected all
						return false;
					}

					// Apply only the accepted hunks
					const partiallyFixedContent = applySelectedHunks(originalContent, acceptedHunks);

					// Apply the changes to the document
					const fullRange = editor.document.validateRange(
						new Range(0, 0, editor.document.lineCount, 0)
					);
					const applied = await editor.edit(editBuilder => {
						editBuilder.replace(fullRange, partiallyFixedContent);
					});

					if (!applied) {
						window.showErrorMessage('Failed to apply selected changes');
						return false;
					}

					// Save document if setting is enabled
					const saved = await saveDocumentIfEnabled(editor.document);
					if (!saved) {
						console.warn('PHPCS: Failed to save document after applying fix');
					}

					window.showInformationMessage(
						`Applied ${acceptedHunks.length} of ${params.hunks.length} change(s)`
					);
					return true;
				} finally {
					// Clear decorations and CodeLens
					inlineDiffPreview.clearPreview();
				}
			}

			// Fallback: no hunks provided or no editor - use diff editor
			return showDiffEditor(originalUri, params, diffProvider);
		});

		// Helper function for diff editor approach
		async function showDiffEditor(
			originalUri: Uri,
			params: proto.ShowDiffPreviewParams,
			provider: PhpcbfDiffContentProvider
		): Promise<boolean> {
			const previewUri = provider.setContent(params.uri, params.fixedContent);

			try {
				// Show diff editor
				await commands.executeCommand(
					'vscode.diff',
					originalUri,
					previewUri,
					`PHPCBF Preview: ${path.basename(originalUri.fsPath)}`
				);

				// Ask user to apply changes
				const apply = await window.showInformationMessage(
					SR.PhpcbfDiffApplyQuestion,
					SR.PhpcbfDiffApply,
					SR.PhpcbfDiffCancel
				);

				return apply === SR.PhpcbfDiffApply;
			} finally {
				provider.clearContent(params.uri);
			}
		}

		/**
		 * Command handler for fixing the current file with PHPCBF.
		 * Validates that a PHP file is open, saves if dirty, and sends a fix request to the language server.
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

			// Save document if dirty to ensure PHPCBF runs against current content
			if (editor.document.isDirty) {
				const saved = await editor.document.save();
				if (!saved) {
					window.showWarningMessage(SR.FailedToSaveBeforeFix);
					return;
				}
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

			// Build a set of PHP file URIs for quick lookup
			const phpFileUris = new Set(phpFiles.map(f => f.toString()));

			// Save all dirty PHP documents that are in our file list
			const dirtyPhpDocs = workspace.textDocuments.filter(
				doc => doc.isDirty && doc.languageId === 'php' && phpFileUris.has(doc.uri.toString())
			);

			if (dirtyPhpDocs.length > 0) {
				let failedSaves = 0;
				for (const doc of dirtyPhpDocs) {
					const saved = await doc.save();
					if (!saved) {
						failedSaves++;
					}
				}
				if (failedSaves > 0) {
					window.showWarningMessage(format(SR.FailedToSaveSomeFiles, failedSaves));
				}
			}

			// Show progress while fixing files
			// TODO: For large workspaces, consider adding a server-side batch fix command
			// that accepts multiple URIs to reduce IPC overhead from sequential requests.
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
						} catch (error) {
							failed++;
							const message = error instanceof Error ? error.message : String(error);
							console.error(`PHPCBF failed for ${uri}: ${message}`);
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