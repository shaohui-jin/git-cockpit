import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { GitOperationError } from './types.ts';
import { assertRepoAllowed } from './allowedRepos.ts';

const CLONE_TIMEOUT_MS = 30 * 60 * 1000;

function isWindowsDrivePath(p: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(p);
}

/**
 * 拒绝 URL 里夹带账号口令 / token（https://user:pass@、https://ghp_xxx@）。
 * 允许：https/http、ssh://、git@host:path、本机绝对路径、file://。
 */
export function assertSafeCloneUrl(url: string): string {
  const u = url.trim();
  if (!u) throw new GitOperationError('克隆地址不能为空', 'INVALID_CLONE_URL');
  if (/[\r\n\0]/.test(u)) throw new GitOperationError('克隆地址含非法字符', 'INVALID_CLONE_URL');

  if (isWindowsDrivePath(u) || (path.isAbsolute(u) && !/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(u))) {
    return path.resolve(u);
  }

  if (u.startsWith('git@')) {
    if (u.includes('://')) throw new GitOperationError('克隆地址格式无效', 'INVALID_CLONE_URL');
    return u;
  }

  let parsed: URL;
  try {
    parsed = new URL(u);
  } catch {
    throw new GitOperationError(`无法解析克隆地址: ${u}`, 'INVALID_CLONE_URL');
  }

  const proto = parsed.protocol.toLowerCase();
  if (!['https:', 'http:', 'ssh:', 'file:', 'git:'].includes(proto)) {
    throw new GitOperationError(`不支持的克隆协议: ${parsed.protocol}`, 'INVALID_CLONE_URL');
  }
  if (parsed.username || parsed.password) {
    throw new GitOperationError('克隆地址不得包含账号、口令或 token，请改用本机凭据或 SSH', 'INVALID_CLONE_URL');
  }
  return u;
}

/** dest 必须是绝对路径；不存在则父目录必须存在；已存在则必须是空目录。走 allowedRepos。 */
export function assertCloneDest(destDir: string, allowedRepos?: string[]): string {
  const raw = destDir.trim();
  if (!raw) throw new GitOperationError('保存路径不能为空', 'INVALID_CLONE_DEST');
  if (!path.isAbsolute(raw) && !isWindowsDrivePath(raw)) {
    throw new GitOperationError('保存路径必须是绝对路径', 'INVALID_CLONE_DEST');
  }
  const dest = path.resolve(raw);
  assertRepoAllowed(dest, allowedRepos);

  if (fs.existsSync(dest)) {
    const st = fs.statSync(dest);
    if (!st.isDirectory()) {
      throw new GitOperationError(`保存路径已存在且不是目录: ${dest}`, 'INVALID_CLONE_DEST');
    }
    if (fs.readdirSync(dest).length > 0) {
      throw new GitOperationError(`保存目录非空: ${dest}`, 'INVALID_CLONE_DEST');
    }
  } else {
    const parent = path.dirname(dest);
    if (!fs.existsSync(parent) || !fs.statSync(parent).isDirectory()) {
      throw new GitOperationError(`保存路径的父目录不存在: ${parent}`, 'INVALID_CLONE_DEST');
    }
  }
  return dest;
}

/**
 * 后台 `git clone --progress`。不走 GitService 队列，避免大仓堵住当前仓的读写。
 * simple-git.clone 会整段缓冲、不好打进度，所以这里用 spawn。
 */
export function spawnClone(
  url: string,
  destDir: string,
  onLog: (chunk: string) => void
): Promise<void> {
  const safeUrl = assertSafeCloneUrl(url);
  const dest = path.resolve(destDir);
  return new Promise((resolve, reject) => {
    const child = spawn('git', ['clone', '--progress', '--', safeUrl, dest], {
      windowsHide: true,
      shell: false,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
    });
    let stderr = '';
    let done = false;
    const finish = (err?: Error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (err) reject(err);
      else resolve();
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(new GitOperationError(`克隆超时（${CLONE_TIMEOUT_MS}ms）`, 'CLONE_TIMEOUT'));
    }, CLONE_TIMEOUT_MS);

    const pump = (buf: Buffer) => {
      const text = buf.toString('utf8');
      stderr += text;
      onLog(text);
    };
    child.stdout?.on('data', pump);
    child.stderr?.on('data', pump);
    child.on('error', (err) => {
      finish(new GitOperationError(err.message, 'CLONE_SPAWN_FAILED'));
    });
    child.on('close', (code) => {
      if (code === 0) {
        finish();
        return;
      }
      const msg = stderr.trim().split('\n').filter(Boolean).slice(-3).join('\n') || `git clone 退出码 ${code}`;
      finish(new GitOperationError(msg, 'CLONE_FAILED'));
    });
  });
}
