/* --------------------------------------------------------------------------------------------
 * Copyright (c) Ioannis Kappas. All rights reserved.
 * Licensed under the MIT License. See License.md in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
"use strict";

import * as proto from "./protocol";
import * as strings from "./base/common/strings";

import {
	CodeAction,
	CodeActionParams,
	createConnection,
	Diagnostic,
	DidChangeConfigurationParams,
	DidChangeWatchedFilesParams,
	ExecuteCommandParams,
	InitializeParams,
	InitializeResult,
	ProposedFeatures,
	PublishDiagnosticsParams,
	TextDocumentIdentifier,
	TextDocuments,
	TextDocumentSyncKind,
	TextEdit,
	WillSaveTextDocumentParams,
	WorkspaceFoldersChangeEvent,
} from 'vscode-languageserver/node';

import { TextDocument } from 'vscode-languageserver-textdocument';

import { URI } from 'vscode-uri';

import { PhpcsLinter } from "./linter";
import { PhpcbfFixer } from "./fixer";
import { PhpcsSettings } from "./settings";
import { StringResources as SR } from "./strings";
import {
	generateCodeActions,
	createFullDocumentEdit,
	PHPCBF_FIX_FILE_COMMAND,
} from "./code-actions";

class PhpcsServer {
	private openedFiles: Map<string, boolean>;
	private connection: ReturnType<typeof createConnection>;
	private documents: TextDocuments<TextDocument>;
	private validating: Map<string, TextDocument>;
	private queue: Map<string, TextDocument>;
	private documentDiagnostics: Map<string, Diagnostic[]>;
	// Track ongoing PHPCBF fix operations to prevent concurrent fixes on the same file
	private fixingDocuments: Map<string, Promise<void>>;

	// Cache the settings of all open documents
	private hasConfigurationCapability: boolean = false;
	private hasWorkspaceFolderCapability: boolean = false;

	private globalSettings: PhpcsSettings | null = null;
	private defaultSettings: PhpcsSettings = {
		enable: true,
		workspaceRoot: null,
		executablePath: null,
		composerJsonPath: null,
		standard: null,
		autoConfigSearch: true,
		showSources: false,
		showWarnings: true,
		ignorePatterns: [],
		ignoreSource: [],
		warningSeverity: 5,
		errorSeverity: 5,
		lintOnOpen: true,
		lintOnType: true,
		lintOnSave: true,
		queueBuffer: 10,
		lintOnlyOpened: true,
		// PHPCBF settings
		phpcbfEnable: true,
		phpcbfExecutablePath: null,
		phpcbfOnSave: false,
		phpcbfTimeout: 60,
	};
	private documentSettings: Map<string, Promise<PhpcsSettings>> = new Map();

	/**
	 * Class constructor.
	 *
	 * @return A new instance of the server.
	 */
	constructor() {
		this.validating = new Map();
		this.openedFiles = new Map();
		this.queue = new Map();
		this.documentDiagnostics = new Map();
		this.fixingDocuments = new Map();
		this.connection = createConnection(ProposedFeatures.all);
		this.documents = new TextDocuments(TextDocument);
		this.documents.listen(this.connection);
		this.connection.onInitialize(this.safeEventHandler(this.onInitialize));
		this.connection.onInitialized(this.safeEventHandler(this.onDidInitialize));
		this.connection.onDidChangeConfiguration(this.safeEventHandler(this.onDidChangeConfiguration));
		this.connection.onDidChangeWatchedFiles(this.safeEventHandler(this.onDidChangeWatchedFiles));
		this.connection.onCodeAction(this.safeEventHandler(this.onCodeAction));
		this.connection.onExecuteCommand(this.safeEventHandler(this.onExecuteCommand));
		this.connection.onWillSaveTextDocumentWaitUntil(this.safeEventHandler(this.onWillSaveTextDocument));
		this.documents.onDidChangeContent(this.safeEventHandler(this.onDidChangeDocument));
		this.documents.onDidOpen(this.safeEventHandler(this.onDidOpenDocument));
		this.documents.onDidSave(this.safeEventHandler(this.onDidSaveDocument));
		this.documents.onDidClose(this.safeEventHandler(this.onDidCloseDocument));
	}

	/**
	 * Safely handle event notifications.
	 * @param callback An event handler.
	 */
	private safeEventHandler(callback: (...args: any[]) => Promise<any>): (...args: any[]) => Promise<any> {
		return (...args: any[]): Promise<any> => {
			return callback.apply(this, args).catch((error: Error) => {
				this.connection.window.showErrorMessage(`phpcs: ${error.message}`);
			});
		};
	}

	/**
	 * Resolve PHPCBF executable path from settings.
	 *
	 * @param settings The PHPCS settings.
	 * @return The resolved PHPCBF path or null.
	 */
	private resolvePhpcbfPath(settings: PhpcsSettings): string | null {
		let phpcbfPath = settings.phpcbfExecutablePath;
		if (!phpcbfPath && settings.executablePath) {
			// Try to derive phpcbf path from phpcs path.
			// Note: This only handles standard naming (phpcs, phpcs.bat, phpcs.phar).
			// For non-standard names, users should set phpcs.phpcbfExecutablePath explicitly.
			// The derived path is verified by PhpcbfFixer.create() which throws if invalid.
			phpcbfPath = settings.executablePath.replace(/phpcs(\.bat|\.phar)?$/i, 'phpcbf$1');
		}
		return phpcbfPath || null;
	}

	/**
	 * Handles server initialization.
	 *
	 * @param params The initialization parameters.
	 * @return A promise of initialization result or initialization error.
	 */
	private async onInitialize(params: InitializeParams): Promise<InitializeResult> {
		let capabilities = params.capabilities;
		this.hasWorkspaceFolderCapability = !!(capabilities.workspace && capabilities.workspace.workspaceFolders);
		this.hasConfigurationCapability = !!(capabilities.workspace && capabilities.workspace.configuration);
		return Promise.resolve<InitializeResult>({
			capabilities: {
				textDocumentSync: {
					openClose: true,
					change: TextDocumentSyncKind.Incremental,
					willSaveWaitUntil: true,
					save: { includeText: false },
				},
				codeActionProvider: true,
				executeCommandProvider: {
					commands: [PHPCBF_FIX_FILE_COMMAND],
				},
			}
		});
	}

	/**
	 * Handles connection initialization completion.
	 */
	private async onDidInitialize(): Promise<void> {
		if (this.hasWorkspaceFolderCapability) {
			this.connection.workspace.onDidChangeWorkspaceFolders((_event: WorkspaceFoldersChangeEvent) => {
				this.connection.console.log('Workspace folder change event received');
			});
		}
	}

	/**
	 * Handles configuration changes.
	 *
	 * @param params The changed configuration parameters.
	 * @return void
	 */
	private async onDidChangeConfiguration(params: DidChangeConfigurationParams): Promise<void> {
		if (this.hasConfigurationCapability) {
			this.documentSettings.clear();
		} else {
			this.globalSettings = {
				...this.defaultSettings,
				...params.settings.phpcs
			};
		}
		await this.validateMany(this.documents.all());
	}

	/**
	 * Handles watched files changes.
	 *
	 * @param params The changed watched files parameters.
	 * @return void
	 */
	private async onDidChangeWatchedFiles(_params: DidChangeWatchedFilesParams): Promise<void> {
		await this.validateMany(this.documents.all());
	}

	/**
	 * Handles opening of text documents.
	 *
	 * @param event The text document change event.
	 * @return void
	 */
	private async onDidOpenDocument({ document }: { document: TextDocument }): Promise<void> {
		this.openedFiles.set(document.uri, true);
		let settings = await this.getDocumentSettings(document);
		if (settings.lintOnOpen) {
			await this.validateSingle(document);
		}
	}

	/**
	 * Handles willSave event to apply PHPCBF fixes before saving.
	 *
	 * @param params The will save text document parameters.
	 * @return Text edits to apply before saving, or empty array.
	 */
	private async onWillSaveTextDocument(params: WillSaveTextDocumentParams): Promise<TextEdit[]> {
		const document = this.documents.get(params.textDocument.uri);
		if (!document) {
			return [];
		}

		const uri = document.uri;

		// Skip if a fix is already in progress for this document
		if (this.fixingDocuments.has(uri)) {
			this.connection.console.log(`[PHPCBF] Fix already in progress for: ${uri}, skipping on-save fix`);
			return [];
		}

		// Only process PHP files
		if (document.languageId !== 'php') {
			return [];
		}

		const settings = await this.getDocumentSettings(document);

		// Check if PHPCBF on save is enabled
		if (!settings.phpcbfEnable || !settings.phpcbfOnSave) {
			return [];
		}

		const phpcbfPath = this.resolvePhpcbfPath(settings);
		if (!phpcbfPath) {
			return [];
		}

		try {
			const fixer = await PhpcbfFixer.create(phpcbfPath);
			fixer.setLogger((message) => this.connection.console.log(message));

			const result = await fixer.fix(document, settings);
			if (result.fixed && result.content !== document.getText()) {
				return [createFullDocumentEdit(document, result.content)];
			}
		} catch (error) {
			// Log error but don't block save
			this.connection.console.error(strings.format(SR.PhpcbfOnSaveFailed, String(error)));
		}

		return [];
	}

	/**
	 * Handles saving of text documents.
	 *
	 * @param event The text document change event.
	 * @return void
	 */
	private async onDidSaveDocument({ document }: { document: TextDocument }): Promise<void> {
		let settings = await this.getDocumentSettings(document);
		if (settings.lintOnSave) {
			await this.validateSingle(document);
			await this.freeBuffer();
		}
	}

	/**
	 * Handles closing of text documents.
	 *
	 * @param event The text document change event.
	 * @return void
	 */
	private async onDidCloseDocument({ document }: { document: TextDocument }): Promise<void> {
		const uri = document.uri;

		this.openedFiles.delete(uri);

		// Clear cached document settings.
		if (this.documentSettings.has(uri)) {
			this.documentSettings.delete(uri);
		}

		// Clear validating status.
		if (this.validating.has(uri)) {
			this.validating.delete(uri);
		}

		this.clearDiagnostics(uri);
	}

	/**
	 * Handles changes of text documents.
	 *
	 * @param event The text document change event.
	 * @return void
	 */
	private async onDidChangeDocument({ document }: { document: TextDocument }): Promise<void> {
		let settings = await this.getDocumentSettings(document);
		if (settings.lintOnType) {
			await this.validateSingle(document);
		}
	}

	/**
	 * Handles code action requests.
	 *
	 * @param params The code action parameters.
	 * @return Array of code actions.
	 */
	private async onCodeAction(params: CodeActionParams): Promise<CodeAction[]> {
		const uri = params.textDocument.uri;
		const document = this.documents.get(uri);

		if (!document) {
			return [];
		}

		const settings = await this.getDocumentSettings(document);

		// Check if PHPCBF is enabled
		if (!settings.phpcbfEnable) {
			return [];
		}

		// Get stored diagnostics for this document
		const documentDiagnostics = this.documentDiagnostics.get(uri) || [];

		return generateCodeActions(params, document, documentDiagnostics);
	}

	/**
	 * Handles execute command requests.
	 *
	 * @param params The execute command parameters.
	 * @return void
	 */
	private async onExecuteCommand(params: ExecuteCommandParams): Promise<void> {
		if (params.command !== PHPCBF_FIX_FILE_COMMAND) {
			return;
		}

		const uri = params.arguments?.[0] as string | undefined;
		if (!uri) {
			return;
		}

		const document = this.documents.get(uri);
		if (!document) {
			return;
		}

		await this.fixDocument(document);
	}

	/**
	 * Fix a document using PHPCBF.
	 *
	 * @param document The text document to fix.
	 * @return void
	 */
	private async fixDocument(document: TextDocument): Promise<void> {
		const uri = document.uri;

		// Check if a fix is already in progress for this document
		if (this.fixingDocuments.has(uri)) {
			this.connection.console.log(`[PHPCBF] Fix already in progress for: ${uri}, skipping duplicate request`);
			return;
		}

		const settings = await this.getDocumentSettings(document);

		if (!settings.phpcbfEnable) {
			return;
		}

		const phpcbfPath = this.resolvePhpcbfPath(settings);
		if (!phpcbfPath) {
			this.connection.window.showWarningMessage(
				'PHPCBF executable not found. Please set phpcs.phpcbfExecutablePath or ensure phpcbf is alongside phpcs.'
			);
			return;
		}

		// Create the fix operation promise and track it
		const fixOperation = this.executeFixOperation(document, settings, phpcbfPath, uri);
		this.fixingDocuments.set(uri, fixOperation);

		try {
			await fixOperation;
		} finally {
			// Always clean up the tracking entry when done
			this.fixingDocuments.delete(uri);
		}
	}

	/**
	 * Execute the actual fix operation for a document.
	 *
	 * @param document The text document to fix.
	 * @param settings The PHPCS settings.
	 * @param phpcbfPath Path to the PHPCBF executable.
	 * @param uri The document URI.
	 * @return void
	 */
	private async executeFixOperation(
		document: TextDocument,
		settings: PhpcsSettings,
		phpcbfPath: string,
		uri: string
	): Promise<void> {
		try {
			this.connection.console.log(`[PHPCBF] Fixing document: ${uri}`);
			const fixer = await PhpcbfFixer.create(phpcbfPath);
			fixer.setLogger((message) => this.connection.console.log(message));

			const result = await fixer.fix(document, settings);

			if (result.error) {
				this.connection.window.showErrorMessage(`PHPCBF: ${result.error}`);
				return;
			}

			if (result.fixed) {
				// Apply the fix using workspace edit
				const edit = createFullDocumentEdit(document, result.content);
				const applied = await this.connection.workspace.applyEdit({
					changes: {
						[uri]: [edit],
					},
				});

				if (applied.applied) {
					this.connection.console.log(`[PHPCBF] Fixed document: ${uri}`);

					// Re-lint the document to refresh diagnostics
					// We need to get the updated document after the edit is applied
					// The document will be updated via onDidChangeDocument, which triggers validation
					// But we should also trigger validation explicitly in case lintOnType is disabled
					const updatedDocument = this.documents.get(uri);
					if (updatedDocument) {
						await this.validateSingle(updatedDocument);
					}
				} else {
					this.connection.console.warn(`[PHPCBF] Failed to apply edit to: ${uri}`);
				}
			} else {
				this.connection.console.log(`[PHPCBF] No fixes applied to: ${uri}`);
			}

			if (result.hasUnfixableIssues) {
				this.connection.window.showInformationMessage(
					'PHPCBF: Some issues could not be automatically fixed.'
				);
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.connection.console.error(`[PHPCBF] Error: ${message}`);
			this.connection.window.showErrorMessage(`PHPCBF: ${message}`);
		}
	}

	/**
	 * Start listening to requests.
	 *
	 * @return void
	 */
	public listen(): void {
		this.connection.listen();
	}

	/**
	 * Sends diagnostics computed for a given document to VSCode to render them in the
	 * user interface.
	 *
	 * @param params The diagnostic parameters.
	 */
	private sendDiagnostics(params: PublishDiagnosticsParams): void {
		// Store diagnostics for code action requests
		this.documentDiagnostics.set(params.uri, params.diagnostics);
		this.connection.sendDiagnostics(params);
	}

	/**
	 * Clears the diagnostics computed for a given document.
	 *
	 * @param uri The document uri for which to clear the diagnostics.
	 */
	private clearDiagnostics(uri: string): void {
		this.documentDiagnostics.delete(uri);
		this.connection.sendDiagnostics({ uri, diagnostics: [] });
	}

	/**
	 * Sends a notification for starting validation of a document.
	 *
	 * @param document The text document on which validation started.
	 */
	private sendStartValidationNotification(document: TextDocument): void {
		this.validating.set(document.uri, document);
		this.connection.sendNotification(
			proto.DidStartValidateTextDocumentNotification.type,
			{
				textDocument: TextDocumentIdentifier.create(document.uri),
				buffered: this.queue.size
			}
		);
		this.connection.console.log(strings.format(SR.DidStartValidateTextDocument, document.uri));
	}

	/**
	 * Sends a notification for ending validation of a document.
	 *
	 * @param document The text document on which validation ended.
	 */
	private sendEndValidationNotification(document: TextDocument): void {
		this.validating.delete(document.uri);
		this.connection.sendNotification(
			proto.DidEndValidateTextDocumentNotification.type,
			{
				textDocument: TextDocumentIdentifier.create(document.uri),
				buffered: this.queue.size
			}
		);
		this.connection.console.log(strings.format(SR.DidEndValidateTextDocument, document.uri));
	}

	/**
	 * Validate a single text document.
	 *
	 * @param document The text document to validate.
	 * @return void
	 */
	public async validateSingle(document: TextDocument): Promise<void> {
		const { uri } = document;

		// Skip validation for non-file URIs (git diffs, PR reviews, etc.)
		const parsedUri = URI.parse(uri);
		if (parsedUri.scheme !== 'file') {
			this.clearDiagnostics(uri);
			return;
		}

		let settings = await this.getDocumentSettings(document);
		if (!settings.enable) {
			return;
		}

		if (settings.lintOnlyOpened) {
			let isOpened = this.openedFiles.has(uri);
			if (!isOpened) {
				this.connection.console.log(
					strings.format(SR.IgnoredClosedTextDocument, uri)
				);
				return;
			}
		}

		let source: string = this.getSource(uri);

		if (settings.ignoreSource.length > 0) {
			for (let key in settings.ignoreSource) {
				let value = settings.ignoreSource[key];
				if (value === source) {
					return;
				}
			}
		}

		if (this.validating.has(uri) === false) {
			let diagnostics: Diagnostic[] = [];
			this.sendStartValidationNotification(document);
			try {
				if (!settings.executablePath) {
					// Skip validation silently - the client has already logged a warning
					return;
				}
				const phpcs = await PhpcsLinter.create(settings.executablePath);
				phpcs.setLogger((message) => this.connection.console.log(message));
				diagnostics = await phpcs.lint(document, settings);
			} catch(error) {
				this.connection.console.error(`Error during linting: ${error}`);
				throw new Error(this.getExceptionMessage(error, document));
			} finally {
				this.sendDiagnostics({ uri, diagnostics });
				this.sendEndValidationNotification(document);
			}
		} else {
			const inQueue: boolean = this.queue.has(uri);
			if (inQueue) {
				const old = this.queue.get(uri);
				if (old && old.version < document.version) {
					this.queue.set(document.uri, document);
				}
			} else if (this.queue.size < settings.queueBuffer) {
				this.queue.set(document.uri, document);
			}
		}
	}

	/**
	 * Attempt to free up buffered Documents
	 * @return void
	 */
	private async freeBuffer(): Promise<void> {
		for (const [key, document] of this.queue) {
			if (this.validating.has(key)) {
				continue;
			}
			this.queue.delete(key);
			try {
				await this.validateSingle(document);
			} catch (error: unknown) {
				const message = error instanceof Error ? error.message : String(error);
				this.connection.window.showErrorMessage(`phpcs: ${message}`);
			}
		}
	}

	/**
	 * Validate a list of text documents.
	 *
	 * @param documents The list of text documents to validate.
	 * @return void
	 */
	public async validateMany(documents: TextDocument[]): Promise<void> {
		for (let i = 0, len = documents.length; i < len; i++) {
			await this.validateSingle(documents[i]);
		}
	}

	/**
	 * Get the settings for the specified document.
	 *
	 * @param document The text document for which to get the settings.
	 * @return A promise of PhpcsSettings.
	 */
	private async getDocumentSettings(document: TextDocument): Promise<PhpcsSettings> {
		const { uri } = document;
		if (this.hasConfigurationCapability) {
			const cached = this.documentSettings.get(uri);
			if (cached) {
				return cached;
			}
			const configurationItem = uri.match(/^untitled:/)
				? { section: 'phpcs' }
				: { section: 'phpcs', scopeUri: uri };
			const settingsPromise = this.connection.workspace.getConfiguration(configurationItem)
				.then((config: PhpcsSettings | null) => {
					// Merge with defaults to ensure all properties exist
					return { ...this.defaultSettings, ...config };
				});
			this.documentSettings.set(uri, settingsPromise);
			return settingsPromise;
		} else {
			return Promise.resolve(this.globalSettings ?? this.defaultSettings);
		}
	}

	/**
	 * Get the exception message from an exception object.
	 *
	 * @param exception The exception to parse.
	 * @param document The document where the exception occurred.
	 * @return string The exception message.
	 */
	private getExceptionMessage(exception: unknown, document: TextDocument): string {
		if (exception && typeof exception === 'object' && 'message' in exception) {
			const msg = exception.message;
			if (typeof msg === 'string') {
				let message = msg.replace(/\r?\n/g, ' ');
				if (/^ERROR: /.test(message)) {
					message = message.substring(7);
				}
				return message;
			}
		}
		return strings.format(SR.UnknownErrorWhileValidatingTextDocument, URI.parse(document.uri).fsPath);
	}

	private getSource(uri: string): string
	{
		const matches = uri.match(/^([^:]+):/);
		if (matches && matches.length === 2) {
			return matches[1];
		}
		return '';
	}
}

let server = new PhpcsServer();
server.listen();
