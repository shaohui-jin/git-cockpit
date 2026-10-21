<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { version as pageVersion } from '../package.json';
import { getDesktopBridge, type DesktopUpdateState } from '@/desktopBridge';
import { useReposStore } from '@/stores/repos';
import { useSettingsStore } from '@/stores/settings';
import { useBranchesStore } from '@/stores/branches';
import { useMergeSessionStore } from '@/stores/mergeSession';
import { useJobsStore } from '@/stores/jobs';
import { repoLeaf, useChatStore } from '@/stores/chat';
import { ApiError, shutdownService, subscribeEvents } from '@/api/client';
import { useRevision } from '@/composables/revision';
import { jobLine, notifyJobEnded } from '@/utils/jobNotify';

const ChatView = defineAsyncComponent(() => import('@/views/ChatView.vue'));

type DockItem = { path: string; label: string; icon: string };

const repos = useReposStore();
const settings = useSettingsStore();
const branches = useBranchesStore();
const mergeSession = useMergeSessionStore();
const jobs = useJobsStore();
const threads = useChatStore();
const route = useRoute();
const router = useRouter();
const { bump } = useRevision();

type Frame = { x: number; y: number; w: number; h: number };
type Grip = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

type BallAnchor = { side: 'left' | 'right'; fromBottom: number };

const chatOpen = ref(false);
const chatAlive = ref(false);
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
  { path: '/dashboard', label: '工作台', icon: 'gauge' },
  { path: '/status', label: '状态', icon: 'activity' },
  { path: '/merge', label: '合并', icon: 'git-merge' }
];
const systemItems: DockItem[] = [
  { path: '/jobs', label: '任务', icon: 'layers' },
  { path: '/logs', label: '日志', icon: 'scroll' },
  { path: '/conversations', label: '对话记录', icon: 'bubble' },
  { path: '/settings', label: '设置', icon: 'sliders' }
];
const dockItems = [...workItems, ...systemItems];

const liveJob = computed(() => jobs.jobs.find((j) => j.status === 'running') ?? null);
const liveJobTitle = computed(() => (liveJob.value ? jobLine(liveJob.value) : ''));

const desktop = ref<DesktopUpdateState>({
  version: '',
  latest: null,
  updateAvailable: false,
  downloaded: false,
  percent: null,
  installMode: 'none',
  jobId: null
});
const backendVersion = computed(() => repos.serverVersion || pageVersion);
const backendConnected = computed(() => repos.healthOk === true);
const desktopVersion = computed(() => desktop.value.version || pageVersion);
const desktopConnected = computed(() => Boolean(desktop.value.version));
const backendChecked = ref(false);
const desktopLoading = ref(false);
/** 连接三态：ok / connecting（琥珀呼吸）/ failed（红点）——驾驶舱仪表灯 */
const backendState = computed<'ok' | 'connecting' | 'failed'>(() => {
  if (!backendChecked.value) return 'connecting';
  return backendConnected.value ? 'ok' : 'failed';
});
const desktopState = computed<'ok' | 'connecting' | 'failed'>(() => {
  if (desktopConnected.value) return 'ok';
  return desktopLoading.value ? 'connecting' : 'failed';
});
let unsubscribeDesktop: (() => void) | null = null;

function applyDesktopState(state: DesktopUpdateState): void {
  desktop.value = state;
}

async function onServiceUpdate(): Promise<void> {
  if (!repos.serviceUpdateAvailable || !repos.serviceUpdateCommand) return;
  if (jobs.runningCount > 0) {
    ElMessage.warning('有任务进行中，请先等任务结束再升级服务');
    return;
  }
  const bridge = getDesktopBridge();
  if (!bridge) {
    await ElMessageBox.alert(`当前页面不能自动停服。可以手动执行：\n${repos.serviceUpdateCommand}`, '服务可更新');
    return;
  }
  try {
    await ElMessageBox.confirm(
      `当前 ${repos.serverVersion || pageVersion} → ${repos.serviceLatest ?? ''}。确认后将停止服务、安装并重启。`,
      '升级服务',
      { confirmButtonText: '升级', cancelButtonText: '稍后', closeOnClickModal: false }
    );
  } catch {
    return;
  }
  const result = await bridge.upgradeService();
  if (!result.ok && result.error) ElMessage.error(result.error);
}

