# PROGRESS
1. 目标：Claude/Codex/Pi adapter 统一输出 `activity.updated`，静默存活输出不可见 `runtime.heartbeat`；watchdog/UI 仅消费统一事件。
2. 现场：`pwd`/repo root=`/Users/allen/.codex/worktrees/c585/NoonFlow`；detached HEAD=`4cd45d0f59b5cf35f2d912c7dfa9b7c272c61f3a`；初始工作树干净。
3. 顺序：任务 0 基线 → 事件/超时红绿 → snapshot/reducer/UI → mocked-SSE Playwright 与双尺寸截图 → 全量门禁/白名单审计。
4. 基线：`native:ensure` 通过；`test:unit:full` 447/447；`npm test` 427/427 + typecheck；lint 0 warning；build 40 routes 成功。
5. Playwright 基线：首次因克隆的绝对 `.bin/playwright` 导致双实例而失败；唯一环境恢复改为 worktree 相对链接后，`--list`=169 tests/17 files。
6. 最大风险：三端原生事件身份/终态不对称，以及现有 idle/tool timeout 自动重试会同时造成误杀和重复 prompt。
7. 红证据：聚焦命令首跑 86 tests，76 pass/9 fail/1 cancelled；缺口正是统一 adapter、heartbeat、watchdog snapshot、三端映射、`timeout=0`。
8. 任务 1 完成：三端仅输出完整 `activity.updated`；Pi 不冒充 subagent；heartbeat 不持久化/渲染；activity/heartbeat 续期；Stop/断流仅请求一次；删除 timeout 自动 prompt；`timeout=0` 保持禁用。
9. 绿证据：同一聚焦命令 91 tests，91 pass，fail/cancelled/skip/todo=0，5.14s；fake time 已覆盖活动超过 330s 不误杀及其后 331s 真断流 Stop 一次。
10. 当前：任务 2，接入 assistant message supplemental 的统一折叠活动 UI 与 mocked-SSE Playwright。
11. 任务 2 完成：同一 `ChildActivity[]` reducer/upsert 驱动消息 supplemental；运行/等待展开、全终态自动折叠；类型/标题/状态/时长/摘要可见，普通 Read 工具仅留在 ToolActionGroup。
12. Playwright 首跑误复用 3000 端口的主 checkout 旧服务而 2 fail；未终止该服务，独立端口重跑 2/2 pass（17.7s），Stop 请求=1 且迟到更新不可见；桌面/390px 均保存截图并验证无横向溢出。
13. 当前：全量门禁、warning 清理与 diff 白名单审计。
14. 全量最终：`test:unit:full` 457/457、89 suites；`npm test` 437/437、83 suites且两套 typecheck 通过；均 fail/cancelled/skip/todo=0，测试数较基线各 +10。
15. 门禁修复：lint 首跑 1 个 effect 同步 setState 错误，phase-key remount 后复跑 0 warning；`npm test` 首跑 1 个测试 cast 类型错误，修正后复跑通过；均未超过 1 轮。
16. `npm run build`：编译/TypeScript/40 个静态页成功；最终 Playwright（独立 3182，移除环境 NO_COLOR 噪声）2/2 pass、13.8s；`--list`=171 tests/18 files。
17. 截图：`test-results/chat-child-activity-messag-f3002-ate-and-fits-desktop-mobile/{child-activity-desktop,child-activity-390px}.png`（测试产物未纳入 diff）。
18. 最终审计：`git diff --check` 通过；32 个变更文件全部在白名单；无新增 skip/todo、依赖/lock/config/数据库改动；截图已被 gitignore；`BLOCKED.md` 为“无”。任务完成。
19. Review 修复红证据：真实 Codex lifecycle/fixture 与 Claude background Bash `task_id` 聚焦测试首跑 64 tests，60 pass/4 fail；失败分别为事件 ID 未归一、`started/interacted` 误 completed、`agentsStates` 对象摘要丢失、后台 Bash 999s 被 timeout；普通前台 Bash 超时仍绿。
20. 当前：实现 Codex 稳定 `agentThreadId` upsert/点事件状态语义，以及仅对已知运行中 subagent/background `task_id` 豁免普通工具墙钟。
21. Review 修复绿证据：同一聚焦命令复跑 64/64，fail/cancelled/skip/todo=0；不同 Codex event id 归一为同一 `agentThreadId` 且保留 `startedAt`，后台 Bash 999s 不 abort，带未知 `task_id` 的普通 Bash 31s 仍 timeout。
22. 当前：复跑全量 unit/test/lint/build 与活动 UI Playwright，并审计白名单和 `BLOCKED.md`。
23. Review 修复全量：`test:unit:full` 458/458、89 suites；`npm test` 438/438、83 suites且两套 typecheck 通过；较基线均 +11，fail/cancelled/skip/todo=0。
24. `npm run lint` 0 warning；`npm run build` 编译/TypeScript/40 静态页成功；活动 UI Playwright 首跑 2/2 但继承颜色环境产生 Node warning，移除 `NO_COLOR` 后复跑 2/2、12.4s、warning=0。
25. 最终审计：`git diff --check` 通过；变更仍仅在原白名单；无新增 skip/todo/依赖/lock/config/数据库改动，测试截图继续被忽略；`BLOCKED.md` 为“无”。Review 修复完成。
26. 自审修复红证据：Claude 前台 Bash `task_started` 与后台集合移除聚焦首跑 17 tests，14 pass/3 fail；确认前台 Bash 超时被错误豁免且进入活动流，后台移除伪造 completed 后又被原生终态重复完成。
27. 当前：仅把明确 subagent/background/workflow 作为活动和超时豁免对象；后台集合移除等待原生 `task_notification/task_updated`，整轮终态继续由 stream manager 兜底。
28. 自审修复绿证据：同一聚焦命令复跑 17/17，fail/cancelled/skip/todo=0；前台 Bash 带 `task_started` 仍在 31s timeout 且不产生活动，后台 Bash 999s 不 abort，集合移除不发终态、原生 notification 才完成。
29. 当前：复跑全量 unit/test/lint/build 与活动 UI Playwright，完成最终审计。
30. 自审修复全量：`test:unit:full` 458/458、89 suites；`npm test` 438/438、83 suites且 typecheck 通过；fail/cancelled/skip/todo=0，测试数仍较基线各 +11。
31. `npm run lint` 0 warning；`npm run build` 编译/TypeScript/40 静态页成功；warning-free 活动 UI Playwright 2/2、13.3s。
32. 最终审计：`git diff --check` 通过；32 个变更项仍全部在白名单，无新增 skip/todo/依赖/lock/config/数据库改动；`BLOCKED.md` 为“无”。自审核心修复完成。
33. Pi lifecycle 红证据：`npx tsx --test src/__tests__/unit/pi-client.test.ts src/__tests__/unit/agent-runtime.test.ts` 首跑 25 tests，22 pass/3 fail；证明 `agent_end` 误 completed、首次可重试 `message_end(error)` 提前终止进程、最终错误未等到 retry/settled。
34. 当前：以 `agent_settled` 为 Pi 唯一终态，暂存 assistant error 并允许原生 retry/compaction 清除；活动在 settled 前只保持 running/waiting。
35. Pi lifecycle 绿证据：同一聚焦命令复跑 25/25，fail/cancelled/skip/todo=0；原生 retry 成功保留后续答案且中间无 completed，重试耗尽只上报最终错误并以 failed settled。
36. 当前：复跑全量 unit/test/lint/build 与活动 UI Playwright，再做白名单和 diff 审计。
37. Pi lifecycle 全量：`test:unit:full` 460/460、89 suites；`npm test` 440/440、83 suites且 typecheck 通过；较基线分别 +13，fail/cancelled/skip/todo=0。
38. `npm run lint` 0 warning；`npm run build` 编译/TypeScript/40 静态页成功；Playwright 首跑误复用 3000 端口旧服务而 2 fail，确认 PID 78370 后改独立 3183 端口复跑 2/2、13.3s、warning=0。
39. 最终审计：`git diff --check` 通过；32 个变更项均在原白名单，依赖/lock/测试配置无改动；测试产物保持 ignored，`BLOCKED.md` 为“无”。Pi lifecycle 修复完成。
40. Codex 终态红证据：`npx tsx --test src/__tests__/unit/{agent-runtime,codex-client,codex-event-mapper}.test.ts` 首跑 58 tests，56 pass/2 fail；真实 `agentsStates[threadId]` 已为 completed/errored，但 adapter 只输出协作调用行，稳定子 Agent 行仍为 running。
41. 当前：让 Codex adapter 对同一 collab 事件同时 upsert 协作调用与各 `agentsStates` 子 Agent，并覆盖原生 pending/running/completed/errored/interrupted/shutdown/notFound 语义。
42. Codex 终态绿证据：同一聚焦命令复跑 59/59，fail/cancelled/skip/todo=0；collab 行与稳定 `threadId` 子 Agent 行同批更新，子 Agent 保留标题/startedAt/摘要，全部原生状态映射正确。
43. 当前：复跑全量 unit/test/lint/build 与活动 UI Playwright，并做 diff/白名单审计。
44. Codex 终态全量：`test:unit:full` 461/461、89 suites；`npm test` 首跑仅既有 Stop 80ms 时序断言 1 fail，未改阈值/断言，原命令复跑 441/441、83 suites且 typecheck 通过；最终 fail/cancelled/skip/todo=0。
45. `npm run lint` 0 warning；`npm run build` 编译/TypeScript/40 静态页成功；独立 3184 端口活动 UI Playwright 2/2、13.7s、warning=0。
46. 最终审计：`git diff --check` 通过；变更仍仅在原白名单，依赖/lock/测试配置无改动，测试产物保持 ignored；`BLOCKED.md` 为“无”。Codex 子 Agent 原生终态修复完成。
