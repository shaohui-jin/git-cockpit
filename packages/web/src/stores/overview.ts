import { defineStore } from 'pinia';
import * as api from '@/api/client';
import type { OpenedRepo, RepoOverview } from '@/api/types';

/** 单条 overview 缓存有效期（切页复用；过期再 refresh） */
export const OVERVIEW_MAX_AGE_MS = 45_000;

/** 超过此数量仍走全量 API，避免 HTTP 往返过多 */
const BULK_OVERVIEW_THRESHOLD = 4;

const FETCH_CONCURRENCY = 4;

export interface OverviewCacheEntry {
  data: RepoOverview;
  fetchedAt: number;
}

interface RefreshOptions {
  force?: boolean;
  maxAge?: number;
  /** 有缓存时后台更新（A2），不挡 UI */
  background?: boolean;
}

interface State {
  /** repoId → 脉搏缓存 */
  entries: Record<number, OverviewCacheEntry>;
  /** 无任何缓存时的首次加载 */
  loading: boolean;
  /** 后台 refresh（A2） */
  refreshing: boolean;
}

let inflight: Promise<void> | null = null;

function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').toLowerCase();
}

function isExpired(entry: OverviewCacheEntry | undefined, maxAge: number): boolean {
  return !entry || Date.now() - entry.fetchedAt >= maxAge;
}

async function mapPool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]!);
    }
  }
  const workers = Math.min(n, items.length);
  await Promise.all(Array.from({ length: workers }, () => worker()));
  return out;
}

/** 按 id 拉脉搏：少量走单仓 API，多量走全量 pick */
async function fetchOverviewsForIds(ids: number[]): Promise<RepoOverview[]> {
  if (!ids.length) return [];
  if (ids.length === 1) {
    const { overview } = await api.fetchRepoOverview(ids[0]!);
    return [overview];
  }
  if (ids.length > BULK_OVERVIEW_THRESHOLD) {
    const targetSet = new Set(ids);
    const { repos } = await api.listOverview();
    return repos.filter((r) => r.id != null && targetSet.has(r.id));
  }
  return mapPool(ids, FETCH_CONCURRENCY, async (id) => {
    const { overview } = await api.fetchRepoOverview(id);
    return overview;
  });
}

export const useOverviewStore = defineStore('overview', {
  state: (): State => ({
    entries: {},
    loading: false,
    refreshing: false
  }),
  getters: {
    hasCache(state): boolean {
      return Object.keys(state.entries).length > 0;
    },
    overviewOf(state) {
      return (path: string): RepoOverview | undefined => {
        const key = normalizePath(path);
        for (const entry of Object.values(state.entries)) {
          if (normalizePath(entry.data.path) === key) return entry.data;
        }
        return undefined;
      };
    },
    byId(state) {
      return (id: number): RepoOverview | undefined => state.entries[id]?.data;
    }
  },
  actions: {
    /** 删仓：立即移除 map key */
    remove(repoIds: number[]): void {
      for (const id of repoIds) delete this.entries[id];
    },

    /** 与 repos 列表对齐，删掉已不在列表里的 key */
    prune(validIds: number[]): void {
      const keep = new Set(validIds);
      for (const key of Object.keys(this.entries)) {
        const id = Number(key);
        if (!keep.has(id)) delete this.entries[id];
      }
    },

    /** 新开仓占位，避免卡片短暂空白 */
    setPlaceholder(repo: OpenedRepo): void {
      const name =
        repo.path
          .replace(/[\\/]+$/, '')
          .split(/[\\/]/)
          .pop() || repo.path;
      this.entries[repo.id] = {
        data: {
          id: repo.id,
          path: repo.path,
          name,
          available: true,
          current: '…',
          tracking: null,
          ahead: 0,
          behind: 0,
          dirtyCount: 0,
          conflictCount: 0,
          operation: 'none',
          tempMergeBranchCount: 0,
          activityStart: '',
          activity: [],
          activityTotal: 0,
          lastOpenedAt: repo.lastOpenedAt
        },
        fetchedAt: 0
      };
    },

    /** 新增：map 无 key 则 placeholder + 拉取 */
    async ensure(repoIds: number[], repos: OpenedRepo[]): Promise<void> {
      const missing = repoIds.filter((id) => !this.entries[id]);
      if (!missing.length) return;
      for (const id of missing) {
        const repo = repos.find((r) => r.id === id);
        if (repo) this.setPlaceholder(repo);
      }
      await this.refresh(missing, { force: true, background: this.hasCache });
    },

    /**
     * 批量更新：按 id merge 进 map。
     * 1 个 id → GET /api/repos/:id/overview；2~4 个并行单仓；>4 个全量 pick。
     */
    async refresh(repoIds: number[], options: RefreshOptions = {}): Promise<void> {
      if (!repoIds.length) return;

      const maxAge = options.maxAge ?? OVERVIEW_MAX_AGE_MS;
      const targets = options.force ? repoIds : repoIds.filter((id) => isExpired(this.entries[id], maxAge));
      if (!targets.length) return;

      if (inflight) return inflight;

      const background = options.background ?? this.hasCache;

      inflight = this.fetchAndMerge(targets, background).finally(() => {
        inflight = null;
      });
      return inflight;
    },

    async fetchAndMerge(targetIds: number[], background: boolean): Promise<void> {
      if (background) {
        if (this.refreshing) return;
        this.refreshing = true;
      } else {
        if (this.loading) return;
        this.loading = true;
      }

      try {
        const rows = await fetchOverviewsForIds(targetIds);
        const now = Date.now();
        for (const row of rows) {
          if (row.id != null) {
            this.entries[row.id] = { data: row, fetchedAt: now };
          }
        }
      } catch {
        /* 保留已有 entry（含 placeholder） */
      } finally {
        if (background) this.refreshing = false;
        else this.loading = false;
      }
    },

    /** 与 repos 列表同步：prune → 按 TTL refresh 全部 id */
    async sync(repos: OpenedRepo[], options: RefreshOptions = {}): Promise<void> {
      const ids = repos.map((r) => r.id);
      this.prune(ids);
      await this.refresh(ids, options);
    }
  }
});
