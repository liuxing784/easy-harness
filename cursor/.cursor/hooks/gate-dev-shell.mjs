#!/usr/bin/env node
/**
 * beforeShellExecution 门禁：无分派计划时，禁止项目初始化 / Tauri 构建命令。
 * 自锁防护（`.cursor/harness/spec/mechanical-gates.md` §8.4）：见 gate-dev-workflow.mjs 顶部注释，策略一致。
 */
function failOpenAllow(context, err, lib) {
  process.stderr.write(`[gate-dev-shell] fail-open (${context}): ${err?.message ?? err}\n`);
  try {
    lib?.recordFailOpenEvent?.('gate-dev-shell', context, err);
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

  const { allow, assertDevGateOrDeny, isGatedShellCommand, readStdinJsonAsync } = lib;

  try {
    const input = await readStdinJsonAsync();
    const command = input.command ?? input.tool_input?.command ?? '';

    if (!isGatedShellCommand(command)) {
      allow();
    }

    assertDevGateOrDeny();
    allow();
  } catch (err) {
    failOpenAllow('runtime', err, lib);
  }
}

main();
