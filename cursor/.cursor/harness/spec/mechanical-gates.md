# 流程门禁 Hook 与机械判据（说明权威）

> **执行权威**：`.cursor/hooks/**`、`.cursor/scripts/*-run.mjs`、`workflow-gate-lib.mjs`（客观判据以代码为准）。  
> **角色操作摘要**：QE → `quality-engineer.md`（R15/R16）；TE → `test-engineer.md`（R14/R17/E2E）；SA → `system-architect.md`（双要素豁免声明）。  
> **常驻摘要**：根目录 `AGENTS.md`（禁止绕过 Hook、门禁链表、顶层自检）。  
> 本节承接原 AGENTS.md §8；修改行为须同步升级 Hook/脚本（R12），不得仅改本文放宽判据。

## 8. 流程门禁 Hook（机械约束）

本项目通过 Cursor Hook 对高风险操作做**确定性拦截**，与 `AGENTS.md` §5 文字规则互补。门禁路径与 Shell 模式以 `harness.config.json` 为默认，并与当前活跃 `docs/**/design/gated-artifacts.json`（可选，架构师维护）合并。活跃路径由 `.cursor/harness-state.json` 或 `HARNESS_PROCESS_PATH` 决定。

### 8.1 Hook 一览

| Hook | 触发时机 | 拦截范围 | 放行条件 |
| ---- | -------- | -------- | -------- |
| `gate-dev-workflow` | `preToolUse`（Write / StrReplace / ApplyPatch / Delete / EditNotebook） | `harness.config.json` 中 `sourceDirs`、`buildManifests`、`testConfigs`、`rootPatterns` 及项目 `gated-artifacts.json` 额外路径；**`.cursor/scripts/**`、`.cursor/agents/**`、`.cursor/hooks/**` 三目录**（R6，白名单豁免见 `gatedPaths.dotCursorExemptPatterns`）；`docs/` 下非 `.md/.mdx/.txt` 文件（`docs/**/design/gated-artifacts.json` 例外，始终放行）——**作为受门禁源码路径纳入拦截范围，实际放行与否遵循右侧「放行条件」，并非无条件拦截**。**不纳入机制门禁**：`.cursor/hooks.json`、`.cursor/harness.config.json`、`.cursor/templates/**`、`.cursor/rules/**`、`.cursor/harness-state.json`、`.cursor/hooks/.toolchain-install-approved.json`（由 R5/R8 文字约束治理） | 判定顺序：**R10 目标文件本身 `cancelled: true` 拒绝**（不可逆，优先于一切）→ `docs-only` 拒绝 → 无有效分派计划拒绝 → **R3 迭代成果物**（非 `hotfix`/`docs-only` 且 `iterationType` 已设时，四件成果物须存在且被 `process.md` 引用）→ **R9 hotfix 设计前置**拒绝 → 阻塞拒绝 → 放行。开发尚未开始：须含有效 `## 当前分派计划` 与 `## 待派发角色列表`；开发已开始：`## 当前分派计划` 有效即可 |
| `gate-dev-shell` | `beforeShellExecution` | `harness.config.json` 中 `gatedShellPatterns` 及项目额外模式（项目初始化、依赖安装等）；`hooks.json` 使用宽 matcher，脚本内部判定 | 同 `gate-dev-workflow` 放行条件（含 R3/R9/R10 判定） |
| `gate-toolchain-install` | `beforeShellExecution` | `harness.config.json` 中 `toolchain.installPatterns`（winget、brew、apt、mise、asdf、nix、VS Build Tools 等） | 用户已确认且存在有效的 `.toolchain-install-approved.json` |
| `gate-role-sequence`（**R13**） | `preToolUse`（Task） | 发起角色 Task 前，按 `gate-chain.md` 门禁链表格机械校验目标角色（`system-architect`/`requirement-reviewer`/`development-engineer`/`quality-engineer`/`test-engineer`）的前置成果物是否存在、设计问题清单/质量报告表格是否有未解决项、**设计问题清单 R18 结构与 P0 需求覆盖矩阵**（发起 `development-engineer` 前）、**编程规范 lint 门禁是否通过（R15，发起 `test-engineer` 前）**、**静态代码质量门禁是否通过（R16，发起 `test-engineer` 前）**、当前流程是否 `cancelled`/`blocking` | 前置条件满足；或目标角色不在门禁表中（`project-manager`/`requirements-analyst` 恒放行）；或解析不到目标角色名；`hooks.json` 中 `failClosed: false` 双重兜底 |
| `gate-stop-workflow` | `stop` | 代理拟结束回合时流程未完成（含 **R15 编程规范 lint 门禁未通过**、**R16 静态代码质量门禁未通过**） | 见下方 **stop 门禁判据**；`blocking: true` 或 **`cancelled: true`（R10）** 时放行 |

