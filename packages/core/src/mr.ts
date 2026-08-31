/**
 * 开 PR/MR：不是 git 操作。remote 的 ssh→https 复用 merge.ts 的 toHttpsRemoteUrl。
 * Token REST 与本机 gh/glab（PATH）在此；禁止下载 CLI。
 */
import { GitOperationError } from './types.ts';
import type {
  CreateMrResult,
  MrCandidate,
  MrCliStatus,
  MrConfig,
  MrConfigRaw,
  MrHostProfile,
  MrMethod,
  MrPlatform,
  PrepareMrResult
} from './types.ts';
import { toHttpsRemoteUrl } from './merge.ts';
import * as path from 'node:path';
import {
  cliInstallUrl,
  cliMissingHint,
  probeMrCli,
  runMrCli
} from './mrCli.ts';

export { GH_INSTALL_URL, GLAB_INSTALL_URL, probeAllMrCli, probeMrCli, readCliAuthToken, resolveCliBin } from './mrCli.ts';

export interface GithubRepoRef {
  owner: string;
  repo: string;
  origin: string;
}

export interface GitlabProjectRef {
  owner: string;
  repo: string;
  projectPath: string;
  origin: string;
}

export function normalizeRepoMethodKey(repoPath: string): string {
  const trimmed = repoPath.trim();
  if (!trimmed) return '';
  let normalized = path.resolve(trimmed);
  if (process.platform === 'win32') normalized = normalized.toLowerCase();
  return normalized;
}

export function methodForRepo(mr: Pick<MrConfig, 'repoMethods'>, repoPath?: string | null): MrMethod {
  const key = repoPath ? normalizeRepoMethodKey(repoPath) : '';
  if (!key) return 'browser';
  const hit = mr.repoMethods[key];
  return hit === 'cli' || hit === 'token' || hit === 'browser' ? hit : 'browser';
}

function normalizeRepoMethods(raw: unknown): Record<string, MrMethod> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, MrMethod> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (v !== 'cli' && v !== 'token' && v !== 'browser') continue;
    const key = normalizeRepoMethodKey(k);
    if (key) out[key] = v;
  }
  return out;
}

export function hostnameOf(remoteUrl: string): string | null {
  const https = toHttpsRemoteUrl(remoteUrl);
  if (!https) return null;
  try {
    return normalizeHostName(new URL(https).hostname);
  } catch {
    return null;
  }
}

export function normalizeHostName(host: string): string {
  const h = host.trim().toLowerCase();
  if (h === 'www.github.com') return 'github.com';
  return h;
}

export function findMrHost(mr: MrConfig, remoteUrl: string): MrHostProfile | undefined {
  const host = hostnameOf(remoteUrl);
  if (!host) return undefined;
  return mr.hosts.find((h) => normalizeHostName(h.host) === host);
}

export function upsertMrHost(
  hosts: MrHostProfile[],
  patch: { host: string; platform?: 'github' | 'gitlab'; token?: string; apiBaseUrl?: string; clearToken?: boolean }
): MrHostProfile[] {
  const host = normalizeHostName(patch.host);
  if (!host) return hosts;
  const i = hosts.findIndex((h) => normalizeHostName(h.host) === host);
  const cur: MrHostProfile =
    i >= 0 ? { ...hosts[i]! } : { host, platform: 'gitlab', token: '', apiBaseUrl: '' };
  cur.host = host;
  if (patch.platform === 'github' || patch.platform === 'gitlab') cur.platform = patch.platform;
  if (patch.clearToken) cur.token = '';
  else if (typeof patch.token === 'string' && patch.token.trim()) cur.token = patch.token.trim();
  if (typeof patch.apiBaseUrl === 'string') cur.apiBaseUrl = patch.apiBaseUrl.trim();
  const next = [...hosts];
  if (i >= 0) next[i] = cur;
  else next.push(cur);
  return next;
}

