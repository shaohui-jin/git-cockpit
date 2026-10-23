<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, reactive, ref } from 'vue';
import type { OpenedRepo, RepoOverview } from '@/api/types';
import { attentionOf, weatherOf } from '@/utils/repoAttention';

const props = defineProps<{
  repo: OpenedRepo;
  overview?: RepoOverview;
  current: boolean;
  muted?: boolean;
  dragging?: boolean;
  dragOver?: boolean;
}>();

type RepoCardEmits = {
  select: [];
  enter: [];
  merge: [];
  fetch: [];
  remove: [];
  dragstart: [e: DragEvent];
  dragover: [e: DragEvent];
  drop: [e: DragEvent];
  dragend: [];
};

/** 从 emits 定义推导「无 payload」事件名 */
type VoidEmitKey<T> = {
  [K in keyof T]: T[K] extends [] ? K : never;
}[keyof T];

type MenuAction = Extract<VoidEmitKey<RepoCardEmits>, 'enter' | 'merge' | 'fetch' | 'remove'>;

const emit = defineEmits<RepoCardEmits>();

// Vue 的 emit 是 intersect overload，union 变量无法直接匹配；断言成泛型单签名即可。
const emitVoid = emit as <K extends MenuAction>(event: K) => void;

const missing = () => props.overview?.available === false;
const moreBtn = ref<HTMLButtonElement | null>(null);
const menuEl = ref<HTMLUListElement | null>(null);
const menu = reactive({ open: false, x: 0, y: 0 });

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

function closeMenu(): void {
  menu.open = false;
}

async function toggleMenu(e: MouseEvent): Promise<void> {
  e.stopPropagation();
  if (menu.open) {
    closeMenu();
    return;
  }
  const btn = moreBtn.value?.getBoundingClientRect();
  if (!btn) return;
  menu.open = true;
  menu.x = btn.right;
  menu.y = btn.bottom + 4;
  await nextTick();
  const box = menuEl.value?.getBoundingClientRect();
  const w = box?.width ?? 168;
  const h = box?.height ?? 128;
  let x = btn.right - w;
  let y = btn.bottom + 4;
  if (x < 8) x = 8;
  if (y + h > window.innerHeight - 8) y = Math.max(8, btn.top - h - 4);
  menu.x = x;
  menu.y = y;
}

function run(action: MenuAction): void {
  closeMenu();
  emitVoid(action);
}

function onWinClick(e: MouseEvent): void {
  const t = e.target as Node | null;
  if (moreBtn.value?.contains(t) || menuEl.value?.contains(t)) return;
  closeMenu();
}

onMounted(() => {
  window.addEventListener('click', onWinClick, true);
  window.addEventListener('scroll', closeMenu, true);
  window.addEventListener('resize', closeMenu);
});
onUnmounted(() => {
  window.removeEventListener('click', onWinClick, true);
  window.removeEventListener('scroll', closeMenu, true);
  window.removeEventListener('resize', closeMenu);
});
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
      <span class="card-name mono">{{ overview?.name || repo.path.split(/[\\/]/).pop() }}</span>
      <em v-if="attentionOf(overview) !== 'quiet'" class="wx" :class="attentionOf(overview)">{{
        weatherOf(attentionOf(overview))
      }}</em>
      <button
        ref="moreBtn"
        type="button"
        class="more-btn"
        aria-label="更多"
        :aria-expanded="menu.open"
        @click="toggleMenu"
      >
        <GcIcon name="more" :size="14" />
      </button>
    </div>
    <div class="card-meta">
      <span class="card-branch mono">{{ missing() ? '不可用' : overview?.current || '…' }}</span>
      <span v-if="overview && !missing()" class="card-stats mono">
        <span class="stat-ahead" :class="{ on: overview.ahead > 0 }">{{ overview.ahead }}↑</span>
        <span class="stat-behind" :class="{ on: overview.behind > 0 }">{{ overview.behind }}↓</span>
        <span class="stat-dirty" :class="{ on: overview.dirtyCount > 0 }">{{ overview.dirtyCount }} 更改</span>
        <span v-if="overview.tempMergeBranchCount > 0" class="stat-draft"
          >{{ overview.tempMergeBranchCount }} 草稿</span
        >
        <span v-for="b in extraBadges()" :key="b" class="card-badge">{{ b }}</span>
      </span>
    </div>
  </div>

  <Teleport to="body">
    <ul
      v-if="menu.open"
      ref="menuEl"
      class="el-dropdown-menu gc-card-menu"
      :style="{ left: menu.x + 'px', top: menu.y + 'px' }"
      @click.stop
    >
      <li class="el-dropdown-menu__item" :class="{ 'is-disabled': missing() }" @click="missing() || run('enter')">
        进入工作区
      </li>
      <li class="el-dropdown-menu__item" :class="{ 'is-disabled': missing() }" @click="missing() || run('merge')">
        预演合并
      </li>
      <li class="el-dropdown-menu__item" :class="{ 'is-disabled': missing() }" @click="missing() || run('fetch')">
        抓取这一仓远程
      </li>
      <li class="el-dropdown-menu__item gc-danger" @click="run('remove')">移除（不删磁盘）</li>
    </ul>
  </Teleport>
