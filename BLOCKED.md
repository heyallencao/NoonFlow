# BLOCKED

## 测试路径白名单歧义（按仓库事实处理）

- 任务书只允许修改 `src/tests/unit/**`，但仓库不存在该目录；实际测试在 `src/__tests__/unit/**`，且 `scripts/run-unit-tests.mjs` 只扫描后者。
- 为同时满足“直接对应测试”、删除旧 bundled 契约和 350 项全量通过，本轮将 `src/__tests__/unit/**` 视为任务书所指测试目录；这是唯一超出字面路径的改动。

## 跨平台实机验证

- Linux/Windows 的六类过滤与扫描规则已完整配置，但按任务书已拍板的主验收范围，本轮只实机构建 macOS arm64；其他平台未实机构建。
