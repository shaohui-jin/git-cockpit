<script setup lang="ts">
import { CanvasEvent, Graph, NodeEvent } from '@antv/g6';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import type { BranchGraph } from '@/api/types';
import { pathToRoots } from '@/graph/pathToRoot';
import {
  branchGraphToG6,
  kindColor,
  legendItemsForGraph,
  tipNameFromNodeId,
  type G6GraphData,
  type G6NodeKind
} from '@/graph/toG6Data';
import { cssVar, isDarkTheme } from '@/graph/theme';

const props = defineProps<{
  data: BranchGraph | null;
  loading?: boolean;
  error?: string;
  defaultRemote?: string;
  remotes?: string[];
}>();

const NODE_LABEL_MAX = 22;
function fitNodeLabel(text: string): string {
  if (text.length <= NODE_LABEL_MAX) return text;
  const keep = NODE_LABEL_MAX - 1;
  const head = Math.ceil(keep * 0.45);
  const tail = keep - head;
  return `${text.slice(0, head)}…${text.slice(-tail)}`;
}

const stageRef = ref<HTMLDivElement | null>(null);
const containerRef = ref<HTMLDivElement | null>(null);
const graphInst = shallowRef<Graph | null>(null);
let resizeObserver: ResizeObserver | null = null;
let themeObserver: MutationObserver | null = null;
let g6Data: G6GraphData | null = null;
let renderSeq = 0;
const HINT_RESERVE = 40;

const searchOpen = ref(false);
const searchQuery = ref('');
const searchIndex = ref(0);
const selectedHint = ref('');

const graphOptions = computed(() => ({
  defaultRemote: props.defaultRemote,
  remotes: props.remotes
}));

const legendItems = computed(() => {
  if (!props.data) return [];
  void isDarkTheme();
  return legendItemsForGraph(props.data, graphOptions.value);
});

const searchHits = computed(() => {
  const q = searchQuery.value.trim().toLowerCase();
  if (!q || !g6Data) return [] as string[];
  return g6Data.nodes
    .filter((n) => {
      const name = (n.data.tipName || n.data.label || '').toLowerCase();
      const sha = (n.data.sha || '').toLowerCase();
      return name.includes(q) || sha.includes(q);
    })
    .map((n) => n.id);
});

function nodeLabel(id: string): string {
  const n = g6Data?.nodes.find((x) => x.id === id);
  if (!n) return tipNameFromNodeId(id) ?? id.slice(0, 7);
  return n.data.label || n.data.tipName || id.slice(0, 7);
}

function measureSize(): { width: number; height: number } {
  const stage = stageRef.value;
  const w = Math.max(120, stage?.clientWidth || containerRef.value?.clientWidth || 640);
  const stageH = stage?.clientHeight || 0;
  const h = Math.max(160, (stageH > 0 ? stageH : 360) - HINT_RESERVE);
  return { width: w, height: h };
}

function clearContainerInlineSize(): void {
  const el = containerRef.value;
  if (!el) return;
  el.style.width = '';
  el.style.height = '';
  el.style.minHeight = '';
  el.style.maxHeight = '';
}

function waitLayout(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });
}

async function clearHighlight(g: Graph): Promise<void> {
  if (!g6Data) return;
  const states: Record<string, string[]> = {};
  for (const n of g6Data.nodes) states[n.id] = [];
  for (const e of g6Data.edges) states[e.id] = [];
  await g.setElementState(states);
  selectedHint.value = '';
}

async function highlightPath(g: Graph, startId: string): Promise<void> {
  if (!g6Data) return;
  const { nodeIds, edgeIds, chain } = pathToRoots(startId, g6Data);
  const states: Record<string, string[]> = {};
  for (const n of g6Data.nodes) {
    if (n.id === startId) states[n.id] = ['selected'];
    else if (nodeIds.has(n.id)) states[n.id] = ['highlight'];
    else states[n.id] = ['inactive'];
  }
  for (const e of g6Data.edges) {
    states[e.id] = edgeIds.has(e.id) ? ['highlight'] : ['inactive'];
  }
  await g.setElementState(states);
  selectedHint.value = chain.map(nodeLabel).join(' ← ');
}

