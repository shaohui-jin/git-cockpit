import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { DEFAULT_CONFIG, PermissionError, PermissionManager } from '../src/index.ts';
import { executeCapability } from '../src/capabilities/executor.ts';
import { TOOL_DEFS } from '../src/capabilities/git/index.ts';
import { getCapabilityRegistry } from '../src/capabilities/registry.ts';
import type { Capability, CapabilityHost, ExecutionResult } from '../src/capabilities/types.ts';
import type { GitCockpitConfig } from '../src/index.ts';
import type { JobEngine } from '../src/jobEngine.ts';
import type { GitService } from '../src/gitService.ts';

function makeConfig(overrides: Partial<GitCockpitConfig['permissions']> = {}): GitCockpitConfig {
  return {
    ...DEFAULT_CONFIG,
    permissions: {
      ...DEFAULT_CONFIG.permissions,
      ...overrides
    }
  };
}

function fakeHost(overrides: Partial<CapabilityHost> = {}): CapabilityHost {
  const logs: unknown[] = [];
  const events: unknown[] = [];
  const config = makeConfig();
  return {
    config,
    permissions: new PermissionManager(config),
    auditLogger: { log: (entry) => logs.push(entry) },
    eventBus: { emit: (...args) => events.push(args) },
    jobs: {} as JobEngine,
    resolveRepo: async () => ({ git: {} as GitService, repoPath: '/tmp/repo' }),
    listOverviews: async () => [],
    ...overrides
  };
}

const ping: Capability = {
  name: 'git_ping',
  description: 'ping',
  risk: 'readonly',
  needsRepo: false,
  schema: z.object({ n: z.number().optional() }),
  handler: async (args) => ({ pong: args.n ?? 1 })
};

afterEach(() => {
  getCapabilityRegistry().reset();
});

describe('CapabilityRegistry', () => {
  it('register 后 list/get/riskLevels 一致', () => {
    const reg = getCapabilityRegistry();
    reg.register(ping);
    expect(reg.get('git_ping')?.risk).toBe('readonly');
    expect(reg.list().map((c) => c.name)).toEqual(['git_ping']);
    expect(reg.riskLevels()).toEqual({ git_ping: 'readonly' });
  });

  it('PermissionManager 优先用 registry 风险', () => {
    getCapabilityRegistry().register({
      ...ping,
      name: 'git_custom_cap',
      risk: 'dangerous'
    });
    const pm = new PermissionManager(makeConfig({ disabledTools: [], requireApprovalFor: [] }));
    expect(pm.getRiskLevel('git_custom_cap')).toBe('dangerous');
    expect(pm.getRiskLevel('git_status')).toBe('readonly');
  });
});

describe('executeCapability', () => {
  it('成功走完权限、zod、审计', async () => {
    const logs: Array<{ result: string; tool: string }> = [];
    const host = fakeHost({
      auditLogger: { log: (entry) => logs.push({ result: entry.result, tool: entry.tool }) }
    });
    const exec: ExecutionResult = await executeCapability(ping, { n: 3 }, { source: 'mcp', host });
    expect(exec.success).toBe(true);
    expect(exec.result).toEqual({ pong: 3 });
    expect(logs).toEqual([{ result: 'success', tool: 'git_ping' }]);
  });

  it('zod 失败不抛、记 error', async () => {
    const host = fakeHost();
    const exec = await executeCapability(ping, { n: 'x' }, { source: 'mcp', host });
    expect(exec.success).toBe(false);
    expect(exec.error?.code).toBe('INVALID_ARGS');
  });

  it('禁用工具记 denied', async () => {
    const config = makeConfig({ disabledTools: ['git_ping'] });
    const host = fakeHost({
      config,
      permissions: new PermissionManager(config)
    });
    const exec = await executeCapability(ping, {}, { source: 'mcp', host });
    expect(exec.success).toBe(false);
    expect(exec.error?.code).toBe('PERMISSION_DENIED');
    expect(() => host.permissions.assertAllowed('git_ping')).toThrow(PermissionError);
  });

  it('needsRepo 时走 host.resolveRepo', async () => {
    let seen: unknown;
    const host = fakeHost({
      resolveRepo: async (input) => {
        seen = input;
        return { git: { repoPath: '/opened' } as GitService, repoPath: '/opened' };
      }
    });
    const cap: Capability = {
      name: 'git_need_repo',
      description: 'need',
      risk: 'readonly',
      schema: z.object({ repoPath: z.string().optional() }),
      handler: async (_args, ctx) => ({ repoPath: ctx.repoPath })
    };
    const exec = await executeCapability(cap, { repoPath: 'D:/x' }, { source: 'web', host, repoId: 7 });
    expect(exec.success).toBe(true);
    expect(exec.result).toEqual({ repoPath: '/opened' });
    expect(seen).toMatchObject({ repoId: 7, argsPath: 'D:/x' });
  });

  it('MCP 写操作要先干跑，网页不用', async () => {
    const write: Capability = {
      name: 'git_touch',
      description: 'touch',
      risk: 'write',
      needsRepo: false,
      schema: z.object({ n: z.number(), dryRun: z.boolean().optional() }),
      handler: async (args) => ({ n: args.n, dryRun: args.dryRun === true })
    };
    const host = fakeHost();
    const denied = await executeCapability(write, { n: 1, dryRun: false }, { source: 'mcp', host });
    expect(denied.error?.code).toBe('NEED_DRY_RUN');
    const preview = await executeCapability(write, { n: 1, dryRun: true }, { source: 'mcp', host });
    expect(preview.success).toBe(true);
    const ok = await executeCapability(write, { n: 1, dryRun: false }, { source: 'mcp', host });
    expect(ok.success).toBe(true);
    expect(ok.result).toEqual({ n: 1, dryRun: false });
    const spent = await executeCapability(write, { n: 1, dryRun: false }, { source: 'mcp', host });
    expect(spent.error?.code).toBe('NEED_DRY_RUN');
    const web = await executeCapability(write, { n: 2, dryRun: false }, { source: 'web', host });
    expect(web.success).toBe(true);
  });
});

describe('TOOL_DEFS 按域', () => {
  it('含 worktree 且无重名', () => {
    const names = TOOL_DEFS.map((d) => d.name);
    expect(names).toContain('git_worktree_list');
    expect(names).toContain('git_worktree_add');
    expect(names).toContain('git_cherry_pick');
    expect(names).toContain('git_cherry_pick_continue');
    expect(names).toContain('git_cherry_pick_abort');
    expect(new Set(names).size).toBe(names.length);
  });
});