async function confirmStop(running: number): Promise<boolean> {
  const message =
    running > 0 ? `有 ${running} 个任务进行中。退出会停下这些任务。` : '退出后当前后端进程结束，标签变为未连接。';
  try {
    await ElMessageBox.confirm(message, '退出后端服务', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      closeOnClickModal: false,
      type: 'warning'
    });
    return true;
  } catch {
    return false;
  }
}

async function onServiceStop(): Promise<void> {
  if (!backendConnected.value) return;
  await jobs.load().catch(() => undefined);
  const force = jobs.runningCount > 0;
  if (!(await confirmStop(jobs.runningCount))) return;
  try {
    await shutdownService({ force });
  } catch (err) {
    const blocked = err instanceof ApiError && err.status === 409;
    if (!blocked) {
      ElMessage.error(err instanceof Error ? err.message : String(err));
      return;
    }
    await jobs.load().catch(() => undefined);
    if (!(await confirmStop(Math.max(jobs.runningCount, 1)))) return;
    try {
      await shutdownService({ force: true });
    } catch (again) {
      ElMessage.error(again instanceof Error ? again.message : String(again));
      return;
    }
  }
  repos.healthOk = false;
  ElMessage.success('后端已退出');
}

async function onDesktopUpdate(): Promise<void> {
  const bridge = getDesktopBridge();
  if (!bridge || !desktop.value.updateAvailable) return;
  if (desktop.value.installMode === 'zip') {
    await bridge.openRelease();
    return;
  }
  const result = await bridge.download();
  if (!result.ok) {
    if (result.error) ElMessage.error(result.error);
    return;
  }
  if (result.jobId) {
    await jobs.load();
    await router.push({ path: '/jobs', query: { id: result.jobId } });
  }
}

const chatRepoLabel = computed(() => (threads.repoPath ? repoLeaf(threads.repoPath) : '未选择仓库'));

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
  backendChecked.value = true;
  void repos.refreshServiceUpdate();
  const bridge = getDesktopBridge();
  if (bridge) {
    desktopLoading.value = true;
    try {
      applyDesktopState(await bridge.getState());
    } catch {
      /* 壳子还没准备好时保持「未知」 */
    }
    desktopLoading.value = false;
    unsubscribeDesktop = bridge.onState(applyDesktopState);
  }
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
        void repos.load().finally(() => bump());
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
  () => threads.revealSeq,
  (n, prev) => {
    if (prev !== undefined && n !== prev) chatOpen.value = true;
  }
);

