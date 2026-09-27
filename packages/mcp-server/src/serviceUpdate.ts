import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const PKG = '@shaohui_jin/git-cockpit-mcp-server';
const TTL_MS = 30 * 60 * 1000;
const FAIL_TTL_MS = 60 * 1000;

export interface ServiceUpdateInfo {
  version: string;
  latestVersion: string | null;
  updateAvailable: boolean;
  command: string | null;
}

type Lookup = () => Promise<string | null>;

let lookup: Lookup = npmViewLatest;
let cache: { at: number; latest: string | null; ttl: number } | null = null;

export function setServiceUpdateLookup(fn: Lookup | null): void {
  lookup = fn ?? npmViewLatest;
  cache = null;
}

export async function readServiceUpdate(current: string): Promise<ServiceUpdateInfo> {
  const latest = await cachedLatest();
  const updateAvailable = Boolean(latest && compareVersions(latest, current) > 0);
  return {
    version: current,
    latestVersion: latest,
    updateAvailable,
    command: updateAvailable && latest ? `npm i -g ${PKG}@${latest}` : null
  };
}

async function cachedLatest(): Promise<string | null> {
  const now = Date.now();
  if (cache && now - cache.at < cache.ttl) return cache.latest;
  let latest: string | null = null;
  let ttl = FAIL_TTL_MS;
  try {
    latest = await lookup();
    if (latest) ttl = TTL_MS;
  } catch {
    latest = null;
  }
  cache = { at: now, latest, ttl };
  return latest;
}

function parseVersion(raw: string): [number, number, number] | null {
  const matched = raw.trim().match(/(\d+)\.(\d+)\.(\d+)/);
  if (!matched) return null;
  return [Number(matched[1]), Number(matched[2]), Number(matched[3])];
}

function compareVersions(a: string, b: string): number {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left || !right) return 0;
  for (let i = 0; i < 3; i += 1) {
    const av = left[i] ?? 0;
    const bv = right[i] ?? 0;
    if (av !== bv) return av - bv;
  }
  return 0;
}

function resolveNpmCli(nodePath: string): string | null {
  const dir = path.dirname(nodePath);
  const candidates = [
    path.join(dir, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.resolve(dir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js')
  ];
  return candidates.find((item) => fs.existsSync(item)) ?? null;
}

function parseNpmVersion(raw: string): string | null {
  const quoted = raw.match(/"(\d+\.\d+\.\d+)"/);
  if (quoted?.[1]) return quoted[1];
  const plain = parseVersion(raw);
  return plain ? plain.join('.') : null;
}

function npmViewLatest(): Promise<string | null> {
  const nodePath = process.execPath;
  const npmCli = resolveNpmCli(nodePath);
  const cmd = npmCli ? nodePath : process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const args = npmCli ? [npmCli, 'view', PKG, 'version', '--json'] : ['view', PKG, 'version', '--json'];
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      windowsHide: true,
      shell: !npmCli && process.platform === 'win32'
    });
    let output = '';
    const timer = setTimeout(() => {
      child.kill();
      resolve(null);
    }, 15000);
    child.stdout?.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.on('error', () => {
      clearTimeout(timer);
      resolve(null);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        resolve(null);
        return;
      }
      resolve(parseNpmVersion(output));
    });
  });
}
