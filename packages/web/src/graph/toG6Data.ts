import { cssVar, isDarkTheme } from './theme';
import type { BranchGraph, BranchTip, GraphCommitNode } from '@/api/types';

export type G6NodeKind = 'base' | 'tip' | 'local-tip' | 'remote-tip';

export interface G6GraphData {
  nodes: Array<{
    id: string;
    data: {
      label: string;
      sub?: string;
      kind: G6NodeKind;
      sha?: string;
      tipName?: string;
      tipFullName?: string;
      remote?: boolean;
      remoteName?: string;
      color?: string;
    };
  }>;
  edges: Array<{
    id: string;
    source: string;
    target: string;
  }>;
}

export interface TipsGraphOptions {
  defaultRemote?: string;
  remotes?: string[];
}

type GraphPalette = {
  local: string;
  remote: string;
  base: string;
  lineage: string;
  fallback: string;
  others: readonly string[];
};

const OTHER_REMOTES_DARK = ['#c678dd', '#56b6c2', '#e5c07b', '#98c379', '#e06c75', '#61afef'] as const;
const OTHER_REMOTES_LIGHT = ['#8250df', '#0f7490', '#9a6700', '#3a7d34', '#c0392b', '#1f6feb'] as const;

export function graphPalette(): GraphPalette {
  return {
    local: cssVar('--el-color-warning', '#f0a35e'),
    remote: cssVar('--el-color-primary', '#4c9aff'),
    base: cssVar('--el-color-info', '#9d8cff'),
    lineage: cssVar('--el-color-success', '#56d364'),
    fallback: cssVar('--el-text-color-secondary', '#5a5a5a'),
    others: isDarkTheme() ? OTHER_REMOTES_DARK : OTHER_REMOTES_LIGHT
  };
}

function short(sha: string): string {
  return sha.slice(0, 7);
}

export function tipNodeId(name: string): string {
  return `tip:${name}`;
}

export function tipNameFromNodeId(id: string): string | null {
  return id.startsWith('tip:') ? id.slice(4) : null;
}

export function splitRemoteTipName(
  tipName: string,
  knownRemotes: string[]
): { remoteName: string; shortName: string } | null {
  const name = tipName.trim();
  if (!name.includes('/')) return null;
  const sorted = [...knownRemotes].map((r) => r.trim()).filter(Boolean).sort((a, b) => b.length - a.length);
  for (const remote of sorted) {
    const prefix = `${remote}/`;
    if (name.startsWith(prefix) && name.length > prefix.length) {
      return { remoteName: remote, shortName: name.slice(prefix.length) };
    }
  }
  const i = name.indexOf('/');
  if (i <= 0 || i === name.length - 1) return null;
  return { remoteName: name.slice(0, i), shortName: name.slice(i + 1) };
}

function hashHue(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return h;
}

export function colorForTip(opts: { remote: boolean; remoteName?: string; defaultRemote: string }): string {
  const p = graphPalette();
  if (!opts.remote) return p.local;
  const rn = opts.remoteName || '';
  if (!rn || rn === opts.defaultRemote) return p.remote;
  return p.others[hashHue(rn) % p.others.length]!;
}

export function kindColor(kind: G6NodeKind): string {
  const p = graphPalette();
  switch (kind) {
    case 'base':
      return p.base;
    case 'local-tip':
      return p.local;
    case 'remote-tip':
      return p.remote;
    case 'tip':
      return p.lineage;
    default:
      return p.fallback;
  }
}

function buildParentMap(nodes: GraphCommitNode[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const n of nodes) map.set(n.sha, n.parents);
  return map;
}

export function nearestAncestorTipShas(
  startSha: string,
  tipShas: Set<string>,
  parentMap: Map<string, string[]>
): string[] {
  const visited = new Set<string>([startSha]);
  let frontier = [...(parentMap.get(startSha) ?? [])].filter((p) => !visited.has(p));
  while (frontier.length > 0) {
    const found: string[] = [];
    const next: string[] = [];
    for (const sha of frontier) {
      if (visited.has(sha)) continue;
      visited.add(sha);
      if (tipShas.has(sha)) {
        found.push(sha);
        continue;
      }
      for (const p of parentMap.get(sha) ?? []) {
        if (!visited.has(p)) next.push(p);
      }
    }
    if (found.length > 0) return [...new Set(found)];
    frontier = next;
  }
  return [];
}

