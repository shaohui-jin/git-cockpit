import { defineStore } from 'pinia';
import * as api from '@/api/client';
import { ApiError } from '@/api/client';
import type { ChatConversationSummary, ChatLogMessage } from '@/api/types';
import type { ChatLine, PendingConfirm } from '@/components/chat/types';

const REPO_KEY = 'gc-chat-repo';
const ACTIVE_PREFIX = 'gc-chat-active:';

export function repoLeaf(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/').filter(Boolean);
  return parts[parts.length - 1] || path;
}

export function sameRepoPath(a: string, b: string): boolean {
  return normRepo(a) === normRepo(b);
}

function normRepo(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

function readStorage(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    /* sessionStorage 不可用时只留在内存 */
  }
}

function activeKey(path: string): string {
  return ACTIVE_PREFIX + normRepo(path);
}

function shouldStore(row: ChatLine): boolean {
  if (row.role === 'tool') return true;
  return Boolean(row.text.trim());
}

function toLine(message: ChatLogMessage): ChatLine {
  return {
    id: message.id,
    role: message.role,
    text: message.text,
    tool: message.tool ?? undefined,
    success: message.success ?? undefined
  };
}

let bootTask: Promise<string | null> | null = null;
let booted = false;

interface State {
  repoPath: string | null;
  conversationId: string | null;
  lines: ChatLine[];
  pending: PendingConfirm[];
  pendingByConv: Record<string, PendingConfirm[]>;
  streaming: boolean;
  confirming: boolean;
  dirty: boolean;
  savedCount: number;
  seq: number;
  loadGen: number;
  revealSeq: number;
}

