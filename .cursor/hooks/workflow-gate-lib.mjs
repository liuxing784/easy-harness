/**
 * 流程门禁共享逻辑 — 供 gate-dev-workflow / gate-dev-shell / gate-stop-workflow / gate-toolchain-install 使用
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = path.resolve(__dirname, '../..');
export const DEFAULT_PROCESS_MD = path.join(PROJECT_ROOT, 'docs/process/process.md');
export const HARNESS_CONFIG = path.join(PROJECT_ROOT, '.cursor/harness.config.json');
export const HARNESS_STATE = path.join(PROJECT_ROOT, '.cursor/harness-state.json');
export const DEFAULT_GATED_ARTIFACTS = path.join(PROJECT_ROOT, 'docs/design/gated-artifacts.json');
export const TOOLCHAIN_APPROVAL_MARKER = path.join(
  __dirname,
  '.toolchain-install-approved.json',
);

const CODE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.pyw', '.go', '.rs', '.java', '.kt', '.kts',
  '.cs', '.cpp', '.cc', '.cxx', '.c', '.h', '.hpp', '.hh',
  '.rb', '.php', '.swift', '.scala', '.sc', '.vue', '.svelte',
  '.sql', '.sh', '.bash', '.zsh', '.ps1', '.psm1', '.bat', '.cmd',
  '.html', '.css', '.scss', '.sass', '.less', '.json', '.yaml', '.yml',
  '.toml', '.xml', '.gradle', '.dart', '.lua', '.r',
  // 函数式 / JVM / BEAM / 其他跨栈语言
  '.ex', '.exs', '.erl', '.hrl', '.clj', '.cljs', '.cljc', '.edn',
  '.hs', '.ml', '.mli', '.fs', '.fsx', '.fsi', '.jl',
  '.zig', '.nim', '.groovy', '.pl', '.pm', '.vb',
]);

const DEFAULT_CONFIG = {
  gatedPaths: {
    sourceDirs: ['src', 'src-tauri', 'app', 'cmd', 'lib', 'internal', 'pkg', 'tests', 'test', '__tests__'],
    buildManifests: ['package.json', 'pyproject.toml', 'go.mod', 'Cargo.toml', 'pom.xml'],
    testConfigs: ['vitest.config.ts', 'jest.config.js', 'pytest.ini'],
    rootPatterns: ['Dockerfile*', 'docker-compose*.yml', 'docker-compose*.yaml', '.env*', '.github/**'],
    docsAllowedExtensions: ['.md', '.mdx', '.txt'],
  },
  gatedShellPatterns: [
    '\\bnpm\\s+create\\b',
    '\\bnpm\\s+install\\b',
    '\\bcargo\\s+init\\b',
    'create-tauri-app',
    '\\bdotnet\\s+new\\b',
    '\\bgo\\s+mod\\s+init\\b',
  ],
  toolchain: {
    approvalTtlMinutes: 60,
    installPatterns: [
      '\\bwinget\\s+install\\b',
      'rustup-init',
      '\\bchoco\\s+install\\b',
      '\\bscoop\\s+install\\b',
      '\\bbrew\\s+install\\b',
      '\\bapt(-get)?\\s+install\\b',
      '\\byum\\s+install\\b',
      '\\bdnf\\s+install\\b',
      'VisualStudio\\.\\*BuildTools',
      'VisualStudio\\.BuildTools',
      'vs_buildtools',
      'Microsoft\\.VisualStudio\\.',
    ],
  },
};

let _configCache = null;
let _gatedArtifactsCache = null;
let _gatedArtifactsCachePath = null;

export function readStdinJson() {
  const raw = fs.readFileSync(0, 'utf8');
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export function output(result) {
  process.stdout.write(JSON.stringify(result));
}

export function allow() {
  output({ permission: 'allow' });
  process.exit(0);
}

export function deny(userMessage, agentMessage) {
  output({
    permission: 'deny',
    user_message: userMessage,
    agent_message: agentMessage,
  });
  process.exit(0);
}

export function ask(userMessage, agentMessage) {
  output({
    permission: 'ask',
    user_message: userMessage,
    agent_message: agentMessage,
  });
  process.exit(0);
}

export function readProcessMd() {
  const processPath = getActiveProcessPath();
  if (!fs.existsSync(processPath)) return null;
  return fs.readFileSync(processPath, 'utf8');
}

function resolveWorkspacePath(candidate, fallback) {
  if (!candidate || typeof candidate !== 'string') return fallback;
  const resolved = path.resolve(PROJECT_ROOT, candidate);
  const relative = path.relative(PROJECT_ROOT, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return fallback;
  return resolved;
}

export function getActiveProcessPath() {
  if (process.env.HARNESS_PROCESS_PATH) {
    return resolveWorkspacePath(process.env.HARNESS_PROCESS_PATH, DEFAULT_PROCESS_MD);
  }

  if (fs.existsSync(HARNESS_STATE)) {
    try {
      const state = JSON.parse(fs.readFileSync(HARNESS_STATE, 'utf8'));
      if (state.activeProcessPath) {
        return resolveWorkspacePath(state.activeProcessPath, DEFAULT_PROCESS_MD);
      }
      if (state.activeFeature) {
        return resolveWorkspacePath(
          `docs/${state.activeFeature}/process/process.md`,
          DEFAULT_PROCESS_MD,
        );
      }
    } catch {
      /* fall through */
    }
  }

  return DEFAULT_PROCESS_MD;
}

