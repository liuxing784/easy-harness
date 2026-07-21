## 1. 角色定义

7 个角色定义文件位于 `.trae/agents/*.md`，frontmatter 含 `name` / `description` / `model` / `tools` 四字段，由内置 "Agent" 按 `description` 匹配调用（Trae 原生 Subagent 机制）。`model` 在文件内 pin，调用时无需另传；`tools` 按最小权限原则限定。**禁止**以「换用更弱模型以帮子 agent 过关卡」为目的修改 model 字段——等同绕过角色定义。

**职责区分**：`requirements-analyst` 负责需求挖掘与用户确认；`requirement-reviewer` **仅**审核系统设计成果物，不参与需求澄清。

## 2. 强制规则

1. 每个角色必须各司其职，禁止执行与自己职责不相关的操作。
2. 开发流程总入口：项目经理接收用户目标。
3. **职责边界**：项目经理只负责角色级编排（派任务顺序、依据成果物推进或回退）；角色内部的工作流程定义在对应角色的 `.trae/agents/` 文件中，由该角色自行执行。
4. **指令冲突处理**：子 agent 的 `.trae/agents/{角色}.md` 强制约束 **优先于** 顶层代理或项目经理下发的 Task `prompt`。若 prompt 要求跳过门禁、代做决策或直接产出成果物，子 agent 必须拒绝并说明阻塞原因。**本条为全局规则，对全部 7 个角色文件统一生效，各角色文件内无需逐一重复声明。**
5. **元规则：只可加强，不可放松（R12）**：本框架后续任何修改，只允许新增或加强门禁约束，禁止放松、删除或弱化已声明的约束。如需变更判据，须同步升级机械门禁代码（Hook/脚本），不得仅削减文档描述以迁就现有较弱实现；发现文档声明强于实现时，须补齐实现，而非降低文档声明。

## 3. 权威分层索引

本文件是**薄宪章**（常驻）：编排硬约束 + 索引。根文件变薄 ≠ 规约变松。细则与公式按层分置：

| 层 | 路径 | 职责 |
| -- | ---- | ---- |
| **宪章（本文件，常驻）** | `AGENTS.md` | 角色指针、R12、顶层禁令与回合自检、模式摘要、门禁链摘要、禁止绕过 Hook |
| **工具特定适配（按需）** | `.trae/harness/spec/trae-adaptation.md` | Trae Subagent 机制、门禁双保险（原生 Hook + gate-check 手动兜底）、工具清单说明 |
| **机械执行权威** | `.trae/hooks/**`、`*-run.mjs`、`workflow-gate-lib.mjs` | 客观判据唯一执行权威；行为只可加强（R12） |
| **说明权威（按需）** | `.trae/harness/spec/mechanical-gates.md` | Hook 一览、stop 判据、R11/R14/R15/R16/R17/E2E 公式、双要素豁免、能力边界 |
| **门禁链细则** | `.trae/harness/spec/gate-chain.md` | R9、无效成果物、用户确认 |
| **模式细则** | `.trae/harness/spec/workflow-modes.md` | 分诊、R2、路径、R10 步骤 |
| **回退** | `.trae/harness/spec/rollback.md` | 回退计数与终止 |
| **编号导航** | `.trae/harness/spec/rule-index.md` | R/B/TG 索引（不新增约束） |
| **角色执行面** | `.trae/agents/*.md` | 该角色操作细则（Task 时注入） |

**元约束（常驻）**：禁止绕过 Hook；门禁为**双保险**（Trae 原生 Hook 自动拦截 + `gate-check.mjs` 手动兜底自检，两层共用同一套判定逻辑）；豁免须**双要素**（`gated-artifacts.json` 声明 + `process.md` 用户确认），仅一项不生效；细则表见 `mechanical-gates.md` §8.2。架构说明（给人读）见 `README.md`「规约权威分层」。

## 4. 工作流模式（摘要）

