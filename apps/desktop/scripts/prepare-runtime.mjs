/**
 * 桌面安装包运行时：把已构建的 mcp-server（含 web 静态页）和 production 依赖
 * 摊到 apps/desktop/runtime，供 electron-builder extraResources 打进安装包。
 * 须先：pnpm --filter core/web/mcp-server build
 */
import { execSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(here, '..');
const repoRoot = path.resolve(desktopRoot, '..', '..');
const runtime = path.join(desktopRoot, 'runtime');
const webDist = path.join(repoRoot, 'packages', 'web', 'dist', 'index.html');
const mcpDist = path.join(repoRoot, 'packages', 'mcp-server', 'dist', 'cli-entry.js');

if (!existsSync(webDist)) {
  console.error('[desktop] 未找到 web 构建产物。请先：pnpm --filter @shaohui_jin/git-cockpit-web build');
  process.exit(1);
}
if (!existsSync(mcpDist)) {
  console.error('[desktop] 未找到 mcp-server 构建产物。请先：pnpm --filter @shaohui_jin/git-cockpit-mcp-server build');
  process.exit(1);
}

execSync('node packages/mcp-server/scripts/copy-web.mjs', { cwd: repoRoot, stdio: 'inherit' });

rmSync(runtime, { recursive: true, force: true });
execSync('pnpm --filter @shaohui_jin/git-cockpit-mcp-server deploy ./apps/desktop/runtime --prod --legacy', {
  cwd: repoRoot,
  stdio: 'inherit'
});

const entry = path.join(runtime, 'dist', 'cli-entry.js');
const webIndex = path.join(runtime, 'dist', 'web', 'index.html');
if (!existsSync(entry) || !existsSync(webIndex)) {
  console.error('[desktop] deploy 后缺少 dist/cli-entry.js 或 dist/web/index.html');
  process.exit(1);
}
console.log(`[desktop] runtime -> ${runtime}`);
