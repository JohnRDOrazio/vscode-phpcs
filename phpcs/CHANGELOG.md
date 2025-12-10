# Changelog

All notable changes to the "phpcs" extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Support for PHP_CodeSniffer v4.0.0 and above
  - Proper handling of STDERR output (v4 routes progress/debug output to STDERR)
  - New exit code handling for v4 (exit codes 16 and 64 for processing errors)
  - Version-aware error detection that maintains backwards compatibility
- Unit tests for PHPCS v4 version handling, STDERR processing, and exit code logic
- Debug logging for PHPCS v4 STDERR output
- Version caching for improved performance during linting

### Changed

- Updated Node.js requirement from v8.9.4 to v20
- Updated TypeScript from v2.7.2 to v5.7.2
- Updated VS Code minimum version from v1.20.0 to v1.75.0
- Updated vscode-languageserver from v5.2.1 to v9.0.1
- Updated vscode-languageclient from v5.2.1 to v9.0.1
- Modernized build process (removed deprecated `installServerIntoExtension` script)

### Fixed

- Fixed regex pattern for detecting PHP fatal errors to properly match both "FATAL ERROR:" and "PHP FATAL ERROR:" formats
