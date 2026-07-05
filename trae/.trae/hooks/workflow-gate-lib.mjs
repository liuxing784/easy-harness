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
  qa: {
    commands: {},
  },
};

const ROLE_ALIASES = {
  '开发工程师': ['开发工程师', 'development-engineer'],
  '质量保障工程师': ['质量保障工程师', 'quality-assurance-engineer'],
  '测试工程师': ['测试工程师', 'test-engineer'],
};

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
      _configCache.qa = { ...DEFAULT_CONFIG.qa, ...parsed.qa };
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

/** R13：设计成果物是否就绪（供发起 product-manager 设计审核 / development-engineer 前机械校验） */
export function checkDesignReady() {
  const docsBase = getActiveDocsBase();
  const designPath = path.join(docsBase, 'design/detail-design-spec.md');
  const taskListPath = path.join(docsBase, 'design/develop-task-list.md');
  if (!fs.existsSync(designPath) || !fs.existsSync(taskListPath)) {
    return { ok: false, reason: 'missing-design-artifacts' };
  }
  return { ok: true, reason: 'checked' };
}

/** R13：设计问题清单是否无未解决问题（供发起 development-engineer 前机械校验） */
export function checkDesignReviewClean() {
  const docsBase = getActiveDocsBase();
  const designProblemPath = path.join(docsBase, 'design/design-problem-list.md');
  if (!fs.existsSync(designProblemPath)) {
    return { ok: false, reason: 'missing-design-problem-list' };
  }
  const content = fs.readFileSync(designProblemPath, 'utf8');
  return { ok: !hasUnresolvedIssues(content), reason: 'checked' };
}

/** R13：质量报告是否无未解决高/中问题、且质量判定通过（供发起 test-engineer 前机械校验） */
export function checkQaClean() {
  const docsBase = getActiveDocsBase();
  const qualityDir = path.join(docsBase, 'quality');
  if (!fs.existsSync(qualityDir)) return { ok: false, reason: 'missing-quality-dir' };
  const files = fs.readdirSync(qualityDir).filter((f) => /^quality-report.*\.md$/.test(f));
  if (files.length === 0) return { ok: false, reason: 'no-quality-report' };
  for (const f of files) {
    const content = fs.readFileSync(path.join(qualityDir, f), 'utf8');
    if (hasUnresolvedIssues(content)) return { ok: false, reason: `unresolved-in-${f}` };
    if (/质量判定[:：]\s*不通过/.test(content)) return { ok: false, reason: `qa-fail-${f}` };
  }
  return { ok: true, reason: 'checked' };
}

/**
 * R13：成果物门禁链机械化——对 §5 表格中可客观判定的前置条件做机械校验，
 * 供 `gate-role-sequence.mjs` 在 Task 发起前拦截。仅覆盖客观可判定部分；
 * 调用者身份（顶层代理 vs 子 agent）与语义类判断（如 single-task 是否单文件级）
 * 不可机械化，继续由 AGENTS.md 文字约束承担（见 R8/R2 说明）。
 * 未知角色 / 无 process.md 时 fail-open 放行，避免因字段解析不确定或流程尚未
 * 启动而误锁死整个框架。
 */
export function checkRoleDispatchGate(role) {
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

  switch (role) {
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
    case 'product-manager': {
      const r = checkDesignReady();
      return r.ok
        ? { ok: true, reason: 'checked' }
        : {
            ok: false,
            reason: r.reason,
            message: '设计成果物未就绪（detail-design-spec.md/develop-task-list.md 缺失），不得发起 product-manager 设计审核。',
          };
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
      } else {
        const d = checkDesignReady();
        if (!d.ok) {
          return { ok: false, reason: d.reason, message: '设计成果物未就绪，不得发起开发工程师。' };
        }
        const clean = checkDesignReviewClean();
        if (!clean.ok) {
          return { ok: false, reason: clean.reason, message: '设计问题清单存在未解决问题，设计审核未通过，不得发起开发工程师。' };
        }
      }
      if (!hasValidDispatchPlan(content)) {
        return { ok: false, reason: 'no-dispatch-plan', message: '尚无项目经理有效分派计划，不得发起开发工程师。' };
      }
      return { ok: true, reason: 'checked' };
    }
    case 'quality-assurance-engineer': {
      const state = parseWorkflowState(content);
      if (!(state.devComplete || state.devInProgress)) {
        return { ok: false, reason: 'dev-not-started', message: '开发工程师尚未产出/尚未标记执行状态，不得发起质量保障工程师。' };
      }
      return { ok: true, reason: 'checked' };
    }
    case 'test-engineer': {
      const state = parseWorkflowState(content);
      if (!state.qaComplete) {
        return { ok: false, reason: 'qa-not-complete', message: '质量保障审核尚未全部通过，不得发起测试工程师。' };
      }
      const qaClean = checkQaClean();
      if (!qaClean.ok) {
        return { ok: false, reason: qaClean.reason, message: '质量报告存在未解决高/中严重等级问题或质量判定未通过，不得发起测试工程师。' };
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
      hasQaRecord: false,
      qaComplete: false,
      testComplete: false,
      batchTestRowComplete: false,
      finalTestRowComplete: false,
      batchE2ePassed: false,
      finalE2ePassed: false,
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
  const qa = roleProgressStats(content, '质量保障工程师');
  const te = testEngineerStats(content);

  const devInProgress = dev.inProgress > 0;
  const devComplete = dev.total > 0 && dev.complete === dev.total && dev.inProgress === 0;
  const hasQaRecord = qa.total > 0;
  const qaComplete = qa.total > 0 && qa.complete === qa.total && qa.inProgress === 0;

  const batchTestRowComplete = te.batch.total > 0 && te.batch.complete === te.batch.total && te.batch.inProgress === 0;
  const finalTestRowComplete = te.final.total > 0 && te.final.complete === te.final.total && te.final.inProgress === 0;

  const batchResult = readE2eResult('batch');
  const finalResult = readE2eResult('final');
  const batchE2ePassed = batchResult?.gatePassed === true;
  const finalE2ePassed = finalResult?.gatePassed === true;

  // R11：hotfix 折叠批次/最终为单次通道——不要求独立的批次集成测试环节，
  // 直接以「最终」判据为准（test-engineer 以 --scope=final 语义运行一次）。
  const batchTestComplete = isHotfix ? true : batchTestRowComplete && batchE2ePassed;
  const finalTestComplete = isDocsOnly ? true : finalTestRowComplete && finalE2ePassed;

  const finalTestRequired = isDocsOnly
    ? false
    : isHotfix
      ? devComplete && qaComplete
      : devComplete && qaComplete && batchTestComplete;

  return {
    blocking,
    cancelled,
    devInProgress,
    devComplete,
    hasQaRecord,
    qaComplete,
    testComplete: finalTestComplete, // 兼容旧字段名
    batchTestRowComplete,
    finalTestRowComplete,
    batchE2ePassed,
    finalE2ePassed,
    batchTestComplete,
    finalTestComplete,
    finalTestRequired,
    phase: fm.phase ?? null,
    workflowMode,
  };
}
