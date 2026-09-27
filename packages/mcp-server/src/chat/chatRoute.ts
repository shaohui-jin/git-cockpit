/**
 * POST /api/chat 流式对话；POST /api/chat/confirm 令牌真执行或取消。
 * Vercel AI SDK 只出现在本目录。
 */
import type { FastifyInstance } from 'fastify';
import { streamText, tool, stepCountIs } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import {
  applyLlmEnvOverrides,
  isChatLogRole,
  llmBaseUrl,
  RepoNotFoundError,
  type ChatLogMessageInput
} from '@shaohui_jin/git-cockpit-core';
import type { Runtime } from '../runtime.ts';
import { ConfirmGate } from './confirmGate.ts';
import { ChatSessions, resolveChatRepo } from './session.ts';
import { CHAT_ALLOWED_TOOLS } from './toolPolicy.ts';
import { buildChatSystemPrompt } from './systemPrompt.ts';
import { cancelChatWrite, chatZodOmit, confirmChatWrite, runChatTool } from './runTool.ts';
import { TOOL_DEF_MAP } from '../tools/index.ts';

const gates = new WeakMap<Runtime, ConfirmGate>();
const sessionMaps = new WeakMap<Runtime, ChatSessions>();

function gateFor(runtime: Runtime): ConfirmGate {
  let g = gates.get(runtime);
  if (!g) {
    g = new ConfirmGate();
    gates.set(runtime, g);
  }
  return g;
}

function sessionsFor(runtime: Runtime): ChatSessions {
  let s = sessionMaps.get(runtime);
  if (!s) {
    s = new ChatSessions();
    sessionMaps.set(runtime, s);
  }
  return s;
}

type ChatMessage = { role: 'user' | 'assistant' | 'system'; content: string };

function writeSse(raw: NodeJS.WritableStream, event: string, data: unknown): void {
  raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export function registerChatRoutes(app: FastifyInstance, runtime: Runtime): void {
  app.post<{
    Body: { messages?: ChatMessage[]; repoPath?: string; sessionId?: string };
  }>('/api/chat', async (req, reply) => {
    const llm = applyLlmEnvOverrides(runtime.configStore.get().llm);
    const apiKey = llm.apiKey.trim();
    if (!apiKey) {
      return reply.code(400).send({ error: '请先在设置里填写模型 API Key', code: 'LLM_NOT_CONFIGURED' });
    }
    const messages = Array.isArray(req.body?.messages) ? req.body.messages : [];
    if (!messages.length) {
      return reply.code(400).send({ error: 'messages 不能为空' });
    }
    const pinned = resolveChatRepo(
      runtime,
      sessionsFor(runtime),
      req.body?.sessionId,
      typeof req.body?.repoPath === 'string' ? req.body.repoPath : ''
    );
    if (!pinned.ok) {
      return reply.code(pinned.status).send({ error: pinned.error, code: pinned.code });
    }
    const repoPath = pinned.repoPath;

    const gate = gateFor(runtime);
    const openai = createOpenAI({
      apiKey,
      ...(llm.baseUrl.trim() ? { baseURL: llmBaseUrl(llm) } : {})
    });
    const tools: Record<string, unknown> = {};
    for (const name of CHAT_ALLOWED_TOOLS) {
      const def = TOOL_DEF_MAP.get(name);
      if (!def) continue;
      tools[name] = tool({
        description: def.description,
        inputSchema: chatZodOmit(def.schema),
        execute: async (input: Record<string, unknown>) => {
          const run = await runChatTool(runtime, gate, name, input ?? {}, repoPath);
          if (run.pendingConfirm && run.token && run.preview) {
            writeSse(reply.raw, 'confirm', {
              token: run.token,
              tool: run.tool,
              preview: run.preview
            });
          } else {
            writeSse(reply.raw, 'tool', { tool: run.tool, success: run.success, pendingConfirm: false });
          }
          return run.modelText;
        }
      });
    }

    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    });

    try {
      // AI SDK 7 的 ToolSet 泛型过严，工具表在运行时由白名单锁死。
      const result = streamText({
        model: openai(llm.model || 'gpt-4.1'),
        system: buildChatSystemPrompt(),
        messages,
        tools: tools as never,
        toolsContext: {} as never,
        stopWhen: stepCountIs(8)
      } as never) as { fullStream: AsyncIterable<{ type: string; text?: string; error?: unknown }> };
      for await (const part of result.fullStream) {
        if (part.type === 'text-delta') {
          const text =
            'text' in part && typeof part.text === 'string'
              ? part.text
              : 'delta' in part && typeof (part as { delta?: string }).delta === 'string'
                ? (part as { delta: string }).delta
                : '';
          if (text) writeSse(reply.raw, 'delta', { text });
        }
        if (part.type === 'error') {
          const err = 'error' in part ? part.error : part;
          writeSse(reply.raw, 'error', { error: err instanceof Error ? err.message : String(err) });
        }
      }
      writeSse(reply.raw, 'done', {});
    } catch (err) {
      writeSse(reply.raw, 'error', { error: err instanceof Error ? err.message : String(err) });
      writeSse(reply.raw, 'done', {});
    } finally {
      reply.raw.end();
    }
  });

  app.post<{ Body: { token?: string; cancel?: boolean } }>('/api/chat/confirm', async (req, reply) => {
    const token = typeof req.body?.token === 'string' ? req.body.token.trim() : '';
    if (!token) return reply.code(400).send({ error: '缺少确认令牌' });
    if (req.body?.cancel) {
      const out = await cancelChatWrite(gateFor(runtime), token);
      if (!out.ok) return reply.code(409).send(out);
      return out;
    }
    const out = await confirmChatWrite(runtime, gateFor(runtime), token);
    if (!out.ok) return reply.code(409).send(out);
    return out;
  });

  app.get<{ Querystring: { repoPath?: string; limit?: string } }>('/api/chat/conversations', async (req) => {
    let repoPath = typeof req.query.repoPath === 'string' ? req.query.repoPath.trim() : '';
    if (repoPath) repoPath = openedRepoPath(runtime, repoPath) ?? repoPath;
    return {
      conversations: runtime.chatLog.list({
        repoPath: repoPath || undefined,
        limit: clampLimit(req.query.limit)
      })
    };
  });

  app.get<{ Params: { id: string } }>('/api/chat/conversations/:id', async (req, reply) => {
    const id = validConversationId(req.params.id);
    if (!id) return reply.code(400).send({ error: '对话 id 无效' });
    const found = runtime.chatLog.get(id);
    if (!found) return reply.code(404).send({ error: '对话不存在' });
    return found;
  });

  app.delete<{ Params: { id: string } }>('/api/chat/conversations/:id', async (req, reply) => {
    const id = validConversationId(req.params.id);
    if (!id) return reply.code(400).send({ error: '对话 id 无效' });
    if (!runtime.chatLog.remove(id)) return reply.code(404).send({ error: '对话不存在' });
    return { ok: true };
  });

  app.post<{
    Params: { id: string };
    Body: { repoPath?: string; messages?: ChatLogMessageInput[] };
  }>('/api/chat/conversations/:id/messages', async (req, reply) => {
    const id = validConversationId(req.params.id);
    if (!id) return reply.code(400).send({ error: '对话 id 无效' });
    const requested = typeof req.body?.repoPath === 'string' ? req.body.repoPath.trim() : '';
    if (!requested) return reply.code(400).send({ error: '请先选择仓库', code: 'NO_ACTIVE_REPO' });
    const repoPath = openedRepoPath(runtime, requested);
    if (!repoPath) {
      return reply.code(400).send({ error: '请先在工作台打开该仓库', code: 'REPO_NOT_OPEN' });
    }
    const parsed = parseChatLogMessages(req.body?.messages);
    if (!parsed.ok) return reply.code(400).send({ error: parsed.error });
    const saved = runtime.chatLog.append(id, repoPath, parsed.messages);
    if (!saved.ok) {
      return reply.code(409).send({ error: '这组对话属于另一个仓库', code: 'CONVERSATION_REPO_MISMATCH' });
    }
    return { conversation: saved.conversation };
  });
}

const CONVERSATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_MESSAGES = 20;
const MAX_TEXT = 100_000;

function validConversationId(raw: string): string | null {
  const id = raw.trim();
  return CONVERSATION_ID.test(id) ? id : null;
}

function clampLimit(raw: string | undefined): number {
  const n = raw == null || raw === '' ? 100 : Number(raw);
  if (!Number.isFinite(n)) return 100;
  return Math.min(Math.max(Math.floor(n), 1), 200);
}

function openedRepoPath(runtime: Runtime, repoPath: string): string | null {
  try {
    return runtime.repoManager.getByPath(repoPath).service.repoPath;
  } catch (err) {
    if (err instanceof RepoNotFoundError) return null;
    throw err;
  }
}

function parseChatLogMessages(
  raw: unknown
): { ok: true; messages: ChatLogMessageInput[] } | { ok: false; error: string } {
  if (!Array.isArray(raw) || raw.length === 0) return { ok: false, error: 'messages 不能为空' };
  if (raw.length > MAX_MESSAGES) return { ok: false, error: '一次最多追加 20 条消息' };
  const messages: ChatLogMessageInput[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') return { ok: false, error: '消息格式无效' };
    const row = item as { role?: unknown; text?: unknown; tool?: unknown; success?: unknown };
    if (typeof row.role !== 'string' || !isChatLogRole(row.role)) return { ok: false, error: '消息角色无效' };
    if (typeof row.text !== 'string' || row.text.length > MAX_TEXT) return { ok: false, error: '消息正文无效' };
    if (row.tool != null && typeof row.tool !== 'string') return { ok: false, error: '工具名无效' };
    if (row.success != null && typeof row.success !== 'boolean') return { ok: false, error: '工具结果无效' };
    messages.push({
      role: row.role,
      text: row.text,
      tool: typeof row.tool === 'string' ? row.tool : null,
      success: typeof row.success === 'boolean' ? row.success : null
    });
  }
  return { ok: true, messages };
}
