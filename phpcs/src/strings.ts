/* --------------------------------------------------------------------------------------------
 * Copyright (c) John R. D'Orazio. All rights reserved.
 * Licensed under the MIT License. See License.md in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
"use strict";

/**
 * String resources for the PHPCS client extension.
 * Centralizing strings improves maintainability and enables future localization.
 */
export class StringResources {
	// Server startup
	static readonly FailedToStartServer: string = 'Failed to start PHPCS language server: {0}';

	// Fix current file command
	static readonly NoActiveEditor: string = 'No active editor. Open a PHP file to fix.';
	static readonly PhpcbfOnlyPhpFiles: string = 'PHPCBF can only fix PHP files.';
	static readonly FailedToSaveBeforeFix: string = 'Failed to save the file before fixing. Please save manually and try again.';
	static readonly PhpcbfFixingFile: string = 'PHPCBF: Fixing file...';
	static readonly PhpcbfError: string = 'PHPCBF error: {0}';

	// Fix workspace command
	static readonly NoWorkspaceFolder: string = 'No workspace folder open.';
	static readonly ConfirmFixWorkspace: string = 'This will run PHPCBF on all PHP files in the workspace. Continue?';
	static readonly ConfirmYes: string = 'Yes';
	static readonly ConfirmNo: string = 'No';
	static readonly NoPhpFilesFound: string = 'No PHP files found in the workspace.';
	static readonly PhpcbfFixingFiles: string = 'PHPCBF: Fixing files';
	static readonly PhpcbfCancelled: string = 'PHPCBF cancelled. Fixed {0} of {1} files.';
	static readonly PhpcbfFixedWithFailures: string = 'PHPCBF: Fixed {0} files, {1} failed.';
	static readonly PhpcbfFixedSuccess: string = 'PHPCBF: Successfully processed {0} files.';
}

/**
 * Formats a string by replacing placeholders ({0}, {1}, etc.) with provided arguments.
 *
 * @param template - The string template with placeholders
 * @param args - The values to substitute for placeholders
 * @returns The formatted string
 *
 * @example
 * format('Hello {0}!', 'World') // Returns 'Hello World!'
 * format('Fixed {0} of {1} files', 5, 10) // Returns 'Fixed 5 of 10 files'
 */
export function format(template: string, ...args: (string | number)[]): string {
	return template.replace(/{(\d+)}/g, (match, index) => {
		const argIndex = parseInt(index, 10);
		return argIndex < args.length ? String(args[argIndex]) : match;
	});
}
