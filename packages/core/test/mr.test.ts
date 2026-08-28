import { afterEach, describe, expect, it } from 'vitest';
import {
  createGithubPullRequest,
  GitOperationError,
  githubPullsApiUrl,
  isGithubRemote,
  parseGithubRepo
} from '../src/index.ts';

describe('GitHub remote 解析', () => {
  it('识别 ssh / https 并抽出 owner/repo', () => {
    expect(parseGithubRepo('git@github.com:acme/app.git')).toEqual({
      owner: 'acme',
      repo: 'app',
      origin: 'https://github.com'
    });
    expect(parseGithubRepo('https://github.com/acme/app.git')?.repo).toBe('app');
    expect(isGithubRemote('https://gitlab.com/acme/app.git')).toBe(false);
    expect(parseGithubRepo('https://gitlab.com/acme/app.git')).toBeNull();
  });

  it('github.com 走 api.github.com', () => {
    expect(githubPullsApiUrl('git@github.com:acme/app.git')).toBe(
      'https://api.github.com/repos/acme/app/pulls'
    );
  });
});

describe('createGithubPullRequest', () => {
  const origFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = origFetch;
  });

  it('无 Token 拒绝', async () => {
    await expect(
      createGithubPullRequest({
        remoteUrl: 'https://github.com/acme/app.git',
        token: '  ',
        sourceBranch: 'feat',
        targetBranch: 'main',
        title: 't'
      })
    ).rejects.toMatchObject({ code: 'NO_TOKEN' });
  });

  it('非 GitHub 拒绝', async () => {
    await expect(
      createGithubPullRequest({
        remoteUrl: 'https://gitlab.com/acme/app.git',
        token: 'tok',
        sourceBranch: 'feat',
        targetBranch: 'main',
        title: 't'
      })
    ).rejects.toMatchObject({ code: 'NOT_GITHUB' });
  });

  it('POST pulls 成功返回 html_url', async () => {
    globalThis.fetch = (async (input, init) => {
      expect(String(input)).toBe('https://api.github.com/repos/acme/app/pulls');
      expect(init?.method).toBe('POST');
      const headers = new Headers(init?.headers);
      expect(headers.get('Authorization')).toBe('Bearer tok');
      expect(headers.get('User-Agent')).toBe('git-cockpit');
      const body = JSON.parse(String(init?.body)) as { head: string; base: string };
      expect(body.head).toBe('feat');
      expect(body.base).toBe('main');
      return new Response(JSON.stringify({ html_url: 'https://github.com/acme/app/pull/9', number: 9 }), {
        status: 201
      });
    }) as typeof fetch;

    const r = await createGithubPullRequest({
      remoteUrl: 'git@github.com:acme/app.git',
      token: 'tok',
      sourceBranch: 'feat',
      targetBranch: 'main',
      title: 'Merge feat into main'
    });
    expect(r).toEqual({ url: 'https://github.com/acme/app/pull/9', number: 9 });
  });

  it('API 错误带上 message', async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ message: 'Validation Failed' }), { status: 422 })) as typeof fetch;
    await expect(
      createGithubPullRequest({
        remoteUrl: 'https://github.com/acme/app.git',
        token: 'tok',
        sourceBranch: 'feat',
        targetBranch: 'main',
        title: 't'
      })
    ).rejects.toBeInstanceOf(GitOperationError);
  });
});
