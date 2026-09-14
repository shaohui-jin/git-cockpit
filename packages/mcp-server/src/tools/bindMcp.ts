/**
 * 把 Capability 登记成 MCP tool。SDK registerTool 必须 bind(server)，
 * 抽成裸函数会丢 this，注册时抛 TypeError 导致握手挂起。
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Capability } from '@shaohui_jin/git-cockpit-core';
import type { Runtime } from '../runtime.ts';
import { formatResultForMcp } from './format.ts';
import { executeTool } from './handlers.ts';

const HIDE_FILES_ON_MCP = new Set(['git_apply_resolve', 'git_merge_continue', 'git_rebase_continue']);

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

export function bindMcpTools(server: McpServer, runtime: Runtime, capabilities: readonly Capability[]): void {
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
        const exec = await executeTool(def, (args ?? {}) as Record<string, unknown>, {
          runtime,
          source: 'mcp'
        });
        return {
          content: [{ type: 'text' as const, text: formatResultForMcp(exec) }],
          isError: !exec.success
        };
      }
    );
  }
}
