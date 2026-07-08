#!/usr/bin/env node
/**
 * 场景级门禁回归测试（框架维护用，不参与宿主项目开发）。
 *
 * 由 `eval/` 下的一次性评估探针（run-gate.mjs / e2e-compute.mjs / probe-blocking.mjs）
 * 沉淀而来，转为可重复运行的常驻回归套件：
 *   - 与 `gate-selftest.mjs`（库函数单元级回归）互补，本套件是**端到端**回归——
 *     真正 spawn 框架自己的 5 个 Hook 入口脚本
 *     （gate-role-sequence / gate-dev-workflow / gate-dev-shell /
 *      gate-toolchain-install / gate-stop-workflow），读取其 allow/deny/ask/followup。
 *   - E2E 门禁结果用框架自己的 `e2e-run-lib.mjs`（parseChromiumResults + computeGateResult）
 *     真实计算后写入 `test-results/e2e/`（运行前快照、运行后还原，避免污染宿主运行时产物）。
 *   - 全程使用**隔离 fixture**（写在 `test-results/.gate-scenarios/` 下，经 HARNESS_PROCESS_PATH /
 *     HARNESS_GATED_ARTIFACTS_PATH 指向），不依赖、不改动宿主项目的 `docs/` 成果物。
 *
 * 覆盖场景矩阵：Greenfield(full) / Feature(full) / Hotfix(R11 折叠) / R15 编程规范 lint 门禁 /
 * R16 静态代码质量门禁（重复代码+安全扫描）/ 对抗健壮性 / Finding #1（出厂模板阻塞误判）端到端回归。
 *
 * 用法：
 *   node .cursor/scripts/gate-scenarios.mjs           # 运行全部场景
 *   node .cursor/scripts/gate-scenarios.mjs --verbose # 附带打印每步 deny/ask/followup 首行原因
 * 退出码非 0 即有场景回归失败，供修改 Hook/脚本/模板后回归验证。
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseChromiumResults, computeGateResult } from './e2e-run-lib.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../..');
const HOOKS_DIR = path.join(PROJECT_ROOT, '.cursor/hooks');
const SCEN_REL = 'test-results/.gate-scenarios';
const SCEN_ROOT = path.join(PROJECT_ROOT, SCEN_REL);
const E2E_DIR = path.join(PROJECT_ROOT, 'test-results/e2e');
const VERBOSE = process.argv.includes('--verbose');

const HOOK_FILES = {
  role: path.join(HOOKS_DIR, 'gate-role-sequence.mjs'),
  write: path.join(HOOKS_DIR, 'gate-dev-workflow.mjs'),
  shell: path.join(HOOKS_DIR, 'gate-dev-shell.mjs'),
  toolchain: path.join(HOOKS_DIR, 'gate-toolchain-install.mjs'),
  stop: path.join(HOOKS_DIR, 'gate-stop-workflow.mjs'),
};

let passCount = 0;
let failCount = 0;
const failures = [];

// ---------------------------------------------------------------------------
// 通用内容块
// ---------------------------------------------------------------------------
const CONFIRM_SECTION = [
  '## 用户确认记录',
  '',
  '| 确认项 | 时间 | 用户原话摘要 |',
  '| ------ | ---- | ------------ |',
  '| 需求摘要 | 2026-01-01 | 已确认 |',
].join('\n');

const DISPATCH_SECTION = [
  '## 当前分派计划',
  '',
  '| 任务包编号 | 分派角色 | 并行/串行 | 状态 |',
  '| ---------- | -------- | --------- | ---- |',
  '| T0-1 | development-engineer | 串行 | 待开发 |',
  '',
  '## 待派发角色列表',
  '',
  '| 角色 | 说明 |',
  '| ---- | ---- |',
  '| development-engineer | T0-1 |',
].join('\n');

const EMPTY_DISPATCH_SECTION = [
  '## 当前分派计划',
  '',
  '| 任务包编号 | 分派角色 | 并行/串行 | 状态 |',
  '| ---------- | -------- | --------- | ---- |',
  '',
  '## 待派发角色列表',
  '',
  '| 角色 | 说明 |',
  '| ---- | ---- |',
].join('\n');

const ARTIFACT_REF =
  '本次已产出 requirement-spec.md、requirement-list.md、detail-design-spec.md、develop-task-list.md。';
const BLOCK_OK = ['## 阻塞原因', '', '无'].join('\n');

const REQ_SPEC = '# requirement-spec.md\n';
const REQ_LIST =
  '# requirement-list.md\n\n| 需求编号 | 名称 | 描述 | 模块 | 优先级 |\n| --- | --- | --- | --- | --- |\n| R-001 | 待办新增 | 新增待办项 | core | P0 |\n';
const DESIGN_SPEC = '# detail-design-spec.md\n';
const TASK_LIST = '# develop-task-list.md\n';
const DPL_CLEAN =
  '# 设计问题清单\n\n| 检查维度 | 问题描述 | 严重等级 | 是否存在 | 是否解决 | 关联成果物 |\n| --- | --- | --- | --- | --- | --- |\n| 功能 | 无 | 低 | 否 | | |\n';
const DPL_UNRESOLVED =
  '# 设计问题清单\n\n| 检查维度 | 问题描述 | 严重等级 | 是否存在 | 是否解决 | 关联成果物 |\n| --- | --- | --- | --- | --- | --- |\n| 功能 | 边界未定义 | 高 | 是 | 否 | detail-design-spec.md |\n';
const GATED_EMPTY = '{}\n';
// R14：含非空「## 接口测试报告」章节的批次测试报告
const TEST_REPORT_API = [
  '# 测试报告',
  '',
  '## 接口测试报告',
  '',
  '| 接口 | 请求方法 | 关联需求 | 关联任务包 | 是否通过 |',
  '| ---- | -------- | -------- | ---------- | -------- |',
  '| /api/todos | POST | R-001 | T0-1 | 是 |',
  '',
].join('\n');

function progressSection(rows = []) {
  return [
    '## 进度列表',
    '',
    '| 角色/开发线 | 任务名称 | 状态 | 说明 |',
    '| ----------- | -------- | ---- | ---- |',
    ...rows,
    '',
  ].join('\n');
}

function greenfieldReady(progressRows = []) {
  return [
    '---',
    'phase: development',
    'workflow_mode: full',
    'iterationType: greenfield',
    'blocking: false',
    'cancelled: false',
    '---',
    '',
    '# 流程进度记录',
    '',
    ARTIFACT_REF,
    '',
    CONFIRM_SECTION,
    '',
    DISPATCH_SECTION,
    '',
    progressSection(progressRows),
    '',
    BLOCK_OK,
    '',
  ].join('\n');
}

// R14：含接口测试豁免确认行的用户确认记录 + 无对外接口的 gated-artifacts 声明
const API_EXEMPT_CONFIRM = [
  '## 用户确认记录',
  '',
  '| 确认项 | 时间 | 用户原话摘要 |',
  '| ------ | ---- | ------------ |',
  '| 需求摘要 | 2026-01-01 | 已确认 |',
  '| 接口测试豁免 | 2026-01-01 | 纯算法库无对外接口，确认豁免接口测试 |',
].join('\n');
const API_NA_GATED = '{\n  "apiTestApplicability": "n/a",\n  "apiTestApplicabilityReason": "纯算法库无对外接口"\n}\n';

function greenfieldApiExempt(progressRows = []) {
  return [
    '---',
    'phase: development',
    'workflow_mode: full',
    'iterationType: greenfield',
    'blocking: false',
    'cancelled: false',
    '---',
    '',
    '# 流程进度记录',
    '',
    ARTIFACT_REF,
    '',
    API_EXEMPT_CONFIRM,
    '',
    DISPATCH_SECTION,
    '',
    progressSection(progressRows),
    '',
    BLOCK_OK,
    '',
  ].join('\n');
}

function greenfieldNoDispatch() {
  return [
    '---',
    'phase: development',
    'workflow_mode: full',
    'iterationType: greenfield',
    'blocking: false',
    'cancelled: false',
    '---',
    '',
    '# 流程进度记录',
    '',
    ARTIFACT_REF,
    '',
    CONFIRM_SECTION,
    '',
    EMPTY_DISPATCH_SECTION,
    '',
    progressSection(),
    '',
    BLOCK_OK,
    '',
  ].join('\n');
}

function greenfieldEmpty() {
  return [
    '---',
    'phase: requirement',
    'workflow_mode: full',
    'iterationType: greenfield',
    'blocking: false',
    'cancelled: false',
    '---',
    '',
    '# 流程进度记录',
    '',
    '## 用户确认记录',
    '',
    '| 确认项 | 时间 | 用户原话摘要 |',
    '| ------ | ---- | ------------ |',
    '',
    EMPTY_DISPATCH_SECTION,
    '',
    BLOCK_OK,
    '',
  ].join('\n');
}

function featureReady(progressRows = []) {
  return [
    '---',
    'phase: development',
    'workflow_mode: full',
    'iterationType: feature',
    'blocking: false',
    'cancelled: false',
    '---',
    '',
    '# 流程进度记录（filter feature）',
    '',
    ARTIFACT_REF,
    '',
    CONFIRM_SECTION,
    '',
    DISPATCH_SECTION,
    '',
    progressSection(progressRows),
    '',
    BLOCK_OK,
    '',
  ].join('\n');
}

function hotfixProcess({ dispatch = true, progressRows = [] } = {}) {
  return [
    '---',
    'phase: development',
    'workflow_mode: hotfix',
    'iterationType: hotfix',
    'blocking: false',
    'cancelled: false',
    '---',
    '',
    '# 流程进度记录（hotfix）',
    '',
    CONFIRM_SECTION,
    '',
    dispatch ? DISPATCH_SECTION : EMPTY_DISPATCH_SECTION,
    '',
    progressSection(progressRows),
    '',
    BLOCK_OK,
    '',
  ].join('\n');
}

function docsOnlyProcess() {
  return [
    '---',
    'phase: development',
    'workflow_mode: docs-only',
    'blocking: false',
    'cancelled: false',
    '---',
    '',
    '# 流程进度记录（docs-only）',
    '',
    CONFIRM_SECTION,
    '',
    BLOCK_OK,
    '',
  ].join('\n');
}

function cancelledProcess() {
  return [
    '---',
    'phase: development',
    'workflow_mode: full',
    'iterationType: greenfield',
    'blocking: false',
    'cancelled: true',
    'cancelledAt: 2026-01-01T00:00:00Z',
    'cancelReason: 用户取消',
    '---',
    '',
    '# 流程进度记录（已取消）',
    '',
    CONFIRM_SECTION,
    '',
    DISPATCH_SECTION,
    '',
    progressSection(['| 开发工程师 | T0-1 | 正在执行 | |']),
    '',
    BLOCK_OK,
    '',
    '## 取消记录',
    '',
    '| 时间 | 触发原话摘要 | 二次确认摘要 |',
    '| ---- | ------------ | ------------ |',
    '| 2026-01-01 | 停止此流程 | 已二次确认 |',
    '',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// fixture / hook 驱动
// ---------------------------------------------------------------------------
function relToProject(abs) {
  return path.relative(PROJECT_ROOT, abs).replace(/\\/g, '/');
}

/** 写入一组 fixture 文件，返回该 fixture 根目录绝对路径 */
function writeFixture(name, files) {
  const root = path.join(SCEN_ROOT, name);
  fs.rmSync(root, { recursive: true, force: true });
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, 'utf8');
  }
  return root;
}

