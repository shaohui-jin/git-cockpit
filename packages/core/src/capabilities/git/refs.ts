import type { Capability } from '../types.ts';
import * as S from '../schemas.ts';

type Args = Record<string, unknown> & { repoPath?: string; dryRun?: boolean };

export const refsCapabilities: Capability[] = [
  {
    name: 'git_branch_list',
    description: '列出所有本地与远程分支，标注当前分支及其指向的提交。',
    risk: 'readonly',
    schema: S.GitBranchListSchema,
    handler: async (_args: Args, ctx) => ctx.git.listBranches()
  },
  {
    name: 'git_tag_list',
    description: '列出所有标签（按创建时间倒序）。',
    risk: 'readonly',
    schema: S.GitTagListSchema,
    handler: async (_args: Args, ctx) => ctx.git.listTags()
  },
  {
    name: 'git_remote_list',
    description: '列出远程仓库信息（名称、fetch/push URL）。',
    risk: 'readonly',
    schema: S.GitRemoteListSchema,
    handler: async (_args: Args, ctx) => ctx.git.listRemotes()
  },
  {
    name: 'git_checkout',
    description: '切换到指定分支。newBranch 给出时从起点新建并检出本地分支（远程起点会跟踪）。本地更改会被覆盖时拒绝。',
    risk: 'write',
    schema: S.GitCheckoutSchema,
    handler: async (args: Args, ctx) =>
      ctx.git.checkoutBranch(args.branch as string, {
        dryRun: args.dryRun as boolean | undefined,
        newBranch: args.newBranch as string | undefined
      })
  },
  {
    name: 'git_branch_create',
    description: '创建新分支（默认从当前 HEAD；startPoint 可指定起点）。支持 dry_run 预览。',
    risk: 'write',
    schema: S.GitBranchCreateSchema,
    handler: async (args: Args, ctx) =>
      ctx.git.createBranch(args.name as string, {
        dryRun: args.dryRun as boolean | undefined,
        startPoint: args.startPoint as string | undefined
      })
  },
  {
    name: 'git_branch_delete',
    description: '安全删除分支（-d，未合并分支会拒绝）。支持 dry_run 预览。',
    risk: 'write',
    schema: S.GitBranchDeleteSchema,
    handler: async (args: Args, ctx) =>
      ctx.git.deleteBranch(args.name as string, { dryRun: args.dryRun as boolean | undefined })
  },
  {
    name: 'git_tag_create',
    description: '创建标签；提供 message 则创建附注标签。支持 dry_run 预览。',
    risk: 'write',
    schema: S.GitTagCreateSchema,
    handler: async (args: Args, ctx) =>
      ctx.git.createTag(args.name as string, {
        dryRun: args.dryRun as boolean | undefined,
        message: args.message as string | undefined,
        commit: args.commit as string | undefined
      })
  }
];
