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