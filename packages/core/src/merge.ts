/**
 * 合并预演辅助：分支名、Git 版本、merge-tree 解析、冲突正文、MR 链接。
 * 均为纯函数 / 临时目录操作，不改仓库工作区；由 GitService 串行调用。
 */
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GitOperationError } from './types.ts';
import type { ConflictFile, GitCommandResult } from './types.ts';

const MAX_CHARS = 24_000;
const HUNK_END = '>>>>>>>';

/** 无共同祖先时当作 merge-base，让三方 diff 退化为两侧新增 */
export const EMPTY_TREE_SHA = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

/** `git --version` 解析结果 */
export interface GitVersion {
  major: number;
  minor: number;
  patch: number;
  raw: string;
}

/** merge-tree 标准输出解析结果 */
export interface ParsedMergeTree {
  clean: boolean;
  conflictFiles: ConflictFile[];
  messages: string[];
  resultTree?: string;
}

/** 单文件三方内容：diff3 冲突正文 + ours / theirs / base 原文 */
export interface ConflictSides {
  conflictContent: string | null;
  oursContent: string | null;
  theirsContent: string | null;
  baseContent: string | null;
}

/** 从 `git --version` 文本解析主/次/补丁号 */
export function parseGitVersion(stdout: string): GitVersion {
  const raw = stdout.trim();
  const match = raw.match(/(\d+)\.(\d+)\.(\d+)/);
  if (!match) {
    throw new GitOperationError(`无法解析 git 版本：${raw}`, 'GIT_VERSION_PARSE');
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    raw
  };
}

/** merge-tree --write-tree 需要 Git >= 2.38；过低直接失败，不回落到真实 merge */
export function assertMergeTreeVersion(version: GitVersion): void {
  const ok = version.major > 2 || (version.major === 2 && version.minor >= 38);
  if (!ok) {
    throw new GitOperationError(
      `合并预演需要 Git >= 2.38（当前 ${version.raw}）。请升级 Git 后重试。`,
      'GIT_TOO_OLD'
    );
  }
}

/**
 * API / 展示用的分支短名（去掉 refs 与 remote 前缀，如 origin/feature → feature）。
 * 不改写磁盘上的 git ref；仅用于 MR URL、临时分支 slug 等。
 */
