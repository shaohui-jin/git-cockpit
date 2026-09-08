import { randomUUID } from 'node:crypto';
import type { EventEmitter } from 'node:events';
import { assertCloneDest, assertSafeCloneUrl, removeIncompleteCloneDest, spawnClone } from './clone.ts';
import type { GitService } from './gitService.ts';
import {
  appendPendingChunk,
  clonePayload,
  takePendingChunk,
  type Job,
  type JobProgressPayload
} from './jobTypes.ts';
import type { JobStore } from './jobStore.ts';

export { appendPendingChunk, takePendingChunk };

const MAX_JOBS = 30;
const MAX_LOG_LINES = 800;
const INTERRUPT_MESSAGE = '服务重启，任务中断';

function splitLines(text: string): string[] {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
}

export interface JobEngineDeps {
  resolveGit?: (repoPath: string) => Promise<GitService>;
}

export class JobEngine {
  private readonly jobs = new Map<string, Job>();
  private lastEmit = 0;
  private pending: Job | null = null;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly pendingChunks = new Map<string, string>();
  private readonly aborts = new Map<string, AbortController>();

  constructor(
    private readonly eventBus: EventEmitter,
    private readonly store: JobStore,
    private readonly deps: JobEngineDeps = {}
  ) {
    this.restore();
  }

  list(): Job[] {
    return [...this.jobs.values()].sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
  }

  get(id: string): Job | undefined {
    return this.jobs.get(id);
  }

  summary(job: Job): Omit<Job, 'logs' | 'payload' | 'result'> & {
    url?: string;
    destDir?: string;
    logCount: number;
    tail: string;
    payload: Record<string, unknown>;
    result?: unknown;
  } {
    const clone = clonePayload(job);
    return {
      id: job.id,
      kind: job.kind,
      status: job.status,
      title: job.title,
      repoPath: job.repoPath,
      repoId: job.repoId,
      url: clone.url,
      destDir: clone.destDir,
      payload: job.payload,
      result: job.result,
      error: job.error,
      progress: job.progress,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
      logCount: job.logs.length,
      tail: job.logs.slice(-3).join('\n')
    };
  }

  detail(job: Job): Job & { url?: string; destDir?: string } {
    return { ...job, ...clonePayload(job) };
  }

  startClone(opts: {
    url: string;
    destDir: string;
    allowedRepos?: string[];
    onSuccess?: (destDir: string) => Promise<number | void>;
  }): Job {
    const url = assertSafeCloneUrl(opts.url);
    const destDir = assertCloneDest(opts.destDir, opts.allowedRepos);
    const running = this.list().find((j) => j.status === 'running' && clonePayload(j).destDir === destDir);
    if (running) {
      throw new Error(`已有克隆任务正在写入 ${destDir}`);
    }

    const job: Job = {
      id: `clone-${randomUUID()}`,
      kind: 'clone',
      status: 'running',
      title: url,
      payload: { url, destDir },
      logs: [`$ git clone --progress -- ${url} ${destDir}`],
      startedAt: new Date().toISOString()
    };
    this.jobs.set(job.id, job);
    this.persist(job);
    this.prune();
    this.emit(job);
    const ac = new AbortController();
    this.aborts.set(job.id, ac);
    void this.runClone(job, opts.onSuccess, ac);
    return job;
  }

  startSurvey(opts: {
    repoPath: string;
    intos: string[];
    froms: string[];
    fetch?: boolean;
    remote?: string;
    git?: GitService;
  }): Job {
    this.assertRepoQueueFree(opts.repoPath);
    const title = `survey ${opts.intos.length}×${opts.froms.length}`;
    const job: Job = {
      id: `survey-${randomUUID()}`,
      kind: 'survey',
      status: 'running',
      title,
      repoPath: opts.repoPath,
      payload: {
        intos: opts.intos,
        froms: opts.froms,
        fetch: opts.fetch,
        remote: opts.remote
      },
      logs: [`$ merge-tree survey ${title}`],
      progress: { current: 0, total: opts.intos.length * opts.froms.length },
      startedAt: new Date().toISOString()
    };
    this.jobs.set(job.id, job);
    this.persist(job);
    this.prune();
    this.emit(job);
    const ac = new AbortController();
    this.aborts.set(job.id, ac);
    void this.runSurveyJob(job, opts.git, ac);
    return job;
  }

