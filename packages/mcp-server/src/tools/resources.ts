/**
 * MCP Resources：只读、不进审计。形状与 git_repo_overview / git_job_* 摘要同源。
 */
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Runtime } from '../runtime.ts';
import { McpSessionContext } from '../mcpSession.ts';
import { collectRepoOverviews } from '../overview.ts';

const MIME = 'application/json';

function jsonContents(uri: string, data: unknown) {
  return {
    contents: [
      {
        uri,
        mimeType: MIME,
        text: JSON.stringify(data)
      }
    ]
  };
}

function overviewWithoutDays(runtime: Runtime) {
  return collectRepoOverviews(runtime).then((repos) =>
    repos.map((row) => {
      const { activity: _days, ...rest } = row;
      return rest;
    })
  );
}

export function registerMcpResources(
  server: McpServer,
  runtime: Runtime,
  session: McpSessionContext = new McpSessionContext(runtime)
): void {
  const register = server.registerResource.bind(server);

  register(
    'repos',
    'git-cockpit://repos',
    { title: '已打开仓库脉搏', description: '与 git_repo_overview 同摘要，不含每日格子', mimeType: MIME },
    async (uri) => jsonContents(uri.href, { repos: await overviewWithoutDays(runtime) })
  );

  register(
    'repo-current',
    'git-cockpit://repo/current',
    { title: '当前 session 仓', description: '当前 MCP session 绑定仓库的工作区摘要；未绑定时兼容最近打开仓库', mimeType: MIME },
    async (uri) => {
      const binding = session.getBinding();
      const handle = binding
        ? await runtime.repoManager.getById(binding.repoId)
        : await runtime.repoManager.getCurrent();
      if (!handle) {
        return jsonContents(uri.href, { available: false, hint: '没有已打开的仓库' });
      }
      const s = await handle.service.getStatus();
      return jsonContents(uri.href, {
        available: true,
        bound: Boolean(binding),
        scope: binding ? 'session' : 'legacy-current',
        repoId: handle.record.id,
        path: handle.record.path,
        current: s.current,
        tracking: s.tracking,
        ahead: s.ahead,
        behind: s.behind,
        operation: s.operation,
        isClean: s.isClean,
        stagedCount: s.staged.length,
        unstagedCount: s.unstaged.length,
        untrackedCount: s.untracked.length,
        conflictCount: s.conflicted.length,
        conflicted: s.conflicted.slice(0, 20)
      });
    }
  );

  register(
    'jobs',
    'git-cockpit://jobs',
    { title: '后台任务列表', description: '与 git_job_list 同摘要', mimeType: MIME },
    async (uri) =>
      jsonContents(uri.href, {
        jobs: runtime.jobs.list().map((j) => runtime.jobs.summary(j))
      })
  );

  register(
    'job',
    new ResourceTemplate('git-cockpit://jobs/{id}', {
      list: async () => ({
        resources: runtime.jobs.list().map((j) => ({
          uri: `git-cockpit://jobs/${j.id}`,
          name: j.title,
          description: `${j.kind} ${j.status}`,
          mimeType: MIME
        }))
      })
    }),
    { title: '单条后台任务', description: '状态 + 日志尾 + result 摘要', mimeType: MIME },
    async (uri, variables) => {
      const id = String(variables.id ?? '');
      const job = runtime.jobs.get(id);
      if (!job) {
        return jsonContents(uri.href, { error: '任务不存在', id });
      }
      const summary = runtime.jobs.summary(job);
      return jsonContents(uri.href, {
        ...summary,
        logs: job.logs.slice(-20)
      });
    }
  );
}
