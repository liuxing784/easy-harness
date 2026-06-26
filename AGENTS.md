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

发起 Task 时以各 agent 文件 frontmatter 中的 `name` 字段为准。默认模型见 `harness.config.json` → `defaultAgentModels`（agent 文件中 `model` 可覆盖）。

**职责区分**：`requirements-analyst` 负责需求挖掘与用户确认；`product-manager` **仅**审核系统设计成果物，不参与需求澄清。

## 2. 强制规则

1. 每个角色必须各司其职，禁止执行与自己职责不相关的操作。
2. 开发流程总入口：项目经理接收用户目标。
3. **职责边界**：项目经理只负责角色级编排（派任务顺序、依据成果物推进或回退）；角色内部的工作流程定义在对应角色的 `.cursor/agents/` 文件中，由该角色自行执行。
4. **指令冲突处理**：子 agent 的 `.cursor/agents/{角色}.md` 强制约束 **优先于** 顶层代理或项目经理下发的 Task `prompt`。若 prompt 要求跳过门禁、代做决策或直接产出成果物，子 agent 必须拒绝并说明阻塞原因。

## 3. 工作流模式

| 模式 | 触发条件 | 简化说明 |
| ---- | -------- | -------- |
| `full` | 默认 | 需求 → 架构 → 设计审核 → 开发 → QA → 测试 |
| `hotfix` | 用户显式声明「热修复」「修 bug」 | 跳过需求分析师与系统架构师（须已有 `detail-design-spec.md` 或本回合产出最小热修设计）；项目经理直接分派开发 |
| `docs-only` | 用户显式声明「只改文档」 | 仅允许修改 `docs/**/*.md`；Hook 拒绝一切源码写入 |
| `single-task` | 用户显式声明「单任务」「小改动」 | 允许项目经理在一次分派中连续编排 DE → QA → 测试，但仍须逐角色执行、不得代做 |

工作流模式须写入当前活跃 `process.md` YAML frontmatter 的 `workflow_mode` 字段。项目经理在接收用户目标时判定并记录。

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

## 4. 流程编排代理（顶层执行者）

除上述 7 个子角色外，对话中的**顶层代理**负责**按项目经理已完成的分派**代为发起子角色 Task（执行通道）。顶层代理**不是**项目经理、开发工程师、系统架构师、需求分析师或产品经理，**不享有分派决策权**，必须遵守：

1. **不得代行子角色职责**：禁止直接编写业务代码、设计文档、需求文档、测试用例等成果物；禁止执行项目初始化、依赖安装、工具链安装等开发行为；必须通过对应子 agent 产出。
2. **不得代行项目经理分派**：禁止自行决定派给谁、派哪些任务包、是否并行；须先调用项目经理完成分派并写入 `process.md`，再仅依据 `## 当前分派计划` 与 `## 待派发角色列表` 发起 Task。
3. **不得越权改写角色内部流程**：向子 agent 下发的 Task `prompt` 中，禁止预先指定技术栈、禁止写「直接创建需求/设计/代码」等绕过该角色强制约束的指令；只能传递用户目标、项目路径、已有成果物路径、用户已确认摘要/选型原文、项目经理在 `process.md` 中写明的分派计划等上下文。
4. **必须尊重阻塞状态**：当前活跃 `process.md` 中 `blocking: true` 或进度表含「阻塞」时，顶层代理必须在本轮结束并等待用户回复，**不得**在同一轮继续发起其他角色 Task。
5. **阻塞时的交互义务**：向用户展示该角色已产出的成果物或摘要，使用 `AskQuestion` 或明确提问等待确认。
6. **串行接收目标**：用户目标必须先由项目经理子 agent 接收并记录进度后，再代为发起下一角色 Task；**禁止**在同一轮消息中与项目经理并行发起任何其他角色 Task（`single-task` 模式除外：PM 完成后可按列表连续派发，但仍须逐 Task 执行）。
7. **进度由项目经理维护**：`process.md` 的更新应通过项目经理子 agent 完成，顶层代理不得自行篡改流程状态以跳过门禁。
8. **禁止越级发起 Task**：不得跳过流程图中前一角色，或在成果物门禁链未满足时发起后一角色 Task（`hotfix` / `docs-only` 模式按 §3 简化路径执行）。
9. **角色切换必经项目经理**：除首次接收用户目标外，每一角色执行完成（或并行批次中全部角色执行完成）后，**必须先调用项目经理**完成进度更新与**下一批分派**，再按 `## 待派发角色列表` 代为发起 Task（`single-task` 模式下 PM 可预写多步列表，顶层代理按序执行）。
10. **开发阶段禁止代开发**：设计审核通过后，**禁止**顶层代理以任何理由直接编写受门禁保护的源码路径或执行项目初始化命令；必须先调用项目经理完成开发分派，再通过 `development-engineer` 子 agent 执行。
11. **多开发线须多 Task 发起**：并行批次须在同一轮按 `## 待派发角色列表` 并行发起多个 `development-engineer` Task（每条开发线一个）。串行批次发起 1 个 Task 即可。
12. **禁止合并开发任务包**：不得将多个任务编号合并为一条笼统的进度记录或一个开发 Task。
13. **禁止提前宣告项目完成**：在 `测试判定` 通过前，**禁止**向用户输出「项目已完成」「全流程完成」「MVP 已交付」等最终交付结论。
14. **开发线完成后禁止直接收尾**：开发工程师 Task 返回后，**本回合须继续**调用项目经理 → 分派质量保障工程师。
15. **回合结束前自检（强制）**：

