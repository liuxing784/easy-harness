#!/usr/bin/env node
/**
 * 门禁逻辑回归自检：覆盖 R3 / R6 / B1 / R9 / R10 / R11 / R13 / R14 / R15 / R16 / R17
 * 最低必测集，以及 Finding #1（出厂模板阻塞误判）回归。
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
  hasUnresolvedIssues,
  isProcessBlocked,
  readLintResult,
  readStaticScanResult,
  checkLintClean,
  checkStaticScanClean,
} from '../hooks/workflow-gate-lib.mjs';

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

/**
 * 递归删除目录树（Windows 兼容）。
 *
 * 背景：Node v24/win32 上 `fs.rmSync(path, { recursive: true, force: true })`
 * 对本 fixture 路径（`test-results/.gate-selftest`，含点前缀目录名）存在静默失败：
 * 调用返回不抛错，但目录及其下文件并未被真正删除。这会让上一轮测试写入的产物
 * （如 `docs/design/detail-design-spec.md`）残留到下一轮，污染断言——
 * R9「hotfix 模式下设计缺失时失败」用例即因检测到上一轮 R3/R13 写入的
 * `detail-design-spec.md` 而错误返回 `ok:true`。
 *
 * 修复：改用「先清文件、再删空目录」的手动后序遍历，并对单文件/单目录删除做
 * 短重试以容忍 Windows 杀毒/索引器瞬时文件锁；最终校验目录确实已被删除，
 * 失败时显式抛错（fail-loud），避免静默污染后续测试。
 */
function rmrf(target) {
  if (!fs.existsSync(target)) return;

  const removeWithRetry = (fn, p, retries = 4) => {
    for (let i = 0; i < retries; i++) {
      try {
        fn(p);
        return;
      } catch (err) {
        if (err.code === 'ENOENT') return;
        if (i === retries - 1) throw err;
        // 同步短暂等待，让 Windows 文件句柄（杀毒/索引器）释放后重试
        const until = Date.now() + 25;
        while (Date.now() < until) { /* spin */ }
      }
    }
  };

  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory() && !entry.isSymbolicLink()) {
        walk(full);
        removeWithRetry(fs.rmdirSync, full);
      } else {
        try { fs.chmodSync(full, 0o666); } catch { /* ignore */ }
        removeWithRetry(fs.unlinkSync, full);
      }
    }
  };

  walk(target);
  removeWithRetry(fs.rmdirSync, target);

  if (fs.existsSync(target)) {
    throw new Error(`rmrf: 未能删除 fixture 目录 ${target}（请检查是否有进程占用）`);
  }
}

/** 重置 fixture 并将 HARNESS_PROCESS_PATH 指向新写入的 process.md，返回其内容 */
function fixtureProcess(processContent, extraFiles = {}) {
  rmrf(FIXTURE_ROOT);
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
  rmrf(FIXTURE_ROOT);
  delete process.env.HARNESS_PROCESS_PATH;
}

