import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import * as fs from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { simpleGit, type SimpleGit } from 'simple-git';
import { bucketActivityDays, emptyActivity } from './activity.ts';
import { GitOperationError } from './types.ts';
import type {
  DiffResult,
  FileStatus,
  DiffFileSummary,
  BranchInfo,
  TagInfo,
  RemoteInfo,
  RepoStatus,
  RepoOverview,
  CommitInfo,
  StashInfo,
  WorktreeInfo,
  LogOptions,
  DiffOptions,
  GraphData,
  BranchGraph,
  BranchLineage,
  BranchTip,
  GraphCommitNode,
  WorkspaceOperation,
  ReflogEntry,
  GitCommandResult,
  MergePreviewResult,
  MergeRehearsalResult,
  MergeSurveyPair,
  MergeSurveyResult,
  SuggestOrderResult,
  ApplyResolveFile,
  ApplyResolveResult,
  ConflictFile,
  PrepareMrResult,
  TempBranchState
} from './types.ts';
import {
  assertMergeTreeVersion,
  branchNameForMr,
  buildConflictContent,
  buildCreateMrUrl,
  classifyMergePair,
  defaultTempBranchName,
  legacyTempBranchName,
  EMPTY_TREE_SHA,
  evaluateMrMergeGate,
  buildMergePageUrl,
  isMergeTempRef,
  isSameBranchForMr,
  parseLandedMergeMessage,
  parseClassicMergeTree,
  parseGitVersion,
  parseModernMergeTree,
  pickRemoteName,
  type GitVersion
} from './merge.ts';
import { parseBlamePorcelain, parseNewSideRanges, type ConflictBlameResult } from './blame.ts';
import { detectMrPlatform } from './mr.ts';
import { crossPairs, MAX_SURVEY_PAIRS, parseTempBranches, runSurvey } from './survey.ts';
import { suggestOrder, type ChainRunner } from './chain.ts';

function sameFsPath(a: string, b: string): boolean {
  const left = path.resolve(a);
  const right = path.resolve(b);
  return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;
}

function isFsPathInside(parent: string, child: string): boolean {
  const root = path.resolve(parent);
  const target = path.resolve(child);
  if (sameFsPath(root, target)) return true;
  const prefix = root.endsWith(path.sep) ? root : root + path.sep;
  if (process.platform === 'win32') {
    return target.toLowerCase().startsWith(prefix.toLowerCase());
  }
  return target.startsWith(prefix);
}

export function parseWorktreePorcelain(text: string, mainPath: string): WorktreeInfo[] {
  const blocks = text
    .replace(/\r\n/g, '\n')
    .split('\n\n')
    .map((b) => b.trim())
    .filter(Boolean);
  return blocks.map((block) => {
    let wtPath = '';
    let head = '';
    let branch: string | null = null;
    let detached = false;
    let locked = false;
    let prunable = false;
    for (const line of block.split('\n')) {
      if (line.startsWith('worktree ')) wtPath = line.slice('worktree '.length);
      else if (line.startsWith('HEAD ')) head = line.slice('HEAD '.length);
      else if (line.startsWith('branch ')) {
        const ref = line.slice('branch '.length).trim();
        branch = ref.replace(/^refs\/heads\//, '');
      } else if (line === 'detached') detached = true;
      else if (line.startsWith('locked')) locked = true;
      else if (line.startsWith('prunable')) prunable = true;
    }
    return {
      path: wtPath,
      head,
      branch: detached ? null : branch,
      detached,
      locked,
      prunable,
      isMain: sameFsPath(wtPath, mainPath)
    };
  });
}

export interface GitServiceOptions {
  maxConcurrentProcesses?: number;
  /** 命令阻塞超时（毫秒） */
  blockTimeoutMs?: number;
}

export interface WritePreview {
  dryRun: boolean;
  command: string;
  args: string[];
  affectedFiles?: string[];
  risk: 'low' | 'medium' | 'high';
  backupCreated?: boolean;
  note?: string;
}

/**
 * 非交互 git 环境变量（供直接 spawn 的场景使用）。
 *
 * daemon 是无人值守进程：只要某条命令触发凭据提示（私有远程的 fetch / push / pull 等），
 * git 就会阻塞在 stdin 上等待输入，而 `simple-git` 的 `raw()` 没有超时，
 * 整个仓库队列会被这一条命令永久卡住。
 *
 * 这里统一禁用终端提示；凭据 helper 与 askpass 机制仍然生效（`GIT_TERMINAL_PROMPT`
 * 只关掉"在终端上问用户"，不影响 credential.helper）。
 */
export function nonInteractiveGitEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return { ...base, GIT_TERMINAL_PROMPT: '0' };
}

/**
 * 把 `GIT_TERMINAL_PROMPT=0` 写进**进程环境**（幂等）。
 *
 * 为什么不直接用 simple-git 的 `git.env()` 传这个变量——它有两个坑：
 * 1. 是**整体替换**而非追加，`env('X','0')` 会让子进程丢掉 PATH（表现为 `spawn git ENOENT`）；
 * 2. 会校验并拒绝一批"不安全"变量（GIT_PAGER / GIT_EDITOR / GIT_SSH 等），
 *    而 `{...process.env}` 里往往正好带着它们（例如本机 `GIT_PAGER=cat`），直接抛
 *    `Use of "GIT_PAGER" is not permitted without enabling allowUnsafePager`。
 *
 * 改为进程级设置后，simple-git 的默认继承与 `spawnGit` 都能拿到，且不触发上述校验。
 */
let nonInteractiveEnvApplied = false;
export function ensureNonInteractiveGitEnv(): void {
  if (nonInteractiveEnvApplied) return;
  nonInteractiveEnvApplied = true;
  process.env.GIT_TERMINAL_PROMPT = '0';
}

/**
 * Git 操作服务：基于 simple-git 封装。
 *
 * - 所有操作通过内部串行队列串行执行，避免并发导致索引损坏；
 * - 写操作前检查 .git/index.lock；
 * - 参数一律以数组传递给 simple-git（spawn 无 shell），杜绝命令注入；
 * - 高危操作调用方需先创建备份（createBackup）。
 */
export class GitService extends EventEmitter {
  readonly repoPath: string;
  readonly gitDir: string;
  private git: SimpleGit;
  private queue: Promise<unknown> = Promise.resolve();
  private gitVersion: GitVersion | null = null;

  constructor(repoPath: string, gitDir: string, options: GitServiceOptions = {}) {
    super();
    this.repoPath = repoPath;
    this.gitDir = gitDir;
    ensureNonInteractiveGitEnv();
    this.git = simpleGit({
      baseDir: repoPath,
      binary: 'git',
      maxConcurrentProcesses: options.maxConcurrentProcesses ?? 1,
      timeout: { block: options.blockTimeoutMs ?? 60_000 }
    });
  }

