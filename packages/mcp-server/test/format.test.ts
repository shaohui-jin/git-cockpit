import { describe, expect, it } from 'vitest';
import { formatResultForMcp, summarizeForAgent } from '../src/tools/format.ts';
import type { ToolExecutionResult } from '../src/tools/handlers.ts';

function ok(tool: string, result: unknown, args: Record<string, unknown> = {}): ToolExecutionResult {
  return {
    tool,
    source: 'mcp',
    dryRun: false,
    success: true,
    result,
    durationMs: 1,
    args
  };
}

describe('summarizeForAgent', () => {
  it('git_diff 默认去掉 rawPatch', () => {
    const out = summarizeForAgent(
      'git_diff',
      { files: [{ path: 'a.ts' }], rawPatch: '@@ -1 +1 @@\n-old\n+new\n', stats: { filesChanged: 1 } },
      {}
    ) as { rawPatch?: string; detailAvailable?: boolean };
    expect(out.rawPatch).toBeUndefined();
    expect(out.detailAvailable).toBe(true);
  });

  it('git_diff 带 path 或 detail 保留正文', () => {
    const full = { files: [], rawPatch: '+x', stats: {} };
    expect((summarizeForAgent('git_diff', full, { path: 'a.ts' }) as { rawPatch: string }).rawPatch).toBe('+x');
    expect((summarizeForAgent('git_diff', full, { detail: true }) as { rawPatch: string }).rawPatch).toBe('+x');
  });

  it('git_merge_rehearse 默认去掉冲突正文', () => {
    const out = summarizeForAgent(
      'git_merge_rehearse',
      {
        into: 'main',
        from: 'feat',
        clean: false,
        conflictFiles: [
          {
            path: 'a.ts',
            contentConflict: true,
            hunks: [],
            conflictContent: '<<<<<<< ours\nA\n=======\nB\n>>>>>>> theirs\n'
          }
        ]
      },
      {}
    ) as { conflictFiles: Array<{ conflictContent?: string; path: string }>; next: unknown[] };
    expect(out.conflictFiles[0]?.conflictContent).toBeUndefined();
    expect(out.conflictFiles[0]?.path).toBe('a.ts');
    expect(out.next?.[0]).toMatchObject({ tool: 'git_merge_rehearse', args: { path: 'a.ts' } });
    expect(out.next?.[1]).toMatchObject({ tool: 'git_apply_resolve' });
  });

  it('git_status 脏工作区附 next git_add', () => {
    const out = summarizeForAgent('git_status', {
      isClean: false,
      operation: 'none',
      unstaged: [{ path: 'a.ts' }],
      untracked: [],
      staged: []
    }) as { next: Array<{ tool: string }> };
    expect(out.next[0]).toMatchObject({ tool: 'git_add' });
  });

  it('写操作 dry-run 预览附 next 真执行', () => {
    const out = summarizeForAgent(
      'git_add',
      { dryRun: true, command: 'git add -- a.ts', args: ['add', '--', 'a.ts'], risk: 'low' },
      { paths: ['a.ts'], dryRun: true },
      true
    ) as { next: Array<{ tool: string; args?: { dryRun?: boolean } }> };
    expect(out.next[0]).toMatchObject({ tool: 'git_add', args: { dryRun: false } });
  });

  it('git_repo_overview 默认去掉每日热力格子', () => {
    const days = new Array(84).fill(0);
    days[0] = 3;
    const out = summarizeForAgent(
      'git_repo_overview',
      { repos: [{ path: 'D:/a', activityTotal: 3, activity: days, activityStart: '2026-06-22' }] },
      {}
    ) as { repos: Array<{ activity?: number[]; activityTotal: number }> };
    expect(out.repos[0]?.activity).toBeUndefined();
    expect(out.repos[0]?.activityTotal).toBe(3);
  });
});

describe('formatResultForMcp', () => {
  it('摘要文本不含冲突标记', () => {
    const text = formatResultForMcp(
      ok('git_merge_rehearse', {
        into: 'main',
        from: 'feat',
        conflictFiles: [{ path: 'a.ts', conflictContent: '<<<<<<< ours\nA\n' }]
      })
    );
    expect(text).not.toContain('<<<<<<<');
    expect(text).toContain('a.ts');
  });

  it('detail=true 保留冲突标记', () => {
    const text = formatResultForMcp(
      ok(
        'git_merge_rehearse',
        { conflictFiles: [{ path: 'a.ts', conflictContent: '<<<<<<< ours\nA\n' }] },
        { detail: true }
      )
    );
    expect(text).toContain('<<<<<<<');
  });

  it('成功输出含 next 提示行', () => {
    const text = formatResultForMcp(
      ok('git_status', {
        isClean: false,
        operation: 'none',
        unstaged: [{ path: 'a.ts' }],
        untracked: [],
        staged: []
      })
    );
    expect(text).toContain('next: git_add');
    expect(text).toContain('"tool":"git_add"');
  });
});
