# vscode-phpcs

[![Maintainers Wanted](https://img.shields.io/badge/maintainers-wanted-red.svg)](https://github.com/pickhardt/maintainers-wanted)
[![VS Code Marketplace Version](https://img.shields.io/visual-studio-marketplace/v/shevaua.phpcs)](https://marketplace.visualstudio.com/items?itemName=shevaua.phpcs)
[![VS Code Marketplace Installs](https://img.shields.io/visual-studio-marketplace/i/shevaua.phpcs)](https://marketplace.visualstudio.com/items?itemName=shevaua.phpcs)
[![VS Code Marketplace Rating](https://img.shields.io/visual-studio-marketplace/r/shevaua.phpcs)](https://marketplace.visualstudio.com/items?itemName=shevaua.phpcs)

Integrates [phpcs](https://github.com/squizlabs/PHP_CodeSniffer.git) into [Visual Studio Code](https://code.visualstudio.com/).

**Supports PHPCS versions 1.x, 2.x, 3.x, and 4.x.**

## Looking for additional maintainers

Due to current work obligations, I am unable to commit enough time to steadily maintain this project,
so I am looking for co-maintainers that are familiar with Node.js, TypeScript, and VS Code extension development.

If you want to help maintain this project, please contact me.

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

> **Note:** If you encounter "Cannot find module 'vscode'" errors after running
> `npm install` in the `phpcs/` subdirectory, run `npm install --ignore-scripts`
> in that directory. The `preinstall` script clears `node_modules` to ensure
> fresh installs, which can interfere with subsequent commands in the same shell
> session.

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
