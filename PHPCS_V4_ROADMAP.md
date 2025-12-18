# Roadmap: PHPCS v4 Support for vscode-phpcs

## Overview

PHP_CodeSniffer v4.0.0 was released on September 16, 2025, with v4.0.1 being the latest stable release.
This document outlines the changes required to support PHPCS v4 in the vscode-phpcs extension.

## Additional Changes Made

In addition to PHPCS v4 support, this update includes a major modernization of the codebase:

- **Node.js**: Updated from v8.9.4 to v20
- **TypeScript**: Updated from v2.7.2 to v5.7.2
- **VS Code Engine**: Updated minimum requirement from v1.20.0 to v1.75.0 (extension) / v1.106.3 (development)
- **vscode-languageserver**: Updated from v5.2.1 to v9.0.1
- **vscode-languageclient**: Updated from v5.2.1 to v9.0.1
- **All other dependencies**: Updated to latest stable versions
- **Build process**: Removed deprecated `installServerIntoExtension` script

## Breaking Changes in PHPCS v4

| Change | Impact | Priority |
|--------|--------|----------|
| Progress/error/debug output now sent to STDERR | **Critical** - Current code throws errors on any STDERR output | P0 |
| Exit codes completely changed | Medium - Code doesn't explicitly check exit codes, but should be handled properly | P1 |
| `--extensions` no longer accepts language flavors | Low - Extension doesn't use this flag currently | P2 |
| Old ignore annotation syntax removed | None - User-facing, not extension code | N/A |
| JS/CSS support removed | None - Extension is for PHP | N/A |

### New Exit Codes (v4)

| Code | Meaning |
|------|---------|
| 0 | Clean code base / all issues fixed / successful non-scan request |
| 1 | Issues found that are auto-fixable |
| 2 | Issues found that cannot be auto-fixed |
| 3 | Mix of auto-fixable and non-auto-fixable issues (1 + 2) |
| 16 | Processing error (e.g., XML ruleset parse errors) |
| 64 | Requirements not met (PHP version, missing extensions) |

---

## Implementation Roadmap

### Phase 1: Critical STDERR Handling Fix

**File:** `phpcs-server/src/linter.ts`

**Current problematic code (lines 191-201):**

```typescript
// Determine whether we have an error in stderr.
if (stderr !== '') {
    // Note: (?:PHP\s?)? makes the "PHP " prefix optional to match both
    // "FATAL ERROR: ..." and "PHP FATAL ERROR: ..."
    if (match = stderr.match(/^(?:PHP\s?)?FATAL\s?ERROR:\s?(.*)/i)) {
        let error = match[1].trim();
        if (match = error.match(/^Uncaught exception '.*' with message '(.*)'/)) {
            throw new Error(match[1]);
        }
        throw new Error(error);
    }
    throw new Error(strings.format(SR.UnknownExecutionError, `${this.executablePath} ${lintArgs.join(' ')}`));
}
```

**Problem:** PHPCS v4 now sends progress, error, and debug output to STDERR. The current code throws an error whenever STDERR is non-empty, which will break with v4.

**Solution:**

1. For PHPCS v4+, only treat STDERR as an error if it contains actual error patterns (FATAL ERROR, etc.)
2. For PHPCS v3 and below, maintain existing behavior for backwards compatibility

**Tasks:**

- [x] Add version check before STDERR handling
- [x] For v4+: Only throw on actual error patterns in STDERR
- [x] Log non-error STDERR content for debugging purposes
- [x] Add unit tests for both v3 and v4 STDERR handling

---

### Phase 2: Exit Code Handling

**File:** `phpcs-server/src/linter.ts`

**Current behavior:** The extension doesn't explicitly check exit codes. It relies on parsing JSON output from stdout.

**Recommended changes:**

1. Add exit code validation after spawn completes
2. Handle error exit codes (16, 64) appropriately
3. For exit codes 1, 2, 3: Continue normal processing (these indicate issues were found, which is expected)

**Tasks:**

- [x] Capture exit code from `spawn.sync()` result (`phpcs.status`)
- [x] Add exit code handling logic with version-awareness
- [x] Map exit codes to appropriate error messages
- [x] Add new string resources for exit code errors

**Proposed exit code handling:**

```typescript
const exitCode = phpcs.status;

if (semver.gte(this.executableVersion, '4.0.0')) {
    // PHPCS v4 exit codes
    if (exitCode === 16) {
        throw new Error(SR.ProcessingError);
    }
    if (exitCode === 64) {
        throw new Error(SR.RequirementsNotMetError);
    }
    // Exit codes 0, 1, 2, 3 are normal operation
} else {
    // PHPCS v3 and below - existing behavior
    // Exit code 1 = errors found, 2 = warnings found, 3 = both
}
```

---

### Phase 3: Version Detection Enhancement

**File:** `phpcs-server/src/linter.ts`

**Current version detection (lines 45-54):**

```typescript
let result: Buffer = cp.execSync(`"${executablePath}" --version`);
const versionPattern: RegExp = /^PHP_CodeSniffer version (\d+\.\d+\.\d+)/i;
const versionMatches = result.toString().match(versionPattern);
```

