import { randomUUID } from 'node:crypto';
import type { EventEmitter } from 'node:events';
import { assertCloneDest, assertSafeCloneUrl, spawnClone } from '@shaohui_jin/git-cockpit-core';

export type JobStatus = 'running' | 'ok' | 'error';

export interface CloneJob {
  id: string;
  kind: 'clone';
  status: JobStatus;
  url: string;
  destDir: string;
  logs: string[];
  error?: string;
  startedAt: string;
  finishedAt?: string;
  repoId?: number;
}

export interface JobProgressPayload {
  id: string;
  kind: 'clone';
  status: JobStatus;
  url: string;
  destDir: string;
  chunk?: string;
  error?: string;
  startedAt: string;
  finishedAt?: string;
  repoId?: number;
  logCount: number;
}

const MAX_JOBS = 30;
const MAX_LOG_LINES = 800;

function splitLines(text: string): string[] {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
}

export class JobManager {
  private readonly jobs = new Map<string, CloneJob>();
  private lastEmit = 0;
  private pending: CloneJob | null = null;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly eventBus: EventEmitter) {}

  list(): CloneJob[] {
    return [...this.jobs.values()].sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
  }

  get(id: string): CloneJob | undefined {
    return this.jobs.get(id);
  }

  summary(job: CloneJob): Omit<CloneJob, 'logs'> & { logCount: number; tail: string } {
    return {
      id: job.id,
      kind: job.kind,
      status: job.status,
      url: job.url,
      destDir: job.destDir,
      error: job.error,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
      repoId: job.repoId,
      logCount: job.logs.length,
      tail: job.logs.slice(-3).join('\n')
    };
  }

  startClone(opts: {
    url: string;
    destDir: string;
    allowedRepos?: string[];
    onSuccess?: (destDir: string) => Promise<number | void>;
  }): CloneJob {
    const url = assertSafeCloneUrl(opts.url);
    const destDir = assertCloneDest(opts.destDir, opts.allowedRepos);
    const running = this.list().find((j) => j.status === 'running' && j.destDir === destDir);
    if (running) {
      throw new Error(`已有克隆任务正在写入 ${destDir}`);
    }

    const job: CloneJob = {
      id: `clone-${randomUUID()}`,
      kind: 'clone',
      status: 'running',
      url,
      destDir,
      logs: [`$ git clone --progress -- ${url} ${destDir}`],
      startedAt: new Date().toISOString()
    };
    this.jobs.set(job.id, job);
    this.prune();
    this.emit(job);
    void this.runClone(job, opts.onSuccess);
    return job;
  }

  private async runClone(job: CloneJob, onSuccess?: (destDir: string) => Promise<number | void>): Promise<void> {
    try {
      await spawnClone(job.url, job.destDir, (chunk) => this.append(job, chunk));
      if (onSuccess) {
        const repoId = await onSuccess(job.destDir);
        if (typeof repoId === 'number') job.repoId = repoId;
      }
      job.status = 'ok';
      this.append(job, '\n克隆完成\n');
    } catch (err) {
      job.status = 'error';
      job.error = err instanceof Error ? err.message : String(err);
      this.append(job, `\n失败: ${job.error}\n`);
    } finally {
      job.finishedAt = new Date().toISOString();
      this.emit(job, true);
    }
  }

  private append(job: CloneJob, chunk: string): void {
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

  private emit(job: CloneJob, force = false, chunk?: string): void {
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
    const payload: JobProgressPayload = {
      id: job.id,
      kind: job.kind,
      status: job.status,
      url: job.url,
      destDir: job.destDir,
      chunk,
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
      if (j.status !== 'running') this.jobs.delete(j.id);
    }
  }
}
