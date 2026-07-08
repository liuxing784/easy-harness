## 1. 角色定义

每个角色定义为一个子 agent，项目中定义了 7 种角色：

| 角色名称 | 子 agent 名称 | Agent 定义文件 |
| -------- | ------------- | -------------- |
| 项目经理 | project-manager | `.cursor/agents/project-manager.md` |
| 需求分析师 | requirements-analyst | `.cursor/agents/requirements-analyst.md` |
| 系统架构师 | system-architect | `.cursor/agents/system-architect.md` |
| 产品经理 | product-manager | `.cursor/agents/product-manager.md` |
| 开发工程师 | development-engineer | `.cursor/agents/development-engineer.md` |
| 质量保障工程师 | quality-assurance-engineer | `.cursor/agents/quality-assurance-engineer.md` |
| 测试工程师 | test-engineer | `.cursor/agents/test-engineer.md` |

发起 Task 时以各 agent 文件 frontmatter 中的 `name` 字段识别子 agent；`model` 字段指定该角色所用模型（Cursor Task 运行时读取，修改模型请直接编辑对应 agent 文件）。

**合法 model slug 对照表**（`model` 字段必须与此表精确匹配，包括点、连字符与后缀）：

| 角色 | 合法 model slug |
| ---- | --------------- |
| project-manager | `composer-2.5` |
| requirements-analyst | `claude-sonnet-5` |
| system-architect | `claude-opus-4-8` |
| product-manager | `composer-2.5` |
| development-engineer | `gpt-5.3-codex` |
| quality-assurance-engineer | `composer-2.5` |
| test-engineer | `composer-2.5` |

> 若 slug 不在系统可用列表中，Cursor Task 运行时将回退至父 agent 模型，导致角色定义失效。更换模型时须确认目标 slug 在系统中确实存在。

**职责区分**：`requirements-analyst` 负责需求挖掘与用户确认；`product-manager` **仅**审核系统设计成果物，不参与需求澄清。

## 2. 强制规则

1. 每个角色必须各司其职，禁止执行与自己职责不相关的操作。
2. 开发流程总入口：项目经理接收用户目标。
3. **职责边界**：项目经理只负责角色级编排（派任务顺序、依据成果物推进或回退）；角色内部的工作流程定义在对应角色的 `.cursor/agents/` 文件中，由该角色自行执行。
4. **指令冲突处理**：子 agent 的 `.cursor/agents/{角色}.md` 强制约束 **优先于** 顶层代理或项目经理下发的 Task `prompt`。若 prompt 要求跳过门禁、代做决策或直接产出成果物，子 agent 必须拒绝并说明阻塞原因。
5. **元规则：只可加强，不可放松（R12）**：本框架后续任何修改，只允许新增或加强门禁约束，禁止放松、删除或弱化已声明的约束。如需变更判据，须同步升级机械门禁代码（Hook/脚本），不得仅削减文档描述以迁就现有较弱实现；发现文档声明强于实现时，须补齐实现，而非降低文档声明。

## 3. 工作流模式

| 模式 | 触发条件 | 简化说明 |
| ---- | -------- | -------- |
| `full` | 默认 | 需求 → 架构 → 设计审核 → 开发 → QA → 测试 |
| `hotfix` | 用户显式声明「热修复」「修 bug」 | 跳过需求分析师与系统架构师（**须已有 `detail-design-spec.md`**；无则按 R9 前置校验先补最小热修设计，见 §5）；项目经理直接分派开发；测试环节按 **R11** 折叠为单次集成测试+E2E（不区分批次/最终，见 §8.2/§8.3） |
| `docs-only` | 用户显式声明「只改文档」 | 仅允许修改 `docs/**/*.md`；Hook 拒绝一切源码写入 |
| `single-task` | 用户显式声明「单任务」「小改动」 | 仅适用于**单文件级、不改 schema、不加新交互面**的小改动；允许项目经理在一次分派中连续编排 DE → QA → 测试，但仍须逐角色执行、不得代做（见下方 R2 收紧定义） |

> **真实浏览器 E2E 门禁**：批次 + 最终 E2E 为机械门禁（`e2e-run.mjs` 双模式判据），适用范围、`gatePassed` 公式与命令的唯一权威定义见 §8.3。

工作流模式须写入当前活跃 `process.md` YAML frontmatter 的 `workflow_mode` 字段。项目经理在接收用户目标时判定并记录。

### 迭代分诊判定表（PM 判定，须 process.md 留痕）

项目经理接收目标时，按下表依次判定 `workflow_mode` 与 `iterationType`，并在当前活跃
`process.md` frontmatter（`workflow_mode` / `iterationType`）与流程状态表中留痕：

| 判定维度 | 命中则 |
| -------- | ------ |
| 新增功能 / 新交互面（新页面、新接口、新命令面） | `full` + `feature`（或首次 `greenfield`） |
| 修改数据模型 / schema / 新增迁移 | `full`（禁止 `single-task`） |
| 仅改治理层（AGENTS/hook/config/agent 定义） | `full` + `governance-overhaul` |
| 修复缺陷、无需求/架构变更 | `hotfix`（沿用当前 process.md） |
| 仅改 `docs/**/*.md` 文档 | `docs-only` |
| 单文件级、不改 schema、不加新交互面的小改动 | 可 `single-task`（仍走完整角色职责，见 R2） |

> `iterationType` 取值仅限：`greenfield` / `feature` / `governance-overhaul` / `hotfix` / `docs-only`；
> 与 `workflow_mode` 协同（如 `governance-overhaul` 通常配 `full`）。缺省判定为 `full` + 对应 `iterationType`。

> **`single-task` 收紧定义（R2）**：仅适用于**单文件级、不改 schema、不加新交互面**的小改动。即便为 `single-task`：
> 1. **必须**保留需求确认记录（`## 用户确认记录` 至少一行）；
> 2. 最小设计**必须由 system-architect 产出**，或体现为 `detail-design-spec.md` 增量；**禁止项目经理代写设计**；
> 3. `single-task` 只压缩**分派节奏**（PM 可一次预写 DE→QA→测试列表），**不跳过任何角色职责**。

### 迭代模式（文档路径）

