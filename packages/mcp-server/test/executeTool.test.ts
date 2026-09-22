/**
 * 集成测试：executeTool 安全链路（权限、dry-run、备份、审计）与 MCP 工具行为。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  PermissionError,
  PermissionManager,
  TOOL_RISK_LEVELS,
  getCapabilityRegistry,
  normalizeRepoMethodKey
} from '@shaohui_jin/git-cockpit-core';
import { createTestRuntime, disposeTestRuntime, createSampleRepo, cleanupTmp, commitFile } from './helpers.ts';
import { executeTool } from '../src/tools/handlers.ts';
import { TOOL_DEF_MAP, TOOL_DEFS } from '../src/tools/index.ts';
import type { Runtime } from '../src/index.ts';
import type { SimpleGit } from 'simple-git';

/** MCP 真写要先有一次相同参数的干跑票据。 */
async function mcpWrite(
  def: Parameters<typeof executeTool>[0],
  args: Record<string, unknown>,
  ctx: Parameters<typeof executeTool>[2]
) {
  if (args.dryRun !== true && def.risk !== 'readonly') {
    const preview = await executeTool(def, { ...args, dryRun: true }, ctx);
    if (!preview.success) return preview;
  }
  return executeTool(def, args, ctx);
}

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
    const addExec = await mcpWrite(addDef, { paths: ['new.txt'] }, { runtime, source: 'mcp' });
    expect(addExec.success).toBe(true);

    const commitDef = TOOL_DEF_MAP.get('git_commit')!;
    const commitExec = await mcpWrite(
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
    const exec = await mcpWrite(def, { target: `${headBefore}^` }, { runtime, source: 'mcp' });
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
      const exec = await mcpWrite(def, {}, { runtime: runtime2, source: 'mcp' });
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
      const applied = await mcpWrite(
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

  it('MCP 禁止带 files 选边', async () => {
    const runtime = createTestRuntime();
    try {
      const sample = await createSampleRepo();
      await runtime.repoManager.open(sample.dir);
      const applyDef = TOOL_DEF_MAP.get('git_apply_resolve')!;
      const exec = await mcpWrite(
        applyDef,
        {
          into: 'main',
          from: 'feature/x',
          files: [{ path: 'a.txt', resolvedContent: 'resolved\n' }],
          dryRun: true
        },
        { runtime, source: 'mcp' }
      );
      expect(exec.success).toBe(false);
      expect(exec.error?.code).toBe('AGENT_NO_RESOLVE');
    } finally {
      disposeTestRuntime(runtime);
    }
  });
});

describe('git_merge_survey / git_merge_order', () => {
  afterAll(() => cleanupTmp());

  it('矩阵与合入顺序均为只读且不改工作区', async () => {
    const runtime = createTestRuntime();
    try {
      const sample = await createSampleRepo();
      await runtime.repoManager.open(sample.dir);
      const surveyDef = TOOL_DEF_MAP.get('git_merge_survey')!;
      expect(TOOL_RISK_LEVELS['git_merge_survey']).toBe('readonly');
      const survey = await executeTool(
        surveyDef,
        { intos: ['main'], froms: ['feature/x', 'main'], fetch: false },
        { runtime, source: 'mcp' }
      );
      expect(survey.success).toBe(true);
      const cells = (survey.result as { cells: Array<{ from: string; outcome: string }> }).cells;
      expect(cells.find((c) => c.from === 'feature/x')?.outcome).toBe('clean');
      expect(cells.find((c) => c.from === 'main')?.outcome).toBe('same');

      const orderDef = TOOL_DEF_MAP.get('git_merge_order')!;
      expect(TOOL_RISK_LEVELS['git_merge_order']).toBe('readonly');
      expect(TOOL_RISK_LEVELS['git_merge_blame']).toBe('readonly');
      const order = await executeTool(
        orderDef,
        { into: 'main', branches: ['feature/x', 'main'], fetch: false },
        { runtime, source: 'mcp' }
      );
      expect(order.success).toBe(true);
      expect((order.result as { best: { cleanPrefix: number } }).best.cleanPrefix).toBeGreaterThanOrEqual(1);
    } finally {
      disposeTestRuntime(runtime);
    }
  });
});

function bindRepoMrMethod(runtime: Runtime, repoPath: string, method: 'token' | 'cli' | 'browser'): void {
  const mr = runtime.config.mr;
  runtime.configStore.update({
    mr: { ...mr, method, repoMethods: { ...mr.repoMethods, [normalizeRepoMethodKey(repoPath)]: method } }
  });
  runtime.config = runtime.configStore.get();
}

/** 让 feature/x 相对 main 有独有提交，否则档位是 already_merged，落不了盘 */
async function divergeFeature(sample: { dir: string; git: SimpleGit }): Promise<void> {
  await sample.git.checkout('feature/x');
  await commitFile(sample.git, sample.dir, 'c.txt', 'feature content\n', 'feat: feature c');
  await sample.git.checkout('main');
}

