/* --------------------------------------------------------------------------------------------
 * Copyright (c) Ioannis Kappas. All rights reserved.
 * Licensed under the MIT License. See License.md in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
"use strict";

export abstract class PhpcsPathResolverBase {
	protected phpcsExecutableFile: string;

	constructor() {
		let extension = /^win/.test(process.platform) ? ".bat" : "";
		this.phpcsExecutableFile = `phpcs${extension}`;
	}

	// Nullable because "not found here" is a normal outcome for an individual
	// resolver — PhpcsPathResolver tries each in turn and only raises when they
	// have all come up empty. Declaring `string` made every implementation
	// silently return null through a type that promised otherwise.
	abstract resolve(): Promise<string | null>;
}
