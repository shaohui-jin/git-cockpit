import { defineStore } from 'pinia';
import * as api from '@/api/client';
import type { OpenedRepo } from '@/api/types';

interface State {
  repos: OpenedRepo[];
  currentId: number | null;
  loading: boolean;
  error: string | null;
  healthOk: boolean | null;
}

/** 仓库管理：最近打开列表、当前激活仓库 */
export const useReposStore = defineStore('repos', {
  state: (): State => ({
    repos: [],
    currentId: null,
    loading: false,
    error: null,
    healthOk: null
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
      } catch {
        this.healthOk = false;
      }
      return this.healthOk === true;
    },
    async load(): Promise<void> {
      this.loading = true;
      this.error = null;
      try {
        const { repos } = await api.listRepos();
        this.repos = repos;
        // 保持当前选择；若无选择则取最近打开
        if (!this.currentId || !repos.some((r) => r.id === this.currentId)) {
          this.currentId = repos[0]?.id ?? null;
        }
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
    async remove(id: number): Promise<void> {
      await api.removeRepo(id);
      if (this.currentId === id) this.currentId = null;
      await this.load();
    },
    switchTo(id: number): void {
      this.currentId = id;
    }
  }
});