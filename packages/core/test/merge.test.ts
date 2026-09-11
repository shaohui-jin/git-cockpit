import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  GitOperationError,
  GitService,
  classifyMergePair,
  evaluateMrMergeGate,
  isMergeTempRef,
  isSameBranchForMr,
  parseLandedMergeMessage
} from '../src/index.ts';
import { cleanupTmp, commitFile, createConflictRepo, createSampleRepo } from './helpers.ts';

describe('isSameBranchForMr', () => {
  it('识别 master 与 origin/master 为同名', () => {
    expect(isSameBranchForMr('origin/master', 'master')).toBe(true);
    expect(isSameBranchForMr('main', 'feature')).toBe(false);
  });
});

describe('merge 临时枝档位', () => {
  it('识别本地 / 远程 merge/*', () => {
    expect(isMergeTempRef('merge/a-into-b')).toBe(true);
    expect(isMergeTempRef('origin/merge/a-into-b')).toBe(true);
    expect(isMergeTempRef('origin/npm_and_yarn/marked-18.0.6')).toBe(false);
  });

  it('解析落盘提交说明', () => {
    expect(parseLandedMergeMessage('merge: feature/x into main via merge/feature-x-into-main\n\nClean merge')).toEqual({
      from: 'feature/x',
      into: 'main',
      tempBranch: 'merge/feature-x-into-main'
    });
    expect(
      parseLandedMergeMessage(
        'resolve: merge origin/a into origin/b via merge/a-into-b\n\nApplied stash'
      )
    ).toEqual({ from: 'origin/a', into: 'origin/b', tempBranch: 'merge/a-into-b' });
  });

  it('档位：对着临时枝 / 已有枝 / 已包含 / 干净', () => {
    expect(
      classifyMergePair({
        outcome: 'clean',
        alreadyUpToDate: true,
        intoIsTemp: true,
        fromIsTemp: false
      })
    ).toBe('looking_at_temp');
    expect(
      classifyMergePair({
        outcome: 'conflicts',
        alreadyUpToDate: false,
        intoIsTemp: false,
        fromIsTemp: false,
        tempBranch: { name: 'merge/x', local: true, remote: true }
      })
    ).toBe('temp_remote');
    expect(
      classifyMergePair({
        outcome: 'clean',
        alreadyUpToDate: true,
        intoIsTemp: false,
        fromIsTemp: false
      })
    ).toBe('already_merged');
    expect(
      classifyMergePair({
        outcome: 'clean',
        alreadyUpToDate: false,
        intoIsTemp: false,
        fromIsTemp: false
      })
    ).toBe('clean');
  });

  it('开单闸：临时枝已推才 ok', () => {
    expect(
      evaluateMrMergeGate({ situation: 'temp_remote', into: 'main', from: 'feat' })
    ).toMatchObject({ ok: true, code: 'OK' });
    expect(
      evaluateMrMergeGate({ situation: 'temp_local', into: 'main', from: 'feat' })
    ).toMatchObject({ ok: false, code: 'TEMP_NOT_PUSHED' });
    expect(
      evaluateMrMergeGate({
        situation: 'looking_at_temp',
        into: 'main',
        from: 'feat',
        pairTempBranch: { name: 'merge/x', local: true, remote: false }
      })
    ).toMatchObject({ ok: false, code: 'TEMP_NOT_PUSHED' });
    expect(
      evaluateMrMergeGate({
        situation: 'looking_at_temp',
        into: 'main',
        from: 'feat',
        pairTempBranch: { name: 'merge/x', local: true, remote: true }
      })
    ).toMatchObject({ ok: true, code: 'OK' });
    expect(evaluateMrMergeGate({ situation: 'clean', into: 'main', from: 'feat' })).toMatchObject({
      ok: false,
      code: 'NOT_LANDED'
    });
    expect(evaluateMrMergeGate({ situation: 'conflicts', into: 'main', from: 'feat' })).toMatchObject({
      ok: false,
      code: 'CONFLICTS_UNRESOLVED'
    });
    expect(evaluateMrMergeGate({ situation: 'already_merged', into: 'main', from: 'feat' })).toMatchObject({
      ok: false,
      code: 'ALREADY_MERGED'
    });
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

  it('短名只有 origin/ 跟踪枝时也能预演', async () => {
    const { dir, git } = await createSampleRepo();
    const sha = (await git.revparse(['feature/x'])).trim();
    await git.raw(['update-ref', 'refs/remotes/origin/only-remote', sha]);
    const svc = await GitService.open(dir);
    const preview = await svc.previewMerge({ into: 'main', from: 'only-remote', fetch: false });
    expect(preview.fromGit).toBe('origin/only-remote');
    expect(preview.fromMr).toBe('only-remote');
    expect(preview.clean).toBe(true);
    expect(preview.webUrl).toContain('/#/merge?');
  });

  it('from 已在 into 里时 situation=already_merged，dry-run 落盘失败', async () => {
    const { dir } = await createSampleRepo();
    const svc = await GitService.open(dir);
    const preview = await svc.previewMerge({ into: 'feature/x', from: 'main', fetch: false });
    expect(preview.alreadyUpToDate).toBe(true);
    expect(preview.situation).toBe('already_merged');
    await expect(
      svc.applyResolve({ into: 'feature/x', from: 'main', push: false, dryRun: true, files: [] })
    ).rejects.toMatchObject({ code: 'NOTHING_TO_MERGE' });
  });

  it('落盘后预演原 pair 为 temp_local；对着临时枝为 looking_at_temp', async () => {
    const { dir } = await createSampleRepo();
    const svc = await GitService.open(dir);
    const applied = await svc.applyResolve({ into: 'main', from: 'feature/x', push: false, files: [] });
    if ('dryRun' in applied) throw new Error('不应返回 dry-run');
    const again = await svc.previewMerge({ into: 'main', from: 'feature/x', fetch: false });
    expect(again.situation).toBe('temp_local');
    expect(again.pairTempBranch?.name).toBe(applied.tempBranch);
    const looking = await svc.previewMerge({ into: applied.tempBranch, from: 'main', fetch: false });
    expect(looking.situation).toBe('looking_at_temp');
    expect(looking.recoveredPair).toEqual({ into: 'main', from: 'feature/x' });
    await expect(
      svc.applyResolve({ into: applied.tempBranch, from: 'main', push: false, dryRun: true, files: [] })
    ).rejects.toMatchObject({ code: 'TEMP_BRANCH_AS_PAIR' });
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
    expect(prep.mergeGate).toMatchObject({ ok: false, code: 'NOT_LANDED' });
    await expect(svc.assertMrOpenable({ into: 'main', from: 'feature/x' })).rejects.toMatchObject({
      code: 'NOT_LANDED'
    });
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

  it('GitLab remote 时 platform 为 gitlab', async () => {
    const { dir, git } = await createSampleRepo();
    await git.addRemote('origin', 'https://gitlab.com/acme/app.git');
    const svc = await GitService.open(dir);
    const prep = await svc.prepareMr({ into: 'main', from: 'feature/x' });
    expect(prep.platform).toBe('gitlab');
    expect(prep.createMrUrl).toContain('merge_requests/new');
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
    expect(prep.mergeGate).toMatchObject({ ok: false, code: 'TEMP_NOT_PUSHED' });
  });

  it('冲突 pair 开单闸 CONFLICTS_UNRESOLVED，prepare 不抛', async () => {
    const { dir } = await createConflictRepo();
    const svc = await GitService.open(dir);
    await expect(svc.assertMrOpenable({ into: 'main', from: 'feature' })).rejects.toMatchObject({
      code: 'CONFLICTS_UNRESOLVED'
    });
    const prep = await svc.prepareMr({ into: 'main', from: 'feature' });
    expect(prep.mergeGate).toMatchObject({ ok: false, code: 'CONFLICTS_UNRESOLVED' });
    expect(prep.sourceBranch).toBe('feature');
  });
});

describe('工作区 merge 收尾', () => {
  beforeEach(() => cleanupTmp());
  afterAll(() => cleanupTmp());

  it('冲突后 operation=merge，选边 continue 结束', async () => {
    const { dir } = await createConflictRepo();
    const svc = await GitService.open(dir);
    await expect(svc.merge('feature')).rejects.toThrow(/冲突/);
    expect((await svc.getStatus()).operation).toBe('merge');
    const listed = await svc.listWorkspaceConflicts();
    expect(listed.operation).toBe('merge');
    expect(listed.files.some((f) => f.path === 'a.txt')).toBe(true);
    await svc.mergeContinue({ files: [{ path: 'a.txt', resolvedContent: 'resolved\n' }] });
    expect((await svc.getStatus()).operation).toBe('none');
    expect(fs.readFileSync(path.join(dir, 'a.txt'), 'utf8')).toBe('resolved\n');
  });

  it('mergeAbort 清掉工作区 merge', async () => {
    const { dir } = await createConflictRepo();
    const svc = await GitService.open(dir);
    await expect(svc.merge('feature')).rejects.toThrow(/冲突/);
    await svc.mergeAbort();
    expect((await svc.getStatus()).operation).toBe('none');
    expect(fs.readFileSync(path.join(dir, 'a.txt'), 'utf8').replace(/\r\n/g, '\n')).toBe('ours\n');
  });
});
