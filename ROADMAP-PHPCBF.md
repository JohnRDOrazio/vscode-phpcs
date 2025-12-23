# PHPCBF Support Roadmap

This document outlines the implementation plan for adding PHPCBF (PHP Code Beautifier
and Fixer) support to vscode-phpcs.

---

## User-Facing Features

### v1 Scope (File-Level Fixes)

#### 1. Quick Fix Code Actions

When a user clicks on a PHPCS diagnostic (squiggly line), they'll see:

- **"Fix all auto-fixable issues in this file (PHPCBF)"** - Run PHPCBF on entire file

This appears in:

- The lightbulb menu (Cmd/Ctrl + .)
- Right-click context menu under "Quick Fix..."
- The Problems panel (click on diagnostic → Quick Fix)

#### 2. Commands (Command Palette)

- **"PHPCS: Fix this file with PHPCBF"** - Fix current file
- **"PHPCS: Fix all files in workspace"** - Fix all PHP files (with confirmation/progress)

#### 3. Format on Save Integration

Optional setting to auto-fix on save:

```json
{
  "phpcs.phpcbfOnSave": true
}
```

#### 4. Status Bar Feedback

Show progress indicator when PHPCBF is running (especially for workspace-wide fixes).

### Future Enhancements (Post-v1)

These features are deferred until v1 is stable:

- **Single diagnostic fixes** - Fix only the specific violation at cursor
- **Diff preview** - Show changes before applying (optional setting)
- **Document formatter registration** - Register as VS Code's document formatter
  (lowest priority, may not implement)

---

## New Settings (v1)

| Setting                      | Type    | Default | Description                                        |
| ---------------------------- | ------- | ------- | -------------------------------------------------- |
| `phpcs.phpcbfEnable`         | boolean | `true`  | Enable/disable PHPCBF integration                  |
| `phpcs.phpcbfExecutablePath` | string  | `null`  | Path to phpcbf executable (auto-detected if null)  |
| `phpcs.phpcbfOnSave`         | boolean | `false` | Auto-fix on save                                   |

---

## Technical Architecture

### New Files

```text
phpcs-server/src/
├── fixer.ts              # PhpcbfFixer class (mirrors PhpcsLinter)
├── fixer-utils.ts        # Utility functions for PHPCBF operations
└── code-actions.ts       # Code action provider logic (file-level fixes)

phpcs-server/test/
├── fixer.test.ts         # Unit tests for fixer
└── fixer-utils.test.ts   # Unit tests for utilities
```

### Key Integration Points

1. **server.ts**: Add `codeActionProvider` capability and `onCodeAction` handler
2. **settings.ts**: Add PHPCBF settings to interface
3. **phpcs/package.json**: Add configuration properties
4. **strings.ts**: Add PHPCBF-related error messages

---

## Implementation Phases (v1)

### Phase 1: Core PHPCBF Execution

**Goal**: Basic PHPCBF execution that can fix a file

