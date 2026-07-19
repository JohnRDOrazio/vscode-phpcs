# PHPCBF Selective Fixes — Design (Take Two)

**Date:** 2026-07-18
**Status:** Abandoned — see "Outcome" below
**Supersedes:** the approach in PR #19 (`feature/phpcbf-post-v1-enhancements`).

## Outcome (2026-07-18)

The Task 1 validation spike **falsified this design's one unproven
assumption**: `editor.action.codeAction` accepts only `kind`, `apply`, and
`preferred` — there is no `preview` argument, so the Refactor Preview panel
cannot be opened programmatically. The panel *is* reachable natively by
pressing Ctrl+Enter on an action in the Code Action widget, but previews are
broken for `source.*` kind actions (open bug
[microsoft/vscode#210171](https://github.com/microsoft/vscode/issues/210171)),
which would have forced a `refactor.rewrite.*` kind workaround plus an extra
documented keypress.

Decision: **stop the effort entirely** rather than continue investing. The
extension keeps whole-file "Fix all auto-fixable issues (PHPCBF)", the #23
document formatter, and `phpcbfOnSave`. PR #19 was closed as won't-implement
and issue #18 closed as not-planned. If this is ever revisited, the two
viable native routes documented here are (a) quickfix-kind actions + the
built-in Ctrl+Enter widget preview, and (b) a side-by-side diff tab over a
virtual "fixed" document; the failed routes are custom decoration/CodeLens UI
(PR #19) and programmatic Refactor Preview (this spec's original Task 1).

## Context and post-mortem of PR #19

PR #19 attempted per-hunk inline diff preview with CodeLens Accept/Reject actions.
It grew to ~4,000 added lines and never stabilized. Root cause: it rebuilt VS Code's
diff experience by hand inside a normal editor — custom LCS diff (`diff-utils`),
character-level diff with whitespace visualization, decoration-based ghost rendering,
per-hunk CodeLens, a `hunk-correlation` algorithm mapping diagnostics to hunks, and
manual save/change synchronization. The commit history shows the failure mode:
repeated fixes for document-sync races, visual artifact cleanup, state-machine
resets, and a documented conflict with Copilot Next Edit Suggestions.

Survey of alternatives confirmed the lesson. `molon/hunkwise` (per-hunk review for
external AI tools) needs the **proposed** `editorInsets` API — unpublishable to the
Marketplace — plus a private git baseline store, because it reviews edits it does
not originate. We *do* originate our edits, so we can hand VS Code a
`WorkspaceEdit` before application and let native UI do the review.

## Core inversion

> The server **describes** fixes as LSP `TextEdit[]`; the client hands them to
> VS Code's native machinery. No custom rendering, no custom sync.

## Decisions (with rationale)

1. **"Fix only this issue" is sniff-scoped, whole file.** The action runs
   `phpcbf --sniffs=<Sniff.Name>` and honestly presents itself as "Fix all
   'Sniff.Name' violations in this file". A hunk and a diagnostic do not map 1:1;
   diagnostic↔hunk correlation is the algorithm that sank PR #19. phpcbf itself
   does the scoping — deterministic, zero guesswork.
2. **Per-change accept/reject uses the native Refactor Preview panel**, triggered
   by executing the built-in `editor.action.codeAction` command with
   `{kind: 'source.fixAll.phpcs', apply: 'first', preview: true}`. Checkbox per
   change, native per-change diff, uncheck to reject. VS Code owns rendering and
   sync; Copilot cannot interfere.
3. **Diff engine: jsdiff** (`diff` npm package, `diffLines`) to convert phpcbf
   full-text output into minimal line-based `TextEdit[]`. Fallback if massaging
   proves awkward: cherry-pick PR #19's tested `diff-utils.ts` +
   `diff-utils.test.ts` (the diff was never the broken part).
4. **Code actions become edit-bearing with lazy resolve** (`codeAction/resolve`,
   LSP 3.16). Lightbulb listing stays instant (no phpcbf run); resolve runs phpcbf
   and attaches a **versioned** `WorkspaceEdit`.
5. **Save-on-fix** (`phpcs.phpcbfSaveOnFix`, default `false`): actions carry both
   `edit` and a client-side `phpcs.saveAfterFix` command; the LSP spec guarantees
   edit-then-command ordering, so saving cannot race the edit.
6. **PR #19 stays open, uncommented, as reference** until the new approach is
   validated end-to-end. New work happens on `feature/phpcbf-selective-fixes`.

## Architecture

### Server (`phpcs-server/`) — nearly all new code

- `computeMinimalEdits(original: string, fixed: string): TextEdit[]` — new pure
  function in `fixer-utils.ts` built on jsdiff's `diffLines`.
- `onCodeAction` returns unresolved, edit-less actions:
  - **"Fix all auto-fixable issues (PHPCBF)"** (kind `source.fixAll.phpcs`) —
    existing action upgraded from command-style to edit-style (gains clean undo +
    atomicity). The distinct kind lets `editor.action.codeAction` select it
    unambiguously for the preview command, and makes the standard
    `"editor.codeActionsOnSave": {"source.fixAll.phpcs": "explicit"}` setting
    work for free.
  - **"Fix all 'Sniff.Name' violations in this file (PHPCBF)"** (`quickfix`) —
    one per distinct sniff among the diagnostics at the cursor; resolve adds
    `--sniffs=X` to the phpcbf invocation.
- `onCodeActionResolve` runs phpcbf on the buffer text via the existing
  `PhpcbfFixer` path, computes minimal edits, returns a `WorkspaceEdit` with a
  versioned document identifier. When `phpcbfSaveOnFix` is enabled, attaches the
  `phpcs.saveAfterFix` command.
- The #23 formatter's `computeFixEdits` switches from one whole-document replace
  edit to the same minimal-edits helper (cursor stability for format-on-save —
  shared plumbing, strictly better behavior).

### Client (`phpcs/`) — deliberately tiny (~30 lines)

- Command **"PHPCS: Preview PHPCBF fixes"** (`phpcs.previewFixes`): executes
  `editor.action.codeAction` with `{kind: <our fix-all kind>, apply: 'first',
  preview: true}` → native Refactor Preview panel.
- Command `phpcs.saveAfterFix`: saves the active document; attached to actions
  only when `phpcs.phpcbfSaveOnFix` is enabled.

### New settings

| Setting                  | Type    | Default | Description                     |
| ------------------------ | ------- | ------- | ------------------------------- |
| `phpcs.phpcbfSaveOnFix`  | boolean | `false` | Save the document after a PHPCBF quick fix is applied |

## Data flow

**Preview path:** `phpcs.previewFixes` → `editor.action.codeAction {preview: true}`
→ server `onCodeAction` (fast, no phpcbf) → VS Code picks the fix-all action →
`codeAction/resolve` → phpcbf runs on buffer text → jsdiff → versioned
`WorkspaceEdit` → Refactor Preview opens → user unchecks unwanted changes →
Apply applies only checked edits, atomically.

**Lightbulb path:** same, minus the wrapper command (direct apply, no preview).

**Sniff path:** same as lightbulb, with `--sniffs=X`.

## Sync safety

Every `WorkspaceEdit` uses a versioned document identifier. If the buffer changed
between resolve and apply, VS Code rejects the entire edit atomically — nothing
half-applies, nothing needs cleanup. We surface "Document changed while
previewing — run the fix again." There is **no server-side state** between resolve
and apply. After apply, the normal `didChange` → re-lint cycle updates diagnostics
as if the user had typed the fix.

## Error handling

- All phpcbf execution goes through the existing `runPhpcbf`/`PhpcbfFixer` path,
  inheriting: log-then-toast convention, `phpcbfTimeout`, exit-16
  "no files checked" benign handling (#29/#30), disabled/missing-executable
  warnings (#23).
- Resolve failure → action returned unresolved + error toast.
- No changes produced → empty edit + existing "no fixable issues" info message.
- Known trade-off: `codeAction/resolve` has no progress UI; a slow phpcbf run
  shows nothing until the preview opens. Acceptable at sub-second single-file
  speeds; bounded by `phpcbfTimeout`.

## Testing

- **Unit (server):** `computeMinimalEdits` edge cases (empty diff, EOL
  differences, trailing newline, BOM, insert-only, delete-only, adjacent hunks);
  `--sniffs` argument building; code-action generation and resolve payloads
  against a fake phpcbf executable (pattern proven in `linter.test.ts`).
- **Integration (real PHPCBF 4.0.1):** sniff-scoped run fixes only that sniff's
  violations; full-file run matches direct phpcbf output after edits are applied.
- **Manual (Extension Development Host):** Refactor Preview checklist — panel
  opens, per-change checkboxes work, unchecked edits stay unapplied, versioned
  edit rejected after concurrent buffer change.

## Validation spike (task 1, before everything else)

Wire a hardcoded two-edit `codeAction/resolve` through
`editor.action.codeAction {preview: true}` and manually confirm in the Extension
Development Host that the Refactor Preview panel opens, checkboxes are
per-change, and unchecked edits stay unapplied. **This is the one unproven
assumption in the design.** If the panel disappoints, fall back to the
side-by-side diff-tab approach (virtual read-only "fixed" document + Apply-all)
— only the thin client command changes; server plumbing is identical.

## Explicitly dropped from PR #19

Inline decorations; CodeLens providers; character-level whitespace
visualization; hunk↔diagnostic correlation; incremental-preview state machine;
all manual save/change synchronization; `phpcs.phpcbfSaveOnFix` interplay with
preview state (save now only ever follows an applied edit).