  /**
   * 打开一个 Git 仓库。会校验路径合法且确实是 Git 仓库（返回标准化的真实仓库根目录）。
   */
  static async open(repoPath: string, options: GitServiceOptions = {}): Promise<GitService> {
    ensureNonInteractiveGitEnv();
    const resolved = path.resolve(repoPath);
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
      throw new GitOperationError(`目录不存在: ${resolved}`, 'REPO_NOT_FOUND');
    }
    const probe = simpleGit({ baseDir: resolved, binary: 'git' });
    let topLevel = '';
    try {
      topLevel = (await probe.raw(['rev-parse', '--show-toplevel'])).trim();
    } catch {
      throw new GitOperationError(`不是有效的 Git 仓库: ${resolved}`, 'NOT_A_GIT_REPO');
    }
    if (!topLevel) {
      throw new GitOperationError(`不是有效的 Git 仓库: ${resolved}`, 'NOT_A_GIT_REPO');
    }
    const gitDir = (await probe.raw(['rev-parse', '--git-dir'])).trim();
    const service = new GitService(path.resolve(topLevel), path.resolve(topLevel, gitDir), options);
    await service.assertNoLock();
    return service;
  }

  /** 串行队列：保证所有 git 命令按序执行 */
  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  /** 执行原始 git 命令（参数数组传递，无 shell） */
  private run(args: string[]): Promise<string> {
    return this.enqueue(() => this.git.raw(args));
  }

  /**
   * 允许非零退出码的 git 调用。merge-tree 冲突时退出码为 1，stdout 仍是有效预演结果，
   * 不得当作 GIT_WRITE_FAILED。走 spawn 而非 simple-git.raw，以便同时拿到 stdout / stderr / code。
   */
  async runAllowFail(args: string[], env?: NodeJS.ProcessEnv): Promise<GitCommandResult> {
    return this.enqueue(() => spawnGit(this.repoPath, args, env));
  }

  /** 检查 index.lock，存在则说明有并发写操作 */
  async assertNoLock(): Promise<void> {
    const lockPath = path.join(this.gitDir, 'index.lock');
    if (fs.existsSync(lockPath)) {
      throw new GitOperationError(
        `Git 索引被锁定（${path.join('.git', 'index.lock')} 存在），可能有其他操作正在进行。请稍后重试或手动删除该文件。`,
        'INDEX_LOCKED'
      );
    }
  }

  /** 校验相对仓库的路径合法，防止越出仓库边界 */
  validateRepoRelativePath(p: string): string {
    if (path.isAbsolute(p)) {
      throw new GitOperationError(`路径必须为相对仓库根目录的路径: ${p}`, 'INVALID_PATH');
    }
    const normalized = path.normalize(p);
    if (normalized.startsWith('..') || normalized.includes('..' + path.sep) || normalized === '..') {
      throw new GitOperationError(`路径越出仓库范围: ${p}`, 'INVALID_PATH');
    }
    if (normalized === '') throw new GitOperationError('路径不能为空', 'INVALID_PATH');
    return normalized;
  }

  /** 校验分支/标签名称，拒绝 shell 特殊字符 */
  validateRefName(name: string): string {
    if (!name) throw new GitOperationError('名称不能为空', 'INVALID_REF');
    // eslint-disable-next-line no-control-regex
    if (/[\x00-\x1f\x7f~^:?*[\\ ]|@\{|^\.|\.\.|\.lock$|(^|\/)\.|\.(\.)?\/|^(?:-|--)/.test(name)) {
      throw new GitOperationError(`名称包含非法字符: ${name}`, 'INVALID_REF');
    }
    if (/[;&|`$]/.test(name)) {
      throw new GitOperationError(`名称包含受限字符: ${name}`, 'INVALID_REF');
    }
    return name;
  }

  // ---------------------------------------------------------------------------
  // 只读操作
  // ---------------------------------------------------------------------------

  /** 获取工作区状态 */
  async getStatus(): Promise<RepoStatus> {
    const s = await this.enqueue(async () => this.git.status());

    const files: FileStatus[] = s.files.map((f) => {
      const index = f.index?.trim() ?? '';
      const workTree = f.working_dir?.trim() ?? '';
      const untracked = index === '?' || workTree === '?' || f.path === '?';
      const conflicted = /[U]/.test(index + workTree) || s.conflicted.includes(f.path);
      return {
        path: f.path,
        status: `${index}${workTree}`.trim(),
        indexStatus: index,
        workTreeStatus: workTree,
        staged: index !== '' && index !== '?',
        untracked,
        conflicted
      };
    });

    return {
      current: s.current ?? '',
      currentShort: s.current?.replace(/^refs\/heads\//, '') ?? '',
      tracking: s.tracking || null,
      ahead: s.ahead ?? 0,
      behind: s.behind ?? 0,
      staged: files.filter((f) => f.staged),
      unstaged: files.filter((f) => !f.staged && !f.untracked && !f.conflicted),
      untracked: files.filter((f) => f.untracked).map((f) => f.path),
      conflicted: s.conflicted ?? [],
      files,
      isClean: s.isClean() ?? files.length === 0,
      operation: await this.detectWorkspaceOperation()
    };
  }

  /** 工作台脉搏：计数即可，不读 diff */
  async getOverview(): Promise<RepoOverview> {
    const s = await this.getStatus();
    const refs = await this.runAllowFail(['for-each-ref', '--format=%(refname:short)', 'refs/heads/merge/']);
    const tempMergeBranchCount = refs.stdout
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.startsWith('merge/')).length;
    const heat = await this.collectActivity();
    return {
      path: this.repoPath,
      name: path.basename(this.repoPath.replace(/[\\/]+$/, '')) || this.repoPath,
      available: true,
      current: s.currentShort || s.current,
      tracking: s.tracking,
      ahead: s.ahead,
      behind: s.behind,
      dirtyCount: s.staged.length + s.unstaged.length + s.untracked.length,
      conflictCount: s.conflicted.length,
      operation: s.operation,
      tempMergeBranchCount,
      ...heat
    };
  }

  /** 近 12 周 `--all` 提交日计数，不读 diff */
  private async collectActivity(): Promise<{
    activityStart: string;
    activity: number[];
    activityTotal: number;
  }> {
    const since = emptyActivity().activityStart;
    const log = await this.runAllowFail(['log', '--all', '--pretty=format:%cd', '--date=short', `--since=${since}`]);
    if (log.code !== 0 || !log.stdout.trim()) return emptyActivity();
    return bucketActivityDays(log.stdout.split('\n'));
  }

  /** MERGE_HEAD / REBASE_HEAD / CHERRY_PICK_HEAD */
  async detectWorkspaceOperation(): Promise<WorkspaceOperation> {
    const merge = await this.runAllowFail(['rev-parse', '-q', '--verify', 'MERGE_HEAD']);
    if (merge.code === 0 && merge.stdout.trim()) return 'merge';
    const rebase = await this.runAllowFail(['rev-parse', '-q', '--verify', 'REBASE_HEAD']);
    if (rebase.code === 0 && rebase.stdout.trim()) return 'rebase';
    const pick = await this.runAllowFail(['rev-parse', '-q', '--verify', 'CHERRY_PICK_HEAD']);
    if (pick.code === 0 && pick.stdout.trim()) return 'cherry-pick';
    try {
      if (
        fs.existsSync(path.join(this.gitDir, 'rebase-merge')) ||
        fs.existsSync(path.join(this.gitDir, 'rebase-apply'))
      ) {
        return 'rebase';
      }
    } catch {
      /* ignore */
    }
    return 'none';
  }

  /** 提交历史 */
  async getLog(options: LogOptions = {}): Promise<CommitInfo[]> {
    const args = this.buildLogArgs(['log', '--no-color', '--date=iso-strict'], options);
    const output = await this.safeLogOutput(args);
    return this.parseLogOutput(output);
  }

  private buildLogArgs(base: string[], options: LogOptions): string[] {
    const args = [...base];
    args.push(`--pretty=format:${GIT_LOG_FORMAT}`);
    if (options.maxCount && options.maxCount > 0) args.push('-n', String(Math.min(options.maxCount, 10000)));
    if (options.author) args.push(`--author=${options.author}`);
    if (options.all) args.push('--all');
    let range: string | null = null;
    if (options.from && options.to) range = `${options.from}..${options.to}`;
    else if (options.from) range = options.from;
    args.push(range ?? 'HEAD');
    if (options.path) {
      args.push('--');
      args.push(options.path);
    }
    return args;
  }

  private async safeLogOutput(args: string[]): Promise<string> {
    try {
      return await this.run(args);
    } catch (err) {
      const msg = String((err as Error).message ?? '');
      // 空仓库 / 无效范围时 git log 返回非零
      if (/does not have any commits yet|bad revision|unknown revision|ambiguous argument/.test(msg)) {
        return '';
      }
      throw new GitOperationError(this.extractGitMessage(msg), 'GIT_LOG_FAILED');
    }
  }

  /** 解析 git log --pretty 输出（记录分隔符 \x1e，字段分隔符 \x1f） */
  parseLogOutput(output: string): CommitInfo[] {
    const commits: CommitInfo[] = [];
    for (const record of output.split(GIT_RECORD_SEP)) {
      if (!record.trim()) continue;
      const fields = record.split(GIT_FIELD_SEP);
      const [
        hash,
        parents,
        authorName,
        authorEmail,
        authorDate,
        committerName,
        committerEmail,
        committerDate,
        refs,
        subject
      ] = fields;
      if (!hash) continue;
      const body = fields.slice(10).join(GIT_FIELD_SEP) || null;
      commits.push({
        hash,
        shortHash: hash.slice(0, 7),
        parents: parents ? parents.split(' ') : [],
        message: subject + (body ? '\n\n' + body : ''),
        subject: subject ?? '',
        body,
        authorName: authorName ?? '',
        authorEmail: authorEmail ?? '',
        authorDate: authorDate ?? '',
        committerName: committerName ?? '',
        committerEmail: committerEmail ?? '',
        committerDate: committerDate ?? '',
        refs: refs ?? ''
      });
    }
    return commits;
  }

  /** 展示提交详细信息（元信息 + diff） */
  async getShow(
    commit: string,
    options: Pick<DiffOptions, 'path' | 'maxPatchBytes'> = {}
  ): Promise<{
    commit: CommitInfo;
    diff: DiffResult;
  }> {
    const meta = await this.getLog({ from: commit, maxCount: 1 });
    if (meta.length === 0) {
      throw new GitOperationError(`提交不存在: ${commit}`, 'COMMIT_NOT_FOUND');
    }
    const diff = await this.getDiff({
      from: `${commit}^`,
      to: commit,
      path: options.path,
      maxPatchBytes: options.maxPatchBytes
    });
    return { commit: meta[0]!, diff };
  }

  /** 获取 diff（支持 path / staged / 范围） */
  async getDiff(options: DiffOptions = {}): Promise<DiffResult> {
    const paths = options.path ? [options.path] : undefined;
    const numstatCmd = ['diff', '--numstat', '--no-color'];
    const nameStatusCmd = ['diff', '--name-status', '--no-color'];
    const patchCmd = ['diff', '--no-color', '--no-ext-diff', '-M'];
    const rangeBase = options.from && options.to ? `${options.from}..${options.to}` : null;

    if (options.staged) {
      numstatCmd.push('--cached');
      nameStatusCmd.push('--cached');
      patchCmd.push('--cached');
    }
    if (rangeBase) {
      numstatCmd.push(rangeBase);
      nameStatusCmd.push(rangeBase);
      patchCmd.push(rangeBase);
    }

    const [numstatRaw, nameStatusRaw, patchRaw] = await Promise.all([
      this.runSafeDiff([...numstatCmd, ...(paths ? ['--', ...paths] : [])]),
      this.runSafeDiff([...nameStatusCmd, ...(paths ? ['--', ...paths] : [])]),
      this.runSafeDiff([...patchCmd, ...(paths ? ['--', ...paths] : [])])
    ]);

    const numstat = new Map<string, { a: number; d: number; binary: boolean }>();
    for (const line of numstatRaw.split('\n')) {
      if (!line.trim()) continue;
      const parts = line.split('\t');
      // 重命名时可能存在 3 段（含 -> 的原名）
      const filePart = parts[parts.length - 1];
      if (!filePart) continue;
      numstat.set(filePart, {
        a: parts[0] === '-' ? 0 : Number(parts[0]) || 0,
        d: parts[1] === '-' ? 0 : Number(parts[1]) || 0,
        binary: parts[0] === '-' && parts[1] === '-'
      });
    }

    const files: DiffFileSummary[] = [];
    for (const line of nameStatusRaw.split('\n')) {
      if (!line.trim()) continue;
      const parts = line.split('\t');
      const code = parts[0] ?? '';
      const file = parts[parts.length - 1];
      if (!file) continue;
      const stat = numstat.get(file);
      files.push({
        path: file,
        status: code ? (code[0] ?? 'M') : 'M',
        additions: stat?.a ?? 0,
        deletions: stat?.d ?? 0,
        binary: stat?.binary ?? false
      });
    }

    const maxBytes = options.maxPatchBytes ?? 2 * 1024 * 1024; // 默认 2MB
    let rawPatch = patchRaw;
    let truncated = false;
    if (Buffer.byteLength(rawPatch, 'utf8') > maxBytes) {
      rawPatch = rawPatch.slice(0, maxBytes) + '\n... [diff 过大已截断]';
      truncated = true;
    }

    const insertions = files.reduce((s, f) => s + f.additions, 0);
    const deletions = files.reduce((s, f) => s + f.deletions, 0);

    return {
      from: options.from ?? null,
      to: options.to ?? null,
      staged: options.staged ?? false,
      files,
      rawPatch,
      truncated,
      stats: { filesChanged: files.length, insertions, deletions }
    };
  }

  private async runSafeDiff(args: string[]): Promise<string> {
    try {
      return await this.run(args);
    } catch (err) {
      const msg = String((err as Error).message ?? '');
      if (/unknown revision|bad revision|ambiguous argument|fatal: bad object/.test(msg)) {
        return '';
      }
      throw new GitOperationError(this.extractGitMessage(msg), 'GIT_DIFF_FAILED');
    }
  }

  /**
   * 列出本地 + 远程分支。
   * 本地分支额外返回 上游(upstream) 与 ahead/behind 同步信息，供分支树直接展示 ↑↓。
   */
  async listBranches(): Promise<{
    branches: BranchInfo[];
    current: string | null;
  }> {
    const [headsOut, remotesOut, currentRef] = await Promise.all([
      this.run([
        'for-each-ref',
        '--format=%(refname:short)%00%(objectname:short)%00%(upstream:short)%00%(upstream:track)',
        'refs/heads'
      ]),
      this.run(['for-each-ref', '--format=%(refname:short)%00%(objectname:short)', 'refs/remotes']).catch(() => ''),
      this.run(['symbolic-ref', '--short', 'HEAD']).catch(() => '')
    ]);
    const current = currentRef.trim() || null;
    const branches: BranchInfo[] = [];

    for (const line of headsOut.split('\n')) {
      if (!line.trim()) continue;
      const [name, commit, upstream, track] = line.split('\0');
      if (!name) continue;
      const sync = parseUpstreamTrack(track ?? '');
      branches.push({
        name,
        current: name === current,
        commit: commit ?? '',
        label: '',
        remote: false,
        upstream: upstream || null,
        ahead: sync.ahead,
        behind: sync.behind
      });
    }

    for (const line of remotesOut.split('\n')) {
      if (!line.trim()) continue;
      const [name, commit] = line.split('\0');
      if (!name) continue;
      branches.push({ name, current: false, commit: commit ?? '', label: '', remote: true });
    }

    branches.sort((x, y) => x.name.localeCompare(y.name));
    return { branches, current };
  }

  /** 列出标签 */
  async listTags(): Promise<TagInfo[]> {
    try {
      const out = await this.run([
        'for-each-ref',
        '--sort=-creatordate',
        '--format=%(refname:short)%00%(objectname:short)%00%(creatordate:iso-strict)',
        'refs/tags'
      ]);
      const tags: TagInfo[] = [];
      for (const line of out.split('\n')) {
        if (!line.trim()) continue;
        const [name, commit, date] = line.split('\0');
        if (!name) continue;
        tags.push({ name, commit: commit ?? '', date: date || null });
      }
      return tags;
    } catch {
      return [];
    }
  }

  /** 列出远程仓库 */
  async listRemotes(): Promise<RemoteInfo[]> {
    const remotes = await this.git.getRemotes(true);
    return remotes.map((r) => ({
      name: r.name,
      fetchUrl: r.refs?.fetch ?? null,
      pushUrl: r.refs?.push ?? null
    }));
  }

  /** 读取指定提交中某个文件的内容 */
  async getFileContent(commit: string, filePath: string): Promise<{ content: string; truncated: boolean }> {
    const safe = this.validateRepoRelativePath(filePath);
    const args = ['show', `${commit}:${safe.replace(/\\/g, '/')}`];
    try {
      const content = await this.run(args);
      const maxBytes = 2 * 1024 * 1024;
      const truncated = Buffer.byteLength(content, 'utf8') > maxBytes;
      return { content: truncated ? content.slice(0, maxBytes) + '\n... [文件过大已截断]' : content, truncated };
    } catch (err) {
      const msg = String((err as Error).message ?? '');
      throw new GitOperationError(this.extractGitMessage(msg), 'FILE_NOT_FOUND');
    }
  }

  /** 提交列表（MCP `git_graph` / 历史旁路）。状态页分支图请用 `getBranchGraph`。 */
  async getGraph(maxCount = 500): Promise<GraphData> {
    const args = [
      'log',
      '--no-color',
      '--date=iso-strict',
      '--all',
      '-n',
      String(Math.max(1, maxCount)),
      `--pretty=format:${GIT_LOG_FORMAT}`
    ];
    const output = await this.safeLogOutput(args);
    const commits = this.parseLogOutput(output).map((c) => ({
      hash: c.hash,
      shortHash: c.shortHash,
      parents: c.parents,
      subject: c.subject,
      authorName: c.authorName,
      authorEmail: c.authorEmail,
      authorDate: c.authorDate,
      refs: c.refs
    }));

    let head: string | null = null;
    try {
      const rev = (await this.run(['rev-parse', 'HEAD'])).trim();
      if (rev) head = rev;
    } catch {
      head = null;
    }

    return { commits, head };
  }

  /**
   * 分支 tip DAG（对齐 Git Insight）：for-each-ref 取 tip，rev-list --parents 从 tip 往回走。
   * 前端只画 tip 节点，中间 commit 用来算最近祖先边。simple-git 没有这套高层 API，走 raw。
   */
  async getBranchGraph(options: { maxNodes?: number; into?: string; from?: string } = {}): Promise<BranchGraph> {
    const cap = Math.max(1, Math.min(2000, options.maxNodes ?? 200));
    const tipsOut = await this.run([
      'for-each-ref',
      '--format=%(refname)%00%(refname:short)%00%(objectname)%00%(upstream:short)',
      'refs/heads',
      'refs/remotes'
    ]);
    const tips: BranchTip[] = [];
    for (const line of tipsOut.split('\n')) {
      if (!line.trim()) continue;
      const [refname, name, sha, upstream] = line.split('\0');
      if (!name || !sha || !refname) continue;
      if (refname.endsWith('/HEAD')) continue;
      tips.push({
        name,
        sha,
        upstream: upstream || undefined,
        remote: refname.startsWith('refs/remotes/')
      });
    }

    const tipShas = [...new Set(tips.map((t) => t.sha))];
    if (tipShas.length === 0) {
      return { repoRoot: this.repoPath, nodes: [], tips, edges: [], truncated: false, maxNodes: cap };
    }

    const rev = await this.runAllowFail(['rev-list', '--parents', `--max-count=${cap}`, ...tipShas]);
    if (rev.code !== 0) {
      throw new GitOperationError((rev.stderr || rev.stdout).trim() || 'rev-list 失败', 'GIT_GRAPH_FAILED');
    }

    const parentMap = new Map<string, string[]>();
    for (const line of rev.stdout.split('\n')) {
      if (!line.trim()) continue;
      const parts = line.trim().split(' ');
      const sha = parts[0];
      if (!sha) continue;
      parentMap.set(sha, parts.slice(1));
    }
    const shas = [...parentMap.keys()];
    const meta = await this.loadGraphCommitMeta(shas);

    const nodes: GraphCommitNode[] = [];
    const edges: Array<[string, string]> = [];
    for (const sha of shas) {
      const parents = parentMap.get(sha) ?? [];
      const base = meta.get(sha);
      nodes.push({
        sha,
        parents,
        message: base?.message ?? '',
        author: base?.author ?? '',
        time: base?.time ?? 0
      });
      for (const parent of parents) edges.push([sha, parent]);
    }

    const into = options.into?.trim();
    const from = options.from?.trim();
    const lineage = into && from ? await this.buildBranchLineage(into, from) : undefined;

    return {
      repoRoot: this.repoPath,
      nodes,
      tips,
      edges,
      truncated: shas.length >= cap,
      maxNodes: cap,
      lineage
    };
  }

  /** 两分支 merge-base 与两侧独有提交数（不改工作区） */
  async buildBranchLineage(into: string, from: string): Promise<BranchLineage> {
    const intoSha = (await this.resolveMergeRef(into)).sha;
    const fromSha = (await this.resolveMergeRef(from)).sha;
    const base = await this.tryMergeBase(intoSha, fromSha);
    if (!base) {
      return {
        into,
        from,
        intoSha,
        fromSha,
        mergeBase: '',
        fromOnlyCount: 0,
        intoOnlyCount: 0
      };
    }
    const fromOnly = await this.run(['rev-list', '--count', `${base}..${fromSha}`]);
    const intoOnly = await this.run(['rev-list', '--count', `${base}..${intoSha}`]);
    let branchedFrom: BranchLineage['branchedFrom'];
    const first = await this.runAllowFail(['rev-list', '--reverse', '--max-count=1', `${base}..${fromSha}`]);
    const firstSha = first.stdout.trim();
    if (firstSha) {
      const meta = await this.loadGraphCommitMeta([firstSha]);
      const node = meta.get(firstSha);
      if (node) {
        branchedFrom = { sha: node.sha, author: node.author, message: node.message, time: node.time };
      }
    }
    return {
      into,
      from,
      intoSha,
      fromSha,
      mergeBase: base,
      fromOnlyCount: Number(fromOnly.trim() || 0),
      intoOnlyCount: Number(intoOnly.trim() || 0),
      branchedFrom
    };
  }

  /** git reflog（只读）。空仓库或尚无 HEAD 时返回空列表。 */
  async getReflog(maxCount = 50): Promise<ReflogEntry[]> {
    const n = Math.max(1, Math.min(500, maxCount));
    const r = await this.runAllowFail([
      'reflog',
      '--date=iso-strict',
      '-n',
      String(n),
      '--pretty=format:%H%x00%gd%x00%gs%x00%ci'
    ]);
    if (r.code !== 0) return [];
    const list: ReflogEntry[] = [];
    for (const line of r.stdout.split('\n')) {
      if (!line.trim()) continue;
      const [hash, selector, message, date] = line.split('\0');
      if (!hash) continue;
      list.push({
        hash,
        selector: selector ?? '',
        message: message ?? '',
        date: date ?? ''
      });
    }
    return list;
  }

  private async loadGraphCommitMeta(shas: string[]): Promise<Map<string, GraphCommitNode>> {
    const map = new Map<string, GraphCommitNode>();
    const chunkSize = 200;
    for (let i = 0; i < shas.length; i += chunkSize) {
      const chunk = shas.slice(i, i + chunkSize);
      if (chunk.length === 0) continue;
      const stdout = await this.run([
        'log',
        '--no-walk=unsorted',
        '--pretty=format:%H%x00%P%x00%an%x00%at%x00%s%x00',
        ...chunk
      ]);
      const parts = stdout.split('\0');
      let j = 0;
      while (j < parts.length) {
        const sha = (parts[j] ?? '').trim();
        if (!sha) {
          j += 1;
          continue;
        }
        if (j + 4 >= parts.length) break;
        const parentsRaw = parts[j + 1] ?? '';
        map.set(sha, {
          sha,
          parents: parentsRaw ? parentsRaw.split(' ').filter(Boolean) : [],
          author: (parts[j + 2] ?? '').trim(),
          time: Number(parts[j + 3] || 0),
          message: (parts[j + 4] ?? '').replace(/\r?\n/g, ' ').trim()
        });
        j += 5;
      }
    }
    return map;
  }

  // ---------------------------------------------------------------------------
  // 写操作
  // ---------------------------------------------------------------------------

  /** 预览一条命令（不真正执行） */
  static preview(command: string[], risk: WritePreview['risk'], affectedFiles?: string[], note?: string): WritePreview {
    return {
      dryRun: true,
      command: `git ${command.join(' ')}`,
      args: command,
      affectedFiles,
      risk,
      note
    };
  }

  /** 获取 HEAD 指向的提交，无提交时返回 null */
  async getHead(): Promise<string | null> {
    try {
      const rev = (await this.run(['rev-parse', '--short', 'HEAD'])).trim();
      return rev || null;
    } catch (err) {
      const msg = String((err as Error).message ?? '');
      if (/does not have any commits yet|unknown revision|bad revision/.test(msg)) return null;
      throw new GitOperationError(this.extractGitMessage(msg), 'GIT_HEAD_FAILED');
    }
  }

  /** 执行前的基础安全检查 */
  private async prepareWrite(): Promise<void> {
    await this.assertNoLock();
  }

  private async runWrite(
    command: string[],
    options: { dryRun?: boolean; risk: WritePreview['risk']; affectedFiles?: string[]; note?: string }
  ): Promise<WritePreview | string> {
    if (options.dryRun) {
      return GitService.preview(command, options.risk, options.affectedFiles, options.note);
    }
    await this.prepareWrite();
    try {
      const out = await this.run(command);
      this.emit('changed', { repoPath: this.repoPath, command });
      return out;
    } catch (err) {
      throw new GitOperationError(this.extractGitMessage(String((err as Error).message ?? '')), 'GIT_WRITE_FAILED');
    }
  }

  /** git add */
  async add(paths: string[], options: { dryRun?: boolean } = {}): Promise<WritePreview | string> {
    const pathspecs = paths.length ? paths : ['.'];
    // 逐项校验路径
    for (const p of pathspecs) if (p !== '.') this.validateRepoRelativePath(p);
    const cmd = ['add', '--', ...pathspecs];
    if (options.dryRun) {
      return GitService.preview(cmd, 'low', pathspecs, `将暂存 ${pathspecs.length} 个路径`);
    }
    await this.prepareWrite();
    try {
      const out = await this.run(cmd);
      this.emit('changed', { repoPath: this.repoPath, command: cmd });
      return out;
    } catch (err) {
      throw new GitOperationError(this.extractGitMessage(String((err as Error).message ?? '')), 'GIT_ADD_FAILED');
    }
  }

  /** git reset（取消暂存，默认 HEAD） */
  async unstage(paths: string[], options: { dryRun?: boolean } = {}): Promise<WritePreview | string> {
    const pathspecs = paths.length ? paths : ['.'];
    for (const p of pathspecs) if (p !== '.') this.validateRepoRelativePath(p);
    const cmd = ['reset', '-q', 'HEAD', '--', ...pathspecs];
    if (options.dryRun) {
      return GitService.preview(cmd, 'low', pathspecs, `将取消暂存 ${pathspecs.length} 个路径`);
    }
    await this.prepareWrite();
    try {
      const out = await this.run(cmd);
      this.emit('changed', { repoPath: this.repoPath, command: cmd });
      return out;
    } catch (err) {
      throw new GitOperationError(this.extractGitMessage(String((err as Error).message ?? '')), 'GIT_UNSTAGE_FAILED');
    }
  }

  /** git commit */
  async commit(
    message: string,
    options: { dryRun?: boolean; allowEmpty?: boolean; paths?: string[] } = {}
  ): Promise<WritePreview | string> {
    if (!message?.trim()) throw new GitOperationError('提交信息不能为空', 'INVALID_COMMIT_MESSAGE');
    const cmd = ['commit'];
    if (options.allowEmpty) cmd.push('--allow-empty');
    cmd.push('-m');
    cmd.push(message);
    if (options.paths?.length) {
      for (const p of options.paths) this.validateRepoRelativePath(p);
      cmd.push('--', ...options.paths);
    }
    if (options.dryRun) {
      const affected = options.paths ?? [];
      return GitService.preview(cmd, 'medium', affected.length ? affected : undefined, '提交将创建新的 commit');
    }
    await this.prepareWrite();
    try {
      const out = await this.run(cmd);
      this.emit('changed', { repoPath: this.repoPath, command: cmd });
      return out;
    } catch (err) {
      const msg = String((err as Error).message ?? '');
      if (/nothing to commit|no changes added to commit/.test(msg)) {
        throw new GitOperationError('没有可提交的更改（请先 git add 暂存文件）', 'NOTHING_TO_COMMIT');
      }
      throw new GitOperationError(this.extractGitMessage(msg), 'GIT_COMMIT_FAILED');
    }
  }

  /** git checkout：切换分支；newBranch 时从起点新建并检出，远程起点带 --track */
  async checkoutBranch(
    branchName: string,
    options: { dryRun?: boolean; newBranch?: string } = {}
  ): Promise<WritePreview | string> {
    this.validateRefName(branchName);
    const fresh = options.newBranch?.trim();
    let cmd = ['checkout', branchName];
    let note = `将切换到分支 ${branchName}`;
    if (fresh) {
      this.validateRefName(fresh);
      const exists = await this.runAllowFail(['show-ref', '--verify', '--quiet', `refs/heads/${fresh}`]);
      if (exists.code === 0) {
        throw new GitOperationError(`本地已有分支 ${fresh}，请换一个名字，或直接切换到它`, 'BRANCH_EXISTS');
      }
      cmd = ['checkout', '-b', fresh, '--track', branchName];
      note = `将从 ${branchName} 检出本地分支 ${fresh} 并跟踪它`;
    }
    if (options.dryRun) return GitService.preview(cmd, 'medium', undefined, note);
    await this.prepareWrite();
    try {
      const out = await this.run(cmd);
      this.emit('changed', { repoPath: this.repoPath, command: cmd });
      return out;
    } catch (err) {
      const msg = String((err as Error).message ?? '');
      if (/local changes would be overwritten|Your local changes/.test(msg)) {
        throw new GitOperationError('本地更改会被覆盖，请先提交或暂存（git stash）', 'CHECKOUT_CONFLICT');
      }
      if (/already exists|a branch named/.test(msg)) {
        throw new GitOperationError(
          `本地已有分支 ${fresh ?? branchName}，请换一个名字，或直接切换到它`,
          'BRANCH_EXISTS'
        );
      }
      throw new GitOperationError(this.extractGitMessage(msg), 'GIT_CHECKOUT_FAILED');
    }
  }

  /** 创建分支（默认从当前 HEAD） */
  async createBranch(
    branchName: string,
    options: { dryRun?: boolean; startPoint?: string } = {}
  ): Promise<WritePreview | string> {
    this.validateRefName(branchName);
    const cmd = ['branch', branchName];
    if (options.startPoint) cmd.push(options.startPoint);
    if (options.dryRun) {
      return GitService.preview(
        cmd,
        'low',
        undefined,
        `将创建分支 ${branchName}${options.startPoint ? `（起点 ${options.startPoint}）` : ''}`
      );
    }
    await this.prepareWrite();
    try {
      const out = await this.run(cmd);
      this.emit('changed', { repoPath: this.repoPath, command: cmd });
      return out;
    } catch (err) {
      const msg = String((err as Error).message ?? '');
      if (/already exists/.test(msg)) throw new GitOperationError(`分支已存在: ${branchName}`, 'BRANCH_EXISTS');
      throw new GitOperationError(this.extractGitMessage(msg), 'GIT_BRANCH_CREATE_FAILED');
    }
  }

  /** 安全删除分支（-d，不强制） */
  async deleteBranch(branchName: string, options: { dryRun?: boolean } = {}): Promise<WritePreview | string> {
    this.validateRefName(branchName);
    const cmd = ['branch', '-d', branchName];
    if (options.dryRun)
      return GitService.preview(cmd, 'medium', undefined, `将删除分支 ${branchName}（未合并分支会被拒绝）`);
    await this.prepareWrite();
    try {
      const out = await this.run(cmd);
      this.emit('changed', { repoPath: this.repoPath, command: cmd });
      return out;
    } catch (err) {
      const msg = String((err as Error).message ?? '');
      if (/not fully merged/.test(msg)) {
        throw new GitOperationError(
          `分支 ${branchName} 尚未完全合并，已拒绝删除（如需强制执行请开启高风险工具）`,
          'BRANCH_NOT_MERGED'
        );
      }
      throw new GitOperationError(this.extractGitMessage(msg), 'GIT_BRANCH_DELETE_FAILED');
    }
  }

  /** 合并分支（普通合并，不 --no-ff，不 --squash） */
  async merge(branchName: string, options: { dryRun?: boolean } = {}): Promise<WritePreview | string> {
    this.validateRefName(branchName);
    const cmd = ['merge', branchName];
    if (options.dryRun)
      return GitService.preview(cmd, 'high', undefined, `将合并分支 ${branchName} 到当前分支（可能产生冲突）`);
    await this.prepareWrite();
    try {
      const out = await this.run(cmd);
      // simple-git 的 raw() 对 merge 冲突（git 退出码 1）不会 reject，需主动检测输出
      if (/CONFLICT|Automatic merge failed/.test(out)) {
        throw new GitOperationError(`合并 ${branchName} 产生冲突，请解决冲突后提交`, 'MERGE_CONFLICT');
      }
      this.emit('changed', { repoPath: this.repoPath, command: cmd });
      return out;
    } catch (err) {
      const msg = String((err as Error).message ?? '');
      if (/conflict|CONFLICT/.test(msg)) {
        throw new GitOperationError(`合并 ${branchName} 产生冲突，请解决冲突后提交`, 'MERGE_CONFLICT');
      }
      throw new GitOperationError(this.extractGitMessage(msg), 'GIT_MERGE_FAILED');
    }
  }

  /** git fetch（改远程跟踪引用，不改工作区） */
  async fetch(options: { dryRun?: boolean; remote?: string } = {}): Promise<WritePreview | string> {
    const remote = options.remote?.trim() || 'origin';
    this.validateRefName(remote);
    const cmd = ['fetch', '--prune', '--no-tags', remote];
    if (options.dryRun) {
      return GitService.preview(
        ['fetch', '--dry-run', '--prune', '--no-tags', remote],
        'low',
        undefined,
        `将从 ${remote} 抓取远程跟踪分支（不改工作区）`
      );
    }
    await this.prepareWrite();
    try {
      const out = await this.run(cmd);
      this.emit('changed', { repoPath: this.repoPath, command: cmd });
      return out;
    } catch (err) {
      throw new GitOperationError(this.extractGitMessage(String((err as Error).message ?? '')), 'GIT_FETCH_FAILED');
    }
  }

  /** git pull（非强制） */
  async pull(options: { dryRun?: boolean; remote?: string; branch?: string } = {}): Promise<WritePreview | string> {
    const cmd = ['pull'];
    if (options.remote) {
      this.validateRefName(options.remote);
      cmd.push(options.remote);
      if (options.branch) {
        this.validateRefName(options.branch);
        cmd.push(options.branch);
      }
    }
    if (options.dryRun) return GitService.preview(cmd, 'medium', undefined, '将从远程拉取并合并更改');
    await this.prepareWrite();
    try {
      const out = await this.run(cmd);
      this.emit('changed', { repoPath: this.repoPath, command: cmd });
      return out;
    } catch (err) {
      const msg = String((err as Error).message ?? '');
      if (/conflict|CONFLICT/.test(msg)) {
        throw new GitOperationError('拉取产生冲突，请解决冲突后提交', 'PULL_CONFLICT');
      }
      if (/no tracking information for the current branch/i.test(msg)) {
        throw new GitOperationError('当前分支没有上游，无法拉取', 'NO_UPSTREAM');
      }
      throw new GitOperationError(this.extractGitMessage(msg), 'GIT_PULL_FAILED');
    }
  }

  /** git push（非强制） */
  async push(options: { dryRun?: boolean; remote?: string; branch?: string } = {}): Promise<WritePreview | string> {
    const cmd = ['push'];
    if (options.remote) cmd.push(options.remote);
    if (options.branch) cmd.push(options.branch);
    if (options.dryRun) return GitService.preview(cmd, 'medium', undefined, '将推送到远程（非强制推送）');
    await this.prepareWrite();
    try {
      const out = await this.run(cmd);
      this.emit('changed', { repoPath: this.repoPath, command: cmd });
      return out;
    } catch (err) {
      const msg = String((err as Error).message ?? '');
      if (/rejected|non-fast-forward|have diverged/.test(msg)) {
        throw new GitOperationError('推送被拒绝：远程有更新，请先拉取（git pull）', 'PUSH_REJECTED');
      }
      throw new GitOperationError(this.extractGitMessage(msg), 'GIT_PUSH_FAILED');
    }
  }

  /** 强制推送（高风险） */
  async pushForce(
    options: { dryRun?: boolean; remote?: string; branch?: string } = {}
  ): Promise<WritePreview | string> {
    const cmd = ['push', '--force-with-lease'];
    if (options.remote) cmd.push(options.remote);
    if (options.branch) cmd.push(options.branch);
    if (options.dryRun)
      return GitService.preview(cmd, 'high', undefined, '将以 --force-with-lease 强制推送（请先创建备份）');
    await this.prepareWrite();
    try {
      const out = await this.run(cmd);
      this.emit('changed', { repoPath: this.repoPath, command: cmd });
      return out;
    } catch (err) {
      const msg = String((err as Error).message ?? '');
      throw new GitOperationError(this.extractGitMessage(msg), 'GIT_PUSH_FORCE_FAILED');
    }
  }

  /** 创建标签 */
  async createTag(
    tagName: string,
    options: { dryRun?: boolean; message?: string; commit?: string } = {}
  ): Promise<WritePreview | string> {
    this.validateRefName(tagName);
    const cmd = ['tag'];
    if (options.message) cmd.push('-a');
    cmd.push(tagName);
    if (options.message) cmd.push('-m', options.message);
    if (options.commit) cmd.push(options.commit);
    if (options.dryRun) return GitService.preview(cmd, 'low', undefined, `将创建标签 ${tagName}`);
    await this.prepareWrite();
    try {
      const out = await this.run(cmd);
      this.emit('changed', { repoPath: this.repoPath, command: cmd });
      return out;
    } catch (err) {
      const msg = String((err as Error).message ?? '');
      if (/already exists/.test(msg)) throw new GitOperationError(`标签已存在: ${tagName}`, 'TAG_EXISTS');
      throw new GitOperationError(this.extractGitMessage(msg), 'GIT_TAG_CREATE_FAILED');
    }
  }

  /**
   * git stash（保存工作区）。
   * 支持 paths：仅保存这些文件（对应 WebStorm Shelve 的“选择部分文件”，git stash push -- <paths>）。
   */
  async stash(
    message?: string,
    options: { dryRun?: boolean; includeUntracked?: boolean; paths?: string[] } = {}
  ): Promise<WritePreview | string> {
    const cmd = ['stash', 'push'];
    if (options.includeUntracked) cmd.push('-u');
    if (message) cmd.push('-m', message);
    const paths = options.paths ?? [];
    for (const p of paths) if (p !== '.') this.validateRepoRelativePath(p);
    // 注意：paths 指定的*未跟踪*文件也必须配合 includeUntracked(-u) 才会被 stash，
    // 否则 git 会报 “pathspec ... did not match any file(s) known to git”。
    // 调用方（如 UI 的选择性 stash）需自行确保未跟踪文件被选中时传入 includeUntracked。
    if (paths.length) cmd.push('--', ...paths);
    const note = paths.length ? `将暂存 ${paths.length} 个文件的更改（仅这些文件）` : '将暂存（stash）当前工作区更改';
    if (options.dryRun) return GitService.preview(cmd, 'medium', paths.length ? paths : undefined, note);
    await this.prepareWrite();
    try {
      const out = await this.run(cmd);
      if (/No local changes to save/.test(out)) {
        return { dryRun: false, command: out.trim(), args: cmd, risk: 'medium', note: '没有可暂存的更改' };
      }
      this.emit('changed', { repoPath: this.repoPath, command: cmd });
      return out;
    } catch (err) {
      const msg = String((err as Error).message ?? '');
      throw new GitOperationError(this.extractGitMessage(msg), 'GIT_STASH_FAILED');
    }
  }

  /** 列出所有 stash 记录（stash@{n} / 说明 / 时间） */
  async listStashes(): Promise<StashInfo[]> {
    try {
      const out = await this.run(['log', '-g', '--format=%gD%x1f%gs%x1f%cI', 'refs/stash']);
      const list: StashInfo[] = [];
      for (const line of out.split('\n')) {
        if (!line.trim()) continue;
        const [ref, message, date] = line.split('\x1f');
        // %gD 可能是 stash@{0} 或 refs/stash@{0}（取决于 git 版本），统一正则归一化
        const m = /^(?:refs\/)?stash@\{(\d+)\}$/.exec(ref ?? '');
        if (!m) continue;
        const index = Number(m[1]);
        list.push({
          index,
          ref: `stash@{${index}}`,
          message: message ?? '',
          date: date || null
        });
      }
      return list;
    } catch (err) {
      const msg = String((err as Error).message ?? '');
      // 没有任何 stash 时 refs/stash 不存在，git log 报错 → 返回空列表
      if (/does not exist|unknown revision|bad revision|ambiguous argument/.test(msg)) {
        return [];
      }
      throw new GitOperationError(this.extractGitMessage(msg), 'GIT_STASH_LIST_FAILED');
    }
  }

  /** git stash show（查看某条 stash 的差异，不修改仓库） */
  async stashShow(options: { index?: number; maxPatchBytes?: number } = {}): Promise<{
    index: number;
    ref: string;
    patch: string;
    truncated: boolean;
  }> {
    const idx = typeof options.index === 'number' && options.index >= 0 ? options.index : 0;
    const ref = `stash@{${idx}}`;
    const out = await this.run(['stash', 'show', '-p', '--include-untracked', ref]);
    const maxBytes = options.maxPatchBytes ?? 2 * 1024 * 1024;
    const truncated = Buffer.byteLength(out, 'utf8') > maxBytes;
    return { index: idx, ref, patch: truncated ? out.slice(0, maxBytes) + '\n... [diff 过大已截断]' : out, truncated };
  }

  /** git stash apply（应用某条 stash，保留记录） */
  async stashApply(options: { dryRun?: boolean; index?: number } = {}): Promise<WritePreview | string> {
    const cmd = ['stash', 'apply'];
    if (typeof options.index === 'number' && options.index >= 0) cmd.push(`stash@{${options.index}}`);
    if (options.dryRun) return GitService.preview(cmd, 'medium', undefined, '将应用该 stash（记录保留，可反复应用）');
    await this.prepareWrite();
    try {
      const out = await this.run(cmd);
      this.emit('changed', { repoPath: this.repoPath, command: cmd });
      return out;
    } catch (err) {
      const msg = String((err as Error).message ?? '');
      if (/conflict|CONFLICT/.test(msg)) {
        throw new GitOperationError('应用 stash 产生冲突，请解决冲突', 'STASH_APPLY_CONFLICT');
      }
      throw new GitOperationError(this.extractGitMessage(msg), 'GIT_STASH_APPLY_FAILED');
    }
  }

  /** git stash drop（删除某条 stash 记录） */
  async stashDrop(options: { dryRun?: boolean; index?: number } = {}): Promise<WritePreview | string> {
    const cmd = ['stash', 'drop'];
    if (typeof options.index === 'number' && options.index >= 0) cmd.push(`stash@{${options.index}}`);
    if (options.dryRun)
      return GitService.preview(cmd, 'medium', undefined, '将删除该 stash 记录（删除后不可直接恢复）');
    await this.prepareWrite();
    try {
      const out = await this.run(cmd);
      this.emit('changed', { repoPath: this.repoPath, command: cmd });
      return out;
    } catch (err) {
      const msg = String((err as Error).message ?? '');
      throw new GitOperationError(this.extractGitMessage(msg), 'GIT_STASH_DROP_FAILED');
    }
  }

  /** git stash pop（恢复 stash） */
  async stashPop(options: { dryRun?: boolean; index?: number } = {}): Promise<WritePreview | string> {
    const cmd = ['stash', 'pop'];
    if (typeof options.index === 'number' && options.index >= 0) cmd.push(`stash@{${options.index}}`);
    if (options.dryRun) return GitService.preview(cmd, 'medium', undefined, '将恢复最新的 stash');
    await this.prepareWrite();
    try {
      const out = await this.run(cmd);
      this.emit('changed', { repoPath: this.repoPath, command: cmd });
      return out;
    } catch (err) {
      const msg = String((err as Error).message ?? '');
      if (/conflict|CONFLICT/.test(msg)) {
        throw new GitOperationError('恢复 stash 产生冲突，请解决冲突', 'STASH_POP_CONFLICT');
      }
      throw new GitOperationError(this.extractGitMessage(msg), 'GIT_STASH_POP_FAILED');
    }
  }

  /** 硬重置到指定提交（高风险，需先备份） */
  async resetHard(target: string, options: { dryRun?: boolean } = {}): Promise<WritePreview | string> {
    const cmd = ['reset', '--hard', target];
    if (options.dryRun)
      return GitService.preview(cmd, 'high', undefined, `将硬重置到 ${target}（工作区与索引将被丢弃）`);
    await this.prepareWrite();
    try {
      const out = await this.run(cmd);
      this.emit('changed', { repoPath: this.repoPath, command: cmd });
      return out;
    } catch (err) {
      const msg = String((err as Error).message ?? '');
      throw new GitOperationError(this.extractGitMessage(msg), 'GIT_RESET_FAILED');
    }
  }

  /** 清理未跟踪文件（高风险） */
  async clean(options: { dryRun?: boolean; force?: boolean } = {}): Promise<WritePreview | string> {
    const cmd = ['clean', '-df'];
    if (options.dryRun) return GitService.preview(cmd, 'high', undefined, '将删除所有未跟踪文件与目录');
    await this.prepareWrite();
    try {
      const out = await this.run(cmd);
      this.emit('changed', { repoPath: this.repoPath, command: cmd });
      return out;
    } catch (err) {
      const msg = String((err as Error).message ?? '');
      throw new GitOperationError(this.extractGitMessage(msg), 'GIT_CLEAN_FAILED');
    }
  }

  /** git rebase（高风险，默认禁用） */
  async rebase(branchName: string, options: { dryRun?: boolean } = {}): Promise<WritePreview | string> {
    this.validateRefName(branchName);
    const cmd = ['rebase', branchName];
    if (options.dryRun) return GitService.preview(cmd, 'high', undefined, `将把当前分支变基到 ${branchName}`);
    await this.prepareWrite();
    try {
      const out = await this.run(cmd);
      this.emit('changed', { repoPath: this.repoPath, command: cmd });
      return out;
    } catch (err) {
      const msg = String((err as Error).message ?? '');
      if (/conflict|CONFLICT/.test(msg)) {
        throw new GitOperationError('变基产生冲突，请解决冲突后继续（git rebase --continue）', 'REBASE_CONFLICT');
      }
      throw new GitOperationError(this.extractGitMessage(msg), 'GIT_REBASE_FAILED');
    }
  }

  /** 中止工作区 merge（不要用于 merge-tree 预演） */
  async mergeAbort(options: { dryRun?: boolean } = {}): Promise<WritePreview | string> {
    const cmd = ['merge', '--abort'];
    if (options.dryRun) {
      return GitService.preview(cmd, 'medium', undefined, '将中止当前工作区 merge，丢弃未提交的合并');
    }
    const op = await this.detectWorkspaceOperation();
    if (op !== 'merge') {
      throw new GitOperationError('当前没有进行中的 merge', 'NO_MERGE_IN_PROGRESS');
    }
    return this.runWrite(cmd, { risk: 'medium', note: '已中止 merge' });
  }

  /** 继续工作区 merge；可选先写入选边结果并 git add。GIT_EDITOR 关掉以免弹编辑器 */
  async mergeContinue(options: { dryRun?: boolean; files?: ApplyResolveFile[] } = {}): Promise<WritePreview | string> {
    const cmd = ['-c', 'core.editor=true', 'merge', '--continue'];
    const paths = (options.files ?? []).map((f) => f.path);
    if (options.dryRun) {
      return GitService.preview(
        cmd,
        'medium',
        paths.length ? paths : undefined,
        '将提交当前 merge（需已解决全部冲突）'
      );
    }
    const op = await this.detectWorkspaceOperation();
    if (op !== 'merge') {
      throw new GitOperationError('当前没有进行中的 merge', 'NO_MERGE_IN_PROGRESS');
    }
    await this.prepareWrite();
    if (options.files?.length) await this.writeResolvedToWorktree(options.files);
    return this.runContinue(cmd, 'GIT_MERGE_CONTINUE_FAILED', 'merge --continue 失败，请确认冲突已全部暂存');
  }

  /** 中止工作区 rebase */
  async rebaseAbort(options: { dryRun?: boolean } = {}): Promise<WritePreview | string> {
    const cmd = ['rebase', '--abort'];
    if (options.dryRun) {
      return GitService.preview(cmd, 'medium', undefined, '将中止当前变基，回到变基开始前');
    }
    const op = await this.detectWorkspaceOperation();
    if (op !== 'rebase') {
      throw new GitOperationError('当前没有进行中的 rebase', 'NO_REBASE_IN_PROGRESS');
    }
    return this.runWrite(cmd, { risk: 'medium', note: '已中止 rebase' });
  }

  /** 继续工作区 rebase；可选先写入选边结果并 git add */
  async rebaseContinue(options: { dryRun?: boolean; files?: ApplyResolveFile[] } = {}): Promise<WritePreview | string> {
    const cmd = ['-c', 'core.editor=true', 'rebase', '--continue'];
    const paths = (options.files ?? []).map((f) => f.path);
    if (options.dryRun) {
      return GitService.preview(
        cmd,
        'medium',
        paths.length ? paths : undefined,
        '将继续变基（需已解决当前提交的冲突）'
      );
    }
    const op = await this.detectWorkspaceOperation();
    if (op !== 'rebase') {
      throw new GitOperationError('当前没有进行中的 rebase', 'NO_REBASE_IN_PROGRESS');
    }
    await this.prepareWrite();
    if (options.files?.length) await this.writeResolvedToWorktree(options.files);
    return this.runContinue(cmd, 'GIT_REBASE_CONTINUE_FAILED', 'rebase --continue 失败，请确认冲突已全部暂存');
  }

  /** 把一个提交拣到当前分支。一次一个，不跳过空提交。 */
  async cherryPick(commit: string): Promise<string> {
    this.validateRefName(commit);
    const op = await this.detectWorkspaceOperation();
    if (op !== 'none') {
      throw new GitOperationError(`工作区正在 ${op}，先继续或中止`, 'WORKSPACE_BUSY');
    }
    const ancestor = await this.runAllowFail(['merge-base', '--is-ancestor', commit, 'HEAD']);
    if (ancestor.code === 0) {
      throw new GitOperationError('这个提交已经在当前分支里', 'ALREADY_CONTAINED');
    }
    await this.prepareWrite();
    const cmd = ['cherry-pick', commit];
    try {
      const out = await this.run(cmd);
      this.emit('changed', { repoPath: this.repoPath, command: cmd });
      return out;
    } catch (err) {
      const now = await this.detectWorkspaceOperation();
      if (now === 'cherry-pick') {
        throw new GitOperationError('拣选产生冲突，请在网页三栏选边后继续', 'CHERRY_PICK_CONFLICT');
      }
      const msg = String((err as Error).message ?? '');
      if (/now empty|nothing to commit/i.test(msg)) {
        throw new GitOperationError('拣选结果是空提交。没有跳过，请中止这次拣选。', 'CHERRY_PICK_EMPTY');
      }
      throw new GitOperationError(this.extractGitMessage(msg), 'GIT_CHERRY_PICK_FAILED');
    }
  }

  async abortCherryPick(): Promise<WritePreview | string> {
    const op = await this.detectWorkspaceOperation();
    if (op !== 'cherry-pick') {
      throw new GitOperationError('当前没有进行中的拣选', 'NO_CHERRY_PICK_IN_PROGRESS');
    }
    return this.runWrite(['cherry-pick', '--abort'], { risk: 'medium', note: '已中止拣选' });
  }

  async continueCherryPick(files?: ApplyResolveFile[]): Promise<string> {
    const op = await this.detectWorkspaceOperation();
    if (op !== 'cherry-pick') {
      throw new GitOperationError('当前没有进行中的拣选', 'NO_CHERRY_PICK_IN_PROGRESS');
    }
    await this.prepareWrite();
    if (files?.length) await this.writeResolvedToWorktree(files);
    return this.runContinue(
      ['-c', 'core.editor=true', 'cherry-pick', '--continue'],
      'GIT_CHERRY_PICK_CONTINUE_FAILED',
      'cherry-pick --continue 失败，请确认冲突已全部暂存'
    );
  }

  private async runContinue(cmd: string[], code: string, fallback: string): Promise<string> {
    const r = await this.runAllowFail(cmd, { ...process.env, GIT_EDITOR: 'true' });
    if (r.code !== 0) {
      const msg = (r.stderr || r.stdout).trim() || fallback;
      throw new GitOperationError(this.extractGitMessage(msg) || fallback, code);
    }
    this.emit('changed', { repoPath: this.repoPath, command: cmd });
    return r.stdout;
  }

  /** 把选边结果写进当前工作区并 git add（工作区冲突收尾，不是 worktree 落盘） */
  async writeResolvedToWorktree(files: ApplyResolveFile[]): Promise<void> {
    if (!files.length) return;
    const paths = files.map((f) => this.validateRepoRelativePath(f.path).replace(/\\/g, '/'));
    await this.enqueue(async () => {
      for (let i = 0; i < files.length; i++) {
        const rel = paths[i]!;
        const full = path.join(this.repoPath, rel);
        await mkdir(path.dirname(full), { recursive: true });
        await writeFile(full, files[i]!.resolvedContent, 'utf8');
      }
      await this.git.raw(['add', '--', ...paths]);
    });
  }

  /**
   * 工作区未合并文件：index 三阶段 :1: / :2: / :3: → 三栏选边。
   * merge / rebase / cherry-pick。
   */
  async listWorkspaceConflicts(): Promise<{
    operation: WorkspaceOperation;
    into: string;
    from: string;
    oursLabel: string;
    theirsLabel: string;
    files: ConflictFile[];
  }> {
    const operation = await this.detectWorkspaceOperation();
    if (operation === 'none') {
      return {
        operation,
        into: 'HEAD',
        from: 'HEAD',
        oursLabel: '当前分支',
        theirsLabel: '合入的',
        files: []
      };
    }
    const into = 'HEAD';
    const from = operation === 'merge' ? 'MERGE_HEAD' : operation === 'rebase' ? 'REBASE_HEAD' : 'CHERRY_PICK_HEAD';
    const oursLabel = operation === 'rebase' ? '变基目标' : '当前分支';
    const theirsLabel = operation === 'merge' ? '合入的' : operation === 'rebase' ? '正在重放的提交' : '拣进来的提交';
    const listed = await this.runAllowFail(['ls-files', '-u']);
    const stages = new Map<string, { s1?: string; s2?: string; s3?: string }>();
    for (const line of listed.stdout.split('\n')) {
      if (!line.trim()) continue;
      const tab = line.indexOf('\t');
      if (tab < 0) continue;
      const meta = line.slice(0, tab).trim();
      const filePath = line.slice(tab + 1);
      const parts = meta.split(/\s+/);
      const stage = parts[2];
      const blob = parts[1];
      if (!filePath || !stage || !blob) continue;
      const rec = stages.get(filePath) ?? {};
      if (stage === '1') rec.s1 = blob;
      else if (stage === '2') rec.s2 = blob;
      else if (stage === '3') rec.s3 = blob;
      stages.set(filePath, rec);
    }
    const files: ConflictFile[] = [];
    for (const [filePath, rec] of stages) {
      const baseContent = rec.s1 ? await this.showFileAtRev(':1', filePath) : null;
      const oursContent = rec.s2 ? await this.showFileAtRev(':2', filePath) : null;
      const theirsContent = rec.s3 ? await this.showFileAtRev(':3', filePath) : null;
      let conflictContent: string | null = null;
      try {
        const full = path.join(this.repoPath, filePath);
        if (fs.existsSync(full) && fs.statSync(full).isFile()) {
          conflictContent = fs.readFileSync(full, 'utf8');
        }
      } catch {
        conflictContent = null;
      }
      files.push({
        path: filePath,
        contentConflict: Boolean(oursContent || theirsContent),
        hunks: [],
        conflictContent,
        oursContent,
        theirsContent,
        baseContent
      });
    }
    files.sort((a, b) => a.path.localeCompare(b.path));
    return { operation, into, from, oursLabel, theirsLabel, files };
  }

  /** 强制删除分支（高风险） */
  async deleteBranchForce(branchName: string, options: { dryRun?: boolean } = {}): Promise<WritePreview | string> {
    this.validateRefName(branchName);
    const cmd = ['branch', '-D', branchName];
    if (options.dryRun)
      return GitService.preview(cmd, 'high', undefined, `将强制删除分支 ${branchName}（不检查合并状态）`);
    await this.prepareWrite();
    try {
      const out = await this.run(cmd);
      this.emit('changed', { repoPath: this.repoPath, command: cmd });
      return out;
    } catch (err) {
      const msg = String((err as Error).message ?? '');
      throw new GitOperationError(this.extractGitMessage(msg), 'GIT_BRANCH_DELETE_FORCE_FAILED');
    }
  }

  // ---------------------------------------------------------------------------
  // worktree 一等公民（列表/添加/删除；不当成第二套工作区做 merge）
  // ---------------------------------------------------------------------------

  async listWorktrees(): Promise<WorktreeInfo[]> {
    const out = await this.run(['worktree', 'list', '--porcelain']);
    return parseWorktreePorcelain(out, this.repoPath);
  }

  async addWorktree(
    dest: string,
    options: { dryRun?: boolean; startPoint?: string; branch?: string } = {}
  ): Promise<WritePreview | { path: string; branch: string | null; head: string }> {
    const resolved = this.assertWorktreeDest(dest);
    if (options.branch) this.validateRefName(options.branch);
    const cmd = ['worktree', 'add'];
    if (options.branch) cmd.push('-b', options.branch);
    cmd.push(resolved);
    if (options.startPoint) cmd.push(options.startPoint);
    if (options.dryRun) {
      return GitService.preview(
        cmd,
        'medium',
        undefined,
        '将添加独立 worktree（不切换主工作区；不要在里面当第二套工作区做 merge）'
      );
    }
    await this.prepareWrite();
    const r = await this.runAllowFail(cmd);
    if (r.code !== 0) {
      throw new GitOperationError(
        this.extractGitMessage((r.stderr || r.stdout).trim()) || '无法添加 worktree',
        'WORKTREE_ADD_FAILED'
      );
    }
    this.emit('changed', { repoPath: this.repoPath, command: cmd });
    const listed = await this.listWorktrees();
    const row = listed.find((w) => sameFsPath(w.path, resolved));
    return {
      path: row?.path ?? resolved,
      branch: row?.branch ?? options.branch ?? null,
      head: row?.head ?? ''
    };
  }

  async removeWorktree(
    dest: string,
    options: { dryRun?: boolean; force?: boolean } = {}
  ): Promise<WritePreview | string> {
    const resolved = path.resolve(dest.trim());
    if (!resolved) throw new GitOperationError('worktree 路径不能为空', 'INVALID_PATH');
    if (sameFsPath(resolved, this.repoPath)) {
      throw new GitOperationError('不能移除主工作区', 'WORKTREE_IS_MAIN');
    }
    const cmd = options.force ? ['worktree', 'remove', '--force', resolved] : ['worktree', 'remove', resolved];
    if (options.dryRun) {
      return GitService.preview(cmd, 'medium', undefined, '将移除该 worktree（不删主工作区）');
    }
    await this.prepareWrite();
    const r = await this.runAllowFail(cmd);
    if (r.code !== 0) {
      throw new GitOperationError(
        this.extractGitMessage((r.stderr || r.stdout).trim()) || '无法移除 worktree',
        'WORKTREE_REMOVE_FAILED'
      );
    }
    this.emit('changed', { repoPath: this.repoPath, command: cmd });
    return r.stdout || `已移除 worktree ${resolved}`;
  }

  private assertWorktreeDest(dest: string): string {
    const trimmed = dest.trim();
    if (!trimmed) throw new GitOperationError('worktree 路径不能为空', 'INVALID_PATH');
    if (!path.isAbsolute(trimmed)) {
      throw new GitOperationError(`worktree 路径必须是绝对路径: ${trimmed}`, 'INVALID_PATH');
    }
    const resolved = path.resolve(trimmed);
    if (sameFsPath(resolved, this.repoPath) || isFsPathInside(this.repoPath, resolved)) {
      throw new GitOperationError('worktree 路径不能落在主工作区内', 'INVALID_PATH');
    }
    if (fs.existsSync(resolved)) {
      const stat = fs.statSync(resolved);
      if (!stat.isDirectory()) {
        throw new GitOperationError(`路径已存在且不是目录: ${resolved}`, 'INVALID_PATH');
      }
      const entries = fs.readdirSync(resolved);
      if (entries.length > 0) {
        throw new GitOperationError(`目标目录非空: ${resolved}`, 'INVALID_PATH');
      }
    }
    return resolved;
  }

  // ---------------------------------------------------------------------------
  // 合并预演（merge-tree，不改工作区）与 worktree 落盘
  // ---------------------------------------------------------------------------

  /** 解析 `into` / `from` 为 commit SHA；失败抛 REV_NOT_FOUND */
  async ensureRev(rev: string): Promise<string> {
    const trimmed = rev.trim();
    if (!trimmed) throw new GitOperationError('引用不能为空', 'INVALID_REF');
    const r = await this.runAllowFail(['rev-parse', '--verify', `${trimmed}^{commit}`]);
    if (r.code !== 0) {
      throw new GitOperationError(
        `无法解析引用「${trimmed}」：${(r.stderr || r.stdout).trim() || 'rev-parse 失败'}`,
        'REV_NOT_FOUND'
      );
    }
    return r.stdout.trim();
  }

  /**
   * 预演/落盘用：原样 rev-parse，失败再试 `{remote}/{name}`。
   * 短名只有 origin/ 跟踪枝时也能预演。
   */
  async resolveMergeRef(rev: string, remote = 'origin'): Promise<{ sha: string; gitRef: string }> {
    const trimmed = rev.trim();
    if (!trimmed) throw new GitOperationError('引用不能为空', 'INVALID_REF');
    const remoteName = remote.trim() || 'origin';
    const candidates = [trimmed];
    if (!trimmed.startsWith('refs/') && !trimmed.startsWith(`${remoteName}/`)) {
      candidates.push(`${remoteName}/${trimmed}`);
    }
    const tried: string[] = [];
    for (const c of candidates) {
      tried.push(c);
      const r = await this.runAllowFail(['rev-parse', '--verify', `${c}^{commit}`]);
      if (r.code === 0 && r.stdout.trim()) {
        return { sha: r.stdout.trim(), gitRef: c };
      }
    }
    throw new GitOperationError(`无法解析引用「${trimmed}」（已试：${tried.join('、')}）`, 'REV_NOT_FOUND');
  }

  /** 两条提交的共同祖先；无关历史时返回 null（不抛） */
  async tryMergeBase(a: string, b: string): Promise<string | null> {
    const r = await this.runAllowFail(['merge-base', a, b]);
    if (r.code !== 0) return null;
    const sha = r.stdout.trim();
    return sha || null;
  }

  /**
   * 对单个冲突文件两侧 tip 做 blame（不改工作区）。
   * 按 `git diff -U0 base...tip` 的新侧行号溯源；增删对不齐时该侧可能为空。
   */
  async blameConflictFile(options: {
    into: string;
    from: string;
    path: string;
    fetch?: boolean;
    remote?: string;
  }): Promise<ConflictBlameResult> {
    const into = options.into.trim();
    const from = options.from.trim();
    if (!into || !from) throw new GitOperationError('into / from 不能为空', 'INVALID_REF');
    const filePath = this.validateRepoRelativePath(options.path).replace(/\\/g, '/');
    if (options.fetch === true) {
      await this.fetchQuiet(options.remote?.trim() || 'origin');
    }
    const remote = options.remote?.trim() || 'origin';
    const intoSha = (await this.resolveMergeRef(into, remote)).sha;
    const fromSha = (await this.resolveMergeRef(from, remote)).sha;
    const base = (await this.tryMergeBase(intoSha, fromSha)) || EMPTY_TREE_SHA;
    const hunks = await this.blameSides(intoSha, fromSha, base, filePath);
    return { path: filePath, into, from, hunks };
  }

  private async fileExistsAt(rev: string, filePath: string): Promise<boolean> {
    const r = await this.runAllowFail(['cat-file', '-e', `${rev}:${filePath}`]);
    return r.code === 0;
  }

  private async diffNewSideRanges(base: string, tip: string, filePath: string): Promise<Array<[number, number]>> {
    const r = await this.runAllowFail(['diff', '-U0', `${base}...${tip}`, '--', filePath]);
    return parseNewSideRanges(r.stdout);
  }

  private async blameRange(rev: string, filePath: string, range: [number, number]) {
    const [start, end] = range;
    if (start <= 0 || end < start) return [];
    const r = await this.runAllowFail([
      'blame',
      '-l',
      '-w',
      `-L${start},${end}`,
      '--line-porcelain',
      rev,
      '--',
      filePath
    ]);
    if (r.code !== 0) return [];
    return parseBlamePorcelain(r.stdout);
  }

  private async blameSides(
    intoSha: string,
    fromSha: string,
    base: string,
    filePath: string
  ): Promise<ConflictBlameResult['hunks']> {
    const [intoExists, fromExists] = await Promise.all([
      this.fileExistsAt(intoSha, filePath),
      this.fileExistsAt(fromSha, filePath)
    ]);
    if (!intoExists && !fromExists) return [];

    const [oursRanges, theirsRanges] = await Promise.all([
      intoExists ? this.diffNewSideRanges(base, intoSha, filePath) : Promise.resolve([] as Array<[number, number]>),
      fromExists ? this.diffNewSideRanges(base, fromSha, filePath) : Promise.resolve([] as Array<[number, number]>)
    ]);
    const ours = oursRanges.length > 0 ? oursRanges : intoExists ? ([[1, 1]] as Array<[number, number]>) : [];
    const theirs = theirsRanges.length > 0 ? theirsRanges : fromExists ? ([[1, 1]] as Array<[number, number]>) : [];
    const max = Math.max(ours.length, theirs.length, 1);
    const hunks: ConflictBlameResult['hunks'] = [];
    for (let i = 0; i < max; i++) {
      const oursRange = ours[i] ?? ours[0] ?? ([0, 0] as [number, number]);
      const theirsRange = theirs[i] ?? theirs[0] ?? ([0, 0] as [number, number]);
      const [oursCommits, theirsCommits] = await Promise.all([
        intoExists && oursRange[0] > 0 ? this.blameRange(intoSha, filePath, oursRange) : Promise.resolve([]),
        fromExists && theirsRange[0] > 0 ? this.blameRange(fromSha, filePath, theirsRange) : Promise.resolve([])
      ]);
      hunks.push({
        path: filePath,
        oursRange,
        theirsRange,
        ours: oursCommits,
        theirs: theirsCommits
      });
    }
    return hunks;
  }

  /**
   * 非交互 fetch（GIT_TERMINAL_PROMPT=0）。失败不抛，由预演结果标明 stale。
   */
  async fetchQuiet(remote = 'origin'): Promise<{ ok: boolean; error?: string }> {
    const r = await this.runAllowFail(['fetch', '--prune', '--no-tags', remote], {
      ...process.env,
      GIT_TERMINAL_PROMPT: '0'
    });
    if (r.code === 0) return { ok: true };
    return { ok: false, error: (r.stderr || r.stdout).trim().slice(0, 400) };
  }

  /** 缓存并校验本机 Git >= 2.38，否则抛 GIT_TOO_OLD */
  private async assertMergeTreeSupported(): Promise<GitVersion> {
    if (this.gitVersion) {
      assertMergeTreeVersion(this.gitVersion);
      return this.gitVersion;
    }
    const out = await this.run(['--version']);
    const version = parseGitVersion(out);
    assertMergeTreeVersion(version);
    this.gitVersion = version;
    return version;
  }

  /** `git show <rev>:<path>`；该 rev 无此文件时返回 null */
  private async showFileAtRev(rev: string, filePath: string): Promise<string | null> {
    const safe = this.validateRepoRelativePath(filePath).replace(/\\/g, '/');
    const r = await this.runAllowFail(['show', `${rev}:${safe}`]);
    if (r.code !== 0) return null;
    return r.stdout;
  }

  /** 先走现代 merge-tree --write-tree；无结果时回落旧式三参 merge-tree */
  private async runMergeTree(
    intoSha: string,
    fromSha: string,
    mergeBaseSha: string | null
  ): Promise<ReturnType<typeof parseModernMergeTree>> {
    await this.assertMergeTreeSupported();
    const args = ['merge-tree', '--write-tree', '-z', '--messages', '--name-only'];
    if (!mergeBaseSha) args.push('--allow-unrelated-histories');
    args.push(intoSha, fromSha);
    const modern = await this.runAllowFail(args);
    const parsed = parseModernMergeTree(modern.stdout, modern.stderr, modern.code);
    if (parsed.clean || parsed.conflictFiles.length > 0 || parsed.resultTree) {
      return parsed;
    }
    if (!mergeBaseSha) {
      return {
        clean: false,
        conflictFiles: [],
        messages: [...parsed.messages, '无法计算 merge-base，且 merge-tree 未能给出冲突文件列表（可能为无关历史）。']
      };
    }
    const classic = await this.runAllowFail(['merge-tree', mergeBaseSha, intoSha, fromSha]);
    return parseClassicMergeTree(classic.stdout || classic.stderr);
  }

  /**
   * 预演把 `from` 合入 `into`：只用 merge-tree，不改工作区、不做真实 merge。
   * into = 合入目标（线上 / ours），from = 我的分支（theirs）。
   */
  async previewMerge(options: {
    into: string;
    from: string;
    fetch?: boolean;
    remote?: string;
    path?: string;
  }): Promise<MergePreviewResult> {
    const into = options.into.trim();
    const from = options.from.trim();
    if (!into || !from) throw new GitOperationError('into / from 不能为空', 'INVALID_REF');

    const remotes = (await this.listRemotes()).map((r) => r.name);
    if (isSameBranchForMr(into, from, remotes.length ? remotes : ['origin'])) {
      throw new GitOperationError(
        `「${from}」与「${into}」是同一分支（如 master 与 origin/master），请自行 push/pull，无需预演合并。`,
        'SAME_BRANCH'
      );
    }

    const remote = options.remote ?? 'origin';
    const shouldFetch = options.fetch !== false;
    let fetched = false;
    let fetchError: string | undefined;
    if (shouldFetch) {
      const fr = await this.fetchQuiet(remote);
      fetched = fr.ok;
      if (!fr.ok) fetchError = fr.error;
    }

    const intoHit = await this.resolveMergeRef(into, remote);
    const fromHit = await this.resolveMergeRef(from, remote);
    const intoSha = intoHit.sha;
    const fromSha = fromHit.sha;
    const bySha = await this.previewMergeBySha(intoSha, fromSha);

    let conflictFiles = bySha.conflictFiles;
    if (options.path) {
      const want = this.validateRepoRelativePath(options.path).replace(/\\/g, '/');
      conflictFiles = conflictFiles.filter((f) => f.path === want);
    }

    const messages = [...bySha.messages];
    if (shouldFetch && !fetched) {
      messages.unshift(`fetch ${remote} 未成功，使用本地已有引用继续预演。${fetchError ? `原因：${fetchError}` : ''}`);
    }

    const remoteNames = remotes.length ? remotes : ['origin'];
    const intoGit = intoHit.gitRef;
    const fromGit = fromHit.gitRef;
    const intoMr = branchNameForMr(intoGit, remoteNames);
    const fromMr = branchNameForMr(fromGit, remoteNames);
    const webUrl = buildMergePageUrl(into, from);
    const meta = await this.attachPairSituation({
      into,
      from,
      intoSha: bySha.intoSha,
      fromSha: bySha.fromSha,
      outcome: bySha.outcome,
      remotes: remoteNames
    });
    if (meta.situation === 'already_merged') {
      messages.push(`「${from}」已包含在「${into}」中，没有可合并的新提交，无需落盘。`);
    } else if (meta.situation === 'looking_at_temp') {
      messages.push('选中的是落盘临时分支（merge/…），不是线上目标。');
    } else if (meta.situation === 'temp_remote') {
      messages.push(`这对分支已有远程临时枝 ${meta.pairTempBranch?.name}，无需再落盘。`);
    } else if (meta.situation === 'temp_local') {
      messages.push(`这对分支已有本地临时枝 ${meta.pairTempBranch?.name}，推送后即可申请 MR。`);
    }

    return {
      repoRoot: this.repoPath,
      into,
      from,
      fetched,
      fetchAttempted: shouldFetch,
      fetchError,
      conflictFiles,
      intoSha: bySha.intoSha,
      fromSha: bySha.fromSha,
      mergeBase: bySha.mergeBase,
      clean: bySha.clean,
      messages,
      unrelatedHistories: bySha.unrelatedHistories,
      outcome: bySha.outcome,
      resultTree: bySha.resultTree,
      intoGit,
      fromGit,
      intoMr,
      fromMr,
      webUrl,
      ...meta
    };
  }

  private async isAncestor(ancestorSha: string, descendantSha: string): Promise<boolean> {
    const r = await this.runAllowFail(['merge-base', '--is-ancestor', ancestorSha, descendantSha]);
    return r.code === 0;
  }

  private async attachPairSituation(options: {
    into: string;
    from: string;
    intoSha: string;
    fromSha: string;
    outcome: MergePreviewResult['outcome'];
    remotes: string[];
  }): Promise<{
    alreadyUpToDate: boolean;
    intoIsTempBranch: boolean;
    fromIsTempBranch: boolean;
    pairTempBranch: TempBranchState | null;
    tempStale: boolean;
    recoveredPair: { into: string; from: string } | null;
    situation: MergePreviewResult['situation'];
  }> {
    const alreadyUpToDate = await this.isAncestor(options.fromSha, options.intoSha);
    const intoIsTempBranch = isMergeTempRef(options.into, options.remotes);
    const fromIsTempBranch = isMergeTempRef(options.from, options.remotes);
    const temps = await this.loadTempBranches(options.remotes);
    const tips = { intoSha: options.intoSha, fromSha: options.fromSha };
    const expected = defaultTempBranchName(options.into, options.from, options.remotes, tips);
    const legacy = legacyTempBranchName(options.into, options.from, options.remotes);
    let pairTempBranch = temps.get(expected) ?? temps.get(legacy) ?? null;
    if (!pairTempBranch && intoIsTempBranch) {
      pairTempBranch = temps.get(branchNameForMr(options.into, options.remotes)) ?? {
        name: branchNameForMr(options.into, options.remotes),
        local: !options.into.includes('/'),
        remote: options.into.startsWith('origin/') || options.into.includes('/merge/')
      };
    }

    let recoveredPair: { into: string; from: string } | null = null;
    let tempStale = false;
    const inspectRef = intoIsTempBranch ? options.into : pairTempBranch?.name;
    if (inspectRef) {
      const log = await this.runAllowFail(['log', '-1', '--format=%B', inspectRef]);
      const parsed = parseLandedMergeMessage(log.stdout);
      if (parsed) recoveredPair = { into: parsed.into, from: parsed.from };
    }
    if (pairTempBranch && !intoIsTempBranch && !fromIsTempBranch) {
      const tempRef = pairTempBranch.local ? pairTempBranch.name : `${options.remotes[0]}/${pairTempBranch.name}`;
      const tempSha = await this.ensureRev(tempRef).catch(() => '');
      if (tempSha) {
        const fromInTemp = await this.isAncestor(options.fromSha, tempSha);
        const intoInTemp = await this.isAncestor(options.intoSha, tempSha);
        tempStale = !fromInTemp || !intoInTemp;
      }
    }

    return {
      alreadyUpToDate,
      intoIsTempBranch,
      fromIsTempBranch,
      pairTempBranch,
      tempStale,
      recoveredPair,
      situation: classifyMergePair({
        outcome: options.outcome,
        alreadyUpToDate,
        intoIsTemp: intoIsTempBranch,
        fromIsTemp: fromIsTempBranch,
        tempBranch: pairTempBranch,
        tempStale
      })
    };
  }

  /**
   * 已知两侧 SHA 的 merge-tree 预演。矩阵 / 合入顺序共用，不 fetch、不校验同名分支。
   */
  async previewMergeBySha(
    intoSha: string,
    fromSha: string
  ): Promise<{
    intoSha: string;
    fromSha: string;
    mergeBase: string;
    clean: boolean;
    unrelatedHistories: boolean;
    outcome: MergePreviewResult['outcome'];
    conflictFiles: MergePreviewResult['conflictFiles'];
    resultTree?: string;
    messages: string[];
  }> {
    const base = await this.tryMergeBase(intoSha, fromSha);
    const unrelated = base === null;
    const parsed = await this.runMergeTree(intoSha, fromSha, base);
    const messages = [...parsed.messages];
    if (unrelated) {
      messages.unshift(
        '两条分支没有共同祖先（unrelated histories），git merge-base 无法计算。',
        '已使用 --allow-unrelated-histories 继续预演合并结果。'
      );
    }
    const clean = unrelated ? false : parsed.clean;
    return {
      intoSha,
      fromSha,
      mergeBase: base ?? '',
      clean,
      unrelatedHistories: unrelated,
      outcome: unrelated ? 'unrelated' : clean ? 'clean' : 'conflicts',
      conflictFiles: parsed.conflictFiles,
      resultTree: parsed.resultTree,
      messages
    };
  }

  /** 游离两亲 commit，不被任何 ref 引用；身份写死以免仓库没配 user.email 时失败 */
  async commitSimulatedMerge(tree: string, parents: string[]): Promise<string> {
    const args = ['commit-tree', tree];
    for (const p of parents) {
      args.push('-p', p);
    }
    args.push('-m', 'git-cockpit: simulated merge (unreferenced)');
    const r = await this.runAllowFail(args, {
      ...process.env,
      GIT_AUTHOR_NAME: 'git-cockpit',
      GIT_AUTHOR_EMAIL: 'git-cockpit@localhost',
      GIT_COMMITTER_NAME: 'git-cockpit',
      GIT_COMMITTER_EMAIL: 'git-cockpit@localhost'
    });
    if (r.code !== 0 || !r.stdout.trim()) {
      throw new GitOperationError(
        `commit-tree 失败：${(r.stderr || r.stdout).trim() || '无输出'}`,
        'COMMIT_TREE_FAILED'
      );
    }
    return r.stdout.trim();
  }

  private makeRevResolver(): (ref: string) => Promise<string> {
    const seen = new Map<string, Promise<string>>();
    return (ref: string) => {
      let hit = seen.get(ref);
      if (!hit) {
        hit = this.ensureRev(ref);
        seen.set(ref, hit);
      }
      return hit;
    };
  }

  private async loadTempBranches(remoteNames: string[]) {
    const r = await this.runAllowFail(['for-each-ref', '--format=%(refname)', 'refs/heads/merge/', 'refs/remotes/']);
    return parseTempBranches(r.code === 0 ? r.stdout : '', remoteNames);
  }

  private async makeChainRunner(into: string): Promise<ChainRunner> {
    const remotes = (await this.listRemotes()).map((r) => r.name);
    const toSha = this.makeRevResolver();
    return {
      intoSha: await toSha(into),
      remoteNames: remotes,
      toSha,
      previewBySha: async (intoSha, fromSha) => {
        const p = await this.previewMergeBySha(intoSha, fromSha);
        return {
          clean: p.clean,
          unrelatedHistories: p.unrelatedHistories,
          conflictPaths: p.conflictFiles.map((f) => f.path),
          resultTree: p.resultTree
        };
      },
      commitTree: (tree, parents) => this.commitSimulatedMerge(tree, parents)
    };
  }

  /**
   * 批量预演：intos × froms（或显式 pairs），整批只 fetch 一次，只给冲突路径不给正文。
   * 单格失败记 error，不拖垮整批。不改工作区。
   */
  async surveyMerges(options: {
    intos?: string[];
    froms?: string[];
    pairs?: MergeSurveyPair[];
    fetch?: boolean;
    remote?: string;
    cache?: boolean;
    signal?: AbortSignal;
    onProgress?: (current: number, total: number) => void;
  }): Promise<MergeSurveyResult> {
    const pairs =
      options.pairs?.map((p) => ({ into: p.into.trim(), from: p.from.trim() })).filter((p) => p.into && p.from) ??
      crossPairs(
        (options.intos ?? []).map((s) => s.trim()).filter(Boolean),
        (options.froms ?? []).map((s) => s.trim()).filter(Boolean)
      );
    if (pairs.length === 0) {
      throw new GitOperationError('请至少选择一个合入目标和一个来源分支', 'INVALID_REF');
    }
    if (pairs.length > MAX_SURVEY_PAIRS) {
      throw new GitOperationError(
        `组合数 ${pairs.length} 超过上限 ${MAX_SURVEY_PAIRS}，请缩小分支范围`,
        'SURVEY_TOO_LARGE'
      );
    }

    const remote = options.remote ?? 'origin';
    let fetched = false;
    if (options.fetch !== false) {
      fetched = (await this.fetchQuiet(remote)).ok;
    }

    const remotes = (await this.listRemotes()).map((r) => r.name);
    const toSha = this.makeRevResolver();
    return runSurvey(
      {
        repoPath: this.repoPath,
        remoteNames: remotes,
        tempBranches: await this.loadTempBranches(remotes),
        toSha,
        previewBySha: async (intoSha, fromSha) => {
          const p = await this.previewMergeBySha(intoSha, fromSha);
          return {
            clean: p.clean,
            unrelatedHistories: p.unrelatedHistories,
            conflictPaths: p.conflictFiles.map((f) => f.path),
            resultTree: p.resultTree
          };
        }
      },
      {
        pairs,
        fetched,
        cache: options.cache,
        shouldStop: () => options.signal?.aborted === true,
        onProgress: options.onProgress
      }
    ).then(async (result) => {
      for (const cell of result.cells) {
        if (!cell.tempBranch?.name || !cell.intoSha || !cell.fromSha) continue;
        const ref = cell.tempBranch.local ? cell.tempBranch.name : `${remotes[0]}/${cell.tempBranch.name}`;
        const tip = await this.ensureRev(ref).catch(() => '');
        const holds = !!tip && (await this.isAncestor(cell.fromSha, tip)) && (await this.isAncestor(cell.intoSha, tip));
        if (!holds) delete cell.tempBranch;
      }
      return result;
    });
  }

  /**
   * 建议合入顺序：贪心挑能干净合入的，对比传入顺序。全程对象库，不改工作区。
   */
  async suggestMergeOrder(options: {
    into: string;
    branches: string[];
    fetch?: boolean;
    remote?: string;
  }): Promise<SuggestOrderResult> {
    const into = options.into.trim();
    const branches = options.branches.map((b) => b.trim()).filter(Boolean);
    if (!into) throw new GitOperationError('into 不能为空', 'INVALID_REF');
    if (branches.length < 2) {
      throw new GitOperationError('合入顺序至少需要 2 个来源分支', 'INVALID_REF');
    }
    if (options.fetch !== false) {
      await this.fetchQuiet(options.remote ?? 'origin');
    }
    return suggestOrder(await this.makeChainRunner(into), into, branches);
  }

  /**
   * 完整预演：冲突文件列表 + diff3 冲突正文（仍不改工作区）。
   * 选边只在网页；不要把 files 交给 Agent。
   */
  async rehearseMerge(options: {
    into: string;
    from: string;
    fetch?: boolean;
    remote?: string;
    path?: string;
    maxFiles?: number;
  }): Promise<MergeRehearsalResult> {
    const preview = await this.previewMerge(options);
    if (preview.clean || (preview.unrelatedHistories && preview.conflictFiles.length === 0)) {
      return preview;
    }
    const maxFiles = options.maxFiles ?? 20;
    const base = preview.mergeBase || EMPTY_TREE_SHA;
    const toLoad = preview.conflictFiles.slice(0, maxFiles);
    const loaded: MergeRehearsalResult['conflictFiles'] = [];
    for (const file of toLoad) {
      const content = await buildConflictContent(
        (rev, p) => this.showFileAtRev(rev, p),
        (oursPath, basePath, theirsPath, labels) =>
          this.runAllowFail([
            'merge-file',
            '-p',
            '--diff3',
            '-L',
            labels.ours,
            '-L',
            'base',
            '-L',
            labels.theirs,
            oursPath,
            basePath,
            theirsPath
          ]),
        base,
        preview.intoSha,
        preview.fromSha,
        file.path
      );
      loaded.push({ ...file, ...content });
    }
    for (const file of preview.conflictFiles.slice(maxFiles)) {
      loaded.push({ ...file, conflictContent: '（超出展示上限，已省略冲突正文）' });
    }
    return { ...preview, conflictFiles: loaded };
  }

  /**
   * 独立 worktree 落盘：基于 into 建临时分支，merge from，写入已解决文件，可选 push。
   * 主工作区 HEAD / 工作区文件全程不切换。
   */
  async applyResolve(options: {
    into: string;
    from: string;
    files?: ApplyResolveFile[];
    remote?: string;
    push?: boolean;
    keepLocal?: boolean;
    tempBranch?: string;
    dryRun?: boolean;
  }): Promise<WritePreview | ApplyResolveResult> {
    const into = options.into.trim();
    const from = options.from.trim();
    if (!into || !from) throw new GitOperationError('into / from 不能为空', 'INVALID_REF');
    const files = options.files ?? [];
    for (const f of files) {
      if (!f.path || f.resolvedContent == null) {
        throw new GitOperationError(`暂存文件缺少 path 或 resolvedContent：${f.path}`, 'INVALID_STASH');
      }
      this.validateRepoRelativePath(f.path);
    }

    const remoteList = await this.listRemotes();
    const remotes = remoteList.map((r) => r.name);
    const remoteNames = remotes.length ? remotes : ['origin'];
    if (isSameBranchForMr(into, from, remoteNames)) {
      throw new GitOperationError(
        `「${from}」与「${into}」是同一分支，请自行 push/pull，不创建临时分支。`,
        'SAME_BRANCH'
      );
    }
    if (isMergeTempRef(into, remoteNames) || isMergeTempRef(from, remoteNames)) {
      const hit = isMergeTempRef(into, remoteNames) ? into : from;
      throw new GitOperationError(
        `「${hit}」是落盘临时分支，不能再当作合入目标或来源落盘。请改选真正的线上分支；已推送的临时枝请申请 MR。`,
        'TEMP_BRANCH_AS_PAIR'
      );
    }

    const remote = options.remote ?? 'origin';
    const intoSha = (await this.resolveMergeRef(into, remote)).sha;
    const fromSha = (await this.resolveMergeRef(from, remote)).sha;
    if (await this.isAncestor(fromSha, intoSha)) {
      throw new GitOperationError(`没有可合并的新提交（${from} → ${into}），无需落盘。`, 'NOTHING_TO_MERGE');
    }
    const doPush = options.push !== false;
    const tempBranch =
      options.tempBranch?.trim() || defaultTempBranchName(into, from, remoteNames, { intoSha, fromSha });
    this.validateRefName(tempBranch);

    const cmd = ['worktree', 'add', '-B', tempBranch, '<tmp>', into, '&&', 'merge', '--no-ff', '--no-commit', from];
    if (doPush) cmd.push('&&', 'push', '-u', remote, `HEAD:refs/heads/${tempBranch}`);
    if (options.dryRun) {
      let affected = files.map((f) => f.path);
      try {
        const preview = await this.previewMerge({ into, from, fetch: false });
        if (preview.conflictFiles.length) affected = preview.conflictFiles.map((f) => f.path);
      } catch {
        /* dry-run 仍返回命令预览 */
      }
      const note = [
        '将在独立 worktree 中合并并提交到临时分支，主工作区不切换。',
        doPush ? `成功后推送 ${remote}/${tempBranch}。` : `不推送，保留本地分支 ${tempBranch}。`,
        files.length ? `将写入 ${files.length} 个已解决文件。` : '未提供已解决文件：仅干净合并可落盘。'
      ].join(' ');
      return GitService.preview(cmd, 'medium', affected.length ? affected : undefined, note);
    }

    await this.prepareWrite();
    const previousBranch = (await this.runAllowFail(['branch', '--show-current'])).stdout.trim() || null;
    if (previousBranch === tempBranch) {
      throw new GitOperationError(
        `主工作区当前正在检出临时分支「${tempBranch}」，请先切回其他分支后再落盘`,
        'TEMP_BRANCH_CHECKED_OUT'
      );
    }
    const previousTipRun = await this.runAllowFail(['rev-parse', '--verify', '--quiet', `refs/heads/${tempBranch}`]);
    const previousTip = previousTipRun.code === 0 ? previousTipRun.stdout.trim() : '';

    const parent = await mkdtemp(path.join(tmpdir(), 'git-cockpit-resolve-'));
    const wtPath = path.join(parent, 'wt');
    const messages: string[] = [];
    let pushSucceeded = false;
    let committed = false;
    const rollbackNote = previousTip ? '临时枝已回到落盘前的提交。' : '未留下本次临时枝。';

    const wt = (...args: string[]) => this.runAllowFail(['-C', wtPath, ...args]);

    try {
      const addRun = await this.runAllowFail(['worktree', 'add', '-B', tempBranch, wtPath, intoSha]);
      if (addRun.code !== 0) {
        throw new GitOperationError(
          `无法创建 worktree（主工作区未改动）：${(addRun.stderr || addRun.stdout).trim()}` +
            `\n若「${tempBranch}」已在其他 worktree 中检出，请先移除该 worktree。${rollbackNote}`,
          'WORKTREE_ADD_FAILED'
        );
      }
      messages.push(`已在独立 worktree 处理：${wtPath}`);
      messages.push(previousBranch ? `主工作区保持在「${previousBranch}」，未切换分支` : '主工作区 HEAD 未切换');

      const mergeRun = await wt('merge', '--no-ff', '--no-commit', fromSha);
      const unmergedRaw = await wt('diff', '--name-only', '--diff-filter=U');
      const unmerged = unmergedRaw.stdout
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);
      const stashPaths = new Set(files.map((f) => f.path.replace(/\\/g, '/')));

      if (mergeRun.code !== 0 || unmerged.length > 0) {
        if (files.length === 0) {
          await wt('merge', '--abort');
          throw new GitOperationError(`合并存在冲突，请先在网页三栏完成选边。${rollbackNote}`, 'HAS_CONFLICTS');
        }
        await writeResolvedFiles(wtPath, files, (rel) => wt('add', '--', rel));
        const still = (await wt('diff', '--name-only', '--diff-filter=U')).stdout
          .split('\n')
          .map((l) => l.trim())
          .filter(Boolean);
        const missing = still.filter((p) => !stashPaths.has(p.replace(/\\/g, '/')));
        if (missing.length > 0) {
          await wt('merge', '--abort');
          throw new GitOperationError(
            `以下冲突文件没有暂存解决结果，已中止合并（主工作区未改动）：\n${missing.join('\n')}\n${rollbackNote}`,
            'UNRESOLVED_LEFT'
          );
        }
        messages.push(`已按暂存覆盖 ${files.length} 个冲突文件`);
      } else if (files.length > 0) {
        await writeResolvedFiles(wtPath, files, (rel) => wt('add', '--', rel));
        messages.push('git merge 无冲突；已按暂存内容对齐文件');
      } else {
        messages.push('git merge 无冲突；将提交合并结果到临时分支');
      }

      const resolvedAny = files.length > 0;
      const commitMsg = resolvedAny
        ? `resolve: merge ${from} into ${into} via ${tempBranch}\n\nApplied stash choices from Git Cockpit merge preview (worktree).`
        : `merge: ${from} into ${into} via ${tempBranch}\n\nClean merge via Git Cockpit temp branch (worktree).`;
      const commitRun = await wt('commit', '-m', commitMsg);
      if (commitRun.code !== 0) {
        await wt('merge', '--abort');
        const detail = (commitRun.stderr || commitRun.stdout).trim();
        const mergeText = `${mergeRun.stdout}\n${mergeRun.stderr}`;
        if (/nothing to commit|no changes added/i.test(detail) || /Already up to date/i.test(mergeText)) {
          throw new GitOperationError(
            `没有可合并的新提交（${from} → ${into}），无需落盘。${rollbackNote}`,
            'NOTHING_TO_MERGE'
          );
        }
        throw new GitOperationError(`提交失败（主工作区未改动）：${detail} ${rollbackNote}`, 'COMMIT_FAILED');
      }

      const head = await wt('rev-parse', 'HEAD');
      const commitSha = head.stdout.trim();
      committed = true;
      messages.push(`已提交 ${commitSha.slice(0, 7)} @ ${tempBranch}`);

      let pushed = false;
      if (doPush) {
        const pushRun = await wt('push', '-u', remote, `HEAD:refs/heads/${tempBranch}`);
        if (pushRun.code !== 0) {
          throw new GitOperationError(
            `推送失败，${rollbackNote}主工作区仍在原分支：${(pushRun.stderr || pushRun.stdout).trim()}`,
            'PUSH_FAILED'
          );
        }
        pushed = true;
        pushSucceeded = true;
        messages.push(`已推送 ${remote}/${tempBranch}`);
      }

      const remoteUrl = urlOfRemote(remoteList, remote);
      const createMrUrl = buildCreateMrUrl(remoteUrl, tempBranch, branchNameForMr(into, remoteNames));

      this.emit('changed', { repoPath: this.repoPath, command: ['worktree', 'merge', tempBranch] });
      return {
        repoRoot: this.repoPath,
        into,
        from,
        tempBranch,
        intoSha,
        fromSha,
        commitSha,
        pushed,
        remote,
        createMrUrl,
        previousBranch,
        usedWorktree: true,
        messages
      };
    } finally {
      await this.runAllowFail(['worktree', 'remove', '--force', wtPath]);
      await rm(parent, { recursive: true, force: true }).catch(() => undefined);
      await this.runAllowFail(['worktree', 'prune']);
      const keepNew = committed && (!doPush || pushSucceeded);
      if (!keepNew) {
        if (previousTip) {
          await this.runAllowFail(['update-ref', `refs/heads/${tempBranch}`, previousTip]);
        } else {
          await this.runAllowFail(['branch', '-D', tempBranch]);
        }
      }
    }
  }

  /**
   * 只读：解析开 PR 用的源/目标分支与浏览器创建页。
   * 优先已有临时分支 `merge/<from>-into-<into>`，否则用 from 的短分支名。
   */
  async prepareMr(options: {
    into: string;
    from: string;
    remote?: string;
    sourceBranch?: string;
  }): Promise<PrepareMrResult> {
    const into = options.into.trim();
    const from = options.from.trim();
    if (!into || !from) throw new GitOperationError('into / from 不能为空', 'INVALID_REF');

    const remoteList = await this.listRemotes();
    const remotes = remoteList.map((r) => r.name);
    const remoteNames = remotes.length ? remotes : ['origin'];
    if (isSameBranchForMr(into, from, remoteNames) && !options.sourceBranch?.trim()) {
      throw new GitOperationError(`「${from}」与「${into}」是同一分支，请自行 push/pull，不创建 PR。`, 'SAME_BRANCH');
    }

    const remote = pickRemoteName(into, remotes, options.remote);
    const remoteUrl = urlOfRemote(remoteList, remote);

    const targetBranch = branchNameForMr(into, remoteNames);
    const intoResolved = await this.resolveMergeRef(into, remote).catch(() => null);
    const fromResolved = await this.resolveMergeRef(from, remote).catch(() => null);
    const tipped =
      intoResolved && fromResolved
        ? defaultTempBranchName(into, from, remoteNames, { intoSha: intoResolved.sha, fromSha: fromResolved.sha })
        : '';
    const legacy = legacyTempBranchName(into, from, remoteNames);
    let sourceBranch = options.sourceBranch?.trim() || tipped || legacy;
    this.validateRefName(sourceBranch);
    this.validateRefName(targetBranch);

    if (!options.sourceBranch?.trim()) {
      const { branches } = await this.listBranches();
      const has = (name: string) =>
        branches.some((b) => !b.remote && b.name === name) ||
        branches.some((b) => b.remote && b.name === `${remote}/${name}`);
      if (tipped && has(tipped)) sourceBranch = tipped;
      else if (has(legacy)) sourceBranch = legacy;
      else {
        sourceBranch = branchNameForMr(from, remoteNames);
        this.validateRefName(sourceBranch);
      }
    }

    const platform = detectMrPlatform(remoteUrl || '');
    const messages: string[] = [];
    let mergeGate = evaluateMrMergeGate({ situation: 'unknown', into, from });
    try {
      const preview = await this.previewMerge({ into, from, fetch: false, remote });
      mergeGate = evaluateMrMergeGate({
        situation: preview.situation,
        into,
        from,
        pairTempBranch: preview.pairTempBranch
      });
    } catch (e) {
      if (e instanceof GitOperationError && e.code === 'SAME_BRANCH') throw e;
      if (e instanceof GitOperationError) {
        mergeGate = {
          ok: false,
          code: e.code === 'REV_NOT_FOUND' ? 'REV_NOT_FOUND' : 'CONFLICTS_UNRESOLVED',
          situation: 'unknown',
          message: e.message,
          webUrl: buildMergePageUrl(into, from)
        };
      } else {
        throw e;
      }
    }
    if (!mergeGate.ok) messages.push(mergeGate.message);

    return {
      platform,
      remote,
      remoteUrl,
      sourceBranch,
      targetBranch,
      title: `Merge ${sourceBranch} into ${targetBranch}`,
      createMrUrl: remoteUrl ? buildCreateMrUrl(remoteUrl, sourceBranch, targetBranch) : null,
      cli: null,
      candidates: [],
      messages,
      mergeGate
    };
  }

  /**
   * 开单闸：冲突 / 未落盘 / 临时枝未推 一律拒绝（含 dryRun）。
   * 显式 sourceBranch 且不是 from、不是 merge/* 时，按 DIY 源枝预演：干净或已包含可过，仍冲突则拒绝。
   */
  async assertMrOpenable(options: {
    into: string;
    from: string;
    sourceBranch?: string;
    remote?: string;
  }): Promise<void> {
    const into = options.into.trim();
    const from = options.from.trim();
    if (!into || !from) throw new GitOperationError('into / from 不能为空', 'INVALID_REF');
    const remotes = (await this.listRemotes()).map((r) => r.name);
    const remoteNames = remotes.length ? remotes : ['origin'];
    const remote = pickRemoteName(into, remotes, options.remote);
    const explicit = options.sourceBranch?.trim() || '';
    const fromMr = branchNameForMr(from, remoteNames);
    const diy = Boolean(explicit) && explicit !== fromMr && explicit !== from && !isMergeTempRef(explicit, remoteNames);

    const preview = await this.previewMerge({
      into,
      from: diy ? explicit : from,
      fetch: false,
      remote
    });
    const gate = evaluateMrMergeGate({
      situation: preview.situation,
      into,
      from,
      pairTempBranch: preview.pairTempBranch
    });
    const fail = (code: string, message: string) => {
      throw new GitOperationError(gate.webUrl ? `${message}\n选边：${gate.webUrl}` : message, code);
    };
    if (diy) {
      if (preview.situation === 'conflicts' || preview.situation === 'unrelated') {
        fail('CONFLICTS_UNRESOLVED', gate.message);
      }
      return;
    }
    if (!gate.ok) fail(gate.code, gate.message);
  }

  /** 提取 git 报错中用户可读的部分 */
  private extractGitMessage(msg: string): string {
    const lines = msg
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    // 常见格式: "fatal: xxx" / "error: xxx" / "error: pathspec ..."
    const fatal = lines.find((l) => /^fatal:/i.test(l));
    const error = lines.find((l) => /^error:/i.test(l));
    const core = fatal ?? error ?? lines[0]?.slice(0, 300);
    return core ?? msg.slice(0, 300);
  }
}

/** git log --pretty 自定义格式：字段分隔符 \x1f，记录分隔符 \x1e */
export const GIT_FIELD_SEP = '\x1f';
export const GIT_RECORD_SEP = '\x1e';
const GIT_LOG_FORMAT = `%H${GIT_FIELD_SEP}%P${GIT_FIELD_SEP}%an${GIT_FIELD_SEP}%ae${GIT_FIELD_SEP}%aI${GIT_FIELD_SEP}%cn${GIT_FIELD_SEP}%ce${GIT_FIELD_SEP}%cI${GIT_FIELD_SEP}%D${GIT_FIELD_SEP}%s${GIT_FIELD_SEP}%b${GIT_RECORD_SEP}`;

/**
 * 解析 `git for-each-ref --format=%(upstream:track)` 的跟踪状态输出，如：
 * `[ahead 2]` / `[behind 3]` / `[ahead 1, behind 5]` / `[gone]` / 空串。
 * 返回 { ahead, behind }，无法识别时均返回 0。
 */
function urlOfRemote(list: RemoteInfo[], name: string): string {
  const r = list.find((x) => x.name === name);
  return (r?.pushUrl || r?.fetchUrl || '').trim();
}

function parseUpstreamTrack(track: string): { ahead: number; behind: number } {
  const ahead = /ahead (\d+)/.exec(track);
  const behind = /behind (\d+)/.exec(track);
  return {
    ahead: ahead ? Number(ahead[1]) : 0,
    behind: behind ? Number(behind[1]) : 0
  };
}

/** 直接 spawn git，拿到 stdout / stderr / exit code；不抛错 */
function spawnGit(cwd: string, args: string[], env?: NodeJS.ProcessEnv, timeoutMs = 60_000): Promise<GitCommandResult> {
  return new Promise((resolve) => {
    const child = spawn('git', args, {
      cwd,
      windowsHide: true,
      shell: false,
      env: nonInteractiveGitEnv(env ?? process.env)
    });
    let stdout = '';
    let stderr = '';
    let done = false;
    const finish = (result: GitCommandResult) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish({ stdout, stderr: `${stderr}\n(git 命令超时 ${timeoutMs}ms)`.trim(), code: 124 });
    }, timeoutMs);
    child.stdout?.on('data', (b: Buffer) => {
      stdout += b.toString('utf8');
    });
    child.stderr?.on('data', (b: Buffer) => {
      stderr += b.toString('utf8');
    });
    child.on('error', (err) => {
      finish({ stdout, stderr: err.message, code: 127 });
    });
    child.on('close', (code) => {
      finish({ stdout, stderr, code: code ?? 1 });
    });
  });
}

async function writeResolvedFiles(
  workDir: string,
  files: ApplyResolveFile[],
  add: (rel: string) => Promise<GitCommandResult>
): Promise<void> {
  for (const f of files) {
    const rel = f.path.replace(/\\/g, '/');
    const abs = path.join(workDir, rel);
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, f.resolvedContent, 'utf8');
    await add(rel);
  }
}

export type {
  DiffResult,
  FileStatus,
  DiffFileSummary,
  BranchInfo,
  TagInfo,
  RemoteInfo,
  RepoStatus,
  CommitInfo,
  GraphData,
  BranchGraph,
  BranchTip,
  GraphCommitNode,
  ReflogEntry
};