async function focusNode(id: string): Promise<void> {
  const g = graphInst.value;
  if (!g || !g6Data) return;
  await highlightPath(g, id);
  try {
    await g.focusElement(id, { duration: 300 });
  } catch {
    /* 高亮已完成 */
  }
}

function openSearch(): void {
  searchOpen.value = true;
  searchIndex.value = 0;
  void nextTick(() => {
    const el = stageRef.value?.querySelector<HTMLInputElement>('.graph-search-input');
    el?.focus();
    el?.select();
  });
}

function closeSearch(): void {
  searchOpen.value = false;
  searchQuery.value = '';
  searchIndex.value = 0;
}

async function goSearchHit(delta: number): Promise<void> {
  const hits = searchHits.value;
  if (!hits.length) return;
  const next = (searchIndex.value + delta + hits.length * 50) % hits.length;
  searchIndex.value = next;
  await focusNode(hits[next]!);
}

async function onSearchEnter(): Promise<void> {
  if (!searchHits.value.length) return;
  if (searchHits.value.length === 1) {
    searchIndex.value = 0;
    await focusNode(searchHits.value[0]!);
    return;
  }
  await goSearchHit(1);
}

function onStageKeydown(ev: KeyboardEvent): void {
  const mod = ev.ctrlKey || ev.metaKey;
  if (mod && ev.key.toLowerCase() === 'f') {
    ev.preventDefault();
    ev.stopPropagation();
    openSearch();
    return;
  }
  if (ev.key === 'Escape' && searchOpen.value) {
    ev.preventDefault();
    closeSearch();
  }
}

async function destroyGraph(): Promise<void> {
  const g = graphInst.value;
  graphInst.value = null;
  g6Data = null;
  if (g) {
    try {
      g.destroy();
    } catch {
      /* ignore */
    }
  }
  clearContainerInlineSize();
}

async function applySizeAndFit(g: Graph): Promise<void> {
  const { width, height } = measureSize();
  if (width <= 0 || height <= 0) return;
  g.setSize(width, height);
  await g.fitView();
}

