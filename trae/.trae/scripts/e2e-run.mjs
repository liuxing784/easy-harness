#!/usr/bin/env node
/**
 * 批次/最终 E2E 门禁运行器（Chromium-only）。判据与命令的唯一权威定义见 AGENTS.md §8.3。
 *
 * 用法：
 *   node .trae/scripts/e2e-run.mjs --scope=batch --required-ids=R-001,R-002
 *   node .trae/scripts/e2e-run.mjs --scope=final --baseline=docs/requirement/requirement-list.md
 *   node .trae/scripts/e2e-run.mjs --scope=final --baseline=docs/{feature}/requirement/requirement-list.md
 *
 * 产物：test-results/e2e/.e2e-batch-result.json 或 .e2e-final-result.json（gatePassed 字段）。
 * 浏览器范围：仅 Chromium（playwright.config.ts 仅声明 chromium project）；本脚本只解析该 project 结果。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import {
  parseChromiumResults,
  parseRequirementP0Ids,
  parseCoverageWaivers,
  computeGateResult,
} from './e2e-run-lib.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../..');
const PW_JSON_REPORT = path.join(PROJECT_ROOT, 'test-results/e2e/pw-report.json');
const RESULT_DIR = path.join(PROJECT_ROOT, 'test-results/e2e');

function parseArgs(argv) {
  const result = {};
  for (const arg of argv) {
    const m = arg.match(/^--([a-zA-Z0-9_-]+)=(.*)$/);
    if (m) result[m[1]] = m[2];
  }
  return result;
}

function findCoverageWaiversPath() {
  const candidates = [
    path.join(PROJECT_ROOT, 'e2e/coverage-waivers.json'),
    path.join(PROJECT_ROOT, 'e2e/specs/coverage-waivers.json'),
  ];
  return candidates.find((p) => fs.existsSync(p)) ?? null;
}

function loadWaivedIds() {
  const p = findCoverageWaiversPath();
  if (!p) return new Set();
  try {
    return parseCoverageWaivers(fs.readFileSync(p, 'utf8'));
  } catch {
    return new Set();
  }
}

function loadRequiredIds(args) {
  if (args['required-ids']) {
    return args['required-ids']
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  if (args.baseline) {
    const baselinePath = path.resolve(PROJECT_ROOT, args.baseline);
    if (!fs.existsSync(baselinePath)) {
      throw new Error(`baseline 文件不存在：${baselinePath}`);
    }
    const content = fs.readFileSync(baselinePath, 'utf8');
    return parseRequirementP0Ids(content);
  }
  return [];
}

function runPlaywright() {
  fs.mkdirSync(RESULT_DIR, { recursive: true });
  try {
    execSync('npx playwright test --project=chromium', {
      cwd: PROJECT_ROOT,
      stdio: 'inherit',
      env: { ...process.env },
    });
    return { exitCode: 0 };
  } catch (err) {
    return { exitCode: err.status ?? 1 };
  }
}

function loadPlaywrightReport() {
  if (!fs.existsSync(PW_JSON_REPORT)) return null;
  try {
    return JSON.parse(fs.readFileSync(PW_JSON_REPORT, 'utf8'));
  } catch {
    return null;
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const scope = args.scope === 'final' ? 'final' : 'batch';

  const requiredIds = loadRequiredIds(args);
  const waivedIds = loadWaivedIds();

  const { exitCode } = runPlaywright();
  const report = loadPlaywrightReport();

  if (!report) {
    const failResult = {
      scope,
      gatePassed: false,
      allPassed: false,
      coverageComplete: false,
      missingIds: requiredIds,
      unexplainedSkips: [],
      coveredIds: [],
      requiredIds,
      playwrightExitCode: exitCode,
      error: 'Playwright JSON 报告未生成（test-results/e2e/pw-report.json 缺失），无法判定门禁。',
      executedAt: new Date().toISOString(),
    };
    writeResult(scope, failResult);
    console.error(JSON.stringify(failResult, null, 2));
    process.exit(1);
  }

  const chromiumResults = parseChromiumResults(report);
  const gate = computeGateResult(chromiumResults, requiredIds, waivedIds);

  const finalResult = {
    scope,
    ...gate,
    requiredIds,
    waivedIds: [...waivedIds],
    playwrightExitCode: exitCode,
    executedAt: new Date().toISOString(),
  };

  writeResult(scope, finalResult);
  console.log(JSON.stringify(finalResult, null, 2));
  process.exit(finalResult.gatePassed ? 0 : 1);
}

function writeResult(scope, result) {
  fs.mkdirSync(RESULT_DIR, { recursive: true });
  const file = scope === 'final' ? '.e2e-final-result.json' : '.e2e-batch-result.json';
  fs.writeFileSync(path.join(RESULT_DIR, file), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
}

main();
