#!/usr/bin/env node
/**
 * 一键初始化 docs 目录结构（幂等，可重复执行）
 * 用法：node .cursor/scripts/bootstrap-docs.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// __dirname = harness/.cursor/scripts → 项目根为上两级
const ROOT = path.resolve(__dirname, '../..');

const PROCESS_TEMPLATE = path.join(ROOT, '.cursor/templates/process.md');
const HARNESS_STATE = path.join(ROOT, '.cursor/harness-state.json');

function normalizeFeatureName(feature) {
  if (!feature) return null;
  const normalized = feature.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if (!normalized || normalized.includes('..')) {
    throw new Error(`非法 feature 名称：${feature}`);
  }
  return normalized;
}

function getDocDirs(feature) {
  const prefix = feature ? `docs/${feature}` : 'docs';
  return [
    `${prefix}/requirement`,
    `${prefix}/design`,
    `${prefix}/quality`,
    `${prefix}/test`,
    `${prefix}/process`,
  ];
}

export function bootstrapDocs(root = ROOT, options = {}) {
  const feature = normalizeFeatureName(options.feature);
  const docDirs = getDocDirs(feature);
  const processRelPath = feature
    ? `docs/${feature}/process/process.md`
    : 'docs/process/process.md';
  const processMd = path.join(root, processRelPath);
  const created = [];

  for (const dir of docDirs) {
    const full = path.join(root, dir);
    if (!fs.existsSync(full)) {
      fs.mkdirSync(full, { recursive: true });
      created.push(dir);
    }
  }

  if (!fs.existsSync(processMd)) {
    if (!fs.existsSync(PROCESS_TEMPLATE)) {
      throw new Error(`缺少模板：${PROCESS_TEMPLATE}`);
    }
    fs.copyFileSync(PROCESS_TEMPLATE, processMd);
    let processContent = fs.readFileSync(processMd, 'utf8');
    processContent = processContent
      .replace(/^process_path:\s*.*$/m, `process_path: ${processRelPath}`)
      .replace(
        /^\| 活跃流程路径 \| .* \|$/m,
        `| 活跃流程路径 | ${processRelPath} |`,
      );
    fs.writeFileSync(processMd, processContent);
    created.push(processRelPath);
  }

  const state = {
    activeProcessPath: processRelPath,
    activeFeature: feature,
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(HARNESS_STATE, `${JSON.stringify(state, null, 2)}\n`);

  return { created, alreadyInitialized: created.length === 0, activeProcessPath: processRelPath };
}

function parseArgs(argv) {
  const result = {};
  for (const arg of argv) {
    if (arg.startsWith('--feature=')) {
      result.feature = arg.slice('--feature='.length);
    }
  }
  return result;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const { created, alreadyInitialized, activeProcessPath } = bootstrapDocs(ROOT, options);
  if (alreadyInitialized) {
    console.log(`docs 结构已存在，无需重复初始化。当前活跃流程：${activeProcessPath}`);
    return;
  }
  console.log(`已初始化 Harness 文档目录。当前活跃流程：${activeProcessPath}`);
  for (const item of created) {
    console.log(`  + ${item}`);
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main();
}
