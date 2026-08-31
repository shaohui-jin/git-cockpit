import { afterEach, describe, expect, it } from 'vitest';
import {
  createGithubPullRequest,
  createGitlabMergeRequest,
  createPullOrMergeRequest,
  DEFAULT_CONFIG,
  detectMrPlatform,
  GitOperationError,
  githubPullsApiUrl,
  gitlabApiRoot,
  isGithubRemote,
  findMrHost,
  hostnameOf,
  methodForRepo,
  normalizeHostName,
  normalizeMrConfig,
  normalizeRepoMethodKey,
  pickRemoteName,
  parseGithubRepo,
  parseGitlabProject,
  probeMrCli,
  resolveCliBin,
  resolveMrPlatform,
  tokenForRemote,
  upsertMrHost
} from '../src/index.ts';
import type { PrepareMrResult } from '../src/index.ts';

describe('远程平台解析', () => {
  it('识别 ssh / https GitHub 并抽出 owner/repo', () => {
    expect(parseGithubRepo('git@github.com:acme/app.git')).toEqual({
      owner: 'acme',
      repo: 'app',
      origin: 'https://github.com'
    });
    expect(parseGithubRepo('https://github.com/acme/app.git')?.repo).toBe('app');
    expect(isGithubRemote('https://gitlab.com/acme/app.git')).toBe(false);
    expect(parseGithubRepo('https://gitlab.com/acme/app.git')).toBeNull();
  });

  it('GitLab 含 subgroup 的 projectPath', () => {
    const p = parseGitlabProject('https://gitlab.com/group/sub/app.git');
    expect(p?.projectPath).toBe('group/sub/app');
    expect(detectMrPlatform('https://gitlab.com/group/sub/app.git')).toBe('gitlab');
  });

  it('host 档案可覆盖检测结果；无档案则用检测值', () => {
    const mr = {
      ...DEFAULT_CONFIG.mr,
      hosts: [{ host: 'git.a.com', platform: 'github' as const, token: '', apiBaseUrl: '' }]
    };
    expect(resolveMrPlatform('gitlab', 'https://git.a.com/g/app.git', mr)).toBe('github');
    expect(resolveMrPlatform('github', 'https://github.com/acme/app.git', DEFAULT_CONFIG.mr)).toBe('github');
  });

  it('into 前缀选出远程名', () => {
    expect(pickRemoteName('origin/master', ['origin', 'upstream'])).toBe('origin');
    expect(pickRemoteName('upstream/dev', ['origin', 'upstream'])).toBe('upstream');
    expect(pickRemoteName('main', ['origin'])).toBe('origin');
    expect(pickRemoteName('main', ['company'])).toBe('company');
  });

  it('github.com 走 api.github.com；apiBaseUrl 可覆盖', () => {
    expect(githubPullsApiUrl('git@github.com:acme/app.git')).toBe(
      'https://api.github.com/repos/acme/app/pulls'
    );
    expect(githubPullsApiUrl('git@github.com:acme/app.git', 'https://git.example.com/api/v3')).toBe(
      'https://git.example.com/api/v3/repos/acme/app/pulls'
    );
  });

  it('GitLab API 根', () => {
    expect(gitlabApiRoot('https://gitlab.com/acme/app.git')).toBe('https://gitlab.com/api/v4');
    expect(gitlabApiRoot('https://gitlab.com/acme/app.git', 'https://git.example.com/api/v4')).toBe(
      'https://git.example.com/api/v4'
    );
  });
});

