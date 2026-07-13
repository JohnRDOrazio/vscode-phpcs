# Document Formatter Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Register the extension as a VS Code document formatter for PHP so `editor.defaultFormatter`, Format Document, and `editor.formatOnSave` run PHPCBF (issue #23).

**Architecture:** The language server declares `documentFormattingProvider: true` and handles `textDocument/formatting` by running the existing PHPCBF fixer on the in-memory document and returning a full-document `TextEdit`. The fix-to-edits logic shared with the on-save path is extracted into one private method, `computeFixEdits()`. No client changes — `vscode-languageclient` auto-registers the formatter from the capability.

**Tech Stack:** TypeScript 5, vscode-languageserver v9, Mocha (TDD interface) via tsx.

**Spec:** `docs/superpowers/specs/2026-07-13-document-formatter-design.md`

## Global Constraints

- Run all npm commands from the repository **root**.
- Code style: tabs for indentation, single quotes, JSDoc comments on methods.
- No new dependencies. No new settings. No client-side code changes.
- `phpcs-server/src/server.ts` has no unit-test infrastructure; each task's verification gate is `npm run compile && npm test` (the fixer integration tests exercise the PHPCBF pipeline against a real phpcbf when available), plus the manual F5 checklist in Task 3.
- Behavior contract from the spec: on-save path stays log-only on failure (never blocks saving); the formatting path surfaces errors with toasts; the disabled-state warning toast shows **at most once per session** and the flag resets in `onDidChangeConfiguration()`.
- Commit messages end with: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`

---

### Task 1: Extract `computeFixEdits()` shared helper

**Files:**
- Modify: `phpcs-server/src/strings.ts` (PHPCBF block, after `PhpcbfErrorMessage`)
- Modify: `phpcs-server/src/server.ts` (`onWillSaveTextDocument` ~line 227, `fixDocument` ~line 395)

**Interfaces:**
- Consumes: `PhpcbfFixer.create/setLogger/fix`, `createFullDocumentEdit`, `this.fixingDocuments` — all existing.
- Produces: `private async computeFixEdits(document: TextDocument, settings: PhpcsSettings, phpcbfPath: string, surfaceErrors: boolean): Promise<TextEdit[]>` — Task 2's formatting handler calls it with `surfaceErrors: true`. Also string resources `PhpcbfDisabledWarning` and `PhpcbfExecutableNotFoundWarning` (used in Task 2).

- [ ] **Step 1: Add the string resources**

In `phpcs-server/src/strings.ts`, after the `PhpcbfErrorMessage` line, add:

```typescript
	static readonly PhpcbfDisabledWarning: string = 'PHPCBF is disabled. Enable phpcs.phpcbfEnable to use Format Document.';
	static readonly PhpcbfExecutableNotFoundWarning: string = 'PHPCBF executable not found. Please set phpcs.phpcbfExecutablePath or ensure phpcbf is alongside phpcs.';
```

- [ ] **Step 2: Add `computeFixEdits()` to `server.ts`**

Insert this method immediately after `onWillSaveTextDocument()`:

```typescript
	/**
	 * Run PHPCBF on a document and return the resulting text edits.
	 *
	 * Shared by the on-save fix path and the document formatting handler.
	 * Registers the operation in fixingDocuments for concurrency control.
	 *
	 * @param document The text document to fix.
	 * @param settings The PHPCS settings for the document.
	 * @param phpcbfPath Path to the PHPCBF executable.
	 * @param surfaceErrors When true (explicit formatting), failures show an
	 *                      error toast and unfixable issues show an info
	 *                      notice; when false (on-save), failures are logged
	 *                      only and never block saving.
	 * @return The edits to apply, or an empty array.
	 */
	private async computeFixEdits(
		document: TextDocument,
		settings: PhpcsSettings,
		phpcbfPath: string,
		surfaceErrors: boolean
	): Promise<TextEdit[]> {
		const uri = document.uri;

		// Check if a fix is already in progress for this document.
		// Note: A small race window exists where two callers could both pass this check
		// before either registers in fixingDocuments. This is acceptable since double-fixing
		// is a UX annoyance rather than a correctness issue, and the window is small in practice.
		if (this.fixingDocuments.has(uri)) {
			this.connection.console.log(`[PHPCBF] Fix already in progress for: ${uri}, skipping duplicate request`);
			return [];
		}

		const fixOperation = (async (): Promise<TextEdit[]> => {
			try {
				const fixer = await PhpcbfFixer.create(phpcbfPath);
				fixer.setLogger((message) => this.connection.console.log(message));

				const result = await fixer.fix(document, settings);

				if (result.error) {
					if (surfaceErrors) {
						this.connection.window.showErrorMessage(strings.format(SR.PhpcbfErrorMessage, result.error));
					} else {
						this.connection.console.error(strings.format(SR.PhpcbfOnSaveFailed, result.error));
					}
					return [];
				}

				if (surfaceErrors && result.hasUnfixableIssues) {
					this.connection.window.showInformationMessage(SR.PhpcbfUnfixableIssues);
				}

				if (result.fixed && result.content !== document.getText()) {
					return [createFullDocumentEdit(document, result.content)];
				}
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				if (surfaceErrors) {
					this.connection.console.error(strings.format(SR.PhpcbfError, message));
					this.connection.window.showErrorMessage(strings.format(SR.PhpcbfErrorMessage, message));
				} else {
					// Log error but don't block save
					this.connection.console.error(strings.format(SR.PhpcbfOnSaveFailed, message));
				}
			}
			return [];
		})();

		// Track for concurrency control across on-save, formatting, and command-based fixes
		this.fixingDocuments.set(uri, fixOperation.then((): void => undefined, (): void => undefined));
		try {
			return await fixOperation;
		} finally {
			this.fixingDocuments.delete(uri);
		}
	}
