# 详细设计说明书

## 1. 技术选型确认

（引用用户已确认的技术栈原文，或"用户目标中已明确技术栈：……"）

## 2. 系统架构

（整体架构图/说明、模块划分、关键设计决策与取舍理由）

**架构设计原则**（跨技术栈通用，须在模块/服务划分与关键决策中体现，供 §4 接口设计与开发工程师落地参考）：

- **单一职责**：每个模块/服务只对应一类变化原因，禁止「大而全」模块；
- **高内聚、低耦合**：模块内部职责聚焦；模块间通过稳定接口交互，避免循环依赖与跨层直接访问内部实现；
- **DRY**：同类能力（鉴权、日志、缓存等）只建一套，禁止多处重复建设；
- **KISS**：优先选用满足当前需求的最简架构，非必要不引入额外抽象层/中间件；
- **依赖方向（SOLID 架构层体现）**：高层模块不依赖低层实现细节，通过接口/抽象隔离变化点；
- **错误处理与日志策略**：统一错误码/异常处理机制、日志级别与格式规范（含敏感信息脱敏要求），具体编码执行见 §5、§8。

## 3. 目录结构

| 路径 | 用途 | 是否受门禁保护 |
| ---- | ---- | -------------- |
| | | 是/否 |

> 「是否受门禁保护」须与 `gated-artifacts.json`（见 §7）及 `.cursor/harness.config.json` 默认列表核对一致。

## 4. 接口 / 数据模型设计

（按项目技术栈：API 契约、数据库 schema、状态管理等）

**业务数据存储介质（R17 输入，须明确）**：声明本项目业务数据是否写入持久化/缓存介质；若写入，列出类别（与 `.cursor/harness/spec/mechanical-gates.md` §8.3 R17 存储介质范围一致：数据库 / 文件 / 缓存 / 对象存储 / 其他）。无上述写入时可走 R17 双要素豁免。写路径涉及几种介质，测试对账就覆盖几种。

| 是否有业务数据存储 | 介质类别（可多选） | 具体系统/路径说明 |
| ------------------ | ------------------ | ----------------- |
| 是/否 | 数据库/文件/缓存/对象存储/其他 | |

## 5. 代码规范

- 注释语言：（中文/英文，与项目约定一致）
- 命名风格：须清晰达意（见下方通用原则），与项目约定一致；
- 复杂逻辑块须有注释；
- 目录结构须与本文件 §3 一致。

**代码编写通用原则**（跨技术栈通用，由开发工程师落地、质量工程师审查）：

- **单一职责（SRP）**：每个函数/类只做一件事、只因一个原因改动；
- **DRY**：禁止复制粘贴产生重复逻辑，公共逻辑须抽取复用；
- **KISS**：优先直白实现，避免炫技式或不必要的复杂写法；
- **SOLID**：面向对象/模块化实现遵循开闭（OCP）、里氏替换（LSP）、接口隔离（ISP）、依赖倒置（DIP）；非 OOP 语言按其范式类比应用；
- **清晰命名**：变量/函数/类名须见名知意，禁止无意义缩写（如 `data1`、`tmp`）与拼音直译；布尔量以 `is`/`has`/`can` 等前缀；
- **小函数**：单函数聚焦单一逻辑，建议 ≤ 50 行、圈复杂度 ≤ 10，超出须拆分或在质量报告说明理由；
- **完整错误处理**：禁止吞异常/静默失败/空 `catch`；对外部边界（I/O、网络、解析、第三方调用）须显式捕获并处理，或携带上下文向上抛出；
- **日志规范**：关键路径与异常须记录日志，区分 DEBUG/INFO/WARN/ERROR 级别；日志须含足够上下文（如请求 ID、模块名）；**禁止记录密钥、密码、令牌等敏感信息**。

### 编程规范 lint 命令（R15，文档留痕）

> **机制说明**：QE 阶段运行 `node .cursor/scripts/lint-run.mjs` 时，命令由 **`harness.config.json` → `qe.commands.lint` 覆盖 > 构建清单自动探测 > 下表默认值** 解析（与 Hook 机械判据一致）。本节由系统架构师按已确认技术栈**填入一行**，供 QE/PM 查阅；**不必**为通过门禁而重复写入 config——多数栈留空 `qe.commands.lint` 即可。仅 monorepo、自定义脚本名、或多 manifest 时须在 config 覆盖并在下表同步改写。

**各栈默认 lint 命令**（`lint-run-lib.mjs` → `STACK_LINT_COMMANDS`，与 `qe-run.mjs` 同口径）：

