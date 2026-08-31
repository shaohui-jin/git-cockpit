/**
 * 本机全局 PATH 上的 gh / glab。禁止下载 CLI 到数据目录。
 * 找不到时返回官方安装页，由设置/工具结果引导用户自己装。
 *
 * Windows：GUI/Cursor 拉起的进程 PATH 经常没有用户后来装的目录
 *（例如 D:\GitHub CLI）。spawn('gh') 按当前进程 PATH 查找会 ENOENT。
 * 探测时合并注册表里的用户/系统 Path，并解析成绝对路径再 spawn。
 */
import { spawn, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { MrCliStatus } from './types.ts';

export const GH_INSTALL_URL = 'https://cli.github.com/';
export const GLAB_INSTALL_URL = 'https://gitlab.com/gitlab-org/cli/-/releases';

const PROBE_TIMEOUT_MS = 8_000;

function expandWindowsEnv(s: string): string {
  return s.replace(/%([^%]+)%/gi, (_, name: string) => process.env[name] ?? `%${name}%`);
}

function readRegistryPath(hive: 'HKCU' | 'HKLM'): string {
  if (process.platform !== 'win32') return '';
  const key =
    hive === 'HKLM'
      ? 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment'
      : 'HKCU\\Environment';
  try {
    const r = spawnSync('reg.exe', ['query', key, '/v', 'Path'], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 3000
    });
    if (r.status !== 0 || !r.stdout) return '';
    const m = r.stdout.match(/\bPath\s+REG_\w+\s+(.+)/i);
    return m?.[1] ? expandWindowsEnv(m[1].trim()) : '';
  } catch {
    return '';
  }
}

function windowsSearchPath(): string {
  const chunks = [process.env.PATH ?? process.env.Path ?? '', readRegistryPath('HKCU'), readRegistryPath('HKLM')];
  const seen = new Set<string>();
  const dirs: string[] = [];
  for (const chunk of chunks) {
    for (const raw of chunk.split(';')) {
      const dir = raw.trim().replace(/^"(.*)"$/, '$1');
      if (!dir) continue;
      const key = dir.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      dirs.push(dir);
    }
  }
  return dirs.join(';');
}

function wellKnownWindowsBins(which: 'gh' | 'glab'): string[] {
  const pf = process.env.ProgramFiles || 'C:\\Program Files';
  const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const local = process.env.LOCALAPPDATA || '';
  const home = process.env.USERPROFILE || '';
  const names = which === 'gh' ? ['GitHub CLI', 'GitHubCLI'] : ['glab', 'GitLab CLI'];
  const out: string[] = [];
  for (const folder of names) {
    out.push(path.join(pf, folder, `${which}.exe`));
    out.push(path.join(pf86, folder, `${which}.exe`));
    if (local) {
      out.push(path.join(local, folder, `${which}.exe`));
      out.push(path.join(local, 'Programs', folder, `${which}.exe`));
    }
  }
  if (home) {
    out.push(path.join(home, 'scoop', 'shims', `${which}.exe`));
    out.push(path.join(home, 'scoop', 'apps', which, 'current', `${which}.exe`));
    out.push(path.join(home, 'scoop', 'apps', which, 'current', 'bin', `${which}.exe`));
  }
  if (local) {
    out.push(path.join(local, 'Microsoft', 'WinGet', 'Links', `${which}.exe`));
  }
  return out;
}