watch(
  chatOpen,
  (open) => {
    if (open) chatAlive.value = true;
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

function onKeydown(ev: KeyboardEvent): void {
  if (ev.key === 'Escape' && chatOpen.value) chatOpen.value = false;
}

onUnmounted(() => {
  unsubscribe?.();
  unsubscribeDesktop?.();
  window.removeEventListener('keydown', onKeydown);
  window.removeEventListener('resize', onResizeWindow);
  window.removeEventListener('pointerdown', onPointerDown);
});
</script>

<template>
  <div class="app-shell">
    <header class="top">
      <div class="brand">
        <span class="brand-mark"><GcIcon name="logo" /></span>
      </div>
      <div class="top-end">
        <button v-if="liveJob" type="button" class="pulse-count" :title="liveJobTitle" @click="goMenu('/jobs')">
          <i /><span>{{ jobs.runningCount }} 进行中</span>
        </button>
        <span class="conn-tag is-ok">
          <i class="dot" /><span class="lbl">页面已连接</span><span class="val">{{ pageVersion }}</span>
        </span>
        <span class="conn-tag" :class="backendState">
          <i class="dot" /><span class="lbl">后端{{ backendConnected ? '已连接' : '未连接' }}</span
          ><span class="val">{{ backendVersion }}</span>
          <button
            v-if="repos.serviceUpdateAvailable"
            type="button"
            class="tag-up"
            :title="repos.serviceUpdateCommand || '升级服务'"
            @click.stop="onServiceUpdate"
          >
            <svg viewBox="0 0 12 12" aria-hidden="true">
              <path d="M6 1.5 10 6.2H7.6V10.5H4.4V6.2H2L6 1.5Z" fill="currentColor" />
            </svg>
          </button>
          <button
            v-if="backendConnected"
            type="button"
            class="tag-off"
            title="退出后端服务"
            @click.stop="onServiceStop"
          >
            <svg viewBox="0 0 12 12" aria-hidden="true">
              <path
                d="M6 1.3v3.5M3.2 3.05a4 4 0 1 0 5.6 0"
                fill="none"
                stroke="currentColor"
                stroke-width="1.4"
                stroke-linecap="round"
              />
            </svg>
          </button>
        </span>
        <span class="conn-tag" :class="desktopState">
          <i class="dot" /><span class="lbl">桌面{{ desktopConnected ? '已连接' : '未连接' }}</span
          ><span class="val">{{ desktopVersion }}</span>
          <button
            v-if="desktop.updateAvailable"
            type="button"
            class="tag-up"
            :title="desktop.installMode === 'zip' ? '打开 Release 页面' : '下载桌面安装包'"
            @click.stop="onDesktopUpdate"
          >
            <svg viewBox="0 0 12 12" aria-hidden="true">
              <path d="M6 1.5 10 6.2H7.6V10.5H4.4V6.2H2L6 1.5Z" fill="currentColor" />
            </svg>
          </button>
        </span>
      </div>
    </header>
    <div v-if="liveJob" class="pulsebar" :title="liveJobTitle" @click="goMenu('/jobs')">
      <i class="fill" /><i class="scan" />
    </div>

    <main class="main-content">
      <router-view v-slot="{ Component }">
        <div class="route-view">
          <component :is="Component" />
        </div>
      </router-view>
    </main>

    <aside
      v-if="chatAlive"
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
        <GcIcon :name="m.icon" class="dock-ico" />
        <span class="dock-label">{{ m.label }}</span>
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
  background: var(--gc-page);
}
.top {
  flex: none;
  display: flex;
  align-items: center;
  gap: var(--gc-pad);
  height: 44px;
  padding: 0 var(--gc-pad);
  border-bottom: 1px solid var(--gc-line);
  background: var(--gc-page);
  z-index: 10;
}
.brand {
  display: flex;
  align-items: center;
  flex: none;
}
.brand-mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  color: var(--gc-accent);
}
.top-end {
  display: flex;
  align-items: center;
  gap: var(--gc-gap);
  margin-left: auto;
  min-width: 0;
}

/* ---------- 连接 tag ×3（正常 teal 点 / 连接中琥珀呼吸 / 失败红点红边） ---------- */
.conn-tag {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 20px;
  padding: 0 8px;
  border-radius: var(--gc-r-tag);
  background: var(--gc-overlay);
  border: 1px solid var(--gc-line);
  font-size: var(--gc-fs-meta);
  font-weight: 500;
  line-height: var(--gc-lh-tag);
  color: var(--gc-text-2);
  white-space: nowrap;
}
.conn-tag .dot {
  flex: none;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--gc-accent);
  box-shadow: var(--gc-glow-sm);
}
.conn-tag .val {
  color: var(--gc-text-3);
  font-variant-numeric: tabular-nums;
}
.conn-tag.is-connecting .dot {
  background: var(--gc-amber);
  box-shadow: none;
  animation: gc-breath var(--gc-t-breath) var(--gc-ease) infinite;
}
.conn-tag.is-failed {
  border-color: rgba(255, 133, 133, 0.4);
}
.conn-tag.is-failed .dot {
  background: var(--gc-red);
  box-shadow: none;
}
.conn-tag.is-failed .val {
  color: var(--gc-red);
}
@keyframes gc-breath {
  0%,
  100% {
    opacity: 0.4;
  }
  50% {
    opacity: 1;
  }
}

