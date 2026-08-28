/**
 * Git Cockpit mcp-server 入口：导出程序化 API（供测试/嵌入式使用）。
 * 命令行入口见 ./cli.ts。
 */
export { createRuntime, disposeRuntime } from './runtime.ts';
export type { Runtime, RuntimeOptions } from './runtime.ts';
export { createMcpServer, startMcpStdio, McpHttpHandler, MCP_SERVER_INFO } from './mcpServer.ts';
export { createWebServer } from './webServer.ts';
export type { WebServerHandle } from './webServer.ts';
export { executeTool, formatResultForMcp } from './tools/handlers.ts';
export type { ToolDef, ToolExecutionContext, ToolExecutionResult } from './tools/handlers.ts';
export { TOOL_DEFS, TOOL_DEF_MAP, toolSummaries } from './tools/index.ts';
export { main as runCli } from './cli.ts';
export { ConfigStore } from './config.ts';
export type { DeepPartial } from './config.ts';
export { RepoManager } from './repoManager.ts';
export type { RepoHandle } from './repoManager.ts';