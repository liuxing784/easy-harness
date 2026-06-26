#!/usr/bin/env node
/**
 * preToolUse 门禁：无项目经理分派计划时，禁止写入开发产物
 */
import {
  allow,
  assertDevGateOrDeny,
  isGatedDevPath,
  readStdinJson,
} from './workflow-gate-lib.mjs';

const input = readStdinJson();
const toolInput = input.tool_input ?? input.arguments ?? {};

function extractPatchPaths(text) {
  if (typeof text !== 'string') return [];
  const paths = [];
  const re = /^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm;
  let match;
  while ((match = re.exec(text)) !== null) {
    paths.push(match[1].trim());
  }
  return paths;
}

function extractToolPaths(value) {
  const paths = [];
  if (!value) return paths;

  if (typeof value === 'string') {
    return extractPatchPaths(value);
  }

  const directFields = [
    'path',
    'file_path',
    'target_file',
    'target_notebook',
    'notebook_path',
  ];
  for (const field of directFields) {
    if (typeof value[field] === 'string') paths.push(value[field]);
  }

  for (const field of ['patch', 'diff', 'content', 'input']) {
    paths.push(...extractPatchPaths(value[field]));
  }

  return paths;
}

const filePaths = extractToolPaths(toolInput);

if (!filePaths.some((filePath) => isGatedDevPath(filePath))) {
  allow();
}

assertDevGateOrDeny();
allow();
