/**
 * 工具执行层：所有工具（MCP / Web / CLI 共用）的收口。
 *
 * 统一处理：
 * 1. 权限检查（PermissionManager：禁用/需审批 → 拒绝并记录 denied）；
 * 2. 参数 schema 校验（zod）；
 * 3. 仓库解析（显式 repoPath / repoId / 最近打开仓库）；
 * 4. dry_run 预览模式（默认取配置）；
 * 5. 高风险操作自动备份（BackupManager，配置开启时）；
 * 6. 执行 + 结果审计日志（脱敏）；
 * 7. 触达事件（GitService 'changed' 已由 RepoManager 转发）。
 */
import { z } from 'zod';
import {
  BackupManager,
  GitOperationError,
  GitService,
  PermissionError
} from '@shaohui_jin/git-cockpit-core';
import type { BackupResult, RiskLevel } from '@shaohui_jin/git-cockpit-core';
import type { RepoHandle } from '../repoManager.js';
import type { Runtime } from '../runtime.js';

export interface ToolExecutionContext {
  runtime: Runtime;
  source: 'mcp' | 'web' | 'cli';
  /** 上层已解析的仓库（Web 路由提供 repoId，MCP 可通过 tool args 的 repoPath 提供） */
  repoId?: number;
  repoPath?: string;
}

export interface ToolDefBase {
  /** 工具名（如 git_status） */
  name: string;
  description: string;
  risk: RiskLevel;
}

export interface ToolDef<TSchema extends z.ZodTypeAny = z.ZodTypeAny> extends ToolDefBase {
  schema: TSchema;
  handler: ToolHandler<TSchema>;
}

export type ToolHandler<TSchema extends z.ZodTypeAny> = (
  args: z.infer<TSchema> & { repoPath?: string; dryRun?: boolean },
  ctx: ToolExecutionContext & { git: GitService; repoPath: string }
) => Promise<unknown>;

export interface ToolExecutionResult {
  tool: string;
  source: 'mcp' | 'web' | 'cli';
  dryRun: boolean;
  success: boolean;
  /** 成功时的返回值（字符串输出或结构化数据） */
  result?: unknown;
  error?: {
    code: string;
    message: string;
    requiredApproval: boolean;
  };
  /** 高风险操作自动创建的备份信息 */
  backupCreated?: BackupResult | null;
  durationMs: number;
  /** 预览格式（dryRun 时返回的 WritePreview 已包含命令） */
  preview?: unknown;
}

/** 解析目标仓库：优先级 repoId > repoPath(上下文) > args.repoPath > 最近打开 */
async function resolveRepo(runtime: Runtime, ctx: ToolExecutionContext, argsPath?: string): Promise<RepoHandle> {
  if (ctx.repoId !== undefined) {
    const handle = await runtime.repoManager.getById(ctx.repoId);
    if (handle) return handle;
    throw new GitOperationError(`仓库不存在: id=${ctx.repoId}`, 'REPO_NOT_FOUND');
  }
  if (ctx.repoPath) {
    return runtime.repoManager.getByPath(ctx.repoPath);
  }
  if (argsPath) {
    return runtime.repoManager.open(argsPath);
  }
  const current = await runtime.repoManager.getCurrent();
  if (!current) {
    throw new GitOperationError('尚未打开任何仓库。请先打开仓库或提供 repoPath 参数。', 'NO_ACTIVE_REPO');
  }
  return current;
}

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
 * 执行一个工具（含统一安全链路）。返回标准化结果，不抛异常（错误编码进 error 字段）。
 */
export async function executeTool(
  def: ToolDef,
  rawArgs: Record<string, unknown>,
  ctx: ToolExecutionContext
): Promise<ToolExecutionResult> {
  const runtime = ctx.runtime;
  const t0 = Date.now();
  const dryRun = typeof rawArgs.dryRun === 'boolean' ? rawArgs.dryRun : runtime.permissions.getDryRunDefault();

  const record = (result: 'success' | 'error' | 'denied', params: Record<string, unknown>, errorMessage?: string, repoPath?: string) => {
    runtime.auditLogger.log({
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
    runtime.eventBus.emit('log', { tool: def.name, result, at: new Date().toISOString() });
  };

  try {
    // 1. 权限
    runtime.permissions.assertAllowed(def.name);

    // 2. schema 校验
    let args: Record<string, unknown>;
    try {
      args = def.schema.parse(rawArgs) as Record<string, unknown>;
    } catch (err) {
      const e = extractError(err);
      record('error', rawArgs, e.message);
      return { tool: def.name, source: ctx.source, dryRun, success: false, error: e, durationMs: Date.now() - t0 };
    }

    // 3. 仓库解析
    const handle = await resolveRepo(runtime, ctx, args.repoPath as string | undefined);
    const git = handle.service;
    const repoPath = git.repoPath;

    // 4. 高风险自动备份（非预览时）
    let backup: BackupResult | null = null;
    if (!dryRun && def.risk === 'dangerous' && runtime.config.git.backupOnDangerousOps) {
      backup = await new BackupManager(git).createBackup();
      args = { ...args, __backup: { branch: backup.branch, stashRef: backup.stashRef } };
    }

    // 5. 执行
    const result = await def.handler(args, { ...ctx, git, repoPath });

    // 6. 审计
    record('success', args, undefined, repoPath);

    const preview = dryRun ? result : undefined;
    return {
      tool: def.name,
      source: ctx.source,
      dryRun,
      success: true,
      result,
      preview,
      backupCreated: backup,
      durationMs: Date.now() - t0
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
    parts.push(`[自动备份] 分支 ${exec.backupCreated.branch ?? '(未创建)'}${exec.backupCreated.stashRef ? `，stash ${exec.backupCreated.stashRef}` : ''}`);
  }
  const payload =
    typeof exec.result === 'string'
      ? exec.result
      : JSON.stringify(exec.result, null, 2);
  parts.push(payload);
  return parts.join('\n\n');
}