#!/usr/bin/env node
/**
 * 幂等初始化 docs/ 目录骨架 + process.md，并同步 .trae/harness-state.json。
 *
 * 用法：
 *   node .trae/scripts/bootstrap-docs.mjs                  # Greenfield
 *   node .trae/scripts/bootstrap-docs.mjs --feature=<name> # Feature 迭代
 *
 * 幂等性：已存在的 process.md 不会被覆盖；已存在的子目录不会报错。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../..');

const DOC_SUBDIRS = ['requirement', 'design', 'quality', 'test', 'process'];
const PROCESS_TEMPLATE = path.join(PROJECT_ROOT, '.trae/templates/process.md');
const HARNESS_STATE = path.join(PROJECT_ROOT, '.trae/harness-state.json');

function parseArgs(argv) {
  const result = {};
  for (const arg of argv) {
    const m = arg.match(/^--([a-zA-Z0-9_-]+)=(.*)$/);
    if (m) result[m[1]] = m[2];
  }
  return result;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function ensureProcessMd(processDir) {
  const processPath = path.join(processDir, 'process.md');
  if (fs.existsSync(processPath)) {
    return { path: processPath, created: false };
  }
  if (!fs.existsSync(PROCESS_TEMPLATE)) {
    throw new Error(`模板缺失：${PROCESS_TEMPLATE}`);
  }
  const template = fs.readFileSync(PROCESS_TEMPLATE, 'utf8');
  fs.writeFileSync(processPath, template, 'utf8');
  return { path: processPath, created: true };
}

function toWorkspaceRelative(absPath) {
  return path.relative(PROJECT_ROOT, absPath).replace(/\\/g, '/');
}

function writeHarnessState(activeProcessPath, activeFeature) {
  let state = {};
  if (fs.existsSync(HARNESS_STATE)) {
    try {
      state = JSON.parse(fs.readFileSync(HARNESS_STATE, 'utf8'));
    } catch {
      state = {};
    }
  }
  state.activeProcessPath = activeProcessPath;
  if (activeFeature) {
    state.activeFeature = activeFeature;
  } else {
    delete state.activeFeature;
  }
  fs.mkdirSync(path.dirname(HARNESS_STATE), { recursive: true });
  fs.writeFileSync(HARNESS_STATE, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const feature = args.feature ? args.feature.trim() : null;

  const docsBase = feature
    ? path.join(PROJECT_ROOT, 'docs', feature)
    : path.join(PROJECT_ROOT, 'docs');

  for (const sub of DOC_SUBDIRS) {
    ensureDir(path.join(docsBase, sub));
  }

  const processDir = path.join(docsBase, 'process');
  const { path: processPath, created } = ensureProcessMd(processDir);

  const activeProcessPath = toWorkspaceRelative(processPath);
  writeHarnessState(activeProcessPath, feature);

  console.log(
    JSON.stringify(
      {
        ok: true,
        feature: feature ?? null,
        docsBase: toWorkspaceRelative(docsBase),
        processPath: activeProcessPath,
        processCreated: created,
      },
      null,
      2,
    ),
  );
}

main();