| 模式 | `process.md` 路径 | 适用场景 |
| ---- | ----------------- | -------- |
| Greenfield | `docs/process/process.md` | 首次从零开发 |
| Feature | `docs/{feature-名称}/process/process.md` | 功能迭代；需求/设计文档同目录子树 |
| Hotfix | 沿用当前活跃 `process.md` | 紧急修复；`workflow_mode: hotfix` |

并行开发多个 feature 时，各 feature 维护独立 `process.md`，顶层代理仅推进用户当前指定的活跃 feature。

**活跃流程指针**：Hook 默认读取 `docs/process/process.md`；若使用 Feature 迭代，项目经理须执行 `node .cursor/scripts/bootstrap-docs.mjs --feature=<feature-名称>` 或等价创建目录，并写入 `.cursor/harness-state.json`：

```json
{
  "activeProcessPath": "docs/<feature-名称>/process/process.md",
  "activeFeature": "<feature-名称>"
}
```

临时覆盖可使用环境变量 `HARNESS_PROCESS_PATH` 与 `HARNESS_GATED_ARTIFACTS_PATH`。

### 流程终止（不可逆，R10）

用户可随时明确表达终止某一流程（关键词如「取消」「终止流程」「不要继续了」「放弃这个迭代」，**不含**「取消当前这一步」之类的局部撤回）。触发后：

1. **项目经理必须先用 `AskQuestion` 做不可逆二次确认**，明确告知用户后果：该 `process.md` 将被永久冻结、无法恢复，若之后要继续相关工作须发起新的流程/迭代（新的 `process.md`）。
2. 用户确认后，项目经理在该 `process.md` frontmatter 写入 `cancelled: true`（含 `cancelledAt`、`cancelReason`），并在 `## 取消记录` 追加一行（时间、触发原话摘要、二次确认摘要）。
3. 写入后，该 `process.md` 即被 Hook **永久冻结**（机械门禁，见 §8.1）：任何角色（含项目经理本人）均不得再修改/删除该文件；针对该流程的任何开发/初始化操作一律被拒绝；`gate-stop-workflow` 检测到 `cancelled: true` 时直接放行、不再催促推进。
4. 项目经理与顶层代理**不得**、也**无法**（有 Hook 兜底）恢复已取消的流程；用户若要求恢复，须引导其发起新的 feature/迭代，不得声称「已恢复」。
5. 顶层代理规则新增（见 §4 新增项）：检测到目标流程 `cancelled: true` 时，禁止再对其发起任何角色 Task。

`cancelled` 语义强于 `blocking`：`blocking` 可由用户确认后解除并继续推进；`cancelled` 不可逆。

## 4. 流程编排代理（顶层执行者）

除上述 7 个子角色外，对话中的**顶层代理**负责**按项目经理已完成的分派**代为发起子角色 Task（执行通道）。顶层代理**不是**项目经理、开发工程师、系统架构师、需求分析师或产品经理，**不享有分派决策权**，必须遵守：

1. **不得代行子角色职责（R5）**：禁止直接编写业务代码、设计文档、需求文档、测试用例等成果物；禁止执行项目初始化、依赖安装、工具链安装等开发行为；必须通过对应子 agent 产出。`.cursor/scripts/**`、`.cursor/agents/**`、`.cursor/hooks/**`、`.cursor/hooks.json`、`.cursor/harness.config.json`、构建/测试脚本、`package.json` scripts 等 harness 与工程化基建文件，归 **development-engineer**（或后续新增的平台/工具工程职责）执行；顶层代理禁止直接编写或修改。**受门禁保护路径**（源码、`.cursor/scripts|agents|hooks/**`、构建产物等）**及治理配置文件**（`.cursor/hooks.json`、`.cursor/harness.config.json`——由 R5 文字约束归属，机制不门禁）的写入**必须发生在对应子 agent 上下文内**。**即使当前 `## 当前分派计划` 有效**，顶层代理也**不得亲自写**——分派计划有效仅代表「可派发对应子 agent」，不代表「顶层代理可代写」。
2. **不得代行项目经理分派**：禁止自行决定派给谁、派哪些任务包、是否并行；须先调用项目经理完成分派并写入 `process.md`，再仅依据 `## 当前分派计划` 与 `## 待派发角色列表` 发起 Task。
3. **不得越权改写角色内部流程**：向子 agent 下发的 Task `prompt` 中，禁止预先指定技术栈、禁止写「直接创建需求/设计/代码」等绕过该角色强制约束的指令；只能传递用户目标、项目路径、已有成果物路径、用户已确认摘要/选型原文、项目经理在 `process.md` 中写明的分派计划等上下文。**严禁在 Task 调用时附加 `model` 参数**——任何显式 `model` 覆盖均视为绕过角色定义，等同代行该角色职责。

   **禁止反例（顶层代理 Task prompt 内不得出现）**：
   - 建议 / 指定 `workflow_mode` 或 `iterationType`（判定权属项目经理）；
   - 要求产品经理（或任何非架构师角色）产出设计成果物；
   - 指定任务包范围、拆分方式或分派数量（分派权属项目经理）；
   - 预先指定技术栈、目录结构或实现方案。

   **仅允许传递**：用户目标原文、项目路径、已有成果物路径、用户已确认摘要/选型原文、
   项目经理已写入 `process.md` 的分派计划（`## 当前分派计划` / `## 待派发角色列表`）。
