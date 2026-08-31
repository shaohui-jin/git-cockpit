import { describe, expect, it } from 'vitest';
import { maskToken, validateGithubTokenFormat, validateGitlabTokenFormat } from '../src/index.ts';

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
