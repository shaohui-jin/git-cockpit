import { defineStore } from 'pinia';
import * as api from '@/api/client';
import type { MergeSurveyCell, MergeSurveyResult, SuggestOrderResult } from '@/api/types';
import { useReposStore } from '@/stores/repos';

export type MergeMode = 'pair' | 'matrix';

export type CellStage = 'open' | 'ready' | 'local' | 'resolved' | 'page' | 'mr';

export interface MergePair {
  into: string;
  from: string;
}

export interface MergeTrail {
  pairs: MergePair[];
  index: number;
}

export interface PairMrMark {
  url: string | null;
  via: string;
}

interface State {
  mode: MergeMode;
  repoId: number | null;
  pairInto: string;
  pairFrom: string;
  trail: MergeTrail | null;
  /** 本会话已落盘的格子；与 survey.tempBranch 一起判断「处理过」 */
  doneKeys: string[];
  /** 本会话开过 PR/MR 的格子（仅网页；MCP 不读） */
  mrMarks: Record<string, PairMrMark>;
  /** 从矩阵点进来：落盘不推送，只记本地临时分支，再回矩阵 */
  fromMatrix: boolean;
  openedFromMatrix: MergePair | null;
  /** 仓库有写操作后，当前调查结果可能过期 */
  surveyStale: boolean;
  /** 递增：从矩阵打开一对或 trail 翻页时，单对页重跑预演 */
  previewSeq: number;
  intos: string[];
  froms: string[];
  fetchRemote: boolean;
  loading: boolean;
  loadError: string;
  survey: MergeSurveyResult | null;
  order: SuggestOrderResult | null;
  active: MergeSurveyCell | null;
  orderView: 'best' | 'original';
}

export function pairKey(intoRef: string, fromRef: string): string {
  return `${intoRef}\u0000${fromRef}`;
}

function samePair(a: MergePair, b: MergePair): boolean {
  return a.into === b.into && a.from === b.from;
}