function fileExists(p: string): boolean {
  try {
    return fs.existsSync(p) && fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

/** 解析 gh/glab 的绝对路径；找不到返回 null */
export function resolveCliBin(which: 'gh' | 'glab'): string | null {
  if (process.platform === 'win32') {
    const exts = ['.exe', '.cmd', '.bat', ''];
    for (const dir of windowsSearchPath().split(';')) {
      if (!dir) continue;
      for (const ext of exts) {
        const candidate = path.join(dir, `${which}${ext}`);
        if (fileExists(candidate)) return candidate;
      }
    }
    for (const p of wellKnownWindowsBins(which)) {
      if (fileExists(p)) return p;
    }
    return null;
  }
  for (const dir of (process.env.PATH ?? '').split(':')) {
    if (!dir) continue;
    const candidate = path.join(dir, which);
    if (fileExists(candidate)) return candidate;
  }
  return null;
}

function runCmd(
  cmd: string,
  args: string[],
  cwd?: string
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd,
      windowsHide: true,
      shell: false,
      env: {
        ...process.env,
        GH_PROMPT_DISABLED: '1',
        GLAB_PROMPT_DISABLED: '1',
        GIT_TERMINAL_PROMPT: '0'
      }
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      resolve({ code: 124, stdout, stderr: stderr || 'timeout' });
    }, PROBE_TIMEOUT_MS);
    child.stdout?.on('data', (b: Buffer) => {
      stdout += b.toString('utf8');
    });
    child.stderr?.on('data', (b: Buffer) => {
      stderr += b.toString('utf8');
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ code: 127, stdout: '', stderr: err.message });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

export function cliInstallUrl(which: 'gh' | 'glab'): string {
  return which === 'gh' ? GH_INSTALL_URL : GLAB_INSTALL_URL;
}

export function cliMissingHint(which: 'gh' | 'glab'): string {
  if (which === 'gh') {
    return `未找到本机 gh（GitHub CLI）。本软件不会代为下载，请自行安装：${GH_INSTALL_URL}`;
  }
  return `未找到本机 glab（GitLab CLI）。本软件不会代为下载，请自行安装：${GLAB_INSTALL_URL}`;
}

export async function probeMrCli(
  which: 'gh' | 'glab',
  options: { cwd?: string; bin?: string } = {}
): Promise<MrCliStatus> {
  const installUrl = cliInstallUrl(which);
  const bin = options.bin?.trim() || resolveCliBin(which) || which;
  const ver = await runCmd(bin, ['--version'], options.cwd);
  if (ver.code !== 0) {
    return {
      name: which,
      found: false,
      loggedIn: false,
      error: cliMissingHint(which),
      installUrl
    };
  }
  const auth = await runCmd(bin, ['auth', 'status'], options.cwd);
  if (auth.code !== 0) {
    const login = which === 'gh' ? 'gh auth login' : 'glab auth login';
    return {
      name: which,
      found: true,
      loggedIn: false,
      error: `${which} 已安装但未登录。请在终端执行：${login}`,
      installUrl
    };
  }
  return { name: which, found: true, loggedIn: true, installUrl };
}

function firstTokenLine(stdout: string): string {
  const line = stdout
    .split(/\r?\n/)
    .map((s) => s.trim())
    .find((s) => s && !s.startsWith('stdout:') && !/\s/.test(s));
  return line ?? '';
}

/** 读取本机 CLI 当前登录凭证。调用方不得写入日志/API 响应。 */
export async function readCliAuthToken(
  which: 'gh' | 'glab',
  options: { cwd?: string; hostname?: string } = {}
): Promise<string> {
  const bin = resolveCliBin(which) || which;
  const host = options.hostname?.trim();
  const attempts: string[][] = [];
  if (which === 'gh') {
    if (host) attempts.push(['auth', 'token', '--hostname', host]);
    attempts.push(['auth', 'token']);
  } else {
    if (host) attempts.push(['auth', 'token', '--hostname', host]);
    attempts.push(['auth', 'token']);
    if (host) attempts.push(['config', 'get', '--host', host, 'token']);
    attempts.push(['config', 'get', 'token']);
  }
  for (const args of attempts) {
    const r = await runCmd(bin, args, options.cwd);
    const token = firstTokenLine(r.stdout);
    if (r.code === 0 && token) return token;
  }
  return '';
}

export async function probeAllMrCli(cwd?: string): Promise<{ gh: MrCliStatus; glab: MrCliStatus }> {
  const [gh, glab] = await Promise.all([probeMrCli('gh', { cwd }), probeMrCli('glab', { cwd })]);
  return { gh, glab };
}

export async function runMrCli(
  bin: string,
  args: string[],
  cwd: string
): Promise<{ code: number; stdout: string; stderr: string }> {
  const resolved =
    bin === 'gh' || bin === 'glab' ? resolveCliBin(bin) ?? bin : bin;
  return runCmd(resolved, args, cwd);
}
