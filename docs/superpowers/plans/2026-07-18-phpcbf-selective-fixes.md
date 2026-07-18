# PHPCBF Selective Fixes Implementation Plan

> **ABANDONED (2026-07-18) — DO NOT EXECUTE.** Task 1's validation spike
> falsified the design's core assumption (`editor.action.codeAction` has no
> `preview` argument; see the Outcome section of the companion spec). The
> effort was stopped by decision; no task beyond the spike was executed, and
> none of the features described below (preview command, sniff-scoped fixes,
> `phpcbfSaveOnFix`, `source.fixAll.phpcs`) exist in the extension. This
> document is a historical record only: task instructions — including
> Task 11's README/CHANGELOG copy — describe what *would have been* built
> and must not be applied to the repository.

**Goal:** Per-change accept/reject preview of PHPCBF fixes via VS Code's native Refactor Preview panel, plus sniff-scoped quick fixes, replacing the abandoned custom-UI approach of PR #19.

**Architecture:** The server describes fixes as minimal LSP `TextEdit[]` (jsdiff) attached to code actions via lazy `codeAction/resolve` with versioned `WorkspaceEdit`s. The client adds one command that triggers the built-in `editor.action.codeAction` with `preview: true`. No decorations, no CodeLens, no hunk correlation, no manual document sync.

**Tech Stack:** TypeScript 5, vscode-languageserver v9 / vscode-languageclient v9, jsdiff (`diff` npm package), Mocha (TDD interface: `suite`/`test`) via tsx, esbuild.

**Spec:** `docs/superpowers/specs/2026-07-18-phpcbf-selective-fixes-design.md`

## Global Constraints

- Branch: `feature/phpcbf-selective-fixes` (already created off `develop`; spec is committed on it).
- Tabs for indentation, single quotes, JSDoc on public methods/functions.
- All commands run from the repo **root**. Unit tests: `npm run test:server:unit`. Compile check: `npm run compile`.
- Commit trailer on every commit: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
- Task 1 ends in a **manual validation gate** — the user must confirm the Refactor Preview panel behaves correctly in the Extension Development Host before any later task runs. If the gate fails, STOP: the fallback (side-by-side diff tab) requires a design amendment first.
- Verified facts baked into this plan (do not re-derive): PHPCS diagnostic JSON `source` is a 4-part code like `PSR12.Operators.OperatorSpacing.NoSpaceBefore`; `phpcbf --sniffs=` takes the 3-part prefix (`PSR12.Operators.OperatorSpacing`) and fixes only that sniff, leaving other violations in place.

---

### Task 1: Spike — validate Refactor Preview with resolve-based code actions

The one unproven assumption in the design. Wire a hardcoded resolve through `editor.action.codeAction {preview: true}`; a human confirms panel behavior before anything else is built.

**Files:**

- Modify: `phpcs-server/src/server.ts` (capabilities in `onInitialize` ~line 165; handler registration ~line 107; new method near `onCodeAction` ~line 456)
- Modify: `phpcs/src/extension.ts` (new command near `phpcs.openStandard` registration ~line 264)
- Modify: `phpcs/package.json` (`contributes.commands`)

**Interfaces:**

- Produces: server capability `codeActionProvider: { codeActionKinds, resolveProvider: true }`; client command `phpcs.previewFixes`; kind string `'source.fixAll.phpcs'` (Task 6 formalizes it as `FIX_ALL_KIND`). The spike resolve body is **replaced** in Task 7; the registration and client command are permanent.

- [ ] **Step 1: Change the server capability**

In `phpcs-server/src/server.ts` `onInitialize`, replace `codeActionProvider: true,` with:

```typescript
				codeActionProvider: {
					codeActionKinds: [CodeActionKind.QuickFix, 'source.fixAll.phpcs'],
					resolveProvider: true,
				},
```

Add `CodeActionKind` to the existing `vscode-languageserver/node` import block, plus `Position`, `TextDocumentEdit`, and `OptionalVersionedTextDocumentIdentifier` (used below).

- [ ] **Step 2: Register and implement the spike resolve handler**

In the constructor, after the `onCodeAction` registration line:

```typescript
		this.connection.onCodeActionResolve(this.safeEventHandler(this.onCodeActionResolve));
```

Add the method after `onCodeAction`:

```typescript
	/**
	 * Resolves a code action by attaching its workspace edit.
	 * SPIKE IMPLEMENTATION — replaced with the real phpcbf-backed resolve in a later task.
	 *
	 * @param action The unresolved code action.
	 * @return The action with a versioned workspace edit attached.
	 */
	private async onCodeActionResolve(action: CodeAction): Promise<CodeAction> {
		const data = action.data as { uri?: string } | undefined;
		const document = data?.uri ? this.documents.get(data.uri) : undefined;
		if (!document) {
			return action;
		}
		action.edit = {
			documentChanges: [
				TextDocumentEdit.create(
					OptionalVersionedTextDocumentIdentifier.create(document.uri, document.version),
					[
						TextEdit.insert(Position.create(0, 0), '// SPIKE edit one\n'),
						TextEdit.insert(Position.create(document.lineCount, 0), '// SPIKE edit two\n'),
					]
				),
			],
		};
		return action;
	}
```

- [ ] **Step 3: Emit a spike action from onCodeAction**

In `onCodeAction`, change the final `return generateCodeActions(...)` to:

```typescript
		const actions = generateCodeActions(params, document, documentDiagnostics);
		// SPIKE (removed in a later task): unconditional action to validate Refactor Preview.
		actions.push({
			title: 'SPIKE: Preview PHPCBF fixes',
			kind: 'source.fixAll.phpcs',
			data: { uri: document.uri },
		});
		return actions;
```