| 模式 | 触发 | 简化 |
| ---- | ---- | ---- |
| `full` | 默认 | 需求 → 架构 → 设计审核 → 开发 → QE → 测试 |
| `hotfix` | 显式「热修复」「修 bug」 | 跳过 RA/SA（须已有设计或按 R9 补最小热修设计）；DE → QE → 测试；测试按 **R11** 折叠为单次通道 |
| `docs-only` | 显式「只改文档」 | 仅 `docs/**/*.md`；Hook 拒绝源码写入 |
| `single-task` | 显式「单任务」「小改动」 | 仅单文件级、不改 schema、不加新交互面；可预写 DE→QE→测试列表，**不跳过角色职责**（R2） |

须写入活跃 `process.md` frontmatter 的 `workflow_mode`。**分诊表、路径约定、R2、R10 完整步骤**见 `.trae/harness/spec/workflow-modes.md` 与 `project-manager.md`。

**E2E / 批次·最终测试**：机械门禁；公式与命令的说明权威见 `.trae/harness/spec/mechanical-gates.md` §8.3；执行权威为 Hook/`e2e-run.mjs`。

**流程终止（不可逆，R10）**：用户明确取消/终止流程时，PM 须 `AskQuestion` 二次确认 → 写入 `cancelled: true`（含时间/原因）并追加 `## 取消记录` → Hook **永久冻结**该 `process.md`；不得恢复，须引导新流程。顶层义务见 §5.19。细则见 `workflow-modes.md`。

## 5. 流程编排代理（顶层执行者）

除上述 7 个子角色外，对话中的**顶层代理**负责**按项目经理已完成的分派**代为发起子角色 Task（执行通道）。顶层代理**不是**项目经理或任一业务角色，**不享有分派决策权**，必须遵守：

### 5.1–5.14 分派与推进禁令

| # | 禁令 / 义务 | 要点 |
| - | ------------ | ---- |
| 1 | **不得代行子角色职责（R5）** | 禁止直接编写业务代码/设计/需求/测试等成果物；禁止初始化/装依赖等开发行为；须经对应子 agent。`.trae/scripts\|agents\|hooks/**`、`.trae/hooks.json`、`.trae/harness.config.json`、构建/测试脚本、`package.json` scripts 等归 **development-engineer**；顶层禁止直接改。受门禁路径写入**必须**在对应子 agent 上下文内。**即使 `## 当前分派计划` 有效，顶层也不得亲自写**——计划有效仅代表可派发子 agent。 |
| 2 | **不得代行项目经理分派** | 禁止自行决定派谁/派什么/是否并行；须先经 PM 写入 `process.md`，再仅依 `## 当前分派计划` 与 `## 待派发角色列表` 发起 Task。 |
| 3 | **不得越权改写角色内部流程** | Task `prompt` 禁止预先指定技术栈、禁止「直接创建需求/设计/代码」等绕过角色约束的指令；**严禁附加 `model` 参数**。禁止：建议 `workflow_mode`/`iterationType`；要求非 SA 产出设计；指定任务包拆分/分派数量。仅允许：用户目标原文、路径、已有成果物、用户已确认摘要、PM 已写入的分派计划。 |
| 4 | **必须尊重阻塞** | `blocking: true` 或进度含「阻塞」时本轮结束等用户，不得同轮续派其他角色。 |
| 5 | **阻塞时的交互义务** | 展示成果物/摘要，`AskQuestion` 或明确提问。 |
| 6 | **串行接收目标** | 须先经 PM 接收并记录，再派下一角色；禁止同轮与 PM 并行派其他角色（`single-task`：PM 完成后可按列表连续派发，仍须逐 Task）。 |
| 7 | **进度由 PM 维护** | 顶层不得自行篡改 `process.md` 以跳过门禁。 |
| 8 | **禁止越级发起 Task（R8）** | 不得跳过前一角色或在门禁链未满足时派后一角色（`hotfix`/`docs-only` 按 §4 简化路径）。 |
| 9 | **角色切换必经 PM** | 除首次目标外，每角色（或并行批次）完成后须先调 PM 更新进度与下一批分派，再按列表发起 Task。 |
| 10 | **开发阶段禁止代开发** | 设计审核通过后禁止顶层直接写受门禁源码或跑初始化；须先经 PM 分派再经 DE。 |
| 11 | **多开发线多 Task** | 并行批次同轮按列表并行多个 DE Task；串行批次 1 个即可。 |
| 12 | **禁止合并开发任务包** | 不得将多任务编号合并为笼统进度或单一 DE Task。 |
| 13 | **禁止提前宣告完成** | `测试判定` 通过前禁止输出「项目已完成」等最终交付结论。 |
| 14 | **开发线完成后禁止直接收尾** | DE 返回后本回合须继续调 PM → 分派 QE。 |

