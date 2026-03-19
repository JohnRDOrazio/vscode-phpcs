/* --------------------------------------------------------------------------------------------
 * Copyright (c) Ioannis Kappas. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
"use strict";

export class StringResources {

	static readonly DidStartValidateTextDocument: string = 'Linting started on: {0}';
	static readonly IgnoredClosedTextDocument: string = 'Linting ignored on: {0}';
	static readonly DidEndValidateTextDocument: string = 'Linting completed on: {0}';

	static readonly ComposerDependencyNotFoundError: string = 'Composer phpcs dependency is configured but was not found under {0}. You may need to run "composer install" or set your phpcs.executablePath manually.';
	static readonly UnableToLocatePhpcsError: string = 'Unable to locate phpcs. Please add phpcs to your global path or use composer dependency manager to install it in your project locally.';
	static readonly InvalidVersionStringError: string = 'Invalid version string encountered!';
	static readonly UnknownErrorWhileValidatingTextDocument: string = 'An unknown error occurred while validating: {0}';

	static readonly CreateLinterErrorDefaultMessage: string = 'Please add phpcs to your global path or use composer dependency manager to install it in your project locally.';
	static readonly CreateLinterError: string = 'Unable to locate phpcs. {0}';

	static readonly CreateFixerErrorDefaultMessage: string = 'Please add phpcbf to your global path or use composer dependency manager to install it in your project locally.';
	static readonly CreateFixerError: string = 'Unable to locate phpcbf. {0}';
	static readonly PhpcbfOnSaveFailed: string = 'PHPCBF on save failed: {0}';
	static readonly PhpcbfTimeoutError: string = 'PHPCBF operation timed out after {0} seconds. Try increasing phpcs.phpcbfTimeout for large files.';
	static readonly PhpcbfFixingDocument: string = '[PHPCBF] Fixing document: {0}';
	static readonly PhpcbfFixApplied: string = '[PHPCBF] Fixed document: {0}';
	static readonly PhpcbfFixFailed: string = '[PHPCBF] Failed to apply edit to: {0}';
	static readonly PhpcbfNoFixesApplied: string = '[PHPCBF] No fixes applied to: {0}';
	static readonly PhpcbfUnfixableIssues: string = 'PHPCBF: Some issues could not be automatically fixed.';
	static readonly PhpcbfError: string = '[PHPCBF] Error: {0}';
	static readonly PhpcbfErrorMessage: string = 'PHPCBF: {0}';
	static readonly PhpcbfDiffCancelled: string = '[PHPCBF] User cancelled fix for: {0}';
	static readonly PhpcbfExecutableNotFound: string = 'PHPCBF executable not found. Please set phpcs.phpcbfExecutablePath or ensure phpcbf is alongside phpcs.';
	static readonly PhpcbfNoFixesAvailable: string = 'No fixes available. The issue may have already been fixed or is not auto-fixable.';
	static readonly PhpcbfCannotIsolateFix: string = 'Could not isolate this specific fix. The fix may depend on other changes. Use "Fix all" to apply all fixes.';
	static readonly PhpcbfCannotApplyFix: string = 'Cannot apply fix: {0}';

	static readonly UnknownExecutionError: string = 'Unknown error ocurred. Please verify that {0} returns a valid json object.';
	static readonly CodingStandardNotInstalledError: string = 'The "{0}" coding standard is not installed. Please review your configuration an try again.';
	static readonly InvalidJsonStringError: string = 'The phpcs report contains invalid json. Please review "Diagnosing Common Errors" in the plugin README.';
	static readonly InvalidJsonStringErrorWithPreview: string = 'The phpcs report contains invalid json. Raw output preview ({0} chars total):\n{1}';

	// PHPCS v4 specific error messages
	static readonly ProcessingError: string = 'PHPCS encountered a processing error (exit code 16). Please check your ruleset configuration.';
	static readonly RequirementsNotMetError: string = 'PHPCS requirements not met (exit code 64). Please check your PHP version and installed extensions.';

	static readonly Empty: string = '';
	static readonly Space: string = ' ';

}
