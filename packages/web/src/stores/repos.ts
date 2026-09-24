import { defineStore } from 'pinia';
import * as api from '@/api/client';
import type { OpenedRepo } from '@/api/types';

interface State {
  repos: OpenedRepo[];
  currentId: number | null;
  loading: boolean;
  error: string | null;
  healthOk: boolean | null;
  serverVersion: string | null;
}

/** 当前仓库记忆：刷新后恢复上次进入的仓库 */
const CURRENT_ID_KEY = 'git-cockpit:currentRepoId';

function readStoredId(): number | null {
  try {
    const n = Number(window.localStorage.getItem(CURRENT_ID_KEY));
    return Number.isInteger(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}
function storeId(id: number | null): void {
  try {
    if (id === null) window.localStorage.removeItem(CURRENT_ID_KEY);
    else window.localStorage.setItem(CURRENT_ID_KEY, String(id));
  } catch {
    /* localStorage 不可用时静默降级 */
  }
}

/** 仓库管理：最近打开列表、当前激活仓库 */
export const useReposStore = defineStore('repos', {
  state: (): State => ({
    repos: [],
    currentId: readStoredId(),
    loading: false,
    error: null,
    healthOk: null,
    serverVersion: null
  }),
  getters: {
    current(state): OpenedRepo | null {
      return state.repos.find((r) => r.id === state.currentId) ?? null;
    },
    currentPath(state): string | null {
      return state.repos.find((r) => r.id === state.currentId)?.path ?? null;
    }
  },
  actions: {
    async checkHealth(): Promise<boolean> {
      try {
        const h = await api.getHealth();
        this.healthOk = h.ok;
        this.serverVersion = h.version || null;
      } catch {
        this.healthOk = false;
        this.serverVersion = null;
      }
      return this.healthOk === true;
    },
    async load(): Promise<void> {
      this.loading = true;
      this.error = null;
      try {
        const { repos } = await api.listRepos();
        this.repos = repos;
        const stored = readStoredId();
        if (stored !== null && repos.some((r) => r.id === stored)) {
          this.currentId = stored;
        } else if (!this.currentId || !repos.some((r) => r.id === this.currentId)) {
          this.currentId = repos[0]?.id ?? null;
        }
        storeId(this.currentId);
      } catch (err) {
        this.error = err instanceof Error ? err.message : String(err);
      } finally {
        this.loading = false;
      }
    },
    async open(path: string): Promise<OpenedRepo> {
      const { repo } = await api.openRepo(path);
      await this.load();
      return repo;
    },
    async activate(id: number): Promise<OpenedRepo> {
      const { repo } = await api.activateRepo(id);
      this.currentId = id;
      storeId(id);
      await this.load();
      return repo;
    },
    async reorder(ids: number[]): Promise<void> {
      const byId = new Map(this.repos.map((r) => [r.id, r]));
      this.repos = ids.map((id) => byId.get(id)).filter((r): r is OpenedRepo => !!r);
      try {
        const { repos } = await api.reorderRepos(ids);
        this.repos = repos;
      } catch {
        await this.load();
      }
    },
    async remove(id: number): Promise<void> {
      await api.removeRepo(id);
      if (this.currentId === id) this.currentId = null;
      await this.load();
    },
    switchTo(id: number): void {
      this.currentId = id;
      storeId(id);
    }
  }
});