Note: `onCodeAction` returns early when the document is missing or has no diagnostics record — for the spike, ensure the early-return for "no diagnostics" still pushes the spike action (move the spike push above any diagnostics-dependent logic if needed; the spike must appear for a clean PHP file too).

- [ ] **Step 4: Register the client preview command**

In `phpcs/src/extension.ts`, after the `phpcs.openStandard` command registration:

```typescript
		/**
		 * Command handler for previewing PHPCBF fixes in the native Refactor Preview panel.
		 */
		const previewFixesCommand = commands.registerCommand('phpcs.previewFixes', async () => {
			const editor = window.activeTextEditor;
			if (!editor || editor.document.languageId !== 'php') {
				window.showWarningMessage(SR.PhpcbfOnlyPhpFiles);
				return;
			}
			await commands.executeCommand('editor.action.codeAction', {
				kind: 'source.fixAll.phpcs',
				apply: 'first',
				preview: true,
			});
		});
```

Add `previewFixesCommand` to the same `context.subscriptions.push(...)` call that holds `openStandardCommand`.

- [ ] **Step 5: Contribute the command**

In `phpcs/package.json` `contributes.commands`, append:

```json
			{
				"command": "phpcs.previewFixes",
				"title": "PHPCS: Preview PHPCBF fixes"
			}
```

- [ ] **Step 6: Compile and bundle**

Run: `npm run compile && npm run bundle-dev`
Expected: exit 0, no TypeScript errors.

- [ ] **Step 7: MANUAL VALIDATION GATE (user)**

Ask the user to press F5 (Launch Extension), open any PHP file in the dev host, run **"PHPCS: Preview PHPCBF fixes"** from the palette, and confirm ALL of:

1. The Refactor Preview panel opens (not a direct apply).
2. It lists **two separate** checkable changes ("SPIKE edit one", "SPIKE edit two").
3. Unchecking one and clicking Apply inserts **only** the checked edit.
4. After editing the buffer and re-running the command *while the panel is open from a previous run*, applying the stale preview fails gracefully (no half-applied content).

**STOP and wait for the user's confirmation. Do not proceed to Task 2 on any failure** — report what happened instead.

- [ ] **Step 8: Commit**

```bash
git add phpcs-server/src/server.ts phpcs/src/extension.ts phpcs/package.json
git commit -m "feat: spike resolve-based code actions through Refactor Preview"
```

---

### Task 2: `computeMinimalEdits` (jsdiff)

**Files:**

- Modify: `phpcs-server/package.json` (dependency)
- Modify: `phpcs-server/src/fixer-utils.ts`
- Test: `phpcs-server/test/fixer-utils.test.ts`

**Interfaces:**

- Produces: `computeMinimalEdits(original: string, fixed: string): TextEdit[]` exported from `fixer-utils.ts`. Invariant relied on by every later task: applying the returned edits to `original` yields exactly `fixed`.

- [ ] **Step 1: Install jsdiff**

```bash
cd phpcs-server && npm install diff && cd ..
```

jsdiff v8+ ships its own TypeScript types. If `npm run compile` later complains about missing types for `'diff'`, additionally run `cd phpcs-server && npm install --save-dev @types/diff && cd ..`.

- [ ] **Step 2: Write the failing tests**

In `phpcs-server/test/fixer-utils.test.ts`, add `computeMinimalEdits` to the existing `../src/fixer-utils` import, and add imports + suite:

```typescript
import { TextDocument } from 'vscode-languageserver-textdocument';
import { TextEdit } from 'vscode-languageserver/node';
```

```typescript
	suite('computeMinimalEdits', () => {

		function applyEdits(original: string, edits: TextEdit[]): string {
			const doc = TextDocument.create('file:///test.php', 'php', 1, original);
			return TextDocument.applyEdits(doc, edits);
		}

		function assertRoundTrip(original: string, fixed: string): TextEdit[] {
			const edits = computeMinimalEdits(original, fixed);
			assert.strictEqual(applyEdits(original, edits), fixed);
			return edits;
		}

		test('should return no edits for identical content', () => {
			const text = '<?php\n$a = 1;\n';
			assert.deepStrictEqual(computeMinimalEdits(text, text), []);
		});

		test('should produce a single edit for a single changed line', () => {
			const edits = assertRoundTrip('<?php\n$a=1;\n$b = 2;\n', '<?php\n$a = 1;\n$b = 2;\n');
			assert.strictEqual(edits.length, 1);
		});

		test('should produce separate edits for separate hunks', () => {
			const original = '<?php\n$a=1;\n$ok = true;\n$b=2;\n';
			const fixed = '<?php\n$a = 1;\n$ok = true;\n$b = 2;\n';
			const edits = assertRoundTrip(original, fixed);
			assert.strictEqual(edits.length, 2);
		});

		test('should handle pure insertion', () => {
			assertRoundTrip('<?php\n$a = 1;\n', '<?php\n\n$a = 1;\n');
		});

		test('should handle pure deletion', () => {
			assertRoundTrip('<?php\n\n\n$a = 1;\n', '<?php\n$a = 1;\n');
		});

		test('should handle a change on the last line without trailing newline', () => {
			assertRoundTrip('<?php\n$a=1;', '<?php\n$a = 1;');
		});

		test('should handle removal of a trailing newline', () => {
			assertRoundTrip('<?php\n$a = 1;\n', '<?php\n$a = 1;');
		});

		test('should handle addition of a trailing newline', () => {
			assertRoundTrip('<?php\n$a = 1;', '<?php\n$a = 1;\n');
		});

		test('should handle CRLF line endings', () => {
			assertRoundTrip('<?php\r\n$a=1;\r\n', '<?php\r\n$a = 1;\r\n');
		});

		test('should handle a whole-file rewrite', () => {
			assertRoundTrip('<?php\necho 1;\n', '<?php\n\ndeclare(strict_types=1);\n\necho 2;\n');
		});

		test('should handle change on the first line', () => {
			assertRoundTrip('<?php echo 1;\n$a = 1;\n', '<?php\necho 1;\n$a = 1;\n');
		});
	});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm run test:server:unit`
