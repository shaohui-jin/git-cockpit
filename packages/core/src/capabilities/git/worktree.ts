import { assertRepoAllowed } from '../../allowedRepos.ts';
import type { Capability } from '../types.ts';
import * as S from '../schemas.ts';

type Args = Record<string, unknown> & { repoPath?: string; dryRun?: boolean };

export const worktreeCapabilities: Capability[] = [
  {
    name: 'git_worktree_list',
    description:
      '列出本仓库的 git worktree（含主工作区）。只读。落盘用的临时 worktree 出现在列表里属正常。不要把 linked worktree 当成第二套工作区做 merge。',
    risk: 'readonly',
    schema: S.GitWorktreeListSchema,
    handler: async (_args: Args, ctx) => ({ worktrees: await ctx.git.listWorktrees() })
  },
  {
    name: 'git_worktree_add',
    description:
      '在独立目录添加 linked worktree（git worktree add）。不切换主工作区。路径须绝对路径且不在主工作区内；非空 allowedRepos 时须落在白名单下。不要在新 worktree 里做 merge 冒充预演。',
    risk: 'write',
    schema: S.GitWorktreeAddSchema,
    handler: async (args: Args, ctx) => {
      const dest = args.path as string;
      assertRepoAllowed(dest, ctx.host.config.git.allowedRepos);
      return ctx.git.addWorktree(dest, {
        dryRun: args.dryRun as boolean | undefined,
        startPoint: args.startPoint as string | undefined,
        branch: args.branch as string | undefined
      });
    }
  },
  {
    name: 'git_worktree_remove',
    description:
      '移除 linked worktree（git worktree remove）。不能移除主工作区。force 可在工作区不干净时强制。',
    risk: 'write',
    schema: S.GitWorktreeRemoveSchema,
    handler: async (args: Args, ctx) =>
      ctx.git.removeWorktree(args.path as string, {
        dryRun: args.dryRun as boolean | undefined,
        force: args.force as boolean | undefined
      })
  }
];
