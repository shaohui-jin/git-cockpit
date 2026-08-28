<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import type { ConflictFile } from '@/api/types';
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
}>();

const activePath = ref('');
const activeHunkId = ref<string | null>(null);
const autoOnlyExpanded = ref(false);
const hunksByPath = ref<Record<string, ChangeHunk[]>>({});
const scrollRootRef = ref<HTMLElement | null>(null);

function initFromFiles(files: ConflictFile[]): void {
  const next: Record<string, ChangeHunk[]> = {};
  for (const f of files) {
    next[f.path] = buildChangeHunks(f);
  }
  hunksByPath.value = next;
  const first =
    files.find((f) => countHunkStats(next[f.path] ?? []).conflicts > 0)?.path ?? files[0]?.path ?? '';
  activePath.value = first;
  const list = next[first] ?? [];
  activeHunkId.value = list.find((h) => h.kind === 'conflict')?.id ?? list[0]?.id ?? null;
  autoOnlyExpanded.value = false;
}

watch(
  () => props.files,
  (files) => initFromFiles(files),
  { immediate: true, deep: true }
);

const hunks = computed(() => hunksByPath.value[activePath.value] ?? []);
const conflictHunks = computed(() => hunks.value.filter((h) => h.kind === 'conflict'));
const activeHunk = computed(() => hunks.value.find((h) => h.id === activeHunkId.value) ?? null);

const conflictFiles = computed(() =>
  props.files.filter((f) => countHunkStats(hunksByPath.value[f.path] ?? []).conflicts > 0)
);
const autoOnlyFiles = computed(() =>
  props.files.filter((f) => countHunkStats(hunksByPath.value[f.path] ?? []).conflicts === 0)
);

const fileStats = computed(() => countHunkStats(hunks.value));
const conflictFileIndex = computed(() => conflictFiles.value.findIndex((f) => f.path === activePath.value));

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

const activeConflictIndex = computed(() => conflictHunks.value.findIndex((h) => h.id === activeHunkId.value));
const canPickHunk = computed(() => activeHunk.value?.kind === 'conflict');

function fileLabel(path: string): string {
  const s = countHunkStats(hunksByPath.value[path] ?? []);
  if (s.conflicts === 0) return s.changes ? `${s.changes}Δ` : '—';
  return `${s.resolved}/${s.conflicts}`;
}

function selectFile(path: string): void {
  activePath.value = path;
  const list = hunksByPath.value[path] ?? [];
  const first = list.find((h) => h.kind === 'conflict' && h.action === 'pending') ?? list.find((h) => h.kind === 'conflict') ?? list[0];
  activeHunkId.value = first?.id ?? null;
}

function goConflictFile(delta: number): void {
  const list = conflictFiles.value;
  if (list.length < 2) return;
  let idx = conflictFileIndex.value;
  if (idx < 0) idx = delta > 0 ? -1 : 0;
  let next = idx + delta;
  if (next < 0) next = list.length - 1;
  else if (next >= list.length) next = 0;
  const file = list[next];
  if (file) selectFile(file.path);
}

