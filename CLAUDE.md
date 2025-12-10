# CLAUDE.md

This file provides context for AI assistants (Claude, Copilot, etc.) working on
this codebase.

## Project Overview

vscode-phpcs is a Visual Studio Code extension that integrates PHP_CodeSniffer
(phpcs) for PHP linting. It uses a client-server architecture based on the
Language Server Protocol (LSP).

## Architecture

```text
vscode-phpcs/
├── phpcs/                 # VS Code extension client
│   ├── src/
│   │   ├── extension.ts   # Extension entry point
│   │   ├── configuration.ts
│   │   ├── status.ts
│   │   └── protocol.ts
│   └── package.json       # Extension manifest (engines.vscode, contributes)
├── phpcs-server/          # Language server
│   ├── src/
│   │   ├── server.ts      # LSP server implementation
│   │   ├── linter.ts      # PHPCS execution and parsing
│   │   ├── settings.ts    # Settings interface
│   │   └── strings.ts     # String resources
│   └── test/              # Server unit tests
└── package.json           # Root workspace scripts
```

## Key Technologies

- **TypeScript 5.x** - Both client and server
- **vscode-languageserver v9** - LSP server implementation
- **vscode-languageclient v9** - LSP client for VS Code
- **Node.js 20+** - Runtime requirement
- **VS Code 1.106.3+** - Minimum extension host version

## Development Commands

Run all commands from the **root** directory:

```bash
npm install          # Install all dependencies (runs postinstall for subdirs)
npm run compile      # Build both client and server
npm test             # Run all tests
npm run test:server  # Run server tests only
npm run lint:md      # Check markdown files
npm run lint:md:fix  # Auto-fix markdown issues
```

## PHPCS Version Compatibility

The extension supports PHPCS versions 1.x, 2.x, 3.x, and 4.x. Key differences:

### PHPCS v4 Breaking Changes (handled in linter.ts)

1. **STDERR Output**: v4 sends progress/debug output to STDERR (not errors)
2. **Exit Codes**: New codes - 0 (clean), 1 (fixable), 2 (unfixable), 3 (both),
   16 (processing error), 64 (requirements not met)
3. **Version Detection**: `isV4OrAbove()` method caches version check

### Version-Aware Code Pattern

```typescript
if (this.isV4OrAbove()) {
    // v4+ specific handling
} else {
    // v3 and below
}
```

## Testing

Server tests are in `phpcs-server/test/`. Run with:

```bash
npm run test:server
```

Tests use Mocha with ts-node. Key test files:

- `linter.test.ts` - Version detection, STDERR handling, exit codes

## Common Tasks

### Adding a New Setting

1. Add to `phpcs/package.json` under `contributes.configuration.properties`
2. Add to `phpcs-server/src/settings.ts` interface
3. Add default value in `phpcs-server/src/server.ts` `defaultSettings`
4. Use in `phpcs-server/src/linter.ts` as needed

### Modifying Linter Behavior

The main linting logic is in `phpcs-server/src/linter.ts`:

- `PhpcsLinter.create()` - Factory method, detects PHPCS version
- `lint()` - Main linting method, handles PHPCS execution
- `parseData()` - Parses JSON output from PHPCS

### Error Messages

String resources are in `phpcs-server/src/strings.ts`. Use `strings.format()`
for parameterized messages.

## Build Quirks

The `preinstall` script in both `phpcs/package.json` and
`phpcs-server/package.json` runs `rimraf node_modules` to ensure fresh
installs. If you encounter module resolution errors after running `npm install`
in a subdirectory, use `npm install --ignore-scripts`.

## Code Style

- No trailing semicolons in some files (maintain consistency within each file)
- Tabs for indentation
- Single quotes for strings
- JSDoc comments for public methods
