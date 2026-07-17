#!/usr/bin/env node
/**
 * 跨技术栈 QE 命令运行器——Windows 退出码不可靠时的留痕手段。
 * 按 harness.config.json → qe.commands 覆盖，或按项目根目录构建清单文件自动探测技术栈，
 * 运行 test/lint/audit 命令，将退出码与结果摘要落盘到 test-results/qe/qe-run-result.json。
 *
 * 用法：
 *   node .cursor/scripts/qe-run.mjs                 # 运行 test + lint + audit
 *   node .cursor/scripts/qe-run.mjs --only=test,audit
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../..');
const HARNESS_CONFIG = path.join(PROJECT_ROOT, '.cursor/harness.config.json');
const RESULT_DIR = path.join(PROJECT_ROOT, 'test-results/qe');

const STACK_DETECTORS = [
  {
    stack: 'node',
    manifest: 'package.json',
    commands: { test: 'npm test', lint: 'npm run lint', audit: 'npm audit' },
  },
  {
    stack: 'python',
    manifest: 'pyproject.toml',
    commands: { test: 'pytest', lint: 'ruff check .', audit: 'pip-audit' },
  },
  {
    stack: 'python-requirements',
    manifest: 'requirements.txt',
    commands: { test: 'pytest', lint: 'ruff check .', audit: 'pip-audit' },
  },
  {
    stack: 'go',
    manifest: 'go.mod',
    commands: { test: 'go test ./...', lint: 'go vet ./...', audit: 'govulncheck ./...' },
  },
  {
    stack: 'rust',
    manifest: 'Cargo.toml',
    commands: { test: 'cargo test', lint: 'cargo clippy', audit: 'cargo audit' },
  },
  {
    stack: 'java-maven',
    manifest: 'pom.xml',
    commands: {
      test: 'mvn test',
      lint: '',
      audit: 'mvn org.owasp:dependency-check-maven:check',
    },
  },
  {
    stack: 'java-gradle',
    manifest: 'build.gradle',
    commands: { test: 'gradle test', lint: '', audit: 'gradle dependencyCheckAnalyze' },
  },
  {
    stack: 'php',
    manifest: 'composer.json',
    commands: { test: 'composer test', lint: '', audit: 'composer audit' },
  },
  {
    stack: 'ruby',
    manifest: 'Gemfile',
    commands: { test: 'bundle exec rspec', lint: 'rubocop', audit: 'bundle audit' },
  },
  {
    stack: 'dotnet',
    manifest: '*.sln',
    commands: { test: 'dotnet test', lint: '', audit: 'dotnet list package --vulnerable' },
  },
];

function parseArgs(argv) {
  const result = {};
  for (const arg of argv) {
    const m = arg.match(/^--([a-zA-Z0-9_-]+)=(.*)$/);
    if (m) result[m[1]] = m[2];
  }
  return result;
}

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
    if (manifestExists(detector.manifest)) return detector;
  }
  return null;
}

function loadConfigOverrides() {
  if (!fs.existsSync(HARNESS_CONFIG)) return {};
  try {
    const config = JSON.parse(fs.readFileSync(HARNESS_CONFIG, 'utf8'));
    return config.qe?.commands ?? {};
  } catch {
    return {};
  }
}

function runCommand(name, command) {
  if (!command) {
    return { command: null, exitCode: null, skipped: true, reason: '未配置该命令' };
  }
  try {
    const stdout = execSync(command, {
      cwd: PROJECT_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { command, exitCode: 0, output: truncate(stdout) };
  } catch (err) {
    return {
      command,
      exitCode: typeof err.status === 'number' ? err.status : 1,
      output: truncate(`${err.stdout ?? ''}\n${err.stderr ?? ''}`),
    };
  }
}

function truncate(text, max = 4000) {
  if (!text) return '';
  return text.length > max ? `${text.slice(0, max)}\n…(truncated)` : text;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const only = args.only ? args.only.split(',').map((s) => s.trim()) : ['test', 'lint', 'audit'];

  const detected = detectStack();
  const overrides = loadConfigOverrides();
  const baseCommands = detected?.commands ?? {};
  const commands = { ...baseCommands, ...overrides };

  const results = {};
  let hasFailure = false;

  for (const key of only) {
    const cmd = commands[key];
    const result = runCommand(key, cmd);
    results[key] = result;
    if (!result.skipped && result.exitCode !== 0) hasFailure = true;
  }

  const finalResult = {
    detectedStack: detected?.stack ?? 'unknown',
    commands: results,
    executedAt: new Date().toISOString(),
  };

  fs.mkdirSync(RESULT_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(RESULT_DIR, 'qe-run-result.json'),
    `${JSON.stringify(finalResult, null, 2)}\n`,
    'utf8',
  );

  console.log(JSON.stringify(finalResult, null, 2));
  process.exit(hasFailure ? 1 : 0);
}

main();
