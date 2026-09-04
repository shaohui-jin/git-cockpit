import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertRepoAllowed, isRepoAllowed } from '../src/allowedRepos.ts';
import { GitOperationError } from '../src/types.ts';

describe('allowedRepos', () => {
  it('空名单不限制', () => {
    expect(isRepoAllowed('/any/repo', [])).toBe(true);
    expect(isRepoAllowed('/any/repo', undefined)).toBe(true);
  });

  it('仓库根等于名单条目或位于其下才允许', () => {
    const root = path.resolve('/work/allowed');
    const child = path.join(root, 'repo');
    expect(isRepoAllowed(root, [root])).toBe(true);
    expect(isRepoAllowed(child, [root])).toBe(true);
    expect(isRepoAllowed(path.resolve('/work/other'), [root])).toBe(false);
  });

  it('不在名单内抛 REPO_NOT_ALLOWED', () => {
    expect(() => assertRepoAllowed(path.resolve('/tmp/x'), [path.resolve('/work')])).toThrow(GitOperationError);
    try {
      assertRepoAllowed(path.resolve('/tmp/x'), [path.resolve('/work')]);
    } catch (err) {
      expect(err).toBeInstanceOf(GitOperationError);
      expect((err as GitOperationError).code).toBe('REPO_NOT_ALLOWED');
    }
  });
});