4. **必须尊重阻塞状态**：当前活跃 `process.md` 中 `blocking: true` 或进度表含「阻塞」时，顶层代理必须在本轮结束并等待用户回复，**不得**在同一轮继续发起其他角色 Task。
5. **阻塞时的交互义务**：向用户展示该角色已产出的成果物或摘要，使用 `AskQuestion` 或明确提问等待确认。
6. **串行接收目标**：用户目标必须先由项目经理子 agent 接收并记录进度后，再代为发起下一角色 Task；**禁止**在同一轮消息中与项目经理并行发起任何其他角色 Task（`single-task` 模式除外：PM 完成后可按列表连续派发，但仍须逐 Task 执行）。
7. **进度由项目经理维护**：`process.md` 的更新应通过项目经理子 agent 完成，顶层代理不得自行篡改流程状态以跳过门禁。
8. **禁止越级发起 Task（R8）**：不得跳过流程图中前一角色，或在成果物门禁链未满足时发起后一角色 Task（`hotfix` / `docs-only` 模式按 §3 简化路径执行）。
9. **角色切换必经项目经理**：除首次接收用户目标外，每一角色执行完成（或并行批次中全部角色执行完成）后，**必须先调用项目经理**完成进度更新与**下一批分派**，再按 `## 待派发角色列表` 代为发起 Task（`single-task` 模式下 PM 可预写多步列表，顶层代理按序执行）。
10. **开发阶段禁止代开发（R5 在开发阶段的体现）**：设计审核通过后，**禁止**顶层代理以任何理由直接编写受门禁保护的源码路径或执行项目初始化命令；必须先调用项目经理完成开发分派，再通过 `development-engineer` 子 agent 执行。
11. **多开发线须多 Task 发起**：并行批次须在同一轮按 `## 待派发角色列表` 并行发起多个 `development-engineer` Task（每条开发线一个）。串行批次发起 1 个 Task 即可。
12. **禁止合并开发任务包**：不得将多个任务编号合并为一条笼统的进度记录或一个开发 Task。
13. **禁止提前宣告项目完成**：在 `测试判定` 通过前，**禁止**向用户输出「项目已完成」「全流程完成」「MVP 已交付」等最终交付结论。
14. **开发线完成后禁止直接收尾**：开发工程师 Task 返回后，**本回合须继续**调用项目经理 → 分派质量保障工程师。
15. **回合结束前自检（强制）**：

| 自检项 | 不满足时的动作 |
| ------ | -------------- |
| 本回合是否由**顶层代理亲自**写入受门禁路径（源码 / `.cursor/scripts\|agents\|hooks/**` / 构建产物）？（R5） | 属越权代写（门禁按分派计划放行≠授权顶层代理代写），须撤销并改由对应子 agent 执行 |
| 本回合是否修改了受门禁保护的源码/构建产物？ | 若当前活跃 `process.md` 无有效 `## 当前分派计划`，属代开发违规，不得收尾 |
| `process.md` 中是否存在开发工程师任务为「正在执行」？ | 须先调用项目经理更新状态并分派 QA |
| 是否存在开发工程师「执行完成」但尚无对应质量保障工程师记录？ | 须先调用项目经理分派 `quality-assurance-engineer` |
| 本批次 QA 已通过，但该批次集成测试（`test-engineer`）未执行？ | 须先调用项目经理分派 `test-engineer` 做**批次集成测试** |
| 批次测试行已完成，但批次 E2E 未 `gatePassed`（`batchE2ePassed=false`）？ | 须由 test-engineer 运行 `e2e-run.mjs --scope=batch`；**不得推进下一批次** |
| 所有任务包已开发+QA+各批次集成测试完成，但**最终整体集成测试**未执行？ | 须先调用项目经理分派 `test-engineer` 执行**最终整体集成测试** |
| 最终测试行已完成，但最终 E2E 未 `gatePassed`（`finalE2ePassed=false`）？ | 须由 test-engineer 运行 `e2e-run.mjs --scope=final`；**不得收尾或宣告完成** |
| 是否拟宣告项目/全流程完成？ | 须确认**最终整体集成测试**的 `测试判定` 已通过，且最终 E2E `gatePassed=true` |
| 目标流程 `process.md` 是否已 `cancelled: true`？（R10） | 禁止再对其发起任何角色 Task；提示用户流程已终止，引导发起新流程 |

16. **Hook 门禁**：本项目在 `.cursor/hooks.json` 配置了流程门禁 Hook（见「流程门禁 Hook」一节）。Hook 拒绝的工具调用**不得**改用其他工具绕过（例如 Write 被拒后改用 Shell 写文件）。
17. **工具链安装须询问用户**：顶层代理**禁止**直接执行系统级工具链安装命令，必须交由 `development-engineer` 或 `test-engineer` 按各自文件中「检测 → 询问 → 确认 → 安装」流程执行（步骤定义以 `development-engineer.md`「依赖与环境工具链」一节为准，`test-engineer.md` 适用同一流程）；用户确认后创建 `.cursor/hooks/.toolchain-install-approved.json`（默认 60 分钟有效）配合 Hook 放行。
18. **子 agent Task 失败时必须阻塞，禁止降级自行执行**：当子 agent Task 因超时、取消或错误而未正常返回时，顶层代理须遵守以下升级策略，**严禁**以任何形式自行替代子 agent 完成其职责（包括简化 prompt 重试、直接写文件、直接执行 Shell 命令等）：

   | 失败次数 | 顶层代理动作 |
   | -------- | ------------ |
   | 第 1 次  | 在原始 prompt 基础上附加失败背景，重新发起同一子 agent Task（不得修改 prompt 核心指令，不得附加 `model` 参数） |
   | 第 2 次（累计） | 停止重试；调用项目经理将该步骤标记为阻塞（`blocking: true`）并写入 `process.md`；向用户展示失败摘要与当前流程状态；使用 `AskQuestion` 等待用户决策（重试 / 跳过 / 人工介入） |

   **禁止行为清单**（无论失败原因）：
   - 将子 agent 的工作内容拆分后由顶层代理自行完成
   - 通过极简英文 prompt 或省略约束性上下文「帮助子 agent 通过」
   - 在 Task 重试时附加 `model` 覆盖参数以期绕开阻塞
   - 直接修改受门禁保护的文件（`process.md`、源码、设计成果物等）作为「临时替代」
   - 在子 agent 尚未真正完成的情况下，按「已完成」推进下一阶段

   **环境 / 工具链 / 测试脚本缺口的正确升级路径**（禁止顶层代理自行处理）：
   1. 子 agent 因环境、工具链或测试脚本缺失而失败 → 项目经理将该步骤**标记阻塞**（`blocking: true`）；
   2. 使用 `AskQuestion` **询问用户**现有工具链路径 / 安装目标 / 修复策略；
   3. 用户确认后，由项目经理**分派 development-engineer**（或 test-engineer）在其上下文内检测、修复、补建脚本或安装工具链。
   - **禁止**顶层代理：自行跑测试、自行安装工具、自建/改写测试脚本或 harness 脚本来「替角色完成」。

