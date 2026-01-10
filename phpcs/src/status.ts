/* --------------------------------------------------------------------------------------------
 * Copyright (c) Ioannis Kappas. All rights reserved.
 * Licensed under the MIT License. See License.md in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
"use strict";

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
	private fixingDocuments: string[] = [];
	private fixing: number = 0;
	private spinnerIndex = 0;
	private spinnerSequence: string[] = ["|", "/", "-", "\\"];
	private timer: Timer;
	private channel: OutputChannel;

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

	public endProcessing(uri: string, buffered: number = 0) {
		this.processing -= 1;
		this.buffered = buffered;
		let index = this.documents.indexOf(uri);
		if (index !== -1) {
			this.documents.splice(index, 1);
		}
		if (this.processing === 0 && this.fixing === 0) {
			this.getTimer().stop();
			this.getStatusBarItem().hide();
			this.updateStatusText();
		}
	}

	public startFixing(uri: string): void {
		this.channel.appendLine('[PHPCBF] > ' + uri);
		this.fixingDocuments.push(uri);
		this.fixing += 1;
		this.getTimer().start();
		this.getStatusBarItem().show();
	}

	public endFixing(uri: string, fixed: boolean): void {
		this.fixing -= 1;
		const index = this.fixingDocuments.indexOf(uri);
		if (index !== -1) {
			this.fixingDocuments.splice(index, 1);
		}
		if (fixed) {
			this.channel.appendLine('[PHPCBF] Fixed: ' + uri);
		}
		if (this.fixing === 0 && this.processing === 0) {
			this.getTimer().stop();
			this.getStatusBarItem().hide();
		}
		this.updateStatusText();
	}

	private updateStatusText(): void {
		let statusBar = this.getStatusBarItem();

		// Prioritize showing fixing status if PHPCBF is running
		if (this.fixing > 0) {
			let spinner = this.getNextSpinnerChar();
			statusBar.text =
				`$(wrench) PHPCBF fixing ${this.fixing} file`
				+ ((this.fixing === 1) ? '' : 's')
				+ ` ${spinner}`;
			return;
		}

		let count = this.processing;
		if (count > 0) {
			let spinner = this.getNextSpinnerChar();
			statusBar.text =
				`$(eye) phpcs is linting ${count} document`
				+ ((count === 1) ? '' : 's')
				+ (this.buffered > 0 ? ` (${this.buffered} in buffer)` : '')
				+ ` ${spinner}`;
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
