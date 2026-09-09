/** 把 fromId 挪到 toId 所在位置（先取出再插入）。 */
export function moveIds(full: number[], fromId: number, toId: number): number[] {
  if (fromId === toId) return full.slice();
  const next = full.slice();
  const from = next.indexOf(fromId);
  const to = next.indexOf(toId);
  if (from < 0 || to < 0) return full.slice();
  const [item] = next.splice(from, 1);
  if (item === undefined) return full.slice();
  next.splice(to, 0, item);
  return next;
}

/** 只调整可见子集的相对顺序，其余位置不动。 */
export function moveAmong(full: number[], visible: number[], fromId: number, toId: number): number[] {
  const vis = moveIds(visible, fromId, toId);
  const visSet = new Set(visible);
  let i = 0;
  return full.map((id) => (visSet.has(id) ? vis[i++]! : id));
}
