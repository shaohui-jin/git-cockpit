import { BackupManager } from '../../backup.ts';
import type { Capability } from '../types.ts';
import * as S from '../schemas.ts';

type Args = Record<string, unknown> & { repoPath?: string; dryRun?: boolean };

export const inspectCapabilities: Capability[] = [
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
    name: 'git_file_content',
    description: '读取指定提交中某个文件的内容（大文件自动截断 2MB）。',
    risk: 'readonly',
    schema: S.GitFileContentSchema,
    handler: async (args: Args, ctx) => ctx.git.getFileContent(args.commit as string, args.path as string)
  },
  {
    name: 'git_graph',
    description:
      '获取全部分支的提交列表（hash/parent/subject/refs/HEAD），给需要线性历史的场景。状态页 G6 分支图请用 git_branch_graph（tip DAG）。',
    risk: 'readonly',
    schema: S.GitGraphSchema,
    handler: async (args: Args, ctx) => ctx.git.getGraph(args.maxCount as number | undefined)
  },
  {
    name: 'git_branch_graph',
    description:
      '分支 tip DAG：for-each-ref + rev-list --parents。节点是各分支 tip，边是最近祖先 tip。与 Git Insight 画布同一口径。不改工作区。',
    risk: 'readonly',
    schema: S.GitBranchGraphSchema,
    handler: async (args: Args, ctx) =>
      ctx.git.getBranchGraph({
        maxNodes: args.maxNodes as number | undefined,
        into: args.into as string | undefined,
        from: args.from as string | undefined
      })
  },
  {
    name: 'git_reflog',
    description: '只读列出 git reflog（HEAD 移动记录）。',
    risk: 'readonly',
    schema: S.GitReflogSchema,
    handler: async (args: Args, ctx) => ctx.git.getReflog(args.maxCount as number | undefined)
  },
  {
    name: 'git_backup_list',
    description: '列出高危操作前自动创建的 backup/pre-op-* 分支，以及说明含 git-cockpit backup 的 stash。',
    risk: 'readonly',
    schema: S.GitStatusSchema,
    handler: async (_args: Args, ctx) => new BackupManager(ctx.git).listBackups()
  }
];