```

Two deliberate, minor behavior refinements over the current on-save code (both improvements, keep them):
1. A `result.error` on the on-save path is now logged via `PhpcbfOnSaveFailed` (previously it fell through silently).
2. The dedup log message is unified to `skipping duplicate request` (the on-save variant said `skipping on-save fix`).

- [ ] **Step 3: Reduce `onWillSaveTextDocument()` to a thin wrapper**

Replace everything in `onWillSaveTextDocument()` from the `// Check if a fix is already in progress` comment through the method's final `}` (keeping the early gates) so the method reads:

```typescript
	private async onWillSaveTextDocument(params: WillSaveTextDocumentParams): Promise<TextEdit[]> {
		const document = this.documents.get(params.textDocument.uri);
		if (!document) {
			return [];
		}

		// Only process PHP files
		if (document.languageId !== 'php') {
			return [];
		}

		const settings = await this.getDocumentSettings(document);

		// Check if PHPCBF on save is enabled
		if (!settings.phpcbfEnable || !settings.phpcbfOnSave) {
			return [];
		}

		const phpcbfPath = this.resolvePhpcbfPath(settings);
		if (!phpcbfPath) {
			return [];
		}

		return this.computeFixEdits(document, settings, phpcbfPath, false);
	}
```

- [ ] **Step 4: Reuse the executable-not-found resource in `fixDocument()`**

In `fixDocument()`, replace:

```typescript
			this.connection.window.showWarningMessage(
				'PHPCBF executable not found. Please set phpcs.phpcbfExecutablePath or ensure phpcbf is alongside phpcs.'
			);
```

with:

```typescript
			this.connection.window.showWarningMessage(SR.PhpcbfExecutableNotFoundWarning);
```

- [ ] **Step 5: Verify compile and tests**

Run: `npm run compile && npm test`
Expected: compile clean; all tests pass (236 server + 1 client at time of writing).

- [ ] **Step 6: Commit**

```bash
git add phpcs-server/src/strings.ts phpcs-server/src/server.ts
git commit -m "refactor(server): extract computeFixEdits from on-save fix path

Prepares for the document formatting handler (#23).

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: `textDocument/formatting` handler and capability

**Files:**
- Modify: `phpcs-server/src/server.ts` (imports ~line 10-28, fields ~line 52, constructor ~line 105, `onInitialize` ~line 160, `onDidChangeConfiguration`, new handler after `computeFixEdits`)

**Interfaces:**
- Consumes: `computeFixEdits(document, settings, phpcbfPath, true)`, `SR.PhpcbfDisabledWarning`, `SR.PhpcbfExecutableNotFoundWarning` from Task 1; existing `resolvePhpcbfPath`, `getDocumentSettings`.
- Produces: the `textDocument/formatting` LSP endpoint. Nothing downstream consumes code from this task.

- [ ] **Step 1: Add the import**

In the `vscode-languageserver/node` import list, after `DidChangeWatchedFilesParams,` add:

```typescript
	DocumentFormattingParams,
```

- [ ] **Step 2: Add the warn-once field**

After the `private fixingDocuments: Map<string, Promise<void>>;` declaration, add:

```typescript
	// Show the "PHPCBF is disabled" formatting warning at most once per session
	private phpcbfDisabledWarningShown: boolean = false;
```

- [ ] **Step 3: Register the handler**

In the constructor, after the `onWillSaveTextDocumentWaitUntil` line, add:

```typescript
		this.connection.onDocumentFormatting(this.safeEventHandler(this.onDocumentFormatting));
```

- [ ] **Step 4: Declare the capability**

In `onInitialize()`, after `codeActionProvider: true,` add:

```typescript
				documentFormattingProvider: true,
```

- [ ] **Step 5: Reset the warn-once flag on configuration change**

In `onDidChangeConfiguration()`, as the first statement of the method body, add:

```typescript
		this.phpcbfDisabledWarningShown = false;
