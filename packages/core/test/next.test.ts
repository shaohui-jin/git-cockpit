import { describe, expect, it } from 'vitest';
import { suggestNext } from '../src/capabilities/next.ts';

describe('suggestNext', () => {
  it('git_status 脏工作区 → git_add', () => {
    expect(
      suggestNext('git_status', { isClean: false, unstaged: [{ path: 'a.ts' }], untracked: [], staged: [] })
    ).toEqual([{ tool: 'git_add', args: { dryRun: true } }]);
  });

  it('git_status 工作区 merge → continue', () => {
    expect(suggestNext('git_status', { operation: 'merge', isClean: false })).toEqual([
      { tool: 'git_merge_continue' }
    ]);
  });

  it('git_add dry-run → 真 git_add；成功 → git_commit', () => {
    expect(suggestNext('git_add', { dryRun: true, command: 'git add' }, { paths: ['a.ts'], dryRun: true })).toEqual([
      { tool: 'git_add', args: { paths: ['a.ts'], dryRun: false } }
    ]);
    expect(suggestNext('git_add', { ok: true }, { paths: ['a.ts'] })).toEqual([
      { tool: 'git_commit', args: { dryRun: true } }
    ]);
  });

  it('git_merge_rehearse 冲突 → 带 path 的 rehearse + 落盘', () => {
    const next = suggestNext(
      'git_merge_rehearse',
      { into: 'main', from: 'feat', clean: false, conflictFiles: [{ path: 'a.ts' }] },
      {}
    );
    expect(next[0]).toEqual({ tool: 'git_merge_rehearse', args: { into: 'main', from: 'feat', path: 'a.ts' } });
    expect(next[1]).toEqual({ tool: 'git_apply_resolve', args: { into: 'main', from: 'feat', dryRun: true } });
  });

  it('git_merge_preview 干净 → git_apply_resolve', () => {
    expect(suggestNext('git_merge_preview', { into: 'main', from: 'feat', clean: true })).toEqual([
      { tool: 'git_apply_resolve', args: { into: 'main', from: 'feat', dryRun: true } }
    ]);
  });

  it('git_merge_survey 有 jobId → git_job_get；冲突格 → rehearse', () => {
    expect(suggestNext('git_merge_survey', { jobId: 'j1', status: 'running' })).toEqual([
      { tool: 'git_job_get', args: { id: 'j1' } }
    ]);
    expect(
      suggestNext('git_merge_survey', {
        cells: [{ into: 'main', from: 'feat', outcome: 'conflicts', conflictPaths: ['a.ts'] }]
      })
    ).toEqual([{ tool: 'git_merge_rehearse', args: { into: 'main', from: 'feat' } }]);
  });

  it('git_apply_resolve 成功 → git_mr_prepare；git_mr_prepare → git_mr_create', () => {
    expect(
      suggestNext('git_apply_resolve', { into: 'main', from: 'feat', tempBranch: 'merge/feat' }, { from: 'feat' })
    ).toEqual([
      { tool: 'git_mr_prepare', args: { into: 'main', from: 'feat', sourceBranch: 'merge/feat' } }
    ]);
    expect(suggestNext('git_mr_prepare', {}, { into: 'main', from: 'feat', sourceBranch: 'merge/feat' })).toEqual([
      {
        tool: 'git_mr_create',
        args: { into: 'main', from: 'feat', sourceBranch: 'merge/feat', dryRun: true }
      }
    ]);
  });
});
