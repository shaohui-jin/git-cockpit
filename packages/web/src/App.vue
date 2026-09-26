<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useReposStore } from '@/stores/repos';
import { useSettingsStore } from '@/stores/settings';
import { useBranchesStore } from '@/stores/branches';
import { useMergeSessionStore } from '@/stores/mergeSession';
import { useJobsStore } from '@/stores/jobs';
import { useOverviewStore } from '@/stores/overview';
import { subscribeEvents } from '@/api/client';
import { useRevision } from '@/composables/revision';
import { jobLine, notifyJobEnded } from '@/utils/jobNotify';
import ChatView from '@/views/ChatView.vue';

type DockItem = { path: string; label: string };

const repos = useReposStore();
const settings = useSettingsStore();
const branches = useBranchesStore();
const mergeSession = useMergeSessionStore();
const jobs = useJobsStore();
const overview = useOverviewStore();
const route = useRoute();
const router = useRouter();
const { bump, revision } = useRevision();

type Frame = { x: number; y: number; w: number; h: number };
type Grip = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

type BallAnchor = { side: 'left' | 'right'; fromBottom: number };

const chatOpen = ref(false);
const chatPhase = ref<'idle' | 'streaming' | 'confirm' | 'error'>('idle');
const frame = ref<Frame>({ x: 0, y: 0, w: 420, h: 560 });
const ballPos = ref({ x: 0, y: 0 });
const ballAnchor = ref<BallAnchor>({ side: 'right', fromBottom: 96 });
const ballReady = ref(false);
const ballDragging = ref(false);
const ballSettling = ref(false);
let ballDragged = false;

const BALL = 52;
const FRAME_MIN_W = 320;
const FRAME_MIN_H = 360;
const BALL_KEY = 'gc-chat-ball';
const FRAME_KEY = 'gc-chat-frame';
const GRIPS: Grip[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];

const workItems: DockItem[] = [
  { path: '/dashboard', label: '工作台' },
  { path: '/status', label: '状态' },
  { path: '/merge', label: '合并' }
];
const systemItems: DockItem[] = [
  { path: '/jobs', label: '任务' },
  { path: '/logs', label: '日志' },
  { path: '/settings', label: '设置' }
];
const dockItems = [...workItems, ...systemItems];

const liveJob = computed(() => jobs.jobs.find((j) => j.status === 'running') ?? null);
const liveJobTitle = computed(() => (liveJob.value ? jobLine(liveJob.value) : ''));

const chatRepoLabel = computed(() => {
  const p = repos.currentPath;
  if (!p) return '未选择仓库';
  const leaf = p.replace(/\\/g, '/').split('/').filter(Boolean).pop();
  return leaf || p;
});

function pageActive(path: string): boolean {
  if (path === '/logs') return route.path === '/logs';
  return route.path === path;
}

function goMenu(p: string): void {
  if (p === route.path) return;
  void router.push(p).catch(() => undefined);
}

function onChatLeave(): void {
  chatOpen.value = false;
}

function dockSpace(): number {
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--gc-control');
  const control = Number.parseFloat(raw) || 32;
  return control + 48;
}

function clampBall(pos: { x: number; y: number }, aboveDock = false): { x: number; y: number } {
  const bottom = aboveDock ? dockSpace() : 8;
  return {
    x: Math.min(window.innerWidth - BALL - 8, Math.max(8, pos.x)),
    y: Math.min(window.innerHeight - BALL - bottom, Math.max(8, pos.y))
  };
}

function defaultBall(): { x: number; y: number } {
  ballAnchor.value = { side: 'right', fromBottom: dockSpace() + 16 };
  return placeBall(ballAnchor.value);
}

function placeBall(anchor: BallAnchor): { x: number; y: number } {
  const fromBottom = Math.max(dockSpace(), anchor.fromBottom);
  const x = anchor.side === 'left' ? 16 : window.innerWidth - BALL - 16;
  const y = window.innerHeight - BALL - fromBottom;
  return clampBall({ x, y }, true);
}

function anchorFromPos(pos: { x: number; y: number }): BallAnchor {
  return {
    side: pos.x + BALL / 2 < window.innerWidth / 2 ? 'left' : 'right',
    fromBottom: Math.max(dockSpace(), window.innerHeight - (pos.y + BALL))
  };
}

