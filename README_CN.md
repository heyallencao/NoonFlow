# NoonFlow

<p align="center">
  <img src="./electron/icons/icon.png" width="128" alt="NoonFlow Logo">
</p>

<p align="center">
  <b>专注于 Claude Code 与 Codex 的桌面工作区</b>
</p>

<p align="center">
  简体中文 | <a href="./README.md">English</a>
</p>

---

NoonFlow 是一个原生 macOS 桌面界面，用来在项目工作区中使用 Claude Code 和 Codex。当前版本主动聚焦于对话、原生会话延续、终端和运行时配置。

## 当前能力

- **Claude Code 与 Codex** — 在同一个工作区中切换两种本地编码运行时
- **工作区优先** — 只展示你在 NoonFlow 中主动打开过的项目，并回到项目最近的原生会话
- **原生会话延续** — 直接读取和恢复 Claude Code、Codex 会话，不导入、不复制到 NoonFlow 自己的对话数据库
- **记忆浏览** — 分页查看 NoonFlow 已打开工作区所关联的原生会话历史
- **终端与文件** — 在应用内浏览项目、编辑文件并使用集成终端
- **运行时配置** — 管理所支持编码运行时的 Skills、Hooks、Agents 和 MCP 配置
- **权限确认** — 在桌面界面中处理运行时发起的工具权限请求

## 当前边界

这个版本删除了 Monitor/分析页面、Git 仪表盘与 worktree 管理、bot 集成以及 bridge 子系统。NoonFlow 不再持久化自己的聊天副本；Claude Code 和 Codex 是各自会话的唯一事实来源。NoonFlow 只保留应用偏好，例如你主动打开过的工作区。

## 技术栈

- Next.js 16、React 19、TypeScript
- Electron 40
- Tailwind CSS 4、Radix UI
- node-pty、xterm.js
- Anthropic Claude Agent SDK、OpenAI Codex SDK
- better-sqlite3 只用于本地配置和进程内运行时表，不保存重复的对话历史

## 安装与运行

当前仓库支持从源码运行和构建，暂未发布经过 Apple 公证的 macOS 安装包。

**环境要求：**

- macOS 13 或更高版本
- Node.js 24（以 `.nvmrc` 为准）
- npm 11+
- 已安装并初始化 Claude Code 和/或 Codex

```bash
git clone https://github.com/heyallencao/NoonFlow.git
cd NoonFlow
nvm use
npm ci
npm run electron:dev
```

NoonFlow 可以沿用 Claude Code 和 Codex 现有的登录与配置；需要 API Key 模式时，也可以在设置中配置可选的供应商凭据。

## 开发

```bash
npm run lint       # ESLint
npm test           # 单元测试与 TypeScript 检查
npm run build      # Next.js 生产构建
npm run electron:smoke
```

本地 macOS 打包需要 Developer ID Application 证书；正式公开二进制发行还需要 Apple 公证配置。

## 开源协议

[MIT](./LICENSE)

## 致谢

- [Electron](https://www.electronjs.org/)
- [shadcn/ui](https://ui.shadcn.com/) 与 [Radix UI](https://www.radix-ui.com/)
- [HugeIcons](https://hugeicons.com/)