export function branchNameForMr(ref: string, remotes: string[] = ['origin']): string {
  let s = ref
    .trim()
    .replace(/^refs\/heads\//, '')
    .replace(/^refs\/remotes\/[^/]+\//, '');
  const byLongest = [...remotes]
    .map((r) => r.trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  for (const remote of byLongest) {
    const prefix = `${remote}/`;
    if (s.startsWith(prefix)) {
      s = s.slice(prefix.length);
      break;
    }
  }
  return s;
}

/**
 * 规范化后源/目标同名（如 master 与 origin/master）。
 * 此类同步请用户自行 push/pull，不建临时分支。
 */
export function isSameBranchForMr(into: string, from: string, remotes: string[] = ['origin']): boolean {
  const a = branchNameForMr(into, remotes);
  const b = branchNameForMr(from, remotes);
  return !!a && !!b && a === b;
}

/** 把分支名收成可进路径的 slug（非法字符 → `-`） */
function slugRef(ref: string, remotes: string[] = ['origin']): string {
  return branchNameForMr(ref, remotes)
    .replace(/[^a-zA-Z0-9._/-]+/g, '-')
    .replace(/\/+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** 落盘用临时分支名：`merge/<from>-into-<into>` */
export function defaultTempBranchName(into: string, from: string, remotes: string[] = ['origin']): string {
  return `merge/${slugRef(from, remotes)}-into-${slugRef(into, remotes)}`;
}

/**
 * 把 git remote URL 转成浏览器「新建 MR/PR」页。无法识别时返回 null。
 * GitHub 走 compare；其余按 GitLab `-/merge_requests/new` 拼。
 */
export function buildCreateMrUrl(
  remoteUrl: string,
  sourceBranch: string,
  targetBranch: string
): string | null {
  let url = remoteUrl.trim();
  if (!url) return null;
  if (url.startsWith('git@')) {
    const m = url.match(/^git@([^:]+):(.+?)(?:\.git)?$/);
    if (!m) return null;
    url = `https://${m[1]}/${m[2]}`;
  } else if (url.startsWith('ssh://git@')) {
    url = url.replace(/^ssh:\/\/git@/, 'https://').replace(/\.git$/, '');
  } else {
    url = url.replace(/\.git$/, '');
  }

  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    const repoPath = u.pathname.replace(/^\/+|\/+$/g, '');
    const src = encodeURIComponent(sourceBranch);
    const tgt = encodeURIComponent(targetBranch);
    if (host === 'github.com' || host.endsWith('.github.com')) {
      return `${u.origin}/${repoPath}/compare/${encodeURIComponent(targetBranch)}...${encodeURIComponent(sourceBranch)}?expand=1`;
    }
    return `${u.origin}/${repoPath}/-/merge_requests/new?merge_request%5Bsource_branch%5D=${src}&merge_request%5Btarget_branch%5D=${tgt}`;
  } catch {
    return null;
  }
}

/** 是否为 git tree / commit 的 hex oid（SHA-1 或 SHA-256） */
function isTreeOid(text: string): boolean {
  return /^[0-9a-f]{40}$|^[0-9a-f]{64}$/.test(text);
}

/** 从 merge-tree 文本里抽出冲突路径（CONFLICT 行、changed in both、added in both） */
export function collectConflictPaths(text: string): Set<string> {
  const conflictPaths = new Set<string>();
  const patterns = [
    /Merge conflict in (.+)$/gm,
    /CONFLICT \(add\/add\): Merge conflict in (.+)$/gm,
    /CONFLICT \(modify\/delete\): (.+) deleted in/gm,
    /CONFLICT \(rename\/delete\): (.+) deleted in/gm,
    /CONFLICT \(file location\): .+ added in .+ inside a directory .+ containing a file .+ competing with (.+)$/gm
  ];
  for (const re of patterns) {
    let match: RegExpExecArray | null;
    while ((match = re.exec(text)) !== null) {
      if (match[1]) conflictPaths.add(match[1].trim());
    }
  }

  const blockRe = /changed in both\n\s+base\s+\d+\s+\w+\s+(.+)\n/g;
  let blockMatch: RegExpExecArray | null;
  while ((blockMatch = blockRe.exec(text)) !== null) {
    if (blockMatch[1]) conflictPaths.add(blockMatch[1].trim());
  }

  const addedBoth = /added in both\n\s+our\s+\d+\s+\w+\s+(.+)\n/g;
  while ((blockMatch = addedBoth.exec(text)) !== null) {
    if (blockMatch[1]) conflictPaths.add(blockMatch[1].trim());
  }

  return conflictPaths;
}

/** 冲突路径 → ConflictFile 列表（预演阶段 hunks 为空，正文由 buildConflictContent 补） */
function toConflictFiles(paths: Set<string>): ConflictFile[] {
  return [...paths].sort().map((p) => ({
    path: p,
    contentConflict: true,
    hunks: []
  }));
}

/**
 * 解析 Git >= 2.38 的 `merge-tree --write-tree -z --messages --name-only`。
 * stdout 以 NUL 分段：首段常为结果 tree oid，其后为消息 / 冲突路径。
 */
export function parseModernMergeTree(stdout: string, stderr: string, code: number): ParsedMergeTree {
  const combined = `${stdout}\n${stderr}`;
  const fromMessages = collectConflictPaths(combined);

  const zParts = stdout
    .split('\0')
    .map((p) => p.trim())
    .filter(Boolean);
  const head = zParts[0];
  const resultTree = head && isTreeOid(head) ? head : undefined;
  for (let i = 1; i < zParts.length; i++) {
    const part = zParts[i];
    if (!part) continue;
    if (!part.includes('\n') && !part.startsWith('CONFLICT') && part !== zParts[0]) {
      if (!part.includes(' ') && (part.includes('/') || /\.\w+$/.test(part))) {
        fromMessages.add(part);
      }
    }
  }

  if (fromMessages.size > 0 || combined.includes('CONFLICT')) {
    return {
      clean: false,
      conflictFiles: toConflictFiles(fromMessages),
      messages: zParts.length > 0 ? zParts : combined.split('\n').filter(Boolean),
      resultTree
    };
  }

  if (code === 0) {
    return {
      clean: true,
      conflictFiles: [],
      messages: zParts,
      resultTree
    };
  }

  return {
    clean: false,
    conflictFiles: [],
    messages: combined.split('\n').filter((l) => l.trim()),
    resultTree
  };
}

/**
 * 回落解析旧式 `merge-tree <base> <ours> <theirs>` 文本输出。
 * 现代 merge-tree 未给出冲突列表时（例如无关历史）才用。
 */
export function parseClassicMergeTree(stdout: string): ParsedMergeTree {
  const classicPaths = collectConflictPaths(stdout);
  return {
    clean: classicPaths.size === 0 && !stdout.includes('<<<<<<<'),
    conflictFiles: toConflictFiles(classicPaths),
    messages: stdout.split('\n').filter((l) => l.trim())
  };
}

/** 冲突正文过长时在完整 hunk 边界截断，避免截在标记中间 */
function truncate(text: string): string {
  if (text.length <= MAX_CHARS) return text;
  const searchRegion = text.slice(0, MAX_CHARS);
  const lastHunkEnd = searchRegion.lastIndexOf(HUNK_END);
  if (lastHunkEnd === -1) {
    return `${searchRegion}\n\n…（内容过长已截断，此处可能位于冲突块中间）\n`;
  }
  const lineEnd = text.indexOf('\n', lastHunkEnd);
  if (lineEnd === -1 || lineEnd >= MAX_CHARS) {
    return `${text.slice(0, lastHunkEnd + HUNK_END.length)}\n\n…（内容过长已截断）\n`;
  }
  return `${text.slice(0, lineEnd)}\n\n…（内容过长已截断）\n`;
}

/**
 * 用 `git merge-file --diff3` 生成冲突标记文本，不改仓库工作区。
 * showFile / mergeFile 由 GitService 注入，保证走同一串行队列。
 */
export async function buildConflictContent(
  showFile: (rev: string, path: string) => Promise<string | null>,
  mergeFile: (
    oursPath: string,
    basePath: string,
    theirsPath: string,
    labels: { ours: string; theirs: string }
  ) => Promise<GitCommandResult>,
  baseSha: string,
  intoSha: string,
  fromSha: string,
  filePath: string
): Promise<ConflictSides> {
  const [oursContent, theirsContent, baseContent] = await Promise.all([
    showFile(intoSha, filePath),
    showFile(fromSha, filePath),
    showFile(baseSha, filePath)
  ]);

  if (oursContent === null && theirsContent === null) {
    return { conflictContent: null, oursContent, theirsContent, baseContent };
  }

  if (oursContent === null || theirsContent === null) {
    const parts = [
      `<<<<<<< ours (${intoSha.slice(0, 7)})`,
      oursContent ?? '（线上侧无此文件 / 已删除）',
      '||||||| base',
      baseContent ?? '（base 无此文件）',
      '=======',
      theirsContent ?? '（我的分支侧无此文件 / 已删除）',
      `>>>>>>> theirs (${fromSha.slice(0, 7)})`,
      ''
    ];
    return {
      conflictContent: truncate(parts.join('\n')),
      oursContent,
      theirsContent,
      baseContent
    };
  }

  const dir = await mkdtemp(join(tmpdir(), 'git-cockpit-merge-'));
  try {
    const oursPath = join(dir, 'ours');
    const basePath = join(dir, 'base');
    const theirsPath = join(dir, 'theirs');
    await writeFile(oursPath, oursContent, 'utf8');
    await writeFile(basePath, baseContent ?? '', 'utf8');
    await writeFile(theirsPath, theirsContent, 'utf8');
    const merged = await mergeFile(oursPath, basePath, theirsPath, {
      ours: `ours:${filePath}`,
      theirs: `theirs:${filePath}`
    });
    const text = merged.stdout || null;
    return {
      conflictContent: text ? truncate(text) : null,
      oursContent,
      theirsContent,
      baseContent
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
