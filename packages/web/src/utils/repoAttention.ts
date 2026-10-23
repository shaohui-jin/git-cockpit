import type { RepoOverview } from '@/api/types';

export type RepoFilter = 'all' | 'stuck' | 'dirty' | 'sync' | 'quiet' | 'lost';
export type Attention = 'stuck' | 'dirty' | 'sync' | 'quiet' | 'lost';

export function attentionOf(o?: RepoOverview): Attention {
  // 路径失效是一等状态：不再混进「雷雨」，避免死条目淹没真正卡住的活仓
  if (o && o.available === false) return 'lost';
  // 概览未到：按中性处理，不误报雷雨
  if (!o) return 'quiet';
  if (o.operation !== 'none' || o.conflictCount > 0) return 'stuck';
  if (o.dirtyCount > 0) return 'dirty';
  if (o.ahead + o.behind > 0 || o.tempMergeBranchCount > 0) return 'sync';
  return 'quiet';
}

export function matchesFilter(o: RepoOverview | undefined, filter: RepoFilter): boolean {
  if (filter === 'all') return true;
  return attentionOf(o) === filter;
}

export function weatherOf(a: Attention): string {
  if (a === 'lost') return '失效';
  if (a === 'stuck') return '雷雨';
  if (a === 'dirty') return '薄雾';
  if (a === 'sync') return '刮风';
  return '晴天';
}

export function weatherHint(a: Attention): string {
  if (a === 'lost') return '路径不存在或不是 Git 仓库';
  if (a === 'stuck') return '工作区卡住，或还有冲突';
  if (a === 'dirty') return '有未提交的更改';
  if (a === 'sync') return '超前或落后远程，或有合并草稿';
  return '干净，可以先不管';
}

/** 给筛选项的无障碍名称，须覆盖现网 E2E：`有更改 1` / `卡住 N` / `未同步 N` */
export function filterAriaName(key: RepoFilter, count: number): string {
  if (key === 'all') return `全部 ${count}`;
  if (key === 'stuck') return `卡住 ${count}`;
  if (key === 'dirty') return `有更改 ${count}`;
  if (key === 'sync') return `未同步 ${count}`;
  if (key === 'lost') return `失效 ${count}`;
  return `晴天 ${count}`;
}

export function attentionRank(a: Attention): number {
  if (a === 'stuck') return 0;
  if (a === 'dirty') return 1;
  if (a === 'sync') return 2;
  if (a === 'lost') return 4;
  return 3;
}
