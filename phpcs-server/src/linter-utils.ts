/* --------------------------------------------------------------------------------------------
 * Copyright (c) Ioannis Kappas. All rights reserved.
 * Licensed under the MIT License. See License.md in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import * as mm from 'micromatch';
import * as path from 'path';
import * as semver from 'semver';
import * as strings from './base/common/strings';
import * as extfs from './base/node/extfs';
import CharCode from './base/common/charcode';
import { StringResources as SR } from './strings';
import { PhpcsMessage } from './message';

import {
	Diagnostic,
	DiagnosticSeverity,
	Range,
} from 'vscode-languageserver/node';

import { TextDocument } from 'vscode-languageserver-textdocument';

/**
 * Regex pattern for detecting fatal errors in STDERR.
 * Matches both "FATAL ERROR: ..." and "PHP FATAL ERROR: ..."
 */
export const FATAL_ERROR_PATTERN = /^(?:PHP\s?)?FATAL\s?ERROR:\s?(.*)/i;

/**
 * Pattern replacements for converting PHPCS ignore patterns to micromatch format.
 */
const IGNORE_PATTERN_REPLACEMENTS: [RegExp, string][] = [
	[/^\*\//, '**/'],      // */some/path => **/some/path
	[/\/\*$/, '/**'],      // some/path/* => some/path/**
	[/\/\*\//g, '/**/'],   // some/*/path => some/**/path
];

/**
 * Result of parsing PHPCS JSON output.
 */
export interface PhpcsParseResult {
	totals?: {
		errors: number;
		warnings: number;
		fixable?: number;
	};
	files: {
		[filePath: string]: {
			errors: number;
			warnings: number;
			messages: PhpcsMessage[];
		};
	};
}

/**
 * Options for building lint arguments.
 */
export interface LintArgumentOptions {
	executableVersion: string;
	filePath?: string;
	standard?: string | null;
	showSources: boolean;
	showWarnings: boolean;
	errorSeverity: number;
	warningSeverity: number;
	ignorePatterns: string[];
}

/**
 * Transform a PHPCS ignore pattern to micromatch-compatible format.
 * @param pattern The original ignore pattern
 * @returns The transformed pattern
 */
export function transformIgnorePattern(pattern: string): string {
	let transformed = pattern;
	for (const [searchValue, replaceValue] of IGNORE_PATTERN_REPLACEMENTS) {
		transformed = transformed.replace(searchValue, replaceValue);
	}
	return transformed;
}

/**
 * Check if a file path matches an ignore pattern.
 * @param filePath The file path to check
 * @param pattern The ignore pattern
 * @returns True if the file matches the pattern
 */
export function isIgnorePatternMatch(filePath: string, pattern: string): boolean {
	const transformedPattern = transformIgnorePattern(pattern);
	return mm.isMatch(filePath, transformedPattern);
}

/**
 * Check if a file should be ignored based on multiple patterns.
 * @param filePath The file path to check
 * @param patterns Array of ignore patterns
 * @returns True if the file matches any pattern
 */
export function shouldIgnoreFile(filePath: string, patterns: string[]): boolean {
	return patterns.some(pattern => isIgnorePatternMatch(filePath, pattern));
}

/**
 * Maximum characters to include in error preview.
 */
const OUTPUT_PREVIEW_MAX_LENGTH = 500;

/**
 * Create a preview of raw output for error messages.
 * @param text The raw output text
 * @param maxLength Maximum characters to include
 * @returns Truncated preview with indicator if truncated
 */
function createOutputPreview(text: string, maxLength: number = OUTPUT_PREVIEW_MAX_LENGTH): string {
	if (text.length <= maxLength) {
		return text;
	}
	return text.substring(0, maxLength) + '... [truncated]';
}

/**
 * Context information for PHPCS execution diagnostics.
 */
export interface PhpcsExecutionContext {
	exitCode: number | null;
	signal: string | null;
	stderr: string;
}

/**
 * Parse PHPCS JSON output.
 * @param text The raw JSON output from PHPCS
 * @param context Optional execution context for better error diagnostics
 * @returns Parsed result object
 * @throws Error if JSON is invalid, including a preview of the raw output
 */
export function parsePhpcsOutput(text: string, context?: PhpcsExecutionContext): PhpcsParseResult {
	try {
		return JSON.parse(text) as PhpcsParseResult;
	} catch (error) {
		let errorMessage: string;

		if (text.length === 0) {
			// Empty output - provide execution context
			const parts: string[] = ['PHPCS returned empty output.'];

			if (context) {
				if (context.signal) {
					parts.push(`Process was killed by signal: ${context.signal}`);
				} else if (context.exitCode !== null && context.exitCode !== 0) {
					parts.push(`Exit code: ${context.exitCode}`);
				}
				if (context.stderr) {
					parts.push(`STDERR: ${createOutputPreview(context.stderr)}`);
				}
			}

			parts.push('This may indicate a timeout, memory limit, or crash.');
			errorMessage = parts.join(' ');
		} else {
			// Non-empty but invalid JSON
			const preview = createOutputPreview(text);
			errorMessage = strings.format(SR.InvalidJsonStringErrorWithPreview, text.length.toString(), preview);
		}

		throw new Error(errorMessage);
	}
}

/**
 * Build the command line arguments for PHPCS.
 * @param options The options for building arguments
 * @returns Array of command line arguments
 */
export function buildLintArguments(options: LintArgumentOptions): string[] {
	const {
		executableVersion,
		filePath,
		standard,
		showSources,
		showWarnings,
		errorSeverity,
		warningSeverity,
		ignorePatterns,
	} = options;

	const args: string[] = ['--report=json'];

	// -q (quiet) option is available since phpcs 2.6.2
	if (semver.gte(executableVersion, '2.6.2')) {
		args.push('-q');
	}

	// Show sniff source codes in report output
	if (showSources) {
		args.push('-s');
	}

	// --encoding option is available since 1.3.0
	if (semver.gte(executableVersion, '1.3.0')) {
		args.push('--encoding=UTF-8');
	}

	// Add standard if specified
	if (standard) {
		args.push(`--standard=${standard}`);
	}

	// Add ignore patterns for PHPCS v3+
	if (filePath !== undefined && ignorePatterns.length && semver.gte(executableVersion, '3.0.0')) {
		args.push(`--ignore=${ignorePatterns.join()}`);
	}

	// Add severity settings
	args.push(`--error-severity=${errorSeverity}`);

	let effectiveWarningSeverity = warningSeverity;
	if (!showWarnings) {
		effectiveWarningSeverity = 0;
	}
	args.push(`--warning-severity=${effectiveWarningSeverity}`);

	// Add stdin-path for PHPCS 2.6.0+
	if (filePath && semver.gte(executableVersion, '2.6.0')) {
		args.push(`--stdin-path=${filePath}`);
	}

	// Read from stdin
	args.push('-');

	return args;
}

/**
 * Prepare file text for PHPCS input, handling version-specific requirements.
 * @param fileText The original file text
 * @param filePath The file path (if available)
 * @param executableVersion The PHPCS version
 * @param eolChar The end-of-line character to use
 * @returns The prepared text
 */
export function prepareFileText(
	fileText: string,
	filePath: string | undefined,
	executableVersion: string,
	eolChar: string
): string {
	// PHPCS 2.x.x before 2.6.0 supports putting the name in the start of the stream
	if (
		filePath !== undefined &&
		semver.satisfies(executableVersion, '>=2.0.0 <2.6.0')
	) {
		return `phpcs_input_file: ${filePath}${eolChar}${fileText}`;
	}
	return fileText;
}

/**
 * Create a VS Code Diagnostic from a PHPCS message.
 * @param document The text document
 * @param message The PHPCS message
 * @param showSources Whether to show source codes in the message
 * @returns A Diagnostic object
 */
export function createDiagnosticFromMessage(
	document: TextDocument,
	message: PhpcsMessage,
	showSources: boolean
): Diagnostic {
	const lines = document.getText().split('\n');
	const line = message.line - 1;
	const lineString = lines[line] || '';

	// Process diagnostic start and end characters
	let startCharacter = message.column - 1;
	let endCharacter = message.column;

	if (lineString.length > 0 && startCharacter < lineString.length) {
		let charCode = lineString.charCodeAt(startCharacter);

		if (CharCode.isWhiteSpace(charCode)) {
			// Extend through whitespace
			for (let i = startCharacter + 1, len = lineString.length; i < len; i++) {
				charCode = lineString.charCodeAt(i);
				if (!CharCode.isWhiteSpace(charCode)) {
					break;
				}
				endCharacter = i;
			}
		} else if (CharCode.isAlphaNumeric(charCode) || CharCode.isSymbol(charCode)) {
			// Get the whole word - extend forward
			for (let i = startCharacter + 1, len = lineString.length; i < len; i++) {
				charCode = lineString.charCodeAt(i);
				if (!CharCode.isAlphaNumeric(charCode) && charCode !== 95) { // 95 = underscore
					break;
				}
				endCharacter++;
			}
			// Move backwards
			for (let i = startCharacter; i > 0; i--) {
				charCode = lineString.charCodeAt(i - 1);
				if (!CharCode.isAlphaNumeric(charCode) && !CharCode.isSymbol(charCode) && charCode !== 95) {
					break;
				}
				startCharacter--;
			}
		}
	}

	// Create the range
	const range: Range = Range.create(line, startCharacter, line, endCharacter);

	// Build the message text
	let diagnosticMessage = message.message;
	if (showSources && message.source) {
		diagnosticMessage += `\n(${message.source})`;
	}

	// Map severity
	const severity = message.type === 'WARNING'
		? DiagnosticSeverity.Warning
		: DiagnosticSeverity.Error;

	const diagnostic = Diagnostic.create(range, diagnosticMessage, severity, undefined, 'phpcs');

	// Store fixable flag and source in data property for use by code actions
	diagnostic.data = {
		fixable: message.fixable,
		source: message.source,
	};

	return diagnostic;
}

/**
 * Check if STDERR content indicates a fatal error.
 * @param stderr The STDERR content
 * @returns The error message if fatal, null otherwise
 */
export function extractFatalError(stderr: string): string | null {
	const match = stderr.match(FATAL_ERROR_PATTERN);
	if (!match) {
		return null;
	}

	let error = match[1].trim();

	// Check for uncaught exception pattern
	const exceptionMatch = error.match(/^Uncaught exception '.*' with message '(.*)'/);
	if (exceptionMatch) {
		return exceptionMatch[1];
	}

	return error;
}

/**
 * Check if STDOUT contains an ERROR message.
 * @param stdout The STDOUT content
 * @returns Object with error details or null if no error
 */
export function extractStdoutError(stdout: string): { message: string; codingStandard?: string } | null {
	const match = stdout.match(/^ERROR:\s?(.*)/i);
	if (!match) {
		return null;
	}

	const error = match[1].trim();

	// Check for coding standard not installed
	const standardMatch = error.match(/^the \"(.*)\" coding standard is not installed\./);
	if (standardMatch) {
		return {
			message: error,
			codingStandard: standardMatch[1],
		};
	}

	return { message: error };
}

/**
 * Check if a PHPCS v4 exit code indicates an error.
 * @param exitCode The exit code from PHPCS
 * @returns Error message if exit code indicates error, null otherwise
 */
export function getV4ExitCodeError(exitCode: number | null): string | null {
	if (exitCode === 16) {
		return SR.ProcessingError;
	}
	if (exitCode === 64) {
		return SR.RequirementsNotMetError;
	}
	// Exit codes 0, 1, 2, 3 are normal operation
	return null;
}

/**
 * PHPCS/PHPCBF config file names in order of precedence.
 */
export const CONFIG_FILE_NAMES = [
	'.phpcs.xml',
	'.phpcs.xml.dist',
	'phpcs.xml',
	'phpcs.xml.dist',
	'phpcs.ruleset.xml',
	'ruleset.xml',
];

/**
 * Resolve the coding standard to use based on settings and config file search.
 * @param settings Object containing autoConfigSearch, standard, workspaceRoot, and ignorePatterns
 * @param filePath The file path being processed
 * @returns The resolved standard path or null
 */
export async function resolveStandard(
	settings: {
		autoConfigSearch: boolean;
		standard: string | null;
		workspaceRoot: string | null;
		ignorePatterns: string[];
	},
	filePath: string | undefined
): Promise<string | null> {
	const { autoConfigSearch, standard, workspaceRoot, ignorePatterns } = settings;

	if (autoConfigSearch && workspaceRoot !== null && filePath !== undefined) {
		const fileDir = path.relative(workspaceRoot, path.dirname(filePath));

		const confFile = !shouldIgnoreFile(filePath, ignorePatterns)
			? await extfs.findAsync(workspaceRoot, fileDir, CONFIG_FILE_NAMES)
			: null;

		return confFile || standard;
	}

	return standard;
}
