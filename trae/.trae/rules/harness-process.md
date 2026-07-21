---
description: Harness 流程文档提醒：编辑 process.md 时对照门禁链与模式细则
globs: docs/**/process.md
alwaysApply: false
---

# process.md 编辑提醒

- 编排硬约束见根目录 `AGENTS.md`（顶层禁令、回合自检、门禁链摘要）。
- 模式分诊 / R2 / R10 细则：`.trae/harness/spec/workflow-modes.md` 与 `project-manager.md`。
- R9 / 无效成果物：`.trae/harness/spec/gate-chain.md`。
- 机械判据以 Hook 为准；禁止绕过 Hook；豁免须双要素（`gated-artifacts.json` + `## 用户确认记录`）。
- 客观公式与 stop 判据说明：`.trae/harness/spec/mechanical-gates.md`。
