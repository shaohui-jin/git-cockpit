import { defineStore } from 'pinia';
import * as api from '@/api/client';
import type { MrCurrentHost, MrSettings, PermissionsPayload, RemoteInfo, ToolSummary } from '@/api/types';

interface State {
  permissions: PermissionsPayload | null;
  tools: ToolSummary[];
  mr: MrSettings | null;
  loading: boolean;
  saving: boolean;
  error: string | null;
}

const emptyMr = (): MrSettings => ({
  method: 'browser',
  defaultRemote: 'origin',
  remotes: [],
  current: null,
  hosts: [],
  cli: {
    gh: { name: 'gh', found: false, loggedIn: false, installUrl: 'https://cli.github.com/' },
    glab: { name: 'glab', found: false, loggedIn: false, installUrl: 'https://gitlab.com/gitlab-org/cli/-/releases' }
  }
});

/** 与 core `toHttpsRemoteUrl` 同规则：仅用于从 remote URL 识别 host / 平台 */
function toHttpsRemoteUrl(remoteUrl: string): string | null {
  let url = remoteUrl.trim();
  if (!url) return null;
  if (url.startsWith('git@')) {
    const m = url.match(/^git@([^:]+):(.+?)(?:\.git)?$/);
    if (!m) return null;
    url = `https://${m[1]}/${m[2]}`;
  } else if (url.startsWith('ssh://git@')) {
    url = url.replace(/^ssh:\/\/git@/, 'https://').replace(/\.git$/, '');
  } else {
    url = url.replace(/\.git$/, '');
  }
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname.replace(/\/+$/, '')}`;
  } catch {
    return null;
  }
}

function hostnameOf(remoteUrl: string): string | null {
  const https = toHttpsRemoteUrl(remoteUrl);
  if (!https) return null;
  try {
    const h = new URL(https).hostname.toLowerCase();
    return h === 'www.github.com' ? 'github.com' : h;
  } catch {
    return null;
  }
}

function detectPlatform(remoteUrl: string): MrCurrentHost['platform'] {
  if (!toHttpsRemoteUrl(remoteUrl)) return 'unknown';
  const host = hostnameOf(remoteUrl);
  if (!host) return 'unknown';
  if (host === 'github.com' || host.endsWith('.github.com')) return 'github';
  return 'gitlab';
}

function pickRemote(remotes: RemoteInfo[], preferred?: string): RemoteInfo | null {
  if (!remotes.length) return null;
  const name = preferred?.trim();
  if (name) {
    const hit = remotes.find((r) => r.name === name);
    if (hit) return hit;
  }
  return remotes.find((r) => r.name === 'origin') ?? remotes[0] ?? null;
}

function deriveCurrent(mr: MrSettings): MrCurrentHost | null {
  const hit = pickRemote(mr.remotes, mr.defaultRemote);
  if (!hit) return null;
  const remoteUrl = (hit.pushUrl || hit.fetchUrl || '').trim();
  const host = remoteUrl ? hostnameOf(remoteUrl) : null;
  const profile = host ? mr.hosts.find((h) => h.host === host) : undefined;
  let origin: string | null = null;
  const https = remoteUrl ? toHttpsRemoteUrl(remoteUrl) : null;
  if (https) {
    try {
      origin = new URL(https).origin;
    } catch {
      origin = null;
    }
  }
  return {
    host,
    origin,
    platform: profile?.platform ?? (remoteUrl ? detectPlatform(remoteUrl) : 'unknown'),
    remote: hit.name,
    remoteUrl,
    tokenSet: Boolean(profile?.tokenSet),
    tokenPreview:
      (mr.current?.host === host ? (mr.current.tokenPreview ?? '') : '') || profile?.tokenPreview || '',
    tokenStatus: mr.current?.host === host ? (mr.current.tokenStatus ?? null) : null,
    apiBaseUrl: profile?.apiBaseUrl ?? ''
  };
}

function normalizeMr(raw: Partial<MrSettings> | null | undefined): MrSettings {
  const base = emptyMr();
  if (!raw) return base;
  return {
    method: raw.method === 'cli' || raw.method === 'token' || raw.method === 'browser' ? raw.method : base.method,
    defaultRemote: raw.defaultRemote ?? base.defaultRemote,
    remotes: raw.remotes ?? [],
    current: raw.current ?? null,
    hosts: raw.hosts ?? [],
    cli: {
      gh: { ...base.cli.gh, ...raw.cli?.gh },
      glab: { ...base.cli.glab, ...raw.cli?.glab }
    }
  };
}

function attachRepoRemotes(mr: MrSettings, remotes: RemoteInfo[]): MrSettings {
  const next: MrSettings = { ...mr, remotes: remotes.length ? remotes : mr.remotes };
  next.current = deriveCurrent(next) ?? next.current;
  return next;
}

/** 权限/设置：工具开关、审批规则、MR 配置 */
export const useSettingsStore = defineStore('settings', {
  state: (): State => ({
    permissions: null,
    tools: [],
    mr: null,
    loading: false,
    saving: false,
    error: null
  }),
  actions: {
    async load(repoId?: number | null, opts?: { validateToken?: boolean }): Promise<void> {
      this.loading = true;
      this.error = null;
      try {
        const [data, remotes] = await Promise.all([
          api.getSettings(repoId, opts),
          repoId != null ? api.listRemotes(repoId).catch(() => [] as RemoteInfo[]) : Promise.resolve([] as RemoteInfo[])
        ]);
        this.permissions = data.permissions;
        this.tools = data.tools;
        this.mr = attachRepoRemotes(normalizeMr(data.mr), remotes);
      } catch (err) {
        this.error = err instanceof Error ? err.message : String(err);
      } finally {
        this.loading = false;
      }
    },
    async save(body: Parameters<typeof api.updateSettings>[0], repoId?: number | null): Promise<void> {
      this.saving = true;
      this.error = null;
      try {
        const prevRemotes = this.mr?.remotes ?? [];
        const res = await api.updateSettings(body, repoId);
        if (body.permissions && this.permissions) {
          this.permissions = { ...this.permissions, ...body.permissions };
        }
        if (res.mr) {
          const incoming = normalizeMr(res.mr);
          this.mr = attachRepoRemotes(incoming, incoming.remotes.length ? incoming.remotes : prevRemotes);
        }
      } catch (err) {
        this.error = err instanceof Error ? err.message : String(err);
        throw err;
      } finally {
        this.saving = false;
      }
    }
  }
});