function readAnchor(saved: { x?: number; y?: number; side?: string; fromBottom?: number }): BallAnchor | null {
  if ((saved.side === 'left' || saved.side === 'right') && typeof saved.fromBottom === 'number') {
    return { side: saved.side, fromBottom: saved.fromBottom };
  }
  if (typeof saved.x === 'number' && typeof saved.y === 'number') {
    return {
      side: saved.x + BALL / 2 < window.innerWidth / 2 ? 'left' : 'right',
      fromBottom: Math.max(dockSpace(), window.innerHeight - (saved.y + BALL))
    };
  }
  return null;
}

function clampFrame(next: Frame): Frame {
  const w = Math.min(window.innerWidth - 16, Math.max(FRAME_MIN_W, next.w));
  const h = Math.min(window.innerHeight - 16, Math.max(FRAME_MIN_H, next.h));
  return {
    w,
    h,
    x: Math.min(window.innerWidth - w - 8, Math.max(8, next.x)),
    y: Math.min(window.innerHeight - h - 8, Math.max(8, next.y))
  };
}

function defaultFrame(): Frame {
  const margin = 16;
  const w = Math.min(420, window.innerWidth - margin * 2);
  const h = Math.min(Math.round(window.innerHeight * 0.7), window.innerHeight - dockSpace() - margin * 2);
  return clampFrame({
    x: window.innerWidth - w - margin,
    y: window.innerHeight - dockSpace() - h - margin,
    w,
    h
  });
}

function saveFrame(): void {
  sessionStorage.setItem(FRAME_KEY, JSON.stringify(frame.value));
}

function loadChrome(): void {
  try {
    const saved = JSON.parse(sessionStorage.getItem(FRAME_KEY) || '') as Partial<Frame>;
    if ([saved.x, saved.y, saved.w, saved.h].every((n) => typeof n === 'number')) {
      frame.value = clampFrame(saved as Frame);
    } else frame.value = defaultFrame();
  } catch {
    frame.value = defaultFrame();
  }
  try {
    const saved = JSON.parse(sessionStorage.getItem(BALL_KEY) || '') as {
      x?: number;
      y?: number;
      side?: string;
      fromBottom?: number;
    };
    const anchor = readAnchor(saved);
    if (anchor) {
      ballAnchor.value = anchor;
      ballPos.value = placeBall(anchor);
      ballReady.value = true;
      return;
    }
  } catch {
    /* 用默认位置 */
  }
  ballPos.value = defaultBall();
  ballReady.value = true;
}

function resetFrameSize(): void {
  const next = defaultFrame();
  frame.value = clampFrame({ ...frame.value, w: next.w, h: next.h });
  saveFrame();
}

function onBallDown(ev: PointerEvent): void {
  ballDragged = false;
  ballDragging.value = true;
  ballSettling.value = false;
  const startX = ev.clientX;
  const startY = ev.clientY;
  const origin = { ...ballPos.value };
  const move = (e: PointerEvent) => {
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (Math.hypot(dx, dy) > 4) ballDragged = true;
    ballPos.value = clampBall({ x: origin.x + dx, y: origin.y + dy });
  };
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    ballDragging.value = false;
    if (ballDragged) {
      ballAnchor.value = anchorFromPos(ballPos.value);
      ballSettling.value = true;
      ballPos.value = placeBall(ballAnchor.value);
      window.setTimeout(() => {
        ballSettling.value = false;
      }, 180);
    }
    sessionStorage.setItem(BALL_KEY, JSON.stringify(ballAnchor.value));
    if (!ballDragged) chatOpen.value = true;
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}

function onPanelDragDown(ev: PointerEvent): void {
  if ((ev.target as Element | null)?.closest('button')) return;
  const startX = ev.clientX;
  const startY = ev.clientY;
  const origin = { ...frame.value };
  const move = (e: PointerEvent) => {
    frame.value = clampFrame({ ...origin, x: origin.x + e.clientX - startX, y: origin.y + e.clientY - startY });
  };
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    saveFrame();
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}

function onFrameResize(grip: Grip, ev: PointerEvent): void {
  ev.preventDefault();
  ev.stopPropagation();
  const startX = ev.clientX;
  const startY = ev.clientY;
  const origin = { ...frame.value };
  const move = (e: PointerEvent) => {
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    let { x, y, w, h } = origin;
    if (grip.includes('e')) w = origin.w + dx;
    if (grip.includes('w')) {
      w = origin.w - dx;
      x = origin.x + dx;
    }
    if (grip.includes('s')) h = origin.h + dy;
    if (grip.includes('n')) {
      h = origin.h - dy;
      y = origin.y + dy;
    }
    frame.value = clampFrame({ x, y, w, h });
  };
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    saveFrame();
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}

