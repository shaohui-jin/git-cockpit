/**
 * Fastify Web 服务：
 * - REST API 供 Web 前端调用（仓库管理、状态/历史/差异/branch 等只读查询、通用写操作入口）；
 * - SSE（GET /api/events）推送仓库变化事件；
 * - 挂载 MCP Streamable HTTP 传输（/mcp），供 AI 客户端（Cursor/Claude Desktop）连接；
 * - 托管 Web 前端构建产物（packages/web/dist，若存在）。
 */
import * as path from 'node:path';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import type { FastifyInstance, FastifyReply } from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import {
  GitOperationError,
  GitService,
  PermissionManager,
  RepoNotFoundError
} from '@shaohui_jin/git-cockpit-core';
import type { OpenedRepo } from '@shaohui_jin/git-cockpit-core';
import { disposeRuntime } from './runtime.js';
import type { Runtime } from './runtime.js';
import { McpHttpHandler } from './mcpServer.js';
import { executeTool } from './tools/handlers.js';
import { TOOL_DEF_MAP, toolSummaries } from './tools/index.js';

export interface WebServerHandle {
  app: FastifyInstance;
  /** 关闭 HTTP 服务与相关资源 */
  close: () => Promise<void>;
}

/** 静态资源目录：优先 Web 构建产物；不存在则仅提供 API。
 * 解析基于脚本自身位置（而非 process.cwd()），保证任意启动目录都能找到前端。 */
function resolveWebDist(): string | null {
  // 源码布局下脚本位于 packages/mcp-server/dist，../.. 回到 packages，再进 web/dist
  const here = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
  const candidates = [
    path.resolve(here, '..', '..', 'web', 'dist'), // 源码布局：packages/mcp-server/dist → packages/web/dist
    path.resolve(here, 'web'), // 发布布局：产物由 copy-web.mjs 打入 dist/web（含 index.html）
    path.resolve(here, 'web', 'dist'), // 兼容旧式 dist/web/dist 布局
    path.resolve(here, '..', 'web', 'dist'), // 兼容 npm 全局安装目录的旧式布局
    path.resolve(process.cwd(), 'dist', 'web'),
    path.resolve(process.cwd(), '..', 'web', 'dist'),
    path.resolve(process.cwd(), 'node_modules', '@shaohui_jin', 'git-cockpit-web', 'dist')
  ];
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, 'index.html'))) return c;
  }
  return null;
}

