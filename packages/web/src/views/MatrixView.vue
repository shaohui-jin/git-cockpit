<script setup lang="ts">
/**
 * 合并矩阵面板：intos × froms 批量预演；状态在 mergeSession，切到单对不会丢。
 * 「去预演 / 开始逐条处理」带着冲突队列切模式，不换路由。
 */
import { computed } from 'vue';
import { ElMessage } from 'element-plus';
import { storeToRefs } from 'pinia';
import { useReposStore } from '@/stores/repos';
import { useMergeSessionStore, type CellStage, type MergePair } from '@/stores/mergeSession';
import type { MergeSurveyCell, SurveyOutcome } from '@/api/types';
import BranchTreeSelect from '@/components/BranchTreeSelect.vue';

const repos = useReposStore();
const session = useMergeSessionStore();
const {
  intos,
  froms,
  fetchRemote,
  loading,
  survey,
  order,
  active,
  orderView,
  surveyStale
} = storeToRefs(session);

const emit = defineEmits<{
  createMr: [payload: { into: string; from: string; sourceBranch: string }];
  pushTemp: [payload: { into: string; from: string; branch: string }];
}>();

const canRun = computed(() => repos.currentId !== null);

const OUTCOME_TEXT: Record<SurveyOutcome, string> = {
  clean: '干净',
  conflicts: '冲突',
  unrelated: '无共祖',
  same: '同名',
  error: '失败'
};

const STAGE_TEXT: Record<CellStage, string> = {
  open: '',
  ready: '',
  local: '已解决·本地',
  resolved: '已处理',
  page: '已开创建页',
  mr: '已提 MR'
};

function pairKey(intoRef: string, fromRef: string): string {
  return `${intoRef}\u0000${fromRef}`;
}

const resultIntos = computed(() => [...new Set((survey.value?.cells ?? []).map((c) => c.into))]);

const rows = computed(() => {
  const cells = survey.value?.cells ?? [];
  const index = new Map(cells.map((c) => [pairKey(c.into, c.from), c]));
  const resultFroms = [...new Set(cells.map((c) => c.from))];
  return resultFroms.map((from) => ({
    from,
    cells: resultIntos.value.map((into) => ({
      into,
      cell: index.get(pairKey(into, from)) ?? null
    }))
  }));
});

