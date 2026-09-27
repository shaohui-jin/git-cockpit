import { DatabaseSync } from 'node:sqlite';

export type ChatLogRole = 'user' | 'assistant' | 'system' | 'tool';

export interface ChatLogMessageInput {
  role: ChatLogRole;
  text: string;
  tool?: string | null;
  success?: boolean | null;
}

export interface ChatLogMessage {
  id: number;
  conversationId: string;
  role: ChatLogRole;
  text: string;
  tool: string | null;
  success: boolean | null;
  seq: number;
  createdAt: string;
}

export interface ChatConversation {
  id: string;
  repoPath: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

const ROLES = new Set<ChatLogRole>(['user', 'assistant', 'system', 'tool']);
const TITLE_LIMIT = 40;

export function isChatLogRole(role: string): role is ChatLogRole {
  return ROLES.has(role as ChatLogRole);
}

/** 对话记录：一组对话加其中的消息。与操作审计分开存。 */
export class ChatLogStore {
  constructor(private readonly db: DatabaseSync) {}

  list(opts: { repoPath?: string; limit?: number } = {}): ChatConversation[] {
    const limit = clampLimit(opts.limit, 100);
    const repoPath = opts.repoPath?.trim() ?? '';
    const where = repoPath ? 'WHERE c.repo_path = ?' : '';
    const params: (string | number)[] = [];
    if (repoPath) params.push(repoPath);
    params.push(limit);
    const rows = this.db
      .prepare(
        `SELECT c.*,
           (SELECT COUNT(*) FROM chat_messages m WHERE m.conversation_id = c.id) AS message_count
         FROM chat_conversations c
         ${where}
         ORDER BY c.updated_at DESC, c.id DESC
         LIMIT ?`
      )
      .all(...params) as Record<string, unknown>[];
    return rows.map((r) => this.rowToConversation(r));
  }

  get(id: string): { conversation: ChatConversation; messages: ChatLogMessage[] } | null {
    const row = this.db.prepare('SELECT * FROM chat_conversations WHERE id = ?').get(id) as
      Record<string, unknown> | undefined;
    if (!row) return null;
    const count = this.db.prepare('SELECT COUNT(*) AS n FROM chat_messages WHERE conversation_id = ?').get(id) as {
      n: number;
    };
    const messages = this.db
      .prepare('SELECT * FROM chat_messages WHERE conversation_id = ? ORDER BY seq ASC, id ASC')
      .all(id) as Record<string, unknown>[];
    return {
      conversation: this.rowToConversation({ ...row, message_count: count.n }),
      messages: messages.map((m) => this.rowToMessage(m))
    };
  }

  /**
   * 追加一轮可见消息。对话不存在则创建。已有对话的仓库路径必须一致。
   */
  append(
    id: string,
    repoPath: string,
    messages: ChatLogMessageInput[]
  ): { ok: true; conversation: ChatConversation } | { ok: false; code: 'MISMATCH' } {
    const now = new Date().toISOString();
    const existing = this.db.prepare('SELECT repo_path, title FROM chat_conversations WHERE id = ?').get(id) as
      { repo_path: string; title: string } | undefined;
    if (existing && existing.repo_path !== repoPath) return { ok: false, code: 'MISMATCH' };

    this.db.exec('BEGIN');
    try {
      if (!existing) {
        this.db
          .prepare(
            'INSERT INTO chat_conversations (id, repo_path, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
          )
          .run(id, repoPath, '', now, now);
      }
      const seqRow = this.db
        .prepare('SELECT COALESCE(MAX(seq), 0) AS n FROM chat_messages WHERE conversation_id = ?')
        .get(id) as { n: number };
      let seq = Number(seqRow.n);
      let title = existing?.title ?? '';
      const insert = this.db.prepare(
        `INSERT INTO chat_messages (conversation_id, role, text, tool, success, seq, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      );
      for (const message of messages) {
        seq += 1;
        if (!title && message.role === 'user') title = chatTitleFrom(message.text);
        insert.run(
          id,
          message.role,
          message.text,
          message.tool?.trim() ? message.tool.trim() : null,
          message.success == null ? null : message.success ? 1 : 0,
          seq,
          now
        );
      }
      this.db.prepare('UPDATE chat_conversations SET title = ?, updated_at = ? WHERE id = ?').run(title, now, id);
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
    const saved = this.get(id);
    if (!saved) throw new Error('对话写入后未能读回');
    return { ok: true, conversation: saved.conversation };
  }

  remove(id: string): boolean {
    this.db.exec('BEGIN');
    try {
      this.db.prepare('DELETE FROM chat_messages WHERE conversation_id = ?').run(id);
      const info = this.db.prepare('DELETE FROM chat_conversations WHERE id = ?').run(id);
      this.db.exec('COMMIT');
      return Number(info.changes) > 0;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  private rowToConversation(r: Record<string, unknown>): ChatConversation {
    return {
      id: String(r.id),
      repoPath: String(r.repo_path),
      title: String(r.title ?? ''),
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at),
      messageCount: Number(r.message_count ?? 0)
    };
  }

  private rowToMessage(r: Record<string, unknown>): ChatLogMessage {
    const success = r.success == null ? null : Number(r.success) !== 0;
    return {
      id: Number(r.id),
      conversationId: String(r.conversation_id),
      role: String(r.role) as ChatLogRole,
      text: String(r.text ?? ''),
      tool: r.tool == null ? null : String(r.tool),
      success,
      seq: Number(r.seq),
      createdAt: String(r.created_at)
    };
  }
}

function clampLimit(limit: number | undefined, fallback: number): number {
  if (limit == null || !Number.isFinite(limit)) return fallback;
  return Math.min(Math.max(Math.floor(limit), 1), 200);
}

function chatTitleFrom(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  const chars = [...flat];
  if (!chars.length) return '';
  if (chars.length <= TITLE_LIMIT) return flat;
  return `${chars.slice(0, TITLE_LIMIT).join('')}…`;
}
