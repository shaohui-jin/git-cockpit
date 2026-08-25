/**
 * Git Cockpit mcp-server 入口：导出程序化 API（供测试/嵌入式使用）。
 * 命令行入口见 ./cli.ts。
 */
export { createRuntime, disposeRuntime } from './runtime.js';
export type { Runtime, RuntimeOptions } from './runtime.js';
export { createMcpServer, startMcpStdio, McpHttpHandler, MCP_SERVER_INFO } from './mcpServer.js';
export { createWebServer } from './webServer.js';
export type { WebServerHandle } from './webServer.js';
export { executeTool, formatResultForMcp } from './tools/handlers.js';
export type { ToolDef, ToolExecutionContext, ToolExecutionResult } from './tools/handlers.js';
export { TOOL_DEFS, TOOL_DEF_MAP, toolSummaries } from './tools/index.js';
export { main as runCli } from './cli.js';
export { ConfigStore } from './config.js';
export type { DeepPartial } from './config.js';
export { RepoManager } from './repoManager.js';
export type { RepoHandle } from './repoManager.js';