# NoonFlow v0.5.1-pre 发布说明

发布日期：2026-04-18

## 版本概览

v0.5.1-pre 是一个以 **MCP 服务器管理体验升级** 和 **首页仪表盘优化** 为核心的增强版本。

本版本在 v0.5.0 品牌重命名（Monolith → NoonFlow）的基础上，重点对已有的 MCP 服务器配置页面进行了体验升级并正式开放入口，移除了尚未落地的 Memory 归档卡片，同时修复了 worktree 分支刷新延迟、成本模型卡片数据源偏差等问题。

## 本次重点更新

### 1) MCP 服务器管理页面体验升级与正式开放

MCP 配置页面此前已存在但 UI 较为基础（简单列表 + Tabs 布局），且未在侧边栏暴露入口，用户不易发现。v0.5.1-pre 对其进行了全面重构并正式开放：

- **统计概览**：顶部新增 4 格统计卡片（Total / stdio / HTTP / SSE），一目了然服务器分布
- **分组卡片**：按服务器类型（stdio / HTTP / SSE）分组展示，每组带图标、标题与计数标签，卡片内展示服务器名称、类型 badge、命令/URL 预览、环境变量 key 预览
- **搜索过滤**：支持按服务器名称或命令内容搜索，无匹配结果有独立空状态
- **视图切换**：List / JSON Config 两种视图切换，保持高级用户直接编辑 JSON 的能力
- **删除确认**：删除服务器前弹出确认对话框，防止误操作
- **操作反馈**：所有增删改操作通过 toast 通知成功/失败，替代此前仅有的 console.error
- **交互提示**：卡片 hover 显示编辑图标 + 右箭头，引导用户点击进入编辑

整体风格与 Skills、Hooks、Agents 页面统一使用 `AutomationHeader` + 分组卡片模式。

### 2) 侧边栏正式开放 MCP 入口

- **开放 MCP 导航项**：在 Automation 分组（Skills / Hooks / Agents）下方开放 MCP 入口，使用 CubeIcon 图标，链接 `/mcp`，中英文均显示 "MCP"
- **移除 Costs 导航项**：从 Monitor 分组中移除 `/costs` 入口（DollarCircleIcon），成本信息已由 CostByModelCard 在首页覆盖

### 3) 首页仪表盘：Memory 卡替换为 MCP 卡

首页 SmallCardsSection 中原 Memory 归档卡片调用的 `/api/memory/archives` 功能尚未落地，始终显示为 0。v0.5.1-pre 将其替换为 MCP 服务器卡片：

- 数据源：`/api/plugins/mcp`
- 跳转目标：`/mcp`（MCP 管理页面）
- 展示内容：服务器名称 + 类型（stdio / HTTP / SSE）

### 4) 首页 CostByModelCard 数据源修正

将成本模型卡片的数据源从 `/api/usage/stats` 切换至 `/api/sessions/stats`，使用 token 数与会话数代替不稳定的 cost 字段，提升数据准确性。

### 5) Worktree 分支刷新优化

在 worktree 缓存命中路径中增加默认 worktree 分支的即时检测，避免分支变更后需等待完整 reconcile 才能反映新分支名的问题。

## 用户可感知变化

升级到 v0.5.1-pre 后，用户通常会感受到：

- MCP 服务器配置页面从基础列表升级为有统计、有分组、可搜索的专业管理界面，并在侧边栏正式开放入口
- 首页第四张小卡片从无用的 Memory 归档变为有实际数据的 MCP 服务器概览
- 侧边栏可直接访问 MCP 配置页面
- 切换 worktree 分支后侧边栏更快显示新分支名
- 首页成本模型卡片数据更准确

## 兼容性与迁移

- 无破坏性数据迁移
- 本地数据目录仍为 `~/.noonflow/`
- 默认数据库仍为 `noonflow.db`
- 前端与 Electron 壳层版本号对齐至 `0.5.1-pre`

## 升级建议

- 如果你使用 MCP 服务器扩展 AI 能力，强烈建议升级到 v0.5.1-pre，MCP 管理体验显著改善
- 如果你关注首页仪表盘数据的准确性，建议升级以获得修正后的成本模型数据
- 如果你在多分支 worktree 场景下使用 NoonFlow，升级后分支名刷新将更及时

## 验证建议

建议在正式发布产物中重点回归以下场景：

- MCP 页面：添加 / 编辑 / 删除服务器，JSON 配置编辑，搜索过滤
- 首页：四张小卡片（Skills / Hooks / Agents / MCP）数据展示与跳转
- 侧边栏：MCP 导航项存在且可正常跳转
- Worktree：切换分支后侧边栏分支名刷新
- 首页 CostByModelCard 数据正常显示

## 致谢

感谢对 MCP 管理体验和首页仪表盘持续打磨的所有贡献者。

欢迎继续通过 Issue / PR 提交反馈与改进建议。
