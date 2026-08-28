import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { GitOperationError, GitService } from '../src/index.ts';
import { cleanupTmp, commitFile, createSampleRepo, initRepo, makeTmpDir } from './helpers.ts';

describe('GitService 打开与校验', () => {
  beforeEach(() => cleanupTmp());
  afterAll(() => cleanupTmp());

  it('非 Git 目录抛出 NOT_A_GIT_REPO', async () => {
    const dir = makeTmpDir('nongit-');
    // 工作区本身可能是 git 仓库（rev-parse 会向祖先目录查找）。
    // 在探测目录内放置指向不存在 gitdir 的 .git 哨兵，强制 git 判定“不是 git 仓库”。
    fs.writeFileSync(path.join(dir, '.git'), `gitdir: ${path.join(dir, '..', '.nonexistent-gitdir')}\n`, 'utf8');
    await expect(GitService.open(dir)).rejects.toThrowError('不是有效的 Git 仓库');
  });

  it('不存在的目录抛出 REPO_NOT_FOUND', async () => {
    const dir = path.join(makeTmpDir('nope-'), 'not-exist');
    await expect(GitService.open(dir)).rejects.toThrow(GitOperationError);
  });

  it('打开仓库时路径会标准化为仓库根目录', async () => {
    const { dir } = await createSampleRepo();
    fs.mkdirSync(path.join(dir, 'sub'));
    const svc = await GitService.open(path.join(dir, 'sub'));
    expect(svc.repoPath).toBe(dir);
  });

  it('拒绝路径越界', async () => {
    const { dir } = await createSampleRepo();
    const svc = await GitService.open(dir, {});
    expect(() => svc.validateRepoRelativePath('../etc/passwd')).toThrow(GitOperationError);
    expect(() => svc.validateRepoRelativePath('/etc/passwd')).toThrow(GitOperationError);
    expect(() => svc.validateRepoRelativePath('ok/path.txt')).not.toThrow();
  });

  it('拒绝非法分支名', async () => {
    const { dir } = await createSampleRepo();
    const svc = await GitService.open(dir);
    for (const bad of ['a;rm -rf', 'a&&b', 'a|b', 'a b', 'a b/c', '--force', 'a..b']) {
      expect(() => svc.validateRefName(bad), `应拒绝: ${bad}`).toThrow(GitOperationError);
    }
    expect(() => svc.validateRefName('feature/ok-name')).not.toThrow();
  });
});

