<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import type { ConflictBlameResult, ConflictFile } from '@/api/types';
import * as api from '@/api/client';
import {
  applyHunkActions,
  buildChangeHunks,
  countHunkStats,
  kindClass,
  resolveHunkLines,
  type ChangeHunk,
  type HunkAction
} from '@/utils/buildChangeHunks';

const props = defineProps<{
  files: ConflictFile[];
  repoId: number | null;
  into: string;
  from: string;
  leftLabel?: string;
  rightLabel?: string;
  enableBlame?: boolean;
}>();

const leftLabel = computed(() => props.leftLabel || '线上');
const rightLabel = computed(() => props.rightLabel || '我的');

const activeHunkId = ref<string | null>(null);
const autoOnlyExpanded = ref(false);
/** 已完全解决的文件默认折叠（初始态）；会话中解决的文件保持展开供核对 */
const collapsed = ref<Set<string>>(new Set());
const hunksByPath = ref<Record<string, ChangeHunk[]>>({});
const rootRef = ref<HTMLElement | null>(null);
const blame = ref<ConflictBlameResult | null>(null);
const blameLoading = ref(false);
const blameError = ref('');

function initFromFiles(files: ConflictFile[]): void {
  const next: Record<string, ChangeHunk[]> = {};
  for (const f of files) {
    next[f.path] = buildChangeHunks(f);
  }
  hunksByPath.value = next;
  const first = files.find((f) => countHunkStats(next[f.path] ?? []).conflicts > 0)?.path ?? files[0]?.path ?? '';
  const list = next[first] ?? [];
  activeHunkId.value =
    list.find((h) => h.kind === 'conflict' && h.action === 'pending')?.id ??
    list.find((h) => h.kind === 'conflict')?.id ??
    list[0]?.id ??
    null;
  autoOnlyExpanded.value = false;
  // 进来就已全部解决的文件先折叠，减少噪音
  const nextCollapsed = new Set<string>();
  for (const f of files) {
    const s = countHunkStats(next[f.path] ?? []);
    if (s.conflicts > 0 && s.pending === 0) nextCollapsed.add(f.path);
  }
  collapsed.value = nextCollapsed;
}

watch(
  () => props.files,
  (files) => initFromFiles(files),
  { immediate: true, deep: true }
);

const conflictFiles = computed(() =>
  props.files.filter((f) => countHunkStats(hunksByPath.value[f.path] ?? []).conflicts > 0)
);
const autoOnlyFiles = computed(() =>
  props.files.filter((f) => countHunkStats(hunksByPath.value[f.path] ?? []).conflicts === 0)
);

/** 全部文件的 hunk（按 props.files 顺序）：跨文件导航与活跃定位用 */
const allHunks = computed(() => props.files.flatMap((f) => hunksByPath.value[f.path] ?? []));

/** 活跃 hunk 所属文件（由 activeHunkId 派生，blame 上下文用） */
const activePath = computed(() => {
  for (const f of props.files) {
    if ((hunksByPath.value[f.path] ?? []).some((h) => h.id === activeHunkId.value)) return f.path;
  }
  return conflictFiles.value[0]?.path ?? props.files[0]?.path ?? '';
});

function hunksOf(path: string): ChangeHunk[] {
  return hunksByPath.value[path] ?? [];
}

function isCollapsed(path: string): boolean {
  return collapsed.value.has(path);
}

function toggleCollapse(path: string): void {
  const next = new Set(collapsed.value);
  if (next.has(path)) next.delete(path);
  else next.add(path);
  collapsed.value = next;
}

const allStats = computed(() => {
  let conflicts = 0;
  let resolved = 0;
  let pending = 0;
  for (const list of Object.values(hunksByPath.value)) {
    const s = countHunkStats(list);
    conflicts += s.conflicts;
    resolved += s.resolved;
    pending += s.pending;
  }
  return { total: conflicts, resolved, pending };
});

const conflictHunks = computed(() => allHunks.value.filter((h) => h.kind === 'conflict'));
const activeHunk = computed(() => allHunks.value.find((h) => h.id === activeHunkId.value) ?? null);
const canPickHunk = computed(() => activeHunk.value?.kind === 'conflict');
const activeConflictIndex = computed(() => conflictHunks.value.findIndex((h) => h.id === activeHunkId.value));

