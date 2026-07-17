import { defineConfig, devices } from '@playwright/test';

const isCI = !!process.env.CI;
const baseURL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3000';

/**
 * Playwright E2E 配置（跨技术栈通用 · AGENTS.md §8.3 唯一权威判据）。
 * 仅支持 Chrome 内核浏览器（Chromium，涵盖 Chrome / Edge 等 Chromium-based 浏览器）；
 * JSON 报告供 `.trae/scripts/e2e-run.mjs` 按 projectName × status 解析。
 *
 * 以下字段为**示例默认值**（Node.js 项目）；其他技术栈须由系统架构师在
 * `docs/<feature>/design/gated-artifacts.json` 中声明构建产物路径，并按需修改本文件的
 * `webServer.command`（或改用 `E2E_WEB_SERVER_COMMAND` 环境变量覆盖），使其对应
 * 目标项目实际的构建/启动命令。
 *
 * 如需运行前置（清理测试数据、初始化 fixture 等），按项目自身数据结构自建
 * `globalSetup` 或 `test.beforeAll` 钩子并在此声明；harness 模板不预置具体实现，
 * 避免绑定到某一特定产品的数据模型（见 `e2e/specs/README.md`）。
 */
export default defineConfig({
  testDir: './e2e/specs',
  // 注意：outputDir 会在每次运行前被 Playwright 清空，故**不得**覆盖 test-results/e2e/，
  // 否则运行 --scope=final 会清除上一轮 .e2e-batch-result.json（反之亦然），导致 stop 门禁
  // 在「批次/最终 E2E 均需 gatePassed」判据间反复弹 followup（批次↔最终 ping-pong 死锁）。
  // 机读门禁产物固定写入 test-results/e2e/（见 .trae/scripts/e2e-run.mjs），须与此目录隔离。
  outputDir: 'test-results/pw-artifacts/',
  fullyParallel: false,
  workers: 1,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  timeout: 90_000,
  expect: {
    timeout: 10_000,
  },
  reporter: [
    ['list'],
    ['json', { outputFile: 'test-results/e2e/pw-report.json' }],
  ],
  use: {
    baseURL,
    headless: true,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: process.env.E2E_WEB_SERVER_COMMAND ?? 'npm run build && npm run start',
    url: baseURL,
    reuseExistingServer: !isCI,
    timeout: 120_000,
    env: {
      ...process.env,
      NODE_ENV: 'production',
    },
  },
});
