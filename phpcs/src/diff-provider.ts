/* --------------------------------------------------------------------------------------------
 * Copyright (c) John R. D'Orazio. All rights reserved.
 * Licensed under the MIT License. See License.md in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
"use strict";

import {
	TextDocumentContentProvider,
	Uri,
	EventEmitter,
	Event,
	Disposable
} from "vscode";

/**
 * URI scheme for PHPCBF diff preview documents.
 */
export const PHPCBF_DIFF_SCHEME = 'phpcbf-preview';

/**
 * Virtual document content provider for PHPCBF diff previews.
 * Stores the fixed content in memory and provides it when VS Code requests it.
 */
export class PhpcbfDiffContentProvider implements TextDocumentContentProvider, Disposable {
	private contentMap: Map<string, string> = new Map();
	private _onDidChange = new EventEmitter<Uri>();

	/**
	 * Event fired when document content changes.
	 */
	public readonly onDidChange: Event<Uri> = this._onDidChange.event;

	/**
	 * Set the fixed content for a document.
	 * @param originalUri The original document URI
	 * @param content The fixed content
	 * @returns The URI to use for the diff preview
	 */
	public setContent(originalUri: string, content: string): Uri {
		const previewUri = this.createPreviewUri(originalUri);
		this.contentMap.set(previewUri.toString(), content);
		this._onDidChange.fire(previewUri);
		return previewUri;
	}

	/**
	 * Provide the content for a virtual document.
	 * @param uri The URI of the virtual document
	 * @returns The content of the virtual document
	 */
	public provideTextDocumentContent(uri: Uri): string {
		return this.contentMap.get(uri.toString()) || '';
	}

	/**
	 * Clear the content for a document.
	 * @param originalUri The original document URI
	 */
	public clearContent(originalUri: string): void {
		const previewUri = this.createPreviewUri(originalUri);
		this.contentMap.delete(previewUri.toString());
	}

	/**
	 * Create a preview URI from an original document URI.
	 * @param originalUri The original document URI
	 * @returns The preview URI
	 */
	private createPreviewUri(originalUri: string): Uri {
		// Encode the original URI as the path of the preview URI
		return Uri.parse(`${PHPCBF_DIFF_SCHEME}:${encodeURIComponent(originalUri)}`);
	}

	/**
	 * Dispose of resources.
	 */
	public dispose(): void {
		this._onDidChange.dispose();
		this.contentMap.clear();
	}
}