function fileLabel(path: string): string {
  const s = countHunkStats(hunksByPath.value[path] ?? []);
  if (s.conflicts === 0) return s.changes ? `${s.changes}Δ` : '—';
  return `${s.resolved}/${s.conflicts}`;
}

function focusFile(path: string): void {
  const list = hunksByPath.value[path] ?? [];
  const first =
    list.find((h) => h.kind === 'conflict' && h.action === 'pending') ??
    list.find((h) => h.kind === 'conflict') ??
    list[0];
  activeHunkId.value = first?.id ?? null;
}

function pathOfHunk(id: string | null): string {
  if (id == null) return '';
  for (const f of props.files) {
    if ((hunksByPath.value[f.path] ?? []).some((h) => h.id === id)) return f.path;
  }
  return '';
}

function updateHunk(id: string, action: HunkAction): void {
  const path = pathOfHunk(id);
  const list = path ? hunksByPath.value[path] : undefined;
  if (!path || !list) return;
  hunksByPath.value = {
    ...hunksByPath.value,
    [path]: list.map((h) => (h.id === id ? { ...h, action } : h))
  };
  activeHunkId.value = id;
}

function acceptLeft(h: ChangeHunk): void {
  updateHunk(h.id, 'accept-left');
}
function acceptRight(h: ChangeHunk): void {
  updateHunk(h.id, 'accept-right');
}

/** 工具条采纳：作用于当前活跃冲突（跨文件跳转后用，不必移到行内按钮） */
function acceptActive(side: 'left' | 'right'): void {
  const h = activeHunk.value;
  if (!h || h.kind !== 'conflict') return;
  if (side === 'left') acceptLeft(h);
  else acceptRight(h);
}

function acceptAll(side: 'left' | 'right', path: string): void {
  const list = hunksByPath.value[path];
  if (!list) return;
  const action: HunkAction = side === 'left' ? 'accept-left' : 'accept-right';
  hunksByPath.value = {
    ...hunksByPath.value,
    [path]: list.map((h) => (h.kind === 'conflict' ? { ...h, action } : h))
  };
}

function resetFile(path: string): void {
  const file = props.files.find((f) => f.path === path);
  if (!file) return;
  const next = buildChangeHunks(file);
  hunksByPath.value = { ...hunksByPath.value, [path]: next };
}

function resultLines(h: ChangeHunk): string[] {
  const lines = resolveHunkLines(h);
  if (lines == null) return ['（未选边）'];
  return lines.length ? lines : [''];
}

function choseLeft(h: ChangeHunk): boolean {
  return h.action === 'accept-left';
}
function choseRight(h: ChangeHunk): boolean {
  return h.action === 'accept-right';
}
function isResolved(h: ChangeHunk): boolean {
  return h.kind === 'conflict' && h.action !== 'pending';
}

function goConflict(delta: number): void {
  const list = conflictHunks.value;
  if (!list.length) return;
  const pending = list.filter((h) => h.action === 'pending');
  const pool = pending.length ? pending : list;
  let idx = pool.findIndex((h) => h.id === activeHunkId.value);
  if (idx < 0) idx = delta > 0 ? -1 : 0;
  let next = idx + delta;
  if (next < 0) next = pool.length - 1;
  else if (next >= pool.length) next = 0;
  const target = pool[next]!;
  activeHunkId.value = target.id;
  // 目标在已折叠的文件里时先展开
  const path = pathOfHunk(target.id);
  if (path && isCollapsed(path)) toggleCollapse(path);
  void nextTick(() => {
    rootRef.value?.querySelector(`[data-hunk-id="${target.id}"]`)?.scrollIntoView({
      block: 'center',
      behavior: 'smooth'
    });
  });
}

function buildFiles(): Array<{ path: string; resolvedContent: string }> {
  return props.files.map((f) => ({
    path: f.path,
    resolvedContent: applyHunkActions(hunksByPath.value[f.path] ?? [])
  }));
}

const emit = defineEmits<{
  progress: [payload: { total: number; resolved: number; pending: number }];
}>();

watch(allStats, (s) => emit('progress', s), { immediate: true });

