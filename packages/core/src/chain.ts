/**
 * 串行合并模拟：merge-tree 结果树 + commit-tree 造游离 commit，不 checkout、不建 worktree。
 * 目标是 cleanPrefix（从头能连续干净合入几个），遇到第一处冲突就停。
 */
import { isSameBranchForMr } from './merge.ts';
import type { MergeChainResult, MergeChainStep, SuggestOrderResult, SurveyOutcome } from './types.ts';

export interface ChainPreview {
  clean: boolean;
  unrelatedHistories: boolean;
  conflictPaths: string[];
  resultTree?: string;
}

export interface ChainRunner {
  intoSha: string;
  remoteNames: string[];
  toSha: (ref: string) => Promise<string>;
  previewBySha: (intoSha: string, fromSha: string) => Promise<ChainPreview>;
  commitTree: (tree: string, parents: string[]) => Promise<string>;
}

export async function runChain(
  runner: ChainRunner,
  into: string,
  order: readonly string[]
): Promise<MergeChainResult> {
  const remotes = runner.remoteNames.length ? runner.remoteNames : ['origin'];
  const steps: MergeChainStep[] = [];
  let cursor = runner.intoSha;
  let cleanPrefix = 0;
  let blockedAt: string | null = null;
  let blockedPaths: string[] = [];
  let blockedReason: string | undefined;

  for (const from of order) {
    if (isSameBranchForMr(into, from, remotes)) {
      steps.push({ from, fromSha: '', outcome: 'same', conflictPaths: [], commit: '' });
      continue;
    }

    let fromSha: string;
    try {
      fromSha = await runner.toSha(from);
    } catch (err) {
      steps.push({ from, fromSha: '', outcome: 'error', conflictPaths: [], commit: '' });
      blockedAt = from;
      blockedReason = err instanceof Error ? err.message : String(err);
      break;
    }

    const preview = await runner.previewBySha(cursor, fromSha);
    const outcome: SurveyOutcome = preview.unrelatedHistories
      ? 'unrelated'
      : preview.clean
        ? 'clean'
        : 'conflicts';

    if (outcome !== 'clean' || !preview.resultTree) {
      const paths = preview.conflictPaths;
      steps.push({
        from,
        fromSha,
        outcome: preview.resultTree ? outcome : 'error',
        conflictPaths: paths,
        commit: ''
      });
      blockedAt = from;
      blockedPaths = paths;
      if (!preview.resultTree) {
        blockedReason =
          outcome === 'unrelated' ? '两条历史没有共同祖先' : 'merge-tree 没有产出结果树，无法继续往下推';
      }
      break;
    }

    cursor = await runner.commitTree(preview.resultTree, [cursor, fromSha]);
    cleanPrefix += 1;
    steps.push({ from, fromSha, outcome: 'clean', conflictPaths: [], commit: cursor });
  }

  return {
    into,
    intoSha: runner.intoSha,
    order: [...order],
    steps,
    cleanPrefix,
    blockedAt,
    blockedPaths,
    blockedReason
  };
}

async function greedyChain(
  runner: ChainRunner,
  into: string,
  branches: readonly string[]
): Promise<{ result: MergeChainResult; tried: number }> {
  const remotes = runner.remoteNames.length ? runner.remoteNames : ['origin'];
  const remaining = new Set(branches);
  const steps: MergeChainStep[] = [];
  const order: string[] = [];
  let cursor = runner.intoSha;
  let cleanPrefix = 0;
  let tried = 0;
  const total = branches.length;
  const maxRounds = total * 2 + 1;
  let round = 0;

  while (remaining.size > 0) {
    round += 1;
    if (round > maxRounds) break;

    let picked: { from: string; fromSha: string; tree: string } | null = null;
    let dropped = false;
    let leastBad: { from: string; paths: string[] } | null = null;

    for (const from of remaining) {
      if (isSameBranchForMr(into, from, remotes)) {
        remaining.delete(from);
        order.push(from);
        steps.push({ from, fromSha: '', outcome: 'same', conflictPaths: [], commit: '' });
        dropped = true;
        break;
      }

      let fromSha: string;
      try {
        fromSha = await runner.toSha(from);
      } catch {
        remaining.delete(from);
        order.push(from);
        steps.push({ from, fromSha: '', outcome: 'error', conflictPaths: [], commit: '' });
        dropped = true;
        break;
      }

      tried += 1;
      const preview = await runner.previewBySha(cursor, fromSha);
      if (preview.clean && preview.resultTree) {
        picked = { from, fromSha, tree: preview.resultTree };
        break;
      }
      const paths = preview.conflictPaths;
      if (!leastBad || paths.length < leastBad.paths.length) {
        leastBad = { from, paths };
      }
    }

    if (dropped) continue;

    if (picked) {
      cursor = await runner.commitTree(picked.tree, [cursor, picked.fromSha]);
      cleanPrefix += 1;
      remaining.delete(picked.from);
      order.push(picked.from);
      steps.push({
        from: picked.from,
        fromSha: picked.fromSha,
        outcome: 'clean',
        conflictPaths: [],
        commit: cursor
      });
      continue;
    }

    const blocker = leastBad;
    if (!blocker) break;
    order.push(blocker.from, ...[...remaining].filter((b) => b !== blocker.from));
    steps.push({
      from: blocker.from,
      fromSha: '',
      outcome: 'conflicts',
      conflictPaths: blocker.paths,
      commit: ''
    });
    return {
      result: {
        into,
        intoSha: runner.intoSha,
        order,
        steps,
        cleanPrefix,
        blockedAt: blocker.from,
        blockedPaths: blocker.paths
      },
      tried
    };
  }

  return {
    result: {
      into,
      intoSha: runner.intoSha,
      order,
      steps,
      cleanPrefix,
      blockedAt: null,
      blockedPaths: []
    },
    tried
  };
}

export async function suggestOrder(
  runner: ChainRunner,
  into: string,
  branches: readonly string[]
): Promise<SuggestOrderResult> {
  const baseline = await runChain(runner, into, branches);
  const greedy = await greedyChain(runner, into, branches);
  return {
    best: greedy.result.cleanPrefix >= baseline.cleanPrefix ? greedy.result : baseline,
    baseline,
    tried: greedy.tried + branches.length
  };
}
