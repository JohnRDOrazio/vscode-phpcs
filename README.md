# vscode-phpcs

[![CI](https://github.com/JohnRDOrazio/vscode-phpcs/actions/workflows/ci.yml/badge.svg)](https://github.com/JohnRDOrazio/vscode-phpcs/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/JohnRDOrazio/vscode-phpcs/branch/develop/graph/badge.svg)](https://codecov.io/gh/JohnRDOrazio/vscode-phpcs)
[![Snyk Security](https://snyk.io/test/github/JohnRDOrazio/vscode-phpcs/badge.svg)](https://snyk.io/test/github/JohnRDOrazio/vscode-phpcs)
[![CodeRabbit Pull Request Reviews](https://img.shields.io/coderabbit/prs/github/JohnRDOrazio/vscode-phpcs?utm_source=oss&utm_medium=github&utm_campaign=JohnRDOrazio%2Fvscode-phpcs&labelColor=171717&color=FF570A&link=https%3A%2F%2Fcoderabbit.ai&label=CodeRabbit+Reviews)](https://coderabbit.ai)

| Platform       | Version                                                                                                                                                                                                           | Installs                                                                                                                                                                                                           | Rating                                                                                                                                                                                                           |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| VS Marketplace | [![VS Code Marketplace Version](https://img.shields.io/visual-studio-marketplace/v/johnrdorazio.vscode-phpcs?cacheSeconds=604800)](https://marketplace.visualstudio.com/items?itemName=johnrdorazio.vscode-phpcs) | [![VS Code Marketplace Installs](https://img.shields.io/visual-studio-marketplace/i/johnrdorazio.vscode-phpcs?cacheSeconds=604800)](https://marketplace.visualstudio.com/items?itemName=johnrdorazio.vscode-phpcs) | [![VS Code Marketplace Rating](https://img.shields.io/visual-studio-marketplace/r/johnrdorazio.vscode-phpcs?cacheSeconds=604800)](https://marketplace.visualstudio.com/items?itemName=johnrdorazio.vscode-phpcs) |
| Open VSX       | [![Open VSX Version](https://img.shields.io/open-vsx/v/johnrdorazio/vscode-phpcs?cacheSeconds=604800)](https://open-vsx.org/extension/johnrdorazio/vscode-phpcs)                                                  | [![Open VSX Downloads](https://img.shields.io/open-vsx/dt/johnrdorazio/vscode-phpcs?cacheSeconds=604800)](https://open-vsx.org/extension/johnrdorazio/vscode-phpcs)                                                | [![Open VSX Rating](https://img.shields.io/open-vsx/rating/johnrdorazio/vscode-phpcs?cacheSeconds=604800)](https://open-vsx.org/extension/johnrdorazio/vscode-phpcs)                                             |

Integrates [phpcs](https://github.com/PHPCSStandards/PHP_CodeSniffer) (PHP_CodeSniffer) for linting and
[phpcbf](https://github.com/PHPCSStandards/PHP_CodeSniffer) (PHP Code Beautifier and Fixer) for auto-fixing
code style issues into [VS Code](https://code.visualstudio.com/) and compatible editors.

## Extension History

This extension is the actively maintained continuation of the original PHPCS extensions:

- **`ikappas.phpcs`** (versions 1.0.1 – 1.0.4) — The original extension by Ioannis Kappas
- **`shevaua.phpcs`** (versions 1.0.6 – 1.0.8) — Maintained by Igor Sheviakov

Both previous extensions are no longer maintained. This fork continues development with
new features, bug fixes, and support for PHP_CodeSniffer v4.

> **Note for Open VSX users:** This extension was previously published on the
> [Open VSX Registry](https://open-vsx.org/) as `johnrdorazio.phpcs` (versions 1.1.0 – 1.2.1).
> That extension ID is now deprecated in favor of `johnrdorazio.vscode-phpcs`.
> Please uninstall the old extension and install this one to receive future updates.

If you were using any of the previous extensions, you can safely uninstall them and
switch to this one to receive continued updates.

**Supports PHPCS versions 1.x, 2.x, 3.x, and 4.x.**

> **Note:** This extension requires a local Node.js runtime and does not work on
> web platforms (github.dev, vscode.dev). It needs to spawn PHPCS as a child
> process, which is not possible in browser-based environments.

For release notes and version history, see the [Changelog](phpcs/CHANGELOG.md).

## Setup Development Version

### Prerequisites

- [Node.js](https://nodejs.org/) v20 or later
- [VS Code](https://code.visualstudio.com/) v1.106.3 or later (or compatible editor)

### Installation

1. Clone this repository and check out the `develop` branch
2. Open the cloned repository folder using VS Code
3. Install dependencies from the **root** directory:

   ```bash
   npm install
   ```

   This runs `postinstall` scripts that install dependencies for both
   `phpcs-server/` and `phpcs/` subdirectories.

### Building

To build the extension, run from the **root** directory:

```bash
npm run bundle        # Production build (minified)
npm run bundle-dev    # Development build (with sourcemaps)
```

This uses [esbuild](https://esbuild.github.io/) to bundle both the client and
server into single JavaScript files in `phpcs/dist/`.

To create a `.vsix` package for installation:

```bash
npm run package-prod  # Production package (~177KB compressed)
npm run package-dev   # Development package with sourcemaps (~388KB compressed)
```

### Running Tests

```bash
npm test
```

This runs tests for both the server and client.

## Run/Debug Development Version

To run the development version of the `phpcs` extension:

1. Open the cloned repository folder using VS Code
2. (Optional) Build the extension before debugging to ensure artifacts are ready:

   ```bash
   npm run bundle-dev         # One-time build
   # OR
   npm run bundle-watch       # Continuous watch mode (auto-rebuilds on changes)
   ```

   **Note:** The debug configurations automatically start the watch tasks via
   `preLaunchTask`, but running `bundle-dev` first ensures the initial build
   completes before the extension launches.

3. Select sidebar option `Run and Debug` (Ctrl+Shift+D)
4. Select `Client + Server` from the Debug dropdown menu
5. Press `Start Debugging` (F5)

This will launch a new VS Code window named `Extension Development Host`,
automatically using the development version of the `phpcs` extension.

> **Note:** If you don't have an open PHP file in the Extension Development
> Host, the server debug session will timeout and you will need to relaunch
> it from the debug panel.

## Architecture

This extension uses the [Language Server Protocol (LSP)](https://microsoft.github.io/language-server-protocol/)
architecture, which separates the extension into two components:

- **Client** (`phpcs/`): The VS Code extension that communicates with the editor
- **Server** (`phpcs-server/`): A separate Node.js process that runs PHPCS and
  reports diagnostics

### Why LSP?

The LSP architecture provides several benefits:

1. **Non-blocking linting**: The server runs in a separate process, so heavy
   PHPCS operations don't freeze the VS Code UI
2. **Better resource isolation**: Memory and CPU usage are isolated from the
   main extension host
3. **Standardized protocol**: Uses the same protocol as other language servers,
   making the codebase more maintainable

### Extension Size

This extension is larger (~650KB uncompressed) compared to simpler alternatives
(~185KB) because it bundles the LSP libraries:

| Component                      | Size   |
| ------------------------------ | ------ |
| vscode-languageclient          | ~100KB |
| vscode-languageserver          | ~80KB  |
| vscode-languageserver-protocol | ~45KB  |
| vscode-jsonrpc                 | ~35KB  |
| Other dependencies             | ~40KB  |
| Extension code                 | ~10KB  |

The trade-off is worth it: the LSP approach ensures VS Code remains responsive
even when linting large files or projects with many PHP files.

## PHPCBF Integration

The extension includes support for [PHPCBF](https://github.com/PHPCSStandards/PHP_CodeSniffer)
(PHP Code Beautifier and Fixer) to automatically fix code style issues.

### Features

- **Quick Fix Actions**: Click on a PHPCS diagnostic (squiggly line) and select
  "Fix this issue (PHPCBF)" or "Fix all auto-fixable issues in this file (PHPCBF)"
- **Command Palette**: Use "PHPCS: Fix this file with PHPCBF" or "PHPCS: Fix all
  files in workspace with PHPCBF"
- **Auto-fix on Save**: Enable `phpcs.phpcbfOnSave` to automatically fix issues
  when saving a file
- **Diff Preview**: Enable `phpcs.phpcbfShowDiff` to preview changes before
  applying them. Use `phpcs.phpcbfDiffInline` to show the diff as inline
  decorations in the current editor instead of a separate diff tab.

### Settings

| Setting                      | Type    | Default | Description                                             |
| ---------------------------- | ------- | ------- | ------------------------------------------------------- |
| `phpcs.phpcbfEnable`         | boolean | `true`  | Enable/disable PHPCBF integration                       |
| `phpcs.phpcbfExecutablePath` | string  | `null`  | Path to phpcbf executable (auto-detected if null)       |
| `phpcs.phpcbfOnSave`         | boolean | `false` | Auto-fix on save                                        |
| `phpcs.phpcbfShowDiff`       | boolean | `false` | Show diff preview before applying fixes                 |
| `phpcs.phpcbfDiffInline`     | boolean | `false` | Show inline diff decorations instead of separate editor |
| `phpcs.phpcbfTimeout`        | number  | `60`    | Timeout in seconds for PHPCBF operations                |
