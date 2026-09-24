/**
 * MCP Server 装配：
 * - 基于官方 SDK 的 McpServer（tools 能力），注册全部工具；
 * - 支持 stdio（独立子进程模式）与 Streamable HTTP（daemon 转发模式）两种传输。
 *
 * 所有工具共用 executeCapability 安全链路（权限/dry-run/备份/审计）。
 */
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Runtime } from './runtime.ts';
import { version } from '../package.json';
import { bindMcpTools } from './tools/bindMcp.ts';
import { TOOL_DEFS } from './tools/index.ts';
import { registerMcpPrompts } from './tools/prompts.ts';
import { registerMcpResources } from './tools/resources.ts';
import { McpSessionContext } from './mcpSession.ts';
import { resolveDaemonEndpoint } from './daemonEndpoint.ts';

export const MCP_SERVER_INFO = { name: 'git-cockpit-mcp-server', version } as const;

/** 创建一个已注册全部工具的 McpServer（一个传输对应一个实例） */
export function createMcpServer(runtime: Runtime, session = new McpSessionContext(runtime)): McpServer {
  const server = new McpServer(
    { name: MCP_SERVER_INFO.name, version: MCP_SERVER_INFO.version },
    {
      capabilities: { tools: {}, prompts: {}, resources: {}, logging: {} },
      instructions: [
        'Git Cockpit MCP Server：可视化的 Git 操作工具。',
        '使用规则：',
        '1. 先调用 git_status 查看工作区状态（含 operation=merge/rebase/cherry-pick 时走工作区收尾，不要用预演工具冒充）；',
        '2. 写操作先 dry_run=true。MCP 真写要等这次预览成功后再用相同参数 dry_run=false；next 不会直接给 dry_run=false。',
        '3. 高风险工具（git_reset_hard/git_clean/git_push_force/git_branch_delete_force/git_rebase）默认禁用，',
        '   需管理员在配置中开启；执行时系统会自动备份当前状态；',
        '4. 多仓库时先调用 git_repo_select 绑定当前 MCP session；后续未指定 repoId/repoPath 的工具使用该绑定。未绑定时才兼容使用最近打开的仓库；普通工具显式指定仓库只影响单次调用；',
        '5. 合并预演用 git_merge_preview / git_merge_rehearse（merge-tree，不改工作区），',
        '   into=合入目标/线上，from=我的分支；禁止用 git_merge 做预演。',
        '   冲突行作者用 git_merge_blame（按文件、只读，不是选边）。',
        '   多分支扫描用 git_merge_survey；建议合入顺序用 git_merge_order。',
        '   有冲突只把 webUrl 给人在网页选边；Agent 不要选边、不要传 files / resolvedContent。',
        '6. 落盘用 git_apply_resolve（独立 worktree，主区不切换）。仅干净合并。有冲突不要调用。',
        '7. 工作区已经冲突：人先在编辑器或网页解决，再 git_merge_continue / git_rebase_continue / git_cherry_pick_continue（不要带 files）或 abort；不是 apply_resolve。拣选一次一个提交。',
        '8. 更新远程跟踪分支用 git_fetch。两分支分叉对比用 git_branch_graph 并传 into/from。',
        '9. 开 PR/MR：先 git_merge_preview。有冲突不要 git_mr_create（含 dry_run），把 webUrl 给人在网页选边。干净则落盘并推送临时枝，再 git_mr_prepare（看 mergeGate.ok）→ git_mr_create 只 dry_run。方式与 Token 在设置 MR 配置（不进工具参数）。找不到 CLI 时结果含官方安装地址。',
        '10. 大结果默认摘要：git_diff / git_show / git_merge_rehearse 要正文请加 path 或 detail=true。',
        '11. 已打开仓库脉搏用 git_repo_overview。长任务用 git_job_list / git_job_get / git_job_cancel。',
        '12. worktree 列表/添加/删除用 git_worktree_list / git_worktree_add / git_worktree_remove；不要把 linked worktree 当成第二套工作区做 merge。',
        '13. 提交 / 预演落盘 / 工作区收尾 / 开 PR 用 Prompt：safe_commit、merge_preview_apply、workspace_continue、open_mr（正文与 README「Agent 该怎么用」相同）。',
        '14. 只读列表可读 Resource：git-cockpit://repos、git-cockpit://repo/current、git-cockpit://jobs、git-cockpit://jobs/{id}。'
      ].join('\n')
    }
  );

  bindMcpTools(server, runtime, TOOL_DEFS, session);

  registerMcpPrompts(server);
  registerMcpResources(server, runtime, session);
  bindMcpNotifications(server, runtime, session);
  return server;
}