async function renderGraph(): Promise<void> {
  const seq = ++renderSeq;
  await nextTick();
  const el = containerRef.value;
  if (!el || !props.data) return;

  await destroyGraph();
  if (seq !== renderSeq) return;
  selectedHint.value = '';

  await waitLayout();
  if (seq !== renderSeq) return;
  clearContainerInlineSize();

  const data = branchGraphToG6(props.data, graphOptions.value);
  g6Data = data;
  if (data.nodes.length === 0) return;

  const { width, height } = measureSize();
  const dark = isDarkTheme();
  const ink = {
    onSolid: '#0b0f16',
    accent: cssVar('--el-color-primary', '#6f6bff'),
    fg: cssVar('--el-text-color-primary', '#e6ecf5'),
    dim: cssVar('--el-text-color-secondary', '#61728a'),
    nodeEdge: dark ? 'rgba(255,255,255,0.25)' : 'rgba(16,24,40,0.22)'
  };

  const g = new Graph({
    container: el,
    width,
    height,
    data,
    autoFit: 'view',
    padding: 32,
    theme: dark ? 'dark' : 'light',
    layout: {
      type: 'dagre',
      rankdir: 'LR',
      nodesep: 36,
      ranksep: 72,
      controlPoints: true
    },
    node: {
      type: 'rect',
      style: {
        size: [176, 46],
        radius: 4,
        labelText: (d) => {
          const sub = (d as { data?: { label?: string; sub?: string } }).data?.sub;
          const label = (d as { data?: { label?: string } }).data?.label ?? '';
          const head = fitNodeLabel(label);
          return sub ? `${head}\n${sub}` : head;
        },
        labelFill: ink.onSolid,
        labelFontSize: 11,
        labelFontWeight: 600,
        labelFontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
        labelPlacement: 'center',
        fill: (d) => {
          const payload = (d as { data?: { color?: string; kind?: G6NodeKind } }).data;
          if (payload?.color) return payload.color;
          return kindColor((payload?.kind ?? 'local-tip') as G6NodeKind);
        },
        stroke: ink.nodeEdge,
        lineWidth: 1,
        opacity: 1
      },
      state: {
        selected: { stroke: ink.accent, lineWidth: 3, shadowColor: ink.accent, shadowBlur: 12, opacity: 1 },
        highlight: { stroke: ink.fg, lineWidth: 2.5, opacity: 1 },
        inactive: { opacity: 0.18 }
      }
    },
    edge: {
      type: 'cubic-horizontal',
      style: { stroke: ink.dim, lineWidth: 2, endArrow: true, opacity: 1 },
      state: {
        highlight: { stroke: ink.accent, lineWidth: 3, opacity: 1, endArrow: true },
        inactive: { opacity: 0.2 }
      }
    },
    behaviors: ['drag-canvas', 'zoom-canvas', 'drag-element']
  });

  g.on(NodeEvent.CLICK, (evt) => {
    const t = evt as { target?: { id?: string }; targetId?: string };
    const id = String(t.targetId ?? t.target?.id ?? '');
    if (!id) return;
    void highlightPath(g, id);
  });
  g.on(CanvasEvent.CLICK, (evt) => {
    const t = evt as { target?: { id?: string }; targetId?: string };
    const id = String(t.targetId ?? t.target?.id ?? '');
    if (id && id !== 'canvas' && !id.startsWith('canvas')) return;
    void clearHighlight(g);
  });

  graphInst.value = g;
  await g.render();
  if (seq !== renderSeq) return;
  await waitLayout();
  if (seq !== renderSeq || graphInst.value !== g) return;
  clearContainerInlineSize();
  await applySizeAndFit(g);
}

function bindResize(): void {
  resizeObserver?.disconnect();
  const stage = stageRef.value;
  if (!stage) return;
  let timer: ReturnType<typeof setTimeout> | null = null;
  resizeObserver = new ResizeObserver(() => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      const g = graphInst.value;
      const { width, height } = measureSize();
      if (!g || width < 80 || height < 80) return;
      void applySizeAndFit(g);
    }, 50);
  });
  resizeObserver.observe(stage);
}

onMounted(() => {
  void renderGraph().then(bindResize);
  stageRef.value?.addEventListener('keydown', onStageKeydown);
  themeObserver = new MutationObserver(() => void renderGraph());
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
});

onBeforeUnmount(() => {
  renderSeq += 1;
  stageRef.value?.removeEventListener('keydown', onStageKeydown);
  themeObserver?.disconnect();
  themeObserver = null;
  resizeObserver?.disconnect();
  resizeObserver = null;
  void destroyGraph();
});

watch(
  () => [props.data, props.defaultRemote ?? '', (props.remotes ?? []).join('\0')] as const,
  () => {
    closeSearch();
    void renderGraph();
  }
);

watch(searchQuery, () => {
  searchIndex.value = 0;
});
</script>

