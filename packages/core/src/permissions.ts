import { PermissionError } from './types.ts';
import type { GitCockpitConfig, RiskLevel } from './types.ts';

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
  git_stash_list: 'readonly',
  git_stash_show: 'readonly',
  git_merge_preview: 'readonly',
  git_merge_rehearse: 'readonly',
  git_mr_prepare: 'readonly',
  // 写操作工具（默认开放，需预览/确认）
  git_add: 'write',
  git_unstage: 'write',
  git_commit: 'write',
  git_checkout: 'write',
  git_branch_create: 'write',
  git_branch_delete: 'write',
  git_merge: 'write',
  git_pull: 'write',
  git_push: 'write',
  git_tag_create: 'write',
  git_stash: 'write',
  git_stash_apply: 'write',
  git_stash_drop: 'write',
  git_stash_pop: 'write',
  git_apply_resolve: 'write',
  git_mr_create: 'write',
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
  /** true 表示该操作本可执行，但需等待人工审批 */
  requiredApproval: boolean;
}

/**
 * 权限控制层：
 * - disabledTools：工具被禁用，调用即报错，需在配置中开启；
 * - requireApprovalFor：工具需人工审批后方可执行（默认覆盖全部高风险工具）；
 * - 高风险工具且未禁用未审批还需额外预览确认。
 */
export class PermissionManager {
  private readonly disabledTools: Set<string>;
  private readonly requireApprovalFor: Set<string>;
  private readonly dryRunDefault: boolean;

  constructor(config: Pick<GitCockpitConfig, 'permissions'>) {
    const p = config.permissions;
    this.disabledTools = new Set(p.disabledTools ?? []);
    this.requireApprovalFor = new Set(p.requireApprovalFor ?? []);
    this.dryRunDefault = p.dryRunDefault ?? false;
  }

  getDryRunDefault(): boolean {
    return this.dryRunDefault;
  }

  evaluate(toolName: string): PermissionDecision {
    const risk = TOOL_RISK_LEVELS[toolName] ?? 'write';
    if (this.disabledTools.has(toolName)) {
      return {
        allowed: false,
        // 高风险工具默认禁用，但可通过"开启 + 审批"放行
        reason:
          risk === 'dangerous'
            ? `工具 ${toolName} 属于 ${risk} 风险操作，默认禁用。请在设置中开启并通过审批后执行。`
            : `工具 ${toolName} 已被禁用。请在配置文件的 permissions.disabledTools 中移除后重试。`,
        requiredApproval: risk === 'dangerous'
      };
    }
    if (this.requireApprovalFor.has(toolName)) {
      return {
        allowed: false,
        reason: `工具 ${toolName} 属于 ${risk} 风险操作，需要人工审批。请在配置中开启或先使用 dry_run 预览影响范围。`,
        requiredApproval: true
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

  /** 工具当前是否可用（未被禁用，且不需审批） */
  isEnabled(toolName: string): boolean {
    return this.evaluate(toolName).allowed;
  }

  getRiskLevel(toolName: string): RiskLevel {
    return TOOL_RISK_LEVELS[toolName] ?? 'write';
  }
}