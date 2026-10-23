<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import * as api from '@/api/client';
import { useReposStore } from '@/stores/repos';
import { useBranchesStore } from '@/stores/branches';
import BranchTreeSelect from '@/components/BranchTreeSelect.vue';
import type { BranchGraph, CommitInfo, DiffResult } from '@/api/types';

const DiffViewer = defineAsyncComponent(() => import('@/components/DiffViewer.vue'));

const props = defineProps<{ operation?: 'none' | 'merge' | 'rebase' | 'cherry-pick' }>();
const emit = defineEmits<{ pick: [hash: string]; mergePreview: [into: string, from: string] }>();

const repos = useReposStore();
const branchStore = useBranchesStore();
const repoId = (): number | null => repos.currentId;

const commits = ref<CommitInfo[]>([]);
const loading = ref(false);
const loadError = ref('');

const mode = ref<'head' | 'all' | 'branch'>('head');
const selectedBranch = ref('');
const pathFilter = ref('');
const maxCount = ref(50);

const lineageInto = ref('');
const lineageFrom = ref('');
const lineage = ref<BranchGraph['lineage'] | null>(null);
const lineageLoading = ref(false);

const selected = ref<CommitInfo | null>(null);
const selectedDiff = ref<DiffResult | null>(null);
const bodyOpen = ref(false);

const currentBranch = computed(() => branchStore.current?.name ?? '');

const LANE_W = 24;
const X0 = 12;
const LANE_COLORS = [
  'var(--gc-amber)',
  'var(--gc-accent)',
  'var(--gc-green)',
  'var(--gc-purple)',
  '#c678dd',
  '#56b6c2',
  '#e5c07b'
];

interface LaneRow {
  c: CommitInfo;
  lane: number;
  color: string;
  refs: string[];
  before: Array<string | null>;
  after: Array<string | null>;
}

function parseRefs(raw: string): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => s.replace(/^HEAD -> /, '').replace(/^tag: /, ''))
    .slice(0, 3);
}

/** 泳道分配：按 git log 顺序维护"每条泳道正在等待的提交" */
const laneRows = computed<LaneRow[]>(() => {
  const active: Array<string | null> = [];
  const rows: LaneRow[] = [];
  // 只追踪仍在当前列表内的父提交：窗口外的父永远不会出现，否则泳道只增不减
  const known = new Set(commits.value.map((c) => c.hash));
  for (const c of commits.value) {
    const before = active.slice();
    let lane = active.indexOf(c.hash);
    if (lane < 0) {
      lane = active.indexOf(null);
      if (lane < 0) {
        lane = active.length;
        active.push(null);
      }
    }
    for (let i = 0; i < active.length; i++) {
      if (i !== lane && active[i] === c.hash) active[i] = null;
    }
    const parents = c.parents.filter((p) => known.has(p));
    const [p0, ...rest] = parents;
    active[lane] = p0 ?? null;
    for (const p of rest) {
      let free = active.indexOf(null);
      if (free < 0) {
        free = active.length;
        active.push(null);
      }
      active[free] = p;
    }
    rows.push({
      c,
      lane,
      color: LANE_COLORS[lane % LANE_COLORS.length] ?? 'var(--gc-text-3)',
      refs: parseRefs(c.refs),
      before,
      after: active.slice()
    });
  }
  return rows;
});

const laneCount = computed(() => Math.max(1, ...laneRows.value.map((r) => Math.max(r.before.length, r.after.length))));

const laneOf = computed(() => {
  const map = new Map<string, number>();
  for (const r of laneRows.value) map.set(r.c.hash, r.lane);
  return map;
});

const legend = computed(() => {
  const items: Array<{ lane: number; color: string; label: string }> = [];
  for (let i = 0; i < laneCount.value; i++) {
    const withRef = laneRows.value.find((r) => r.lane === i && r.refs.length);
    if (!withRef?.refs[0]) continue;
    items.push({
      lane: i,
      color: LANE_COLORS[i % LANE_COLORS.length] ?? 'var(--gc-text-3)',
      label: withRef.refs[0]
    });
  }
  return items;
});

