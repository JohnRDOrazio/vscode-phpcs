/* --------------------------------------------------------------------------------------------
 * Copyright (c) Ioannis Kappas. All rights reserved.
 * Licensed under the MIT License. See License.md in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
"use strict";

import {
	NotificationType,
	RequestType,
	TextDocumentIdentifier
} from "vscode-languageserver/node";

/**
 * The parameters send in a did start validate text document notification
 */
export interface DidStartValidateTextDocumentParams {
	/**
	 * The document on which validation started.
	 */
	textDocument: TextDocumentIdentifier;
	/**
	 * Number of documents in queue
	 */
	buffered: number;
}

/**
 * The document start validation notification is sent from the server to the client to signal
 * the start of the validation on text documents.
 */
export namespace DidStartValidateTextDocumentNotification {
	export const type = new NotificationType<DidStartValidateTextDocumentParams>("textDocument/didStartValidate");
}

/**
 * The parameters send in a did end validate text document notification
 */
export interface DidEndValidateTextDocumentParams {
	/**
	 * The document on which validation ended.
	 */
	textDocument: TextDocumentIdentifier;
	/**
	 * Number of documents in queue
	 */
	buffered: number;
}

/**
 * The document end validation notification is sent from the server to the client to signal
 * the end of the validation on text documents.
 */
export namespace DidEndValidateTextDocumentNotification {
	export const type = new NotificationType<DidEndValidateTextDocumentParams>("textDocument/didEndValidate");
}

/**
 * The parameters sent in a did start fix text document notification
 */
export interface DidStartFixTextDocumentParams {
	/**
	 * The document on which fixing started.
	 */
	textDocument: TextDocumentIdentifier;
}

/**
 * The document start fix notification is sent from the server to the client to signal
 * the start of PHPCBF fixing on a text document.
 */
export namespace DidStartFixTextDocumentNotification {
	export const type = new NotificationType<DidStartFixTextDocumentParams>("textDocument/didStartFix");
}

/**
 * The parameters sent in a did end fix text document notification
 */
export interface DidEndFixTextDocumentParams {
	/**
	 * The document on which fixing ended.
	 */
	textDocument: TextDocumentIdentifier;
	/**
	 * Whether the document was successfully fixed.
	 */
	fixed: boolean;
	/**
	 * Error message if fixing failed.
	 */
	error?: string;
}

/**
 * The document end fix notification is sent from the server to the client to signal
 * the end of PHPCBF fixing on a text document.
 */
export namespace DidEndFixTextDocumentNotification {
	export const type = new NotificationType<DidEndFixTextDocumentParams>("textDocument/didEndFix");
}

/**
 * The parameters for the show diff preview request.
 */
export interface ShowDiffPreviewParams {
	/**
	 * The document URI.
	 */
	uri: string;
	/**
	 * The original content before fixes.
	 */
	originalContent: string;
	/**
	 * The fixed content after PHPCBF.
	 */
	fixedContent: string;
	/**
	 * Optional target line for positioning the CodeLens (0-indexed).
	 * If provided, the accept/reject CodeLens will be positioned near this line.
	 * If not provided, it will be at the top of the file.
	 */
	targetLine?: number;
}

/**
 * Request sent from the server to the client to show a diff preview.
 * The client should display the diff and return true if the user accepts the changes.
 */
export namespace ShowDiffPreviewRequest {
	export const type = new RequestType<ShowDiffPreviewParams, boolean, void>("phpcs/showDiffPreview");
}

/**
 * The parameters for the save document notification.
 */
export interface SaveDocumentParams {
	/**
	 * The document URI to save.
	 */
	uri: string;
}

/**
 * Notification sent from the server to the client to request saving a document.
 * The client should save the document if the phpcbfSaveOnFix setting is enabled.
 */
export namespace SaveDocumentNotification {
	export const type = new NotificationType<SaveDocumentParams>("phpcs/saveDocument");
}