function onPointerDown(ev: PointerEvent): void {
  if (!chatOpen.value) return;
  const target = ev.target;
  if (!(target instanceof Element)) return;
  if (target.closest('.chat-panel, .el-overlay, .el-popper, .el-message, .el-dialog')) return;
  chatOpen.value = false;
}

function onResizeWindow(): void {
  ballPos.value = placeBall(ballAnchor.value);
  frame.value = clampFrame(frame.value);
}

const ballTitle = computed(() => {
  if (chatPhase.value === 'streaming') return '回复中';
  if (chatPhase.value === 'confirm') return '待确认';
  if (chatPhase.value === 'error') return '回复中断';
  return '打开聊天';
});

let unsubscribe: (() => void) | null = null;

onMounted(async () => {
  await repos.checkHealth();
  await repos.load();
  await Promise.all([settings.load(repos.currentId).catch(() => undefined), branches.load(), jobs.load()]);
  unsubscribe = subscribeEvents({
    onRepoChanged: (payload) => {
      bump();
      mergeSession.onRepoChanged(payload.repoPath);
    },
    onLog: () => bump(),
    onJobProgress: (payload) => {
      jobs.onProgress(payload);
      notifyJobEnded(payload, router);
      if (payload.status === 'ok') {
        bump();
        void repos.load().then(() => {
          const ids = repos.repos.map((r) => r.id);
          overview.prune(ids);
          void overview.refresh(ids, { force: true, background: true });
        });
      }
    },
    onError: () => {
      // SSE 断开会由浏览器自动重连；这里仅静默
    }
  });
  window.addEventListener('keydown', onKeydown);
  window.addEventListener('resize', onResizeWindow);
  window.addEventListener('pointerdown', onPointerDown);
  loadChrome();
});

watch(
  () => route.path,
  async (p) => {
    if (p === '/chat') {
      chatOpen.value = true;
      await router.replace('/dashboard');
    }
  },
  { immediate: true }
);

watch(
  () => repos.currentId,
  () => {
    void branches.load();
    void settings.load(repos.currentId).catch(() => undefined);
  }
);
watch(revision, () => {
  void branches.load();
  const ids = repos.repos.map((r) => r.id);
  if (ids.length) {
    void overview.refresh(ids, { force: true, background: true });
  }
});

function onKeydown(ev: KeyboardEvent): void {
  if (ev.key === 'Escape' && chatOpen.value) chatOpen.value = false;
}

onUnmounted(() => {
  unsubscribe?.();
  window.removeEventListener('keydown', onKeydown);
  window.removeEventListener('resize', onResizeWindow);
  window.removeEventListener('pointerdown', onPointerDown);
});
</script>

<template>
  <div class="app-shell">
    <header class="top">
      <div class="brand">
        <span class="brand-mark">⌘</span>
        <span class="brand-name">Git Cockpit</span>
      </div>
      <div class="top-end">
        <button v-if="liveJob" type="button" class="pulse" :title="liveJobTitle" @click="goMenu('/jobs')">
          <i /><span>{{ liveJobTitle }}</span>
          <em v-if="jobs.runningCount > 1">{{ jobs.runningCount }}</em>
        </button>
        <el-tag v-if="repos.healthOk" size="small" type="success">后端已连接</el-tag>
        <el-tag v-else-if="repos.healthOk === false" size="small" type="danger">后端离线</el-tag>
        <el-tag v-else size="small" type="info">连接中…</el-tag>
        <span v-if="repos.serverVersion" class="top-version">{{ repos.serverVersion }}</span>
      </div>
    </header>

    <main class="main-content">
      <router-view v-slot="{ Component }">
        <div class="route-view">
          <component :is="Component" />
        </div>
      </router-view>
    </main>

    <aside
      v-show="chatOpen"
      class="chat-panel"
      :style="{ left: `${frame.x}px`, top: `${frame.y}px`, width: `${frame.w}px`, height: `${frame.h}px` }"
      role="dialog"
      aria-label="聊天"
    >
      <div
        v-for="grip in GRIPS"
        :key="grip"
        class="grip"
        :class="'grip-' + grip"
        @pointerdown="onFrameResize(grip, $event)"
      />
      <header class="sheet-bar" @pointerdown="onPanelDragDown">
        <span>助手 · {{ chatRepoLabel }}</span>
        <button type="button" class="sheet-close" @click="resetFrameSize">重置</button>
      </header>
      <ChatView embedded @leave="onChatLeave" @phase="chatPhase = $event" />
    </aside>

    <button
      v-show="!chatOpen && ballReady"
      type="button"
      class="chat-ball"
      :class="[chatPhase, { dragging: ballDragging, settling: ballSettling }]"
      :style="{ left: `${ballPos.x}px`, top: `${ballPos.y}px` }"
      :title="ballTitle"
      aria-label="打开聊天"
      @pointerdown="onBallDown"
    >
      <span class="ball-ring" />
      <svg class="ball-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path
          fill="currentColor"
          d="M5 5.5A2.5 2.5 0 0 1 7.5 3h9A2.5 2.5 0 0 1 19 5.5v7A2.5 2.5 0 0 1 16.5 15H12l-3.6 3.2c-.6.5-1.4.1-1.4-.7V15H7.5A2.5 2.5 0 0 1 5 12.5v-7Z"
        />
      </svg>
      <i v-if="chatPhase === 'confirm'" class="ball-dot" />
    </button>

    <nav class="dock" aria-label="主导航">
      <button
        v-for="m in dockItems"
        :key="m.path"
        type="button"
        class="dock-btn"
        :class="{ on: pageActive(m.path) }"
        @click="goMenu(m.path)"
      >
        {{ m.label }}
        <span v-if="m.path === '/jobs' && jobs.runningCount" class="dock-count">{{ jobs.runningCount }}</span>
      </button>
    </nav>
  </div>
