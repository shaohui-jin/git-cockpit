import type { G6GraphData } from './toG6Data';

export interface PathHighlight {
  nodeIds: Set<string>;
  edgeIds: Set<string>;
  chain: string[];
}

/** G6 边为 parent → child；回溯时走 child → parents。 */
export function pathToRoots(startId: string, data: G6GraphData): PathHighlight {
  const parentsOf = new Map<string, string[]>();
  const edgeIdByPair = new Map<string, string>();

  for (const e of data.edges) {
    const list = parentsOf.get(e.target) ?? [];
    list.push(e.source);
    parentsOf.set(e.target, list);
    edgeIdByPair.set(`${e.source}\0${e.target}`, e.id);
  }

  const nodeIds = new Set<string>([startId]);
  const edgeIds = new Set<string>();
  const queue = [startId];

  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const parent of parentsOf.get(cur) ?? []) {
      const eid = edgeIdByPair.get(`${parent}\0${cur}`);
      if (eid) edgeIds.add(eid);
      if (!nodeIds.has(parent)) {
        nodeIds.add(parent);
        queue.push(parent);
      }
    }
  }

  const chain: string[] = [startId];
  let walk = startId;
  const seen = new Set<string>([startId]);
  for (;;) {
    const parents = parentsOf.get(walk) ?? [];
    const next = parents[0];
    if (!next || seen.has(next)) break;
    seen.add(next);
    chain.push(next);
    walk = next;
  }

  return { nodeIds, edgeIds, chain };
}
