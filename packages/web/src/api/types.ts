/** 与 mcp-server REST API 对齐的前端类型定义 */

export interface FileStatus {
  path: string;
  status: string;
  indexStatus: string;
  workTreeStatus: string;
  staged: boolean;
  untracked: boolean;
  conflicted: boolean;
}

export interface RepoStatus {
  current: string;
  currentShort: string;
  tracking: string | null;
  ahead: number;
  behind: number;
  staged: FileStatus[];
  unstaged: FileStatus[];
  untracked: string[];
  conflicted: string[];
  files: FileStatus[];
  isClean: boolean;
}

export interface OpenedRepo {
  id: number;
  path: string;
  addedAt: string;
  lastOpenedAt: string;
  available?: boolean;
}

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
  refs: string;
}

export interface DiffFileSummary {
  path: string;
  status: string;
  additions: number;
  deletions: number;
  binary: boolean;
}

export interface DiffResult {
  from: string | null;
  to: string | null;
  staged: boolean;
  files: DiffFileSummary[];
  rawPatch: string;
  truncated: boolean;
  insertions: number;
  deletions: number;
}

export interface BranchInfo {
  name: string;
  current: boolean;
  commit: string;
  label: string;
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

export interface GraphData {
  commits: Array<{
    hash: string;
    shortHash: string;
    parents: string[];
    subject: string;
    authorName: string;
    authorEmail: string;
    authorDate: string;
    refs: string;
  }>;
  head: string | null;
}

export type RiskLevel = 'readonly' | 'write' | 'dangerous';

export interface ToolSummary {
  name: string;
  description: string;
  risk: RiskLevel;
  riskLevel: RiskLevel;
  enabled: boolean;
}

export interface ToolExecResult {
  tool: string;
  source: 'mcp' | 'web' | 'cli';
  dryRun: boolean;
  success: boolean;
  result?: unknown;
  preview?: unknown;
  backupCreated?: { branch: string | null; stashRef: string | null } | null;
  error?: {
    code: string;
    message: string;
    requiredApproval: boolean;
  };
  durationMs: number;
}

export interface WritePreview {
  dryRun: boolean;
  command: string;
  args: string[];
  affectedFiles?: string[];
  risk: RiskLevel;
  note?: string;
}

export interface LogEntry {
  id: number;
  timestamp: string;
  source: string;
  tool: string;
  repoPath: string | null;
  params: unknown;
  result: string;
  error: string | null;
  durationMs: number;
  dryRun: boolean;
}

export interface PermissionsPayload {
  disabledTools: string[];
  requireApprovalFor: string[];
  dryRunDefault: boolean;
}

export interface SettingsData {
  permissions: PermissionsPayload;
  tools: ToolSummary[];
}

export interface HealthInfo {
  ok: boolean;
  service: string;
  version: string;
  uptimeMs: number;
}