</template>

<style scoped>
.app-shell {
  height: 100%;
  position: relative;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--el-bg-color-page);
  --gc-dock-space: calc(var(--gc-control) + var(--gc-pad) * 2 + var(--gc-gap) * 2);
}
.top {
  flex: none;
  display: flex;
  align-items: center;
  gap: var(--gc-pad);
  height: var(--gc-line);
  padding: 0 var(--gc-pad);
  border-bottom: 1px solid var(--el-border-color-light);
  background: var(--el-bg-color);
  z-index: 10;
}
.brand {
  display: flex;
  align-items: center;
  gap: var(--gc-gap);
  font-size: var(--el-font-size-extra-large);
  font-weight: 600;
}
.brand-mark {
  color: var(--el-color-primary);
}
.top-end {
  display: flex;
  align-items: center;
  gap: var(--gc-pad);
  margin-left: auto;
  min-width: 0;
}
.pulse {
  display: inline-flex;
  align-items: center;
  gap: var(--gc-gap);
  min-width: 0;
  max-width: 280px;
  height: var(--gc-control);
  padding: 0 var(--gc-pad);
  border: 0;
  border-radius: var(--gc-radius);
  background: color-mix(in srgb, var(--el-color-success) 16%, transparent);
  color: var(--el-text-color-regular);
  font: inherit;
  font-size: var(--gc-text);
  cursor: pointer;
}
.pulse span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pulse i {
  flex: none;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--el-color-success);
  box-shadow: 0 0 8px var(--el-color-success);
}
.pulse em {
  flex: none;
  font-style: normal;
  min-width: 16px;
  height: 16px;
  padding: 0 5px;
  border-radius: 8px;
  background: var(--el-color-danger);
  color: #fff;
  font-size: 11px;
  line-height: 16px;
  text-align: center;
}
.top-version {
  font-size: var(--gc-text);
  color: var(--el-text-color-secondary);
}
.main-content {
  flex: 1;
  min-height: 0;
  padding: var(--gc-pad);
  padding-bottom: var(--gc-dock-space);
  width: 100%;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.route-view {
  flex: 1;
  min-height: 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.route-view > * {
  flex: 1;
  min-height: 0;
  min-width: 0;
}
/* 低于 dock(25) 与 Element 对话框(~2000) */
.chat-panel {
  position: absolute;
  z-index: 20;
  display: flex;
  flex-direction: column;
  min-width: 0;
  background: color-mix(in srgb, var(--el-bg-color-overlay) 94%, transparent);
  border: 1px solid var(--el-border-color);
  border-radius: var(--gc-radius);
  box-shadow: var(--gc-shadow-menu);
  backdrop-filter: blur(16px);
}
.grip {
  position: absolute;
  z-index: 2;
}
.grip-n,
.grip-s {
  left: 10px;
  right: 10px;
  height: 6px;
  cursor: ns-resize;
}
.grip-n {
  top: -3px;
}
.grip-s {
  bottom: -3px;
}
.grip-e,
.grip-w {
  top: 10px;
  bottom: 10px;
  width: 6px;
  cursor: ew-resize;
}
.grip-e {
  right: -3px;
}
.grip-w {
  left: -3px;
}
.grip-ne,
.grip-nw,
.grip-se,
.grip-sw {
  width: 12px;
  height: 12px;
}
.grip-ne {
  top: -4px;
  right: -4px;
  cursor: nesw-resize;
}
.grip-nw {
  top: -4px;
  left: -4px;
  cursor: nwse-resize;
}
.grip-se {
  right: -4px;
  bottom: -4px;
  cursor: nwse-resize;
}
.grip-sw {
  left: -4px;
  bottom: -4px;
  cursor: nesw-resize;
}
.chat-panel :deep(.chat-page) {
  flex: 1;
  min-height: 0;
  height: auto;
  overflow: hidden;
  padding: var(--gc-pad);
}
.chat-ball {
  position: absolute;
  z-index: 20;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 52px;
  height: 52px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: var(--el-color-primary);
  color: #fff;
  box-shadow: var(--gc-shadow-menu);
  cursor: grab;
  touch-action: none;
}
.chat-ball.dragging {
  transform: scale(1.06);
  cursor: grabbing;
}
.chat-ball.settling {
  transition:
    left 0.16s ease,
    top 0.16s ease;
}
.ball-ring {
  position: absolute;
  inset: 3px;
  border-radius: 50%;
  border: 2px solid transparent;
}
.chat-ball.streaming .ball-ring {
  border-color: rgb(255 255 255 / 28%);
  border-top-color: #fff;
  animation: ball-spin 0.8s linear infinite;
}
.chat-ball.confirm {
  box-shadow:
    var(--gc-shadow-menu),
    0 0 0 2px var(--el-color-warning);
}
.chat-ball.error {
  box-shadow:
    var(--gc-shadow-menu),
    0 0 0 2px var(--el-color-danger);
}
.ball-icon {
  position: relative;
  width: 22px;
  height: 22px;
}
.ball-dot {
  position: absolute;
  top: 6px;
  right: 6px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--el-color-warning);
  box-shadow: 0 0 0 2px var(--el-color-primary);
}
@keyframes ball-spin {
  to {
    transform: rotate(360deg);
  }
}
.sheet-bar {
  flex: none;
  display: flex;
  align-items: center;
  height: var(--gc-line);
  padding: 0 var(--gc-pad);
  border-bottom: 1px solid var(--el-border-color-lighter);
  font-weight: 600;
  min-width: 0;
  gap: var(--gc-gap);
  cursor: grab;
  user-select: none;
  touch-action: none;
}
.sheet-bar:active {
  cursor: grabbing;
}
.sheet-bar span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sheet-close {
  margin-left: auto;
  height: var(--gc-control);
  padding: 0 var(--gc-pad);
  border: 0;
  border-radius: var(--gc-radius);
  background: var(--el-fill-color-light);
  color: inherit;
  font: inherit;
  font-size: var(--gc-text);
  cursor: pointer;
}
.dock {
  position: absolute;
  z-index: 25;
  left: 50%;
  bottom: var(--gc-pad);
  transform: translateX(-50%);
  display: flex;
  gap: var(--gc-gap);
  padding: var(--gc-gap);
  border-radius: var(--gc-radius);
  background: color-mix(in srgb, var(--el-bg-color) 82%, transparent);
  border: 1px solid var(--el-border-color);
  box-shadow: var(--gc-shadow-menu);
  backdrop-filter: blur(16px);
}
.dock-btn {
  position: relative;
  border: 0;
  background: transparent;
  color: var(--el-text-color-regular);
  padding: 0 var(--gc-pad);
  height: var(--gc-control);
  border-radius: var(--gc-radius);
  cursor: pointer;
  font: inherit;
  font-size: var(--gc-text);
  opacity: 0.65;
}
.dock-btn.on {
  opacity: 1;
  background: color-mix(in srgb, var(--el-color-primary) 22%, transparent);
  color: var(--el-text-color-primary);
}
.dock-count {
  margin-left: 4px;
  min-width: 16px;
  height: 16px;
  padding: 0 5px;
  border-radius: 8px;
  background: var(--el-color-danger);
  color: #fff;
  font-size: 11px;
  line-height: 16px;
  display: inline-block;
  vertical-align: middle;
}
</style>