function formatBlameSide(commits: { author: string; summary: string }[]): string {
  if (!commits.length) return '（无溯源）';
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const c of commits) {
    const key = `${c.author}\0${c.summary}`;
    if (seen.has(key)) continue;
    seen.add(key);
    parts.push(`${c.author} · ${c.summary}`);
    if (parts.length >= 3) break;
  }
  return parts.join('；');
}

const blameOurs = computed(() => formatBlameSide(blame.value?.hunks.flatMap((h) => h.ours) ?? []));
const blameTheirs = computed(() => formatBlameSide(blame.value?.hunks.flatMap((h) => h.theirs) ?? []));

async function loadBlame(filePath: string): Promise<void> {
  const id = props.repoId;
  if (id == null || !filePath || !props.into || !props.from || props.enableBlame === false) {
    blame.value = null;
    blameError.value = '';
    return;
  }
  blameLoading.value = true;
  blameError.value = '';
  try {
    blame.value = await api.mergeBlame(id, {
      into: props.into,
      from: props.from,
      path: filePath,
      fetch: false
    });
  } catch (err) {
    blame.value = null;
    blameError.value = err instanceof Error ? err.message : String(err);
  } finally {
    blameLoading.value = false;
  }
}

watch(
  () => [activePath.value, props.into, props.from, props.repoId] as const,
  ([filePath]) => {
    void loadBlame(filePath);
  },
  { immediate: true }
);

defineExpose({ buildFiles });
</script>