function buildPayload(hook, { role, filePath, command }) {
  if (hook === 'role') return { tool_name: 'Task', tool_input: { subagent_type: role } };
  if (hook === 'write') return { tool_name: 'Write', tool_input: { path: filePath } };
  if (hook === 'shell' || hook === 'toolchain') return { command, tool_input: { command } };
  return {};
}

function runHook({ hook, role, filePath, command, processPath, gatedPath }) {
  const env = { ...process.env };
  delete env.HARNESS_PROCESS_PATH;
  delete env.HARNESS_GATED_ARTIFACTS_PATH;
  if (processPath) env.HARNESS_PROCESS_PATH = processPath;
  if (gatedPath) env.HARNESS_GATED_ARTIFACTS_PATH = gatedPath;

  const res = spawnSync('node', [HOOK_FILES[hook]], {
    cwd: PROJECT_ROOT,
    input: JSON.stringify(buildPayload(hook, { role, filePath, command })),
    encoding: 'utf8',
    env,
  });

  let verdict;
  try {
    verdict = JSON.parse((res.stdout || '').trim() || '{}');
  } catch {
    verdict = { _raw: res.stdout };
  }

  let outcome;
  if (hook === 'stop') outcome = verdict.followup_message ? 'followup' : 'allow-stop';
  else outcome = verdict.permission ?? 'unknown';

  return { outcome, verdict, stderr: res.stderr };
}

