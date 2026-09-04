import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { GitOperationError, GitService, assertCloneDest, assertSafeCloneUrl, spawnClone } from '../src/index.ts';
import { cleanupTmp, createSampleRepo, makeTmpDir } from './helpers.ts';

describe('clone URL / dest 校验', () => {
  it('拒绝 URL 中的账号口令与 token', () => {
    expect(() => assertSafeCloneUrl('https://user:pass@github.com/a/b.git')).toThrow(GitOperationError);
    expect(() => assertSafeCloneUrl('https://ghp_abc@github.com/a/b.git')).toThrow(GitOperationError);
  });

  it('接受 https / SSH / 本机绝对路径', () => {
    expect(assertSafeCloneUrl('https://github.com/a/b.git')).toBe('https://github.com/a/b.git');
    expect(assertSafeCloneUrl('git@github.com:a/b.git')).toBe('git@github.com:a/b.git');
    const dir = makeTmpDir('clone-src-');
    expect(assertSafeCloneUrl(dir)).toBe(path.resolve(dir));
  });

  it('dest 必须绝对路径且父目录存在', () => {
    expect(() => assertCloneDest('relative/out')).toThrow(/绝对路径/);
    const parent = makeTmpDir('clone-parent-');
    const dest = path.join(parent, 'new-repo');
    expect(assertCloneDest(dest)).toBe(path.resolve(dest));
  });

  it('非空 dest 拒绝', () => {
    const dest = makeTmpDir('clone-full-');
    fs.writeFileSync(path.join(dest, 'keep.txt'), 'x');
    expect(() => assertCloneDest(dest)).toThrow(/非空/);
  });
});

describe('spawnClone 本机仓库', () => {
  beforeEach(() => cleanupTmp());
  afterAll(() => cleanupTmp());

  it('能把本地仓 clone 到空目标目录', async () => {
    const { dir: src } = await createSampleRepo();
    const parent = makeTmpDir('clone-to-');
    const dest = path.join(parent, 'copy');
    const logs: string[] = [];
    await spawnClone(src, dest, (c) => logs.push(c));
    const svc = await GitService.open(dest);
    const status = await svc.getStatus();
    expect(status.current).toBe('main');
    expect(fs.existsSync(path.join(dest, '.git'))).toBe(true);
  });
});