function rowSvg(row: LaneRow): string {
  const parts: string[] = [];
  const max = Math.max(row.before.length, row.after.length);
  for (let i = 0; i < max; i++) {
    const b = row.before[i] ?? null;
    const a = row.after[i] ?? null;
    if (!b && !a) continue;
    const x = X0 + i * LANE_W;
    const color = LANE_COLORS[i % LANE_COLORS.length] ?? 'var(--gc-text-3)';
    const y1 = b ? 0 : 14;
    const y2 = a ? 28 : 14;
    parts.push(
      `<line x1="${x}" y1="${y1}" x2="${x}" y2="${y2}" stroke="${color}" stroke-width="2" stroke-opacity="0.72"/>`
    );
  }
  for (const p of row.c.parents) {
    const pl = laneOf.value.get(p);
    if (pl === undefined || pl === row.lane) continue;
    const x1 = X0 + row.lane * LANE_W;
    const x2 = X0 + pl * LANE_W;
    parts.push(
      `<path d="M${x1} 14 Q${x1} 28 ${x2} 28" fill="none" stroke="${row.color}" stroke-width="2" stroke-opacity="0.72"/>`
    );
  }
  const cx = X0 + row.lane * LANE_W;
  parts.push(`<circle cx="${cx}" cy="14" r="4" fill="${row.color}"/>`);
  if (lineage.value?.mergeBase === row.c.hash) {
    parts.push(`<circle cx="${cx}" cy="14" r="7" fill="none" stroke="var(--gc-purple)" stroke-opacity="0.75"/>`);
  }
  const w = X0 * 2 + max * LANE_W;
  return `<svg viewBox="0 0 ${w} 28" width="${w}" height="28">${parts.join('')}</svg>`;
}

async function loadLog(): Promise<void> {
  const id = repoId();
  if (id === null) return;
  loading.value = true;
  loadError.value = '';
  try {
    const opts: Parameters<typeof api.getLog>[1] = { maxCount: maxCount.value };
    if (mode.value === 'all') opts.all = true;
    else if (mode.value === 'branch' && selectedBranch.value) opts.from = selectedBranch.value;
    if (pathFilter.value.trim()) opts.path = pathFilter.value.trim();
    commits.value = await api.getLog(id, opts);
    const first = commits.value[0];
    if (first && !selected.value) void openCommit(first);
  } catch (err) {
    loadError.value = err instanceof Error ? err.message : String(err);
    commits.value = [];
  } finally {
    loading.value = false;
  }
}

async function openCommit(c: CommitInfo): Promise<void> {
  const id = repoId();
  if (id === null) return;
  selected.value = c;
  selectedDiff.value = null;
  bodyOpen.value = false;
  try {
    const { diff } = await api.getShow(id, c.hash);
    if (selected.value?.hash === c.hash) selectedDiff.value = diff;
  } catch (err) {
    if (err instanceof api.ApiError && err.code === 'COMMIT_NOT_FOUND') {
      ElMessage.warning(`提交不存在（${c.shortHash}），可能已被清理，请刷新列表`);
    } else {
      ElMessage.error(err instanceof Error ? err.message : String(err));
    }
  }
}

async function compareLineage(): Promise<void> {
  const id = repoId();
  const into = lineageInto.value.trim();
  const from = lineageFrom.value.trim();
  if (id === null || !into || !from) {
    ElMessage.warning('请选择合入目标与我的分支');
    return;
  }
  lineageLoading.value = true;
  try {
    const g = await api.getBranchGraph(id, { maxNodes: 200, into, from });
    lineage.value = g.lineage;
    if (g.lineage && !g.lineage.mergeBase) ElMessage.warning('两条分支没有共同祖先');
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : String(err));
  } finally {
    lineageLoading.value = false;
  }
}

function clearLineage(): void {
  lineageInto.value = '';
  lineageFrom.value = '';
  lineage.value = null;
}

