/* --------------------------------------------------------------------------------------------
 * Copyright (c) Ioannis Kappas. All rights reserved.
 * Licensed under the MIT License. See License.md in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
"use strict";
import * as cp from "child_process";
import * as extfs from "./base/node/extfs";
import * as os from "os";
import * as path from "path";
import * as semver from "semver";
import * as spawn from "cross-spawn";
import * as strings from "./base/common/strings";

import {
    Diagnostic,
} from "vscode-languageserver/node";

import { TextDocument } from "vscode-languageserver-textdocument";
import { URI } from "vscode-uri";

import { StringResources as SR } from "./strings";
import { PhpcsSettings } from "./settings";

import {
    buildLintArguments,
    createDiagnosticFromMessage,
    extractFatalError,
    extractStdoutError,
    getV4ExitCodeError,
	isNoFilesCheckedMessage,
    parsePhpcsOutput,
    prepareFileText,
    resolveStandard,
    shouldIgnoreFile,
    PhpcsExecutionContext,
} from "./linter-utils";

// Re-export for backward compatibility
export { FATAL_ERROR_PATTERN } from "./linter-utils";

export type LoggerFunction = (message: string) => void;

export class PhpcsLinter {

	private executablePath: string;
	private executableVersion: string;
	private isV4: boolean;
	private logger: LoggerFunction | null = null;

	private constructor(executablePath: string, executableVersion: string) {
		this.executablePath = executablePath;
		this.executableVersion = executableVersion;
		// Cache version check for performance - this is called frequently during linting
		this.isV4 = semver.gte(executableVersion, '4.0.0');
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
	 * Check if the PHPCS version is 4.0.0 or above.
	 * PHPCS v4 introduced breaking changes including STDERR output routing.
	 * Uses cached value computed at construction time for performance.
	 */
	private isV4OrAbove(): boolean {
		return this.isV4;
	}

	/**
	 * Create an instance of the PhpcsLinter.
	 */
	static async create(executablePath: string): Promise<PhpcsLinter> {
		try {

			let result: Buffer = cp.execSync(`"${executablePath}" --version`);

			const versionPattern: RegExp = /^PHP_CodeSniffer version (\d+\.\d+\.\d+)/i;
			const versionMatches = result.toString().match(versionPattern);

			if (versionMatches === null) {
				throw new Error(SR.InvalidVersionStringError);
			}

			const executableVersion = versionMatches[1];
			return new PhpcsLinter(executablePath, executableVersion);

		} catch (error: unknown) {
			let message = SR.CreateLinterErrorDefaultMessage;
			if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
				message = error.message;
			}
			throw new Error(strings.format(SR.CreateLinterError, message));
		}
	}

	public async lint(document: TextDocument, settings: PhpcsSettings): Promise<Diagnostic[]> {

		const { workspaceRoot } = settings;

		// Process linting paths.
		let filePath: string | undefined;
		try {
			const uri = URI.parse(document.uri);
			if (uri.scheme === 'file') {
				filePath = uri.fsPath;
			}
		} catch {
			filePath = undefined;
		}

		// Make sure we capitalize the drive letter in paths on Windows.
		if (filePath !== undefined && /^win/.test(process.platform)) {
			let pathRoot: string = path.parse(filePath).root;
			let noDrivePath = filePath.slice(Math.max(pathRoot.length - 1, 0));
			filePath = path.join(pathRoot.toUpperCase(), noDrivePath);
		}

		let fileText = document.getText();

		// Return empty on empty text.
		if (fileText === '') {
			return [];
		}

		// Resolve coding standard (uses shared utility to find config files)
		const standard = await resolveStandard(settings, filePath);

		// Check if file should be ignored for PHPCS < 3.0.0 (Skip for in-memory documents)
		if (
			filePath !== undefined &&
			settings.ignorePatterns.length &&
			!semver.gte(this.executableVersion, '3.0.0') &&
			shouldIgnoreFile(filePath, settings.ignorePatterns)
		) {
			return [];
		}

		// Build lint arguments using the extracted function
		const lintArgs = buildLintArguments({
			executableVersion: this.executableVersion,
			filePath,
			standard,
			showSources: settings.showSources,
			showWarnings: settings.showWarnings,
			errorSeverity: settings.errorSeverity,
			warningSeverity: settings.warningSeverity,
			ignorePatterns: settings.ignorePatterns,
		});

		// Prepare file text (handles version-specific requirements)
		const text = prepareFileText(fileText, filePath, this.executableVersion, os.EOL);

		const forcedKillTime = 1000 * 60 * 5; // ms * s * m: 5 minutes
		const options = {
			cwd: workspaceRoot !== null ? workspaceRoot : undefined,
			env: process.env,
			encoding: "utf8" as const,
			timeout: forcedKillTime,
			input: text,
		};

		const phpcs = spawn.sync(this.executablePath, lintArgs, options);
		const stdout = (phpcs.stdout ?? '').toString().trim();
		const stderr = (phpcs.stderr ?? '').toString().trim();
		const exitCode = phpcs.status;
		const signal = phpcs.signal;

		// Build execution context for diagnostics
		const executionContext: PhpcsExecutionContext = {
			exitCode,
			signal,
			stderr,
		};

		// Handle PHPCS v4+ specific cases: no-files-checked and exit codes.
		if (this.isV4OrAbove()) {
			// "No files were checked" is a benign PHPCS message when filters or exclusions skip the file.
			// PHPCS v4 writes it to STDERR and returns exit code 16.
			if (isNoFilesCheckedMessage(stderr)) {
				this.log('[PHPCS] No files were checked for current lint input (likely excluded by filtering rules).');
				return [];
			}

			// Handle exit codes.
			const exitCodeError = getV4ExitCodeError(exitCode);
			if (exitCodeError) {
				throw new Error(exitCodeError);
			}
		}

		// Check for fatal errors in stderr
		if (stderr !== '') {
			const fatalError = extractFatalError(stderr);
			if (fatalError) {
				throw new Error(fatalError);
			}

			// For PHPCS v4+, non-fatal stderr content is normal (progress/debug output).
			// For v3 and below, any other stderr content indicates an error.
			if (this.isV4OrAbove()) {
				this.log(`[PHPCS v4 STDERR] ${stderr}`);
			} else {
				throw new Error(strings.format(SR.UnknownExecutionError, `${this.executablePath} ${lintArgs.join(' ')}`));
			}
		}

		// Check for errors in stdout
		const stdoutError = extractStdoutError(stdout);
		if (stdoutError) {
			if (stdoutError.codingStandard) {
				throw new Error(strings.format(SR.CodingStandardNotInstalledError, stdoutError.codingStandard));
			}
			throw new Error(stdoutError.message);
		}

		// Parse PHPCS output
		const data = parsePhpcsOutput(stdout, executionContext);

		// Get messages from the appropriate file key
		let messages;
		if (filePath !== undefined && semver.gte(this.executableVersion, '2.0.0')) {
			const fileRealPath = extfs.realpathSync(filePath);
			if (!data.files[fileRealPath]) {
				return [];
			}
			({ messages } = data.files[fileRealPath]);
		} else {
			// PHPCS v1 can't associate a filename with STDIN input
			if (!data.files.STDIN) {
				return [];
			}
			({ messages } = data.files.STDIN);
		}

		// Create diagnostics using the extracted function
		return messages.map(message =>
			createDiagnosticFromMessage(document, message, settings.showSources)
		);
	}
}
