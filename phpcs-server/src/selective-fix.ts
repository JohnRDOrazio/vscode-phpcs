/* --------------------------------------------------------------------------------------------
 * Copyright (c) John R. D'Orazio. All rights reserved.
 * Licensed under the MIT License. See License.md in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import { DiffHunk } from './diff-utils';

/**
 * Sort hunks by their original start line in descending order.
 * This is crucial for applying hunks from bottom to top to avoid line number shifting.
 *
 * @param hunks Array of hunks to sort
 * @returns New sorted array (does not modify original)
 */
export function sortHunksDescending(hunks: DiffHunk[]): DiffHunk[] {
	return [...hunks].sort((a, b) => b.originalStart - a.originalStart);
}

/**
 * Apply selected hunks to the original content.
 * Hunks are applied from bottom to top to prevent line number shifting issues.
 *
 * @param originalContent The original file content
 * @param hunks Array of hunks to apply
 * @returns The content with selected hunks applied
 */
export function applyHunks(originalContent: string, hunks: DiffHunk[]): string {
	if (hunks.length === 0) {
		return originalContent;
	}

	const lines = originalContent.split('\n');

	// Sort hunks descending by original start line
	// This ensures we apply from bottom to top, avoiding line number shifts
	const sortedHunks = sortHunksDescending(hunks);

	for (const hunk of sortedHunks) {
		// Replace the original lines with the modified lines
		// splice(start, deleteCount, ...items)
		lines.splice(
			hunk.originalStart,
			hunk.originalLength,
			...hunk.modifiedLines
		);
	}

	return lines.join('\n');
}

/**
 * Check if two hunks overlap in the original content.
 * Overlapping hunks cannot be applied independently.
 *
 * @param a First hunk
 * @param b Second hunk
 * @returns True if hunks overlap
 */
export function hunksOverlap(a: DiffHunk, b: DiffHunk): boolean {
	const aEnd = a.originalStart + a.originalLength;
	const bEnd = b.originalStart + b.originalLength;

	// Handle pure insertions (length 0)
	if (a.originalLength === 0 && b.originalLength === 0) {
		// Two insertions at the same point overlap
		return a.originalStart === b.originalStart;
	}

	if (a.originalLength === 0) {
		// a is pure insertion, check if it's within b's range
		return a.originalStart >= b.originalStart && a.originalStart < bEnd;
	}

	if (b.originalLength === 0) {
		// b is pure insertion, check if it's within a's range
		return b.originalStart >= a.originalStart && b.originalStart < aEnd;
	}

	// Standard overlap check
	return !(aEnd <= b.originalStart || bEnd <= a.originalStart);
}

/**
 * Check if a set of hunks can be applied independently without conflicts.
 *
 * @param hunks Array of hunks to check
 * @returns True if all hunks are non-overlapping
 */
export function areHunksIndependent(hunks: DiffHunk[]): boolean {
	for (let i = 0; i < hunks.length; i++) {
		for (let j = i + 1; j < hunks.length; j++) {
			if (hunksOverlap(hunks[i], hunks[j])) {
				return false;
			}
		}
	}
	return true;
}

/**
 * Calculate the line offset caused by applying a hunk.
 * Positive means lines shift down, negative means lines shift up.
 *
 * @param hunk The hunk to calculate offset for
 * @returns The line offset
 */
export function calculateLineOffset(hunk: DiffHunk): number {
	return hunk.modifiedLength - hunk.originalLength;
}

/**
 * Calculate the total line offset for a set of hunks.
 *
 * @param hunks Array of hunks
 * @returns Total line offset
 */
export function calculateTotalLineOffset(hunks: DiffHunk[]): number {
	return hunks.reduce((sum, hunk) => sum + calculateLineOffset(hunk), 0);
}

/**
 * Validate that hunks can be safely applied.
 *
 * @param originalContent The original content
 * @param hunks Hunks to validate
 * @returns Object with valid flag and optional error message
 */
export function validateHunks(
	originalContent: string,
	hunks: DiffHunk[]
): { valid: boolean; error?: string } {
	if (hunks.length === 0) {
		return { valid: true };
	}

	const lines = originalContent.split('\n');
	const lineCount = lines.length;

	for (const hunk of hunks) {
		// Check if hunk start is within bounds
		if (hunk.originalStart < 0 || hunk.originalStart > lineCount) {
			return {
				valid: false,
				error: `Hunk start ${hunk.originalStart} is out of bounds (0-${lineCount})`
			};
		}

		// Check if hunk end is within bounds
		const hunkEnd = hunk.originalStart + hunk.originalLength;
		if (hunkEnd > lineCount) {
			return {
				valid: false,
				error: `Hunk end ${hunkEnd} exceeds line count ${lineCount}`
			};
		}

		// Verify original lines match (if we have them)
		if (hunk.originalLines.length > 0 && hunk.originalLength > 0) {
			for (let i = 0; i < hunk.originalLength; i++) {
				const lineIndex = hunk.originalStart + i;
				if (lines[lineIndex] !== hunk.originalLines[i]) {
					return {
						valid: false,
						error: `Line ${lineIndex} content mismatch: expected "${hunk.originalLines[i]}" but found "${lines[lineIndex]}"`
					};
				}
			}
		}
	}

	// Check for overlapping hunks
	if (!areHunksIndependent(hunks)) {
		return {
			valid: false,
			error: 'Hunks overlap and cannot be applied independently'
		};
	}

	return { valid: true };
}
