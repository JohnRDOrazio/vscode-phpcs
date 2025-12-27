# Changelog

All notable changes to the "vscode-phpcs" extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.2] - 2025-12-27

### Added

- **Command Palette Commands** for PHPCBF:
  - `PHPCS: Fix this file with PHPCBF` - Fix the current file
  - `PHPCS: Fix all files in workspace with PHPCBF` - Fix all PHP files with
    confirmation dialog and progress indicator

### Changed

- **Extension renamed** from `phpcs` to `vscode-phpcs` to avoid naming conflict
  with the original abandoned extensions on the VS Code Marketplace
- Added "Extension History" section to README documenting the lineage from
  `ikappas.phpcs` and `shevaua.phpcs`
- Updated README to document PHPCBF (auto-fix) support alongside PHPCS (linting)
- Updated PHP_CodeSniffer repository links from deprecated `squizlabs` to
  `PHPCSStandards`

### Fixed

- File watcher now monitors all PHPCS ruleset file types (`phpcs.xml`,
  `phpcs.xml.dist`, `.phpcs.xml`, `.phpcs.xml.dist`, `phpcs.ruleset.xml`,
  `ruleset.xml`) instead of only `ruleset.xml`

> **Note for existing users:** Your settings will continue to work as the
> settings namespace remains `phpcs.*`. However, you may need to reinstall
> the extension under its new name.

## [1.2.1] - 2025-12-23

### Fixed

- Fixed `phpcs.phpcbfOnSave` setting not working - PHPCBF settings were missing
  from the client configuration middleware, causing the server to always receive
  default values instead of user-configured settings

### Changed

- Updated document selector to explicit format for better LSP compatibility
- Extracted `resolvePhpcbfPath()` helper method to reduce code duplication

## [1.2.0] - 2025-12-23

### Added

- **PHPCBF Support**: Auto-fix code style issues using PHP Code Beautifier and Fixer
  - Quick fix code action: "Fix all auto-fixable issues in this file (PHPCBF)"
  - Appears in lightbulb menu when hovering over PHPCS diagnostics
  - New settings:
    - `phpcs.phpcbfEnable`: Enable/disable PHPCBF integration (default: true)
    - `phpcs.phpcbfExecutablePath`: Custom path to phpcbf executable
    - `phpcs.phpcbfOnSave`: Automatically resolves issues when saving (default: false)
- Improved error diagnostics for PHPCS JSON parsing failures
  - Error messages now include raw output preview for debugging
  - Exit code and signal information included in error context

### Fixed

- Fixed PHPCBF exit code handling - content comparison now used to detect actual
  changes, as PHPCBF sometimes returns exit code 0 even when fixes were applied

## [1.1.1] - 2025-12-22

### Changed

- Switched from TypeScript compilation to esbuild bundling for faster extension
  activation and smaller package size (~177KB compressed vs previous ~500KB)
- Updated TypeScript from v5.7.2 to v5.9.3

### Added

- Architecture documentation in README explaining LSP design and size trade-offs
- Note about web platform limitations (github.dev, vscode.dev not supported)
- Convenience scripts: `package-dev` and `package-prod` for building VSIX packages

## [1.1.0] - 2025-12-18

### Added

- Support for PHP_CodeSniffer v4.0.0 and above
  - Proper handling of STDERR output (v4 routes progress/debug output to STDERR)
  - New exit code handling for v4 (exit codes 16 and 64 for processing errors)
  - Version-aware error detection that maintains backwards compatibility
- Unit tests for PHPCS v4 version handling, STDERR processing, and exit code logic
- Integration tests for validating PHPCS behavior across versions
- Debug logging for PHPCS v4 STDERR output
- Version caching for improved performance during linting

### Changed

- Publisher changed from `shevaua` to `johnrdorazio`
- Repository URLs updated to <https://github.com/JohnRDOrazio/vscode-phpcs>
- Updated Node.js requirement from v8.9.4 to v20
- Updated TypeScript from v2.7.2 to v5.7.2
- Updated VS Code minimum version from v1.20.0 to v1.106.0
- Updated vscode-languageserver from v5.2.1 to v9.0.1
- Updated vscode-languageclient from v5.2.1 to v9.0.1
- Modernized build process (removed deprecated `installServerIntoExtension` script)

### Fixed

- Fixed regex pattern for detecting PHP fatal errors to properly match both
  "FATAL ERROR:" and "PHP FATAL ERROR:" formats
- Fixed duplicate `sendEndValidationNotification` calls in error handling path
- Fixed unhandled promise rejection in `freeBuffer` method
- Improved error handling for missing PHPCS executable in multi-root workspaces
