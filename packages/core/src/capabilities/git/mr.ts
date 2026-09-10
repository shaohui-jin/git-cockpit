import { createPullOrMergeRequest, enrichPrepareMr } from '../../mr.ts';
import type { Capability } from '../types.ts';
import * as S from '../schemas.ts';

type Args = Record<string, unknown> & { repoPath?: string; dryRun?: boolean };

export const mrCapabilities: Capability[] = [
  {
    name: 'git_mr_prepare',
    description:
      '只读：解析开 PR/MR 的源/目标、浏览器创建页、本机 gh/glab 是否可用（找不到会带官方安装地址）、可选审核人列表。Token 不进参数。into/from 同 git_merge_preview。',
    risk: 'readonly',
    schema: S.GitMrPrepareSchema,
    handler: async (args: Args, ctx) => {
      const mr = ctx.host.config.mr;
      const prep = await ctx.git.prepareMr({
        into: args.into as string,
        from: args.from as string,
        remote: (args.remote as string | undefined)?.trim() || undefined,
        sourceBranch: args.sourceBranch as string | undefined
      });
      return enrichPrepareMr({ prep, mr, cwd: ctx.git.repoPath });
    }
  },
  {
    name: 'git_mr_create',
    description:
      '按设置 MR 配置开 PR/MR：Token REST、本机 gh/glab，或浏览器创建页。Token 不进本工具参数。找不到 CLI 时结果里带官方安装地址。dry_run 可预览。',
    risk: 'write',
    schema: S.GitMrCreateSchema,
    handler: async (args: Args, ctx) => {
      const mr = ctx.host.config.mr;
      const prep = await ctx.git.prepareMr({
        into: args.into as string,
        from: args.from as string,
        remote: (args.remote as string | undefined)?.trim() || undefined,
        sourceBranch: args.sourceBranch as string | undefined
      });
      return createPullOrMergeRequest({
        prep,
        mr,
        cwd: ctx.git.repoPath,
        title: args.title as string | undefined,
        body: args.body as string | undefined,
        reviewers: args.reviewers as string[] | undefined,
        dryRun: args.dryRun as boolean | undefined
      });
    }
  }
];