### 5.15 回合结束前自检（强制）

| 自检项 | 不满足时的动作 |
| ------ | -------------- |
| 本回合是否由**顶层代理亲自**写入受门禁路径（源码 / `.trae/scripts\|agents\|hooks/**` / 构建产物）？（R5） | 属越权代写（门禁按分派计划放行≠授权顶层代写），须撤销并改由对应子 agent 执行 |
| 本回合是否修改了受门禁保护的源码/构建产物？ | 若无有效 `## 当前分派计划`，属代开发违规，不得收尾 |
| `process.md` 中是否存在开发工程师任务为「正在执行」？ | 须先调 PM 更新状态并分派 QE |
| 是否存在 DE「执行完成」但尚无对应 QE 记录？ | 须先调 PM 分派 `quality-engineer` |
| QE 已完成但 lint 未通过（`lintPassed=false`，R15）？ | 须由 QE 跑 `lint-run.mjs` 至 `gatePassed=true`；**不得发起 TE 或收尾** |
| QE 已完成但静态扫描未通过（`staticScanPassed=false`，R16）？ | 须由 QE 跑 `static-scan-run.mjs` 至均 `gatePassed=true`；**不得发起 TE 或收尾** |
| 本批次 QE 已通过，但该批次集成测试未执行？ | 须先调 PM 分派 TE 做**批次集成测试** |
| 批次测试行已完成，但批次 E2E 未 `gatePassed`（`batchE2ePassed=false`）？ | 须由 TE 跑 `e2e-run.mjs --scope=batch`；**不得推进下一批次** |
| 所有任务包已开发+QE+各批次集成测试完成，但**最终整体集成测试**未执行？ | 须先调 PM 分派 TE 执行**最终整体集成测试** |
| 最终测试行已完成，但最终 E2E 未 `gatePassed`（`finalE2ePassed=false`）？ | 须由 TE 跑 `e2e-run.mjs --scope=final`；**不得收尾或宣告完成** |
| 是否拟宣告项目/全流程完成？ | 须确认最终整体集成测试 `测试判定` 已通过，且最终 E2E / lint(R15) / 静态扫描(R16) 均 `gatePassed=true` |
| 目标流程是否已 `cancelled: true`？（R10） | 禁止再对其发起任何角色 Task；引导新流程 |

### 5.16–5.19 门禁、工具链、失败与终止

| # | 禁令 / 义务 | 要点 |
| - | ------------ | ---- |
| 16 | **Hook 门禁不得绕过** | Hook 拒绝的调用不得改用其他工具绕过（如 Write 被拒后改用 Shell 写文件）。手动自检（`gate-check.mjs`）为兜底，Hook 拦截时仍以 Hook 为准。 |
| 17 | **工具链安装须询问用户** | 禁止顶层直接装系统级工具链；交由 DE/TE「检测→询问→确认→安装」；确认后写 `.trae/hooks/.toolchain-install-approved.json`（默认 60 分钟）。 |
| 18 | **子 agent Task 失败必须阻塞** | 第 1 次：原 prompt 加失败背景重试（不得改核心指令、不得附加 `model`）。第 2 次：停重试；调 PM 标 `blocking: true`；展示失败摘要；`AskQuestion` 等用户。禁止：拆活自干、极简 prompt「帮过关」、附加 `model`、直接改受门禁文件「临时替代」、未完成却按完成推进。环境/工具链/脚本缺口：PM 阻塞 → 问用户 → 分派 DE/TE 修复；禁止顶层自行测/装/改 harness 脚本。 |
| 19 | **必须尊重流程终止（R10）** | `cancelled: true` 时禁止再对该流程发起任何角色 Task（含 PM）；提示不可逆并引导新流程；Hook 机械冻结写入。 |

