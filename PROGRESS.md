# PROGRESS
1. 目标：Claude/Codex/Pi 共用 `RuntimeContextState`，只同步各 runtime 原生 usage/压缩生命周期与有界恢复。
2. 基线：保留 `HEAD=75347e2` 的现有脏树，不 fetch/merge/reset/checkout；指定 7 文件为 75/75，fail/skip/todo=0。
3. 已复核：Claude `/compact` 有 timeout/abort 竞争；Codex cached 去重、reasoning 门控、单 app-server 与 completed item 权威语义均保留。
4. 顺序：冻结三 runtime 职责边界 → Pi 原生 producer → Pi 恢复历史懒加载 → 反向红绿 → 最多 3 轮完整验收。
5. 最大风险：Pi 0.84.1 事件字段与 resume 失败时序；不得把 `estimatedTokensAfter` 或默认窗口升级为真实占用/决策。
6. 实现选择：按建议使用与 Claude/Codex 同形的 lazy loader；只在缺失/失效/失败后读取最多 50 条并裁剪。
7. 已完成：Pi `message_end` 仅更新 last-turn；原生 start/end 映射 trigger、成功/aborted/error/缺结果，近似 post 明示“约”且不生成占用。
8. 已完成：Pi 与 Claude/Codex 同形 lazy loader；正常 resume 不读/注入 DB，缺失或明确失败后才读最多 50 条并裁剪，局部 34/34。
9. 已交付：第 2 轮全量 421/421 与全部门禁通过；隐藏 unavailable 空条，Codex 改用原生 `last.totalTokens/window` 显示完整当前上下文。
