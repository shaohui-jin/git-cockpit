import { emptyActivity, type RepoOverview } from '@shaohui_jin/git-cockpit-core';
import type { Runtime } from './runtime.ts';

const CONCURRENCY = 4;

export function unavailableOverview(path: string, extra: Partial<RepoOverview> = {}): RepoOverview {
  const name = path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || path;
  return {
    path,
    name,
    available: false,
    current: '',
    tracking: null,
    ahead: 0,
    behind: 0,
    dirtyCount: 0,
    conflictCount: 0,
    operation: 'none',
    tempMergeBranchCount: 0,
    ...emptyActivity(),
    ...extra
  };
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

export async function collectRepoOverviews(runtime: Runtime): Promise<RepoOverview[]> {
  const repos = runtime.repoManager.list();
  if (!repos.length) return [];
  return mapPool(repos, CONCURRENCY, async (r) => {
    try {
      const handle = await runtime.repoManager.getById(r.id);
      if (!handle) return unavailableOverview(r.path, { id: r.id, lastOpenedAt: r.lastOpenedAt });
      const o = await handle.service.getOverview();
      return { ...o, id: r.id, lastOpenedAt: r.lastOpenedAt };
    } catch {
      return unavailableOverview(r.path, { id: r.id, lastOpenedAt: r.lastOpenedAt });
    }
  });
}
