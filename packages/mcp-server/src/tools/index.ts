/**
 * 工具注册表：全部 MCP 工具的静态定义（名称/描述/风险等级/schema/handler）。
 * handler 直接调用 core GitService 的方法；统一安全链路由 executeTool 承担。
 */
import {
  enrichPrepareMr,
  createPullOrMergeRequest,
  type GitService
} from '@shaohui_jin/git-cockpit-core';
import * as S from './schemas.ts';
import type { ToolDef } from './handlers.ts';

type Args = Record<string, unknown> & { repoPath?: string; dryRun?: boolean };

export const TOOL_DEFS: ToolDef[] = [
  // ---------------------------------------------------------------------------
  // 只读工具（默认开放）
  // ---------------------------------------------------------------------------
  {
    name: 'git_status',
    description: '获取当前仓库的工作区状态：当前分支、已暂存/未暂存/未跟踪文件、冲突文件、领先/落后于上游等。',
    risk: 'readonly',
    schema: S.GitStatusSchema,
    handler: async (_args: Args, ctx) => ctx.git.getStatus()
  },
  {
    name: 'git_log',
    description: '获取提交历史（默认 HEAD 起，最多返回 maxCount 条）。支持按作者、路径、提交范围过滤。',
    risk: 'readonly',
    schema: S.GitLogSchema,
    handler: async (args: Args, ctx) =>
      ctx.git.getLog({
        maxCount: args.maxCount as number | undefined,
        from: args.from as string | undefined,
        to: args.to as string | undefined,
        author: args.author as string | undefined,
        path: args.path as string | undefined,
        all: args.all as boolean | undefined
      })
  },
  {
    name: 'git_diff',
    description: '获取工作区/暂存区/提交范围的差异。支持指定文件、staged、大 diff 截断。返回文件级统计与完整 unified diff 文本。',
    risk: 'readonly',
    schema: S.GitDiffSchema,
    handler: async (args: Args, ctx) =>
      ctx.git.getDiff({
        from: args.from as string | undefined,
        to: args.to as string | undefined,
        path: args.path as string | undefined,
        staged: args.staged as boolean | undefined,
        maxPatchBytes: args.maxPatchBytes as number | undefined
      })
  },
  {
    name: 'git_show',
    description: '显示某个提交的详细信息（元信息 + 相对父提交的 diff）。',
    risk: 'readonly',
    schema: S.GitShowSchema,
    handler: async (args: Args, ctx) =>
      ctx.git.getShow(args.commit as string, {
        path: args.path as string | undefined,
        maxPatchBytes: args.maxPatchBytes as number | undefined
      })
  },
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
    name: 'git_file_content',
    description: '读取指定提交中某个文件的内容（大文件自动截断 2MB）。',
    risk: 'readonly',
    schema: S.GitFileContentSchema,
    handler: async (args: Args, ctx) => ctx.git.getFileContent(args.commit as string, args.path as string)
  },
  {
    name: 'git_graph',
    description: '获取分支拓扑图数据（全部分支提交、父提交、引用装饰、HEAD 位置），供可视化渲染。',
    risk: 'readonly',
    schema: S.GitGraphSchema,
    handler: async (args: Args, ctx) => ctx.git.getGraph(args.maxCount as number | undefined)
  },
  {
    name: 'git_merge_preview',
    description:
      '用 git merge-tree 预演把 from 合入 into（不改工作区）。into=合入目标/线上/ours，from=我的分支/theirs。返回是否可干净合并及冲突文件列表。禁止用 git_merge 做预演。Git >= 2.38。',
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
      '完整合并预演：冲突文件 + diff3 冲突正文 + ours/theirs/base（仍不改工作区）。选边后把 files[{path,resolvedContent}] 交给 git_apply_resolve。into/from 含义同 git_merge_preview。',
    risk: 'readonly',
    schema: S.GitMergeRehearseSchema,
    handler: async (args: Args, ctx) =>
      ctx.git.rehearseMerge({
        into: args.into as string,
        from: args.from as string,
        fetch: args.fetch as boolean | undefined,
        remote: args.remote as string | undefined,
        path: args.path as string | undefined,
        maxFiles: args.maxFiles as number | undefined
      })
  },
  {
    name: 'git_merge_survey',
    description:
      '批量预演矩阵：intos × froms 每对跑一次 merge-tree，整批只 fetch 一次。只返回结论与冲突路径，不生成正文。适合发布前扫描。禁止用 git_merge 做预演。',
    risk: 'readonly',
    schema: S.GitMergeSurveySchema,
    handler: async (args: Args, ctx) =>
      ctx.git.surveyMerges({
        intos: args.intos as string[],
        froms: args.froms as string[],
        fetch: args.fetch as boolean | undefined,
        remote: args.remote as string | undefined
      })
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
    name: 'git_mr_prepare',
    description:
      '只读：解析开 PR/MR 的源/目标、浏览器创建页、本机 gh/glab 是否可用（找不到会带官方安装地址）、可选审核人列表。Token 不进参数。into/from 同 git_merge_preview。',
    risk: 'readonly',
    schema: S.GitMrPrepareSchema,
    handler: async (args: Args, ctx) => {
      const mr = ctx.runtime.config.mr;
      const prep = await ctx.git.prepareMr({
        into: args.into as string,
        from: args.from as string,
        remote: (args.remote as string | undefined)?.trim() || undefined,
        sourceBranch: args.sourceBranch as string | undefined
      });
      return enrichPrepareMr({ prep, mr, cwd: ctx.git.repoPath });
    }
  },

  // ---------------------------------------------------------------------------
  // 写操作工具（默认开放，需预览/确认）
  // ---------------------------------------------------------------------------
  {
    name: 'git_add',
    description: '暂存指定文件；paths 为空表示暂存全部。支持 dry_run 预览。',
    risk: 'write',
    schema: S.GitAddSchema,
    handler: async (args: Args, ctx) =>
      ctx.git.add((args.paths as string[]) ?? [], { dryRun: args.dryRun as boolean | undefined })
  },
  {
    name: 'git_unstage',
    description: '取消暂存指定文件（git reset HEAD -- <paths>）。支持 dry_run 预览。',
    risk: 'write',
    schema: S.GitUnstageSchema,
    handler: async (args: Args, ctx) =>
      ctx.git.unstage((args.paths as string[]) ?? [], { dryRun: args.dryRun as boolean | undefined })
  },
  {
    name: 'git_commit',
    description: '创建提交。需要指定 message；paths 可限定仅提交部分文件；allowEmpty 允许空提交。支持 dry_run 预览。',
    risk: 'write',
    schema: S.GitCommitSchema,
    handler: async (args: Args, ctx) =>
      ctx.git.commit(args.message as string, {
        dryRun: args.dryRun as boolean | undefined,
        allowEmpty: args.allowEmpty as boolean | undefined,
        paths: args.paths as string[] | undefined
      })
  },
  {
    name: 'git_checkout',
    description: '切换到指定分支。若本地更改会被覆盖将拒绝并给出提示。支持 dry_run 预览。',
    risk: 'write',
    schema: S.GitCheckoutSchema,
    handler: async (args: Args, ctx) =>
      ctx.git.checkoutBranch(args.branch as string, { dryRun: args.dryRun as boolean | undefined })
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
    name: 'git_merge',
    description: '把指定分支合并到当前分支（普通合并）。产生冲突时会提示解决。支持 dry_run 预览。',
    risk: 'write',
    schema: S.GitMergeSchema,
    handler: async (args: Args, ctx) =>
      ctx.git.merge(args.branch as string, { dryRun: args.dryRun as boolean | undefined })
  },
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
  },
  {
    name: 'git_stash',
    description: '暂存（stash）当前工作区更改，可选包含未跟踪文件（-u）；paths 可指定仅暂存部分文件（对应 WebStorm Shelve 的选择性暂存）。支持 dry_run 预览。',
    risk: 'write',
    schema: S.GitStashSchema,
    handler: async (args: Args, ctx) =>
      ctx.git.stash(args.message as string | undefined, {
        dryRun: args.dryRun as boolean | undefined,
        includeUntracked: args.includeUntracked as boolean | undefined,
        paths: (args.paths as string[]) ?? []
      })
  },
  {
    name: 'git_stash_list',
    description: '列出全部 stash 记录（stash@{n} / 说明 / 时间）。',
    risk: 'readonly',
    schema: S.GitStashListSchema,
    handler: async (_args: Args, ctx) => ctx.git.listStashes()
  },
  {
    name: 'git_stash_show',
    description: '查看某条 stash 的差异内容（不修改仓库）。',
    risk: 'readonly',
    schema: S.GitStashShowSchema,
    handler: async (args: Args, ctx) =>
      ctx.git.stashShow({
        index: args.index as number | undefined,
        maxPatchBytes: args.maxPatchBytes as number | undefined
      })
  },
  {
    name: 'git_stash_apply',
    description: '应用某条 stash（保留记录，可反复应用）。产生冲突会提示。支持 dry_run 预览。',
    risk: 'write',
    schema: S.GitStashApplySchema,
    handler: async (args: Args, ctx) =>
      ctx.git.stashApply({ dryRun: args.dryRun as boolean | undefined, index: args.index as number | undefined })
  },
  {
    name: 'git_stash_drop',
    description: '删除某条 stash 记录（删除后不可直接恢复）。支持 dry_run 预览。',
    risk: 'write',
    schema: S.GitStashDropSchema,
    handler: async (args: Args, ctx) =>
      ctx.git.stashDrop({ dryRun: args.dryRun as boolean | undefined, index: args.index as number | undefined })
  },
  {
    name: 'git_stash_pop',
    description: '恢复最新（或指定 index）的 stash。恢复产生冲突会提示。支持 dry_run 预览。',
    risk: 'write',
    schema: S.GitStashPopSchema,
    handler: async (args: Args, ctx) =>
      ctx.git.stashPop({ dryRun: args.dryRun as boolean | undefined, index: args.index as number | undefined })
  },
  {
    name: 'git_apply_resolve',
    description:
      '在独立 git worktree 中把 from 合入 into 并提交到临时分支（主工作区不切换）。干净合并 files 可空；有冲突必须提供 files。默认 push 临时分支。不要用工作区 git_merge 代替本工具。',
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
  },
  {
    name: 'git_mr_create',
    description:
      '按设置 MR 配置开 PR/MR：Token REST、本机 gh/glab，或浏览器创建页。Token 不进本工具参数。找不到 CLI 时结果里带官方安装地址。dry_run 可预览。',
    risk: 'write',
    schema: S.GitMrCreateSchema,
    handler: async (args: Args, ctx) => {
      const mr = ctx.runtime.config.mr;
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
  },

  // ---------------------------------------------------------------------------
  // 高风险工具（默认禁用，需开启/审批；自动备份）
  // ---------------------------------------------------------------------------
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
  },
  {
    name: 'git_branch_delete_force',
    description: '强制删除分支（-D，不检查合并状态，高风险）。支持 dry_run 预览。',
    risk: 'dangerous',
    schema: S.GitBranchDeleteForceSchema,
    handler: async (args: Args, ctx) =>
      ctx.git.deleteBranchForce(args.name as string, { dryRun: args.dryRun as boolean | undefined })
  },
  {
    name: 'git_rebase',
    description: '把当前分支变基到指定分支（重写提交历史，高风险，产生冲突需手动解决后 git rebase --continue）。',
    risk: 'dangerous',
    schema: S.GitRebaseSchema,
    handler: async (args: Args, ctx) =>
      ctx.git.rebase(args.branch as string, { dryRun: args.dryRun as boolean | undefined })
  }
];

export const TOOL_DEF_MAP: ReadonlyMap<string, ToolDef> = new Map(TOOL_DEFS.map((d) => [d.name, d]));

/** 供 mcpServer 注册工具列表（名称、描述、schema） */
export function toolSummaries(): { name: string; description: string }[] {
  return TOOL_DEFS.map((d) => ({ name: d.name, description: d.description }));
}

export type { GitService };