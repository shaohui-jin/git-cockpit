import { spawn, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rmQuiet } from './tmp';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

export function cliEntry(): string {
  return path.join(repoRoot, 'packages', 'mcp-server', 'dist', 'cli-entry.js');
}

export function webDistIndex(): string {
  return path.join(repoRoot, 'packages', 'web', 'dist', 'index.html');
}

export function assertBuilt(): void {
  if (!fs.existsSync(cliEntry()) || !fs.existsSync(webDistIndex())) {
    throw new Error('缺少构建产物。请先在仓库根目录执行 pnpm build，或使用 pnpm test:e2e（会自动 build）。');
  }
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      server.close((err) => (err ? reject(err) : resolve(port)));
    });
    server.on('error', reject);
  });
}

async function waitHealth(baseURL: string, child: ChildProcess, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastErr = '';
  while (Date.now() < deadline) {
    if (child.exitCode != null) {
      throw new Error(`daemon 提前退出（code ${child.exitCode}）${lastErr ? `：${lastErr}` : ''}`);
    }
    try {
      const res = await fetch(`${baseURL}/api/health`);
      if (res.ok) {
        const body = (await res.json()) as { ok?: boolean };
        if (body.ok) return;
      }
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`等待 /api/health 超时（${timeoutMs}ms）${lastErr ? `：${lastErr}` : ''}`);
}

export interface Daemon {
  baseURL: string;
  dataDir: string;
  port: number;
  stop: () => Promise<void>;
}

export async function startDaemon(dataDir: string): Promise<Daemon> {
  assertBuilt();
  fs.mkdirSync(dataDir, { recursive: true });
  const port = await freePort();
  const host = '127.0.0.1';
  const baseURL = `http://${host}:${port}`;
  const child = spawn(process.execPath, [cliEntry(), 'start'], {
    env: {
      ...process.env,
      GIT_COCKPIT_DATA_DIR: dataDir,
      GIT_COCKPIT_PORT: String(port),
      GIT_COCKPIT_HOST: host
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });

  let logs = '';
  const onChunk = (buf: Buffer) => {
    logs += buf.toString('utf8');
  };
  child.stdout?.on('data', onChunk);
  child.stderr?.on('data', onChunk);

  try {
    await waitHealth(baseURL, child, 30_000);
  } catch (err) {
    child.kill();
    const extra = logs.trim() ? `\n${logs.trim()}` : '';
    throw new Error(`${err instanceof Error ? err.message : String(err)}${extra}`);
  }

  return {
    baseURL,
    dataDir,
    port,
    stop: async () => {
      if (child.exitCode == null) {
        child.kill();
        await new Promise((r) => setTimeout(r, 400));
        if (child.exitCode == null) child.kill('SIGKILL');
      }
      rmQuiet(dataDir);
    }
  };
}
