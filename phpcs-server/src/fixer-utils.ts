/* --------------------------------------------------------------------------------------------
 * Copyright (c) John R. D'Orazio. All rights reserved.
 * Licensed under the MIT License. See License.md in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import * as semver from 'semver';

/**
 * Options for building PHPCBF fix arguments.
 */
export interface FixArgumentOptions {
	executableVersion: string;
	filePath?: string;
	standard?: string | null;
}

/**
 * Result of a PHPCBF fix operation.
 */
export interface FixResult {
	/** Whether any fixes were applied */
	fixed: boolean;
	/** The fixed file content (if fixes were applied) */
	content: string;
	/** Whether there are remaining unfixable issues */
	hasUnfixableIssues: boolean;
	/** Error message if the fix failed */
	error?: string;
}

/**
 * PHPCBF exit codes.
 * @see https://github.com/PHPCSStandards/PHP_CodeSniffer/wiki/Exit-Codes
 */
export enum PhpcbfExitCode {
	/** No fixable errors were found */
	NoFixableErrors = 0,
	/** All fixable errors were fixed */
	AllFixed = 1,
	/** Some errors could not be fixed */
	SomeUnfixable = 2,
	/** Both fixed and unfixable errors exist */
	FixedAndUnfixable = 3,
	/** Processing error (PHPCS v4+) */
	ProcessingError = 16,
	/** Requirements not met (PHPCS v4+) */
	RequirementsNotMet = 64,
}

/**
 * Build the command line arguments for PHPCBF.
 * @param options The options for building arguments
 * @returns Array of command line arguments
 */
export function buildFixArguments(options: FixArgumentOptions): string[] {
	const {
		executableVersion,
		filePath,
		standard,
	} = options;

	const args: string[] = [];

	// -q (quiet) option is available since phpcs 2.6.2
	if (semver.gte(executableVersion, '2.6.2')) {
		args.push('-q');
	}

	// --encoding option is available since 1.3.0
	if (semver.gte(executableVersion, '1.3.0')) {
		args.push('--encoding=UTF-8');
	}

	// Add standard if specified
	if (standard) {
		args.push(`--standard=${standard}`);
	}

	// Add stdin-path for PHPCBF 2.6.0+
	if (filePath !== undefined && semver.gte(executableVersion, '2.6.0')) {
		args.push(`--stdin-path=${filePath}`);
	}

	// Read from stdin
	args.push('-');

	return args;
}

/**
 * Parse the result of a PHPCBF execution.
 * @param stdout The stdout from PHPCBF
 * @param stderr The stderr from PHPCBF
 * @param exitCode The exit code from PHPCBF
 * @param originalContent The original file content (for comparison)
 * @param isV4OrAbove Whether PHPCS/PHPCBF is version 4.0.0 or above
 * @returns The fix result
 */
export function parseFixResult(
	stdout: string,
	stderr: string,
	exitCode: number | null,
	originalContent: string,
	isV4OrAbove: boolean
): FixResult {
	// Check for processing errors (v4+)
	if (isV4OrAbove && exitCode === PhpcbfExitCode.ProcessingError) {
		return {
			fixed: false,
			content: originalContent,
			hasUnfixableIssues: false,
			error: 'PHPCBF encountered a processing error (exit code 16). Please check your ruleset configuration.',
		};
	}

	// Check for requirements not met (v4+)
	if (isV4OrAbove && exitCode === PhpcbfExitCode.RequirementsNotMet) {
		return {
			fixed: false,
			content: originalContent,
			hasUnfixableIssues: false,
			error: 'PHPCBF requirements not met (exit code 64). Please check your PHP version and installed extensions.',
		};
	}

	// Check for fatal errors in stderr
	const fatalError = extractPhpcbfFatalError(stderr);
	if (fatalError) {
		return {
			fixed: false,
			content: originalContent,
			hasUnfixableIssues: false,
			error: fatalError,
		};
	}

	// PHPCBF outputs the (potentially fixed) content to stdout.
	// We compare stdout with original content to detect if changes were made,
	// rather than relying solely on exit code (which can be inconsistent).
	const hasOutput = stdout.length > 0;
	const contentChanged = hasOutput && stdout !== originalContent;

	// Determine result based on exit code and content comparison
	switch (exitCode) {
		case PhpcbfExitCode.NoFixableErrors:
			// Exit code 0 typically means no fixable errors, but PHPCBF may still
			// output fixed content in some cases. Check if content actually changed.
			if (contentChanged) {
				return {
					fixed: true,
					content: stdout,
					hasUnfixableIssues: false,
				};
			}
			return {
				fixed: false,
				content: originalContent,
				hasUnfixableIssues: false,
			};

		case PhpcbfExitCode.AllFixed:
			// All fixable errors were fixed
			return {
				fixed: true,
				content: stdout,
				hasUnfixableIssues: false,
			};

		case PhpcbfExitCode.SomeUnfixable:
			// Some errors could not be fixed - check if any were actually fixed
			if (contentChanged) {
				return {
					fixed: true,
					content: stdout,
					hasUnfixableIssues: true,
				};
			}
			return {
				fixed: false,
				content: originalContent,
				hasUnfixableIssues: true,
			};

		case PhpcbfExitCode.FixedAndUnfixable:
			// Both fixed and unfixable errors
			return {
				fixed: true,
				content: stdout,
				hasUnfixableIssues: true,
			};

		default:
			// Unknown exit code - check if content changed anyway
			if (contentChanged) {
				return {
					fixed: true,
					content: stdout,
					hasUnfixableIssues: false,
				};
			}
			return {
				fixed: false,
				content: originalContent,
				hasUnfixableIssues: false,
				error: `PHPCBF returned unexpected exit code: ${exitCode}`,
			};
	}
}

/**
 * Check if STDERR content indicates a fatal error.
 * @param stderr The STDERR content
 * @returns The error message if fatal, null otherwise
 */
export function extractPhpcbfFatalError(stderr: string): string | null {
	if (!stderr || stderr.trim() === '') {
		return null;
	}

	// Check for fatal error pattern
	const fatalMatch = stderr.match(/^(?:PHP\s?)?FATAL\s?ERROR:\s?(.*)/im);
	if (fatalMatch) {
		let error = fatalMatch[1].trim();

		// Check for uncaught exception pattern
		const exceptionMatch = error.match(/^Uncaught exception '.*' with message '(.*)'/);
		if (exceptionMatch) {
			return exceptionMatch[1];
		}

		return error;
	}

	// Check for parse error (syntax error in PHP file)
	const parseMatch = stderr.match(/^(?:PHP\s?)?Parse error:\s?(.*)/im);
	if (parseMatch) {
		return `Parse error: ${parseMatch[1].trim()}`;
	}

	return null;
}

/**
 * Check if STDOUT contains an ERROR message from PHPCBF.
 * @param stdout The STDOUT content
 * @returns Error message or null if no error
 */
export function extractPhpcbfStdoutError(stdout: string): string | null {
	const match = stdout.match(/^ERROR:\s?(.*)/i);
	if (match) {
		return match[1].trim();
	}
	return null;
}
