import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { AuditLogger, DEFAULT_CONFIG, JobStore, RepoStore, openDatabase } from '../src/index.ts';
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

  it('list 按打开先后（新仓在队尾），再打开不改顺序', async () => {
    store.open('/repo/one');
    await new Promise((r) => setTimeout(r, 5));
    store.open('/repo/two');
    expect(store.list().map((r) => r.path)).toEqual(['/repo/one', '/repo/two']);
    store.open('/repo/one');
    expect(store.list().map((r) => r.path)).toEqual(['/repo/one', '/repo/two']);
    expect(store.listByLastOpened()[0]!.path).toBe('/repo/one');
  });

  it('reorder 按给定 id 排列', () => {
    const a = store.open('/repo/a');
    const b = store.open('/repo/b');
    const c = store.open('/repo/c');
    store.reorder([c.id, a.id, b.id]);
    expect(store.list().map((r) => r.path)).toEqual(['/repo/c', '/repo/a', '/repo/b']);
  });

  it('remove 删除仓库记录', () => {
    const r = store.open('/repo/x');
    store.remove(r.id);
    expect(store.getById(r.id)).toBeNull();
    expect(store.list()).toHaveLength(0);
  });
});

describe('JobStore（SQLite）', () => {
  let dir: string;
  let db: DatabaseSync;
  let store: JobStore;

  beforeEach(() => {
    cleanupTmp();
    dir = makeTmpDir('job-');
    db = openDatabase(dir);
    store = new JobStore(db);
  });

  afterAll(() => cleanupTmp());

  it('upsert 后按 started_at 倒序列出', () => {
    store.upsert({
      id: 'clone-old',
      kind: 'clone',
      status: 'ok',
      url: 'https://example.com/a.git',
      destDir: '/a',
      logs: ['done'],
      startedAt: '2026-01-01T00:00:00.000Z',
      finishedAt: '2026-01-01T00:01:00.000Z'
    });
    store.upsert({
      id: 'clone-new',
      kind: 'clone',
      status: 'error',
      url: 'https://example.com/b.git',
      destDir: '/b',
      logs: ['fail'],
      error: 'boom',
      startedAt: '2026-01-02T00:00:00.000Z',
      finishedAt: '2026-01-02T00:01:00.000Z'
    });
    const list = store.list();
    expect(list.map((j) => j.id)).toEqual(['clone-new', 'clone-old']);
    expect(store.get('clone-new')?.error).toBe('boom');
    expect(store.get('clone-new')?.logs).toEqual(['fail']);
  });

  it('同 id 覆盖写入', () => {
    store.upsert({
      id: 'clone-1',
      kind: 'clone',
      status: 'running',
      url: 'https://example.com/a.git',
      destDir: '/a',
      logs: ['start'],
      startedAt: '2026-01-01T00:00:00.000Z'
    });
    store.upsert({
      id: 'clone-1',
      kind: 'clone',
      status: 'ok',
      url: 'https://example.com/a.git',
      destDir: '/a',
      logs: ['start', 'done'],
      startedAt: '2026-01-01T00:00:00.000Z',
      finishedAt: '2026-01-01T00:02:00.000Z',
      repoId: 7
    });
    expect(store.list()).toHaveLength(1);
    expect(store.get('clone-1')).toMatchObject({ status: 'ok', repoId: 7, logs: ['start', 'done'] });
  });

  it('remove 删除任务', () => {
    store.upsert({
      id: 'clone-1',
      kind: 'clone',
      status: 'ok',
      url: 'https://example.com/a.git',
      destDir: '/a',
      logs: [],
      startedAt: '2026-01-01T00:00:00.000Z'
    });
    store.remove('clone-1');
    expect(store.get('clone-1')).toBeNull();
    expect(store.list()).toHaveLength(0);
  });
});

describe('clone_jobs 迁到 jobs', () => {
  afterAll(() => cleanupTmp());

  it('旧表一行能被 openDatabase 读到', () => {
    const dir = makeTmpDir('job-mig-');
    const raw = new DatabaseSync(path.join(dir, 'git-cockpit.db'));
    raw.exec(`
      CREATE TABLE clone_jobs (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL DEFAULT 'clone',
        status TEXT NOT NULL,
        url TEXT NOT NULL,
        dest_dir TEXT NOT NULL,
        logs TEXT NOT NULL,
        error TEXT,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        repo_id INTEGER
      );
    `);
    raw
      .prepare(
        `INSERT INTO clone_jobs (id, kind, status, url, dest_dir, logs, error, started_at, finished_at, repo_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        'clone-old',
        'clone',
        'ok',
        'https://example.com/a.git',
        '/tmp/a',
        JSON.stringify(['done']),
        null,
        '2026-01-01T00:00:00.000Z',
        '2026-01-01T00:01:00.000Z',
        2
      );
    raw.close();

    const db = openDatabase(dir);
    const store = new JobStore(db);
    const job = store.get('clone-old');
    expect(job?.kind).toBe('clone');
    expect(job?.status).toBe('ok');
    expect(job?.payload).toEqual({ url: 'https://example.com/a.git', destDir: '/tmp/a' });
    expect(job?.repoId).toBe(2);
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='clone_jobs'").get();
    expect(tables).toBeUndefined();
  });
});