/** 落盘这对分支，并写一条 origin/ 跟踪引用，让档位变成 temp_remote（测试里不必真 push） */
async function landTempRemote(
  runtime: Runtime,
  sample: { dir: string; git: SimpleGit },
  into = 'main',
  from = 'feature/x'
): Promise<string> {
  await divergeFeature(sample);
  const applyDef = TOOL_DEF_MAP.get('git_apply_resolve')!;
  const applied = await mcpWrite(
    applyDef,
    { into, from, push: false, dryRun: false },
    { runtime, source: 'mcp' }
  );
  if (!applied.success) {
    throw new Error(applied.error?.message ?? 'git_apply_resolve 失败');
  }
  const temp = (applied.result as { tempBranch: string }).tempBranch;
  const sha = (await sample.git.revparse([temp])).trim();
  await sample.git.raw(['update-ref', `refs/remotes/origin/${temp}`, sha]);
  return temp;
}

describe('git_mr_prepare / git_mr_create', () => {
  afterAll(() => cleanupTmp());

  it('prepare 无远程时返回 unknown', async () => {
    const runtime = createTestRuntime();
    try {
      const sample = await createSampleRepo();
      await runtime.repoManager.open(sample.dir);
      const def = TOOL_DEF_MAP.get('git_mr_prepare')!;
      const exec = await mcpWrite(
        def,
        { into: 'main', from: 'feature/x', dryRun: false },
        { runtime, source: 'mcp' }
      );
      expect(exec.success).toBe(true);
      expect((exec.result as { platform: string; sourceBranch: string }).platform).toBe('unknown');
      expect((exec.result as { sourceBranch: string }).sourceBranch).toBe('feature/x');
      expect((exec.result as { mergeGate?: { ok: boolean; code: string } }).mergeGate).toMatchObject({
        ok: false,
        code: 'ALREADY_MERGED'
      });
    } finally {
      disposeTestRuntime(runtime);
    }
  });

  it('method=token 且未配 Token 时 create 失败', async () => {
    const runtime = createTestRuntime({ mr: { method: 'token' } });
    try {
      const sample = await createSampleRepo();
      await sample.git.addRemote('origin', 'https://github.com/acme/app.git');
      await runtime.repoManager.open(sample.dir);
      bindRepoMrMethod(runtime, sample.dir, 'token');
      await divergeFeature(sample);
      const def = TOOL_DEF_MAP.get('git_mr_create')!;
      const blocked = await executeTool(
        def,
        { into: 'main', from: 'feature/x', dryRun: true },
        { runtime, source: 'mcp' }
      );
      expect(blocked.success).toBe(false);
      expect(blocked.error?.code).toBe('NOT_LANDED');

      await landTempRemote(runtime, sample);
      const exec = await mcpWrite(
        def,
        { into: 'main', from: 'feature/x', dryRun: true },
        { runtime, source: 'mcp' }
      );
      expect(exec.success).toBe(false);
      expect(exec.error?.code).toBe('NO_TOKEN');
    } finally {
      disposeTestRuntime(runtime);
    }
  });

  it('启用正文规范时 create 缺 fields 失败；齐了 dry-run 带渲染正文', async () => {
    const runtime = createTestRuntime({
      mr: {
        template: {
          enabled: true,
          agentFill: 'allow',
          filename: 't.md',
          sourceMd: '',
          fields: [{ id: 'purpose', type: 'textarea', label: '变更目的', required: true }]
        }
      }
    });
    try {
      const sample = await createSampleRepo();
      await sample.git.addRemote('origin', 'https://github.com/acme/app.git');
      await runtime.repoManager.open(sample.dir);
      await landTempRemote(runtime, sample);
      const def = TOOL_DEF_MAP.get('git_mr_create')!;
      const missing = await executeTool(
        def,
        { into: 'main', from: 'feature/x', dryRun: true },
        { runtime, source: 'mcp' }
      );
      expect(missing.success).toBe(false);
      expect(missing.error?.code).toBe('TEMPLATE_INCOMPLETE');

      const ok = await executeTool(
        def,
        { into: 'main', from: 'feature/x', fields: { purpose: '说明原因' }, dryRun: true },
        { runtime, source: 'mcp' }
      );
      expect(ok.success).toBe(true);
      expect(String((ok.result as { body?: string }).body ?? '')).toContain('说明原因');
      expect(String((ok.result as { note?: string }).note ?? '')).toContain('建议改用 Token 或本机 CLI');

      const prepDef = TOOL_DEF_MAP.get('git_mr_prepare')!;
      const prep = await executeTool(
        prepDef,
        { into: 'main', from: 'feature/x' },
        { runtime, source: 'mcp' }
      );
      expect(prep.success).toBe(true);
      expect((prep.result as { template?: { enabled: boolean } }).template?.enabled).toBe(true);
      expect((prep.result as { method?: string }).method).toBe('browser');
    } finally {
      disposeTestRuntime(runtime);
    }
  });

  it('未启用规范时 create 不挡空 body', async () => {
    const runtime = createTestRuntime();
    try {
      const sample = await createSampleRepo();
      await sample.git.addRemote('origin', 'https://github.com/acme/app.git');
      await runtime.repoManager.open(sample.dir);
      await landTempRemote(runtime, sample);
      const def = TOOL_DEF_MAP.get('git_mr_create')!;
      const exec = await mcpWrite(
        def,
        { into: 'main', from: 'feature/x', dryRun: true },
        { runtime, source: 'mcp' }
      );
      expect(exec.success).toBe(true);
    } finally {
      disposeTestRuntime(runtime);
    }
  });

  it('auto 且未配 Token 时 dry-run 仍成功（回退浏览器或 CLI）', async () => {
    const runtime = createTestRuntime();
    try {
      const sample = await createSampleRepo();
      await sample.git.addRemote('origin', 'https://github.com/acme/app.git');
      await runtime.repoManager.open(sample.dir);
      await landTempRemote(runtime, sample);
      const def = TOOL_DEF_MAP.get('git_mr_create')!;
      const exec = await mcpWrite(
        def,
        { into: 'main', from: 'feature/x', dryRun: true },
        { runtime, source: 'mcp' }
      );
      expect(exec.success).toBe(true);
    } finally {
      disposeTestRuntime(runtime);
    }
  });

  it('GitHub Token 创建 PR（mock fetch）', async () => {
    const runtime = createTestRuntime({
      mr: {
        hosts: [{ host: 'github.com', platform: 'github', token: 'ghs_test', apiBaseUrl: '' }]
      }
    });
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async (input, init) => {
      expect(String(input)).toBe('https://api.github.com/repos/acme/app/pulls');
      expect(init?.method).toBe('POST');
      return new Response(JSON.stringify({ html_url: 'https://github.com/acme/app/pull/3', number: 3 }), {
        status: 201
      });
    }) as typeof fetch;
    try {
      const sample = await createSampleRepo();
      await sample.git.addRemote('origin', 'https://github.com/acme/app.git');
      await runtime.repoManager.open(sample.dir);
      bindRepoMrMethod(runtime, sample.dir, 'token');
      await landTempRemote(runtime, sample);
      const def = TOOL_DEF_MAP.get('git_mr_create')!;
      const exec = await mcpWrite(
        def,
        { into: 'main', from: 'feature/x', dryRun: false },
        { runtime, source: 'mcp' }
      );
      expect(exec.success).toBe(true);
      expect(exec.result).toMatchObject({ via: 'token', number: 3 });
    } finally {
      globalThis.fetch = origFetch;
      disposeTestRuntime(runtime);
    }
  });

  it('GitLab Token 创建 MR（mock fetch）', async () => {
    const runtime = createTestRuntime({
      mr: {
        hosts: [{ host: 'gitlab.com', platform: 'gitlab', token: 'glpat_test', apiBaseUrl: '' }]
      }
    });
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async (input, init) => {
      expect(String(input)).toBe('https://gitlab.com/api/v4/projects/acme%2Fapp/merge_requests');
      expect(init?.method).toBe('POST');
      return new Response(JSON.stringify({ web_url: 'https://gitlab.com/acme/app/-/merge_requests/2', iid: 2 }), {
        status: 201
      });
    }) as typeof fetch;
    try {
      const sample = await createSampleRepo();
      await sample.git.addRemote('origin', 'https://gitlab.com/acme/app.git');
      await runtime.repoManager.open(sample.dir);
      bindRepoMrMethod(runtime, sample.dir, 'token');
      await landTempRemote(runtime, sample);
      const def = TOOL_DEF_MAP.get('git_mr_create')!;
      const exec = await mcpWrite(
        def,
        { into: 'main', from: 'feature/x', dryRun: false },
        { runtime, source: 'mcp' }
      );
      expect(exec.success).toBe(true);
      expect(exec.result).toMatchObject({ via: 'token' });
      expect((exec.result as { url: string }).url).toContain('merge_requests/2');
    } finally {
      globalThis.fetch = origFetch;
      disposeTestRuntime(runtime);
    }
  });
});

describe('Capability registry', () => {
  it('TOOL_DEFS 风险与 TOOL_RISK_LEVELS / registry 一致', () => {
    const reg = getCapabilityRegistry();
    expect(reg.list().length).toBe(TOOL_DEFS.length);
    for (const def of TOOL_DEFS) {
      expect(TOOL_RISK_LEVELS[def.name], def.name).toBe(def.risk);
      expect(reg.get(def.name)?.risk, def.name).toBe(def.risk);
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