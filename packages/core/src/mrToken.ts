/**
 * Token 格式校验 + GitHub/GitLab API 探测。明文不进 GET 响应，只回掩码与校验摘要。
 */
import { gitlabApiRoot, parseGithubRepo } from './mr.ts';
import { describeFetchError, trustSystemCa } from './trustSystemCa.ts';
import type { MrTokenStatus } from './types.ts';

export type { MrTokenStatus };

const GITHUB_PAT =
  /^(ghp_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{22,}|gho_[A-Za-z0-9]{36}|ghu_[A-Za-z0-9]{36}|ghs_[A-Za-z0-9]{36}|ghr_[A-Za-z0-9]{36})$/;
const GITLAB_PAT = /^glpat-[A-Za-z0-9_-]{20,}$/;

export function maskToken(token: string): string {
  const t = token.trim();
  if (!t) return '';
  if (t.length < 8) return '••••';
  let head = t.slice(0, 4);
  if (t.startsWith('github_pat_')) head = 'github_pat_';
  else if (t.startsWith('glpat-')) head = 'glpat-';
  else if (/^gh[pousr]_/i.test(t)) head = t.slice(0, 4);
  return `${head}••••${t.slice(-4)}`;
}

function formatChinaDateTime(input: string): string {
  let ms = Date.parse(input);
  if (Number.isNaN(ms) && /^\d{4}-\d{2}-\d{2}$/.test(input)) {
    ms = Date.parse(`${input}T23:59:59+08:00`);
  }
  if (Number.isNaN(ms)) return input;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).formatToParts(new Date(ms));
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '';
  const hour = get('hour') === '24' ? '00' : get('hour');
  return `${get('year')}/${get('month')}/${get('day')} ${hour}:${get('minute')}:${get('second')}`;
}

function expiryMessage(expiresAt: string | null | undefined, platform: 'github' | 'gitlab'): string | undefined {
  if (expiresAt === undefined) {
    return platform === 'github' ? '有效（未返回有效期）' : '有效（未能读取有效期）';
  }
  if (expiresAt === null) return '永久有效';
  const china = formatChinaDateTime(expiresAt);
  let ms = Date.parse(expiresAt);
  if (Number.isNaN(ms) && /^\d{4}-\d{2}-\d{2}$/.test(expiresAt)) {
    ms = Date.parse(`${expiresAt}T23:59:59+08:00`);
  }
  if (Number.isNaN(ms)) return `有效期 ${china}`;
  const days = Math.floor((ms - Date.now()) / (24 * 60 * 60 * 1000));
  if (days < 0) return `已过期（${china}）`;
  if (days === 0) return `今日到期（${china}）`;
  return `至 ${china}`;
}

function titleStatus(r: Omit<MrTokenStatus, 'titleStatus'>): string {
  const parts = [r.statusLabel];
  if (r.ok && r.login) parts.push(r.login);
  if (!r.ok && r.error) parts.push(r.error);
  else if (r.expiresMessage) parts.push(r.expiresMessage);
  return parts.join(' · ');
}

function fail(statusLabel: string, error: string, extra?: Partial<MrTokenStatus>): MrTokenStatus {
  const base: Omit<MrTokenStatus, 'titleStatus'> = { ok: false, statusLabel, error, ...extra };
  return { ...base, titleStatus: titleStatus(base) };
}

function okStatus(extra: Partial<MrTokenStatus> & { login?: string }): MrTokenStatus {
  const base: Omit<MrTokenStatus, 'titleStatus'> = {
    ok: true,
    statusLabel: '有效',
    ...extra
  };
  return { ...base, titleStatus: titleStatus(base) };
}

export function validateGithubTokenFormat(token: string): { ok: boolean; message: string } {
  const t = token.trim();
  if (!t) return { ok: false, message: '请填写 GitHub Token' };
  if (t.includes(' ') || t.includes('\n')) return { ok: false, message: 'Token 不应包含空格或换行' };
  if (GITHUB_PAT.test(t)) return { ok: true, message: '格式正确' };
  if (/^gh[pousr]_/i.test(t) || /^github_pat_/i.test(t)) {
    return { ok: false, message: '前缀像 GitHub Token，但长度或字符不符，请检查是否复制完整' };
  }
  return { ok: false, message: '格式不符：期望 ghp_… / github_pat_…' };
}

export function validateGitlabTokenFormat(token: string): { ok: boolean; message: string } {
  const t = token.trim();
  if (!t) return { ok: false, message: '请填写 GitLab Token' };
  if (t.includes(' ') || t.includes('\n')) return { ok: false, message: 'Token 不应包含空格或换行' };
  if (/^gh[pousr]_/i.test(t) || /^github_pat_/i.test(t)) {
    return { ok: false, message: '这是 GitHub Token 格式，GitLab 必须使用 glpat- 前缀' };
  }
  if (GITLAB_PAT.test(t)) return { ok: true, message: '格式正确' };
  if (/^glpat-/i.test(t)) return { ok: false, message: '须以 glpat- 开头，且后面至少 20 位' };
  return { ok: false, message: '格式不符：GitLab Token 必须以 glpat- 为前缀' };
}

