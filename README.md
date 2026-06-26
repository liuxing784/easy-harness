# Harness Engineering

跨技术栈 AI 编程流程规约。将本目录作为 Cursor 工作区根目录，或复制 `.cursor/` 与 `AGENTS.md` 到目标项目后使用（`harness.config.json` 已收纳于 `.cursor/` 内）。

## 前置条件

- Harness Hook 与初始化脚本依赖 `Node.js >= 18` 执行 `.mjs` 文件。
- 目标项目的业务技术栈不限；具体运行时、包管理器与测试工具由系统架构师在设计阶段声明。

## 快速开始

**无需手动建目录。** 直接把本目录作为 Cursor 工作区根，向 AI 提目标即可。

1. **向 AI 提出目标**，例如：

   > 请按 Harness 流程开发一个 XXX 工具，技术栈待定。

2. **首次对话时**，项目经理会自动初始化 `docs/` 结构（执行 `node .cursor/scripts/bootstrap-docs.mjs` 或等价 Write），并写入 `.cursor/harness-state.json` 指向当前活跃流程。你不需要自己 `mkdir` / `copy`。

3. **顶层代理执行顺序**：
   - 先单独调用 `project-manager` 记录用户目标
   - 再按当前活跃 `process.md` 中 `## 待派发角色列表` 机械发起各角色 Task

4. **（可选）手动初始化**：仅当你要在无 AI 环境下预先建目录时，可执行 `node .cursor/scripts/bootstrap-docs.mjs`；Feature 迭代可执行 `node .cursor/scripts/bootstrap-docs.mjs --feature=feature-name`。

5. **轻量模式**（用户显式声明时生效）：

   | 模式 | 触发关键词示例 | 简化路径 |
   | ---- | -------------- | -------- |
   | `hotfix` | 「热修复」「修 bug」 | 跳过需求/架构，PM 直接分派开发 |
   | `docs-only` | 「只改文档」 | 仅允许 `docs/**/*.md` |
   | `single-task` | 「单任务」「小改动」 | PM 一次编排 DE→QA→测试 |

   轻量模式须在 `process.md` frontmatter 中设置 `workflow_mode`。

## 目录结构

```
harness/
├── AGENTS.md                 # 顶层流程规约（Cursor 约定根目录文件）
├── README.md
└── .cursor/                  # Harness 框架机件（整体复制即可分发）
    ├── harness.config.json   # 门禁路径、Shell 模式、工具链 TTL、默认模型
    ├── harness-state.json    # 运行时生成：当前活跃 process.md 指针
    ├── agents/               # 7 个子角色定义
    ├── hooks.json            # Hook 注册（matcher 与脚本映射）
    ├── hooks/                # 流程门禁 Hook 脚本
    ├── scripts/
    │   └── bootstrap-docs.mjs  # 一键初始化 docs/ 结构（幂等）
    └── templates/            # 成果物模板
```

> **目录布局说明**：除 `AGENTS.md`（Cursor 按约定在根目录读取）外，框架机件统一收敛在 `.cursor/` 下——既避免与宿主项目的 `scripts/`、`templates/`、配置文件等同名冲突，又使「复制 `.cursor/` + `AGENTS.md`」成为自洽的分发单元。运行时生成物在 `docs/`，由项目经理自动创建。
>
> **跨平台**：示例命令以 Windows（PowerShell / winget / VS Build Tools）居多，仅为示例；macOS/Linux 请使用等价工具（`brew`/`apt`/`dnf` 等）。禁止使用未确认的管道安装（如 `curl | sh`、`iwr | iex`）绕过工具链确认流程。

## 子 Agent 与 Task 映射

| 角色 | `.cursor/agents/` 文件名 | Task `subagent_type` |
| ---- | ------------------------ | -------------------- |
| 项目经理 | `project-manager.md` | 使用 agent 名称或对应 explore/generalPurpose 并传入本文件约束 |
| 需求分析师 | `requirements-analyst.md` | 同上 |
| 系统架构师 | `system-architect.md` | 同上 |
| 产品经理 | `product-manager.md` | 同上 |
| 开发工程师 | `development-engineer.md` | 同上 |
| 质量保障工程师 | `quality-assurance-engineer.md` | 同上 |
| 测试工程师 | `test-engineer.md` | 同上 |

> Cursor Task 工具以 `.cursor/agents/{name}.md` 中 `name` 字段识别子 agent。发起 Task 时 `prompt` 须引用对应角色定义，且不得越权。

### Task Prompt 最小上下文

顶层代理发起子角色 Task 时，`prompt` 只传递以下信息，不得替子角色指定内部实现步骤：

- 用户目标与用户已确认摘要；
- 当前活跃 `process.md` 路径；
- 已存在成果物路径；
- 项目经理在 `## 待派发角色列表` 中写明的目标角色、开发线、任务包编号；
- 质量报告 / 测试报告中的待整改问题（仅整改阶段）。

## 技术栈扩展

系统架构师在 `docs/design/gated-artifacts.json`（可选）中声明本项目额外受门禁保护的路径与初始化命令，Hook 会与 `harness.config.json` 默认项合并。

模板见 `.cursor/templates/gated-artifacts.json`。

Feature 迭代时，对应文件位于 `docs/{feature-名称}/design/gated-artifacts.json`，Hook 会根据 `.cursor/harness-state.json` 或环境变量 `HARNESS_PROCESS_PATH` 定位当前活跃 feature。

## 配置说明

- **门禁路径**：`.cursor/harness.config.json` → `gatedPaths`
- **根目录/基础设施门禁**：`.cursor/harness.config.json` → `gatedPaths.rootPatterns`
- **Shell 拦截**：`gatedShellPatterns` + 项目级 `gated-artifacts.json`；`hooks.json` 采用宽 matcher，具体是否拦截由脚本读取配置判定
- **工具链安装批准**：`toolchain.installPatterns` 命中后，用户确认并创建 `.cursor/hooks/.toolchain-install-approved.json`（默认 60 分钟有效）
- **活跃流程路径**：`.cursor/harness-state.json` → `activeProcessPath`；可用环境变量 `HARNESS_PROCESS_PATH` 临时覆盖

修改 Hook 或配置后，请同步更新 `AGENTS.md`「流程门禁 Hook」一节。
