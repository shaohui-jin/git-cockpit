import { z } from 'zod';
import { BackupManager } from '../backup.ts';
import type { BackupResult } from '../backup.ts';
import type { GitService } from '../gitService.ts';
import { GitOperationError, PermissionError } from '../types.ts';
import type { Capability, ExecutionContext, ExecutionResult } from './types.ts';

function extractError(err: unknown): { code: string; message: string; requiredApproval: boolean } {
  if (err instanceof PermissionError) {
    return { code: 'PERMISSION_DENIED', message: err.message, requiredApproval: err.requiredApproval };
  }
  if (err instanceof GitOperationError) {
    return { code: err.code, message: err.message, requiredApproval: false };
  }
  if (err instanceof z.ZodError) {
    const summary = err.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .slice(0, 5)
      .join('; ');
    return { code: 'INVALID_ARGS', message: `参数校验失败：${summary}`, requiredApproval: false };
  }
  const msg = err instanceof Error ? err.message : String(err);
  return { code: 'INTERNAL_ERROR', message: msg.slice(0, 500), requiredApproval: false };
}

/**
 * 统一安全链路：权限 → zod → 解析仓库 → 高危备份 → handler → 审计。
 * 不抛异常，错误编码进 error 字段。
 */
export async function executeCapability(
  def: Capability,
  rawArgs: Record<string, unknown>,
  ctx: ExecutionContext
): Promise<ExecutionResult> {
  const host = ctx.host;
  const t0 = Date.now();
  const dryRun = typeof rawArgs.dryRun === 'boolean' ? rawArgs.dryRun : host.permissions.getDryRunDefault();

  const record = (
    result: 'success' | 'error' | 'denied',
    params: Record<string, unknown>,
    errorMessage?: string,
    repoPath?: string
  ) => {
    host.auditLogger.log({
      timestamp: new Date().toISOString(),
      source: ctx.source,
      tool: def.name,
      repoPath: repoPath ?? '',
      params,
      result,
      error: errorMessage ?? null,
      durationMs: Date.now() - t0,
      dryRun
    });
    host.eventBus.emit('log', { tool: def.name, result, at: new Date().toISOString() });
  };

  try {
    host.permissions.assertAllowed(def.name);

    let args: Record<string, unknown>;
    try {
      args = def.schema.parse(rawArgs) as Record<string, unknown>;
    } catch (err) {
      const e = extractError(err);
      record('error', rawArgs, e.message);
      return { tool: def.name, source: ctx.source, dryRun, success: false, error: e, durationMs: Date.now() - t0 };
    }

    if (ctx.source === 'mcp' && Array.isArray(args.files) && args.files.length > 0) {
      if (
        def.name === 'git_apply_resolve' ||
        def.name === 'git_merge_continue' ||
        def.name === 'git_rebase_continue'
      ) {
        throw new GitOperationError(
          '冲突选边只在网页完成。Agent 不要传 files / resolvedContent，请把 preview 的 webUrl 给人。',
          'AGENT_NO_RESOLVE'
        );
      }
    }

    let git: GitService | undefined;
    let repoPath = '';
    if (def.needsRepo !== false) {
      const handle = await host.resolveRepo({
        repoId: ctx.repoId,
        repoPath: ctx.repoPath,
        argsPath: args.repoPath as string | undefined
      });
      git = handle.git;
      repoPath = handle.repoPath;
    }

    let backup: BackupResult | null = null;
    if (!dryRun && def.risk === 'dangerous' && host.config.git.backupOnDangerousOps && git) {
      backup = await new BackupManager(git).createBackup();
      args = { ...args, __backup: { branch: backup.branch, stashRef: backup.stashRef } };
    }

    const result = await def.handler(args, {
      source: ctx.source,
      git: git as GitService,
      repoPath,
      host
    });

    record('success', args, undefined, repoPath);

    return {
      tool: def.name,
      source: ctx.source,
      dryRun,
      success: true,
      result,
      preview: dryRun ? result : undefined,
      backupCreated: backup,
      durationMs: Date.now() - t0,
      args
    };
  } catch (err) {
    const e = extractError(err);
    const isDenied = err instanceof PermissionError;
    record(isDenied ? 'denied' : 'error', rawArgs, e.message);
    return {
      tool: def.name,
      source: ctx.source,
      dryRun,
      success: false,
      error: e,
      durationMs: Date.now() - t0
    };
  }
}
