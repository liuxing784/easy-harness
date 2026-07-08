#!/usr/bin/env node
/**
 * 门禁逻辑回归自检：覆盖 R3 / R6 / B1 / R9 / R10 / R11 / R13 最低必测集，
 * 以及 Finding #1（出厂模板阻塞误判）回归。
 * 纯 Node，无需额外依赖。通过临时 fixture（写入 test-results/.gate-selftest/ 下的
 * docs 子树 + process.md，借助 HARNESS_PROCESS_PATH 环境变量切换活跃流程指针）
 * 驱动 workflow-gate-lib.mjs 的真实文件系统逻辑；测试完成后清理 fixture。
 * 非 0 退出码即失败，供修改 Hook/脚本后回归验证。
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import {
  isGatedDevPath,
  parseWorkflowState,
  checkIterationArtifacts,
  checkHotfixDesign,
  isCancelledProcessFile,
  checkRoleDispatchGate,
  checkBatchApiTestReport,
  isApiTestExempt,
  isLintExempt,
  readLintResult,
  checkLintClean,
  isDupCheckExempt,
  isSecurityScanExempt,
  readStaticScanResult,
  checkStaticScanClean,
  hasUnresolvedIssues,
  isProcessBlocked,
} from '../hooks/workflow-gate-lib.mjs';
import { resolveLintCommand, computeLintGate } from './lint-run-lib.mjs';
import {
  resolveDupCommand,
  resolveSecurityCommand,
  computeSubGate,
  computeStaticScanGate,
} from './static-scan-run-lib.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../..');
const FIXTURE_ROOT = path.join(PROJECT_ROOT, 'test-results/.gate-selftest');

let passCount = 0;
let failCount = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passCount += 1;
    console.log(`  ok   - ${name}`);
  } catch (err) {
    failCount += 1;
    failures.push({ name, error: err.message });
    console.error(`  FAIL - ${name}: ${err.message}`);
  }
}

/** 重置 fixture 并将 HARNESS_PROCESS_PATH 指向新写入的 process.md，返回其内容 */
function fixtureProcess(processContent, extraFiles = {}) {
  fs.rmSync(FIXTURE_ROOT, { recursive: true, force: true });
  const processAbsPath = path.join(FIXTURE_ROOT, 'docs/process/process.md');
  fs.mkdirSync(path.dirname(processAbsPath), { recursive: true });
  fs.writeFileSync(processAbsPath, processContent, 'utf8');
  for (const [rel, content] of Object.entries(extraFiles)) {
    const abs = path.join(FIXTURE_ROOT, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, 'utf8');
  }
  process.env.HARNESS_PROCESS_PATH = path
    .relative(PROJECT_ROOT, processAbsPath)
    .replace(/\\/g, '/');
  return processContent;
}

function cleanup() {
  fs.rmSync(FIXTURE_ROOT, { recursive: true, force: true });
  delete process.env.HARNESS_PROCESS_PATH;
  delete process.env.HARNESS_GATED_ARTIFACTS_PATH;
}

