/* --------------------------------------------------------------------------------------------
 * Copyright (c) John R. D'Orazio. All rights reserved.
 * Licensed under the MIT License. See License.md in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

/**
 * Represents a contiguous change region (hunk) in a diff.
 */
export interface DiffHunk {
	/** 0-indexed line number where this hunk starts in the original content */
	originalStart: number;
	/** Number of lines removed from original */
	originalLength: number;
	/** 0-indexed line number where this hunk starts in the modified content */
	modifiedStart: number;
	/** Number of lines added in modified */
	modifiedLength: number;
	/** Lines removed from original */
	originalLines: string[];
	/** Lines added in modified */
	modifiedLines: string[];
}

/**
 * Internal representation of a single line change used during diff computation.
 */
interface LineOp {
	type: 'equal' | 'delete' | 'insert';
	originalIndex: number;
	modifiedIndex: number;
	line: string;
}

/**
 * Compute Longest Common Subsequence of two line arrays.
 * @param a First array of lines
 * @param b Second array of lines
 * @returns Array of common lines in order
 */
function computeLCS(a: string[], b: string[]): string[] {
	const m = a.length;
	const n = b.length;

	// Build LCS length table
	const dp: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

	for (let i = 1; i <= m; i++) {
		for (let j = 1; j <= n; j++) {
			if (a[i - 1] === b[j - 1]) {
				dp[i][j] = dp[i - 1][j - 1] + 1;
			} else {
				dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
			}
		}
	}

	// Backtrack to find LCS
	const lcs: string[] = [];
	let i = m, j = n;
	while (i > 0 && j > 0) {
		if (a[i - 1] === b[j - 1]) {
			lcs.unshift(a[i - 1]);
			i--;
			j--;
		} else if (dp[i - 1][j] > dp[i][j - 1]) {
			i--;
		} else {
			j--;
		}
	}

	return lcs;
}

/**
 * Compute line-by-line operations between original and modified content.
 * @param originalLines Lines from original content
 * @param modifiedLines Lines from modified content
 * @returns Array of line operations
 */
function computeLineOps(originalLines: string[], modifiedLines: string[]): LineOp[] {
	const lcs = computeLCS(originalLines, modifiedLines);
	const ops: LineOp[] = [];

	let origIdx = 0;
	let modIdx = 0;
	let lcsIdx = 0;

	while (origIdx < originalLines.length || modIdx < modifiedLines.length) {
		if (lcsIdx < lcs.length &&
			origIdx < originalLines.length &&
			modIdx < modifiedLines.length &&
			originalLines[origIdx] === lcs[lcsIdx] &&
			modifiedLines[modIdx] === lcs[lcsIdx]) {
			// Lines match - equal
			ops.push({
				type: 'equal',
				originalIndex: origIdx,
				modifiedIndex: modIdx,
				line: originalLines[origIdx]
			});
			origIdx++;
			modIdx++;
			lcsIdx++;
		} else if (modIdx < modifiedLines.length &&
				   (lcsIdx >= lcs.length || modifiedLines[modIdx] !== lcs[lcsIdx])) {
			// Line added in modified
			ops.push({
				type: 'insert',
				originalIndex: origIdx,
				modifiedIndex: modIdx,
				line: modifiedLines[modIdx]
			});
			modIdx++;
		} else if (origIdx < originalLines.length &&
				   (lcsIdx >= lcs.length || originalLines[origIdx] !== lcs[lcsIdx])) {
			// Line deleted from original
			ops.push({
				type: 'delete',
				originalIndex: origIdx,
				modifiedIndex: modIdx,
				line: originalLines[origIdx]
			});
			origIdx++;
		}
	}

	return ops;
}

/**
 * Group consecutive non-equal operations into hunks.
 * @param ops Array of line operations
 * @returns Array of diff hunks
 */
function groupIntoHunks(ops: LineOp[]): DiffHunk[] {
	const hunks: DiffHunk[] = [];
	let currentHunk: DiffHunk | null = null;

	for (const op of ops) {
		if (op.type === 'equal') {
			// End current hunk if any
			if (currentHunk) {
				hunks.push(currentHunk);
				currentHunk = null;
			}
		} else {
			// Start new hunk if needed
			if (!currentHunk) {
				currentHunk = {
					originalStart: op.originalIndex,
					originalLength: 0,
					modifiedStart: op.modifiedIndex,
					modifiedLength: 0,
					originalLines: [],
					modifiedLines: []
				};
			}

			if (op.type === 'delete') {
				currentHunk.originalLines.push(op.line);
				currentHunk.originalLength++;
			} else if (op.type === 'insert') {
				currentHunk.modifiedLines.push(op.line);
				currentHunk.modifiedLength++;
			}
		}
	}

	// Don't forget the last hunk
	if (currentHunk) {
		hunks.push(currentHunk);
	}

	return hunks;
}

/**
 * Compute diff hunks between original and modified content.
 * Groups consecutive changes into contiguous hunks.
 *
 * Note: Empty content is treated as a single empty line (length 1), not zero lines.
 * This matches JavaScript's `''.split('\n')` behavior which returns `['']`.
 * This is intentional as it allows proper diffing between empty and non-empty content.
 *
 * @param original Original content string
 * @param modified Modified content string
 * @returns Array of diff hunks representing changes
 */
export function computeDiffHunks(original: string, modified: string): DiffHunk[] {
	const originalLines = original.split('\n');
	const modifiedLines = modified.split('\n');

	const ops = computeLineOps(originalLines, modifiedLines);
	return groupIntoHunks(ops);
}

/**
 * Check if a line number falls within a hunk's affected range in the original content.
 * @param hunk The diff hunk
 * @param lineNumber 0-indexed line number to check
 * @returns True if the line is within the hunk's original range
 */
export function isLineInHunkRange(hunk: DiffHunk, lineNumber: number): boolean {
	// For pure insertions (originalLength === 0), the line must be at the insertion point
	if (hunk.originalLength === 0) {
		return lineNumber === hunk.originalStart;
	}
	// For deletions or modifications, check if line is in the affected range
	return lineNumber >= hunk.originalStart &&
		   lineNumber < hunk.originalStart + hunk.originalLength;
}

/**
 * Get the end line (exclusive) of a hunk in the original content.
 * @param hunk The diff hunk
 * @returns The line number after the last affected line
 */
export function getHunkOriginalEnd(hunk: DiffHunk): number {
	return hunk.originalStart + Math.max(hunk.originalLength, 1);
}
