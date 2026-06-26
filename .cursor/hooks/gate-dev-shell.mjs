#!/usr/bin/env node
/**
 * beforeShellExecution 门禁：无分派计划时，禁止项目初始化 / Tauri 构建命令
 */
import {
  allow,
  assertDevGateOrDeny,
  isGatedShellCommand,
  readStdinJson,
} from './workflow-gate-lib.mjs';

const input = readStdinJson();
const command = input.command ?? input.tool_input?.command ?? '';

if (!isGatedShellCommand(command)) {
  allow();
}

assertDevGateOrDeny();
allow();
