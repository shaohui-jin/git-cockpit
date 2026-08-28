/**
 * MCP 工具参数 Schema（zod）。
 * 所有工具均支持可选的 repoPath（缺省使用当前打开的仓库）与 dryRun（缺省为配置默认）。
 */
import { z } from 'zod';

const repoPath = z
  .string()
  .optional()
  .describe('仓库绝对路径。不提供时使用当前打开的仓库。');

const dryRun = z
  .boolean()
  .optional()
  .describe('为 true 时仅返回将执行的命令与影响范围（预览/干运行），不真正修改仓库。');

const maxCount = z
  .number()
  .int()
  .min(1)
  .max(10000)
  .optional()
  .describe('最多返回的提交数量。');

/** 全部只读工具共享的 schema（仅 repoPath 可选） */
const readonlyBase = { repoPath };

export const GitStatusSchema = z.object({ ...readonlyBase });
export type GitStatusArgs = z.infer<typeof GitStatusSchema>;

export const GitLogSchema = z.object({
  ...readonlyBase,
  maxCount,
  from: z.string().optional().describe('起始提交（含）；与 to 配合表示范围 from..to'),
  to: z.string().optional().describe('结束提交（含）'),
  author: z.string().optional().describe('按作者过滤（支持子串）'),
  path: z.string().optional().describe('仅查看该路径的历史'),
  all: z.boolean().optional().describe('包含所有分支（--all）')
});
export type GitLogArgs = z.infer<typeof GitLogSchema>;

export const GitDiffSchema = z.object({
  ...readonlyBase,
  from: z.string().optional().describe('起点提交'),
  to: z.string().optional().describe('终点提交'),
  path: z.string().optional().describe('限定的文件路径'),
  staged: z.boolean().optional().describe('查看已暂存（索引）差异'),
  maxPatchBytes: z.number().int().positive().optional().describe('diff 正文最大字节数，超出截断')
});
export type GitDiffArgs = z.infer<typeof GitDiffSchema>;

export const GitShowSchema = z.object({
  ...readonlyBase,
  commit: z.string().describe('要查看的提交 hash'),
  path: z.string().optional().describe('限定文件'),
  maxPatchBytes: z.number().int().positive().optional()
});
export type GitShowArgs = z.infer<typeof GitShowSchema>;

export const GitBranchListSchema = z.object({ ...readonlyBase });
export type GitBranchListArgs = z.infer<typeof GitBranchListSchema>;

export const GitTagListSchema = z.object({ ...readonlyBase });
export type GitTagListArgs = z.infer<typeof GitTagListSchema>;

export const GitRemoteListSchema = z.object({ ...readonlyBase });
export type GitRemoteListArgs = z.infer<typeof GitRemoteListSchema>;

export const GitFileContentSchema = z.object({
  ...readonlyBase,
  commit: z.string().describe('提交 hash（如 HEAD、main）'),
  path: z.string().describe('仓库内文件相对路径')
});
export type GitFileContentArgs = z.infer<typeof GitFileContentSchema>;

export const GitGraphSchema = z.object({
  ...readonlyBase,
  maxCount: z.number().int().min(1).max(5000).optional().describe('最大提交数')
});
export type GitGraphArgs = z.infer<typeof GitGraphSchema>;

const mergeIntoFrom = {
  into: z.string().min(1).describe('合入目标（线上 / ours / 预演左侧）。例如 origin/main'),
  from: z.string().min(1).describe('我的分支（theirs / 预演右侧）。例如 feature/x'),
  fetch: z.boolean().optional().describe('是否先非交互 fetch。缺省 true；失败则用本地引用并标明 stale'),
  remote: z.string().optional().describe('fetch/push 使用的远程名，缺省 origin'),
  path: z.string().optional().describe('仅关心该冲突文件路径')
};

