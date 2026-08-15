/* --------------------------------------------------------------------------------------------
 * Copyright (c) Ioannis Kappas. All rights reserved.
 * Licensed under the MIT License. See License.md in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
"use strict";

import * as path from 'path';
import * as fs from 'fs';

import { PhpcsPathResolverBase } from './path-resolver-base';

export class GlobalPhpcsPathResolver extends PhpcsPathResolverBase {
	async resolve(): Promise<string | null> {
		let resolvedPath: string | null = null;
		let pathSeparator = /^win/.test(process.platform) ? ";" : ":";
		// PATH is not guaranteed to be set, and splitting undefined threw before
		// the caller could report that phpcs simply was not found. Empty entries
		// are dropped too: joining one produces a relative path, which would
		// resolve against the current working directory by accident.
		let globalPaths: string[] = (process.env.PATH ?? "").split(pathSeparator).filter(entry => entry.length > 0);
		globalPaths.some((globalPath: string) => {
			let testPath = path.join(globalPath, this.phpcsExecutableFile);
			if (fs.existsSync(testPath)) {
				resolvedPath = testPath;
				return true;
			}
			return false;
		});
		return resolvedPath;
	}
}
