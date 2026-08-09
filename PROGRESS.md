# PROGRESS
1. 目标：Codex 与 Claude Code 仅通过 system CLI 运行，制品只携带固定版本轻量 SDK。
2. 初始 git status 为空；用户给定现状：测试 350/350，Codex 平台包 116 MiB，Claude SDK 77 MiB。
3. 任务 0 实测：`npm test` 为 tests/pass 350、fail/skipped/todo 0，typecheck 通过。
4. 编辑前基线构建通过；`.app` 1076875264 B、DMG 353378304 B、ZIP 369496064 B（`du -sk`）。
5. 基线 `.app`：Codex darwin-arm64 121032704 B；Claude 0.2.62 主包 70836224 B（磁盘字节）。
6. 顺序：运行时唯一化 → 制品精准排除与扫描红绿验证 → 最终构建、体积公式和真实 smoke。
7. 最大风险：Claude 0.3.226 API/认证差异，以及非 macOS 平台只能验证配置与扫描规则。
8. 任务 1 完成：SDK 锁定 0.147.0/0.3.226，仅 system CLI；相关 25/25、全量 350/350、typecheck 通过。
9. 任务 2/3 与 review 修复完成：扫描 0 命中、app 788881408 B、公式余量 101367808 B；Windows 新旧布局/managed env 4/4、Claude 无本机 CLI 隔离 1/1、全量 354/354；真实 smoke 与双 CLI 缺失反验通过。
