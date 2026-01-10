/* --------------------------------------------------------------------------------------------
 * Copyright (c) John R. D'Orazio. All rights reserved.
 * Licensed under the MIT License. See License.md in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import * as cp from 'child_process';
import * as os from 'os';
import * as spawn from 'cross-spawn';
import * as strings from './base/common/strings';

import { TextDocument } from 'vscode-languageserver-textdocument';
import { URI } from 'vscode-uri';

import { StringResources as SR } from './strings';
import { PhpcsSettings } from './settings';
import { prepareFileText, shouldIgnoreFile, resolveStandard } from './linter-utils';

import {
	buildFixArguments,
	parseFixResult,
	extractPhpcbfStdoutError,
	normalizeWindowsPath,
	createEmptyFileResult,
	createIgnoredFileResult,
	createTimeoutResult,
	isTimeoutSignal,
	parseVersionString,
	isVersionV4OrAbove,
	FixResult,
} from './fixer-utils';

export type LoggerFunction = (message: string) => void;

/**
 * PHPCBF fixer class for auto-fixing code style issues.
 */
export class PhpcbfFixer {

	private executablePath: string;
	private executableVersion: string;
	private isV4: boolean;
	private logger: LoggerFunction | null = null;

	private constructor(executablePath: string, executableVersion: string) {
		this.executablePath = executablePath;
		this.executableVersion = executableVersion;
		// Cache version check for performance
		this.isV4 = isVersionV4OrAbove(executableVersion);
	}

	/**
	 * Set a logger function to receive debug messages.
	 */
	public setLogger(logger: LoggerFunction): void {
		this.logger = logger;
	}

	/**
	 * Log a message if a logger is set.
	 */
	private log(message: string): void {
		if (this.logger) {
			this.logger(message);
		}
	}

	/**
	 * Check if the PHPCS/PHPCBF version is 4.0.0 or above.
	 */
	private isV4OrAbove(): boolean {
		return this.isV4;
	}

	/**
	 * Create an instance of the PhpcbfFixer.
	 * @param executablePath Path to the phpcbf executable
	 */
	static async create(executablePath: string): Promise<PhpcbfFixer> {
		try {
			const result: Buffer = cp.execSync(`"${executablePath}" --version`);
			const executableVersion = parseVersionString(result.toString());

			if (executableVersion === null) {
				throw new Error(SR.InvalidVersionStringError);
			}

			return new PhpcbfFixer(executablePath, executableVersion);

		} catch (error: unknown) {
			let message = SR.CreateFixerErrorDefaultMessage;
			if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
				message = error.message;
			}
			throw new Error(strings.format(SR.CreateFixerError, message));
		}
	}

	/**
	 * Get the executable path.
	 */
	public getExecutablePath(): string {
		return this.executablePath;
	}

	/**
	 * Get the executable version.
	 */
	public getExecutableVersion(): string {
		return this.executableVersion;
	}

	/**
	 * Fix a document using PHPCBF.
	 * @param document The text document to fix
	 * @param settings The PHPCS settings
	 * @returns The fix result
	 */
	public async fix(document: TextDocument, settings: PhpcsSettings): Promise<FixResult> {
		const { workspaceRoot } = settings;

		// Process file path
		let filePath: string | undefined;
		try {
			const uri = URI.parse(document.uri);
			if (uri.scheme === 'file') {
				filePath = uri.fsPath;
			}
		} catch {
			filePath = undefined;
		}

		// Make sure we capitalize the drive letter in paths on Windows
		if (filePath !== undefined && /^win/.test(process.platform)) {
			filePath = normalizeWindowsPath(filePath);
		}

		const fileText = document.getText();

		// Return early on empty text
		if (fileText === '') {
			return createEmptyFileResult(fileText);
		}

		// Resolve coding standard (uses shared utility to find config files)
		const standard = await resolveStandard(settings, filePath);

		// Check if file should be ignored
		if (
			filePath !== undefined &&
			settings.ignorePatterns.length &&
			shouldIgnoreFile(filePath, settings.ignorePatterns)
		) {
			return createIgnoredFileResult(fileText);
		}

		// Build fix arguments
		const fixArgs = buildFixArguments({
			executableVersion: this.executableVersion,
			filePath,
			standard,
		});

		// Prepare file text (handles version-specific requirements)
		const text = prepareFileText(fileText, filePath, this.executableVersion, os.EOL);

		// Use configurable timeout (in seconds), convert to milliseconds
		const timeoutSeconds = settings.phpcbfTimeout ?? 60;
		const timeoutMs = timeoutSeconds * 1000;

		const options = {
			cwd: workspaceRoot !== null ? workspaceRoot : undefined,
			env: process.env,
			encoding: "utf8" as const,
			timeout: timeoutMs,
			input: text,
		};

		this.log(`[PHPCBF] Running: ${this.executablePath} ${fixArgs.join(' ')}`);
		this.log(`[PHPCBF] Input content length: ${text.length} chars`);
		this.log(`[PHPCBF] Timeout: ${timeoutSeconds} seconds`);

		const phpcbf = spawn.sync(this.executablePath, fixArgs, options);
		const stdout = (phpcbf.stdout ?? '').toString();
		const stderr = (phpcbf.stderr ?? '').toString().trim();
		const exitCode = phpcbf.status;

		this.log(`[PHPCBF] Exit code: ${exitCode}`);

		// Check for timeout (process killed by signal)
		if (isTimeoutSignal(phpcbf.signal)) {
			return createTimeoutResult(fileText, strings.format(SR.PhpcbfTimeoutError, String(timeoutSeconds)));
		}

		// Check for stdout errors first (e.g., "ERROR: the standard is not installed")
		const stdoutError = extractPhpcbfStdoutError(stdout);
		if (stdoutError) {
			return {
				fixed: false,
				content: fileText,
				hasUnfixableIssues: false,
				error: stdoutError,
			};
		}

		// Parse the result
		return parseFixResult(stdout, stderr, exitCode, fileText, this.isV4OrAbove());
	}
}
