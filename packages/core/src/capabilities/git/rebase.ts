import type { Capability } from '../types.ts';
import * as S from '../schemas.ts';

type Args = Record<string, unknown> & { repoPath?: string; dryRun?: boolean };

export const rebaseCapabilities: Capability[] = [
  {
    name: 'git_rebase',
    description: '把当前分支变基到指定分支（重写提交历史，高风险）。产生冲突时停止，Agent 不要选边。',
    risk: 'dangerous',
    schema: S.GitRebaseSchema,
    handler: async (args: Args, ctx) =>
      ctx.git.rebase(args.branch as string, { dryRun: args.dryRun as boolean | undefined })
  },
  {
    name: 'git_rebase_abort',
    description: '中止当前工作区 rebase（git rebase --abort）。只用于已经开始的变基。',
    risk: 'write',
    schema: S.GitRebaseAbortSchema,
    handler: async (args: Args, ctx) => ctx.git.rebaseAbort({ dryRun: args.dryRun as boolean | undefined })
  },
  {
    name: 'git_rebase_continue',
    description: '继续当前工作区 rebase。冲突须人先在编辑器或网页解决；Agent 不要传 files / resolvedContent。',
    risk: 'write',
    schema: S.GitRebaseContinueSchema,
    handler: async (args: Args, ctx) =>
      ctx.git.rebaseContinue({
        dryRun: args.dryRun as boolean | undefined,
        files: args.files as { path: string; resolvedContent: string }[] | undefined
      })
  }
];
