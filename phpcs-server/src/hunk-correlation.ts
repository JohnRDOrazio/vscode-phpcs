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
 * Maximum number of lines between a diagnostic and a pure deletion hunk
 * for them to be considered related. Kept small to avoid false matches.
 */
const MAX_DELETION_PROXIMITY = 2;

/**
 * Maximum number of lines for header-related fixes (diagnostic at line 0).
 * Only matches hunks very close to the start of the file.
 */
const MAX_HEADER_PROXIMITY = 3;

/**
 * Check if a diagnostic is likely fixed by a hunk based on line number.
 * Handles several cases:
 * - Standard: diagnostic line falls within hunk's deletion range
 * - Pure insertions: diagnostic is at or before the insertion point
 * - Pure deletions (lenient only): diagnostic is near (within proximity) of the deletion
 * - Header fixes (lenient only): diagnostic at line 0 correlates with nearby hunk
 *
 * @param hunk The diff hunk
 * @param diagnostic The diagnostic to check
 * @param strict If true, only use direct line matching (for single-issue fixes)
 * @returns True if the diagnostic is likely fixed by this hunk
 */
export function isDiagnosticInHunk(hunk: DiffHunk, diagnostic: Diagnostic, strict: boolean = false): boolean {
	// Diagnostics use 0-indexed line numbers
	const diagnosticLine = diagnostic.range.start.line;

	// Standard case: diagnostic falls within hunk's deletion range
	if (hunk.originalLength > 0 && isLineInHunkRange(hunk, diagnosticLine)) {
		return true;
	}

	// For pure insertions (originalLength === 0):
	// The diagnostic might be on the line before or at the insertion point.
	// E.g., "missing blank line" at line 9 -> insertion at line 10
	if (hunk.originalLength === 0) {
		const insertionPoint = hunk.originalStart;
		if (diagnosticLine === insertionPoint || diagnosticLine === insertionPoint - 1) {
			return true;
		}
	}

	// In strict mode, don't use proximity-based matching
	// This prevents single-issue fixes from matching unrelated hunks
	if (strict) {
		return false;
	}

	// For pure deletions (removing blank lines) or spacing fixes:
	// PHPCS often reports errors at block starts but the fix is applied
	// to a nearby blank line. Only match if diagnostic is very close.
	if (hunk.modifiedLength === 0 && hunk.originalLength > 0) {
		// Pure deletion - check if diagnostic is immediately before the hunk
		const hunkStart = hunk.originalStart;
		const linesBefore = hunkStart - diagnosticLine;
		if (linesBefore >= 0 && linesBefore <= MAX_DELETION_PROXIMITY) {
			return true;
		}
	}

	// Header-related fixes: diagnostic at line 0 correlates with
	// fixes at the very start of the file only
	if (diagnosticLine === 0 && hunk.originalStart <= MAX_HEADER_PROXIMITY) {
		return true;
	}

	return false;
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
 * Uses strict matching by default to only return hunks directly related to the diagnostic.
 *
 * @param correlations Array of hunk correlations
 * @param diagnostic The diagnostic to find hunks for
 * @param useStrictMatching If true (default), use strict matching to avoid false positives
 * @returns Array of hunks that contain the diagnostic in their range
 */
export function findHunksForDiagnostic(
	correlations: HunkCorrelation[],
	diagnostic: Diagnostic,
	useStrictMatching: boolean = true
): DiffHunk[] {
	const result: DiffHunk[] = [];

	for (const correlation of correlations) {
		// Always use isDiagnosticInHunk directly for accurate matching
		// Don't rely on pre-computed correlations which may be too broad
		const containsDiagnostic = isDiagnosticInHunk(correlation.hunk, diagnostic, useStrictMatching);

		if (containsDiagnostic) {
			result.push(correlation.hunk);
		}
	}

	return result;
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
