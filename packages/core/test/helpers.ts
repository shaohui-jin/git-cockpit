import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { simpleGit, type SimpleGit } from 'simple-git';

/**
 * 测试辅助：在 workspace 内的 test/tmp 下创建临时 Git 仓库
 * （使用 workspace 内路径以避免外部目录写限制）。
 */
export function tmpBase(): string {
  // vitest 多文件并发时每个 worker 独立 tmp 基目录，避免互相 cleanup 删除正在使用的仓库
  const worker = process.env.VITEST_WORKER_ID ?? process.env.VITEST_POOL_ID ?? 'single';
  const base = path.resolve(process.cwd(), 'test', 'tmp', `w${worker}`);
  fs.mkdirSync(base, { recursive: true });
  return base;
}

export function makeTmpDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(tmpBase(), prefix));
  return dir;
}

export function cleanupTmp(): string {
  const base = tmpBase();
  try {
    fs.rmSync(base, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
  return base;
}

export async function initRepo(dir: string): Promise<SimpleGit> {
  fs.mkdirSync(dir, { recursive: true });
  const git = simpleGit({ baseDir: dir });
  await git.init(['-b', 'main']);
  await git.addConfig('user.email', 'test@example.com');
  await git.addConfig('user.name', 'Test User');
  return git;
}

export async function commitFile(git: SimpleGit, dir: string, file: string, content: string, message: string): Promise<void> {
  const fullPath = path.resolve(dir, file);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, 'utf8');
  await git.add(file);
  await git.commit(message);
}

/** 创建带若干提交的仓库 */
export async function createSampleRepo(): Promise<{ dir: string; git: SimpleGit }> {
  const dir = makeTmpDir('sample-');
  const git = await initRepo(dir);
  await commitFile(git, dir, 'a.txt', 'hello\n', 'feat: add a.txt');
  await commitFile(git, dir, 'b.txt', 'world\n', 'chore: add b.txt');
  await commitFile(git, dir, 'a.txt', 'hello world\n', 'fix: update a.txt');
  await git.branch(['feature/x']);
  await git.checkout('feature/x');
  await commitFile(git, dir, 'c.txt', 'feature content\n', 'feat: feature c');
  await git.checkout('main');
  return { dir, git };
}

/** 两条分支改同一文件，预演应报内容冲突 */
export async function createConflictRepo(): Promise<{ dir: string; git: SimpleGit }> {
  const dir = makeTmpDir('conflict-');
  const git = await initRepo(dir);
  await commitFile(git, dir, 'a.txt', 'base\n', 'init: base');
  await git.branch(['feature']);
  await git.checkout('feature');
  await commitFile(git, dir, 'a.txt', 'theirs\n', 'feat: theirs');
  await git.checkout('main');
  await commitFile(git, dir, 'a.txt', 'ours\n', 'fix: ours');
  return { dir, git };
}

export { os };