/**
 * CLI：`git-cockpit` 入口。
 * - git-cockpit start  启动常驻 daemon（Web 服务 + MCP Streamable HTTP），默认端口 3000；
 * - git-cockpit mcp    以 stdio 模式运行 MCP Server（供客户端直接拉起）；
 * - git-cockpit version / --help。
 */
import { createRuntime, disposeRuntime } from './runtime.js';
import { createWebServer } from './webServer.js';
import { startMcpStdio } from './mcpServer.js';

function printHelp(): void {
  console.log(`Git Cockpit - 基于 MCP 的 Git 可视化操作工具

用法:
  git-cockpit start           启动 daemon：Web 界面 + MCP Server（Streamable HTTP）
  git-cockpit mcp             以 stdio 模式运行 MCP Server（供 Claude Desktop / Cursor 配置）
  git-cockpit version         输出版本号
  git-cockpit help            显示帮助

环境变量:
  GIT_COCKPIT_DATA_DIR        数据目录（默认 ~/.git-cockpit）
  GIT_COCKPIT_PORT            端口（默认 3000）
  GIT_COCKPIT_HOST            监听地址（默认 localhost）
`);
}

export async function main(argv: string[]): Promise<number> {
  const args = argv.slice(2);
  const command = args[0] ?? 'start';

  if (command === 'help' || command === '--help' || command === '-h') {
    printHelp();
    return 0;
  }
  if (command === 'version' || command === '--version' || command === '-v') {
    console.log('0.1.0');
    return 0;
  }

  const dataDir = process.env.GIT_COCKPIT_DATA_DIR ?? '~/.git-cockpit';
  const runtime = createRuntime({ dataDir });

  if (command === 'mcp') {
    await startMcpStdio(runtime);
    return 0;
  }

  if (command === 'start') {
    const port = Number(process.env.GIT_COCKPIT_PORT) || runtime.config.server.port;
    const host = process.env.GIT_COCKPIT_HOST ?? runtime.config.server.host;
    const server = await createWebServer(runtime, { host, port });
    console.log(`[git-cockpit] Web UI:      http://${host}:${port}`);
    console.log(`[git-cockpit] MCP (HTTP):  http://${host}:${port}/mcp`);
    console.log(`[git-cockpit] 数据目录:      ${dataDir}`);
    console.log(`[git-cockpit] Ctrl+C 退出`);
    return await new Promise<number>((resolve) => {
      const shutdown = () => {
        void server.close().then(() => resolve(0));
      };
      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);
    });
  }

  console.error(`未知命令: ${command}`);
  printHelp();
  return 1;
}

export { createRuntime, disposeRuntime };