/** 旧 githubToken / gitlabToken / 全局 apiBaseUrl 迁到 hosts[]；主键 hostname */
export function normalizeMrConfig(raw: MrConfigRaw | undefined): MrConfig {
  const src = raw ?? {};
  const hosts: MrHostProfile[] = [];
  const seen = new Set<string>();
  const add = (p: MrHostProfile): void => {
    const host = normalizeHostName(p.host);
    if (!host || seen.has(host)) return;
    seen.add(host);
    hosts.push({
      host,
      platform: p.platform === 'github' ? 'github' : 'gitlab',
      token: (p.token ?? '').trim(),
      apiBaseUrl: (p.apiBaseUrl ?? '').trim()
    });
  };
  for (const h of src.hosts ?? []) {
    if (h?.host) add(h);
  }
  const legacyGithub = src.githubToken?.trim();
  if (legacyGithub) {
    add({ host: 'github.com', platform: 'github', token: legacyGithub, apiBaseUrl: '' });
  }
  const legacyGitlab = src.gitlabToken?.trim();
  const legacyApi = src.apiBaseUrl?.trim() ?? '';
  if (legacyGitlab) {
    let host = 'gitlab.com';
    if (legacyApi) {
      try {
        host = normalizeHostName(new URL(legacyApi).hostname) || 'gitlab.com';
      } catch {
        host = 'gitlab.com';
      }
    }
    add({
      host,
      platform: src.platform === 'github' ? 'github' : 'gitlab',
      token: legacyGitlab,
      apiBaseUrl: legacyApi
    });
  }
  const method: MrMethod =
    src.method === 'cli' || src.method === 'token' || src.method === 'browser' ? src.method : 'browser';
  return {
    method,
    defaultRemote: src.defaultRemote?.trim() || 'origin',
    hosts,
    repoMethods: normalizeRepoMethods(src.repoMethods)
  };
}

export function isGithubRemote(remoteUrl: string): boolean {
  const host = hostnameOf(remoteUrl);
  if (!host) return false;
  return host === 'github.com' || host.endsWith('.github.com');
}

export function isGitlabRemote(remoteUrl: string): boolean {
  const host = hostnameOf(remoteUrl);
  if (!host) return false;
  return host === 'gitlab.com' || host.endsWith('.gitlab.com') || host.includes('gitlab');
}

/** 有 URL 时：GitHub 主机为 github，其余按 GitLab（含自建）。host 档案可覆盖。 */
export function detectMrPlatform(remoteUrl: string): MrPlatform {
  if (!toHttpsRemoteUrl(remoteUrl)) return 'unknown';
  if (isGithubRemote(remoteUrl)) return 'github';
  return 'gitlab';
}

export function resolveMrPlatform(detected: MrPlatform, remoteUrl: string, mr: MrConfig): MrPlatform {
  const profile = findMrHost(mr, remoteUrl);
  if (profile?.platform === 'github' || profile?.platform === 'gitlab') return profile.platform;
  return detected;
}

export function tokenForRemote(mr: MrConfig, remoteUrl: string): string {
  return findMrHost(mr, remoteUrl)?.token.trim() ?? '';
}

export function apiBaseForRemote(mr: MrConfig, remoteUrl: string): string {
  return findMrHost(mr, remoteUrl)?.apiBaseUrl.trim() ?? '';
}

export function parseGithubRepo(remoteUrl: string): GithubRepoRef | null {
  const https = toHttpsRemoteUrl(remoteUrl);
  if (!https || !isGithubRemote(remoteUrl)) return null;
  try {
    const u = new URL(https);
    const parts = u.pathname.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
    if (parts.length < 2) return null;
    return { owner: parts[parts.length - 2]!, repo: parts[parts.length - 1]!, origin: u.origin };
  } catch {
    return null;
  }
}

