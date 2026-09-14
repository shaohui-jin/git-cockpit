import type { Runtime } from '../runtime.ts';
import { RepoNotFoundError } from '@shaohui_jin/git-cockpit-core';

const TTL_MS = 24 * 60 * 60 * 1000;

interface ChatSession {
  repoPath: string;
  createdAt: number;
}

export class ChatSessions {
  private readonly sessions = new Map<string, ChatSession>();

  get(id: string): ChatSession | null {
    this.gc();
    return this.sessions.get(id) ?? null;
  }

  pin(id: string, repoPath: string): ChatSession {
    this.gc();
    const row: ChatSession = { repoPath, createdAt: Date.now() };
    this.sessions.set(id, row);
    return row;
  }

  delete(id: string): void {
    this.sessions.delete(id);
  }

  private gc(): void {
    const now = Date.now();
    for (const [k, v] of this.sessions) {
      if (now - v.createdAt > TTL_MS) this.sessions.delete(k);
    }
  }
}

export type ChatRepoResolve =
  | { ok: true; repoPath: string }
  | { ok: false; status: number; error: string; code: string };

/**
 * 会话钉死已打开的仓。模型参数里的 repoPath 另由 sanitizeChatArgs 丢掉。
 * 未打开的路径不会在这里 open。
 */
export function resolveChatRepo(
  runtime: Runtime,
  sessions: ChatSessions,
  sessionId: string | undefined,
  requestedRaw: string
): ChatRepoResolve {
  const requested = requestedRaw.trim();
  const sid = sessionId?.trim();
  if (sid) {
    const existing = sessions.get(sid);
    if (existing) {
      if (requested) {
        const opened = tryOpenedPath(runtime, requested);
        if (!opened || opened !== existing.repoPath) {
          return {
            ok: false,
            status: 409,
            error: '本会话已钉在另一个仓库。请新开会话或切回原仓库。',
            code: 'SESSION_REPO_PINNED'
          };
        }
      }
      const still = tryOpenedPath(runtime, existing.repoPath);
      if (!still) {
        sessions.delete(sid);
        return { ok: false, status: 400, error: '会话仓库已关闭，请先在工作台打开', code: 'REPO_NOT_OPEN' };
      }
      return { ok: true, repoPath: still };
    }
  }
  if (!requested) {
    return { ok: false, status: 400, error: '请先选择仓库', code: 'NO_ACTIVE_REPO' };
  }
  const opened = tryOpenedPath(runtime, requested);
  if (!opened) {
    return { ok: false, status: 400, error: '请先在工作台打开该仓库', code: 'REPO_NOT_OPEN' };
  }
  if (sid) sessions.pin(sid, opened);
  return { ok: true, repoPath: opened };
}

function tryOpenedPath(runtime: Runtime, repoPath: string): string | null {
  try {
    return runtime.repoManager.getByPath(repoPath).service.repoPath;
  } catch (err) {
    if (err instanceof RepoNotFoundError) return null;
    throw err;
  }
}