<template>
  <div class="commit-graph">
    <div v-if="error" class="graph-msg">{{ error }}</div>
    <div v-else-if="loading && !data" class="graph-msg">加载分支图…</div>
    <div v-else-if="!data?.tips.length" class="graph-msg">没有分支 tip</div>
    <div
      v-else
      ref="stageRef"
      class="graph-stage"
      tabindex="0"
      title="Ctrl+F 搜索分支节点"
    >
      <div ref="containerRef" class="graph-g6" />

      <button v-if="!searchOpen" type="button" class="graph-search-toggle" title="Ctrl+F" @click="openSearch">
        搜索节点
      </button>
      <div v-if="searchOpen" class="graph-search" @mousedown.stop @click.stop>
        <input
          class="graph-search-input"
          type="search"
          :value="searchQuery"
          placeholder="搜索分支名 / sha…"
          @input="searchQuery = ($event.target as HTMLInputElement).value"
          @keydown.enter.prevent="onSearchEnter"
          @keydown.esc.prevent="closeSearch"
        />
        <span class="graph-search-meta">
          {{ searchHits.length ? `${Math.min(searchIndex + 1, searchHits.length)}/${searchHits.length}` : '0' }}
        </span>
        <el-button size="small" text :disabled="!searchHits.length" @click="goSearchHit(-1)">上一个</el-button>
        <el-button size="small" text :disabled="!searchHits.length" @click="goSearchHit(1)">下一个</el-button>
        <el-button size="small" text @click="closeSearch">关闭</el-button>
      </div>

      <div class="graph-color-legend" title="节点颜色：本地 / 各远程">
        <div v-for="item in legendItems" :key="item.key" class="graph-color-legend-row">
          <span class="legend-swatch" :style="{ background: item.color }" />
          <span>{{ item.label }}</span>
        </div>
      </div>

      <div class="path-hint">
        {{ selectedHint || '点击分支高亮到根源的链路 · 点击空白恢复 · 连线：较近 tip 祖先 → 子分支 · Ctrl+F 搜索' }}
      </div>
    </div>
  </div>
</template>

<style scoped>
.commit-graph {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.graph-msg {
  padding: var(--gc-pad);
  color: var(--el-text-color-secondary);
}
.graph-stage {
  position: relative;
  flex: 1;
  min-height: 0;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: var(--gc-radius);
  background: var(--el-bg-color);
  overflow: hidden;
}
.graph-g6 {
  position: absolute !important;
  top: 0 !important;
  left: 0 !important;
  right: 0 !important;
  bottom: 40px !important;
  width: auto !important;
  height: auto !important;
  max-height: none !important;
  overflow: hidden;
}
.graph-search-toggle {
  position: absolute;
  top: 8px;
  right: 8px;
  z-index: 3;
  height: var(--gc-control);
  padding: 0 10px;
  font-size: var(--gc-text);
  color: var(--el-text-color-regular);
  background: var(--el-bg-color-overlay);
  border: 1px solid var(--el-border-color);
  border-radius: var(--gc-radius);
  cursor: pointer;
}
.graph-search {
  position: absolute;
  top: 8px;
  right: 8px;
  z-index: 3;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 6px;
  background: var(--el-bg-color-overlay);
  border: 1px solid var(--el-border-color);
  border-radius: var(--gc-radius);
}
.graph-search-input {
  width: 180px;
  height: var(--gc-control);
  border: none;
  background: transparent;
  color: var(--el-text-color-primary);
  font-size: var(--gc-text);
  outline: none;
}
.graph-search-meta {
  font-size: 11px;
  color: var(--el-text-color-secondary);
  min-width: 36px;
}
.graph-color-legend {
  position: absolute;
  top: 8px;
  left: 8px;
  z-index: 2;
  padding: 6px 8px;
  background: color-mix(in srgb, var(--el-bg-color) 88%, transparent);
  border: 1px solid var(--el-border-color-lighter);
  border-radius: var(--gc-radius);
  font-size: 11px;
  color: var(--el-text-color-secondary);
}
.graph-color-legend-row {
  display: flex;
  align-items: center;
  gap: 6px;
  line-height: 18px;
}
.legend-swatch {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--el-text-color-primary) 25%, transparent);
}
.path-hint {
  position: absolute;
  left: 8px;
  right: 8px;
  bottom: 8px;
  z-index: 2;
  font-size: 11px;
  line-height: 1.4;
  color: var(--el-text-color-secondary);
  padding: 6px 10px;
  border-radius: var(--gc-radius);
  background: color-mix(in srgb, var(--el-bg-color) 92%, transparent);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  pointer-events: none;
}
</style>