/** 将 daemon 的业务事件映射为 MCP 主动通知；监听器随 server 关闭而移除。 */
function bindMcpNotifications(server: McpServer, runtime: Runtime, session: McpSessionContext): void {
  const onRepoChanged = (payload: unknown) => {
    const repoPath =
      typeof payload === 'object' && payload !== null && 'repoPath' in payload
        ? String((payload as { repoPath?: unknown }).repoPath ?? '')
        : '';
    const binding = session.getBinding();
    if (binding && repoPath && binding.repoPath !== repoPath) return;
    void server.server.sendResourceUpdated({ uri: 'git-cockpit://repo/current' }).catch(() => undefined);
    void server.server
      .sendLoggingMessage({
        level: 'info',
        data: { event: 'repo-changed', repoPath, payload }
      })
      .catch(() => undefined);
  };
  const onJobProgress = (payload: unknown) => {
    void server.server
      .sendLoggingMessage({
        level: 'info',
        data: { event: 'job-progress', payload }
      })
      .catch(() => undefined);
  };
  runtime.eventBus.on('repo-changed', onRepoChanged);
  runtime.eventBus.on('job-progress', onJobProgress);
  server.server.onclose = () => {
    runtime.eventBus.off('repo-changed', onRepoChanged);
    runtime.eventBus.off('job-progress', onJobProgress);
  };
}

/** stdio 模式：单连接，适合 Claude Desktop / Cursor 直接拉起的独立进程 */
export async function startMcpStdio(runtime: Runtime): Promise<void> {
  const server = createMcpServer(runtime, new McpSessionContext(runtime));
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
  repoContext: McpSessionContext;
}

function isInitializeBody(body: unknown): boolean {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return false;
  return (body as { method?: unknown }).method === 'initialize';
}

/** IPv6 字面量在 Host 头里必须带方括号（`::1` → `[::1]`） */
function normalizeHostBase(addr: string): string {
  return addr.includes(':') && !addr.startsWith('[') ? `[${addr}]` : addr;
}

/**
 * SDK 的 DNS rebinding 校验直接用带端口的 Host 头比对 allowedHosts（不剥端口），
 * 所以 `host` 与 `host:port` 两种形态都要列进去，否则真实客户端一律 403。
 *
 * 另外并入本次连接的真实本地端点（socket）：
 * - 服务监听在随机端口 / 0.0.0.0 时，配置里的端口未必等于实际端口；
 * - 这不削弱防护 —— 攻击者能控制的只有 Host 头（如 evil.com:3000），
 *   而 socket 端点由服务自身决定，永远不会是攻击者的域名。
 */
function buildAllowedHosts(
  configured: { host: string; port: number },
  socket?: { localAddress?: string; localPort?: number }
): string[] {
  const bases = new Set<string>();
  for (const raw of [configured.host, '127.0.0.1', 'localhost', '[::1]']) {
    if (raw) bases.add(normalizeHostBase(raw));
  }
  const local = socket?.localAddress;
  if (local) {
    bases.add(normalizeHostBase(local));
    // IPv4-mapped IPv6（::ffff:127.0.0.1）在 Host 头里是裸 IPv4，补一份
    if (local.startsWith('::ffff:')) bases.add(local.slice(7));
  }

  const ports = new Set<number>();
  for (const p of [configured.port, socket?.localPort]) {
    if (typeof p === 'number' && Number.isInteger(p) && p > 0) ports.add(p);
  }

  const out = new Set<string>();
  for (const base of bases) {
    out.add(base);
    for (const port of ports) out.add(`${base}:${port}`);
  }
  return [...out];
}

/** 维护 Streamable HTTP 的会话映射（sessionId -> server+transport） */
export class McpHttpHandler {
  private readonly sessions = new Map<string, McpHttpSession>();
  constructor(private readonly runtime: Runtime) {}

  /** 与 cli.ts、stdio bridge 保持同一套 daemon 地址解析。 */
  private hostPort(): { host: string; port: number } {
    const endpoint = resolveDaemonEndpoint(this.runtime.config);
    return { host: endpoint.host, port: endpoint.port };
  }

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

    // 没有会话 id 的请求只能是 initialize；预检使用 /api/health，避免制造悬空 transport。
    if (req.method !== 'POST' || !isInitializeBody(parsedBody)) {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'MCP session 不存在；请先发送 initialize' }));
      return;
    }

    // 新会话：创建 transport + server 并连接
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      enableDnsRebindingProtection: true,
      allowedHosts: buildAllowedHosts(this.hostPort(), req.socket ?? undefined),
      // JSON 响应模式：POST 直接回一条 application/json（而不是默认的 SSE 长连接）。
      // 本产品的工具是纯请求-响应，没有服务端主动推送，用 SSE 只会让连接悬着：
      // - stdio 桥要等流关闭才能拿到完整正文，curl 调试也要 --no-buffer 才看得到；
      // - 客户端侧（GET /mcp）的 SSE 通道不受影响，仍可用于服务端通知。
      enableJsonResponse: true
    });
    const repoContext = new McpSessionContext(this.runtime);
    const server = createMcpServer(this.runtime, repoContext);
    await server.connect(transport);
    const session: McpHttpSession = { id: '', server, transport, repoContext };
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
