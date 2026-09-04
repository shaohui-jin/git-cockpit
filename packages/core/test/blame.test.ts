import { afterAll, describe, expect, it } from 'vitest';
import { parseBlamePorcelain, parseNewSideRanges } from '../src/blame.ts';
import { GitService } from '../src/index.ts';
import { cleanupTmp, createConflictRepo } from './helpers.ts';

describe('blame porcelain', () => {
  it('解析作者与说明并按 sha 去重', () => {
    const sha = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const stdout = [
      `${sha} 1 1 1`,
      'author Alice',
      'author-mail <a@ex.com>',
      'author-time 1700000000',
      'summary fix: ours',
      '\tours',
      `${sha} 2 2 1`,
      'author Alice',
      '\tmore',
      ''
    ].join('\n');
    const commits = parseBlamePorcelain(stdout);
    expect(commits).toHaveLength(1);
    expect(commits[0]?.author).toBe('Alice');
    expect(commits[0]?.summary).toBe('fix: ours');
    expect(commits[0]?.shortSha).toBe('aaaaaaa');
  });

  it('解析 diff -U0 新侧行号', () => {
    expect(parseNewSideRanges('@@ -1 +1,2 @@\n+a\n+b\n')).toEqual([[1, 2]]);
    expect(parseNewSideRanges('@@ -3,0 +4 @@\n+x\n')).toEqual([[4, 4]]);
  });
});

describe('blameConflictFile', () => {
  afterAll(() => cleanupTmp());

  it('冲突文件两侧都能溯到提交', async () => {
    cleanupTmp();
    const { dir } = await createConflictRepo();
    const svc = await GitService.open(dir);
    const result = await svc.blameConflictFile({ into: 'main', from: 'feature', path: 'a.txt', fetch: false });
    expect(result.path).toBe('a.txt');
    expect(result.hunks.length).toBeGreaterThan(0);
    const ours = result.hunks.flatMap((h) => h.ours);
    const theirs = result.hunks.flatMap((h) => h.theirs);
    expect(ours.some((c) => c.summary.includes('ours'))).toBe(true);
    expect(theirs.some((c) => c.summary.includes('theirs'))).toBe(true);
  });
});