export function getActiveGatedArtifactsPath() {
  if (process.env.HARNESS_GATED_ARTIFACTS_PATH) {
    return resolveWorkspacePath(process.env.HARNESS_GATED_ARTIFACTS_PATH, DEFAULT_GATED_ARTIFACTS);
  }

  const processPath = normalizePath(getActiveProcessPath());
  const featureMatch = processPath.match(/^docs\/(.+)\/process\/process\.md$/);
  if (featureMatch) {
    return path.join(PROJECT_ROOT, 'docs', featureMatch[1], 'design/gated-artifacts.json');
  }

  return DEFAULT_GATED_ARTIFACTS;
}

/** 简易解析 process.md YAML frontmatter（仅支持扁平 key: value） */
export function parseProcessFrontmatter(content) {
  if (!content) return {};
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};

  const result = {};
  for (const line of match[1].split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const kv = trimmed.match(/^([a-zA-Z0-9_]+):\s*(.*)$/);
    if (!kv) continue;
    const [, key, raw] = kv;
    let value = raw.trim();
    if (value === 'true') value = true;
    else if (value === 'false') value = false;
    else if (value === 'null' || value === '') value = null;
    else if (value === '[]') value = [];
    else if (value === '{}') value = {};
    else if (value.startsWith('[') && value.endsWith(']')) {
      value = value
        .slice(1, -1)
        .split(',')
        .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
        .filter(Boolean);
    }
    result[key] = value;
  }
  return result;
}

export function loadHarnessConfig() {
  if (_configCache) return _configCache;
  if (fs.existsSync(HARNESS_CONFIG)) {
    try {
      _configCache = { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(HARNESS_CONFIG, 'utf8')) };
      _configCache.gatedPaths = { ...DEFAULT_CONFIG.gatedPaths, ..._configCache.gatedPaths };
      return _configCache;
    } catch {
      /* fall through */
    }
  }
  _configCache = DEFAULT_CONFIG;
  return _configCache;
}

export function loadGatedArtifacts() {
  const gatedArtifactsPath = getActiveGatedArtifactsPath();
  if (_gatedArtifactsCache && _gatedArtifactsCachePath === gatedArtifactsPath) {
    return _gatedArtifactsCache;
  }
  if (fs.existsSync(gatedArtifactsPath)) {
    try {
      _gatedArtifactsCache = JSON.parse(fs.readFileSync(gatedArtifactsPath, 'utf8'));
      _gatedArtifactsCachePath = gatedArtifactsPath;
      return _gatedArtifactsCache;
    } catch {
      /* fall through */
    }
  }
  _gatedArtifactsCache = {};
  _gatedArtifactsCachePath = gatedArtifactsPath;
  return _gatedArtifactsCache;
}

