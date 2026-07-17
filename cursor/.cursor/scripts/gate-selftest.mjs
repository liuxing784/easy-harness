#!/usr/bin/env node
/**
 * 门禁逻辑回归自检：覆盖 R3 / R6 / B1 / R9 / R10 / R11 / R13 / R14 / R15 / R16 / R17 / R18 最低必测集，
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
  checkBatchStorageReconciliationReport,
  isStorageReconciliationExempt,
  isE2eExempt,
  isLintExempt,
  readLintResult,
  checkLintClean,
  isDupCheckExempt,
  isSecurityScanExempt,
  readStaticScanResult,
  checkStaticScanClean,
  hasUnresolvedIssues,
  isProcessBlocked,
  checkDesignProblemListStructure,
  checkRequirementCoverageMatrix,
  extractP0RequirementIds,
  checkDesignReviewClean,
  checkTechSelectionConfirmed,
  checkDesignReviewConclusion,
  checkHotfixP0Impact,
  checkHotfixP0InterfaceStorageMention,
  recordHotfixP0SoftReminder,
  recordFailOpenEvent,
  hasResolvedDesignIssues,
  extractQeDispatchTaskPacks,
  getDevLineStatusForTaskPack,
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

// R15：lint 机读产物固定落盘于 test-results/qe/.lint-result.json（非 fixture 子树）；
// 自检期间快照/还原真实文件，避免污染宿主运行时产物。
const LINT_RESULT_PATH = path.join(PROJECT_ROOT, 'test-results/qe/.lint-result.json');
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

// R16：静态代码质量机读产物固定落盘于 test-results/qe/.static-scan-result.json（非 fixture 子树）；
// 自检期间快照/还原真实文件，避免污染宿主运行时产物。
const STATIC_SCAN_RESULT_PATH = path.join(PROJECT_ROOT, 'test-results/qe/.static-scan-result.json');
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
    '| 质量工程师 | T-1 | 执行完成 | |',
    '',
  ].join('\n');
  const state = parseWorkflowState(content);
  assert.equal(state.finalTestRequired, true, 'hotfix 只需 dev+QE 完成即视为需要（唯一一次）最终测试');
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

const R18_DIMS = [
  '需求覆盖度',
  '目标达成性',
  '功能',
  '体验',
  '可行性',
  'MVP 范围',
  '任务可执行性',
  '流程合规性',
  '架构设计原则',
  '成果物完整性',
  '测试可执行性',
  '安全与合规',
];
function makeCleanDplForSelftest(p0Ids = ['R-001']) {
  const header =
    '| 检查维度 | 问题描述 | 严重等级 | 是否存在 | 是否解决 | 关联成果物 | 关联需求编号 | 建议责任角色 | 修复建议 |';
  const sep = '| --- | --- | --- | --- | --- | --- | --- | --- | --- |';
  const dimRows = R18_DIMS.map((d) => `| ${d} | 无 | 低 | 否 | | | | | |`).join('\n');
  const covRows = p0Ids
    .map((id) => `| ${id} | P0 | AC-${id}-1 可验证 | detail-design-spec.md §2 | 用户可创建待办项 | T0-1 | 已覆盖 |`)
    .join('\n');
  return [
    '# 设计问题清单',
    '',
    '## 审核问题表',
    '',
    header,
    sep,
    dimRows,
    '',
    '## 需求覆盖矩阵',
    '',
    '| 需求编号 | 优先级 | 验收标准 | 设计落点 | 设计落点原文摘录 | 任务包 | 覆盖结论 |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    covRows,
    '',
    '## 审核结论',
    '',
    '| 审核轮次 | 结论 | 说明 |',
    '| --- | --- | --- |',
    '| 1 | 通过 | 首次审核无未解决问题 |',
    '',
  ].join('\n');
}
const SELFTEST_REQ_LIST =
  '| 需求编号 | 需求名称 | 需求描述 | 验收标准 | 需求优先级 | 来源确认 | 状态 |\n| --- | --- | --- | --- | --- | --- | --- |\n| R-001 | 示例 | 描述 | Given | P0 | 确认 | 已确认 |\n';
const SELFTEST_DPL_CLEAN = makeCleanDplForSelftest(['R-001']);
const SELFTEST_DPL_UNRESOLVED = [
  '# 设计问题清单',
  '',
  '## 审核问题表',
  '',
  '| 检查维度 | 问题描述 | 严重等级 | 是否存在 | 是否解决 | 关联成果物 | 关联需求编号 | 建议责任角色 | 修复建议 |',
  '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ...R18_DIMS.map((d) =>
    d === '功能'
      ? `| ${d} | 问题X | 高 | 是 | 否 | detail-design-spec.md | R-001 | system-architect | 补充边界说明 |`
      : `| ${d} | 无 | 低 | 否 | | | | | |`,
  ),
  '',
  '## 需求覆盖矩阵',
  '',
  '| 需求编号 | 优先级 | 验收标准 | 设计落点 | 设计落点原文摘录 | 任务包 | 覆盖结论 |',
  '| --- | --- | --- | --- | --- | --- | --- |',
  '| R-001 | P0 | AC-R-001-1 | detail-design-spec.md §2 | 用户可创建待办项 | T0-1 | 已覆盖 |',
  '',
  '## 审核结论',
  '',
  '| 审核轮次 | 结论 | 说明 |',
  '| --- | --- | --- |',
  '| 1 | 不通过 | 存在未解决问题 |',
  '',
].join('\n');

const SELFTEST_TECH_CONFIRM = [
  '## 用户确认记录',
  '',
  '| 确认项 | 时间 | 用户原话摘要 |',
  '| ------ | ---- | ------------ |',
  '| 需求摘要 | 2026-01-01 | 已确认 |',
  '| 技术选型 | 2026-01-01 | 确认采用 Node.js |',
  '',
].join('\n');

console.log('== R18：设计审核可修复性与需求覆盖机读 ==');
test('R18: extractP0RequirementIds 提取 P0', () => {
  assert.deepEqual(extractP0RequirementIds(SELFTEST_REQ_LIST), ['R-001']);
});
test('R18: 完整清洁清单结构通过', () => {
  assert.equal(checkDesignProblemListStructure(SELFTEST_DPL_CLEAN).ok, true);
});
test('R18: 缺少需求覆盖度维度时结构失败', () => {
  const bad = SELFTEST_DPL_CLEAN.replace('| 需求覆盖度 |', '| 其他维度 |');
  const r = checkDesignProblemListStructure(bad);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'missing-review-dimension');
});
test('R18: 未解决行缺修复建议时结构失败', () => {
  const bad = SELFTEST_DPL_UNRESOLVED.replace('补充边界说明', '');
  const r = checkDesignProblemListStructure(bad);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'unresolved-missing-fix');
});
test('R18: P0 覆盖矩阵通过', () => {
  assert.equal(
    checkRequirementCoverageMatrix(SELFTEST_DPL_CLEAN, SELFTEST_REQ_LIST).ok,
    true,
  );
});
test('R18: P0 未入矩阵时失败', () => {
  const bad = SELFTEST_DPL_CLEAN.replace('| R-001 | P0 |', '| R-999 | P0 |');
  const r = checkRequirementCoverageMatrix(bad, SELFTEST_REQ_LIST);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'p0-missing-in-matrix');
});
test('R18: P0 结论非已覆盖时失败', () => {
  const bad = SELFTEST_DPL_CLEAN.replace('已覆盖', '未覆盖');
  const r = checkRequirementCoverageMatrix(bad, SELFTEST_REQ_LIST);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'p0-not-covered');
});
test('R18: checkDesignReviewClean 在清洁清单+需求清单时通过', () => {
  fixtureProcess('---\nworkflow_mode: full\n---\n', {
    'docs/design/design-problem-list.md': SELFTEST_DPL_CLEAN,
    'docs/requirement/requirement-list.md': SELFTEST_REQ_LIST,
  });
  assert.equal(checkDesignReviewClean().ok, true);
});
test('R18: 缺少覆盖矩阵章节时 checkDesignReviewClean 失败', () => {
  const noMatrix = SELFTEST_DPL_CLEAN.replace('## 需求覆盖矩阵', '## 其他章节');
  fixtureProcess('---\nworkflow_mode: full\n---\n', {
    'docs/design/design-problem-list.md': noMatrix,
    'docs/requirement/requirement-list.md': SELFTEST_REQ_LIST,
  });
  const r = checkDesignReviewClean();
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'missing-coverage-matrix');
});
test('R18: 缺少验收标准列时覆盖矩阵失败', () => {
  const bad = SELFTEST_DPL_CLEAN
    .replace('| 需求编号 | 优先级 | 验收标准 | 设计落点 | 设计落点原文摘录 | 任务包 | 覆盖结论 |', '| 需求编号 | 优先级 | 设计落点 | 设计落点原文摘录 | 任务包 | 覆盖结论 |')
    .replace('| R-001 | P0 | AC-R-001-1 可验证 | detail-design-spec.md §2 | 用户可创建待办项 | T0-1 | 已覆盖 |', '| R-001 | P0 | detail-design-spec.md §2 | 用户可创建待办项 | T0-1 | 已覆盖 |');
  const r = checkRequirementCoverageMatrix(bad, SELFTEST_REQ_LIST);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'missing-acceptance-column');
});
test('R18: 缺少设计落点原文摘录列时覆盖矩阵失败', () => {
  const bad = SELFTEST_DPL_CLEAN
    .replace('| 需求编号 | 优先级 | 验收标准 | 设计落点 | 设计落点原文摘录 | 任务包 | 覆盖结论 |', '| 需求编号 | 优先级 | 验收标准 | 设计落点 | 任务包 | 覆盖结论 |')
    .replace('| R-001 | P0 | AC-R-001-1 可验证 | detail-design-spec.md §2 | 用户可创建待办项 | T0-1 | 已覆盖 |', '| R-001 | P0 | AC-R-001-1 可验证 | detail-design-spec.md §2 | T0-1 | 已覆盖 |');
  const r = checkRequirementCoverageMatrix(bad, SELFTEST_REQ_LIST);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'missing-excerpt-column');
});
test('R18: 设计落点原文摘录为空时覆盖矩阵失败', () => {
  const bad = SELFTEST_DPL_CLEAN.replace(
    '| R-001 | P0 | AC-R-001-1 可验证 | detail-design-spec.md §2 | 用户可创建待办项 | T0-1 | 已覆盖 |',
    '| R-001 | P0 | AC-R-001-1 可验证 | detail-design-spec.md §2 | | T0-1 | 已覆盖 |',
  );
  const r = checkRequirementCoverageMatrix(bad, SELFTEST_REQ_LIST);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'p0-empty-design-excerpt');
});
test('R18: 缺少审核结论时 checkDesignReviewClean 失败', () => {
  const noConclusion = SELFTEST_DPL_CLEAN.replace('## 审核结论', '## 其他结论');
  fixtureProcess('---\nworkflow_mode: full\n---\n', {
    'docs/design/design-problem-list.md': noConclusion,
    'docs/requirement/requirement-list.md': SELFTEST_REQ_LIST,
  });
  const r = checkDesignReviewClean();
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'missing-review-conclusion');
});
test('R18: 已解决问题但结论非复审通过时失败', () => {
  const resolved = SELFTEST_DPL_UNRESOLVED
    .replace('| 是 | 否 |', '| 是 | 是 |')
    .replace('| 1 | 不通过 | 存在未解决问题 |', '| 1 | 通过 | SA 已修复但未复审 |');
  assert.equal(hasResolvedDesignIssues(resolved), true);
  const r = checkDesignReviewConclusion(resolved);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'rereview-required');
});
test('R18: 已解决问题且复审通过时结论校验通过', () => {
  const resolved = SELFTEST_DPL_UNRESOLVED
    .replace('| 是 | 否 |', '| 是 | 是 |')
    .replace(
      '| 1 | 不通过 | 存在未解决问题 |',
      '| 1 | 不通过 | 首次\n| 2 | 复审通过 | SA 返工后复审 |',
    );
  assert.equal(checkDesignReviewConclusion(resolved).ok, true);
});
test('R18: checkTechSelectionConfirmed 识别技术选型确认', () => {
  assert.equal(checkTechSelectionConfirmed(SELFTEST_TECH_CONFIRM).ok, true);
  assert.equal(
    checkTechSelectionConfirmed('## 用户确认记录\n\n| 确认项 | 时间 | 用户原话摘要 |\n| --- | --- | --- |\n| 需求摘要 | 2026-01-01 | 已确认 |\n')
      .ok,
    false,
  );
});
test('R9: hotfix_p0_impact 未声明时失败', () => {
  const content = fixtureProcess('---\nworkflow_mode: hotfix\n---\n', {
    'docs/design/detail-design-spec.md': '# design',
  });
  const r = checkHotfixP0Impact(content);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'hotfix-p0-impact-unset');
});
test('R9: hotfix_p0_impact=none 缺判断依据留痕时失败', () => {
  const content = fixtureProcess(
    [
      '---',
      'workflow_mode: hotfix',
      'hotfix_p0_impact: none',
      '---',
      '',
      SELFTEST_TECH_CONFIRM,
    ].join('\n'),
    {
      'docs/design/detail-design-spec.md': '# design',
    },
  );
  const r = checkHotfixP0Impact(content);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'hotfix-none-justification-missing');
});
test('R9: hotfix_p0_impact=none 且有判断依据留痕时通过', () => {
  const content = fixtureProcess(
    [
      '---',
      'workflow_mode: hotfix',
      'hotfix_p0_impact: none',
      '---',
      '',
      '## 用户确认记录',
      '',
      '| 确认项 | 时间 | 用户原话摘要 |',
      '| ------ | ---- | ------------ |',
      '| hotfix影响面 | 2026-01-01 | 已比对 requirement-list.md 全部 P0，本次修复仅涉及日志格式，不改变任何 P0 行为 |',
      '',
    ].join('\n'),
    {
      'docs/design/detail-design-spec.md': '# design',
    },
  );
  assert.equal(checkHotfixP0Impact(content).ok, true);
});
test('R9: hotfix_p0_impact=p0 且无 R18 通过时失败', () => {
  const content = fixtureProcess('---\nworkflow_mode: hotfix\nhotfix_p0_impact: p0\n---\n', {
    'docs/design/detail-design-spec.md': '# design',
  });
  const r = checkHotfixP0Impact(content);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'hotfix-p0-needs-rr');
});
console.log('== R9 软性提醒：P0 影响 hotfix 的本次报告结构化章节检测（非阻塞）==');
const HOTFIX_STRUCTURED_API_STORAGE_REPORT = [
  '# 测试报告',
  '',
  '## 接口测试报告',
  '',
  '| 接口 | 请求方法 | 关联需求 | 关联任务包 | 是否通过 |',
  '| ---- | -------- | -------- | ---------- | -------- |',
  '| /api/hotfix | POST | R-001 | T-1 | 是 |',
  '',
  '## 存储对账记录',
  '',
  '| 场景类型 | 关联需求 | 关联任务包 | 存储介质 | 对账方式 | 预期存储结果 | 实际存储结果 | 是否通过 | 备注 |',
  '| -------- | -------- | ---------- | -------- | -------- | ------------ | ------------ | -------- | ---- |',
  '| 接口 | R-001 | T-1 | 数据库 | SELECT 1 | 有行 | 有行 | 是 | |',
  '',
].join('\n');
test('R9 软性提醒: 非 hotfix 时不适用', () => {
  const content = fixtureProcess('---\nworkflow_mode: full\n---\n');
  assert.equal(checkHotfixP0InterfaceStorageMention(content).applicable, false);
});
test('R9 软性提醒: hotfix 但 hotfix_p0_impact=none 时不适用', () => {
  const content = fixtureProcess('---\nworkflow_mode: hotfix\nhotfix_p0_impact: none\n---\n');
  assert.equal(checkHotfixP0InterfaceStorageMention(content).applicable, false);
});
test('R9 软性提醒: hotfix_p0_impact=p0 但本次报告缺结构化接口/存储章节时 needsReminder=true', () => {
  const content = fixtureProcess('---\nworkflow_mode: hotfix\nhotfix_p0_impact: p0\n---\n', {
    'docs/test/test-report.md': '# 测试报告\n\n## 集成测试记录\n\n全部通过。\n',
  });
  const r = checkHotfixP0InterfaceStorageMention(content);
  assert.equal(r.applicable, true);
  assert.equal(r.mentionsInterface, false);
  assert.equal(r.mentionsStorage, false);
  assert.equal(r.needsReminder, true);
});
test('R9 软性提醒: 本次 test-report.md 含结构化章节真实数据行时 needsReminder=false', () => {
  const content = fixtureProcess('---\nworkflow_mode: hotfix\nhotfix_p0_impact: p0\n---\n', {
    'docs/test/test-report.md': HOTFIX_STRUCTURED_API_STORAGE_REPORT,
  });
  const r = checkHotfixP0InterfaceStorageMention(content);
  assert.equal(r.mentionsInterface, true);
  assert.equal(r.mentionsStorage, true);
  assert.equal(r.needsReminder, false);
});
test('R9 软性提醒: 仅有关键词而无真实数据行时仍 needsReminder=true', () => {
  const content = fixtureProcess('---\nworkflow_mode: hotfix\nhotfix_p0_impact: p0\n---\n', {
    'docs/test/test-report.md':
      '# 测试报告\n\n## 接口测试报告\n\n已核对接口契约无变化。\n\n## 存储对账记录\n\n已完成存储对账，结果一致。\n',
  });
  const r = checkHotfixP0InterfaceStorageMention(content);
  assert.equal(r.mentionsInterface, false);
  assert.equal(r.mentionsStorage, false);
  assert.equal(r.needsReminder, true);
});
test('R9 软性提醒: 历史无关报告中的结构化章节不得抑制本次提醒', () => {
  const content = fixtureProcess('---\nworkflow_mode: hotfix\nhotfix_p0_impact: p0\n---\n', {
    'docs/test/old-history.md': HOTFIX_STRUCTURED_API_STORAGE_REPORT,
    'docs/test/test-report.md': '# 测试报告\n\n## 集成测试记录\n\n全部通过。\n',
  });
  const r = checkHotfixP0InterfaceStorageMention(content);
  assert.equal(r.needsReminder, true, '历史报告不得抑制本次 test-report.md 的提醒');
});
test('R9 软性提醒: recordHotfixP0SoftReminder 命中时写入一次性非阻塞记录', () => {
  const content = fixtureProcess(
    ['---', 'workflow_mode: hotfix', 'hotfix_p0_impact: p0', 'blocking: false', 'cancelled: false', '---', ''].join(
      '\n',
    ),
    {
      'docs/test/test-report.md': '# 测试报告\n\n## 集成测试记录\n\n全部通过。\n',
    },
  );
  const r = recordHotfixP0SoftReminder(content);
  assert.equal(r.ok, true);
  assert.equal(r.reason, 'recorded');
  const md = fs.readFileSync(process.env.HARNESS_PROCESS_PATH, 'utf8');
  assert.match(md, /## 门禁软性提醒（非阻塞）/);
  assert.match(md, /接口测试报告|存储对账记录/);
  // blocking 不应被本机制置为 true（区别于 recordFailOpenEvent 的 fail-open 语义）
  assert.doesNotMatch(md, /blocking:\s*true/);
});
test('R9 软性提醒: recordHotfixP0SoftReminder 幂等——同一 process.md 不重复写入', () => {
  const content = fixtureProcess(
    ['---', 'workflow_mode: hotfix', 'hotfix_p0_impact: p0', 'blocking: false', 'cancelled: false', '---', ''].join(
      '\n',
    ),
    {
      'docs/test/test-report.md': '# 测试报告\n\n## 集成测试记录\n\n全部通过。\n',
    },
  );
  recordHotfixP0SoftReminder(content);
  const first = fs.readFileSync(process.env.HARNESS_PROCESS_PATH, 'utf8');
  const r2 = recordHotfixP0SoftReminder(content);
  assert.equal(r2.ok, true);
  assert.equal(r2.reason, 'already-recorded');
  const second = fs.readFileSync(process.env.HARNESS_PROCESS_PATH, 'utf8');
  assert.equal(first, second, '第二次调用不应再追加内容');
});
test('R9 软性提醒: 不满足条件（needsReminder=false）时不写入', () => {
  const content = fixtureProcess(
    ['---', 'workflow_mode: hotfix', 'hotfix_p0_impact: p0', 'blocking: false', 'cancelled: false', '---', ''].join(
      '\n',
    ),
    {
      'docs/test/test-report.md': HOTFIX_STRUCTURED_API_STORAGE_REPORT,
    },
  );
  const r = recordHotfixP0SoftReminder(content);
  assert.equal(r.ok, true);
  assert.equal(r.reason, 'not-needed');
  const md = fs.readFileSync(process.env.HARNESS_PROCESS_PATH, 'utf8');
  assert.doesNotMatch(md, /## 门禁软性提醒/);
});
test('R9 软性提醒: cancelled 流程不写入', () => {
  const content = fixtureProcess(
    ['---', 'workflow_mode: hotfix', 'hotfix_p0_impact: p0', 'cancelled: true', '---', ''].join('\n'),
    {
      'docs/test/test-report.md': '# 测试报告\n\n全部通过。\n',
    },
  );
  const r = recordHotfixP0SoftReminder(content);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'cancelled');
});

test('§8.4: recordFailOpenEvent 写入 blocking 与门禁异常事件', () => {
  fixtureProcess(
    [
      '---',
      'workflow_mode: full',
      'blocking: false',
      'cancelled: false',
      '---',
      '',
      '## 阻塞原因',
      '',
      '无',
      '',
    ].join('\n'),
  );
  const r = recordFailOpenEvent('gate-selftest', 'runtime', new Error('boom'));
  assert.equal(r.ok, true);
  const md = fs.readFileSync(process.env.HARNESS_PROCESS_PATH, 'utf8');
  assert.match(md, /blocking:\s*true/);
  assert.match(md, /## 门禁异常事件/);
  assert.match(md, /gate-selftest/);
  assert.match(md, /boom/);
});
test('§8.4: cancelled 流程不写 fail-open 事件', () => {
  fixtureProcess('---\nworkflow_mode: full\ncancelled: true\nblocking: false\n---\n');
  const r = recordFailOpenEvent('gate-selftest', 'runtime', new Error('boom'));
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'cancelled');
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
      SELFTEST_TECH_CONFIRM,
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
      'docs/design/design-problem-list.md': SELFTEST_DPL_UNRESOLVED,
      'docs/requirement/requirement-list.md': SELFTEST_REQ_LIST,
    },
  );
  const result = checkRoleDispatchGate('development-engineer');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'unresolved-design-issues');
});
test('R13: 设计审核通过 + 有效分派计划时允许发起 development-engineer', () => {
  fixtureProcess(
    [
      '---',
      'workflow_mode: full',
      '---',
      '',
      SELFTEST_TECH_CONFIRM,
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
      'docs/design/design-problem-list.md': SELFTEST_DPL_CLEAN,
      'docs/requirement/requirement-list.md': SELFTEST_REQ_LIST,
    },
  );
  const result = checkRoleDispatchGate('development-engineer');
  assert.equal(result.ok, true);
});
test('R13: 缺少技术选型确认时禁止发起 development-engineer', () => {
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
      '| 需求摘要 | 2026-01-01 | 已确认 |',
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
      'docs/design/design-problem-list.md': SELFTEST_DPL_CLEAN,
      'docs/requirement/requirement-list.md': SELFTEST_REQ_LIST,
    },
  );
  const result = checkRoleDispatchGate('development-engineer');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'no-tech-selection-confirmation');
});
test('R13: 缺少技术选型确认时禁止发起 requirement-reviewer', () => {
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
      '| 需求摘要 | 2026-01-01 | 已确认 |',
      '',
    ].join('\n'),
    {
      'docs/design/detail-design-spec.md': '# design',
      'docs/design/develop-task-list.md': '# tasks',
    },
  );
  const result = checkRoleDispatchGate('requirement-reviewer');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'no-tech-selection-confirmation');
});

console.log('== R13：quality-engineer 按任务包核验开发线执行完成 ==');
function makeQeDispatchProcess({ progressRows, planRole = 'quality-engineer', planPack = 'T0-1', pending = true }) {
  const pendingBlock = pending
    ? [
        '## 待派发角色列表',
        '',
        '| 角色 | 说明 |',
        '| ---- | ---- |',
        `| quality-engineer | ${planPack} |`,
        '',
      ].join('\n')
    : '';
  return [
    '---',
    'workflow_mode: full',
    '---',
    '',
    '## 当前分派计划',
    '',
    '| 任务包编号 | 分派角色 | 并行/串行 | 状态 |',
    '| ---------- | -------- | --------- | ---- |',
    `| ${planPack} | ${planRole} | 串行 | 待 QE |`,
    '',
    pendingBlock,
    '## 进度列表',
    '',
    '| 角色/开发线 | 任务名称 | 状态 | 说明 |',
    '| ----------- | -------- | ---- | ---- |',
    ...progressRows,
    '',
  ].join('\n');
}
test('R13 QE: extractQeDispatchTaskPacks 从分派计划提取任务包', () => {
  const content = makeQeDispatchProcess({
    progressRows: ['| 开发工程师 | T0-1 | 执行完成 | |'],
  });
  assert.deepEqual(extractQeDispatchTaskPacks(content), ['T0-1']);
});
test('R13 QE: 开发线正在执行时拒绝发起 quality-engineer', () => {
  fixtureProcess(
    makeQeDispatchProcess({
      progressRows: ['| 开发工程师 | T0-1 | 正在执行 | |'],
    }),
  );
  const r = checkRoleDispatchGate('quality-engineer');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'qe-dev-line-not-complete');
});
test('R13 QE: 分派计划缺 QE 任务包编号时拒绝', () => {
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
      '## 进度列表',
      '',
      '| 角色/开发线 | 任务名称 | 状态 | 说明 |',
      '| ----------- | -------- | ---- | ---- |',
      '| 开发工程师 | T0-1 | 执行完成 | |',
      '',
    ].join('\n'),
  );
  const r = checkRoleDispatchGate('quality-engineer');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'qe-missing-task-packs');
});
test('R13 QE: 对应开发线执行完成且分派含任务包时允许发起 quality-engineer', () => {
  fixtureProcess(
    makeQeDispatchProcess({
      progressRows: ['| 开发工程师 | T0-1 | 执行完成 | |'],
    }),
  );
  const r = checkRoleDispatchGate('quality-engineer');
  assert.equal(r.ok, true);
  assert.equal(getDevLineStatusForTaskPack(fs.readFileSync(process.env.HARNESS_PROCESS_PATH, 'utf8'), 'T0-1'), 'complete');
});
test('R13 QE: 多任务包时任一未完成即拒绝', () => {
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
      '| T0-1 | quality-engineer | 并行 | 待 QE |',
      '| T0-2 | quality-engineer | 并行 | 待 QE |',
      '',
      '## 待派发角色列表',
      '',
      '| 角色 | 说明 |',
      '| ---- | ---- |',
      '| quality-engineer | T0-1 T0-2 批量审查 |',
      '',
      '## 进度列表',
      '',
      '| 角色/开发线 | 任务名称 | 状态 | 说明 |',
      '| ----------- | -------- | ---- | ---- |',
      '| 开发工程师 | T0-1 | 执行完成 | |',
      '| 开发工程师 | T0-2 | 正在执行 | |',
      '',
    ].join('\n'),
  );
  const r = checkRoleDispatchGate('quality-engineer');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'qe-dev-line-not-complete');
  assert.match(r.message, /T0-2/);
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
  '| 质量工程师 | T0-1 | 执行完成 | |',
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
      '| 质量工程师 | T-1 | 执行完成 | |',
      '',
    ].join('\n'),
  );
  assert.equal(parseWorkflowState(content).batchTestComplete, true);
});

console.log('== R17：业务数据存储对账机读判据 ==');
const STORAGE_RECON_HEADER =
  '| 场景类型 | 关联需求 | 关联任务包 | 存储介质 | 对账方式 | 预期存储结果 | 实际存储结果 | 是否通过 | 备注 |';
const STORAGE_RECON_SEP =
  '| -------- | -------- | ---------- | -------- | -------- | ------------ | ------------ | -------- | ---- |';
const STORAGE_RECON_BOTH = [
  '# 测试报告',
  '',
  '## 存储对账记录',
  '',
  STORAGE_RECON_HEADER,
  STORAGE_RECON_SEP,
  '| 接口 | R-001 | T0-1 | 数据库 | SELECT id FROM todos | 有行 | 有行 | 是 | |',
  '| E2E | R-001 | T0-1 | 缓存 | Redis GET todo:1 | 有值 | 有值 | 是 | |',
  '',
].join('\n');
const STORAGE_RECON_API_ONLY = [
  '# 测试报告',
  '',
  '## 存储对账记录',
  '',
  STORAGE_RECON_HEADER,
  STORAGE_RECON_SEP,
  '| 接口 | R-001 | T0-1 | 文件 | 读 /data/out.json | 存在 | 存在 | 是 | |',
  '',
].join('\n');
const STORAGE_RECON_E2E_ONLY = [
  '# 测试报告',
  '',
  '## 存储对账记录',
  '',
  STORAGE_RECON_HEADER,
  STORAGE_RECON_SEP,
  '| E2E | R-001 | T0-1 | 对象存储 | S3 headObject | 存在 | 存在 | 是 | |',
  '',
].join('\n');
const STORAGE_RECON_BAD_MEDIUM = [
  '# 测试报告',
  '',
  '## 存储对账记录',
  '',
  STORAGE_RECON_HEADER,
  STORAGE_RECON_SEP,
  '| 接口 | R-001 | T0-1 | PostgreSQL | SELECT 1 | 有行 | 有行 | 是 | |',
  '| E2E | R-001 | T0-1 | 内存变量 | 看变量 | 有值 | 有值 | 是 | |',
  '',
].join('\n');
const STORAGE_RECON_EMPTY = [
  '# 测试报告',
  '',
  '## 存储对账记录',
  '',
  STORAGE_RECON_HEADER,
  STORAGE_RECON_SEP,
  '',
].join('\n');

test('R17: 缺少存储对账记录章节时校验失败', () => {
  fixtureProcess(R14_PROGRESS_BATCH_DONE, {
    'docs/test/test-report.md': '# 测试报告\n\n## 接口测试报告\n\n| 接口 | 是否通过 |\n| ---- | -------- |\n| /a | 是 |\n',
  });
  assert.equal(checkBatchStorageReconciliationReport().ok, false);
});
test('R17: 存储对账章节为空（仅表头）时校验失败', () => {
  fixtureProcess(R14_PROGRESS_BATCH_DONE, {
    'docs/test/test-report.md': STORAGE_RECON_EMPTY,
  });
  assert.equal(checkBatchStorageReconciliationReport().ok, false);
});
test('R17: 缺 E2E 场景类型行时校验失败（未豁免 E2E）', () => {
  fixtureProcess(R14_PROGRESS_BATCH_DONE, {
    'docs/test/test-report.md': STORAGE_RECON_API_ONLY,
  });
  const r = checkBatchStorageReconciliationReport();
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'missing-e2e-scene-row');
});
test('R17: 缺接口场景类型行时校验失败（未豁免 R14）', () => {
  fixtureProcess(R14_PROGRESS_BATCH_DONE, {
    'docs/test/test-report.md': STORAGE_RECON_E2E_ONLY,
  });
  const r = checkBatchStorageReconciliationReport();
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'missing-api-scene-row');
});
test('R17: 存储介质列无合法关键词时校验失败', () => {
  fixtureProcess(R14_PROGRESS_BATCH_DONE, {
    'docs/test/test-report.md': STORAGE_RECON_BAD_MEDIUM,
  });
  const r = checkBatchStorageReconciliationReport();
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'invalid-storage-medium');
});
test('R17: 接口+E2E 行且介质合法（数据库/缓存）时校验通过', () => {
  fixtureProcess(R14_PROGRESS_BATCH_DONE, {
    'docs/test/test-report.md': STORAGE_RECON_BOTH,
  });
  assert.equal(checkBatchStorageReconciliationReport().ok, true);
});
test('R17: 文件与对象存储介质关键词可识别', () => {
  const mixed = [
    '# 测试报告',
    '',
    '## 存储对账记录',
    '',
    STORAGE_RECON_HEADER,
    STORAGE_RECON_SEP,
    '| 接口 | R-001 | T0-1 | filesystem | 读盘 | 存在 | 存在 | 是 | |',
    '| E2E | R-001 | T0-1 | s3 | head | 存在 | 存在 | 是 | |',
    '',
  ].join('\n');
  fixtureProcess(R14_PROGRESS_BATCH_DONE, { 'docs/test/test-report.md': mixed });
  assert.equal(checkBatchStorageReconciliationReport().ok, true);
});
test('R17: 「其他」介质缺备注时校验失败', () => {
  const otherNoNote = [
    '# 测试报告',
    '',
    '## 存储对账记录',
    '',
    STORAGE_RECON_HEADER,
    STORAGE_RECON_SEP,
    '| 接口 | R-001 | T0-1 | 其他 | 查外部系统 | 有记录 | 有记录 | 是 | |',
    '| E2E | R-001 | T0-1 | 数据库 | SELECT 1 | 有行 | 有行 | 是 | |',
    '',
  ].join('\n');
  fixtureProcess(R14_PROGRESS_BATCH_DONE, { 'docs/test/test-report.md': otherNoNote });
  const r = checkBatchStorageReconciliationReport();
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'other-medium-requires-note');
});
test('R17: 「其他」介质含非空备注时校验通过', () => {
  const otherWithNote = [
    '# 测试报告',
    '',
    '## 存储对账记录',
    '',
    STORAGE_RECON_HEADER,
    STORAGE_RECON_SEP,
    '| 接口 | R-001 | T0-1 | 其他 | 查外部系统 | 有记录 | 有记录 | 是 | 业务落盘至自建消息队列 MQ-X |',
    '| E2E | R-001 | T0-1 | 数据库 | SELECT 1 | 有行 | 有行 | 是 | |',
    '',
  ].join('\n');
  fixtureProcess(R14_PROGRESS_BATCH_DONE, { 'docs/test/test-report.md': otherWithNote });
  assert.equal(checkBatchStorageReconciliationReport().ok, true);
});
test('R17: 描述列（对账方式/预期/实际/是否通过）为空时校验失败', () => {
  const missingDesc = [
    '# 测试报告',
    '',
    '## 存储对账记录',
    '',
    STORAGE_RECON_HEADER,
    STORAGE_RECON_SEP,
    '| 接口 | R-001 | T0-1 | 数据库 | | 有行 | 有行 | 是 | |',
    '| E2E | R-001 | T0-1 | 缓存 | Redis GET | 有值 | 有值 | 是 | |',
    '',
  ].join('\n');
  fixtureProcess(R14_PROGRESS_BATCH_DONE, { 'docs/test/test-report.md': missingDesc });
  const r = checkBatchStorageReconciliationReport();
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'missing-recon-method');
});
test('R17: 关联任务包为空时校验失败', () => {
  const missingTask = [
    '# 测试报告',
    '',
    '## 存储对账记录',
    '',
    STORAGE_RECON_HEADER,
    STORAGE_RECON_SEP,
    '| 接口 | R-001 | | 数据库 | SELECT 1 | 有行 | 有行 | 是 | |',
    '| E2E | R-001 | T0-1 | 缓存 | Redis GET | 有值 | 有值 | 是 | |',
    '',
  ].join('\n');
  fixtureProcess(R14_PROGRESS_BATCH_DONE, { 'docs/test/test-report.md': missingTask });
  const r = checkBatchStorageReconciliationReport();
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'missing-task-package');
});
test('R17: 多批次进度任务包须全部被对账行覆盖（仅覆盖首批不够）', () => {
  const multiBatchProgress = [
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
    '| 质量工程师 | T0-1 | 执行完成 | |',
    '| 测试工程师 | 批次集成测试 T0-1 | 执行完成 | |',
    '| 开发工程师 | T0-2 | 执行完成 | |',
    '| 质量工程师 | T0-2 | 执行完成 | |',
    '| 测试工程师 | 批次集成测试 T0-2 | 执行完成 | |',
    '',
  ].join('\n');
  // 仅覆盖 T0-1，缺 T0-2
  fixtureProcess(multiBatchProgress, { 'docs/test/test-report.md': STORAGE_RECON_BOTH });
  const r = checkBatchStorageReconciliationReport();
  assert.equal(r.ok, false);
  assert.match(r.reason, /^missing-batch-task-coverage:/);
  assert.match(r.reason, /T0-2/);
});
test('R17: 多批次任务包均有对账行时校验通过', () => {
  const multiBatchProgress = [
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
    '| 质量工程师 | T0-1 | 执行完成 | |',
    '| 测试工程师 | 批次集成测试 T0-1 | 执行完成 | |',
    '| 开发工程师 | T0-2 | 执行完成 | |',
    '| 质量工程师 | T0-2 | 执行完成 | |',
    '| 测试工程师 | 批次集成测试 T0-2 | 执行完成 | |',
    '',
  ].join('\n');
  const bothBatches = [
    '# 测试报告',
    '',
    '## 存储对账记录',
    '',
    STORAGE_RECON_HEADER,
    STORAGE_RECON_SEP,
    '| 接口 | R-001 | T0-1 | 数据库 | SELECT | 有行 | 有行 | 是 | |',
    '| E2E | R-001 | T0-1 | 缓存 | Redis GET | 有值 | 有值 | 是 | |',
    '| 接口 | R-002 | T0-2 | 数据库 | SELECT | 有行 | 有行 | 是 | |',
    '| E2E | R-002 | T0-2 | 文件 | 读盘 | 存在 | 存在 | 是 | |',
    '',
  ].join('\n');
  fixtureProcess(multiBatchProgress, { 'docs/test/test-report.md': bothBatches });
  assert.equal(checkBatchStorageReconciliationReport().ok, true);
});
test('R17: 「不适用」介质缺备注时校验失败', () => {
  const naNoNote = [
    '# 测试报告',
    '',
    '## 存储对账记录',
    '',
    STORAGE_RECON_HEADER,
    STORAGE_RECON_SEP,
    '| 接口 | R-001 | T0-1 | 数据库 | SELECT 1 | 有行 | 有行 | 是 | |',
    '| E2E | R-001 | T0-1 | 不适用 | 不适用 | 不适用 | 不适用 | 不适用 | |',
    '',
  ].join('\n');
  fixtureProcess(R14_PROGRESS_BATCH_DONE, { 'docs/test/test-report.md': naNoNote });
  const r = checkBatchStorageReconciliationReport();
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'na-medium-requires-note');
});
test('R17: 仅有接口/E2E「不适用」行时校验失败（不能代替真实对账）', () => {
  const onlyNa = [
    '# 测试报告',
    '',
    '## 存储对账记录',
    '',
    STORAGE_RECON_HEADER,
    STORAGE_RECON_SEP,
    '| 接口 | R-001 | T0-1 | 不适用 | 不适用 | 不适用 | 不适用 | 不适用 | 本任务包无业务数据写入，不适用对账 |',
    '| E2E | R-001 | T0-1 | 不适用 | 不适用 | 不适用 | 不适用 | 不适用 | 本任务包无业务数据写入，不适用对账 |',
    '',
  ].join('\n');
  fixtureProcess(R14_PROGRESS_BATCH_DONE, { 'docs/test/test-report.md': onlyNa });
  const r = checkBatchStorageReconciliationReport();
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'missing-applicable-recon-row');
});
test('R17: 「不适用」行不计入分类型真实对账（仅有不适用接口行 + 适用 E2E 行仍缺接口）', () => {
  const naApiOnly = [
    '# 测试报告',
    '',
    '## 存储对账记录',
    '',
    STORAGE_RECON_HEADER,
    STORAGE_RECON_SEP,
    '| 接口 | R-001 | T0-1 | 不适用 | 不适用 | 不适用 | 不适用 | 不适用 | 本任务包无业务数据写入，不适用对账 |',
    '| E2E | R-001 | T0-1 | 数据库 | SELECT 1 | 有行 | 有行 | 是 | |',
    '',
  ].join('\n');
  fixtureProcess(R14_PROGRESS_BATCH_DONE, { 'docs/test/test-report.md': naApiOnly });
  const r = checkBatchStorageReconciliationReport();
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'missing-api-scene-row');
});
test('R17: 真实对账行 + 无写入任务包「不适用」留痕时校验通过', () => {
  const multiBatchProgress = [
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
    '| 质量工程师 | T0-1 | 执行完成 | |',
    '| 测试工程师 | 批次集成测试 T0-1 | 执行完成 | |',
    '| 开发工程师 | T0-2 | 执行完成 | |',
    '| 质量工程师 | T0-2 | 执行完成 | |',
    '| 测试工程师 | 批次集成测试 T0-2 | 执行完成 | |',
    '',
  ].join('\n');
  const mixed = [
    '# 测试报告',
    '',
    '## 存储对账记录',
    '',
    STORAGE_RECON_HEADER,
    STORAGE_RECON_SEP,
    '| 接口 | R-001 | T0-1 | 数据库 | SELECT | 有行 | 有行 | 是 | |',
    '| E2E | R-001 | T0-1 | 缓存 | Redis GET | 有值 | 有值 | 是 | |',
    '| 接口 | R-002 | T0-2 | 不适用 | 不适用 | 不适用 | 不适用 | 不适用 | 本任务包无业务数据写入，不适用对账 |',
    '',
  ].join('\n');
  fixtureProcess(multiBatchProgress, { 'docs/test/test-report.md': mixed });
  assert.equal(checkBatchStorageReconciliationReport().ok, true);
});
test('R17: 缺存储对账时 batchTestComplete=false', () => {
  const content = fixtureProcess(R14_PROGRESS_BATCH_DONE, {
    'docs/test/test-report.md': API_REPORT_FILLED,
  });
  const state = parseWorkflowState(content);
  assert.equal(state.batchApiReportPresent, true);
  assert.equal(state.batchStorageReconPresent, false);
  assert.equal(state.batchTestComplete, false);
});

console.log('== R17：无业务数据持久化适用性豁免（双要素）==');
const STORAGE_EXEMPT_CONFIRM_PROCESS = [
  '---',
  'workflow_mode: full',
  'iterationType: greenfield',
  '---',
  '',
  '## 用户确认记录',
  '',
  '| 确认项 | 时间 | 用户原话摘要 |',
  '| ------ | ---- | ------------ |',
  '| 存储对账豁免 | 2026-01-01 | 纯算法库无持久化，确认豁免存储对账 |',
  '',
  '## 进度列表',
  '',
  '| 角色/开发线 | 任务名称 | 状态 | 说明 |',
  '| ----------- | -------- | ---- | ---- |',
  '| 开发工程师 | T0-1 | 执行完成 | |',
  '',
].join('\n');
const STORAGE_NA_GATED =
  '{ "storageReconciliationApplicability": "n/a", "storageReconciliationApplicabilityReason": "无业务数据持久化" }\n';

test('R17: 仅用户确认但架构师未声明 n/a → 不豁免', () => {
  const content = fixtureProcess(STORAGE_EXEMPT_CONFIRM_PROCESS, {
    'docs/design/none.json': '{}\n',
  });
  process.env.HARNESS_GATED_ARTIFACTS_PATH = 'test-results/.gate-selftest/docs/design/none.json';
  assert.equal(isStorageReconciliationExempt(content), false);
});
test('R17: 仅架构师声明 n/a 但无用户确认 → 不豁免', () => {
  const content = fixtureProcess(
    ['---', 'workflow_mode: full', 'iterationType: greenfield', '---', ''].join('\n'),
    { 'docs/design/gated-storage-na.json': STORAGE_NA_GATED },
  );
  process.env.HARNESS_GATED_ARTIFACTS_PATH =
    'test-results/.gate-selftest/docs/design/gated-storage-na.json';
  assert.equal(isStorageReconciliationExempt(content), false);
});
test('R17: 架构师声明 n/a + 用户确认 → 豁免，batchStorageReconPresent 视为满足', () => {
  const content = fixtureProcess(STORAGE_EXEMPT_CONFIRM_PROCESS, {
    'docs/design/gated-storage-na.json': STORAGE_NA_GATED,
  });
  process.env.HARNESS_GATED_ARTIFACTS_PATH =
    'test-results/.gate-selftest/docs/design/gated-storage-na.json';
  assert.equal(isStorageReconciliationExempt(content), true);
  const state = parseWorkflowState(content);
  assert.equal(state.storageReconciliationExempt, true);
  assert.equal(state.batchStorageReconPresent, true);
});
test('R17: API 豁免后仅需 E2E 对账行即可通过机读', () => {
  const content = fixtureProcess(API_EXEMPT_CONFIRM_PROCESS, {
    'docs/design/gated-na.json': API_NA_GATED,
    'docs/test/test-report.md': STORAGE_RECON_E2E_ONLY,
  });
  process.env.HARNESS_GATED_ARTIFACTS_PATH = 'test-results/.gate-selftest/docs/design/gated-na.json';
  assert.equal(isApiTestExempt(content), true);
  assert.equal(checkBatchStorageReconciliationReport(content).ok, true);
});
test('R17: E2E 豁免后仅需接口对账行即可通过机读', () => {
  const e2eExemptProcess = [
    '---',
    'workflow_mode: full',
    'iterationType: greenfield',
    '---',
    '',
    '## 用户确认记录',
    '',
    '| 确认项 | 时间 | 用户原话摘要 |',
    '| ------ | ---- | ------------ |',
    '| E2E豁免 | 2026-01-01 | 纯后端无 UI，确认豁免 E2E |',
    '',
    '## 进度列表',
    '',
    '| 角色/开发线 | 任务名称 | 状态 | 说明 |',
    '| ----------- | -------- | ---- | ---- |',
    '| 开发工程师 | T0-1 | 执行完成 | |',
    '',
  ].join('\n');
  const e2eNaGated = '{ "e2eApplicability": "n/a", "e2eApplicabilityReason": "无 UI" }\n';
  const content = fixtureProcess(e2eExemptProcess, {
    'docs/design/gated-e2e-na.json': e2eNaGated,
    'docs/test/test-report.md': STORAGE_RECON_API_ONLY,
  });
  process.env.HARNESS_GATED_ARTIFACTS_PATH =
    'test-results/.gate-selftest/docs/design/gated-e2e-na.json';
  assert.equal(isE2eExempt(content), true);
  assert.equal(checkBatchStorageReconciliationReport(content).ok, true);
});
test('R17: hotfix 折叠通道不并入存储对账判据（batchTestComplete 恒真）', () => {
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
      '',
    ].join('\n'),
  );
  assert.equal(parseWorkflowState(content).batchTestComplete, true);
});
delete process.env.HARNESS_GATED_ARTIFACTS_PATH;

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
const R15_QE_DONE = [
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
  '| 质量工程师 | T0-1 | 执行完成 | |',
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
  '| 质量工程师 | T0-1 | 执行完成 | |',
  '',
].join('\n');

snapshotLintResult();
test('R15: 无 lint 机读产物时 checkLintClean 失败、lintPassed=false', () => {
  const content = fixtureProcess(R15_QE_DONE);
  clearLintResult();
  assert.equal(readLintResult(), null);
  assert.equal(checkLintClean().ok, false);
  assert.equal(parseWorkflowState(content).lintPassed, false);
});
test('R15: lint gatePassed=true 时 checkLintClean 通过、lintPassed=true', () => {
  const content = fixtureProcess(R15_QE_DONE);
  writeLintResult(LINT_PASS);
  assert.equal(checkLintClean().ok, true);
  assert.equal(parseWorkflowState(content).lintPassed, true);
});
test('R15: lint gatePassed=false（lint 失败）时 checkLintClean 失败、lintPassed=false', () => {
  const content = fixtureProcess(R15_QE_DONE);
  writeLintResult(LINT_FAIL);
  assert.equal(checkLintClean().ok, false);
  assert.equal(parseWorkflowState(content).lintPassed, false);
});
test('R15: 仅架构师声明 n/a 但无用户确认 → 不豁免', () => {
  const content = fixtureProcess(R15_QE_DONE, { 'docs/design/gated-lint-na.json': LINT_NA_GATED });
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
const R16_QE_DONE = R15_QE_DONE;
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
  '| 质量工程师 | T0-1 | 执行完成 | |',
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
  '| 质量工程师 | T0-1 | 执行完成 | |',
  '',
].join('\n');

snapshotStaticScanResult();
test('R16: 无静态扫描机读产物时 checkStaticScanClean 失败、staticScanPassed=false', () => {
  const content = fixtureProcess(R16_QE_DONE);
  clearStaticScanResult();
  assert.equal(readStaticScanResult(), null);
  assert.equal(checkStaticScanClean().ok, false);
  assert.equal(parseWorkflowState(content).staticScanPassed, false);
});
test('R16: 两项子检查均 gatePassed=true 时 checkStaticScanClean 通过、staticScanPassed=true', () => {
  const content = fixtureProcess(R16_QE_DONE);
  writeStaticScanResult(STATIC_SCAN_PASS);
  assert.equal(checkStaticScanClean().ok, true);
  assert.equal(parseWorkflowState(content).staticScanPassed, true);
});
test('R16: 重复代码检测未通过时 checkStaticScanClean 失败、staticScanPassed=false', () => {
  const content = fixtureProcess(R16_QE_DONE);
  writeStaticScanResult(STATIC_SCAN_DUP_FAIL);
  assert.equal(checkStaticScanClean().ok, false);
  assert.equal(checkStaticScanClean().reason, 'dup-check-not-passed');
  assert.equal(parseWorkflowState(content).staticScanPassed, false);
});
test('R16: 安全扫描未通过时 checkStaticScanClean 失败、staticScanPassed=false', () => {
  const content = fixtureProcess(R16_QE_DONE);
  writeStaticScanResult(STATIC_SCAN_SECURITY_FAIL);
  assert.equal(checkStaticScanClean().ok, false);
  assert.equal(checkStaticScanClean().reason, 'security-scan-not-passed');
  assert.equal(parseWorkflowState(content).staticScanPassed, false);
});
test('R16: 仅架构师声明 dupCheckApplicability n/a 但无用户确认 → 不豁免', () => {
  const content = fixtureProcess(R16_QE_DONE, { 'docs/design/gated-dup-na.json': DUP_NA_GATED });
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