Expected: FAIL — `computeMinimalEdits` is not exported.

- [ ] **Step 4: Implement**

In `phpcs-server/src/fixer-utils.ts`, add to the imports:

```typescript
import { diffLines } from 'diff';
import { Position, Range, TextEdit } from 'vscode-languageserver/node';
```

Add after `parseFixResult`:

```typescript
/**
 * Compute minimal line-based text edits that transform the original content
 * into the fixed content. Applying the returned edits to a document holding
 * the original content yields exactly the fixed content.
 *
 * Ranges use line positions; an end position past the last line is clamped
 * by the LSP text document implementation, which keeps last-line and
 * trailing-newline cases correct.
 *
 * @param original The original document content
 * @param fixed The fixed content produced by PHPCBF
 * @returns Minimal text edits, empty when the contents are identical
 */
export function computeMinimalEdits(original: string, fixed: string): TextEdit[] {
	if (original === fixed) {
		return [];
	}

	const edits: TextEdit[] = [];
	const parts = diffLines(original, fixed);
	let line = 0;

	for (let i = 0; i < parts.length; i++) {
		const part = parts[i];
		const count = part.count ?? 0;

		if (!part.added && !part.removed) {
			line += count;
			continue;
		}

		if (part.removed) {
			const next = parts[i + 1];
			let replacement = '';
			if (next && next.added) {
				replacement = next.value;
				i++;
			}
			edits.push(TextEdit.replace(Range.create(line, 0, line + count, 0), replacement));
			line += count;
			continue;
		}

		// Pure insertion (no preceding removal).
		edits.push(TextEdit.insert(Position.create(line, 0), part.value));
	}

	return edits;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test:server:unit`
Expected: PASS, including all pre-existing tests. If a trailing-newline round-trip fails, the fix is in how the last removed block is ranged: replace the range end with `Range.create(line, 0, line + count, 0)` clamped via the document — debug against the failing case, do not weaken the round-trip assertion.

- [ ] **Step 6: Commit**

```bash
git add phpcs-server/package.json phpcs-server/package-lock.json phpcs-server/src/fixer-utils.ts phpcs-server/test/fixer-utils.test.ts
git commit -m "feat: add computeMinimalEdits converting phpcbf output to minimal TextEdits"
```

---

### Task 3: Switch `computeFixEdits` to minimal edits

**Files:**

- Modify: `phpcs-server/src/server.ts:306` (the `createFullDocumentEdit` return inside `computeFixEdits`)
- Test: existing suites (`npm run test:server`)

**Interfaces:**

