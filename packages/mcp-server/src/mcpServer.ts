/**
 * MCP Server 装配：
 * - 基于官方 SDK 的 McpServer（tools 能力），注册全部工具；
 * - 支持 stdio（独立子进程模式）与 Streamable HTTP（daemon 转发模式）两种传输。
 *
 * 所有工具共用 executeTool 安全链路（权限/dry-run/备份/审计）。
 */
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Runtime } from './runtime.ts';
import { executeTool, formatResultForMcp } from './tools/handlers.ts';
import { TOOL_DEFS } from './tools/index.ts';

export const MCP_SERVER_INFO = { name: 'git-cockpit-mcp-server', version: '0.1.0' } as const;

/** 创建一个已注册全部工具的 McpServer（一个传输对应一个实例） */
export function createMcpServer(runtime: Runtime): McpServer {
  const server = new McpServer(
    { name: MCP_SERVER_INFO.name, version: MCP_SERVER_INFO.version },
    {
      capabilities: { tools: {} },
      instructions: [
        'Git Cockpit MCP Server：可视化的 Git 操作工具。',
        '使用规则：',
        '1. 先调用 git_status 查看工作区状态；',
        '2. 写操作（git_add/git_commit/git_push 等）默认可执行，但请先使用 dry_run=true 预览影响范围；',
        '3. 高风险工具（git_reset_hard/git_clean/git_push_force/git_branch_delete_force/git_rebase）默认禁用，',
        '   需管理员在配置中开启；执行时系统会自动备份当前状态；',
        '4. 未指定 repoPath 时使用最近打开的仓库；',
        '5. 合并预演用 git_merge_preview / git_merge_rehearse（merge-tree，不改工作区），',
        '   into=合入目标/线上，from=我的分支；禁止用 git_merge 做预演。',
        '6. 落盘用 git_apply_resolve（独立 worktree，主区不切换）；冲突时把选边后的 files 一并传入。',
        '7. 开 GitHub PR 用 git_mr_prepare（只读）/ git_mr_create（Token 在设置 MR 配置，不进工具参数）；非 GitHub 只给浏览器创建页。'
      ].join('\n')
    }
  );

  for (const def of TOOL_DEFS) {
    // SDK registerTool 的泛型联合推断在遍历场景下不稳定，统一收窄为运行时签名。
    // 注意：必须 bind(server)，SDK 1.30 的 registerTool 内部访问 this._registeredTools，
    // 抽成裸函数调用会丢 this，注册时抛 TypeError 导致 MCP 握手挂起。
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
  return server;
}

/** stdio 模式：单连接，适合 Claude Desktop / Cursor 直接拉起的独立进程 */
export async function startMcpStdio(runtime: Runtime): Promise<void> {
  const server = createMcpServer(runtime);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// ---------------------------------------------------------------------------
// Streamable HTTP 模式（daemon 内嵌）：stateful 会话管理
// ---------------------------------------------------------------------------

interface McpHttpSession {
  id: string;
  server: McpServer;
  transport: StreamableHTTPServerTransport;
}

/** 维护 Streamable HTTP 的会话映射（sessionId -> server+transport） */
export class McpHttpHandler {
  private readonly sessions = new Map<string, McpHttpSession>();
  constructor(private readonly runtime: Runtime) {}

  async handle(req: IncomingMessage, res: ServerResponse, parsedBody?: unknown): Promise<void> {
    const headerId = req.headers['mcp-session-id'];
    if (typeof headerId === 'string' && headerId) {
      const session = this.sessions.get(headerId);
      if (!session) {
        res.statusCode = 404;
        res.end('MCP session not found');
        return;
      }
      await session.transport.handleRequest(req, res, parsedBody);
      return;
    }

    // 新会话：创建 transport + server 并连接
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID()
    });
    const server = createMcpServer(this.runtime);
    await server.connect(transport);
    const session: McpHttpSession = { id: '', server, transport };
    transport.onclose = () => {
      if (session.id) this.sessions.delete(session.id);
      void server.close().catch(() => undefined);
    };
    await transport.handleRequest(req, res, parsedBody);
    const sid = transport.sessionId;
    if (sid) {
      session.id = sid;
      this.sessions.set(sid, session);
    }
  }

  dispose(): void {
    for (const session of this.sessions.values()) {
      session.transport.close().catch(() => undefined);
    }
    this.sessions.clear();
  }
}