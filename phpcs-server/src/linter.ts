/* --------------------------------------------------------------------------------------------
 * Copyright (c) Ioannis Kappas. All rights reserved.
 * Licensed under the MIT License. See License.md in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
"use strict";
import * as cp from "child_process";
import * as extfs from "./base/node/extfs";
import * as mm from "micromatch";
import * as os from "os";
import * as path from "path";
import * as semver from "semver";
import * as spawn from "cross-spawn";
import * as strings from "./base/common/strings";
import CharCode from "./base/common/charcode";

import {
	Diagnostic,
	DiagnosticSeverity,
	Range,
} from "vscode-languageserver/node";

import { TextDocument } from "vscode-languageserver-textdocument";
import { URI } from "vscode-uri";

import { StringResources as SR } from "./strings";
import { PhpcsSettings } from "./settings";
import { PhpcsMessage } from "./message";

export type LoggerFunction = (message: string) => void;

export class PhpcsLinter {

	private executablePath: string;
	private executableVersion: string;
	private isV4: boolean;
	private ignorePatternReplacements: Map<RegExp, string> | null = null;
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

		// Process linting arguments.
		let lintArgs = ['--report=json'];

		// -q (quiet) option is available since phpcs 2.6.2
		if (semver.gte(this.executableVersion, '2.6.2')) {
			lintArgs.push('-q');
		}

		// Show sniff source codes in report output.
		if (settings.showSources === true) {
			lintArgs.push('-s');
		}

		// --encoding option is available since 1.3.0
		if (semver.gte(this.executableVersion, '1.3.0')) {
			lintArgs.push('--encoding=UTF-8');
		}

		// Check if a config file exists and handle it
		let standard: string | null = null;
		if (settings.autoConfigSearch && workspaceRoot !== null && filePath !== undefined) {
			const confFileNames = [
				'.phpcs.xml',
				'.phpcs.xml.dist',
				'phpcs.xml',
				'phpcs.xml.dist',
				'phpcs.ruleset.xml',
				'ruleset.xml',
			];

			const fileDir = path.relative(workspaceRoot, path.dirname(filePath));

			const confFile = !settings.ignorePatterns.some(pattern => this.isIgnorePatternMatch(filePath, pattern))
				? await extfs.findAsync(workspaceRoot, fileDir, confFileNames)
				: null;

			standard = confFile || settings.standard;
		} else {
			standard = settings.standard;
		}

		if (standard) {
			lintArgs.push(`--standard=${standard}`);
		}

		// Check if file should be ignored (Skip for in-memory documents)
		if (filePath !== undefined && settings.ignorePatterns.length) {
			if (semver.gte(this.executableVersion, '3.0.0')) {
				// PHPCS v3 and up support this with STDIN files
				lintArgs.push(`--ignore=${settings.ignorePatterns.join()}`);
			} else if (settings.ignorePatterns.some(pattern => this.isIgnorePatternMatch(filePath, pattern))) {
				// We must determine this ourself for lower versions
				return [];
			}
		}

		lintArgs.push(`--error-severity=${settings.errorSeverity}`);

		let warningSeverity = settings.warningSeverity;
		if (settings.showWarnings === false) {
			warningSeverity = 0;
		}
		lintArgs.push(`--warning-severity=${warningSeverity}`);

		let text = fileText;

		// Determine the method of setting the file name
		if (filePath !== undefined) {
			switch (true) {

				// PHPCS 2.6 and above support sending the filename in a flag
				case semver.gte(this.executableVersion, '2.6.0'):
					lintArgs.push(`--stdin-path=${filePath}`);
					break;

				// PHPCS 2.x.x before 2.6.0 supports putting the name in the start of the stream
				case semver.satisfies(this.executableVersion, '>=2.0.0 <2.6.0'):
					// TODO: This needs to be document specific.
					const eolChar = os.EOL;
					text = `phpcs_input_file: ${filePath}${eolChar}${fileText}`;
					break;

				// PHPCS v1 supports stdin, but ignores all filenames.
				default:
					// Nothing to do
					break;
			}
		}

		// Finish off the parameter list
		lintArgs.push('-');

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
		let match = null;

		// Handle PHPCS v4+ exit codes first.
		// v4 exit codes: 0=clean, 1=fixable issues, 2=non-fixable issues, 3=both,
		// 16=processing error, 64=requirements not met
		if (this.isV4OrAbove()) {
			if (exitCode === 16) {
				throw new Error(SR.ProcessingError);
			}
			if (exitCode === 64) {
				throw new Error(SR.RequirementsNotMetError);
			}
			// Exit codes 0, 1, 2, 3 are normal operation - continue processing
		}

		// Determine whether we have an error in stderr.
		// Check for actual fatal errors (applies to both v3 and v4)
		if (stderr !== '') {
			if (match = stderr.match(/^(?:PHP\s?)?FATAL\s?ERROR:\s?(.*)/i)) {
				let error = match[1].trim();
				if (match = error.match(/^Uncaught exception '.*' with message '(.*)'/)) {
					throw new Error(match[1]);
				}
				throw new Error(error);
			}

			// For PHPCS v4+, non-fatal stderr content is normal (progress/debug output).
			// Log it for debugging purposes.
			// For v3 and below, any other stderr content indicates an error.
			if (this.isV4OrAbove()) {
				this.log(`[PHPCS v4 STDERR] ${stderr}`);
			} else {
				throw new Error(strings.format(SR.UnknownExecutionError, `${this.executablePath} ${lintArgs.join(' ')}`));
			}
		}

		// Determine whether we have an error in stdout.
		if (match = stdout.match(/^ERROR:\s?(.*)/i)) {
			let error = match[1].trim();
			if (match = error.match(/^the \"(.*)\" coding standard is not installed\./)) {
				throw new Error(strings.format(SR.CodingStandardNotInstalledError, match[1]));
			}
			throw new Error(error);
		}

		const data = this.parseData(stdout);

		let messages: Array<PhpcsMessage>;
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

		let diagnostics: Diagnostic[] = [];
		messages.map(message => diagnostics.push(
			this.createDiagnostic(document, message, settings.showSources)
		));

		return diagnostics;
	}

	private parseData(text: string) {
		try {
			return JSON.parse(text) as { files: any };
		} catch (error) {
			throw new Error(SR.InvalidJsonStringError);
		}
	}

	private createDiagnostic(document: TextDocument, entry: PhpcsMessage, showSources: boolean): Diagnostic {

		let lines = document.getText().split("\n");
		let line = entry.line - 1;
		let lineString = lines[line];

		// Process diagnostic start and end characters.
		let startCharacter = entry.column - 1;
		let endCharacter = entry.column;
		let charCode = lineString.charCodeAt(startCharacter);
		if (CharCode.isWhiteSpace(charCode)) {
			for (let i = startCharacter + 1, len = lineString.length; i < len; i++) {
				charCode = lineString.charCodeAt(i);
				if (!CharCode.isWhiteSpace(charCode)) {
					break;
				}
				endCharacter = i;
			}
		} else if (CharCode.isAlphaNumeric(charCode) || CharCode.isSymbol(charCode)) {
			// Get the whole word
			for (let i = startCharacter + 1, len = lineString.length; i < len; i++) {
				charCode = lineString.charCodeAt(i);
				if (!CharCode.isAlphaNumeric(charCode) && charCode !== 95) {
					break;
				}
				endCharacter++;
			}
			// Move backwards
			for (let i = startCharacter, len = 0; i > len; i--) {
				charCode = lineString.charCodeAt(i - 1);
				if (!CharCode.isAlphaNumeric(charCode) && !CharCode.isSymbol(charCode) && charCode !== 95) {
					break;
				}
				startCharacter--;
			}
		}

		// Process diagnostic range.
		const range: Range = Range.create(line, startCharacter, line, endCharacter);

		// Process diagnostic sources.
		let message: string = entry.message;
		if (showSources) {
			message += `\n(${entry.source})`;
		}

		// Process diagnostic severity.
		let severity: DiagnosticSeverity = DiagnosticSeverity.Error;
		if (entry.type === "WARNING") {
			severity = DiagnosticSeverity.Warning;
		}

		return Diagnostic.create(range, message, severity, undefined, 'phpcs');
	}

	protected getIgnorePatternReplacements(): Map<RegExp, string> {
		if (!this.ignorePatternReplacements) {
			this.ignorePatternReplacements = new Map([
				[/^\*\//, '**/'], // */some/path => **/some/path
				[/\/\*$/, '/**'], // some/path/* => some/path/**
				[/\/\*\//g, '/**/'], // some/*/path => some/**/path
			]);
		}
		return this.ignorePatternReplacements;
	}

	protected isIgnorePatternMatch(path: string, pattern: string): boolean {
		for (let [searchValue, replaceValue] of this.getIgnorePatternReplacements()) {
			pattern = pattern.replace(searchValue, replaceValue);
		}
		return mm.isMatch(path, pattern);
	}
}
