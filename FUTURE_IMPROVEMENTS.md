# Future Improvements

This document tracks planned improvements and enhancements for the vscode-phpcs extension.

---

## Extension Bundling with esbuild

**Priority:** Medium
**Effort:** Medium
**Reference:** <https://code.visualstudio.com/api/working-with-extensions/bundling-extension>

### Overview

Bundle the extension using esbuild to improve load times and reduce package size.

### Benefits

- Faster extension activation
- Smaller .vsix package size
- Better dependency tree-shaking
- Single-file output for both client and server

### Limitations

This extension **will not work on web platforms** (github.dev, vscode.dev) even with bundling because:

1. It spawns `phpcs` as a child process
2. Requires PHP to be installed locally
3. Needs file system access to read PHP files

Bundling is still beneficial for desktop VS Code performance.

### Implementation Plan

1. Add `esbuild` as a dev dependency to both `phpcs/` and `phpcs-server/`
2. Create esbuild configuration scripts:
   - `phpcs/esbuild.js` - Bundle client extension
   - `phpcs-server/esbuild.js` - Bundle language server
3. Update build scripts in root `package.json`:
   - Add `bundle` script for production builds
   - Add `bundle:watch` for development
4. Update `phpcs/package.json`:
   - Change `main` entry point from `out/extension.js` to `dist/extension.js`
5. Update `.vscodeignore` to exclude source files and include only bundles
6. Test extension activation and functionality

### Sample esbuild Configuration

```javascript
const esbuild = require("esbuild");

const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");

async function main() {
  const ctx = await esbuild.context({
    entryPoints: ["src/extension.ts"],
    bundle: true,
    format: "cjs",
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    platform: "node",
    outfile: "dist/extension.js",
    external: ["vscode"],
    logLevel: "warning",
    plugins: [esbuildProblemMatcherPlugin],
  });
  if (watch) {
    await ctx.watch();
  } else {
    await ctx.rebuild();
    await ctx.dispose();
  }
}

const esbuildProblemMatcherPlugin = {
  name: "esbuild-problem-matcher",
  setup(build) {
    build.onStart(() => {
      console.log("[watch] build started");
    });
    build.onEnd((result) => {
      result.errors.forEach(({ text, location }) => {
        console.error(`✘ [ERROR] ${text}`);
        if (location) {
          console.error(
            `    ${location.file}:${location.line}:${location.column}:`,
          );
        }
      });
      console.log("[watch] build finished");
    });
  },
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

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
