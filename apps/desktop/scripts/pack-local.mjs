/**
 * 本地测试打包：构建三包 → 打 Windows 窗壳 → 打印产物清单与验证提示。
 *
 * 与 CI（release-desktop.yml）的区别：本地不检查 npm tag 闸门，不上传 Release，
 * 产物只落在 apps/desktop/release，供本机安装验证。
 *
 * 用法（在 apps/desktop 下）：
 *   pnpm pack:local
 *   node scripts/pack-local.mjs --skip-build   # 已构建过，只重新打包
 *
 * 打包前必须关掉所有 Git Cockpit 窗口与 pnpm desktop:dev，否则 Electron 会锁住
 * win-unpacked，pack-win.mjs 会直接拒绝执行。
 */
import { execSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const skipBuild = args.includes('--skip-build');

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(here, '..');
const repoRoot = path.resolve(desktopRoot, '..', '..');
const release = path.join(desktopRoot, 'release');

function run(cmd, cwd) {
  console.log(`\n[pack-local] $ ${cmd}`);
  execSync(cmd, { cwd, stdio: 'inherit' });
}

function humanSize(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

console.log('[pack-local] Git Cockpit 桌面窗 · 本地测试打包');
console.log('[pack-local] 请确认已关掉所有 Git Cockpit 窗口和 pnpm desktop:dev。');

if (skipBuild) {
  const mcpDist = path.join(repoRoot, 'packages', 'mcp-server', 'dist', 'cli-entry.js');
  if (!existsSync(mcpDist)) {
    console.error('[pack-local] --skip-build 但 packages/mcp-server/dist/cli-entry.js 不存在。');
    console.error('[pack-local] 请先去掉 --skip-build，或执行 pnpm build。');
    process.exit(1);
  }
  console.log('[pack-local] --skip-build：沿用现有 dist。');
} else {
  run('pnpm build', repoRoot);
}

run('node scripts/pack-win.mjs', desktopRoot);

console.log('\n[pack-local] 产物：');
if (!existsSync(release)) {
  console.error('[pack-local] 没有生成 release 目录，打包可能失败。');
  process.exit(1);
}

const wanted = (name) =>
  name.endsWith('.exe') || name.endsWith('.zip') || name === 'latest.yml' || name.endsWith('.blockmap');
const files = readdirSync(release)
  .filter(wanted)
  .map((name) => {
    const full = path.join(release, name);
    return { name, full, size: statSync(full).size };
  })
  .sort((a, b) => b.size - a.size);

if (!files.length) {
  console.error('[pack-local] release 目录里没有安装包，检查 electron-builder 输出。');
  process.exit(1);
}

for (const f of files) {
  console.log(`  ${humanSize(f.size).padStart(9)}  ${f.full}`);
}

const unpacked = path.join(release, 'win-unpacked');
if (existsSync(unpacked)) {
  console.log(`\n[pack-local] 免安装目录（调试用，可直接跑里面的 Git Cockpit.exe）：\n  ${unpacked}`);
}

console.log(`
[pack-local] 本地验证依赖自动安装：
  1) npm uninstall -g @shaohui_jin/git-cockpit-mcp-server
  2) 确认 :3000 没有 daemon（浏览器打开 http://127.0.0.1:3000/api/health 应失败）
  3) 装 NSIS 安装包，或解压 zip 后双击 Git Cockpit.exe
  4) 期望：确认框 → 安装日志窗 → 复检 → 进窗口
  5) npm ls -g @shaohui_jin/git-cockpit-mcp-server  应能看到版本
  6) 安装日志：%LOCALAPPDATA%\\git-cockpit-desktop\\logs\\
  7) 若走了权限兜底，包会装在 %LOCALAPPDATA%\\git-cockpit\\npm

[pack-local] 完整步骤见 docs/桌面端本地打包.md`);