describe('normalizeMrConfig / hosts', () => {
  it('旧 githubToken / gitlabToken 迁到对应 hostname', () => {
    const n = normalizeMrConfig({
      githubToken: 'ghp_x',
      gitlabToken: 'glpat_y',
      method: 'token'
    });
    expect(n.method).toBe('token');
    expect(n.hosts).toEqual([
      { host: 'github.com', platform: 'github', token: 'ghp_x', apiBaseUrl: '' },
      { host: 'gitlab.com', platform: 'gitlab', token: 'glpat_y', apiBaseUrl: '' }
    ]);
  });

  it('自建 GitLab 的 apiBaseUrl 抽出 host，两家公司互不覆盖', () => {
    const n = normalizeMrConfig({
      hosts: [
        { host: 'git.a.com', platform: 'gitlab', token: 'tok-a', apiBaseUrl: '' },
        { host: 'git.b.com', platform: 'gitlab', token: 'tok-b', apiBaseUrl: '' }
      ]
    });
    expect(tokenForRemote(n, 'https://git.a.com/g/app.git')).toBe('tok-a');
    expect(tokenForRemote(n, 'https://git.b.com/g/app.git')).toBe('tok-b');
    expect(tokenForRemote(n, 'https://git.c.com/g/app.git')).toBe('');
    expect(findMrHost(n, 'https://git.a.com/x/y.git')?.host).toBe('git.a.com');
    expect(normalizeHostName('www.github.com')).toBe('github.com');
    expect(hostnameOf('git@git.a.com:g/app.git')).toBe('git.a.com');
  });

  it('旧 method auto 迁成 browser', () => {
    expect(normalizeMrConfig({ method: 'auto' }).method).toBe('browser');
    expect(normalizeMrConfig({}).method).toBe('browser');
    expect(normalizeMrConfig({}).repoMethods).toEqual({});
  });

  it('repoMethods 按仓库路径规范化；未登记的仓库默认 browser', () => {
    const cwd = process.cwd();
    const n = normalizeMrConfig({
      method: 'token',
      repoMethods: { [cwd]: 'cli', '  ': 'token' }
    });
    expect(n.method).toBe('token');
    expect(methodForRepo(n, cwd)).toBe('cli');
    expect(methodForRepo(n, undefined)).toBe('browser');
    expect(methodForRepo({ repoMethods: { [normalizeRepoMethodKey('/tmp/other-xyz')]: 'token' } }, cwd)).toBe(
      'browser'
    );
  });

  it('upsert 只改指定 host', () => {
    const hosts = upsertMrHost([], { host: 'git.a.com', platform: 'gitlab', token: 'a' });
    const next = upsertMrHost(hosts, { host: 'git.b.com', platform: 'gitlab', token: 'b' });
    const cleared = upsertMrHost(next, { host: 'git.a.com', clearToken: true });
    expect(cleared.find((h) => h.host === 'git.a.com')?.token).toBe('');
    expect(cleared.find((h) => h.host === 'git.b.com')?.token).toBe('b');
  });
});