export function parseGitlabProject(remoteUrl: string): GitlabProjectRef | null {
  const https = toHttpsRemoteUrl(remoteUrl);
  if (!https) return null;
  try {
    const u = new URL(https);
    const parts = u.pathname.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
    if (parts.length < 2) return null;
    return {
      owner: parts[0]!,
      repo: parts[parts.length - 1]!,
      projectPath: parts.join('/'),
      origin: u.origin
    };
  } catch {
    return null;
  }
}

function trimSlash(s: string): string {
  return s.replace(/\/+$/, '');
}

/** github.com → api.github.com；GHES 默认 origin/api/v3；可被 apiBaseUrl 覆盖 */
export function githubPullsApiUrl(remoteUrl: string, apiBaseUrl = ''): string | null {
  const parsed = parseGithubRepo(remoteUrl);
  if (!parsed) return null;
  const custom = trimSlash(apiBaseUrl.trim());
  if (custom) return `${custom}/repos/${parsed.owner}/${parsed.repo}/pulls`;
  let host: string;
  try {
    host = new URL(parsed.origin).hostname.toLowerCase();
  } catch {
    return null;
  }
  const apiBase =
    host === 'github.com' || host === 'www.github.com'
      ? 'https://api.github.com'
      : `${parsed.origin}/api/v3`;
  return `${apiBase}/repos/${parsed.owner}/${parsed.repo}/pulls`;
}

export function gitlabApiRoot(remoteUrl: string, apiBaseUrl = ''): string | null {
  const custom = trimSlash(apiBaseUrl.trim());
  if (custom) return custom;
  const parsed = parseGitlabProject(remoteUrl);
  if (!parsed) return null;
  return `${parsed.origin}/api/v4`;
}

function uaHeaders(token: string, kind: 'github' | 'gitlab'): Record<string, string> {
  if (kind === 'github') {
    return {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'User-Agent': 'git-cockpit',
      'Content-Type': 'application/json'
    };
  }
  return {
    'PRIVATE-TOKEN': token,
    'User-Agent': 'git-cockpit',
    'Content-Type': 'application/json'
  };
}

export async function createGithubPullRequest(options: {
  remoteUrl: string;
  token: string;
  sourceBranch: string;
  targetBranch: string;
  title: string;
  body?: string;
  reviewers?: string[];
  apiBaseUrl?: string;
}): Promise<{ url: string; number: number }> {
  const apiUrl = githubPullsApiUrl(options.remoteUrl, options.apiBaseUrl);
  if (!apiUrl) {
    throw new GitOperationError('远程不是可识别的 GitHub 仓库', 'NOT_GITHUB');
  }
  const token = options.token.trim();
  if (!token) {
    throw new GitOperationError('未配置 GitHub Token（设置 → MR 配置）', 'NO_TOKEN');
  }
  const headers = uaHeaders(token, 'github');
  let json: {
    html_url?: string;
    number?: number;
    message?: string;
    errors?: Array<{ message?: string }>;
  };
  try {
    const res = await fetch(apiUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        title: options.title,
        body: options.body ?? '',
        head: options.sourceBranch,
        base: options.targetBranch
      })
    });
    json = (await res.json()) as typeof json;
    if (!res.ok) {
      const detail = (json.errors ?? []).map((e) => e.message).filter(Boolean).join('; ');
      throw new GitOperationError(
        `GitHub 创建 PR 失败：${detail || json.message || String(res.status)}`,
        'CREATE_MR_FAILED'
      );
    }
  } catch (err) {
    if (err instanceof GitOperationError) throw err;
    throw new GitOperationError(
      `GitHub 创建 PR 请求失败：${err instanceof Error ? err.message : String(err)}`,
      'CREATE_MR_FAILED'
    );
  }
  if (!json.html_url || json.number == null) {
    throw new GitOperationError('GitHub 创建 PR 成功但未返回链接', 'CREATE_MR_FAILED');
  }
  const reviewers = [...new Set((options.reviewers ?? []).map((r) => r.trim()).filter(Boolean))];
  if (reviewers.length) {
    const parsed = parseGithubRepo(options.remoteUrl);
    const root = apiUrl.replace(/\/pulls$/, '');
    if (parsed) {
      await fetch(`${root}/pulls/${json.number}/requested_reviewers`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ reviewers })
      }).catch(() => undefined);
      await fetch(`${root}/issues/${json.number}/assignees`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ assignees: reviewers })
      }).catch(() => undefined);
    }
  }
  return { url: json.html_url, number: json.number };
}

async function resolveGitlabUserIds(
  apiRoot: string,
  token: string,
  usernames: string[]
): Promise<{ ids: number[]; missing: string[] }> {
  const ids: number[] = [];
  const missing: string[] = [];
  for (const username of usernames) {
    try {
      const res = await fetch(`${apiRoot}/users?username=${encodeURIComponent(username)}`, {
        headers: uaHeaders(token, 'gitlab')
      });
      if (!res.ok) {
        missing.push(username);
        continue;
      }
      const arr = (await res.json()) as Array<{ id?: number; username?: string }>;
      const hit =
        arr.find((u) => u.username?.toLowerCase() === username.toLowerCase()) ?? arr[0];
      if (hit?.id != null) ids.push(hit.id);
      else missing.push(username);
    } catch {
      missing.push(username);
    }
  }
  return { ids, missing };
}

export async function createGitlabMergeRequest(options: {
  remoteUrl: string;
  token: string;
  sourceBranch: string;
  targetBranch: string;
  title: string;
  body?: string;
  reviewers?: string[];
  apiBaseUrl?: string;
}): Promise<{ url: string; warnings: string[] }> {
  const parsed = parseGitlabProject(options.remoteUrl);
  const apiRoot = gitlabApiRoot(options.remoteUrl, options.apiBaseUrl);
  const token = options.token.trim();
  if (!parsed || !apiRoot) {
    throw new GitOperationError('远程不是可识别的 GitLab 仓库', 'NOT_GITLAB');
  }
  if (!token) {
    throw new GitOperationError('未配置 GitLab Token（设置 → MR 配置）', 'NO_TOKEN');
  }
  const warnings: string[] = [];
  const reviewers = [...new Set((options.reviewers ?? []).map((r) => r.trim()).filter(Boolean))];
  let userIds: number[] = [];
  if (reviewers.length) {
    const resolved = await resolveGitlabUserIds(apiRoot, token, reviewers);
    userIds = resolved.ids;
    if (resolved.missing.length) {
      warnings.push(`未能解析用户 id，已跳过：${resolved.missing.join(', ')}`);
    }
  }
  const project = encodeURIComponent(parsed.projectPath);
  let json: { web_url?: string; iid?: number; message?: string | string[] };
  try {
    const res = await fetch(`${apiRoot}/projects/${project}/merge_requests`, {
      method: 'POST',
      headers: uaHeaders(token, 'gitlab'),
      body: JSON.stringify({
        source_branch: options.sourceBranch,
        target_branch: options.targetBranch,
        title: options.title,
        description: options.body ?? '',
        assignee_ids: userIds,
        reviewer_ids: userIds
      })
    });
    json = (await res.json()) as typeof json;
    if (!res.ok) {
      const msg = Array.isArray(json.message) ? json.message.join('; ') : json.message;
      throw new GitOperationError(`GitLab 创建 MR 失败：${msg || String(res.status)}`, 'CREATE_MR_FAILED');
    }
  } catch (err) {
    if (err instanceof GitOperationError) throw err;
    throw new GitOperationError(
      `GitLab 创建 MR 请求失败：${err instanceof Error ? err.message : String(err)}`,
      'CREATE_MR_FAILED'
    );
  }
  if (!json.web_url) {
    throw new GitOperationError('GitLab 创建 MR 成功但未返回链接', 'CREATE_MR_FAILED');
  }
  return { url: json.web_url, warnings };
}