export const useMergeSessionStore = defineStore('mergeSession', {
  state: (): State => ({
    mode: 'pair',
    repoId: null,
    pairInto: '',
    pairFrom: '',
    trail: null,
    doneKeys: [],
    mrMarks: {},
    fromMatrix: false,
    openedFromMatrix: null,
    surveyStale: false,
    previewSeq: 0,
    intos: [],
    froms: [],
    fetchRemote: true,
    loading: false,
    loadError: '',
    survey: null,
    order: null,
    active: null,
    orderView: 'best'
  }),
  getters: {
    trailCurrent(state): MergePair | undefined {
      if (!state.trail) return undefined;
      return state.trail.pairs[state.trail.index];
    },
    trailRemaining(state): number {
      if (!state.trail) return 0;
      return state.trail.pairs.filter((p) => {
        if (state.doneKeys.includes(pairKey(p.into, p.from))) return false;
        const cell = state.survey?.cells.find((c) => c.into === p.into && c.from === p.from);
        return !cell?.tempBranch;
      }).length;
    },
    canSurvey(state): boolean {
      return state.intos.length > 0 && state.froms.length > 0 && !state.loading;
    },
    canOrder(state): boolean {
      return state.intos.length === 1 && state.froms.length > 1 && !state.loading;
    }
  },
  actions: {
    resetIfRepoChanged(id: number | null): void {
      if (this.repoId === id) return;
      this.repoId = id;
      this.pairInto = '';
      this.pairFrom = '';
      this.trail = null;
      this.doneKeys = [];
      this.mrMarks = {};
      this.fromMatrix = false;
      this.openedFromMatrix = null;
      this.surveyStale = false;
      this.intos = [];
      this.froms = [];
      this.survey = null;
      this.order = null;
      this.active = null;
      this.loadError = '';
      this.loading = false;
    },
    setMode(mode: MergeMode): void {
      this.mode = mode;
    },
    dropChip(kind: 'into' | 'from', name: string): void {
      if (kind === 'into') this.intos = this.intos.filter((b) => b !== name);
      else this.froms = this.froms.filter((b) => b !== name);
    },
    isPairDone(pair: MergePair): boolean {
      if (this.doneKeys.includes(pairKey(pair.into, pair.from))) return true;
      const cell = this.survey?.cells.find((c) => c.into === pair.into && c.from === pair.from);
      return !!cell?.tempBranch;
    },
    markPairDone(pair: MergePair): void {
      const key = pairKey(pair.into, pair.from);
      if (!this.doneKeys.includes(key)) this.doneKeys = [...this.doneKeys, key];
    },
    markPairMr(pair: MergePair, mark: PairMrMark): void {
      this.mrMarks = { ...this.mrMarks, [pairKey(pair.into, pair.from)]: mark };
    },
    /**
     * 网页格子阶段。MCP 工具仍只返回 outcome / tempBranch，不返回颜色。
     * page/mr 只存在本会话；刷新后只剩 git 上的临时分支档。
     */
    stageOf(cell: MergeSurveyCell): CellStage {
      const key = pairKey(cell.into, cell.from);
      const mr = this.mrMarks[key];
      if (mr) return mr.via === 'browser' ? 'page' : 'mr';
      if (cell.tempBranch?.remote) return 'resolved';
      if (cell.tempBranch || this.doneKeys.includes(key)) return 'local';
      if (cell.outcome === 'clean') return 'ready';
      return 'open';
    },
    /** 开 MR 用的源分支：干净格用 from；冲突格必须用临时分支，禁止让 core 猜 */
    sourceBranchFor(cell: MergeSurveyCell): string | null {
      if (cell.outcome === 'clean') return cell.from;
      return cell.tempBranch?.name ?? null;
    },
    canCreateMr(cell: MergeSurveyCell): boolean {
      const stage = this.stageOf(cell);
      if (stage === 'ready' || stage === 'resolved' || stage === 'page' || stage === 'mr') return true;
      return false;
    },
    onRepoChanged(repoPath: string): void {
      if (!this.survey || this.loading) return;
      const rec = useReposStore().repos.find((r) => r.id === this.repoId);
      if (!rec) return;
      const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
      if (norm(rec.path) !== norm(repoPath)) return;
      this.surveyStale = true;
    },
    /**
     * 从矩阵进入单对。queue 是冲突格展示序；当前格不在队列里（干净格）则不挂回程条。
     */
    openPair(pair: MergePair, queue: MergePair[]): void {
      const at = queue.findIndex((p) => samePair(p, pair));
      this.trail = queue.length > 0 && at >= 0 ? { pairs: queue, index: at } : null;
      this.fromMatrix = true;
      this.openedFromMatrix = { ...pair };
      this.pairInto = pair.into;
      this.pairFrom = pair.from;
      this.mode = 'pair';
      this.previewSeq += 1;
    },
    clearTrail(): void {
      this.trail = null;
      this.fromMatrix = false;
      this.openedFromMatrix = null;
    },
    /** 人改了单对分支，就不再是矩阵那趟记录流程 */
    syncTrailWithPair(): void {
      const origin = this.openedFromMatrix;
      if (origin && (origin.into !== this.pairInto || origin.from !== this.pairFrom)) {
        this.trail = null;
        this.fromMatrix = false;
        this.openedFromMatrix = null;
      }
    },
    trailGo(delta: number): boolean {
      const trail = this.trail;
      if (!trail) return false;
      const next = trail.index + delta;
      const pair = trail.pairs[next];
      if (!pair) return false;
      this.trail = { pairs: trail.pairs, index: next };
      this.pairInto = pair.into;
      this.pairFrom = pair.from;
      this.mode = 'pair';
      this.previewSeq += 1;
      return true;
    },
    /** 下一条未落盘的冲突；没有了就回矩阵。返回是否仍停在单对。 */
    trailNextPending(): boolean {
      const trail = this.trail;
      if (!trail) {
        this.backToMatrix();
        return false;
      }
      const at = trail.pairs.findIndex((p, i) => i > trail.index && !this.isPairDone(p));
      if (at < 0) {
        this.backToMatrix();
        return false;
      }
      this.trailGo(at - trail.index);
      return true;
    },
    backToMatrix(): void {
      this.mode = 'matrix';
      void this.refreshSurvey();
    },
    async runSurvey(fetchOverride?: boolean): Promise<void> {
      const id = useReposStore().currentId;
      if (id === null || this.intos.length === 0 || this.froms.length === 0) return;
      this.loading = true;
      this.loadError = '';
      this.order = null;
      const prev = this.active ? pairKey(this.active.into, this.active.from) : '';
      this.active = null;
      try {
        const exec = await api.runTool(id, 'git_merge_survey', {
          intos: [...this.intos],
          froms: [...this.froms],
          fetch: fetchOverride ?? this.fetchRemote,
          dryRun: false
        });
        if (!exec.success) {
          this.loadError = exec.error?.message ?? '矩阵预演失败';
          this.survey = null;
          return;
        }
        this.survey = exec.result as MergeSurveyResult;
        this.surveyStale = false;
        if (prev) {
          this.active = this.survey.cells.find((c) => pairKey(c.into, c.from) === prev) ?? null;
        }
      } catch (err) {
        this.loadError = err instanceof Error ? err.message : String(err);
        this.survey = null;
      } finally {
        this.loading = false;
      }
    },
    async refreshSurvey(): Promise<void> {
      if (this.intos.length === 0 || this.froms.length === 0) return;
      await this.runSurvey(false);
    },
    async runOrder(): Promise<void> {
      const id = useReposStore().currentId;
      const into = this.intos[0];
      if (id === null || !into || this.intos.length !== 1 || this.froms.length < 2) return;
      this.loading = true;
      this.loadError = '';
      try {
        const exec = await api.runTool(id, 'git_merge_order', {
          into,
          branches: [...this.froms],
          fetch: this.fetchRemote,
          dryRun: false
        });
        if (!exec.success) {
          this.loadError = exec.error?.message ?? '顺序推演失败';
          return;
        }
        this.order = exec.result as SuggestOrderResult;
        this.orderView = 'best';
      } catch (err) {
        this.loadError = err instanceof Error ? err.message : String(err);
      } finally {
        this.loading = false;
      }
    }
  }
});