**Tasks:**

- [x] Verify the `--version` output format hasn't changed in v4
- [x] Add helper method `isV4OrAbove()` for cleaner version checks
- [x] Cache major version for performance (computed at construction time)

**Proposed helper:**

```typescript
private isV4OrAbove(): boolean {
    return semver.gte(this.executableVersion, '4.0.0');
}
```

---

### Phase 4: Add New String Resources

**File:** `phpcs-server/src/strings.ts`

**Tasks:**

- [x] Add new error message strings for v4-specific errors

**Proposed additions:**

```typescript
static readonly ProcessingError: string = 'PHPCS encountered a processing error. Please check your ruleset configuration.';
static readonly RequirementsNotMetError: string = 'PHPCS requirements not met. Please check your PHP version and installed extensions.';
static readonly StderrDebugOutput: string = 'PHPCS debug output: {0}';
```

---

### Phase 5: Testing

**Tasks:**

- [x] Create test fixtures for PHPCS v4 output (version comparison logic tests in linter.test.ts)
- [x] Add unit tests for STDERR handling with v4
- [x] Add unit tests for new exit code handling
- [ ] Add integration tests with actual PHPCS v4 binary (requires CI setup)
- [ ] Test backwards compatibility with PHPCS v3.x (manual testing performed - verified working)

**Test scenarios:**

1. Clean file (exit 0, empty output)
2. File with errors (exit 1/2/3, JSON output)
3. Invalid ruleset (exit 16, error in stderr)
4. PHP version mismatch (exit 64)
5. Progress output in stderr (v4 only, should not error)

---

### Phase 6: Documentation

**Tasks:**

- [x] Update README.md with supported PHPCS versions
- [x] Document any configuration changes needed for v4 (none required - extension handles version differences automatically)
- [x] Add changelog entry for v4 support
- [x] Update any version badges/shields (N/A - no badges currently in README)

---

## Implementation Details

### Modified `lint()` method outline

```typescript
public async lint(document: TextDocument, settings: PhpcsSettings): Promise<Diagnostic[]> {
    // ... existing setup code ...

    const phpcs = spawn.sync(this.executablePath, lintArgs, options);
    const stdout = phpcs.stdout.toString().trim();
    const stderr = phpcs.stderr.toString().trim();
    const exitCode = phpcs.status;

    // Handle exit codes first
    if (this.isV4OrAbove()) {
        if (exitCode === 16) {
            throw new Error(SR.ProcessingError);
        }
        if (exitCode === 64) {
            throw new Error(SR.RequirementsNotMetError);
        }
    }

    // Handle STDERR - version aware
    if (stderr !== '') {
        // Check for actual fatal errors (both v3 and v4)
        // Note: (?:PHP\s?)? makes the "PHP " prefix optional to match both
        // "FATAL ERROR: ..." and "PHP FATAL ERROR: ..."
        if (match = stderr.match(/^(?:PHP\s?)?FATAL\s?ERROR:\s?(.*)/i)) {
            let error = match[1].trim();
            if (match = error.match(/^Uncaught exception '.*' with message '(.*)'/)) {
                throw new Error(match[1]);
            }
            throw new Error(error);
        }

        // For v3: any other stderr content is an error
        // For v4: non-fatal stderr is just debug/progress output, ignore it
        if (!this.isV4OrAbove()) {
            throw new Error(strings.format(SR.UnknownExecutionError, `${this.executablePath} ${lintArgs.join(' ')}`));
        }
    }

    // Handle STDOUT errors
    if (match = stdout.match(/^ERROR:\s?(.*)/i)) {
        // ... existing error handling ...
    }

    // Parse JSON output
    const data = this.parseData(stdout);
    // ... rest of existing code ...
}
```

---

## Risks and Considerations

1. **Backwards Compatibility**: All changes must maintain support for PHPCS v1.x, v2.x, and v3.x.
   The code uses version-aware logic (e.g., `--encoding` since v1.3.0, `-q` since v2.6.2) to ensure compatibility.
2. **Testing Matrix**: CI tests against PHPCS v3.x and v4.x as the most commonly used versions.
   Older versions (v1.x, v2.x) are supported through version-aware code but not actively tested in CI.
3. **Future PHPCS Changes**: Consider adding configuration option for users to specify expected PHPCS major version
4. **Performance**: Version checks should be cached, not performed on every lint operation

---

## References

- [PHPCS v4 User Upgrade Guide](https://github.com/PHPCSStandards/PHP_CodeSniffer/wiki/Version-4.0-User-Upgrade-Guide)
- [PHPCS Advanced Usage - Exit Codes](https://github.com/PHPCSStandards/PHP_CodeSniffer/wiki/Advanced-Usage)
- [PHPCS Releases](https://github.com/PHPCSStandards/PHP_CodeSniffer/releases)
- [PHPCS Changelog](https://github.com/PHPCSStandards/PHP_CodeSniffer/blob/master/CHANGELOG.md)
