#!/usr/bin/env node
/**
 * 门禁逻辑回归自检：覆盖 R3 / R6 / B1 / R9 / R10 / R11 / R13 / R14 / R15 / R16
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
