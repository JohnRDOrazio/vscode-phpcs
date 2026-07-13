# Design: Register as VS Code Document Formatter (issue #23)

**Date:** 2026-07-13
**Issue:** [#23](https://github.com/JohnRDOrazio/vscode-phpcs/issues/23)
**Status:** Approved

## Problem

Users configure `"[php]": { "editor.defaultFormatter": "johnrdorazio.vscode-phpcs" }`
and expect **Format Document** (and `editor.formatOnSave`) to work, but the
extension never registers as a formatter — fixing is only reachable through the
custom `PHPCS: Fix this file with PHPCBF` command. VS Code reports "no
formatter exists for PHP files".

## Goals

Expose the existing PHPCBF fix pipeline through the standard LSP
`textDocument/formatting` request so `editor.defaultFormatter`,
Format Document, and `editor.formatOnSave` work for PHP files.

## Decisions (from brainstorming)

| Question | Decision |
| --- | --- |
| Gating | Formatting requires `phpcs.phpcbfEnable` (default true), independent of `phpcbfOnSave`. When disabled, show a **warning toast** and return no edits. |
| Error surfacing | Format Document is explicit: PHPCBF failures show an **error toast** (like the fix command). The on-save path keeps its silent log-only behavior. |
| `phpcbfOnSave` overlap | Keep both save-time paths unchanged; document the overlap and recommend enabling only one. No deprecation, no auto-suppression. |
| Architecture | Static LSP capability (`documentFormattingProvider: true`) + `onDocumentFormatting` handler on the server. No client code — `vscode-languageclient` auto-registers the formatter from the capability. |

## Server changes (`phpcs-server/src/server.ts`)

### Capability and wiring

- `onInitialize()` adds `documentFormattingProvider: true` to the returned
  capabilities (alongside `codeActionProvider`).
- The constructor's handler registration block adds:
  `this.connection.onDocumentFormatting(this.safeEventHandler(this.onDocumentFormatting));`

### Shared helper (refactor)

The fix-to-edits body of `onWillSaveTextDocument()` — in-flight dedup via
`fixingDocuments`, `PhpcbfFixer.create()` + `setLogger` + `fix()`, content
comparison, `createFullDocumentEdit()` — is extracted into one private method
used by both paths:

```typescript
private async computeFixEdits(
	document: TextDocument,
	settings: PhpcsSettings,
	phpcbfPath: string,
	surfaceErrors: boolean
): Promise<TextEdit[]>
```

- `surfaceErrors: false` (on-save): behavior identical to today — failures are
  logged (`PhpcbfOnSaveFailed`) and never block saving; no toasts.
- `surfaceErrors: true` (formatting): `result.error` and thrown errors show
  `showErrorMessage` (`PhpcbfErrorMessage`) in addition to the log;
  `result.hasUnfixableIssues` shows the existing `PhpcbfUnfixableIssues`
  info notice.
- Dedup semantics are unchanged: if a fix is already in progress for the uri,
  return `[]` and log the skip. The method registers its own operation in
  `fixingDocuments` and cleans up in `finally`, as the current code does.

`onWillSaveTextDocument()` becomes a thin wrapper: document/language/settings
gates as today, then `computeFixEdits(..., false)`.

### New handler

```typescript
private async onDocumentFormatting(params: DocumentFormattingParams): Promise<TextEdit[]>
```

1. Document missing from `this.documents`, or `languageId !== 'php'` → `[]`.
2. `!settings.phpcbfEnable` → `showWarningMessage` with a new string resource
   (see below) and `[]`. Because `editor.formatOnSave` also issues
   `textDocument/formatting` (indistinguishable from an explicit
   Format Document), the warning is shown **at most once per session**: a
   private boolean flag on the server, reset in `onDidChangeConfiguration()`
   so re-enabling awareness survives settings changes. Every occurrence is
   still logged.
3. `resolvePhpcbfPath()` returns null → the existing "PHPCBF executable not
   found" warning message (same text as `fixDocument()`) and `[]`.
4. Otherwise → `computeFixEdits(document, settings, phpcbfPath, true)`.

The LSP `FormattingOptions` in `params.options` (tabSize, insertSpaces) are
**ignored**: PHPCBF formats according to the resolved coding standard, not
editor preferences. Documented in the README.

Range formatting (`documentRangeFormattingProvider`) is **not** registered:
phpcbf cannot format a sub-range of a document.

### String resources (`phpcs-server/src/strings.ts`)

New entry in the PHPCBF block:

```typescript
static readonly PhpcbfDisabledWarning: string = 'PHPCBF is disabled. Enable phpcs.phpcbfEnable to use Format Document.';
```

All other messages reuse existing resources (`PhpcbfErrorMessage`,
`PhpcbfUnfixableIssues`, `PhpcbfOnSaveFailed`).

## Client changes

None. `vscode-languageclient` auto-registers a document formatting provider
for the existing `{ scheme: 'file', language: 'php' }` selector when the
server declares the capability. No new settings in `phpcs/package.json`.

## Edge cases

- **Dirty buffers**: formatting runs on the in-memory content via stdin — no
  forced save (unlike the `phpcs.fixCurrentFile` command).
- **Empty documents / ignored files**: the fixer's existing early returns
  produce an unfixed `FixResult` → no edits, no toast.
- **Already-clean files**: content comparison yields no edits.
- **Timeout**: surfaces as `result.error` → error toast on the formatting
  path (`PhpcbfTimeoutError` text).
- **`editor.formatOnSave` + `phpcs.phpcbfOnSave` both enabled**: both paths
  run sequentially on save; the second finds nothing to fix. Documented, not
  suppressed.
- **Concurrent format/save/fix-command**: the shared `fixingDocuments` map
  dedups; the later request returns no edits and logs the skip.

## Documentation

- `phpcs/README.md`: new "Formatting" section after the PHPCBF Configuration
  section covering: setting the default formatter for PHP, `editor.formatOnSave`,
  Format Selection being unsupported (whole-document only), formatting following
  the coding standard rather than editor tab/space preferences, and the
  `phpcbfOnSave` overlap guidance (both work; enable only one;
  `editor.formatOnSave` is the VS Code-idiomatic choice, `phpcs.phpcbfOnSave`
  works without a default formatter).
- `phpcs/CHANGELOG.md`: Unreleased → Added entry referencing issue #23.

## Testing

- **Regression safety**: the refactor keeps `computeFixEdits` behavior
  identical for the on-save path; the full existing suite (including fixer
  integration tests, which run against a real phpcbf in CI) must pass.
- **Manual F5 checklist**:
  1. With the reporter's exact config (`editor.defaultFormatter` for `[php]`),
     Format Document reformats a non-compliant file.
  2. `editor.formatOnSave: true` formats on save.
  3. `phpcs.phpcbfEnable: false` → warning toast, no edits.
  4. Format Selection is not offered for PHP files.
  5. Formatting an unsaved (dirty) buffer works without saving first.
