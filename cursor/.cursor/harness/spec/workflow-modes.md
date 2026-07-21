# 工作流模式细则（说明权威）

> **执行权威**：Hook / `workflow-gate-lib.mjs`。  
> **编排执行面**：`.cursor/agents/project-manager.md`。  
> **常驻摘要**：根目录 `AGENTS.md` §4。  
> 本节承接原 `AGENTS.md` 工作流模式展开；修改须满足 R12，并与 Hook、PM agent 同步。

## 3. 工作流模式

| 模式 | 触发条件 | 简化说明 |
| ---- | -------- | -------- |
| `full` | 默认 | 需求 → 架构 → 设计审核 → 开发 → QE → 测试 |
| `hotfix` | 用户显式声明「热修复」「修 bug」 | 跳过需求分析师与系统架构师（**须已有 `detail-design-spec.md`**；无则按 R9 前置校验先补最小热修设计，见 `gate-chain.md`）；项目经理直接分派开发；测试环节按 **R11** 折叠为单次集成测试+E2E（不区分批次/最终，见 `mechanical-gates.md` §8.2/§8.3） |
| `docs-only` | 用户显式声明「只改文档」 | 仅允许修改 `docs/**/*.md`；Hook 拒绝一切源码写入 |
| `single-task` | 用户显式声明「单任务」「小改动」 | 仅适用于**单文件级、不改 schema、不加新交互面**的小改动；允许项目经理在一次分派中连续编排 DE → QE → 测试，但仍须逐角色执行、不得代做（见下方 R2 收紧定义） |

> **真实浏览器 E2E 门禁**：批次 + 最终 E2E 为机械门禁（`e2e-run.mjs` 双模式判据），适用范围、`gatePassed` 公式与命令的唯一权威定义见 `mechanical-gates.md` §8.3。

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
> 3. `single-task` 只压缩**分派节奏**（PM 可一次预写 DE→QE→测试列表），**不跳过任何角色职责**。

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
3. 写入后，该 `process.md` 即被 Hook **永久冻结**（机械门禁，见 `mechanical-gates.md` §8.1）：任何角色（含项目经理本人）均不得再修改/删除该文件；针对该流程的任何开发/初始化操作一律被拒绝；`gate-stop-workflow` 检测到 `cancelled: true` 时直接放行、不再催促推进。
4. 项目经理与顶层代理**不得**、也**无法**（有 Hook 兜底）恢复已取消的流程；用户若要求恢复，须引导其发起新的 feature/迭代，不得声称「已恢复」。
5. 顶层代理对应义务（禁止对已 `cancelled` 流程发起任何角色 Task）见 `AGENTS.md` §5.19。

`cancelled` 语义强于 `blocking`：`blocking` 可由用户确认后解除并继续推进；`cancelled` 不可逆。
