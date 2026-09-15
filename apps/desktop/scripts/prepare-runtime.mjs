/**
 * 桌面安装包运行时：已构建的 mcp-server（含 web）+ production 依赖，
 * 摊到 apps/desktop/runtime。electron-builder extraResources 只带代码；
 * node_modules 由 after-pack 再拷实体文件（它会丢掉 pnpm junction / .pnpm）。
 *
 * 须先：pnpm --filter core/web/mcp-server build
 */
import { execSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { copySolid, assertRealPackage } = require('./copy-solid.cjs');

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(here, '..');
const repoRoot = path.resolve(desktopRoot, '..', '..');
const runtime = path.join(desktopRoot, 'runtime');
const mcpRoot = path.join(repoRoot, 'packages', 'mcp-server');
const coreRoot = path.join(repoRoot, 'packages', 'core');
const webDist = path.join(repoRoot, 'packages', 'web', 'dist', 'index.html');
const mcpDist = path.join(mcpRoot, 'dist', 'cli-entry.js');
const coreDist = path.join(coreRoot, 'dist', 'index.js');

if (!existsSync(webDist)) {
  console.error('[desktop] 未找到 web 构建产物。请先：pnpm --filter @shaohui_jin/git-cockpit-web build');
  process.exit(1);
}
if (!existsSync(mcpDist)) {
  console.error('[desktop] 未找到 mcp-server 构建产物。请先：pnpm --filter @shaohui_jin/git-cockpit-mcp-server build');
  process.exit(1);
}
if (!existsSync(coreDist)) {
  console.error('[desktop] 未找到 core 构建产物。请先：pnpm --filter @shaohui_jin/git-cockpit-core build');
  process.exit(1);
}

execSync('node packages/mcp-server/scripts/copy-web.mjs', { cwd: repoRoot, stdio: 'inherit' });

rmSync(runtime, { recursive: true, force: true });
mkdirSync(runtime, { recursive: true });

cpSync(path.join(mcpRoot, 'dist'), path.join(runtime, 'dist'), { recursive: true });
const readme = path.join(mcpRoot, 'README.md');
if (existsSync(readme)) cpSync(readme, path.join(runtime, 'README.md'));

const vendorCore = path.join(runtime, 'vendor', 'core');
mkdirSync(vendorCore, { recursive: true });
writeProdPackage(path.join(coreRoot, 'package.json'), path.join(vendorCore, 'package.json'));
cpSync(path.join(coreRoot, 'dist'), path.join(vendorCore, 'dist'), { recursive: true });

const mcpPkg = JSON.parse(readFileSync(path.join(mcpRoot, 'package.json'), 'utf8'));
delete mcpPkg.devDependencies;
delete mcpPkg.scripts;
delete mcpPkg.publishConfig;
mcpPkg.dependencies['@shaohui_jin/git-cockpit-core'] = 'file:./vendor/core';
writeFileSync(path.join(runtime, 'package.json'), `${JSON.stringify(mcpPkg, null, 2)}\n`);

execSync('npm install --omit=dev --ignore-scripts --no-audit --no-fund', {
  cwd: runtime,
  stdio: 'inherit',
  shell: true
});

const nm = path.join(runtime, 'node_modules');
const nmSolid = path.join(runtime, 'node_modules.solid');
copySolid(nm, nmSolid);
rmSync(nm, { recursive: true, force: true });
cpSync(nmSolid, nm, { recursive: true });
rmSync(nmSolid, { recursive: true, force: true });

const entry = path.join(runtime, 'dist', 'cli-entry.js');
const webIndex = path.join(runtime, 'dist', 'web', 'index.html');
if (!existsSync(entry) || !existsSync(webIndex)) {
  console.error('[desktop] runtime 缺少 dist/cli-entry.js 或 dist/web/index.html');
  process.exit(1);
}

for (const name of ['fastify', '@fastify/cors', '@shaohui_jin/git-cockpit-core', 'simple-git']) {
  assertRealPackage(runtime, name);
}

execSync('node --input-type=module -e "await import(\'fastify\')"', {
  cwd: path.join(runtime, 'dist'),
  stdio: 'inherit'
});

console.log(`[desktop] runtime -> ${runtime}`);

function writeProdPackage(from, to) {
  const pkg = JSON.parse(readFileSync(from, 'utf8'));
  delete pkg.devDependencies;
  delete pkg.scripts;
  delete pkg.publishConfig;
  writeFileSync(to, `${JSON.stringify(pkg, null, 2)}\n`);
}
