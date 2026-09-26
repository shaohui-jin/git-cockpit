/**
 * 聊天流的统一事件。界面只消费这份结构。
 * `/api/chat` 的 SSE、本地 mock、以后的其它模型来源都收成这些事件。
 */
export interface ChatConfirmPreview {
  command: string;
  affectedFiles: string[];
  args?: string[];
  note?: string;
}

export type ChatEvent =
  | { type: 'delta'; text: string }
  | { type: 'tool'; tool: string; success: boolean }
  | { type: 'confirm'; token: string; tool: string; preview: ChatConfirmPreview }
  | { type: 'error'; error: string }
  | { type: 'done' };

export function parseChatSseData(event: string, data: unknown): ChatEvent | null {
  if (event === 'done') return { type: 'done' };
  if (!data || typeof data !== 'object') return null;
  const row = data as Record<string, unknown>;
  if (event === 'delta' && typeof row.text === 'string') return { type: 'delta', text: row.text };
  if (event === 'tool' && typeof row.tool === 'string') {
    return { type: 'tool', tool: row.tool, success: row.success !== false };
  }
  if (event === 'confirm' && typeof row.token === 'string' && typeof row.tool === 'string') {
    const preview = row.preview && typeof row.preview === 'object' ? (row.preview as Record<string, unknown>) : {};
    return {
      type: 'confirm',
      token: row.token,
      tool: row.tool,
      preview: {
        command: typeof preview.command === 'string' ? preview.command : '',
        affectedFiles: Array.isArray(preview.affectedFiles) ? preview.affectedFiles.map((f) => String(f)) : [],
        args: Array.isArray(preview.args) ? preview.args.map((a) => String(a)) : undefined,
        note: typeof preview.note === 'string' ? preview.note : undefined
      }
    };
  }
  if (event === 'error') {
    return { type: 'error', error: typeof row.error === 'string' ? row.error : '对话出错' };
  }
  return null;
}

const sseEncoder = new TextEncoder();

export function encodeSseFrame(event: string, data: unknown): Uint8Array {
  return sseEncoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export function encodeChatEvent(event: ChatEvent): Uint8Array {
  if (event.type === 'delta') return encodeSseFrame('delta', { text: event.text });
  if (event.type === 'tool') return encodeSseFrame('tool', { tool: event.tool, success: event.success });
  if (event.type === 'confirm') {
    return encodeSseFrame('confirm', { token: event.token, tool: event.tool, preview: event.preview });
  }
  if (event.type === 'error') return encodeSseFrame('error', { error: event.error });
  return encodeSseFrame('done', {});
}

/** 读 SSE 字节流。半包先留下，解出一帧就回调一次。 */
export async function readChatByteStream(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: ChatEvent) => void
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let event = 'message';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) {
      if (line.startsWith('event:')) {
        event = line.slice(6).trim();
        continue;
      }
      if (!line.startsWith('data:')) continue;
      const raw = line.slice(5).trim();
      if (!raw) continue;
      let data: unknown = raw;
      try {
        data = JSON.parse(raw);
      } catch {
        /* 留到下一帧 */
      }
      const parsed = parseChatSseData(event, data);
      if (parsed) onEvent(parsed);
      event = 'message';
    }
  }
}
