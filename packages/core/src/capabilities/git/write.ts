import type { Capability } from '../types.ts';
import * as S from '../schemas.ts';

type Args = Record<string, unknown> & { repoPath?: string; dryRun?: boolean };

export const writeCapabilities: Capability[] = [
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
    name: 'git_stash',
    description:
      '暂存（stash）当前工作区更改，可选包含未跟踪文件（-u）；paths 可指定仅暂存部分文件（对应 WebStorm Shelve 的选择性暂存）。支持 dry_run 预览。',
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
  }
];
