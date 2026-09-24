import { DatabaseSync } from 'node:sqlite';

export interface OpenedRepo {
  id: number;
  path: string;
  addedAt: string;
  lastOpenedAt: string;
  pinOrder: number;
}

/**
 * 已打开仓库存储：维护用户打开的仓库列表（多仓库标签页切换的基础），
 * 持久化到 SQLite。
 */
export class RepoStore {
  constructor(private readonly db: DatabaseSync) {}

  /** 打开/记录一个仓库（同路径只刷新最近打开时间，不改拖拽顺序） */
  open(path: string): OpenedRepo {
    const now = new Date().toISOString();
    const existing = this.getByPath(path);
    if (existing) {
      this.db.prepare('UPDATE opened_repos SET last_opened_at = ? WHERE id = ?').run(now, existing.id);
      return { ...existing, lastOpenedAt: now };
    }
    const pinOrder = this.nextPinOrder();
    const info = this.db
      .prepare('INSERT INTO opened_repos (path, added_at, last_opened_at, pin_order) VALUES (?, ?, ?, ?)')
      .run(path, now, now, pinOrder);
    return { id: Number(info.lastInsertRowid), path, addedAt: now, lastOpenedAt: now, pinOrder };
  }

  getByPath(path: string): OpenedRepo | null {
    const row = this.db.prepare('SELECT * FROM opened_repos WHERE path = ?').get(path) as
      Record<string, unknown> | undefined;
    return row ? this.rowToRepo(row) : null;
  }

  getById(id: number): OpenedRepo | null {
    const row = this.db.prepare('SELECT * FROM opened_repos WHERE id = ?').get(id) as
      Record<string, unknown> | undefined;
    return row ? this.rowToRepo(row) : null;
  }

  /** 工作台顺序：拖拽 pin_order */
  list(): OpenedRepo[] {
    const rows = this.db.prepare('SELECT * FROM opened_repos ORDER BY pin_order ASC, id ASC').all() as Record<
      string,
      unknown
    >[];
    return rows.map((r) => this.rowToRepo(r));
  }

  /** MCP / 未指定仓时：仍按最近打开 */
  listByLastOpened(): OpenedRepo[] {
    const rows = this.db.prepare('SELECT * FROM opened_repos ORDER BY last_opened_at DESC, id ASC').all() as Record<
      string,
      unknown
    >[];
    return rows.map((r) => this.rowToRepo(r));
  }

  /** 完整重排。ids 必须覆盖当前全部仓库且不重复。 */
  reorder(ids: number[]): OpenedRepo[] {
    const current = this.list();
    const have = new Set(current.map((r) => r.id));
    if (ids.length !== have.size || new Set(ids).size !== ids.length || ids.some((id) => !have.has(id))) {
      throw new Error('仓库顺序不完整');
    }
    const upd = this.db.prepare('UPDATE opened_repos SET pin_order = ? WHERE id = ?');
    ids.forEach((id, i) => upd.run(i, id));
    return this.list();
  }

  remove(id: number): void {
    this.db.prepare('DELETE FROM opened_repos WHERE id = ?').run(id);
  }

  removeByPath(path: string): void {
    this.db.prepare('DELETE FROM opened_repos WHERE path = ?').run(path);
  }

  private nextPinOrder(): number {
    const row = this.db.prepare('SELECT COALESCE(MAX(pin_order), -1) AS m FROM opened_repos').get() as { m: number };
    return Number(row.m) + 1;
  }

  private rowToRepo(r: Record<string, unknown>): OpenedRepo {
    return {
      id: Number(r.id),
      path: String(r.path),
      addedAt: String(r.added_at),
      lastOpenedAt: String(r.last_opened_at),
      pinOrder: Number(r.pin_order ?? 0)
    };
  }
}