/* ---------- 任务脉冲计数 chip（点击跳任务页） ---------- */
.pulse-count {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 20px;
  padding: 0 8px;
  border: 0;
  border-radius: var(--gc-r-tag);
  background: var(--gc-accent-weak);
  color: var(--gc-accent-text);
  font: inherit;
  font-size: var(--gc-fs-meta);
  font-weight: 500;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  cursor: pointer;
}
.pulse-count i {
  flex: none;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--gc-accent);
  box-shadow: var(--gc-glow-sm);
}

/* ---------- 任务脉冲条（2px 通长，纯色扫描段，禁渐变） ---------- */
.pulsebar {
  flex: none;
  position: relative;
  height: 2px;
  background: var(--gc-accent-weak);
  overflow: hidden;
  cursor: pointer;
}
.pulsebar .fill {
  position: absolute;
  inset: 0 auto 0 0;
  width: 40%;
  background: var(--gc-signal-bar);
  box-shadow: var(--gc-glow-bar);
}
.pulsebar .scan {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  width: 72px;
  background: var(--gc-signal-scan);
  opacity: 0.9;
  animation: gc-scan 1800ms linear infinite;
}
@keyframes gc-scan {
  from {
    transform: translateX(-72px);
  }
  to {
    transform: translateX(calc(100vw + 72px));
  }
}

/* tag 内嵌操作钮（升级 / 停服） */
.tag-up,
.tag-off {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 12px;
  height: 12px;
  margin-left: 2px;
  padding: 0;
  border: 0;
  background: transparent;
  cursor: pointer;
  flex: none;
}
.tag-up {
  border-radius: 50%;
  background: var(--gc-amber-strong);
  color: #fff;
}
.tag-off {
  color: var(--gc-red);
}
.tag-up svg,
.tag-off svg {
  width: 12px;
  height: 12px;
}
.main-content {
  flex: 1;
  min-height: 0;
  padding: var(--gc-pad);
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
  background: var(--gc-overlay);
  border: 1px solid var(--gc-line);
  border-radius: var(--gc-radius);
  box-shadow: var(--gc-shadow-menu);
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
  background: var(--gc-accent);
  color: var(--gc-accent-ink);
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
    0 0 0 2px var(--gc-amber);
}
.chat-ball.error {
  box-shadow:
    var(--gc-shadow-menu),
    0 0 0 2px var(--gc-red);
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
  background: var(--gc-amber);
  box-shadow: 0 0 0 2px var(--gc-accent);
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
  height: var(--gc-row-lg);
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
  font-size: var(--gc-fs-body);
  cursor: pointer;
}
/* ---------- Dock（44px 实底通栏，禁玻璃；激活项顶部 2px 指示条） ---------- */
.dock {
  flex: none;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 2px;
  padding: 0 var(--gc-pad);
  background: var(--gc-page);
  border-top: 1px solid var(--gc-line);
  z-index: 25;
}
.dock-btn {
  position: relative;
  border: 0;
  background: transparent;
  color: var(--gc-text-3);
  width: 64px;
  height: 36px;
  border-radius: var(--gc-radius);
  cursor: pointer;
  font: inherit;
  font-size: var(--gc-fs-meta);
  font-weight: 500;
  line-height: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  transition:
    background var(--gc-t-micro) var(--gc-ease),
    color var(--gc-t-micro) var(--gc-ease);
}
.dock-ico {
  width: 16px;
  height: 16px;
}
.dock-btn:hover {
  background: rgba(255, 255, 255, 0.05);
  color: var(--gc-text-2);
}
.dock-btn.on {
  background: var(--gc-accent-weak);
  color: var(--gc-accent-text);
}
.dock-btn.on::before {
  content: '';
  position: absolute;
  top: 0;
  left: 50%;
  transform: translateX(-50%);
  width: 24px;
  height: 2px;
  border-radius: 0 0 2px 2px;
  background: var(--gc-accent);
}
.dock-count {
  position: absolute;
  top: 2px;
  right: 8px;
  min-width: 14px;
  height: 14px;
  padding: 0 3px;
  border-radius: 7px;
  background: var(--gc-red-strong);
  color: #fff;
  font-size: 10px;
  line-height: 14px;
  text-align: center;
  font-variant-numeric: tabular-nums;
}
</style>
