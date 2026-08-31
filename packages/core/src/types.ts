/**
 * Git Cockpit 核心类型定义
 */

/** 工具风险等级：只读 / 普通写操作 / 高风险 */
export type RiskLevel = 'readonly' | 'write' | 'dangerous';

/** Git 工具动作来源 */
export type OperationSource = 'mcp' | 'web' | 'cli';

/** 操作结果 */
export type OperationResult = 'success' | 'error' | 'denied';

/** 单个文件的工作区状态 */
export interface FileStatus {
  /** 相对仓库根目录的文件路径 */
  path: string;
  /** combined 短状态码，如 "M "、"??"、"R " */
  status: string;
  /** 暂存区状态码 */
  indexStatus: string;
  /** 工作区状态码 */
  workTreeStatus: string;
  /** 是否已暂存 */
  staged: boolean;
  /** 是否未跟踪 */
  untracked: boolean;
  /** 是否存在冲突 */
  conflicted: boolean;
}

/** 仓库工作区整体状态 */
export interface RepoStatus {
  /** 当前分支名；HEAD 处于游离状态时为 "HEAD (detached)" 样式的描述 */
  current: string;
  currentShort: string;
  /** 上游跟踪分支，如 origin/main */
  tracking: string | null;
  ahead: number;
  behind: number;
  /** 已暂存文件 */
  staged: FileStatus[];
  /** 未暂存文件 */
  unstaged: FileStatus[];
  /** 未跟踪文件路径 */
  untracked: string[];
  /** 冲突文件路径 */
  conflicted: string[];
  /** 全部文件（合并列表） */
  files: FileStatus[];
  isClean: boolean;
}

/** 一次提交的信息 */
export interface CommitInfo {
  hash: string;
  shortHash: string;
  parents: string[];
  message: string;
  subject: string;
  body: string | null;
  authorName: string;
  authorEmail: string;
  authorDate: string;
  committerName: string;
  committerEmail: string;
  committerDate: string;
  /** 装饰引用，如 "HEAD -> main, origin/main, tag: v1.0" */
  refs: string;
}

export interface LogOptions {
  maxCount?: number;
  from?: string;
  to?: string;
  author?: string;
  path?: string;
  all?: boolean;
}

export interface DiffFileSummary {
  path: string;
  /** 单字符状态码：A/M/D/R/C/U */
  status: string;
  additions: number;
  deletions: number;
  binary: boolean;
}

export interface DiffOptions {
  from?: string;
  to?: string;
  path?: string;
  staged?: boolean;
  maxPatchBytes?: number;
}

export interface DiffResult {
  from: string | null;
  to: string | null;
  staged: boolean;
  files: DiffFileSummary[];
  /** 原始 unified diff 文本（供 diff2html / <pre> 渲染） */
  rawPatch: string;
  truncated: boolean;
  stats: {
    filesChanged: number;
    insertions: number;
    deletions: number;
  };
}

export interface CommitDetail extends CommitInfo {
  diff: DiffResult;
}

export interface BranchInfo {
  name: string;
  /** 是否当前分支 */
  current: boolean;
  /** 指向的提交 hash */
  commit: string;
  /** 提交主题 */
  label: string;
  /** 是否为远程分支 */
  remote: boolean;
  /** 上游跟踪分支，如 origin/main（仅本地分支 & 存在上游时） */
  upstream?: string | null;
  /** 领先上游的提交数 */
  ahead?: number;
  /** 落后上游的提交数 */
  behind?: number;
}

/** 一条 stash 记录（对应 stash@{n}） */
export interface StashInfo {
  /** 序号，如 0 / 1（对应 stash@{n}） */
  index: number;
  /** 引用名，如 stash@{0} */
  ref: string;
  /** 保存说明（默认形如 "WIP on 分支名: 提交主题"） */
  message: string;
  /** 保存时间（ISO 字符串） */
  date: string | null;
}

export interface TagInfo {
  name: string;
  commit: string;
  date: string | null;
}

export interface RemoteInfo {
  name: string;
  fetchUrl: string | null;
  pushUrl: string | null;
}

export interface GraphCommit {
  hash: string;
  shortHash: string;
  parents: string[];
  subject: string;
  authorName: string;
  authorEmail: string;
  authorDate: string;
  /** 指向该提交的引用装饰 */
  refs: string;
}