19. **必须尊重流程终止状态（R10）**：检测到目标流程 `process.md` 的 `cancelled: true` 时，禁止再对其发起任何角色 Task（含 project-manager），须提示用户该流程已被取消终止（不可逆），并引导其发起新的流程/迭代。该文件同时被 Hook 机械冻结（见 §8.1），任何写入尝试都会被拒绝。

## 5. 成果物门禁链

派发下一角色前，须满足下列前置成果物（`full` 模式首次开发路径）。**R13**：本表中客观可判定的前置条件（成果物文件是否存在、设计问题清单/质量报告表格是否有未解决项）已由 `gate-role-sequence.mjs` 在 Task 发起前机械校验（见 §8.1）；下表文字描述仅为可读性摘要，实际判定以 Hook 为准。调用者身份判定（是否为顶层代理越权）不可机械化，继续由 R8 文字约束承担。

| 下一角色 | 必须已存在且有效的成果物 | 流程状态要求 |
| -------- | ------------------------ | ------------ |
| 需求分析师 | 项目经理已记录用户目标于 `process.md` | 无阻塞 |
| 系统架构师 | `requirement-spec.md`、`requirement-list.md`；用户已确认需求摘要 | 无阻塞 |
| 产品经理 | `detail-design-spec.md`、`develop-task-list.md`；用户已确认技术选型 | 无阻塞 |
| 开发工程师 | 同上 + `design-problem-list.md` 设计审核通过；项目经理已完成分派 | 无阻塞 |
| 质量保障工程师 | 开发任务对应的功能代码与单元测试；对应开发线状态为执行完成 | 无阻塞 |
| 测试工程师（批次集成测试） | 本批次开发线对应的质量审核全部通过；**本批次 E2E `gatePassed=true`**（Chromium headless 覆盖本批次 P0 子集，机读产物 `test-results/e2e/.e2e-batch-result.json`）；**本批次须做接口测试且测试报告含非空「## 接口测试报告」章节（R14）** | 无阻塞 |
| 测试工程师（最终整体集成测试） | 全部任务包的开发、QA 与**各批次集成测试**（含各批次 E2E）均已执行完成；**全量 E2E `gatePassed=true`**（Chromium headless 覆盖 `requirement-list.md` 全部 P0，机读产物 `test-results/e2e/.e2e-final-result.json`） | 无阻塞 |

> **两级集成测试 + E2E 机械门禁**：测试工程师执行两类集成测试——①**批次集成测试**：每批次 QA 通过后对本批次新交付任务包做集成测试，`gatePassed≠true` 时视为本批次集成测试未完成，**不得推进下一批次**；②**最终整体集成测试**：全部任务包与各批次 E2E 闭环后对整个产品做端到端集成测试，`gatePassed≠true` 时**不得宣告项目完成**。`测试判定`（最终交付依据）以**最终整体集成测试**（含最终 E2E）结论为准。执行命令、产物路径、浏览器范围与 `gatePassed` 公式的唯一权威定义见 §8.3。

**`hotfix` 模式门禁链**：项目经理记录目标 →（**R9 设计前置校验**）→ 开发工程师 → QA → 测试；跳过需求分析师与系统架构师，但**不跳过** PM 分派与 QA/测试。

> **R9（hotfix 设计/E2E 前置校验）**：hotfix 虽豁免 R3 四件成果物，但进入开发前 PM 须校验两项前置，任一不满足**不得**分派开发工程师，须标记 `blocking` 并 `AskQuestion` 请用户决策：
> 1. **设计存在性**（机械门禁，`checkHotfixDesign`）：当前活跃 `process.md` 基目录下须存在 `detail-design-spec.md`。缺失时，PM 可分派 **system-architect** 执行「最小热修设计微任务」（仅补 bug 影响面涉及的设计章节，见 `system-architect.md`），或由用户指认既有设计路径——**禁止**项目经理或顶层代理代写设计（R5）。
> 2. **E2E 适用性可解析**（文字约束，无机械兜底）：项目有 UI 且 `e2e/specs/**` 已有对应 P0 用例，**或** `gated-artifacts.json` 已声明 `e2eApplicability:"n/a"` 且 `## 用户确认记录` 含 E2E 豁免（§8.3）。两者皆无时，PM 请用户确认豁免后由 **system-architect** 在同一微任务内补写 `gated-artifacts.json`。
>
> hotfix 只在前端省去 RA/SA，**后端 QA + 集成测试 + E2E 一律不省**（§8.3 适用范围含 hotfix）；但测试环节按 **R11** 折叠为单次通道（不再区分批次集成测试与最终整体集成测试，见 §8.2/§8.3），消除"一次性小改动被迫走两轮测试工程师"的流程冗余，严格程度不降低。

**`docs-only` 模式门禁链**：项目经理记录目标 → 需求/设计文档角色（按需）→ 无开发/QA/测试。

**无效成果物**（视为未产出，不得用于推进流程）：

- 未经用户确认的需求文档
- 仅有 `tech-stack-options.md` 而无 `detail-design-spec.md`
- 设计文档技术栈未经用户明确确认
- `process.md` 处于阻塞状态
- 开发任务未经项目经理分派即已有业务代码
- `process.md` 缺少 `## 当前分派计划`、表中仅有空白占位行（无真实分派数据行），或任务包编号无法对应 `develop-task-list.md`
- 开发尚未开始时，`process.md` 缺少有效 `## 待派发角色列表`；开发工程师已处于「正在执行」后，可视为待派发列表已被消费，但 `## 当前分派计划` 仍须保留有效数据行
- `develop-task-list.md` 缺少 §3 分派方式分析或「整体分派模式」
- 通过 Shell 重定向、`tee`、脚本批量写入等方式绕过 Hook
- 在 `docs/` 下写入非文档扩展名文件（`.md/.mdx/.txt` 之外，`docs/**/design/gated-artifacts.json` 例外）——**按受门禁源码路径处理**：无有效分派计划或流程阻塞/取消时 `gate-dev-workflow` 拒绝；开发阶段存在有效分派计划时，与其它受门禁源码同等放行（非无条件拦截）
- 一个 QA Task 覆盖多条开发线，但 `## 当前分派计划` 未显式标注为「批量/全量审查」并列明全部任务包编号，或未对每个任务包分别给出结论与对应 `quality-report` 章节
- 质量审核以**抽样**方式核查单元测试（未对任务包功能单元逐一核查、未运行该任务包**全量**单元测试套件）
- 仅完成各批次集成测试、未执行**最终整体集成测试**即据以宣告项目完成
- 批次/最终 E2E 缺结果产物（`.e2e-batch-result.json` / `.e2e-final-result.json`）、`gatePassed≠true`、或任一浏览器 `missingIds` 非空 / 存在未解释 skip
- 非 `hotfix`/`docs-only` 迭代缺任一四件成果物（`requirement-spec.md`、`requirement-list.md`、`detail-design-spec.md`、`develop-task-list.md`）或未被 `process.md` 引用时，`gate-dev-workflow` / `gate-dev-shell` 机制拒绝（R3）
- 试图在 `cancelled: true` 的 `process.md` 上继续推进流程或将其作为分派依据（R10，机制拒绝：`isCancelledProcessFile`）