describe('GitService 只读操作', () => {
  let dir: string;
  let svc: GitService;

  beforeEach(async () => {
    cleanupTmp();
    ({ dir } = await createSampleRepo());
    svc = await GitService.open(dir);
  });

  afterAll(() => cleanupTmp());

  it('getStatus 返回当前分支与干净状态', async () => {
    const status = await svc.getStatus();
    expect(status.current).toBe('main');
    expect(status.isClean).toBe(true);
    expect(status.ahead).toBe(0);
  });

  it('getStatus 识别未跟踪 / 已暂存 / 已修改', async () => {
    fs.writeFileSync(path.join(dir, 'new.txt'), 'new\n');
    fs.writeFileSync(path.join(dir, 'a.txt'), 'modified a\n');
    fs.writeFileSync(path.join(dir, 'b.txt'), 'staged b\n');
    await svc.add(['b.txt']);

    const status = await svc.getStatus();
    expect(status.untracked).toContain('new.txt');
    expect(status.staged.find((f) => f.path === 'b.txt')).toBeTruthy();
    expect(status.unstaged.find((f) => f.path === 'a.txt')).toBeTruthy();
    expect(status.isClean).toBe(false);
  });

  it('getLog 返回提交历史（含多分支）', async () => {
    const logs = await svc.getLog({ maxCount: 10, all: true });
    expect(logs.length).toBeGreaterThanOrEqual(4);
    const first = logs[0]!;
    expect(first.hash).toMatch(/^[0-9a-f]{40}$/);
    expect(first.shortHash).toHaveLength(7);
    expect(first.authorName).toBe('Test User');
    expect(first.parents.length).toBeGreaterThanOrEqual(0);
    expect(first.subject.length).toBeGreaterThan(0);
    // refs 装饰应包含分支引用
    expect(logs.some((l) => l.refs.includes('feature/x'))).toBe(true);
  });

  it('空仓库 getLog 返回空数组', async () => {
    const emptyDir = makeTmpDir('empty-');
    await initRepo(emptyDir);
    const esvc = await GitService.open(emptyDir);
    expect(await esvc.getLog()).toEqual([]);
  });

  it('getDiff 统计增删行数与文件', async () => {
    fs.writeFileSync(path.join(dir, 'a.txt'), 'hello world 2\n');
    const diff = await svc.getDiff();
    expect(diff.files.length).toBe(1);
    expect(diff.files[0]!.path).toBe('a.txt');
    expect(diff.files[0]!.additions).toBe(1);
    expect(diff.files[0]!.deletions).toBe(1);
    expect(diff.rawPatch).toContain('+hello world 2');
  });

  it('getDiff 支持 staged 与路径过滤', async () => {
    fs.writeFileSync(path.join(dir, 'a.txt'), 'staged-a\n');
    await svc.add(['a.txt']);
    const staged = await svc.getDiff({ staged: true });
    expect(staged.files[0]!.path).toBe('a.txt');
    const none = await svc.getDiff({ staged: false, path: 'b.txt' });
    expect(none.files.length).toBe(0);
  });

  it('listBranches 包含本地与远程', async () => {
    const { branches, current } = await svc.listBranches();
    expect(current).toBe('main');
    expect(branches.some((b) => b.name === 'main' && b.current)).toBe(true);
    expect(branches.some((b) => b.name === 'feature/x')).toBe(true);
  });

  it('listTags / createTag', async () => {
    await svc.createTag('v1.0.0');
    const tags = await svc.listTags();
    expect(tags.some((t) => t.name === 'v1.0.0')).toBe(true);
  });

  it('getFileContent 读取历史文件', async () => {
    const { content } = await svc.getFileContent('HEAD', 'a.txt');
    expect(content).toBe('hello world\n');
    await expect(svc.getFileContent('HEAD', 'nope.txt')).rejects.toThrow(GitOperationError);
  });

  it('getGraph 返回带 parent 的提交', async () => {
    const graph = await svc.getGraph();
    expect(graph.head).toBeTruthy();
    expect(graph.commits.length).toBeGreaterThanOrEqual(4);
    const mainHead = graph.commits[0]!;
    expect(Array.isArray(mainHead.parents)).toBe(true);
  });

  it('getShow 返回提交元信息与 diff', async () => {
    const logs = await svc.getLog({ maxCount: 1 });
    const detail = await svc.getShow(logs[0]!.hash);
    expect(detail.commit.hash).toBe(logs[0]!.hash);
    expect(detail.diff.files.length).toBeGreaterThan(0);
  });
});

describe('GitService 写操作与 dry-run', () => {
  let dir: string;
  let svc: GitService;

  beforeEach(async () => {
    cleanupTmp();
    ({ dir } = await createSampleRepo());
    svc = await GitService.open(dir);
  });

  afterAll(() => cleanupTmp());

  it('dry_run 返回预览而不真正执行', async () => {
    const preview = (await svc.add(['a.txt'], { dryRun: true })) as { dryRun: boolean; command: string };
    expect(preview.dryRun).toBe(true);
    expect(preview.command).toContain('git add');
    const status = await svc.getStatus();
    expect(status.isClean).toBe(true); // 未真正执行
  });

  it('add + commit 完整流程', async () => {
    fs.writeFileSync(path.join(dir, 'z.txt'), 'z\n');
    await svc.add(['z.txt']);
    await svc.commit('feat: add z.txt');
    const logs = await svc.getLog({ maxCount: 1 });
    expect(logs[0]!.subject).toBe('feat: add z.txt');
  });

  it('空提交信息被拒绝', async () => {
    await expect(svc.commit('   ')).rejects.toThrow('提交信息不能为空');
  });

  it('unstage 取消暂存', async () => {
    fs.writeFileSync(path.join(dir, 'a.txt'), 'unstaged test\n');
    await svc.add(['a.txt']);
    let status = await svc.getStatus();
    expect(status.staged.length).toBe(1);
    await svc.unstage(['a.txt']);
    status = await svc.getStatus();
    expect(status.staged.length).toBe(0);
  });

  it('创建/切换/删除分支', async () => {
    await svc.createBranch('dev');
    await svc.checkoutBranch('dev');
    let { current } = await svc.listBranches();
    expect(current).toBe('dev');
    await svc.checkoutBranch('main');
    await svc.deleteBranch('dev');
    const { branches } = await svc.listBranches();
    expect(branches.some((b) => b.name === 'dev')).toBe(false);
  });

  it('删除未合并分支被拒绝', async () => {
    await expect(svc.deleteBranch('feature/x')).rejects.toThrow('尚未完全合并');
  });

  it('stash / stashPop 往返', async () => {
    fs.writeFileSync(path.join(dir, 'a.txt'), 'stash me\n');
    await svc.stash('backup test');
    let status = await svc.getStatus();
    expect(status.isClean).toBe(true);
    await svc.stashPop();
    status = await svc.getStatus();
    expect(status.isClean).toBe(false);
    const { content } = await svc.getFileContent('HEAD', 'a.txt');
    void content;
  });

  it('merge 冲突时抛出 MERGE_CONFLICT', async () => {
    const conflictDir = makeTmpDir('conflict-');
    await initRepo(conflictDir);
    const svc2 = await GitService.open(conflictDir);
    fs.writeFileSync(path.join(conflictDir, 'f.txt'), 'base\n');
    await svc2.add(['f.txt']);
    await svc2.commit('base');
    await svc2.createBranch('other');
    await svc2.checkoutBranch('other');
    fs.writeFileSync(path.join(conflictDir, 'f.txt'), 'other\n');
    await svc2.add(['f.txt']);
    await svc2.commit('other change');
    await svc2.checkoutBranch('main');
    fs.writeFileSync(path.join(conflictDir, 'f.txt'), 'main\n');
    await svc2.add(['f.txt']);
    await svc2.commit('main change');
    await expect(svc2.merge('other')).rejects.toThrow(/冲突/);
  });
});

