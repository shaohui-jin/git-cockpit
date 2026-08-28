import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { GitOperationError, GitService, isSameBranchForMr } from '../src/index.ts';
import { cleanupTmp, commitFile, createConflictRepo, createSampleRepo } from './helpers.ts';

describe('isSameBranchForMr', () => {
  it('识别 master 与 origin/master 为同名', () => {
    expect(isSameBranchForMr('origin/master', 'master')).toBe(true);
    expect(isSameBranchForMr('main', 'feature')).toBe(false);
  });
});

describe('merge-tree 预演', () => {
  beforeEach(() => cleanupTmp());
  afterAll(() => cleanupTmp());

  it('干净合并不改工作区', async () => {
    const { dir } = await createSampleRepo();
    const svc = await GitService.open(dir);
    const statusBefore = await svc.getStatus();
    const result = await svc.previewMerge({ into: 'main', from: 'feature/x', fetch: false });
    expect(result.clean).toBe(true);
    expect(result.outcome).toBe('clean');
    expect(result.conflictFiles).toEqual([]);
    expect(result.resultTree).toMatch(/^[0-9a-f]{40}$/);
    const statusAfter = await svc.getStatus();
    expect(statusAfter.current).toBe(statusBefore.current);
    expect(statusAfter.isClean).toBe(true);
    expect(fs.readFileSync(path.join(dir, 'a.txt'), 'utf8')).toBe('hello world\n');
  });

  it('内容冲突返回文件列表，runAllowFail 捕获 exit 1', async () => {
    const { dir } = await createConflictRepo();
    const svc = await GitService.open(dir);
    const intoSha = await svc.ensureRev('main');
    const fromSha = await svc.ensureRev('feature');
    const raw = await svc.runAllowFail([
      'merge-tree',
      '--write-tree',
      '-z',
      '--messages',
      '--name-only',
      intoSha,
      fromSha
    ]);
    expect(raw.code).not.toBe(0);
    expect(raw.stdout.length + raw.stderr.length).toBeGreaterThan(0);

    const result = await svc.previewMerge({ into: 'main', from: 'feature', fetch: false });
    expect(result.clean).toBe(false);
    expect(result.outcome).toBe('conflicts');
    expect(result.conflictFiles.map((f) => f.path)).toContain('a.txt');
    expect((await svc.getStatus()).isClean).toBe(true);
    expect(fs.readFileSync(path.join(dir, 'a.txt'), 'utf8')).toBe('ours\n');
  });

  it('rehearse 带上 diff3 冲突正文', async () => {
    const { dir } = await createConflictRepo();
    const svc = await GitService.open(dir);
    const result = await svc.rehearseMerge({ into: 'main', from: 'feature', fetch: false });
    const file = result.conflictFiles.find((f) => f.path === 'a.txt');
    expect(file?.conflictContent).toBeTruthy();
    expect(file?.oursContent).toContain('ours');
    expect(file?.theirsContent).toContain('theirs');
  });

  it('同名分支拒绝预演', async () => {
    const { dir } = await createSampleRepo();
    const svc = await GitService.open(dir);
    await expect(svc.previewMerge({ into: 'main', from: 'main', fetch: false })).rejects.toThrow(GitOperationError);
  });
});

describe('worktree 落盘', () => {
  beforeEach(() => cleanupTmp());
  afterAll(() => cleanupTmp());

  it('干净合并落盘后主工作区仍干净且在原分支', async () => {
    const { dir, git } = await createSampleRepo();
    const svc = await GitService.open(dir);
    const result = await svc.applyResolve({
      into: 'main',
      from: 'feature/x',
      push: false,
      files: []
    });
    if ('dryRun' in result) throw new Error('不应返回 dry-run');
    expect(result.pushed).toBe(false);
    expect(result.usedWorktree).toBe(true);
    expect(result.tempBranch).toMatch(/^merge\//);
    expect(result.commitSha).toMatch(/^[0-9a-f]{40}$/);

    const status = await svc.getStatus();
    expect(status.current).toBe('main');
    expect(status.isClean).toBe(true);
    expect(fs.existsSync(path.join(dir, 'c.txt'))).toBe(false);

    const branches = await svc.listBranches();
    expect(branches.branches.some((b) => b.name === result.tempBranch)).toBe(true);
    const show = await git.show([`${result.tempBranch}:c.txt`]);
    expect(show).toContain('feature content');

    const wt = await svc.runAllowFail(['worktree', 'list']);
    expect(wt.stdout).not.toMatch(/git-cockpit-resolve/);
  });

  it('有冲突且无 files 时拒绝，主区不变、不留 worktree', async () => {
    const { dir } = await createConflictRepo();
    const svc = await GitService.open(dir);
    await expect(
      svc.applyResolve({ into: 'main', from: 'feature', push: false, files: [] })
    ).rejects.toMatchObject({ code: 'HAS_CONFLICTS' });

    const status = await svc.getStatus();
    expect(status.current).toBe('main');
    expect(status.isClean).toBe(true);
    expect(fs.readFileSync(path.join(dir, 'a.txt'), 'utf8')).toBe('ours\n');
    const wt = await svc.runAllowFail(['worktree', 'list']);
    expect(wt.stdout).not.toMatch(/git-cockpit-resolve/);
  });

  it('按 files 写入解决结果后主区仍是 ours', async () => {
    const { dir, git } = await createConflictRepo();
    const svc = await GitService.open(dir);
    const result = await svc.applyResolve({
      into: 'main',
      from: 'feature',
      push: false,
      files: [{ path: 'a.txt', resolvedContent: 'resolved\n' }]
    });
    if ('dryRun' in result) throw new Error('不应返回 dry-run');
    expect(fs.readFileSync(path.join(dir, 'a.txt'), 'utf8')).toBe('ours\n');
    const merged = await git.show([`${result.tempBranch}:a.txt`]);
    expect(merged).toBe('resolved\n');
  });
});

describe('prepareMr', () => {
  beforeEach(() => cleanupTmp());
  afterAll(() => cleanupTmp());

  it('无远程时 platform 为 unknown，源分支回落到 from', async () => {
    const { dir } = await createSampleRepo();
    const svc = await GitService.open(dir);
    const prep = await svc.prepareMr({ into: 'main', from: 'feature/x' });
    expect(prep.platform).toBe('unknown');
    expect(prep.sourceBranch).toBe('feature/x');
    expect(prep.targetBranch).toBe('main');
    expect(prep.createMrUrl).toBeNull();
  });

  it('GitHub remote 时 platform 为 github，并拼出 compare URL', async () => {
    const { dir, git } = await createSampleRepo();
    await git.addRemote('origin', 'git@github.com:acme/app.git');
    const svc = await GitService.open(dir);
    const prep = await svc.prepareMr({ into: 'main', from: 'feature/x' });
    expect(prep.platform).toBe('github');
    expect(prep.createMrUrl).toContain('/compare/');
    expect(prep.createMrUrl).toContain('feature%2Fx');
  });

  it('已有临时分支时优先用它做 source', async () => {
    const { dir } = await createSampleRepo();
    const svc = await GitService.open(dir);
    const applied = await svc.applyResolve({
      into: 'main',
      from: 'feature/x',
      push: false,
      files: []
    });
    if ('dryRun' in applied) throw new Error('不应返回 dry-run');
    const prep = await svc.prepareMr({ into: 'main', from: 'feature/x' });
    expect(prep.sourceBranch).toBe(applied.tempBranch);
  });
});
