import { fileURLToPath, URL } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import type { ProxyOptions } from 'vite';

const backendPort = process.env.GIT_COCKPIT_PORT ?? '3000';
const backendHost = process.env.GIT_COCKPIT_HOST ?? '127.0.0.1';

function localSecret(): string {
  const raw = process.env.GIT_COCKPIT_DATA_DIR;
  const dir = raw ? raw.replace(/^~(?=$|[/\\])/, os.homedir()) : path.join(os.homedir(), '.git-cockpit');
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8')) as {
      auth?: { localSecret?: string };
    };
    return cfg.auth?.localSecret ?? '';
  } catch {
    return '';
  }
}

const injectSecret: ProxyOptions['configure'] = (proxy) => {
  proxy.on('proxyReq', (proxyReq) => {
    const secret = localSecret();
    if (secret) proxyReq.setHeader('X-Git-Cockpit-Secret', secret);
  });
};

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: `http://${backendHost}:${backendPort}`,
        changeOrigin: true,
        configure: injectSecret
      },
      '/mcp': {
        target: `http://${backendHost}:${backendPort}`,
        changeOrigin: true,
        configure: injectSecret
      }
    }
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks: {
          vue: ['vue', 'vue-router', 'pinia'],
          'element-plus': ['element-plus']
        }
      }
    }
  }
});
