import { DatabaseSync } from 'node:sqlite';

export type CloneJobStatus = 'running' | 'ok' | 'error';

export interface CloneJob {
  id: string;
  kind: 'clone';
  status: CloneJobStatus;
  url: string;
  destDir: string;
  logs: string[];
  error?: string;
  startedAt: string;
  finishedAt?: string;
  repoId?: number;
}

/** 后台克隆任务落盘：与 opened_repos / operations 同一 SQLite。 */
export class JobStore {
  constructor(private readonly db: DatabaseSync) {}

  list(limit = 200): CloneJob[] {
    const cap = Math.min(Math.max(limit, 1), 500);
    const rows = this.db
      .prepare('SELECT * FROM clone_jobs ORDER BY started_at DESC LIMIT ?')
      .all(cap) as Record<string, unknown>[];
    return rows.map((r) => this.rowToJob(r));
  }

  get(id: string): CloneJob | null {
    const row = this.db.prepare('SELECT * FROM clone_jobs WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? this.rowToJob(row) : null;
  }

  upsert(job: CloneJob): void {
    this.db
      .prepare(
        `INSERT INTO clone_jobs (id, kind, status, url, dest_dir, logs, error, started_at, finished_at, repo_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           kind = excluded.kind,
           status = excluded.status,
           url = excluded.url,
           dest_dir = excluded.dest_dir,
           logs = excluded.logs,
           error = excluded.error,
           started_at = excluded.started_at,
           finished_at = excluded.finished_at,
           repo_id = excluded.repo_id`
      )
      .run(
        job.id,
        job.kind,
        job.status,
        job.url,
        job.destDir,
        JSON.stringify(job.logs),
        job.error ?? null,
        job.startedAt,
        job.finishedAt ?? null,
        job.repoId ?? null
      );
  }

  remove(id: string): void {
    this.db.prepare('DELETE FROM clone_jobs WHERE id = ?').run(id);
  }

  private rowToJob(r: Record<string, unknown>): CloneJob {
    let logs: string[] = [];
    try {
      const parsed: unknown = JSON.parse(String(r.logs ?? '[]'));
      if (Array.isArray(parsed)) logs = parsed.map((l) => String(l));
    } catch {
      logs = [];
    }
    return {
      id: String(r.id),
      kind: 'clone',
      status: r.status === 'ok' || r.status === 'error' || r.status === 'running' ? r.status : 'error',
      url: String(r.url),
      destDir: String(r.dest_dir),
      logs,
      error: r.error == null ? undefined : String(r.error),
      startedAt: String(r.started_at),
      finishedAt: r.finished_at == null ? undefined : String(r.finished_at),
      repoId: r.repo_id == null ? undefined : Number(r.repo_id)
    };
  }
}
