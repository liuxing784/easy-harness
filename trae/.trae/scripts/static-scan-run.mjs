#!/usr/bin/env node
/**
 * 静态代码质量门禁运行器（R16：重复代码 DRY + 安全静态扫描）。判据与产物的唯一权威
 * 定义见 AGENTS.md §8.2（R16）。
 *
 * 用法：
 *   node .trae/scripts/static-scan-run.mjs   # 依次运行重复代码检测与安全静态扫描
 *
 * 命令解析优先级：harness.config.json → qa.commands.dupCheck / qa.commands.securityScan
 * 覆盖 > 通用默认值（jscpd-rs / gitleaks-secret-scanner，经 npx 获取）。两项工具跨技术栈
 * 通用，不需要像 lint-run.mjs 那样按技术栈探测命令。
 * 产物：test-results/qa/.static-scan-result.json（gatePassed 字段），由 workflow-gate-lib.mjs
 * 的 readStaticScanResult() 读取，供 gate-stop-workflow / gate-role-sequence 机械判定。
 * gatePassed = duplication.gatePassed && security.gatePassed；任一无命令或退出码非 0 即为 false。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import {
  resolveDupCommand,
  resolveSecurityCommand,
  computeSubGate,
  computeStaticScanGate,
} from './static-scan-run-lib.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../..');
const HARNESS_CONFIG = path.join(PROJECT_ROOT, '.trae/harness.config.json');
const RESULT_DIR = path.join(PROJECT_ROOT, 'test-results/qa');
const RESULT_FILE = path.join(RESULT_DIR, '.static-scan-result.json');

function loadOverride(key) {
  if (!fs.existsSync(HARNESS_CONFIG)) return undefined;
  try {
    const config = JSON.parse(fs.readFileSync(HARNESS_CONFIG, 'utf8'));
    const value = config.qa?.commands?.[key];
    return typeof value === 'string' ? value : undefined;
  } catch {
    return undefined;
  }
}

function truncate(text, max = 4000) {
  if (!text) return '';
  return text.length > max ? `${text.slice(0, max)}\n…(truncated)` : text;
}

function runCommand(command) {
  try {
    const stdout = execSync(command, {
      cwd: PROJECT_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { exitCode: 0, output: truncate(stdout) };
  } catch (err) {
    return {
      exitCode: typeof err.status === 'number' ? err.status : 1,
      output: truncate(`${err.stdout ?? ''}\n${err.stderr ?? ''}`),
    };
  }
}

function runCheck(resolveCommand, overrideKey) {
  const override = loadOverride(overrideKey);
  const command = resolveCommand({ override });
  if (!command) {
    return { command: null, exitCode: null, output: '', ...computeSubGate({ command: null, exitCode: null }) };
  }
  const run = runCommand(command);
  return {
    command,
    exitCode: run.exitCode,
    output: run.output,
    ...computeSubGate({ command, exitCode: run.exitCode }),
  };
}

function writeResult(result) {
  fs.mkdirSync(RESULT_DIR, { recursive: true });
  fs.writeFileSync(RESULT_FILE, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
}

function main() {
  const duplication = runCheck(resolveDupCommand, 'dupCheck');
  const security = runCheck(resolveSecurityCommand, 'securityScan');

  const gate = computeStaticScanGate({ duplication, security });
  const result = {
    ...gate,
    duplication,
    security,
    executedAt: new Date().toISOString(),
  };

  writeResult(result);
  console.log(
    JSON.stringify(
      {
        ...result,
        duplication: { ...result.duplication, output: undefined },
        security: { ...result.security, output: undefined },
      },
      null,
      2,
    ),
  );
  process.exit(result.gatePassed ? 0 : 1);
}

main();
