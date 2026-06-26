#!/usr/bin/env node
/**
 * stop 门禁：流程未完成时注入 followup，防止开发后直接收尾
 */
import fs from 'node:fs';
import {
  output,
  getActiveProcessPath,
  readProcessMd,
  parseWorkflowState,
} from './workflow-gate-lib.mjs';

function exitAllow() {
  output({});
  process.exit(0);
}

function exitFollowup(message) {
  output({ followup_message: message });
  process.exit(0);
}

const content = readProcessMd();
const processPath = getActiveProcessPath();
if (!content || !fs.existsSync(processPath)) {
  exitAllow();
}

const state = parseWorkflowState(content);

if (state.blocking) {
  exitAllow();
}

if (state.testComplete) {
  exitAllow();
}

if (state.devInProgress) {
  exitFollowup(
    '【流程门禁】开发工程师任务仍为「正在执行」。禁止直接收尾。请在本回合：1) 调用 project-manager 更新进度；2) 在 ## 待派发角色列表 分派 quality-assurance-engineer；3) 发起 QA Task。',
  );
}

if (state.devComplete && !state.hasQaRecord) {
  exitFollowup(
    '【流程门禁】开发已标记完成，但尚未分派质量保障工程师。请先调用 project-manager 分派 quality-assurance-engineer 并发起 QA Task。',
  );
}

if (state.devComplete && state.hasQaRecord && !state.qaComplete) {
  exitFollowup(
    '【流程门禁】质量保障审核尚未完成。请继续 quality-assurance-engineer Task，不得宣告项目完成。',
  );
}

if (state.qaComplete && !state.testComplete) {
  const inDevPhase =
    state.phase === 'development' ||
    state.phase === 'testing' ||
    /当前阶段.*开发/.test(content) ||
    /## 当前分派计划/.test(content);

  if (inDevPhase) {
    exitFollowup(
      '【流程门禁】本批次 QA 已通过，但测试工程师尚未执行。请先调用 project-manager 分派 test-engineer；禁止在测试判定通过前宣告「项目/全流程完成」。',
    );
  }
}

exitAllow();