export interface GraphData {
  commits: GraphCommit[];
  /** 当前 HEAD 指向的提交 */
  head: string | null;
}

/** `git` 命令允许非零退出时的捕获结果（如 merge-tree 冲突 = 1） */
export interface GitCommandResult {
  stdout: string;
  stderr: string;
  code: number;
}

/** 预演中的冲突文件（hunk 选边留给三栏；本阶段可只填 path） */
export interface ConflictFile {
  path: string;
  contentConflict: boolean;
  hunks: unknown[];
  conflictContent?: string | null;
  oursContent?: string | null;
  theirsContent?: string | null;
  baseContent?: string | null;
}

export type MergeOutcome = 'clean' | 'conflicts' | 'unrelated';

/** merge-tree 预演结果（不改工作区） */
export interface MergePreviewResult {
  repoRoot: string;
  into: string;
  from: string;
  intoSha: string;
  fromSha: string;
  /** 空字符串表示算不出共同祖先（无关历史） */
  mergeBase: string;
  clean: boolean;
  fetched: boolean;
  fetchAttempted: boolean;
  fetchError?: string;
  conflictFiles: ConflictFile[];
  messages: string[];
  outcome: MergeOutcome;
  unrelatedHistories: boolean;
  /** merge-tree --write-tree 的结果树；冲突时也有（blob 带冲突标记） */
  resultTree?: string;
}

export type MergeRehearsalResult = MergePreviewResult;

/** 批量预演格子结论；same / error 只在矩阵出现 */
export type SurveyOutcome = MergeOutcome | 'same' | 'error';

export interface MergeSurveyPair {
  into: string;
  from: string;
}

export interface TempBranchState {
  name: string;
  local: boolean;
  /** 远程已有同名 merge/*，才谈得上单独开 MR */
  remote: boolean;
}

export interface MergeSurveyCell {
  into: string;
  from: string;
  intoSha: string;
  fromSha: string;
  outcome: SurveyOutcome;
  /** 只有路径：批量不生成冲突正文 */
  conflictPaths: string[];
  resultTree?: string;
  tempBranch?: TempBranchState;
  error?: string;
}

export interface MergeSurveyResult {
  repoRoot: string;
  fetched: boolean;
  generatedAt: number;
  cells: MergeSurveyCell[];
}

export interface MergeChainStep {
  from: string;
  fromSha: string;
  outcome: SurveyOutcome;
  conflictPaths: string[];
  /** 这一步之后的游离 commit；冲突或跳过时为空 */
  commit: string;
}

export interface MergeChainResult {
  into: string;
  intoSha: string;
  order: string[];
  steps: MergeChainStep[];
  /** 从头能连续干净合入几个 */
  cleanPrefix: number;
  blockedAt: string | null;
  blockedPaths: string[];
  blockedReason?: string;
}

export interface SuggestOrderResult {
  best: MergeChainResult;
  baseline: MergeChainResult;
  tried: number;
}

export interface ApplyResolveFile {
  path: string;
  resolvedContent: string;
}

export interface ApplyResolveResult {
  repoRoot: string;
  into: string;
  from: string;
  tempBranch: string;
  intoSha: string;
  fromSha: string;
  commitSha: string;
  pushed: boolean;
  remote: string;
  createMrUrl: string | null;
  previousBranch: string | null;
  usedWorktree: boolean;
  messages: string[];
}

/** 操作日志条目（脱敏后存储） */
export interface OperationLogEntry {
  timestamp: string;
  source: OperationSource;
  tool: string;
  repoPath: string;
  params: Record<string, unknown>;
  result: OperationResult;
  error?: string | null;
  durationMs: number;
  dryRun: boolean;
}

export interface StorageConfig {
  dataDir: string;
}

export interface ServerConfig {
  host: string;
  port: number;
}

export interface GitConfig {
  maxConcurrentOperations: number;
  backupOnDangerousOps: boolean;
  allowedRepos: string[];
}

export interface PermissionsConfig {
  disabledTools: string[];
  requireApprovalFor: string[];
  dryRunDefault: boolean;
}

export interface LoggingConfig {
  level: 'debug' | 'info' | 'warn' | 'error';
  redact: string[];
}

/** 开单方式：本机 gh/glab、Token、或只打开浏览器创建页。旧配置 `auto` 读盘时迁成 `browser` */
export type MrMethod = 'cli' | 'token' | 'browser';