  startFetch(opts: { repoPath: string; remote?: string; git?: GitService }): Job {
    this.assertRepoQueueFree(opts.repoPath);
    const remote = opts.remote ?? 'origin';
    const job: Job = {
      id: `fetch-${randomUUID()}`,
      kind: 'fetch',
      status: 'running',
      title: `fetch ${remote}`,
      repoPath: opts.repoPath,
      payload: { remote },
      logs: [`$ git fetch --prune --no-tags ${remote}`],
      startedAt: new Date().toISOString()
    };
    this.jobs.set(job.id, job);
    this.persist(job);
    this.prune();
    this.emit(job);
    const ac = new AbortController();
    this.aborts.set(job.id, ac);
    void this.runFetchJob(job, opts.git, ac);
    return job;
  }

  cancel(id: string): Job {
    const job = this.jobs.get(id);
    if (!job) throw new Error('任务不存在');
    if (job.status !== 'running') throw new Error('任务已结束，无法取消');
    const ac = this.aborts.get(id);
    if (!ac) throw new Error('任务无法取消');
    ac.abort();
    return job;
  }

  private assertRepoQueueFree(repoPath: string): void {
    const running = this.list().find(
      (j) => j.status === 'running' && j.repoPath === repoPath && (j.kind === 'survey' || j.kind === 'fetch')
    );
    if (running) {
      throw new Error(`仓库已有进行中的 ${running.kind} 任务`);
    }
  }

  private restore(): void {
    const saved = this.store.list();
    for (const job of saved) {
      if (job.status === 'running') {
        job.status = 'error';
        job.error = INTERRUPT_MESSAGE;
        job.finishedAt = new Date().toISOString();
        job.logs.push(INTERRUPT_MESSAGE);
        while (job.logs.length > MAX_LOG_LINES) job.logs.shift();
        this.persist(job);
      }
      this.jobs.set(job.id, job);
    }
    this.prune();
  }

  private persist(job: Job): void {
    try {
      this.store.upsert(job);
    } catch {
      /* 落盘失败不打断任务 */
    }
  }

  private remove(id: string): void {
    this.jobs.delete(id);
    try {
      this.store.remove(id);
    } catch {
      /* ignore */
    }
  }

  private async resolveGit(repoPath: string, git?: GitService): Promise<GitService> {
    if (git) return git;
    if (!this.deps.resolveGit) throw new Error('无法解析仓库');
    return this.deps.resolveGit(repoPath);
  }

  private async runClone(
    job: Job,
    onSuccess?: (destDir: string) => Promise<number | void>,
    ac?: AbortController
  ): Promise<void> {
    const { url, destDir } = clonePayload(job);
    try {
      if (!url || !destDir) throw new Error('克隆任务缺少 url / destDir');
      await spawnClone(url, destDir, (chunk) => this.append(job, chunk), {
        signal: ac?.signal
      });
      if (ac?.signal.aborted) {
        throw new Error('用户取消');
      }
      if (onSuccess) {
        const repoId = await onSuccess(destDir);
        if (typeof repoId === 'number') job.repoId = repoId;
      }
      job.status = 'ok';
      this.append(job, '\n克隆完成\n');
    } catch (err) {
      const cancelled =
        ac?.signal.aborted ||
        (err instanceof Error && (err.message === '用户取消' || ('code' in err && err.code === 'CLONE_CANCELLED')));
      job.status = 'error';
      job.error = cancelled ? '用户取消' : err instanceof Error ? err.message : String(err);
      if (destDir) removeIncompleteCloneDest(destDir);
      this.append(job, `\n失败: ${job.error}\n`);
    } finally {
      if (job.id) this.aborts.delete(job.id);
      job.finishedAt = new Date().toISOString();
      this.emit(job, true);
    }
  }

