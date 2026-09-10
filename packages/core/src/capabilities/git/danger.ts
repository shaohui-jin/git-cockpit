import type { Capability } from '../types.ts';
import * as S from '../schemas.ts';

type Args = Record<string, unknown> & { repoPath?: string; dryRun?: boolean };

export const dangerCapabilities: Capability[] = [
  {
    name: 'git_reset_hard',
    description: '硬重置到指定提交（丢弃索引与工作区更改，高风险不可逆，执行前自动备份）。',
    risk: 'dangerous',
    schema: S.GitResetHardSchema,
    handler: async (args: Args, ctx) =>
      ctx.git.resetHard(args.target as string, { dryRun: args.dryRun as boolean | undefined })
  },
  {
    name: 'git_clean',
    description: '清理（删除）所有未跟踪文件与目录（高风险不可逆，执行前自动备份）。支持 dry_run 预览。',
    risk: 'dangerous',
    schema: S.GitCleanSchema,
    handler: async (args: Args, ctx) => ctx.git.clean({ dryRun: args.dryRun as boolean | undefined })
  },
  {
    name: 'git_branch_delete_force',
    description: '强制删除分支（-D，不检查合并状态，高风险）。支持 dry_run 预览。',
    risk: 'dangerous',
    schema: S.GitBranchDeleteForceSchema,
    handler: async (args: Args, ctx) =>
      ctx.git.deleteBranchForce(args.name as string, { dryRun: args.dryRun as boolean | undefined })
  }
];
