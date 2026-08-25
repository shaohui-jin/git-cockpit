import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, PermissionError, PermissionManager } from '../src/index.js';
import type { GitCockpitConfig } from '../src/index.js';

function makeConfig(overrides: Partial<GitCockpitConfig['permissions']> = {}): GitCockpitConfig {
  return {
    ...DEFAULT_CONFIG,
    permissions: {
      ...DEFAULT_CONFIG.permissions,
      ...overrides
    }
  };
}

describe('PermissionManager', () => {
  it('只读工具默认开放', () => {
    const pm = new PermissionManager(makeConfig());
    expect(pm.evaluate('git_status').allowed).toBe(true);
    expect(pm.evaluate('git_log').allowed).toBe(true);
    expect(pm.evaluate('git_diff').allowed).toBe(true);
  });

  it('普通写操作默认开放', () => {
    const pm = new PermissionManager(makeConfig());
    expect(pm.evaluate('git_add').allowed).toBe(true);
    expect(pm.evaluate('git_commit').allowed).toBe(true);
  });

  it('高风险工具默认禁用', () => {
    const pm = new PermissionManager(makeConfig());
    for (const tool of ['git_reset_hard', 'git_clean', 'git_push_force', 'git_branch_delete_force', 'git_rebase']) {
      const d = pm.evaluate(tool);
      expect(d.allowed, tool).toBe(false);
      expect(d.requiredApproval).toBe(true);
    }
  });

  it('disabledTools 禁用后 assertion 抛 PermissionError', () => {
    const pm = new PermissionManager(
      makeConfig({ disabledTools: ['git_commit', ...DEFAULT_CONFIG.permissions.disabledTools] })
    );
    expect(() => pm.assertAllowed('git_commit')).toThrow(PermissionError);
  });

  it('从禁用列表移除高风险工具后需要审批', () => {
    const pm = new PermissionManager(
      makeConfig({
        disabledTools: [],
        requireApprovalFor: ['git_reset_hard']
      })
    );
    expect(pm.evaluate('git_reset_hard').requiredApproval).toBe(true);
    expect(pm.evaluate('git_clean').allowed).toBe(true); // 未禁用也未要求审批
  });

  it('未知工具按 write 风险处理', () => {
    const pm = new PermissionManager(makeConfig());
    expect(pm.getRiskLevel('unknown_tool')).toBe('write');
  });

  it('dryRunDefault 透传', () => {
    expect(new PermissionManager(makeConfig({ dryRunDefault: true })).getDryRunDefault()).toBe(true);
    expect(new PermissionManager(makeConfig({ dryRunDefault: false })).getDryRunDefault()).toBe(false);
  });
});