export const GitMergePreviewSchema = z.object({
  ...readonlyBase,
  ...mergeIntoFrom
});
export type GitMergePreviewArgs = z.infer<typeof GitMergePreviewSchema>;

export const GitMergeRehearseSchema = z.object({
  ...readonlyBase,
  ...mergeIntoFrom,
  maxFiles: z.number().int().min(1).max(100).optional().describe('最多生成冲突正文的文件数，缺省 20')
});
export type GitMergeRehearseArgs = z.infer<typeof GitMergeRehearseSchema>;

/** 写操作公共参数 */
const writeBase = { repoPath, dryRun };
const pathsField = z.array(z.string()).default([]).describe('文件路径列表；缺省为空即全部文件');

export const GitAddSchema = z.object({ ...writeBase, paths: pathsField });
export type GitAddArgs = z.infer<typeof GitAddSchema>;

export const GitUnstageSchema = z.object({ ...writeBase, paths: pathsField });
export type GitUnstageArgs = z.infer<typeof GitUnstageSchema>;

export const GitCommitSchema = z.object({
  ...writeBase,
  message: z.string().min(1).describe('提交信息'),
  paths: z.array(z.string()).optional().describe('仅提交这些路径（可空）'),
  allowEmpty: z.boolean().optional().describe('允许空提交（--allow-empty）')
});
export type GitCommitArgs = z.infer<typeof GitCommitSchema>;

export const GitCheckoutSchema = z.object({
  ...writeBase,
  branch: z.string().describe('要切换到的分支名')
});
export type GitCheckoutArgs = z.infer<typeof GitCheckoutSchema>;

export const GitBranchCreateSchema = z.object({
  ...writeBase,
  name: z.string().describe('新分支名'),
  startPoint: z.string().optional().describe('创建起点（提交/分支），缺省为当前 HEAD')
});
export type GitBranchCreateArgs = z.infer<typeof GitBranchCreateSchema>;

export const GitBranchDeleteSchema = z.object({
  ...writeBase,
  name: z.string().describe('要删除的分支名（未合并分支会被拒绝）')
});
export type GitBranchDeleteArgs = z.infer<typeof GitBranchDeleteSchema>;

export const GitMergeSchema = z.object({
  ...writeBase,
  branch: z.string().describe('要合并进来的分支名')
});
export type GitMergeArgs = z.infer<typeof GitMergeSchema>;

export const GitPullSchema = z.object({
  ...writeBase,
  remote: z.string().optional().describe('远程名（缺省 origin）'),
  branch: z.string().optional().describe('远端分支名')
});
export type GitPullArgs = z.infer<typeof GitPullSchema>;

export const GitPushSchema = z.object({
  ...writeBase,
  remote: z.string().optional().describe('远程名（缺省 origin）'),
  branch: z.string().optional().describe('分支名')
});
export type GitPushArgs = z.infer<typeof GitPushSchema>;

export const GitTagCreateSchema = z.object({
  ...writeBase,
  name: z.string().describe('标签名'),
  message: z.string().optional().describe('附注标签消息（带则创建 annotated tag）'),
  commit: z.string().optional().describe('打标签的提交，缺省为 HEAD')
});
export type GitTagCreateArgs = z.infer<typeof GitTagCreateSchema>;

export const GitStashSchema = z.object({
  ...writeBase,
  message: z.string().optional().describe('stash 消息'),
  includeUntracked: z.boolean().optional().describe('包含未跟踪文件（-u）'),
  paths: pathsField.describe('仅暂存这些文件（对应 WebStorm Shelve 的选择性暂存；空则暂存全部）')
});
export type GitStashArgs = z.infer<typeof GitStashSchema>;

export const GitStashListSchema = z.object({ ...readonlyBase });
export type GitStashListArgs = z.infer<typeof GitStashListSchema>;