</template>

<style scoped>
.repo-card {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 9px 11px;
  border: 1px solid var(--gc-line);
  border-radius: var(--gc-radius);
  border-left-width: 2px;
  cursor: grab;
  background: var(--gc-card);
  min-width: 0;
}
.repo-card.drag-over {
  outline: 1px dashed var(--gc-accent);
}
.repo-card:hover {
  background: var(--gc-btn-hover);
}
.repo-card.current {
  background: var(--gc-accent-weak);
}
.repo-card.muted {
  opacity: 1;
}
.repo-card.dragging {
  opacity: 0.45;
}
.repo-card.stuck {
  border-left-color: var(--gc-red);
}
.repo-card.dirty {
  border-left-color: var(--gc-amber);
}
.repo-card.sync {
  border-left-color: var(--gc-accent);
}
.repo-card.quiet {
  border-left-color: var(--gc-line);
}
.repo-card.lost {
  opacity: 0.58;
  border-left-color: var(--gc-line);
}
.repo-card.lost:hover {
  opacity: 0.85;
}
.card-top,
.card-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.card-name {
  flex: 1;
  min-width: 0;
  font-family: var(--gc-font-mono);
  font-size: var(--gc-fs-body);
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.wx {
  flex: none;
  font-style: normal;
  height: 18px;
  padding: 0 7px;
  border-radius: var(--gc-r-tag);
  font-size: var(--gc-fs-micro);
  font-weight: 500;
  line-height: 1;
  display: inline-flex;
  align-items: center;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid var(--gc-line);
  color: var(--gc-text-3);
}
.wx.stuck {
  color: var(--gc-red);
  background: var(--gc-red-weak);
}
.wx.dirty {
  color: var(--gc-amber);
  background: var(--gc-amber-weak);
}
.wx.sync {
  color: var(--gc-accent-text);
  background: var(--gc-accent-weak);
}
.wx.quiet {
  color: var(--gc-green);
  background: var(--gc-green-weak);
}
.wx.lost {
  color: var(--gc-text-3);
  background: rgba(255, 255, 255, 0.05);
}
.more-btn {
  flex: none;
  width: var(--gc-control);
  height: var(--gc-control);
  border: 0;
  border-radius: var(--gc-radius);
  background: transparent;
  color: var(--el-text-color-regular);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.card-ico {
  flex: none;
  color: var(--gc-text-3);
}
.more-btn:hover,
.more-btn[aria-expanded='true'] {
  background: var(--el-fill-color);
}
.card-branch {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--gc-text-2);
  font-size: var(--gc-fs-meta);
}
.card-stats {
  flex: none;
  display: flex;
  align-items: center;
  gap: var(--gc-s2);
  white-space: nowrap;
}
.card-stat,
.stat-dirty,
.stat-draft,
.card-badge {
  flex: none;
  font-size: var(--gc-fs-meta);
  color: var(--gc-text-3);
  white-space: nowrap;
}
.stat-ahead.on {
  color: var(--gc-green);
}
.stat-behind.on {
  color: var(--gc-red);
}
.stat-dirty.on {
  color: var(--gc-amber);
}
.stat-draft {
  color: var(--gc-accent-text);
}
</style>
