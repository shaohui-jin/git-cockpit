/**
 * stdio -> daemon 的 MCP 适配器。
 *
 * 正常情况下它不创建 Runtime、不打开 SQLite，只把一个客户端的 MCP session
 * 转发到唯一 daemon。HTTP bridge 具备：超时、有限重试、有限队列、异常隔离，
 * 并在 initialize 后订阅 GET /mcp SSE，把服务端主动通知写回 stdout。
 */
import { formatDaemonUrl } from './daemonEndpoint.ts';

const SECRET_HEADER = 'X-Git-Cockpit-Secret';
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_QUEUE = 100;
const DEFAULT_RECONNECT_ATTEMPTS = 2;
const DEFAULT_RECONNECT_DELAY_MS = 250;

export interface McpForwarderOptions {
  host: string;
  port: number;
  secret: string;
  timeoutMs?: number;
  maxQueue?: number;
  reconnectAttempts?: number;
  reconnectDelayMs?: number;
}

interface JsonRpcMessage {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
}

export interface McpForwarder {
  preflight(): Promise<void>;
  forward(line: string): Promise<string | null>;
  sessionId(): string;
  close(): Promise<void>;
}

function parseMessage(line: string): JsonRpcMessage | null {
  try {
    const value = JSON.parse(line) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    return value as JsonRpcMessage;
  } catch {
    return null;
  }
}

function errorResponse(id: string | number | null, message: string): string {
  return JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message }, id: id ?? null });
}

function extractSsePayload(text: string): string | null {
  let last: string | null = null;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line.startsWith('data:')) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === '[DONE]') continue;
    try {
      const parsed = JSON.parse(payload) as JsonRpcMessage;
      if (parsed && typeof parsed === 'object') last = payload;
    } catch {
      /* 忽略非 JSON data 行 */
    }
  }
  return last;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function timeoutSignal(ms: number): { signal: AbortSignal; cancel: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`请求超时（${ms}ms）`)), ms);
  return { signal: controller.signal, cancel: () => clearTimeout(timer) };
}

