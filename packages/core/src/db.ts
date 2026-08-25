import { DatabaseSync } from 'node:sqlite';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export interface DatabaseOptions {
  dataDir: string;
}

/**
 * 打开（或创建）Git Cockpit 本地 SQLite 数据库。
 * 数据库即本地文件（默认 ~/.git-cockpit/git-cockpit.db），零部署成本。
 */
export function openDatabase(dataDir: string): DatabaseSync {
  const dir = expandHome(dataDir ?? '~/.git-cockpit');
  fs.mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(path.join(dir, 'git-cockpit.db'));
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA busy_timeout = 5000;');
  migrate(db);
  return db;
}

export function expandHome(p: string): string {
  if (p === '~') return os.homedir();
  if (p.startsWith('~/') || p.startsWith('~\\')) {
    return path.join(os.homedir(), p.slice(2));
  }
  return p;
}

function migrate(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS operations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      source TEXT NOT NULL,
      tool TEXT NOT NULL,
      repo_path TEXT,
      params TEXT,
      result TEXT NOT NULL,
      error TEXT,
      duration_ms INTEGER NOT NULL,
      dry_run INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_operations_timestamp ON operations(timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_operations_tool ON operations(tool);

    CREATE TABLE IF NOT EXISTS opened_repos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      path TEXT NOT NULL UNIQUE,
      added_at TEXT NOT NULL,
      last_opened_at TEXT NOT NULL
    );
  `);
}