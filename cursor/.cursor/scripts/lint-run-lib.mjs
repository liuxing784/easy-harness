/**
 * lint-run.mjs 的纯函数库：跨技术栈 lint 命令解析与 gatePassed 判据计算。
 * 与 workflow-gate-lib.mjs 独立（不引入运行时状态依赖），便于单测覆盖。
 *
 * 编程规范门禁（R15，`.cursor/harness/spec/mechanical-gates.md` §8.2 说明权威；执行权威：Hook/脚本）：QE 阶段须实际运行 lint 且
 * 退出码为 0，机读结果落盘 test-results/qe/.lint-result.json（gatePassed 字段），
 * 判据结构与 E2E 门禁（e2e-run-lib.mjs）同构。`gatePassed` 仅在「有 lint 命令且
 * 退出码为 0」时为 true；无可用 lint 命令时 gatePassed=false（reason=no-lint-command），
 * 须由 harness.config.json → qe.commands.lint 覆盖、或走「无 linter 适用性豁免」
 * （架构师声明 lintApplicability:"n/a" + 用户确认）；detail-design-spec §5 仅为文档留痕，
 * 不作为 Hook 输入。无默认栈不得静默放过。
 */

/** 各技术栈默认 lint 命令（与 qe-run.mjs 保持一致的取值口径；空串表示该栈默认无 lint） */
export const STACK_LINT_COMMANDS = {
  node: 'npm run lint',
  python: 'ruff check .',
  'python-requirements': 'ruff check .',
  go: 'go vet ./...',
  rust: 'cargo clippy',
  'java-maven': '',
  'java-gradle': '',
  php: '',
  ruby: 'rubocop',
  dotnet: '',
};

/**
 * 解析本次应使用的 lint 命令：harness.config.json → qe.commands.lint 覆盖优先，
 * 其次按探测到的技术栈默认值。二者皆无（含空串）时返回 null（视为无 lint 命令）。
 * @param {{ stack?: string|null, override?: string|null }} params
 * @returns {string|null}
 */
export function resolveLintCommand({ stack = null, override = null } = {}) {
  if (typeof override === 'string' && override.trim()) return override.trim();
  if (override === null || override === undefined) {
    const fallback = stack ? STACK_LINT_COMMANDS[stack] : null;
    if (typeof fallback === 'string' && fallback.trim()) return fallback.trim();
  }
  return null;
}

/**
 * 计算 lint 门禁判定。gatePassed = 有命令且退出码为 0。
 * @param {{ command: string|null, exitCode: number|null }} params
 * @returns {{ gatePassed: boolean, reason: string }}
 */
export function computeLintGate({ command, exitCode }) {
  if (!command) {
    return { gatePassed: false, reason: 'no-lint-command' };
  }
  if (exitCode === 0) {
    return { gatePassed: true, reason: 'passed' };
  }
  return { gatePassed: false, reason: 'lint-failed' };
}