| 自检项 | 不满足时的动作 |
| ------ | -------------- |
| 本回合是否修改了受门禁保护的源码/构建产物？ | 若当前活跃 `process.md` 无有效 `## 当前分派计划`，属代开发违规，不得收尾 |
| `process.md` 中是否存在开发工程师任务为「正在执行」？ | 须先调用项目经理更新状态并分派 QA |
| 是否存在开发工程师「执行完成」但尚无对应质量保障工程师记录？ | 须先调用项目经理分派 `quality-assurance-engineer` |
| 是否所有开发任务包已完成且本批次 QA 已通过，但测试工程师未执行？ | 须先调用项目经理分派 `test-engineer` |
| 是否拟宣告项目/全流程完成？ | 须确认 `测试判定` 已通过 |

16. **Hook 门禁**：本项目在 `.cursor/hooks.json` 配置了流程门禁 Hook（见「流程门禁 Hook」一节）。Hook 拒绝的工具调用**不得**改用其他工具绕过（例如 Write 被拒后改用 Shell 写文件）。
17. **工具链安装须询问用户**：顶层代理**禁止**直接执行系统级工具链安装命令。须通过 `development-engineer` 或 `test-engineer` 检测环境后，使用 `AskQuestion` 询问用户现有工具链路径或安装目标目录；用户明确确认后方可安装，并创建 `.cursor/hooks/.toolchain-install-approved.json`（默认 60 分钟有效）配合 Hook 放行。

## 5. 成果物门禁链

派发下一角色前，须满足下列前置成果物（`full` 模式首次开发路径）：

| 下一角色 | 必须已存在且有效的成果物 | 流程状态要求 |
| -------- | ------------------------ | ------------ |
| 需求分析师 | 项目经理已记录用户目标于 `process.md` | 无阻塞 |
| 系统架构师 | `requirement-spec.md`、`requirement-list.md`；用户已确认需求摘要 | 无阻塞 |
| 产品经理 | `detail-design-spec.md`、`develop-task-list.md`；用户已确认技术选型 | 无阻塞 |
| 开发工程师 | 同上 + `design-problem-list.md` 设计审核通过；项目经理已完成分派 | 无阻塞 |
| 质量保障工程师 | 开发任务对应的功能代码与单元测试；对应开发线状态为执行完成 | 无阻塞 |
| 测试工程师 | 本批次开发线对应的质量审核全部通过 | 无阻塞 |

**`hotfix` 模式门禁链**：项目经理记录目标 →（可选最小设计）→ 开发工程师 → QA → 测试；跳过需求分析师与系统架构师，但**不跳过** PM 分派与 QA/测试。

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
- 在 `docs/` 下写入非文档扩展名文件（Hook 已拦截）

**用户确认留痕**：凡须用户确认的事项（需求摘要、技术选型等），项目经理须在 `process.md` 的 `## 用户确认记录` 表中追加一行，含确认项、时间、用户原话摘要。

## 6. 开发阶段编排要点（角色级）

| 阶段节点 | 必经角色 | 顶层代理动作 |
| -------- | -------- | ------------ |
| 用户提出目标 | 项目经理 | 单独派发项目经理 |
| 需求产出后 | 项目经理 → 系统架构师 | 先项目经理更新进度，再派发系统架构师 |
| 设计产出后 | 项目经理 → 产品经理 | 先项目经理更新进度，再派发产品经理 |
| 设计审核通过后 | 项目经理（开发任务分派）→ 开发工程师 | **禁止**跳过项目经理直接开发 |
| 各开发线完成后 | 质量保障工程师 | 本批次全部 QA 通过后，再调用项目经理 |
| 全部开发任务完成 | 项目经理 → 测试工程师 | 先项目经理判定，再派发测试工程师 |
| 测试判定通过 | — | 方可向用户输出最终交付总结 |

