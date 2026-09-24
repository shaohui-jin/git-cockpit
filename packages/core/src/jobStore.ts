import { DatabaseSync } from 'node:sqlite';
import { normalizeJob, type Job, type LegacyCloneJob } from './jobTypes.ts';

/** 后台任务落盘：与 opened_repos / operations 同一 SQLite。 */
export class JobStore {
  constructor(private readonly db: DatabaseSync) {}

  list(limit = 200): Job[] {
    const cap = Math.min(Math.max(limit, 1), 500);
    const rows = this.db.prepare('SELECT * FROM jobs ORDER BY started_at DESC LIMIT ?').all(cap) as Record<
      string,
      unknown
    >[];
    return rows.map((r) => this.rowToJob(r));
  }

  get(id: string): Job | null {
    const row = this.db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? this.rowToJob(row) : null;
  }

  upsert(job: Job | LegacyCloneJob): void {
    const j = normalizeJob(job);
    this.db
      .prepare(
        `INSERT INTO jobs (id, kind, status, title, repo_path, repo_id, payload, logs, result, error, progress, started_at, finished_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           kind = excluded.kind,
           status = excluded.status,
           title = excluded.title,
           repo_path = excluded.repo_path,
           repo_id = excluded.repo_id,
           payload = excluded.payload,
           logs = excluded.logs,
           result = excluded.result,
           error = excluded.error,
           progress = excluded.progress,
           started_at = excluded.started_at,
           finished_at = excluded.finished_at`
      )
      .run(
        j.id,
        j.kind,
        j.status,
        j.title,
        j.repoPath ?? null,
        j.repoId ?? null,
        JSON.stringify(j.payload ?? {}),
        JSON.stringify(j.logs),
        j.result === undefined ? null : JSON.stringify(j.result),
        j.error ?? null,
        j.progress ? JSON.stringify(j.progress) : null,
        j.startedAt,
        j.finishedAt ?? null
      );
  }

  remove(id: string): void {
    this.db.prepare('DELETE FROM jobs WHERE id = ?').run(id);
  }

  private rowToJob(r: Record<string, unknown>): Job {
    let logs: string[] = [];
    try {
      const parsed: unknown = JSON.parse(String(r.logs ?? '[]'));
      if (Array.isArray(parsed)) logs = parsed.map((l) => String(l));
    } catch {
      logs = [];
    }
    let payload: Record<string, unknown> = {};
    try {
      const parsed: unknown = JSON.parse(String(r.payload ?? '{}'));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        payload = parsed as Record<string, unknown>;
      }
    } catch {
      payload = {};
    }
    let result: unknown;
    if (r.result != null) {
      try {
        result = JSON.parse(String(r.result));
      } catch {
        result = r.result;
      }
    }
    let progress: Job['progress'];
    if (r.progress != null) {
      try {
        progress = JSON.parse(String(r.progress)) as Job['progress'];
      } catch {
        progress = undefined;
      }
    }
    const kind = r.kind === 'survey' || r.kind === 'fetch' || r.kind === 'clone' ? r.kind : 'clone';
    const job: Job = {
      id: String(r.id),
      kind,
      status: r.status === 'ok' || r.status === 'error' || r.status === 'running' ? r.status : 'error',
      title: String(r.title || r.id),
      repoPath: r.repo_path == null ? undefined : String(r.repo_path),
      repoId: r.repo_id == null ? undefined : Number(r.repo_id),
      payload,
      logs,
      result,
      error: r.error == null ? undefined : String(r.error),
      progress,
      startedAt: String(r.started_at),
      finishedAt: r.finished_at == null ? undefined : String(r.finished_at)
    };
    return job;
  }
}