export function getMergedGatedPaths() {
  const config = loadHarnessConfig();
  const extra = loadGatedArtifacts();
  return {
    sourceDirs: [
      ...config.gatedPaths.sourceDirs,
      ...(extra.extraSourceDirs ?? []),
    ],
    buildManifests: [
      ...config.gatedPaths.buildManifests,
      ...(extra.extraBuildManifests ?? []),
    ],
    testConfigs: [
      ...config.gatedPaths.testConfigs,
      ...(extra.extraTestConfigs ?? []),
    ],
    rootPatterns: [
      ...(config.gatedPaths.rootPatterns ?? []),
      ...(extra.extraRootPatterns ?? []),
    ],
    docsAllowedExtensions: config.gatedPaths.docsAllowedExtensions ?? ['.md', '.mdx', '.txt'],
  };
}

export function getMergedShellPatterns() {
  const config = loadHarnessConfig();
  const extra = loadGatedArtifacts();
  const patterns = [
    ...(config.gatedShellPatterns ?? []),
    ...(extra.extraShellPatterns ?? []),
  ];
  return patterns.map((p) => new RegExp(p, 'i'));
}

export function getToolchainInstallPatterns() {
  const config = loadHarnessConfig();
  return (config.toolchain?.installPatterns ?? DEFAULT_CONFIG.toolchain.installPatterns)
    .map((p) => new RegExp(p, 'i'));
}

/** 提取指定 `## 标题` 章节正文 */
function extractSection(content, title) {
  const re = new RegExp(`##\\s*${title}\\s*([\\s\\S]*?)(?=\\n##\\s|$)`);
  const m = content.match(re);
  return m ? m[1] : null;
}

/**
 * 章节内的 markdown 表格是否含**真实数据行**（排除表头、分隔行与全空占位行）。
 * 用于区分「模板空表」与「项目经理已填入的实际分派」。
 */
function sectionHasDataRow(content, title) {
  const body = extractSection(content, title);
  if (!body) return false;
  const tableRows = [];
  for (const line of body.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('|')) continue;
    if (/^\|[\s|:-]+\|?$/.test(t)) continue; // 分隔行 | --- | --- |
    tableRows.push(t);
  }
  // 第一条为表头，其余为数据行
  for (let i = 1; i < tableRows.length; i++) {
    const cells = tableRows[i].split('|').slice(1, -1).map((c) => c.trim());
    if (cells.some((c) => c.length > 0)) return true;
  }
  return false;
}

/** 是否存在有效分派计划（开发阶段写代码的前置条件） */
export function hasValidDispatchPlan(content) {
  if (!content) return false;
  const fm = parseProcessFrontmatter(content);
  if (fm.workflow_mode === 'docs-only') return false;
  // 仅有空模板标题不算有效；须项目经理填入真实分派行
  if (!sectionHasDataRow(content, '当前分派计划')) return false;
  if (sectionHasDataRow(content, '待派发角色列表')) return true;
  // 开发工程师已开始执行后，PM 可能已消费待派发列表；继续依据当前分派计划放行。
  if (roleProgressStats(content, '开发工程师').inProgress > 0) return true;
  return false;
}

