<script setup lang="ts">
import type { OpenedRepo, RepoOverview } from '@/api/types';
import { attentionOf } from '@/utils/repoAttention';
import ActivityHeatmap from '@/components/ActivityHeatmap.vue';

const props = defineProps<{
  repo: OpenedRepo;
  overview?: RepoOverview;
  current: boolean;
  muted?: boolean;
  dragging?: boolean;
  dragOver?: boolean;
  selected?: boolean;
}>();

const emit = defineEmits<{
  select: [];
  enter: [];
  merge: [];
  remove: [];
  'toggle-select': [];
  dragstart: [e: DragEvent];
  dragover: [e: DragEvent];
  drop: [e: DragEvent];
  dragend: [];
}>();

function formatOpened(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function onDragStart(e: DragEvent): void {
  const t = e.target as HTMLElement | null;
  if (t?.closest?.('button')) {
    e.preventDefault();
    return;
  }
  emit('dragstart', e);
}

function extraBadges(): string[] {
  const o = props.overview;
  if (!o) return [];
  const out: string[] = [];
  if (o.operation !== 'none') out.push(o.operation);
  if (o.conflictCount > 0) out.push(`${o.conflictCount} 冲突`);
  return out;
}
</script>

<template>
  <div
    class="repo-card"
    :class="[attentionOf(overview), { current, muted, dragging, 'drag-over': dragOver }]"
    :title="repo.path"
    draggable="true"
    @click="emit('select')"
    @dblclick="emit('enter')"
    @dragstart="onDragStart"
    @dragover="emit('dragover', $event)"
    @drop="emit('drop', $event)"
    @dragend="emit('dragend')"
  >
    <div class="card-top">
      <el-checkbox
        class="card-check"
        :model-value="selected"
        @click.stop
        @change="emit('toggle-select')"
      />
      <span class="card-name mono">{{ overview?.name || repo.path.split(/[\\/]/).pop() }}</span>
      <span class="card-actions">
        <el-button size="small" text type="primary" @click.stop="emit('enter')">进入</el-button>
        <el-button size="small" text type="primary" @click.stop="emit('merge')">合并</el-button>
        <el-button size="small" text type="danger" @click.stop="emit('remove')">移除</el-button>
      </span>
    </div>
    <div class="card-meta">
      <span class="card-branch mono">{{
        overview?.available === false ? '不可用' : overview?.current || '…'
      }}</span>
      <template v-if="overview && overview.available !== false">
        <span class="card-stat mono">
          <span class="stat-ahead" :class="{ on: overview.ahead > 0 }">{{ overview.ahead }}↑</span>
          <span class="stat-behind" :class="{ on: overview.behind > 0 }">{{ overview.behind }}↓</span>
        </span>
        <span class="stat-dirty" :class="{ on: overview.dirtyCount > 0 }">{{ overview.dirtyCount }} 更改</span>
        <span v-if="overview.tempMergeBranchCount > 0" class="stat-draft">{{ overview.tempMergeBranchCount }} 合并草稿</span>
      </template>
      <span v-for="b in extraBadges()" :key="b" class="card-badge">{{ b }}</span>
    </div>
    <div class="card-foot">
      <ActivityHeatmap
        :days="overview?.activity"
        :start="overview?.activityStart"
        :total="overview?.activityTotal"
      />
      <span class="card-opened" :title="repo.lastOpenedAt">打开 {{ formatOpened(repo.lastOpenedAt) }}</span>
    </div>
  </div>
</template>

<style scoped>
.repo-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: var(--gc-gap) var(--gc-pad);
  border: 1px solid var(--el-border-color-lighter);
  border-radius: var(--gc-radius);
  border-left-width: 3px;
  cursor: grab;
  background: var(--el-bg-color);
  min-width: 0;
}
.repo-card.drag-over {
  outline: 1px dashed var(--el-color-primary);
}
.repo-card:hover {
  background: var(--el-fill-color-light);
}
.repo-card.current {
  background: var(--el-color-primary-light-9);
  box-shadow: var(--gc-shadow-menu);
}
.repo-card.muted {
  opacity: 0.42;
}
.repo-card.muted:hover {
  opacity: 0.72;
}
.repo-card.dragging {
  opacity: 0.45;
}
.repo-card.stuck {
  border-left-color: var(--el-color-danger);
}
.repo-card.dirty {
  border-left-color: var(--el-color-warning);
}
.repo-card.sync {
  border-left-color: var(--el-color-primary);
}
.repo-card.quiet {
  border-left-color: var(--el-border-color);
}
.card-top,
.card-meta {
  display: flex;
  align-items: center;
  gap: var(--gc-gap);
  min-width: 0;
}
.card-check {
  flex: none;
  margin-right: 0;
}
.card-name {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.card-actions {
  flex: none;
  display: flex;
}
.card-branch {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
.card-stat,
.stat-dirty,
.stat-draft,
.card-badge {
  flex: none;
  font-size: 11px;
  color: var(--el-text-color-secondary);
  white-space: nowrap;
}
.card-foot {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: var(--gc-gap);
}
.card-opened {
  flex: none;
  font-size: 11px;
  color: var(--el-text-color-secondary);
  white-space: nowrap;
}
.stat-ahead.on {
  color: var(--el-color-success);
}
.stat-behind.on {
  color: var(--el-color-danger);
}
.stat-dirty.on {
  color: var(--el-color-warning);
}
.stat-draft {
  color: var(--el-color-primary);
}
</style>
