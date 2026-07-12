# Resolved Coding Standard Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the coding standard that phpcs actually used for each file visible in the server log and in a clickable VS Code status bar item (issue #21).

**Architecture:** The language server's `lint()` starts returning the resolved standard alongside diagnostics; the existing custom `textDocument/didEndValidate` notification carries it to the client; the client shows it in a persistent status bar item with a `phpcs.openStandard` click command. PHPCBF logs the standard server-side only.

**Tech Stack:** TypeScript 5, vscode-languageserver/-client v9, Mocha (TDD interface: `suite`/`test`) via tsx.

**Spec:** `docs/superpowers/specs/2026-07-12-resolved-standard-visibility-design.md`

## Global Constraints

- Run all npm commands from the repository **root**.
- Code style: tabs for indentation, single quotes, JSDoc comments on public methods (per CLAUDE.md).
- The two protocol files `phpcs-server/src/protocol.ts` and `phpcs/src/protocol.ts` are near-identical copies (different import package). Any change to notification params must be made in **both**.
- No new dependencies.
- Commit messages end with: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
- Payload semantics used throughout: `standard` is `undefined` = unknown (lint error), `null` = phpcs default (nothing resolved), `string` = resolved standard name or config file path.

---

### Task 1: `lint()` returns the resolved standard

**Files:**
- Modify: `phpcs-server/src/linter.ts` (interface + `lint()` at line 108)
- Modify: `phpcs-server/src/server.ts:613` (call site)
- Test: `phpcs-server/test/linter-utils.test.ts`

**Interfaces:**
- Consumes: `resolveStandard(settings, filePath)` from `linter-utils.ts` (already exists, unchanged).
- Produces: `export interface PhpcsLintResult { diagnostics: Diagnostic[]; standard: string | null }` in `phpcs-server/src/linter.ts`; `PhpcsLinter.lint(document, settings): Promise<PhpcsLintResult>`. Task 2 relies on both.

- [ ] **Step 1: Write characterization tests for `resolveStandard`**

These lock in the exact values `lint()` will start reporting. In `phpcs-server/test/linter-utils.test.ts`, extend the imports at the top:

```typescript
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
```

