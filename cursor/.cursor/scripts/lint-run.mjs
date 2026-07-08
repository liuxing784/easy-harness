#!/usr/bin/env node
/**
 * 编程规范（lint）门禁运行器。判据与产物的唯一权威定义见 AGENTS.md §8.2（R15）。
 *
 * 用法：
 *   node .cursor/scripts/lint-run.mjs            # 自动探测技术栈并运行 lint
 *
 * lint 命令解析优先级：harness.config.json → qa.commands.lint 覆盖 > 探测栈默认值。
 * 产物：test-results/qa/.lint-result.json（gatePassed 字段），由 workflow-gate-lib.mjs
 * 的 readLintResult() 读取，供 gate-stop-workflow / gate-role-sequence 机械判定。
 * gatePassed=true 仅当「有 lint 命令且退出码为 0」；无 lint 命令时 gatePassed=false。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { resolveLintCommand, computeLintGate } from './lint-run-lib.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../..');
const HARNESS_CONFIG = path.join(PROJECT_ROOT, '.cursor/harness.config.json');
const RESULT_DIR = path.join(PROJECT_ROOT, 'test-results/qa');
const RESULT_FILE = path.join(RESULT_DIR, '.lint-result.json');

// 与 qa-run.mjs 同口径的技术栈探测（按构建清单文件识别）
const STACK_DETECTORS = [
  { stack: 'node', manifest: 'package.json' },
  { stack: 'python', manifest: 'pyproject.toml' },
  { stack: 'python-requirements', manifest: 'requirements.txt' },
  { stack: 'go', manifest: 'go.mod' },
  { stack: 'rust', manifest: 'Cargo.toml' },
  { stack: 'java-maven', manifest: 'pom.xml' },
  { stack: 'java-gradle', manifest: 'build.gradle' },
  { stack: 'php', manifest: 'composer.json' },
  { stack: 'ruby', manifest: 'Gemfile' },
  { stack: 'dotnet', manifest: '*.sln' },
];

function manifestExists(pattern) {
  if (!pattern.includes('*')) {
    return fs.existsSync(path.join(PROJECT_ROOT, pattern));
  }
  const re = new RegExp(`^${pattern.replace(/\./g, '\\.').replace(/\*/g, '.*')}$`, 'i');
  try {
    return fs.readdirSync(PROJECT_ROOT).some((f) => re.test(f));
  } catch {
    return false;
  }
}

function detectStack() {
  for (const detector of STACK_DETECTORS) {
    if (manifestExists(detector.manifest)) return detector.stack;
  }
  return null;
}

function loadLintOverride() {
  if (!fs.existsSync(HARNESS_CONFIG)) return null;
  try {
    const config = JSON.parse(fs.readFileSync(HARNESS_CONFIG, 'utf8'));
    const lint = config.qa?.commands?.lint;
    return typeof lint === 'string' ? lint : null;
  } catch {
    return null;
  }
}

function truncate(text, max = 4000) {
  if (!text) return '';
  return text.length > max ? `${text.slice(0, max)}\n…(truncated)` : text;
}

function runLint(command) {
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

function writeResult(result) {
  fs.mkdirSync(RESULT_DIR, { recursive: true });
  fs.writeFileSync(RESULT_FILE, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
}

function main() {
  const stack = detectStack();
  const override = loadLintOverride();
  const command = resolveLintCommand({ stack, override });

  let exitCode = null;
  let output = '';
  if (command) {
    const run = runLint(command);
    exitCode = run.exitCode;
    output = run.output;
  }

  const gate = computeLintGate({ command, exitCode });
  const result = {
    ...gate,
    stack: stack ?? 'unknown',
    command,
    exitCode,
    output: truncate(output),
    executedAt: new Date().toISOString(),
  };

  writeResult(result);
  console.log(JSON.stringify({ ...result, output: undefined }, null, 2));
  process.exit(result.gatePassed ? 0 : 1);
}

main();
