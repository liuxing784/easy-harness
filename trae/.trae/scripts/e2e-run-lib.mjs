/**
 * e2e-run.mjs 的纯函数库：用例标题 [R-xxx] 标签解析、需求清单 P0 提取、
 * 覆盖率与 gatePassed 判据计算。与 workflow-gate-lib.mjs 独立（不引入运行时状态依赖），
 * 便于 vitest 单测覆盖（见 e2e-run-lib.test.ts）。
 *
 * 浏览器范围（AGENTS.md §8.3 唯一权威定义）：仅需支持 Chrome 内核浏览器（Chromium），
 * 本文件与调用方 e2e-run.mjs 均只解析 `chromium` project 的结果，不引入
 * Firefox/WebKit 相关代码路径——浏览器范围是本机械门禁**唯一**允许简化的维度，
 * `gatePassed`、覆盖率、追溯标签等判据不因浏览器范围收窄而放松。
 */

const R_TAG_RE = /\[(R-[A-Za-z0-9_-]+)\]/;

/** 从用例标题中提取 [R-xxx] 追溯标签，未命中返回 null */
export function extractRequirementTag(title) {
  if (typeof title !== 'string') return null;
  const m = title.match(R_TAG_RE);
  return m ? m[1] : null;
}

/**
 * 解析 Playwright JSON reporter 输出（`--reporter=json` / `reporter: [['json', ...]]` 产物），
 * 仅提取 `chromium` project 的用例结果，归一化为：
 * [{ id, title, status: 'passed'|'failed'|'skipped'|'timedOut'|'interrupted', file }]
 */
export function parseChromiumResults(playwrightReport) {
  const results = [];
  if (!playwrightReport || !Array.isArray(playwrightReport.suites)) return results;

  function walkSuite(suite, filePath) {
    const currentFile = suite.file ?? filePath;
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        if (test.projectName && test.projectName !== 'chromium') continue;
        const lastResult = (test.results ?? [])[test.results.length - 1];
        const status = lastResult?.status ?? test.status ?? 'unknown';
        const title = spec.title ?? test.title ?? '';
        results.push({
          id: extractRequirementTag(title),
          title,
          status,
          file: currentFile,
        });
      }
    }
    for (const child of suite.suites ?? []) {
      walkSuite(child, currentFile);
    }
  }

  for (const suite of playwrightReport.suites) {
    walkSuite(suite, suite.file);
  }

  return results;
}

/** 解析 requirement-list.md 表格，提取需求优先级=P0 的需求编号列表 */
export function parseRequirementP0Ids(requirementListContent) {
  if (!requirementListContent) return [];
  const ids = [];
  for (const line of requirementListContent.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('|')) continue;
    if (/^\|[\s|:-]+\|?$/.test(t)) continue; // 分隔行
    const cells = t.split('|').slice(1, -1).map((c) => c.trim());
    if (cells.length < 5) continue;
    const [reqId, , , , priority] = cells;
    if (!/^R-/.test(reqId)) continue; // 跳过表头行
    if (/^P0$/i.test(priority)) ids.push(reqId);
  }
  return ids;
}

/** 解析 coverage-waivers.json 内容，返回已豁免的需求编号集合（含说明校验：须有 reason 字段） */
export function parseCoverageWaivers(waiversJsonContent) {
  if (!waiversJsonContent) return new Set();
  try {
    const parsed = JSON.parse(waiversJsonContent);
    const waivers = Array.isArray(parsed) ? parsed : parsed.waivers ?? [];
    const ids = new Set();
    for (const w of waivers) {
      if (w && typeof w.id === 'string' && typeof w.reason === 'string' && w.reason.trim()) {
        ids.add(w.id);
      }
    }
    return ids;
  } catch {
    return new Set();
  }
}

/**
 * 计算覆盖率与门禁判定。
 *
 * @param {Array<{id: string|null, status: string}>} results Chromium 用例结果
 * @param {string[]} requiredIds 本次范围要求覆盖的需求编号（批次：--required-ids；最终：P0 全集）
 * @param {Set<string>} waivedIds 已登记且有理由说明的覆盖率豁免需求编号
 * @returns {{
 *   allPassed: boolean,
 *   coverageComplete: boolean,
 *   gatePassed: boolean,
 *   missingIds: string[],
 *   unexplainedSkips: string[],
 *   coveredIds: string[],
 * }}
 */
export function computeGateResult(results, requiredIds, waivedIds = new Set()) {
  const coveredIds = new Set(results.filter((r) => r.id && r.status === 'passed').map((r) => r.id));

  const missingIds = requiredIds.filter((id) => !coveredIds.has(id) && !waivedIds.has(id));

  const unexplainedSkips = results
    .filter((r) => (r.status === 'skipped' || r.status === 'interrupted') && r.id && !waivedIds.has(r.id))
    .map((r) => r.id);

  const failed = results.filter((r) => r.status === 'failed' || r.status === 'timedOut');
  const allPassed = failed.length === 0;

  const coverageComplete = missingIds.length === 0 && unexplainedSkips.length === 0;

  return {
    allPassed,
    coverageComplete,
    gatePassed: allPassed && coverageComplete,
    missingIds,
    unexplainedSkips,
    coveredIds: [...coveredIds],
  };
}
