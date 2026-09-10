import { ElNotification } from 'element-plus';
import type { Router } from 'vue-router';
import type { JobKind, JobProgressPayload, JobStatus } from '@/api/types';

const ended = new Set<string>();

export function kindLabel(kind: JobKind | string): string {
  if (kind === 'clone') return '克隆';
  if (kind === 'survey') return '矩阵扫描';
  if (kind === 'fetch') return '抓取';
  return kind;
}

/** 任务列表主行：克隆看地址→目录，抓取/扫描看操作→仓库路径。 */
export function jobLine(j: {
  kind?: string;
  title?: string;
  url?: string;
  destDir?: string;
  repoPath?: string;
  id?: string;
}): string {
  if (j.kind === 'clone') {
    return [j.url, j.destDir ? `→ ${j.destDir}` : ''].filter(Boolean).join(' ');
  }
  const title = j.title?.trim() || '';
  const repo = j.repoPath?.trim() || '';
  if (repo && title && !title.includes(repo)) return `${title} → ${repo}`;
  return title || repo || j.id || '';
}

export function statusLabel(status: JobStatus | string): string {
  if (status === 'running') return '进行中';
  if (status === 'ok') return '成功';
  if (status === 'error') return '失败';
  return status;
}

export function statusTag(status: JobStatus | string): 'success' | 'danger' | 'warning' {
  if (status === 'ok') return 'success';
  if (status === 'error') return 'danger';
  return 'warning';
}

export function notifyJobStarted(opts: { id: string; kind: JobKind | string; title: string; router: Router }): void {
  ElNotification({
    type: 'info',
    title: `已开始${kindLabel(opts.kind)}`,
    message: opts.title,
    position: 'top-right',
    duration: 4500,
    onClick: () => void opts.router.push({ path: '/jobs', query: { id: opts.id } })
  });
}

export function notifyJobEnded(payload: JobProgressPayload, router: Router): void {
  if (payload.status !== 'ok' && payload.status !== 'error') return;
  const key = `${payload.id}:${payload.status}`;
  if (ended.has(key)) return;
  ended.add(key);
  const label = kindLabel(payload.kind);
  const title = jobLine(payload);
  ElNotification({
    type: payload.status === 'ok' ? 'success' : 'error',
    title: payload.status === 'ok' ? `${label}完成` : `${label}失败`,
    message: payload.status === 'ok' ? title : payload.error || title,
    position: 'top-right',
    duration: 6000,
    onClick: () => void router.push({ path: '/jobs', query: { id: payload.id } })
  });
}
