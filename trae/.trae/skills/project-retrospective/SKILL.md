---
name: project-retrospective
description: Conducts Harness Engineering project retrospectives against easy-harness spec (AGENTS.md, hooks, agents, artifacts). Evaluates workflow compliance, proposes spec improvements for user approval, then implements and tests approved changes. Use only when the developer manually invokes project retrospective, post-mortem, or harness spec review.
disable-model-invocation: true
---

# 项目复盘（Harness Engineering）

对**已完成或已终止**的 Harness 流程做复盘：先对照规约评估执行合规性，再产出规约改进建议（须用户审核），最后对**已批准**项修改规约并跑框架回归测试。

> **手动调用**：本 skill 仅在开发者显式发起复盘时使用，不随日常开发自动加载。
>
> **规约权威源**：`AGENTS.md`（常驻 charter §1–§8）、`.trae/harness/spec/`（说明权威细则）、`README.md`（自测与配置）、`.trae/hooks/**`、`.trae/agents/**`、`.trae/templates/**`。
>
> **元规则 R12**：规约改动**只可加强、不可放松**；放宽约束须拒绝并说明替代方案（如拆分迭代、补机械门禁而非删文档）。

## 前置：定位复盘范围

1. 确认工作区根目录存在 `AGENTS.md` 与 `.trae/harness.config.json`（easy-harness 或已接入的宿主项目）。
2. 读取 `.trae/harness-state.json` 的 `activeProcessPath`；无则默认 `docs/process/process.md`。
3. 与用户确认复盘对象：
   - **单次迭代**：指定 `docs/**/process/process.md` 路径；
   - **多 feature**：列出各 `process.md` 分别复盘；
   - **仅规约自评**（无运行时 `docs/`）：跳过 Phase 1 项目证据，直接进入 Phase 2。

将确认结果记入输出报告头部的「复盘范围」。

---

## Phase 1：项目复盘与合规评估

按 [audit-checklist.md](audit-checklist.md) 逐项检查，证据须引用具体文件路径与章节/表格行。

### 1.1 收集证据

| 类别 | 路径 |
| ---- | ---- |
| 流程状态 | 活跃 `process.md`（frontmatter + 各 `##` 节） |
| 需求/设计 | `docs/**/requirement/*.md`、`docs/**/design/*.md`、`gated-artifacts.json` |
| 质量/测试 | `docs/**/quality/*.md`、`docs/**/test/*.md`、`test-results/e2e/.e2e-*.json` |
| 规约 | `AGENTS.md`、`README.md`、`.trae/agents/*.md`、`.trae/hooks/**` |

### 1.2 合规判定维度（摘要）

- **工作流模式**：`workflow_mode` / `iterationType` 是否与用户目标匹配（`.trae/harness/spec/workflow-modes.md` 分诊表）。
- **角色与门禁链**：`.trae/harness/spec/gate-chain.md` 成果物是否齐全、用户确认是否留痕、`blocking`/`cancelled` 是否正确处理。
- **开发编排**：分派计划、待派发列表、进度列表（B1 最新状态）、回退计数是否一致。
- **测试闭环**：批次/最终集成测试与 E2E（`.trae/harness/spec/mechanical-gates.md` §8.3）；`hotfix` 是否按 R11 折叠；`gatePassed` 是否达标。
- **顶层代理边界**：是否存在代写源码/设计、越级 Task、Hook 绕过等（`AGENTS.md` §5，结合 git 历史或对话记录若可获）。
- **机械门禁对齐**：文档声明与 `workflow-gate-lib.mjs` / Hook 行为是否一致（R13、TG-D-4）。

### 1.3 输出：复盘报告

使用以下模板写入 `docs/retrospective/YYYY-MM-DD-<简短主题>.md`（目录不存在则创建）：

```markdown
# 项目复盘报告

## 复盘范围
- 项目/迭代：
- process.md：
- 复盘日期：

## 执行摘要
（2–4 句：整体是否按规约推进、最大风险点）

## 合规评估

| 维度 | 结论（合规/部分合规/不合规） | 证据 | 说明 |
| ---- | ---------------------------- | ---- | ---- |

## 流程亮点
- 

## 问题与根因
| # | 现象 | 根因分类（执行偏差/规约缺口/工具限制） | 影响 |
| --- | ---- | -------------------------------------- | ---- |

## 规约改进候选（待 Phase 2 细化）
| # | 关联问题 | 初步方向 | 是否触及 R12 |
| --- | -------- | -------- | ------------ |
```

