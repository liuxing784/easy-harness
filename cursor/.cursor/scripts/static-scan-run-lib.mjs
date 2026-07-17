/**
 * static-scan-run.mjs 的纯函数库：重复代码检测（DRY）与安全静态扫描（密钥泄露）的
 * 命令解析与 gatePassed 判据计算。与 workflow-gate-lib.mjs 独立（不引入运行时状态
 * 依赖），便于单测覆盖。
 *
 * 静态代码质量门禁（R16，AGENTS.md §8.2 唯一权威定义）：QE 阶段须运行重复代码检测
 * 与安全静态扫描且均退出码为 0，机读结果落盘 test-results/qe/.static-scan-result.json。
 * 两项工具均经 `npx` 获取（jscpd-rs / gitleaks-secret-scanner），跨技术栈通用，
 * 不像 lint-run-lib.mjs 那样需要按技术栈探测——本框架已强制要求 Node.js >= 18，
 * `npx` 在任意技术栈项目中均可用。
 * `gatePassed = duplication.gatePassed && security.gatePassed`，二者可分别独立豁免
 * （见 workflow-gate-lib.mjs 的 isDupCheckExempt / isSecurityScanExempt）。
 */

/** 重复代码检测默认命令：jscpd-rs，5% 阈值，超限退出码非 0，JSON 报告落盘供人工核查 */
export const DEFAULT_DUP_COMMAND =
  'npx --yes jscpd-rs --threshold 5 --exitCode 1 --reporters json --output test-results/qe/.jscpd --ignore "**/node_modules/**,**/dist/**,**/build/**,**/.git/**,**/test-results/**,**/vendor/**,**/target/**,**/coverage/**" .';

/** 安全静态扫描默认命令：gitleaks-secret-scanner，跨平台自动获取 gitleaks 二进制，扫描全部改动 */
export const DEFAULT_SECURITY_COMMAND = 'npx --yes gitleaks-secret-scanner --diff-mode all';

/**
 * 解析重复代码检测命令：`harness.config.json` → `qe.commands.dupCheck` 覆盖优先
 * （显式空串视为「禁用默认命令」，回退为 no-command，须走适用性豁免），否则使用通用默认值。
 * @param {{ override?: string|null }} params
 * @returns {string|null}
 */
export function resolveDupCommand({ override = null } = {}) {
  if (typeof override === 'string') {
    return override.trim() ? override.trim() : null;
  }
  return DEFAULT_DUP_COMMAND;
}

/**
 * 解析安全静态扫描命令，规则与 resolveDupCommand 对称。
 * @param {{ override?: string|null }} params
 * @returns {string|null}
 */
export function resolveSecurityCommand({ override = null } = {}) {
  if (typeof override === 'string') {
    return override.trim() ? override.trim() : null;
  }
  return DEFAULT_SECURITY_COMMAND;
}

/**
 * 计算单项子门禁（重复代码 或 安全扫描）。gatePassed = 有命令且退出码为 0。
 * @param {{ command: string|null, exitCode: number|null }} params
 * @returns {{ gatePassed: boolean, reason: string }}
 */
export function computeSubGate({ command, exitCode }) {
  if (!command) {
    return { gatePassed: false, reason: 'no-command' };
  }
  if (exitCode === 0) {
    return { gatePassed: true, reason: 'passed' };
  }
  return { gatePassed: false, reason: 'scan-failed' };
}

/**
 * 汇总静态代码质量门禁判定：两项子检查须均通过。
 * @param {{ duplication: { gatePassed: boolean }, security: { gatePassed: boolean } }} params
 * @returns {{ gatePassed: boolean, reason: string }}
 */
export function computeStaticScanGate({ duplication, security }) {
  const gatePassed = duplication?.gatePassed === true && security?.gatePassed === true;
  return { gatePassed, reason: gatePassed ? 'passed' : 'failed' };
}
