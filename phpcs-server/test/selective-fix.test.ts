/*---------------------------------------------------------------------------------------------
 * Copyright (c) John R. D'Orazio. All rights reserved.
 * Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import * as assert from 'assert';
import { DiffHunk } from '../src/diff-utils';
import {
	applyHunks,
	sortHunksDescending,
	hunksOverlap,
	areHunksIndependent,
	calculateLineOffset,
	calculateTotalLineOffset,
	validateHunks
} from '../src/selective-fix';

suite('Selective Fix', () => {

	const createHunk = (
		originalStart: number,
		originalLength: number,
		modifiedLength: number,
		originalLines?: string[],
		modifiedLines?: string[]
	): DiffHunk => ({
		originalStart,
		originalLength,
		modifiedStart: originalStart,
		modifiedLength,
		originalLines: originalLines || Array(originalLength).fill('old'),
		modifiedLines: modifiedLines || Array(modifiedLength).fill('new')
	});

	suite('sortHunksDescending', () => {

		test('should sort hunks by originalStart in descending order', () => {
			const hunks = [
				createHunk(1, 1, 1),
				createHunk(5, 1, 1),
				createHunk(3, 1, 1)
			];
			const sorted = sortHunksDescending(hunks);

			assert.strictEqual(sorted[0].originalStart, 5);
			assert.strictEqual(sorted[1].originalStart, 3);
			assert.strictEqual(sorted[2].originalStart, 1);
		});

		test('should not modify original array', () => {
			const hunks = [
				createHunk(1, 1, 1),
				createHunk(5, 1, 1)
			];
			sortHunksDescending(hunks);

			assert.strictEqual(hunks[0].originalStart, 1);
			assert.strictEqual(hunks[1].originalStart, 5);
		});

		test('should handle empty array', () => {
			const sorted = sortHunksDescending([]);
			assert.strictEqual(sorted.length, 0);
		});

	});

	suite('applyHunks', () => {

		test('should return original content for empty hunks', () => {
			const content = 'line1\nline2\nline3';
			const result = applyHunks(content, []);
			assert.strictEqual(result, content);
		});

		test('should apply single line replacement', () => {
			const content = 'line1\nline2\nline3';
			const hunk = createHunk(1, 1, 1, ['line2'], ['modified']);
			const result = applyHunks(content, [hunk]);
			assert.strictEqual(result, 'line1\nmodified\nline3');
		});

		test('should apply single line deletion', () => {
			const content = 'line1\nline2\nline3';
			const hunk = createHunk(1, 1, 0, ['line2'], []);
			const result = applyHunks(content, [hunk]);
			assert.strictEqual(result, 'line1\nline3');
		});

		test('should apply single line insertion', () => {
			const content = 'line1\nline3';
			const hunk = createHunk(1, 0, 1, [], ['line2']);
			const result = applyHunks(content, [hunk]);
			assert.strictEqual(result, 'line1\nline2\nline3');
		});

		test('should apply multiple independent hunks', () => {
			const content = 'line1\nline2\nline3\nline4\nline5';
			const hunks = [
				createHunk(1, 1, 1, ['line2'], ['modified2']),
				createHunk(3, 1, 1, ['line4'], ['modified4'])
			];
			const result = applyHunks(content, hunks);
			assert.strictEqual(result, 'line1\nmodified2\nline3\nmodified4\nline5');
		});

		test('should handle hunks in any order (sorts internally)', () => {
			const content = 'line1\nline2\nline3\nline4\nline5';
			const hunks = [
				createHunk(3, 1, 1, ['line4'], ['modified4']),
				createHunk(1, 1, 1, ['line2'], ['modified2'])
			];
			const result = applyHunks(content, hunks);
			assert.strictEqual(result, 'line1\nmodified2\nline3\nmodified4\nline5');
		});

		test('should handle multi-line replacement', () => {
			const content = 'line1\nold1\nold2\nline4';
			const hunk = createHunk(1, 2, 3, ['old1', 'old2'], ['new1', 'new2', 'new3']);
			const result = applyHunks(content, [hunk]);
			assert.strictEqual(result, 'line1\nnew1\nnew2\nnew3\nline4');
		});

		test('should handle change at start of file', () => {
			const content = 'line1\nline2\nline3';
			const hunk = createHunk(0, 1, 1, ['line1'], ['modified1']);
			const result = applyHunks(content, [hunk]);
			assert.strictEqual(result, 'modified1\nline2\nline3');
		});

		test('should handle change at end of file', () => {
			const content = 'line1\nline2\nline3';
			const hunk = createHunk(2, 1, 1, ['line3'], ['modified3']);
			const result = applyHunks(content, [hunk]);
			assert.strictEqual(result, 'line1\nline2\nmodified3');
		});

	});

	suite('hunksOverlap', () => {

		test('should return false for non-overlapping hunks', () => {
			const a = createHunk(1, 2, 2);
			const b = createHunk(5, 2, 2);
			assert.strictEqual(hunksOverlap(a, b), false);
		});

		test('should return true for overlapping hunks', () => {
			const a = createHunk(1, 3, 3);
			const b = createHunk(2, 3, 3);
			assert.strictEqual(hunksOverlap(a, b), true);
		});

		test('should return false for adjacent hunks', () => {
			const a = createHunk(1, 2, 2);
			const b = createHunk(3, 2, 2);
			assert.strictEqual(hunksOverlap(a, b), false);
		});

		test('should handle pure insertions at same point', () => {
			const a = createHunk(5, 0, 1);
			const b = createHunk(5, 0, 2);
			assert.strictEqual(hunksOverlap(a, b), true);
		});

		test('should handle pure insertion within regular hunk', () => {
			const insertion = createHunk(5, 0, 1);
			const regular = createHunk(3, 5, 5);
			assert.strictEqual(hunksOverlap(insertion, regular), true);
		});

		test('should handle pure insertion outside regular hunk', () => {
			const insertion = createHunk(10, 0, 1);
			const regular = createHunk(3, 2, 2);
			assert.strictEqual(hunksOverlap(insertion, regular), false);
		});

		test('should handle regular hunk with pure insertion within (reversed order)', () => {
			// Test with b as the pure insertion (to cover line 75-77)
			const regular = createHunk(3, 5, 5);
			const insertion = createHunk(5, 0, 1);
			assert.strictEqual(hunksOverlap(regular, insertion), true);
		});

		test('should handle regular hunk with pure insertion outside (reversed order)', () => {
			const regular = createHunk(3, 2, 2);
			const insertion = createHunk(10, 0, 1);
			assert.strictEqual(hunksOverlap(regular, insertion), false);
		});

		test('should handle pure insertions at different points', () => {
			const a = createHunk(5, 0, 1);
			const b = createHunk(10, 0, 2);
			assert.strictEqual(hunksOverlap(a, b), false);
		});

	});

	suite('areHunksIndependent', () => {

		test('should return true for empty array', () => {
			assert.strictEqual(areHunksIndependent([]), true);
		});

		test('should return true for single hunk', () => {
			assert.strictEqual(areHunksIndependent([createHunk(5, 1, 1)]), true);
		});

		test('should return true for non-overlapping hunks', () => {
			const hunks = [
				createHunk(1, 1, 1),
				createHunk(5, 1, 1),
				createHunk(10, 1, 1)
			];
			assert.strictEqual(areHunksIndependent(hunks), true);
		});

		test('should return false for overlapping hunks', () => {
			const hunks = [
				createHunk(1, 3, 3),
				createHunk(2, 2, 2)
			];
			assert.strictEqual(areHunksIndependent(hunks), false);
		});

	});

	suite('calculateLineOffset', () => {

		test('should return 0 for replacement with same line count', () => {
			const hunk = createHunk(1, 2, 2);
			assert.strictEqual(calculateLineOffset(hunk), 0);
		});

		test('should return positive for insertion', () => {
			const hunk = createHunk(1, 1, 3);
			assert.strictEqual(calculateLineOffset(hunk), 2);
		});

		test('should return negative for deletion', () => {
			const hunk = createHunk(1, 3, 1);
			assert.strictEqual(calculateLineOffset(hunk), -2);
		});

		test('should handle pure insertion', () => {
			const hunk = createHunk(1, 0, 2);
			assert.strictEqual(calculateLineOffset(hunk), 2);
		});

		test('should handle pure deletion', () => {
			const hunk = createHunk(1, 2, 0);
			assert.strictEqual(calculateLineOffset(hunk), -2);
		});

	});

	suite('calculateTotalLineOffset', () => {

		test('should return 0 for empty array', () => {
			assert.strictEqual(calculateTotalLineOffset([]), 0);
		});

		test('should sum offsets correctly', () => {
			const hunks = [
				createHunk(1, 1, 2),  // +1
				createHunk(5, 2, 1),  // -1
				createHunk(10, 0, 3)  // +3
			];
			assert.strictEqual(calculateTotalLineOffset(hunks), 3);
		});

	});

	suite('validateHunks', () => {

		test('should return valid for empty hunks', () => {
			const result = validateHunks('line1\nline2', []);
			assert.strictEqual(result.valid, true);
		});

		test('should return invalid for out of bounds start', () => {
			const content = 'line1\nline2';
			const hunk = createHunk(10, 1, 1);
			const result = validateHunks(content, [hunk]);
			assert.strictEqual(result.valid, false);
			assert.ok(result.error?.includes('out of bounds'));
		});

		test('should return invalid for negative start', () => {
			const content = 'line1\nline2';
			const hunk = createHunk(-1, 1, 1);
			const result = validateHunks(content, [hunk]);
			assert.strictEqual(result.valid, false);
		});

		test('should return invalid for hunk end exceeding line count', () => {
			const content = 'line1\nline2';
			const hunk = createHunk(1, 5, 1);
			const result = validateHunks(content, [hunk]);
			assert.strictEqual(result.valid, false);
			assert.ok(result.error?.includes('exceeds line count'));
		});

		test('should return invalid for content mismatch', () => {
			const content = 'line1\nline2\nline3';
			const hunk = createHunk(1, 1, 1, ['wrong'], ['new']);
			const result = validateHunks(content, [hunk]);
			assert.strictEqual(result.valid, false);
			assert.ok(result.error?.includes('mismatch'));
		});

		test('should return invalid for overlapping hunks', () => {
			const content = 'line1\nline2\nline3\nline4\nline5';
			const hunks = [
				createHunk(1, 3, 3, ['line2', 'line3', 'line4'], ['a', 'b', 'c']),
				createHunk(2, 2, 2, ['line3', 'line4'], ['x', 'y'])
			];
			const result = validateHunks(content, hunks);
			assert.strictEqual(result.valid, false);
			assert.ok(result.error?.includes('overlap'));
		});

		test('should return valid for correct hunks', () => {
			const content = 'line1\nline2\nline3';
			const hunk = createHunk(1, 1, 1, ['line2'], ['modified']);
			const result = validateHunks(content, [hunk]);
			assert.strictEqual(result.valid, true);
		});

		test('should return valid when originalLines is empty (skip content verification)', () => {
			const content = 'line1\nline2\nline3';
			// Hunk with originalLength > 0 but empty originalLines array
			const hunk = createHunk(1, 1, 1, [], ['modified']);
			const result = validateHunks(content, [hunk]);
			assert.strictEqual(result.valid, true);
		});

		test('should return valid for pure insertion hunks', () => {
			const content = 'line1\nline2\nline3';
			// Pure insertion: originalLength = 0
			const hunk = createHunk(1, 0, 1, [], ['inserted']);
			const result = validateHunks(content, [hunk]);
			assert.strictEqual(result.valid, true);
		});

		test('should return valid for hunk at exact end of file', () => {
			const content = 'line1\nline2\nline3';
			// Hunk at the last line (index 2, which is valid for 3 lines)
			const hunk = createHunk(2, 1, 1, ['line3'], ['modified']);
			const result = validateHunks(content, [hunk]);
			assert.strictEqual(result.valid, true);
		});

	});

});
