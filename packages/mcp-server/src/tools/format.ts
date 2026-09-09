/**
 * MCP 文本输出：默认摘要，正文靠 path / detail。
 * Web REST / executeTool.result 仍是完整对象，不走这里。
 */
import { suggestNext } from '@shaohui_jin/git-cockpit-core';
import type { ExecutionResult } from '@shaohui_jin/git-cockpit-core';

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
  return {
    ...r,
    conflictFiles: paths,
    detailAvailable: true
  };
}

function attachNext(tool: string, result: unknown, args: Record<string, unknown>, dryRun: boolean): unknown {
  const rec = asRecord(result);
  if (!rec) return result;
  if (Array.isArray(rec.next) && rec.next.length) return result;
  const next = suggestNext(tool, result, args, { dryRun });
  if (!next.length) return result;
  return { ...rec, next };
}

/** 把完整工具结果收成 Agent 默认可消化的形状 */
export function summarizeForAgent(
  tool: string,
  result: unknown,
  args: Record<string, unknown> = {},
  dryRun = false
): unknown {
  if (result == null) return result;
  const detail = wantsDetail(args);
  const pathSet = hasPath(args);

  let summarized: unknown = result;
  if (tool === 'git_diff' || tool === 'git_stash_show') {
    summarized = detail || pathSet ? result : stripDiffPatch(result);
  } else if (tool === 'git_show') {
    if (detail || pathSet) {
      summarized = result;
    } else {
      const row = asRecord(result);
      summarized = row ? { ...row, diff: stripDiffPatch(row.diff) } : result;
    }
  } else if (tool === 'git_merge_rehearse') {
    summarized = detail || pathSet ? result : stripRehearseBodies(result);
  } else if (tool === 'git_repo_overview') {
    if (!detail) {
      const row = asRecord(result);
      const repos = Array.isArray(row?.repos) ? row.repos : [];
      summarized = {
        ...row,
        repos: repos.map((item) => {
          const rec = asRecord(item);
          if (!rec) return item;
          const { activity: _days, ...rest } = rec;
          return rest;
        })
      };
    }
  } else if (tool === 'git_file_content') {
    if (!detail) {
      const row = asRecord(result);
      const content = typeof row?.content === 'string' ? row.content : '';
      const bytes = Buffer.byteLength(content, 'utf8');
      if (bytes > FILE_CONTENT_LIMIT) {
        summarized = {
          path: args.path,
          truncated: true,
          bytes,
          detailAvailable: true
        };
      }
    }
  }

  return attachNext(tool, summarized, args, dryRun);
}

/** 把干运行/真实结果统一包成 MCP 文本输出 */
export function formatResultForMcp(exec: ExecutionResult): string {
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
  const summarized = summarizeForAgent(exec.tool, exec.result, exec.args ?? {}, exec.dryRun);
  const rec = asRecord(summarized);
  const next = Array.isArray(rec?.next) ? rec.next : [];
  if (next.length) {
    const names = next
      .map((step) => asRecord(step)?.tool)
      .filter((n): n is string => typeof n === 'string' && n.length > 0);
    if (names.length) parts.push(`next: ${names.join(' → ')}`);
  }
  const payload = typeof summarized === 'string' ? summarized : JSON.stringify(summarized);
  parts.push(payload);
  return parts.join('\n\n');
}
