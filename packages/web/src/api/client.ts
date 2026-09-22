/**
 * 后端 REST API 客户端（fetch 封装）。
 * 统一处理：JSON 序列化、错误体解析、403/400/401 等状态的语义化。
 */
import type {
  BranchGraph,
  BranchInfo,
  BackupList,
  CloneJobDetail,
  CloneJobSummary,
  CommitInfo,
  DiffResult,
  GraphData,
  HealthInfo,
  JobProgressPayload,
  LogEntry,
  MrSettings,
  MrTemplate,
  OpenedRepo,
  PermissionsPayload,
  PublicLlmConfig,
  ReflogEntry,
  RemoteInfo,
  RepoOverview,
  RepoStatus,
  SettingsData,
  StashInfo,
  TagInfo,
  ToolExecResult,
  ToolSummary,
  WorktreeInfo,
  WorkspaceConflicts,
  MergePreviewResult,
  MergeSurveyResult,
  SuggestOrderResult,
  PrepareMrResult,
  ConflictBlameResult
} from './types';

/** 后端 DiffResult 把 +/- 放在 stats 里，前端类型是平铺字段 */
type DiffPayload = DiffResult & { stats?: { insertions?: number; deletions?: number } };

function normalizeDiff(d: DiffPayload): DiffResult {
  return {
    ...d,
    insertions: d.insertions ?? d.stats?.insertions ?? 0,
    deletions: d.deletions ?? d.stats?.deletions ?? 0
  };
}

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

let secretPromise: Promise<string> | null = null;

function loadSecret(): Promise<string> {
  if (!secretPromise) {
    secretPromise = fetch('/api/bootstrap')
      .then(async (res) => {
        if (!res.ok) return '';
        const body = (await res.json()) as { secret?: string };
        return typeof body.secret === 'string' ? body.secret : '';
      })
      .catch(() => '');
  }
  return secretPromise;
}

