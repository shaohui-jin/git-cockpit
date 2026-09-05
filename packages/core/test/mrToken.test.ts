import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  describeFetchError,
  maskToken,
  trustSystemCa,
  validateGithubTokenFormat,
  validateGitlabTokenFormat,
  validateMrToken
} from '../src/index.ts';

describe('maskToken', () => {
  it('保留前缀与末 4 位', () => {
    expect(maskToken('ghp_' + 'a'.repeat(36))).toBe('ghp_••••aaaa');
    expect(maskToken('github_pat_' + 'b'.repeat(22))).toBe('github_pat_••••bbbb');
    expect(maskToken('glpat-' + 'c'.repeat(20))).toBe('glpat-••••cccc');
  });
});

describe('Token 格式', () => {
  it('GitHub ghp_ 须 36 位', () => {
    expect(validateGithubTokenFormat('nope').ok).toBe(false);
    expect(validateGithubTokenFormat('ghp_short').ok).toBe(false);
    expect(validateGithubTokenFormat('ghp_' + 'A'.repeat(36)).ok).toBe(true);
  });

  it('GitLab 须 glpat- 且至少 20 位', () => {
    expect(validateGitlabTokenFormat('glpat_a').ok).toBe(false);
    expect(validateGitlabTokenFormat('glpat-short').ok).toBe(false);
    expect(validateGitlabTokenFormat('glpat-' + 'A'.repeat(20)).ok).toBe(true);
  });
});

describe('describeFetchError', () => {
  it('带上 undici 的 cause', () => {
    const err = new TypeError('fetch failed');
    err.cause = Object.assign(new Error('unable to verify the first certificate'), {
      code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE'
    });
    expect(describeFetchError(err)).toBe('fetch failed（unable to verify the first certificate）');
  });
});

describe('validateMrToken 网络错误', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('GitHub fetch failed 时展示证书 cause', async () => {
    const err = new TypeError('fetch failed');
    err.cause = new Error('unable to verify the first certificate');
    vi.stubGlobal('fetch', async () => {
      throw err;
    });
    const status = await validateMrToken({ platform: 'github', token: 'ghp_' + 'A'.repeat(36) });
    expect(status.ok).toBe(false);
    expect(status.error).toContain('unable to verify the first certificate');
  });
});

describe('trustSystemCa', () => {
  it('可重复调用且不抛错', () => {
    expect(() => {
      trustSystemCa();
      trustSystemCa();
    }).not.toThrow();
  });
});