**用户确认留痕**：凡须用户确认的事项（需求摘要、技术选型等），项目经理须在 `process.md` 的 `## 用户确认记录` 表中追加一行，含确认项、时间、用户原话摘要。

## 6. 开发阶段编排要点（角色级）

| 阶段节点 | 必经角色 | 顶层代理动作 |
| -------- | -------- | ------------ |
| 用户提出目标 | 项目经理 | 单独派发项目经理 |
| 需求产出后 | 项目经理 → 系统架构师 | 先项目经理更新进度，再派发系统架构师 |
| 设计产出后 | 项目经理 → 产品经理 | 先项目经理更新进度，再派发产品经理 |
| 设计审核通过后 | 项目经理（开发任务分派）→ 开发工程师 | **禁止**跳过项目经理直接开发 |
| 各开发线完成后 | 质量保障工程师（每条开发线/批次独立审核） | 本批次全部 QA 通过后，再调用项目经理 |
| 每批次 QA 通过后 | 项目经理 → 测试工程师（**批次集成测试**） | 先项目经理判定，再派发 test-engineer 对本批次做集成测试 + 批次 E2E（`--scope=batch`）+ **接口测试（R14，测试报告须含非空「## 接口测试报告」章节）**；判据见 §8.3（`hotfix` 模式跳过本行，见 R11） |
| 全部任务包开发+QA+各批次集成测试（含各批次 E2E）完成后 | 项目经理 → 测试工程师（**最终整体集成测试**） | 先项目经理判定，再派发 test-engineer 对**整个产品**做最终集成测试 + 全量 E2E（`--scope=final`）；判据见 §8.3（`hotfix` 模式为唯一一次测试通道，见 R11） |
| 最终整体集成测试判定通过（含最终 E2E `gatePassed`） | — | 方可向用户输出最终交付总结 |

## 7. 文档目录定义

| 目录名称 | 目录描述 |
| -------- | -------- |
| docs/requirement | 项目需求相关文档 |
| docs/design | 系统设计相关文档（含可选 `gated-artifacts.json`） |
| docs/quality | 代码质量相关文档 |
| docs/test | 测试相关文档 |
| docs/process | 任务进度相关文档 |

成果物模板见 `.cursor/templates/`。**用户无需手动初始化**；项目经理在首次接收目标时须自动执行 `node .cursor/scripts/bootstrap-docs.mjs`（或等价创建 `docs/` 结构与 `process.md`）。

**harness 与工程化基建归属**：`.cursor/scripts/**`、`.cursor/agents/**`、`.cursor/hooks/**`、`.cursor/hooks.json`、`.cursor/harness.config.json`、构建/测试脚本、`package.json` scripts 等文件的创建与修改，须由项目经理分派 **development-engineer**（或后续平台/工具工程角色）在其子 agent 上下文内执行；顶层代理不得直接编写（见 §4.1）。

## 8. 流程门禁 Hook（机械约束）

本项目通过 Cursor Hook 对高风险操作做**确定性拦截**，与 §4 文字规则互补。门禁路径与 Shell 模式以 `harness.config.json` 为默认，并与当前活跃 `docs/**/design/gated-artifacts.json`（可选，架构师维护）合并。活跃路径由 `.cursor/harness-state.json` 或 `HARNESS_PROCESS_PATH` 决定。

### 8.1 Hook 一览

| Hook | 触发时机 | 拦截范围 | 放行条件 |
| ---- | -------- | -------- | -------- |
| `gate-dev-workflow` | `preToolUse`（Write / StrReplace / ApplyPatch / Delete / EditNotebook） | `harness.config.json` 中 `sourceDirs`、`buildManifests`、`testConfigs`、`rootPatterns` 及项目 `gated-artifacts.json` 额外路径；**`.cursor/scripts/**`、`.cursor/agents/**`、`.cursor/hooks/**` 三目录**（R6，白名单豁免见 `gatedPaths.dotCursorExemptPatterns`）；`docs/` 下非 `.md/.mdx/.txt` 文件（`docs/**/design/gated-artifacts.json` 例外，始终放行）——**作为受门禁源码路径纳入拦截范围，实际放行与否遵循右侧「放行条件」，并非无条件拦截**。**不纳入机制门禁**：`.cursor/hooks.json`、`.cursor/harness.config.json`、`.cursor/templates/**`、`.cursor/rules/**`、`.cursor/harness-state.json`、`.cursor/hooks/.toolchain-install-approved.json`（由 R5/R8 文字约束治理） | 判定顺序：**R10 目标文件本身 `cancelled: true` 拒绝**（不可逆，优先于一切）→ `docs-only` 拒绝 → 无有效分派计划拒绝 → **R3 迭代成果物**（非 `hotfix`/`docs-only` 且 `iterationType` 已设时，四件成果物须存在且被 `process.md` 引用）→ **R9 hotfix 设计前置**拒绝 → 阻塞拒绝 → 放行。开发尚未开始：须含有效 `## 当前分派计划` 与 `## 待派发角色列表`；开发已开始：`## 当前分派计划` 有效即可 |
| `gate-dev-shell` | `beforeShellExecution` | `harness.config.json` 中 `gatedShellPatterns` 及项目额外模式（项目初始化、依赖安装等）；`hooks.json` 使用宽 matcher，脚本内部判定 | 同 `gate-dev-workflow` 放行条件（含 R3/R9/R10 判定） |
| `gate-toolchain-install` | `beforeShellExecution` | `harness.config.json` 中 `toolchain.installPatterns`（winget、brew、apt、mise、asdf、nix、VS Build Tools 等） | 用户已确认且存在有效的 `.toolchain-install-approved.json` |
| `gate-role-sequence`（**R13**） | `preToolUse`（Task） | 发起角色 Task 前，按 §5 门禁链表格机械校验目标角色（`system-architect`/`product-manager`/`development-engineer`/`quality-assurance-engineer`/`test-engineer`）的前置成果物是否存在、设计问题清单/质量报告表格是否有未解决项、当前流程是否 `cancelled`/`blocking` | 前置条件满足；或目标角色不在门禁表中（`project-manager`/`requirements-analyst` 恒放行）；或解析不到目标角色名；`hooks.json` 中 `failClosed: false` 双重兜底 |
| `gate-stop-workflow` | `stop` | 代理拟结束回合时流程未完成 | 见下方 **stop 门禁判据**；`blocking: true` 或 **`cancelled: true`（R10）** 时放行 |

