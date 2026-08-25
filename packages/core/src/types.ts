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
  remote: boolean;
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

/** 全局配置（对应 config.json） */
export interface GitCockpitConfig {
  server: ServerConfig;
  storage: StorageConfig;
  git: GitConfig;
  permissions: PermissionsConfig;
  logging: LoggingConfig;
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
  logging: { level: 'info', redact: ['password', 'token', 'authorization'] }
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