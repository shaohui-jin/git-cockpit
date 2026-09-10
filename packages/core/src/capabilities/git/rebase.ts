import type { Capability } from '../types.ts';
import * as S from '../schemas.ts';

type Args = Record<string, unknown> & { repoPath?: string; dryRun?: boolean };

export const rebaseCapabilities: Capability[] = [
  {
    name: 'git_rebase',
    description: '把当前分支变基到指定分支（重写提交历史，高风险，产生冲突需手动解决后 git rebase --continue）。',
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
    description: '继续当前工作区 rebase。可把 files 写入工作区并 git add 后再 continue。冲突须先解决。',
    risk: 'write',
    schema: S.GitRebaseContinueSchema,
    handler: async (args: Args, ctx) =>
      ctx.git.rebaseContinue({
        dryRun: args.dryRun as boolean | undefined,
        files: args.files as { path: string; resolvedContent: string }[] | undefined
      })
  }
];