export async function listMrCandidates(options: {
  platform: MrPlatform;
  remoteUrl: string;
  token: string;
  apiBaseUrl?: string;
  cwd: string;
}): Promise<MrCandidate[]> {
  const token = options.token.trim();
  if (options.platform === 'github' && token) {
    const parsed = parseGithubRepo(options.remoteUrl);
    const apiUrl = githubPullsApiUrl(options.remoteUrl, options.apiBaseUrl);
    if (!parsed || !apiUrl) return [];
    const collab = apiUrl.replace(/\/pulls$/, '/collaborators?per_page=100');
    try {
      const res = await fetch(collab, { headers: uaHeaders(token, 'github') });
      if (!res.ok) return [];
      const arr = (await res.json()) as Array<{ login?: string; role_name?: string }>;
      return arr.filter((u) => u.login).map((u) => ({ username: u.login!, role: u.role_name }));
    } catch {
      return [];
    }
  }
  if (options.platform === 'gitlab' && token) {
    const parsed = parseGitlabProject(options.remoteUrl);
    const apiRoot = gitlabApiRoot(options.remoteUrl, options.apiBaseUrl);
    if (!parsed || !apiRoot) return [];
    try {
      const res = await fetch(
        `${apiRoot}/projects/${encodeURIComponent(parsed.projectPath)}/members/all?per_page=100`,
        { headers: uaHeaders(token, 'gitlab') }
      );
      if (!res.ok) return [];
      const arr = (await res.json()) as Array<{ username?: string; name?: string; access_level?: number }>;
      return arr
        .filter((u) => u.username && (u.access_level ?? 0) >= 30)
        .map((u) => ({ username: u.username!, name: u.name }));
    } catch {
      return [];
    }
  }
  const which = options.platform === 'gitlab' ? 'glab' : options.platform === 'github' ? 'gh' : null;
  if (!which) return [];
  const probe = await probeMrCli(which, { cwd: options.cwd });
  if (!probe.loggedIn) return [];
  if (which === 'gh') {
    const parsed = parseGithubRepo(options.remoteUrl);
    if (!parsed) return [];
    const run = await runMrCli(
      'gh',
      ['api', `repos/${parsed.owner}/${parsed.repo}/collaborators?per_page=100`],
      options.cwd
    );
    if (run.code !== 0) return [];
    try {
      const arr = JSON.parse(run.stdout) as Array<{ login?: string }>;
      return arr.filter((u) => u.login).map((u) => ({ username: u.login! }));
    } catch {
      return [];
    }
  }
  const parsed = parseGitlabProject(options.remoteUrl);
  if (!parsed) return [];
  const run = await runMrCli(
    'glab',
    ['api', `projects/${encodeURIComponent(parsed.projectPath)}/members/all?per_page=100`],
    options.cwd
  );
  if (run.code !== 0) return [];
  try {
    const arr = JSON.parse(run.stdout) as Array<{ username?: string; name?: string }>;
    return arr.filter((u) => u.username).map((u) => ({ username: u.username!, name: u.name }));
  } catch {
    return [];
  }
}

export interface EnrichMrOptions {
  prep: PrepareMrResult;
  mr: MrConfig;
  cwd: string;
}