Add `resolveStandard` to the existing `from '../src/linter-utils'` import list (it's alphabetized — insert between `prepareFileText` and `shouldIgnoreFile`).

Add this suite inside the top-level `suite('Linter Utils', () => {` block, at the end before its closing `});`:

```typescript
	suite('resolveStandard', () => {

		let tmpDir: string;

		setup(() => {
			tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'phpcs-resolve-test-'));
		});

		teardown(() => {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		});

		function makeSettings(overrides: Partial<{ autoConfigSearch: boolean; standard: string | null; workspaceRoot: string | null; ignorePatterns: string[] }> = {}) {
			return {
				autoConfigSearch: true,
				standard: null,
				workspaceRoot: tmpDir,
				ignorePatterns: [],
				...overrides,
			};
		}

		test('returns the auto-detected config file path when one exists', async () => {
			const rulesetPath = path.join(tmpDir, '.phpcs.xml');
			fs.writeFileSync(rulesetPath, '<?xml version="1.0"?><ruleset/>');
			fs.mkdirSync(path.join(tmpDir, 'src'));
			const filePath = path.join(tmpDir, 'src', 'file.php');
			const result = await resolveStandard(makeSettings(), filePath);
			assert.strictEqual(result, rulesetPath);
		});

		test('returns the configured standard when no config file exists', async () => {
			const filePath = path.join(tmpDir, 'file.php');
			const result = await resolveStandard(makeSettings({ standard: 'PSR12' }), filePath);
			assert.strictEqual(result, 'PSR12');
		});

		test('returns null when no config file exists and no standard is configured', async () => {
			const filePath = path.join(tmpDir, 'file.php');
			const result = await resolveStandard(makeSettings(), filePath);
			assert.strictEqual(result, null);
		});

		test('falls back to the configured standard for ignored files', async () => {
			fs.writeFileSync(path.join(tmpDir, '.phpcs.xml'), '<?xml version="1.0"?><ruleset/>');
			fs.mkdirSync(path.join(tmpDir, 'vendor'));
			const filePath = path.join(tmpDir, 'vendor', 'file.php');
			const result = await resolveStandard(
				makeSettings({ standard: 'PSR12', ignorePatterns: ['**/vendor/**'] }),
				filePath
			);
			assert.strictEqual(result, 'PSR12');
		});
	});
```

- [ ] **Step 2: Run the new tests**

Run: `npm run test:server:unit`
Expected: PASS (these are characterization tests of the existing `resolveStandard`; they pin down the values the rest of the plan reports).

- [ ] **Step 3: Add `PhpcsLintResult` and change `lint()`'s return type**

In `phpcs-server/src/linter.ts`, immediately above the `PhpcsLinter` class declaration, add:

```typescript
/**
 * Result of a lint run: the diagnostics produced and the coding standard
 * that was resolved for the run (null when phpcs used its own default).
 */
export interface PhpcsLintResult {
	diagnostics: Diagnostic[];
	standard: string | null;
}
```

Change the `lint()` signature (line 108):

```typescript
	public async lint(document: TextDocument, settings: PhpcsSettings): Promise<PhpcsLintResult> {
```

Update every return statement in `lint()`:

1. Empty-text early return (`// Return empty on empty text.`, before `resolveStandard` runs):

```typescript
		if (fileText === '') {
			return { diagnostics: [], standard: null };
		}
```

2. Ignored-file return for PHPCS < 3.0.0 (the `semver.gte(this.executableVersion, '3.0.0')` block just after `resolveStandard`):

```typescript
			return { diagnostics: [], standard: null };
```

3. The two `return [];` inside the message-extraction section (missing file key for v2+, missing `STDIN` key for v1) — the `standard` variable is in scope here:

```typescript
				return { diagnostics: [], standard };
```

4. The final return:

```typescript
		return {
			diagnostics: messages.map(message =>
				createDiagnosticFromMessage(document, message, settings.showSources)
			),
			standard,
		};
```

- [ ] **Step 4: Compile to find the broken call site**

Run: `npm run compile`
Expected: FAIL with a TS2322-style error at `phpcs-server/src/server.ts:613` (`PhpcsLintResult` is not assignable to `Diagnostic[]`). This confirms the only caller.

- [ ] **Step 5: Fix the call site minimally**

In `phpcs-server/src/server.ts:613`, change:

```typescript
				diagnostics = await phpcs.lint(document, settings);
```

to:

```typescript
				diagnostics = (await phpcs.lint(document, settings)).diagnostics;
```

(Task 2 will capture `standard` here; keep this task minimal.)

- [ ] **Step 6: Verify compile and full test suite**

Run: `npm run compile && npm run test:server`
Expected: compile clean, all tests PASS.

- [ ] **Step 7: Commit**

```bash
git add phpcs-server/src/linter.ts phpcs-server/src/server.ts phpcs-server/test/linter-utils.test.ts
git commit -m "feat(server): return resolved coding standard from lint()

Refs #21

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Notification payload and server log line

**Files:**
- Modify: `phpcs-server/src/protocol.ts` (`DidEndValidateTextDocumentParams`)
- Modify: `phpcs-server/src/strings.ts:11`
- Modify: `phpcs-server/src/server.ts` (`validateSingle` ~line 603-621, `sendEndValidationNotification` ~line 545-559)

**Interfaces:**
- Consumes: `PhpcsLintResult` from Task 1.
- Produces: `DidEndValidateTextDocumentParams.standard?: string | null` (server copy — Task 4 mirrors it client-side); log strings `DidEndValidateTextDocument` (2 params) and `DidEndValidateTextDocumentNoStandard` (1 param).

- [ ] **Step 1: Extend the notification params (server copy)**

In `phpcs-server/src/protocol.ts`, inside `DidEndValidateTextDocumentParams`, after the `buffered` member:

```typescript
	/**
	 * The coding standard resolved for the lint run.
	 * `undefined` when unknown (lint error), `null` when phpcs used its default.
	 */
	standard?: string | null;
```

- [ ] **Step 2: Update the string resources**

In `phpcs-server/src/strings.ts`, replace line 11:

```typescript
	static readonly DidEndValidateTextDocument: string = 'Linting completed on: {0} using standard: {1}';
	static readonly DidEndValidateTextDocumentNoStandard: string = 'Linting completed on: {0}';
```

- [ ] **Step 3: Thread the standard through `validateSingle`**

In `phpcs-server/src/server.ts`, in `validateSingle()`, replace the lint block:

```typescript
		if (this.validating.has(uri) === false) {
			let diagnostics: Diagnostic[] = [];
			let standard: string | null | undefined;
			this.sendStartValidationNotification(document);
			try {
				if (!settings.executablePath) {
					// Skip validation silently - the client has already logged a warning
					return;
				}
				const phpcs = await PhpcsLinter.create(settings.executablePath);
				phpcs.setLogger((message) => this.connection.console.log(message));
				const result = await phpcs.lint(document, settings);
				diagnostics = result.diagnostics;
				standard = result.standard;
			} catch(error) {
				this.connection.console.error(`Error during linting: ${error}`);
				throw new Error(this.getExceptionMessage(error, document));
			} finally {
				this.sendDiagnostics({ uri, diagnostics });
				this.sendEndValidationNotification(document, standard);
			}
		} else {
```

(Only the `let standard` declaration, the `const result` destructuring, and the `sendEndValidationNotification` argument are new; the rest is unchanged.)

- [ ] **Step 4: Extend `sendEndValidationNotification`**

Replace the method:

```typescript
	/**
	 * Sends a notification for ending validation of a document.
	 *
	 * @param document The text document on which validation ended.
	 * @param standard The coding standard resolved for the run; undefined when
	 *                 unknown (lint error), null when phpcs used its default.
	 */
	private sendEndValidationNotification(document: TextDocument, standard?: string | null): void {
		this.validating.delete(document.uri);
		this.connection.sendNotification(
			proto.DidEndValidateTextDocumentNotification.type,
			{
				textDocument: TextDocumentIdentifier.create(document.uri),
				buffered: this.queue.size,
				standard
			}
		);
		if (standard === undefined) {
			this.connection.console.log(strings.format(SR.DidEndValidateTextDocumentNoStandard, document.uri));
		} else {
			this.connection.console.log(strings.format(SR.DidEndValidateTextDocument, document.uri, standard ?? 'default'));
		}
	}
```

- [ ] **Step 5: Verify compile and tests**

Run: `npm run compile && npm run test:server`
Expected: compile clean, all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add phpcs-server/src/protocol.ts phpcs-server/src/strings.ts phpcs-server/src/server.ts
git commit -m "feat(server): report resolved standard in didEndValidate and log line

Implements the log format requested in #21.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: PHPCBF log line

**Files:**
- Modify: `phpcs-server/src/strings.ts` (PHPCBF string block, after `PhpcbfFixingDocument`)
- Modify: `phpcs-server/src/fixer.ts` (~line 147, after `resolveStandard` call)

**Interfaces:**
- Consumes: `resolveStandard` result already computed in `fix()`; `this.log()` and `strings.format`/`SR` already imported in `fixer.ts`.
- Produces: log string `PhpcbfUsingStandard` (2 params). Nothing downstream depends on this task.

- [ ] **Step 1: Add the string resource**

In `phpcs-server/src/strings.ts`, after the `PhpcbfFixingDocument` line:

```typescript
	static readonly PhpcbfUsingStandard: string = '[PHPCBF] Fixing: {0} using standard: {1}';
```

(Note: uses the `[PHPCBF]` prefix convention of the surrounding fixer log strings; the spec's plain `Fixing file:` wording is adapted to match.)

- [ ] **Step 2: Log the standard in `fix()`**

In `phpcs-server/src/fixer.ts`, immediately after:

```typescript
		// Resolve coding standard (uses shared utility to find config files)
		const standard = await resolveStandard(settings, filePath);
```

add:

```typescript
		this.log(strings.format(SR.PhpcbfUsingStandard, filePath ?? document.uri, standard ?? 'default'));
```

- [ ] **Step 3: Verify compile and tests**

Run: `npm run compile && npm run test:server`
Expected: compile clean, all tests PASS.

- [ ] **Step 4: Commit**

```bash
git add phpcs-server/src/strings.ts phpcs-server/src/fixer.ts
git commit -m "feat(server): log resolved standard for phpcbf fix runs

Refs #21

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Client plumbing and status bar item

**Files:**
- Modify: `phpcs/src/protocol.ts` (`DidEndValidateTextDocumentParams`)
- Modify: `phpcs/src/status.ts`
- Modify: `phpcs/src/extension.ts` (notification handler at line ~99, listener registration at the `context.subscriptions.push(status)` block)

**Interfaces:**
- Consumes: `event.standard` from the notification (Task 2's payload, mirrored client-side here).
- Produces: `PhpcsStatus.endProcessing(uri, buffered, standard?)`, `PhpcsStatus.updateStandardStatusBar()`, `PhpcsStatus.getStandardForUri(uri): string | null | undefined`, `PhpcsStatus.removeDocument(uri)`. Task 5 relies on `getStandardForUri`.

- [ ] **Step 1: Extend the notification params (client copy)**

In `phpcs/src/protocol.ts`, inside `DidEndValidateTextDocumentParams`, after the `buffered` member (identical to the server copy):

```typescript
	/**
	 * The coding standard resolved for the lint run.
	 * `undefined` when unknown (lint error), `null` when phpcs used its default.
	 */
	standard?: string | null;
```

- [ ] **Step 2: Extend `PhpcsStatus`**

In `phpcs/src/status.ts`:

Add the import at the top (before the vscode import):

```typescript
import * as path from "path";
```

Add two members after `private channel: OutputChannel;`:

```typescript
	private standardStatusBarItem: StatusBarItem;
	private documentStandards: Map<string, string | null> = new Map();
```

Replace `endProcessing` (this also fixes the pre-existing no-op `slice`/`!== undefined` bug in the same method):

```typescript
	public endProcessing(uri: string, buffered: number = 0, standard?: string | null) {
		this.processing -= 1;
		this.buffered = buffered;
		let index = this.documents.indexOf(uri);
		if (index !== -1) {
			this.documents.splice(index, 1);
		}
		if (standard !== undefined) {
			this.documentStandards.set(uri, standard);
		}
		this.updateStandardStatusBar();
		if (this.processing === 0) {
			this.getTimer().stop();
			this.getStatusBarItem().hide();
			this.updateStatusText();
		}
	}
```

Add these methods after `endProcessing`:

```typescript
	/**
	 * Returns the last known resolved standard for a document uri.
	 * `undefined` when never linted, `null` when phpcs used its default.
	 */
	public getStandardForUri(uri: string): string | null | undefined {
		return this.documentStandards.get(uri);
	}

	/**
	 * Forgets the resolved standard for a closed document.
	 */
	public removeDocument(uri: string): void {
		this.documentStandards.delete(uri);
		this.updateStandardStatusBar();
	}

	/**
	 * Shows the resolved standard for the active PHP editor in the status bar,
	 * or hides the item when there is nothing to show.
	 */
	public updateStandardStatusBar(): void {
		const item = this.getStandardStatusBarItem();
		const editor = window.activeTextEditor;
		if (!editor || editor.document.languageId !== 'php') {
			item.hide();
			return;
		}
		const uri = editor.document.uri.toString();
		if (!this.documentStandards.has(uri)) {
			item.hide();
			return;
		}
		const standard = this.documentStandards.get(uri);
		if (standard === null || standard === undefined) {
			item.text = 'phpcs: default';
			item.tooltip = 'Using phpcs default standard';
		} else if (isPathLike(standard)) {
			item.text = `phpcs: ${path.basename(standard)}`;
			item.tooltip = standard;
		} else {
			item.text = `phpcs: ${standard}`;
			item.tooltip = `Standard: ${standard}`;
		}
		item.show();
	}

	private getStandardStatusBarItem(): StatusBarItem {
		// Create as needed
		if (!this.standardStatusBarItem) {
			this.standardStatusBarItem = window.createStatusBarItem(StatusBarAlignment.Left);
		}
		return this.standardStatusBarItem;
	}
```

Add the helper function at module level, after the class's closing brace:

```typescript
/**
 * A standard containing a path separator is a config file path;
 * a bare name (e.g. PSR12) is a built-in standard. String check only —
 * no filesystem I/O in the render path.
 */
function isPathLike(standard: string): boolean {
	return standard.includes('/') || standard.includes('\\');
}
```

In `dispose()`, add before the `this.timer` block:

```typescript
		if (this.standardStatusBarItem) {
			this.standardStatusBarItem.dispose();
		}
```

- [ ] **Step 3: Wire up the client**

In `phpcs/src/extension.ts`, change the end-validate handler (line ~99):

```typescript
		client.onNotification(proto.DidEndValidateTextDocumentNotification.type, event => {
			status.endProcessing(event.textDocument.uri, event.buffered, event.standard);
		});
```

In the `// Only register disposables after successful start` block, after `context.subscriptions.push(fixAllFilesCommand);`, add:

```typescript
		context.subscriptions.push(
			window.onDidChangeActiveTextEditor(() => status.updateStandardStatusBar()),
			workspace.onDidCloseTextDocument(document => status.removeDocument(document.uri.toString()))
		);
```

(`window` and `workspace` are already imported in `extension.ts`.)

- [ ] **Step 4: Verify compile and tests**

Run: `npm run compile && npm test`
Expected: compile clean, all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add phpcs/src/protocol.ts phpcs/src/status.ts phpcs/src/extension.ts
git commit -m "feat(client): show resolved coding standard in status bar

Refs #21

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: `phpcs.openStandard` click command

**Files:**
- Modify: `phpcs/package.json` (`contributes.commands`, line ~47)
- Modify: `phpcs/src/extension.ts` (imports + command registration)
- Modify: `phpcs/src/status.ts` (`getStandardStatusBarItem`)

**Interfaces:**
- Consumes: `status.getStandardForUri(uri)` from Task 4.
- Produces: command id `phpcs.openStandard` (referenced by the status bar item). Nothing downstream depends on this task.

- [ ] **Step 1: Contribute the command**

In `phpcs/package.json`, in the `contributes.commands` array, after the `phpcs.fixWorkspace` entry:

```json
			{
				"command": "phpcs.openStandard",
				"title": "PHPCS: Open the coding standard in use"
			}
```

- [ ] **Step 2: Register the command handler**

In `phpcs/src/extension.ts`, add `Uri` to the `vscode` import list:

```typescript
import {
	CancellationToken,
	commands,
	ExtensionContext,
	ProgressLocation,
	Uri,
	window,
	workspace
} from "vscode";
```

Inside the `client.start().then(() => {` block, after the `fixAllFilesCommand` definition, add:

```typescript
		/**
		 * Command handler for opening the coding standard in use for the active PHP file.
		 * Opens the resolved ruleset file when the standard is an existing file path;
		 * otherwise opens the settings UI filtered to phpcs.standard.
		 */
		const openStandardCommand = commands.registerCommand('phpcs.openStandard', async () => {
			const editor = window.activeTextEditor;
			const standard = editor && editor.document.languageId === 'php'
				? status.getStandardForUri(editor.document.uri.toString())
				: undefined;
			if (typeof standard === 'string') {
				try {
					const fileUri = Uri.file(standard);
					await workspace.fs.stat(fileUri);
					await window.showTextDocument(await workspace.openTextDocument(fileUri));
					return;
				} catch {
					// Not an existing file (built-in standard name or stale path):
					// fall through to the settings UI.
				}
			}
			await commands.executeCommand('workbench.action.openSettings', 'phpcs.standard');
		});
```

And register it with the other disposables — the push block from Task 4 becomes:

```typescript
		context.subscriptions.push(fixFileCommand);
		context.subscriptions.push(fixAllFilesCommand);
		context.subscriptions.push(openStandardCommand);
		context.subscriptions.push(
			window.onDidChangeActiveTextEditor(() => status.updateStandardStatusBar()),
			workspace.onDidCloseTextDocument(document => status.removeDocument(document.uri.toString()))
		);
```

- [ ] **Step 3: Attach the command to the status bar item**

In `phpcs/src/status.ts`, in `getStandardStatusBarItem()`:

```typescript
	private getStandardStatusBarItem(): StatusBarItem {
		// Create as needed
		if (!this.standardStatusBarItem) {
			this.standardStatusBarItem = window.createStatusBarItem(StatusBarAlignment.Left);
			this.standardStatusBarItem.command = 'phpcs.openStandard';
		}
		return this.standardStatusBarItem;
	}
```

- [ ] **Step 4: Verify compile and tests**

Run: `npm run compile && npm test`
Expected: compile clean, all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add phpcs/package.json phpcs/src/extension.ts phpcs/src/status.ts
git commit -m "feat(client): open resolved standard on status bar click

Closes #21

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Documentation and manual verification

**Files:**
- Modify: `phpcs/README.md` (insert before `## Basic Configuration`, line ~82)
- Modify: `phpcs/CHANGELOG.md` (insert after the intro paragraph, before `## [1.2.3]`)

**Interfaces:**
- Consumes: the full feature from Tasks 1-5.
- Produces: user-facing docs; nothing downstream.

- [ ] **Step 1: README section**

In `phpcs/README.md`, insert immediately before the `## Basic Configuration` heading:

```markdown
## Status Bar

While a PHP file is active, the status bar shows the coding standard used for
its most recent lint, e.g. `phpcs: ruleset.xml` or `phpcs: PSR12`
(`phpcs: default` when no standard is configured and none was auto-detected).
Hover to see the full ruleset path. Click to open the resolved ruleset file,
or the `phpcs.standard` setting when the standard is not a file.

The server log ("Output" panel, "PHP Code Sniffer" channel) also reports the
standard for every run: `Linting completed on: <file> using standard: <standard>`.
```

- [ ] **Step 2: CHANGELOG entry**

In `phpcs/CHANGELOG.md`, insert after the intro paragraph (before `## [1.2.3] - 2026-01-10`):

```markdown
## [Unreleased]

### Added

- **Resolved standard visibility**: lint log lines now include
  `using standard: <standard>`, PHPCBF runs log the standard, and a status bar
  item shows the standard used for the active PHP file — click it to open the
  resolved ruleset file (or the `phpcs.standard` setting)
  ([#21](https://github.com/JohnRDOrazio/vscode-phpcs/issues/21))
```

- [ ] **Step 3: Lint the markdown**

Run: `npm run lint:md`
Expected: PASS (run `npm run lint:md:fix` if it flags the new sections, then re-run).

- [ ] **Step 4: Full verification**

Run: `npm run compile && npm test && npm run bundle-dev`
Expected: all clean/PASS; `phpcs/dist/` bundles build.

- [ ] **Step 5: Manual verification (F5 Extension Development Host)**

With `npm run bundle-dev` built, launch **Run and Debug → Launch Extension** and check three scenarios:

1. Workspace containing a `ruleset.xml`/`.phpcs.xml`, `phpcs.standard` unset: open a PHP file → status bar shows `phpcs: <config basename>`; hover shows full path; click opens the ruleset file; Output panel log line ends with `using standard: <path>`.
2. `phpcs.standard: "PSR12"`, no config file: status bar shows `phpcs: PSR12`; click opens Settings filtered to `phpcs.standard`.
3. No standard configured, no config file: status bar shows `phpcs: default`; click opens Settings.

Also: switch to a non-PHP editor → item hides; run "PHPCS: Fix this file with PHPCBF" → server log shows `[PHPCBF] Fixing: <file> using standard: <standard>`.

- [ ] **Step 6: Commit**

```bash
git add phpcs/README.md phpcs/CHANGELOG.md
git commit -m "docs: document resolved-standard status bar and log format

Refs #21

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```
