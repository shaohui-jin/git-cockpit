import { EventEmitter } from 'node:events';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { simpleGit, type SimpleGit } from 'simple-git';
import { GitOperationError } from './types.js';
import type {
  DiffResult,
  FileStatus,
  DiffFileSummary,
  BranchInfo,
  TagInfo,
  RemoteInfo,
  RepoStatus,
  CommitInfo,
  LogOptions,
  DiffOptions,
  GraphData
} from './types.js';

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

  constructor(repoPath: string, gitDir: string, options: GitServiceOptions = {}) {
    super();
    this.repoPath = repoPath;
    this.gitDir = gitDir;
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
      isClean: s.isClean() ?? files.length === 0
    };
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
      const [hash, parents, authorName, authorEmail, authorDate, committerName, committerEmail, committerDate, refs, subject] = fields;
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
  async getShow(commit: string, options: Pick<DiffOptions, 'path' | 'maxPatchBytes'> = {}): Promise<{
    commit: CommitInfo;
    diff: DiffResult;
  }> {
    const meta = await this.getLog({ from: commit, maxCount: 1 });
    if (meta.length === 0) {
      throw new GitOperationError(`提交不存在: ${commit}`, 'COMMIT_NOT_FOUND');
    }
    const diff = await this.getDiff({ from: `${commit}^`, to: commit, path: options.path, maxPatchBytes: options.maxPatchBytes });
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

  /** 列出本地 + 远程分支 */
  async listBranches(): Promise<{
    branches: BranchInfo[];
    current: string | null;
  }> {
    const b = await this.enqueue(async () => this.git.branch(['-a', '--no-color']));
    const branches: BranchInfo[] = [];
    for (const [name, br] of Object.entries(b.branches)) {
      branches.push({
        name,
        current: Boolean(br.current),
        commit: br.commit ?? '',
        label: br.label ?? '',
        remote: name.startsWith('remotes/')
      });
    }
    branches.sort((x, y) => x.name.localeCompare(y.name));
    return { branches, current: b.current || null };
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

  /** 分支拓扑图数据（全部分支的提交，含父提交与引用装饰） */
  async getGraph(maxCount = 500): Promise<GraphData> {
    const args = ['log', '--no-color', '--date=iso-strict', '--all', '-n', String(Math.max(1, maxCount)), `--pretty=format:${GIT_LOG_FORMAT}`];
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

  private async runWrite(command: string[], options: { dryRun?: boolean; risk: WritePreview['risk']; affectedFiles?: string[]; note?: string }): Promise<WritePreview | string> {
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
  async commit(message: string, options: { dryRun?: boolean; allowEmpty?: boolean; paths?: string[] } = {}): Promise<WritePreview | string> {
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

  /** git checkout：切换分支 */
  async checkoutBranch(branchName: string, options: { dryRun?: boolean } = {}): Promise<WritePreview | string> {
    this.validateRefName(branchName);
    const cmd = ['checkout', branchName];
    if (options.dryRun) return GitService.preview(cmd, 'medium', undefined, `将切换到分支 ${branchName}`);
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
      throw new GitOperationError(this.extractGitMessage(msg), 'GIT_CHECKOUT_FAILED');
    }
  }

  /** 创建分支（默认从当前 HEAD） */
  async createBranch(branchName: string, options: { dryRun?: boolean; startPoint?: string } = {}): Promise<WritePreview | string> {
    this.validateRefName(branchName);
    const cmd = ['branch', branchName];
    if (options.startPoint) cmd.push(options.startPoint);
    if (options.dryRun) {
      return GitService.preview(cmd, 'low', undefined, `将创建分支 ${branchName}${options.startPoint ? `（起点 ${options.startPoint}）` : ''}`);
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
    if (options.dryRun) return GitService.preview(cmd, 'medium', undefined, `将删除分支 ${branchName}（未合并分支会被拒绝）`);
    await this.prepareWrite();
    try {
      const out = await this.run(cmd);
      this.emit('changed', { repoPath: this.repoPath, command: cmd });
      return out;
    } catch (err) {
      const msg = String((err as Error).message ?? '');
      if (/not fully merged/.test(msg)) {
        throw new GitOperationError(`分支 ${branchName} 尚未完全合并，已拒绝删除（如需强制执行请开启高风险工具）`, 'BRANCH_NOT_MERGED');
      }
      throw new GitOperationError(this.extractGitMessage(msg), 'GIT_BRANCH_DELETE_FAILED');
    }
  }

  /** 合并分支（普通合并，不 --no-ff，不 --squash） */
  async merge(branchName: string, options: { dryRun?: boolean } = {}): Promise<WritePreview | string> {
    this.validateRefName(branchName);
    const cmd = ['merge', branchName];
    if (options.dryRun) return GitService.preview(cmd, 'high', undefined, `将合并分支 ${branchName} 到当前分支（可能产生冲突）`);
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
  async pushForce(options: { dryRun?: boolean; remote?: string; branch?: string } = {}): Promise<WritePreview | string> {
    const cmd = ['push', '--force-with-lease'];
    if (options.remote) cmd.push(options.remote);
    if (options.branch) cmd.push(options.branch);
    if (options.dryRun) return GitService.preview(cmd, 'high', undefined, '将以 --force-with-lease 强制推送（请先创建备份）');
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
  async createTag(tagName: string, options: { dryRun?: boolean; message?: string; commit?: string } = {}): Promise<WritePreview | string> {
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

  /** git stash（保存工作区） */
  async stash(message?: string, options: { dryRun?: boolean; includeUntracked?: boolean } = {}): Promise<WritePreview | string> {
    const cmd = ['stash', 'push'];
    if (options.includeUntracked) cmd.push('-u');
    if (message) cmd.push('-m', message);
    if (options.dryRun) return GitService.preview(cmd, 'medium', undefined, '将暂存（stash）当前工作区更改');
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
    if (options.dryRun) return GitService.preview(cmd, 'high', undefined, `将硬重置到 ${target}（工作区与索引将被丢弃）`);
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

  /** 强制删除分支（高风险） */
  async deleteBranchForce(branchName: string, options: { dryRun?: boolean } = {}): Promise<WritePreview | string> {
    this.validateRefName(branchName);
    const cmd = ['branch', '-D', branchName];
    if (options.dryRun) return GitService.preview(cmd, 'high', undefined, `将强制删除分支 ${branchName}（不检查合并状态）`);
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

  /** 提取 git 报错中用户可读的部分 */
  private extractGitMessage(msg: string): string {
    const lines = msg.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
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

export type { DiffResult, FileStatus, DiffFileSummary, BranchInfo, TagInfo, RemoteInfo, RepoStatus, CommitInfo, GraphData };