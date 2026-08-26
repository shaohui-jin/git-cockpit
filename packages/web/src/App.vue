<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { useReposStore } from '@/stores/repos';
import { useSettingsStore } from '@/stores/settings';
import { subscribeEvents } from '@/api/client';
import { useRevision } from '@/composables/revision';

const repos = useReposStore();
const settings = useSettingsStore();
const route = useRoute();
const router = useRouter();
const { bump } = useRevision();

const menu = [
  { path: '/status', label: '状态', icon: '◧' },
  { path: '/history', label: '历史', icon: '◫' },
  { path: '/repos', label: '仓库管理', icon: '▤' },
  { path: '/logs', label: '操作日志', icon: '≡' },
  { path: '/settings', label: '设置', icon: '⚙' }
];

const currentLabel = computed(() => {
  if (!repos.currentId) return '未选择仓库';
  const r = repos.repos.find((x) => x.id === repos.currentId);
  return r?.path ?? '未选择仓库';
});

const isActive = (p: string): boolean => (p === '/status' ? route.path === '/status' : route.path.startsWith(p));

let unsubscribe: (() => void) | null = null;

onMounted(async () => {
  await repos.checkHealth();
  await Promise.all([repos.load(), settings.load().catch(() => undefined)]);
  // 后端仓库变化与日志事件 → 递增修订号 → 各视图自动刷新
  unsubscribe = subscribeEvents({
    onRepoChanged: () => bump(),
    onLog: () => bump(),
    onError: () => {
      // SSE 断开会由浏览器自动重连；这里仅静默
    }
  });
});

onUnmounted(() => {
  unsubscribe?.();
});
</script>

<template>
  <el-container class="app-shell">
    <el-aside width="220px" class="app-aside">
      <div class="brand">
        <span class="brand-mark">⌘</span>
        <span class="brand-name">Git Cockpit</span>
      </div>

      <div class="repo-box">
        <div class="repo-box-label">当前仓库</div>
        <div class="repo-box-path mono" :title="currentLabel">{{ currentLabel }}</div>
      </div>

      <el-menu :default-active="route.path" class="nav-menu">
        <el-menu-item v-for="m in menu" :key="m.path" :index="m.path" @click="router.push(m.path)">
          <span class="menu-icon">{{ m.icon }}</span>
          <span>{{ m.label }}</span>
        </el-menu-item>
      </el-menu>

      <div class="aside-footer">
        <el-tag v-if="repos.healthOk" size="small" type="success">后端已连接</el-tag>
        <el-tag v-else-if="repos.healthOk === false" size="small" type="danger">后端离线</el-tag>
        <el-tag v-else size="small" type="info">连接中…</el-tag>
      </div>
    </el-aside>

    <el-container class="app-main">
      <el-main class="main-content">
        <router-view v-slot="{ Component }">
          <component :is="Component" />
        </router-view>
      </el-main>
    </el-container>
  </el-container>
</template>

<style scoped>
.app-shell {
  height: 100%;
}
.app-aside {
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--el-border-color-light);
  background: var(--el-bg-color);
}
.brand {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 16px 16px 10px;
  font-size: 16px;
  font-weight: 600;
}
.brand-mark {
  color: var(--el-color-primary);
  font-size: 18px;
}
.repo-box {
  margin: 4px 12px 10px;
  padding: 8px 10px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
  background: var(--el-fill-color-lighter);
}
.repo-box-label {
  font-size: 11px;
  color: var(--el-text-color-secondary);
  margin-bottom: 4px;
}
.repo-box-path {
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.nav-menu {
  border-right: none;
  flex: 1;
}
.menu-icon {
  margin-right: 8px;
  color: var(--el-color-primary);
}
.aside-footer {
  padding: 12px 16px;
  border-top: 1px solid var(--el-border-color-lighter);
}
.app-main {
  background: var(--el-bg-color-page);
}
.main-content {
  padding: 20px;
  width: 100%;
}
</style>