| 技术栈（根目录 manifest） | 默认 lint 命令 |
| ------------------------- | -------------- |
| Node.js（`package.json`） | `npm run lint` |
| Python（`pyproject.toml` / `requirements.txt`） | `ruff check .` |
| Go（`go.mod`） | `go vet ./...` |
| Rust（`Cargo.toml`） | `cargo clippy` |
| Ruby（`Gemfile`） | `rubocop` |
| Java Maven / Gradle / PHP / .NET | **无框架默认** → 在 config 声明等价命令，或走 `lintApplicability: "n/a"` 双要素豁免 |

**本项目（架构师填写）**：

| 已确认技术栈 | lint 命令 / 豁免说明 |
| ------------ | -------------------- |
| （如 Node.js） | （从上表复制默认，如 `npm run lint`；或说明豁免理由） |

### 重复代码检测命令（R16，文档留痕）

> **机制说明**：重复代码检测（DRY）经 `jscpd-rs`（`npx --yes jscpd-rs --threshold 5 --exitCode 1 ...`）实现，**跨技术栈通用、无需按栈适配**（本框架已强制要求 `Node.js >= 18`，`npx` 在任意技术栈项目中均可用）。默认阈值 5%，**多数项目不必修改** `harness.config.json`；仅当阈值需调整或忽略目录不同于默认（`node_modules`/`dist`/`build`/`vendor`/`target` 等）时，在 `qe.commands.dupCheck` 覆盖完整命令。确无法运行（如离线环境）时，走 `dupCheckApplicability: "n/a"` 双要素豁免。

**本项目**：（默认沿用框架命令；如有覆盖或豁免，在此说明）

## 6. 测试策略

| 测试类型 | 负责角色 | 工具/命令 | 覆盖范围 |
| -------- | -------- | --------- | -------- |
| 单元测试 | development-engineer | | |
| 集成测试 | test-engineer | | |
| 接口测试 | test-engineer | | 开发窗口批次集成测试阶段必测（R14，见 `.cursor/harness/spec/mechanical-gates.md` §8.3）；覆盖各接口/契约 |
| 存储对账 | test-engineer | | 开发窗口批次机读硬门禁（R17，见 `.cursor/harness/spec/mechanical-gates.md` §8.3 / `checkBatchStorageReconciliationReport`）；介质范围见 §4 |
| E2E（若适用） | test-engineer | Playwright Chromium headless | P0 场景，见 `.cursor/harness/spec/mechanical-gates.md` §8.3；写路径对账留痕见 R17 |

> 若项目无 UI 或不适用浏览器 E2E，须在 §7 `gated-artifacts.json` 中声明 `e2eApplicability: "n/a"` 并注明理由，等待用户在 `process.md`「用户确认记录」中确认豁免。
> 若项目无业务数据持久化，须声明 `storageReconciliationApplicability: "n/a"` 并经用户确认后豁免 R17（见 `.cursor/harness/spec/mechanical-gates.md` §8.2）。

## 7. 受门禁保护的产物声明

已同步写入 `docs/[{feature}/]design/gated-artifacts.json`（模板：`.cursor/templates/gated-artifacts.json`）。

## 8. 安全基线

（密钥管理、输入校验、依赖安全审计要求等最小约束）

**安全编码要求**（跨技术栈通用）：

- 密钥/凭证禁止硬编码，统一走环境变量或密钥管理服务；
- 所有外部输入（用户输入、第三方接口响应）须校验/转义，防注入（SQL/命令/XSS 等）；
- 对外错误信息须脱敏，禁止暴露堆栈、内部路径、密钥等敏感细节（呼应 §5 日志规范）；
- 依赖安全审计命令见 `quality-engineer.md`「依赖审计命令」，执行结果记录于质量报告。

### 安全静态扫描命令（R16，文档留痕）

> **机制说明**：硬编码密钥泄露扫描经 `gitleaks-secret-scanner`（`npx --yes gitleaks-secret-scanner ...`）实现，同 §5 重复代码检测，**跨技术栈通用、经 `npx` 自动获取，多数项目不必修改** `harness.config.json`；仅当需替换为项目已有的 SAST 工具（如 semgrep，覆盖更深的注入类检测）时，在 `qe.commands.securityScan` 覆盖完整命令。确无法运行时，走 `securityScanApplicability: "n/a"` 双要素豁免。

**本项目**：（默认沿用框架命令；如有覆盖或豁免，在此说明）