/** process.md 是否处于阻塞状态 */
export function isProcessBlocked(content) {
  if (!content) return false;
  const fm = parseProcessFrontmatter(content);
  if (fm.blocking === true) return true;
  if (/\|\s*阻塞\s*\|/.test(content)) return true;
  const blockSection = content.match(/## 阻塞原因\s*([\s\S]*?)(?=\n## |\n$|$)/);
  if (blockSection && blockSection[1].trim().length > 0) {
    const body = blockSection[1].trim();
    if (body !== '—' && body !== '-' && !/^无$/m.test(body)) return true;
  }
  return false;
}

export function getWorkflowMode(content) {
  const fm = parseProcessFrontmatter(content ?? '');
  return fm.workflow_mode ?? 'full';
}

export function assertDevGateOrDeny() {
  const content = readProcessMd();
  const mode = getWorkflowMode(content);

  if (mode === 'docs-only') {
    deny(
      '流程门禁：当前为 docs-only 模式，禁止写入源码与构建产物。',
      'AGENTS.md 轻量模式 docs-only：仅允许修改 docs/**/*.md。请切换 workflow_mode 或走完整开发流程。',
    );
  }

  if (!hasValidDispatchPlan(content)) {
    deny(
      '流程门禁：尚未完成项目经理开发分派。须先在 process.md 写入「## 当前分派计划」与「## 待派发角色列表」，再通过 development-engineer 子 agent 开发。',
      'AGENTS.md：禁止在无分派计划时写入受保护源码路径或执行项目初始化/依赖安装命令。请先调用 project-manager 完成分派；若开发已在执行，须保持「## 当前分派计划」有效。',
    );
  }
  if (isProcessBlocked(content)) {
    deny(
      '流程门禁：process.md 处于阻塞状态，须等待用户确认后再继续开发。',
      'AGENTS.md：阻塞状态下禁止继续开发相关操作。',
    );
  }
}

/** 将路径规范化为正斜杠小写，便于匹配 */
export function normalizePath(filePath) {
  if (!filePath) return '';
  let p = filePath.replace(/\\/g, '/').toLowerCase();
  const root = PROJECT_ROOT.replace(/\\/g, '/').toLowerCase();
  if (p.startsWith(root)) p = p.slice(root.length);
  if (p.startsWith('/')) p = p.slice(1);
  return p;
}

function basenameMatches(p, names) {
  const base = p.split('/').pop() ?? '';
  return names.some((name) => {
    if (name.includes('*')) {
      const re = new RegExp(`^${name.replace(/\./g, '\\.').replace(/\*/g, '.*')}$`, 'i');
      return re.test(base);
    }
    return base === name.toLowerCase();
  });
}

function globPatternMatches(p, pattern) {
  const normalized = pattern.toLowerCase().replace(/\\/g, '/');
  const escaped = normalized
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '::DOUBLE_STAR::')
    .replace(/\*/g, '[^/]*')
    .replace(/::DOUBLE_STAR::/g, '.*');
  const re = new RegExp(`^${escaped}$`, 'i');
  return re.test(p);
}

function isCodeExtension(ext) {
  return CODE_EXTENSIONS.has(ext.toLowerCase());
}

/** 是否为受门禁约束的开发产物路径 */
export function isGatedDevPath(filePath) {
  const p = normalizePath(filePath);
  if (!p) return false;

  if (p.includes('node_modules/')) return false;
  if (p.startsWith('.cursor/')) return false;

  // 架构师配置文件：docs/[{feature}/]design/gated-artifacts.json 需允许写入
  // （它是门禁配置而非源码，否则与「架构师必须产出该文件」相互矛盾）
  if (/(^|\/)docs\/(.+\/)?design\/gated-artifacts\.json$/.test(p)) return false;

  const gated = getMergedGatedPaths();

  // docs/ 下仅允许 markdown 等文档扩展名，禁止源码文件
  if (p.startsWith('docs/')) {
    const ext = path.posix.extname(p).toLowerCase();
    if (!ext) return false;
    const allowed = gated.docsAllowedExtensions.map((e) => e.toLowerCase());
    if (allowed.includes(ext)) return false;
    if (isCodeExtension(ext)) return true;
    // 其他非文档扩展名在 docs 下也拦截
    return true;
  }

  for (const dir of gated.sourceDirs) {
    const d = dir.toLowerCase().replace(/\\/g, '/');
    if (p === d || p.startsWith(`${d}/`)) return true;
  }

  if (basenameMatches(p, gated.buildManifests.map((n) => n.toLowerCase()))) {
    if (!p.includes('node_modules')) return true;
  }

  if (basenameMatches(p, gated.testConfigs.map((n) => n.toLowerCase()))) {
    return true;
  }

  if ((gated.rootPatterns ?? []).some((pattern) => globPatternMatches(p, pattern))) {
    return true;
  }

  // 根目录或子目录 Cargo.toml（Rust 工作区）
  if (p === 'cargo.toml' || p.endsWith('/cargo.toml')) return true;

  return false;
}

