#!/usr/bin/env node
/**
 * preToolUse 门禁：无项目经理分派计划时，禁止写入开发产物。
 * 自锁防护（`.cursor/harness/spec/mechanical-gates.md` §8.4）：workflow-gate-lib.mjs 动态加载失败或执行期出现未预期
 * 异常时 fail-open 放行并打印 stderr 告警，避免门禁自身故障导致全流程硬死锁。
 */
function failOpenAllow(context, err, lib) {
  process.stderr.write(`[gate-dev-workflow] fail-open (${context}): ${err?.message ?? err}\n`);
  try {
    lib?.recordFailOpenEvent?.('gate-dev-workflow', context, err);
  } catch {
    /* 落盘失败不影响 fail-open 放行 */
  }
  process.stdout.write(JSON.stringify({ permission: 'allow' }));
  process.exit(0);
}

function extractPatchPaths(text) {
  if (typeof text !== 'string') return [];
  const paths = [];
  const re = /^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm;
  let match;
  while ((match = re.exec(text)) !== null) {
    paths.push(match[1].trim());
  }
  return paths;
}

function extractToolPaths(value) {
  const paths = [];
  if (!value) return paths;

  if (typeof value === 'string') {
    return extractPatchPaths(value);
  }

  const directFields = ['path', 'file_path', 'target_file', 'target_notebook', 'notebook_path'];
  for (const field of directFields) {
    if (typeof value[field] === 'string') paths.push(value[field]);
  }

  for (const field of ['patch', 'diff', 'content', 'input']) {
    paths.push(...extractPatchPaths(value[field]));
  }

  return paths;
}

async function main() {
  let lib;
  try {
    lib = await import('./workflow-gate-lib.mjs');
  } catch (err) {
    failOpenAllow('lib-load', err);
    return;
  }

  const { allow, assertDevGateOrDeny, deny, isCancelledProcessFile, isGatedDevPath, readStdinJsonAsync } = lib;

  try {
    const input = await readStdinJsonAsync();
    const toolInput = input.tool_input ?? input.arguments ?? {};
    const filePaths = extractToolPaths(toolInput);

    // R10：已取消（不可逆）的 process.md 一律冻结，优先于其余判定（含 docs 允许扩展名放行）。
    // 检查目标文件自身当前磁盘内容，与「活跃流程指针」无关，天然支持多 feature 逐个终止。
    for (const filePath of filePaths) {
      if (isCancelledProcessFile(filePath)) {
        deny(
          '流程门禁（R10）：该 process.md 已被用户取消终止（不可逆），禁止任何后续写入/修改/删除。',
          'AGENTS.md R10：cancelled: true 的 process.md 永久冻结，任何角色（含 project-manager）均不得再修改。如需继续工作，请发起新的流程/迭代（新的 process.md）。',
        );
      }
    }

    if (!filePaths.some((filePath) => isGatedDevPath(filePath))) {
      allow();
    }

    assertDevGateOrDeny();
    allow();
  } catch (err) {
    failOpenAllow('runtime', err, lib);
  }
}

main();
