/**
 * 工具注册表：全部 MCP 工具的静态定义（名称/描述/风险等级/schema/handler）。
 * handler 直接调用 core GitService 的方法；统一安全链路由 executeTool 承担。
 */
import type { GitService } from '@shaohui_jin/git-cockpit-core';
import * as S from './schemas.js';
import type { ToolDef } from './handlers.js';

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
    description: '暂存（stash）当前工作区更改，可选包含未跟踪文件（-u）。支持 dry_run 预览。',
    risk: 'write',
    schema: S.GitStashSchema,
    handler: async (args: Args, ctx) =>
      ctx.git.stash(args.message as string | undefined, {
        dryRun: args.dryRun as boolean | undefined,
        includeUntracked: args.includeUntracked as boolean | undefined
      })
  },
  {
    name: 'git_stash_pop',
    description: '恢复最新（或指定 index）的 stash。恢复产生冲突会提示。支持 dry_run 预览。',
    risk: 'write',
    schema: S.GitStashPopSchema,
    handler: async (args: Args, ctx) =>
      ctx.git.stashPop({ dryRun: args.dryRun as boolean | undefined, index: args.index as number | undefined })
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