function check(label, expect, opts) {
  const { outcome, verdict } = runHook(opts);
  const ok = outcome === expect;
  if (ok) {
    passCount += 1;
    console.log(`  PASS  expect=${expect} got=${outcome} :: ${label}`);
  } else {
    failCount += 1;
    failures.push({ label, expect, outcome });
    console.error(`  FAIL  expect=${expect} got=${outcome} :: ${label}`);
  }
  if (VERBOSE) {
    const detail = verdict.user_message || verdict.followup_message;
    if (detail) console.log(`          ↳ ${String(detail).split('\n')[0].slice(0, 160)}`);
  }
}

// ---------------------------------------------------------------------------
// E2E 结果产物（快照 / 计算 / 还原）
// ---------------------------------------------------------------------------
const E2E_FILES = {
  batch: path.join(E2E_DIR, '.e2e-batch-result.json'),
  final: path.join(E2E_DIR, '.e2e-final-result.json'),
};
const e2eSnapshot = {};

function snapshotE2e() {
  for (const [scope, file] of Object.entries(E2E_FILES)) {
    e2eSnapshot[scope] = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  }
}

function restoreE2e() {
  for (const [scope, file] of Object.entries(E2E_FILES)) {
    const snap = e2eSnapshot[scope];
    if (snap === null) fs.rmSync(file, { force: true });
    else fs.writeFileSync(file, snap, 'utf8');
  }
}

// R15：编程规范（lint）门禁机读产物（test-results/qa/.lint-result.json）——
// 与 E2E 产物同为受控运行产物，快照/还原避免污染宿主运行时。
const LINT_FILE = path.join(PROJECT_ROOT, 'test-results/qa/.lint-result.json');
let lintSnapshot = null;

function snapshotLint() {
  lintSnapshot = fs.existsSync(LINT_FILE) ? fs.readFileSync(LINT_FILE, 'utf8') : null;
}

function restoreLint() {
  if (lintSnapshot === null) fs.rmSync(LINT_FILE, { force: true });
  else fs.writeFileSync(LINT_FILE, lintSnapshot, 'utf8');
}

