/* --------------------------------------------------------------------------------------------
 * Copyright (c) Ioannis Kappas. All rights reserved.
 * Licensed under the MIT License. See License.md in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
"use strict";

import * as path from "path";

import {
	StatusBarAlignment,
	StatusBarItem,
	window,
	OutputChannel
} from "vscode";

import { Timer } from './timer';

export class PhpcsStatus {

	private statusBarItem: StatusBarItem;
	private documents: string[] = [];
	private processing: number = 0;
	private buffered: number = 0;
	private spinnerIndex = 0;
	private spinnerSequence: string[] = ["|", "/", "-", "\\"];
	private timer: Timer;
	private channel: OutputChannel;
	private standardStatusBarItem: StatusBarItem;
	private documentStandards: Map<string, string | null> = new Map();

	public constructor()
	{
		this.channel = window.createOutputChannel('PhpCS log');
	}

	public startProcessing(uri: string, buffered: number = 0) {
		this.channel.appendLine('> '+uri);
		this.documents.push(uri);
		this.processing += 1;
		this.buffered = buffered;
		this.getTimer().start();
		this.getStatusBarItem().show();
	}

	/**
	 * Records the end of a lint run for a document and refreshes the status bar.
	 *
	 * @param uri The uri of the document whose validation ended.
	 * @param buffered Number of documents remaining in the queue.
	 * @param standard The coding standard resolved for the run: a string or null
	 *                 is stored (null = phpcs default), while undefined (lint
	 *                 error) leaves the last known value unchanged.
	 */
	public endProcessing(uri: string, buffered: number = 0, standard?: string | null) {
		this.processing -= 1;
		this.buffered = buffered;
		let index = this.documents.indexOf(uri);
		if (index !== -1) {
			this.documents.splice(index, 1);
		}
		if (standard !== undefined) {
			this.documentStandards.set(uri, standard);
		}
		this.updateStandardStatusBar();
		if (this.processing === 0) {
			this.getTimer().stop();
			this.getStatusBarItem().hide();
			this.updateStatusText();
		}
	}

	/**
	 * Returns the last known resolved standard for a document uri.
	 * `undefined` when never linted, `null` when phpcs used its default.
	 */
	public getStandardForUri(uri: string): string | null | undefined {
		return this.documentStandards.get(uri);
	}

	/**
	 * Forgets the resolved standard for a closed document.
	 */
	public removeDocument(uri: string): void {
		this.documentStandards.delete(uri);
		this.updateStandardStatusBar();
	}

	/**
	 * Shows the resolved standard for the active PHP editor in the status bar,
	 * or hides the item when there is nothing to show.
	 */
	public updateStandardStatusBar(): void {
		const item = this.getStandardStatusBarItem();
		const editor = window.activeTextEditor;
		if (!editor || editor.document.languageId !== 'php') {
			item.hide();
			return;
		}
		const uri = editor.document.uri.toString();
		if (!this.documentStandards.has(uri)) {
			item.hide();
			return;
		}
		const standard = this.documentStandards.get(uri);
		if (standard === null || standard === undefined) {
			item.text = 'phpcs: default';
			item.tooltip = 'Using phpcs default standard';
		} else if (isPathLike(standard)) {
			item.text = `phpcs: ${path.basename(standard)}`;
			item.tooltip = standard;
		} else {
			item.text = `phpcs: ${standard}`;
			item.tooltip = `Standard: ${standard}`;
		}
		item.show();
	}

	private getStandardStatusBarItem(): StatusBarItem {
		// Create as needed
		if (!this.standardStatusBarItem) {
			this.standardStatusBarItem = window.createStatusBarItem(StatusBarAlignment.Left);
			this.standardStatusBarItem.name = 'PHPCS Standard';
			this.standardStatusBarItem.command = 'phpcs.openStandard';
		}
		return this.standardStatusBarItem;
	}

	private updateStatusText(): void {
		let statusBar = this.getStatusBarItem();
		let count = this.processing;
		if (count > 0) {
			let spinner = this.getNextSpinnerChar();
			statusBar.text =
				`$(eye) phpcs is linting ${count} document`
				+ ((count === 1) ? '' : 's')
				+ (this.buffered > 0 ? `(${this.buffered} in buffer)` : '')
				+ `${spinner}`;
		} else if (this.buffered > 0) {
			statusBar.text = `$(eye) phpcs keeps ${this.buffered} documents in buffer`;
		}
	}

	private getNextSpinnerChar(): string {
		let spinnerChar = this.spinnerSequence[this.spinnerIndex];
		this.spinnerIndex += 1;
		if (this.spinnerIndex > this.spinnerSequence.length - 1) {
			this.spinnerIndex = 0;
		}
		return spinnerChar;
	}

	private getTimer(): Timer {
		if (!this.timer) {
			this.timer = new Timer(() => {
				this.updateStatusText();
			});
			this.timer.interval = 100;
		}
		return this.timer;
	}

	private getStatusBarItem(): StatusBarItem {
		// Create as needed
		if (!this.statusBarItem) {
			this.statusBarItem = window.createStatusBarItem(StatusBarAlignment.Left);
		}
		return this.statusBarItem;
	}

	dispose() {
		if (this.standardStatusBarItem) {
			this.standardStatusBarItem.dispose();
		}
		if (this.statusBarItem) {
			this.statusBarItem.dispose();
		}
		if (this.timer) {
			this.timer.dispose();
		}
		if (this.channel) {
			this.channel.dispose();
		}
	}
}

/**
 * A standard containing a path separator is a config file path;
 * a bare name (e.g. PSR12) is a built-in standard. String check only —
 * no filesystem I/O in the render path.
 */
function isPathLike(standard: string): boolean {
	return standard.includes('/') || standard.includes('\\');
}