function stripRef(r: string): string {
  return r.replace(/^refs\/(heads|remotes)\//, '').replace(/^origin\//, '');
}

function sameRef(a: string, b: string): boolean {
  return stripRef(a) === stripRef(b);
}

const orderMatches = computed(() => {
  const o = order.value;
  if (!o || resultIntos.value.length !== 1) return false;
  const firstInto = resultIntos.value[0];
  if (!firstInto || !sameRef(o.best.into, firstInto)) return false;
  const matrixFroms = rows.value.map((r) => r.from);
  const orderFroms = new Set(o.best.order);
  return matrixFroms.length === orderFroms.size && matrixFroms.every((f) => [...orderFroms].some((n) => sameRef(n, f)));
});

type DisplayRow =
  | { kind: 'row'; ord: number; from: string; cells: Array<{ into: string; cell: MergeSurveyCell | null }> }
  | { kind: 'divider'; reason: string };

const displayRows = computed<DisplayRow[]>(() => {
  const base = rows.value;
  const asPlain = (): DisplayRow[] => base.map((row) => ({ kind: 'row', ord: 0, ...row }));
  const o = order.value;
  if (!o || orderView.value !== 'best' || !orderMatches.value) return asPlain();
  const byFrom = new Map(base.map((row) => [stripRef(row.from), row]));
  const out: DisplayRow[] = [];
  o.best.order.forEach((name, idx) => {
    const row = byFrom.get(stripRef(name));
    if (!row) return;
    out.push({ kind: 'row', ord: idx + 1, ...row });
    const prefix = o.best.cleanPrefix;
    if (idx + 1 === prefix && prefix < o.best.order.length) {
      out.push({
        kind: 'divider',
        reason: o.best.blockedReason ?? (o.best.blockedAt ? `从 ${o.best.blockedAt} 起需要人工处理` : '')
      });
    }
  });
  return out.filter((r) => r.kind === 'row').length === base.length ? out : asPlain();
});

const allCells = computed(() =>
  displayRows.value.flatMap((r) =>
    r.kind === 'divider' ? [] : r.cells.map((c) => c.cell).filter((cell): cell is MergeSurveyCell => !!cell)
  )
);

const conflictQueue = computed<MergePair[]>(() =>
  allCells.value.filter((c) => c.outcome === 'conflicts').map((c) => ({ into: c.into, from: c.from }))
);

const pendingQueue = computed(() => conflictQueue.value.filter((p) => !session.isPairDone(p)));

const localCells = computed(() => allCells.value.filter((c) => session.stageOf(c) === 'local'));

const mrReadyCells = computed(() =>
  allCells.value.filter((c) => {
    const s = session.stageOf(c);
    return s === 'ready' || s === 'resolved';
  })
);

const summary = computed(() => {
  const cells = survey.value?.cells ?? [];
  return {
    total: cells.length,
    clean: cells.filter((c) => c.outcome === 'clean').length,
    conflicts: cells.filter((c) => c.outcome === 'conflicts').length
  };
});

const orderPill = computed(() => {
  const o = order.value;
  if (!o || !orderMatches.value) return null;
  return {
    cleanPrefix: o.best.cleanPrefix,
    total: o.best.order.length,
    baseline: o.baseline.cleanPrefix,
    improved: o.best.cleanPrefix > o.baseline.cleanPrefix
  };
});

const nextActionText = computed(() => {
  if (pendingQueue.value.length > 0) {
    return session.doneKeys.length > 0 || conflictQueue.value.length !== pendingQueue.value.length
      ? `处理下一条冲突（剩 ${pendingQueue.value.length}）`
      : '开始逐条处理';
  }
  if (localCells.value.length > 0) {
    return `推送临时分支（剩 ${localCells.value.length}）`;
  }
  if (mrReadyCells.value.length > 0) {
    return mrReadyCells.value.length > 1
      ? `申请 MR（剩 ${mrReadyCells.value.length}）`
      : '申请 MR';
  }
  return '';
});

async function runSurvey(): Promise<void> {
  if (repos.currentId === null) {
    ElMessage.warning('请先选择仓库');
    return;
  }
  if (!session.canSurvey) return;
  await session.runSurvey();
}

async function runOrder(): Promise<void> {
  if (!session.canOrder) return;
  await session.runOrder();
}

function goPreview(cell: MergeSurveyCell): void {
  session.openPair({ into: cell.into, from: cell.from }, conflictQueue.value);
}

function nextMatrixAction(): void {
  const pending = pendingQueue.value[0];
  if (pending) {
    session.openPair(pending, conflictQueue.value);
    return;
  }
  const local = localCells.value[0];
  if (local) {
    pushTemp(local);
    return;
  }
  const mr = mrReadyCells.value[0];
  if (mr) requestMr(mr);
}

function pushTemp(cell: MergeSurveyCell): void {
  const branch = cell.tempBranch?.name;
  if (!branch) {
    ElMessage.warning('没有本地临时分支');
    return;
  }
  emit('pushTemp', { into: cell.into, from: cell.from, branch });
}

function cellLabel(cell: MergeSurveyCell): string {
  const n = cell.conflictPaths.length;
  const extra = n > 0 ? ` ${n}` : '';
  const stage = session.stageOf(cell);
  const stageText = STAGE_TEXT[stage];
  if (stageText) return `${stageText}${extra}`;
  return `${OUTCOME_TEXT[cell.outcome]}${extra}`;
}

function cellTitle(cell: MergeSurveyCell): string {
  const stage = session.stageOf(cell);
  const pair = `${cell.from} → ${cell.into}`;
  if (stage === 'local') return `${pair} · 选边已记在本地临时分支，未推送；可在矩阵推送后申请 MR`;
  if (stage === 'resolved') return `${pair} · 临时分支已推送，可申请 MR`;
  if (stage === 'page') return `${pair} · 已打开创建页`;
  if (stage === 'mr') return `${pair} · 已创建 PR/MR`;
  return cell.error || pair;
}

function requestMr(cell: MergeSurveyCell): void {
  const source = session.sourceBranchFor(cell);
  if (!source) {
    ElMessage.warning('没有可用来开 MR 的源分支');
    return;
  }
  if (!session.canCreateMr(cell)) {
    ElMessage.warning('临时分支还在本地，请先在单对落盘并推送');
    return;
  }
  emit('createMr', { into: cell.into, from: cell.from, sourceBranch: source });
}

function isActive(cell: MergeSurveyCell): boolean {
  return active.value?.into === cell.into && active.value?.from === cell.from;
}
</script>

<template>
  <div class="matrix-panel">
    <el-card shadow="never" class="filter-card">
      <div class="filter-bar">
        <div class="field">
          <span class="field-label">合入目标 into（可多选）</span>
          <BranchTreeSelect v-model="intos" multiple remote-first placeholder="选择线上目标" />
        </div>
        <div class="field">
          <span class="field-label">我的分支 from（可多选）</span>
          <BranchTreeSelect v-model="froms" multiple placeholder="选择待合入分支" />
        </div>
        <div class="field field-switch">
          <span class="field-label">先 fetch</span>
          <el-switch v-model="fetchRemote" />
        </div>
        <div class="field field-actions">
          <el-button :loading="loading" :disabled="!session.canSurvey" type="primary" @click="runSurvey">跑矩阵</el-button>
          <el-button :loading="loading" :disabled="!session.canOrder" @click="runOrder">建议顺序</el-button>
        </div>
      </div>
      <div class="chips">
        <span class="chip-label">INTO</span>
        <span v-if="intos.length === 0" class="hint">未选</span>
        <el-tag
          v-for="b in intos"
          :key="`i-${b}`"
          size="small"
          closable
          @close="session.dropChip('into', b)"
        >{{ b }}</el-tag>
      </div>
      <div class="chips">
        <span class="chip-label">FROM</span>
        <span v-if="froms.length === 0" class="hint">未选</span>
        <el-tag
          v-for="b in froms"
          :key="`f-${b}`"
          size="small"
          closable
          type="info"
          @close="session.dropChip('from', b)"
        >{{ b }}</el-tag>
      </div>
      <p class="tip">
        每对只跑 merge-tree，不改工作区。点「去预演」选边后只记到本地临时分支（不推送），回矩阵显示「已解决·本地」。
        矩阵上再统一：先清剩余冲突，再推送临时分支、申请 MR。不切换当前工作区。
      </p>
    </el-card>

    <div v-if="survey" class="matrix-body">
      <div class="matrix-table-wrap">
        <el-alert
          v-if="surveyStale"
          title="仓库刚有过写操作，矩阵可能过期"
          type="warning"
          show-icon
          :closable="false"
          class="stale-alert"
        >
          <el-button type="primary" :loading="loading" :disabled="!session.canSurvey" @click="runSurvey">重新跑矩阵</el-button>
        </el-alert>
        <div class="summary">
          <span>{{ summary.total }} 组</span>
          <span class="ok">干净 {{ summary.clean }}</span>
          <span class="bad">冲突 {{ summary.conflicts }}</span>
          <template v-if="orderPill">
            <span>建议可连续干净 {{ orderPill.cleanPrefix }}/{{ orderPill.total }}</span>
            <span v-if="orderPill.improved">原顺序 {{ orderPill.baseline }}</span>
            <el-radio-group v-if="orderMatches" v-model="orderView" size="small">
              <el-radio-button value="best">建议顺序</el-radio-button>
              <el-radio-button value="original">原顺序</el-radio-button>
            </el-radio-group>
          </template>
          <span class="summary-spacer" />
          <el-button
            v-if="nextActionText"
            type="primary"
            :disabled="!canRun || loading"
            @click="nextMatrixAction"
          >{{ nextActionText }}</el-button>
        </div>
        <table class="grid">
          <thead>
            <tr>
              <th class="corner">from \ into</th>
              <th v-for="intoCol in resultIntos" :key="intoCol" class="mono">{{ intoCol }}</th>
            </tr>
          </thead>
          <tbody>
            <template v-for="(row, idx) in displayRows" :key="row.kind === 'divider' ? `d-${idx}` : row.from">
              <tr v-if="row.kind === 'divider'">
                <td :colspan="resultIntos.length + 1" class="divider">{{ row.reason }}</td>
              </tr>
              <tr v-else>
                <th class="mono row-head">
                  <span v-if="row.ord" class="ord">{{ row.ord }}</span>
                  {{ row.from }}
                </th>
                <td v-for="col in row.cells" :key="col.into">
                  <button
                    v-if="col.cell"
                    type="button"
                    class="cell"
                    :class="[`is-${col.cell.outcome}`, `is-stage-${session.stageOf(col.cell)}`, { active: isActive(col.cell) }]"
                    :title="cellTitle(col.cell)"
                    @click="session.active = col.cell"
                  >
                    {{ cellLabel(col.cell) }}
                  </button>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
      <aside v-if="active" class="detail">
        <h3 class="mono">{{ active.from }} → {{ active.into }}</h3>
        <p>{{ OUTCOME_TEXT[active.outcome] }}{{ active.error ? ` · ${active.error}` : '' }}</p>
        <p v-if="active.tempBranch" class="tip">
          临时分支 {{ active.tempBranch.name }}
          （{{ active.tempBranch.local ? '本地' : '' }}{{ active.tempBranch.local && active.tempBranch.remote ? ' / ' : '' }}{{ active.tempBranch.remote ? '远程' : '' }}）
        </p>
        <ul v-if="active.conflictPaths.length" class="paths">
          <li v-for="p in active.conflictPaths" :key="p" class="mono">{{ p }}</li>
        </ul>
        <p v-else-if="active.outcome === 'clean'" class="hint">没有冲突文件</p>
        <el-button
          v-if="active.outcome === 'conflicts' || active.outcome === 'clean'"
          type="primary"
          @click="goPreview(active)"
        >去预演</el-button>
        <el-button
          v-if="session.stageOf(active) === 'local'"
          :disabled="loading"
          @click="pushTemp(active)"
        >推送临时分支</el-button>
        <el-button
          v-if="session.canCreateMr(active)"
          :disabled="loading"
          @click="requestMr(active)"
        >申请 MR</el-button>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.matrix-panel {
  overflow: hidden;
  display: flex;
  flex-direction: column;
  gap: var(--gc-gap);
  flex: 1;
  min-height: 0;
}
.filter-card {
  flex-shrink: 0;
}
.filter-bar {
  display: flex;
  align-items: flex-end;
  gap: var(--gc-gap);
  flex-wrap: wrap;
}
.field {
  display: flex;
  flex-direction: column;
  gap: var(--gc-gap);
}
.field-actions {
  flex-direction: row;
  align-items: center;
}
.field-label {
  font-size: var(--gc-text);
  color: var(--el-text-color-secondary);
}
.chips {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  margin-top: var(--gc-gap);
}
.chip-label {
  font-family: ui-monospace, monospace;
  font-size: var(--gc-text);
  color: var(--el-text-color-secondary);
  margin-right: 4px;
}
.hint {
  font-size: var(--gc-text);
  color: var(--el-text-color-placeholder);
}
.tip {
  margin: var(--gc-gap) 0 0;
  font-size: var(--gc-text);
  color: var(--el-text-color-secondary);
}
.matrix-body {
  flex: 1;
  min-height: 0;
  display: flex;
  gap: var(--gc-gap);
  overflow: hidden;
}
.matrix-table-wrap {
  flex: 1;
  min-width: 0;
  overflow: auto;
}
.summary {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--gc-gap);
  margin-bottom: var(--gc-gap);
  font-size: var(--gc-text);
  color: var(--el-text-color-secondary);
}
.summary-spacer {
  flex: 1;
  min-width: 8px;
}
.ok {
  color: var(--el-color-success);
}
.bad {
  color: var(--el-color-danger);
}
.grid {
  border-collapse: collapse;
  font-size: var(--gc-text);
}
.grid th,
.grid td {
  border: 1px solid var(--el-border-color-lighter);
  padding: 4px;
  text-align: left;
  vertical-align: middle;
}
.corner,
.row-head {
  background: var(--el-fill-color-lighter);
  white-space: nowrap;
}
.ord {
  display: inline-block;
  min-width: 1.2em;
  margin-right: 4px;
  color: var(--el-color-primary);
}
.divider {
  background: var(--el-fill-color);
  color: var(--el-color-warning);
  font-size: var(--gc-text);
  text-align: center;
}
.cell {
  display: block;
  width: 100%;
  min-width: 72px;
  padding: 6px 8px;
  border: 0;
  cursor: pointer;
  font: inherit;
  font-size: var(--gc-text);
  text-align: left;
  border-radius: 2px;
  color: var(--el-text-color-primary);
}
.cell.active {
  outline: 1px solid var(--el-color-primary);
}
.cell.is-clean {
  background: var(--gc-matrix-clean);
}
.cell.is-conflicts {
  background: var(--gc-matrix-conflict);
}
.cell.is-unrelated {
  background: var(--gc-matrix-unrelated);
}
.cell.is-same {
  background: var(--gc-matrix-same);
}
.stale-alert {
  margin-bottom: var(--gc-gap);
}
.cell.is-stage-local {
  box-shadow: inset 2px 0 0 var(--el-color-warning);
}
.cell.is-stage-resolved,
.cell.is-stage-mr {
  box-shadow: inset 2px 0 0 var(--el-color-success);
}
.cell.is-stage-page {
  box-shadow: inset 2px 0 0 var(--el-color-primary);
}
.detail {
  width: 280px;
  flex-shrink: 0;
  overflow: auto;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: var(--gc-radius);
  padding: var(--gc-pad);
  background: var(--el-bg-color);
}
.detail h3 {
  margin: 0 0 var(--gc-gap);
  font-size: var(--gc-text);
  word-break: break-all;
}
.detail p {
  margin: 0 0 var(--gc-gap);
  font-size: var(--gc-text);
  color: var(--el-text-color-secondary);
}
.paths {
  margin: 0 0 var(--gc-gap);
  padding-left: 1.2em;
  max-height: 40vh;
  overflow: auto;
}
</style>