```

- [ ] **Step 6: Add the handler**

Insert immediately after `computeFixEdits()`:

```typescript
	/**
	 * Handles textDocument/formatting requests by running PHPCBF on the document.
	 *
	 * The LSP formatting options (tab size, spaces) are ignored: PHPCBF formats
	 * according to the resolved coding standard, not editor preferences.
	 *
	 * @param params The document formatting parameters.
	 * @return Text edits that reformat the document, or an empty array.
	 */
	private async onDocumentFormatting(params: DocumentFormattingParams): Promise<TextEdit[]> {
		const document = this.documents.get(params.textDocument.uri);
		if (!document || document.languageId !== 'php') {
			return [];
		}

		const settings = await this.getDocumentSettings(document);

		if (!settings.phpcbfEnable) {
			this.connection.console.log(SR.PhpcbfDisabledWarning);
			// editor.formatOnSave issues the same request on every save; warn once per session.
			if (!this.phpcbfDisabledWarningShown) {
				this.phpcbfDisabledWarningShown = true;
				this.connection.window.showWarningMessage(SR.PhpcbfDisabledWarning);
			}
			return [];
		}

		const phpcbfPath = this.resolvePhpcbfPath(settings);
		if (!phpcbfPath) {
			this.connection.window.showWarningMessage(SR.PhpcbfExecutableNotFoundWarning);
			return [];
		}

		return this.computeFixEdits(document, settings, phpcbfPath, true);
	}
```

- [ ] **Step 7: Verify compile, tests, and bundles**

Run: `npm run compile && npm test && npm run bundle-dev`
Expected: compile clean; all tests pass; `phpcs/dist/` bundles build.

- [ ] **Step 8: Commit**

```bash
git add phpcs-server/src/server.ts
git commit -m "feat(server): register as document formatter via LSP

Format Document, editor.defaultFormatter, and editor.formatOnSave now
run PHPCBF on the in-memory document.

Closes #23

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Documentation and manual verification

**Files:**
- Modify: `phpcs/README.md` (insert before the `## Advanced Configuration` heading, ~line 294)
- Modify: `phpcs/CHANGELOG.md` (`## [Unreleased]` → `### Added`, after the resolved-standard bullet)

**Interfaces:**
- Consumes: the feature from Tasks 1-2. Produces: user-facing docs; nothing downstream.

- [ ] **Step 1: README Formatting section**

Insert immediately before the `## Advanced Configuration` heading:

````markdown
## Formatting

The extension registers as a document formatter for PHP files, so PHPCBF can
be used through VS Code's standard formatting commands:

```json
"[php]": {
  "editor.defaultFormatter": "johnrdorazio.vscode-phpcs",
  "editor.formatOnSave": true
}
```

With this configuration, **Format Document** and format-on-save run PHPCBF on
the current buffer (unsaved changes included) using the resolved coding
standard.

Notes:

- **Format Selection** is not supported: PHPCBF can only fix whole documents.
- Editor indentation preferences (tab size, spaces) are ignored — formatting
  follows the coding standard, like running `phpcbf` on the command line.
- Formatting requires `phpcs.phpcbfEnable` (on by default). When disabled,
  Format Document shows a warning instead.
- `editor.formatOnSave` and `phpcs.phpcbfOnSave` both fix on save — enable
  only one. Prefer `editor.formatOnSave` if you set a default formatter;
  `phpcs.phpcbfOnSave` works without one.
````

- [ ] **Step 2: CHANGELOG entry**

In `phpcs/CHANGELOG.md`, under `## [Unreleased]` → `### Added`, after the
resolved-standard bullet, add:

```markdown
- **Document formatter support**: the extension registers as a VS Code
  formatter for PHP, so `editor.defaultFormatter`, **Format Document**, and
  `editor.formatOnSave` now run PHPCBF on the current buffer
  ([#23](https://github.com/JohnRDOrazio/vscode-phpcs/issues/23))
```

- [ ] **Step 3: Lint the markdown**

Run: `npm run lint:md`
Expected: PASS (run `npm run lint:md:fix` on failures, then re-check).

- [ ] **Step 4: Full verification**

Run: `npm run compile && npm test && npm run bundle-dev`
Expected: all clean/PASS.

- [ ] **Step 5: Manual verification (F5 Extension Development Host)**

With `npm run bundle-dev` built, launch **Run and Debug → Launch Extension**:

1. Settings: `"[php]": { "editor.defaultFormatter": "johnrdorazio.vscode-phpcs" }`.
   Open a non-PSR12 PHP file → **Format Document** (Shift+Alt+F) reformats it.
2. Add `"editor.formatOnSave": true` → saving reformats.
3. Type changes without saving, Format Document → the dirty buffer is
   formatted without a save.
4. Set `"phpcs.phpcbfEnable": false` → Format Document shows the warning
   toast once; further attempts only log.
5. Select code → the Format Selection command is not offered for PHP.

- [ ] **Step 6: Commit**

```bash
git add phpcs/README.md phpcs/CHANGELOG.md
git commit -m "docs: document formatter usage and phpcbfOnSave overlap

Refs #23

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```
