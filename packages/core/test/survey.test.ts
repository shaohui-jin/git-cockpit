import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  GitOperationError,
  GitService,
  clearMergeSurveyCache,
  parseTempBranches
} from '../src/index.ts';
import { cleanupTmp, createSurveyRepo } from './helpers.ts';

describe('parseTempBranches', () => {
  it('合并本地与远程 merge/* 引用', () => {
    const stdout = [
      'refs/heads/merge/feat-into-main',
      'refs/remotes/origin/merge/feat-into-main',
      'refs/remotes/origin/main',
      'refs/heads/main'
    ].join('\n');
    const map = parseTempBranches(stdout, ['origin']);
    expect(map.get('merge/feat-into-main')).toEqual({
      name: 'merge/feat-into-main',
      local: true,
      remote: true
    });
    expect(map.size).toBe(1);
  });
});

describe('surveyMerges / suggestMergeOrder', () => {
  beforeEach(() => {
    cleanupTmp();
    clearMergeSurveyCache();
  });
  afterAll(() => cleanupTmp());

  it('矩阵：干净 / 冲突 / 同名；不改工作区', async () => {
    const { dir } = await createSurveyRepo();
    const svc = await GitService.open(dir);
    const before = await svc.getStatus();
    const result = await svc.surveyMerges({
      intos: ['main'],
      froms: ['feat-a', 'feat-c', 'main'],
      fetch: false,
      cache: false
    });
    expect(result.cells).toHaveLength(3);
    const byFrom = Object.fromEntries(result.cells.map((c) => [c.from, c]));
    expect(byFrom['feat-a']?.outcome).toBe('clean');
    expect(byFrom['feat-c']?.outcome).toBe('conflicts');
    expect(byFrom['feat-c']?.conflictPaths).toContain('a.txt');
    expect(byFrom['main']?.outcome).toBe('same');
    const after = await svc.getStatus();
    expect(after.current).toBe(before.current);
    expect(after.isClean).toBe(true);
    expect(fs.readFileSync(path.join(dir, 'a.txt'), 'utf8')).toBe('ours\n');
  });

  it('单格坏引用记 error，其余格子仍有结果', async () => {
    const { dir } = await createSurveyRepo();
    const svc = await GitService.open(dir);
    const result = await svc.surveyMerges({
      intos: ['main'],
      froms: ['feat-a', 'no-such-branch'],
      fetch: false,
      cache: false
    });
    const byFrom = Object.fromEntries(result.cells.map((c) => [c.from, c]));
    expect(byFrom['feat-a']?.outcome).toBe('clean');
    expect(byFrom['no-such-branch']?.outcome).toBe('error');
    expect(byFrom['no-such-branch']?.error).toBeTruthy();
  });

  it('已有 merge/* 临时分支会标在冲突格上', async () => {
    const { dir, git } = await createSurveyRepo();
    await git.branch(['merge/feat-c-into-main']);
    const svc = await GitService.open(dir);
    const result = await svc.surveyMerges({
      intos: ['main'],
      froms: ['feat-c'],
      fetch: false,
      cache: false
    });
    const cell = result.cells[0];
    expect(cell?.outcome).toBe('conflicts');
    expect(cell?.tempBranch).toEqual({
      name: 'merge/feat-c-into-main',
      local: true,
      remote: false
    });
  });

  it('建议顺序：把能干净合入的提前，工作区不动且不新建分支', async () => {
    const { dir } = await createSurveyRepo();
    const svc = await GitService.open(dir);
    const branchesBefore = (await svc.listBranches()).branches.map((b) => b.name).sort();
    const order = await svc.suggestMergeOrder({
      into: 'main',
      branches: ['feat-c', 'feat-a', 'feat-b'],
      fetch: false
    });
    expect(order.baseline.cleanPrefix).toBe(0);
    expect(order.baseline.blockedAt).toBe('feat-c');
    expect(order.best.cleanPrefix).toBe(2);
    expect(order.best.blockedAt).toBe('feat-c');
    expect(order.best.order.slice(0, 2).sort()).toEqual(['feat-a', 'feat-b']);
    expect(order.best.order[2]).toBe('feat-c');
    const after = await svc.getStatus();
    expect(after.isClean).toBe(true);
    expect(after.current).toBe('main');
    const branchesAfter = (await svc.listBranches()).branches.map((b) => b.name).sort();
    expect(branchesAfter).toEqual(branchesBefore);
  });

  it('来源少于 2 个拒绝算顺序', async () => {
    const { dir } = await createSurveyRepo();
    const svc = await GitService.open(dir);
    await expect(svc.suggestMergeOrder({ into: 'main', branches: ['feat-a'], fetch: false })).rejects.toThrow(
      GitOperationError
    );
  });
});
