/*---------------------------------------------------------------------------------------------
 * Copyright (c) John R. D'Orazio. All rights reserved.
 * Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import * as assert from 'assert';
import { computeDiffHunks, isLineInHunkRange, getHunkOriginalEnd, DiffHunk } from '../src/diff-utils';

suite('Diff Utils', () => {

	suite('computeDiffHunks', () => {

		test('should return empty array for identical content', () => {
			const content = 'line1\nline2\nline3';
			const hunks = computeDiffHunks(content, content);
			assert.strictEqual(hunks.length, 0);
		});

		test('should detect single line change', () => {
			const original = 'line1\nline2\nline3';
			const modified = 'line1\nmodified\nline3';
			const hunks = computeDiffHunks(original, modified);

			assert.strictEqual(hunks.length, 1);
			assert.strictEqual(hunks[0].originalStart, 1);
			assert.strictEqual(hunks[0].originalLength, 1);
			assert.strictEqual(hunks[0].modifiedLength, 1);
			assert.deepStrictEqual(hunks[0].originalLines, ['line2']);
			assert.deepStrictEqual(hunks[0].modifiedLines, ['modified']);
		});

		test('should detect single line deletion', () => {
			const original = 'line1\nline2\nline3';
			const modified = 'line1\nline3';
			const hunks = computeDiffHunks(original, modified);

			assert.strictEqual(hunks.length, 1);
			assert.strictEqual(hunks[0].originalStart, 1);
			assert.strictEqual(hunks[0].originalLength, 1);
			assert.strictEqual(hunks[0].modifiedLength, 0);
			assert.deepStrictEqual(hunks[0].originalLines, ['line2']);
			assert.deepStrictEqual(hunks[0].modifiedLines, []);
		});

		test('should detect single line insertion', () => {
			const original = 'line1\nline3';
			const modified = 'line1\nline2\nline3';
			const hunks = computeDiffHunks(original, modified);

			assert.strictEqual(hunks.length, 1);
			assert.strictEqual(hunks[0].originalLength, 0);
			assert.strictEqual(hunks[0].modifiedLength, 1);
			assert.deepStrictEqual(hunks[0].originalLines, []);
			assert.deepStrictEqual(hunks[0].modifiedLines, ['line2']);
		});

		test('should detect multiple line change as single hunk', () => {
			const original = 'line1\nline2\nline3\nline4';
			const modified = 'line1\nchanged2\nchanged3\nline4';
			const hunks = computeDiffHunks(original, modified);

			assert.strictEqual(hunks.length, 1);
			assert.strictEqual(hunks[0].originalStart, 1);
			assert.strictEqual(hunks[0].originalLength, 2);
			assert.strictEqual(hunks[0].modifiedLength, 2);
			assert.deepStrictEqual(hunks[0].originalLines, ['line2', 'line3']);
			assert.deepStrictEqual(hunks[0].modifiedLines, ['changed2', 'changed3']);
		});

		test('should detect multiple separate hunks', () => {
			const original = 'line1\nline2\nline3\nline4\nline5';
			const modified = 'line1\nchanged2\nline3\nchanged4\nline5';
			const hunks = computeDiffHunks(original, modified);

			assert.strictEqual(hunks.length, 2);

			// First hunk
			assert.strictEqual(hunks[0].originalStart, 1);
			assert.strictEqual(hunks[0].originalLength, 1);
			assert.deepStrictEqual(hunks[0].originalLines, ['line2']);
			assert.deepStrictEqual(hunks[0].modifiedLines, ['changed2']);

			// Second hunk
			assert.strictEqual(hunks[1].originalStart, 3);
			assert.strictEqual(hunks[1].originalLength, 1);
			assert.deepStrictEqual(hunks[1].originalLines, ['line4']);
			assert.deepStrictEqual(hunks[1].modifiedLines, ['changed4']);
		});

		test('should handle changes at start of file', () => {
			const original = 'line1\nline2\nline3';
			const modified = 'changed1\nline2\nline3';
			const hunks = computeDiffHunks(original, modified);

			assert.strictEqual(hunks.length, 1);
			assert.strictEqual(hunks[0].originalStart, 0);
			assert.deepStrictEqual(hunks[0].originalLines, ['line1']);
			assert.deepStrictEqual(hunks[0].modifiedLines, ['changed1']);
		});

		test('should handle changes at end of file', () => {
			const original = 'line1\nline2\nline3';
			const modified = 'line1\nline2\nchanged3';
			const hunks = computeDiffHunks(original, modified);

			assert.strictEqual(hunks.length, 1);
			assert.strictEqual(hunks[0].originalStart, 2);
			assert.deepStrictEqual(hunks[0].originalLines, ['line3']);
			assert.deepStrictEqual(hunks[0].modifiedLines, ['changed3']);
		});

		test('should handle empty original content', () => {
			const original = '';
			const modified = 'line1\nline2';
			const hunks = computeDiffHunks(original, modified);

			assert.strictEqual(hunks.length, 1);
			assert.strictEqual(hunks[0].originalLength, 1); // Empty string splits to ['']
			assert.strictEqual(hunks[0].modifiedLength, 2);
		});

		test('should handle empty modified content', () => {
			const original = 'line1\nline2';
			const modified = '';
			const hunks = computeDiffHunks(original, modified);

			assert.strictEqual(hunks.length, 1);
			assert.strictEqual(hunks[0].originalLength, 2);
			assert.strictEqual(hunks[0].modifiedLength, 1); // Empty string splits to ['']
		});

		test('should handle whitespace-only changes', () => {
			const original = 'line1\n    indented\nline3';
			const modified = 'line1\n\tindented\nline3';
			const hunks = computeDiffHunks(original, modified);

			assert.strictEqual(hunks.length, 1);
			assert.deepStrictEqual(hunks[0].originalLines, ['    indented']);
			assert.deepStrictEqual(hunks[0].modifiedLines, ['\tindented']);
		});

		test('should handle mixed insertions and deletions in one hunk', () => {
			const original = 'line1\nold1\nold2\nline4';
			const modified = 'line1\nnew1\nnew2\nnew3\nline4';
			const hunks = computeDiffHunks(original, modified);

			assert.strictEqual(hunks.length, 1);
			assert.strictEqual(hunks[0].originalLength, 2);
			assert.strictEqual(hunks[0].modifiedLength, 3);
			assert.deepStrictEqual(hunks[0].originalLines, ['old1', 'old2']);
			assert.deepStrictEqual(hunks[0].modifiedLines, ['new1', 'new2', 'new3']);
		});

		test('should handle completely different content', () => {
			const original = 'a\nb\nc';
			const modified = 'x\ny\nz';
			const hunks = computeDiffHunks(original, modified);

			// All lines are different, should result in a single hunk
			assert.strictEqual(hunks.length, 1);
			assert.strictEqual(hunks[0].originalLength, 3);
			assert.strictEqual(hunks[0].modifiedLength, 3);
		});

		test('should handle insertion at very beginning', () => {
			const original = 'line2\nline3';
			const modified = 'line1\nline2\nline3';
			const hunks = computeDiffHunks(original, modified);

			assert.strictEqual(hunks.length, 1);
			assert.strictEqual(hunks[0].originalStart, 0);
			assert.strictEqual(hunks[0].originalLength, 0);
			assert.strictEqual(hunks[0].modifiedLength, 1);
			assert.deepStrictEqual(hunks[0].modifiedLines, ['line1']);
		});

		test('should handle insertion at very end', () => {
			const original = 'line1\nline2';
			const modified = 'line1\nline2\nline3';
			const hunks = computeDiffHunks(original, modified);

			assert.strictEqual(hunks.length, 1);
			assert.strictEqual(hunks[0].originalLength, 0);
			assert.strictEqual(hunks[0].modifiedLength, 1);
			assert.deepStrictEqual(hunks[0].modifiedLines, ['line3']);
		});

		test('should handle deletion at very beginning', () => {
			const original = 'line1\nline2\nline3';
			const modified = 'line2\nline3';
			const hunks = computeDiffHunks(original, modified);

			assert.strictEqual(hunks.length, 1);
			assert.strictEqual(hunks[0].originalStart, 0);
			assert.strictEqual(hunks[0].originalLength, 1);
			assert.strictEqual(hunks[0].modifiedLength, 0);
			assert.deepStrictEqual(hunks[0].originalLines, ['line1']);
		});

		test('should handle deletion at very end', () => {
			const original = 'line1\nline2\nline3';
			const modified = 'line1\nline2';
			const hunks = computeDiffHunks(original, modified);

			assert.strictEqual(hunks.length, 1);
			assert.strictEqual(hunks[0].originalLength, 1);
			assert.strictEqual(hunks[0].modifiedLength, 0);
			assert.deepStrictEqual(hunks[0].originalLines, ['line3']);
		});

		test('should handle single line original and modified', () => {
			const original = 'single';
			const modified = 'changed';
			const hunks = computeDiffHunks(original, modified);

			assert.strictEqual(hunks.length, 1);
			assert.deepStrictEqual(hunks[0].originalLines, ['single']);
			assert.deepStrictEqual(hunks[0].modifiedLines, ['changed']);
		});

		test('should handle LCS backtracking with equal dp values', () => {
			// This tests the case where dp[i-1][j] equals dp[i][j-1]
			// The algorithm should prefer one direction consistently
			const original = 'a\nc\ne';
			const modified = 'b\nc\nd';
			const hunks = computeDiffHunks(original, modified);

			// Both have 'c' in common
			assert.ok(hunks.length >= 1);
			// Verify 'c' is preserved (not in any hunk's changes on either side)
			const allOriginalLines = hunks.flatMap(h => h.originalLines);
			const allModifiedLines = hunks.flatMap(h => h.modifiedLines);
			assert.strictEqual(allOriginalLines.includes('c'), false, "'c' should not be in original hunk lines");
			assert.strictEqual(allModifiedLines.includes('c'), false, "'c' should not be in modified hunk lines");
		});

	});

	suite('isLineInHunkRange', () => {

		test('should return true for line within deletion range', () => {
			const hunk: DiffHunk = {
				originalStart: 5,
				originalLength: 3,
				modifiedStart: 5,
				modifiedLength: 2,
				originalLines: ['a', 'b', 'c'],
				modifiedLines: ['x', 'y']
			};

			assert.strictEqual(isLineInHunkRange(hunk, 5), true);
			assert.strictEqual(isLineInHunkRange(hunk, 6), true);
			assert.strictEqual(isLineInHunkRange(hunk, 7), true);
		});

		test('should return false for line outside deletion range', () => {
			const hunk: DiffHunk = {
				originalStart: 5,
				originalLength: 3,
				modifiedStart: 5,
				modifiedLength: 2,
				originalLines: ['a', 'b', 'c'],
				modifiedLines: ['x', 'y']
			};

			assert.strictEqual(isLineInHunkRange(hunk, 4), false);
			assert.strictEqual(isLineInHunkRange(hunk, 8), false);
		});

		test('should handle pure insertion hunk', () => {
			const hunk: DiffHunk = {
				originalStart: 3,
				originalLength: 0,
				modifiedStart: 3,
				modifiedLength: 2,
				originalLines: [],
				modifiedLines: ['new1', 'new2']
			};

			// Pure insertion only matches the exact insertion point
			assert.strictEqual(isLineInHunkRange(hunk, 3), true);
			assert.strictEqual(isLineInHunkRange(hunk, 2), false);
			assert.strictEqual(isLineInHunkRange(hunk, 4), false);
		});

	});

	suite('getHunkOriginalEnd', () => {

		test('should return correct end for deletion hunk', () => {
			const hunk: DiffHunk = {
				originalStart: 5,
				originalLength: 3,
				modifiedStart: 5,
				modifiedLength: 2,
				originalLines: ['a', 'b', 'c'],
				modifiedLines: ['x', 'y']
			};

			assert.strictEqual(getHunkOriginalEnd(hunk), 8);
		});

		test('should return start + 1 for pure insertion hunk', () => {
			const hunk: DiffHunk = {
				originalStart: 3,
				originalLength: 0,
				modifiedStart: 3,
				modifiedLength: 2,
				originalLines: [],
				modifiedLines: ['new1', 'new2']
			};

			assert.strictEqual(getHunkOriginalEnd(hunk), 4);
		});

	});

});
