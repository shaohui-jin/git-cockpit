import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { BackupManager, GitService } from '../src/index.ts';
import { cleanupTmp, createSampleRepo } from './helpers.ts';

describe('BackupManager 自动备份', () => {
  let dir: string;
  let svc: GitService;

  beforeEach(async () => {
    cleanupTmp();
    ({ dir } = await createSampleRepo());
    svc = await GitService.open(dir);
  });

  afterAll(() => cleanupTmp());

  it('干净工作区时仅创建备份分支', async () => {
    const backup = new BackupManager(svc);
    const result = await backup.createBackup();
    expect(result.branch).toMatch(/^backup\/pre-op-\d+$/);
    expect(result.stashRef).toBeNull();

    const { branches } = await svc.listBranches();
    expect(branches.some((b) => b.name === result.branch)).toBe(true);
  });

  it('存在未提交改动时同时 stash 并创建备份分支', async () => {
    fs.writeFileSync(path.join(dir, 'a.txt'), 'dirty\n');
    const backup = new BackupManager(svc);
    const result = await backup.createBackup();
    expect(result.stashRef).toBe('stash@{0}');

    // 工作区已被 stash，变得干净
    const status = await svc.getStatus();
    expect(status.isClean).toBe(true);

    // 恢复
    await svc.stashPop();
  });

  it('listBackups 能列出备份分支', async () => {
    const backup = new BackupManager(svc);
    await backup.createBackup();
    const list = await backup.listBackups();
    expect(list.branches.length).toBeGreaterThanOrEqual(1);
    expect(list.branches[0]).toMatch(/^backup\/pre-op-/);
  });

  it('高危操作前备份后可 hard reset 恢复', async () => {
    const logsBefore = await svc.getLog({ maxCount: 1 });
    const backup = new BackupManager(svc);
    await backup.createBackup();

    // 破坏性操作
    await svc.resetHard(logsBefore[0]!.hash);
    const logsAfter = await svc.getLog({ maxCount: 1 });
    expect(logsAfter[0]!.hash).toBe(logsBefore[0]!.hash);
  });
});