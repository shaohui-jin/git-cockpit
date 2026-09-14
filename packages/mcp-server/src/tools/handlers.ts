/**
 * 工具执行层：MCP / Web / CLI 共用。安全链路在 core executeCapability。
 */
import { executeCapability } from '@shaohui_jin/git-cockpit-core';
import type { Capability, ExecutionResult } from '@shaohui_jin/git-cockpit-core';
import { hostFromRuntime } from '../host.ts';
import type { Runtime } from '../runtime.ts';

export type ToolDef = Capability;
export type ToolExecutionResult = ExecutionResult;

export interface ToolExecutionContext {
  runtime: Runtime;
  source: 'mcp' | 'web' | 'cli' | 'chat';
  /** 上层已解析的仓库（Web 路由提供 repoId，MCP 可通过 tool args 的 repoPath 提供） */
  repoId?: number;
  repoPath?: string;
}

/**
 * 执行一个工具（含统一安全链路）。返回标准化结果，不抛异常（错误编码进 error 字段）。
 */
export async function executeTool(
  def: ToolDef,
  rawArgs: Record<string, unknown>,
  ctx: ToolExecutionContext
): Promise<ToolExecutionResult> {
  return executeCapability(def, rawArgs, {
    source: ctx.source,
    repoId: ctx.repoId,
    repoPath: ctx.repoPath,
    host: hostFromRuntime(ctx.runtime)
  });
}

export { formatResultForMcp, summarizeForAgent } from './format.ts';