/** 按 hostname 存的凭证：公司 A / B 的 GitLab 各一条，互不覆盖 */
export interface MrHostProfile {
  /** 小写 hostname，如 git.a.com、github.com */
  host: string;
  platform: 'github' | 'gitlab';
  token: string;
  /** 空则按惯例推断 API 根 */
  apiBaseUrl: string;
}

/** MR / PR：开单方式按仓库路径；Token / API 按域名。不进工具参数 */
export interface MrConfig {
  /** 仅作读盘兼容 / 最近一次写入；真正开单看 repoMethods */
  method: MrMethod;
  /** MCP 未传 remote 时的兜底远程名；UI 不展示，运行时优先从 into / listRemotes 推 */
  defaultRemote: string;
  hosts: MrHostProfile[];
  /** 规范化仓库绝对路径 → 开单方式；没有记录则默认 browser */
  repoMethods: Record<string, MrMethod>;
}

/** 读盘时可能仍带旧字段（含 `method: 'auto'`），normalizeMrConfig 会迁到 hosts / browser */
export type MrConfigRaw = Omit<Partial<MrConfig>, 'method'> & {
  method?: string;
  githubToken?: string;
  gitlabToken?: string;
  apiBaseUrl?: string;
  platform?: '' | 'github' | 'gitlab';
  hosts?: MrHostProfile[];
};

export type MrPlatform = 'github' | 'gitlab' | 'unknown';

export interface MrCandidate {
  username: string;
  name?: string;
  role?: string;
}

export interface MrTokenStatus {
  ok: boolean;
  statusLabel: string;
  titleStatus: string;
  login?: string;
  expiresMessage?: string;
  error?: string;
}

export interface MrCliStatus {
  name: 'gh' | 'glab';
  found: boolean;
  loggedIn: boolean;
  error?: string;
  installUrl: string;
  /** 已登录且做过 API 校验时有值；不含 Token 明文 */
  tokenStatus?: MrTokenStatus | null;
}

export interface PrepareMrResult {
  platform: MrPlatform;
  remote: string;
  remoteUrl: string;
  sourceBranch: string;
  targetBranch: string;
  title: string;
  createMrUrl: string | null;
  cli: 'gh' | 'glab' | null;
  cliError?: string;
  cliInstallUrl?: string | null;
  candidates: MrCandidate[];
  messages: string[];
}

export interface CreateMrResult {
  via: 'token' | 'gh' | 'glab' | 'browser';
  url: string | null;
  number?: number;
  sourceBranch: string;
  targetBranch: string;
  title: string;
  messages: string[];
  cliInstallUrl?: string | null;
}

/** 全局配置（对应 config.json） */
export interface GitCockpitConfig {
  server: ServerConfig;
  storage: StorageConfig;
  git: GitConfig;
  permissions: PermissionsConfig;
  logging: LoggingConfig;
  mr: MrConfig;
}

export const DEFAULT_CONFIG: GitCockpitConfig = {
  server: { host: 'localhost', port: 3000 },
  storage: { dataDir: '~/.git-cockpit' },
  git: { maxConcurrentOperations: 1, backupOnDangerousOps: true, allowedRepos: [] },
  permissions: {
    disabledTools: [
      'git_reset_hard',
      'git_clean',
      'git_push_force',
      'git_branch_delete_force',
      'git_rebase'
    ],
    requireApprovalFor: ['git_reset_hard', 'git_clean', 'git_push_force', 'git_branch_delete_force', 'git_rebase'],
    dryRunDefault: false
  },
  logging: { level: 'info', redact: ['password', 'token', 'authorization'] },
  mr: {
    method: 'browser',
    defaultRemote: 'origin',
    hosts: [],
    repoMethods: {}
  }
};

/** Git 操作相关错误（携带用户友好信息） */
export class GitOperationError extends Error {
  constructor(
    message: string,
    public readonly code: string = 'GIT_OPERATION_ERROR',
    public readonly exitCode?: number
  ) {
    super(message);
    this.name = 'GitOperationError';
  }
}

/** 权限校验不通过错误 */
export class PermissionError extends Error {
  constructor(
    message: string,
    public readonly tool: string,
    public readonly requiredApproval: boolean = false
  ) {
    super(message);
    this.name = 'PermissionError';
  }
}

/** 仓库未打开等资源错误 */
export class RepoNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RepoNotFoundError';
  }
}