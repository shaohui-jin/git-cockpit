import { getCapabilityRegistry } from './capabilities/registry.ts';
import { PermissionError } from './types.ts';
import type { GitCockpitConfig, PermissionsConfig, RiskLevel } from './types.ts';

/**
 * 未注册 Capability 时的回退目录（core 单测不加载 mcp-server）。
 * 已注册则以 registry.risk 为准，避免加工具时再改本表。
 */
export function resolveToolRisk(toolName: string): RiskLevel {
  return getCapabilityRegistry().get(toolName)?.risk ?? TOOL_RISK_LEVELS[toolName] ?? 'write';
}

/** 内置工具目录：工具名 -> 风险等级 */
export const TOOL_RISK_LEVELS: Record<string, RiskLevel> = {
  // 只读工具（默认开放）
  git_status: 'readonly',
  git_log: 'readonly',
  git_diff: 'readonly',
  git_show: 'readonly',
  git_branch_list: 'readonly',
  git_tag_list: 'readonly',
  git_remote_list: 'readonly',
  git_file_content: 'readonly',
  git_graph: 'readonly',
  git_branch_graph: 'readonly',
  git_reflog: 'readonly',
  git_backup_list: 'readonly',
  git_stash_list: 'readonly',
  git_stash_show: 'readonly',
  git_merge_preview: 'readonly',
  git_merge_rehearse: 'readonly',
  git_merge_blame: 'readonly',
  git_merge_survey: 'readonly',
  git_merge_order: 'readonly',
  git_mr_prepare: 'readonly',
  git_repo_overview: 'readonly',
  git_job_list: 'readonly',
  git_job_get: 'readonly',
  git_worktree_list: 'readonly',
  // 写操作工具（默认开放，需预览/确认）
  git_add: 'write',
  git_unstage: 'write',
  git_commit: 'write',
  git_checkout: 'write',
  git_branch_create: 'write',
  git_branch_delete: 'write',
  git_merge: 'write',
  git_pull: 'write',
  git_fetch: 'write',
  git_push: 'write',
  git_merge_abort: 'write',
  git_merge_continue: 'write',
  git_rebase_abort: 'write',
  git_rebase_continue: 'write',
  git_cherry_pick: 'write',
  git_cherry_pick_abort: 'write',
  git_cherry_pick_continue: 'write',
  git_tag_create: 'write',
  git_stash: 'write',
  git_stash_apply: 'write',
  git_stash_drop: 'write',
  git_stash_pop: 'write',
  git_apply_resolve: 'write',
  git_mr_create: 'write',
  git_job_cancel: 'write',
  git_worktree_add: 'write',
  git_worktree_remove: 'write',
  // 高风险工具（默认禁用，需用户主动开启或审批）
  git_reset_hard: 'dangerous',
  git_clean: 'dangerous',
  git_push_force: 'dangerous',
  git_branch_delete_force: 'dangerous',
  git_rebase: 'dangerous'
};

export interface PermissionDecision {
  allowed: boolean;
  /** 拒绝时的人性化原因 */
  reason: string;
  /** true 表示高风险工具被禁用，界面可以带到设置里打开 */
  requiredApproval: boolean;
}

/**
 * 权限只有一份禁用名单。旧配置里的 requireApprovalFor 并进 disabledTools，不再单独生效。
 */
export function normalizePermissions(p: PermissionsConfig): PermissionsConfig {
  const disabled = [...new Set([...(p.disabledTools ?? []), ...(p.requireApprovalFor ?? [])])];
  return {
    disabledTools: disabled,
    requireApprovalFor: [],
    dryRunDefault: p.dryRunDefault ?? false
  };
}
export class PermissionManager {
  private readonly disabledTools: Set<string>;
  private readonly dryRunDefault: boolean;

  constructor(config: Pick<GitCockpitConfig, 'permissions'>) {
    const p = normalizePermissions(config.permissions);
    this.disabledTools = new Set(p.disabledTools);
    this.dryRunDefault = p.dryRunDefault;
  }

  getDryRunDefault(): boolean {
    return this.dryRunDefault;
  }

  evaluate(toolName: string): PermissionDecision {
    const risk = resolveToolRisk(toolName);
    if (this.disabledTools.has(toolName)) {
      return {
        allowed: false,
        // 高风险工具默认禁用，但可通过"开启 + 审批"放行
        reason: `工具 ${toolName} 已禁用。请到设置的 Git 操作里打开。`,
        requiredApproval: risk === 'dangerous'
      };
    }
    return { allowed: true, reason: '', requiredApproval: false };
  }

  /** 校验工具可用，不可用则抛出 PermissionError */
  assertAllowed(toolName: string): void {
    const d = this.evaluate(toolName);
    if (!d.allowed) {
      throw new PermissionError(d.reason, toolName, d.requiredApproval);
    }
  }

  /** 工具当前是否可用（未禁用） */
  isEnabled(toolName: string): boolean {
    return this.evaluate(toolName).allowed;
  }

  getRiskLevel(toolName: string): RiskLevel {
    return resolveToolRisk(toolName);
  }
}
