/**
 * 后端 REST API 客户端（fetch 封装）。
 * 统一处理：JSON 序列化、错误体解析、403/400/401 等状态的语义化。
 */
import type {
  BranchInfo,
  CommitInfo,
  DiffResult,
  GraphData,
  HealthInfo,
  LogEntry,
  MrSettings,
  OpenedRepo,
  PermissionsPayload,
  RemoteInfo,
  RepoStatus,
  SettingsData,
  StashInfo,
  TagInfo,
  ToolExecResult,
  ToolSummary
} from './types';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly requiredApproval?: boolean
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
  } catch (err) {
    throw new ApiError(`无法连接后端服务（${url}）：${err instanceof Error ? err.message : String(err)}`, 0);
  }

  if (!res.ok) {
    let message = res.statusText;
    let code: string | undefined;
    let requiredApproval: boolean | undefined;
    try {
      const data = (await res.json()) as {
        error?: string | { code?: string; message?: string; requiredApproval?: boolean };
        code?: string;
        message?: string;
        requiredApproval?: boolean;
      };
      // 错误体两种形态：平铺 { error, code }（tools 接口）与嵌套 { error: { code, message } }（withRepo 查询接口）
      if (typeof data.error === 'string') {
        message = data.error;
        code = data.code;
        requiredApproval = data.requiredApproval;
      } else if (data.error && typeof data.error === 'object') {
        message = data.error.message ?? message;
        code = data.error.code ?? data.code;
        requiredApproval = data.error.requiredApproval ?? data.requiredApproval;
      } else if (data.message) {
        message = data.message;
        code = data.code;
        requiredApproval = data.requiredApproval;
      }
    } catch {
      /* 非 JSON 响应 */
    }
    throw new ApiError(message, res.status, code, requiredApproval);
  }
  return (await res.json()) as T;
}

/** 打开仓库列表 */
export function listRepos(): Promise<{ repos: OpenedRepo[] }> {
  return request('GET', '/api/repos');
}

/** 打开一个本地仓库 */
export function openRepo(path: string): Promise<{ repo: OpenedRepo }> {
  return request('POST', '/api/repos/open', { path });
}

/** 激活/进入仓库：后端刷新最近打开排序并记录操作日志 */
export function activateRepo(id: number): Promise<{ repo: OpenedRepo }> {
  return request('POST', `/api/repos/${id}/activate`);
}

/** 关闭并移除仓库记录 */
export function removeRepo(id: number): Promise<{ ok: boolean }> {
  return request('DELETE', `/api/repos/${id}`);
}

export function getStatus(id: number): Promise<RepoStatus> {
  return request('GET', `/api/repos/${id}/status`);
}

export function getLog(
  id: number,
  opts: { maxCount?: number; all?: boolean; path?: string; from?: string; to?: string; author?: string } = {}
): Promise<CommitInfo[]> {
  const q = new URLSearchParams();
  if (opts.maxCount) q.set('maxCount', String(opts.maxCount));
  if (opts.all) q.set('all', 'true');
  if (opts.path) q.set('path', opts.path);
  if (opts.from) q.set('from', opts.from);
  if (opts.to) q.set('to', opts.to);
  if (opts.author) q.set('author', opts.author);
  const qs = q.toString();
  return request('GET', `/api/repos/${id}/log${qs ? `?${qs}` : ''}`);
}

export function getDiff(
  id: number,
  opts: { from?: string; to?: string; path?: string; staged?: boolean } = {}
): Promise<DiffResult> {
  const q = new URLSearchParams();
  if (opts.from) q.set('from', opts.from);
  if (opts.to) q.set('to', opts.to);
  if (opts.path) q.set('path', opts.path);
  if (opts.staged) q.set('staged', 'true');
  const qs = q.toString();
  return request('GET', `/api/repos/${id}/diff${qs ? `?${qs}` : ''}`);
}

export function getShow(id: number, commit: string): Promise<{ commit: CommitInfo; diff: DiffResult }> {
  return request('GET', `/api/repos/${id}/show/${encodeURIComponent(commit)}`);
}

export function listBranches(id: number): Promise<{ branches: BranchInfo[]; current: string | null }> {
  return request('GET', `/api/repos/${id}/branches`);
}

export function listStashes(id: number): Promise<StashInfo[]> {
  return request('GET', `/api/repos/${id}/stashes`);
}

export function listTags(id: number): Promise<TagInfo[]> {
  return request('GET', `/api/repos/${id}/tags`);
}

export function listRemotes(id: number): Promise<RemoteInfo[]> {
  return request('GET', `/api/repos/${id}/remotes`);
}

export function getGraph(id: number, maxCount = 500): Promise<GraphData> {
  return request('GET', `/api/repos/${id}/graph?maxCount=${maxCount}`);
}

export function getFileContent(id: number, commit: string, path: string): Promise<{ content: string; truncated: boolean }> {
  return request('GET', `/api/repos/${id}/file?commit=${encodeURIComponent(commit)}&path=${encodeURIComponent(path)}`);
}

/** 通用写操作入口（复用后端安全链路：权限/dry-run/备份/审计） */
export function runTool(
  id: number,
  tool: string,
  params: Record<string, unknown> = {}
): Promise<ToolExecResult> {
  return request('POST', `/api/repos/${id}/tools/${tool}`, { params });
}

export function listTools(): Promise<{ tools: ToolSummary[] }> {
  return request('GET', '/api/tools');
}

export function listLogs(opts: { limit?: number; tool?: string } = {}): Promise<{ logs: LogEntry[] }> {
  const q = new URLSearchParams();
  if (opts.limit) q.set('limit', String(opts.limit));
  if (opts.tool) q.set('tool', opts.tool);
  const qs = q.toString();
  return request('GET', `/api/logs${qs ? `?${qs}` : ''}`);
}

export function getSettings(repoId?: number | null, opts?: { validateToken?: boolean }): Promise<SettingsData> {
  const q = new URLSearchParams();
  if (repoId != null) q.set('repoId', String(repoId));
  if (opts?.validateToken) q.set('validateToken', '1');
  const qs = q.toString();
  return request('GET', `/api/settings${qs ? `?${qs}` : ''}`);
}

export function updateSettings(
  body: {
    permissions?: Partial<PermissionsPayload>;
    mr?: {
      method?: MrSettings['method'];
      defaultRemote?: string;
      upsertHost?: {
        host: string;
        platform?: 'github' | 'gitlab';
        token?: string;
        apiBaseUrl?: string;
      };
      deleteHost?: string;
    };
  },
  repoId?: number | null
): Promise<{ ok: boolean; mr?: MrSettings }> {
  const q = repoId != null ? `?repoId=${repoId}` : '';
  return request('PUT', `/api/settings${q}`, body);
}

export function getHealth(): Promise<HealthInfo> {
  return request('GET', '/api/health');
}

/** SSE：订阅仓库变化事件。返回取消函数。 */
export function subscribeEvents(handlers: {
  onRepoChanged?: (payload: { repoPath: string; command: string[]; at: string }) => void;
  onLog?: () => void;
  onError?: (err: Event) => void;
}): () => void {
  const es = new EventSource('/api/events');
  if (handlers.onRepoChanged) es.addEventListener('repo-changed', (e) => handlers.onRepoChanged?.(JSON.parse((e as MessageEvent).data)));
  if (handlers.onLog) es.addEventListener('log', () => handlers.onLog?.());
  if (handlers.onError) es.onerror = (e) => handlers.onError?.(e);
  return () => es.close();
}