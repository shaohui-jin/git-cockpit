import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { AuditLogger, DEFAULT_CONFIG, RepoStore, openDatabase } from '../src/index.ts';
import { cleanupTmp, makeTmpDir } from './helpers.ts';

describe('AuditLogger（SQLite）', () => {
  let dir: string;
  let db: DatabaseSync;
  let logger: AuditLogger;

  beforeEach(() => {
    cleanupTmp();
    dir = makeTmpDir('log-');
    db = openDatabase(dir);
    logger = new AuditLogger(db, { redact: DEFAULT_CONFIG.logging.redact });
  });

  afterAll(() => cleanupTmp());

  it('写入并查询操作日志', () => {
    logger.log({
      timestamp: '2026-08-25T00:00:00.000Z',
      source: 'mcp',
      tool: 'git_commit',
      repoPath: dir,
      params: { message: 'fix: bug' },
      result: 'success',
      durationMs: 12,
      dryRun: false
    });
    const rows = logger.list();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.tool).toBe('git_commit');
    expect(rows[0]!.params).toEqual({ message: 'fix: bug' });
    expect(rows[0]!.durationMs).toBe(12);
  });

  it('敏感参数被脱敏', () => {
    logger.log({
      timestamp: '2026-08-25T00:00:00.000Z',
      source: 'web',
      tool: 'git_push',
      repoPath: dir,
      params: { remote: 'https://example.com', auth: { token: 'secret-token-123' }, password: 'p@ss' },
      result: 'success',
      durationMs: 1,
      dryRun: false
    });
    const rows = logger.list();
    const params = rows[0]!.params;
    expect(params.remote).toBe('https://example.com');
    expect(params.auth).toEqual({ token: '[REDACTED]' });
    expect(params.password).toBe('[REDACTED]');
  });

  it('按工具过滤与分页', () => {
    for (let i = 0; i < 5; i++) {
      logger.log({
        timestamp: `2026-08-25T00:00:0${i}.000Z`,
        source: 'mcp',
        tool: 'git_status',
        repoPath: dir,
        params: {},
        result: 'success',
        durationMs: 1,
        dryRun: false
      });
    }
    logger.log({
      timestamp: '2026-08-25T00:00:05.000Z',
      source: 'mcp',
      tool: 'git_log',
      repoPath: dir,
      params: {},
      result: 'error',
      error: 'boom',
      durationMs: 1,
      dryRun: false
    });
    const statusRows = logger.list({ tool: 'git_status', limit: 2 });
    expect(statusRows).toHaveLength(2);
    const all = logger.list({ limit: 100 });
    expect(all).toHaveLength(6);
    expect(all[0]!.result).toBe('error');
  });

  it('数据库文件持久化在 dataDir', () => {
    logger.log({
      timestamp: 'x',
      source: 'cli',
      tool: 'git_status',
      repoPath: dir,
      params: {},
      result: 'success',
      durationMs: 0,
      dryRun: false
    });
    expect(fs.existsSync(path.join(dir, 'git-cockpit.db'))).toBe(true);
  });
});

describe('RepoStore（SQLite）', () => {
  let dir: string;
  let db: DatabaseSync;
  let store: RepoStore;

  beforeEach(() => {
    cleanupTmp();
    dir = makeTmpDir('repo-');
    db = openDatabase(dir);
    store = new RepoStore(db);
  });

  afterAll(() => cleanupTmp());

  it('打开仓库去重并更新最近打开时间', () => {
    const p1 = store.open('/a/b');
    const p2 = store.open('/a/b');
    expect(p1.id).toBe(p2.id);
    expect(store.list()).toHaveLength(1);
  });

  it('list 按最近打开倒序', async () => {
    store.open('/repo/one');
    await new Promise((r) => setTimeout(r, 5));
    store.open('/repo/two');
    const list = store.list();
    expect(list[0]!.path).toBe('/repo/two');
  });

  it('remove 删除仓库记录', () => {
    const r = store.open('/repo/x');
    store.remove(r.id);
    expect(store.getById(r.id)).toBeNull();
    expect(store.list()).toHaveLength(0);
  });
});