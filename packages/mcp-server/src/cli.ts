/**
 * CLI：`git-cockpit` 入口。
 * - git-cockpit start  启动常驻 daemon（Web 服务 + MCP Streamable HTTP），默认端口 3000；
 * - git-cockpit mcp    连接或启动唯一 daemon，并把 stdio 桥接到它；
 *                      多客户端共用一个后端，当前命令启动的 daemon 随 stdin 关闭；
 * - git-cockpit version / --help。
 */
import { createRuntime, disposeRuntime } from './runtime.ts';
import { createWebServer } from './webServer.ts';
import { startMcpStdio } from './mcpServer.ts';
import { startMcpBridge } from './mcpBridge.ts';
import { ConfigStore } from './config.ts';
import { resolveDaemonEndpoint } from './daemonEndpoint.ts';
import { version } from '../package.json'

async function probeDaemon(url: string, timeoutMs = 1_000): Promise<boolean> {
  try {
    return (await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })).ok;
  } catch {
    return false;
  }
}

async function waitForDaemon(url: string, attempts = 10): Promise<boolean> {
  for (let i = 0; i < attempts; i += 1) {
    if (await probeDaemon(url)) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

function printHelp(): void {
  console.log(`Git Cockpit - 基于 MCP 的 Git 可视化操作工具

用法:
  git-cockpit start           启动 daemon：Web 界面 + MCP Server（Streamable HTTP）
  git-cockpit mcp             连接或启动唯一 daemon，并桥接 stdio MCP
                              已有 daemon 时复用；没有 daemon 时由本命令启动，退出时一并关闭
  git-cockpit mcp --standalone
                              显式自建后端（每个客户端一份队列与锁，一般不需要）
  git-cockpit version         输出版本号
  git-cockpit help            显示帮助

环境变量:
  GIT_COCKPIT_DATA_DIR        数据目录（默认 ~/.git-cockpit）
  GIT_COCKPIT_PORT            端口（默认 3000）
  GIT_COCKPIT_HOST            监听地址（默认 localhost）
  GIT_COCKPIT_LLM_API_KEY     开发可选：覆盖设置里的模型 Key，不写回 config.json
  GIT_COCKPIT_LLM_MODEL       开发可选：覆盖模型名
  GIT_COCKPIT_LLM_BASE_URL    开发可选：覆盖 OpenAI 兼容 Base URL
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
    console.log(version);
    return 0;
  }

  const dataDir = process.env.GIT_COCKPIT_DATA_DIR ?? '~/.git-cockpit';

  if (command === 'mcp') {
    // 只用 ConfigStore 读取 endpoint 与密钥；已有 daemon 时本进程不打开 SQLite。
    const config = new ConfigStore(dataDir).get();
    const endpoint = resolveDaemonEndpoint(config);
    const secret = config.auth.localSecret;

    // 显式逃生舱：确实需要每个客户端一份后端时才用（会失去全局队列与仓库锁）。
    if (args.includes('--standalone')) {
      process.stderr.write(
        '[git-cockpit] --standalone：本进程自建后端，多个客户端将各自持有一份队列与仓库锁。\n'
      );
      await startMcpStdio(createRuntime({ dataDir }));
      return 0;
    }

    if (await probeDaemon(endpoint.healthUrl)) {
      // 已有 daemon：只桥接，绝不创建第二套 Runtime。
      await startMcpBridge({ host: endpoint.host, port: endpoint.port, secret });
      return 0;
    }

    // 没有 daemon：由当前命令启动唯一 daemon，随后仍走同一个 HTTP bridge。
    const ownedRuntime = createRuntime({ dataDir });
    let ownedServer: Awaited<ReturnType<typeof createWebServer>> | undefined;
    try {
      ownedServer = await createWebServer(ownedRuntime, { host: endpoint.host, port: endpoint.port });
    } catch (err) {
      disposeRuntime(ownedRuntime);
      // 并发启动：另一个 mcp 进程刚抢到端口，退回去桥接它，而不是再起一套后端。
      if (await waitForDaemon(endpoint.healthUrl)) {
        await startMcpBridge({ host: endpoint.host, port: endpoint.port, secret });
        return 0;
      }
      throw err;
    }

    try {
      if (!(await waitForDaemon(endpoint.healthUrl))) {
        throw new Error(`daemon 启动后健康检查未通过：${endpoint.healthUrl}`);
      }
      process.stderr.write(`[git-cockpit] 未发现 daemon，已由当前 mcp 命令启动 ${endpoint.baseUrl}\n`);
      await startMcpBridge({ host: endpoint.host, port: endpoint.port, secret });
      return 0;
    } finally {
      // 只关闭自己启动的 daemon；外部 daemon 不受影响。
      await ownedServer.close();
    }
  }

  const runtime = createRuntime({ dataDir });

  if (command === 'start') {
    const endpoint = resolveDaemonEndpoint(runtime.config);
    const { host, port } = endpoint;
    const server = await createWebServer(runtime, { host, port });
    console.log(`[git-cockpit] Web UI:      http://${host}:${port}`);
    console.log(`[git-cockpit] API 文档:     http://${host}:${port}/docs`);
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