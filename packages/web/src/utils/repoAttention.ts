import type { RepoOverview } from '@/api/types';

export type RepoFilter = 'all' | 'stuck' | 'dirty' | 'sync';
export type Attention = 'stuck' | 'dirty' | 'sync' | 'quiet';

export function attentionOf(o?: RepoOverview): Attention {
  if (!o || o.available === false) return 'stuck';
  if (o.operation !== 'none' || o.conflictCount > 0) return 'stuck';
  if (o.dirtyCount > 0) return 'dirty';
  if (o.ahead + o.behind > 0 || o.tempMergeBranchCount > 0) return 'sync';
  return 'quiet';
}

export function matchesFilter(o: RepoOverview | undefined, filter: RepoFilter): boolean {
  if (filter === 'all') return true;
  return attentionOf(o) === filter;
}

export function attentionRank(a: Attention): number {
  if (a === 'stuck') return 0;
  if (a === 'dirty') return 1;
  if (a === 'sync') return 2;
  return 3;
}
