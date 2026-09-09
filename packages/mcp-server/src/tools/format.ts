/**
 * MCP 文本输出：默认摘要，正文靠 path / detail。
 * Web REST / executeTool.result 仍是完整对象，不走这里。
 */
import type { ToolExecutionResult } from './handlers.ts';

const FILE_CONTENT_LIMIT = 64 * 1024;

export function wantsDetail(args: Record<string, unknown> | undefined): boolean {
  return args?.detail === true;
}

function hasPath(args: Record<string, unknown> | undefined): boolean {
  return typeof args?.path === 'string' && args.path.trim().length > 0;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stripDiffPatch(diff: unknown): unknown {
  const d = asRecord(diff);
  if (!d || !('rawPatch' in d)) return diff;
  const { rawPatch: _raw, ...rest } = d;
  return { ...rest, detailAvailable: true };
}

function stripRehearseBodies(result: unknown): unknown {
  const r = asRecord(result);
  if (!r) return result;
  const files = Array.isArray(r.conflictFiles) ? r.conflictFiles : [];
  const paths = files.map((f) => {
    const row = asRecord(f);
    return {
      path: row?.path ?? '',
      contentConflict: row?.contentConflict ?? true,
      hunks: []
    };
  });
  const first = typeof paths[0]?.path === 'string' ? paths[0].path : '';
  return {
    ...r,
    conflictFiles: paths,
    detailAvailable: true,
    next: first
      ? [{ tool: 'git_merge_rehearse', args: { into: r.into, from: r.from, path: first } }]
      : []
  };
}

/** 把完整工具结果收成 Agent 默认可消化的形状 */
export function summarizeForAgent(tool: string, result: unknown, args: Record<string, unknown> = {}): unknown {
  if (result == null) return result;
  const detail = wantsDetail(args);
  const pathSet = hasPath(args);

  if (tool === 'git_diff' || tool === 'git_stash_show') {
    if (detail || pathSet) return result;
    return stripDiffPatch(result);
  }
  if (tool === 'git_show') {
    if (detail || pathSet) return result;
    const row = asRecord(result);
    if (!row) return result;
    return { ...row, diff: stripDiffPatch(row.diff) };
  }
  if (tool === 'git_merge_rehearse') {
    if (detail || pathSet) return result;
    return stripRehearseBodies(result);
  }
  if (tool === 'git_repo_overview') {
    if (detail) return result;
    const row = asRecord(result);
    const repos = Array.isArray(row?.repos) ? row.repos : [];
    return {
      ...row,
      repos: repos.map((item) => {
        const rec = asRecord(item);
        if (!rec) return item;
        const { activity: _days, ...rest } = rec;
        return rest;
      })
    };
  }
  if (tool === 'git_file_content') {
    if (detail) return result;
    const row = asRecord(result);
    const content = typeof row?.content === 'string' ? row.content : '';
    const bytes = Buffer.byteLength(content, 'utf8');
    if (bytes <= FILE_CONTENT_LIMIT) return result;
    return {
      path: args.path,
      truncated: true,
      bytes,
      detailAvailable: true
    };
  }
  return result;
}

/** 把干运行/真实结果统一包成 MCP 文本输出 */
export function formatResultForMcp(exec: ToolExecutionResult): string {
  if (!exec.success) {
    const prefix = exec.error?.requiredApproval ? '需要审批' : '操作失败';
    return `${prefix}：${exec.error?.message ?? '未知错误'}`;
  }
  const parts: string[] = [];
  if (exec.dryRun) {
    parts.push('[dry-run 预览] 未实际执行任何操作');
  }
  if (exec.backupCreated) {
    parts.push(
      `[自动备份] 分支 ${exec.backupCreated.branch ?? '(未创建)'}${exec.backupCreated.stashRef ? `，stash ${exec.backupCreated.stashRef}` : ''}`
    );
  }
  const summarized = summarizeForAgent(exec.tool, exec.result, exec.args ?? {});
  const payload = typeof summarized === 'string' ? summarized : JSON.stringify(summarized);
  parts.push(payload);
  return parts.join('\n\n');
}
