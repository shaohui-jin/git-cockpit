/**
 * CLI 程序入口薄壳：被 `node dist/cli-entry.js`（或 git-cockpit bin）直接执行时运行 main。
 * 独立成入口避免 esbuild 代码分割后 import.meta.url 语义错乱（详见 cli.ts）。
 */
import { main } from './cli.ts';

main(process.argv)
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err) => {
    console.error('[git-cockpit] 启动失败:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });