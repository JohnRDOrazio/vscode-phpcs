/* --------------------------------------------------------------------------------------------
 * Copyright (c) Ioannis Kappas. All rights reserved.
 * Licensed under the MIT License. See License.md in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
"use strict";

import * as path from "path";

import {
	CancellationToken,
	Disposable,
	Uri,
	workspace,
	WorkspaceConfiguration,
	WorkspaceFolder
} from "vscode";

import {
	DidChangeConfigurationNotification,
	LanguageClient,
} from "vscode-languageclient/node";

import { ConfigurationParams } from "vscode-languageserver-protocol";

import { PhpcsSettings } from "./settings";
import { PhpcsPathResolver } from "./resolvers/path-resolver";

export class PhpcsConfiguration extends Disposable {

	// Nulled on dispose to release the reference, so the field is nullable and
	// reached through the accessor below rather than directly.
	private client: LanguageClient | null;
	private disposables: Array<Disposable> = [];
	// Null rather than undefined-until-first-computed. The `if (this.globalSettings)`
	// check below already treated it as absent-or-present; the type now says so.
	private globalSettings: PhpcsSettings | null = null;
	private folderSettings: Map<Uri, PhpcsSettings> = new Map();

	/**
	 * Class constructor
	 * @param client The client to use.
	 */
	public constructor(client: LanguageClient) {
		super(() => {
			this.disposables.map(o => { o.dispose(); });
			this.client = null;
		});

		this.client = client;
	}

	/**
	 * The language client, or a clear failure if this object has been disposed.
	 *
	 * Every use here is reached from a callback registered while the object was
	 * live, so a null client means something is running after dispose. That was
	 * already fatal — it threw "Cannot read properties of null" from whichever
	 * property happened to be touched first. This says which object is at fault.
	 */
	private get languageClient(): LanguageClient {
		if (this.client === null) {
			throw new Error('PhpcsConfiguration has been disposed and can no longer be used.');
		}
		return this.client;
	}

	// Convert VS Code specific settings to a format acceptable by the server. Since
	// both client and server do use JSON the conversion is trivial.
	public async compute(params: ConfigurationParams, _token: CancellationToken, _next: Function): Promise<any[]> {
		// An empty result rather than null. The declared Promise<any[]> is not
		// negotiable — vscode-languageclient's MiddlewareSignature requires an
		// array, so returning null was a protocol violation as well as a type
		// error. `items` is required by the LSP spec, so this is defensive
		// anyway, and an empty array is the correct answer to a request that
		// asks for nothing.
		if (!params.items) {
			return [];
		}
		let result: (PhpcsSettings | null)[] = [];
		for (let item of params.items) {
			// Only handle phpcs configuration requests
			// Return null for other sections to indicate that the configuration is not supported.
			if (item.section && item.section !== 'phpcs') {
				result.push(null);
				continue;
			}

			let config: WorkspaceConfiguration;
			// Only assigned when the request carries a scope, and getWorkspaceFolder
			// returns undefined for a resource outside every folder. The `if (folder)`
			// checks below already assumed this; the declaration did not.
			let folder: WorkspaceFolder | undefined;
			if (item.scopeUri) {
				let resource = this.languageClient.protocol2CodeConverter.asUri(item.scopeUri);
				folder = workspace.getWorkspaceFolder(resource);
			}

			if (folder) {
				const cached = this.folderSettings.get(folder.uri);
				if (cached) {
					result.push(cached);
					continue;
				}
				config = workspace.getConfiguration('phpcs', folder.uri);
			} else {
				if (this.globalSettings) {
					result.push(this.globalSettings);
					continue;
				}
				config = workspace.getConfiguration('phpcs');
			}

			// Every default below is the one declared for the same key in
			// package.json under contributes.configuration. The single-argument
			// config.get() returns `T | undefined`, which is honest — it yields
			// undefined for a key VS Code does not know about — so the fields it
			// filled were only non-undefined by the grace of the manifest. Passing
			// the default explicitly makes that dependency visible and gives the
			// two-argument overload, which returns `T`.
			//
			// These must stay in step with the manifest; a value drifting here
			// would change behaviour silently for anyone who has not set the key.
			let settings: PhpcsSettings = {
				enable: config.get<boolean>('enable', true),
				workspaceRoot: folder ? folder.uri.fsPath : null,
				executablePath: config.get<string | null>('executablePath', null),
				composerJsonPath: config.get<string>('composerJsonPath', 'composer.json'),
				standard: config.get<string | null>('standard', null),
				autoConfigSearch: config.get<boolean>('autoConfigSearch', true),
				showSources: config.get<boolean>('showSources', false),
				showWarnings: config.get<boolean>('showWarnings', true),
				ignorePatterns: config.get<string[]>('ignorePatterns', []),
				ignoreSource: config.get<string[]>('ignoreSource', []),
				warningSeverity: config.get<number>('warningSeverity', 5),
				errorSeverity: config.get<number>('errorSeverity', 5),
				lintOnType: config.get<boolean>('lintOnType', true),
				lintOnOpen: config.get<boolean>('lintOnOpen', true),
				lintOnSave: config.get<boolean>('lintOnSave', true),
				queueBuffer: config.get<number>('queueBuffer', 10),
				lintOnlyOpened: config.get<boolean>('lintOnlyOpened', true),
				// PHPCBF settings
				phpcbfEnable: config.get<boolean>('phpcbfEnable', true),
				phpcbfExecutablePath: config.get<string | null>('phpcbfExecutablePath', null),
				phpcbfOnSave: config.get<boolean>('phpcbfOnSave', false),
				phpcbfTimeout: config.get<number>('phpcbfTimeout', 60),
			};

			settings = await this.resolveExecutablePath(settings);

			if (folder) {
				this.folderSettings.set(folder.uri, settings);
			} else {
				this.globalSettings = settings;
			}

			result.push(settings);
		}
		return result;
	}

	protected async resolveExecutablePath(settings: PhpcsSettings): Promise<PhpcsSettings> {
		if (settings.executablePath === null) {
			let executablePathResolver = new PhpcsPathResolver(settings);
			try {
				settings.executablePath = await executablePathResolver.resolve();
			} catch (error) {
				// Log a warning instead of throwing an error popup
				const folderName = settings.workspaceRoot
					? path.basename(settings.workspaceRoot)
					: 'global';
				const message = error instanceof Error ? error.message : String(error);
				this.languageClient.outputChannel.appendLine(`[Warning] ${folderName}: ${message}`);
				// Leave executablePath as null - the server will skip validation for this folder
			}
		} else if (!path.isAbsolute(settings.executablePath) && settings.workspaceRoot !== null) {
			settings.executablePath = path.join(settings.workspaceRoot, settings.executablePath);
		}
		return settings;
	}

	public initialize(): void {
		// VS Code currently doesn't sent fine grained configuration changes. So we
		// listen to any change. However this will change in the near future.
		this.disposables.push(workspace.onDidChangeConfiguration(() => {
			this.folderSettings.clear();
			this.globalSettings = null;
			this.languageClient.sendNotification(DidChangeConfigurationNotification.type, { settings: null });
		}));
	}
}
