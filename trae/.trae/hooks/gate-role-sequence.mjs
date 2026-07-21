#!/usr/bin/env node
/**
 * R13（需求 6）：成果物门禁链机械化。
 *
 * 拦截 Task 工具调用，在角色 Task 真正发起前，对 .trae/harness/spec/gate-chain.md 门禁链表格中
 * 客观可判定的前置条件（成果物文件是否存在、设计问题清单/质量报告表格是否有
 * 未解决项等）做机械校验，不满足则 deny——把原先仅靠 R8/§5 文字约束的部分
 * 转为 Hook 强制，减少对文字规则可靠性的依赖。
 *
 * fail-open 兜底（.trae/harness/spec/mechanical-gates.md §8.4，与其余 4 个 Hook 一致，`hooks.json` 亦将本 Hook
 * 设为 `failClosed: false` 双重保险）：
 * - workflow-gate-lib.mjs 动态加载失败或执行期出现未预期异常时放行；
 * - 无法从 tool_input 中解析出目标角色名时放行；
 * - 目标角色不在 ROLE_GATE_TABLE 中（如 project-manager、requirements-analyst，
 *   二者是流程起点/无强前置）时放行。
 *
 * 本 Hook 与写入期机械门禁（gate-dev-workflow / gate-dev-shell）互为纵深防御：
 * 本 Hook 在 Task 发起前拦，写入期 Hook 在真正写入/执行前再拦一次。
 */
const GATED_ROLES = new Set([
  'system-architect',
  'requirement-reviewer',
  'development-engineer',
  'quality-engineer',
  'test-engineer',
]);

function failOpenAllow(context, err) {
  if (err) {
    process.stderr.write(`[gate-role-sequence] fail-open (${context}): ${err?.message ?? err}\n`);
  }
  if (globalThis.__gateLib?.recordFailOpenEvent) {
    try {
      globalThis.__gateLib.recordFailOpenEvent('gate-role-sequence', context, err);
    } catch {
      // 写日志失败不影响 fail-open 放行
    }
  }
  process.stdout.write(JSON.stringify({ permission: 'allow' }));
  process.exit(0);
}

function extractTargetRole(input) {
  const toolInput = input.tool_input ?? input.arguments ?? {};
  const candidates = [
    toolInput.subagent_type,
    toolInput.subagentType,
    toolInput.agent,
    toolInput.agent_type,
    toolInput.role,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  }
  return null;
}

async function main() {
  let lib;
  try {
    lib = await import('./workflow-gate-lib.mjs');
  } catch (err) {
    failOpenAllow('lib-load', err);
    return;
  }

  const { readStdinJsonAsync, checkRoleDispatchGate } = lib;
  globalThis.__gateLib = lib;

  try {
    const input = await readStdinJsonAsync();
    const rawRole = extractTargetRole(input);
    const role = lib.normalizeRoleSlug(rawRole) ?? rawRole;

    if (!role || !GATED_ROLES.has(role)) {
      failOpenAllow('not-gated-role');
      return;
    }

    const result = checkRoleDispatchGate(role);
    if (result.ok) {
      process.stdout.write(JSON.stringify({ permission: 'allow' }));
      process.exit(0);
    }

    process.stdout.write(
      JSON.stringify({
        permission: 'deny',
        user_message: `流程门禁（R13）：发起 ${role} 前置条件未满足——${result.message ?? result.reason}`,
        agent_message: `.trae/harness/spec/gate-chain.md R13/§5：${result.message ?? result.reason}（reason=${result.reason}）。请先完成对应前置成果物或分派，再重试发起该角色。`,
      }),
    );
    process.exit(0);
  } catch (err) {
    failOpenAllow('runtime', err);
  }
}

main();