**Phase 1 结束**：向用户展示摘要；若存在「不合规」且为执行偏差，在报告中区分「规约问题」与「执行问题」，避免把执行失误误归为改规约。

---

## Phase 2：规约改进建议（须审核）

基于 Phase 1 的「规约缺口」与「规约改进候选」，产出**可执行**改进方案。**未经用户批准不得进入 Phase 3。**

### 2.1 改进项编写原则

每条建议须包含：

| 字段 | 要求 |
| ---- | ---- |
| 问题陈述 | 规约哪一节/哪条规则在项目中暴露不足 |
| 改进方案 | 具体改哪些文件（`AGENTS.md` / `.trae/harness/spec/` / agent / hook / 模板 / README） |
| R12 判定 | `加强` / `澄清（不弱化）` / `需机械门禁补齐`；**禁止**「删除约束」「降低 gatePassed 标准」类方案 |
| 优先级 | P0（阻塞后续项目）/ P1（显著降摩擦）/ P2（文档/体验） |
| 验证方式 | 将跑哪些自测（见 Phase 3） |

### 2.2 审核门禁

使用 `AskQuestion` 让用户对每条建议勾选：**批准 / 修订后批准 / 驳回**，并可补充约束。

将审核结果追加到复盘报告：

```markdown
## 规约改进审核记录

| # | 建议摘要 | 用户决定 | 备注 |
| --- | -------- | -------- | ---- |
```

**仅「批准」或「修订后批准」的条目进入 Phase 3。** 若用户要求放松约束，说明 R12 限制并给出加强型替代（例如：新增豁免须用户确认 + `gated-artifacts.json` 留痕，而非删除 E2E 要求）。

---

## Phase 3：实施改进与测试

### 3.1 实施顺序

1. 先改**机械层**（`workflow-gate-lib.mjs`、各 `gate-*.mjs`、`e2e-run-lib.mjs`）再改**文档层**（`AGENTS.md`、`.trae/harness/spec/`、`README.md`、agents、templates），保持 TG-D-4 / R13 表述一致。
2. 同步更新受影响的 agent 文件中的交叉引用。
3. 在复盘报告中记录「变更清单」：文件路径 + 一行变更说明。

### 3.2 框架回归测试（必跑）

在工作区根目录依次执行；**全部通过方可宣称 Phase 3 完成**：

```bash
node .trae/scripts/gate-selftest.mjs
node .trae/scripts/gate-scenarios.mjs
```

若修改了 `e2e-run-lib.mjs`，另跑（需已安装 vitest）：

```bash
npx vitest run --config .trae/scripts/vitest.config.ts
```

失败时：修复实现或回滚该条改进，**不得**为通过测试而弱化门禁（R12）。

### 3.3 可选：为新增门禁补场景

若 Phase 3 新增机械判定，在 `gate-selftest.mjs` 或 `gate-scenarios.mjs` 中补最小回归用例，并在变更清单中注明。

### 3.4 输出：收尾

更新复盘报告：

```markdown
## 已实施改进

| # | 文件 | 变更说明 | 自测结果 |
| --- | ---- | -------- | -------- |

## 遗留项
（驳回项、修订待办、执行层改进建议给团队）
```

向用户提供：报告路径、自测命令输出摘要、未批准项列表。

---

## 执行约束

- **不跳过审核**：Phase 2 → Phase 3 之间必须有用户明确批准。
- **复盘不代替交付**：复盘 skill 不宣告「项目已完成」；完成判定仍以 `process.md` 测试闭环为准。
- **治理改动归属**：修改 `.trae/scripts|agents|hooks/**` 时，若当前项目仍有活跃开发流程，应提醒用户此类改动属 `governance-overhaul`；本 skill 在复盘场景下由开发者手动触发，可直接实施已批准项。
- **证据优先**：合规结论必须可追溯到文件内容，禁止无证据的笼统评价。

## 附加资源

- 完整审计清单：[audit-checklist.md](audit-checklist.md)
