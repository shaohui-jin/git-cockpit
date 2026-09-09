/**
 * MCP Prompt：。正文抄仓库根 README「Agent 该怎么用」，不许另写流程
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

const PREAMBLE = [
  '不要用终端 git 代替「预演、落盘、开 PR」。',
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
    description: '只做预演，人选边，独立目录落盘。工作区已经卡住时不要走这条。',
    text: [
      PREAMBLE,
      '',
      '2. 合不合得进去，以及写进仓库',
      '先看工作区是不是已经卡在 merge / rebase 里。卡住了走「工作区已经卡在 merge 或 rebase 里」，不要走这条。',
      '',
      '问能不能合进去时，只做预演，不要在当前工作区执行 merge。`into` 是要合进去的目标（线上），`from` 是你的分支。有冲突时把正文给人看、人选边，不要让模型自动选。',
      '',
      '看完要写进仓库：用独立目录落盘，不要切走你正在干活的分支。',
      '',
      '对应工具：`git_merge_preview` / `git_merge_rehearse`（冲突行是谁改的用 `git_merge_blame`）→ `git_apply_resolve`。禁止用 `git_merge` 冒充预演。'
    ].join('\n')
  },
  {
    name: 'workspace_continue',
    title: '工作区已经卡在 merge 或 rebase 里',
    description: '看状态，然后继续或放弃。不要用预演落盘去收尾。',
    text: [
      PREAMBLE,
      '',
      '3. 工作区已经卡在 merge 或 rebase 里',
      '这是另一回事：冲突已经发生在当前目录了。看状态，然后继续或放弃。不要用「合不合得进去，以及写进仓库」的落盘去收尾。',
      '',
      '对应工具：`git_status`（看 `operation`）→ `git_merge_continue` / `git_rebase_continue` 或 abort。禁止用 `git_apply_resolve`。'
    ].join('\n')
  },
  {
    name: 'open_mr',
    title: '开 Pull Request / Merge Request',
    description: '先准备标题和目标分支，再创建。Token 在网页设置里，不要塞进工具参数。',
    text: [
      PREAMBLE,
      '',
      '4. 开 Pull Request / Merge Request',
      '先准备标题和目标分支等信息，再创建。登录用的 Token 写在网页设置里，不要塞进工具参数。',
      '',
      '对应工具：`git_mr_prepare` → `git_mr_create`。'
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
