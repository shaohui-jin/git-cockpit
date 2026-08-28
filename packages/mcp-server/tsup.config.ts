export default {
  entry: ['src/index.ts', 'src/cli-entry.ts', 'src/cli.ts', 'src/mcpServer.ts', 'src/webServer.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'node22',
  // 为全部产物首行加 node shebang，让 npm bin（./dist/cli-entry.js）在 Windows 上
  // 生成带 `node` 的 .cmd/.ps1 shim，且 git bash 的 exec 也能用 node 正确解释，
  // 避免依赖系统 .js 关联（如 WebStorm）导致 EPIPE 崩溃或 `import: command not found`。
  banner: { js: '#!/usr/bin/env node' },
  outDir: 'dist',
  // 原生/服务端模块不进 bundle，由安装方提供；core 走包内已发布产物（含修复后的 node:sqlite 前缀）
  external: [
    '@shaohui_jin/git-cockpit-core',
    '@modelcontextprotocol/sdk',
    'simple-git',
    'fastify',
    '@fastify/cors',
    '@fastify/static',
    '@fastify/swagger',
    '@fastify/swagger-ui',
    'zod',
    'zod-to-json-schema'
  ]
};