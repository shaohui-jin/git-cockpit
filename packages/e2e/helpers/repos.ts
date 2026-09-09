import * as fs from 'node:fs';
import * as path from 'node:path';
import { simpleGit, type SimpleGit } from 'simple-git';
import { makeTmpDir } from './tmp';

async function initRepo(dir: string): Promise<SimpleGit> {
  fs.mkdirSync(dir, { recursive: true });
  const git = simpleGit({ baseDir: dir });
  await git.init(['-b', 'main']);
  await git.addConfig('user.email', 'e2e@example.com');
  await git.addConfig('user.name', 'E2E User');
  await git.addConfig('core.autocrlf', 'false');
  return git;
}

async function commitFile(
  git: SimpleGit,
  dir: string,
  file: string,
  content: string | Buffer,
  message: string
): Promise<void> {
  const fullPath = path.resolve(dir, file);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  if (typeof content === 'string') fs.writeFileSync(fullPath, content, 'utf8');
  else fs.writeFileSync(fullPath, content);
  await git.add(file);
  await git.commit(message);
}

export async function createDirtyRepo(): Promise<{ dir: string; git: SimpleGit }> {
  const dir = makeTmpDir('dirty-');
  const git = await initRepo(dir);
  await commitFile(git, dir, 'a.txt', 'hello\n', 'feat: add a.txt');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'dirty from e2e\n', 'utf8');
  return { dir, git };
}

/** 两条分支改同一文件，预演应报内容冲突。结束在 main。 */
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

/** 一条目标 + 干净来源 + 一条与目标冲突的来源。 */
export async function createSurveyRepo(): Promise<{ dir: string; git: SimpleGit }> {
  const dir = makeTmpDir('survey-');
  const git = await initRepo(dir);
  await commitFile(git, dir, 'a.txt', 'base\n', 'init: base');
  await git.branch(['feat-a']);
  await git.branch(['feat-c']);
  await git.checkout('feat-a');
  await commitFile(git, dir, 'fa.txt', 'a only\n', 'feat: a file');
  await git.checkout('feat-c');
  await commitFile(git, dir, 'a.txt', 'theirs\n', 'feat: conflict theirs');
  await git.checkout('main');
  await commitFile(git, dir, 'a.txt', 'ours\n', 'fix: conflict ours');
  return { dir, git };
}

/** 带稍大 blob 的裸仓源，给本地克隆一点耗时。 */
export async function createCloneSource(): Promise<{ dir: string; git: SimpleGit }> {
  const dir = makeTmpDir('clone-src-');
  const git = await initRepo(dir);
  await commitFile(git, dir, 'readme.txt', 'clone source\n', 'init: readme');
  await commitFile(git, dir, 'blob.bin', Buffer.alloc(8 * 1024 * 1024, 7), 'chore: blob');
  return { dir, git };
}
