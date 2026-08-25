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
import { TOOL_DEFS, createMcpServer } from '../src/index.js';
import { createTestRuntime, disposeTestRuntime, cleanupTmp } from './helpers.js';
import type { Runtime } from '../src/index.js';

type ServerLike = ReturnType<typeof createMcpServer>;

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