/** 聊天自己的当前仓库和对话。工作台切换不会改这里。 */
export const useChatStore = defineStore('chat', {
  state: (): State => ({
    repoPath: readStorage(REPO_KEY),
    conversationId: null,
    lines: [],
    pending: [],
    pendingByConv: {},
    streaming: false,
    confirming: false,
    dirty: false,
    savedCount: 0,
    seq: 0,
    loadGen: 0,
    revealSeq: 0
  }),
  getters: {
    busy(state): boolean {
      return state.streaming || state.confirming || state.pending.length > 0;
    }
  },
  actions: {
    boot(fallback: string | null): Promise<string | null> {
      if (booted) return Promise.resolve(null);
      if (bootTask) return bootTask;
      const path = this.repoPath || fallback;
      if (!path) return Promise.resolve(null);
      bootTask = this.selectRepo(path).then((err) => {
        bootTask = null;
        if (!err) booted = true;
        return err;
      });
      return bootTask;
    },
    pushLine(partial: Omit<ChatLine, 'id'>): ChatLine {
      const row: ChatLine = { id: ++this.seq, ...partial };
      this.lines.push(row);
      this.dirty = true;
      return this.lines[this.lines.length - 1]!;
    },
    async flush(): Promise<string | null> {
      if (!this.dirty) return null;
      if (!this.repoPath || !this.conversationId) return '请先选择仓库';
      const rows = this.lines.slice(this.savedCount).filter(shouldStore);
      if (!rows.length) {
        this.savedCount = this.lines.length;
        this.dirty = false;
        return null;
      }
      try {
        const res = await api.appendChatMessages(this.conversationId, {
          repoPath: this.repoPath,
          messages: rows.map((row) => ({
            role: row.role,
            text: row.text,
            tool: row.tool ?? null,
            success: row.success ?? null
          }))
        });
        this.repoPath = res.conversation.repoPath;
        writeStorage(REPO_KEY, this.repoPath);
        writeStorage(activeKey(this.repoPath), this.conversationId);
        this.savedCount = this.lines.length;
        this.dirty = false;
        return null;
      } catch (err) {
        return err instanceof Error ? err.message : String(err);
      }
    },
    async selectRepo(path: string): Promise<string | null> {
      if (this.busy) return '正在回复或确认，请稍后再换仓库';
      if (this.conversationId && !this.dirty && this.repoPath && sameRepoPath(path, this.repoPath)) return null;
      if (this.dirty) {
        const err = await this.flush();
        if (err) return err;
      }
      const gen = ++this.loadGen;
      try {
        const detail = await this.lookupRepoThread(path);
        if (gen !== this.loadGen) return null;
        this.stashPending();
        if (!detail) {
          this.repoPath = path;
          writeStorage(REPO_KEY, path);
          this.forgetCurrent();
          return null;
        }
        this.applyDetail(detail);
        return null;
      } catch (err) {
        return err instanceof Error ? err.message : String(err);
      }
    },
    async startBlank(): Promise<string | null> {
      if (this.busy) return '正在回复或确认，请稍后再开新对话';
      if (!this.repoPath) return '请先选择仓库';
      if (this.dirty) {
        const err = await this.flush();
        if (err) return err;
      }
      this.stashPending();
      this.forgetCurrent();
      return null;
    },
    async openConversation(id: string): Promise<string | null> {
      if (this.busy) return '正在回复或确认，请稍后再打开这组对话';
      if (this.dirty) {
        const err = await this.flush();
        if (err) return err;
      }
      const gen = ++this.loadGen;
      try {
        const detail = await readConversation(id);
        if (gen !== this.loadGen) return null;
        if (!detail) return '对话不存在';
        this.stashPending();
        this.applyDetail(detail);
        this.revealSeq += 1;
        return null;
      } catch (err) {
        return err instanceof Error ? err.message : String(err);
      }
    },
    async removeConversation(id: string): Promise<string | null> {
      if (this.conversationId === id && this.busy) return '这组对话还在回复或确认，请稍后再删除';
      try {
        await api.deleteChatConversation(id);
      } catch (err) {
        return err instanceof Error ? err.message : String(err);
      }
      this.loadGen += 1;
      delete this.pendingByConv[id];
      if (this.conversationId === id) this.forgetCurrent();
      return null;
    },
    async lookupRepoThread(
      path: string
    ): Promise<{ conversation: ChatConversationSummary; messages: ChatLogMessage[] } | null> {
      const active = readStorage(activeKey(path));
      if (active) {
        const found = await readConversation(active);
        if (found && sameRepoPath(found.conversation.repoPath, path)) return found;
      }
      const { conversations } = await api.listChatConversations({ repoPath: path, limit: 1 });
      const latest = conversations[0];
      if (!latest) return null;
      return readConversation(latest.id);
    },
    applyDetail(detail: { conversation: ChatConversationSummary; messages: ChatLogMessage[] }): void {
      this.conversationId = detail.conversation.id;
      this.repoPath = detail.conversation.repoPath;
      writeStorage(REPO_KEY, this.repoPath);
      writeStorage(activeKey(this.repoPath), this.conversationId);
      this.lines = detail.messages.map(toLine);
      this.seq = this.lines.reduce((max, line) => Math.max(max, line.id), 0);
      this.savedCount = this.lines.length;
      this.dirty = false;
      this.pending = (this.pendingByConv[this.conversationId] ?? []).slice();
    },
    forgetCurrent(): void {
      this.conversationId = crypto.randomUUID();
      this.lines = [];
      this.pending = [];
      this.savedCount = 0;
      this.dirty = false;
      this.seq = 0;
      if (this.repoPath) writeStorage(activeKey(this.repoPath), this.conversationId);
    },
    stashPending(): void {
      if (!this.conversationId) return;
      if (this.pending.length) this.pendingByConv[this.conversationId] = this.pending.slice();
      else delete this.pendingByConv[this.conversationId];
    }
  }
});

async function readConversation(
  id: string
): Promise<{ conversation: ChatConversationSummary; messages: ChatLogMessage[] } | null> {
  try {
    return await api.getChatConversation(id);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}