Hook 解析 `## 进度列表` 时同时识别中文角色名与 `.cursor/agents` 的 agent slug（如 `开发工程师` / `development-engineer`），项目经理可按 Task 实际发起名称留痕。

### 8.2 stop 门禁判据（gate-stop-workflow）

**`gate-stop-workflow` stop 门禁判据**（按优先级顺序，命中即注入 `followup_message`）：

| 判据 | 触发条件 | followup 要点 |
| ---- | -------- | ------------- |
| 放行（不可逆取消） | `cancelled`（R10） | 已取消的流程不再被催促推进，直接放行 |
| 放行（全流程测试闭环） | `finalTestRequired && finalTestComplete` | 全部开发+QA+批次测试（含批次 E2E）+**最终整体集成测试**（含最终 E2E）均完成；`hotfix` 模式下 batch 相关判据恒真（见下方 R11） |
| 开发进行中 | `devInProgress` | 分派 QA |
| 待分派 QA | `devComplete && !hasQaRecord` | 分派 quality-assurance-engineer |
| QA 未完成 | `devComplete && hasQaRecord && !qaComplete` | 继续 QA |
| **批次 E2E**（非 hotfix） | `qaComplete && batchTestRowComplete && !batchE2ePassed` 且处于开发阶段 | test-engineer 运行 `e2e-run.mjs --scope=batch --required-ids=<本批次P0>`；未通过前**不得推进下一批次** |
| **批次接口测试报告**（R14，非 hotfix） | `qaComplete && batchTestRowComplete && batchE2ePassed && !batchApiReportPresent` 且处于开发阶段 | test-engineer 补做接口测试并在测试报告补全非空「## 接口测试报告」章节（须含真实用例数据行）；未补全前**不得推进下一批次或最终整体集成测试** |
| **批次集成测试**（非 hotfix） | `qaComplete && !batchTestComplete` 且处于开发阶段 | 分派 test-engineer 做**批次集成测试**（含批次 E2E 与接口测试报告） |
| **最终 E2E** | `finalTestRequired && finalTestRowComplete && !finalE2ePassed` | test-engineer 运行 `e2e-run.mjs --scope=final --baseline=<requirement-list.md 或热修影响面>`；未通过前**禁止宣告完成** |
| **最终整体集成测试 / hotfix 唯一测试通道**（独立门禁） | `finalTestRequired && !finalTestComplete` | 非 hotfix：分派 test-engineer 做**最终整体集成测试**（含全量 E2E）；hotfix（R11）：分派 test-engineer 执行**唯一一次**集成测试+E2E（`--scope=final` 语义） |

> **R11（hotfix 批次/最终测试折叠，唯一权威定义）**：`workflow_mode=hotfix` 时不要求区分「批次集成测试」与「最终整体集成测试」两个独立环节，测试工程师**只需执行一次**集成测试+E2E（直接以 `--scope=final` 语义运行，产出即视为最终结果）。判据层面：`batchTestComplete` 恒为 `true`（跳过批次 E2E/批次接口测试报告/批次集成测试三条判据行，R14 接口测试报告章节判据仅约束开发窗口批次阶段，不并入 hotfix 折叠通道）；`finalTestRequired = devComplete && qaComplete`（不要求 `batchTestComplete` 参与判定）；`finalTestComplete` 计算方式不变（`finalTestRowComplete && finalE2ePassed`）。`gatePassed` 公式、Chromium headless 执行器、覆盖率判据**不因折叠而放松**，仅消除批次/最终两阶段的流程冗余，呼应需求 1「简化」精神且不违反 R12「只可加强」。
>
> **进度列表识别规则**：测试工程师行若含「最终整体集成测试」「最终集成测试」「TE-FINAL」「TE-最终」之一，计入最终测试；其余测试工程师行计入批次测试。`finalTestRequired` 的完整公式见 R11（hotfix）与上表（非 hotfix）。
>
> **B1 最新有效状态统计**：`gate-stop-workflow` 对 `## 进度列表` 按**任务包编号**取最新有效状态（后出现覆盖先出现）；`已作废` / `superseded` 行作为 tombstone 使该任务包退出统计。任务包编号须写在进度行「任务名称」列，使用**大写多段编号**（如 `A-DOC-1`、`B-LIB-1/2/3` 互不合并）；作废行亦须含被作废任务包编号以便精确 tombstone。`iterationType` 缺失时 R3 跳过（legacy 兼容）；`hotfix` / `docs-only` 豁免 R3。

### 8.3 两级集成测试与 E2E 判据（唯一权威定义，TG-D-4）

> 本节是「批次/最终 E2E」判据与命令的**唯一权威定义**；`README.md`、§3、§5、§6、`project-manager.md`、`test-engineer.md` 中出现的相关表述均须与本节保持一致，若只需引用判据请指回本节，不再复述完整公式/命令。

