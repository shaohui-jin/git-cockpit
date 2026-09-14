/**
 * 清掉上次打包残留。Windows 上 win-unpacked.tmp 常被未退出的 Electron 锁住，
 * 删不掉就改名，避免挡住这一次 pack。
 */
import { existsSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const release = path.resolve(here, '..', 'release');

function stash(dir) {
  if (!existsSync(dir)) return;
  try {
    rmSync(dir, { recursive: true, force: true });
    return;
  } catch (err) {
    const dest = `${dir}.stale-${Date.now()}`;
    try {
      renameSync(dir, dest);
      console.warn(`[desktop] ${path.basename(dir)} 被占用，已改名为 ${path.basename(dest)}。请关掉 Git Cockpit 后再删。`);
    } catch (renameErr) {
      console.error('[desktop] 无法清理打包目录（多半被未退出的 Git Cockpit / Electron 占用）。');
      console.error('[desktop] 请先关掉桌面窗后再运行 pack:win。');
      process.exit(1);
    }
  }
}

if (!existsSync(release)) process.exit(0);

stash(path.join(release, 'win-unpacked.tmp'));
stash(path.join(release, 'win-unpacked'));

for (const name of readdirSync(release)) {
  if (!name.includes('.stale-')) continue;
  const full = path.join(release, name);
  try {
    if (statSync(full).isDirectory()) rmSync(full, { recursive: true, force: true });
  } catch {
    /* 仍被占用就留着 */
  }
}
