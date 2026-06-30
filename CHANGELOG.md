# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.3.0] - 2026-06-30

### Added

- `billing payment-method bind/list` commands

## [1.2.0] - 2026-06-26

### Added

- `support list`, `support view`, `support create`, `support reply`, `support close`, `support rate` commands for ticket lifecycle management

## [1.1.0] - 2026-06-19

### Added

- `docs search` / `docs view` commands for browsing QwenCloud documentation
- `billing summary`, `billing breakdown`, `billing limit` commands
- `workspace list` / `workspace limit` commands
- `subscription status`, `subscription orders`, `subscription tokenplan` commands
- `usage logs` command for detailed API call history
- Interactive paginated tables for long list outputs

### Changed

- Expanded model metadata in `models info` with pricing and capability details

### Fixed

- Windows ConHost terminal compatibility for interactive UI
- Usage logs timestamp precision (full datetime)

## [1.0.2] - 2026-05-20

### Added

- Compatibility with itemized pricing data
- Compatibility with dynamic billing units (e.g. `voices`)

### Changed

- Show full numeric digits in usage percentage and free-tier remaining
- Unify `—` for zero-value cells

### Fixed

- Defensive null checks for `InitCapacity` / `CurrCapacity` in `fetchFreeTierQuotas`
- Align displayed fields across `usage` subcommands

## [1.0.1] - 2026-05-14

### Added

- Install scripts: `install.sh` (macOS/Linux) and `install.ps1` (Windows, PowerShell 5.1 / CLM compatible)
- Upgrade check with update notification in the `version` command

### Changed

- Unified CLI option formatting; optimized free model and pricing display
- Usage breakdown: rename `isToday` → `isCurrent` for period-agnostic semantics
- Windows standalone binary: when falling back to the encrypted credential file, derive the encryption key from the persisted device ID instead of the hardware fingerprint

## [1.0.0] - 2026-04-30

### Added

- Initial public release of QwenCloud CLI
- OAuth 2.0 Device Flow with PKCE authentication (`auth login`, `auth logout`, `auth status`)
- Interactive REPL and one-shot command execution modes
- Model discovery (`models list`, `models info`, `models search`)
- Usage tracking for Free Tier, Coding Plan, and PAYG (`usage summary`, `usage breakdown`, `usage free-tier`, `usage payg`)
- Configuration management (`config list`, `config get`, `config set`, `config unset`)
- Environment diagnostics (`doctor`) and shell completion for zsh, bash, and fish
- Secure credential storage: OS keychain with AES-256-GCM encrypted file fallback
- Agent-friendly output: `--format json`, `--quiet`, and standardized exit codes (0–4, 130)
- Global config at `~/.qwencloud/config.json` with auto-migration from `<cwd>/.qwencloud.json`
