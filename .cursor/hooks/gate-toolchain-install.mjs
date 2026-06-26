#!/usr/bin/env node
/**
 * beforeShellExecution 门禁：系统级工具链安装须先询问用户确认路径
 */
import {
  allow,
  ask,
  isToolchainInstallCommand,
  hasToolchainInstallApproval,
  readStdinJson,
} from './workflow-gate-lib.mjs';

const input = readStdinJson();
const command = input.command ?? input.tool_input?.command ?? '';

if (!isToolchainInstallCommand(command)) {
  allow();
}

if (hasToolchainInstallApproval(command)) {
  allow();
}

ask(
  '工具链安装门禁：须先询问用户现有工具链路径或安装目标目录（避免未经确认的默认系统路径），在用户明确确认前不得自动安装。',
  'AGENTS.md gate-toolchain-install：请先使用 AskQuestion 询问用户工具链的现有路径或安装目录。用户确认后创建 `.cursor/hooks/.toolchain-install-approved.json`（含 approvedAt、userConfirmed: true，可选 commandHash），默认 60 分钟内有效，再重试安装命令。',
);
