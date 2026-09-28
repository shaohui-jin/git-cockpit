import { createRouter, createWebHashHistory } from 'vue-router';

export const router = createRouter({
  // 使用 hash 历史模式：后端 SPA fallback 与文件托管下均无需服务端改写
  history: createWebHashHistory(),
  routes: [
    { path: '/', redirect: '/dashboard' },
    {
      path: '/dashboard',
      name: 'dashboard',
      component: () => import('@/views/ReposView.vue'),
      meta: { title: '工作台' }
    },
    { path: '/jobs', name: 'jobs', component: () => import('@/views/JobsView.vue'), meta: { title: '任务' } },
    { path: '/repos', redirect: '/dashboard' },
    { path: '/status', name: 'status', component: () => import('@/views/StatusView.vue'), meta: { title: '状态' } },
    { path: '/merge', name: 'merge', component: () => import('@/views/MergeView.vue'), meta: { title: '合并' } },
    { path: '/chat', name: 'chat', component: () => import('@/views/ChatView.vue'), meta: { title: '聊天' } },
    { path: '/matrix', redirect: { path: '/merge', query: { mode: 'matrix' } } },
    { path: '/logs', name: 'logs', component: () => import('@/views/LogsView.vue'), meta: { title: '操作日志' } },
    {
      path: '/conversations',
      name: 'conversations',
      component: () => import('@/views/ConversationsView.vue'),
      meta: { title: '对话记录' }
    },
    {
      path: '/settings',
      name: 'settings',
      component: () => import('@/views/SettingsView.vue'),
      meta: { title: '设置' }
    }
  ]
});

router.afterEach((to) => {
  const title = to.meta.title as string | undefined;
  document.title = title ? `${title} · Git Cockpit` : 'Git Cockpit';
});
