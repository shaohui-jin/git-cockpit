/**
 * 回归测试：createMcpServer 必须成功注册全部工具。
 *
 * 背景：SDK >=1.30 的 registerTool 内部访问 this._registeredTools。
 * 若把 server.registerTool 抽成裸函数再调用（丢失 this），注册时抛
 * TypeError"Cannot read properties of undefined (reading '_registeredTools')"，
 * 且该异常发生在 Fastify hijack 的 /mcp 处理链路内被静默吞掉，导致
 * MCP 握手挂起、Cursor 等客户端报 Connection closed。
 */
import { afterAll, describe, expect, it } from 'vitest';
import { TOOL_DEFS, createMcpServer, MCP_PROMPTS } from '../src/index.ts';
import { createTestRuntime, disposeTestRuntime, cleanupTmp } from './helpers.ts';
import type { Runtime } from '../src/index.ts';

type ServerLike = ReturnType<typeof createMcpServer>;

type PromptReg = {
  callback: (extra: unknown) => Promise<{ messages: { content: { text: string } }[] }> | { messages: { content: { text: string } }[] };
};
type ResourceReg = {
  readCallback: (uri: URL) => Promise<{ contents: { text: string }[] }>;
};

/** 每个用例独立创建 runtime + McpServer，测试结束释放。 */
function withServer(fn: (runtime: Runtime, server: ServerLike) => void): void {
  const runtime = createTestRuntime();
  try {
    const server = createMcpServer(runtime);
    fn(runtime, server);
  } finally {
    disposeTestRuntime(runtime);
  }
}

describe('createMcpServer 工具注册', () => {
  afterAll(() => {
    cleanupTmp();
  });

  it('注册全部工具且不抛错', () => {
    withServer((runtime, _server) => {
      expect(() => createMcpServer(runtime)).not.toThrow();
    });
  });

  it('注册的工具数量与 TOOL_DEFS 一致', () => {
    withServer((_runtime, server) => {
      const reg = (server as unknown as { _registeredTools: Record<string, unknown> })._registeredTools;
      expect(Object.keys(reg).length).toBe(TOOL_DEFS.length);
    });
  });

  it('全部工具名与 TOOL_DEFS 对应', () => {
    withServer((_runtime, server) => {
      const reg = (server as unknown as { _registeredTools: Record<string, unknown> })._registeredTools;
      for (const def of TOOL_DEFS) {
        expect(reg[def.name], `缺少工具 ${def.name}`).toBeDefined();
      }
    });
  });
});

describe('createMcpServer Prompt / Resource', () => {
  afterAll(() => {
    cleanupTmp();
  });

  it('注册 README 四条 Prompt，正文含对应人话', async () => {
    const runtime = createTestRuntime();
    try {
      const server = createMcpServer(runtime);
      const reg = (server as unknown as { _registeredPrompts: Record<string, PromptReg> })._registeredPrompts;
      expect(Object.keys(reg)).toEqual([...MCP_PROMPTS.map((p) => p.name)]);
      const commit = await reg.safe_commit!.callback({});
      expect(commit.messages[0]?.content.text).toContain('不要一上来就提交');
      const merge = await reg.merge_preview_apply!.callback({});
      expect(merge.messages[0]?.content.text).toContain('禁止用 `git_merge` 冒充预演');
      const ws = await reg.workspace_continue!.callback({});
      expect(ws.messages[0]?.content.text).toContain('禁止用 `git_apply_resolve`');
      expect(ws.messages[0]?.content.text).toContain('不要传 files');
      const mr = await reg.open_mr!.callback({});
      expect(mr.messages[0]?.content.text).toContain('不要塞进工具参数');
      expect(merge.messages[0]?.content.text).toContain('不要选边');
    } finally {
      disposeTestRuntime(runtime);
    }
  });

  it('可读 git-cockpit://repos 与 jobs，空列表不抛错', async () => {
    const runtime = createTestRuntime();
    try {
      const server = createMcpServer(runtime);
      const res = (server as unknown as { _registeredResources: Record<string, ResourceReg> })._registeredResources;
      expect(res['git-cockpit://repos']).toBeDefined();
      expect(res['git-cockpit://repo/current']).toBeDefined();
      expect(res['git-cockpit://jobs']).toBeDefined();
      const repos = await res['git-cockpit://repos']!.readCallback(new URL('git-cockpit://repos'));
      expect(JSON.parse(repos.contents[0]!.text)).toEqual({ repos: [] });
      const jobs = await res['git-cockpit://jobs']!.readCallback(new URL('git-cockpit://jobs'));
      expect(JSON.parse(jobs.contents[0]!.text)).toEqual({ jobs: [] });
      const current = await res['git-cockpit://repo/current']!.readCallback(new URL('git-cockpit://repo/current'));
      expect(JSON.parse(current.contents[0]!.text)).toMatchObject({ available: false });
    } finally {
      disposeTestRuntime(runtime);
    }
  });
});
