/* --------------------------------------------------------------------------------------------
 * Copyright (c) John R. D'Orazio. All rights reserved.
 * Licensed under the MIT License. See License.md in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import { Diagnostic } from 'vscode-languageserver/node';
import { DiffHunk, isLineInHunkRange } from './diff-utils';

/**
 * Confidence level for a hunk-to-diagnostic correlation.
 * - high: Single diagnostic maps to the hunk
 * - medium: Multiple diagnostics map to the same hunk
 * - low: Hunk has no matching diagnostics (side-effect of another fix)
 */
export type CorrelationConfidence = 'high' | 'medium' | 'low';

/**
 * Represents a correlation between a diff hunk and the diagnostics it likely fixes.
 */
export interface HunkCorrelation {
	/** The diff hunk */
	hunk: DiffHunk;
	/** Diagnostics whose line falls within this hunk's range */
	diagnostics: Diagnostic[];
	/** Confidence level of the correlation */
	confidence: CorrelationConfidence;
}

/**
 * Check if a diagnostic is likely fixed by a hunk based on line number.
 * For pure insertions (like adding blank lines), we also check if the diagnostic
 * is on the line immediately before or after the insertion point.
 * @param hunk The diff hunk
 * @param diagnostic The diagnostic to check
 * @returns True if the diagnostic's line falls within or is adjacent to the hunk's range
 */
export function isDiagnosticInHunk(hunk: DiffHunk, diagnostic: Diagnostic): boolean {
	// Diagnostics use 0-indexed line numbers
	const diagnosticLine = diagnostic.range.start.line;

	// For regular hunks (with deletions/modifications), use standard range check
	if (hunk.originalLength > 0) {
		return isLineInHunkRange(hunk, diagnosticLine);
	}

	// For pure insertions (originalLength === 0):
	// The diagnostic might be on the line before or at the insertion point.
	// E.g., "missing blank line" at line 9 -> insertion at line 10
	// Or "missing opening tag" at line 0 -> insertion at line 0
	const insertionPoint = hunk.originalStart;
	return diagnosticLine === insertionPoint || diagnosticLine === insertionPoint - 1;
}

/**
 * Correlate diagnostics to diff hunks.
 * Maps each hunk to the diagnostics that fall within its line range.
 *
 * @param hunks Array of diff hunks
 * @param diagnostics Array of diagnostics from PHPCS
 * @returns Array of hunk correlations with confidence levels
 */
export function correlateDiagnosticsToHunks(
	hunks: DiffHunk[],
	diagnostics: Diagnostic[]
): HunkCorrelation[] {
	const correlations: HunkCorrelation[] = [];

	for (const hunk of hunks) {
		const matchingDiagnostics = diagnostics.filter(d => isDiagnosticInHunk(hunk, d));

		let confidence: CorrelationConfidence;
		if (matchingDiagnostics.length === 0) {
			confidence = 'low';
		} else if (matchingDiagnostics.length === 1) {
			confidence = 'high';
		} else {
			confidence = 'medium';
		}

		correlations.push({
			hunk,
			diagnostics: matchingDiagnostics,
			confidence
		});
	}

	return correlations;
}

/**
 * Find hunks that are correlated with a specific diagnostic.
 *
 * @param correlations Array of hunk correlations
 * @param diagnostic The diagnostic to find hunks for
 * @returns Array of hunks that contain the diagnostic in their range
 */
export function findHunksForDiagnostic(
	correlations: HunkCorrelation[],
	diagnostic: Diagnostic
): DiffHunk[] {
	const result: DiffHunk[] = [];

	for (const correlation of correlations) {
		// Check if this correlation contains the target diagnostic
		const containsDiagnostic = correlation.diagnostics.some(
			d => diagnosticsMatch(d, diagnostic)
		);
		if (containsDiagnostic) {
			result.push(correlation.hunk);
		}
	}

	return result;
}

/**
 * Check if two diagnostics match (same location and message).
 * @param a First diagnostic
 * @param b Second diagnostic
 * @returns True if diagnostics match
 */
function diagnosticsMatch(a: Diagnostic, b: Diagnostic): boolean {
	return (
		a.range.start.line === b.range.start.line &&
		a.range.start.character === b.range.start.character &&
		a.range.end.line === b.range.end.line &&
		a.range.end.character === b.range.end.character &&
		a.message === b.message
	);
}

/**
 * Get all diagnostics that will be affected by applying a set of hunks.
 * Useful for showing users which issues will be fixed together.
 *
 * @param correlations Array of hunk correlations
 * @param hunksToApply Hunks that will be applied
 * @returns All diagnostics that will be fixed by these hunks
 */
export function getDiagnosticsForHunks(
	correlations: HunkCorrelation[],
	hunksToApply: DiffHunk[]
): Diagnostic[] {
	const result: Diagnostic[] = [];
	const seen = new Set<string>();

	for (const correlation of correlations) {
		const hunkMatches = hunksToApply.some(h =>
			h.originalStart === correlation.hunk.originalStart &&
			h.originalLength === correlation.hunk.originalLength
		);

		if (hunkMatches) {
			for (const diagnostic of correlation.diagnostics) {
				// Create unique key to avoid duplicates
				const key = `${diagnostic.range.start.line}:${diagnostic.range.start.character}:${diagnostic.message}`;
				if (!seen.has(key)) {
					seen.add(key);
					result.push(diagnostic);
				}
			}
		}
	}

	return result;
}

/**
 * Check if applying a hunk might affect other unrelated lines.
 * This is useful for detecting potential interdependent fixes.
 *
 * @param hunk The hunk to check
 * @param allCorrelations All correlations in the document
 * @returns True if the hunk has low confidence (no matching diagnostics)
 */
export function isHunkASideEffect(
	hunk: DiffHunk,
	allCorrelations: HunkCorrelation[]
): boolean {
	const correlation = allCorrelations.find(
		c => c.hunk.originalStart === hunk.originalStart &&
			 c.hunk.originalLength === hunk.originalLength
	);
	return correlation?.confidence === 'low';
}
