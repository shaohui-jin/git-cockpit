import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * 说明：vitest 直接解析到 core 包的 TypeScript 源码，
 * 避免加载 core 的 tsup 打包产物（其会将 node:sqlite 改写为裸 "sqlite"，
 * 导致 Node 无法解析该内置模块）。
 */
export default defineConfig({
  resolve: {
    alias: {
      '@shaohui_jin/git-cockpit-core': fileURLToPath(
        new URL('../core/src/index.ts', import.meta.url)
      )
    }
  },
  test: {
    include: ['test/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000
  }
});