## 7. 文档目录定义

| 目录名称 | 目录描述 |
| -------- | -------- |
| docs/requirement | 项目需求相关文档 |
| docs/design | 系统设计相关文档（含可选 `gated-artifacts.json`） |
| docs/quality | 代码质量相关文档 |
| docs/test | 测试相关文档 |
| docs/process | 任务进度相关文档 |

成果物模板见 `.cursor/templates/`。**用户无需手动初始化**；项目经理在首次接收目标时须自动执行 `node .cursor/scripts/bootstrap-docs.mjs`（或等价创建 `docs/` 结构与 `process.md`）。

## 8. 流程门禁 Hook（机械约束）

本项目通过 Cursor Hook 对高风险操作做**确定性拦截**，与 §4 文字规则互补。门禁路径与 Shell 模式以 `harness.config.json` 为默认，并与当前活跃 `docs/**/design/gated-artifacts.json`（可选，架构师维护）合并。活跃路径由 `.cursor/harness-state.json` 或 `HARNESS_PROCESS_PATH` 决定。

| Hook | 触发时机 | 拦截范围 | 放行条件 |
| ---- | -------- | -------- | -------- |
| `gate-dev-workflow` | `preToolUse`（Write / StrReplace / ApplyPatch / Delete / EditNotebook） | `harness.config.json` 中 `sourceDirs`、`buildManifests`、`testConfigs`、`rootPatterns` 及项目 `gated-artifacts.json` 额外路径；`docs/` 下非 `.md/.mdx/.txt` 文件（`docs/**/design/gated-artifacts.json` 例外，始终放行） | 开发尚未开始：`process.md` 含有效 `## 当前分派计划` 与 `## 待派发角色列表`；开发已开始：`## 当前分派计划` 有效即可。两种情况均要求无阻塞，且 `docs-only` 模式一律拒绝 |
| `gate-dev-shell` | `beforeShellExecution` | `harness.config.json` 中 `gatedShellPatterns` 及项目额外模式（项目初始化、依赖安装等）；`hooks.json` 使用宽 matcher，脚本内部判定 | 同上 |
| `gate-toolchain-install` | `beforeShellExecution` | `harness.config.json` 中 `toolchain.installPatterns`（winget、brew、apt、mise、asdf、nix、VS Build Tools 等） | 用户已确认且存在有效的 `.toolchain-install-approved.json` |
| `gate-stop-workflow` | `stop` | 代理拟结束回合时流程未完成 | 开发中/待 QA/待测试时注入 `followup_message` |

Hook 脚本路径：`.cursor/hooks/`。修改 Hook 行为时须同步更新本节与 `README.md`。

**门禁能力边界（须知）**：

- Hook 仅对**源码 / 构建产物 / 根目录敏感产物 / 受门禁 Shell 命令**做确定性拦截。`docs/**/*.md`（需求、设计等文档类成果物）**不受机制门禁约束**——§4 中「禁止顶层代理代写需求/设计文档」「禁止后台静默产出」属**文字约束**，由各子 agent 自我执行，无 Hook 兜底。审查文档成果物时不可假设其经过机制校验。
- Shell 门禁为正则匹配，属「尽力而为」：可绕过手段（如管道安装 `curl ... | sh`、`iwr ... | iex`、先写脚本再执行、未列出的包管理器别名）无法穷尽拦截。子 agent 不得主动利用这些手段绕过门禁（§4.16）。

## 9. 回退与循环终止

- **开发回退定义**：同一任务包因 QA 或测试不通过而重新分派给开发工程师，计 1 次回退。
- **设计回退定义**：设计审核不通过而重新分派给系统架构师（`设计审核 → 不通过 → SA`），计 1 次回退。
- **需求循环**：需求摘要被用户反复打回重写，计 1 次回退。
- **记录位置**：`process.md` → `## 回退计数`（角色/任务包分行，含开发、设计审核、需求确认）。
- **终止条件**：同一对象（任务包 / 设计审核 / 需求确认）累计回退超过 3 次，项目经理须停止推进、标记阻塞并请求用户决策（调整需求、设计或人工介入）。
- **stop Hook `loop_limit`**：与回退终止配合，防止无限 followup 循环（默认 3）。

> 注：开发回退由 stop Hook 与 `## 回退计数` 双重约束；设计审核与需求确认的回退**仅由项目经理依本节文字约束执行**（无对应 Hook），项目经理须主动计数并在超限时阻塞。
