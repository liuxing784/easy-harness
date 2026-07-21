/**
 * 流程门禁共享逻辑 — 供 gate-dev-workflow / gate-dev-shell / gate-stop-workflow /
 * gate-toolchain-install / gate-role-sequence 使用。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = path.resolve(__dirname, '../..');
export const DEFAULT_PROCESS_MD = path.join(PROJECT_ROOT, 'docs/process/process.md');
export const HARNESS_CONFIG = path.join(PROJECT_ROOT, '.trae/harness.config.json');
export const HARNESS_STATE = path.join(PROJECT_ROOT, '.trae/harness-state.json');
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

// R6：.trae/scripts|agents|hooks 三目录纳入机制门禁；其余 .trae/** 默认放行，
// 但可被 dotTraeExemptPatterns 精确豁免其中的非治理产物（如 .toolchain-install-approved.json）。
const DEFAULT_DOTTRAE_EXEMPT_PATTERNS = [
  '.trae/templates/**',
  '.trae/rules/**',
  '.trae/harness-state.json',
  '.trae/hooks.json',
  '.trae/harness.config.json',
  '.trae/hooks/.toolchain-install-approved.json',
];

const DEFAULT_CONFIG = {
  gatedPaths: {
    sourceDirs: ['src', 'src-tauri', 'app', 'cmd', 'lib', 'internal', 'pkg', 'tests', 'test', '__tests__'],
    buildManifests: ['package.json', 'pyproject.toml', 'go.mod', 'Cargo.toml', 'pom.xml'],
    testConfigs: ['vitest.config.ts', 'jest.config.js', 'pytest.ini'],
    rootPatterns: ['Dockerfile*', 'docker-compose*.yml', 'docker-compose*.yaml', '.env*', '.github/**'],
    docsAllowedExtensions: ['.md', '.mdx', '.txt'],
    dotTraeExemptPatterns: DEFAULT_DOTTRAE_EXEMPT_PATTERNS,
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
  qe: {
    commands: {},
  },
};

const ROLE_ALIASES = {
  '开发工程师': ['开发工程师', 'development-engineer'],
  '质量工程师': ['质量工程师', 'quality-engineer', 'QE'],
  '测试工程师': ['测试工程师', 'test-engineer'],
};

const ROLE_SLUG_MAP = {
  'system-architect': 'system-architect',
  '系统架构师': 'system-architect',
  'requirements-analyst': 'requirements-analyst',
  '需求分析师': 'requirements-analyst',
  'requirement-reviewer': 'requirement-reviewer',
  '需求评审专家': 'requirement-reviewer',
  'project-manager': 'project-manager',
  '项目经理': 'project-manager',
  'development-engineer': 'development-engineer',
  '开发工程师': 'development-engineer',
  'quality-engineer': 'quality-engineer',
  '质量工程师': 'quality-engineer',
  'qe': 'quality-engineer',
  'test-engineer': 'test-engineer',
  '测试工程师': 'test-engineer',
};

export function normalizeRoleSlug(role) {
  if (!role) return null;
  const key = String(role).trim().toLowerCase();
  return ROLE_SLUG_MAP[key] ?? null;
}

let _configCache = null;
let _gatedArtifactsCache = null;
let _gatedArtifactsCachePath = null;

export function readStdinJsonAsync(timeoutMs = 5000) {
  if (process.stdin.isTTY) {
    return Promise.resolve({});
  }

  return new Promise((resolve) => {
    let data = '';
    let settled = false;

    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      process.stdin.removeListener('data', onData);
      process.stdin.removeListener('end', onEnd);
      process.stdin.removeListener('error', onEnd);
      try {
        process.stdin.pause();
      } catch {
        /* ignore */
      }
      resolve(value);
    };

    const timer = setTimeout(() => {
      try {
        finish(data.trim() ? JSON.parse(data) : {});
      } catch {
        finish({});
      }
    }, timeoutMs);

    const onData = (chunk) => {
      data += chunk;
    };
    const onEnd = () => {
      try {
        finish(data.trim() ? JSON.parse(data) : {});
      } catch {
        finish({});
      }
    };

    process.stdin.setEncoding('utf8');
    process.stdin.on('data', onData);
    process.stdin.on('end', onEnd);
    process.stdin.on('error', onEnd);
    process.stdin.resume();
  });
}

