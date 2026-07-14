# Harness 项目复盘审计清单

Phase 1 对照本清单逐项打勾并记录证据。结论：`✓` 合规 / `△` 部分合规 / `✗` 不合规 / `N/A` 不适用。

## A. 流程初始化与模式

| # | 检查项 | 规约依据 |
| --- | ------ | -------- |
| A1 | `docs/` 结构已由 bootstrap 或等价方式创建 | §7 |
| A2 | `workflow_mode` 与用户声明一致（full/hotfix/docs-only/single-task） | §3 |
| A3 | `iterationType` 与分诊表一致且已留痕 | §3 |
| A4 | Feature 迭代时 `harness-state.json` 指向正确 `process.md` | §3 |
| A5 | `## 用户目标` 记录完整 | process 模板 |
| A6 | 须确认事项均在 `## 用户确认记录` 留痕 | §5 |

## B. 成果物门禁链（按 workflow_mode）

### full / feature / greenfield

| # | 检查项 | 规约依据 |
| --- | ------ | -------- |
| B1 | `requirement-spec.md`、`requirement-list.md` 存在且有效 | §5 |
| B2 | `detail-design-spec.md`、`develop-task-list.md` 存在 | §5 |
| B3 | 技术选型经用户确认（非仅 `tech-stack-options.md`） | §5 无效成果物 |
| B4 | `design-problem-list.md` 设计审核已通过 | §5 |
| B5 | 四件成果物在 `process.md` 中被引用（R3） | §5、R3 |

### hotfix

| # | 检查项 | 规约依据 |
| --- | ------ | -------- |
| B6 | `detail-design-spec.md` 存在（R9） | §5 hotfix |
| B7 | E2E 适用性可解析或已豁免留痕 | R9、§8.3 |
| B8 | 测试按 R11 单次通道执行 | R11 |

### docs-only

| # | 检查项 | 规约依据 |
| --- | ------ | -------- |
| B9 | 无业务源码写入；仅 `docs/**/*.md` | §3 |

## C. 项目经理编排

| # | 检查项 | 规约依据 |
| --- | ------ | -------- |
| C1 | `## 当前分派计划` 含有效数据行（非占位） | §5 无效成果物 |
| C2 | 开发前存在 `## 待派发角色列表` | §5 |
| C3 | `develop-task-list.md` 含 §3 分派方式与整体分派模式 | §5 |
| C4 | 角色切换经项目经理（进度表有 PM 记录） | §4.9、§6 |
| C5 | 并行开发线分 Task 未合并任务包 | §4.11–12 |
| C6 | `## 回退计数` 与超 3 次阻塞处理 | §9 |
| C7 | `blocking: true` 时流程未偷偷推进 | §4.4 |
| C8 | `cancelled: true` 后无继续修改 process | R10 |

## D. 开发与质量

| # | 检查项 | 规约依据 |
| --- | ------ | -------- |
| D1 | 业务代码在 DE 分派后出现，非 PM 代写 | §4、§5 |
| D2 | 每条开发线有独立 QA 记录 | §5、§6 |
| D3 | QA 非抽样：任务包全量单元测试已运行 | §5 无效成果物 |
| D4 | `quality-report` 与任务包编号对应 | §5 |
| D5 | R15：`lint-run.mjs` 已运行且 `.lint-result.json` 中 `gatePassed=true`（或双要素豁免留痕） | §8.2 R15 |
| D6 | 质量报告含「## 编程规范（lint）执行记录」 | quality-report 模板 |
| D7 | R16：`static-scan-run.mjs` 已运行且 `.static-scan-result.json` 中 `duplication.gatePassed`/`security.gatePassed` 均为 `true`（或对应双要素豁免留痕，二者独立） | §8.2 R16 |
| D8 | 质量报告含「## 静态代码质量执行记录（R16：重复代码 + 安全扫描）」 | quality-report 模板 |

## E. 测试与 E2E

| # | 检查项 | 规约依据 |
| --- | ------ | -------- |
| E1 | 每批次 QA 后有批次集成测试行（非 hotfix） | §6、§8.3 |
| E2 | `.e2e-batch-result.json` 存在且 `gatePassed=true`（非 hotfix） | §8.3 |
| E3 | 全部批次完成后有最终整体集成测试 | §6 |
| E4 | `.e2e-final-result.json` 存在且 `gatePassed=true` | §8.3 |
| E5 | P0 用例含 `[R-xxx]` 追溯标签 | §8.3 |
| E6 | 未在 E2E 未通过时宣告完成 | §4.13、§8.3 |
| E7 | hotfix：单次 final 通道满足 E3/E4 语义 | R11 |
| E8 | 批次测试报告含非空「## 接口测试报告」且至少一条真实用例数据行，或已双要素豁免 | R14、§8.3 |
| E9 | 接口测试豁免留痕（若适用）：`apiTestApplicability` + 用户确认 | R14、§8.2 |
| E10 | 批次测试报告含非空「## 存储对账记录」且适用分类型行/至少一条适用行/描述列/介质/其他与不适用备注/批次任务包覆盖机读通过，或已双要素豁免 | R17、§8.3 |
| E11 | 存储对账豁免留痕（若适用）：`storageReconciliationApplicability` + 用户确认 | R17、§8.2 |

## F. 顶层代理与 Hook（证据：日志、git、对话）

| # | 检查项 | 规约依据 |
| --- | ------ | -------- |
| F1 | 无顶层代写受门禁路径 | R5、§4.1 |
| F2 | 无越级发起 Task | R8、R13 |
| F3 | 无 Hook 拒绝后换工具绕过 | §4.16 |
| F4 | 工具链安装经用户确认与批准标记 | §4.17 |
| F5 | Task 未附加 `model` 覆盖 | §4.3 |

## G. 文档与规约一致性

| # | 检查项 | 规约依据 |
| --- | ------ | -------- |
| G1 | `AGENTS.md` 与 `README.md` E2E/测试表述与 §8.3 一致 | TG-D-4 |
| G2 | agent 文件 model slug 与 §1 对照表一致 | §1 |
| G3 | Hook 行为与 §8.1 表一致（可对照 gate-scenarios） | §8.1 |
| G4 | 文档声明强于实现时，实现已补齐（非削文档） | R12 |

## H. 复盘元数据

记录：

- 复盘人/对话 id（可选）
- 证据缺口（无法验证的项及原因）
- 执行偏差 vs 规约缺口 数量统计
