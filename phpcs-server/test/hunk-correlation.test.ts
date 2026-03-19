/*---------------------------------------------------------------------------------------------
 * Copyright (c) John R. D'Orazio. All rights reserved.
 * Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import * as assert from 'assert';
import { Diagnostic, DiagnosticSeverity } from 'vscode-languageserver/node';
import { DiffHunk } from '../src/diff-utils';
import {
	isDiagnosticInHunk,
	correlateDiagnosticsToHunks,
	findHunksForDiagnostic,
	getDiagnosticsForHunks,
	isHunkASideEffect
} from '../src/hunk-correlation';

suite('Hunk Correlation', () => {

	const createDiagnostic = (
		line: number,
		character: number = 0,
		message: string = 'test error'
	): Diagnostic => ({
		range: {
			start: { line, character },
			end: { line, character: character + 5 }
		},
		message,
		severity: DiagnosticSeverity.Error,
		source: 'phpcs'
	});

	const createHunk = (
		originalStart: number,
		originalLength: number,
		modifiedStart: number = originalStart,
		modifiedLength: number = originalLength
	): DiffHunk => ({
		originalStart,
		originalLength,
		modifiedStart,
		modifiedLength,
		originalLines: Array(originalLength).fill('old'),
		modifiedLines: Array(modifiedLength).fill('new')
	});

	suite('isDiagnosticInHunk', () => {

		test('should return true when diagnostic line is at hunk start', () => {
			const hunk = createHunk(5, 3);
			const diagnostic = createDiagnostic(5);
			assert.strictEqual(isDiagnosticInHunk(hunk, diagnostic), true);
		});

		test('should return true when diagnostic line is within hunk', () => {
			const hunk = createHunk(5, 3);
			const diagnostic = createDiagnostic(6);
			assert.strictEqual(isDiagnosticInHunk(hunk, diagnostic), true);
		});

		test('should return true when diagnostic line is at hunk end', () => {
			const hunk = createHunk(5, 3);
			const diagnostic = createDiagnostic(7);
			assert.strictEqual(isDiagnosticInHunk(hunk, diagnostic), true);
		});

		test('should return false when diagnostic line is before hunk', () => {
			const hunk = createHunk(5, 3);
			const diagnostic = createDiagnostic(4);
			assert.strictEqual(isDiagnosticInHunk(hunk, diagnostic), false);
		});

		test('should return false when diagnostic line is after hunk', () => {
			const hunk = createHunk(5, 3);
			const diagnostic = createDiagnostic(8);
			assert.strictEqual(isDiagnosticInHunk(hunk, diagnostic), false);
		});

		test('should handle pure insertion hunk', () => {
			const hunk = createHunk(5, 0, 5, 2);
			// Pure insertions match the insertion point OR the line before
			// (e.g., "missing blank line" at line 4 -> insertion at line 5)
			assert.strictEqual(isDiagnosticInHunk(hunk, createDiagnostic(5)), true);
			assert.strictEqual(isDiagnosticInHunk(hunk, createDiagnostic(4)), true); // line before insertion
			assert.strictEqual(isDiagnosticInHunk(hunk, createDiagnostic(3)), false);
			assert.strictEqual(isDiagnosticInHunk(hunk, createDiagnostic(6)), false);
		});

		test('should handle pure deletion hunk with nearby diagnostic (lenient mode)', () => {
			// Pure deletion: removes 1 line at line 2, adds 0 lines
			// (e.g., removing extra blank line between header blocks)
			const hunk = createHunk(2, 1, 2, 0);
			// In lenient mode (default), diagnostic at line 0 should match (within proximity of 2 lines)
			assert.strictEqual(isDiagnosticInHunk(hunk, createDiagnostic(0)), true);
			// Diagnostic at line 1 should also match (1 line before hunk)
			assert.strictEqual(isDiagnosticInHunk(hunk, createDiagnostic(1)), true);
			// Diagnostic at line 2 (within the hunk) should match
			assert.strictEqual(isDiagnosticInHunk(hunk, createDiagnostic(2)), true);
			// Diagnostic at line 3 (after hunk) should not match
			assert.strictEqual(isDiagnosticInHunk(hunk, createDiagnostic(3)), false);
		});

		test('should NOT match pure deletion with distant diagnostic (lenient mode)', () => {
			// Pure deletion: removes 1 line at line 5, adds 0 lines
			const hunk = createHunk(5, 1, 5, 0);
			// Diagnostic at line 0 should NOT match (5 lines before, beyond MAX_DELETION_PROXIMITY of 2)
			assert.strictEqual(isDiagnosticInHunk(hunk, createDiagnostic(0)), false);
			// Diagnostic at line 2 should NOT match (3 lines before, beyond proximity)
			assert.strictEqual(isDiagnosticInHunk(hunk, createDiagnostic(2)), false);
			// Diagnostic at line 3 should match (2 lines before, within proximity)
			assert.strictEqual(isDiagnosticInHunk(hunk, createDiagnostic(3)), true);
		});

		test('should NOT match pure deletion with nearby diagnostic in strict mode', () => {
			// Pure deletion: removes 1 line at line 2, adds 0 lines
			const hunk = createHunk(2, 1, 2, 0);
			// In strict mode, proximity-based matching is disabled
			// Diagnostic at line 0 should NOT match (not within hunk range)
			assert.strictEqual(isDiagnosticInHunk(hunk, createDiagnostic(0), true), false);
			// Diagnostic at line 1 should NOT match (not within hunk range)
			assert.strictEqual(isDiagnosticInHunk(hunk, createDiagnostic(1), true), false);
			// Diagnostic at line 2 (within the hunk) should match
			assert.strictEqual(isDiagnosticInHunk(hunk, createDiagnostic(2), true), true);
		});

		test('should handle header fix with diagnostic at line 0 (lenient mode)', () => {
			// Header-related sniffs report at line 0, fix is at nearby line
			const hunk = createHunk(2, 1, 2, 0); // Delete line 2
			// Diagnostic at line 0 should match if hunk is within first 3 lines (lenient mode)
			assert.strictEqual(isDiagnosticInHunk(hunk, createDiagnostic(0)), true);
		});

		test('should match header diagnostic at line 0 with replacement hunk via header proximity', () => {
			// Replacement hunk (not pure deletion) at line 3 - still within MAX_HEADER_PROXIMITY
			// This specifically tests the header proximity branch (lines 94-96)
			const hunk = createHunk(3, 1, 3, 1); // Replace 1 line at line 3
			// Diagnostic at line 0 should NOT match via standard case (line 0 not in [3,4))
			// Diagnostic at line 0 should NOT match via pure deletion proximity (not a pure deletion)
			// Diagnostic at line 0 SHOULD match via header proximity (hunk at line 3 <= MAX_HEADER_PROXIMITY of 3)
			assert.strictEqual(isDiagnosticInHunk(hunk, createDiagnostic(0)), true);
		});

		test('should NOT match header diagnostic with hunk beyond header proximity', () => {
			// Header-related sniffs report at line 0, fix is beyond header proximity
			const hunk = createHunk(4, 1, 4, 0); // Delete line 4
			// Diagnostic at line 0 should NOT match hunk at line 4 (beyond MAX_HEADER_PROXIMITY of 3)
			assert.strictEqual(isDiagnosticInHunk(hunk, createDiagnostic(0)), false);
		});

		test('should NOT match header diagnostic with nearby hunk in strict mode', () => {
			// Header-related sniffs report at line 0, fix is at nearby line
			const hunk = createHunk(2, 1, 2, 0); // Delete line 2
			// In strict mode, diagnostic at line 0 should NOT match hunk at line 2
			assert.strictEqual(isDiagnosticInHunk(hunk, createDiagnostic(0), true), false);
		});

		test('should not match header diagnostic with distant hunk', () => {
			// Header diagnostic should not match hunk that's too far away
			const hunk = createHunk(10, 1, 10, 0); // Delete at line 10
			// Diagnostic at line 0 should NOT match hunk beyond proximity
			assert.strictEqual(isDiagnosticInHunk(hunk, createDiagnostic(0)), false);
		});

	});

	suite('correlateDiagnosticsToHunks', () => {

		test('should assign high confidence when single diagnostic matches', () => {
			const hunks = [createHunk(5, 1)];
			const diagnostics = [createDiagnostic(5)];
			const correlations = correlateDiagnosticsToHunks(hunks, diagnostics);

			assert.strictEqual(correlations.length, 1);
			assert.strictEqual(correlations[0].confidence, 'high');
			assert.strictEqual(correlations[0].diagnostics.length, 1);
		});

		test('should assign medium confidence when multiple diagnostics match', () => {
			const hunks = [createHunk(5, 3)];
			const diagnostics = [
				createDiagnostic(5, 0, 'error 1'),
				createDiagnostic(6, 0, 'error 2')
			];
			const correlations = correlateDiagnosticsToHunks(hunks, diagnostics);

			assert.strictEqual(correlations.length, 1);
			assert.strictEqual(correlations[0].confidence, 'medium');
			assert.strictEqual(correlations[0].diagnostics.length, 2);
		});

		test('should assign low confidence when no diagnostics match', () => {
			const hunks = [createHunk(5, 1)];
			const diagnostics = [createDiagnostic(10)];
			const correlations = correlateDiagnosticsToHunks(hunks, diagnostics);

			assert.strictEqual(correlations.length, 1);
			assert.strictEqual(correlations[0].confidence, 'low');
			assert.strictEqual(correlations[0].diagnostics.length, 0);
		});

		test('should handle multiple hunks with mixed confidence', () => {
			const hunks = [
				createHunk(1, 1),  // Will have 1 diagnostic (high)
				createHunk(5, 2),  // Will have 2 diagnostics (medium)
				createHunk(10, 1)  // Will have 0 diagnostics (low)
			];
			const diagnostics = [
				createDiagnostic(1),
				createDiagnostic(5),
				createDiagnostic(6)
			];
			const correlations = correlateDiagnosticsToHunks(hunks, diagnostics);

			assert.strictEqual(correlations.length, 3);
			assert.strictEqual(correlations[0].confidence, 'high');
			assert.strictEqual(correlations[1].confidence, 'medium');
			assert.strictEqual(correlations[2].confidence, 'low');
		});

		test('should return empty correlations for empty hunks', () => {
			const correlations = correlateDiagnosticsToHunks([], [createDiagnostic(5)]);
			assert.strictEqual(correlations.length, 0);
		});

	});

	suite('findHunksForDiagnostic', () => {

		test('should find single hunk containing diagnostic', () => {
			const hunks = [createHunk(1, 1), createHunk(5, 1), createHunk(10, 1)];
			const diagnostics = [
				createDiagnostic(1),
				createDiagnostic(5),
				createDiagnostic(10)
			];
			const correlations = correlateDiagnosticsToHunks(hunks, diagnostics);

			const result = findHunksForDiagnostic(correlations, diagnostics[1]);
			assert.strictEqual(result.length, 1);
			assert.strictEqual(result[0].originalStart, 5);
		});

		test('should return empty array when diagnostic not found', () => {
			const hunks = [createHunk(1, 1)];
			const diagnostics = [createDiagnostic(1)];
			const correlations = correlateDiagnosticsToHunks(hunks, diagnostics);

			const notFoundDiagnostic = createDiagnostic(100);
			const result = findHunksForDiagnostic(correlations, notFoundDiagnostic);
			assert.strictEqual(result.length, 0);
		});

		test('should find hunk when diagnostic matches exactly', () => {
			const hunks = [createHunk(5, 1)];
			const diagnostic = createDiagnostic(5, 3, 'specific error');
			const diagnostics = [diagnostic];
			const correlations = correlateDiagnosticsToHunks(hunks, diagnostics);

			const result = findHunksForDiagnostic(correlations, diagnostic);
			assert.strictEqual(result.length, 1);
		});

		test('should find hunk with lenient matching when useStrictMatching is false', () => {
			// Pure deletion hunk at line 5 with diagnostic at line 3 (within proximity)
			const hunks = [createHunk(5, 1, 5, 0)]; // Delete 1 line at line 5
			const diagnostic = createDiagnostic(3); // 2 lines before hunk (within MAX_DELETION_PROXIMITY)
			const diagnostics = [diagnostic];
			const correlations = correlateDiagnosticsToHunks(hunks, diagnostics);

			// Strict mode should NOT find this
			const strictResult = findHunksForDiagnostic(correlations, diagnostic, true);
			assert.strictEqual(strictResult.length, 0);

			// Lenient mode should find this
			const lenientResult = findHunksForDiagnostic(correlations, diagnostic, false);
			assert.strictEqual(lenientResult.length, 1);
		});

		test('should handle empty correlations array', () => {
			const diagnostic = createDiagnostic(5);
			const result = findHunksForDiagnostic([], diagnostic);
			assert.strictEqual(result.length, 0);
		});

	});

	suite('getDiagnosticsForHunks', () => {

		test('should return all diagnostics for specified hunks', () => {
			const hunks = [createHunk(1, 1), createHunk(5, 2)];
			const diagnostics = [
				createDiagnostic(1),
				createDiagnostic(5),
				createDiagnostic(6)
			];
			const correlations = correlateDiagnosticsToHunks(hunks, diagnostics);

			const result = getDiagnosticsForHunks(correlations, [hunks[1]]);
			assert.strictEqual(result.length, 2);
		});

		test('should not include duplicates', () => {
			const hunks = [createHunk(5, 1)];
			const diagnostic = createDiagnostic(5);
			const diagnostics = [diagnostic];
			const correlations = correlateDiagnosticsToHunks(hunks, diagnostics);

			// Pass the same hunk twice
			const result = getDiagnosticsForHunks(correlations, [hunks[0], hunks[0]]);
			assert.strictEqual(result.length, 1);
		});

		test('should return empty for empty hunks array', () => {
			const hunks = [createHunk(5, 1)];
			const diagnostics = [createDiagnostic(5)];
			const correlations = correlateDiagnosticsToHunks(hunks, diagnostics);

			const result = getDiagnosticsForHunks(correlations, []);
			assert.strictEqual(result.length, 0);
		});

	});

	suite('isHunkASideEffect', () => {

		test('should return true for low confidence hunk', () => {
			const hunks = [createHunk(5, 1)];
			const diagnostics: Diagnostic[] = []; // No diagnostics for this hunk
			const correlations = correlateDiagnosticsToHunks(hunks, diagnostics);

			assert.strictEqual(isHunkASideEffect(hunks[0], correlations), true);
		});

		test('should return false for high confidence hunk', () => {
			const hunks = [createHunk(5, 1)];
			const diagnostics = [createDiagnostic(5)];
			const correlations = correlateDiagnosticsToHunks(hunks, diagnostics);

			assert.strictEqual(isHunkASideEffect(hunks[0], correlations), false);
		});

		test('should return false for medium confidence hunk', () => {
			const hunks = [createHunk(5, 2)];
			const diagnostics = [createDiagnostic(5), createDiagnostic(6)];
			const correlations = correlateDiagnosticsToHunks(hunks, diagnostics);

			assert.strictEqual(isHunkASideEffect(hunks[0], correlations), false);
		});

		test('should return false when hunk is not found in correlations', () => {
			// Create correlations for one hunk, but check a different hunk
			const correlatedHunk = createHunk(5, 1);
			const diagnostics = [createDiagnostic(5)];
			const correlations = correlateDiagnosticsToHunks([correlatedHunk], diagnostics);

			// Check a hunk that's not in the correlations
			const unknownHunk = createHunk(10, 1);
			assert.strictEqual(isHunkASideEffect(unknownHunk, correlations), false);
		});

		test('should return false for empty correlations array', () => {
			const hunk = createHunk(5, 1);
			assert.strictEqual(isHunkASideEffect(hunk, []), false);
		});

	});

});
