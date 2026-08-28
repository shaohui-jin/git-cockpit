import * as fs from 'node:fs';
import * as path from 'node:path';
import { simpleGit, type SimpleGit } from 'simple-git';
import { openDatabase } from '@shaohui_jin/git-cockpit-core';
import { createRuntime, disposeRuntime } from '../src/index.ts';
import type { Runtime } from '../src/index.ts';

/** 测试临时目录基座（位于本包 test/tmp，受 workspace 写约束） */
export function tmpBase(): string {
  // vitest 多文件并发时每个 worker 独立 tmp 基目录，避免互相 cleanup 删除正在使用的仓库
  const worker = process.env.VITEST_WORKER_ID ?? process.env.VITEST_POOL_ID ?? 'single';
  const base = path.resolve(process.cwd(), 'test', 'tmp', `w${worker}`);
  fs.mkdirSync(base, { recursive: true });
  return base;
}

export function makeTmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(tmpBase(), prefix));
}

export function cleanupTmp(): void {
  try {
    fs.rmSync(tmpBase(), { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

export async function initRepo(dir: string): Promise<SimpleGit> {
  fs.mkdirSync(dir, { recursive: true });
  const git = simpleGit({ baseDir: dir });
  await git.init(['-b', 'main']);
  await git.addConfig('user.email', 'test@example.com');
  await git.addConfig('user.name', 'Test User');
  return git;
}

export async function commitFile(
  git: SimpleGit,
  dir: string,
  file: string,
  content: string,
  message: string
): Promise<void> {
  const fullPath = path.resolve(dir, file);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, 'utf8');
  await git.add(file);
  await git.commit(message);
}

/** 创建带若干提交 + feature 分支的示例仓库 */
export async function createSampleRepo(): Promise<{ dir: string; git: SimpleGit }> {
  const dir = makeTmpDir('sample-');
  const git = await initRepo(dir);
  await commitFile(git, dir, 'a.txt', 'hello\n', 'feat: add a.txt');
  await commitFile(git, dir, 'b.txt', 'world\n', 'chore: add b.txt');
  await git.branch(['feature/x']);
  return { dir, git };
}

/** 创建隔离的运行时（独立内存 DB 与数据目录），测试后必须 dispose */
export function createTestRuntime(
  overrides?: NonNullable<Parameters<typeof createRuntime>[0]>['configOverrides']
): Runtime {
  const dir = makeTmpDir('runtime-');
  const db = openDatabase(dir);
  return createRuntime({
    dataDir: dir,
    db,
    configOverrides: overrides
  });
}

export function disposeTestRuntime(runtime: Runtime): void {
  try {
    disposeRuntime(runtime);
  } catch {
    /* ignore */
  }
}