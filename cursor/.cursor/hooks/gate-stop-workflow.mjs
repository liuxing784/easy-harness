#!/usr/bin/env node
/**
 * stop 门禁：流程未完成时注入 followup，防止开发后直接收尾。
 * 判据顺序为 AGENTS.md §8.2 的唯一权威定义，修改行为须同步更新该节。
 * 自锁防护（AGENTS.md §8.4）：见 gate-dev-workflow.mjs 顶部注释，策略一致
 *（此处「fail-open」等价于放行/不注入 followup，即 `{}`）。
 */
function failOpenAllow(context, err) {
  process.stderr.write(`[gate-stop-workflow] fail-open (${context}): ${err?.message ?? err}\n`);
  process.stdout.write(JSON.stringify({}));
  process.exit(0);
}

async function main() {
  let lib;
  try {
    lib = await import('./workflow-gate-lib.mjs');
  } catch (err) {
    failOpenAllow('lib-load', err);
    return;
  }

  const fs = await import('node:fs');
  const { getActiveProcessPath, output, readProcessMd, parseWorkflowState } = lib;

  function exitAllow() {
    output({});
    process.exit(0);
  }

  function exitFollowup(message) {
    output({ followup_message: message });
    process.exit(0);
  }

  try {
    const content = readProcessMd();
    const processPath = getActiveProcessPath();
    if (!content || !fs.existsSync(processPath)) {
      exitAllow();
    }

    const state = parseWorkflowState(content);

    // R10：已取消的流程不再被催促推进（无论处于哪个阶段）。
    if (state.cancelled) {
      exitAllow();
    }

    if (state.blocking) {
      exitAllow();
    }

    // 放行（全流程测试闭环）：finalTestRequired && finalTestComplete
    if (state.finalTestRequired && state.finalTestComplete) {
      exitAllow();
    }

    // 开发进行中
    if (state.devInProgress) {
      exitFollowup(
        '【流程门禁】开发工程师任务仍为「正在执行」。禁止直接收尾。请在本回合：1) 调用 project-manager 更新进度；2) 在 ## 待派发角色列表 分派 quality-assurance-engineer；3) 发起 QA Task。',
      );
    }

    // 待分派 QA
    if (state.devComplete && !state.hasQaRecord) {
      exitFollowup(
        '【流程门禁】开发已标记完成，但尚未分派质量保障工程师。请先调用 project-manager 分派 quality-assurance-engineer 并发起 QA Task。',
      );
    }

    // QA 未完成
    if (state.devComplete && state.hasQaRecord && !state.qaComplete) {
      exitFollowup(
        '【流程门禁】质量保障审核尚未完成。请继续 quality-assurance-engineer Task，不得宣告项目完成。',
      );
    }

    const isHotfix = state.workflowMode === 'hotfix';
    const isDocsOnly = state.workflowMode === 'docs-only';

    if (!isDocsOnly && state.qaComplete) {
      if (isHotfix) {
        // R11：hotfix 折叠批次/最终为单次通道，跳过批次相关两条判据，直接要求最终（唯一一次）E2E。
        if (!state.finalTestRowComplete) {
          exitFollowup(
            '【流程门禁】（R11 hotfix 折叠通道）QA 已通过，但测试工程师尚未执行集成测试。请先调用 project-manager 分派 test-engineer 执行一次集成测试 + E2E（--scope=final 语义，无需区分批次）。',
          );
        }
        if (state.finalTestRowComplete && !state.finalE2ePassed) {
          exitFollowup(
            '【流程门禁】（R11 hotfix 折叠通道）测试记录已完成，但 E2E 门禁未通过。请由 test-engineer 运行 `node .cursor/scripts/e2e-run.mjs --scope=final --baseline=<requirement-list.md 或热修影响面>`；`gatePassed` 为 true 前禁止宣告完成。',
          );
        }
      } else {
        // 全量模式：批次 E2E → 批次集成测试 → 最终 E2E → 最终整体集成测试
        if (state.batchTestRowComplete && !state.batchE2ePassed) {
          exitFollowup(
            '【流程门禁】本批次测试记录已完成，但批次 E2E 未通过。请由 test-engineer 运行 `node .cursor/scripts/e2e-run.mjs --scope=batch --required-ids=<本批次P0>`；未通过前不得推进下一批次。',
          );
        }
        if (!state.batchTestComplete) {
          exitFollowup(
            '【流程门禁】本批次 QA 已通过，但测试工程师尚未执行批次集成测试（含批次 E2E）。请先调用 project-manager 分派 test-engineer 做批次集成测试。',
          );
        }
        if (state.finalTestRequired) {
          if (state.finalTestRowComplete && !state.finalE2ePassed) {
            exitFollowup(
              '【流程门禁】最终测试记录已完成，但最终 E2E 未通过。请由 test-engineer 运行 `node .cursor/scripts/e2e-run.mjs --scope=final --baseline=<requirement-list.md>`；未通过前禁止宣告完成。',
            );
          }
          if (!state.finalTestComplete) {
            exitFollowup(
              '【流程门禁】全部任务包开发+QA+各批次集成测试已完成，但尚未执行最终整体集成测试。请先调用 project-manager 分派 test-engineer 执行最终整体集成测试（含全量 E2E）。',
            );
          }
        }
      }
    }

    exitAllow();
  } catch (err) {
    failOpenAllow('runtime', err);
  }
}

main();
