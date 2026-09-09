/**
 * 把 Capability 登记成 MCP tool。SDK registerTool 必须 bind(server)，
 * 抽成裸函数会丢 this，注册时抛 TypeError 导致握手挂起。
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Capability } from '@shaohui_jin/git-cockpit-core';
import type { Runtime } from '../runtime.ts';
import { formatResultForMcp } from './format.ts';
import { executeTool } from './handlers.ts';

export function bindMcpTools(server: McpServer, runtime: Runtime, capabilities: readonly Capability[]): void {
  for (const def of capabilities) {
    const register = server.registerTool.bind(server) as unknown as (
      name: string,
      config: { title?: string; description?: string; inputSchema?: unknown },
      cb: (args: unknown, extra: unknown) => Promise<unknown>
    ) => unknown;

    register(
      def.name,
      { description: def.description, inputSchema: def.schema },
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