Hook 解析 `## 进度列表` 时同时识别中文角色名与 `.cursor/agents` 的 agent slug（如 `开发工程师` / `development-engineer`），项目经理可按 Task 实际发起名称留痕。

### 8.2 stop 门禁判据（gate-stop-workflow）

**`gate-stop-workflow` stop 门禁判据**（按优先级顺序，命中即注入 `followup_message`）：

| 判据 | 触发条件 | followup 要点 |
| ---- | -------- | ------------- |
| 放行（不可逆取消） | `cancelled`（R10） | 已取消的流程不再被催促推进，直接放行 |
| 放行（全流程测试闭环） | `finalTestRequired && finalTestComplete && lintPassed && staticScanPassed`（R15/R16） | 全部开发+QE+批次测试（含批次 E2E）+**最终整体集成测试**（含最终 E2E）+**编程规范 lint 门禁**+**静态代码质量门禁**均通过；`hotfix` 模式下 batch 相关判据恒真（见下方 R11） |
| 开发进行中 | `devInProgress` | 分派 QE |
| 待分派 QE | `devComplete && !hasQeRecord` | 分派 quality-engineer |
| QE 未完成 | `devComplete && hasQeRecord && !qeComplete` | 继续 QE |
| **编程规范 lint 门禁**（R15，非 docs-only） | `qeComplete && !lintPassed` | quality-engineer 运行 `lint-run.mjs`，整改至 `gatePassed=true`（机读产物 `test-results/qe/.lint-result.json`）；未通过前**不得推进测试或宣告完成** |
| **静态代码质量门禁**（R16，非 docs-only） | `qeComplete && !staticScanPassed` | quality-engineer 运行 `static-scan-run.mjs`，整改重复代码/安全扫描至均 `gatePassed=true`（机读产物 `test-results/qe/.static-scan-result.json`）；未通过前**不得推进测试或宣告完成** |
| **批次 E2E**（非 hotfix） | `qeComplete && batchTestRowComplete && !batchE2ePassed` 且处于开发阶段 | test-engineer 运行 `e2e-run.mjs --scope=batch --required-ids=<本批次P0>`；未通过前**不得推进下一批次** |
| **批次接口测试报告**（R14，非 hotfix） | `qeComplete && batchTestRowComplete && batchE2ePassed && !batchApiReportPresent` 且处于开发阶段 | test-engineer 补做接口测试并在测试报告补全非空「## 接口测试报告」章节（须含真实用例数据行）；未补全前**不得推进下一批次或最终整体集成测试** |
| **批次存储对账记录**（R17，非 hotfix） | `qeComplete && batchTestRowComplete && batchE2ePassed && !batchStorageReconPresent` 且处于开发阶段 | test-engineer 按 R17 补全非空「## 存储对账记录」（适用分类型行 + 至少一条适用行 + 描述列完备 + 介质/其他/不适用备注 + 批次任务包覆盖）；未补全前**不得推进下一批次或最终整体集成测试** |
| **批次集成测试**（非 hotfix） | `qeComplete && !batchTestComplete` 且处于开发阶段 | 分派 test-engineer 做**批次集成测试**（含批次 E2E、接口测试报告与存储对账） |
| **最终 E2E** | `finalTestRequired && finalTestRowComplete && !finalE2ePassed` | test-engineer 运行 `e2e-run.mjs --scope=final --baseline=<requirement-list.md 或热修影响面>`；未通过前**禁止宣告完成** |
| **最终整体集成测试 / hotfix 唯一测试通道**（独立门禁） | `finalTestRequired && !finalTestComplete` | 非 hotfix：分派 test-engineer 做**最终整体集成测试**（含全量 E2E）；hotfix（R11）：分派 test-engineer 执行**唯一一次**集成测试+E2E（`--scope=final` 语义） |

