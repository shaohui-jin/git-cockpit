import { DatabaseSync } from 'node:sqlite';

export interface OpenedRepo {
  id: number;
  path: string;
  addedAt: string;
  lastOpenedAt: string;
}

/**
 * 已打开仓库存储：维护用户打开的仓库列表（多仓库标签页切换的基础），
 * 持久化到 SQLite。
 */
export class RepoStore {
  constructor(private readonly db: DatabaseSync) {}

  /** 打开/记录一个仓库（同路径则为更新最近打开时间） */
  open(path: string): OpenedRepo {
    const now = new Date().toISOString();
    const existing = this.getByPath(path);
    if (existing) {
      this.db.prepare('UPDATE opened_repos SET last_opened_at = ? WHERE id = ?').run(now, existing.id);
      return { ...existing, lastOpenedAt: now };
    }
    const info = this.db
      .prepare('INSERT INTO opened_repos (path, added_at, last_opened_at) VALUES (?, ?, ?)')
      .run(path, now, now);
    return { id: Number(info.lastInsertRowid), path, addedAt: now, lastOpenedAt: now };
  }

  getByPath(path: string): OpenedRepo | null {
    const row = this.db.prepare('SELECT * FROM opened_repos WHERE path = ?').get(path) as
      | Record<string, unknown>
      | undefined;
    return row ? this.rowToRepo(row) : null;
  }

  getById(id: number): OpenedRepo | null {
    const row = this.db.prepare('SELECT * FROM opened_repos WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? this.rowToRepo(row) : null;
  }

  /** 打开仓库列表（按最近打开时间倒序） */
  list(): OpenedRepo[] {
    const rows = this.db.prepare('SELECT * FROM opened_repos ORDER BY last_opened_at DESC').all() as Record<
      string,
      unknown
    >[];
    return rows.map((r) => this.rowToRepo(r));
  }

  remove(id: number): void {
    this.db.prepare('DELETE FROM opened_repos WHERE id = ?').run(id);
  }

  removeByPath(path: string): void {
    this.db.prepare('DELETE FROM opened_repos WHERE path = ?').run(path);
  }

  private rowToRepo(r: Record<string, unknown>): OpenedRepo {
    return {
      id: Number(r.id),
      path: String(r.path),
      addedAt: String(r.added_at),
      lastOpenedAt: String(r.last_opened_at)
    };
  }
}