# Changelog

## [0.6.0] - 2026-08-09

NoonFlow 0.6.0 is the focused Claude Code and Codex desktop workspace release.

### Highlights

- Focused the main product path on opened workspaces, native Claude Code/Codex conversations, project files, terminal access, and runtime configuration.
- Added paginated native session discovery and limited project listings to workspaces explicitly opened in NoonFlow.
- Kept Claude Code and Codex as the source of truth for conversation history; NoonFlow no longer persists a duplicate chat history.
- Preserved current-turn token/context status and desktop permission confirmation without creating a long-term conversation copy.

### Removed

- Monitor, cost/usage analytics, repository insights, timelines, and related dashboards.
- Git dashboard, diff/timeline APIs, and worktree management.
- Bot integrations, Telegram support, and the bridge subsystem.
- NoonFlow-owned session archives and conversation persistence.

### Fixed

- Restored workspace session opening after the native-session migration.
- Reduced native history loading work through server-side pagination.
- Prevented Codex `SessionEnd` hook timeout clamping warnings from appearing as failed model turns when the turn itself completes successfully.
- Cleaned stale navigation, settings, APIs, tests, and runtime storage related to removed modules.

### Maintenance and security

- Upgraded to Next.js 16.3.0, Electron 40.10.6, electron-builder 26.15.3, and `@electron/rebuild` 4.2.0.
- Reduced `npm audit` findings from 48 vulnerabilities, including 3 critical findings, to one upstream Electron high-severity advisory.
- The remaining Electron advisory concerns sandboxed iframes with `allow-popups`; NoonFlow does not grant that sandbox capability and intercepts top-level window creation.

### Distribution

This is a source release. A notarized macOS binary is not attached because the Apple notarization profile is not configured for this release environment.

## [0.5.1] - 2026-08-08

Initial public source baseline before the focused 0.6.0 feature reduction.
