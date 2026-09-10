/**
 * Capability 按域拆分。新工具写进对应 git/*.ts 并列入本数组；
 * 禁止只在 mcp-server 加工具却不注册进 registry。
 * 加载本数组的进程壳（mcp-server tools/index）负责 registerAll。
 */
import type { Capability } from '../types.ts';
import { dangerCapabilities } from './danger.ts';
import { inspectCapabilities } from './inspect.ts';
import { jobsCapabilities } from './jobs.ts';
import { mergeCapabilities } from './merge.ts';
import { mrCapabilities } from './mr.ts';
import { rebaseCapabilities } from './rebase.ts';
import { refsCapabilities } from './refs.ts';
import { syncCapabilities } from './sync.ts';
import { worktreeCapabilities } from './worktree.ts';
import { writeCapabilities } from './write.ts';

export const TOOL_DEFS: Capability[] = [
  ...inspectCapabilities,
  ...refsCapabilities,
  ...writeCapabilities,
  ...mergeCapabilities,
  ...rebaseCapabilities,
  ...syncCapabilities,
  ...mrCapabilities,
  ...jobsCapabilities,
  ...worktreeCapabilities,
  ...dangerCapabilities
];

export const TOOL_DEF_MAP: ReadonlyMap<string, Capability> = new Map(TOOL_DEFS.map((d) => [d.name, d]));

export function toolSummaries(): { name: string; description: string }[] {
  return TOOL_DEFS.map((d) => ({ name: d.name, description: d.description }));
}
