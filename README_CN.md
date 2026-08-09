# NoonFlow

<p align="center">
  <img src="./electron/icons/icon.png" width="128" alt="NoonFlow Logo">
</p>

<p align="center">
  <b>专注于 Claude Code、Codex 与 Pi 的桌面工作区</b>
</p>

<p align="center">
  简体中文 | <a href="./README.md">English</a>
</p>

---

NoonFlow 是一个原生 macOS 桌面界面，用来在项目工作区中使用 Claude Code、Codex 和 Pi。当前版本主动聚焦于对话、原生会话延续、终端和运行时配置。

## 当前能力

- **Claude Code、Codex 与 Pi** — 在同一个工作区中选择三种本地编码运行时
- **工作区优先** — 只展示你在 NoonFlow 中主动打开过的项目，并回到项目最近的原生会话
- **Git Worktree** — 创建 NoonFlow 管理的 worktree、打开已有外部 worktree，并让每个运行时会话在所选检出目录中隔离执行
- **原生会话延续** — 直接读取和恢复 Claude Code、Codex、Pi 会话，不导入、不复制到 NoonFlow 自己的对话数据库
- **记忆浏览** — 分页查看 NoonFlow 已打开工作区所关联的原生会话历史
- **终端与文件** — 在应用内浏览项目、编辑文件并使用集成终端
- **运行时配置** — 在桌面端安装、更新、检测、启用和选择三种运行时；选择带 provider 的 Pi 模型，并管理 Codex/Pi 共享 Skills
- **权限确认** — 在桌面界面中处理运行时发起的工具权限请求

## 当前边界

精简后的产品不再包含 Monitor/分析页面、宽泛的 Git 仪表盘、bot 集成和 bridge 子系统，但保留面向隔离编码会话的轻量 Git worktree 流程，不恢复仓库分析能力。NoonFlow 不持久化自己的聊天副本；Claude Code、Codex 和 Pi 仍是各自会话的唯一事实来源，NoonFlow 只保留应用偏好，例如你主动打开过的工作区。

## 技术栈

- Next.js 16、React 19、TypeScript
- Electron 40
- Tailwind CSS 4、Radix UI
- node-pty、xterm.js
- Anthropic Claude Agent SDK、OpenAI Codex SDK、Pi RPC 模式
- better-sqlite3 只用于本地配置和进程内运行时表，不保存重复的对话历史

## 安装与运行

当前仓库支持从源码运行和构建，暂未发布经过 Apple 公证的 macOS 安装包。

**环境要求：**

- macOS 13 或更高版本
- Node.js 24（以 `.nvmrc` 为准）
- npm 11+
- 已安装并初始化 Claude Code、Codex 和/或 Pi

```bash
git clone https://github.com/heyallencao/NoonFlow.git
cd NoonFlow
nvm use
npm ci
npm run electron:dev
```

NoonFlow 的桌面安装向导可以安装或更新三种 CLI。Pi 使用 `npm install -g --ignore-scripts @earendil-works/pi-coding-agent`，要求 Node.js 22.19.0 或更高版本，并会检查原生模型目录；缺少认证时运行 `pi` 后使用 `/login`。NoonFlow 通过 Pi 原生 RPC 启动，保留带 provider 的模型 ID，以 Pi 自己的会话文件为事实来源，并让 Codex 与 Pi 共享 `~/.agents/skills` 技能目录。

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