/** 是否为受门禁约束的 Shell 命令 */
export function isGatedShellCommand(command) {
  if (!command) return false;
  const patterns = getMergedShellPatterns();
  return patterns.some((re) => re.test(command));
}

/** 是否为系统级工具链安装命令（须先询问用户安装路径） */
export function isToolchainInstallCommand(command) {
  if (!command) return false;
  const patterns = getToolchainInstallPatterns();
  return patterns.some((re) => re.test(command));
}

function hashCommand(command) {
  return createHash('sha256').update(command.trim()).digest('hex').slice(0, 16);
}

/** 用户是否已通过标记文件授权工具链安装（含 TTL） */
export function hasToolchainInstallApproval(command) {
  if (!fs.existsSync(TOOLCHAIN_APPROVAL_MARKER)) return false;

  try {
    const data = JSON.parse(fs.readFileSync(TOOLCHAIN_APPROVAL_MARKER, 'utf8'));
    const config = loadHarnessConfig();
    const ttl = config.toolchain?.approvalTtlMinutes ?? 60;

    if (data.expiresAt) {
      if (new Date(data.expiresAt) < new Date()) return false;
    } else if (data.approvedAt) {
      const approved = new Date(data.approvedAt);
      const expires = new Date(approved.getTime() + ttl * 60 * 1000);
      if (expires < new Date()) return false;
    }

    if (command && data.commandHash) {
      return data.commandHash === hashCommand(command);
    }

    return data.userConfirmed === true;
  } catch {
    return false;
  }
}

export function hashCommandForApproval(command) {
  return hashCommand(command);
}

/**
 * 统计「## 进度列表」中某角色的开发线状态。
 * 支持并行：按行聚合，区分总数 / 已完成 / 正在执行，
 * 从而能判断「全部完成」而非「任一完成」。
 */
function roleProgressStats(content, roleKey) {
  const body = extractSection(content, '进度列表');
  const stats = { total: 0, complete: 0, inProgress: 0 };
  if (!body) return stats;
  for (const line of body.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('|')) continue;
    if (/^\|[\s|:-]+\|?$/.test(t)) continue; // 分隔行
    if (!t.includes(roleKey)) continue; // 仅本角色的开发线行
    stats.total += 1;
    if (t.includes('执行完成')) stats.complete += 1;
    else if (t.includes('正在执行')) stats.inProgress += 1;
  }
  return stats;
}

/** 从 process.md 解析流程状态（按开发线聚合，支持并行批次） */
export function parseWorkflowState(content) {
  if (!content) {
    return {
      blocking: false,
      devInProgress: false,
      devComplete: false,
      hasQaRecord: false,
      qaComplete: false,
      testComplete: false,
      phase: null,
      workflowMode: 'full',
    };
  }

  const fm = parseProcessFrontmatter(content);
  const blocking = fm.blocking === true || isProcessBlocked(content);

  const dev = roleProgressStats(content, '开发工程师');
  const qa = roleProgressStats(content, '质量保障工程师');
  const te = roleProgressStats(content, '测试工程师');

  return {
    blocking,
    // 任一开发线仍在执行即视为开发进行中
    devInProgress: dev.inProgress > 0,
    // 须存在开发线且全部完成、无在执行项
    devComplete: dev.total > 0 && dev.complete === dev.total && dev.inProgress === 0,
    hasQaRecord: qa.total > 0,
    // QA 须全部开发线完成审核
    qaComplete: qa.total > 0 && qa.complete === qa.total && qa.inProgress === 0,
    // 测试须全部完成
    testComplete: te.total > 0 && te.complete === te.total && te.inProgress === 0,
    phase: fm.phase ?? null,
    workflowMode: fm.workflow_mode ?? 'full',
  };
}