- Consumes: `computeMinimalEdits` (Task 2).
- Produces: `computeFixEdits` now returns minimal edits — the formatter (#23), on-save fix, and the Task 7 resolve all inherit this.

- [ ] **Step 1: Change the return**

In `phpcs-server/src/server.ts` `computeFixEdits`, replace:

```typescript
				if (result.fixed && result.content !== document.getText()) {
					return [createFullDocumentEdit(document, result.content)];
				}
```

with:

```typescript
				if (result.fixed && result.content !== document.getText()) {
					return computeMinimalEdits(document.getText(), result.content);
				}
```

Add `computeMinimalEdits` to the `./fixer-utils` import in `server.ts`. If `createFullDocumentEdit` is now unused in `server.ts`, remove it from the `./code-actions` import there (keep the export in `code-actions.ts` — the `onExecuteCommand` path may still use it; check before removing).

- [ ] **Step 2: Run the full server suite**

Run: `npm run test:server`
Expected: PASS. If any test asserts a single whole-document edit from the formatting path, update it to instead assert that applying the returned edits to the original content produces the fixed content (use the same `TextDocument.applyEdits` round-trip helper pattern as Task 2).

- [ ] **Step 3: Commit**

```bash
git add phpcs-server/src/server.ts phpcs-server/test
git commit -m "feat: return minimal edits from computeFixEdits (cursor-stable formatting)"
```

---

### Task 4: Diagnostics carry the sniff code

**Files:**

- Modify: `phpcs-server/src/linter-utils.ts:338` (the `Diagnostic.create` call in `createDiagnosticFromMessage`)
- Test: `phpcs-server/test/linter-utils.test.ts`

**Interfaces:**

- Produces: `Diagnostic.code` holds the full 4-part PHPCS source (e.g. `'PSR12.Operators.OperatorSpacing.NoSpaceBefore'`) when PHPCS provides one, else `undefined`. Task 6 depends on this.

- [ ] **Step 1: Write the failing test**

In the existing `createDiagnosticFromMessage` suite in `phpcs-server/test/linter-utils.test.ts` (create the suite if absent, following the file's existing import of `createDiagnosticFromMessage`):

```typescript
		test('should set the diagnostic code to the PHPCS source', () => {
			const document = TextDocument.create('file:///test.php', 'php', 1, '<?php\n$a=1;\n');
			const message = {
				message: 'Expected at least 1 space before "="; 0 found',
				severity: 5,
				type: 'ERROR',
				line: 2,
				column: 3,
				fixable: true,
				source: 'PSR12.Operators.OperatorSpacing.NoSpaceBefore',
			};
			const diagnostic = createDiagnosticFromMessage(document, message, false);
			assert.strictEqual(diagnostic.code, 'PSR12.Operators.OperatorSpacing.NoSpaceBefore');
			assert.strictEqual(diagnostic.source, 'phpcs');
		});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:server:unit`
Expected: FAIL — `diagnostic.code` is `undefined`.

- [ ] **Step 3: Implement**

In `createDiagnosticFromMessage`, change the final line from:

```typescript
	return Diagnostic.create(range, diagnosticMessage, severity, undefined, 'phpcs');
```

to:

```typescript
	return Diagnostic.create(range, diagnosticMessage, severity, message.source, 'phpcs');
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:server:unit`
Expected: PASS (the Problems panel will now show the sniff in parentheses next to messages — intended).

- [ ] **Step 5: Commit**

```bash
git add phpcs-server/src/linter-utils.ts phpcs-server/test/linter-utils.test.ts
git commit -m "feat: set diagnostic code to the PHPCS sniff source"
```

---

### Task 5: Sniff-scoped phpcbf execution

**Files:**

- Modify: `phpcs-server/src/fixer-utils.ts` (`FixArgumentOptions`, `buildFixArguments`)
- Modify: `phpcs-server/src/fixer.ts` (`fix` signature)
- Modify: `phpcs-server/src/server.ts` (`runPhpcbf` and `computeFixEdits` signatures)
- Test: `phpcs-server/test/fixer-utils.test.ts`

**Interfaces:**

- Produces: `buildFixArguments({..., sniffs?: string[]})` adds `--sniffs=A,B`; `PhpcbfFixer.fix(document, settings, sniffs?: string[])`; `computeFixEdits(document, settings, phpcbfPath, surfaceErrors, sniffs?: string[])`. Task 7 consumes `computeFixEdits` with `sniffs`.

- [ ] **Step 1: Write the failing tests**

In the existing `buildFixArguments` suite in `fixer-utils.test.ts`:

```typescript
		test('should add --sniffs when sniffs are provided', () => {
			const args = buildFixArguments({
				executableVersion: '4.0.1',
				sniffs: ['PSR12.Operators.OperatorSpacing'],
			});
			assert.ok(args.includes('--sniffs=PSR12.Operators.OperatorSpacing'));
		});

		test('should join multiple sniffs with commas', () => {
			const args = buildFixArguments({
				executableVersion: '4.0.1',
				sniffs: ['PSR12.Operators.OperatorSpacing', 'Squiz.ControlStructures.ControlSignature'],
			});
			assert.ok(args.includes('--sniffs=PSR12.Operators.OperatorSpacing,Squiz.ControlStructures.ControlSignature'));
		});

		test('should not add --sniffs when sniffs are absent or empty', () => {
			assert.ok(!buildFixArguments({ executableVersion: '4.0.1' }).some(a => a.startsWith('--sniffs')));
			assert.ok(!buildFixArguments({ executableVersion: '4.0.1', sniffs: [] }).some(a => a.startsWith('--sniffs')));
		});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:server:unit`
Expected: FAIL — TypeScript rejects the unknown `sniffs` option (compile error counts as the failing state).

- [ ] **Step 3: Implement**

In `fixer-utils.ts`, add to `FixArgumentOptions`:

```typescript
	/** Restrict the fix to these sniffs (3-part codes), via --sniffs. */
	sniffs?: string[];
```

In `buildFixArguments`, destructure `sniffs` and add after the `--standard` block:

```typescript
	// Restrict fixing to specific sniffs when requested
	if (sniffs && sniffs.length > 0) {
		args.push(`--sniffs=${sniffs.join(',')}`);
	}
```

In `fixer.ts`, change the `fix` signature to `public async fix(document: TextDocument, settings: PhpcsSettings, sniffs?: string[]): Promise<FixResult>` (update its JSDoc with a `@param sniffs` line) and pass `sniffs` into the `buildFixArguments({...})` call.

In `server.ts`, add a trailing optional `sniffs?: string[]` parameter to both `runPhpcbf` and `computeFixEdits` (JSDoc `@param` each); `computeFixEdits` forwards it to `runPhpcbf`, which forwards to `fixer.fix(document, settings, sniffs)`. Existing call sites pass nothing and are unaffected.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run compile && npm run test:server:unit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add phpcs-server/src/fixer-utils.ts phpcs-server/src/fixer.ts phpcs-server/src/server.ts phpcs-server/test/fixer-utils.test.ts
git commit -m "feat: support sniff-scoped phpcbf runs via --sniffs"
```

---

### Task 6: Edit-bearing code actions

**Files:**

- Modify: `phpcs-server/src/code-actions.ts`
- Modify: `phpcs-server/src/server.ts` (remove the Task 1 spike action push in `onCodeAction`)
- Test: `phpcs-server/test/code-actions.test.ts`

**Interfaces:**

- Consumes: `Diagnostic.code` (Task 4).
- Produces (Task 7 consumes all of these):

```typescript
export const FIX_ALL_KIND = 'source.fixAll.phpcs';
export interface PhpcsCodeActionData {
	uri: string;
	type: 'fixAll' | 'fixSniff';
	sniff?: string;
}
export function sniffFromCode(code: string | number | undefined): string | null;
export function createFixSniffActions(document: TextDocument, contextDiagnostics: Diagnostic[]): CodeAction[];
// createFixAllInFileAction / generateCodeActions keep their signatures but the
// actions they return now carry kind + data and NO command and NO edit.
```

- [ ] **Step 1: Write the failing tests**

In `phpcs-server/test/code-actions.test.ts` (extend existing imports with `FIX_ALL_KIND`, `sniffFromCode`, `createFixSniffActions`, `PhpcsCodeActionData`):

```typescript
	suite('sniffFromCode', () => {
		test('should extract the 3-part sniff from a 4-part source', () => {
			assert.strictEqual(
				sniffFromCode('PSR12.Operators.OperatorSpacing.NoSpaceBefore'),
				'PSR12.Operators.OperatorSpacing'
			);
		});
		test('should accept an exactly 3-part code', () => {
			assert.strictEqual(sniffFromCode('PSR12.Operators.OperatorSpacing'), 'PSR12.Operators.OperatorSpacing');
		});
		test('should return null for short, numeric, or missing codes', () => {
			assert.strictEqual(sniffFromCode('Internal.Tokenizer'), null);
			assert.strictEqual(sniffFromCode(42), null);
			assert.strictEqual(sniffFromCode(undefined), null);
		});
	});

	suite('createFixAllInFileAction (edit-bearing)', () => {
		test('should carry the fixAll kind and data payload, no command', () => {
			const document = TextDocument.create('file:///t.php', 'php', 1, '<?php\n');
			const diagnostic = Diagnostic.create(Range.create(1, 0, 1, 1), 'msg', DiagnosticSeverity.Error, 'PSR12.Operators.OperatorSpacing.NoSpaceAfter', 'phpcs');
			const action = createFixAllInFileAction(document, [diagnostic]);
			assert.ok(action);
			assert.strictEqual(action!.kind, FIX_ALL_KIND);
			assert.strictEqual(action!.command, undefined);
			assert.strictEqual(action!.edit, undefined);
			assert.deepStrictEqual(action!.data, { uri: 'file:///t.php', type: 'fixAll' });
		});
	});

	suite('createFixSniffActions', () => {
		const document = TextDocument.create('file:///t.php', 'php', 1, '<?php\n');
		const diag = (code: string | undefined) =>
			Diagnostic.create(Range.create(1, 0, 1, 1), 'msg', DiagnosticSeverity.Error, code, 'phpcs');

		test('should create one quickfix per distinct sniff', () => {
			const actions = createFixSniffActions(document, [
				diag('PSR12.Operators.OperatorSpacing.NoSpaceBefore'),
				diag('PSR12.Operators.OperatorSpacing.NoSpaceAfter'),
				diag('Squiz.ControlStructures.ControlSignature.SpaceAfterKeyword'),
			]);
			assert.strictEqual(actions.length, 2);
			assert.strictEqual(actions[0].title, "Fix all 'PSR12.Operators.OperatorSpacing' violations in this file (PHPCBF)");
			assert.strictEqual(actions[0].kind, CodeActionKind.QuickFix);
			assert.deepStrictEqual(actions[0].data, { uri: 'file:///t.php', type: 'fixSniff', sniff: 'PSR12.Operators.OperatorSpacing' });
			assert.strictEqual(actions[0].diagnostics!.length, 2);
		});

		test('should skip diagnostics without a usable code and non-phpcs sources', () => {
			const other = Diagnostic.create(Range.create(0, 0, 0, 1), 'msg', DiagnosticSeverity.Error, 'X.Y.Z.W', 'eslint');
			assert.deepStrictEqual(createFixSniffActions(document, [diag(undefined), other]), []);
		});
	});

	suite('generateCodeActions kind filtering', () => {
		const document = TextDocument.create('file:///t.php', 'php', 1, '<?php\n$a=1;\n');
		const diagnostic = Diagnostic.create(Range.create(1, 2, 1, 3), 'msg', DiagnosticSeverity.Error, 'PSR12.Operators.OperatorSpacing.NoSpaceBefore', 'phpcs');
		const makeParams = (contextDiagnostics: Diagnostic[], only?: string[]): CodeActionParams => ({
			textDocument: { uri: document.uri },
			range: Range.create(1, 0, 1, 5),
			context: { diagnostics: contextDiagnostics, only },
		});

		test('lightbulb (no only): fix-all plus sniff actions for in-range diagnostics', () => {
			const actions = generateCodeActions(makeParams([diagnostic]), document, [diagnostic]);
			assert.deepStrictEqual(
				actions.map(a => a.kind),
				[FIX_ALL_KIND, CodeActionKind.QuickFix]
			);
		});

		test('only source.fixAll: fix-all offered even with no in-range diagnostics', () => {
			const actions = generateCodeActions(makeParams([], ['source.fixAll']), document, [diagnostic]);
			assert.strictEqual(actions.length, 1);
			assert.strictEqual(actions[0].kind, FIX_ALL_KIND);
		});

		test('only quickfix: sniff actions only', () => {
			const actions = generateCodeActions(makeParams([diagnostic], [CodeActionKind.QuickFix]), document, [diagnostic]);
			assert.ok(actions.every(a => a.kind === CodeActionKind.QuickFix));
			assert.strictEqual(actions.length, 1);
		});

		test('no phpcs diagnostics in document: no actions at all', () => {
			assert.deepStrictEqual(generateCodeActions(makeParams([]), document, []), []);
		});
	});
```

Adjust any pre-existing tests in this file that assert the old command-based fix-all shape (`action.command.command === PHPCBF_FIX_FILE_COMMAND`): the palette command path still exists, but the *code action* no longer carries a command — update those assertions to the new `kind`/`data` shape.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:server:unit`
Expected: FAIL — missing exports.

- [ ] **Step 3: Implement**

In `code-actions.ts` add:

```typescript
/**
 * Code action kind for the PHPCBF fix-all action. The distinct kind lets
 * editor.action.codeAction target it unambiguously (preview command) and makes
 * "editor.codeActionsOnSave": {"source.fixAll.phpcs": "explicit"} work.
 */
export const FIX_ALL_KIND = 'source.fixAll.phpcs';

/**
 * Payload attached to unresolved PHPCBF code actions; read back in
 * codeAction/resolve to run the right phpcbf invocation.
 */
export interface PhpcsCodeActionData {
	uri: string;
	type: 'fixAll' | 'fixSniff';
	sniff?: string;
}

/**
 * Extract the 3-part sniff code (Standard.Category.Sniff) from a diagnostic
 * code holding a PHPCS source (usually 4 parts including the message code).
 * @param code The diagnostic code
 * @returns The sniff code, or null when the code is not a PHPCS source string
 */
export function sniffFromCode(code: string | number | undefined): string | null {
	if (typeof code !== 'string') {
		return null;
	}
	const parts = code.split('.');
	if (parts.length < 3) {
		return null;
	}
	return parts.slice(0, 3).join('.');
}
```

Replace the body of `createFixAllInFileAction` so the returned action is:

```typescript
	const action: CodeAction = {
		title: 'Fix all auto-fixable issues in this file (PHPCBF)',
		kind: FIX_ALL_KIND,
		diagnostics: phpcsDiagnostics,
		data: { uri: document.uri, type: 'fixAll' } satisfies PhpcsCodeActionData,
	};
```

Add:

```typescript
/**
 * Create one quickfix action per distinct sniff among the phpcs diagnostics
 * in the requested range. Each action fixes every occurrence of that sniff in
 * the file via phpcbf --sniffs (resolved lazily).
 * @param document The text document
 * @param contextDiagnostics The diagnostics in the requested range
 * @returns One action per distinct sniff, in first-seen order
 */
export function createFixSniffActions(
	document: TextDocument,
	contextDiagnostics: Diagnostic[]
): CodeAction[] {
	const bySniff = new Map<string, Diagnostic[]>();
	for (const diagnostic of getPhpcsDiagnostics(contextDiagnostics)) {
		const sniff = sniffFromCode(diagnostic.code);
		if (!sniff) {
			continue;
		}
		const group = bySniff.get(sniff) ?? [];
		group.push(diagnostic);
		bySniff.set(sniff, group);
	}
	return Array.from(bySniff.entries(), ([sniff, diagnostics]) => ({
		title: `Fix all '${sniff}' violations in this file (PHPCBF)`,
		kind: CodeActionKind.QuickFix,
		diagnostics,
		data: { uri: document.uri, type: 'fixSniff', sniff } satisfies PhpcsCodeActionData,
	}));
}
```

Replace `generateCodeActions`'s body:

```typescript
	const actions: CodeAction[] = [];

	if (!hasPhpcsDiagnostics(documentDiagnostics)) {
		return actions;
	}

	const only = params.context.only;
	const kindRequested = (kind: string): boolean =>
		!only || only.some(k => kind === k || kind.startsWith(k + '.'));

	const contextDiagnostics = params.context.diagnostics || [];
	const hasPhpcsInRange = hasPhpcsDiagnostics(contextDiagnostics);

	// Fix-all: on explicit kind request (codeActionsOnSave, preview command)
	// offer it whenever the document has phpcs diagnostics; on a plain
	// lightbulb request require a phpcs diagnostic in range (existing behavior).
	if (kindRequested(FIX_ALL_KIND) && (hasPhpcsInRange || only !== undefined)) {
		const fixAllAction = createFixAllInFileAction(document, documentDiagnostics);
		if (fixAllAction) {
			actions.push(fixAllAction);
		}
	}

	if (kindRequested(CodeActionKind.QuickFix)) {
		actions.push(...createFixSniffActions(document, contextDiagnostics));
	}

	return actions;
```

In `server.ts` `onCodeAction`, delete the Task 1 spike push (restore `return generateCodeActions(params, document, documentDiagnostics);`).

Keep `PHPCBF_FIX_FILE_COMMAND` and `createFullDocumentEdit` exported — the palette command path (`onExecuteCommand`) still uses them.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:server:unit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add phpcs-server/src/code-actions.ts phpcs-server/src/server.ts phpcs-server/test/code-actions.test.ts
git commit -m "feat: edit-bearing fix-all and sniff-scoped code actions with lazy resolve data"
```

---

### Task 7: Real `onCodeActionResolve`

**Files:**

- Modify: `phpcs-server/src/server.ts` (replace the spike resolve body)
- Test: covered by Task 6 unit tests (action shapes), Task 10 integration tests (edit content), and the Task 1 manual gate (panel flow) — the handler itself is thin glue.

**Interfaces:**

- Consumes: `PhpcsCodeActionData`, `FIX_ALL_KIND` (Task 6); `computeFixEdits(..., sniffs?)` (Tasks 3+5).
- Produces: resolved actions carrying a versioned `WorkspaceEdit`; attaches the `phpcs.saveAfterFix` command when `settings.phpcbfSaveOnFix` is true. That setting is added in Task 8 — see the ordering note in Step 1 for how to keep this task's commit compiling on its own.

- [ ] **Step 1: Replace the spike resolve implementation**

```typescript
	/**
	 * Resolves a PHPCBF code action by running phpcbf and attaching a
	 * versioned workspace edit. Returns the action unchanged when the
	 * document is gone, PHPCBF is unavailable, or no fixes apply — VS Code
	 * treats an edit-less resolved action as a no-op.
	 *
	 * @param action The unresolved code action carrying PhpcsCodeActionData.
	 * @return The action, with edit (and optionally a save command) attached.
	 */
	private async onCodeActionResolve(action: CodeAction): Promise<CodeAction> {
		const data = action.data as PhpcsCodeActionData | undefined;
		if (!data || !data.uri) {
			return action;
		}
		const document = this.documents.get(data.uri);
		if (!document) {
			return action;
		}
		const settings = await this.getDocumentSettings(document);
		if (!settings.phpcbfEnable) {
			this.connection.window.showWarningMessage(SR.PhpcbfDisabledWarning);
			return action;
		}
		const phpcbfPath = this.resolvePhpcbfPath(settings);
		if (!phpcbfPath) {
			this.connection.window.showWarningMessage(SR.PhpcbfExecutableNotFoundWarning);
			return action;
		}

		// Capture the version BEFORE running phpcbf so a buffer change during
		// the run makes VS Code reject the whole edit atomically.
		const version = document.version;
		const sniffs = data.type === 'fixSniff' && data.sniff ? [data.sniff] : undefined;
		const edits = await this.computeFixEdits(document, settings, phpcbfPath, true, sniffs);
		if (edits.length === 0) {
			return action;
		}

		action.edit = {
			documentChanges: [
				TextDocumentEdit.create(
					OptionalVersionedTextDocumentIdentifier.create(data.uri, version),
					edits
				),
			],
		};
		if (settings.phpcbfSaveOnFix) {
			action.command = Command.create('Save after fix', 'phpcs.saveAfterFix', data.uri);
		}
		return action;
	}
```

Imports to add in `server.ts`: `Command` from `vscode-languageserver/node`; `PhpcsCodeActionData` from `./code-actions`. (`TextDocumentEdit`, `OptionalVersionedTextDocumentIdentifier` were added in Task 1.) **Ordering note:** `settings.phpcbfSaveOnFix` does not exist until Task 8 — implement Tasks 7 and 8 in the same working session if the compiler rejects the field, or land Task 8 first; the reviewer gate accepts either order as long as each commit compiles. If doing Task 7 strictly first, write `if ((settings as PhpcsSettings & { phpcbfSaveOnFix?: boolean }).phpcbfSaveOnFix)` and remove the cast in Task 8.

- [ ] **Step 2: Compile and run the suite**

Run: `npm run compile && npm run test:server:unit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add phpcs-server/src/server.ts
git commit -m "feat: resolve PHPCBF code actions to versioned workspace edits"
```

---

### Task 8: `phpcs.phpcbfSaveOnFix` setting

**Files:**

- Modify: `phpcs/package.json` (`contributes.configuration.properties`)
- Modify: `phpcs-server/src/settings.ts`
- Modify: `phpcs-server/src/server.ts` (`defaultSettings`, ~line 63)
- Modify: `phpcs/src/configuration.ts` (~line 105, the phpcbf settings block)

**Interfaces:**

- Produces: `PhpcsSettings.phpcbfSaveOnFix: boolean` (default `false`), synced through the client middleware. Task 7's resolve reads it; Task 9's client command completes the loop.

- [ ] **Step 1: Add the setting in all four places**

`phpcs/package.json`, after the `phpcs.phpcbfOnSave` property:

```json
				"phpcs.phpcbfSaveOnFix": {
					"scope": "resource",
					"type": "boolean",
					"default": false,
					"description": "Save the document automatically after a PHPCBF quick fix or preview apply."
				},
```

`phpcs-server/src/settings.ts`, after `phpcbfOnSave`:

```typescript
	phpcbfSaveOnFix: boolean;
```

`phpcs-server/src/server.ts` `defaultSettings`, after `phpcbfOnSave: false,`:

```typescript
		phpcbfSaveOnFix: false,
```

`phpcs/src/configuration.ts`, in the block with `phpcbfOnSave: config.get('phpcbfOnSave'),`:

```typescript
				phpcbfSaveOnFix: config.get('phpcbfSaveOnFix'),
```

(This middleware sync is load-bearing: the 1.2.1 release fixed a bug where missing entries here silently reset phpcbf settings to defaults.)

Also fix the two integration-test settings factories (`makeSettings` in `phpcs-server/test/integration.test.ts` and the settings object in `phpcs-server/test/linter.test.ts`) by adding `phpcbfSaveOnFix: false,` — TypeScript will point at every object literal missing the field.

Remove the defensive cast in `onCodeActionResolve` if Task 7 added one.

- [ ] **Step 2: Compile and test**

Run: `npm run compile && npm run test:server:unit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add phpcs/package.json phpcs-server/src/settings.ts phpcs-server/src/server.ts phpcs/src/configuration.ts phpcs-server/test
git commit -m "feat: add phpcs.phpcbfSaveOnFix setting"
```

---

### Task 9: Client `saveAfterFix` command

**Files:**

- Modify: `phpcs/src/extension.ts` (next to the Task 1 `previewFixesCommand`)

**Interfaces:**

- Consumes: the `phpcs.saveAfterFix` command name attached by Task 7's resolve.
- Produces: the registered command. Deliberately NOT contributed in `package.json` — it is internal plumbing and must not appear in the command palette.

- [ ] **Step 1: Register the command**

```typescript
		/**
		 * Internal command attached by the server to fix code actions when
		 * phpcs.phpcbfSaveOnFix is enabled; runs after the edit is applied
		 * (LSP guarantees edit-then-command ordering).
		 */
		const saveAfterFixCommand = commands.registerCommand('phpcs.saveAfterFix', async (uri?: string) => {
			const document = uri
				? workspace.textDocuments.find(candidate => candidate.uri.toString() === uri)
				: window.activeTextEditor?.document;
			if (document && document.isDirty) {
				await document.save();
			}
		});
```

Add `saveAfterFixCommand` to the same `context.subscriptions.push(...)` call as `previewFixesCommand`.

- [ ] **Step 2: Compile**

Run: `npm run compile`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add phpcs/src/extension.ts
git commit -m "feat: register internal phpcs.saveAfterFix command"
```

---

### Task 10: Integration tests with real PHPCBF

**Files:**

- Test: `phpcs-server/test/fixer.test.ts` (extend — it already resolves the real phpcbf executable and skips when absent; follow its existing `skipTests` pattern and imports)

**Interfaces:**

- Consumes: `PhpcbfFixer.fix(document, settings, sniffs?)` (Task 5), `computeMinimalEdits` (Task 2).

- [ ] **Step 1: Add the sniff-scoping suite**

Fixture (verified against PHPCS/PHPCBF 4.0.1 with `--standard=PSR12`; keep byte-exact — the header-blank-line and spacing violations are load-bearing):

```typescript
	suite('sniff-scoped fixes', () => {
		// Violations: PSR12.Files.FileHeader (line 1), PSR12.Operators.OperatorSpacing
		// (line 2, x2), Squiz.ControlStructures.ControlSignature (line 3, x2).
		const FIXTURE = '<?php\n$a=1;\nif($a){\n    echo $a;\n}\n';

		function makeDocument(content: string): TextDocument {
			return TextDocument.create('file:///sniff-fixture.php', 'php', 1, content);
		}

		test('should fix only the requested sniff', async function () {
			if (skipTests) { this.skip(); }
			const fixer = await PhpcbfFixer.create(phpcbfPath!);
			const settings = makeSettings({ standard: 'PSR12' });
			const result = await fixer.fix(makeDocument(FIXTURE), settings, ['PSR12.Operators.OperatorSpacing']);
			assert.strictEqual(result.error, undefined);
			assert.ok(result.content.includes('$a = 1;'), 'operator spacing fixed');
			assert.ok(result.content.includes('if($a){'), 'other sniffs untouched');
		});

		test('should fix everything without a sniff restriction', async function () {
			if (skipTests) { this.skip(); }
			const fixer = await PhpcbfFixer.create(phpcbfPath!);
			const settings = makeSettings({ standard: 'PSR12' });
			const result = await fixer.fix(makeDocument(FIXTURE), settings);
			assert.strictEqual(result.error, undefined);
			assert.ok(result.content.includes('$a = 1;'));
			assert.ok(result.content.includes('if ($a) {'));
		});

		test('minimal edits round-trip the real phpcbf output', async function () {
			if (skipTests) { this.skip(); }
			const fixer = await PhpcbfFixer.create(phpcbfPath!);
			const settings = makeSettings({ standard: 'PSR12' });
			const result = await fixer.fix(makeDocument(FIXTURE), settings);
			const edits = computeMinimalEdits(FIXTURE, result.content);
			const applied = TextDocument.applyEdits(makeDocument(FIXTURE), edits);
			assert.strictEqual(applied, result.content);
			assert.ok(edits.length >= 2, 'edits are minimal, not one whole-file replace');
		});
	});
```

Adapt helper names (`skipTests`, `phpcbfPath`, `makeSettings`) to what `fixer.test.ts` actually uses — read the file first; if it lacks a `makeSettings` override helper, build the settings object inline copying an existing test's literal and setting `standard: 'PSR12'`.

- [ ] **Step 2: Run with real phpcbf**

Run: `PHPCS_PATH=<path-to-phpcs> npm run test:server` (integration tests derive phpcbf from the phpcs path; check the file's convention — there may be a separate `PHPCBF_PATH`). Without a local phpcbf the new tests must self-skip; CI runs them on all six PHPCS matrix jobs.
Expected: PASS locally with the scratchpad composer install, and `npm run test:server:unit` still green.

- [ ] **Step 3: Commit**

```bash
git add phpcs-server/test/fixer.test.ts
git commit -m "test: integration coverage for sniff-scoped fixes and minimal-edit round-trip"
```

---

### Task 11: Documentation and final verification

**Files:**

- Modify: `phpcs/README.md` (the "Formatting" section added by #23)
- Modify: `phpcs/CHANGELOG.md` (Unreleased)

**Interfaces:** none — docs only.

- [ ] **Step 1: README**

In `phpcs/README.md`, extend the Formatting/Fixing documentation with a "Previewing and selectively applying fixes" subsection covering: the **PHPCS: Preview PHPCBF fixes** command and the Refactor Preview panel (uncheck to reject); per-sniff quick fixes from the lightbulb ("Fix all 'X' violations in this file"); the `phpcs.phpcbfSaveOnFix` setting; and the `"editor.codeActionsOnSave": { "source.fixAll.phpcs": "explicit" }` snippet. Keep the existing document tone and heading levels.

- [ ] **Step 2: CHANGELOG**

Add a new `## [Unreleased]` section above `## [1.3.0]` with:

```markdown
## [Unreleased]

### Added

- **Preview PHPCBF fixes with per-change accept/reject**: the new
  `PHPCS: Preview PHPCBF fixes` command opens VS Code's native Refactor
  Preview panel — uncheck any change you don't want before applying
  ([#18](https://github.com/JohnRDOrazio/vscode-phpcs/issues/18))
- **Sniff-scoped quick fixes**: diagnostics now offer
  "Fix all '<Sniff>' violations in this file (PHPCBF)" from the lightbulb,
  powered by `phpcbf --sniffs`
- **`phpcs.phpcbfSaveOnFix` setting** (default `false`): automatically save
  the document after a PHPCBF quick fix is applied
- **`source.fixAll.phpcs` code action kind**: enables
  `"editor.codeActionsOnSave": { "source.fixAll.phpcs": "explicit" }`

### Changed

- PHPCBF fixes (including the #23 document formatter) now apply **minimal
  text edits** instead of replacing the whole document — the cursor no
  longer jumps on format-on-save, and undo history stays clean
```

- [ ] **Step 3: Lint and full validation**

Run: `npm run lint:md && npm run compile && npm run test:server && npm run bundle-dev`
Expected: all green.

- [ ] **Step 4: Final manual verification checklist (user)**

Ask the user to F5 and verify against a real PHP project: preview command → uncheck one change → Apply → only checked changes land; lightbulb shows fix-all + per-sniff actions; sniff fix fixes only that sniff; `phpcbfSaveOnFix: true` saves after a fix; formatter and `phpcbfOnSave` still work; undo reverts a fix in one step.

- [ ] **Step 5: Commit**

```bash
git add phpcs/README.md phpcs/CHANGELOG.md
git commit -m "docs: document PHPCBF fix preview, sniff fixes, and phpcbfSaveOnFix"
```