> **R11（hotfix 批次/最终测试折叠，唯一权威定义）**：`workflow_mode=hotfix` 时不要求区分「批次集成测试」与「最终整体集成测试」两个独立环节，测试工程师**只需执行一次**集成测试+E2E（直接以 `--scope=final` 语义运行，产出即视为最终结果）。判据层面：`batchTestComplete` 恒为 `true`（跳过批次 E2E/批次接口测试报告/批次存储对账/批次集成测试判据行；R14/R17 机读判据仅约束开发窗口批次阶段，不并入 hotfix 折叠通道）；`finalTestRequired = devComplete && qeComplete`（不要求 `batchTestComplete` 参与判定）；`finalTestComplete` 计算方式不变（`finalTestRowComplete && finalE2ePassed`）。`gatePassed` 公式、Chromium headless 执行器、覆盖率判据**不因折叠而放松**，仅消除批次/最终两阶段的流程冗余，呼应需求 1「简化」精神且不违反 R12「只可加强」。
>
> **进度列表识别规则**：测试工程师行若含「最终整体集成测试」「最终集成测试」「TE-FINAL」「TE-最终」之一，计入最终测试；其余测试工程师行计入批次测试。`finalTestRequired` 的完整公式见 R11（hotfix）与上表（非 hotfix）。
>
> **B1 最新有效状态统计**：`gate-stop-workflow` 对 `## 进度列表` 按**任务包编号**取最新有效状态（后出现覆盖先出现）；`已作废` / `superseded` 行作为 tombstone 使该任务包退出统计。任务包编号须写在进度行「任务名称」列，使用**大写多段编号**（如 `A-DOC-1`、`B-LIB-1/2/3` 互不合并）；作废行亦须含被作废任务包编号以便精确 tombstone。`iterationType` 缺失时 R3 跳过（legacy 兼容）；`hotfix` / `docs-only` 豁免 R3。
>
> **双要素豁免机制（总则，唯一权威定义，适用于下表全部门禁）**：本框架任何机械门禁的「确不适用 / 确无法运行」豁免，**一律**须**同时**满足两项要素方可生效——**仅满足一项不生效**（防单方面弱化，R12）：
> 1. 系统架构师在活跃 `gated-artifacts.json` 中声明对应 `{gate}Applicability: "n/a"` + `{gate}ApplicabilityReason`（简述理由）；
> 2. `process.md`「## 用户确认记录」含一行对应豁免确认（行内须含下表「确认关键词」列所示词汇，供 Hook 机械识别）。
>
> | 门禁 | Applicability 字段 | 确认关键词（须含） | 判定函数（`workflow-gate-lib.mjs`） | 详细定义 |
> | ---- | ------------------- | -------------------- | ------------------------------------ | -------- |
> | E2E | `e2eApplicability` | 「E2E」+「豁免/不适用/无」 | `isE2eExempt()` | §8.3 |
> | R14 接口测试 | `apiTestApplicability` | 「接口测试」+「豁免/不适用/无接口」 | `isApiTestExempt()` | §8.3 |
> | R17 存储对账 | `storageReconciliationApplicability` | 「存储对账/对账」+「豁免/不适用/无持久化」 | `isStorageReconciliationExempt()` | §8.3 |
> | R15 lint | `lintApplicability` | 「编程规范/代码规范/lint」+「豁免/不适用/无」 | `isLintExempt()` | 本节 R15 |
> | R16 重复代码 | `dupCheckApplicability` | 「重复代码/DRY/jscpd」+「豁免/不适用/无」 | `isDupCheckExempt()` | 本节 R16 |
> | R16 安全扫描 | `securityScanApplicability` | 「安全扫描/安全静态扫描/密钥扫描」+「豁免/不适用/无」 | `isSecurityScanExempt()` | 本节 R16 |
>
> 重复代码与安全扫描**分别独立**豁免，不可一项代替另一项；下文各门禁「适用性豁免」小节均指回本表，不再重复展开机制本身。
>
> **R15（编程规范 lint 硬门禁，唯一权威定义）**：`full`（含 `greenfield`/`feature`/`governance-overhaul`）、`single-task` 与 `hotfix` 迭代，QE 阶段须满足：
> - 判据结构与 E2E 门禁同构（运行器写 `gatePassed` 机读产物 → lib 读入 → 门禁判定）；**执行命令与产物**：`node .cursor/scripts/lint-run.mjs` → `test-results/qe/.lint-result.json`。
> - **命令解析优先级**：`harness.config.json → qe.commands.lint` 覆盖 > 构建清单自动探测 > 栈默认（Node/Python/Go/Rust/Ruby 等有默认；Java/PHP/.NET 等无默认）；多数项目不必手配 config，仅 monorepo/自定义脚本名/探测不准时覆盖。`detail-design-spec.md` §5 由架构师填入与默认一致的留痕，不作为 Hook 输入。
> - **判据**：`lintPassed = readLintResult()?.gatePassed===true`（须有 lint 命令且退出码为 0）；`docs-only` 视为满足。QE 记录完成但 `lintPassed=false` 时 `gate-stop-workflow` 注入 followup，且**不得发起 test-engineer**（判定函数见 `rule-index.md`）。
> - **适用性豁免**：见上表 R15 行；无默认 lint 的栈须声明等价命令或走豁免，不得静默放过。
>
> **R16（静态代码质量硬门禁：重复代码 DRY + 安全静态扫描，唯一权威定义）**：`full`（含 `greenfield`/`feature`/`governance-overhaul`）、`single-task` 与 `hotfix` 迭代，QE 阶段须满足：
> - 判据结构与 R15 同构，但**跨技术栈通用、不做 per-stack 探测**（本框架要求 `Node.js >= 18`，两项工具均经 `npx` 直接获取）；**执行命令与产物**：`node .cursor/scripts/static-scan-run.mjs` → `test-results/qe/.static-scan-result.json`（含 `duplication`/`security` 两个子结果）。
> - **默认工具**：重复代码检测 `jscpd-rs`（`npx --yes jscpd-rs --threshold 5 --exitCode 1 ...`，5% 阈值超限退出码非 0）；安全静态扫描 `gitleaks-secret-scanner`（`npx --yes gitleaks-secret-scanner ...`，检出密钥即退出码非 0）。**命令解析优先级**：`harness.config.json → qe.commands.dupCheck`/`qe.commands.securityScan` 覆盖 > 框架默认值；多数项目不必手配 config。
> - **判据**：`staticScanPassed = (dupCheckExempt || duplication.gatePassed) && (securityScanExempt || security.gatePassed)`；`docs-only` 视为满足。QE 记录完成但 `staticScanPassed=false` 时 `gate-stop-workflow` 注入 followup，且**不得发起 test-engineer**（判定函数见 `rule-index.md`）。
> - **适用性豁免**：见上表 R16 两行（重复代码/安全扫描分别独立判定）。