describe('probeMrCli', () => {
  it('找不到二进制时带官方安装地址', async () => {
    const r = await probeMrCli('gh', { bin: 'git-cockpit-no-such-cli-xyz' });
    expect(r.found).toBe(false);
    expect(r.loggedIn).toBe(false);
    expect(r.installUrl).toContain('cli.github.com');
    expect(r.error).toContain('cli.github.com');
    const glab = await probeMrCli('glab', { bin: 'git-cockpit-no-such-cli-xyz' });
    expect(glab.installUrl).toContain('gitlab.com/gitlab-org/cli');
  });

  it('Windows 能扫到系统 Path 里的 gh，不依赖当前进程 PATH', async () => {
    if (process.platform !== 'win32') return;
    const resolved = resolveCliBin('gh');
    const probed = await probeMrCli('gh');
    if (resolved) {
      expect(probed.found).toBe(true);
      expect(resolved.toLowerCase().endsWith('gh.exe') || resolved.toLowerCase().endsWith('gh.cmd')).toBe(true);
    }
    const glabBin = resolveCliBin('glab');
    if (glabBin) {
      const glab = await probeMrCli('glab');
      expect(glab.found).toBe(true);
    }
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

describe('createGitlabMergeRequest', () => {
  const origFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = origFetch;
  });

  it('无 Token 拒绝', async () => {
    await expect(
      createGitlabMergeRequest({
        remoteUrl: 'https://gitlab.com/acme/app.git',
        token: '  ',
        sourceBranch: 'feat',
        targetBranch: 'main',
        title: 't'
      })
    ).rejects.toMatchObject({ code: 'NO_TOKEN' });
  });

  it('非 GitLab 路径过短拒绝', async () => {
    await expect(
      createGitlabMergeRequest({
        remoteUrl: 'https://gitlab.com/onlyone.git',
        token: 'tok',
        sourceBranch: 'feat',
        targetBranch: 'main',
        title: 't'
      })
    ).rejects.toMatchObject({ code: 'NOT_GITLAB' });
  });

  it('POST merge_requests 成功返回 web_url', async () => {
    globalThis.fetch = (async (input, init) => {
      expect(String(input)).toBe('https://gitlab.com/api/v4/projects/acme%2Fapp/merge_requests');
      expect(init?.method).toBe('POST');
      const headers = new Headers(init?.headers);
      expect(headers.get('PRIVATE-TOKEN')).toBe('tok');
      const body = JSON.parse(String(init?.body)) as { source_branch: string; target_branch: string };
      expect(body.source_branch).toBe('feat');
      expect(body.target_branch).toBe('main');
      return new Response(JSON.stringify({ web_url: 'https://gitlab.com/acme/app/-/merge_requests/4', iid: 4 }), {
        status: 201
      });
    }) as typeof fetch;

    const r = await createGitlabMergeRequest({
      remoteUrl: 'git@gitlab.com:acme/app.git',
      token: 'tok',
      sourceBranch: 'feat',
      targetBranch: 'main',
      title: 'Merge feat into main'
    });
    expect(r).toEqual({ url: 'https://gitlab.com/acme/app/-/merge_requests/4', warnings: [] });
  });
});

function fakePrep(over: Partial<PrepareMrResult> = {}): PrepareMrResult {
  return {
    platform: 'github',
    remote: 'origin',
    remoteUrl: 'https://github.com/acme/app.git',
    sourceBranch: 'feat',
    targetBranch: 'main',
    title: 'Merge feat into main',
    createMrUrl: 'https://github.com/acme/app/compare/main...feat',
    cli: null,
    candidates: [],
    messages: [],
    ...over
  };
}

describe('createPullOrMergeRequest', () => {
  const cwd = process.cwd();

  it('method=token 且无 Token 时报 NO_TOKEN', async () => {
    await expect(
      createPullOrMergeRequest({
        prep: fakePrep(),
        mr: {
          ...DEFAULT_CONFIG.mr,
          method: 'token',
          repoMethods: { [normalizeRepoMethodKey(cwd)]: 'token' }
        },
        cwd
      })
    ).rejects.toMatchObject({ code: 'NO_TOKEN' });
  });

  it('未给该仓库登记开单方式时走 browser，即使全局 method=token', async () => {
    const r = await createPullOrMergeRequest({
      prep: fakePrep(),
      mr: { ...DEFAULT_CONFIG.mr, method: 'token' },
      cwd
    });
    if ('dryRun' in r) throw new Error('unexpected dryRun');
    expect(r.via).toBe('browser');
  });

  it('method=browser 只返回创建页，不调 API', async () => {
    const r = await createPullOrMergeRequest({
      prep: fakePrep(),
      mr: { ...DEFAULT_CONFIG.mr, method: 'browser' },
      cwd
    });
    if ('dryRun' in r) throw new Error('unexpected dryRun');
    expect(r.via).toBe('browser');
    expect(r.url).toContain('/compare/');
  });

  it('method=token 时只用当前域名的 Token', async () => {
    const mr = {
      ...DEFAULT_CONFIG.mr,
      method: 'token' as const,
      repoMethods: { [normalizeRepoMethodKey(cwd)]: 'token' as const },
      hosts: [
        { host: 'git.a.com', platform: 'gitlab' as const, token: 'tok-a', apiBaseUrl: '' },
        { host: 'git.b.com', platform: 'gitlab' as const, token: 'tok-b', apiBaseUrl: '' }
      ]
    };
    const ok = await createPullOrMergeRequest({
      prep: fakePrep({
        platform: 'gitlab',
        remoteUrl: 'https://git.a.com/g/app.git',
        createMrUrl: 'https://git.a.com/g/app/-/merge_requests/new'
      }),
      mr,
      cwd: process.cwd(),
      dryRun: true
    });
    expect(ok).toMatchObject({ dryRun: true, command: 'POST gitlab merge_requests' });
    await expect(
      createPullOrMergeRequest({
        prep: fakePrep({
          platform: 'gitlab',
          remoteUrl: 'https://git.c.com/g/app.git',
          createMrUrl: null
        }),
        mr,
        cwd: process.cwd(),
        dryRun: true
      })
    ).rejects.toMatchObject({ code: 'NO_TOKEN' });
  });
});
