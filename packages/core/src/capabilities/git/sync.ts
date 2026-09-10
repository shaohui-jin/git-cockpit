import type { Capability } from '../types.ts';
import * as S from '../schemas.ts';

type Args = Record<string, unknown> & { repoPath?: string; dryRun?: boolean };

export const syncCapabilities: Capability[] = [
  {
    name: 'git_pull',
    description: '从远程拉取并合并（非强制）。远程有冲突将提示。支持 dry_run 预览。',
    risk: 'write',
    schema: S.GitPullSchema,
    handler: async (args: Args, ctx) =>
      ctx.git.pull({
        dryRun: args.dryRun as boolean | undefined,
        remote: args.remote as string | undefined,
        branch: args.branch as string | undefined
      })
  },
  {
    name: 'git_fetch',
    description:
      '从远程抓取跟踪分支（git fetch --prune --no-tags），不改工作区、不合并。更新 origin/xxx 后再做预演或分支图对比。支持 dry_run 预览。',
    risk: 'write',
    schema: S.GitFetchSchema,
    handler: async (args: Args, ctx) =>
      ctx.git.fetch({
        dryRun: args.dryRun as boolean | undefined,
        remote: args.remote as string | undefined
      })
  },
  {
    name: 'git_push',
    description: '推送到远程（非强制）。推送被拒绝（远程有新提交）会给出提示。支持 dry_run 预览。',
    risk: 'write',
    schema: S.GitPushSchema,
    handler: async (args: Args, ctx) =>
      ctx.git.push({
        dryRun: args.dryRun as boolean | undefined,
        remote: args.remote as string | undefined,
        branch: args.branch as string | undefined
      })
  },
  {
    name: 'git_push_force',
    description: '以 --force-with-lease 强制推送（覆盖远程历史，高风险，执行前自动备份）。',
    risk: 'dangerous',
    schema: S.GitPushForceSchema,
    handler: async (args: Args, ctx) =>
      ctx.git.pushForce({
        dryRun: args.dryRun as boolean | undefined,
        remote: args.remote as string | undefined,
        branch: args.branch as string | undefined
      })
  }
];
