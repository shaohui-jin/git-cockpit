/**
 * CLI 程序入口薄壳：被 `node dist/cli-entry.js`（或 git-cockpit bin）直接执行时运行 main。
 * 独立成入口避免 esbuild 代码分割后 import.meta.url 语义错乱（详见 cli.ts）。
 */
import { existsSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { main } from './cli.ts';

// 仓库里直接启动与打包后的桌面端分开听端口，数据目录仍是同一份。
// 安装后的 git-cockpit 没有上层 pnpm-workspace.yaml，继续默认 3000。
if (!process.env.GIT_COCKPIT_PORT) {
  const distDir = realpathSync(path.dirname(fileURLToPath(import.meta.url)));
  const workspaceFile = path.resolve(distDir, '..', '..', '..', 'pnpm-workspace.yaml');
  if (existsSync(workspaceFile)) process.env.GIT_COCKPIT_PORT = '3010';
}

main(process.argv)
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err) => {
    console.error('[git-cockpit] 启动失败:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
