# vscode-phpcs

[![CI](https://github.com/JohnRDOrazio/vscode-phpcs/actions/workflows/ci.yml/badge.svg)](https://github.com/JohnRDOrazio/vscode-phpcs/actions/workflows/ci.yml)
[![Snyk Security](https://img.shields.io/snyk/vulnerabilities/github/JohnRDOrazio/vscode-phpcs)](https://snyk.io/test/github/JohnRDOrazio/vscode-phpcs)
[![CodeRabbit Pull Request Reviews](https://img.shields.io/coderabbit/prs/github/JohnRDOrazio/vscode-phpcs?utm_source=oss&utm_medium=github&utm_campaign=JohnRDOrazio%2Fvscode-phpcs&labelColor=171717&color=FF570A&link=https%3A%2F%2Fcoderabbit.ai&label=CodeRabbit+Reviews)](https://coderabbit.ai)

| Platform       | Version                                                                                                                                                                                            | Installs                                                                                                                                                                                            | Rating                                                                                                                                                                                            |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| VS Marketplace | [![VS Code Marketplace Version](https://img.shields.io/visual-studio-marketplace/v/johnrdorazio.phpcs?cacheSeconds=86400)](https://marketplace.visualstudio.com/items?itemName=johnrdorazio.phpcs) | [![VS Code Marketplace Installs](https://img.shields.io/visual-studio-marketplace/i/johnrdorazio.phpcs?cacheSeconds=86400)](https://marketplace.visualstudio.com/items?itemName=johnrdorazio.phpcs) | [![VS Code Marketplace Rating](https://img.shields.io/visual-studio-marketplace/r/johnrdorazio.phpcs?cacheSeconds=86400)](https://marketplace.visualstudio.com/items?itemName=johnrdorazio.phpcs) |
| Open VSX       | [![Open VSX Version](https://img.shields.io/open-vsx/v/johnrdorazio/phpcs?cacheSeconds=86400)](https://open-vsx.org/extension/johnrdorazio/phpcs)                                                  | [![Open VSX Downloads](https://img.shields.io/open-vsx/dt/johnrdorazio/phpcs?cacheSeconds=86400)](https://open-vsx.org/extension/johnrdorazio/phpcs)                                                | [![Open VSX Rating](https://img.shields.io/open-vsx/rating/johnrdorazio/phpcs?cacheSeconds=86400)](https://open-vsx.org/extension/johnrdorazio/phpcs)                                             |

Integrates [phpcs](https://github.com/squizlabs/PHP_CodeSniffer.git) into [Visual Studio Code](https://code.visualstudio.com/).

**Supports PHPCS versions 1.x, 2.x, 3.x, and 4.x.**

For release notes and version history, see the [Changelog](phpcs/CHANGELOG.md).

## Setup Development Version

### Prerequisites

- [Node.js](https://nodejs.org/) v20 or later
- [Visual Studio Code](https://code.visualstudio.com/) v1.106.3 or later

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

To compile the extension, run from the **root** directory:

```bash
npm run compile
```

This will:

1. Clean previous build artifacts
2. Compile the server TypeScript (`phpcs-server/`)
3. Compile the client TypeScript (`phpcs/`)
4. Copy the server package.json and install production dependencies

### Running Tests

```bash
npm test
```

This runs tests for both the server and client.

## Run/Debug Development Version

To run the development version of the `phpcs` extension:

1. Open the cloned repository folder using VS Code
2. Select sidebar option `Run and Debug` (Ctrl+Shift+D)
3. Select `Client + Server` from the Debug dropdown menu
4. Press `Start Debugging` (F5)

This will launch a new VS Code window named `Extension Development Host`,
automatically using the development version of the `phpcs` extension.

> **Note:** If you don't have an open PHP file in the Extension Development
> Host, the server debug session will timeout and you will need to relaunch
> it from the debug panel.
