import { EventEmitter } from 'node:events';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { JobStore, openDatabase } from '@shaohui_jin/git-cockpit-core';
import { appendPendingChunk, JobManager, takePendingChunk } from '../src/jobs.ts';
import { cleanupTmp, makeTmpDir } from './helpers.ts';

describe('JobManager 持久化', () => {
  let dir: string;

  beforeEach(() => {
    cleanupTmp();
    dir = makeTmpDir('jobs-');
  });

  afterAll(() => cleanupTmp());

  it('启动时把 running 标成中断，已结束任务原样保留', () => {
    const db = openDatabase(dir);
    const store = new JobStore(db);
    store.upsert({
      id: 'clone-run',
      kind: 'clone',
      status: 'running',
      url: 'https://example.com/a.git',
      destDir: '/tmp/a',
      logs: ['$ git clone'],
      startedAt: '2026-01-01T00:00:00.000Z'
    });
    store.upsert({
      id: 'clone-ok',
      kind: 'clone',
      status: 'ok',
      url: 'https://example.com/b.git',
      destDir: '/tmp/b',
      logs: ['完成'],
      startedAt: '2026-01-02T00:00:00.000Z',
      finishedAt: '2026-01-02T00:01:00.000Z',
      repoId: 3
    });

    const mgr = new JobManager(new EventEmitter(), store);
    expect(mgr.get('clone-run')?.status).toBe('error');
    expect(mgr.get('clone-run')?.error).toBe('服务重启，任务中断');
    expect(mgr.get('clone-run')?.logs.at(-1)).toBe('服务重启，任务中断');
    expect(mgr.get('clone-ok')?.status).toBe('ok');
    expect(mgr.get('clone-ok')?.repoId).toBe(3);

    const again = new JobManager(new EventEmitter(), new JobStore(db));
    expect(again.get('clone-run')?.status).toBe('error');
    expect(again.list().map((j) => j.id)).toEqual(['clone-ok', 'clone-run']);
  });
});

describe('SSE chunk 合并', () => {
  it('节流期间的多段 chunk 一次取出', () => {
    const buf = new Map<string, string>();
    appendPendingChunk(buf, 'j1', 'a');
    appendPendingChunk(buf, 'j1', 'b');
    appendPendingChunk(buf, 'j2', 'x');
    expect(takePendingChunk(buf, 'j1')).toBe('ab');
    expect(takePendingChunk(buf, 'j1')).toBeUndefined();
    expect(takePendingChunk(buf, 'j2')).toBe('x');
    appendPendingChunk(buf, 'j1');
    expect(takePendingChunk(buf, 'j1')).toBeUndefined();
  });
});