- **两级范围**：①**批次集成测试**——每批次 QA 通过后，对本批次新交付任务包做集成测试；②**最终整体集成测试**——全部任务包与各批次 E2E 闭环后，对整个产品做端到端集成测试。`测试判定`（最终交付依据）以**最终整体集成测试**（含最终 E2E）结论为准。
- **执行命令与产物**：批次 `node .cursor/scripts/e2e-run.mjs --scope=batch --required-ids=<本批次P0>` → `test-results/e2e/.e2e-batch-result.json`；最终 `node .cursor/scripts/e2e-run.mjs --scope=final --baseline=<requirement-list.md>` → `test-results/e2e/.e2e-final-result.json`。
- **浏览器范围**：仅需支持 **Chrome 内核浏览器（Chromium，含 Chrome/Edge 等 Chromium-based 浏览器）**，不要求 Firefox / WebKit 覆盖；执行器 Playwright Chromium headless；用例标题含 `[R-xxx]` 追溯标签。**浏览器范围是本机械门禁唯一允许简化的维度**：`gatePassed`、覆盖率、追溯标签等判据不因浏览器范围收窄而放松（需求 1）。
- **`gatePassed` 公式**：`gatePassed = allPassed && coverageComplete`（Chromium 覆盖全部 required P0 且无未解释 skip 且均通过）。`batchTestRowComplete` / `finalTestRowComplete` 仅反映进度行完成；`batchE2ePassed` / `finalE2ePassed` 读取对应结果文件的 `gatePassed`。`batchTestComplete = batchTestRowComplete && batchE2ePassed && batchApiReportPresent`（含 R14 接口测试报告章节判据）；`finalTestComplete = finalTestRowComplete && finalE2ePassed`。**`hotfix` 模式下按 R11 折叠**（见 §8.2），`batchTestComplete` 恒真，`finalTestRequired` 不依赖 `batchTestComplete`。
- **接口测试（R14，开发窗口批次集成测试阶段必测，唯一权威定义）**：`full` 模式非 hotfix 迭代，**开发窗口的批次集成测试阶段**（每批次 QA 通过后对本批次做的集成测试，**非**最终整体集成测试阶段）**必须做接口测试**，且测试报告须含**非空**的「## 接口测试报告」章节（至少一条真实表格数据行）。机读判据 `batchApiReportPresent` 由 `workflow-gate-lib.mjs` 的 `checkBatchApiTestReport()` 扫描当前活跃 docs 子树 `test/` 目录下 `*.md` 计算；缺失或为空时 `batchTestComplete=false`，`gate-stop-workflow` 注入 R14 followup，**不得推进下一批次或最终整体集成测试**。R14 仅约束批次阶段，最终整体集成测试与 hotfix 折叠通道不并入此判据。
- **接口测试适用性豁免（无对外接口项目）**：纯算法库、纯静态前端、无 HTTP/RPC/CLI 契约的组件等**无对外接口**项目，可豁免 R14 接口测试判据，判定与 E2E 适用性豁免同构，须**同时**满足：①架构师在活跃 `gated-artifacts.json` 声明 `apiTestApplicability: "n/a"`（+`apiTestApplicabilityReason`）；②`process.md`「## 用户确认记录」含一行接口测试豁免确认（行内含「接口测试」与「豁免/不适用/无接口」等词）。两项皆满足时 `isApiTestExempt()` 使 `batchApiReportPresent` 视为满足；**仅声明一项不生效**（防单方面弱化，R12）。详见 `test-engineer.md`「接口测试适用性豁免」。
- **约束后果**：批次 `gatePassed≠true` 时视为本批次集成测试未完成，**不得推进下一批次**；最终 `gatePassed≠true` 时**不得宣告项目完成**。
- **适用范围**：适用于 `full` 模式下的 `greenfield` / `feature` / `governance-overhaul` 及 `hotfix` 迭代（`hotfix` 按 R11 折叠为单次通道，测试严格程度不降低）；`docs-only` 豁免；无 UI 项目经 `gated-artifacts.json` 声明 `e2eApplicability: "n/a"` 且 `process.md`「用户确认记录」含 E2E 豁免确认后豁免（详见 `test-engineer.md`「E2E 适用性豁免」）。
- **未解释 skip / `coverage-waivers.json`**：见 `test-engineer.md`「`coverage-waivers.json`」一节。

Hook 脚本路径：`.cursor/hooks/`。修改 Hook 行为时须同步更新本节与 `README.md`。

### 8.4 自锁防护与门禁能力边界

**自锁防护（fail-open）**：全部**五个** hook 入口脚本（`gate-dev-workflow`、`gate-dev-shell`、`gate-toolchain-install`、`gate-stop-workflow`、`gate-role-sequence`）对 `workflow-gate-lib.mjs` 使用动态 `import` + `try/catch`，且执行期逻辑同样包裹在 `try/catch` 中；lib 不可加载或运行期出现未预期异常时 **fail-open 放行**（`gate-stop-workflow` 语义为不注入 followup）并打印 stderr 告警，避免门禁自身损坏导致全流程硬死锁。策略性 `deny` 不受影响。`gate-role-sequence` 额外在 `hooks.json` 中配置 `failClosed: false` 作为第二层兜底。

**门禁能力边界（须知）**：

- Hook 对**源码 / 构建产物 / 根目录敏感产物 / `.cursor/scripts|agents|hooks/**` 三目录 / 受门禁 Shell 命令 / Task 发起前的角色前置成果物（R13）**做确定性拦截。`.cursor/hooks.json`、`.cursor/harness.config.json` **不纳入机制门禁**，其变更治理由 §4.1 R5/R8 **文字约束**覆盖。`docs/**/*.md`（需求、设计等文档类成果物）**不受写入期机制门禁约束**——§4 中「禁止顶层代理代写需求/设计文档」「禁止后台静默产出」属**文字约束**，由各子 agent 自我执行；但其中客观可判定的**存在性/表格完备性**已被 `gate-role-sequence`（R13）在 Task 发起前机械校验。Hook **无法识别调用者身份**（顶层代理 vs 子 agent 共用工具通道），故 actor identity 判定（谁在越权）属文字 + §4.15 自检约束，无 Hook 兜底——这是 R13 明确排除、无法机械化的部分（见 §5 脚注）。
- **批次 + 最终 E2E 均有机读判据**（`batchE2ePassed` / `finalE2ePassed`）；**批次接口测试报告章节存在性**亦有机读判据（`batchApiReportPresent`，R14，检查「## 接口测试报告」章节非空）；**交互断言与接口用例语义正确性**因不可机械判定而由 QA/PM 文字审查兜底。
- **`test-results/` 受控运行产物例外**：E2E 机读结果（`test-results/e2e/.e2e-batch-result.json`、`.e2e-final-result.json`）及 Playwright trace/截图/video 由 `e2e-run.mjs` / Playwright **进程内 `writeFileSync` 写盘**，不在 `sourceDirs` / `buildManifests` / `testConfigs` / `rootPatterns` 内，**不触发** `gate-dev-workflow`；`.gitignore` 已忽略 `test-results/`。此为**受控运行产物**，非绕过门禁；QA/测试阶段不得据此判定「脚本绕过 Hook」。
- Shell 门禁为正则匹配，属「尽力而为」：可绕过手段（如管道安装 `curl ... | sh`、`iwr ... | iex`、先写脚本再执行、未列出的包管理器别名）无法穷尽拦截。子 agent 不得主动利用这些手段绕过门禁（§4.16）。

