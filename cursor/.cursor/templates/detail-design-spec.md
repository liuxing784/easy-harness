# 详细设计说明书

## 1. 技术选型确认

（引用用户已确认的技术栈原文，或"用户目标中已明确技术栈：……"）

## 2. 系统架构

（整体架构图/说明、模块划分、关键设计决策与取舍理由）

## 3. 目录结构

| 路径 | 用途 | 是否受门禁保护 |
| ---- | ---- | -------------- |
| | | 是/否 |

> 「是否受门禁保护」须与 `gated-artifacts.json`（见 §7）及 `.cursor/harness.config.json` 默认列表核对一致。

## 4. 接口 / 数据模型设计

（按项目技术栈：API 契约、数据库 schema、状态管理等）

## 5. 代码规范

- 注释语言：（中文/英文，与项目约定一致）
- 命名风格：
- 复杂逻辑块须有注释；
- 目录结构须与本文件 §3 一致。

## 6. 测试策略

| 测试类型 | 负责角色 | 工具/命令 | 覆盖范围 |
| -------- | -------- | --------- | -------- |
| 单元测试 | development-engineer | | |
| 集成测试 | test-engineer | | |
| 接口测试 | test-engineer | | 开发窗口批次集成测试阶段必测（R14，见 AGENTS.md §8.3）；覆盖各接口/契约 |
| E2E（若适用） | test-engineer | Playwright Chromium headless | P0 场景，见 AGENTS.md §8.3 |

> 若项目无 UI 或不适用浏览器 E2E，须在 §7 `gated-artifacts.json` 中声明 `e2eApplicability: "n/a"` 并注明理由，等待用户在 `process.md`「用户确认记录」中确认豁免。

## 7. 受门禁保护的产物声明

已同步写入 `docs/[{feature}/]design/gated-artifacts.json`（模板：`.cursor/templates/gated-artifacts.json`）。

## 8. 安全基线

（密钥管理、输入校验、依赖安全审计要求等最小约束）