/** @deprecated Prefer readStdinJsonAsync in hook entry scripts */
export function readStdinJson() {
  if (process.stdin.isTTY) return {};
  try {
    const chunks = [];
    let chunk;
    process.stdin.setEncoding('utf8');
    while ((chunk = process.stdin.read()) !== null) {
      chunks.push(chunk);
    }
    const raw = chunks.join('');
    if (!raw.trim()) return {};
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

/** 读取任意（非当前活跃指针）process.md 路径的内容，供 R10 冻结检查使用 */
export function readProcessMdAtPath(filePath) {
  const abs = path.isAbsolute(filePath) ? filePath : path.resolve(PROJECT_ROOT, filePath);
  if (!fs.existsSync(abs)) return null;
  try {
    return fs.readFileSync(abs, 'utf8');
  } catch {
    return null;
  }
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

/** 活跃 process.md 所在的 docs 子树根目录（如 docs/ 或 docs/{feature}/） */
export function getActiveDocsBase() {
  const processPath = normalizePath(getActiveProcessPath());
  const base = processPath.replace(/\/process\/process\.md$/, '');
  return path.join(PROJECT_ROOT, base);
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
      const parsed = JSON.parse(fs.readFileSync(HARNESS_CONFIG, 'utf8'));
      _configCache = { ...DEFAULT_CONFIG, ...parsed };
      _configCache.gatedPaths = { ...DEFAULT_CONFIG.gatedPaths, ...parsed.gatedPaths };
      _configCache.qe = { ...DEFAULT_CONFIG.qe, ...parsed.qe };
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

export function getMergedDotTraeExemptPatterns() {
  const config = loadHarnessConfig();
  return config.gatedPaths.dotTraeExemptPatterns ?? DEFAULT_DOTTRAE_EXEMPT_PATTERNS;
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

/** 通用 markdown 表格解析：返回 [{ headers: string[], rows: string[][] }] */
function parseMarkdownTables(content) {
  if (!content) return [];
  const lines = content.split('\n');
  const tables = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();
    const next = lines[i + 1]?.trim() ?? '';
    if (line.startsWith('|') && /^\|[\s|:-]+\|?$/.test(next)) {
      const headers = line.split('|').slice(1, -1).map((s) => s.trim());
      let j = i + 2;
      const rows = [];
      while (j < lines.length && lines[j].trim().startsWith('|')) {
        const cells = lines[j].split('|').slice(1, -1).map((s) => s.trim());
        rows.push(cells);
        j += 1;
      }
      tables.push({ headers, rows });
      i = j;
    } else {
      i += 1;
    }
  }
  return tables;
}

/**
 * 是否存在表格化的「未解决问题」行：表头含「是否存在」与「是否解决」两列，
 * 且某行「是否存在」=是 且「是否解决」≠是。用于 design-problem-list.md / quality-report.md。
 */
export function hasUnresolvedIssues(content) {
  const tables = parseMarkdownTables(content);
  for (const table of tables) {
    const existIdx = table.headers.findIndex((h) => /是否存在/.test(h));
    const resolvedIdx = table.headers.findIndex((h) => /是否解决/.test(h));
    if (existIdx === -1 || resolvedIdx === -1) continue;
    for (const row of table.rows) {
      const exists = (row[existIdx] ?? '').trim();
      const resolved = (row[resolvedIdx] ?? '').trim();
      if (/^是$/.test(exists) && !/^是$/.test(resolved)) return true;
    }
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

// ---------------------------------------------------------------------------
// R10：流程终止（不可逆取消）
// ---------------------------------------------------------------------------

/** 是否为 process.md 路径（任意 Greenfield/Feature 均匹配，与「当前活跃指针」无关） */
export function isProcessFilePath(filePath) {
  const p = normalizePath(filePath);
  if (!p) return false;
  return /(^|\/)docs\/(.+\/)?process\/process\.md$/.test(p);
}

/** 目标 process.md 自身（读取磁盘当前内容，而非活跃指针）是否已被标记为不可逆取消 */
export function isCancelledProcessFile(filePath) {
  if (!isProcessFilePath(filePath)) return false;
  const content = readProcessMdAtPath(filePath);
  if (!content) return false;
  const fm = parseProcessFrontmatter(content);
  return fm.cancelled === true;
}

/** 当前活跃流程是否已被取消（用于 shell / stop 门禁） */
export function isActiveProcessCancelled() {
  const content = readProcessMd();
  if (!content) return false;
  const fm = parseProcessFrontmatter(content);
  return fm.cancelled === true;
}

export function assertDevGateOrDeny() {
  const content = readProcessMd();
  const mode = getWorkflowMode(content);

  if (content && isActiveProcessCancelled()) {
    deny(
      '流程门禁：当前活跃流程已被用户取消终止（不可逆），禁止再对其进行任何开发/初始化操作。',
      'AGENTS.md R10：该 process.md 已标记 cancelled: true，永久冻结，无法恢复。如需继续工作，须发起新的流程/迭代（新的 process.md），不得尝试绕过或清除取消标记。',
    );
  }

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

  const r3 = checkIterationArtifacts(content);
  if (!r3.ok) {
    deny(
      `流程门禁（R3）：本次迭代缺少必需成果物或未被 process.md 引用：${(r3.missing ?? []).join('、')}`,
      'AGENTS.md R3：非 hotfix/docs-only 迭代进入开发前须校验四件成果物（requirement-spec.md、requirement-list.md、detail-design-spec.md、develop-task-list.md）存在且被 process.md 引用。',
    );
  }

  if (mode === 'hotfix') {
    const r9 = checkHotfixDesign(content);
    if (!r9.ok) {
      deny(
        '流程门禁（R9）：hotfix 前置校验未通过，detail-design-spec.md 不存在。',
        'AGENTS.md R9：hotfix 进入开发前须校验设计存在性；缺失须先由 system-architect 补最小热修设计微任务，禁止 PM/顶层代理代写设计。',
      );
    }
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

/**
 * R6：`.trae/` 下是否为受机制门禁保护的治理/工程化基建路径。
 * 白名单豁免（模板、rules、运行时状态、hooks/config 注册文件、工具链批准标记）之外，
 * `scripts|agents|hooks` 三目录一律纳入门禁；其余未命名子目录默认不纳入（与 R6 声明范围一致）。
 */
function isGatedDotTraePath(p) {
  const exempt = getMergedDotTraeExemptPatterns();
  if (exempt.some((pattern) => globPatternMatches(p, pattern))) return false;
  return /^\.trae\/(scripts|agents|hooks)(\/|$)/.test(p);
}

/** 是否为受门禁约束的开发产物路径 */
export function isGatedDevPath(filePath) {
  const p = normalizePath(filePath);
  if (!p) return false;

  if (p.includes('node_modules/')) return false;

  if (p.startsWith('.trae/')) {
    return isGatedDotTraePath(p);
  }

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

/** 从行文本中提取任务包编号（B1），如 A-DOC-1、B-LIB-1/2/3、T0-1、TE-FINAL */
function extractTaskCode(rowText) {
  const m = rowText.match(/\b([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+(?:\/\d+)*)\b/);
  return m ? m[1] : null;
}

/**
 * 统计「## 进度列表」中某角色的开发线状态（B1：按任务包编号取最新有效状态）。
 * 角色既可能以中文职责名记录，也可能以 `.trae/agents` 的 slug 记录。
 * 同一任务包编号出现多行时，取**最后一次出现**的状态；`已作废`/`superseded` 行
 * 作为 tombstone，使该任务包编号退出统计（不计入 total/complete/inProgress）。
 * 无法提取编号的行各自独立计数（不做跨行去重），避免误合并不同任务。
 */
function roleProgressStats(content, roleKey) {
  const body = extractSection(content, '进度列表');
  const stats = { total: 0, complete: 0, inProgress: 0 };
  const roleAliases = ROLE_ALIASES[roleKey] ?? [roleKey];
  if (!body) return stats;

  const latestByCode = new Map();
  let anonymousIndex = 0;

  for (const line of body.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('|')) continue;
    if (/^\|[\s|:-]+\|?$/.test(t)) continue; // 分隔行
    if (!roleAliases.some((alias) => t.includes(alias))) continue; // 仅本角色的开发线行

    const code = extractTaskCode(t) ?? `__row_${anonymousIndex++}`;
    const isTombstone = /已作废|superseded/i.test(t);
    let status = 'other';
    if (t.includes('执行完成')) status = 'complete';
    else if (t.includes('正在执行')) status = 'inProgress';

    latestByCode.set(code, isTombstone ? { status: 'tombstoned' } : { status });
  }

  for (const entry of latestByCode.values()) {
    if (entry.status === 'tombstoned') continue;
    stats.total += 1;
    if (entry.status === 'complete') stats.complete += 1;
    else if (entry.status === 'inProgress') stats.inProgress += 1;
  }

  return stats;
}

/**
 * 测试工程师专属统计：区分「批次集成测试」与「最终整体集成测试」两类行
 * （含「最终整体集成测试」「最终集成测试」「TE-FINAL」「TE-最终」之一者计入 final，其余计入 batch），
 * 同样应用 B1 去重/tombstone 规则（分桶后各自去重）。
 */
function testEngineerStats(content) {
  const body = extractSection(content, '进度列表');
  const batch = { total: 0, complete: 0, inProgress: 0 };
  const final = { total: 0, complete: 0, inProgress: 0 };
  if (!body) return { batch, final };

  const roleAliases = ROLE_ALIASES['测试工程师'];
  const latestByCode = new Map();
  let anonymousIndex = 0;

  for (const line of body.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('|')) continue;
    if (/^\|[\s|:-]+\|?$/.test(t)) continue;
    if (!roleAliases.some((alias) => t.includes(alias))) continue;

    const isFinal = /最终整体集成测试|最终集成测试|TE-FINAL|TE-最终/i.test(t);
    const baseCode = extractTaskCode(t) ?? `__row_${anonymousIndex++}`;
    const code = `${baseCode}__${isFinal ? 'final' : 'batch'}`;
    const isTombstone = /已作废|superseded/i.test(t);
    let status = 'other';
    if (t.includes('执行完成')) status = 'complete';
    else if (t.includes('正在执行')) status = 'inProgress';

    latestByCode.set(code, isTombstone ? { status: 'tombstoned', isFinal } : { status, isFinal });
  }

  for (const entry of latestByCode.values()) {
    if (entry.status === 'tombstoned') continue;
    const bucket = entry.isFinal ? final : batch;
    bucket.total += 1;
    if (entry.status === 'complete') bucket.complete += 1;
    else if (entry.status === 'inProgress') bucket.inProgress += 1;
  }

  return { batch, final };
}

/** 读取批次/最终 E2E 机读结果（e2e-run.mjs 产出），文件不存在或解析失败时返回 null */
export function readE2eResult(scope) {
  const file = scope === 'final' ? '.e2e-final-result.json' : '.e2e-batch-result.json';
  const resultPath = path.join(PROJECT_ROOT, 'test-results/e2e', file);
  if (!fs.existsSync(resultPath)) return null;
  try {
    const content = fs.readFileSync(resultPath, 'utf8').replace(/^\uFEFF/, '');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/** R15：读取 QE 阶段编程规范（lint）门禁机读结果（lint-run.mjs 产出），缺失/解析失败返回 null */
export function readLintResult() {
  const resultPath = path.join(PROJECT_ROOT, 'test-results/qe', '.lint-result.json');
  if (!fs.existsSync(resultPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(resultPath, 'utf8'));
  } catch {
    return null;
  }
}

/** R16：读取 QE 阶段静态代码质量门禁机读结果（static-scan-run.mjs 产出），缺失/解析失败返回 null */
export function readStaticScanResult() {
  const resultPath = path.join(PROJECT_ROOT, 'test-results/qe', '.static-scan-result.json');
  if (!fs.existsSync(resultPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(resultPath, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * R3：非 hotfix/docs-only 迭代进入开发前须校验四件成果物存在且被 process.md 引用。
 * `iterationType` 缺失时跳过（legacy 兼容）。
 */
export function checkIterationArtifacts(content) {
  const fm = parseProcessFrontmatter(content);
  const mode = fm.workflow_mode ?? 'full';
  if (mode === 'hotfix' || mode === 'docs-only') {
    return { ok: true, reason: 'exempt-mode' };
  }
  if (!fm.iterationType) {
    return { ok: true, reason: 'legacy-no-iterationType' };
  }

  const docsBase = getActiveDocsBase();
  const required = [
    ['requirement/requirement-spec.md', 'requirement-spec.md'],
    ['requirement/requirement-list.md', 'requirement-list.md'],
    ['design/detail-design-spec.md', 'detail-design-spec.md'],
    ['design/develop-task-list.md', 'develop-task-list.md'],
  ];

  const missing = [];
  for (const [rel, label] of required) {
    const abs = path.join(docsBase, rel);
    if (!fs.existsSync(abs)) {
      missing.push(label);
      continue;
    }
    if (!content.includes(label)) {
      missing.push(`${label}(未被process.md引用)`);
    }
  }
  return { ok: missing.length === 0, missing };
}

/** R9：hotfix 模式进入开发前须校验 detail-design-spec.md 是否存在 */
export function checkHotfixDesign(content) {
  const fm = parseProcessFrontmatter(content);
  if (fm.workflow_mode !== 'hotfix') {
    return { ok: true, reason: 'not-hotfix' };
  }
  const docsBase = getActiveDocsBase();
  const designPath = path.join(docsBase, 'design/detail-design-spec.md');
  return { ok: fs.existsSync(designPath), designPath };
}

/**
 * E2E 适用性豁免——无 UI 项目可豁免浏览器 E2E 相关判据，判定遵循 §8.2 双要素：
 * ①`gated-artifacts.json` 声明 `e2eApplicability: "n/a"`；
 * ②`process.md`「## 用户确认记录」含一行 E2E 豁免确认。两项皆满足才豁免（R12）。
 * 供 R17 分类型行（场景类型=E2E）机读联立使用。
 */
function hasE2eExemptionConfirmation(content) {
  const body = extractSection(content, '用户确认记录');
  if (!body) return false;
  for (const line of body.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('|')) continue;
    if (/^\|[\s|:-]+\|?$/.test(t)) continue;
    if (/e2e/i.test(t) && /豁免|不适用|n\/a|无/i.test(t)) return true;
  }
  return false;
}

export function isE2eExempt(content) {
  const artifacts = loadGatedArtifacts();
  if (artifacts.e2eApplicability !== 'n/a') return false;
  const md = content ?? readProcessMd();
  if (!md) return false;
  return hasE2eExemptionConfirmation(md);
}

/**
 * R17：业务数据存储对账适用性豁免——无业务数据持久化（数据库/文件/缓存/对象存储等）
 * 的项目可豁免 R17 机读判据，判定与 R14 同构（§8.2 双要素）：
 * ①`gated-artifacts.json` 声明 `storageReconciliationApplicability: "n/a"`；
 * ②`process.md`「## 用户确认记录」含一行存储对账豁免确认。两项皆满足才豁免（R12）。
 */
function hasStorageReconciliationExemptionConfirmation(content) {
  const body = extractSection(content, '用户确认记录');
  if (!body) return false;
  for (const line of body.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('|')) continue;
    if (/^\|[\s|:-]+\|?$/.test(t)) continue;
    if (/存储对账|对账/i.test(t) && /豁免|不适用|n\/a|无持久化/i.test(t)) return true;
  }
  return false;
}

export function isStorageReconciliationExempt(content) {
  const artifacts = loadGatedArtifacts();
  if (artifacts.storageReconciliationApplicability !== 'n/a') return false;
  const md = content ?? readProcessMd();
  if (!md) return false;
  return hasStorageReconciliationExemptionConfirmation(md);
}

/** R17：具名存储介质关键词（与 .trae/harness/spec/mechanical-gates.md §8.3 一致；不含「其他」「不适用」） */
const STORAGE_MEDIUM_NAMED_RE =
  /数据库|\bdb\b|database|文件|filesystem|\bfile\b|缓存|\bcache\b|对象存储|\bobject\b|\bblob\b|\bs3\b|\boss\b|\bminio\b/i;

/** R17：兜底介质「其他」——须另填非空备注说明具体系统（真实落盘介质，不可用于「无写入」） */
const STORAGE_MEDIUM_OTHER_RE = /其他|\bother\b/i;

/**
 * R17：任务包级「不适用」介质——仅用于批次内确无业务数据写入的任务包留痕；
 * 只参与任务包覆盖，不计入接口/E2E 分类型真实对账判定（防用「其他」伪装绕过）。
 */
const STORAGE_MEDIUM_NA_RE = /不适用|n\/a/i;

/** R17：场景类型=接口 */
const STORAGE_SCENE_API_RE = /接口|\bapi\b/i;

/** R17：场景类型=E2E */
const STORAGE_SCENE_E2E_RE = /e2e|\bui\b/i;

/** R17：该行是否为「不适用」留痕行（非真实对账） */
function isStorageReconNaRow(row) {
  if (!row?.medium) return false;
  if (STORAGE_MEDIUM_NAMED_RE.test(row.medium)) return false;
  if (STORAGE_MEDIUM_OTHER_RE.test(row.medium)) return false;
  return STORAGE_MEDIUM_NA_RE.test(row.medium);
}

/** R17：从进度行提取全部任务包编号（同一行可含多个，如 T0-1 与 T0-2） */
function extractAllTaskCodes(rowText) {
  const re = /\b([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+(?:\/\d+)*)\b/g;
  const codes = [];
  for (const m of rowText.matchAll(re)) codes.push(m[1]);
  return codes;
}

/**
 * R17：收集「## 进度列表」中测试工程师**已完成**的批次集成测试行所关联的任务包编号。
 * 用于按批次强制覆盖——每条已完成批次测试进度中的任务包，须在「## 存储对账记录」
 * 「关联任务包」列中至少出现一次（避免首批填过一次后后续批次空跑过门禁）。
 */
function collectCompletedBatchTestTaskCodes(content) {
  const body = extractSection(content, '进度列表');
  if (!body) return [];
  const roleAliases = ROLE_ALIASES['测试工程师'] ?? ['测试工程师'];
  const codes = new Set();
  for (const line of body.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('|')) continue;
    if (/^\|[\s|:-]+\|?$/.test(t)) continue;
    if (!roleAliases.some((alias) => t.includes(alias))) continue;
    if (/最终整体集成测试|最终集成测试|TE-FINAL|TE-最终/i.test(t)) continue;
    if (/已作废|superseded/i.test(t)) continue;
    if (!t.includes('执行完成')) continue;
    for (const code of extractAllTaskCodes(t)) codes.add(code);
  }
  return [...codes];
}

/**
 * 解析「## 存储对账记录」章节内表格的数据行。
 * 要求表头含：场景类型、关联任务包、存储介质、对账方式、预期存储结果、实际存储结果、是否通过；
 * 「备注」列可选（介质为「其他」时必填，在校验阶段强制）。
 * @returns {{ ok: false, reason: string } | { ok: true, rows: object[] }}
 */
function parseStorageReconciliationRows(content) {
  const body = extractSection(content, '存储对账记录');
  if (!body) return { ok: false, reason: 'no-storage-recon-section' };
  const tables = parseMarkdownTables(body);
  if (tables.length === 0) return { ok: false, reason: 'no-storage-recon-table' };
  for (const table of tables) {
    const sceneIdx = table.headers.findIndex((h) => /场景类型/.test(h));
    const taskIdx = table.headers.findIndex((h) => /关联任务包/.test(h));
    const mediumIdx = table.headers.findIndex((h) => /存储介质/.test(h));
    const methodIdx = table.headers.findIndex((h) => /对账方式/.test(h));
    const expectedIdx = table.headers.findIndex((h) => /预期存储结果/.test(h));
    const actualIdx = table.headers.findIndex((h) => /实际存储结果/.test(h));
    const passIdx = table.headers.findIndex((h) => /是否通过/.test(h));
    const noteIdx = table.headers.findIndex((h) => /^备注$/.test(h) || /备注/.test(h));
    if (
      sceneIdx === -1 ||
      taskIdx === -1 ||
      mediumIdx === -1 ||
      methodIdx === -1 ||
      expectedIdx === -1 ||
      actualIdx === -1 ||
      passIdx === -1
    ) {
      continue;
    }
    const rows = [];
    for (const row of table.rows) {
      const scene = (row[sceneIdx] ?? '').trim();
      const taskPkg = (row[taskIdx] ?? '').trim();
      const medium = (row[mediumIdx] ?? '').trim();
      const method = (row[methodIdx] ?? '').trim();
      const expected = (row[expectedIdx] ?? '').trim();
      const actual = (row[actualIdx] ?? '').trim();
      const passed = (row[passIdx] ?? '').trim();
      const note = noteIdx >= 0 ? (row[noteIdx] ?? '').trim() : '';
      if (
        !scene &&
        !taskPkg &&
        !medium &&
        !method &&
        !expected &&
        !actual &&
        !passed &&
        !note &&
        row.every((c) => !(c ?? '').trim())
      ) {
        continue;
      }
      rows.push({ scene, taskPkg, medium, method, expected, actual, passed, note });
    }
    if (rows.length === 0) return { ok: false, reason: 'no-storage-recon-data-row' };
    return { ok: true, rows };
  }
  return { ok: false, reason: 'no-storage-recon-required-columns' };
}

/**
 * 校验单行存储对账字段完备性（描述列非空、「其他」/「不适用」备注、介质关键词）。
 * 「不适用」行：备注必填说明理由；描述列可填「不适用」；不校验具名介质。
 * @returns {string|null} 失败 reason，通过则 null
 */
function validateStorageReconRow(row) {
  if (!row.taskPkg) return 'missing-task-package';
  if (!extractTaskCode(row.taskPkg)) return 'invalid-task-package';
  if (!row.method) return 'missing-recon-method';
  if (!row.expected) return 'missing-expected-result';
  if (!row.actual) return 'missing-actual-result';
  if (!row.passed) return 'missing-pass-result';
  if (!row.medium) return 'invalid-storage-medium';
  if (isStorageReconNaRow(row)) {
    if (!row.note) return 'na-medium-requires-note';
    return null;
  }
  const named = STORAGE_MEDIUM_NAMED_RE.test(row.medium);
  const other = STORAGE_MEDIUM_OTHER_RE.test(row.medium);
  if (!named && !other) return 'invalid-storage-medium';
  if (other && !named && !row.note) return 'other-medium-requires-note';
  return null;
}

/**
 * R17：批次（开发窗口）集成测试阶段必须做业务数据存储对账——测试报告须含非空的
 * 「## 存储对账记录」章节，且满足分类型行、描述列完备、「其他」/「不适用」备注、
 * 存储介质列与批次任务包覆盖机读（.trae/harness/spec/mechanical-gates.md §8.3 唯一权威）。
 * 「不适用」行仅计入任务包覆盖，不计入接口/E2E 分类型真实对账；项目未整体豁免时
 * 至少须有一条适用（真实对账）行。
 * 扫描当前活跃 docs 子树 `test/` 目录下所有 `*.md`；合并全部对账行后整体判定。
 * 无业务持久化项目按 `isStorageReconciliationExempt()` 在 parseWorkflowState 侧豁免。
 */
export function checkBatchStorageReconciliationReport(content) {
  const docsBase = getActiveDocsBase();
  const testDir = path.join(docsBase, 'test');
  if (!fs.existsSync(testDir)) return { ok: false, reason: 'missing-test-dir' };
  let files;
  try {
    files = fs.readdirSync(testDir).filter((f) => f.toLowerCase().endsWith('.md'));
  } catch {
    return { ok: false, reason: 'test-dir-unreadable' };
  }
  if (files.length === 0) return { ok: false, reason: 'no-test-report' };

  const md = content ?? readProcessMd() ?? '';
  const needApiRow = !isApiTestExempt(md);
  const needE2eRow = !isE2eExempt(md);
  const requiredTaskCodes = collectCompletedBatchTestTaskCodes(md);

  const allRows = [];
  let lastReason = 'no-storage-recon-section';
  for (const f of files) {
    let fileContent;
    try {
      fileContent = fs.readFileSync(path.join(testDir, f), 'utf8');
    } catch {
      continue;
    }
    const parsed = parseStorageReconciliationRows(fileContent);
    if (!parsed.ok) {
      lastReason = parsed.reason;
      continue;
    }
    allRows.push(...parsed.rows);
  }
  if (allRows.length === 0) return { ok: false, reason: lastReason };

  for (const row of allRows) {
    const rowFail = validateStorageReconRow(row);
    if (rowFail) return { ok: false, reason: rowFail };
  }

  const applicableRows = allRows.filter((r) => !isStorageReconNaRow(r));
  if (applicableRows.length === 0) {
    return { ok: false, reason: 'missing-applicable-recon-row' };
  }

  const hasApi = applicableRows.some((r) => STORAGE_SCENE_API_RE.test(r.scene));
  const hasE2e = applicableRows.some((r) => STORAGE_SCENE_E2E_RE.test(r.scene));
  if (needApiRow && !hasApi) return { ok: false, reason: 'missing-api-scene-row' };
  if (needE2eRow && !hasE2e) return { ok: false, reason: 'missing-e2e-scene-row' };

  if (requiredTaskCodes.length > 0) {
    const covered = new Set();
    for (const row of allRows) {
      for (const code of extractAllTaskCodes(row.taskPkg)) covered.add(code);
    }
    const missing = requiredTaskCodes.filter((c) => !covered.has(c));
    if (missing.length > 0) {
      return { ok: false, reason: `missing-batch-task-coverage:${missing.join(',')}` };
    }
  }

  return { ok: true, reason: 'checked' };
}

/**
 * R14：接口测试适用性豁免——无对外接口的项目（纯算法库、纯静态前端、无 HTTP/RPC/CLI
 * 契约的组件等）可豁免「必须做接口测试」判据，判定与 E2E 适用性豁免同构（§8.3）：
 * 须同时满足①架构师在活跃 `gated-artifacts.json` 声明 `apiTestApplicability: "n/a"`；
 * ②`process.md`「## 用户确认记录」含一行接口测试豁免确认。两项皆满足才豁免，避免单方
 * 面弱化门禁（R12）。
 */
function hasApiExemptionConfirmation(content) {
  const body = extractSection(content, '用户确认记录');
  if (!body) return false;
  for (const line of body.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('|')) continue;
    if (/^\|[\s|:-]+\|?$/.test(t)) continue; // 分隔行
    if (/接口测试|api/i.test(t) && /豁免|不适用|n\/a|无接口|无对外接口/i.test(t)) return true;
  }
  return false;
}

export function isApiTestExempt(content) {
  const artifacts = loadGatedArtifacts();
  if (artifacts.apiTestApplicability !== 'n/a') return false;
  const md = content ?? readProcessMd();
  if (!md) return false;
  return hasApiExemptionConfirmation(md);
}

/**
 * R15：编程规范（lint）适用性豁免——确无可用 linter 的项目（如无成熟 lint 工具的
 * 技术栈）可豁免「lint 门禁必须通过」判据，判定与 E2E / 接口测试适用性豁免同构：
 * 须同时满足①架构师在活跃 `gated-artifacts.json` 声明 `lintApplicability: "n/a"`；
 * ②`process.md`「## 用户确认记录」含一行编程规范/lint 豁免确认。两项皆满足才豁免，
 * 避免单方面弱化门禁（R12）。
 */
function hasLintExemptionConfirmation(content) {
  const body = extractSection(content, '用户确认记录');
  if (!body) return false;
  for (const line of body.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('|')) continue;
    if (/^\|[\s|:-]+\|?$/.test(t)) continue; // 分隔行
    if (/编程规范|代码规范|lint/i.test(t) && /豁免|不适用|n\/a|无\s*lint|无可用/i.test(t)) return true;
  }
  return false;
}

export function isLintExempt(content) {
  const artifacts = loadGatedArtifacts();
  if (artifacts.lintApplicability !== 'n/a') return false;
  const md = content ?? readProcessMd();
  if (!md) return false;
  return hasLintExemptionConfirmation(md);
}

/**
 * R16：重复代码检测（DRY）适用性豁免——判定与 lint 豁免（R15）同构：须同时满足
 * ①架构师在活跃 `gated-artifacts.json` 声明 `dupCheckApplicability: "n/a"`；
 * ②`process.md`「## 用户确认记录」含一行重复代码/DRY 豁免确认。两项皆满足才豁免，
 * 避免单方面弱化门禁（R12）。与安全扫描豁免（isSecurityScanExempt）相互独立。
 */
function hasDupExemptionConfirmation(content) {
  const body = extractSection(content, '用户确认记录');
  if (!body) return false;
  for (const line of body.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('|')) continue;
    if (/^\|[\s|:-]+\|?$/.test(t)) continue; // 分隔行
    if (/重复代码|dry|jscpd/i.test(t) && /豁免|不适用|n\/a|无/i.test(t)) return true;
  }
  return false;
}

export function isDupCheckExempt(content) {
  const artifacts = loadGatedArtifacts();
  if (artifacts.dupCheckApplicability !== 'n/a') return false;
  const md = content ?? readProcessMd();
  if (!md) return false;
  return hasDupExemptionConfirmation(md);
}

/**
 * R16：安全静态扫描（密钥泄露）适用性豁免——判定与 lint 豁免（R15）同构：须同时满足
 * ①架构师在活跃 `gated-artifacts.json` 声明 `securityScanApplicability: "n/a"`；
 * ②`process.md`「## 用户确认记录」含一行安全扫描豁免确认。两项皆满足才豁免，避免
 * 单方面弱化门禁（R12）。与重复代码豁免（isDupCheckExempt）相互独立。
 */
function hasSecurityExemptionConfirmation(content) {
  const body = extractSection(content, '用户确认记录');
  if (!body) return false;
  for (const line of body.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('|')) continue;
    if (/^\|[\s|:-]+\|?$/.test(t)) continue; // 分隔行
    if (/安全扫描|安全静态扫描|密钥扫描|secretscan|gitleaks/i.test(t) && /豁免|不适用|n\/a|无/i.test(t)) return true;
  }
  return false;
}

export function isSecurityScanExempt(content) {
  const artifacts = loadGatedArtifacts();
  if (artifacts.securityScanApplicability !== 'n/a') return false;
  const md = content ?? readProcessMd();
  if (!md) return false;
  return hasSecurityExemptionConfirmation(md);
}

/**
 * R14：批次（开发窗口）集成测试阶段必须做接口测试——测试报告须含非空的
 * 「## 接口测试报告」章节（至少一条真实表格数据行）。扫描当前活跃 docs 子树
 * `test/` 目录下所有 `*.md` 测试报告，任一含有效「## 接口测试报告」章节即通过。
 * 仅约束「开发窗口批次集成测试阶段」，最终整体集成测试与 hotfix 折叠通道不由此判定。
 * 无对外接口项目按 `isApiTestExempt()` 豁免（见上）。
 */
export function checkBatchApiTestReport() {
  const docsBase = getActiveDocsBase();
  const testDir = path.join(docsBase, 'test');
  if (!fs.existsSync(testDir)) return { ok: false, reason: 'missing-test-dir' };
  let files;
  try {
    files = fs.readdirSync(testDir).filter((f) => f.toLowerCase().endsWith('.md'));
  } catch {
    return { ok: false, reason: 'test-dir-unreadable' };
  }
  if (files.length === 0) return { ok: false, reason: 'no-test-report' };
  for (const f of files) {
    let content;
    try {
      content = fs.readFileSync(path.join(testDir, f), 'utf8');
    } catch {
      continue;
    }
    if (sectionHasDataRow(content, '接口测试报告')) {
      return { ok: true, reason: 'checked' };
    }
  }
  return { ok: false, reason: 'no-api-test-report-section' };
}

/** R13：需求成果物是否就绪（供发起 system-architect 前机械校验） */
export function checkRequirementReady() {
  const docsBase = getActiveDocsBase();
  const specPath = path.join(docsBase, 'requirement/requirement-spec.md');
  const listPath = path.join(docsBase, 'requirement/requirement-list.md');
  if (!fs.existsSync(specPath) || !fs.existsSync(listPath)) {
    return { ok: false, reason: 'missing-requirement-artifacts' };
  }
  const content = readProcessMd() ?? '';
  if (!sectionHasDataRow(content, '用户确认记录')) {
    return { ok: false, reason: 'no-user-confirmation' };
  }
  return { ok: true, reason: 'checked' };
}

/** R18：设计问题清单审核问题表必填表头 */
export const REQUIRED_DPL_HEADERS = [
  '检查维度',
  '问题描述',
  '严重等级',
  '是否存在',
  '是否解决',
  '关联成果物',
  '关联需求编号',
  '建议责任角色',
  '修复建议',
];

/** R18：设计审核 12 维（须全部出现在「检查维度」列） */
export const REQUIRED_DESIGN_REVIEW_DIMENSIONS = [
  '需求覆盖度',
  '目标达成性',
  '功能',
  '体验',
  '可行性',
  'MVP 范围',
  '任务可执行性',
  '流程合规性',
  '架构设计原则',
  '成果物完整性',
  '测试可执行性',
  '安全与合规',
];

const KNOWN_FIX_ROLE_RE =
  /^(system-architect|requirements-analyst|requirement-reviewer|project-manager|development-engineer|quality-engineer|test-engineer|qe|系统架构师|需求分析师|需求评审专家|项目经理|开发工程师|质量工程师|测试工程师)$/i;

/** 归一化需求编号：R-001（去前导零后至少 3 位） */
export function normalizeRequirementId(raw) {
  const m = String(raw ?? '')
    .trim()
    .match(/^R-0*(\d+)$/i);
  if (!m) return null;
  return `R-${m[1].padStart(3, '0')}`;
}

/** 从 requirement-list.md 提取全部 P0 需求编号 */
export function extractP0RequirementIds(content) {
  if (!content) return [];
  const ids = [];
  for (const table of parseMarkdownTables(content)) {
    const idIdx = table.headers.findIndex((h) => /需求编号/.test(h));
    const prioIdx = table.headers.findIndex((h) => /优先级/.test(h));
    if (idIdx === -1 || prioIdx === -1) continue;
    for (const row of table.rows) {
      const id = normalizeRequirementId(row[idIdx]);
      const prio = (row[prioIdx] ?? '').trim();
      if (id && /^P0$/i.test(prio)) ids.push(id);
    }
  }
  return [...new Set(ids)];
}

function normalizeDimensionName(raw) {
  const s = String(raw ?? '').trim();
  if (/^MVP(\s*范围)?$/i.test(s)) return 'MVP 范围';
  return s;
}

function isBlankOrPlaceholder(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return true;
  if (/^(高\/中\/低|已覆盖\/未覆盖)$/i.test(s)) return true;
  if (/^Given\/When\/Then/i.test(s)) return true;
  return false;
}

/** 从任务包单元格提取 T 编号（如 T0-1、T-DOC-1） */
function extractTaskPackIds(raw) {
  const matches = String(raw ?? '').match(/\bT[\w./-]+\b/g);
  return matches ? [...new Set(matches)] : [];
}

/**
 * 设计落点是否可在详细设计中解析到（stub 设计文件跳过）。
 * 有 §N 引用时，要求设计正文出现对应章节痕迹。
 */
function designAnchorResolvable(anchor, designContent) {
  if (!designContent) return true;
  const body = designContent.replace(/^#.+$/m, '').trim();
  if (!body) return true;
  const sectionMatch = String(anchor ?? '').match(/§\s*([\w.]+)/);
  if (!sectionMatch) return true;
  const n = sectionMatch[1];
  if (designContent.includes(`§${n}`)) return true;
  if (new RegExp(`^#+\\s*${n}([.\\s]|$)`, 'm').test(designContent)) return true;
  if (designContent.includes(`第${n}`)) return true;
  return false;
}

/** 任务包编号是否出现在开发任务清单（清单本身无任何 T 编号时视为 stub，跳过） */
function taskPackExistsInList(taskId, taskListContent) {
  if (!taskListContent) return true;
  if (!/\bT[\w./-]+\b/.test(taskListContent)) return true;
  return taskListContent.includes(taskId);
}

/**
 * R18：用户确认记录是否含技术选型/技术栈确认行。
 */
export function hasTechSelectionConfirmation(content) {
  const body = extractSection(content, '用户确认记录');
  if (!body) return false;
  for (const line of body.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('|')) continue;
    if (/^\|[\s|:-]+\|?$/.test(t)) continue;
    if (/确认项|时间|用户原话/.test(t) && /\|.*\|.*\|/.test(t) && !/技术/.test(t)) continue;
    if (/技术选型|技术栈/.test(t) && /确认|采用|同意|选定|已选/.test(t)) return true;
  }
  return false;
}

/** R18：技术选型确认机读（供 RR / DE 前置） */
export function checkTechSelectionConfirmed(content) {
  const md = content ?? readProcessMd() ?? '';
  if (!hasTechSelectionConfirmation(md)) {
    return {
      ok: false,
      reason: 'no-tech-selection-confirmation',
      message:
        'R18：process.md「## 用户确认记录」缺少技术选型/技术栈确认行，不得发起设计审核或开发。',
    };
  }
  return { ok: true, reason: 'checked' };
}

/**
 * R18：是否存在「曾登记为问题且已标记解决」的行（是否存在=是 且 是否解决=是）。
 * 用于强制 SA 返工后须经 RR 复审（审核结论须为「复审通过」）。
 */
export function hasResolvedDesignIssues(content) {
  const tables = parseMarkdownTables(content);
  for (const table of tables) {
    const existIdx = table.headers.findIndex((h) => /是否存在/.test(h));
    const resolvedIdx = table.headers.findIndex((h) => /是否解决/.test(h));
    if (existIdx === -1 || resolvedIdx === -1) continue;
    for (const row of table.rows) {
      const exists = (row[existIdx] ?? '').trim();
      const resolved = (row[resolvedIdx] ?? '').trim();
      if (/^是$/.test(exists) && /^是$/.test(resolved)) return true;
    }
  }
  return false;
}

/**
 * R18：审核结论机读——须有「## 审核结论」；最新结论为「通过」或「复审通过」；
 * 若存在已解决的设计问题行，最新结论必须为「复审通过」。
 */
export function checkDesignReviewConclusion(dplContent) {
  const section = extractSection(dplContent, '审核结论');
  if (section == null) {
    return {
      ok: false,
      reason: 'missing-review-conclusion',
      message: 'R18：设计问题清单缺少「## 审核结论」章节（首次通过填「通过」；返工后须「复审通过」）。',
    };
  }
  const tables = parseMarkdownTables(section);
  const table = tables.find((t) => t.headers.some((h) => /结论/.test(h)));
  if (!table || table.rows.length === 0) {
    return {
      ok: false,
      reason: 'missing-review-conclusion-rows',
      message: 'R18：「## 审核结论」缺少含「结论」列的数据行。',
    };
  }
  const verdictIdx = table.headers.findIndex((h) => /^结论$/.test(h.trim()) || /结论/.test(h));
  const last = table.rows[table.rows.length - 1];
  const verdict = (last[verdictIdx] ?? '').trim();
  const needsRereview = hasResolvedDesignIssues(dplContent);
  if (needsRereview) {
    if (!/^复审通过$/.test(verdict)) {
      return {
        ok: false,
        reason: 'rereview-required',
        message:
          'R18：设计问题清单存在已解决的问题行，须由 requirement-reviewer 复审并将「## 审核结论」最新结论标为「复审通过」后，方可进入开发。',
      };
    }
  } else if (!/^(通过|复审通过)$/.test(verdict)) {
    return {
      ok: false,
      reason: 'review-not-passed',
      message: `R18：「## 审核结论」最新结论须为「通过」或「复审通过」（当前：${verdict || '空'}）。`,
    };
  }
  return { ok: true, reason: needsRereview ? 'rereview-passed' : 'checked' };
}

/**
 * R9：声明 hotfix_p0_impact:none 时，用户确认记录是否含「hotfix影响面」判断依据行。
 * 仅校验关键词存在性，不校验语义真实性（与技术选型确认同构）。
 */
export function hasHotfixNoneJustification(content) {
  const body = extractSection(content, '用户确认记录');
  if (!body) return false;
  for (const line of body.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('|')) continue;
    if (/^\|[\s|:-]+\|?$/.test(t)) continue;
    if (/确认项|时间|用户原话/.test(t) && /\|.*\|.*\|/.test(t) && !/hotfix|热修/i.test(t)) {
      continue;
    }
    if (/hotfix影响面|hotfix\s*影响面|热修影响面/i.test(t)) return true;
  }
  return false;
}

/**
 * R9 扩展：hotfix 须声明 hotfix_p0_impact；声明 none 时须留痕判断依据；
 * 若为 p0/yes，则须 R18 设计审核清洁（含复审结论）。
 */
export function checkHotfixP0Impact(content) {
  const fm = parseProcessFrontmatter(content);
  if (fm.workflow_mode !== 'hotfix') {
    return { ok: true, reason: 'not-hotfix' };
  }
  const raw = String(fm.hotfix_p0_impact ?? '')
    .trim()
    .toLowerCase();
  if (!raw) {
    return {
      ok: false,
      reason: 'hotfix-p0-impact-unset',
      message:
        'R9：hotfix 须在 process.md frontmatter 声明 hotfix_p0_impact: none|p0（影响 P0 行为时为 p0）。',
    };
  }
  if (!/^(none|no|p0|yes)$/.test(raw)) {
    return {
      ok: false,
      reason: 'hotfix-p0-impact-invalid',
      message: `R9：hotfix_p0_impact 取值无效（${raw}），仅允许 none|p0。`,
    };
  }
  if (/^(none|no)$/.test(raw)) {
    if (!hasHotfixNoneJustification(content)) {
      return {
        ok: false,
        reason: 'hotfix-none-justification-missing',
        message:
          'R9：声明 hotfix_p0_impact:none 时须在 ## 用户确认记录 补一行判断依据（含关键词「hotfix影响面」）。',
      };
    }
  }
  if (/^(p0|yes)$/.test(raw)) {
    const clean = checkDesignReviewClean();
    if (!clean.ok) {
      return {
        ok: false,
        reason: 'hotfix-p0-needs-rr',
        message:
          clean.message ??
          'R9：hotfix 影响 P0 行为时须完成需求评审（R18 通过）或改走 workflow_mode: full。',
      };
    }
  }
  return { ok: true, reason: /^(p0|yes)$/.test(raw) ? 'p0-reviewed' : 'no-p0-impact' };
}

/**
 * 收集「本次 hotfix」相关的测试报告路径（不扫描整个 docs/test/ 目录）：
 * 1. process.md 正文显式引用的 `docs/.../test/*.md` / `test/*.md`；
 * 2. 若无引用，回退到规范名 `test-report.md`（存在时）。
 * 历史无关报告中的关键词/章节不得抑制本次软性提醒。
 */
function collectCurrentHotfixTestReportPaths(content) {
  const docsBase = getActiveDocsBase();
  const testDir = path.join(docsBase, 'test');
  const names = new Set();
  const refs =
    String(content ?? '').match(
      /(?:docs\/(?:[\w.-]+\/)?test\/|\/test\/|(?:^|[\s(`])test\/)([\w./-]+\.md)/gi,
    ) ?? [];
  for (const ref of refs) {
    const m = ref.match(/([\w./-]+\.md)$/i);
    if (m) names.add(path.basename(m[1]));
  }
  if (names.size === 0 && fs.existsSync(path.join(testDir, 'test-report.md'))) {
    names.add('test-report.md');
  }
  const paths = [];
  for (const name of names) {
    const abs = path.join(testDir, name);
    if (fs.existsSync(abs)) paths.push(abs);
  }
  return paths;
}

/**
 * R9 软性提醒（非阻塞，唯一权威定义见 .trae/harness/spec/gate-chain.md §5 R9 脚注第 4 条）：
 * P0 影响的 hotfix 走 R11 折叠通道时，R14（接口测试）/R17（存储对账）机读硬门禁
 * 明确不并入该通道（仅约束 full 模式开发窗口批次阶段），但高风险的 P0 行为变更仍
 * 应在**本次**测试报告中留痕接口/存储相关验证结果。本函数仅对**本次 hotfix 测试报告**
 * （process.md 引用或规范名 `test-report.md`）做结构化章节校验--须含非空
 * 「## 接口测试报告」「## 存储对账记录」真实数据行（同 R14/R17 的 `sectionHasDataRow`），
 * **不做全目录关键词匹配**；缺失时供 `recordHotfixP0SoftReminder` 写入一次性提醒，
 * **不阻塞流程、不影响 gatePassed/finalTestComplete**。
 */
export function checkHotfixP0InterfaceStorageMention(content) {
  const fm = parseProcessFrontmatter(content);
  if (fm.workflow_mode !== 'hotfix') return { applicable: false, reason: 'not-hotfix' };
  const raw = String(fm.hotfix_p0_impact ?? '').trim().toLowerCase();
  if (!/^(p0|yes)$/.test(raw)) return { applicable: false, reason: 'no-p0-impact' };

  const reportPaths = collectCurrentHotfixTestReportPaths(content);
  let mentionsInterface = false;
  let mentionsStorage = false;
  for (const reportPath of reportPaths) {
    let reportContent = '';
    try {
      reportContent = fs.readFileSync(reportPath, 'utf8');
    } catch {
      continue;
    }
    if (sectionHasDataRow(reportContent, '接口测试报告')) mentionsInterface = true;
    if (sectionHasDataRow(reportContent, '存储对账记录')) mentionsStorage = true;
  }
  return {
    applicable: true,
    mentionsInterface,
    mentionsStorage,
    reportPaths,
    needsReminder: !mentionsInterface || !mentionsStorage,
  };
}

const HOTFIX_P0_SOFT_REMINDER_MARKER = '<!-- hotfix-p0-interface-storage-reminder -->';

/**
 * 将 R9 软性提醒（见 `checkHotfixP0InterfaceStorageMention`）以一次性、非阻塞的方式
 * 写入活跃 `process.md`：仅在「hotfix + P0 影响 + 唯一测试通道已完成」时检测一次，
 * 命中即追加「## 门禁软性提醒（非阻塞）」章节并留下幂等标记（同一 process.md 不重复写入）。
 * 本函数**永不**返回失败以外的阻塞语义--调用方（`gate-stop-workflow`）须以 best-effort/
 * try-catch 方式调用，任何异常都不得影响正常的 allow/followup 判定。
 */
export function recordHotfixP0SoftReminder(content) {
  try {
    const processPath = getActiveProcessPath();
    if (!fs.existsSync(processPath)) return { ok: false, reason: 'no-process' };
    let fileContent = fs.readFileSync(processPath, 'utf8');
    const fm = parseProcessFrontmatter(fileContent);
    if (fm.cancelled === true) return { ok: false, reason: 'cancelled' };
    if (fileContent.includes(HOTFIX_P0_SOFT_REMINDER_MARKER)) {
      return { ok: true, reason: 'already-recorded' };
    }

    const check = checkHotfixP0InterfaceStorageMention(content ?? fileContent);
    if (!check.applicable || !check.needsReminder) {
      return { ok: true, reason: 'not-needed' };
    }

    const missing = [];
    if (!check.mentionsInterface) missing.push('接口测试报告（须含真实数据行）');
    if (!check.mentionsStorage) missing.push('存储对账记录（须含真实数据行）');

    const note = [
      '',
      '## 门禁软性提醒（非阻塞）',
      '',
      HOTFIX_P0_SOFT_REMINDER_MARKER,
      `- [R9 软性提醒] 本次 hotfix 声明 \`hotfix_p0_impact: p0\`（影响 P0 行为），但**本次**测试报告（process.md 引用或 \`test-report.md\`）缺少结构化「${missing.join('、')}」。R14/R17 机读硬门禁按 R11 明确不并入 hotfix 折叠通道，本提醒**不阻塞**本次收尾；建议 test-engineer/项目经理复核本次热修是否实际触及接口或业务数据存储，若涉及，请在本次测试报告补充对应章节与真实数据行供人工审查参考。`,
      '',
    ].join('\n');

    fileContent = `${fileContent.trimEnd()}\n${note}`;
    fs.writeFileSync(processPath, fileContent, 'utf8');
    return { ok: true, reason: 'recorded' };
  } catch (writeErr) {
    process.stderr.write(
      `[recordHotfixP0SoftReminder] failed: ${writeErr?.message ?? writeErr}\n`,
    );
    return { ok: false, reason: 'write-failed' };
  }
}

/**
 * §8.4：fail-open 时将异常持久化为 process.md 阻塞事件（cancelled 流程不写）。
 * 写入失败时仅 stderr，不影响 fail-open 放行。
 */
export function recordFailOpenEvent(hookName, context, err) {
  if (!err) return { ok: false, reason: 'no-error' };
  try {
    const processPath = getActiveProcessPath();
    if (!fs.existsSync(processPath)) return { ok: false, reason: 'no-process' };
    let content = fs.readFileSync(processPath, 'utf8');
    const fm = parseProcessFrontmatter(content);
    if (fm.cancelled === true) return { ok: false, reason: 'cancelled' };

    if (/^---\r?\n/.test(content)) {
      content = content.replace(/^---\r?\n([\s\S]*?)\r?\n---/, (block) => {
        if (/^blocking:\s*/m.test(block)) {
          return block.replace(/^blocking:\s*.*$/m, 'blocking: true');
        }
        return block.replace(/\n---\s*$/, '\nblocking: true\n---');
      });
    }

    const ts = new Date().toISOString();
    const msg = String(err?.message ?? err)
      .replace(/\|/g, '/')
      .replace(/\r?\n/g, ' ')
      .slice(0, 200);
    const row = `| ${ts} | ${hookName} | ${context} | ${msg} | 待处理 |`;
    const header = [
      '## 门禁异常事件',
      '',
      '| 时间 | Hook | 上下文 | 异常摘要 | 处理状态 |',
      '| ---- | ---- | ------ | -------- | -------- |',
      row,
      '',
    ].join('\n');

    if (/## 门禁异常事件/.test(content)) {
      content = content.replace(
        /(## 门禁异常事件\s*\n\s*\| 时间 \| Hook \| 上下文 \| 异常摘要 \| 处理状态 \|\s*\n\|[^\n]+\|\s*\n)/,
        `$1${row}\n`,
      );
      if (!content.includes(row)) {
        content = content.replace(/(## 门禁异常事件\s*\n)/, `$1\n${row}\n`);
      }
    } else {
      content = `${content.trimEnd()}\n\n${header}`;
    }

    if (/## 阻塞原因/.test(content)) {
      content = content.replace(
        /## 阻塞原因\s*\n+无\s*(?=\n## |\n*$)/,
        `## 阻塞原因\n\n- 阻塞原因：门禁 fail-open 异常（${hookName}/${context}），待项目经理处理\n- 待决事项：核查 stderr 与「## 门禁异常事件」，修复后门禁后清除 blocking\n- 已产出成果物：见门禁异常事件\n`,
      );
    }

    fs.writeFileSync(processPath, content, 'utf8');
    return { ok: true, reason: 'recorded' };
  } catch (writeErr) {
    process.stderr.write(
      `[recordFailOpenEvent] failed: ${writeErr?.message ?? writeErr}\n`,
    );
    return { ok: false, reason: 'write-failed' };
  }
}

function isNaRequirementRef(raw) {
  return /^(无|不适用|n\/a|—|-)$/i.test(String(raw ?? '').trim());
}

/**
 * R18：设计问题清单结构机读——必填表头、12 维齐全、未解决行可修复字段完备。
 */
export function checkDesignProblemListStructure(content) {
  if (!content) {
    return {
      ok: false,
      reason: 'empty-design-problem-list',
      message: 'R18：设计问题清单为空。',
    };
  }

  const tables = parseMarkdownTables(content);
  const issueTable = tables.find((t) => t.headers.some((h) => /检查维度/.test(h)));
  if (!issueTable) {
    return {
      ok: false,
      reason: 'missing-issue-table',
      message: 'R18：设计问题清单缺少含「检查维度」列的审核问题表。',
    };
  }

  for (const required of REQUIRED_DPL_HEADERS) {
    if (!issueTable.headers.some((h) => h === required || h.includes(required))) {
      return {
        ok: false,
        reason: 'missing-dpl-header',
        message: `R18：设计问题清单缺少必填列「${required}」（含关联需求编号/建议责任角色/修复建议等可修复字段）。`,
      };
    }
  }

  const dimIdx = issueTable.headers.findIndex((h) => /检查维度/.test(h));
  const existIdx = issueTable.headers.findIndex((h) => /是否存在/.test(h));
  const resolvedIdx = issueTable.headers.findIndex((h) => /是否解决/.test(h));
  const artifactIdx = issueTable.headers.findIndex((h) => /关联成果物/.test(h));
  const reqIdx = issueTable.headers.findIndex((h) => /关联需求编号/.test(h));
  const roleIdx = issueTable.headers.findIndex((h) => /建议责任角色/.test(h));
  const fixIdx = issueTable.headers.findIndex((h) => /修复建议/.test(h));

  const presentDims = new Set(
    issueTable.rows.map((row) => normalizeDimensionName(row[dimIdx])).filter(Boolean),
  );
  for (const dim of REQUIRED_DESIGN_REVIEW_DIMENSIONS) {
    if (!presentDims.has(dim)) {
      return {
        ok: false,
        reason: 'missing-review-dimension',
        message: `R18：设计问题清单缺少必审维度「${dim}」（含需求覆盖度/目标达成性等 12 维）。`,
      };
    }
  }

  for (const row of issueTable.rows) {
    const exists = (row[existIdx] ?? '').trim();
    const resolved = (row[resolvedIdx] ?? '').trim();
    if (!/^是$/.test(exists) || /^是$/.test(resolved)) continue;

    const artifact = (row[artifactIdx] ?? '').trim();
    const reqRef = (row[reqIdx] ?? '').trim();
    const role = (row[roleIdx] ?? '').trim();
    const fix = (row[fixIdx] ?? '').trim();

    if (isBlankOrPlaceholder(artifact)) {
      return {
        ok: false,
        reason: 'unresolved-missing-artifact',
        message: 'R18：未解决设计问题缺少「关联成果物」，无法供其他 Agent 定位修复。',
      };
    }
    if (isBlankOrPlaceholder(reqRef)) {
      return {
        ok: false,
        reason: 'unresolved-missing-req-ref',
        message: 'R18：未解决设计问题缺少「关联需求编号」（流程类问题可填「无」）。',
      };
    }
    if (!isNaRequirementRef(reqRef)) {
      const parts = reqRef.split(/[,，\s]+/).filter(Boolean);
      if (parts.length === 0 || !parts.every((p) => normalizeRequirementId(p))) {
        return {
          ok: false,
          reason: 'unresolved-bad-req-ref',
          message: 'R18：未解决设计问题的「关联需求编号」格式无效（须为 R-xxx 或「无」）。',
        };
      }
    }
    if (isBlankOrPlaceholder(role) || !KNOWN_FIX_ROLE_RE.test(role)) {
      return {
        ok: false,
        reason: 'unresolved-missing-role',
        message:
          'R18：未解决设计问题缺少合法「建议责任角色」（如 system-architect / 系统架构师）。',
      };
    }
    if (isBlankOrPlaceholder(fix)) {
      return {
        ok: false,
        reason: 'unresolved-missing-fix',
        message: 'R18：未解决设计问题缺少「修复建议」，无法供其他 Agent 执行返工。',
      };
    }
  }

  return { ok: true, reason: 'checked' };
}

/**
 * R18：需求覆盖矩阵机读--章节存在；全部 P0 出现且结论为「已覆盖」；
 * 「验收标准」「设计落点/设计支撑点」「设计落点原文摘录」「任务包」均非空；
 * 在设计/任务清单非 stub 时交叉校验可解析性（原文摘录仅校验列存在与非空，语义相关性仍由人工核验）。
 */
export function checkRequirementCoverageMatrix(dplContent, reqListContent) {
  const section = extractSection(dplContent, '需求覆盖矩阵');
  if (section == null) {
    return {
      ok: false,
      reason: 'missing-coverage-matrix',
      message: 'R18：设计问题清单缺少「## 需求覆盖矩阵」章节。',
    };
  }

  const p0Ids = extractP0RequirementIds(reqListContent);
  const tables = parseMarkdownTables(section);
  const matrix = tables.find(
    (t) =>
      t.headers.some((h) => /需求编号/.test(h)) && t.headers.some((h) => /覆盖结论/.test(h)),
  );
  if (!matrix) {
    return {
      ok: false,
      reason: 'missing-coverage-table',
      message: 'R18：需求覆盖矩阵缺少含「需求编号」「覆盖结论」列的表格。',
    };
  }

  const idIdx = matrix.headers.findIndex((h) => /需求编号/.test(h));
  const acIdx = matrix.headers.findIndex((h) => /验收标准/.test(h));
  // 「设计落点原文摘录」亦含「设计落点」字样，须显式排除，避免列索引串位
  const anchorIdx = matrix.headers.findIndex(
    (h) => /设计落点|设计支撑点/.test(h) && !/原文摘录/.test(h),
  );
  const excerptIdx = matrix.headers.findIndex((h) => /原文摘录/.test(h));
  const taskIdx = matrix.headers.findIndex((h) => /任务包/.test(h));
  const verdictIdx = matrix.headers.findIndex((h) => /覆盖结论/.test(h));
  if (acIdx === -1) {
    return {
      ok: false,
      reason: 'missing-acceptance-column',
      message: 'R18：需求覆盖矩阵缺少「验收标准」列（须固化验收标准 ↔ 设计支撑 ↔ 任务包）。',
    };
  }
  if (anchorIdx === -1 || taskIdx === -1) {
    return {
      ok: false,
      reason: 'missing-coverage-columns',
      message: 'R18：需求覆盖矩阵缺少「设计落点/设计支撑点」或「任务包」列。',
    };
  }
  if (excerptIdx === -1) {
    return {
      ok: false,
      reason: 'missing-excerpt-column',
      message:
        'R18：需求覆盖矩阵缺少「设计落点原文摘录」列（须摘录设计文档相关原句，供人工核验；机读仅校验列存在与非空）。',
    };
  }

  const docsBase = getActiveDocsBase();
  const designPath = path.join(docsBase, 'design/detail-design-spec.md');
  const taskListPath = path.join(docsBase, 'design/develop-task-list.md');
  const designContent = fs.existsSync(designPath)
    ? fs.readFileSync(designPath, 'utf8')
    : '';
  const taskListContent = fs.existsSync(taskListPath)
    ? fs.readFileSync(taskListPath, 'utf8')
    : '';

  const rowById = new Map();
  for (const row of matrix.rows) {
    const id = normalizeRequirementId(row[idIdx]);
    if (id) rowById.set(id, row);
  }

  for (const id of p0Ids) {
    const row = rowById.get(id);
    if (!row) {
      return {
        ok: false,
        reason: 'p0-missing-in-matrix',
        message: `R18：P0 需求 ${id} 未出现在需求覆盖矩阵中。`,
      };
    }
    const verdict = (row[verdictIdx] ?? '').trim();
    if (!/^已覆盖$/.test(verdict)) {
      return {
        ok: false,
        reason: 'p0-not-covered',
        message: `R18：P0 需求 ${id} 覆盖结论不是「已覆盖」（当前：${verdict || '空'}）。`,
      };
    }
    if (isBlankOrPlaceholder(row[acIdx])) {
      return {
        ok: false,
        reason: 'p0-empty-acceptance',
        message: `R18：P0 需求 ${id} 的「验收标准」为空（须填写可读验收断言或编号）。`,
      };
    }
    if (isBlankOrPlaceholder(row[anchorIdx])) {
      return {
        ok: false,
        reason: 'p0-empty-design-anchor',
        message: `R18：P0 需求 ${id} 的「设计落点/设计支撑点」为空。`,
      };
    }
    if (isBlankOrPlaceholder(row[excerptIdx])) {
      return {
        ok: false,
        reason: 'p0-empty-design-excerpt',
        message: `R18：P0 需求 ${id} 的「设计落点原文摘录」为空（须摘录设计文档中与该验收标准直接相关的一句原文）。`,
      };
    }
    if (isBlankOrPlaceholder(row[taskIdx])) {
      return {
        ok: false,
        reason: 'p0-empty-task-anchor',
        message: `R18：P0 需求 ${id} 的「任务包」为空。`,
      };
    }
    if (!designAnchorResolvable(row[anchorIdx], designContent)) {
      return {
        ok: false,
        reason: 'p0-design-anchor-unresolved',
        message: `R18：P0 需求 ${id} 的设计落点「${row[anchorIdx]}」在 detail-design-spec.md 中无法解析到对应章节。`,
      };
    }
    const taskIds = extractTaskPackIds(row[taskIdx]);
    if (taskIds.length === 0) {
      return {
        ok: false,
        reason: 'p0-task-id-unparseable',
        message: `R18：P0 需求 ${id} 的「任务包」须含可识别编号（如 T0-1）。`,
      };
    }
    for (const tid of taskIds) {
      if (!taskPackExistsInList(tid, taskListContent)) {
        return {
          ok: false,
          reason: 'p0-task-not-found',
          message: `R18：P0 需求 ${id} 引用的任务包 ${tid} 未出现在 develop-task-list.md 中。`,
        };
      }
    }
  }

  return { ok: true, reason: p0Ids.length === 0 ? 'no-p0' : 'checked' };
}

/** R13：设计成果物是否就绪（供发起 requirement-reviewer 设计审核 / development-engineer 前机械校验） */
export function checkDesignReady() {
  const docsBase = getActiveDocsBase();
  const designPath = path.join(docsBase, 'design/detail-design-spec.md');
  const taskListPath = path.join(docsBase, 'design/develop-task-list.md');
  if (!fs.existsSync(designPath) || !fs.existsSync(taskListPath)) {
    return { ok: false, reason: 'missing-design-artifacts' };
  }
  return { ok: true, reason: 'checked' };
}

/**
 * R13 + R18：设计审核是否通过（供发起 development-engineer 前机械校验）。
 * 校验：清单存在 -> 结构/12 维/可修复字段 -> 无未解决问题 -> P0 需求覆盖矩阵
 * （含验收标准列与落点交叉校验）-> 审核结论（返工后须复审通过）。
 */
export function checkDesignReviewClean() {
  const docsBase = getActiveDocsBase();
  const designProblemPath = path.join(docsBase, 'design/design-problem-list.md');
  if (!fs.existsSync(designProblemPath)) {
    return {
      ok: false,
      reason: 'missing-design-problem-list',
      message: '设计问题清单缺失，设计审核未通过，不得发起开发工程师。',
    };
  }
  const content = fs.readFileSync(designProblemPath, 'utf8');

  const structure = checkDesignProblemListStructure(content);
  if (!structure.ok) return structure;

  if (hasUnresolvedIssues(content)) {
    return {
      ok: false,
      reason: 'unresolved-design-issues',
      message: '设计问题清单存在未解决问题，设计审核未通过，不得发起开发工程师。',
    };
  }

  const reqListPath = path.join(docsBase, 'requirement/requirement-list.md');
  if (!fs.existsSync(reqListPath)) {
    return {
      ok: false,
      reason: 'missing-requirement-list-for-coverage',
      message: 'R18：缺少 requirement-list.md，无法校验需求覆盖矩阵。',
    };
  }
  const reqList = fs.readFileSync(reqListPath, 'utf8');
  const coverage = checkRequirementCoverageMatrix(content, reqList);
  if (!coverage.ok) return coverage;

  const conclusion = checkDesignReviewConclusion(content);
  if (!conclusion.ok) return conclusion;

  return { ok: true, reason: 'checked' };
}

/** R13：质量报告是否无未解决高/中问题、且质量判定通过（供发起 test-engineer 前机械校验） */
export function checkQeClean() {
  const docsBase = getActiveDocsBase();
  const qualityDir = path.join(docsBase, 'quality');
  if (!fs.existsSync(qualityDir)) return { ok: false, reason: 'missing-quality-dir' };
  const files = fs.readdirSync(qualityDir).filter((f) => /^quality-report.*\.md$/.test(f));
  if (files.length === 0) return { ok: false, reason: 'no-quality-report' };
  for (const f of files) {
    const content = fs.readFileSync(path.join(qualityDir, f), 'utf8');
    if (hasUnresolvedIssues(content)) return { ok: false, reason: `unresolved-in-${f}` };
    if (/质量判定[:：]\s*不通过/.test(content)) return { ok: false, reason: `qe-fail-${f}` };
  }
  return { ok: true, reason: 'checked' };
}

/**
 * R15：编程规范（lint）门禁是否通过（供发起 test-engineer 前机械校验，与 checkQeClean 并列）。
 * docs-only 模式或经双要素适用性豁免时视为通过；否则须存在 lint-run.mjs 机读产物且 gatePassed=true。
 */
export function checkLintClean(content) {
  if (content == null) content = readProcessMd() ?? '';
  if (getWorkflowMode(content) === 'docs-only') return { ok: true, reason: 'docs-only' };
  if (isLintExempt(content)) return { ok: true, reason: 'lint-exempt' };
  const result = readLintResult();
  if (!result) return { ok: false, reason: 'no-lint-result' };
  return result.gatePassed === true
    ? { ok: true, reason: 'checked' }
    : { ok: false, reason: 'lint-not-passed' };
}

/**
 * R16：静态代码质量门禁是否通过（供发起 test-engineer 前机械校验，与 checkLintClean 并列）。
 * docs-only 模式视为通过；否则须存在 static-scan-run.mjs 机读产物且 gatePassed=true，
 * 或重复代码/安全扫描分别经双要素豁免后各自视为满足。
 */
export function checkStaticScanClean(content) {
  if (content == null) content = readProcessMd() ?? '';
  if (getWorkflowMode(content) === 'docs-only') return { ok: true, reason: 'docs-only' };
  const result = readStaticScanResult();
  const dupOk = isDupCheckExempt(content) || result?.duplication?.gatePassed === true;
  const securityOk = isSecurityScanExempt(content) || result?.security?.gatePassed === true;
  if (dupOk && securityOk) return { ok: true, reason: 'checked' };
  if (!result) return { ok: false, reason: 'no-static-scan-result' };
  if (!dupOk) return { ok: false, reason: 'dup-check-not-passed' };
  return { ok: false, reason: 'security-scan-not-passed' };
}

/**
 * 从「## 当前分派计划 / ## 待派发角色列表」提取本次 quality-engineer 审查的任务包编号。
 * 分派计划行：分派角色为 quality-engineer/质量工程师，任务包编号列（或整行）含 B1 编号；
 * 待派发行：角色列为 quality-engineer，说明列含任务包编号。
 */
export function extractQeDispatchTaskPacks(content) {
  const packs = new Set();
  const qeAliases = ROLE_ALIASES['质量工程师'] ?? ['quality-engineer', '质量工程师'];

  const planSection = extractSection(content, '当前分派计划');
  if (planSection) {
    const tables = parseMarkdownTables(planSection);
    for (const table of tables) {
      const roleIdx = table.headers.findIndex((h) => /分派角色|角色/.test(h));
      const packIdx = table.headers.findIndex((h) => /任务包/.test(h));
      for (const row of table.rows) {
        const roleCell = roleIdx >= 0 ? row[roleIdx] ?? '' : row.join(' ');
        if (!qeAliases.some((a) => String(roleCell).includes(a))) continue;
        const raw = packIdx >= 0 ? row[packIdx] ?? '' : row.join(' ');
        for (const id of extractAllTaskCodes(raw)) packs.add(id);
      }
    }
  }

  const pendingSection = extractSection(content, '待派发角色列表');
  if (pendingSection) {
    const tables = parseMarkdownTables(pendingSection);
    for (const table of tables) {
      const roleIdx = table.headers.findIndex((h) => /角色/.test(h));
      const noteIdx = table.headers.findIndex((h) => /说明|任务包|范围/.test(h));
      for (const row of table.rows) {
        const roleCell = roleIdx >= 0 ? row[roleIdx] ?? '' : row.join(' ');
        if (!qeAliases.some((a) => String(roleCell).includes(a))) continue;
        const raw = noteIdx >= 0 ? row[noteIdx] ?? '' : row.join(' ');
        for (const id of extractAllTaskCodes(raw)) packs.add(id);
      }
    }
  }

  return [...packs];
}

/**
 * 查询「## 进度列表」中指定任务包对应开发工程师行的最新有效状态（B1）。
 * @returns {'complete'|'inProgress'|'other'|null} null = 未找到该任务包的开发行
 */
export function getDevLineStatusForTaskPack(content, taskId) {
  const body = extractSection(content, '进度列表');
  if (!body || !taskId) return null;
  const roleAliases = ROLE_ALIASES['开发工程师'] ?? ['开发工程师', 'development-engineer'];
  let latest = null;
  for (const line of body.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('|')) continue;
    if (/^\|[\s|:-]+\|?$/.test(t)) continue;
    if (!roleAliases.some((alias) => t.includes(alias))) continue;
    const code = extractTaskCode(t);
    if (code !== taskId) continue;
    if (/已作废|superseded/i.test(t)) {
      latest = null; // tombstone
      continue;
    }
    if (t.includes('执行完成')) latest = 'complete';
    else if (t.includes('正在执行')) latest = 'inProgress';
    else latest = 'other';
  }
  return latest;
}

/**
 * R13：成果物门禁链机械化--对 §5 表格中可客观判定的前置条件做机械校验，
 * 供 `gate-role-sequence.mjs` 在 Task 发起前拦截。仅覆盖客观可判定部分；
 * 调用者身份（顶层代理 vs 子 agent）与语义类判断（如 single-task 是否单文件级）
 * 不可机械化，继续由 AGENTS.md 文字约束承担（见 R8/R2 说明）。
 * 未知角色 / 无 process.md 时 fail-open 放行，避免因字段解析不确定或流程尚未
 * 启动而误锁死整个框架。
 */
export function checkRoleDispatchGate(role) {
  const normalizedRole = normalizeRoleSlug(role) ?? role;
  const content = readProcessMd();
  if (!content) return { ok: true, reason: 'no-process-yet' };

  const fm = parseProcessFrontmatter(content);
  if (fm.cancelled === true) {
    return {
      ok: false,
      reason: 'cancelled',
      message: '该流程已被用户取消终止（不可逆，R10），不得再对其发起任何角色 Task；请发起新流程/迭代。',
    };
  }
  if (isProcessBlocked(content)) {
    return {
      ok: false,
      reason: 'blocked',
      message: 'process.md 处于阻塞状态，须等待用户确认后才能继续分派。',
    };
  }

  const mode = fm.workflow_mode ?? 'full';

  switch (normalizedRole) {
    case 'system-architect': {
      if (mode === 'hotfix' || mode === 'docs-only') return { ok: true, reason: `${mode}-exempt` };
      const r = checkRequirementReady();
      return r.ok
        ? { ok: true, reason: 'checked' }
        : {
            ok: false,
            reason: r.reason,
            message:
              '需求成果物未就绪（requirement-spec.md/requirement-list.md 缺失，或用户确认记录为空），不得发起 system-architect。',
          };
    }
    case 'requirement-reviewer': {
      const r = checkDesignReady();
      if (!r.ok) {
        return {
          ok: false,
          reason: r.reason,
          message: '设计成果物未就绪（detail-design-spec.md/develop-task-list.md 缺失），不得发起 requirement-reviewer 设计审核。',
        };
      }
      if (mode !== 'hotfix' && mode !== 'docs-only') {
        const tech = checkTechSelectionConfirmed(content);
        if (!tech.ok) {
          return {
            ok: false,
            reason: tech.reason,
            message: tech.message,
          };
        }
      }
      return { ok: true, reason: 'checked' };
    }
    case 'development-engineer': {
      if (mode === 'docs-only') {
        return { ok: false, reason: 'docs-only', message: 'docs-only 模式禁止分派开发工程师。' };
      }
      if (mode === 'hotfix') {
        const h = checkHotfixDesign(content);
        if (!h.ok) {
          return {
            ok: false,
            reason: 'hotfix-design-missing',
            message: 'R9：hotfix 前置校验未通过，detail-design-spec.md 不存在，须先由 system-architect 补最小热修设计。',
          };
        }
        const p0 = checkHotfixP0Impact(content);
        if (!p0.ok) return p0;
      } else {
        const tech = checkTechSelectionConfirmed(content);
        if (!tech.ok) {
          return {
            ok: false,
            reason: tech.reason,
            message: tech.message,
          };
        }
        const d = checkDesignReady();
        if (!d.ok) {
          return { ok: false, reason: d.reason, message: '设计成果物未就绪，不得发起开发工程师。' };
        }
        const clean = checkDesignReviewClean();
        if (!clean.ok) {
          return {
            ok: false,
            reason: clean.reason,
            message:
              clean.message ??
              '设计问题清单存在未解决问题或 R18 机读未通过，设计审核未通过，不得发起开发工程师。',
          };
        }
      }
      if (!hasValidDispatchPlan(content)) {
        return { ok: false, reason: 'no-dispatch-plan', message: '尚无项目经理有效分派计划，不得发起开发工程师。' };
      }
      return { ok: true, reason: 'checked' };
    }
    case 'quality-engineer': {
      const state = parseWorkflowState(content);
      if (!(state.devComplete || state.devInProgress)) {
        return {
          ok: false,
          reason: 'dev-not-started',
          message: '开发工程师尚未产出/尚未标记执行状态，不得发起质量工程师。',
        };
      }
      const qePacks = extractQeDispatchTaskPacks(content);
      if (qePacks.length === 0) {
        return {
          ok: false,
          reason: 'qe-missing-task-packs',
          message:
            '分派 quality-engineer 前，须在「## 当前分派计划」或「## 待派发角色列表」标明本次审查的任务包编号（分派角色/角色列为 quality-engineer）。',
        };
      }
      const incomplete = [];
      for (const tid of qePacks) {
        const status = getDevLineStatusForTaskPack(content, tid);
        if (status !== 'complete') {
          const label =
            status === 'inProgress'
              ? '正在执行'
              : status === 'other'
                ? '非执行完成'
                : '未找到开发行';
          incomplete.push(`${tid}（${label}）`);
        }
      }
      if (incomplete.length > 0) {
        return {
          ok: false,
          reason: 'qe-dev-line-not-complete',
          message: `质量工程师对应开发线尚未「执行完成」：${incomplete.join('、')}。须等开发完成并更新进度后再派发 QE。`,
        };
      }
      return { ok: true, reason: 'checked' };
    }
    case 'test-engineer': {
      const state = parseWorkflowState(content);
      if (!state.qeComplete) {
        return { ok: false, reason: 'qe-not-complete', message: '质量工程师审核尚未全部通过，不得发起测试工程师。' };
      }
      const qeClean = checkQeClean();
      if (!qeClean.ok) {
        return { ok: false, reason: qeClean.reason, message: '质量报告存在未解决高/中严重等级问题或质量判定未通过，不得发起测试工程师。' };
      }
      const lintClean = checkLintClean();
      if (!lintClean.ok) {
        return { ok: false, reason: lintClean.reason, message: 'R15：编程规范（lint）门禁未通过（.lint-result.json 缺失或 gatePassed≠true），QE 阶段须运行 `node .trae/scripts/lint-run.mjs` 并整改至通过；确无可用 linter 时须走「架构师声明 lintApplicability:"n/a" + 用户确认」双要素豁免。不得发起测试工程师。' };
      }
      const staticScanClean = checkStaticScanClean();
      if (!staticScanClean.ok) {
        return { ok: false, reason: staticScanClean.reason, message: 'R16：静态代码质量门禁未通过（.static-scan-result.json 缺失或重复代码/安全扫描任一 gatePassed≠true），QE 阶段须运行 `node .trae/scripts/static-scan-run.mjs` 并整改至通过；确无法运行时须分别走「架构师声明 dupCheckApplicability/securityScanApplicability:"n/a" + 用户确认」双要素豁免。不得发起测试工程师。' };
      }
      return { ok: true, reason: 'checked' };
    }
    default:
      // project-manager / requirements-analyst 及未识别角色：无强前置或不可机械判定，放行
      return { ok: true, reason: 'not-gated' };
  }
}

/** 从 process.md 解析流程状态（按开发线聚合，支持并行批次；含批次/最终 E2E 状态与 R11 hotfix 折叠） */
export function parseWorkflowState(content) {
  if (!content) {
    return {
      blocking: false,
      cancelled: false,
      devInProgress: false,
      devComplete: false,
      hasQeRecord: false,
      qeComplete: false,
      testComplete: false,
      batchTestRowComplete: false,
      finalTestRowComplete: false,
      batchE2ePassed: false,
      finalE2ePassed: false,
      apiTestExempt: false,
      batchApiReportPresent: false,
      storageReconciliationExempt: false,
      batchStorageReconPresent: false,
      lintExempt: false,
      lintPassed: false,
      staticScanExempt: false,
      staticScanPassed: false,
      batchTestComplete: false,
      finalTestComplete: false,
      finalTestRequired: false,
      phase: null,
      workflowMode: 'full',
    };
  }

  const fm = parseProcessFrontmatter(content);
  const blocking = fm.blocking === true || isProcessBlocked(content);
  const cancelled = fm.cancelled === true;
  const workflowMode = fm.workflow_mode ?? 'full';
  const isHotfix = workflowMode === 'hotfix';
  const isDocsOnly = workflowMode === 'docs-only';

  const dev = roleProgressStats(content, '开发工程师');
  const qe = roleProgressStats(content, '质量工程师');
  const te = testEngineerStats(content);

  const devInProgress = dev.inProgress > 0;
  const devComplete = dev.total > 0 && dev.complete === dev.total && dev.inProgress === 0;
  const hasQeRecord = qe.total > 0;
  const qeComplete = qe.total > 0 && qe.complete === qe.total && qe.inProgress === 0;

  const batchTestRowComplete = te.batch.total > 0 && te.batch.complete === te.batch.total && te.batch.inProgress === 0;
  const finalTestRowComplete = te.final.total > 0 && te.final.complete === te.final.total && te.final.inProgress === 0;

  const batchResult = readE2eResult('batch');
  const finalResult = readE2eResult('final');
  const batchE2ePassed = batchResult?.gatePassed === true;
  const finalE2ePassed = finalResult?.gatePassed === true;

  // R14：开发窗口批次集成测试阶段必须做接口测试，测试报告须含「## 接口测试报告」章节；
  // 无对外接口项目经架构师声明 + 用户确认后豁免（batchApiReportPresent 视为满足）。
  const apiTestExempt = isApiTestExempt(content);
  const batchApiReportPresent = apiTestExempt || checkBatchApiTestReport().ok;

  // R17：开发窗口批次集成测试阶段必须做业务数据存储对账；无业务持久化项目经双要素豁免后
  // batchStorageReconPresent 视为满足（分类型行/存储介质列机读见 checkBatchStorageReconciliationReport）。
  const storageReconciliationExempt = isStorageReconciliationExempt(content);
  const batchStorageReconPresent =
    storageReconciliationExempt || checkBatchStorageReconciliationReport(content).ok;

  // R15：编程规范（lint）硬门禁——QE 阶段须实际运行 lint 且 gatePassed=true（机读产物
  // test-results/qe/.lint-result.json）。docs-only 无开发窗口视为满足；确无可用 linter 项目
  // 经「架构师声明 lintApplicability:"n/a" + 用户确认」双要素豁免后视为满足（防单方面弱化，R12）。
  const lintExempt = isLintExempt(content);
  const lintResult = readLintResult();
  const lintPassed = isDocsOnly ? true : (lintExempt || lintResult?.gatePassed === true);

  // R16：静态代码质量硬门禁（重复代码 DRY + 安全静态扫描）——QE 阶段须实际运行且
  // 两项子检查均 gatePassed=true（机读产物 test-results/qe/.static-scan-result.json）。
  // docs-only 无开发窗口视为满足；重复代码/安全扫描可分别经「架构师声明
  // dupCheckApplicability|securityScanApplicability:"n/a" + 用户确认」双要素豁免后视为满足
  // （防单方面弱化，R12）。staticScanExempt 仅当两项子检查均处于豁免状态时为 true。
  const staticScanResult = readStaticScanResult();
  const dupCheckExempt = isDupCheckExempt(content);
  const securityScanExempt = isSecurityScanExempt(content);
  const staticScanExempt = dupCheckExempt && securityScanExempt;
  const staticScanPassed = isDocsOnly
    ? true
    : (dupCheckExempt || staticScanResult?.duplication?.gatePassed === true) &&
      (securityScanExempt || staticScanResult?.security?.gatePassed === true);

  // R11：hotfix 折叠批次/最终为单次通道——不要求独立的批次集成测试环节，
  // 直接以「最终」判据为准（test-engineer 以 --scope=final 语义运行一次）；R14/R17
  // 机读判据仅约束「开发窗口批次集成测试阶段」，故 hotfix 折叠通道不并入该判据。
  const batchTestComplete = isHotfix
    ? true
    : batchTestRowComplete && batchE2ePassed && batchApiReportPresent && batchStorageReconPresent;
  const finalTestComplete = isDocsOnly ? true : finalTestRowComplete && finalE2ePassed;

  const finalTestRequired = isDocsOnly
    ? false
    : isHotfix
      ? devComplete && qeComplete
      : devComplete && qeComplete && batchTestComplete;

  return {
    blocking,
    cancelled,
    devInProgress,
    devComplete,
    hasQeRecord,
    qeComplete,
    testComplete: finalTestComplete, // 兼容旧字段名
    batchTestRowComplete,
    finalTestRowComplete,
    batchE2ePassed,
    finalE2ePassed,
    apiTestExempt,
    batchApiReportPresent,
    storageReconciliationExempt,
    batchStorageReconPresent,
    lintExempt,
    lintPassed,
    staticScanExempt,
    staticScanPassed,
    batchTestComplete,
    finalTestComplete,
    finalTestRequired,
    phase: fm.phase ?? null,
    workflowMode,
  };
}
