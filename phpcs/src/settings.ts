/* --------------------------------------------------------------------------------------------
 * Copyright (c) Ioannis Kappas. All rights reserved.
 * Licensed under the MIT License. See License.md in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
"use strict";

export interface PhpcsSettings {
	enable: boolean;
	workspaceRoot: string | null;
	executablePath: string | null;
	// Not nullable: package.json declares this `type: "string"` with a default
	// of "composer.json", so it is always a string by the time it is read. The
	// wider type let a null reach path.isAbsolute() in the composer resolver,
	// which throws rather than reporting that phpcs could not be found.
	composerJsonPath: string;
	standard: string | null;
	autoConfigSearch: boolean;
	showSources: boolean;
	showWarnings: boolean;
	ignorePatterns: string[];
	ignoreSource: string[];
	warningSeverity: number;
	errorSeverity: number;
	lintOnType: boolean;
	lintOnSave: boolean;
	lintOnOpen: boolean;
	queueBuffer: number;
	lintOnlyOpened: boolean;
	// PHPCBF settings
	phpcbfEnable: boolean;
	phpcbfExecutablePath: string | null;
	phpcbfOnSave: boolean;
	phpcbfTimeout: number;
}