function writeLintPass() {
  fs.mkdirSync(path.dirname(LINT_FILE), { recursive: true });
  const result = {
    gatePassed: true,
    reason: 'passed',
    stack: 'node',
    command: 'npm run lint',
    exitCode: 0,
    executedAt: new Date().toISOString(),
    _note: 'Synthesized by gate-scenarios.mjs for regression only.',
  };
  fs.writeFileSync(LINT_FILE, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
}

function writeLintFail() {
  fs.mkdirSync(path.dirname(LINT_FILE), { recursive: true });
  const result = {
    gatePassed: false,
    reason: 'lint-failed',
    stack: 'node',
    command: 'npm run lint',
    exitCode: 1,
    executedAt: new Date().toISOString(),
    _note: 'Synthesized by gate-scenarios.mjs for regression only.',
  };
  fs.writeFileSync(LINT_FILE, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
}

function clearLint() {
  fs.rmSync(LINT_FILE, { force: true });
}

// R16：静态代码质量门禁机读产物（test-results/qa/.static-scan-result.json）——
// 与 lint 产物同为受控运行产物，快照/还原避免污染宿主运行时。
const STATIC_SCAN_FILE = path.join(PROJECT_ROOT, 'test-results/qa/.static-scan-result.json');
let staticScanSnapshot = null;

function snapshotStaticScan() {
  staticScanSnapshot = fs.existsSync(STATIC_SCAN_FILE) ? fs.readFileSync(STATIC_SCAN_FILE, 'utf8') : null;
}

function restoreStaticScan() {
  if (staticScanSnapshot === null) fs.rmSync(STATIC_SCAN_FILE, { force: true });
  else fs.writeFileSync(STATIC_SCAN_FILE, staticScanSnapshot, 'utf8');
}

function writeStaticScanResult(result) {
  fs.mkdirSync(path.dirname(STATIC_SCAN_FILE), { recursive: true });
  fs.writeFileSync(STATIC_SCAN_FILE, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
}

function writeStaticScanPass() {
  writeStaticScanResult({
    gatePassed: true,
    duplication: { gatePassed: true, reason: 'passed', command: 'jscpd-rs .', exitCode: 0 },
    security: { gatePassed: true, reason: 'passed', command: 'gitleaks-secret-scanner', exitCode: 0 },
    executedAt: new Date().toISOString(),
    _note: 'Synthesized by gate-scenarios.mjs for regression only.',
  });
}

function writeStaticScanDupFail() {
  writeStaticScanResult({
    gatePassed: false,
    duplication: { gatePassed: false, reason: 'scan-failed', command: 'jscpd-rs .', exitCode: 1 },
    security: { gatePassed: true, reason: 'passed', command: 'gitleaks-secret-scanner', exitCode: 0 },
    executedAt: new Date().toISOString(),
    _note: 'Synthesized by gate-scenarios.mjs for regression only.',
  });
}

function writeStaticScanSecurityFail() {
  writeStaticScanResult({
    gatePassed: false,
    duplication: { gatePassed: true, reason: 'passed', command: 'jscpd-rs .', exitCode: 0 },
    security: { gatePassed: false, reason: 'scan-failed', command: 'gitleaks-secret-scanner', exitCode: 1 },
    executedAt: new Date().toISOString(),
    _note: 'Synthesized by gate-scenarios.mjs for regression only.',
  });
}

function clearStaticScan() {
  fs.rmSync(STATIC_SCAN_FILE, { force: true });
}

function specFor(id, status) {
  return { title: `[${id}] e2e`, tests: [{ projectName: 'chromium', results: [{ status }] }] };
}

function writeE2e(scope, { requiredIds, passed = [], failed = [], skipped = [] }) {
  const report = {
    suites: [
      {
        file: 'e2e/specs/scenario.spec.js',
        specs: [
          ...passed.map((id) => specFor(id, 'passed')),
          ...failed.map((id) => specFor(id, 'failed')),
          ...skipped.map((id) => specFor(id, 'skipped')),
        ],
      },
    ],
  };
  const gate = computeGateResult(parseChromiumResults(report), requiredIds, new Set());
  const result = {
    scope,
    ...gate,
    requiredIds,
    waivedIds: [],
    playwrightExitCode: gate.allPassed ? 0 : 1,
    executedAt: new Date().toISOString(),
    _note: 'Synthesized by gate-scenarios.mjs via real e2e-run-lib for regression only.',
  };
  fs.mkdirSync(E2E_DIR, { recursive: true });
  fs.writeFileSync(E2E_FILES[scope], `${JSON.stringify(result, null, 2)}\n`, 'utf8');
}

function clearE2e(scope) {
  fs.rmSync(E2E_FILES[scope], { force: true });
}

// ---------------------------------------------------------------------------
// 场景
// ---------------------------------------------------------------------------
function greenfieldScenarios() {
  console.log('== 场景 1：首次开发 Greenfield（full）==');

  const empty = writeFixture('gf-empty', {
    'docs/process/process.md': greenfieldEmpty(),
    'docs/design/gated-artifacts.json': GATED_EMPTY,
  });
  check('G1 需求未就绪时发起 system-architect', 'deny', {
    hook: 'role',
    role: 'system-architect',
    processPath: relToProject(path.join(empty, 'docs/process/process.md')),
    gatedPath: relToProject(path.join(empty, 'docs/design/gated-artifacts.json')),
  });

  const ready = writeFixture('gf-ready', {
    'docs/process/process.md': greenfieldReady(),
    'docs/requirement/requirement-spec.md': REQ_SPEC,
    'docs/requirement/requirement-list.md': REQ_LIST,
    'docs/design/detail-design-spec.md': DESIGN_SPEC,
    'docs/design/develop-task-list.md': TASK_LIST,
    'docs/design/design-problem-list.md': DPL_CLEAN,
    'docs/design/gated-artifacts.json': GATED_EMPTY,
  });
  const readyProc = relToProject(path.join(ready, 'docs/process/process.md'));
  const readyGated = relToProject(path.join(ready, 'docs/design/gated-artifacts.json'));

  check('G2 需求就绪 + 用户确认后发起 system-architect', 'allow', {
    hook: 'role', role: 'system-architect', processPath: readyProc, gatedPath: readyGated,
  });

  const badDesign = writeFixture('gf-baddesign', {
    'docs/process/process.md': greenfieldReady(),
    'docs/requirement/requirement-spec.md': REQ_SPEC,
    'docs/requirement/requirement-list.md': REQ_LIST,
    'docs/design/detail-design-spec.md': DESIGN_SPEC,
    'docs/design/develop-task-list.md': TASK_LIST,
    'docs/design/design-problem-list.md': DPL_UNRESOLVED,
    'docs/design/gated-artifacts.json': GATED_EMPTY,
  });
  check('G3 设计存在未解决问题时发起 development-engineer', 'deny', {
    hook: 'role',
    role: 'development-engineer',
    processPath: relToProject(path.join(badDesign, 'docs/process/process.md')),
    gatedPath: relToProject(path.join(badDesign, 'docs/design/gated-artifacts.json')),
  });

  const noDispatch = writeFixture('gf-nodispatch', {
    'docs/process/process.md': greenfieldNoDispatch(),
    'docs/requirement/requirement-spec.md': REQ_SPEC,
    'docs/requirement/requirement-list.md': REQ_LIST,
    'docs/design/detail-design-spec.md': DESIGN_SPEC,
    'docs/design/develop-task-list.md': TASK_LIST,
    'docs/design/design-problem-list.md': DPL_CLEAN,
    'docs/design/gated-artifacts.json': GATED_EMPTY,
  });
  const noDispatchProc = relToProject(path.join(noDispatch, 'docs/process/process.md'));
  const noDispatchGated = relToProject(path.join(noDispatch, 'docs/design/gated-artifacts.json'));

  check('G4 无分派计划写源码', 'deny', {
    hook: 'write', filePath: 'src/app.ts', processPath: noDispatchProc, gatedPath: noDispatchGated,
  });
  check('G5 有分派计划 + 设计审核通过写源码', 'allow', {
    hook: 'write', filePath: 'src/app.ts', processPath: readyProc, gatedPath: readyGated,
  });
  check('G6 设计审核通过 + 有效分派计划发起 development-engineer', 'allow', {
    hook: 'role', role: 'development-engineer', processPath: readyProc, gatedPath: readyGated,
  });
  check('G7 开发未开始发起 quality-assurance-engineer', 'deny', {
    hook: 'role', role: 'quality-assurance-engineer', processPath: readyProc, gatedPath: readyGated,
  });
  check('G8 QA 未过发起 test-engineer', 'deny', {
    hook: 'role', role: 'test-engineer', processPath: readyProc, gatedPath: readyGated,
  });

  const stopDev = writeFixture('gf-stop-dev', {
    'docs/process/process.md': greenfieldReady(['| 开发工程师 | T0-1 | 正在执行 | |']),
    'docs/requirement/requirement-spec.md': REQ_SPEC,
    'docs/requirement/requirement-list.md': REQ_LIST,
    'docs/design/detail-design-spec.md': DESIGN_SPEC,
    'docs/design/develop-task-list.md': TASK_LIST,
    'docs/design/design-problem-list.md': DPL_CLEAN,
  });
  clearE2e('batch');
  clearE2e('final');
  check('G9 开发「正在执行」就想收尾', 'followup', {
    hook: 'stop', processPath: relToProject(path.join(stopDev, 'docs/process/process.md')),
  });

  const stopBatchFail = writeFixture('gf-stop-batchfail', {
    'docs/process/process.md': greenfieldReady([
      '| 开发工程师 | T0-1 | 执行完成 | |',
      '| 质量保障工程师 | T0-1 | 执行完成 | |',
      '| 测试工程师 | 批次集成测试 T0-1 | 执行完成 | |',
    ]),
    'docs/requirement/requirement-spec.md': REQ_SPEC,
    'docs/requirement/requirement-list.md': REQ_LIST,
    'docs/design/detail-design-spec.md': DESIGN_SPEC,
    'docs/design/develop-task-list.md': TASK_LIST,
    'docs/design/design-problem-list.md': DPL_CLEAN,
  });
  writeE2e('batch', { requiredIds: ['R-001'], failed: ['R-001'] });
  clearE2e('final');
  writeLintPass();
  writeStaticScanPass();
  check('G10 批次 E2E 失败就想推进/收尾', 'followup', {
    hook: 'stop', processPath: relToProject(path.join(stopBatchFail, 'docs/process/process.md')),
  });

  const stopBatchNoApi = writeFixture('gf-stop-batch-noapi', {
    'docs/process/process.md': greenfieldReady([
      '| 开发工程师 | T0-1 | 执行完成 | |',
      '| 质量保障工程师 | T0-1 | 执行完成 | |',
      '| 测试工程师 | 批次集成测试 T0-1 | 执行完成 | |',
    ]),
    'docs/requirement/requirement-spec.md': REQ_SPEC,
    'docs/requirement/requirement-list.md': REQ_LIST,
    'docs/design/detail-design-spec.md': DESIGN_SPEC,
    'docs/design/develop-task-list.md': TASK_LIST,
    'docs/design/design-problem-list.md': DPL_CLEAN,
  });
  writeE2e('batch', { requiredIds: ['R-001'], passed: ['R-001'] });
  clearE2e('final');
  writeLintPass();
  writeStaticScanPass();
  check('G10b R14：批次 E2E 过但缺接口测试报告章节', 'followup', {
    hook: 'stop', processPath: relToProject(path.join(stopBatchNoApi, 'docs/process/process.md')),
  });

  const stopFinal = writeFixture('gf-stop-final', {
    'docs/process/process.md': greenfieldReady([
      '| 开发工程师 | T0-1 | 执行完成 | |',
      '| 质量保障工程师 | T0-1 | 执行完成 | |',
      '| 测试工程师 | 批次集成测试 T0-1 | 执行完成 | |',
      '| 测试工程师 | 最终整体集成测试 | 执行完成 | |',
    ]),
    'docs/requirement/requirement-spec.md': REQ_SPEC,
    'docs/requirement/requirement-list.md': REQ_LIST,
    'docs/design/detail-design-spec.md': DESIGN_SPEC,
    'docs/design/develop-task-list.md': TASK_LIST,
    'docs/design/design-problem-list.md': DPL_CLEAN,
    'docs/test/test-report.md': TEST_REPORT_API,
  });
  writeE2e('batch', { requiredIds: ['R-001'], passed: ['R-001'] });
  writeE2e('final', { requiredIds: ['R-001'], passed: ['R-001'] });
  writeLintPass();
  writeStaticScanPass();
  check('G11 最终 E2E 通过 + 批次接口测试报告齐备 + lint 通过 + 静态代码质量门禁通过后收尾（唯一放行点）', 'allow-stop', {
    hook: 'stop', processPath: relToProject(path.join(stopFinal, 'docs/process/process.md')),
  });
  clearE2e('batch');
  clearE2e('final');

  const stopApiNaOnly = writeFixture('gf-stop-apina-only', {
    'docs/process/process.md': greenfieldReady([
      '| 开发工程师 | T0-1 | 执行完成 | |',
      '| 质量保障工程师 | T0-1 | 执行完成 | |',
      '| 测试工程师 | 批次集成测试 T0-1 | 执行完成 | |',
    ]),
    'docs/requirement/requirement-spec.md': REQ_SPEC,
    'docs/requirement/requirement-list.md': REQ_LIST,
    'docs/design/detail-design-spec.md': DESIGN_SPEC,
    'docs/design/develop-task-list.md': TASK_LIST,
    'docs/design/design-problem-list.md': DPL_CLEAN,
    'docs/design/gated-artifacts.json': API_NA_GATED,
  });
  writeE2e('batch', { requiredIds: ['R-001'], passed: ['R-001'] });
  clearE2e('final');
  writeLintPass();
  writeStaticScanPass();
  check('G11b R14：仅声明 apiTestApplicability n/a 但无用户确认 → 不豁免', 'followup', {
    hook: 'stop',
    processPath: relToProject(path.join(stopApiNaOnly, 'docs/process/process.md')),
    gatedPath: relToProject(path.join(stopApiNaOnly, 'docs/design/gated-artifacts.json')),
  });

  const stopApiExempt = writeFixture('gf-stop-apiexempt', {
    'docs/process/process.md': greenfieldApiExempt([
      '| 开发工程师 | T0-1 | 执行完成 | |',
      '| 质量保障工程师 | T0-1 | 执行完成 | |',
      '| 测试工程师 | 批次集成测试 T0-1 | 执行完成 | |',
      '| 测试工程师 | 最终整体集成测试 | 执行完成 | |',
    ]),
    'docs/requirement/requirement-spec.md': REQ_SPEC,
    'docs/requirement/requirement-list.md': REQ_LIST,
    'docs/design/detail-design-spec.md': DESIGN_SPEC,
    'docs/design/develop-task-list.md': TASK_LIST,
    'docs/design/design-problem-list.md': DPL_CLEAN,
    'docs/design/gated-artifacts.json': API_NA_GATED,
  });
  writeE2e('batch', { requiredIds: ['R-001'], passed: ['R-001'] });
  writeE2e('final', { requiredIds: ['R-001'], passed: ['R-001'] });
  writeLintPass();
  writeStaticScanPass();
  check('G11c R14：无接口项目声明豁免 + 用户确认后无接口测试报告也可收尾', 'allow-stop', {
    hook: 'stop',
    processPath: relToProject(path.join(stopApiExempt, 'docs/process/process.md')),
    gatedPath: relToProject(path.join(stopApiExempt, 'docs/design/gated-artifacts.json')),
  });
  clearE2e('batch');
  clearE2e('final');
  clearLint();
  clearStaticScan();
}

function featureScenarios() {
  console.log('== 场景 2：功能迭代 Feature（full，独立子树）==');
  const root = writeFixture('feature', {
    'docs/filter/process/process.md': featureReady(),
    'docs/filter/requirement/requirement-spec.md': REQ_SPEC,
    'docs/filter/requirement/requirement-list.md': REQ_LIST,
    'docs/filter/design/detail-design-spec.md': DESIGN_SPEC,
    'docs/filter/design/develop-task-list.md': TASK_LIST,
    'docs/filter/design/design-problem-list.md': DPL_CLEAN,
    'docs/filter/design/gated-artifacts.json': GATED_EMPTY,
  });
  const proc = relToProject(path.join(root, 'docs/filter/process/process.md'));
  const gated = relToProject(path.join(root, 'docs/filter/design/gated-artifacts.json'));

  check('F1 feature 子树内有分派计划写源码', 'allow', {
    hook: 'write', filePath: 'src/filter.js', processPath: proc, gatedPath: gated,
  });
  check('F2 feature 子树设计审核通过发起 development-engineer', 'allow', {
    hook: 'role', role: 'development-engineer', processPath: proc, gatedPath: gated,
  });
}

function hotfixScenarios() {
  console.log('== 场景 3：Bug 修复 Hotfix（R9 设计前置 + R11 折叠）==');

  const noDesign = writeFixture('hotfix-nodesign', {
    'docs/process/process.md': hotfixProcess({ dispatch: true }),
    'docs/design/gated-artifacts.json': GATED_EMPTY,
  });
  const noDesignProc = relToProject(path.join(noDesign, 'docs/process/process.md'));
  const noDesignGated = relToProject(path.join(noDesign, 'docs/design/gated-artifacts.json'));
  check('H1 R9：无 detail-design-spec 时发起 development-engineer', 'deny', {
    hook: 'role', role: 'development-engineer', processPath: noDesignProc, gatedPath: noDesignGated,
  });
  check('H2 R9：无 detail-design-spec 时写源码', 'deny', {
    hook: 'write', filePath: 'src/fix.js', processPath: noDesignProc, gatedPath: noDesignGated,
  });

  const ready = writeFixture('hotfix-ready', {
    'docs/process/process.md': hotfixProcess({ dispatch: true }),
    'docs/design/detail-design-spec.md': DESIGN_SPEC,
    'docs/design/gated-artifacts.json': GATED_EMPTY,
  });
  check('H3 R9：补最小热修设计后发起 development-engineer', 'allow', {
    hook: 'role',
    role: 'development-engineer',
    processPath: relToProject(path.join(ready, 'docs/process/process.md')),
    gatedPath: relToProject(path.join(ready, 'docs/design/gated-artifacts.json')),
  });

  const stopNoTest = writeFixture('hotfix-stop-notest', {
    'docs/process/process.md': hotfixProcess({
      dispatch: true,
      progressRows: [
        '| 开发工程师 | T-1 | 执行完成 | |',
        '| 质量保障工程师 | T-1 | 执行完成 | |',
      ],
    }),
    'docs/design/detail-design-spec.md': DESIGN_SPEC,
  });
  clearE2e('batch');
  clearE2e('final');
  writeLintPass();
  writeStaticScanPass();
  check('H4 R11：QA 过但未做（唯一一次）集成测试即收尾', 'followup', {
    hook: 'stop', processPath: relToProject(path.join(stopNoTest, 'docs/process/process.md')),
  });

  const stopFinal = writeFixture('hotfix-stop-final', {
    'docs/process/process.md': hotfixProcess({
      dispatch: true,
      progressRows: [
        '| 开发工程师 | T-1 | 执行完成 | |',
        '| 质量保障工程师 | T-1 | 执行完成 | |',
        '| 测试工程师 | 最终集成测试 | 执行完成 | |',
      ],
    }),
    'docs/design/detail-design-spec.md': DESIGN_SPEC,
  });
  writeE2e('final', { requiredIds: ['R-001'], passed: ['R-001'] });
  writeLintPass();
  writeStaticScanPass();
  check('H5 R11：单次集成测试 + 最终 E2E 通过后收尾', 'allow-stop', {
    hook: 'stop', processPath: relToProject(path.join(stopFinal, 'docs/process/process.md')),
  });
  clearE2e('final');
  clearLint();
  clearStaticScan();
}

const QUALITY_REPORT_CLEAN = [
  '# 质量报告',
  '',
  '## 审查结论',
  '',
  '| 检查维度 | 要点 | 是否存在问题 | 严重等级 | 是否解决 | 说明 |',
  '| -------- | ---- | ------------ | -------- | -------- | ---- |',
  '| 代码规范 | 符合设计文档 §5 | 否 | 低 | | |',
  '',
  '## 审查结论汇总',
  '',
  '- 质量判定：通过',
  '',
].join('\n');

const QA_DONE_ROWS = [
  '| 开发工程师 | T0-1 | 执行完成 | |',
  '| 质量保障工程师 | T0-1 | 执行完成 | |',
];

function lintGateScenarios() {
  console.log('== 场景 4：编程规范（lint）硬门禁（R15）==');

  // stop 门禁：QA 记录完成后 lint 未通过则注入 followup
  const stopBase = {
    'docs/requirement/requirement-spec.md': REQ_SPEC,
    'docs/requirement/requirement-list.md': REQ_LIST,
    'docs/design/detail-design-spec.md': DESIGN_SPEC,
    'docs/design/develop-task-list.md': TASK_LIST,
    'docs/design/design-problem-list.md': DPL_CLEAN,
  };

  const stopLintFail = writeFixture('lint-stop-fail', {
    'docs/process/process.md': greenfieldReady(QA_DONE_ROWS),
    ...stopBase,
  });
  clearE2e('batch');
  clearE2e('final');
  writeLintFail();
  writeStaticScanPass();
  check('L1 QA 记录完成但 lint 失败即想推进/收尾', 'followup', {
    hook: 'stop', processPath: relToProject(path.join(stopLintFail, 'docs/process/process.md')),
  });

  const stopLintMissing = writeFixture('lint-stop-missing', {
    'docs/process/process.md': greenfieldReady(QA_DONE_ROWS),
    ...stopBase,
  });
  clearE2e('batch');
  clearE2e('final');
  clearLint();
  writeStaticScanPass();
  check('L2 QA 记录完成但缺 lint 机读产物即想推进/收尾', 'followup', {
    hook: 'stop', processPath: relToProject(path.join(stopLintMissing, 'docs/process/process.md')),
  });

  // 角色派发门禁（R13/R15）：lint 未通过时禁止发起 test-engineer
  const roleBase = {
    ...stopBase,
    'docs/quality/quality-report.md': QUALITY_REPORT_CLEAN,
    'docs/design/gated-artifacts.json': GATED_EMPTY,
  };

  const roleLintFail = writeFixture('lint-role-fail', {
    'docs/process/process.md': greenfieldReady(QA_DONE_ROWS),
    ...roleBase,
  });
  const roleFailProc = relToProject(path.join(roleLintFail, 'docs/process/process.md'));
  const roleFailGated = relToProject(path.join(roleLintFail, 'docs/design/gated-artifacts.json'));
  writeLintFail();
  writeStaticScanPass();
  check('L3 QA 通过但 lint 未过发起 test-engineer', 'deny', {
    hook: 'role', role: 'test-engineer', processPath: roleFailProc, gatedPath: roleFailGated,
  });

  const roleLintPass = writeFixture('lint-role-pass', {
    'docs/process/process.md': greenfieldReady(QA_DONE_ROWS),
    ...roleBase,
  });
  const rolePassProc = relToProject(path.join(roleLintPass, 'docs/process/process.md'));
  const rolePassGated = relToProject(path.join(roleLintPass, 'docs/design/gated-artifacts.json'));
  writeLintPass();
  writeStaticScanPass();
  check('L4 QA 通过 + lint 通过 + 静态代码质量门禁通过后发起 test-engineer', 'allow', {
    hook: 'role', role: 'test-engineer', processPath: rolePassProc, gatedPath: rolePassGated,
  });
  clearLint();
  clearStaticScan();
}

function staticScanGateScenarios() {
  console.log('== 场景 5：静态代码质量硬门禁（R16：重复代码 + 安全扫描）==');

  // stop 门禁：QA 记录完成后重复代码/安全扫描未通过则注入 followup
  const stopBase = {
    'docs/requirement/requirement-spec.md': REQ_SPEC,
    'docs/requirement/requirement-list.md': REQ_LIST,
    'docs/design/detail-design-spec.md': DESIGN_SPEC,
    'docs/design/develop-task-list.md': TASK_LIST,
    'docs/design/design-problem-list.md': DPL_CLEAN,
  };

  const stopDupFail = writeFixture('static-scan-stop-dupfail', {
    'docs/process/process.md': greenfieldReady(QA_DONE_ROWS),
    ...stopBase,
  });
  clearE2e('batch');
  clearE2e('final');
  writeLintPass();
  writeStaticScanDupFail();
  check('S1 QA 记录完成但重复代码检测未通过即想推进/收尾', 'followup', {
    hook: 'stop', processPath: relToProject(path.join(stopDupFail, 'docs/process/process.md')),
  });

  const stopSecurityFail = writeFixture('static-scan-stop-securityfail', {
    'docs/process/process.md': greenfieldReady(QA_DONE_ROWS),
    ...stopBase,
  });
  clearE2e('batch');
  clearE2e('final');
  writeLintPass();
  writeStaticScanSecurityFail();
  check('S2 QA 记录完成但安全静态扫描未通过即想推进/收尾', 'followup', {
    hook: 'stop', processPath: relToProject(path.join(stopSecurityFail, 'docs/process/process.md')),
  });

  const stopMissing = writeFixture('static-scan-stop-missing', {
    'docs/process/process.md': greenfieldReady(QA_DONE_ROWS),
    ...stopBase,
  });
  clearE2e('batch');
  clearE2e('final');
  writeLintPass();
  clearStaticScan();
  check('S3 QA 记录完成但缺静态代码质量机读产物即想推进/收尾', 'followup', {
    hook: 'stop', processPath: relToProject(path.join(stopMissing, 'docs/process/process.md')),
  });

  // 角色派发门禁（R13/R16）：重复代码/安全扫描未通过时禁止发起 test-engineer
  const roleBase = {
    ...stopBase,
    'docs/quality/quality-report.md': QUALITY_REPORT_CLEAN,
    'docs/design/gated-artifacts.json': GATED_EMPTY,
  };

  const roleScanFail = writeFixture('static-scan-role-fail', {
    'docs/process/process.md': greenfieldReady(QA_DONE_ROWS),
    ...roleBase,
  });
  const roleFailProc = relToProject(path.join(roleScanFail, 'docs/process/process.md'));
  const roleFailGated = relToProject(path.join(roleScanFail, 'docs/design/gated-artifacts.json'));
  writeLintPass();
  writeStaticScanSecurityFail();
  check('S4 QA 通过 + lint 通过但安全静态扫描未过发起 test-engineer', 'deny', {
    hook: 'role', role: 'test-engineer', processPath: roleFailProc, gatedPath: roleFailGated,
  });

  const roleScanPass = writeFixture('static-scan-role-pass', {
    'docs/process/process.md': greenfieldReady(QA_DONE_ROWS),
    ...roleBase,
  });
  const rolePassProc = relToProject(path.join(roleScanPass, 'docs/process/process.md'));
  const rolePassGated = relToProject(path.join(roleScanPass, 'docs/design/gated-artifacts.json'));
  writeLintPass();
  writeStaticScanPass();
  check('S5 QA 通过 + lint 通过 + 重复代码/安全扫描均通过后发起 test-engineer', 'allow', {
    hook: 'role', role: 'test-engineer', processPath: rolePassProc, gatedPath: rolePassGated,
  });
  clearLint();
  clearStaticScan();
}

function adversarialScenarios() {
  console.log('== 对抗 / 健壮性 ==');

  const cancelled = writeFixture('adv-cancelled', {
    'docs/process/process.md': cancelledProcess(),
  });
  const cancelledProc = relToProject(path.join(cancelled, 'docs/process/process.md'));
  check('A1 R10：写入已取消（冻结）的 process.md 自身', 'deny', {
    hook: 'write', filePath: cancelledProc, processPath: cancelledProc,
  });
  check('A2 R10：在已取消流程上发起角色', 'deny', {
    hook: 'role', role: 'development-engineer', processPath: cancelledProc,
  });
  check('A3 R10：已取消流程 stop 不再催促', 'allow-stop', {
    hook: 'stop', processPath: cancelledProc,
  });

  const docsOnly = writeFixture('adv-docsonly', {
    'docs/process/process.md': docsOnlyProcess(),
    'docs/design/gated-artifacts.json': GATED_EMPTY,
  });
  const docsOnlyProc = relToProject(path.join(docsOnly, 'docs/process/process.md'));
  const docsOnlyGated = relToProject(path.join(docsOnly, 'docs/design/gated-artifacts.json'));
  check('A4 docs-only：写源码', 'deny', {
    hook: 'write', filePath: 'src/app.ts', processPath: docsOnlyProc, gatedPath: docsOnlyGated,
  });
  check('A5 docs-only：发起 development-engineer', 'deny', {
    hook: 'role', role: 'development-engineer', processPath: docsOnlyProc, gatedPath: docsOnlyGated,
  });

  check('A6 工具链安装未批准', 'ask', {
    hook: 'toolchain', command: 'winget install OpenJS.NodeJS',
  });

  const noDispatch = writeFixture('adv-nodispatch', {
    'docs/process/process.md': greenfieldNoDispatch(),
    'docs/requirement/requirement-spec.md': REQ_SPEC,
    'docs/requirement/requirement-list.md': REQ_LIST,
    'docs/design/detail-design-spec.md': DESIGN_SPEC,
    'docs/design/develop-task-list.md': TASK_LIST,
    'docs/design/design-problem-list.md': DPL_CLEAN,
    'docs/design/gated-artifacts.json': GATED_EMPTY,
  });
  const noDispatchProc = relToProject(path.join(noDispatch, 'docs/process/process.md'));
  const noDispatchGated = relToProject(path.join(noDispatch, 'docs/design/gated-artifacts.json'));
  check('A7 无分派计划执行 npm install（项目初始化）', 'deny', {
    hook: 'shell', command: 'npm install', processPath: noDispatchProc, gatedPath: noDispatchGated,
  });

  const ready = writeFixture('adv-ready', {
    'docs/process/process.md': greenfieldReady(),
    'docs/requirement/requirement-spec.md': REQ_SPEC,
    'docs/requirement/requirement-list.md': REQ_LIST,
    'docs/design/detail-design-spec.md': DESIGN_SPEC,
    'docs/design/develop-task-list.md': TASK_LIST,
    'docs/design/design-problem-list.md': DPL_CLEAN,
    'docs/design/gated-artifacts.json': GATED_EMPTY,
  });
  const readyProc = relToProject(path.join(ready, 'docs/process/process.md'));
  const readyGated = relToProject(path.join(ready, 'docs/design/gated-artifacts.json'));
  check('A8 有分派计划执行 npm install', 'allow', {
    hook: 'shell', command: 'npm install', processPath: readyProc, gatedPath: readyGated,
  });
  check('A9 Finding #2：有分派计划时写 docs/ 非文档扩展名（受门禁源码，放行）', 'allow', {
    hook: 'write', filePath: 'docs/design/notes.py', processPath: readyProc, gatedPath: readyGated,
  });
  check('A10 Finding #2：无分派计划时写 docs/ 非文档扩展名（拦截）', 'deny', {
    hook: 'write', filePath: 'docs/design/notes.py', processPath: noDispatchProc, gatedPath: noDispatchGated,
  });
}

function finding1Scenario() {
  console.log('== Finding #1：出厂模板端到端不被误判为阻塞 ==');
  const template = fs
    .readFileSync(path.join(PROJECT_ROOT, '.cursor/templates/process.md'), 'utf8')
    .replace(/\r\n/g, '\n');
  const withConfirm = template.replace(
    '| ------ | ---- | ------------ |\n',
    '| ------ | ---- | ------------ |\n| 需求摘要 | 2026-01-01 | 已确认 |\n',
  );
  if (withConfirm === template) {
    failCount += 1;
    failures.push({ label: 'B1 模板注入用户确认行', expect: 'injected', outcome: 'template-shape-changed' });
    console.error('  FAIL  出厂模板「## 用户确认记录」表结构变化，无法注入确认行（请更新本回归）');
    return;
  }
  const root = writeFixture('finding1-template', {
    'docs/process/process.md': withConfirm,
    'docs/requirement/requirement-spec.md': REQ_SPEC,
    'docs/requirement/requirement-list.md': REQ_LIST,
    'docs/design/gated-artifacts.json': GATED_EMPTY,
  });
  check('B1 出厂模板派发 system-architect（不得因阻塞误判被拒）', 'allow', {
    hook: 'role',
    role: 'system-architect',
    processPath: relToProject(path.join(root, 'docs/process/process.md')),
    gatedPath: relToProject(path.join(root, 'docs/design/gated-artifacts.json')),
  });
}

// ---------------------------------------------------------------------------
function main() {
  fs.rmSync(SCEN_ROOT, { recursive: true, force: true });
  snapshotE2e();
  snapshotLint();
  snapshotStaticScan();
  try {
    greenfieldScenarios();
    featureScenarios();
    hotfixScenarios();
    lintGateScenarios();
    staticScanGateScenarios();
    adversarialScenarios();
    finding1Scenario();
  } finally {
    restoreE2e();
    restoreLint();
    restoreStaticScan();
    fs.rmSync(SCEN_ROOT, { recursive: true, force: true });
  }

  console.log('');
  console.log(`结果：${passCount} passed, ${failCount} failed`);
  if (failCount > 0) {
    console.error('失败场景：');
    for (const f of failures) console.error(`  - ${f.label}（expect=${f.expect} got=${f.outcome}）`);
    process.exit(1);
  }
  process.exit(0);
}

main();
