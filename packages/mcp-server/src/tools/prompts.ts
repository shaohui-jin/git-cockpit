/**
 * MCP Prompt：。正文抄仓库根 README「Agent 该怎么用」，不许另写流程
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

const PREAMBLE = [
  '不要用终端 git 代替「预演、落盘、开 PR」。',
  '多仓库时先调用 `git_repo_select({ repoId })` 绑定当前 MCP session；显式 repoId/repoPath 只影响单次调用。',
  '默认只给摘要；要看某文件正文时再说路径，或加 `detail=true`。写操作先干跑（`dry_run=true`）。高风险操作默认关着。'
].join('\n');

export const MCP_PROMPTS = [
  {
    name: 'safe_commit',
    title: '提交',
    description: '先看改了什么，再暂存、再提交。不要一上来就提交。',
    text: [
      PREAMBLE,
      '',
      '1. 提交',
      '先看工作区有没有改、改了什么，再暂存，再提交。不要一上来就提交。',
      '',
      '对应工具：`git_status` → `git_diff` → 按需 `git_add` → `git_commit`。'
    ].join('\n')
  },
  {
    name: 'merge_preview_apply',
    title: '合不合得进去，以及写进仓库',
    description: '只做预演。有冲突给人网页，不要选边。工作区已经卡住时不要走这条。',
    text: [
      PREAMBLE,
      '',
      '2. 合不合得进去，以及写进仓库',
      '先看工作区是不是已经卡在 merge / rebase 里。卡住了走「工作区已经卡在 merge 或 rebase 里」，不要走这条。',
      '',
      '问能不能合进去时，只做预演，不要在当前工作区执行 merge。`into` 是要合进去的目标（线上），`from` 是你的分支。有冲突时把 webUrl 给人打开合并页（`/#/merge?into=&from=&preview=1`），然后停止。不要选边，不要传 files / resolvedContent，不要在冲突时 git_mr_create（含 dry_run）。',
      '',
      '看完要写进仓库：仅干净合并才用独立目录落盘，不要切走你正在干活的分支。人口头说解决了不算：用原来的 into/from 再预演，认这一对的 `merge/<from>-into-<into>`（或 `origin/merge/…`）。别人的 `merge/*` 当噪音。',
      '',
      '对应工具：`git_merge_preview` / `git_merge_rehearse`（冲突行是谁改的用 `git_merge_blame`，只读）。干净才 `git_apply_resolve`。禁止用 `git_merge` 冒充预演。'
    ].join('\n')
  },
  {
    name: 'workspace_continue',
    title: '工作区已经卡在 merge 或 rebase 里',
    description: '看状态。人先解决，再继续或放弃。不要传 files，不要用预演落盘去收尾。',
    text: [
      PREAMBLE,
      '',
      '3. 工作区已经卡在 merge 或 rebase 里',
      '这是另一回事：冲突已经发生在当前目录了。看状态。人先在编辑器或网页解决，再继续或放弃。不要传 files。不要用「合不合得进去，以及写进仓库」的落盘去收尾。',
      '',
      '对应工具：`git_status`（看 `operation`）→ `git_merge_continue` / `git_rebase_continue`（不要带 `files`）或 abort。禁止用 `git_apply_resolve`。'
    ].join('\n')
  },
  {
    name: 'open_mr',
    title: '开 Pull Request / Merge Request',
    description: '先预演；冲突则停。干净才落盘开单。Token 在网页设置里，不要塞进工具参数。',
    text: [
      PREAMBLE,
      '',
      '4. 开 Pull Request / Merge Request',
      '先 `git_merge_preview`。有冲突不要 `git_mr_create`（含 dry_run），把 webUrl 给人在网页选边。干净则落盘并推送临时枝，再 `git_mr_prepare`；只有 `mergeGate.ok` 才 `git_mr_create`，且只 dry_run 预览正文，不要把干跑当确认开单。登录用的 Token 写在网页设置里，不要塞进工具参数。',
      '',
      '对应工具：`git_merge_preview` →（冲突则停）`git_apply_resolve` / `git_push` → `git_mr_prepare` → `git_mr_create`（只 dry_run）。'
    ].join('\n')
  }
] as const;

export function registerMcpPrompts(server: McpServer): void {
  const register = server.registerPrompt.bind(server);
  for (const p of MCP_PROMPTS) {
    register(p.name, { title: p.title, description: p.description }, () => ({
      description: p.description,
      messages: [{ role: 'user' as const, content: { type: 'text' as const, text: p.text } }]
    }));
  }
}
