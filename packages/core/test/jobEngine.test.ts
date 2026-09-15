import { EventEmitter } from 'node:events';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { JobEngine, JobStore, openDatabase, type GitService } from '../src/index.ts';
import { cleanupTmp, makeTmpDir } from './helpers.ts';

function mockGit(path: string, fetchImpl?: () => Promise<string>): GitService {
  return {
    repoPath: path,
    fetch: fetchImpl ?? (async () => 'ok')
  } as unknown as GitService;
}

async function waitDone(engine: JobEngine, id: string, ms = 2000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    const j = engine.get(id);
    if (j && j.status !== 'running') return j;
    await new Promise((r) => setTimeout(r, 15));
  }
  throw new Error('任务超时');
}

describe('JobEngine 批量 fetch', () => {
  let dir: string;

  beforeEach(() => {
    cleanupTmp();
    dir = makeTmpDir('job-engine-');
  });

  afterAll(() => cleanupTmp());

  it('多仓合成一条任务，失败写在同一份日志', async () => {
    const store = new JobStore(openDatabase(dir));
    const calls: string[] = [];
    const engine = new JobEngine(new EventEmitter(), store, {
      resolveGit: async (repoPath) => {
        calls.push(repoPath);
        if (repoPath.endsWith('b')) {
          return mockGit(repoPath, async () => {
            throw new Error('network');
          });
        }
        return mockGit(repoPath);
      }
    });

    const job = engine.startFetchMany({
      repos: [{ repoPath: 'D:/work/a' }, { repoPath: 'D:/work/b' }, { repoPath: 'D:/work/c' }]
    });
    expect(job.title).toBe('fetch 3 个仓库');
    const done = await waitDone(engine, job.id);
    expect(done.status).toBe('error');
    expect(done.error).toMatch(/完成 2，失败 1/);
    expect(calls).toEqual(['D:/work/a', 'D:/work/b', 'D:/work/c']);
    expect(done.logs.some((l) => l.includes('[1/3] fetch D:/work/a'))).toBe(true);
    expect(done.logs.some((l) => l.includes('失败: network'))).toBe(true);
    expect(engine.list().filter((j) => j.kind === 'fetch')).toHaveLength(1);
  });

  it('已有批量任务时拒绝再开一条', async () => {
    const store = new JobStore(openDatabase(dir));
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const engine = new JobEngine(new EventEmitter(), store, {
      resolveGit: async (repoPath) =>
        mockGit(repoPath, async () => {
          await gate;
          return 'ok';
        })
    });
    const first = engine.startFetchMany({ repos: [{ repoPath: 'D:/work/a' }] });
    expect(() => engine.startFetchMany({ repos: [{ repoPath: 'D:/work/b' }] })).toThrow('已有批量抓取任务进行中');
    release();
    await waitDone(engine, first.id);
  });
});