### 8.3 两级集成测试与 E2E 判据（唯一权威定义，TG-D-4）

> 本节是「批次/最终 E2E」判据与命令的**唯一权威定义**；`README.md`、§3、§5、§6、`project-manager.md`、`test-engineer.md` 中出现的相关表述均须与本节保持一致，若只需引用判据请指回本节，不再复述完整公式/命令。

- **两级范围**：①**批次集成测试**——每批次 QE 通过后，对本批次新交付任务包做集成测试；②**最终整体集成测试**——全部任务包与各批次 E2E 闭环后，对整个产品做端到端集成测试。`测试判定`（最终交付依据）以**最终整体集成测试**（含最终 E2E）结论为准。
- **执行命令与产物**：批次 `node .cursor/scripts/e2e-run.mjs --scope=batch --required-ids=<本批次P0>` → `test-results/e2e/.e2e-batch-result.json`；最终 `node .cursor/scripts/e2e-run.mjs --scope=final --baseline=<requirement-list.md>` → `test-results/e2e/.e2e-final-result.json`。
- **浏览器范围**：仅需支持 **Chrome 内核浏览器（Chromium，含 Chrome/Edge 等 Chromium-based 浏览器）**，不要求 Firefox / WebKit 覆盖；执行器 Playwright Chromium headless；用例标题含 `[R-xxx]` 追溯标签。**浏览器范围是本机械门禁唯一允许简化的维度**：`gatePassed`、覆盖率、追溯标签等判据不因浏览器范围收窄而放松（需求 1）。
- **`gatePassed` 公式**：`gatePassed = allPassed && coverageComplete`（Chromium 覆盖全部 required P0 且无未解释 skip 且均通过）。`batchTestRowComplete` / `finalTestRowComplete` 仅反映进度行完成；`batchE2ePassed` / `finalE2ePassed` 读取对应结果文件的 `gatePassed`。`batchTestComplete = batchTestRowComplete && batchE2ePassed && batchApiReportPresent && batchStorageReconPresent`（含 R14 接口测试报告与 R17 存储对账机读判据）；`finalTestComplete = finalTestRowComplete && finalE2ePassed`。**`hotfix` 模式下按 R11 折叠**（见 §8.2），`batchTestComplete` 恒真，`finalTestRequired` 不依赖 `batchTestComplete`。
- **接口测试（R14，开发窗口批次集成测试阶段必测，唯一权威定义）**：`full`（含 `single-task`，见下方「适用范围」关于 `single-task` 的说明）模式非 hotfix 迭代，**开发窗口的批次集成测试阶段**（每批次 QE 通过后对本批次做的集成测试，**非**最终整体集成测试阶段）**必须做接口测试**，且测试报告须含**非空**的「## 接口测试报告」章节（至少一条真实表格数据行）。机读判据 `batchApiReportPresent` 由 `workflow-gate-lib.mjs` 的 `checkBatchApiTestReport()` 扫描当前活跃 docs 子树 `test/` 目录下 `*.md` 计算；缺失或为空时 `batchTestComplete=false`，`gate-stop-workflow` 注入 R14 followup，**不得推进下一批次或最终整体集成测试**。R14 仅约束批次阶段，最终整体集成测试与 hotfix 折叠通道不并入此判据。
- **接口测试适用性豁免（无对外接口项目）**：纯算法库、纯静态前端、无 HTTP/RPC/CLI 契约的组件等**无对外接口**项目，可豁免 R14 接口测试判据；判定遵循 §8.2「双要素豁免机制」表 R14 行（两项皆满足时 `isApiTestExempt()` 使 `batchApiReportPresent` 视为满足）。详见 `test-engineer.md`「接口测试适用性豁免」。
- **业务数据存储对账（R17，开发窗口批次集成测试阶段机读硬门禁，唯一权威定义）**：`full`（含 `single-task`）模式非 hotfix 迭代，**开发窗口的批次集成测试阶段**须满足机读判据 `batchStorageReconPresent`（由 `checkBatchStorageReconciliationReport()` 计算；豁免时 `isStorageReconciliationExempt()` 视为满足）。未满足时 `batchTestComplete=false`，`gate-stop-workflow` 注入 R17 followup，**不得推进下一批次或最终整体集成测试**。R17 仅约束批次阶段，最终整体集成测试与 hotfix 折叠通道不并入此判据。机读要求：
  1. 测试报告含非空「## 存储对账记录」章节（至少一条真实表格数据行；表头须含场景类型、关联任务包、存储介质、对账方式、预期存储结果、实际存储结果、是否通过）；
  2. **分类型行（仅计适用行）**：未豁免 R14（`!isApiTestExempt()`）时须含「场景类型」为接口/API **且存储介质非「不适用」** 的数据行；未豁免 E2E（`!isE2eExempt()`）时须含「场景类型」为 E2E/UI **且存储介质非「不适用」** 的数据行。「不适用」行**不计入**分类型判定；
  3. **至少一条适用行**：项目未走整体豁免时，合并全部对账行后须至少有一条介质为具名类别或「其他」的真实对账行（不得仅靠「不适用」行过门禁）；
  4. **描述列完备**：每条数据行「关联任务包」「对账方式」「预期存储结果」「实际存储结果」「是否通过」均非空；「关联任务包」须含可识别任务包编号（与 B1 同款大写多段编号）；
  5. **存储介质列**：每条数据行「存储介质」非空且匹配下表至少一类关键词（大小写不敏感）；介质仅为「其他/other」（未同时命中具名类别）时，「备注」列须非空并写明具体系统；介质为「不适用」时，「备注」列须非空说明该任务包无业务数据写入的理由；
  6. **按批次任务包覆盖**：`process.md`「## 进度列表」中测试工程师**已完成**的批次集成测试行所含任务包编号，须全部出现在对账行「关联任务包」列中至少一次（合并 `docs/test/*.md` 全部对账行判定，**含「不适用」留痕行**）。首批已填对账**不能**代替后续批次新增任务包的对账留痕。
