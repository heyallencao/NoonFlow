# NoonFlow

<p align="center">
  <a href="./README.md">English</a> | 简体中文
</p>

NoonFlow 是一个面向 Claude Code 和 Codex 重度用户的可视化 AI coding 工作台。

它不是要替代底层 CLI，而是把交互层和管理层做得更强一些：更顺手的聊天工作流、更连续的 session 管理、更清晰的 memory 可见性，以及一个更适合长期 AI coding 工作的桌面工作台。

这个仓库当前先作为 NoonFlow 的公开入口，用来承接 releases、文档和反馈。公开源码可以按阶段继续补进来。

## 为什么做 NoonFlow

当 AI coding 变成日常工作后，痛点往往已经不是 CLI 能不能回答一个问题。

真正的痛点，是围绕它的整套工作流：

- 聊天和终端分散在太多窗口里
- skills、provider 配置和可复用的工作流资产散落在不同地方
- session history 和 memory 会随着使用变深而越来越难管理
- costs 很容易在长期使用中失去可见性
- repos、projects、worktrees 缺少一个统一的可视化管理层

NoonFlow 想做的，就是把这些东西重新拉回一个工作台里，让 AI coding 没那么碎，也更容易长期管理。

## 你能得到什么

- 一个同时容纳 Claude Code 和 Codex 的工作台
- 更好的聊天工作流，以及更强的 session / memory 可视化管理
- 把 skills、providers 和 model 配置放到一个地方管理
- 对 costs、repos、projects、worktree 活动有更清晰的可见性
- 一个更适合长期 AI coding 工作的本地桌面工作台

## 适合谁

NoonFlow 主要面向已经在高频使用 Claude Code 或 Codex、并且想要的不只是 terminal wrapper 的开发者。

如果你在意 session continuity、memory 管理、provider 灵活性，以及更贴近真实本地开发的工作流，它会更适合你。

## 当前可用范围

- 平台：macOS
- 运行时要求：已安装并完成认证的 Claude Code 或 Codex CLI
- 下载：[GitHub Releases](https://github.com/heyallencao/NoonFlow/releases)
- 快速开始：[QUICKSTART_CN.md](./QUICKSTART_CN.md)

## 接下来

- 扩展更多平台支持，优先补上 Windows 和 Linux
- 做更好的 onboarding 和更顺畅的首次使用体验
- 继续加强 memory、session 和长期工作流管理
- 支持更多 provider 集成，并把 model / endpoint 配置做得更顺手
- 把 repos、worktrees 和长会话相关的工作台继续打磨得更完整

## 反馈

- Bug 与安装问题：[GitHub Issues](https://github.com/heyallencao/NoonFlow/issues)
- 想法与产品讨论：[GitHub Discussions](https://github.com/heyallencao/NoonFlow/discussions)
- 常见问题：[docs/faq_CN.md](./docs/faq_CN.md)

## License

MIT
