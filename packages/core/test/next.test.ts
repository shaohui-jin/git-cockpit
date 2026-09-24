import { describe, expect, it } from 'vitest';
import { suggestNext } from '../src/capabilities/next.ts';

describe('suggestNext', () => {
  it('git_status 脏工作区 → git_add', () => {
    expect(
      suggestNext('git_status', { isClean: false, unstaged: [{ path: 'a.ts' }], untracked: [], staged: [] })
    ).toEqual([{ tool: 'git_add', args: { dryRun: true } }]);
  });

  it('git_status 工作区 merge → continue', () => {
    expect(suggestNext('git_status', { operation: 'merge', isClean: false })).toEqual([{ tool: 'git_merge_continue' }]);
  });

  it('git_add dry-run 不再给出真执行；成功后才建议 git_commit', () => {
    expect(suggestNext('git_add', { dryRun: true, command: 'git add' }, { paths: ['a.ts'], dryRun: true })).toEqual([]);
    expect(suggestNext('git_add', { ok: true }, { paths: ['a.ts'] })).toEqual([
      { tool: 'git_commit', args: { dryRun: true } }
    ]);
  });

  it('git_merge_rehearse 冲突 → 不给落盘、不开单', () => {
    const next = suggestNext(
      'git_merge_rehearse',
      { into: 'main', from: 'feat', clean: false, conflictFiles: [{ path: 'a.ts' }] },
      {}
    );
    expect(next).toEqual([]);
  });

  it('git_merge_preview 干净 → git_apply_resolve', () => {
    expect(suggestNext('git_merge_preview', { into: 'main', from: 'feat', clean: true })).toEqual([
      { tool: 'git_apply_resolve', args: { into: 'main', from: 'feat', dryRun: true } }
    ]);
  });

  it('git_merge_preview 已有临时枝 / 已包含时不落盘', () => {
    expect(
      suggestNext('git_merge_preview', {
        into: 'main',
        from: 'feat',
        clean: true,
        situation: 'already_merged'
      })
    ).toEqual([]);
    expect(
      suggestNext('git_merge_preview', {
        into: 'main',
        from: 'feat',
        situation: 'temp_local',
        pairTempBranch: { name: 'merge/feat-into-main', local: true, remote: false }
      })
    ).toEqual([{ tool: 'git_push', args: { branch: 'merge/feat-into-main', dryRun: true } }]);
    expect(
      suggestNext('git_merge_preview', {
        into: 'origin/merge/x',
        from: 'main',
        situation: 'looking_at_temp',
        pairTempBranch: { name: 'merge/x', remote: false },
        recoveredPair: { into: 'main', from: 'feat' }
      })
    ).toEqual([{ tool: 'git_push', args: { branch: 'merge/x', dryRun: true } }]);
    expect(
      suggestNext('git_merge_preview', {
        into: 'origin/merge/x',
        from: 'main',
        situation: 'looking_at_temp',
        pairTempBranch: { name: 'merge/x', remote: true },
        recoveredPair: { into: 'main', from: 'feat' }
      })
    ).toEqual([{ tool: 'git_mr_prepare', args: { into: 'main', from: 'feat', sourceBranch: 'merge/x' } }]);
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

  it('git_apply_resolve 成功 → git_mr_prepare；mergeGate.ok 才 create；干跑不再确认开单', () => {
    expect(
      suggestNext('git_apply_resolve', { into: 'main', from: 'feat', tempBranch: 'merge/feat' }, { from: 'feat' })
    ).toEqual([{ tool: 'git_mr_prepare', args: { into: 'main', from: 'feat', sourceBranch: 'merge/feat' } }]);
    expect(
      suggestNext(
        'git_mr_prepare',
        { sourceBranch: 'merge/feat', mergeGate: { ok: false, code: 'TEMP_NOT_PUSHED' } },
        { into: 'main', from: 'feat', sourceBranch: 'merge/feat' }
      )
    ).toEqual([{ tool: 'git_push', args: { branch: 'merge/feat', dryRun: true } }]);
    expect(
      suggestNext('git_mr_prepare', { mergeGate: { ok: false, code: 'NOT_LANDED' } }, { into: 'main', from: 'feat' })
    ).toEqual([{ tool: 'git_apply_resolve', args: { into: 'main', from: 'feat', dryRun: true } }]);
    expect(
      suggestNext(
        'git_mr_prepare',
        { mergeGate: { ok: false, code: 'CONFLICTS_UNRESOLVED' } },
        { into: 'main', from: 'feat' }
      )
    ).toEqual([]);
    expect(
      suggestNext(
        'git_mr_prepare',
        { mergeGate: { ok: true } },
        { into: 'main', from: 'feat', sourceBranch: 'merge/feat' }
      )
    ).toEqual([
      {
        tool: 'git_mr_create',
        args: { into: 'main', from: 'feat', sourceBranch: 'merge/feat', dryRun: true }
      }
    ]);
    expect(
      suggestNext(
        'git_mr_prepare',
        { sourceBranch: 'merge/feat', template: { enabled: true, fields: [] }, mergeGate: { ok: true } },
        { into: 'main', from: 'feat' }
      )
    ).toEqual([
      {
        tool: 'git_mr_create',
        args: { into: 'main', from: 'feat', sourceBranch: 'merge/feat', dryRun: true, fields: {} }
      }
    ]);
    expect(
      suggestNext(
        'git_mr_create',
        { dryRun: true, command: 'gh pr create' },
        { into: 'main', from: 'feat', dryRun: true }
      )
    ).toEqual([]);
  });
});
