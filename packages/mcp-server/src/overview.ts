import { emptyActivity, type RepoOverview } from '@shaohui_jin/git-cockpit-core';
import type { Runtime } from './runtime.ts';

const CONCURRENCY = 4;

export function unavailableOverview(path: string, extra: Partial<RepoOverview> = {}): RepoOverview {
  const name =
    path
      .replace(/[\\/]+$/, '')
      .split(/[\\/]/)
      .pop() || path;
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

async function overviewForRecord(
  runtime: Runtime,
  record: { id: number; path: string; lastOpenedAt: string }
): Promise<RepoOverview> {
  try {
    const handle = await runtime.repoManager.getById(record.id);
    if (!handle) {
      return unavailableOverview(record.path, { id: record.id, lastOpenedAt: record.lastOpenedAt });
    }
    const o = await handle.service.getOverview();
    return { ...o, id: record.id, lastOpenedAt: record.lastOpenedAt };
  } catch {
    return unavailableOverview(record.path, { id: record.id, lastOpenedAt: record.lastOpenedAt });
  }
}

/** 单个已打开仓库的脉搏；不在列表中返回 null */
export async function collectRepoOverviewForId(runtime: Runtime, id: number): Promise<RepoOverview | null> {
  const record = runtime.repoManager.list().find((r) => r.id === id);
  if (!record) return null;
  return overviewForRecord(runtime, record);
}

export async function collectRepoOverviews(runtime: Runtime): Promise<RepoOverview[]> {
  const repos = runtime.repoManager.list();
  if (!repos.length) return [];
  return mapPool(repos, CONCURRENCY, (r) => overviewForRecord(runtime, r));
}
