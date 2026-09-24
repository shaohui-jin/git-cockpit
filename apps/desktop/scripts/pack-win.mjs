/**
 * Windows 安装包：只打窗壳。daemon 用本机已安装的 git-cockpit，不把 Node 依赖打进安装包。
 * 打包时不能同时开着 desktop:dev，否则会 EBUSY 锁住 default_app.asar。
 * 解压目录放在系统临时目录：仓库里的 release 会被编辑器盯住，win-unpacked.tmp 改名会 EPERM。
 */
import { execSync } from 'node:child_process';
import { cpSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(here, '..');

function runningDesktopElectron() {
  try {
    const out = execSync(
      "wmic process where \"name='electron.exe' or name='Git Cockpit.exe'\" get CommandLine,Name /FORMAT:LIST",
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
    );
    return /git-cockpit[\\/]apps[\\/]desktop|git-cockpit-desktop|Git Cockpit\.exe/i.test(out);
  } catch {
    return false;
  }
}

if (!process.env.GITHUB_ACTIONS && runningDesktopElectron()) {
  console.error('[desktop] pack:win 失败：Git Cockpit 窗口还在运行。');
  console.error('[desktop] 请先关掉桌面窗（或停掉 pnpm desktop:dev），再重新打包。');
  process.exit(1);
}

execSync('node scripts/clean-release.mjs', { cwd: desktopRoot, stdio: 'inherit' });

const stage = path.join(os.tmpdir(), 'git-cockpit-desktop-release');
rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });

const env = { ...process.env };
delete env.GH_TOKEN;
delete env.GITHUB_TOKEN;
execSync(`pnpm exec electron-builder --win zip nsis --x64 --publish never --config.directories.output="${stage}"`, {
  cwd: desktopRoot,
  stdio: 'inherit',
  env
});

const release = path.join(desktopRoot, 'release');
mkdirSync(release, { recursive: true });
for (const name of readdirSync(stage)) {
  const keep =
    name === 'win-unpacked' ||
    name === 'latest.yml' ||
    name === 'builder-effective-config.yaml' ||
    name.endsWith('.exe') ||
    name.endsWith('.zip') ||
    name.endsWith('.blockmap');
  if (!keep) continue;
  cpSync(path.join(stage, name), path.join(release, name), { recursive: true, force: true });
}
rmSync(stage, { recursive: true, force: true });
console.log(`[desktop] 安装包已复制到 ${release}`);
console.log('[desktop] 安装包只含窗壳。打开时若没有 Node.js 22+ 或 git-cockpit，会先提示。');
