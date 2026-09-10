import { GitOperationError } from '../../types.ts';
import type { Capability } from '../types.ts';
import * as S from '../schemas.ts';

type Args = Record<string, unknown> & { repoPath?: string; dryRun?: boolean };

export const jobsCapabilities: Capability[] = [
  {
    name: 'git_repo_overview',
    description:
      '已打开仓库脉搏：分支、脏文件数、ahead/behind、工作区 operation、本地 merge/* 数、近 12 周提交总数。默认不含每日格子；detail=true 才回 activity[]。不回 diff。',
    risk: 'readonly',
    needsRepo: false,
    schema: S.GitRepoOverviewSchema,
    handler: async (_args: Args, ctx) => ({ repos: await ctx.host.listOverviews() })
  },
  {
    name: 'git_job_list',
    description: '列出后台任务摘要（克隆 / survey / fetch）。',
    risk: 'readonly',
    needsRepo: false,
    schema: S.GitJobListSchema,
    handler: async (_args: Args, ctx) => ({ jobs: ctx.host.jobs.list().map((j) => ctx.host.jobs.summary(j)) })
  },
  {
    name: 'git_job_get',
    description: '查看一条后台任务（日志 + 完成时的 result 摘要）。',
    risk: 'readonly',
    needsRepo: false,
    schema: S.GitJobGetSchema,
    handler: async (args: Args, ctx) => {
      const job = ctx.host.jobs.get(args.id as string);
      if (!job) throw new GitOperationError('任务不存在', 'JOB_NOT_FOUND');
      return ctx.host.jobs.detail(job);
    }
  },
  {
    name: 'git_job_cancel',
    description: '取消进行中的后台任务。克隆会杀进程并删除不完整目录。',
    risk: 'write',
    needsRepo: false,
    schema: S.GitJobCancelSchema,
    handler: async (args: Args, ctx) => {
      if (args.dryRun) {
        return {
          dryRun: true,
          command: 'job cancel',
          args: [args.id],
          risk: 'low',
          note: '将取消进行中的后台任务'
        };
      }
      return ctx.host.jobs.summary(ctx.host.jobs.cancel(args.id as string));
    }
  }
];
