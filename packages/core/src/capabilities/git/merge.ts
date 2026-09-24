import { SURVEY_ASYNC_THRESHOLD } from '../../jobTypes.ts';
import type { Capability } from '../types.ts';
import * as S from '../schemas.ts';

type Args = Record<string, unknown> & { repoPath?: string; dryRun?: boolean };

export const mergeCapabilities: Capability[] = [
  {
    name: 'git_merge_preview',
    description:
      '用 git merge-tree 预演把 from 合入 into（不改工作区）。into=合入目标/线上/ours，from=我的分支/theirs。有冲突时带 webUrl 给网页选边；Agent 不要选边、不要传 files、不要 git_mr_create。禁止用 git_merge 做预演。Git >= 2.38。',
    risk: 'readonly',
    schema: S.GitMergePreviewSchema,
    handler: async (args: Args, ctx) =>
      ctx.git.previewMerge({
        into: args.into as string,
        from: args.from as string,
        fetch: args.fetch as boolean | undefined,
        remote: args.remote as string | undefined,
        path: args.path as string | undefined
      })
  },
  {
    name: 'git_merge_rehearse',
    description:
      '完整合并预演：冲突文件 + diff3 冲突正文 + ours/theirs/base（仍不改工作区）。MCP 默认只回路径摘要；要正文请带 path 或 detail=true。有冲突只给人网页选边，Agent 不要选边、不要把 files 交给 git_apply_resolve。into/from 同 git_merge_preview。',
    risk: 'readonly',
    schema: S.GitMergeRehearseSchema,
    handler: async (args: Args, ctx) => {
      const wantBody = args.detail === true || (typeof args.path === 'string' && args.path.trim().length > 0);
      if (!wantBody) {
        return ctx.git.previewMerge({
          into: args.into as string,
          from: args.from as string,
          fetch: args.fetch as boolean | undefined,
          remote: args.remote as string | undefined,
          path: args.path as string | undefined
        });
      }
      return ctx.git.rehearseMerge({
        into: args.into as string,
        from: args.from as string,
        fetch: args.fetch as boolean | undefined,
        remote: args.remote as string | undefined,
        path: args.path as string | undefined,
        maxFiles: args.maxFiles as number | undefined
      });
    }
  },
  {
    name: 'git_merge_blame',
    description:
      '对单个冲突文件两侧 tip 跑 git blame（不改工作区）。返回红块相关区间的作者/说明/时间，给人看。不是选边，Agent 不要据此改文件。into/from 同 git_merge_preview。',
    risk: 'readonly',
    schema: S.GitMergeBlameSchema,
    handler: async (args: Args, ctx) =>
      ctx.git.blameConflictFile({
        into: args.into as string,
        from: args.from as string,
        path: args.path as string,
        fetch: args.fetch as boolean | undefined,
        remote: args.remote as string | undefined
      })
  },
  {
    name: 'git_merge_survey',
    description:
      '批量预演矩阵：intos × froms 每对跑一次 merge-tree，整批只 fetch 一次。只返回结论与冲突路径。格子>20 或 async=true 时后台跑并返回 jobId（git_job_get）。禁止用 git_merge 做预演。',
    risk: 'readonly',
    schema: S.GitMergeSurveySchema,
    handler: async (args: Args, ctx) => {
      const intos = args.intos as string[];
      const froms = args.froms as string[];
      const asyncWanted = args.async === true || intos.length * froms.length > SURVEY_ASYNC_THRESHOLD;
      if (asyncWanted) {
        const job = ctx.host.jobs.startSurvey({
          repoPath: ctx.repoPath,
          intos,
          froms,
          fetch: args.fetch as boolean | undefined,
          remote: args.remote as string | undefined,
          git: ctx.git
        });
        return { jobId: job.id, status: job.status, async: true, title: job.title };
      }
      return ctx.git.surveyMerges({
        intos,
        froms,
        fetch: args.fetch as boolean | undefined,
        remote: args.remote as string | undefined
      });
    }
  },
  {
    name: 'git_merge_order',
    description:
      '建议把多个 from 合入同一个 into 的顺序。对象库内 merge-tree + commit-tree 串行模拟，不改工作区、不建分支。返回建议顺序、能连续干净合入几个、从哪一步开始要人工。',
    risk: 'readonly',
    schema: S.GitMergeOrderSchema,
    handler: async (args: Args, ctx) =>
      ctx.git.suggestMergeOrder({
        into: args.into as string,
        branches: args.branches as string[],
        fetch: args.fetch as boolean | undefined,
        remote: args.remote as string | undefined
      })
  },
  {
    name: 'git_merge',
    description:
      '把指定分支合并到当前分支（普通合并）。产生冲突时停止，不要选边、不要用本工具冒充预演。支持 dry_run 预览。',
    risk: 'write',
    schema: S.GitMergeSchema,
    handler: async (args: Args, ctx) =>
      ctx.git.merge(args.branch as string, { dryRun: args.dryRun as boolean | undefined })
  },
  {
    name: 'git_merge_abort',
    description:
      '中止当前工作区 merge（git merge --abort）。只用于已经开始的工作区合并，禁止拿来代替 merge-tree 预演。',
    risk: 'write',
    schema: S.GitMergeAbortSchema,
    handler: async (args: Args, ctx) => ctx.git.mergeAbort({ dryRun: args.dryRun as boolean | undefined })
  },
  {
    name: 'git_merge_continue',
    description:
      '继续当前工作区 merge。冲突须人先在编辑器或网页解决；Agent 不要传 files / resolvedContent。不是 git_apply_resolve。',
    risk: 'write',
    schema: S.GitMergeContinueSchema,
    handler: async (args: Args, ctx) =>
      ctx.git.mergeContinue({
        dryRun: args.dryRun as boolean | undefined,
        files: args.files as { path: string; resolvedContent: string }[] | undefined
      })
  },
  {
    name: 'git_apply_resolve',
    description:
      '在独立 git worktree 中把 from 合入 into 并提交到临时分支（主工作区不切换）。仅干净合并可落盘；有冲突不要调用，把 preview 的 webUrl 给人在网页选边。Agent 禁止传 files / resolvedContent。默认 push 临时分支。不要用工作区 git_merge 代替本工具。',
    risk: 'write',
    schema: S.GitApplyResolveSchema,
    handler: async (args: Args, ctx) =>
      ctx.git.applyResolve({
        into: args.into as string,
        from: args.from as string,
        files: args.files as { path: string; resolvedContent: string }[] | undefined,
        remote: args.remote as string | undefined,
        push: args.push as boolean | undefined,
        keepLocal: args.keepLocal as boolean | undefined,
        tempBranch: args.tempBranch as string | undefined,
        dryRun: args.dryRun as boolean | undefined
      })
  }
];
