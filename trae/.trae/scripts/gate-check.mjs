#!/usr/bin/env node
/**
 * gate-check.mjs — Trae 手动门禁调用入口
 *
 * 本脚本作为「手动门禁」入口，供顶层代理在对应操作前显式调用：
 * 内部构造 JSON 载荷并以子进程方式调用 .trae/hooks/ 下对应的 gate 脚本，
 * 透传其 stdout 结果，并以退出码区分放行 / 拒绝 / 须继续推进。
 *
 * 用法：
 *   node .trae/scripts/gate-check.mjs dev-write <filepath>            # 写入/编辑/删除前（R3/R6/R9/R10）
 *   node .trae/scripts/gate-check.mjs dev-shell "<shell-command>"     # 受控 Shell 前门禁
 *   node .trae/scripts/gate-check.mjs toolchain "<install-command>"   # 工具链安装前门禁
 *   node .trae/scripts/gate-check.mjs role <role-name>                # 角色分派前门禁（R13）
 *   node .trae/scripts/gate-check.mjs stop                             # 回合结束前门禁
 *
 * 输出（stdout）：原样透传 gate 脚本的 JSON 结果：
 *   {permission: "allow"}                                → 放行
 *   {permission: "deny", user_message, agent_message}    → 拒绝（须停止并报告用户）
 *   {followup_message: "..."}                            → stop 专用，须继续推进
 * 退出码：0 = 放行 / 可收尾；1 = 拒绝；2 = 须继续推进（followup）
 *
 * 注意：gate 脚本 fail-open（见 .trae/harness/spec/mechanical-gates.md §8.4），lib 不可加载或运行期异常时放行。
 * 这是防自锁设计，非门禁放松。
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOOKS_DIR = path.resolve(__dirname, '../hooks');
const PROJECT_ROOT = path.resolve(__dirname, '../..');

function usage() {
  const lines = [
    'Usage: node .trae/scripts/gate-check.mjs <gate> [args...]',
    '',
    'Gates:',
    '  dev-write <filepath>           Pre-write gate (R3/R6/R9/R10)',
    '  dev-shell "<shell-command>"     Pre-shell gate (gated patterns)',
    '  toolchain "<install-command>"   Pre-toolchain-install gate',
    '  role <role-name>                Pre-dispatch gate (R13 role sequence)',
    '  stop                            Pre-stop gate (turn-end check)',
    '',
    'Exit codes: 0 = allow / stop-ok, 1 = deny, 2 = followup (continue)',
  ];
  process.stderr.write(lines.join('\n') + '\n');
}

function runGate(scriptName, payload) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(HOOKS_DIR, scriptName)], {
      stdio: ['pipe', 'pipe', 'inherit'],
      cwd: PROJECT_ROOT,
    });
    let stdout = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.on('error', reject);
    child.on('close', () => resolve({ stdout: stdout.trim() }));
    child.stdin.end(JSON.stringify(payload));
  });
}

async function main() {
  const [gate, ...rest] = process.argv.slice(2);
  if (!gate) { usage(); process.exit(1); }

  let scriptName, payload;
  switch (gate) {
    case 'dev-write': {
      const filePath = rest[0];
      if (!filePath) { process.stderr.write('Error: filepath required\n'); process.exit(1); }
      scriptName = 'gate-dev-workflow.mjs';
      payload = { tool_input: { path: filePath } };
      break;
    }
    case 'dev-shell': {
      const command = rest.join(' ');
      if (!command) { process.stderr.write('Error: command required\n'); process.exit(1); }
      scriptName = 'gate-dev-shell.mjs';
      payload = { command };
      break;
    }
    case 'toolchain': {
      const command = rest.join(' ');
      if (!command) { process.stderr.write('Error: command required\n'); process.exit(1); }
      scriptName = 'gate-toolchain-install.mjs';
      payload = { command };
      break;
    }
    case 'role': {
      const role = rest[0];
      if (!role) { process.stderr.write('Error: role-name required\n'); process.exit(1); }
      scriptName = 'gate-role-sequence.mjs';
      payload = { tool_input: { subagent_type: role } };
      break;
    }
    case 'stop': {
      scriptName = 'gate-stop-workflow.mjs';
      payload = {};
      break;
    }
    default:
      process.stderr.write(`Error: unknown gate "${gate}"\n`);
      usage();
      process.exit(1);
  }

  const { stdout } = await runGate(scriptName, payload);
  if (stdout) process.stdout.write(stdout + '\n');

  let result = {};
  try { result = JSON.parse(stdout); } catch { /* non-JSON, treat as allow */ }
  if (result.permission === 'deny') process.exit(1);
  if (result.followup_message) process.exit(2);
  process.exit(0);
}

main();
