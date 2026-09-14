/**
 * POST /api/chat 流式对话；POST /api/chat/confirm 令牌真执行或取消。
 * Vercel AI SDK 只出现在本目录。
 */
import type { FastifyInstance } from 'fastify';
import { streamText, tool, stepCountIs } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { applyLlmEnvOverrides, llmBaseUrl } from '@shaohui_jin/git-cockpit-core';
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
}