- **R17 存储介质范围（唯一权威）**：「业务数据存储」不限于关系库；凡业务数据写入下列任一介质即触发 R17（写路径涉及几种就对几种；按 `detail-design-spec.md` §4 声明选用）：

  | 类别（机读关键词） | 典型形态（说明用，非穷尽） |
  | ------------------ | -------------------------- |
  | **数据库** / `db` / `database` | RDBMS、文档库、KV 持久库等 |
  | **文件** / `file` / `filesystem` | 本地/挂载目录、上传落盘、导出文件等 |
  | **缓存** / `cache` | Redis/Memcached 等承载业务状态或写穿/写回的缓存 |
  | **对象存储** / `object` / `blob` / `s3` / `oss` / `minio` | S3/OSS/MinIO 等 |
  | **其他** / `other` | 上表未列但 design §4 声明的业务落盘/落缓存介质；**备注列须非空**写明具体系统（机读强制）；**不得**用「其他」表示「本任务包无写入」 |
  | **不适用** / `n/a` | 项目整体有持久化、但**本任务包确无**业务数据写入时的留痕专用值；**仅计入任务包覆盖，不计入分类型真实对账**；**备注列须非空**说明理由（如「本任务包无业务数据写入，不适用对账」） |

- **存储对账适用性豁免（无业务数据持久化）**：仅内存计算、无跨请求业务状态、纯静态前端等**无**上述介质业务写入的项目，可豁免 R17；判定遵循 §8.2「双要素豁免机制」表 R17 行（两项皆满足时 `batchStorageReconPresent` 视为满足）。**不得**因「不是数据库」而跳过（文件/缓存/对象存储等同属触发范围）。**不得**用整份报告仅填「不适用」行代替项目级双要素豁免。
- **R17 门禁能力边界**：章节/表头存在性、分类型适用行、至少一条适用行、描述列非空、「其他」/「不适用」备注非空、存储介质类别关键词、批次任务包编号覆盖为机读硬门禁；对账方式是否真正查到对应介质、预期/实际是否语义正确等，仍由 QE/PM 文字审查（§8.4），Hook 不声称已验证语义。
- **约束后果**：批次 `gatePassed≠true` 时视为本批次集成测试未完成，**不得推进下一批次**；最终 `gatePassed≠true` 时**不得宣告项目完成**。
- **适用范围**：适用于 `full` 模式下的 `greenfield` / `feature` / `governance-overhaul`、`single-task` 及 `hotfix` 迭代（`hotfix` 按 R11 折叠为单次通道，测试严格程度不降低）；`docs-only` 豁免；无 UI 项目按 §8.2「双要素豁免机制」表 E2E 行豁免（详见 `test-engineer.md`「E2E 适用性豁免」）。**`single-task` 说明**：`workflow_mode=single-task` 未被 R11 折叠（R11 仅对 `hotfix` 生效），代码判定（`workflow-gate-lib.mjs` 仅对 `docs-only`/`hotfix` 做特判，其余按 `full` 同等严格处理）与 `full` 完全一致——即仍须产出「批次集成测试」与「最终整体集成测试」两条独立进度行（各自的 E2E/接口测试报告/存储对账判据同 §8.2/§8.3 全量要求），**不会**因为是小改动而自动折叠为一次测试。若确需单次测试通道，须与用户确认后改用 `hotfix` 模式（承担其设计前置校验 R9），不得自行按 `single-task` 语义简化两阶段测试判据（R12：不可仅凭「单任务」字面含义放松机械门禁）。
- **未解释 skip / `coverage-waivers.json`**：见 `test-engineer.md`「`coverage-waivers.json`」一节。

