export type JobStatus = 'running' | 'ok' | 'error';
export type JobKind = 'clone' | 'survey' | 'fetch';

export const SURVEY_ASYNC_THRESHOLD = 20;

export interface JobProgress {
  current: number;
  total: number;
  message?: string;
}

export interface Job {
  id: string;
  kind: JobKind;
  status: JobStatus;
  title: string;
  repoPath?: string;
  repoId?: number;
  payload: Record<string, unknown>;
  logs: string[];
  result?: unknown;
  error?: string;
  progress?: JobProgress;
  startedAt: string;
  finishedAt?: string;
}

/** 旧克隆任务形状（测试与迁移仍可能传入） */
export interface LegacyCloneJob {
  id: string;
  kind?: JobKind;
  status: JobStatus;
  url: string;
  destDir: string;
  title?: string;
  repoPath?: string;
  logs: string[];
  result?: unknown;
  error?: string;
  progress?: JobProgress;
  startedAt: string;
  finishedAt?: string;
  repoId?: number;
}

export type CloneJob = Job;

export interface JobProgressPayload {
  id: string;
  kind: JobKind;
  status: JobStatus;
  title?: string;
  url?: string;
  destDir?: string;
  repoPath?: string;
  chunk?: string;
  error?: string;
  startedAt: string;
  finishedAt?: string;
  repoId?: number;
  logCount: number;
}

export function clonePayload(job: Job): { url?: string; destDir?: string } {
  if (job.kind !== 'clone') return {};
  const url = job.payload.url;
  const destDir = job.payload.destDir;
  return {
    url: typeof url === 'string' ? url : undefined,
    destDir: typeof destDir === 'string' ? destDir : undefined
  };
}

export function normalizeJob(job: Job | LegacyCloneJob): Job {
  if ('payload' in job && job.payload && typeof job.payload === 'object') {
    return job;
  }
  const c = job as LegacyCloneJob;
  return {
    id: c.id,
    kind: c.kind ?? 'clone',
    status: c.status,
    title: c.title ?? c.url ?? c.id,
    repoPath: c.repoPath,
    repoId: c.repoId,
    payload: { url: c.url, destDir: c.destDir },
    logs: c.logs ?? [],
    result: c.result,
    error: c.error,
    progress: c.progress,
    startedAt: c.startedAt,
    finishedAt: c.finishedAt
  };
}

export function appendPendingChunk(buf: Map<string, string>, jobId: string, chunk?: string): void {
  if (!chunk) return;
  buf.set(jobId, (buf.get(jobId) ?? '') + chunk);
}

export function takePendingChunk(buf: Map<string, string>, jobId: string): string | undefined {
  const text = buf.get(jobId) ?? '';
  buf.delete(jobId);
  return text.length ? text : undefined;
}