// R15：lint 机读产物固定落盘于 test-results/qa/.lint-result.json（非 fixture 子树）；
// 自检期间快照/还原真实文件，避免污染宿主运行时产物。
const LINT_RESULT_PATH = path.join(PROJECT_ROOT, 'test-results/qa/.lint-result.json');
let _lintSnapshot;
function snapshotLintResult() {
  _lintSnapshot = fs.existsSync(LINT_RESULT_PATH) ? fs.readFileSync(LINT_RESULT_PATH, 'utf8') : null;
}
function restoreLintResult() {
  if (_lintSnapshot === null || _lintSnapshot === undefined) fs.rmSync(LINT_RESULT_PATH, { force: true });
  else fs.writeFileSync(LINT_RESULT_PATH, _lintSnapshot, 'utf8');
}
function writeLintResult(result) {
  fs.mkdirSync(path.dirname(LINT_RESULT_PATH), { recursive: true });
  fs.writeFileSync(LINT_RESULT_PATH, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
}
function clearLintResult() {
  fs.rmSync(LINT_RESULT_PATH, { force: true });
}

// R16：静态代码质量机读产物固定落盘于 test-results/qa/.static-scan-result.json（非 fixture 子树）；
// 自检期间快照/还原真实文件，避免污染宿主运行时产物。
const STATIC_SCAN_RESULT_PATH = path.join(PROJECT_ROOT, 'test-results/qa/.static-scan-result.json');
let _staticScanSnapshot;
function snapshotStaticScanResult() {
  _staticScanSnapshot = fs.existsSync(STATIC_SCAN_RESULT_PATH)
    ? fs.readFileSync(STATIC_SCAN_RESULT_PATH, 'utf8')
    : null;
}
function restoreStaticScanResult() {
  if (_staticScanSnapshot === null || _staticScanSnapshot === undefined) {
    fs.rmSync(STATIC_SCAN_RESULT_PATH, { force: true });
  } else {
    fs.writeFileSync(STATIC_SCAN_RESULT_PATH, _staticScanSnapshot, 'utf8');
  }
}
function writeStaticScanResult(result) {
  fs.mkdirSync(path.dirname(STATIC_SCAN_RESULT_PATH), { recursive: true });
  fs.writeFileSync(STATIC_SCAN_RESULT_PATH, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
}
function clearStaticScanResult() {
  fs.rmSync(STATIC_SCAN_RESULT_PATH, { force: true });
}

console.log('== R6：.cursor/ 门禁路径判定 ==');
test('R6: .cursor/scripts 下的文件受门禁保护', () => {
  assert.equal(isGatedDevPath('.cursor/scripts/foo.mjs'), true);
});
test('R6: .cursor/agents 下的文件受门禁保护', () => {
  assert.equal(isGatedDevPath('.cursor/agents/foo.md'), true);
});
test('R6: .cursor/hooks 下的文件受门禁保护（豁免标记文件除外）', () => {
  assert.equal(isGatedDevPath('.cursor/hooks/gate-foo.mjs'), true);
  assert.equal(isGatedDevPath('.cursor/hooks/.toolchain-install-approved.json'), false);
});
test('R6: 治理配置文件不纳入机制门禁（文字约束覆盖）', () => {
  assert.equal(isGatedDevPath('.cursor/templates/process.md'), false);
  assert.equal(isGatedDevPath('.cursor/harness.config.json'), false);
  assert.equal(isGatedDevPath('.cursor/hooks.json'), false);
  assert.equal(isGatedDevPath('.cursor/harness-state.json'), false);
});
test('R6: 常规源码路径仍受门禁保护（回归既有行为）', () => {
  assert.equal(isGatedDevPath('src/index.ts'), true);
  assert.equal(isGatedDevPath('docs/requirement/requirement-list.md'), false);
});

console.log('== B1：任务包去重与 tombstone ==');
test('B1: 同一任务包取最新状态，已作废行被 tombstone 排除', () => {
  const content = [
    '---',
    'workflow_mode: full',
    '---',
    '',
    '## 进度列表',
    '',
    '| 角色/开发线 | 任务名称 | 状态 | 说明 |',
    '| ----------- | -------- | ---- | ---- |',
    '| 开发工程师 | T0-1 | 正在执行 | |',
    '| 开发工程师 | T0-1 | 执行完成 | |',
    '| 开发工程师 | T0-2 已作废 | 执行完成 | |',
    '',
  ].join('\n');
  const state = parseWorkflowState(content);
  assert.equal(state.devComplete, true, 'T0-1 最新状态应为完成，T0-2 已作废应被排除出统计');
});
test('B1: 未去重前提下的朴素实现会误判——验证确实按编号聚合而非计数总行数', () => {
  const content = [
    '---',
    'workflow_mode: full',
    '---',
    '',
    '## 进度列表',
    '',
    '| 角色/开发线 | 任务名称 | 状态 | 说明 |',
    '| ----------- | -------- | ---- | ---- |',
    '| 开发工程师 | T0-1 | 正在执行 | |',
    '| 开发工程师 | T0-1 | 正在执行 | 重复上报 |',
    '',
  ].join('\n');
  const state = parseWorkflowState(content);
  assert.equal(state.devInProgress, true);
  assert.equal(state.devComplete, false);
});

console.log('== R3：迭代成果物前置校验 ==');
test('R3: iterationType 缺失时跳过校验（legacy 兼容）', () => {
  const result = checkIterationArtifacts('---\nworkflow_mode: full\n---\n');
  assert.equal(result.ok, true);
});
test('R3: hotfix/docs-only 豁免', () => {
  assert.equal(checkIterationArtifacts('---\nworkflow_mode: hotfix\n---\n').ok, true);
  assert.equal(checkIterationArtifacts('---\nworkflow_mode: docs-only\n---\n').ok, true);
});
test('R3: 非 hotfix 迭代缺成果物时失败', () => {
  const content = fixtureProcess('---\nworkflow_mode: full\niterationType: greenfield\n---\n');
  assert.equal(checkIterationArtifacts(content).ok, false);
});
test('R3: 四件成果物存在且被 process.md 引用时通过', () => {
  const content = fixtureProcess(
    [
      '---',
      'workflow_mode: full',
      'iterationType: greenfield',
      '---',
      '',
      '已产出 requirement-spec.md、requirement-list.md、detail-design-spec.md、develop-task-list.md。',
      '',
    ].join('\n'),
    {
      'docs/requirement/requirement-spec.md': '# spec',
      'docs/requirement/requirement-list.md': '# list',
      'docs/design/detail-design-spec.md': '# design',
      'docs/design/develop-task-list.md': '# tasks',
    },
  );
  assert.equal(checkIterationArtifacts(content).ok, true);
});

console.log('== R9：hotfix 设计存在性前置校验 ==');
test('R9: hotfix 模式下设计缺失时失败', () => {
  const content = fixtureProcess('---\nworkflow_mode: hotfix\n---\n');
  assert.equal(checkHotfixDesign(content).ok, false);
});
test('R9: hotfix 模式下设计存在时通过', () => {
  const content = fixtureProcess('---\nworkflow_mode: hotfix\n---\n', {
    'docs/design/detail-design-spec.md': '# design',
  });
  assert.equal(checkHotfixDesign(content).ok, true);
});
test('R9: 非 hotfix 模式豁免', () => {
  assert.equal(checkHotfixDesign('---\nworkflow_mode: full\n---\n').ok, true);
});

console.log('== R10：流程终止（不可逆取消）==');
test('R10: cancelled=true 的 process.md 被识别为冻结', () => {
  fixtureProcess('---\nworkflow_mode: full\ncancelled: true\n---\n');
  assert.equal(isCancelledProcessFile(process.env.HARNESS_PROCESS_PATH), true);
});
test('R10: cancelled=false 时不冻结', () => {
  fixtureProcess('---\nworkflow_mode: full\ncancelled: false\n---\n');
  assert.equal(isCancelledProcessFile(process.env.HARNESS_PROCESS_PATH), false);
});
test('R10: 非 process.md 路径不受冻结判定影响', () => {
  assert.equal(isCancelledProcessFile('docs/design/detail-design-spec.md'), false);
});
test('R10: parseWorkflowState 正确反映 cancelled 状态', () => {
  const state = parseWorkflowState('---\nworkflow_mode: full\ncancelled: true\n---\n');
  assert.equal(state.cancelled, true);
});

console.log('== R11：hotfix 批次/最终测试折叠 ==');
test('R11: hotfix 模式下 finalTestRequired 不要求批次集成测试完成', () => {
  const content = [
    '---',
    'workflow_mode: hotfix',
    '---',
    '',
    '## 进度列表',
    '',
    '| 角色/开发线 | 任务名称 | 状态 | 说明 |',
    '| ----------- | -------- | ---- | ---- |',
    '| 开发工程师 | T-1 | 执行完成 | |',
    '| 质量保障工程师 | T-1 | 执行完成 | |',
    '',
  ].join('\n');
  const state = parseWorkflowState(content);
  assert.equal(state.finalTestRequired, true, 'hotfix 只需 dev+QA 完成即视为需要（唯一一次）最终测试');
});

console.log('== 表格未解决问题解析（design-problem-list.md / quality-report.md 通用）==');
test('hasUnresolvedIssues: 识别是否存在=是 且 是否解决≠是 的行', () => {
  const content = '| 是否存在 | 是否解决 |\n| --- | --- |\n| 是 | 否 |\n';
  assert.equal(hasUnresolvedIssues(content), true);
});
test('hasUnresolvedIssues: 已解决问题不计入未解决', () => {
  const content = '| 是否存在 | 是否解决 |\n| --- | --- |\n| 是 | 是 |\n';
  assert.equal(hasUnresolvedIssues(content), false);
});

console.log('== Finding #1：出厂 process.md 模板不得被误判为阻塞 ==');
test('出厂模板的「## 阻塞原因」默认体不被判为阻塞（开箱即用不卡死）', () => {
  const templatePath = path.join(PROJECT_ROOT, '.cursor/templates/process.md');
  const templateContent = fs.readFileSync(templatePath, 'utf8');
  assert.equal(
    isProcessBlocked(templateContent),
    false,
    '出厂 process.md 模板不应开箱即被判为阻塞（Finding #1 回归）',
  );
});
test('真实阻塞原因仍被判为阻塞（回归 isProcessBlocked 严格性，防止 R12 弱化）', () => {
  const blocked = [
    '---',
    'blocking: false',
    '---',
    '',
    '## 阻塞原因',
    '',
    '- 阻塞原因：等待用户确认预算上限',
    '',
  ].join('\n');
  assert.equal(isProcessBlocked(blocked), true);
});
test('frontmatter blocking: true 时判为阻塞（与章节内容无关）', () => {
  assert.equal(isProcessBlocked('---\nblocking: true\n---\n\n## 阻塞原因\n\n无\n'), true);
});

console.log('== R13：成果物门禁链机械化（Task 前置校验）==');
test('R13: 已取消流程禁止发起任何角色', () => {
  fixtureProcess('---\nworkflow_mode: full\ncancelled: true\n---\n');
  const result = checkRoleDispatchGate('development-engineer');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'cancelled');
});
test('R13: project-manager / requirements-analyst 不在门禁表中，恒放行', () => {
  fixtureProcess('---\nworkflow_mode: full\n---\n');
  assert.equal(checkRoleDispatchGate('project-manager').ok, true);
  assert.equal(checkRoleDispatchGate('requirements-analyst').ok, true);
});
test('R13: 需求成果物未就绪时禁止发起 system-architect', () => {
  fixtureProcess(
    [
      '---',
      'workflow_mode: full',
      '---',
      '',
      '## 用户确认记录',
      '',
      '| 确认项 | 时间 | 用户原话摘要 |',
      '| ------ | ---- | ------------ |',
      '',
    ].join('\n'),
  );
  assert.equal(checkRoleDispatchGate('system-architect').ok, false);
});
test('R13: 需求成果物就绪且有用户确认记录时允许发起 system-architect', () => {
  fixtureProcess(
    [
      '---',
      'workflow_mode: full',
      '---',
      '',
      '## 用户确认记录',
      '',
      '| 确认项 | 时间 | 用户原话摘要 |',
      '| ------ | ---- | ------------ |',
      '| 需求摘要 | 2026-01-01 | 用户确认无误 |',
      '',
    ].join('\n'),
    {
      'docs/requirement/requirement-spec.md': '# spec',
      'docs/requirement/requirement-list.md': '# list',
    },
  );
  assert.equal(checkRoleDispatchGate('system-architect').ok, true);
});
test('R13: 设计问题清单存在未解决问题时禁止发起 development-engineer', () => {
  fixtureProcess(
    [
      '---',
      'workflow_mode: full',
      '---',
      '',
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
      '',
    ].join('\n'),
    {
      'docs/design/detail-design-spec.md': '# design',
      'docs/design/develop-task-list.md': '# tasks',
      'docs/design/design-problem-list.md':
        '# 设计问题清单\n\n| 检查维度 | 问题描述 | 严重等级 | 是否存在 | 是否解决 | 关联成果物 |\n| --- | --- | --- | --- | --- | --- |\n| 功能 | 问题X | 高 | 是 | 否 | |\n',
    },
  );
  const result = checkRoleDispatchGate('development-engineer');
  assert.equal(result.ok, false);
});
test('R13: 设计审核通过 + 有效分派计划时允许发起 development-engineer', () => {
  fixtureProcess(
    [
      '---',
      'workflow_mode: full',
      '---',
      '',
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
      '',
    ].join('\n'),
    {
      'docs/design/detail-design-spec.md': '# design',
      'docs/design/develop-task-list.md': '# tasks',
      'docs/design/design-problem-list.md':
        '# 设计问题清单\n\n| 检查维度 | 问题描述 | 严重等级 | 是否存在 | 是否解决 | 关联成果物 |\n| --- | --- | --- | --- | --- | --- |\n| 功能 | 无 | 低 | 否 | | |\n',
    },
  );
  const result = checkRoleDispatchGate('development-engineer');
  assert.equal(result.ok, true);
});

console.log('== R14：开发窗口批次接口测试报告章节校验 ==');
const R14_PROGRESS_BATCH_DONE = [
  '---',
  'workflow_mode: full',
  'iterationType: greenfield',
  '---',
  '',
  '## 进度列表',
  '',
  '| 角色/开发线 | 任务名称 | 状态 | 说明 |',
  '| ----------- | -------- | ---- | ---- |',
  '| 开发工程师 | T0-1 | 执行完成 | |',
  '| 质量保障工程师 | T0-1 | 执行完成 | |',
  '| 测试工程师 | 批次集成测试 T0-1 | 执行完成 | |',
  '',
].join('\n');
const API_REPORT_EMPTY =
  '# 测试报告\n\n## 接口测试报告\n\n| 接口 | 是否通过 |\n| ---- | -------- |\n';
const API_REPORT_FILLED =
  '# 测试报告\n\n## 接口测试报告\n\n| 接口 | 是否通过 |\n| ---- | -------- |\n| /api/todos POST | 是 |\n';

test('R14: 测试报告缺少接口测试报告章节时校验失败', () => {
  fixtureProcess(R14_PROGRESS_BATCH_DONE, {
    'docs/test/test-report.md': '# 测试报告\n\n## 测试环境\n\n无\n',
  });
  assert.equal(checkBatchApiTestReport().ok, false);
});
test('R14: 接口测试报告章节存在但为空（仅表头）时校验失败', () => {
  fixtureProcess(R14_PROGRESS_BATCH_DONE, {
    'docs/test/test-report.md': API_REPORT_EMPTY,
  });
  assert.equal(checkBatchApiTestReport().ok, false);
});
test('R14: 接口测试报告章节含真实数据行时校验通过', () => {
  fixtureProcess(R14_PROGRESS_BATCH_DONE, {
    'docs/test/test-report.md': API_REPORT_FILLED,
  });
  assert.equal(checkBatchApiTestReport().ok, true);
});
test('R14: parseWorkflowState 反映 batchApiReportPresent', () => {
  const content = fixtureProcess(R14_PROGRESS_BATCH_DONE, {
    'docs/test/test-report.md': API_REPORT_FILLED,
  });
  assert.equal(parseWorkflowState(content).batchApiReportPresent, true);
});
test('R14: 缺接口测试报告章节时 batchTestComplete=false（即便测试记录完成）', () => {
  const content = fixtureProcess(R14_PROGRESS_BATCH_DONE, {
    'docs/test/test-report.md': API_REPORT_EMPTY,
  });
  const state = parseWorkflowState(content);
  assert.equal(state.batchTestRowComplete, true, '批次测试进度行应为完成');
  assert.equal(state.batchApiReportPresent, false);
  assert.equal(state.batchTestComplete, false, '接口测试报告缺失应使批次测试判定为未完成');
});
console.log('== R14：无对外接口项目适用性豁免（双要素）==');
const API_EXEMPT_CONFIRM_PROCESS = [
  '---',
  'workflow_mode: full',
  'iterationType: greenfield',
  '---',
  '',
  '## 用户确认记录',
  '',
  '| 确认项 | 时间 | 用户原话摘要 |',
  '| ------ | ---- | ------------ |',
  '| 接口测试豁免 | 2026-01-01 | 纯算法库无对外接口，确认豁免接口测试 |',
  '',
  '## 进度列表',
  '',
  '| 角色/开发线 | 任务名称 | 状态 | 说明 |',
  '| ----------- | -------- | ---- | ---- |',
  '| 开发工程师 | T0-1 | 执行完成 | |',
  '',
].join('\n');
const API_NA_GATED = '{ "apiTestApplicability": "n/a", "apiTestApplicabilityReason": "纯算法库无对外接口" }\n';

test('R14: 仅用户确认但架构师未声明 n/a → 不豁免', () => {
  const content = fixtureProcess(API_EXEMPT_CONFIRM_PROCESS, {
    'docs/design/none.json': '{}\n',
  });
  process.env.HARNESS_GATED_ARTIFACTS_PATH = 'test-results/.gate-selftest/docs/design/none.json';
  assert.equal(isApiTestExempt(content), false);
});
test('R14: 仅架构师声明 n/a 但无用户确认 → 不豁免', () => {
  const content = fixtureProcess(
    ['---', 'workflow_mode: full', 'iterationType: greenfield', '---', ''].join('\n'),
    { 'docs/design/gated-na.json': API_NA_GATED },
  );
  process.env.HARNESS_GATED_ARTIFACTS_PATH = 'test-results/.gate-selftest/docs/design/gated-na.json';
  assert.equal(isApiTestExempt(content), false);
});
test('R14: 架构师声明 n/a + 用户确认 → 豁免，batchApiReportPresent 视为满足', () => {
  const content = fixtureProcess(API_EXEMPT_CONFIRM_PROCESS, {
    'docs/design/gated-na.json': API_NA_GATED,
  });
  process.env.HARNESS_GATED_ARTIFACTS_PATH = 'test-results/.gate-selftest/docs/design/gated-na.json';
  assert.equal(isApiTestExempt(content), true);
  const state = parseWorkflowState(content);
  assert.equal(state.apiTestExempt, true);
  assert.equal(state.batchApiReportPresent, true, '豁免后即便无接口测试报告章节也视为满足');
});
delete process.env.HARNESS_GATED_ARTIFACTS_PATH;

test('R14: hotfix 折叠通道不并入接口测试报告判据（batchTestComplete 恒真）', () => {
  const content = fixtureProcess(
    [
      '---',
      'workflow_mode: hotfix',
      'iterationType: hotfix',
      '---',
      '',
      '## 进度列表',
      '',
      '| 角色/开发线 | 任务名称 | 状态 | 说明 |',
      '| ----------- | -------- | ---- | ---- |',
      '| 开发工程师 | T-1 | 执行完成 | |',
      '| 质量保障工程师 | T-1 | 执行完成 | |',
      '',
    ].join('\n'),
  );
  assert.equal(parseWorkflowState(content).batchTestComplete, true);
});

console.log('== R15：编程规范（lint）门禁纯函数判据 ==');
test('R15: resolveLintCommand 覆盖优先于栈默认值', () => {
  assert.equal(resolveLintCommand({ stack: 'node', override: 'eslint .' }), 'eslint .');
  assert.equal(resolveLintCommand({ stack: 'node', override: null }), 'npm run lint');
  assert.equal(resolveLintCommand({ stack: 'python', override: null }), 'ruff check .');
});
test('R15: 无 lint 命令的栈返回 null', () => {
  assert.equal(resolveLintCommand({ stack: 'java-maven', override: null }), null);
  assert.equal(resolveLintCommand({ stack: null, override: null }), null);
});
test('R15: computeLintGate —— 有命令且退出码 0 才 gatePassed', () => {
  assert.equal(computeLintGate({ command: 'npm run lint', exitCode: 0 }).gatePassed, true);
  assert.equal(computeLintGate({ command: 'npm run lint', exitCode: 1 }).gatePassed, false);
  assert.equal(computeLintGate({ command: null, exitCode: null }).gatePassed, false);
  assert.equal(computeLintGate({ command: null, exitCode: null }).reason, 'no-lint-command');
});

console.log('== R15：编程规范（lint）门禁机读判据（含双要素豁免）==');
const R15_QA_DONE = [
  '---',
  'workflow_mode: full',
  'iterationType: greenfield',
  '---',
  '',
  '## 进度列表',
  '',
  '| 角色/开发线 | 任务名称 | 状态 | 说明 |',
  '| ----------- | -------- | ---- | ---- |',
  '| 开发工程师 | T0-1 | 执行完成 | |',
  '| 质量保障工程师 | T0-1 | 执行完成 | |',
  '',
].join('\n');
const LINT_PASS = { gatePassed: true, reason: 'passed', stack: 'node', command: 'npm run lint', exitCode: 0 };
const LINT_FAIL = { gatePassed: false, reason: 'lint-failed', stack: 'node', command: 'npm run lint', exitCode: 1 };
const LINT_NA_GATED = '{ "lintApplicability": "n/a", "lintApplicabilityReason": "无成熟 linter" }\n';
const LINT_EXEMPT_CONFIRM_PROCESS = [
  '---',
  'workflow_mode: full',
  'iterationType: greenfield',
  '---',
  '',
  '## 用户确认记录',
  '',
  '| 确认项 | 时间 | 用户原话摘要 |',
  '| ------ | ---- | ------------ |',
  '| 编程规范豁免 | 2026-01-01 | 该技术栈无可用 linter，确认豁免 lint 门禁 |',
  '',
  '## 进度列表',
  '',
  '| 角色/开发线 | 任务名称 | 状态 | 说明 |',
  '| ----------- | -------- | ---- | ---- |',
  '| 开发工程师 | T0-1 | 执行完成 | |',
  '| 质量保障工程师 | T0-1 | 执行完成 | |',
  '',
].join('\n');

snapshotLintResult();
test('R15: 无 lint 机读产物时 checkLintClean 失败、lintPassed=false', () => {
  const content = fixtureProcess(R15_QA_DONE);
  clearLintResult();
  assert.equal(readLintResult(), null);
  assert.equal(checkLintClean().ok, false);
  assert.equal(parseWorkflowState(content).lintPassed, false);
});
test('R15: lint gatePassed=true 时 checkLintClean 通过、lintPassed=true', () => {
  const content = fixtureProcess(R15_QA_DONE);
  writeLintResult(LINT_PASS);
  assert.equal(checkLintClean().ok, true);
  assert.equal(parseWorkflowState(content).lintPassed, true);
});
test('R15: lint gatePassed=false（lint 失败）时 checkLintClean 失败、lintPassed=false', () => {
  const content = fixtureProcess(R15_QA_DONE);
  writeLintResult(LINT_FAIL);
  assert.equal(checkLintClean().ok, false);
  assert.equal(parseWorkflowState(content).lintPassed, false);
});
test('R15: 仅架构师声明 n/a 但无用户确认 → 不豁免', () => {
  const content = fixtureProcess(R15_QA_DONE, { 'docs/design/gated-lint-na.json': LINT_NA_GATED });
  process.env.HARNESS_GATED_ARTIFACTS_PATH = 'test-results/.gate-selftest/docs/design/gated-lint-na.json';
  clearLintResult();
  assert.equal(isLintExempt(content), false);
  assert.equal(parseWorkflowState(content).lintPassed, false);
  delete process.env.HARNESS_GATED_ARTIFACTS_PATH;
});
test('R15: 仅用户确认但架构师未声明 n/a → 不豁免', () => {
  const content = fixtureProcess(LINT_EXEMPT_CONFIRM_PROCESS, { 'docs/design/none.json': '{}\n' });
  process.env.HARNESS_GATED_ARTIFACTS_PATH = 'test-results/.gate-selftest/docs/design/none.json';
  clearLintResult();
  assert.equal(isLintExempt(content), false);
  delete process.env.HARNESS_GATED_ARTIFACTS_PATH;
});
test('R15: 架构师声明 n/a + 用户确认 → 豁免，lintPassed 视为满足（即便无 lint 产物）', () => {
  const content = fixtureProcess(LINT_EXEMPT_CONFIRM_PROCESS, { 'docs/design/gated-lint-na.json': LINT_NA_GATED });
  process.env.HARNESS_GATED_ARTIFACTS_PATH = 'test-results/.gate-selftest/docs/design/gated-lint-na.json';
  clearLintResult();
  assert.equal(isLintExempt(content), true);
  assert.equal(checkLintClean().ok, true);
  assert.equal(parseWorkflowState(content).lintPassed, true);
  delete process.env.HARNESS_GATED_ARTIFACTS_PATH;
});
test('R15: docs-only 模式 lintPassed 视为满足', () => {
  const content = '---\nworkflow_mode: docs-only\n---\n';
  clearLintResult();
  assert.equal(parseWorkflowState(content).lintPassed, true);
});
restoreLintResult();

console.log('== R16：静态代码质量门禁纯函数判据 ==');
test('R16: resolveDupCommand/resolveSecurityCommand 覆盖优先于默认值', () => {
  assert.equal(resolveDupCommand({ override: 'jscpd --threshold 10 .' }), 'jscpd --threshold 10 .');
  assert.ok(resolveDupCommand({ override: null }).includes('jscpd-rs'));
  assert.equal(resolveDupCommand({ override: '' }), null);
  assert.equal(resolveSecurityCommand({ override: 'gitleaks detect' }), 'gitleaks detect');
  assert.ok(resolveSecurityCommand({ override: null }).includes('gitleaks-secret-scanner'));
  assert.equal(resolveSecurityCommand({ override: '' }), null);
});
test('R16: computeSubGate —— 有命令且退出码 0 才 gatePassed', () => {
  assert.equal(computeSubGate({ command: 'jscpd .', exitCode: 0 }).gatePassed, true);
  assert.equal(computeSubGate({ command: 'jscpd .', exitCode: 1 }).gatePassed, false);
  assert.equal(computeSubGate({ command: null, exitCode: null }).gatePassed, false);
  assert.equal(computeSubGate({ command: null, exitCode: null }).reason, 'no-command');
});
test('R16: computeStaticScanGate —— 两项子检查均通过才 gatePassed', () => {
  const pass = { gatePassed: true };
  const fail = { gatePassed: false };
  assert.equal(computeStaticScanGate({ duplication: pass, security: pass }).gatePassed, true);
  assert.equal(computeStaticScanGate({ duplication: fail, security: pass }).gatePassed, false);
  assert.equal(computeStaticScanGate({ duplication: pass, security: fail }).gatePassed, false);
});

console.log('== R16：静态代码质量门禁机读判据（含双要素豁免，重复代码/安全扫描独立）==');
const R16_QA_DONE = R15_QA_DONE;
const STATIC_SCAN_PASS = {
  gatePassed: true,
  duplication: { gatePassed: true, reason: 'passed', command: 'jscpd .', exitCode: 0 },
  security: { gatePassed: true, reason: 'passed', command: 'gitleaks-secret-scanner', exitCode: 0 },
};
const STATIC_SCAN_DUP_FAIL = {
  gatePassed: false,
  duplication: { gatePassed: false, reason: 'scan-failed', command: 'jscpd .', exitCode: 1 },
  security: { gatePassed: true, reason: 'passed', command: 'gitleaks-secret-scanner', exitCode: 0 },
};
const STATIC_SCAN_SECURITY_FAIL = {
  gatePassed: false,
  duplication: { gatePassed: true, reason: 'passed', command: 'jscpd .', exitCode: 0 },
  security: { gatePassed: false, reason: 'scan-failed', command: 'gitleaks-secret-scanner', exitCode: 1 },
};
const DUP_NA_GATED = '{ "dupCheckApplicability": "n/a", "dupCheckApplicabilityReason": "生成代码占比过高" }\n';
const SECURITY_NA_GATED = '{ "securityScanApplicability": "n/a", "securityScanApplicabilityReason": "离线环境无法拉取工具" }\n';
const DUP_EXEMPT_CONFIRM_PROCESS = [
  '---',
  'workflow_mode: full',
  'iterationType: greenfield',
  '---',
  '',
  '## 用户确认记录',
  '',
  '| 确认项 | 时间 | 用户原话摘要 |',
  '| ------ | ---- | ------------ |',
  '| 重复代码豁免 | 2026-01-01 | 生成代码占比过高，确认豁免重复代码检测门禁 |',
  '',
  '## 进度列表',
  '',
  '| 角色/开发线 | 任务名称 | 状态 | 说明 |',
  '| ----------- | -------- | ---- | ---- |',
  '| 开发工程师 | T0-1 | 执行完成 | |',
  '| 质量保障工程师 | T0-1 | 执行完成 | |',
  '',
].join('\n');
const SECURITY_EXEMPT_CONFIRM_PROCESS = [
  '---',
  'workflow_mode: full',
  'iterationType: greenfield',
  '---',
  '',
  '## 用户确认记录',
  '',
  '| 确认项 | 时间 | 用户原话摘要 |',
  '| ------ | ---- | ------------ |',
  '| 安全扫描豁免 | 2026-01-01 | 离线环境无法拉取工具，确认豁免安全静态扫描门禁 |',
  '',
  '## 进度列表',
  '',
  '| 角色/开发线 | 任务名称 | 状态 | 说明 |',
  '| ----------- | -------- | ---- | ---- |',
  '| 开发工程师 | T0-1 | 执行完成 | |',
  '| 质量保障工程师 | T0-1 | 执行完成 | |',
  '',
].join('\n');

snapshotStaticScanResult();
test('R16: 无静态扫描机读产物时 checkStaticScanClean 失败、staticScanPassed=false', () => {
  const content = fixtureProcess(R16_QA_DONE);
  clearStaticScanResult();
  assert.equal(readStaticScanResult(), null);
  assert.equal(checkStaticScanClean().ok, false);
  assert.equal(parseWorkflowState(content).staticScanPassed, false);
});
test('R16: 两项子检查均 gatePassed=true 时 checkStaticScanClean 通过、staticScanPassed=true', () => {
  const content = fixtureProcess(R16_QA_DONE);
  writeStaticScanResult(STATIC_SCAN_PASS);
  assert.equal(checkStaticScanClean().ok, true);
  assert.equal(parseWorkflowState(content).staticScanPassed, true);
});
test('R16: 重复代码检测未通过时 checkStaticScanClean 失败、staticScanPassed=false', () => {
  const content = fixtureProcess(R16_QA_DONE);
  writeStaticScanResult(STATIC_SCAN_DUP_FAIL);
  assert.equal(checkStaticScanClean().ok, false);
  assert.equal(checkStaticScanClean().reason, 'dup-check-not-passed');
  assert.equal(parseWorkflowState(content).staticScanPassed, false);
});
test('R16: 安全扫描未通过时 checkStaticScanClean 失败、staticScanPassed=false', () => {
  const content = fixtureProcess(R16_QA_DONE);
  writeStaticScanResult(STATIC_SCAN_SECURITY_FAIL);
  assert.equal(checkStaticScanClean().ok, false);
  assert.equal(checkStaticScanClean().reason, 'security-scan-not-passed');
  assert.equal(parseWorkflowState(content).staticScanPassed, false);
});
test('R16: 仅架构师声明 dupCheckApplicability n/a 但无用户确认 → 不豁免', () => {
  const content = fixtureProcess(R16_QA_DONE, { 'docs/design/gated-dup-na.json': DUP_NA_GATED });
  process.env.HARNESS_GATED_ARTIFACTS_PATH = 'test-results/.gate-selftest/docs/design/gated-dup-na.json';
  clearStaticScanResult();
  assert.equal(isDupCheckExempt(content), false);
  assert.equal(parseWorkflowState(content).staticScanPassed, false);
  delete process.env.HARNESS_GATED_ARTIFACTS_PATH;
});
test('R16: 架构师声明 dupCheckApplicability n/a + 用户确认 → 仅重复代码豁免，安全扫描仍须通过', () => {
  const content = fixtureProcess(DUP_EXEMPT_CONFIRM_PROCESS, { 'docs/design/gated-dup-na.json': DUP_NA_GATED });
  process.env.HARNESS_GATED_ARTIFACTS_PATH = 'test-results/.gate-selftest/docs/design/gated-dup-na.json';
  clearStaticScanResult();
  assert.equal(isDupCheckExempt(content), true);
  assert.equal(isSecurityScanExempt(content), false);
  // 未运行安全扫描，即便重复代码已豁免，整体仍不通过
  assert.equal(checkStaticScanClean().ok, false);
  assert.equal(parseWorkflowState(content).staticScanPassed, false);
  // 安全扫描单独通过后，两项子判据（豁免 + 实测）皆满足
  writeStaticScanResult({
    gatePassed: false,
    duplication: { gatePassed: false, reason: 'scan-failed', command: 'jscpd .', exitCode: 1 },
    security: { gatePassed: true, reason: 'passed', command: 'gitleaks-secret-scanner', exitCode: 0 },
  });
  assert.equal(checkStaticScanClean().ok, true);
  assert.equal(parseWorkflowState(content).staticScanPassed, true);
  delete process.env.HARNESS_GATED_ARTIFACTS_PATH;
});
test('R16: 架构师声明 securityScanApplicability n/a + 用户确认 → 仅安全扫描豁免，重复代码仍须通过', () => {
  const content = fixtureProcess(SECURITY_EXEMPT_CONFIRM_PROCESS, {
    'docs/design/gated-security-na.json': SECURITY_NA_GATED,
  });
  process.env.HARNESS_GATED_ARTIFACTS_PATH = 'test-results/.gate-selftest/docs/design/gated-security-na.json';
  clearStaticScanResult();
  assert.equal(isSecurityScanExempt(content), true);
  assert.equal(isDupCheckExempt(content), false);
  assert.equal(checkStaticScanClean().ok, false);
  writeStaticScanResult({
    gatePassed: false,
    duplication: { gatePassed: true, reason: 'passed', command: 'jscpd .', exitCode: 0 },
    security: { gatePassed: false, reason: 'scan-failed', command: 'gitleaks-secret-scanner', exitCode: 1 },
  });
  assert.equal(checkStaticScanClean().ok, true);
  assert.equal(parseWorkflowState(content).staticScanPassed, true);
  delete process.env.HARNESS_GATED_ARTIFACTS_PATH;
});
test('R16: docs-only 模式 staticScanPassed 视为满足', () => {
  const content = '---\nworkflow_mode: docs-only\n---\n';
  clearStaticScanResult();
  assert.equal(parseWorkflowState(content).staticScanPassed, true);
});
restoreStaticScanResult();

cleanup();

console.log('');
console.log(`结果：${passCount} passed, ${failCount} failed`);
if (failCount > 0) {
  console.error('失败用例：');
  for (const f of failures) console.error(`  - ${f.name}: ${f.error}`);
  process.exit(1);
}
process.exit(0);