1. Create `fixer.ts` with `PhpcbfFixer` class
   - Factory method to create fixer (detect phpcbf path)
   - `fix(document, settings)` method that runs PHPCBF
   - Version detection (reuse PHPCS version since they're bundled together)

2. Create `fixer-utils.ts` with utility functions
   - `buildFixArguments()` - Build CLI arguments for PHPCBF
   - `parseFixResult()` - Parse PHPCBF output/exit codes
   - Exit codes: 0 = no issues, 1 = issues fixed, 2 = unfixable issues, 3 = both

3. Add settings to `settings.ts`

4. Add unit tests for utilities

### Phase 2: File-Level Code Actions

**Goal**: Quick fix action to fix all issues in a file

1. Create `code-actions.ts` with code action logic
   - Generate "Fix all issues in this file" action when diagnostics exist

2. Update `server.ts`
   - Add `codeActionProvider: true` to capabilities
   - Implement `onCodeAction` handler
   - Execute PHPCBF and apply text edits (full file replacement)

3. Re-lint after fix to refresh diagnostics

### Phase 3: Commands, Workspace Fixes, and Auto-Fix

**Goal**: Command palette integration, workspace-wide fixes, and format-on-save

1. Register commands in extension
   - "Fix this file" command
   - "Fix all files in workspace" command

2. Implement workspace-wide fixes
   - Find all PHP files in workspace
   - Show progress indicator during operation
   - Report summary (X files fixed, Y errors, etc.)

3. Implement auto-fix on save
   - Hook into `onDidSave` event
   - Run PHPCBF before/after save based on setting

4. Add status bar integration
   - Show "Fixing..." indicator during operations

### Phase 4: Polish and Edge Cases

**Goal**: Robust error handling and user experience

1. Handle edge cases
   - PHPCBF not installed/not found
   - File has syntax errors (PHPCBF can't fix)
   - Concurrent fix requests
   - Large files / timeout handling

2. Documentation
   - Update README with PHPCBF features
   - Add configuration examples

---

## Future Phases (Post-v1)

### Single Diagnostic Fixes

- Add "Fix this issue" action for individual diagnostics
- May require running PHPCBF with line-specific options or `--dry-run` analysis

### Diff Preview

- Add `phpcs.phpcbfShowDiff` setting
- Show changes in diff view before applying
- Allow user to accept/reject

### Document Formatter Registration

- Register as `DocumentFormattingEditProvider`
- Allow "Format Document" command to use PHPCBF
- Lowest priority - may not implement

---

## PHPCBF Execution Details

### Command Structure

```bash
phpcbf --stdin-path=<file> --standard=<standard> --encoding=UTF-8 -
```

- Input: File content via stdin (same as PHPCS)
- Output: Fixed file content to stdout

### Exit Codes

Exit codes have different meanings in v3 vs v4. See the
[official documentation](https://github.com/PHPCSStandards/PHP_CodeSniffer/wiki/Advanced-Usage#understanding-the-exit-codes)
for details.

**PHPCBF v3.x:**

| Code | Meaning                                    |
| ---- | ------------------------------------------ |
| 0    | no fixable errors, nothing was fixed       |
| 1    | all fixable errors were fixed correctly    |
| 2    | phpcbf failed to fix some fixable errors   |
| 3    | processing error                           |

**PHPCBF v4.0.0+ (cumulative/bitmask):**

| Code | Meaning                                                |
| ---- | ------------------------------------------------------ |
| 0    | clean code base / auto-fixed with no issues remaining  |
| 1    | issues found/remaining, auto-fixable                   |
| 2    | issues found/remaining, non-auto-fixable               |
| 4    | failure to fix some files/fixer conflict               |
| 5    | 1 + 4: auto-fixable issues with some fix failures      |
| 7    | 1 + 2 + 4: mixed issues with some fix failures         |
| 16   | processing error blocking the run                      |
| 64   | requirements not met (e.g., minimum PHP version)       |

**Note**: In v4+, the `ignore_non_auto_fixable_on_exit` config option can make
PHPCBF return exit code 0 even when non-fixable issues remain. This is useful
for CI/CD automation. We use content comparison to detect actual changes
regardless of exit code.

### Applying Fixes

Use LSP's `TextEdit` to replace entire file content:

```typescript
{
  range: fullDocumentRange,
  newText: fixedContent
}
```

Or use `WorkspaceEdit` for batch operations:

```typescript
connection.workspace.applyEdit({
  changes: {
    [uri]: [textEdit]
  }
})
```

---

## Considerations

### PHPCBF Path Resolution

PHPCBF is typically bundled with PHPCS:

- Same directory as `phpcs` executable
- Composer: `vendor/bin/phpcbf`
- Global: `/usr/local/bin/phpcbf`

Reuse existing path resolution logic, just swap `phpcs` → `phpcbf`.

### Fixable vs Non-Fixable Violations

Not all PHPCS violations can be auto-fixed. For v1, we use the **optimistic approach**:

- Offer "Fix all issues" action whenever any diagnostics exist
- PHPCBF will fix what it can and skip unfixable violations
- User sees remaining diagnostics after fix is applied

This is simple and works well for file-level fixes. Single diagnostic fixes (post-v1)
may need `--dry-run` analysis to determine fixability.

### Concurrent Requests

If user triggers multiple fixes quickly:

- Queue requests
- Cancel pending if new request comes in
- Or debounce fix operations

---

## Testing Strategy

### Unit Tests

- `fixer-utils.test.ts`: Test argument building, result parsing
- Mock PHPCBF responses for various scenarios

### Integration Tests

- `fixer.test.ts`: Test actual PHPCBF execution (requires PHPCBF installed)
- Test with intentionally broken PHP files
- Verify fixes are applied correctly

### Manual Testing

- Test quick fix actions in VS Code
- Test "Fix this file" command
- Test "Fix all files in workspace" command
- Test format-on-save
- Test with various coding standards
- Test error scenarios (syntax errors, missing PHPCBF)

---

## Success Criteria (v1)

- [ ] "Fix all issues in this file" code action appears on PHPCS diagnostics
- [ ] Clicking "Fix" applies PHPCBF and updates the file
- [ ] Diagnostics refresh after fix is applied
- [ ] "Fix this file" command works from command palette
- [ ] "Fix all files in workspace" command works with progress indicator
- [ ] Auto-fix on save works when enabled
- [ ] Settings allow customizing PHPCBF behavior
- [ ] Errors are handled gracefully (missing PHPCBF, syntax errors, etc.)
- [ ] Unit tests cover utility functions
- [ ] Integration tests verify end-to-end flow
