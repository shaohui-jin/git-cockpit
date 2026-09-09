import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const e2eRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(e2eRoot, '../..');
const webDist = path.join(repoRoot, 'packages', 'web', 'dist', 'index.html');
const cli = path.join(repoRoot, 'packages', 'mcp-server', 'dist', 'cli-entry.js');
const buildArgs = [
  '--filter',
  '@shaohui_jin/git-cockpit-core',
  '--filter',
  '@shaohui_jin/git-cockpit-web',
  '--filter',
  '@shaohui_jin/git-cockpit-mcp-server',
  'build'
];

function run(command, args, cwd) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/^npm_config_(filter|recursive)$/i.test(key) || key === 'PNPM_PACKAGE_NAME') {
      delete env[key];
    }
  }
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

const skipBuild = process.env.E2E_SKIP_BUILD === '1';
if (!skipBuild || !fs.existsSync(webDist) || !fs.existsSync(cli)) {
  console.log('[e2e] 构建 core / web / mcp-server（测发布形态）');
  run('pnpm', buildArgs, repoRoot);
}

if (!fs.existsSync(webDist) || !fs.existsSync(cli)) {
  console.error('[e2e] 缺少 packages/web/dist 或 mcp-server dist/cli-entry.js');
  process.exit(1);
}

if (process.env.E2E_INSTALL_BROWSER === '1') {
  run('pnpm', ['exec', 'playwright', 'install', 'chromium'], e2eRoot);
}

run('pnpm', ['exec', 'playwright', 'test', ...process.argv.slice(2)], e2eRoot);
