/**
 * Windows 安装包：部署 runtime、清残留、再 electron-builder。
 * 打包时不能同时开着 desktop:dev，否则会 EBUSY 锁住 default_app.asar。
 */
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(here, '..');

function runningDesktopElectron() {
  try {
    const out = execSync(
      'wmic process where "name=\'electron.exe\'" get CommandLine /FORMAT:LIST',
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
    );
    return /git-cockpit[\\/]apps[\\/]desktop|git-cockpit-desktop/i.test(out);
  } catch {
    return false;
  }
}

if (!process.env.GITHUB_ACTIONS && runningDesktopElectron()) {
  console.error('[desktop] pack:win 失败：Git Cockpit 窗口还在运行。');
  console.error('[desktop] 请先关掉桌面窗（或停掉 pnpm desktop:dev），再重新打包。');
  process.exit(1);
}

execSync('node scripts/prepare-runtime.mjs', { cwd: desktopRoot, stdio: 'inherit' });
execSync('node scripts/clean-release.mjs', { cwd: desktopRoot, stdio: 'inherit' });
const env = { ...process.env };
delete env.GH_TOKEN;
delete env.GITHUB_TOKEN;
execSync('pnpm exec electron-builder --win zip nsis --x64 --publish never', {
  cwd: desktopRoot,
  stdio: 'inherit',
  env
});