export function createMcpForwarder(options: McpForwarderOptions): McpForwarder {
  const url = formatDaemonUrl(options.host, options.port, '/mcp');
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const reconnectAttempts = options.reconnectAttempts ?? DEFAULT_RECONNECT_ATTEMPTS;
  const reconnectDelayMs = options.reconnectDelayMs ?? DEFAULT_RECONNECT_DELAY_MS;
  let sessionId = '';
  let sseStarted = false;
  let closed = false;
  let sseAbort: AbortController | null = null;

  const baseHeaders = (): Record<string, string> => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      // SDK 要求 POST 的 Accept 同时列出两者，否则 406
      Accept: 'application/json, text/event-stream',
      [SECRET_HEADER]: options.secret
    };
    if (sessionId) headers['Mcp-Session-Id'] = sessionId;
    return headers;
  };

  const fetchWithRetry = async (init: RequestInit): Promise<Response> => {
    let lastError: unknown;
    for (let attempt = 0; attempt <= reconnectAttempts; attempt += 1) {
      const timed = timeoutSignal(timeoutMs);
      try {
        const response = await fetch(url, { ...init, signal: timed.signal });
        if (response.status >= 500 && response.status <= 504 && attempt < reconnectAttempts) {
          await response.arrayBuffer().catch(() => undefined);
          await wait(reconnectDelayMs * (attempt + 1));
          continue;
        }
        return response;
      } catch (err) {
        lastError = err;
        if (attempt >= reconnectAttempts) break;
        await wait(reconnectDelayMs * (attempt + 1));
      } finally {
        timed.cancel();
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  };

  const writeSseEvent = (data: string) => {
    const payload = extractSsePayload(`data: ${data}`);
    if (payload && !closed) process.stdout.write(`${payload}\n`);
  };

  const pumpSse = async (): Promise<void> => {
    // daemon 彻底不可达时不要无限重连：连续失败到上限就停，避免空转刷日志。
    const maxFailures = 5;
    let failures = 0;
    while (!closed && sessionId) {
      const controller = new AbortController();
      sseAbort = controller;
      try {
        const res = await fetch(url, {
          method: 'GET',
          headers: {
            Accept: 'text/event-stream',
            [SECRET_HEADER]: options.secret,
            'Mcp-Session-Id': sessionId
          },
          signal: controller.signal
        });
        if (!res.ok || !res.body) {
          // 401/403/404 说明鉴权或会话已失效，重连没有意义
          if (res.status === 401 || res.status === 403 || res.status === 404) return;
          failures += 1;
          if (failures >= maxFailures) return;
          await wait(reconnectDelayMs);
          continue;
        }
        failures = 0;
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        while (!closed) {
          const chunk = await reader.read();
          if (chunk.done) break;
          buffer += decoder.decode(chunk.value, { stream: true });
          let split = buffer.indexOf('\n\n');
          while (split >= 0) {
            const event = buffer.slice(0, split);
            buffer = buffer.slice(split + 2);
            const data = event
              .split(/\r?\n/)
              .filter((line) => line.startsWith('data:'))
              .map((line) => line.slice(5).trim())
              .join('\n');
            if (data) writeSseEvent(data);
            split = buffer.indexOf('\n\n');
          }
        }
        if (!closed) await wait(reconnectDelayMs);
      } catch (err) {
        if (closed) return;
        failures += 1;
        if (failures >= maxFailures) {
          const detail = err instanceof Error ? err.message : String(err);
          process.stderr.write(
            `[git-cockpit] MCP 主动通知通道已断开（连续 ${failures} 次失败：${detail}）；请求-响应仍可用。\n`
          );
          return;
        }
        await wait(reconnectDelayMs);
      } finally {
        if (sseAbort === controller) sseAbort = null;
      }
    }
  };

  const ensureSse = () => {
    if (sseStarted || !sessionId) return;
    sseStarted = true;
    void pumpSse();
  };

  return {
    sessionId: () => sessionId,

    async preflight(): Promise<void> {
      let res: Response;
      try {
        // GET 无 session 会由 MCP handler 返回 400，但不会创建 transport；鉴权仍会执行。
        res = await fetchWithRetry({
          method: 'GET',
          headers: { Accept: 'text/event-stream', [SECRET_HEADER]: options.secret }
        });
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        throw new Error(`无法连接 daemon（${detail}）`);
      }
      await res.text().catch(() => '');
      if (res.status === 401) throw new Error('daemon 拒绝密钥（HTTP 401），请确认两端使用同一数据目录');
      if (res.status === 403) throw new Error('daemon 拒绝请求来源（HTTP 403），Host 校验未通过');
      if (res.status !== 400) throw new Error(`daemon MCP 预检失败（HTTP ${res.status}）`);
    },

    async forward(line: string): Promise<string | null> {
      const message = parseMessage(line);
      if (!message) return errorResponse(null, 'Invalid JSON-RPC message');

      let res: Response;
      try {
        res = await fetchWithRetry({ method: 'POST', headers: baseHeaders(), body: line });
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        process.stderr.write(`[git-cockpit] 转发到 daemon 失败：${detail}\n`);
        return message.id === undefined || message.id === null ? null : errorResponse(message.id, `无法连接 daemon：${detail}`);
      }

      const sid = res.headers.get('mcp-session-id');
      if (sid) {
        sessionId = sid;
        ensureSse();
      }

      const raw = await res.text();
      const text = raw.trim();
      if (text) {
        const contentType = res.headers.get('content-type') ?? '';
        const payload = contentType.includes('text/event-stream') ? extractSsePayload(text) : text;
        if (payload) return payload;
      }
      if (!res.ok && message.id !== undefined && message.id !== null) {
        return errorResponse(message.id, `daemon 返回 HTTP ${res.status}`);
      }
      return null;
    },

    async close(): Promise<void> {
      closed = true;
      sseAbort?.abort();
      if (sessionId) {
        const timed = timeoutSignal(timeoutMs);
        try {
          await fetch(url, {
            method: 'DELETE',
            headers: { Accept: 'application/json', [SECRET_HEADER]: options.secret, 'Mcp-Session-Id': sessionId },
            signal: timed.signal
          });
        } catch {
          /* daemon 已断开时无需阻塞客户端退出 */
        } finally {
          timed.cancel();
        }
      }
    }
  };
}

export async function startMcpBridge(options: McpForwarderOptions): Promise<void> {
  const forwarder = createMcpForwarder(options);
  await forwarder.preflight();
  let buffer = '';
  let pending = 0;
  let tail: Promise<void> = Promise.resolve();
  const maxQueue = options.maxQueue ?? DEFAULT_MAX_QUEUE;

  const enqueue = (line: string) => {
    if (pending >= maxQueue) {
      const message = parseMessage(line);
      if (message?.id !== undefined && message.id !== null) {
        process.stdout.write(`${errorResponse(message.id, `MCP bridge 队列已满（上限 ${maxQueue}）`)}\n`);
      }
      return;
    }
    pending += 1;
    tail = tail
      .then(async () => {
        try {
          const out = await forwarder.forward(line);
          if (out) process.stdout.write(`${out}\n`);
        } catch (err) {
          const message = parseMessage(line);
          if (message?.id !== undefined && message.id !== null) {
            process.stdout.write(`${errorResponse(message.id, err instanceof Error ? err.message : String(err))}\n`);
          }
        } finally {
          pending -= 1;
        }
      }, async () => {
        pending -= 1;
      });
  };

  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk: string) => {
    buffer += chunk;
    let idx = buffer.indexOf('\n');
    while (idx >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (line) enqueue(line);
      idx = buffer.indexOf('\n');
    }
  });
  process.stdin.resume();

  try {
    await new Promise<void>((resolve) => {
      const done = () => resolve();
      process.stdin.on('end', done);
      process.stdin.on('close', done);
      process.once('SIGINT', done);
      process.once('SIGTERM', done);
    });
    await tail;
  } finally {
    await forwarder.close();
  }
}
