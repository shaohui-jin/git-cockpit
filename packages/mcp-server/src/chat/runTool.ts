import { z } from 'zod';
import type { Runtime } from '../runtime.ts';
import { executeTool } from '../tools/handlers.ts';
import { summarizeForAgent } from '../tools/format.ts';
import { TOOL_DEF_MAP } from '../tools/index.ts';
import { ConfirmGate, previewFromExecResult, type ConfirmTicket } from './confirmGate.ts';
import {
  isChatAllowedTool,
  isChatWriteTool,
  sanitizeChatArgs,
  wrapToolData,
  type ChatAllowedTool
} from './toolPolicy.ts';

export interface ChatToolRun {
  tool: string;
  success: boolean;
  pendingConfirm: boolean;
  token?: string;
  preview?: ConfirmTicket['preview'];
  modelText: string;
}

export async function runChatTool(
  runtime: Runtime,
  gate: ConfirmGate,
  tool: string,
  rawArgs: Record<string, unknown>,
  repoPath: string
): Promise<ChatToolRun> {
  if (!isChatAllowedTool(tool)) {
    const modelText = wrapToolData(tool, { error: `Tool not allowed in chat: ${tool}` });
    return { tool, success: false, pendingConfirm: false, modelText };
  }
  const def = TOOL_DEF_MAP.get(tool);
  if (!def) {
    return { tool, success: false, pendingConfirm: false, modelText: wrapToolData(tool, { error: 'unknown tool' }) };
  }
  const args = sanitizeChatArgs(tool, rawArgs, repoPath);
  const exec = await executeTool(def, args, { runtime, source: 'chat', repoPath });
  const summarized = exec.success
    ? summarizeForAgent(tool, exec.result ?? exec.preview, exec.args ?? args, exec.dryRun)
    : { error: exec.error?.message ?? 'failed', code: exec.error?.code };

  if (isChatWriteTool(tool as ChatAllowedTool) && exec.success && exec.dryRun) {
    const preview = previewFromExecResult(exec.preview ?? exec.result);
    const execArgs = { ...(exec.args ?? args) };
    delete execArgs.dryRun;
    const ticket = gate.issue({
      tool,
      repoPath,
      args: execArgs,
      preview
    });
    return {
      tool,
      success: true,
      pendingConfirm: true,
      token: ticket.token,
      preview,
      modelText: wrapToolData(tool, {
        pendingConfirm: true,
        command: preview.command,
        affectedFiles: preview.affectedFiles,
        note: 'Waiting for the user to confirm in the UI. Do not claim the write succeeded.'
      })
    };
  }

  return {
    tool,
    success: exec.success,
    pendingConfirm: false,
    modelText: wrapToolData(tool, summarized)
  };
}

export async function confirmChatWrite(
  runtime: Runtime,
  gate: ConfirmGate,
  token: string
): Promise<{ ok: boolean; error?: string; tool?: string; preview?: ConfirmTicket['preview']; result?: unknown }> {
  const ticket = gate.take(token);
  if (!ticket) return { ok: false, error: '确认已过期或已使用，请重新预览' };
  if (!isChatWriteTool(ticket.tool)) return { ok: false, error: '不是可确认的写操作' };
  const def = TOOL_DEF_MAP.get(ticket.tool);
  if (!def) return { ok: false, error: '未知工具' };

  const dryArgs = { ...ticket.args, dryRun: true, repoPath: ticket.repoPath };
  const dry = await executeTool(def, dryArgs, { runtime, source: 'chat', repoPath: ticket.repoPath });
  if (!dry.success) {
    return { ok: false, error: dry.error?.message ?? '预览失败，已取消执行', tool: ticket.tool };
  }
  const fresh = previewFromExecResult(dry.preview ?? dry.result);
  if (!gate.previewsMatch(ticket.preview, fresh)) {
    return { ok: false, error: '仓库已变化，请重新预览后再确认', tool: ticket.tool, preview: fresh };
  }

  const exec = await executeTool(
    def,
    { ...ticket.args, dryRun: false, repoPath: ticket.repoPath },
    {
      runtime,
      source: 'chat',
      repoPath: ticket.repoPath
    }
  );
  if (!exec.success) {
    return { ok: false, error: exec.error?.message ?? '执行失败', tool: ticket.tool };
  }
  return { ok: true, tool: ticket.tool, preview: ticket.preview, result: exec.result };
}

export async function cancelChatWrite(
  gate: ConfirmGate,
  token: string
): Promise<{ ok: boolean; error?: string; tool?: string }> {
  const ticket = gate.take(token);
  if (!ticket) return { ok: false, error: '确认已过期或已使用' };
  return { ok: true, tool: ticket.tool };
}

export function chatZodOmit(schema: z.ZodTypeAny): z.ZodTypeAny {
  const obj = schema as z.ZodObject<z.ZodRawShape> & { omit?: (mask: Record<string, true>) => z.ZodTypeAny };
  if (typeof obj.omit !== 'function') return schema;
  return obj.omit({ repoPath: true, dryRun: true, detail: true });
}