export const GitStashShowSchema = z.object({
  ...readonlyBase,
  index: z.number().int().min(0).optional().describe('stash 序号，缺省为 stash@{0}'),
  maxPatchBytes: z.number().int().positive().optional().describe('diff 正文最大字节数，超出截断')
});
export type GitStashShowArgs = z.infer<typeof GitStashShowSchema>;

export const GitStashApplySchema = z.object({
  ...writeBase,
  index: z.number().int().min(0).optional().describe('stash 序号，缺省为 stash@{0}')
});
export type GitStashApplyArgs = z.infer<typeof GitStashApplySchema>;

export const GitStashDropSchema = z.object({
  ...writeBase,
  index: z.number().int().min(0).optional().describe('stash 序号，缺省为 stash@{0}')
});
export type GitStashDropArgs = z.infer<typeof GitStashDropSchema>;

export const GitStashPopSchema = z.object({
  ...writeBase,
  index: z.number().int().min(0).optional().describe('stash 序号，缺省为最新的 stash@{0}')
});
export type GitStashPopArgs = z.infer<typeof GitStashPopSchema>;

export const GitApplyResolveSchema = z.object({
  ...writeBase,
  into: z.string().min(1).describe('合入目标（线上 / ours）。例如 origin/main'),
  from: z.string().min(1).describe('我的分支（theirs）。例如 feature/x'),
  remote: z.string().optional().describe('push 使用的远程名，缺省 origin'),
  files: z
    .array(
      z.object({
        path: z.string().describe('仓库内相对路径'),
        resolvedContent: z.string().describe('该文件解决后的完整内容')
      })
    )
    .optional()
    .describe('已解决冲突的文件。干净合并可省略或传空数组'),
  push: z.boolean().optional().describe('是否推送临时分支，缺省 true'),
  keepLocal: z.boolean().optional().describe('推送失败时仍保留本地临时分支'),
  tempBranch: z.string().optional().describe('自定义临时分支名；缺省 merge/<from>-into-<into>')
});
export type GitApplyResolveArgs = z.infer<typeof GitApplyResolveSchema>;

const mrIntoFrom = {
  into: z.string().min(1).describe('合入目标（线上 / ours）。例如 origin/main'),
  from: z.string().min(1).describe('我的分支（theirs）。例如 feature/x'),
  remote: z.string().optional().describe('远程名，缺省 origin'),
  sourceBranch: z.string().optional().describe('PR 源分支；缺省已有临时分支 merge/<from>-into-<into>，否则 from')
};

export const GitMrPrepareSchema = z.object({
  ...readonlyBase,
  ...mrIntoFrom
});
export type GitMrPrepareArgs = z.infer<typeof GitMrPrepareSchema>;

export const GitMrCreateSchema = z.object({
  ...writeBase,
  ...mrIntoFrom,
  title: z.string().optional().describe('PR 标题；缺省 Merge <source> into <target>'),
  body: z.string().optional().describe('PR 正文')
});
export type GitMrCreateArgs = z.infer<typeof GitMrCreateSchema>;

/** 高风险工具 */
export const GitResetHardSchema = z.object({ ...writeBase, target: z.string().describe('要重置到的提交') });
export type GitResetHardArgs = z.infer<typeof GitResetHardSchema>;

export const GitCleanSchema = z.object({ ...writeBase });
export type GitCleanArgs = z.infer<typeof GitCleanSchema>;

export const GitPushForceSchema = z.object({
  ...writeBase,
  remote: z.string().optional(),
  branch: z.string().optional()
});
export type GitPushForceArgs = z.infer<typeof GitPushForceSchema>;

export const GitBranchDeleteForceSchema = z.object({
  ...writeBase,
  name: z.string().describe('要强制删除的分支名')
});
export type GitBranchDeleteForceArgs = z.infer<typeof GitBranchDeleteForceSchema>;

export const GitRebaseSchema = z.object({
  ...writeBase,
  branch: z.string().describe('要变基到的分支/提交')
});
export type GitRebaseArgs = z.infer<typeof GitRebaseSchema>;