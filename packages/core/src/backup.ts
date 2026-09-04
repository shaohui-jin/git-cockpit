import { GitService } from './gitService.ts';

export interface BackupResult {
  /** 创建的 stash 引用（如 stash@{0}），无改动时为 null */
  stashRef: string | null;
  /** 创建的备份分支名 */
  branch: string | null;
  timestamp: number;
}

/**
 * 自动备份：在高风险不可逆操作（reset --hard、clean、force push、强制删分支、rebase）前调用。
 * - 若工作区存在未提交更改，自动 git stash -u（带时间戳）；
 * - 在 HEAD 处创建临时分支 backup/pre-op-{timestamp} 作为可回退点。
 */
export class BackupManager {
  constructor(private readonly git: GitService) {}

  async createBackup(): Promise<BackupResult> {
    const timestamp = Date.now();
    let stashRef: string | null = null;
    let branch: string | null = null;

    const status = await this.git.getStatus();
    if (!status.isClean || status.untracked.length > 0) {
      await this.git.stash(`git-cockpit backup ${timestamp}`, { includeUntracked: true });
      stashRef = 'stash@{0}';
    }

    // 备份分支指向当前 HEAD（即使没有 HEAD——空仓库——也允许创建）
    const branchName = `backup/pre-op-${timestamp}`;
    try {
      await this.git.createBranch(branchName);
      branch = branchName;
    } catch {
      // 空仓库无法创建分支等场景忽略
      branch = null;
    }

    return { stashRef, branch, timestamp };
  }

  /** 列出备份分支，以及说明里带 git-cockpit backup 的 stash */
  async listBackups(): Promise<{ branches: string[]; stashes: string[] }> {
    const { branches } = await this.git.listBranches();
    const backups = branches.filter((b) => !b.remote && b.name.includes('backup/pre-op-')).map((b) => b.name);
    const stashes = (await this.git.listStashes())
      .filter((s) => /git-cockpit backup/i.test(s.message))
      .map((s) => s.ref);
    return { branches: backups, stashes };
  }
}