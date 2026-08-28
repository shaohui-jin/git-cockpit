import { defineStore } from 'pinia';
import * as api from '@/api/client';
import type { BranchInfo, RemoteInfo } from '@/api/types';
import { buildBranchPanes } from '@/utils/branchTree';
import { useReposStore } from '@/stores/repos';

interface State {
  list: BranchInfo[];
  remotes: RemoteInfo[];
  repoId: number | null;
  loading: boolean;
}

let inflight: Promise<void> | null = null;

/** 当前仓库的分支：各页共用同一份列表，树由 utils/branchTree 生成，页面只做过滤。 */
export const useBranchesStore = defineStore('branches', {
  state: (): State => ({
    list: [],
    remotes: [],
    repoId: null,
    loading: false
  }),
  getters: {
    current(state): BranchInfo | null {
      return state.list.find((b) => b.current) ?? null;
    },
    locals(state): BranchInfo[] {
      return state.list.filter((b) => !b.remote);
    },
    remoteBranches(state): BranchInfo[] {
      return state.list.filter((b) => b.remote);
    },
    hasRemote(state): boolean {
      return state.remotes.length > 0 || state.list.some((b) => b.remote);
    },
    panes(state) {
      return buildBranchPanes(state.list, 'all');
    }
  },
  actions: {
    async load(): Promise<void> {
      if (inflight) {
        await inflight;
        if (this.repoId === useReposStore().currentId) return;
      }
      inflight = this.fetch().finally(() => {
        inflight = null;
      });
      return inflight;
    },
    async fetch(): Promise<void> {
      const id = useReposStore().currentId;
      if (id === null) {
        this.list = [];
        this.remotes = [];
        this.repoId = null;
        return;
      }
      if (this.repoId !== id) {
        this.list = [];
        this.remotes = [];
      }
      this.loading = true;
      try {
        const [{ branches }, remotes] = await Promise.all([api.listBranches(id), api.listRemotes(id)]);
        if (useReposStore().currentId !== id) return;
        this.list = branches;
        this.remotes = remotes;
        this.repoId = id;
      } catch {
        if (useReposStore().currentId === id && this.repoId !== id) {
          this.list = [];
          this.remotes = [];
        }
      } finally {
        this.loading = false;
      }
    }
  }
});