function pick(): void {
  if (!selected.value || (props.operation ?? 'none') !== 'none') return;
  emit('pick', selected.value.hash);
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

watch(repoId, () => {
  selectedBranch.value = '';
  selected.value = null;
  lineage.value = null;
  void loadLog();
});
watch([mode, selectedBranch, maxCount], () => void loadLog());

onMounted(() => void loadLog());

defineExpose({ refresh: loadLog, loading });
</script>

<template>
  <div class="ch-wrap">
    <div class="ch-main">
      <el-alert v-if="loadError" :title="loadError" type="error" :closable="false" show-icon class="mb" />

      <div class="ch-bar">
        <el-radio-group v-model="mode" size="small">
          <el-radio-button value="head">当前分支</el-radio-button>
          <el-radio-button value="all">全部分支</el-radio-button>
          <el-radio-button value="branch">指定分支</el-radio-button>
        </el-radio-group>
        <BranchTreeSelect v-if="mode === 'branch'" v-model="selectedBranch" placeholder="选择分支" />
        <el-input v-model="pathFilter" clearable placeholder="按路径过滤" class="path-input" @keyup.enter="loadLog" />
        <el-select v-model="maxCount" class="count-select">
          <el-option label="最近 20 条" :value="20" />
          <el-option label="最近 50 条" :value="50" />
          <el-option label="最近 100 条" :value="100" />
        </el-select>
        <el-button size="small" :loading="loading" @click="loadLog">刷新</el-button>
        <span class="spacer" />
        <span class="lb">对比</span>
        <BranchTreeSelect v-model="lineageInto" remote-first placeholder="合入目标" />
        <BranchTreeSelect v-model="lineageFrom" placeholder="我的分支" />
        <el-button
          size="small"
          type="primary"
          :disabled="!lineageInto || !lineageFrom"
          :loading="lineageLoading"
          @click="compareLineage"
        >
          对比
        </el-button>
        <el-button v-if="lineage" size="small" @click="clearLineage">清除</el-button>
        <el-button
          v-if="lineage?.mergeBase"
          size="small"
          text
          type="primary"
          @click="emit('mergePreview', lineage.into, lineage.from)"
          >去合并预演</el-button
        >
      </div>

      <p v-if="lineage" class="ch-meta">
        <template v-if="lineage.mergeBase">
          分叉点 {{ lineage.mergeBase.slice(0, 7) }} · {{ lineage.into }} 独有 {{ lineage.intoOnlyCount }} ·
          {{ lineage.from }} 独有 {{ lineage.fromOnlyCount }}
        </template>
        <template v-else>两条分支没有共同祖先</template>
      </p>

      <div class="ch-legend">
        <span v-for="l in legend" :key="l.lane" class="lg">
          <i class="dot" :style="{ background: l.color }" />{{ l.label }}
        </span>
      </div>

      <div v-loading="loading" class="ch-list">
        <div
          v-for="row in laneRows"
          :key="row.c.hash"
          class="c-row"
          :class="{ 'is-sel': selected?.hash === row.c.hash }"
          @click="openCommit(row.c)"
        >
          <span class="lane" v-html="rowSvg(row)" />
          <span class="hash">{{ row.c.shortHash }}</span>
          <span class="msg" :title="row.c.subject">{{ row.c.subject }}</span>
          <span class="brs">
            <span v-for="r in row.refs" :key="r" class="chip plain sm">{{ r }}</span>
          </span>
          <span class="who">{{ row.c.authorName }}</span>
          <span class="when">{{ formatDate(row.c.authorDate) }}</span>
        </div>
        <el-empty v-if="!loading && !laneRows.length" description="没有提交" :image-size="60" />
      </div>
    </div>

    <aside v-if="selected" class="ch-detail">
      <div class="cd-head">
        <GcIcon name="commit" :size="14" />
        <span class="cd-hash mono">{{ selected.shortHash }}</span>
        <span class="spacer" />
        <button type="button" class="icon-btn" aria-label="关闭" @click="selected = null">
          <GcIcon name="close" :size="14" />
        </button>
      </div>
      <div class="cd-meta">{{ selected.authorName }} · {{ formatDate(selected.authorDate) }}</div>
      <div class="cd-body">
        <b>{{ selected.subject }}</b>
        <pre v-if="bodyOpen && selected.body" class="cd-raw">{{ selected.body }}</pre>
        <button v-if="selected.body" type="button" class="tbtn" @click="bodyOpen = !bodyOpen">
          {{ bodyOpen ? '收起正文' : '展开正文' }}
        </button>
      </div>
      <div class="cd-diff">
        <DiffViewer v-if="selectedDiff?.rawPatch" :patch="selectedDiff.rawPatch" />
        <p v-else class="cd-empty">无差异</p>
      </div>
      <div class="pick-bar">
        <el-button type="primary" size="small" :disabled="(props.operation ?? 'none') !== 'none'" @click="pick">
          拣选到当前分支
        </el-button>
        <span v-if="(props.operation ?? 'none') !== 'none'" class="pick-hint">工作区正忙，先继续或中止</span>
      </div>
    </aside>
  </div>
</template>

<style scoped>
.ch-wrap {
  flex: 1;
  min-height: 0;
  display: flex;
  gap: var(--gc-s2);
}
.ch-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--gc-s2);
}
.ch-bar {
  flex: none;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--gc-s2);
  font-size: var(--gc-fs-meta);
  color: var(--gc-text-3);
}
.ch-bar .spacer {
  flex: 1;
}
.ch-bar .lb {
  white-space: nowrap;
}
.path-input {
  width: 180px;
}
.count-select {
  width: 116px;
}
.ch-meta {
  margin: 0;
  font-size: var(--gc-fs-meta);
  color: var(--gc-text-3);
}
.ch-legend {
  flex: none;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--gc-s3);
  font-size: var(--gc-fs-meta);
  color: var(--gc-text-2);
}
.ch-legend .lg {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  white-space: nowrap;
}
.ch-legend .dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex: none;
}
.ch-list {
  flex: 1;
  min-height: 0;
  overflow: auto;
  background: var(--gc-card);
  border: 1px solid var(--gc-line);
  border-radius: var(--gc-radius);
}
.c-row {
  display: flex;
  align-items: center;
  gap: var(--gc-s2);
  height: 28px;
  padding: 0 var(--gc-pad) 0 4px;
  border-bottom: 1px solid var(--gc-line-weak);
  cursor: pointer;
  min-width: 0;
}
.c-row:hover {
  background: var(--gc-btn-hover);
}
.c-row.is-sel {
  background: var(--gc-accent-weak);
}
.c-row .lane {
  flex: none;
  height: 28px;
  display: inline-flex;
}
.c-row .hash {
  flex: none;
  width: 60px;
  font-family: var(--gc-font-mono);
  font-size: var(--gc-fs-micro);
  color: var(--gc-text-3);
}
.c-row .msg {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--gc-fs-meta);
  color: var(--gc-text);
}
.c-row .brs {
  flex: none;
  display: flex;
  gap: 4px;
}
.c-row .who {
  flex: none;
  width: 64px;
  font-size: var(--gc-fs-micro);
  color: var(--gc-text-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.c-row .when {
  flex: none;
  width: 128px;
  text-align: right;
  font-size: var(--gc-fs-micro);
  color: var(--gc-text-3);
}
.ch-detail {
  flex: none;
  width: 420px;
  display: flex;
  flex-direction: column;
  background: var(--gc-card);
  border: 1px solid var(--gc-line);
  border-radius: var(--gc-radius);
  overflow: hidden;
}
.cd-head {
  flex: none;
  display: flex;
  align-items: center;
  gap: 6px;
  height: 36px;
  padding: 0 var(--gc-pad);
  border-bottom: 1px solid var(--gc-line);
  background: var(--gc-page);
}
.cd-head .spacer {
  flex: 1;
}
.cd-hash {
  font-size: var(--gc-fs-body);
  color: var(--gc-accent-text);
}
.cd-meta {
  flex: none;
  padding: 8px var(--gc-pad) 0;
  font-size: var(--gc-fs-meta);
  color: var(--gc-text-3);
}
.cd-body {
  flex: none;
  padding: 6px var(--gc-pad) 10px;
  border-bottom: 1px solid var(--gc-line-weak);
}
.cd-body b {
  display: block;
  font-size: var(--gc-fs-body);
  color: var(--gc-text);
  line-height: 1.4;
}
.cd-raw {
  margin: 6px 0 0;
  font-family: var(--gc-font-mono);
  font-size: var(--gc-fs-micro);
  color: var(--gc-text-2);
  white-space: pre-wrap;
}
.cd-diff {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: var(--gc-s2) var(--gc-pad);
}
.cd-empty {
  margin: 0;
  font-size: var(--gc-fs-meta);
  color: var(--gc-text-3);
}
.pick-bar {
  flex: none;
  display: flex;
  align-items: center;
  gap: var(--gc-s2);
  padding: 10px var(--gc-pad);
  border-top: 1px solid var(--gc-line);
  background: var(--gc-page);
}
.pick-hint {
  font-size: var(--gc-fs-micro);
  color: var(--gc-text-3);
}
</style>
