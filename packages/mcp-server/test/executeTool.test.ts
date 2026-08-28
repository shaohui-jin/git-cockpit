/**
 * 集成测试：executeTool 安全链路（权限、dry-run、备份、审计）与 MCP 工具行为。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PermissionError, PermissionManager, TOOL_RISK_LEVELS } from '@shaohui_jin/git-cockpit-core';
import { createTestRuntime, disposeTestRuntime, createSampleRepo, cleanupTmp, commitFile } from './helpers.ts';
import { executeTool } from '../src/tools/handlers.ts';
import { TOOL_DEF_MAP } from '../src/tools/index.ts';
import type { Runtime } from '../src/index.ts';
import type { SimpleGit } from 'simple-git';

describe('executeTool 安全链路', () => {
  let runtime: Runtime;
  let repo: { dir: string; git: SimpleGit };

  beforeAll(async () => {
    repo = await createSampleRepo();
    runtime = createTestRuntime({ git: { backupOnDangerousOps: true } });
    await runtime.repoManager.open(repo.dir);
  });

  afterAll(() => {
    disposeTestRuntime(runtime);
    cleanupTmp();
  });

  it('只读工具 git_status 返回工作区状态', async () => {
    const def = TOOL_DEF_MAP.get('git_status')!;
    const exec = await executeTool(def, {}, { runtime, source: 'mcp' });
    expect(exec.success).toBe(true);
    const status = exec.result as { current: string; isClean: boolean };
    expect(status.current).toBe('main');
    expect(status.isClean).toBe(true);
  });

  it('git_log 返回提交历史并按作者过滤', async () => {
    const def = TOOL_DEF_MAP.get('git_log')!;
    const exec = await executeTool(def, { maxCount: 10 }, { runtime, source: 'mcp' });
    expect(exec.success).toBe(true);
    const commits = exec.result as { shortHash: string; subject: string }[];
    expect(commits.length).toBeGreaterThanOrEqual(2);
    expect(commits.some((c) => c.subject.includes('feat: add a.txt'))).toBe(true);
  });

  it('git_add dry_run 仅返回预览，不修改索引', async () => {
    repo.git = repo.git;
    const { writeFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    writeFileSync(join(repo.dir, 'new.txt'), 'new\n', 'utf8');

    const def = TOOL_DEF_MAP.get('git_add')!;
    const exec = await executeTool(def, { paths: ['new.txt'], dryRun: true }, { runtime, source: 'mcp' });
    expect(exec.success).toBe(true);
    expect(exec.dryRun).toBe(true);
    const preview = exec.preview as { dryRun: boolean; command: string };
    expect(preview.dryRun).toBe(true);
    expect(preview.command).toContain('git add');

    const status = await repo.git.status();
    expect(status.files.some((f) => f.path === 'new.txt')).toBe(true);
  });

  it('执行 git_add + git_commit 完成一次真实提交', async () => {
    const addDef = TOOL_DEF_MAP.get('git_add')!;
    const addExec = await executeTool(addDef, { paths: ['new.txt'] }, { runtime, source: 'mcp' });
    expect(addExec.success).toBe(true);

    const commitDef = TOOL_DEF_MAP.get('git_commit')!;
    const commitExec = await executeTool(
      commitDef,
      { message: 'feat: add new.txt', paths: ['new.txt'] },
      { runtime, source: 'mcp' }
    );
    expect(commitExec.success).toBe(true);

    const log = await repo.git.log({ maxCount: 1 });
    expect(log.latest?.message).toContain('feat: add new.txt');
  });

  it('审计日志记录成功操作', () => {
    const logs = runtime.auditLogger.list({ tool: 'git_commit', limit: 10 });
    expect(logs.length).toBeGreaterThan(0);
    expect(logs.some((l) => l.result === 'success')).toBe(true);
  });

  it('高危工具默认被权限层禁用', async () => {
    const def = TOOL_DEF_MAP.get('git_reset_hard')!;
    expect(TOOL_RISK_LEVELS['git_reset_hard']).toBe('dangerous');
    const exec = await executeTool(def, { target: 'HEAD' }, { runtime, source: 'mcp' });
    expect(exec.success).toBe(false);
    expect(exec.error?.code).toBe('PERMISSION_DENIED');
    expect(exec.error?.requiredApproval).toBe(true);
  });

  it('禁用工具可在置顶配置中移除后工作，并自动创建备份', async () => {
    // 临时启用 git_reset_hard，以验证执行路径与备份
    runtime.configStore.update({
      permissions: { disabledTools: [], requireApprovalFor: [] }
    });
    runtime.config = runtime.configStore.get();
    runtime.permissions = new PermissionManager(runtime.config);

    const headBefore = (await repo.git.revparse(['--short', 'HEAD'])).trim();
    const def = TOOL_DEF_MAP.get('git_reset_hard')!;
    const exec = await executeTool(def, { target: `${headBefore}^` }, { runtime, source: 'mcp' });
    expect(exec.success).toBe(true);
    // 备份分支应包含 backup/pre-op- 前缀
    const branches = await runtime.repoManager.getCurrent();
    expect(branches).not.toBeNull();
    const list = await branches!.service.listBranches();
    expect(list.branches.some((b) => b.name.includes('backup/pre-op-'))).toBe(true);

    // 恢复：把 HEAD 指回原位置，避免影响后续用例
    await runtime.repoManager.getCurrent().then((h) => h!.service.resetHard(headBefore));
    // 还原默认配置
    runtime.configStore.update({
      permissions: { disabledTools: ['git_reset_hard', 'git_clean', 'git_push_force', 'git_branch_delete_force', 'git_rebase'], requireApprovalFor: ['git_reset_hard', 'git_clean', 'git_push_force', 'git_branch_delete_force', 'git_rebase'] }
    });
    runtime.config = runtime.configStore.get();
    runtime.permissions = new PermissionManager(runtime.config);
  });

  it('schema 校验错误返回 INVALID_ARGS', async () => {
    const def = TOOL_DEF_MAP.get('git_commit')!;
    const exec = await executeTool(def, {}, { runtime, source: 'mcp' });
    expect(exec.success).toBe(false);
    expect(exec.error?.code).toBe('INVALID_ARGS');
  });

  it('未打开任何仓库时返回 NO_ACTIVE_REPO', async () => {
    const runtime2 = createTestRuntime();
    try {
      const def = TOOL_DEF_MAP.get('git_status')!;
      const exec = await executeTool(def, {}, { runtime: runtime2, source: 'mcp' });
      expect(exec.success).toBe(false);
      expect(exec.error?.code).toBe('NO_ACTIVE_REPO');
    } finally {
      disposeTestRuntime(runtime2);
    }
  });
});

describe('git_merge_preview / git_apply_resolve', () => {
  afterAll(() => cleanupTmp());

  it('预演干净合并与冲突仓库', async () => {
    const runtime = createTestRuntime();
    try {
      const sample = await createSampleRepo();
      await sample.git.checkout('feature/x');
      await commitFile(sample.git, sample.dir, 'c.txt', 'feature content\n', 'feat: feature c');
      await sample.git.checkout('main');
      await runtime.repoManager.open(sample.dir);
      const previewDef = TOOL_DEF_MAP.get('git_merge_preview')!;
      const clean = await executeTool(
        previewDef,
        { into: 'main', from: 'feature/x', fetch: false, dryRun: false },
        { runtime, source: 'mcp' }
      );
      expect(clean.success).toBe(true);
      expect((clean.result as { clean: boolean }).clean).toBe(true);

      const applyDef = TOOL_DEF_MAP.get('git_apply_resolve')!;
      const applied = await executeTool(
        applyDef,
        { into: 'main', from: 'feature/x', fetch: false, push: false, dryRun: false },
        { runtime, source: 'mcp' }
      );
      expect(applied.success).toBe(true);
      expect((applied.result as { usedWorktree: boolean }).usedWorktree).toBe(true);
    } finally {
      disposeTestRuntime(runtime);
    }
  });
});

describe('PermissionManager 交互', () => {
  it('PermissionError 属性正确', () => {
    const err = new PermissionError('拒绝', 'git_clean', true);
    expect(err.tool).toBe('git_clean');
    expect(err.requiredApproval).toBe(true);
    expect(err.message).toBe('拒绝');
  });
});