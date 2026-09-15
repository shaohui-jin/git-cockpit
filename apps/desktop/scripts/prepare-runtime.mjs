/**
 * 桌面安装包运行时：把已构建的 mcp-server（含 web 静态页）和 production 依赖
 * 摊到 apps/desktop/runtime，供 electron-builder extraResources 打进安装包。
 * 须先：pnpm --filter core/web/mcp-server build
 *
 * 依赖必须是实体文件。pnpm 默认 hardlink/symlink 指向本机 store，
 * 装到别人电脑上会变成「Cannot find package 'fastify'」，daemon 起不来。
 */
import { execSync } from 'node:child_process';
import { cpSync, existsSync, lstatSync, rmSync } from 'node:fs';
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
  stdio: 'inherit',
  env: {
    ...process.env,
    npm_config_node_linker: 'hoisted',
    npm_config_package_import_method: 'copy'
  }
});

materializeIfLinked(runtime);

const entry = path.join(runtime, 'dist', 'cli-entry.js');
const webIndex = path.join(runtime, 'dist', 'web', 'index.html');
const fastifyPkg = path.join(runtime, 'node_modules', 'fastify', 'package.json');
if (!existsSync(entry) || !existsSync(webIndex)) {
  console.error('[desktop] deploy 后缺少 dist/cli-entry.js 或 dist/web/index.html');
  process.exit(1);
}
if (!existsSync(fastifyPkg) || isLink(path.join(runtime, 'node_modules', 'fastify'))) {
  console.error('[desktop] runtime 里没有实体 fastify。安装包在别人机器上会起不了 :3000。');
  process.exit(1);
}

execSync('node --input-type=module -e "await import(\'fastify\')"', {
  cwd: runtime,
  stdio: 'inherit'
});

console.log(`[desktop] runtime -> ${runtime}`);

function isLink(p) {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}

function materializeIfLinked(dir) {
  const nm = path.join(dir, 'node_modules');
  const marker = path.join(nm, 'fastify');
  if (!existsSync(marker) || !isLink(marker)) return;
  console.log('[desktop] node_modules 仍是链接，复制成实体文件…');
  const tmp = `${dir}.solid`;
  rmSync(tmp, { recursive: true, force: true });
  cpSync(dir, tmp, { recursive: true, dereference: true });
  rmSync(dir, { recursive: true, force: true });
  cpSync(tmp, dir, { recursive: true });
  rmSync(tmp, { recursive: true, force: true });
}
