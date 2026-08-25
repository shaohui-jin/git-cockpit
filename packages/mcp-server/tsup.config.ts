export default {
  entry: ['src/index.ts', 'src/cli-entry.ts', 'src/cli.ts', 'src/mcpServer.ts', 'src/webServer.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'node22',
  outDir: 'dist',
  // 原生/服务端模块不进 bundle，由安装方提供；core 走包内已发布产物（含修复后的 node:sqlite 前缀）
  external: [
    '@shaohui_jin/git-cockpit-core',
    '@modelcontextprotocol/sdk',
    'simple-git',
    'fastify',
    '@fastify/cors',
    '@fastify/static',
    'zod'
  ]
};