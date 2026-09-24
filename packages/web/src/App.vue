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

const chatOpen = ref(false);
let hijackingChat = false;

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

const liveJob = computed(() => jobs.jobs.find((j) => j.status === 'running') ?? null);
const liveJobTitle = computed(() => (liveJob.value ? jobLine(liveJob.value) : ''));

const dockItems = computed(() => {
  const chat: DockItem = { path: '/chat', label: '聊天' };
  if (settings.llm?.tokenSet) return [chat, ...workItems, ...systemItems];
  return [...workItems, chat, ...systemItems];
});

const isChatRoute = computed(() => route.path === '/chat');

const chatRepoLabel = computed(() => {
  const p = repos.currentPath;
  if (!p) return '未选择仓库';
  const leaf = p.replace(/\\/g, '/').split('/').filter(Boolean).pop();
  return leaf || p;
});

function pageActive(path: string): boolean {
  if (path === '/chat') return chatOpen.value || isChatRoute.value;
  if (chatOpen.value) return false;
  if (path === '/logs') return route.path === '/logs';
  return route.path === path;
}

function goMenu(p: string): void {
  if (p === '/chat') {
    toggleChat();
    return;
  }
  chatOpen.value = false;
  if (p === route.path) return;
  void router.push(p).catch(() => undefined);
}

function toggleChat(): void {
  if (isChatRoute.value) {
    chatOpen.value = true;
    void router.replace('/dashboard');
    return;
  }
  chatOpen.value = !chatOpen.value;
}

function closeChat(): void {
  chatOpen.value = false;
}

function onChatLeave(): void {
  chatOpen.value = false;
}

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
});

watch(
  () => route.path,
  async (p) => {
    if (p === '/chat') {
      hijackingChat = true;
      chatOpen.value = true;
      await router.replace('/dashboard');
      hijackingChat = false;
      return;
    }
    if (hijackingChat) return;
    if (chatOpen.value) chatOpen.value = false;
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

    <Transition name="chat-rise">
      <aside v-show="chatOpen" class="chat-sheet-anchor" role="dialog" aria-label="聊天" :aria-hidden="!chatOpen">
        <div class="chat-sheet">
          <header class="sheet-bar">
            <span>助手 · {{ chatRepoLabel }}</span>
            <button type="button" class="sheet-close" @click="closeChat">关闭</button>
          </header>
          <ChatView embedded @leave="onChatLeave" />
        </div>
      </aside>
    </Transition>

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
/* 低于 dock(25) 与 Element 对话框(~2000)，避开底栏 */
.chat-sheet-anchor {
  position: absolute;
  z-index: 20;
  left: 50%;
  bottom: var(--gc-dock-space);
  transform: translateX(-50%);
  width: min(640px, calc(100% - var(--gc-pad) * 2));
  height: min(70%, calc(100% - var(--gc-line) - var(--gc-dock-space) - var(--gc-pad)));
}
.chat-rise-enter-active,
.chat-rise-leave-active {
  transition:
    opacity 0.22s ease,
    transform 0.22s ease;
}
.chat-rise-leave-active {
  pointer-events: none;
}
.chat-rise-enter-from,
.chat-rise-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(20px);
}
.chat-sheet {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-height: 0;
  background: color-mix(in srgb, var(--el-bg-color-overlay) 88%, transparent);
  border: 1px solid var(--el-border-color);
  border-radius: var(--gc-radius);
  box-shadow: var(--gc-shadow-menu);
  backdrop-filter: blur(16px);
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
.chat-sheet :deep(.chat-page) {
  flex: 1;
  min-height: 0;
  height: auto;
  overflow: hidden;
  padding: var(--gc-pad);
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
