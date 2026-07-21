#!/usr/bin/env node
/**
 * beforeShellExecution 门禁：系统级工具链安装须先询问用户确认路径。
 * 自锁防护（`.cursor/harness/spec/mechanical-gates.md` §8.4）：见 gate-dev-workflow.mjs 顶部注释，策略一致。
 */
function failOpenAllow(context, err, lib) {
  process.stderr.write(`[gate-toolchain-install] fail-open (${context}): ${err?.message ?? err}\n`);
  try {
    lib?.recordFailOpenEvent?.('gate-toolchain-install', context, err);
  } catch {
    /* 落盘失败不影响 fail-open 放行 */
  }
  process.stdout.write(JSON.stringify({ permission: 'allow' }));
  process.exit(0);
}

async function main() {
  let lib;
  try {
    lib = await import('./workflow-gate-lib.mjs');
  } catch (err) {
    failOpenAllow('lib-load', err);
    return;
  }

  const { allow, ask, isToolchainInstallCommand, hasToolchainInstallApproval, readStdinJsonAsync } = lib;

  try {
    const input = await readStdinJsonAsync();
    const command = input.command ?? input.tool_input?.command ?? '';

    if (!isToolchainInstallCommand(command)) {
      allow();
    }

    if (hasToolchainInstallApproval(command)) {
      allow();
    }

    ask(
      '工具链安装门禁：须先询问用户现有工具链路径或安装目标目录（避免未经确认的默认系统路径），在用户明确确认前不得自动安装。',
      'AGENTS.md gate-toolchain-install：请先使用 AskQuestion 询问用户工具链的现有路径或安装目录。用户确认后创建 `.cursor/hooks/.toolchain-install-approved.json`（含 approvedAt、userConfirmed: true，可选 commandHash），默认 60 分钟内有效，再重试安装命令。',
    );
  } catch (err) {
    failOpenAllow('runtime', err, lib);
  }
}

main();
