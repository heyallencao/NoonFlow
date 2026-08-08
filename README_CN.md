# NoonFlow

<p align="center">
  <img src="./electron/icons/icon.png" width="128" alt="NoonFlow Logo">
</p>

<p align="center">
  <b>Claude Code 与 Codex CLI 的原生桌面 GUI</b>
</p>

<p align="center">
  AI 驱动编程工作流的可视化界面
</p>

<p align="center">
  简体中文 | <a href="./README.md">English</a>
</p>

---

## 功能特性

- **AI 支持** — 当前支持：Claude (Anthropic)、Codex (OpenAI)。架构已预留多供应商扩展
- **原生桌面体验** — 基于 Electron 构建，支持 macOS（即将支持 Windows/Linux）
- **集成终端** — 内置终端，基于 node-pty 和 xterm.js
- **MCP 插件系统** — 管理 Model Context Protocol 服务器和插件
- **会话管理** — 基于 SQLite 的持久化聊天记录
- **成本追踪** — 监控 API 使用量和消费情况
- **Worktree 支持** — Git worktree 集成，支持基于分支的工作流
- **技能市场** — 浏览和安装社区技能

## 技术栈

- **前端**: Next.js 16 + React 19 + TypeScript
- **桌面端**: Electron 33
- **样式**: Tailwind CSS 4 + Radix UI
- **终端**: node-pty + xterm.js
- **数据库**: better-sqlite3
- **AI SDK**: @anthropic-ai/claude-agent-sdk, @openai/codex-sdk

## 安装

### 下载预构建版本（推荐）

从 [Releases](https://github.com/heyallencao/NoonFlow/releases) 页面下载最新版本。

### 从源码构建

**环境要求：**
- Node.js 20+
- npm 10+
- macOS（用于构建 macOS 版本）

```bash
# 克隆仓库
git clone https://github.com/heyallencao/NoonFlow.git
cd NoonFlow

# 安装依赖
npm install

# 构建原生模块
npm run native:ensure

# 启动开发模式
npm run electron:dev
```

## 开发

### 可用脚本

```bash
# 开发
npm run dev              # 启动 Next.js 开发服务器
npm run electron:dev     # 以开发模式启动 Electron

# 构建
npm run build            # 构建 Next.js 生产包
npm run electron:build   # 为当前平台构建 Electron 应用

# macOS 专用构建
npm run electron:build:mac:arm64           # 为 Apple Silicon 构建已签名应用
npm run electron:build:mac:x64             # 为 Intel Mac 构建已签名应用
npm run electron:build:mac                 # 为当前架构构建已签名应用
npm run electron:build:mac:release         # 为当前架构构建已公证发布包

# 测试
npm run lint             # 运行 ESLint
npm run electron:smoke   # 运行冒烟测试
```

### 开发环境建议

NoonFlow 当前推荐采用“主仓库基线 + worktree 本地复用依赖”的方式开发，而不是每个 worktree 都重新 `npm install`。

为了保证构建可复现，建议从仓库根目录安装依赖，并在依赖或 Electron 版本变化后重新构建 Electron 原生模块。

### 项目结构

```
NoonFlow/
├── electron/           # Electron 主进程
│   ├── main.ts        # 主入口
│   ├── handlers/      # IPC 处理程序
│   ├── server.ts      # 静态文件服务器
│   └── icons/         # 应用图标
├── src/               # Next.js 前端
│   ├── app/           # App Router 页面
│   ├── components/    # React 组件
│   ├── hooks/         # 自定义 Hooks
│   └── lib/           # 工具函数
├── scripts/           # 构建脚本
├── docs/              # 文档
└── build/             # 构建输出
```

## 配置

### API 密钥

NoonFlow 需要 AI 供应商的 API 密钥。在设置页面配置：

- **Anthropic** — 从 [console.anthropic.com](https://console.anthropic.com) 获取密钥
- **OpenAI** — 从 [platform.openai.com](https://platform.openai.com) 获取密钥
- **Google** — 从 [aistudio.google.com](https://aistudio.google.com) 获取密钥

### MCP 服务器

在设置 > 插件中配置 MCP（Model Context Protocol）服务器。NoonFlow 支持：
- 自定义 MCP 服务器
- 内置工具（文件系统、终端等）

## 参与贡献

1. Fork 本仓库
2. 创建功能分支 (`git checkout -b feature/amazing-feature`)
3. 提交更改 (`git commit -m 'Add some amazing feature'`)
4. 推送到分支 (`git push origin feature/amazing-feature`)
5. 创建 Pull Request

## 开源协议

[MIT](./LICENSE)

## 致谢

- 基于 [Electron](https://www.electronjs.org/) 构建
- UI 使用 [shadcn/ui](https://ui.shadcn.com/) 和 [Radix UI](https://www.radix-ui.com/)
- 图标来自 [HugeIcons](https://hugeicons.com/)

---

<p align="center">
  为 Claude Code 社区精心打造 ❤️
</p>
