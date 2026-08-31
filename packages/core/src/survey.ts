/**
 * 批量合并预演：一次问「这些分支两两合起来会怎样」。
 * git 调用一律由 GitService 传入；本文件只做笛卡尔积、缓存、临时分支解析与格子组装。
 */
import { defaultTempBranchName, isSameBranchForMr } from './merge.ts';
import type { MergeSurveyCell, MergeSurveyPair, MergeSurveyResult, TempBranchState } from './types.ts';

export const MAX_SURVEY_PAIRS = 200;

export interface SurveyPreview {
  clean: boolean;
  unrelatedHistories: boolean;
  conflictPaths: string[];
  resultTree?: string;
}

export interface SurveyRunner {
  repoPath: string;
  remoteNames: string[];
  tempBranches: Map<string, TempBranchState>;
  toSha: (ref: string) => Promise<string>;
  previewBySha: (intoSha: string, fromSha: string) => Promise<SurveyPreview>;
}

const CACHE_LIMIT = 500;
const cache = new Map<string, MergeSurveyCell>();

function cacheKey(repoRoot: string, intoSha: string, fromSha: string): string {
  return `${repoRoot}\0${intoSha}\0${fromSha}`;
}

function cachePut(key: string, cell: MergeSurveyCell): void {
  if (cache.size >= CACHE_LIMIT) {
    let drop = Math.ceil(CACHE_LIMIT / 4);
    for (const k of cache.keys()) {
      cache.delete(k);
      drop -= 1;
      if (drop <= 0) break;
    }
  }
  cache.set(key, cell);
}

export function clearMergeSurveyCache(): void {
  cache.clear();
}

export function crossPairs(intos: readonly string[], froms: readonly string[]): MergeSurveyPair[] {
  const pairs: MergeSurveyPair[] = [];
  for (const into of intos) {
    for (const from of froms) {
      pairs.push({ into, from });
    }
  }
  return pairs;
}

/** 从 `for-each-ref` 输出解析 merge/* 临时分支（本地 / 远程） */
export function parseTempBranches(stdout: string, remoteNames: string[]): Map<string, TempBranchState> {
  const found = new Map<string, TempBranchState>();
  for (const line of stdout.split('\n')) {
    const ref = line.trim();
    if (!ref) continue;
    let name: string | null = null;
    let local = false;
    if (ref.startsWith('refs/heads/')) {
      name = ref.slice('refs/heads/'.length);
      local = true;
    } else if (ref.startsWith('refs/remotes/')) {
      const rest = ref.slice('refs/remotes/'.length);
      const hit = remoteNames.find((r) => rest.startsWith(`${r}/`));
      name = hit ? rest.slice(hit.length + 1) : null;
    }
    if (!name || !name.startsWith('merge/')) continue;
    const prev = found.get(name);
    found.set(name, {
      name,
      local: local || !!prev?.local,
      remote: !local || !!prev?.remote
    });
  }
  return found;
}

export async function runSurvey(
  runner: SurveyRunner,
  options: { pairs: readonly MergeSurveyPair[]; fetched: boolean; cache?: boolean }
): Promise<MergeSurveyResult> {
  const useCache = options.cache !== false;
  const remotes = runner.remoteNames.length ? runner.remoteNames : ['origin'];
  const tempFor = (into: string, from: string): TempBranchState | undefined =>
    runner.tempBranches.get(defaultTempBranchName(into, from, remotes));

  const cells: MergeSurveyCell[] = [];
  for (const pair of options.pairs) {
    if (isSameBranchForMr(pair.into, pair.from, remotes)) {
      cells.push({
        into: pair.into,
        from: pair.from,
        intoSha: '',
        fromSha: '',
        outcome: 'same',
        conflictPaths: []
      });
      continue;
    }
    try {
      const [intoSha, fromSha] = await Promise.all([runner.toSha(pair.into), runner.toSha(pair.from)]);
      const key = cacheKey(runner.repoPath, intoSha, fromSha);
      if (useCache) {
        const hit = cache.get(key);
        if (hit) {
          cells.push({
            ...hit,
            into: pair.into,
            from: pair.from,
            tempBranch: tempFor(pair.into, pair.from)
          });
          continue;
        }
      }
      const preview = await runner.previewBySha(intoSha, fromSha);
      const cell: MergeSurveyCell = {
        into: pair.into,
        from: pair.from,
        intoSha,
        fromSha,
        outcome: preview.unrelatedHistories ? 'unrelated' : preview.clean ? 'clean' : 'conflicts',
        conflictPaths: preview.conflictPaths,
        resultTree: preview.resultTree
      };
      if (useCache) cachePut(key, cell);
      cells.push({ ...cell, tempBranch: tempFor(pair.into, pair.from) });
    } catch (err) {
      cells.push({
        into: pair.into,
        from: pair.from,
        intoSha: '',
        fromSha: '',
        outcome: 'error',
        conflictPaths: [],
        error: err instanceof Error ? err.message : String(err)
      });
    }
  }

  return {
    repoRoot: runner.repoPath,
    fetched: options.fetched,
    generatedAt: Date.now(),
    cells
  };
}