<template>
  <div ref="rootRef" class="resolve">
    <div class="resolve-head">
      <span>
        冲突文件 {{ conflictFiles.length }} · 已决 {{ allStats.resolved }}/{{ allStats.total }}
        <span class="muted"> · 绿=新增 紫=修改（自动进结果） · 红块选 {{ leftLabel }} 或 {{ rightLabel }}</span>
      </span>
      <span class="grow" />
      <span class="head-nav">
        <el-button size="small" :disabled="!conflictHunks.length" @click="goConflict(-1)">上一处</el-button>
        <span class="nav-pos"
          >{{ activeConflictIndex >= 0 ? activeConflictIndex + 1 : 0 }}/{{ conflictHunks.length }}</span
        >
        <el-button size="small" :disabled="!conflictHunks.length" @click="goConflict(1)">下一处</el-button>
      </span>
      <span class="head-pick">
        <el-button size="small" :disabled="!canPickHunk" @click="acceptActive('left')">采用{{ leftLabel }}</el-button>
        <el-button size="small" :disabled="!canPickHunk" @click="acceptActive('right')">采用{{ rightLabel }}</el-button>
      </span>
    </div>

    <div class="resolve-body">
      <!-- 冲突文件：全部平铺，各带文件头与五列选边行 -->
      <section v-for="f in conflictFiles" :key="f.path" class="cf-file" :class="{ collapsed: isCollapsed(f.path) }">
        <header class="cf-file-head">
          <button
            class="collapse-btn"
            type="button"
            :aria-label="isCollapsed(f.path) ? '展开文件' : '收起文件'"
            @click="toggleCollapse(f.path)"
          >
            <GcIcon name="chevron-down" :size="12" :class="{ rotated: isCollapsed(f.path) }" />
          </button>
          <GcIcon name="file" :size="12" class="cf-ico" />
          <span class="cf-path mono" :title="f.path">{{ f.path }}</span>
          <span class="cf-prog">{{ fileLabel(f.path) }}</span>
          <span class="cf-actions">
            <el-button size="small" @click="acceptAll('left', f.path)">采用{{ leftLabel }}</el-button>
            <el-button size="small" @click="acceptAll('right', f.path)">采用{{ rightLabel }}</el-button>
            <el-button size="small" @click="resetFile(f.path)">重置本文件</el-button>
          </span>
        </header>
        <template v-if="!isCollapsed(f.path)">
          <div class="merge-heads">
            <div>
              <span class="side-chip ours">OURS · {{ leftLabel }}</span>
            </div>
            <div />
            <div>结果</div>
            <div />
            <div>
              <span class="side-chip theirs">THEIRS · {{ rightLabel }}</span>
            </div>
          </div>
          <div v-if="f.path === activePath && (blameLoading || blameError || blame)" class="blame-bar">
            <span v-if="blameLoading" class="muted">正在溯源作者…</span>
            <span v-else-if="blameError" class="blame-err">{{ blameError }}</span>
            <template v-else>
              <span class="blame-side">{{ leftLabel }}：{{ blameOurs }}</span>
              <span class="blame-side">{{ rightLabel }}：{{ blameTheirs }}</span>
            </template>
          </div>
          <div
            v-for="h in hunksOf(f.path)"
            :key="h.id"
            class="merge-row"
            :class="[
              kindClass(h.kind),
              {
                active: h.id === activeHunkId,
                resolved: isResolved(h),
                'chose-left': choseLeft(h),
                'chose-right': choseRight(h)
              }
            ]"
            :data-hunk-id="h.id"
            @click="activeHunkId = h.id"
          >
            <div class="pane pane-ours">
              <pre
                class="code"
              ><span v-for="(line, i) in (h.leftLines.length ? h.leftLines : [''])" :key="'L'+i" class="code-line">{{ line || ' ' }}</span></pre>
            </div>
            <div class="gutter">
              <button
                v-if="h.kind === 'conflict' && h.leftLines.length"
                type="button"
                class="pick-btn ours"
                :class="{ picked: choseLeft(h) }"
                :title="choseLeft(h) ? `已采用${leftLabel}` : `采用${leftLabel}`"
                :aria-label="`采用${leftLabel}`"
                @click.stop="acceptLeft(h)"
              >
                <GcIcon :name="choseLeft(h) ? 'check' : 'chevron'" :size="12" />
              </button>
            </div>
            <div class="pane pane-result">
              <pre
                class="code"
              ><span v-for="(line, i) in resultLines(h)" :key="'R'+i" class="code-line" :class="{ pending: h.kind === 'conflict' && h.action === 'pending' }">{{ line || ' ' }}</span></pre>
            </div>
            <div class="gutter">
              <button
                v-if="h.kind === 'conflict' && h.rightLines.length"
                type="button"
                class="pick-btn theirs"
                :class="{ picked: choseRight(h) }"
                :title="choseRight(h) ? `已采用${rightLabel}` : `采用${rightLabel}`"
                :aria-label="`采用${rightLabel}`"
                @click.stop="acceptRight(h)"
              >
                <GcIcon :name="choseRight(h) ? 'check' : 'chevron'" :size="12" />
              </button>
            </div>
            <div class="pane pane-theirs">
              <pre
                class="code"
              ><span v-for="(line, i) in (h.rightLines.length ? h.rightLines : [''])" :key="'T'+i" class="code-line">{{ line || ' ' }}</span></pre>
            </div>
          </div>
        </template>
      </section>

      <!-- 仅自动合并的文件：折叠汇总，可展开核对 -->
      <div v-if="autoOnlyFiles.length" class="cf-auto">
        <button
          class="collapse-btn"
          type="button"
          :aria-label="autoOnlyExpanded ? '收起自动合并文件' : '展开自动合并文件'"
          @click="autoOnlyExpanded = !autoOnlyExpanded"
        >
          <GcIcon name="chevron-down" :size="12" :class="{ rotated: !autoOnlyExpanded }" />
        </button>
        仅自动合并（{{ autoOnlyFiles.length }}）· 无冲突，自动进结果
      </div>
      <section v-for="f in autoOnlyFiles" v-show="autoOnlyExpanded" :key="`auto-${f.path}`" class="cf-file auto">
        <header class="cf-file-head">
          <GcIcon name="file" :size="12" class="cf-ico" />
          <span class="cf-path mono" :title="f.path">{{ f.path }}</span>
          <span class="cf-prog">{{ fileLabel(f.path) }}</span>
        </header>
        <div class="merge-heads">
          <div>
            <span class="side-chip ours">OURS · {{ leftLabel }}</span>
          </div>
          <div />
          <div>结果</div>
          <div />
          <div>
            <span class="side-chip theirs">THEIRS · {{ rightLabel }}</span>
          </div>
        </div>
        <div
          v-for="h in hunksOf(f.path)"
          :key="h.id"
          class="merge-row"
          :class="[
            kindClass(h.kind),
            {
              active: h.id === activeHunkId,
              resolved: isResolved(h),
              'chose-left': choseLeft(h),
              'chose-right': choseRight(h)
            }
          ]"
          :data-hunk-id="h.id"
          @click="activeHunkId = h.id"
        >
          <div class="pane pane-ours">
            <pre
              class="code"
            ><span v-for="(line, i) in (h.leftLines.length ? h.leftLines : [''])" :key="'L'+i" class="code-line">{{ line || ' ' }}</span></pre>
          </div>
          <div class="gutter" />
          <div class="pane pane-result">
            <pre
              class="code"
            ><span v-for="(line, i) in resultLines(h)" :key="'R'+i" class="code-line">{{ line || ' ' }}</span></pre>
          </div>
          <div class="gutter" />
          <div class="pane pane-theirs">
            <pre
              class="code"
            ><span v-for="(line, i) in (h.rightLines.length ? h.rightLines : [''])" :key="'T'+i" class="code-line">{{ line || ' ' }}</span></pre>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.resolve {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
.resolve-head {
  display: flex;
  align-items: center;
  gap: var(--gc-gap);
  flex-shrink: 0;
  flex-wrap: wrap;
  min-height: var(--gc-row-lg);
  margin-bottom: var(--gc-gap);
  font-size: var(--gc-fs-body);
  color: var(--el-text-color-secondary);
}
.head-nav,
.head-pick {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  gap: 2px;
}
.nav-pos {
  margin: 0 var(--gc-gap);
  text-align: center;
  font-size: var(--gc-fs-body);
  font-variant-numeric: tabular-nums;
  color: var(--gc-text-3);
}
.muted {
  color: var(--el-text-color-placeholder);
}
.grow {
  flex: 1;
  min-width: 8px;
}
/* 平铺容器：全部冲突文件同屏滚动 */
.resolve-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: var(--gc-gap);
  padding: var(--gc-gap);
  border: 1px solid var(--gc-line);
  border-radius: var(--gc-radius);
  background: var(--gc-card);
}
/* 文件区块：文件头 + 五列选边行 */
.cf-file {
  flex: none;
  border: 1px solid var(--gc-line-weak);
  border-radius: var(--gc-radius);
  overflow: hidden;
  background: var(--gc-page);
}
.cf-file-head {
  display: flex;
  align-items: center;
  gap: var(--gc-gap);
  flex-wrap: wrap;
  min-height: var(--gc-row-lg);
  padding: 4px var(--gc-pad);
  background: var(--gc-card);
  border-bottom: 1px solid var(--gc-line-weak);
  font-size: var(--gc-fs-body);
  color: var(--gc-text-2);
}
.cf-file.collapsed .cf-file-head {
  border-bottom: 0;
}
.cf-ico {
  color: var(--gc-text-3);
  flex: none;
}
.cf-path {
  flex: 1;
  min-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cf-prog {
  flex: none;
  color: var(--gc-text-3);
  font-variant-numeric: tabular-nums;
}
.cf-actions {
  flex: none;
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}
.collapse-btn {
  flex: none;
  width: 20px;
  height: 20px;
  border: 0;
  border-radius: var(--gc-r-tag);
  background: transparent;
  color: var(--gc-text-3);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}
.collapse-btn:hover {
  background: var(--gc-btn-hover);
  color: var(--gc-text-2);
}
.collapse-btn .rotated {
  transform: rotate(-90deg);
}
/* 仅自动合并文件：折叠汇总条 */
.cf-auto {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: none;
  min-height: var(--gc-row-lg);
  padding: 0 var(--gc-pad);
  border: 1px solid var(--gc-line-weak);
  border-radius: var(--gc-radius);
  background: var(--gc-page);
  font-size: var(--gc-fs-body);
  color: var(--gc-text-3);
}
.merge-heads,
.merge-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 44px minmax(0, 1fr) 44px minmax(0, 1fr);
  align-items: stretch;
}
.merge-heads {
  min-height: var(--gc-row-lg);
  padding: 0;
  background: var(--gc-page);
  border-bottom: 1px solid var(--gc-line-weak);
  font-size: var(--gc-fs-meta);
  color: var(--gc-text-3);
}
.merge-heads > div {
  display: flex;
  align-items: center;
  padding: 0 var(--gc-pad);
}
/* OURS / THEIRS 侧标：青 / 紫，与全站语义一致 */
.side-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 18px;
  padding: 0 6px;
  border-radius: var(--gc-r-tag);
  font-size: var(--gc-fs-micro);
  font-weight: 600;
  letter-spacing: 0.04em;
  white-space: nowrap;
}
.side-chip.ours {
  background: var(--gc-ours-bg);
  border: 1px solid var(--gc-ours-border);
  color: var(--gc-ours-text);
}
.side-chip.theirs {
  background: var(--gc-purple-weak);
  border: 1px solid rgba(163, 113, 247, 0.35);
  color: var(--gc-purple);
}
.blame-bar {
  display: flex;
  flex-wrap: wrap;
  gap: var(--gc-gap);
  padding: 4px var(--gc-pad);
  border-bottom: 1px solid var(--gc-line-weak);
  background: var(--gc-page);
  font-size: var(--gc-fs-body);
  color: var(--gc-text-3);
}
.blame-side {
  min-width: 0;
}
.blame-err {
  color: var(--gc-amber);
}
.empty {
  padding: var(--gc-pad);
  font-size: var(--gc-fs-body);
  color: var(--el-text-color-secondary);
}
.merge-row {
  border-bottom: 1px solid var(--gc-line-weak);
  cursor: default;
}
.merge-row.active {
  outline: 1px solid var(--gc-accent);
  outline-offset: -1px;
}
.pane {
  min-width: 0;
  overflow: hidden;
}
.gutter {
  display: flex;
  align-items: center;
  justify-content: center;
  border-left: 1px solid var(--gc-line-weak);
  border-right: 1px solid var(--gc-line-weak);
  background: var(--gc-page);
}
/* 选边按钮：图标化（禁字符），选中后转 check + 侧色 */
.pick-btn {
  width: 22px;
  height: 22px;
  border: 0;
  border-radius: var(--gc-r-tag);
  background: transparent;
  color: var(--gc-text-3);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition:
    background var(--gc-t-micro) var(--gc-ease),
    color var(--gc-t-micro) var(--gc-ease);
}
.pick-btn:hover {
  background: rgba(255, 255, 255, 0.06);
  color: var(--gc-text-2);
}
.pick-btn.ours.picked {
  background: var(--gc-ours-bg);
  border: 1px solid var(--gc-ours-border);
  color: var(--gc-ours-text);
}
.pick-btn.theirs.picked {
  background: var(--gc-purple-weak);
  border: 1px solid rgba(163, 113, 247, 0.35);
  color: var(--gc-purple);
}
.code {
  margin: 0;
  padding: 0;
  font-size: var(--gc-fs-body);
  line-height: var(--gc-merge-code-line);
}
.code-line {
  display: block;
  min-height: var(--gc-merge-code-line);
  padding: 0 var(--gc-pad);
  white-space: pre;
  overflow: hidden;
  text-overflow: ellipsis;
}
.code-line.pending {
  color: var(--gc-text-3);
}
.merge-row.hunk-add-left .pane-ours .code,
.merge-row.hunk-add-left .pane-result .code {
  background: var(--gc-merge-add);
}
.merge-row.hunk-add-right .pane-theirs .code,
.merge-row.hunk-add-right .pane-result .code {
  background: var(--gc-merge-add);
}
.merge-row.hunk-modify-left .pane-ours .code,
.merge-row.hunk-modify-left .pane-result .code {
  background: var(--gc-merge-mod);
}
.merge-row.hunk-modify-right .pane-theirs .code,
.merge-row.hunk-modify-right .pane-result .code {
  background: var(--gc-merge-mod);
}
/* 未决冲突行：整行红弱底 + 左 2px 红边（"未确认不安置"）；已决：左 2px 绿边 */
.merge-row.hunk-conflict:not(.resolved) {
  background: rgba(255, 133, 133, 0.06);
  box-shadow: inset 2px 0 0 var(--gc-red);
}
.merge-row.hunk-conflict:not(.resolved) .code {
  background: var(--gc-merge-conflict);
}
.merge-row.hunk-conflict.resolved {
  box-shadow: inset 2px 0 0 var(--gc-green);
}
.merge-row.hunk-conflict.chose-left .pane-ours .code,
.merge-row.hunk-conflict.chose-right .pane-theirs .code {
  background: var(--gc-merge-add);
}
.merge-row.hunk-conflict.chose-left .pane-ours .code {
  background: var(--gc-ours-bg);
}
.merge-row.hunk-conflict.chose-right .pane-theirs .code {
  background: var(--gc-purple-weak);
}
</style>
