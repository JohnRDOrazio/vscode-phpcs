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
npm install                # Install all dependencies (runs postinstall for subdirs)
npm run compile            # Build both client and server
npm test                   # Run all tests
npm run test:server        # Run server tests only
npm run test:server:unit   # Run server unit tests only
npm run test:server:coverage  # Run server tests with coverage report
npm run lint:md            # Check markdown files
npm run lint:md:fix        # Auto-fix markdown issues
npm run format:md          # Format markdown files with Prettier
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
npm run test:server           # All tests
npm run test:server:unit      # Unit tests only
npm run test:server:coverage  # Tests with coverage report
```

Tests use Mocha with tsx. Key test files:

- `linter.test.ts` - Version detection, STDERR handling, exit codes
- `linter-utils.test.ts` - Pure utility functions (argument building, parsing, etc.)
- `extfs.test.ts` - File system utilities
- `integration.test.ts` - Integration tests (require PHPCS installed)
- `base/common/strings.test.ts` - String utility functions

## Common Tasks

### Adding a New Setting

1. Add to `phpcs/package.json` under `contributes.configuration.properties`
2. Add to `phpcs-server/src/settings.ts` interface
3. Add default value in `phpcs-server/src/server.ts` `defaultSettings`
4. Use in `phpcs-server/src/linter.ts` as needed

### Modifying Linter Behavior

The linting logic is split between two files:

**`phpcs-server/src/linter.ts`** - Main linter class:

- `PhpcsLinter.create()` - Factory method, detects PHPCS version
- `lint()` - Main linting method, handles PHPCS execution

**`phpcs-server/src/linter-utils.ts`** - Pure utility functions (testable):

- `buildLintArguments()` - Builds PHPCS command line arguments
- `parsePhpcsOutput()` - Parses JSON output from PHPCS
- `createDiagnosticFromMessage()` - Creates VS Code diagnostics
- `transformIgnorePattern()` - Transforms ignore patterns for micromatch
- `extractFatalError()` - Extracts fatal errors from STDERR
- `getV4ExitCodeError()` - Handles PHPCS v4 exit codes

### Error Messages

String resources are in `phpcs-server/src/strings.ts`. Use `strings.format()`
for parameterized messages.

## Code Style

- No trailing semicolons in some files (maintain consistency within each file)
- Tabs for indentation
- Single quotes for strings
- JSDoc comments for public methods

## Repository Information

This is a fork maintained at `JohnRDOrazio/vscode-phpcs`. The original
repositories (`ikappas/vscode-phpcs`, `shevaua/vscode-phpcs`) are no longer
actively maintained.

**Important**: Only create GitHub issues and pull requests on the
`JohnRDOrazio/vscode-phpcs` repository. Do NOT create issues on the original
`ikappas` or `shevaua` repositories.

### GitHub CLI Configuration

The repository has `gh repo set-default` configured to use `JohnRDOrazio/vscode-phpcs`.
This ensures that `gh pr create`, `gh issue create`, and similar commands target
the correct repository instead of the upstream `ikappas/vscode-phpcs`.

To verify or set this configuration:

```bash
gh repo set-default --view              # View current default
gh repo set-default JohnRDOrazio/vscode-phpcs  # Set default
```
