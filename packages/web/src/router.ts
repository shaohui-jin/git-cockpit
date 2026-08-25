import { createRouter, createWebHashHistory } from 'vue-router';
import ReposView from '@/views/ReposView.vue';
import StatusView from '@/views/StatusView.vue';
import HistoryView from '@/views/HistoryView.vue';
import LogsView from '@/views/LogsView.vue';
import SettingsView from '@/views/SettingsView.vue';

export const router = createRouter({
  // 使用 hash 历史模式：后端 SPA fallback 与文件托管下均无需服务端改写
  history: createWebHashHistory(),
  routes: [
    { path: '/', redirect: '/status' },
    { path: '/repos', name: 'repos', component: ReposView, meta: { title: '仓库管理' } },
    { path: '/status', name: 'status', component: StatusView, meta: { title: '状态' } },
    { path: '/history', name: 'history', component: HistoryView, meta: { title: '历史' } },
    { path: '/logs', name: 'logs', component: LogsView, meta: { title: '操作日志' } },
    { path: '/settings', name: 'settings', component: SettingsView, meta: { title: '设置' } }
  ]
});

router.afterEach((to) => {
  const title = to.meta.title as string | undefined;
  document.title = title ? `${title} · Git Cockpit` : 'Git Cockpit';
});