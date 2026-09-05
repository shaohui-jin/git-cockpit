import { createApp } from 'vue';
import { createPinia } from 'pinia';
import ElementPlus from 'element-plus';
import 'element-plus/dist/index.css';
import 'element-plus/theme-chalk/dark/css-vars.css';
import App from './App.vue';
import { router } from './router';
import './style.css';
import 'diff2html/bundles/css/diff2html.min.css';
import './theme.css';

// 启用暗色模式（配合 element-plus/theme-chalk/dark/css-vars.css 与 theme.css）
document.documentElement.classList.add('dark');

const app = createApp(App);
app.use(createPinia());
app.use(router);
app.use(ElementPlus, { size: 'default' });
app.mount('#app');