Hook 脚本路径：`.cursor/hooks/`。修改 Hook 行为时须同步更新本节与 `README.md`。

### 8.4 自锁防护与门禁能力边界

**自锁防护（fail-open）**：全部**五个** hook 入口脚本（`gate-dev-workflow`、`gate-dev-shell`、`gate-toolchain-install`、`gate-stop-workflow`、`gate-role-sequence`）对 `workflow-gate-lib.mjs` 使用动态 `import` + `try/catch`，且执行期逻辑同样包裹在 `try/catch` 中；lib 不可加载或运行期出现未预期异常时 **fail-open 放行**（`gate-stop-workflow` 语义为不注入 followup）并打印 stderr 告警，同时尽量将异常写入活跃 `process.md` 的 `## 门禁异常事件` 并将 `blocking: true`（`recordFailOpenEvent`；cancelled 流程或无法写盘时仅保留 stderr），避免门禁自身损坏导致全流程硬死锁，同时防止静默绕过。策略性 `deny` 不受影响。`gate-role-sequence` 额外在 `hooks.json` 中配置 `failClosed: false` 作为第二层兜底。

**门禁能力边界（须知）**：

- Hook 对**源码 / 构建产物 / 根目录敏感产物 / `.cursor/scripts|agents|hooks/**` 三目录 / 受门禁 Shell 命令 / Task 发起前的角色前置成果物（R13）**做确定性拦截。`.cursor/hooks.json`、`.cursor/harness.config.json` **不纳入机制门禁**，其变更治理由 `AGENTS.md` §5.1 R5/R8 **文字约束**覆盖。`docs/**/*.md`（需求、设计等文档类成果物）**不受写入期机制门禁约束**——§5 中「禁止顶层代理代写需求/设计文档」「禁止后台静默产出」属**文字约束**，由各子 agent 自我执行；但其中客观可判定的**存在性/表格完备性**已被 `gate-role-sequence`（R13）在 Task 发起前机械校验。Hook **无法识别调用者身份**（顶层代理 vs 子 agent 共用工具通道），故 actor identity 判定（谁在越权）属文字 + §5.15 自检约束，无 Hook 兜底——这是 R13 明确排除、无法机械化的部分（见 `gate-chain.md` 脚注）。
- **批次 + 最终 E2E 均有机读判据**（`batchE2ePassed` / `finalE2ePassed`）；**编程规范 lint 门禁**亦有机读判据（`lintPassed`，R15，读取 `test-results/qe/.lint-result.json`）；**静态代码质量门禁**亦有机读判据（`staticScanPassed`，R16，读取 `test-results/qe/.static-scan-result.json`）；**批次接口测试报告章节存在性**亦有机读判据（`batchApiReportPresent`，R14，检查「## 接口测试报告」章节非空）；**批次存储对账**亦有机读判据（`batchStorageReconPresent`，R17，检查「## 存储对账记录」非空、适用分类型行、至少一条适用行、描述列完备、「其他」/「不适用」备注、存储介质关键词与批次任务包覆盖）；**设计审核 R18**亦有机读判据（`checkDesignReviewClean`：12 维齐全、未解决行可修复字段完备、P0 覆盖矩阵含验收标准与**设计落点原文摘录**且全部「已覆盖」、审核结论通过/复审通过、技术选型确认；非 stub 时交叉校验设计章节与任务包编号）；**目标达成性/架构原则是否真正合理、验收标准与设计的深层语义对齐、交互断言、接口用例语义正确性、存储对账查验语义、SRP/SOLID/清晰命名等语义类规范**因不可机械判定而由需求评审专家/QE/PM 文字审查兜底。R18 覆盖矩阵的设计落点/任务包交叉校验（`designAnchorResolvable`/`taskPackExistsInList`）**仅做弱正则/子串匹配**（章节号或任务包编号在设计文档/任务清单中出现即视为可解析，不校验该章节/任务包内容与本条 P0 需求是否真实相关）——这是已知且被本文件坦诚披露的机械判定局限（不属隐藏漏洞）；「设计落点原文摘录」列为 R18 **机读必填且非空**（不校验摘录是否语义相关），供需求评审专家自查、QE/PM 复核时快速人工核验。
- **`test-results/` 受控运行产物例外**：E2E 机读结果（`test-results/e2e/.e2e-batch-result.json`、`.e2e-final-result.json`）、**编程规范 lint 机读结果**（`test-results/qe/.lint-result.json`）、**静态代码质量机读结果**（`test-results/qe/.static-scan-result.json`）、QE 运行留痕（`test-results/qe/qe-run-result.json`）及 Playwright trace/截图/video 由 `e2e-run.mjs` / `lint-run.mjs` / `static-scan-run.mjs` / `qe-run.mjs` / Playwright **进程内 `writeFileSync` 写盘**，不在 `sourceDirs` / `buildManifests` / `testConfigs` / `rootPatterns` 内，**不触发** `gate-dev-workflow`；`.gitignore` 已忽略 `test-results/`。此为**受控运行产物**，非绕过门禁；QE/测试阶段不得据此判定「脚本绕过 Hook」。
- Shell 门禁为正则匹配，属「尽力而为」：可绕过手段（如管道安装 `curl ... | sh`、`iwr ... | iex`、先写脚本再执行、未列出的包管理器别名）无法穷尽拦截。子 agent 不得主动利用这些手段绕过门禁（`AGENTS.md` §5.16）。
- **hotfix 折叠通道下 R14/R17 无硬门禁的部分缓解**：P0 影响的 hotfix（`hotfix_p0_impact: p0`）走 R11 折叠通道时，接口测试/存储对账无对应机读硬门禁（§8.3 已明确排除）——这是高风险场景下的一处真实机制空白（非文档/实现不一致）。`gate-stop-workflow` 提供一项**非阻塞**的缓解：唯一测试通道 `gatePassed=true` 后对**本次**测试报告做结构化章节（非空「## 接口测试报告」「## 存储对账记录」真实数据行）检测，缺失时写一次性软性提醒（见 `gate-chain.md` R9 脚注第 4 条），**不改变**「P0 影响的 hotfix 接口/存储验证仍主要依赖文字约束与人工审查」这一事实。
