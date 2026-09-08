import { ElNotification } from 'element-plus';
import type { Router } from 'vue-router';
import type { JobKind, JobProgressPayload } from '@/api/types';

const ended = new Set<string>();

export function kindLabel(kind: JobKind | string): string {
  if (kind === 'clone') return '克隆';
  if (kind === 'survey') return '矩阵扫描';
  if (kind === 'fetch') return '抓取';
  return kind;
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
  const title = payload.title || payload.url || payload.repoPath || payload.id;
  ElNotification({
    type: payload.status === 'ok' ? 'success' : 'error',
    title: payload.status === 'ok' ? `${label}完成` : `${label}失败`,
    message: payload.status === 'ok' ? title : payload.error || title,
    position: 'top-right',
    duration: 6000,
    onClick: () => void router.push({ path: '/jobs', query: { id: payload.id } })
  });
}
