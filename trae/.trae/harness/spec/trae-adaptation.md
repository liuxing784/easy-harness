# Trae 适配说明（工具特定）

> **本文件为 Trae 工具特有适配说明**，Cursor 版本无对应文件。常驻宪章见根目录 `AGENTS.md`（硬约束与索引，不含工具特定展开）。
> **约束强度**：本文是对宪章与其他 spec 中 Trae 特有机制的**展开说明**，不新增也不放松任何约束；遇不一致时以宪章 + `workflow-gate-lib.mjs` 代码为准。

## 0. Trae 适配总览

本规约为 Trae 版本。**文字规则（R2/R3/R5/R6/R8/R9/R10/R11/R12/R13/B1/TG-D-4）与 Cursor 版完全一致**。以下为 Trae 工具特有的加载、调用与门禁机制说明。

### 0.1 角色加载机制（Trae 原生 Subagent）

Trae 原生支持项目级 Subagent（见 <https://docs.trae.cn/ide_subagents>）。7 个角色定义文件位于 `.trae/agents/{name}.md`，frontmatter 含 `name` / `description` / `model` / `tools` 四字段：

- **加载方式**：内置 "Agent" 根据用户意图与各 Subagent 的 `description` 字段匹配，自动调用对应 Subagent；Subagent 拥有独立上下文窗口，中间推理不污染顶层 Agent 对话。
- **模型**：`model` 字段在文件内 pin（见 §0.2 映射表说明），无需顶层代理在 Agent 调用时传入。
- **工具**：`tools` 字段按最小权限原则限定各角色可用工具（见各角色文件 frontmatter）。
- **角色间分派**：Subagent 不能调用其他 Subagent（Trae 仅内置 "Agent" 可调用 Subagent）；项目经理完成分派后，由顶层 Agent 依据 `process.md` 的 `## 待派发角色列表` 调用对应角色 Subagent。
- **用户交互**：Subagent 工具集不含 `AskUserQuestion`（已核对 Trae 官方 Subagent 可用工具清单：Bash/Edit/Glob/Grep/Read/Skill/TodoWrite/WebFetch/WebSearch/Write/LSP/MCP）；需用户确认时，Subagent 在返回结果中标注「需要用户确认：[问题]」，由顶层 Agent 代为询问，确认结果传回后继续。

### 0.2 角色推荐模型映射

模型已在 `.trae/agents/*.md` frontmatter 的 `model` 字段内 pin，顶层 Agent 调用 Subagent 时无需另行传入。**禁止**以「换用更弱模型以帮助子 agent 通过门禁」为目的修改角色文件 frontmatter 的 `model` 字段——此行为等同绕过角色定义、代行该角色职责。

### 0.3 门禁机制（原生 Hook + 手动兜底双保险）

门禁采用 **Trae 原生 Hook 自动拦截** 与 **顶层代理手动调用自检** 双保险机制：
- **原生 Hook（第一层，确定性拦截）**：`.trae/hooks.json` 遵循 Trae 标准格式（`PreToolUse` / `Stop` PascalCase 事件 + `name`/`enabled`/`command`/`matcher` 字段），Trae 客户端自动加载并在对应事件触发时执行 Hook 脚本，实现机械确定性拦截。
- **手动自检（第二层，兜底保障）**：`.trae/rules/gate-protocol.md`（`alwaysApply: true`）强制顶层代理在关键操作前手动调用 `node .trae/scripts/gate-check.mjs <子命令>` 自检，作为 Hook 失效或未覆盖场景的兜底保障。

两层机制共用同一套判定逻辑（`workflow-gate-lib.mjs` + 5 个 `gate-*.mjs`），确保判据一致。

**强制调用清单（手动自检兜底）**：

| 操作前 | gate-check 子命令 | 动作 |
| ------ | ------------------ | ---- |
| 写入 / 编辑 / 删除任意文件 | `node .trae/scripts/gate-check.mjs dev-write <filepath>` | 退出码 0 放行；1 拒绝 |
| 执行 Shell 命令 | `node .trae/scripts/gate-check.mjs dev-shell "<command>"` | 退出码 0 放行；1 拒绝 |
| 执行系统级工具链安装 | `node .trae/scripts/gate-check.mjs toolchain "<command>"` | 退出码 0 放行；1 拒绝 |
| 发起角色 Agent 分派 | `node .trae/scripts/gate-check.mjs role <role-name>` | 退出码 0 放行；1 拒绝 |
| 拟结束当前回合 | `node .trae/scripts/gate-check.mjs stop` | 退出码 0 可收尾；2 须继续推进 |

**R12（只可加强不可放松）适配**：本方案不放松任何判据——gate 脚本的判定逻辑（R3/R6/R9/R10/R11/R13/B1）完整（同一份 `workflow-gate-lib.mjs`），`gate-selftest` / `gate-scenarios` 全量回归通过。

### 0.4 工具说明

| 工具 | 说明 |
| ---- | ---- |
| Agent（发起子 agent） | Trae 原生 Subagent，定义于 `.trae/agents/{name}.md`，按 `description` 匹配调用对应 Subagent |
| AskUserQuestion | Subagent 工具集不含此工具（已核对官方清单）；需用户确认时在返回结果中标注，由顶层 Agent 代为询问 |

> 正文中「Task」「发起 Task」「子 agent Task」等表述均指 Trae 的 `Agent` 工具调用。