export async function enrichPrepareMr(options: EnrichMrOptions): Promise<PrepareMrResult> {
  const platform = resolveMrPlatform(options.prep.platform, options.prep.remoteUrl, options.mr);
  const messages: string[] = [...options.prep.messages];
  let cli: 'gh' | 'glab' | null = null;
  let cliError: string | undefined;
  let installUrl: string | null = null;
  const which: 'gh' | 'glab' | null =
    platform === 'github' ? 'gh' : platform === 'gitlab' ? 'glab' : null;
  let probe: MrCliStatus | undefined;
  if (which) {
    probe = await probeMrCli(which, { cwd: options.cwd });
    if (probe.loggedIn) cli = which;
    else {
      cliError = probe.error;
      messages.push(probe.error ?? cliMissingHint(which));
      if (!probe.found) installUrl = probe.installUrl;
    }
  }
  let candidates: MrCandidate[] = [];
  try {
    candidates = await listMrCandidates({
      platform,
      remoteUrl: options.prep.remoteUrl,
      token: tokenForRemote(options.mr, options.prep.remoteUrl),
      apiBaseUrl: apiBaseForRemote(options.mr, options.prep.remoteUrl),
      cwd: options.cwd
    });
  } catch {
    candidates = [];
  }
  return {
    ...options.prep,
    platform,
    cli,
    cliError,
    cliInstallUrl: installUrl,
    candidates,
    messages
  };
}

export async function createPullOrMergeRequest(options: {
  prep: PrepareMrResult;
  mr: MrConfig;
  cwd: string;
  title?: string;
  body?: string;
  reviewers?: string[];
  dryRun?: boolean;
}): Promise<CreateMrResult | { dryRun: true; command: string; args: string[]; risk: 'medium'; note: string }> {
  const platform = resolveMrPlatform(options.prep.platform, options.prep.remoteUrl, options.mr);
  const method: MrMethod = methodForRepo(options.mr, options.cwd);
  const title = (options.title ?? '').trim() || options.prep.title;
  const body = options.body ?? '';
  const reviewers = [...new Set((options.reviewers ?? []).map((r) => r.trim()).filter(Boolean))];
  const token = tokenForRemote(options.mr, options.prep.remoteUrl);
  const apiBaseUrl = apiBaseForRemote(options.mr, options.prep.remoteUrl);
  const host = hostnameOf(options.prep.remoteUrl);
  const which: 'gh' | 'glab' | null =
    platform === 'github' ? 'gh' : platform === 'gitlab' ? 'glab' : null;
  const probe = which ? await probeMrCli(which, { cwd: options.cwd }) : null;

  let via: CreateMrResult['via'] = 'browser';
  if (method === 'browser') via = 'browser';
  else if (method === 'token') {
    if (!token) {
      throw new GitOperationError(
        host ? `未配置 ${host} 的 Token（设置 → MR 配置）` : '未配置该远程的 Token（设置 → MR 配置）',
        'NO_TOKEN'
      );
    }
    via = 'token';
  } else if (method === 'cli') {
    if (!which) {
      throw new GitOperationError('无法识别远程平台（GitHub / GitLab）', 'UNKNOWN_PLATFORM');
    }
    if (!probe?.found) {
      throw new GitOperationError(cliMissingHint(which), 'CLI_UNAVAILABLE');
    }
    if (!probe.loggedIn) {
      throw new GitOperationError(probe.error ?? `${which} 未登录`, 'CLI_UNAVAILABLE');
    }
    via = which;
  } else {
    via = 'browser';
  }

  if (options.dryRun) {
    const note =
      via === 'token'
        ? `将用设置中的 Token 创建 ${platform === 'gitlab' ? 'MR' : 'PR'}：${options.prep.sourceBranch} → ${options.prep.targetBranch}`
        : via === 'gh'
          ? `将调用本机 gh pr create：${options.prep.sourceBranch} → ${options.prep.targetBranch}`
          : via === 'glab'
            ? `将调用本机 glab mr create：${options.prep.sourceBranch} → ${options.prep.targetBranch}`
            : '确认后仅返回浏览器创建页 URL，不会调用 Token / CLI。';
    return {
      dryRun: true,
      command:
        via === 'token'
          ? `POST ${platform === 'gitlab' ? 'gitlab merge_requests' : 'github pulls'}`
          : via === 'gh'
            ? 'gh pr create'
            : via === 'glab'
              ? 'glab mr create'
              : `open ${options.prep.createMrUrl ?? ''}`,
      args: [options.prep.sourceBranch, options.prep.targetBranch],
      risk: 'medium',
      note
    };
  }

  const messages: string[] = [];
  const installUrl = which ? cliInstallUrl(which) : null;

  if (via === 'browser') {
    if (probe && !probe.found) {
      messages.push(probe.error ?? cliMissingHint(which!));
    }
    messages.push('未调用 Token / CLI，请用浏览器打开创建页。');
    return {
      via: 'browser',
      url: options.prep.createMrUrl,
      sourceBranch: options.prep.sourceBranch,
      targetBranch: options.prep.targetBranch,
      title,
      messages,
      cliInstallUrl: probe && !probe.found ? installUrl : null
    };
  }

  if (via === 'token') {
    if (platform === 'gitlab') {
      const created = await createGitlabMergeRequest({
        remoteUrl: options.prep.remoteUrl,
        token,
        sourceBranch: options.prep.sourceBranch,
        targetBranch: options.prep.targetBranch,
        title,
        body,
        reviewers,
        apiBaseUrl
      });
      messages.push('已用 GitLab Token 创建 MR');
      messages.push(...created.warnings);
      return {
        via: 'token',
        url: created.url,
        sourceBranch: options.prep.sourceBranch,
        targetBranch: options.prep.targetBranch,
        title,
        messages
      };
    }
    const pr = await createGithubPullRequest({
      remoteUrl: options.prep.remoteUrl,
      token,
      sourceBranch: options.prep.sourceBranch,
      targetBranch: options.prep.targetBranch,
      title,
      body,
      reviewers,
      apiBaseUrl
    });
    messages.push(`已创建 PR #${pr.number}`);
    return {
      via: 'token',
      url: pr.url,
      number: pr.number,
      sourceBranch: options.prep.sourceBranch,
      targetBranch: options.prep.targetBranch,
      title,
      messages
    };
  }

  if (via === 'gh') {
    const args = [
      'pr',
      'create',
      '--base',
      options.prep.targetBranch,
      '--head',
      options.prep.sourceBranch,
      '--title',
      title,
      '--body',
      body
    ];
    if (reviewers.length) {
      args.push('--assignee', reviewers.join(','), '--reviewer', reviewers.join(','));
    }
    const run = await runMrCli('gh', args, options.cwd);
    if (run.code !== 0) {
      throw new GitOperationError(`gh pr create 失败：${(run.stderr || run.stdout).trim()}`, 'CREATE_MR_FAILED');
    }
    const prUrl = (run.stdout.trim().split('\n').filter(Boolean).pop() ?? '').trim();
    messages.push('已用本机 gh 创建 PR');
    return {
      via: 'gh',
      url: prUrl || options.prep.createMrUrl,
      sourceBranch: options.prep.sourceBranch,
      targetBranch: options.prep.targetBranch,
      title,
      messages
    };
  }

  const args = [
    'mr',
    'create',
    '--source-branch',
    options.prep.sourceBranch,
    '--target-branch',
    options.prep.targetBranch,
    '--title',
    title,
    '--description',
    body,
    '--yes'
  ];
  for (const r of reviewers) {
    args.push('--assignee', r, '--reviewer', r);
  }
  const run = await runMrCli('glab', args, options.cwd);
  if (run.code !== 0) {
    throw new GitOperationError(`glab mr create 失败：${(run.stderr || run.stdout).trim()}`, 'CREATE_MR_FAILED');
  }
  const mrUrl = run.stdout.match(/https?:\/\/\S+/)?.[0] ?? options.prep.createMrUrl;
  messages.push('已用本机 glab 创建 MR');
  return {
    via: 'glab',
    url: mrUrl,
    sourceBranch: options.prep.sourceBranch,
    targetBranch: options.prep.targetBranch,
    title,
    messages
  };
}
