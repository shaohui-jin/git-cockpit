/**
 * 把 Capability 登记成 MCP tool。SDK registerTool 必须 bind(server)，
 * 抽成裸函数会丢 this，注册时抛 TypeError 导致握手挂起。
 */
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Capability } from '@shaohui_jin/git-cockpit-core';
import type { Runtime } from '../runtime.ts';
import { formatResultForMcp } from './format.ts';
import { executeTool } from './handlers.ts';
import { McpSessionContext } from '../mcpSession.ts';

const HIDE_FILES_ON_MCP = new Set([
  'git_apply_resolve',
  'git_merge_continue',
  'git_rebase_continue',
  'git_cherry_pick_continue'
]);

function mcpInputSchema(def: Capability): unknown {
  if (!HIDE_FILES_ON_MCP.has(def.name)) return def.schema;
  const schema = def.schema as { omit?: (mask: { files: true }) => unknown };
  return typeof schema.omit === 'function' ? schema.omit({ files: true }) : def.schema;
}

function mcpAnnotations(def: Capability): {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  openWorldHint: boolean;
} {
  return {
    readOnlyHint: def.risk === 'readonly',
    destructiveHint: def.risk === 'dangerous',
    openWorldHint: false
  };
}

const repoSelectSchema = z.object({
  repoId: z.number().int().positive().optional().describe('已打开仓库的稳定 id'),
  repoPath: z.string().optional().describe('仓库绝对路径'),
  clear: z.boolean().optional().describe('清除当前 MCP session 的仓库绑定')
});

function bindRepoSelect(server: McpServer, runtime: Runtime, session: McpSessionContext): void {
  server.registerTool(
    'git_repo_select',
    {
      description: '绑定、切换或清除当前 MCP session 的默认仓库。普通工具显式传 repoId/repoPath 只影响单次调用。',
      inputSchema: repoSelectSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false }
    },
    async (args) => {
      try {
        const binding = await session.select(args);
        // 多 Agent 排查时能看出“谁把 session 绑到了哪个仓”，不进审计库
        runtime.eventBus.emit('log', {
          tool: 'git_repo_select',
          result: binding ? `bound:${binding.repoId}` : 'cleared',
          at: new Date().toISOString()
        });
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(binding ? { bound: true, ...binding } : { bound: false }) }]
        };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: err instanceof Error ? err.message : String(err) }],
          isError: true
        };
      }
    }
  );
}

export function bindMcpTools(
  server: McpServer,
  runtime: Runtime,
  capabilities: readonly Capability[],
  session: McpSessionContext = new McpSessionContext(runtime)
): void {
  bindRepoSelect(server, runtime, session);
  for (const def of capabilities) {
    const register = server.registerTool.bind(server) as unknown as (
      name: string,
      config: { title?: string; description?: string; inputSchema?: unknown; annotations?: unknown },
      cb: (args: unknown, extra: unknown) => Promise<unknown>
    ) => unknown;

    register(
      def.name,
      { description: def.description, inputSchema: mcpInputSchema(def), annotations: mcpAnnotations(def) },
      async (args: unknown) => {
        const rawArgs = (args ?? {}) as Record<string, unknown>;
        const binding = session.getBinding();
        const hasExplicitRepo = rawArgs.repoId !== undefined || Boolean(rawArgs.repoPath);
        const exec = await executeTool(def, rawArgs, {
          runtime,
          source: 'mcp',
          repoId: hasExplicitRepo ? undefined : binding?.repoId,
          repoPath: hasExplicitRepo ? undefined : binding?.repoPath
        });
        return {
          content: [{ type: 'text' as const, text: formatResultForMcp(exec) }],
          isError: !exec.success
        };
      }
    );
  }
}