function githubUserApi(remoteUrl: string, apiBaseUrl = ''): string {
  const custom = apiBaseUrl.trim().replace(/\/+$/, '');
  if (custom) return `${custom}/user`;
  const parsed = remoteUrl ? parseGithubRepo(remoteUrl) : null;
  if (!parsed) return 'https://api.github.com/user';
  try {
    const host = new URL(parsed.origin).hostname.toLowerCase();
    if (host === 'github.com' || host === 'www.github.com') return 'https://api.github.com/user';
    return `${parsed.origin}/api/v3/user`;
  } catch {
    return 'https://api.github.com/user';
  }
}

export async function validateMrToken(options: {
  platform: 'github' | 'gitlab';
  token: string;
  remoteUrl?: string;
  apiBaseUrl?: string;
  /** CLI 登录凭证不一定符合 PAT 格式，跳过格式、只打 API */
  skipFormat?: boolean;
}): Promise<MrTokenStatus> {
  const token = options.token.trim();
  trustSystemCa();
  if (options.platform === 'github') {
    if (!options.skipFormat) {
      const format = validateGithubTokenFormat(token);
      if (!format.ok) return fail('格式错误', format.message);
    } else if (!token) {
      return fail('无效', '未能读取 gh 登录凭证');
    }
    try {
      const res = await fetch(githubUserApi(options.remoteUrl ?? '', options.apiBaseUrl), {
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${token}`,
          'User-Agent': 'git-cockpit',
          'X-GitHub-Api-Version': '2022-11-28'
        }
      });
      const expHeader = res.headers.get('github-authentication-token-expiration');
      let expiresAt: string | null | undefined;
      if (expHeader) {
        const parsed = Date.parse(expHeader);
        expiresAt = Number.isNaN(parsed) ? expHeader : new Date(parsed).toISOString();
      }
      if (res.status === 401 || res.status === 403) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        return fail('无效', body.message || `GitHub 拒绝该 Token（HTTP ${res.status}）`);
      }
      if (!res.ok) return fail('无效', `GitHub API 异常：HTTP ${res.status}`);
      const user = (await res.json()) as { login?: string };
      const expired =
        expiresAt != null && !Number.isNaN(Date.parse(expiresAt)) && Date.parse(expiresAt) < Date.now();
      if (expired) return fail('已过期', 'Token 已过期', { login: user.login, expiresMessage: expiryMessage(expiresAt, 'github') });
      return okStatus({ login: user.login, expiresMessage: expiryMessage(expiresAt, 'github') });
    } catch (err) {
      return fail('无效', `无法连接 GitHub API：${describeFetchError(err)}`);
    }
  }

  if (!options.skipFormat) {
    const format = validateGitlabTokenFormat(token);
    if (!format.ok) return fail('格式错误', format.message);
  } else if (!token) {
    return fail('无效', '未能读取 glab 登录凭证');
  }
  const root = gitlabApiRoot(options.remoteUrl ?? '', options.apiBaseUrl ?? '');
  if (!root) return fail('无效', '无法解析 GitLab 地址，请确认仓库 remote 可访问');
  let headers: Record<string, string> = { 'PRIVATE-TOKEN': token, 'User-Agent': 'git-cockpit' };
  try {
    let res = await fetch(`${root}/user`, { headers });
    if ((res.status === 401 || res.status === 403) && options.skipFormat) {
      headers = { Authorization: `Bearer ${token}`, 'User-Agent': 'git-cockpit' };
      res = await fetch(`${root}/user`, { headers });
    }
    if (res.status === 401 || res.status === 403) {
      const body = (await res.json().catch(() => ({}))) as { message?: string };
      return fail('无效', body.message || `GitLab 拒绝该 Token（HTTP ${res.status}）`);
    }
    if (!res.ok) return fail('无效', `GitLab API 异常：HTTP ${res.status}`);
    const user = (await res.json()) as { username?: string };
    let expiresAt: string | null | undefined;
    try {
      const self = await fetch(`${root}/personal_access_tokens/self`, { headers });
      if (self.ok) {
        const pat = (await self.json()) as { expires_at?: string | null; active?: boolean; revoked?: boolean };
        if (pat.revoked) return fail('无效', 'Token 已被撤销', { login: user.username });
        if (pat.active === false) return fail('无效', 'Token 未处于 active 状态', { login: user.username });
        expiresAt = pat.expires_at === undefined ? null : pat.expires_at;
        if (expiresAt) {
          const end = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(expiresAt) ? `${expiresAt}T23:59:59+08:00` : expiresAt);
          if (!Number.isNaN(end) && end < Date.now()) {
            return fail('已过期', 'Token 已过期', { login: user.username, expiresMessage: expiryMessage(expiresAt, 'gitlab') });
          }
        }
      }
    } catch {
      /* 旧版 GitLab 可能没有 self 接口 */
    }
    return okStatus({ login: user.username, expiresMessage: expiryMessage(expiresAt, 'gitlab') });
  } catch (err) {
    return fail('无效', `无法连接 GitLab API：${describeFetchError(err)}`);
  }
}