function updateHunk(id: string, action: HunkAction): void {
  const path = activePath.value;
  const list = hunksByPath.value[path];
  if (!list) return;
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

function acceptAll(side: 'left' | 'right', path: string): void {
  const list = hunksByPath.value[path];
  if (!list) return;
  if (path !== activePath.value) activePath.value = path;
  const action: HunkAction = side === 'left' ? 'accept-left' : 'accept-right';
  hunksByPath.value = {
    ...hunksByPath.value,
    [path]: list.map((h) => (h.kind === 'conflict' ? { ...h, action } : h))
  };
}

function acceptActive(side: 'left' | 'right'): void {
  const h = activeHunk.value;
  if (!h || h.kind !== 'conflict') return;
  if (side === 'left') acceptLeft(h);
  else acceptRight(h);
}

function resetCurrentFile(): void {
  const path = activePath.value;
  const file = props.files.find((f) => f.path === path);
  if (!file) return;
  const next = buildChangeHunks(file);
  hunksByPath.value = { ...hunksByPath.value, [path]: next };
  activeHunkId.value = next.find((h) => h.kind === 'conflict')?.id ?? next[0]?.id ?? null;
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
  void nextTick(() => {
    scrollRootRef.value?.querySelector(`[data-hunk-id="${target.id}"]`)?.scrollIntoView({
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

defineExpose({ buildFiles });
</script>

<template>
  <div class="resolve">
    <div class="resolve-head">
      <span>
        冲突 {{ allStats.resolved }} / {{ allStats.total }}
        <span class="muted"> · 绿=新增 蓝=修改（自动进结果） · 红块选线上或我的</span>
      </span>
    </div>

    <div class="resolve-body">
      <div class="file-list">
        <div class="file-list-head">
          <span>冲突文件 {{ conflictFiles.length }}</span>
          <span class="file-nav">
            <el-button size="small" :disabled="conflictFiles.length < 2" @click="goConflictFile(-1)">‹</el-button>
            <span class="nav-pos">{{ conflictFileIndex >= 0 ? conflictFileIndex + 1 : 0 }}/{{ conflictFiles.length }}</span>
            <el-button size="small" :disabled="conflictFiles.length < 2" @click="goConflictFile(1)">›</el-button>
          </span>
        </div>
        <template v-for="f in conflictFiles" :key="f.path">
          <button
            type="button"
            class="file-item"
            :class="{
              active: f.path === activePath,
              done: countHunkStats(hunksByPath[f.path] ?? []).pending === 0
            }"
            @click="selectFile(f.path)"
          >
            <span class="file-main">
              <span class="mono path" :title="f.path">{{ f.path.split('/').pop() }}</span>
              <span class="stat">{{ fileLabel(f.path) }}</span>
            </span>
          </button>
          <div v-if="f.path === activePath" class="file-sides">
            <el-button size="small" @click="acceptAll('left', f.path)">线上</el-button>
            <el-button size="small" @click="acceptAll('right', f.path)">我的</el-button>
          </div>
        </template>
        <button
          v-if="autoOnlyFiles.length"
          type="button"
          class="file-item auto-toggle"
          @click="autoOnlyExpanded = !autoOnlyExpanded"
        >
          {{ autoOnlyExpanded ? '▾' : '▸' }} 仅自动合并（{{ autoOnlyFiles.length }}）
        </button>
        <template v-if="autoOnlyExpanded">
          <button
            v-for="f in autoOnlyFiles"
            :key="f.path"
            type="button"
            class="file-item auto"
            :class="{ active: f.path === activePath }"
            @click="selectFile(f.path)"
          >
            <span class="file-main">
              <span class="mono path" :title="f.path">{{ f.path.split('/').pop() }}</span>
              <span class="stat">{{ fileLabel(f.path) }}</span>
            </span>
          </button>
        </template>
      </div>

      <div class="merge-wrap">
        <div class="merge-bar">
          <span class="mono merge-path" :title="activePath">{{ activePath }}</span>
          <span class="muted">{{ fileStats.resolved }}/{{ fileStats.conflicts }}</span>
          <span class="merge-bar-actions">
            <el-button size="small" :disabled="!conflictHunks.length" @click="goConflict(-1)">上一处</el-button>
            <span class="nav-pos">{{ activeConflictIndex >= 0 ? activeConflictIndex + 1 : 0 }}/{{ conflictHunks.length }}</span>
            <el-button size="small" :disabled="!conflictHunks.length" @click="goConflict(1)">下一处</el-button>
            <el-button size="small" :disabled="!canPickHunk" @click="acceptActive('left')">采用线上</el-button>
            <el-button size="small" :disabled="!canPickHunk" @click="acceptActive('right')">采用我的</el-button>
            <el-button size="small" :disabled="!activePath" @click="resetCurrentFile">重置本文件</el-button>
          </span>
        </div>
        <div ref="scrollRootRef" class="merge">
          <header class="merge-heads">
            <div>线上（合入目标）</div>
            <div />
            <div>结果</div>
            <div />
            <div>我的分支</div>
          </header>
          <div v-if="hunks.length === 0" class="empty">没有可展示的变更</div>
          <div
            v-for="h in hunks"
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
              <pre class="code"><span v-for="(line, i) in (h.leftLines.length ? h.leftLines : [''])" :key="'L'+i" class="code-line">{{ line || ' ' }}</span></pre>
            </div>
            <div class="gutter">
              <el-button
                v-if="h.kind === 'conflict' && h.leftLines.length"
                size="small"
                text
                type="primary"
                :title="choseLeft(h) ? '已采用线上' : '采用线上'"
                @click.stop="acceptLeft(h)"
              >
                {{ choseLeft(h) ? '✓' : '≫' }}
              </el-button>
            </div>
            <div class="pane pane-result">
              <pre class="code"><span v-for="(line, i) in resultLines(h)" :key="'R'+i" class="code-line" :class="{ pending: h.kind === 'conflict' && h.action === 'pending' }">{{ line || ' ' }}</span></pre>
            </div>
            <div class="gutter">
              <el-button
                v-if="h.kind === 'conflict' && h.rightLines.length"
                size="small"
                text
                type="primary"
                :title="choseRight(h) ? '已采用我的' : '采用我的'"
                @click.stop="acceptRight(h)"
              >
                {{ choseRight(h) ? '✓' : '≪' }}
              </el-button>
            </div>
            <div class="pane pane-theirs">
              <pre class="code"><span v-for="(line, i) in (h.rightLines.length ? h.rightLines : [''])" :key="'T'+i" class="code-line">{{ line || ' ' }}</span></pre>
            </div>
          </div>
        </div>
      </div>
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
  min-height: var(--gc-line);
  margin-bottom: var(--gc-gap);
  font-size: var(--gc-text);
  color: var(--el-text-color-secondary);
}
.nav-pos {
  margin: 0 var(--gc-gap);
  text-align: center;
  font-size: var(--gc-text);
  font-variant-numeric: tabular-nums;
}
.muted {
  color: var(--el-text-color-placeholder);
}
.resolve-body {
  display: flex;
  flex: 1;
  min-height: 0;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: var(--gc-radius);
  overflow: hidden;
}
.file-list {
  width: 220px;
  flex-shrink: 0;
  overflow: auto;
  background: var(--el-fill-color-lighter);
  border-right: 1px solid var(--el-border-color-lighter);
}
.file-list-head,
.file-item,
.file-sides,
.merge-bar {
  display: flex;
  align-items: center;
  min-height: var(--gc-line);
  padding: 0 var(--gc-pad);
  font-size: var(--gc-text);
  box-sizing: border-box;
}
.file-list-head,
.file-item,
.merge-bar {
  gap: var(--gc-gap);
}
.file-list-head {
  justify-content: space-between;
  position: sticky;
  top: 0;
  z-index: 1;
  background: var(--el-fill-color-lighter);
  border-bottom: 1px solid var(--el-border-color-lighter);
  color: var(--el-text-color-secondary);
}
.file-nav,
.merge-bar-actions {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  margin-left: auto;
}
.file-item {
  justify-content: space-between;
  width: 100%;
  border: 0;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
}
.file-main {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--gc-gap);
  width: 100%;
  min-width: 0;
}
.file-item:hover {
  background: var(--el-fill-color);
}
.file-item.active {
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
}
.file-item.done .stat {
  color: var(--el-color-success);
}
.file-item.auto-toggle,
.file-item.auto {
  color: var(--el-text-color-secondary);
}
.path,
.merge-path {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}
.merge-path {
  flex: 1;
}
.stat {
  flex-shrink: 0;
  color: var(--el-text-color-secondary);
}
.file-sides {
  background: var(--el-color-primary-light-9);
  border-bottom: 1px solid var(--el-border-color-lighter);
}
.merge-wrap {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.merge-bar {
  flex-shrink: 0;
  border-bottom: 1px solid var(--el-border-color-lighter);
  background: var(--el-bg-color);
}
.merge {
  flex: 1;
  min-width: 0;
  overflow: auto;
}
.merge-heads,
.merge-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 44px minmax(0, 1fr) 44px minmax(0, 1fr);
  align-items: stretch;
}
.merge-heads {
  position: sticky;
  top: 0;
  z-index: 1;
  min-height: var(--gc-line);
  padding: 0;
  background: var(--el-fill-color-light);
  border-bottom: 1px solid var(--el-border-color-lighter);
  font-size: var(--gc-text);
  color: var(--el-text-color-secondary);
}
.merge-heads > div {
  display: flex;
  align-items: center;
  padding: 0 var(--gc-pad);
}
.empty {
  padding: var(--gc-pad);
  font-size: var(--gc-text);
  color: var(--el-text-color-secondary);
}
.merge-row {
  border-bottom: 1px solid var(--el-border-color-extra-light);
  cursor: default;
}
.merge-row.active {
  outline: 1px solid var(--el-color-primary-light-5);
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
  border-left: 1px solid var(--el-border-color-extra-light);
  border-right: 1px solid var(--el-border-color-extra-light);
  background: var(--el-fill-color-lighter);
}
.code {
  margin: 0;
  padding: 0;
  font-size: var(--gc-text);
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
  color: var(--el-text-color-placeholder);
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
.merge-row.hunk-conflict:not(.resolved) .code {
  background: var(--gc-merge-conflict);
}
.merge-row.hunk-conflict:not(.resolved) .pane-ours {
  box-shadow: inset 2px 0 0 var(--el-color-danger);
}
.merge-row.hunk-conflict.chose-left .pane-ours .code,
.merge-row.hunk-conflict.chose-right .pane-theirs .code {
  background: var(--gc-merge-add);
}
</style>
