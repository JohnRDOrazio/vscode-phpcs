# Future Improvements

This document tracks planned improvements and enhancements for the vscode-phpcs extension.

---

## VS Code Extension Tests with xvfb-run

**Priority:** Low
**Effort:** Medium
**Reference:** <https://code.visualstudio.com/api/working-with-extensions/continuous-integration>

### Overview

Add VS Code extension tests that launch the actual VS Code environment to test the extension
UI and integration. These tests require a display on Linux, so `xvfb-run` is needed in CI.

### Current State

The current CI runs only pure Node.js/Mocha tests:

- `test:server:unit` - Unit tests (no GUI needed)
- `test:server:integration` - PHPCS integration tests (no GUI needed)

### Implementation Plan

1. Create VS Code extension tests in `phpcs/test/` using the `@vscode/test-electron` package
2. Add test cases for:
   - Extension activation
   - Diagnostics appearing in the Problems panel
   - Configuration changes
   - Multi-root workspace support
3. Update CI workflow to use `xvfb-run` for Linux:

```yaml
- run: xvfb-run -a npm run test:extension
  if: runner.os == 'Linux'
- run: npm run test:extension
  if: runner.os != 'Linux'
```

### Sample CI Configuration

```yaml
on:
  push:
    branches: [develop, master]
  pull_request:
    branches: [develop, master]

jobs:
  extension-tests:
    strategy:
      matrix:
        os: [macos-latest, ubuntu-latest, windows-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm install
      - run: npm run compile
      - run: xvfb-run -a npm run test:extension
        if: runner.os == 'Linux'
      - run: npm run test:extension
        if: runner.os != 'Linux'
```

---

## Additional Ideas

- Add quick-fix code actions for common PHPCS errors
- Support for PHPCBF (auto-fixing)
- Workspace-level PHPCS version caching
- Configuration UI for selecting coding standards