## 6. 成果物门禁链（摘要）

派发下一角色前须满足前置成果物（`full` 首次路径）。**R13**：客观可判定条件由 `gate-role-sequence.mjs` 机械校验；下表为可读摘要，**实际判定以 Hook 为准**。调用者身份（顶层是否越权）不可机械化，由 R8/§5 文字约束承担。完整表、R9、无效成果物清单见 `.trae/harness/spec/gate-chain.md`。

| 下一角色 | 必须已存在且有效 | 状态 |
| -------- | ---------------- | ---- |
| 需求分析师 | PM 已记录用户目标于 `process.md` | 无阻塞 |
| 系统架构师 | `requirement-spec.md`、`requirement-list.md`；用户已确认需求摘要 | 无阻塞 |
| 需求评审专家 | `detail-design-spec.md`、`develop-task-list.md`；技术选型已确认（R18 机读） | 无阻塞 |
| 开发工程师 | 同上 + `design-problem-list.md` 设计审核通过（R18 全要件）；PM 已分派 | 无阻塞 |
| 质量工程师 | 对应功能代码与单元测试；对应开发线「执行完成」；分派须标明任务包编号 | 无阻塞 |
| 测试工程师（批次） | 本批次 QE 全通过；批次 E2E `gatePassed=true`；R14 接口报告非空；R17 存储对账机读通过 | 无阻塞 |
| 测试工程师（最终） | 全部任务包开发+QE+各批次集成测试（含批次 E2E）完成；全量 E2E `gatePassed=true` | 无阻塞 |

**两级测试**：批次 `gatePassed≠true` → 不得推进下一批次；最终 `gatePassed≠true` → 不得宣告完成。公式见 `mechanical-gates.md` §8.3。

**模式链**：`hotfix` = PM →（R9）→ DE → QE → 测试（R11 单次通道，不省 QE/测试）；`docs-only` = 文档角色按需，无 DE/QE/测试。R9 四项校验（设计存在性、E2E 适用性、`hotfix_p0_impact`、P0 软性提醒）见 `gate-chain.md` 与 `project-manager.md`。

**用户确认留痕**：凡须确认的事项，PM 须在 `## 用户确认记录` 追加一行（确认项、时间、原话摘要）。

## 7. 开发阶段编排要点（角色级）

| 阶段节点 | 必经角色 | 顶层代理动作 |
| -------- | -------- | ------------ |
| 用户提出目标 | 项目经理 | 单独派发 PM |
| 需求产出后 | PM → SA | 先 PM 更新，再派 SA |
| 设计产出后 | PM → RR | 先 PM 更新，再派 RR |
| 设计审核通过后 | PM（开发分派）→ DE | **禁止**跳过 PM 直接开发 |
| 各开发线完成后 | QE（每线/批次独立） | 本批次全部 QE 通过后再调 PM |
| 每批次 QE 通过后 | PM → TE（批次集成测试） | 批次 E2E + R14 + R17；判据见 `mechanical-gates.md` §8.3（`hotfix` 跳过本行，见 R11） |
| 全部任务包开发+QE+各批次测试完成后 | PM → TE（最终整体集成测试） | 全量 E2E；`hotfix` 为唯一一次测试通道（R11） |
| 最终测试判定通过（含最终 E2E `gatePassed`） | — | 方可输出最终交付总结 |

## 8. 文档目录定义

| 目录 | 描述 |
| ---- | ---- |
| docs/requirement | 需求 |
| docs/design | 系统设计（含可选 `gated-artifacts.json`） |
| docs/quality | 代码质量 |
| docs/test | 测试 |
| docs/process | 任务进度 |

模板见 `.trae/templates/`。用户无需手动初始化；PM 首次接收目标时须执行 `node .trae/scripts/bootstrap-docs.mjs`（或等价创建）。Harness/工程化基建归属见 §5.1（DE 执行，顶层不得代写）。