function collectRemotesFromTips(tips: BranchTip[]): string[] {
  const set = new Set<string>();
  for (const t of tips) {
    if (!t.remote) continue;
    const i = t.name.indexOf('/');
    if (i > 0) set.add(t.name.slice(0, i));
  }
  return [...set];
}

function tipsToBranchGraph(graph: BranchGraph, options?: TipsGraphOptions): G6GraphData {
  const tips = graph.tips;
  if (tips.length === 0) return { nodes: [], edges: [] };

  const remotes = options?.remotes?.length ? options.remotes : collectRemotesFromTips(tips);
  const defaultRemote =
    options?.defaultRemote?.trim() || (remotes.includes('origin') ? 'origin' : remotes[0] || 'origin');

  const hiddenLocalNames = new Set<string>();
  for (const local of tips) {
    if (local.remote) continue;
    const pair = tips.find((t) => {
      if (!t.remote || t.sha !== local.sha) return false;
      const split = splitRemoteTipName(t.name, remotes);
      return split?.remoteName === defaultRemote && split.shortName === local.name;
    });
    if (pair) hiddenLocalNames.add(local.name);
  }

  const displayTips = tips.filter((t) => t.remote || !hiddenLocalNames.has(t.name));
  const parentMap = buildParentMap(graph.nodes);
  const tipShas = new Set(displayTips.map((t) => t.sha));
  const tipsBySha = new Map<string, BranchTip[]>();
  for (const t of displayTips) {
    const list = tipsBySha.get(t.sha) ?? [];
    list.push(t);
    tipsBySha.set(t.sha, list);
  }

  const nodes: G6GraphData['nodes'] = displayTips.map((t) => {
    const split = t.remote ? splitRemoteTipName(t.name, remotes) : null;
    const shortName = t.remote ? (split?.shortName ?? t.name) : t.name;
    const remoteName = t.remote ? split?.remoteName : undefined;
    const color = colorForTip({ remote: t.remote, remoteName, defaultRemote });
    return {
      id: tipNodeId(t.name),
      data: {
        label: shortName,
        sub: short(t.sha),
        kind: t.remote ? 'remote-tip' : 'local-tip',
        sha: t.sha,
        tipName: shortName,
        tipFullName: t.name,
        remote: t.remote,
        remoteName,
        color
      }
    };
  });

  const edges: G6GraphData['edges'] = [];
  const edgeKeys = new Set<string>();
  let ei = 0;
  for (const child of displayTips) {
    const ancestorShas = nearestAncestorTipShas(child.sha, tipShas, parentMap);
    for (const aSha of ancestorShas) {
      const parents = tipsBySha.get(aSha) ?? [];
      for (const parent of parents) {
        if (parent.name === child.name) continue;
        const key = `${parent.name}\0${child.name}`;
        if (edgeKeys.has(key)) continue;
        edgeKeys.add(key);
        edges.push({
          id: `e-${ei++}`,
          source: tipNodeId(parent.name),
          target: tipNodeId(child.name)
        });
      }
    }
  }

  return { nodes, edges };
}

/** 画布只含分支 tip；边 = 最近 tip 祖先。中间 commit 不画。 */
export function branchGraphToG6(graph: BranchGraph, options?: TipsGraphOptions): G6GraphData {
  return tipsToBranchGraph(graph, options);
}

export function legendItemsForGraph(
  graph: BranchGraph,
  options?: TipsGraphOptions
): Array<{ key: string; label: string; color: string }> {
  const remotes = options?.remotes?.length ? options.remotes : collectRemotesFromTips(graph.tips);
  const defaultRemote =
    options?.defaultRemote?.trim() || (remotes.includes('origin') ? 'origin' : remotes[0] || 'origin');
  const items: Array<{ key: string; label: string; color: string }> = [
    { key: 'local', label: '本地', color: graphPalette().local }
  ];
  for (const r of remotes) {
    items.push({
      key: `remote:${r}`,
      label: r,
      color: colorForTip({ remote: true, remoteName: r, defaultRemote })
    });
  }
  return items;
}