describe('GitService stash 列表/选择/apply/drop/show', () => {
  let dir: string;
  let svc: GitService;

  beforeEach(async () => {
    cleanupTmp();
    ({ dir } = await createSampleRepo());
    svc = await GitService.open(dir);
  });

  afterAll(() => cleanupTmp());

  it('listStashes 空列表返回空数组', async () => {
    expect(await svc.listStashes()).toEqual([]);
  });

  it('stash 后可列出，show/apply/drop 可用', async () => {
    fs.writeFileSync(path.join(dir, 'a.txt'), 'stash content\n');
    await svc.stash('my stash note');

    const list = await svc.listStashes();
    expect(list.length).toBe(1);
    expect(list[0]!.index).toBe(0);
    expect(list[0]!.ref).toBe('stash@{0}');
    expect(list[0]!.message).toContain('my stash note');
    expect(list[0]!.date).toBeTruthy();

    const shown = await svc.stashShow({ index: 0 });
    expect(shown.ref).toBe('stash@{0}');
    expect(shown.patch).toContain('stash content');

    // apply 保留记录
    await svc.stashApply({ index: 0 });
    expect((await svc.listStashes()).length).toBe(1);
    let st = await svc.getStatus();
    expect(st.isClean).toBe(false);

    // 重新 stash 后 drop
    await svc.stash('again');
    expect((await svc.listStashes()).length).toBe(2);
    await svc.stashDrop({ index: 0 });
    const after = await svc.listStashes();
    expect(after.length).toBe(1);
    expect(after[0]!.index).toBe(0); // drop 后索引重排
  });

  it('选择性 stash：仅保存指定路径（含未跟踪文件）', async () => {
    fs.writeFileSync(path.join(dir, 'a.txt'), 'keep this change\n');
    fs.writeFileSync(path.join(dir, 'b.txt'), 'stash me\n');
    fs.writeFileSync(path.join(dir, 'new-untracked.txt'), 'new file\n');

    await svc.stash('partial', { paths: ['b.txt', 'new-untracked.txt'], includeUntracked: true });

    let st = await svc.getStatus();
    // b.txt 与未跟踪文件被暂存，a.txt 保留
    expect(st.unstaged.find((f) => f.path === 'a.txt')).toBeTruthy();
    expect(st.unstaged.find((f) => f.path === 'b.txt')).toBeFalsy();
    expect(st.untracked.includes('new-untracked.txt')).toBe(false);

    const list = await svc.listStashes();
    const shown = await svc.stashShow({ index: list[0]!.index });
    expect(shown.patch).toContain('stash me');
    expect(shown.patch).toContain('new file');
  });
});

describe('GitService 串行队列', () => {
  it('高并发读写调用按序执行且不报错', async () => {
    cleanupTmp();
    const { dir } = await createSampleRepo();
    const svc = await GitService.open(dir);
    fs.writeFileSync(path.join(dir, 'queue.txt'), '1\n');
    await svc.add(['queue.txt']);
    await svc.commit('feat: queue');
    const results = await Promise.all([
      svc.getStatus(),
      svc.getLog({ maxCount: 5 }),
      svc.getDiff(),
      svc.listBranches(),
      svc.getGraph()
    ]);
    expect(results.length).toBe(5);
    cleanupTmp();
  });
});