console.log('== R6：.trae/ 门禁路径判定 ==');
test('R6: .trae/scripts 下的文件受门禁保护', () => {
  assert.equal(isGatedDevPath('.trae/scripts/foo.mjs'), true);
});
test('R6: .trae/agents 下的文件受门禁保护', () => {
  assert.equal(isGatedDevPath('.trae/agents/foo.md'), true);
});
test('R6: .trae/hooks 下的文件受门禁保护（豁免标记文件除外）', () => {
  assert.equal(isGatedDevPath('.trae/hooks/gate-foo.mjs'), true);
  assert.equal(isGatedDevPath('.trae/hooks/.toolchain-install-approved.json'), false);
});
test('R6: 治理配置文件不纳入机制门禁（文字约束覆盖）', () => {
  assert.equal(isGatedDevPath('.trae/templates/process.md'), false);
  assert.equal(isGatedDevPath('.trae/harness.config.json'), false);
  assert.equal(isGatedDevPath('.trae/hooks.json'), false);
  assert.equal(isGatedDevPath('.trae/harness-state.json'), false);
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
  const templatePath = path.join(PROJECT_ROOT, '.trae/templates/process.md');
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
    '| 质量保障工程师 | T0-1 | 执行完成 | |',
    '| 测试工程师 | 批次集成测试 T0-1 | 执行完成 | |',
    '| 开发工程师 | T0-2 | 执行完成 | |',
    '| 质量保障工程师 | T0-2 | 执行完成 | |',
    '| 测试工程师 | 批次集成测试 T0-2 | 执行完成 | |',
    '',
  ].join('\n');
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
    '| 质量保障工程师 | T0-1 | 执行完成 | |',
    '| 测试工程师 | 批次集成测试 T0-1 | 执行完成 | |',
    '| 开发工程师 | T0-2 | 执行完成 | |',
    '| 质量保障工程师 | T0-2 | 执行完成 | |',
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
    '| 质量保障工程师 | T0-1 | 执行完成 | |',
    '| 测试工程师 | 批次集成测试 T0-1 | 执行完成 | |',
    '| 开发工程师 | T0-2 | 执行完成 | |',
    '| 质量保障工程师 | T0-2 | 执行完成 | |',
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

console.log('== R15：编程规范 lint 门禁 ==');
test('R15: 无 lint 机读产物时 readLintResult 返回 null', () => {
  assert.equal(readLintResult(), null);
});
test('R15: 存在 lint 结果文件时 readLintResult 返回解析后的对象', () => {
  const qaDir = path.join(PROJECT_ROOT, 'test-results/qa');
  fs.mkdirSync(qaDir, { recursive: true });
  const lintResultPath = path.join(qaDir, '.lint-result.json');
  fs.writeFileSync(lintResultPath, JSON.stringify({ gatePassed: true }), 'utf8');
  const statePath = path.join(FIXTURE_ROOT, 'docs/process/process.md');
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, '---\nworkflow_mode: full\n---\n', 'utf8');
  process.env.HARNESS_PROCESS_PATH = path.relative(PROJECT_ROOT, statePath).replace(/\\/g, '/');
  try {
    const result = readLintResult();
    assert.notEqual(result, null);
    assert.equal(result.gatePassed, true);
  } finally {
    try { fs.unlinkSync(lintResultPath); } catch { /* ignore */ }
  }
});
test('R15: checkLintClean 在无产物时返回 false', () => {
  const content = '---\nworkflow_mode: full\n---\n';
  const result = checkLintClean(content);
  assert.equal(result.ok, false);
});
test('R15: checkLintClean 在 docs-only 模式视为通过', () => {
  const content = '---\nworkflow_mode: docs-only\n---\n';
  const result = checkLintClean(content);
  assert.equal(result.ok, true);
});
test('R15: parseWorkflowState 含 lintPassed/staticScanPassed 字段', () => {
  const state = parseWorkflowState('---\nworkflow_mode: full\n---\n');
  assert.equal('lintPassed' in state, true);
  assert.equal('staticScanPassed' in state, true);
  assert.equal('lintExempt' in state, true);
  assert.equal('staticScanExempt' in state, true);
});

console.log('== R16：静态代码质量门禁 ==');
test('R16: 无 static scan 机读产物时 readStaticScanResult 返回 null', () => {
  assert.equal(readStaticScanResult(), null);
});
test('R16: checkStaticScanClean 在无产物时返回 false', () => {
  const content = '---\nworkflow_mode: full\n---\n';
  const result = checkStaticScanClean(content);
  assert.equal(result.ok, false);
});
test('R16: checkStaticScanClean 在 docs-only 模式视为通过', () => {
  const content = '---\nworkflow_mode: docs-only\n---\n';
  const result = checkStaticScanClean(content);
  assert.equal(result.ok, true);
});

cleanup();

console.log('');
console.log(`结果：${passCount} passed, ${failCount} failed`);
if (failCount > 0) {
  console.error('失败用例：');
  for (const f of failures) console.error(`  - ${f.name}: ${f.error}`);
  process.exit(1);
}
process.exit(0);