  private async runSurveyJob(job: Job, git: GitService | undefined, ac?: AbortController): Promise<void> {
    try {
      const svc = await this.resolveGit(job.repoPath ?? '', git);
      const intos = (job.payload.intos as string[]) ?? [];
      const froms = (job.payload.froms as string[]) ?? [];
      const result = await svc.surveyMerges({
        intos,
        froms,
        fetch: job.payload.fetch as boolean | undefined,
        remote: job.payload.remote as string | undefined,
        signal: ac?.signal,
        onProgress: (current, total) => {
          job.progress = { current, total };
          this.append(job, `格子 ${current}/${total}\n`);
        }
      });
      if (ac?.signal.aborted) throw new Error('用户取消');
      job.result = result;
      job.status = 'ok';
      this.append(job, `\n完成 ${result.cells.length} 格\n`);
    } catch (err) {
      job.status = 'error';
      job.error = ac?.signal.aborted ? '用户取消' : err instanceof Error ? err.message : String(err);
      this.append(job, `\n失败: ${job.error}\n`);
    } finally {
      this.aborts.delete(job.id);
      job.finishedAt = new Date().toISOString();
      this.emit(job, true);
    }
  }

  private async runFetchJob(job: Job, git: GitService | undefined, ac?: AbortController): Promise<void> {
    try {
      if (ac?.signal.aborted) throw new Error('用户取消');
      const svc = await this.resolveGit(job.repoPath ?? '', git);
      await svc.fetch({ remote: job.payload.remote as string | undefined });
      if (ac?.signal.aborted) throw new Error('用户取消');
      job.status = 'ok';
      this.append(job, '\nfetch 完成\n');
    } catch (err) {
      job.status = 'error';
      job.error = ac?.signal.aborted ? '用户取消' : err instanceof Error ? err.message : String(err);
      this.append(job, `\n失败: ${job.error}\n`);
    } finally {
      this.aborts.delete(job.id);
      job.finishedAt = new Date().toISOString();
      this.emit(job, true);
    }
  }

  private append(job: Job, chunk: string): void {
    const lines = splitLines(chunk);
    if (!lines.length) return;
    const last = job.logs[job.logs.length - 1] ?? '';
    if (lines[0] !== undefined && job.logs.length && !last.endsWith('\n') && chunk[0] !== '\n') {
      job.logs[job.logs.length - 1] = last + lines[0];
      job.logs.push(...lines.slice(1));
    } else {
      job.logs.push(...lines);
    }
    while (job.logs.length > MAX_LOG_LINES) job.logs.shift();
    this.emit(job, false, chunk);
  }

  private emit(job: Job, force = false, chunk?: string): void {
    appendPendingChunk(this.pendingChunks, job.id, chunk);
    const now = Date.now();
    if (!force && now - this.lastEmit < 200) {
      this.pending = job;
      this.flushTimer ??= setTimeout(() => {
        this.flushTimer = null;
        if (this.pending) this.emit(this.pending, true);
      }, 200);
      return;
    }
    this.lastEmit = now;
    this.pending = null;
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    this.persist(job);
    const clone = clonePayload(job);
    const payload: JobProgressPayload = {
      id: job.id,
      kind: job.kind,
      status: job.status,
      title: job.title,
      url: clone.url,
      destDir: clone.destDir,
      repoPath: job.repoPath,
      chunk: takePendingChunk(this.pendingChunks, job.id),
      error: job.error,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
      repoId: job.repoId,
      logCount: job.logs.length
    };
    this.eventBus.emit('job-progress', payload);
  }

  private prune(): void {
    const all = this.list();
    if (all.length <= MAX_JOBS) return;
    for (const j of all.slice(MAX_JOBS)) {
      if (j.status !== 'running') this.remove(j.id);
    }
  }
}

/** 兼容旧名 */
export { JobEngine as JobManager };