## 9. 回退与循环终止

- **开发回退定义**：同一任务包因 QA 或测试不通过而重新分派给开发工程师，计 1 次回退。
- **设计回退定义**：设计审核不通过而重新分派给系统架构师（`设计审核 → 不通过 → SA`），计 1 次回退。
- **需求循环**：需求摘要被用户反复打回重写，计 1 次回退。
- **记录位置**：`process.md` → `## 回退计数`（角色/任务包分行，含开发、设计审核、需求确认）。
- **终止条件**：同一对象（任务包 / 设计审核 / 需求确认）累计回退超过 3 次，项目经理须停止推进、标记阻塞并请求用户决策（调整需求、设计或人工介入）。
- **stop Hook `loop_limit`**：与回退终止配合，防止无限 followup 循环（默认 3）。

> 注：开发回退由 stop Hook 与 `## 回退计数` 双重约束；设计审核与需求确认的回退**仅由项目经理依本节文字约束执行**（无对应 Hook），项目经理须主动计数并在超限时阻塞。

## 10. 规则编号索引（导航用，不新增约束）

正文中部分强制规则以编号形式被跨章节引用（如「见 R5」）。本表仅索引这些编号在当前文件中的定义位置，便于跳转与核对，不改变任何判定逻辑：

| 编号 | 主题 | 定义位置 |
| ---- | ---- | -------- |
| R2 | `single-task` 模式收紧定义：分派节奏可压缩，但角色职责不可省略 | §3「`single-task` 收紧定义」 |
| R3 | 非 `hotfix`/`docs-only` 迭代进入开发前须校验四件成果物（需求说明书、需求清单、详细设计、开发任务清单）存在且被 `process.md` 引用 | §5 门禁链脚注；`workflow-gate-lib.mjs` 的 `checkIterationArtifacts` |
| R5 | 顶层代理不得代行子角色职责，含不得代写受门禁保护路径 | §4.1 |
| R6 | `.cursor/scripts\|agents\|hooks/**` 三目录纳入机制门禁；白名单豁免见 `gatedPaths.dotCursorExemptPatterns` | §8.1 Hook 一览表 |
| R8 | 禁止越级发起 Task（不得跳过前一角色或在门禁链未满足时发起后一角色 Task） | §4.8 |
| R9 | hotfix 进入开发前须校验设计存在性（机械门禁）与 E2E 适用性（文字约束）；缺失须经 SA 最小热修设计微任务补齐，禁止 PM/顶层代理代写 | §5 `hotfix` 门禁链脚注；`workflow-gate-lib.mjs` 的 `checkHotfixDesign` |
| B1 | `## 进度列表` 按任务包编号取最新有效状态，`已作废`/`superseded` 行为 tombstone | §8.2 stop 门禁判据脚注 |
| R10 | 流程终止不可逆：用户确认取消后 `process.md` 写入 `cancelled: true` 即被 Hook 永久冻结，任何角色不得再修改/推进 | §3「流程终止（不可逆，R10）」；§4.19；`workflow-gate-lib.mjs` 的 `isCancelledProcessFile`/`isProcessFilePath` |
| R11 | `hotfix` 模式下批次/最终测试折叠为单次通道（不区分批次集成测试与最终整体集成测试），`gatePassed` 判据与执行器不降低 | §8.2 stop 门禁判据（唯一权威定义）；§5 `hotfix` 门禁链脚注；§8.3 适用范围 |
| R12 | 元规则：本框架后续修改只可新增/加强门禁约束，不可放松；变更判据须同步升级机械门禁代码 | §2 强制规则第 5 条 |
| R13 | 成果物门禁链机械化：§5 表格中客观可判定的前置条件由 `gate-role-sequence.mjs` 在 Task 发起前机械拦截，是 R8（禁止越级发起）/R9（hotfix 设计前置）在"文件状态可判定"维度的机械化层，不新增独立约束对象 | §5 表格脚注；§8.1 Hook 一览；`workflow-gate-lib.mjs` 的 `checkRoleDispatchGate` |
| R14 | 开发窗口批次集成测试阶段（非最终整体集成测试阶段）必须做接口测试，测试报告须含非空「## 接口测试报告」章节；机读判据 `batchApiReportPresent` 并入 `batchTestComplete`，缺失时 stop 门禁拒绝推进；无对外接口项目经「架构师声明 `apiTestApplicability:"n/a"` + 用户确认」双要素豁免 | §8.2 stop 门禁判据表；§8.3 接口测试判据与适用性豁免（唯一权威定义）；`workflow-gate-lib.mjs` 的 `checkBatchApiTestReport` / `isApiTestExempt` |
| TG-D-4 | 批次/最终 E2E 判据与 `workflow-gate-lib` 字段（`gatePassed`、`batchTestComplete` 等）严格对齐 | §8.3 两级集成测试与 E2E 判据 |

> 编号不连续（如无 R1/R4/R7）属正常：这些编号源自本框架自举开发（governance-overhaul）迭代中的需求/任务追溯标识，对应的 `requirement-list.md`/`develop-task-list.md` 是运行时产物，不随框架模板分发；本表只收录当前仍在 `AGENTS.md`/Hook 正文中被引用、因而需要跨章节定位的编号。
