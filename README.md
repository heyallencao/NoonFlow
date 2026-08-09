# NoonFlow

<p align="center">
  <img src="./electron/icons/icon.png" width="128" alt="NoonFlow Logo">
</p>

<p align="center">
  <b>A focused desktop workspace for Claude Code, Codex, and Pi</b>
</p>

<p align="center">
  <a href="./README_CN.md">简体中文</a> | English
</p>

---

NoonFlow is a native macOS desktop interface for working with Claude Code, Codex, and Pi in project workspaces. The current version deliberately focuses on chat, native session continuity, terminal access, and runtime configuration.

## What it includes

- **Claude Code, Codex, and Pi** — choose any of the three local coding runtimes from one workspace
- **Workspace-first chat** — open only the projects you choose and return to their latest native sessions
- **Native session continuity** — read and resume Claude Code, Codex, and Pi sessions without importing or duplicating their conversation history into a NoonFlow database
- **Memory browser** — page through native session history for workspaces opened in NoonFlow
- **Integrated terminal and files** — inspect a project, edit files, and use a built-in terminal without leaving the app
- **Runtime configuration** — install, update, detect, enable, and choose all three runtimes; select provider-scoped Pi models and manage shared Codex/Pi Skills from the desktop UI
- **Permission handling** — review runtime tool permission requests in the desktop interface

## Current scope

This release removes the Monitor/analytics surfaces, Git dashboards and worktree management, bot integrations, and the bridge subsystem. NoonFlow no longer keeps its own persistent copy of chats. Claude Code, Codex, and Pi remain the source of truth for their sessions; NoonFlow persists only app preferences such as the workspaces you explicitly opened.

## Tech stack

- Next.js 16, React 19, and TypeScript
- Electron 40
- Tailwind CSS 4 and Radix UI
- node-pty and xterm.js
- Anthropic Claude Agent SDK, OpenAI Codex SDK, and Pi RPC mode
- better-sqlite3 for local configuration and process-local runtime tables, not duplicated conversation history

## Install and run

The repository currently supports running and building from source. A notarized macOS binary is not published yet.

**Prerequisites:**

- macOS 13 or later
- Node.js 24 (see `.nvmrc`)
- npm 11+
- Claude Code, Codex, and/or Pi installed and initialized

```bash
git clone https://github.com/heyallencao/NoonFlow.git
cd NoonFlow
nvm use
npm ci
npm run electron:dev
```

NoonFlow's desktop setup can install or update all three CLIs. For Pi it runs `npm install -g --ignore-scripts @earendil-works/pi-coding-agent`, requires Node.js 22.19.0 or newer, and checks the native model catalog. Run `pi` and use `/login` when credentials are missing. NoonFlow starts Pi through native RPC, preserves provider-qualified model IDs, uses Pi's own session files as the source of truth, and exposes the shared `~/.agents/skills` catalog to both Codex and Pi.

## Development

```bash
npm run lint       # ESLint
npm test           # Unit tests and TypeScript checks
npm run build      # Next.js production build
npm run electron:smoke
```

For a local macOS package, a Developer ID Application certificate is required. A public binary release additionally requires an Apple notarization profile.

## License

[MIT](./LICENSE)

## Acknowledgements

- [Electron](https://www.electronjs.org/)
- [shadcn/ui](https://ui.shadcn.com/) and [Radix UI](https://www.radix-ui.com/)
- [HugeIcons](https://hugeicons.com/)
