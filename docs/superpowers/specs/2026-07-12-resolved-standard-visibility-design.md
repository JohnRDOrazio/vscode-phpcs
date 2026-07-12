# Design: Resolved Coding Standard Visibility (issue #21)

**Date:** 2026-07-12
**Issue:** [#21](https://github.com/JohnRDOrazio/vscode-phpcs/issues/21)
**Status:** Approved

## Problem

When `phpcs.standard` is `null` and `phpcs.autoConfigSearch` is enabled, the
extension searches for a ruleset file on its own (`resolveStandard()` in
`phpcs-server/src/linter-utils.ts`). The resolved standard is used to build the
phpcs command line and then discarded — users have no way to see which
ruleset.xml (or built-in standard) was actually used for a given file.

## Goals

1. Log the resolved standard with every lint completion (the literal request
   in issue #21) and with every phpcbf fix run.
2. Surface the resolved standard in the VS Code interface via a status bar
   item with a tooltip and click-to-open behavior.

## Decisions (from brainstorming)

| Question | Decision |
| --- | --- |
| Status bar visibility | Show whenever the active editor is a PHP file with a known resolved standard; hide otherwise. No gating setting. |
| Click behavior | If the standard is a path to an existing file, open it. Otherwise (built-in name, phpcs default, missing file), open VS Code Settings filtered to `phpcs.standard`. |
| PHPCBF scope | Log only. The status bar is fed by lint results; a fix is always followed by a re-lint that refreshes it. |
| Transport | Extend the existing custom `textDocument/didEndValidate` notification with an optional `standard` field. No new notification, no client-side resolution. |

## Server-side changes

### `phpcs-server/src/linter.ts`

`lint()` return type changes from `Promise<Diagnostic[]>` to
`Promise<PhpcsLintResult>`:

```typescript
export interface PhpcsLintResult {
	diagnostics: Diagnostic[];
	standard: string | null; // resolveStandard() result; null = phpcs default
}
```

Early-return paths (empty file text, ignored file on phpcs < 3.0.0) return
`{ diagnostics: [], standard: null }`.

### `phpcs-server/src/server.ts`

- `validateSingle()` captures `{ diagnostics, standard }` from `lint()`.
- `sendEndValidationNotification(document, standard?)` gains an optional
  second parameter, included in the notification payload and in the log line.
- On the error path (`finally` after a thrown lint error), `standard` is
  `undefined`: the notification omits the field and the log line falls back to
  the old format without the standard.

### `phpcs-server/src/protocol.ts` and `phpcs/src/protocol.ts`

`DidEndValidateTextDocumentParams` gains:

```typescript
standard?: string | null;
```

Semantics: `undefined` = unknown (lint error), `null` = phpcs default,
string = resolved standard name or config file path. Client and server ship
together in the same extension, so extending the custom notification is
backward-compatible.

### `phpcs-server/src/strings.ts`

- `DidEndValidateTextDocument` becomes
  `'Linting completed on: {0} using standard: {1}'` where `{1}` is the
  resolved path/name, or `default` when `null`.
- New string for the fixer: `'Fixing file: {0} using standard: {1}'`.

### `phpcs-server/src/fixer.ts`

One log line added right after the existing `resolveStandard()` call, using
the new string resource. No protocol involvement.

`resolveStandard()` and the rest of `linter-utils.ts` are untouched.

## Client-side changes

### `phpcs/src/status.ts` (`PhpcsStatus`)

A second, persistent `StatusBarItem`, separate from the existing transient
spinner item (which keeps its current behavior):

- New state: `documentStandards: Map<string, string | null>` (uri → standard).
- `endProcessing(uri, buffered, standard?)` gains an optional third parameter.
  `standard !== undefined` updates the map; `undefined` (lint error) keeps the
  last-known value.
- New `updateStandardStatusBar()`, called from `endProcessing()` and on
  `window.onDidChangeActiveTextEditor`:
  - Active editor is a PHP file with a map entry → show `phpcs: <label>`:
    basename if the standard contains a path separator (e.g. `.phpcs.xml` for
    `/project/.phpcs.xml` — a string check, no filesystem I/O in the render
    path), the name as-is if built-in (e.g. `PSR12`), `default` if `null`.
  - Tooltip: full resolved path, or `Standard: <name>` /
    `Using phpcs default standard`.
  - No entry, or non-PHP editor → hide the item.
- Map entries are pruned on `workspace.onDidCloseTextDocument`.
- The new status bar item's `command` is `phpcs.openStandard`.

### `phpcs/src/extension.ts`

- The `DidEndValidate` handler passes `event.standard` through to
  `status.endProcessing()`.
- Registers `onDidChangeActiveTextEditor` and `onDidCloseTextDocument`
  listeners (delegating to `PhpcsStatus`) and the `phpcs.openStandard`
  command; all pushed to `context.subscriptions`.

### `phpcs.openStandard` command

Contributed in `phpcs/package.json` as
`PHPCS: Open the coding standard in use` (also available from the command
palette). Handler, for the active editor's resolved standard:

1. String is a path to an existing file → open with `window.showTextDocument`.
2. Otherwise (built-in name, `null`, missing file, no active PHP editor) →
   run `workbench.action.openSettings` with query `phpcs.standard`.

The file-vs-name distinction is a runtime existence check, not provenance
tracking — a user-configured `phpcs.standard` may itself be a path and should
also be click-to-openable.

## Edge cases

- **Non-file URIs / untitled docs**: server already skips them; no map entry,
  item stays hidden. Same for PHP files not yet linted.
- **Lint failure**: `standard` omitted from the notification; status bar keeps
  the last successful lint's value instead of flickering to nothing.
- **`phpcs.enable: false` / skipped lints** (`lintOnlyOpened`, ignored
  source): no notification with a standard fires; item stays hidden or
  reflects the last real lint.
- **Multi-root workspaces**: map keyed by document URI, standard resolved
  per-file on the server; per-folder rulesets display correctly.
- **Relative/missing paths**: the click handler checks file existence before
  opening and falls back to the settings UI.

## Testing

- **Server unit tests** (Mocha/tsx): update `linter.test.ts` for the new
  `lint()` return shape; assert `standard` equals the auto-detected config
  path, the configured standard, and `null` respectively. Trivial test for
  the new log string formatting.
- **Client**: no client-side test infrastructure exists; verify manually via
  `npm run bundle-dev` + F5 in three scenarios: workspace with a
  `ruleset.xml` (auto-detect), explicit `phpcs.standard: "PSR12"`, and no
  standard at all. Check click behavior for each.

## Documentation

- README: short "Status bar" note under the features section.
- CHANGELOG: entry referencing issue #21.
