import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { GitOperationError, GitService } from '../src/index.ts';
import { commitFile, initRepo, makeTmpDir, cleanupTmp } from './helpers.ts';

describe('cherry-pick', () => {
  beforeEach(() => cleanupTmp());
  afterAll(() => cleanupTmp());

  it('拣一个不在当前分支上的提交，冲突则标成 cherry-pick', async () => {
    const dir = makeTmpDir('pick-');
    const git = await initRepo(dir);
    await commitFile(git, dir, 'a.txt', 'base\n', 'init');
    await git.checkoutLocalBranch('side');
    await commitFile(git, dir, 'a.txt', 'side\n', 'side edit');
    const side = (await git.revparse(['HEAD'])).trim();
    await git.checkout('main');
    await commitFile(git, dir, 'a.txt', 'main\n', 'main edit');
    const svc = await GitService.open(dir);
    await expect(svc.cherryPick(side)).rejects.toMatchObject({ code: 'CHERRY_PICK_CONFLICT' });
    expect(await svc.detectWorkspaceOperation()).toBe('cherry-pick');
    const conflicts = await svc.listWorkspaceConflicts();
    expect(conflicts.operation).toBe('cherry-pick');
    expect(conflicts.files.length).toBeGreaterThan(0);
    await svc.abortCherryPick();
    expect(await svc.detectWorkspaceOperation()).toBe('none');
  });

  it('已经在当前分支上的提交不再拣', async () => {
    const dir = makeTmpDir('pick-anc-');
    const git = await initRepo(dir);
    await commitFile(git, dir, 'a.txt', 'base\n', 'init');
    const head = (await git.revparse(['HEAD'])).trim();
    const svc = await GitService.open(dir);
    await expect(svc.cherryPick(head)).rejects.toBeInstanceOf(GitOperationError);
    await expect(svc.cherryPick(head)).rejects.toMatchObject({ code: 'ALREADY_CONTAINED' });
  });
});
