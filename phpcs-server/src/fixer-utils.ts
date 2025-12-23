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
 * @see https://github.com/PHPCSStandards/PHP_CodeSniffer/wiki/Advanced-Usage#understanding-the-exit-codes
 *
 * Exit codes have different meanings in v3 vs v4:
 *
 * v3: 0=nothing to fix, 1=all fixed, 2=failed to fix some, 3=processing error
 * v4: 0=clean/fixed, 1=auto-fixable remain, 2=non-auto-fixable, 4=fix failure,
 *     16=processing error, 64=requirements not met (codes are cumulative/bitmask)
 *
 * Note: In v4+, the `ignore_non_auto_fixable_on_exit` config option can make
 * PHPCBF return exit code 0 even when non-fixable issues remain. We use content
 * comparison to detect actual changes regardless of exit code.
 */
export enum PhpcbfExitCode {
	/** v3: nothing to fix | v4: clean/all fixed with no issues remaining */
	NoErrorsOrFixed = 0,
	/** v3: all fixable errors fixed correctly | v4: auto-fixable issues remain */
	FixedOrFixableRemain = 1,
	/** v3: failed to fix some errors | v4: non-auto-fixable issues exist */
	FailedOrNonFixable = 2,
	/** v4 only: failure to fix some files/fixer conflict */
	FixFailure = 4,
	/** v4 only: processing error blocking the run */
	ProcessingError = 16,
	/** v4 only: requirements not met (e.g., minimum PHP version) */
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
	if (filePath && semver.gte(executableVersion, '2.6.0')) {
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

	// Determine result based on exit code and content comparison.
	// We rely on content comparison because exit codes have different meanings
	// in v3 vs v4, and v4 codes can be cumulative (bitmask).
	switch (exitCode) {
		case PhpcbfExitCode.NoErrorsOrFixed:
			// Exit code 0: v3=nothing to fix, v4=clean/all fixed.
			// In v4+ with ignore_non_auto_fixable_on_exit config, this can also
			// mean non-fixable issues remain. Use content comparison to be safe.
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

		case PhpcbfExitCode.FixedOrFixableRemain:
			// Exit code 1: v3=all fixed correctly, v4=auto-fixable issues remain.
			// Use content comparison to determine if fixes were actually applied.
			return {
				fixed: contentChanged,
				content: contentChanged ? stdout : originalContent,
				hasUnfixableIssues: false,
			};

		case PhpcbfExitCode.FailedOrNonFixable:
			// Exit code 2: v3=failed to fix some, v4=non-auto-fixable issues exist.
			// Check if any fixes were actually applied.
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

		case PhpcbfExitCode.FixFailure:
			// Exit code 4 (v4 only): failure to fix some files/fixer conflict.
			// Some fixes may have been applied before the failure.
			if (contentChanged) {
				return {
					fixed: true,
					content: stdout,
					hasUnfixableIssues: true,
					error: 'PHPCBF failed to fix some files or encountered fixer conflicts.',
				};
			}
			return {
				fixed: false,
				content: originalContent,
				hasUnfixableIssues: false,
				error: 'PHPCBF failed to fix files or encountered fixer conflicts.',
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
