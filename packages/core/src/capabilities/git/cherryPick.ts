import type { Capability } from '../types.ts';
import * as S from '../schemas.ts';

type Args = Record<string, unknown> & { repoPath?: string; dryRun?: boolean };

export const cherryPickCapabilities: Capability[] = [
  {
    name: 'git_cherry_pick',
    description: '把一个提交拣到当前分支。一次一个。冲突留在工作区，去网页三栏选边。',
    risk: 'write',
    schema: S.GitCherryPickSchema,
    handler: async (args: Args, ctx) => {
      if (args.dryRun) {
        return {
          dryRun: true,
          command: `git cherry-pick ${args.commit}`,
          summary: `拣选 ${args.commit} 到当前分支`
        };
      }
      return ctx.git.cherryPick(String(args.commit));
    }
  },
  {
    name: 'git_cherry_pick_continue',
    description: '拣选冲突解决后继续。冲突在网页三栏选边。Agent 不要传 files。',
    risk: 'write',
    schema: S.GitCherryPickContinueSchema,
    handler: async (args: Args, ctx) => {
      if (args.dryRun) {
        return { dryRun: true, command: 'git cherry-pick --continue', summary: '继续拣选' };
      }
      return ctx.git.continueCherryPick(args.files as { path: string; resolvedContent: string }[] | undefined);
    }
  },
  {
    name: 'git_cherry_pick_abort',
    description: '放弃进行中的拣选，工作区回到拣选前。',
    risk: 'write',
    schema: S.GitCherryPickAbortSchema,
    handler: async (args: Args, ctx) => {
      if (args.dryRun) {
        return { dryRun: true, command: 'git cherry-pick --abort', summary: '放弃拣选' };
      }
      return ctx.git.abortCherryPick();
    }
  }
];
