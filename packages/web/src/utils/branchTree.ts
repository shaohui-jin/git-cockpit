import type { BranchInfo } from '@/api/types';

export type BranchScope = 'all' | 'local' | 'remote';

export interface BranchTreeNode {
  key: string;
  value: string;
  label: string;
  disabled: boolean;
  fullName?: string;
  branch?: BranchInfo;
  remote?: boolean;
  children?: BranchTreeNode[];
}

export interface BranchPane {
  key: string;
  title: string;
  tree: BranchTreeNode[];
}

export function filterBranches(list: BranchInfo[], scope: BranchScope = 'all'): BranchInfo[] {
  if (scope === 'local') return list.filter((b) => !b.remote);
  if (scope === 'remote') return list.filter((b) => b.remote);
  return list;
}

function sortTree(nodes: BranchTreeNode[]): void {
  nodes.sort((a, b) => {
    const ad = a.branch ? 1 : 0;
    const bd = b.branch ? 1 : 0;
    if (ad !== bd) return ad - bd;
    return a.label.localeCompare(b.label);
  });
  for (const n of nodes) if (n.children) sortTree(n.children);
}

function buildPathTree(entries: { path: string; branch: BranchInfo }[], keyPrefix: string): BranchTreeNode[] {
  const roots: BranchTreeNode[] = [];
  for (const { path: branchPath, branch } of entries) {
    const parts = branchPath.split('/').filter((p) => p.length > 0);
    if (parts.length === 0) continue;
    let level = roots;
    let prefix = '';
    for (const [i, part] of parts.entries()) {
      prefix = prefix ? `${prefix}/${part}` : part;
      const isLeaf = i === parts.length - 1;
      const existing = level.find((n) => n.label === part);
      const node: BranchTreeNode = existing ?? {
        key: `${keyPrefix}:${prefix}`,
        value: isLeaf ? branch.name : `${keyPrefix}:${prefix}`,
        label: part,
        disabled: !isLeaf
      };
      if (!existing) level.push(node);
      if (isLeaf) {
        node.value = branch.name;
        node.disabled = false;
        node.branch = branch;
        node.fullName = branch.name;
        node.remote = branch.remote;
      } else {
        if (!node.children) node.children = [];
        level = node.children;
      }
    }
  }
  sortTree(roots);
  return roots;
}

/** 本地一组 + 每个 remote 一组，组内按 / 分层。状态页侧栏与下拉树共用。 */
export function buildBranchPanes(list: BranchInfo[], scope: BranchScope = 'all'): BranchPane[] {
  const filtered = filterBranches(list, scope);
  const locals = filtered.filter((b) => !b.remote);
  const remotes = filtered.filter((b) => b.remote);
  const remoteMap = new Map<string, { path: string; branch: BranchInfo }[]>();
  for (const r of remotes) {
    const slash = r.name.indexOf('/');
    const remoteName = slash === -1 ? '' : r.name.slice(0, slash);
    if (!remoteName) continue;
    const group = remoteMap.get(remoteName) ?? [];
    group.push({ path: r.name.slice(slash + 1), branch: r });
    remoteMap.set(remoteName, group);
  }

  const panes: BranchPane[] = [];
  if (locals.length && scope !== 'remote') {
    panes.push({
      key: 'local',
      title: `本地分支（${locals.length}）`,
      tree: buildPathTree(
        locals.map((b) => ({ path: b.name, branch: b })),
        'local'
      )
    });
  }
  if (scope !== 'local') {
    for (const [remote, entries] of remoteMap) {
      panes.push({
        key: `remote:${remote}`,
        title: `远程 · ${remote}（${entries.length}）`,
        tree: buildPathTree(entries, `remote:${remote}`)
      });
    }
  }
  return panes;
}

/** 下拉树：把 pane 收成带分组根节点的一棵树 */
export function panesToSelectTree(panes: BranchPane[], remoteFirst = false): BranchTreeNode[] {
  const ordered = remoteFirst ? [...panes].reverse() : panes;
  return ordered.map((pane) => ({
    key: `group:${pane.key}`,
    value: `group:${pane.key}`,
    label: pane.title,
    disabled: true,
    children: pane.tree
  }));
}
