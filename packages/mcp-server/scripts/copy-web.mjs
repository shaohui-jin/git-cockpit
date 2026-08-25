// 将 web 前端构建产物复制到 dist/web，随 npm 包一起发布。
// 发布布局为 dist/web（"here/web/dist"），由 src/webServer.ts 的 resolveWebDist 优先命中。
// 必须在 mcp-server build（tsup clean）之后执行。
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url)); // packages/mcp-server/scripts
const mcpRoot = path.resolve(here, '..');
const webDist = path.resolve(mcpRoot, '../web/dist');
const target = path.join(mcpRoot, 'dist', 'web');

if (!existsSync(webDist)) {
  console.error(`[copy-web] 未找到 web 构建产物：${webDist}`);
  console.error('[copy-web] 请先执行：pnpm --filter @shaohui_jin/git-cockpit-web build');
  process.exit(1);
}
mkdirSync(target, { recursive: true });
cpSync(webDist, target, { recursive: true, force: true });
console.log(`[copy-web] ${webDist} -> ${target}`);