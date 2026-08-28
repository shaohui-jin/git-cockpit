/**
 * GitHub PR（D-lite）：Token REST。不是 git 操作，simple-git 做不了。
 * remote URL 的 ssh→https / owner/repo 解析复用 merge.ts 的 toHttpsRemoteUrl。
 */
import { GitOperationError } from './types.ts';
import { toHttpsRemoteUrl } from './merge.ts';

export interface GithubRepoRef {
  owner: string;
  repo: string;
  origin: string;
}

export function isGithubRemote(remoteUrl: string): boolean {
  const https = toHttpsRemoteUrl(remoteUrl);
  if (!https) return false;
  try {
    const host = new URL(https).hostname.toLowerCase();
    return host === 'github.com' || host === 'www.github.com' || host.endsWith('.github.com');
  } catch {
    return false;
  }
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

/** github.com → api.github.com；其余按 GHES `/api/v3` */
export function githubPullsApiUrl(remoteUrl: string): string | null {
  const parsed = parseGithubRepo(remoteUrl);
  if (!parsed) return null;
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

/** 用 GitHub Token 创建 PR；失败抛 GitOperationError */
export async function createGithubPullRequest(options: {
  remoteUrl: string;
  token: string;
  sourceBranch: string;
  targetBranch: string;
  title: string;
  body?: string;
}): Promise<{ url: string; number: number }> {
  const apiUrl = githubPullsApiUrl(options.remoteUrl);
  if (!apiUrl) {
    throw new GitOperationError('远程不是可识别的 GitHub 仓库', 'NOT_GITHUB');
  }
  const token = options.token.trim();
  if (!token) {
    throw new GitOperationError('未配置 GitHub Token（设置 → MR 配置）', 'NO_TOKEN');
  }
  let json: {
    html_url?: string;
    number?: number;
    message?: string;
    errors?: Array<{ message?: string }>;
  };
  try {
    const res = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'User-Agent': 'git-cockpit',
        'Content-Type': 'application/json'
      },
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
  return { url: json.html_url, number: json.number };
}