export async function getBootstrap(): Promise<{ secret: string }> {
  return { secret: await loadSecret() };
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  let res: Response;
  const secret = await loadSecret();
  const headers: Record<string, string> = {};
  if (secret) headers['X-Git-Cockpit-Secret'] = secret;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  try {
    res = await fetch(url, {
      method,
      headers: Object.keys(headers).length ? headers : undefined,
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

export function listOverview(): Promise<{ repos: RepoOverview[] }> {
  return request('GET', '/api/repos/overview');
}

/** 打开一个本地仓库 */
export function openRepo(path: string): Promise<{ repo: OpenedRepo }> {
  return request('POST', '/api/repos/open', { path });
}

/** 激活/进入仓库：刷新最近打开时间，不改卡片顺序 */
export function activateRepo(id: number): Promise<{ repo: OpenedRepo }> {
  return request('POST', `/api/repos/${id}/activate`);
}

export function reorderRepos(ids: number[]): Promise<{ repos: OpenedRepo[] }> {
  return request('PUT', '/api/repos/order', { ids });
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
  return request<DiffPayload>('GET', `/api/repos/${id}/diff${qs ? `?${qs}` : ''}`).then(normalizeDiff);
}

export function getShow(id: number, commit: string): Promise<{ commit: CommitInfo; diff: DiffResult }> {
  return request<{ commit: CommitInfo; diff: DiffPayload }>(
    'GET',
    `/api/repos/${id}/show/${encodeURIComponent(commit)}`
  ).then((r) => ({ ...r, diff: normalizeDiff(r.diff) }));
}

export function listBranches(id: number): Promise<{ branches: BranchInfo[]; current: string | null }> {
  return request('GET', `/api/repos/${id}/branches`);
}

export function listStashes(id: number): Promise<StashInfo[]> {
  return request('GET', `/api/repos/${id}/stashes`);
}

export function listWorktrees(id: number): Promise<{ worktrees: WorktreeInfo[] }> {
  return request('GET', `/api/repos/${id}/worktrees`);
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

export function getBranchGraph(
  id: number,
  opts: { maxNodes?: number; into?: string; from?: string } = {}
): Promise<BranchGraph> {
  const q = new URLSearchParams();
  q.set('maxNodes', String(opts.maxNodes ?? 200));
  if (opts.into) q.set('into', opts.into);
  if (opts.from) q.set('from', opts.from);
  return request('GET', `/api/repos/${id}/branch-graph?${q.toString()}`);
}

export function getWorkspaceConflicts(id: number): Promise<WorkspaceConflicts> {
  return request('GET', `/api/repos/${id}/workspace-conflicts`);
}

export function mergePreview(
  id: number,
  opts: { into: string; from: string; fetch?: boolean; remote?: string; path?: string }
): Promise<MergePreviewResult> {
  const q = new URLSearchParams();
  q.set('into', opts.into);
  q.set('from', opts.from);
  if (opts.fetch !== undefined) q.set('fetch', opts.fetch ? 'true' : 'false');
  if (opts.remote) q.set('remote', opts.remote);
  if (opts.path) q.set('path', opts.path);
  return request('GET', `/api/repos/${id}/merge/preview?${q.toString()}`);
}

export function mergeRehearse(
  id: number,
  opts: { into: string; from: string; fetch?: boolean; remote?: string; path?: string; maxFiles?: number }
): Promise<MergePreviewResult> {
  const q = new URLSearchParams();
  q.set('into', opts.into);
  q.set('from', opts.from);
  if (opts.fetch !== undefined) q.set('fetch', opts.fetch ? 'true' : 'false');
  if (opts.remote) q.set('remote', opts.remote);
  if (opts.path) q.set('path', opts.path);
  if (opts.maxFiles) q.set('maxFiles', String(opts.maxFiles));
  return request('GET', `/api/repos/${id}/merge/rehearse?${q.toString()}`);
}

export function mergeBlame(
  id: number,
  opts: { into: string; from: string; path: string; fetch?: boolean; remote?: string }
): Promise<ConflictBlameResult> {
  const q = new URLSearchParams();
  q.set('into', opts.into);
  q.set('from', opts.from);
  q.set('path', opts.path);
  if (opts.fetch !== undefined) q.set('fetch', opts.fetch ? 'true' : 'false');
  if (opts.remote) q.set('remote', opts.remote);
  return request('GET', `/api/repos/${id}/merge/blame?${q.toString()}`);
}

export function mergeSurvey(
  id: number,
  opts: { intos: string[]; froms: string[]; fetch?: boolean; remote?: string }
): Promise<MergeSurveyResult> {
  const q = new URLSearchParams();
  for (const x of opts.intos) q.append('intos', x);
  for (const x of opts.froms) q.append('froms', x);
  if (opts.fetch !== undefined) q.set('fetch', opts.fetch ? 'true' : 'false');
  if (opts.remote) q.set('remote', opts.remote);
  return request('GET', `/api/repos/${id}/merge/survey?${q.toString()}`);
}

export function mergeOrder(
  id: number,
  opts: { into: string; branches: string[]; fetch?: boolean; remote?: string }
): Promise<SuggestOrderResult> {
  const q = new URLSearchParams();
  q.set('into', opts.into);
  for (const b of opts.branches) q.append('branches', b);
  if (opts.fetch !== undefined) q.set('fetch', opts.fetch ? 'true' : 'false');
  if (opts.remote) q.set('remote', opts.remote);
  return request('GET', `/api/repos/${id}/merge/order?${q.toString()}`);
}

export function mrPrepare(
  id: number,
  opts: { into: string; from: string; remote?: string; sourceBranch?: string }
): Promise<PrepareMrResult> {
  const q = new URLSearchParams();
  q.set('into', opts.into);
  q.set('from', opts.from);
  if (opts.remote) q.set('remote', opts.remote);
  if (opts.sourceBranch) q.set('sourceBranch', opts.sourceBranch);
  return request('GET', `/api/repos/${id}/mr/prepare?${q.toString()}`);
}

export function getReflog(id: number, maxCount = 50): Promise<ReflogEntry[]> {
  return request('GET', `/api/repos/${id}/reflog?maxCount=${maxCount}`);
}

export function listBackups(id: number): Promise<BackupList> {
  return request('GET', `/api/repos/${id}/backups`);
}

export function listJobs(): Promise<{ jobs: CloneJobSummary[] }> {
  return request('GET', '/api/jobs');
}

export function getJob(id: string): Promise<{ job: CloneJobDetail }> {
  return request('GET', `/api/jobs/${encodeURIComponent(id)}`);
}

export function startClone(url: string, destDir: string): Promise<{ job: CloneJobSummary }> {
  return request('POST', '/api/jobs/clone', { url, destDir });
}

export function startJob(
  kind: 'clone' | 'survey' | 'fetch',
  opts: { repoId?: number; repoPath?: string; payload?: Record<string, unknown> } = {}
): Promise<{ job: CloneJobSummary }> {
  return request('POST', '/api/jobs', {
    kind,
    repoId: opts.repoId,
    repoPath: opts.repoPath,
    payload: opts.payload ?? {}
  });
}

export function cancelClone(id: string): Promise<{ job: CloneJobSummary }> {
  return request('POST', `/api/jobs/${encodeURIComponent(id)}/cancel`);
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
    git?: { allowedRepos?: string[] };
    llm?: {
      provider?: PublicLlmConfig['provider'];
      model?: string;
      baseUrl?: string;
      apiKey?: string;
      clearKey?: boolean;
    };
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
      template?: MrSettings['template'];
    };
  },
  repoId?: number | null
): Promise<{ ok: boolean; mr?: MrSettings; llm?: PublicLlmConfig }> {
  const q = repoId != null ? `?repoId=${repoId}` : '';
  return request('PUT', `/api/settings${q}`, body);
}

export function parseMrTemplate(
  markdown: string,
  filename?: string
): Promise<{ template: MrTemplate; preview: string }> {
  return request('POST', '/api/settings/mr-template/parse', { markdown, filename });
}

export function previewMrTemplate(
  template: MrTemplate,
  values?: Record<string, unknown>
): Promise<{ preview: string }> {
  return request('POST', '/api/settings/mr-template/preview', { template, values });
}

export function getHealth(): Promise<HealthInfo> {
  return request('GET', '/api/health');
}

export interface ChatSseHandlers {
  onDelta?: (text: string) => void;
  onConfirm?: (payload: { token: string; tool: string; preview: { command: string; affectedFiles: string[]; args?: string[]; note?: string } }) => void;
  onTool?: (payload: { tool: string; success: boolean }) => void;
  onError?: (message: string) => void;
  onDone?: () => void;
}

export async function streamChat(
  body: { messages: Array<{ role: 'user' | 'assistant'; content: string }>; repoPath: string; sessionId: string },
  handlers: ChatSseHandlers,
  signal?: AbortSignal
): Promise<void> {
  const secret = await loadSecret();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'text/event-stream'
  };
  if (secret) headers['X-Git-Cockpit-Secret'] = secret;
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const j = (await res.json()) as { error?: string };
      if (j.error) msg = j.error;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  const reader = res.body?.getReader();
  if (!reader) throw new Error('无法读取对话流');
  const decoder = new TextDecoder();
  let buf = '';
  let event = 'message';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const parts = buf.split('\n');
    buf = parts.pop() ?? '';
    for (const line of parts) {
      if (line.startsWith('event:')) {
        event = line.slice(6).trim();
        continue;
      }
      if (line.startsWith('data:')) {
        const raw = line.slice(5).trim();
        if (!raw) continue;
        let data: unknown = raw;
        try {
          data = JSON.parse(raw);
        } catch {
          /* keep string */
        }
        if (event === 'delta' && data && typeof data === 'object' && 'text' in data) {
          handlers.onDelta?.(String((data as { text: string }).text));
        } else if (event === 'confirm' && data && typeof data === 'object') {
          handlers.onConfirm?.(data as { token: string; tool: string; preview: { command: string; affectedFiles: string[] } });
        } else if (event === 'tool' && data && typeof data === 'object') {
          handlers.onTool?.(data as { tool: string; success: boolean });
        } else if (event === 'error' && data && typeof data === 'object' && 'error' in data) {
          handlers.onError?.(String((data as { error: string }).error));
        } else if (event === 'done') {
          handlers.onDone?.();
        }
        event = 'message';
      }
    }
  }
  handlers.onDone?.();
}

export function confirmChat(
  token: string,
  opts?: { cancel?: boolean }
): Promise<{
  ok: boolean;
  error?: string;
  tool?: string;
  preview?: { command: string; affectedFiles: string[] };
}> {
  return request('POST', '/api/chat/confirm', { token, cancel: Boolean(opts?.cancel) });
}

/** SSE：订阅仓库变化事件。返回取消函数。 */
export function subscribeEvents(handlers: {
  onRepoChanged?: (payload: { repoPath: string; command: string[]; at: string }) => void;
  onLog?: () => void;
  onJobProgress?: (payload: JobProgressPayload) => void;
  onError?: (err: Event) => void;
}): () => void {
  const es = new EventSource('/api/events');
  if (handlers.onRepoChanged) es.addEventListener('repo-changed', (e) => handlers.onRepoChanged?.(JSON.parse((e as MessageEvent).data)));
  if (handlers.onLog) es.addEventListener('log', () => handlers.onLog?.());
  if (handlers.onJobProgress) {
    es.addEventListener('job-progress', (e) => handlers.onJobProgress?.(JSON.parse((e as MessageEvent).data)));
  }
  if (handlers.onError) es.onerror = (e) => handlers.onError?.(e);
  return () => es.close();
}