export async function createWebServer(
  runtime: Runtime,
  options: { host?: string; port?: number; staticDir?: string | null; noListen?: boolean } = {}
): Promise<WebServerHandle> {
  const app = Fastify({ logger: false, bodyLimit: 2 * 1024 * 1024 });

  await app.register(cors, {
    origin: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Mcp-Session-Id', 'Authorization']
  });

  const staticDir = options.staticDir !== undefined ? options.staticDir : resolveWebDist();
  if (staticDir && fs.existsSync(staticDir)) {
    await app.register(fastifyStatic, { root: staticDir, prefix: '/' });
  }

  const mcpHttp = new McpHttpHandler(runtime);

  // Health
  app.get('/api/health', async () => ({
    ok: true,
    service: 'git-cockpit',
    version: '0.1.0',
    uptimeMs: process.uptime() * 1000
  }));

  // ---------------------------------------------------------------------------
  // 仓库管理
  // ---------------------------------------------------------------------------
  app.get('/api/repos', async () => ({
    repos: runtime.repoManager.list()
  }));

  app.post<{ Body: { path?: string } }>('/api/repos/open', async (req, reply) => {
    const target = req.body?.path?.trim();
    if (!target) {
      return reply.code(400).send({ error: '缺少 path 参数' } as never);
    }
    try {
      const handle = await runtime.repoManager.open(target);
      return { repo: handle.record };
    } catch (err) {
      return reply.code(400).send({ error: toError(err) } as never);
    }
  });

  app.delete<{ Params: { id: string } }>('/api/repos/:id', async (req, reply) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return reply.code(400).send({ error: '非法仓库 id' } as never);
    }
    runtime.repoManager.remove(id);
    return { ok: true };
  });

  // ---------------------------------------------------------------------------
  // 只读查询（按仓库 id）
  // ---------------------------------------------------------------------------
  async function withRepo<T>(
    req: { params: { id: string } },
    reply: FastifyReply,
    fn: (handle: { service: GitService; record: OpenedRepo }) => Promise<T>
  ): Promise<T | void> {
    const id = Number(req.params.id);
    const handle = await runtime.repoManager.getById(id);
    if (!handle) {
      await reply.code(404).send({ error: '仓库不存在或已失效' });
      return undefined;
    }
    try {
      return await fn(handle);
    } catch (err) {
      await reply.code(400).send({ error: toError(err) });
      return undefined;
    }
  }

  app.get<{ Params: { id: string } }>('/api/repos/:id/status', async (req, reply) =>
    withRepo(req, reply, async ({ service }) => service.getStatus())
  );

  app.get<{ Params: { id: string }; Querystring: Record<string, string | undefined> }>('/api/repos/:id/log', async (req, reply) =>
    withRepo(req, reply, async ({ service }) => {
      const q = req.query;
      return service.getLog({
        maxCount: q.maxCount ? Math.min(Number(q.maxCount) || 100, 10000) : undefined,
        from: q.from,
        to: q.to,
        author: q.author,
        path: q.path,
        all: q.all === 'true'
      });
    })
  );

  app.get<{ Params: { id: string }; Querystring: Record<string, string | undefined> }>('/api/repos/:id/diff', async (req, reply) =>
    withRepo(req, reply, async ({ service }) => {
      const q = req.query;
      return service.getDiff({
        from: q.from,
        to: q.to,
        path: q.path,
        staged: q.staged === 'true',
        maxPatchBytes: q.maxPatchBytes ? Number(q.maxPatchBytes) : undefined
      });
    })
  );

  app.get<{ Params: { id: string; commit: string }; Querystring: Record<string, string | undefined> }>(
    '/api/repos/:id/show/:commit',
    async (req, reply) =>
      withRepo(req, reply, async ({ service }) =>
        service.getShow(req.params.commit, {
          path: req.query.path,
          maxPatchBytes: req.query.maxPatchBytes ? Number(req.query.maxPatchBytes) : undefined
        })
      )
  );

  app.get<{ Params: { id: string } }>('/api/repos/:id/branches', async (req, reply) =>
    withRepo(req, reply, async ({ service }) => service.listBranches())
  );

  app.get<{ Params: { id: string } }>('/api/repos/:id/tags', async (req, reply) =>
    withRepo(req, reply, async ({ service }) => service.listTags())
  );

  app.get<{ Params: { id: string } }>('/api/repos/:id/remotes', async (req, reply) =>
    withRepo(req, reply, async ({ service }) => service.listRemotes())
  );

  app.get<{ Params: { id: string }; Querystring: Record<string, string | undefined> }>('/api/repos/:id/graph', async (req, reply) =>
    withRepo(req, reply, async ({ service }) => service.getGraph(req.query.maxCount ? Number(req.query.maxCount) : 500))
  );

  app.get<{ Params: { id: string }; Querystring: { commit?: string; path?: string } }>('/api/repos/:id/file', async (req, reply) =>
    withRepo(req, reply, async ({ service }) => {
      if (!req.query.commit || !req.query.path) {
        return { error: '需要 commit 与 path 参数' };
      }
      return service.getFileContent(req.query.commit, req.query.path);
    })
  );

  app.get<{ Params: { id: string } }>('/api/repos/:id/stashes', async (req, reply) =>
    withRepo(req, reply, async ({ service }) => service.listStashes())
  );

  // ---------------------------------------------------------------------------
  // 通用写操作入口（复用 MCP 同款安全链路）
  // ---------------------------------------------------------------------------
  app.post<{ Params: { id: string; tool: string }; Body: { params?: Record<string, unknown> } }>(
    '/api/repos/:id/tools/:tool',
    async (req, reply) => {
      const def = TOOL_DEF_MAP.get(req.params.tool);
      if (!def) return reply.code(404).send({ error: `未知工具: ${req.params.tool}` });
      const params = req.body?.params ?? {};
      const exec = await executeTool(def, params, {
        runtime,
        source: 'web',
        repoId: Number(req.params.id)
      });
      if (!exec.success) {
        const status = exec.error?.requiredApproval ? 403 : 400;
        return reply
          .code(status)
          .send({ error: exec.error?.message, requiredApproval: exec.error?.requiredApproval, code: exec.error?.code });
      }
      return { ...exec };
    }
  );

  // ---------------------------------------------------------------------------
  // 工具注册表信息（供前端渲染可操作按钮）
  // ---------------------------------------------------------------------------
  app.get('/api/tools', async () => ({
    tools: toolSummaries().map((t) => ({
      ...t,
      riskLevel: runtime.permissions.getRiskLevel(t.name),
      enabled: runtime.permissions.isEnabled(t.name)
    }))
  }));

  // ---------------------------------------------------------------------------
  // 操作日志
  // ---------------------------------------------------------------------------
  app.get<{ Querystring: Record<string, string | undefined> }>('/api/logs', async (req) => {
    const q = req.query;
    return {
      logs: runtime.auditLogger.list({
        limit: q.limit ? Number(q.limit) : undefined,
        offset: q.offset ? Number(q.offset) : undefined,
        tool: q.tool,
        source: (q.source as 'mcp' | 'web' | 'cli' | undefined) ?? undefined
      })
    };
  });

  // ---------------------------------------------------------------------------
  // 配置 / 权限
  // ---------------------------------------------------------------------------
  app.get('/api/settings', async () => ({
    config: runtime.configStore.snapshot(),
    permissions: {
      disabledTools: runtime.config.permissions.disabledTools,
      requireApprovalFor: runtime.config.permissions.requireApprovalFor,
      dryRunDefault: runtime.config.permissions.dryRunDefault
    },
    tools: toolSummaries().map((t) => ({
      name: t.name,
      description: t.description,
      riskLevel: runtime.permissions.getRiskLevel(t.name),
      enabled: runtime.permissions.isEnabled(t.name)
    }))
  }));

  app.put<{
    Body: { permissions?: { disabledTools?: string[]; requireApprovalFor?: string[]; dryRunDefault?: boolean } };
  }>('/api/settings', async (req, reply) => {
    const patch = req.body ?? {};
    if (patch.permissions === undefined) {
      return reply.code(400).send({ error: '仅支持更新 permissions 段' });
    }
    runtime.configStore.update({ permissions: patch.permissions });
    runtime.config = runtime.configStore.get();
    runtime.permissions = new PermissionManager(runtime.config);
    return { ok: true, config: runtime.configStore.snapshot() };
  });

  // ---------------------------------------------------------------------------
  // SSE：仓库变化推送
  // ---------------------------------------------------------------------------
  app.get('/api/events', async (req, reply) => {
    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    raw.write(': connected\n\n');

    const listener = (payload: unknown) => {
      raw.write(`event: repo-changed\ndata: ${JSON.stringify(payload)}\n\n`);
    };
    const logListener = () => {
      raw.write('event: log\ndata: {}\n\n');
    };
    runtime.eventBus.on('repo-changed', listener);
    runtime.eventBus.on('log', logListener);

    const keepAlive = setInterval(() => raw.write(': ping\n\n'), 15_000);

    req.raw.on('close', () => {
      clearInterval(keepAlive);
      runtime.eventBus.off('repo-changed', listener);
      runtime.eventBus.off('log', logListener);
    });
  });

  // ---------------------------------------------------------------------------
  // MCP Streamable HTTP
  // ---------------------------------------------------------------------------
  app.get('/mcp', async (req, reply) => {
    reply.hijack();
    await mcpHttp.handle(req.raw, reply.raw, undefined);
  });
  app.post('/mcp', async (req, reply) => {
    // fastify 预读并解析了请求体（req.body）；SDK transport 需要 parsedBody 透传
    // （handleRequest(req, res, parsedBody)），否则它再读 req.raw 时流已空，initialize 无响应。
    reply.hijack();
    await mcpHttp.handle(req.raw, reply.raw, req.body);
  });

  // SPA fallback（静态托管存在时）
  if (staticDir) {
    app.setNotFoundHandler(async (req, reply) => {
      if (req.url.startsWith('/api') || req.url.startsWith('/mcp')) {
        return reply.code(404).send({ error: 'Not Found' });
      }
      const index = path.join(staticDir, 'index.html');
      if (fs.existsSync(index)) {
        reply.type('text/html').send(fs.readFileSync(index, 'utf8'));
        return;
      }
      return reply.code(404).send({ error: 'Not Found' });
    });
  }

  const port = options.port ?? runtime.config.server.port;
  const host = options.host ?? runtime.config.server.host;
  if (!options.noListen) {
    await app.listen({ port, host });
  }

  return {
    app,
    close: async () => {
      mcpHttp.dispose();
      await app.close();
      disposeRuntime(runtime);
    }
  };
}

function toError(err: unknown): { code: string; message: string; requiredApproval?: boolean } {
  if (err instanceof GitOperationError) return { code: err.code, message: err.message };
  if (err instanceof RepoNotFoundError) return { code: 'REPO_NOT_FOUND', message: err.message };
  if (err instanceof Error) return { code: 'INTERNAL_ERROR', message: err.message.slice(0, 500) };
  return { code: 'INTERNAL_ERROR', message: String(err) };
}