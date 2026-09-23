/**
 * 回归测试：`git-cockpit mcp` 的 daemon 归属决策。
 *
 * 背景：旧实现探到 daemon 就 `return 0`（stdio 客户端立刻退出）；
 * 后来改成探不到就自建独立 Runtime（多个客户端各持一份队列与仓库锁）。
 * 现在的要求是：**任何情况下都只指向一个后端**——
 *   - 已有 daemon：只桥接，不创建 Runtime；
 *   - 没有 daemon：由当前命令启动一个，stdin 关闭时关掉自己启动的那个；
 *   - 并发启动抢端口失败：退回去桥接对方，而不是再起一套。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createRuntime: vi.fn(),
  disposeRuntime: vi.fn(),
  createWebServer: vi.fn(),
  startMcpBridge: vi.fn(),
  startMcpStdio: vi.fn()
}));

const FAKE_CONFIG = {
  server: { host: '127.0.0.1', port: 3999 },
  auth: { localSecret: 'a'.repeat(64) },
  storage: { dataDir: '~/.git-cockpit' },
  git: { backupOnDangerousOps: true, allowedRepos: [] },
  permissions: { disabledTools: [], requireApprovalFor: [], dryRunDefault: false },
  logging: { level: 'info' },
  mr: {},
  llm: {}
};

vi.mock('../src/runtime.ts', () => ({
  createRuntime: mocks.createRuntime,
  disposeRuntime: mocks.disposeRuntime
}));
vi.mock('../src/webServer.ts', () => ({ createWebServer: mocks.createWebServer }));
vi.mock('../src/mcpBridge.ts', () => ({ startMcpBridge: mocks.startMcpBridge }));
vi.mock('../src/mcpServer.ts', () => ({ startMcpStdio: mocks.startMcpStdio }));
vi.mock('../src/config.ts', () => ({
  ConfigStore: class {
    get(): unknown {
      return FAKE_CONFIG;
    }
  }
}));

const { main } = await import('../src/cli.ts');

/** 让探活按给定序列返回；用完后一律视为“daemon 已就绪”。 */
function stubHealth(results: boolean[]): void {
  let index = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      const ok = results[index] ?? true;
      index += 1;
      if (!ok) throw new Error('ECONNREFUSED');
      return { ok: true } as Response;
    })
  );
}

describe('git-cockpit mcp 的 daemon 归属', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createRuntime.mockReturnValue({ config: FAKE_CONFIG, dispose: vi.fn() });
    mocks.disposeRuntime.mockReturnValue(undefined);
    mocks.startMcpBridge.mockResolvedValue(undefined);
    mocks.startMcpStdio.mockResolvedValue(undefined);
    mocks.createWebServer.mockResolvedValue({ app: {}, close: vi.fn(async () => undefined) });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.GIT_COCKPIT_HOST;
    delete process.env.GIT_COCKPIT_PORT;
  });

  it('已有 daemon：只桥接，不创建第二套 Runtime', async () => {
    stubHealth([true]);
    await expect(main(['node', 'git-cockpit', 'mcp'])).resolves.toBe(0);

    expect(mocks.startMcpBridge).toHaveBeenCalledTimes(1);
    expect(mocks.startMcpBridge).toHaveBeenCalledWith({
      host: '127.0.0.1',
      port: 3999,
      secret: FAKE_CONFIG.auth.localSecret
    });
    expect(mocks.createRuntime).not.toHaveBeenCalled();
    expect(mocks.createWebServer).not.toHaveBeenCalled();
  });

  it('没有 daemon：自建 daemon 并桥接，stdin 结束后关闭自己启动的那个', async () => {
    stubHealth([false, true]);
    await expect(main(['node', 'git-cockpit', 'mcp'])).resolves.toBe(0);

    expect(mocks.createRuntime).toHaveBeenCalledTimes(1);
    expect(mocks.createWebServer).toHaveBeenCalledWith(expect.anything(), { host: '127.0.0.1', port: 3999 });
    expect(mocks.startMcpBridge).toHaveBeenCalledTimes(1);
    const handle = await mocks.createWebServer.mock.results[0]!.value;
    expect(handle.close).toHaveBeenCalledTimes(1);
  });

  it('并发抢端口失败：退回去桥接对方，并释放自己那份 Runtime', async () => {
    stubHealth([false, true]);
    mocks.createWebServer.mockRejectedValueOnce(new Error('EADDRINUSE'));
    await expect(main(['node', 'git-cockpit', 'mcp'])).resolves.toBe(0);

    expect(mocks.disposeRuntime).toHaveBeenCalledTimes(1);
    expect(mocks.startMcpBridge).toHaveBeenCalledTimes(1);
  });

  it('自建 daemon 后健康检查始终不过：明确报错，不静默降级', async () => {
    // 第一次探活失败（进入自建分支），之后 waitForDaemon 的 10 次全部失败
    stubHealth([false, ...Array.from({ length: 10 }, () => false)]);
    await expect(main(['node', 'git-cockpit', 'mcp'])).rejects.toThrow(/健康检查未通过/);
    expect(mocks.startMcpBridge).not.toHaveBeenCalled();
  });

  it('--standalone：显式自建 stdio，不走桥接', async () => {
    stubHealth([true]);
    await expect(main(['node', 'git-cockpit', 'mcp', '--standalone'])).resolves.toBe(0);

    expect(mocks.startMcpStdio).toHaveBeenCalledTimes(1);
    expect(mocks.startMcpBridge).not.toHaveBeenCalled();
    expect(mocks.createWebServer).not.toHaveBeenCalled();
  });

  it('start 命令与 mcp 使用同一套地址解析', async () => {
    process.env.GIT_COCKPIT_PORT = '4321';
    const listeners: Record<string, () => void> = {};
    const originalOn = process.on.bind(process);
    const onSpy = vi.spyOn(process, 'on').mockImplementation(((
      event: string,
      handler: (...args: unknown[]) => void
    ) => {
      if (event === 'SIGINT' || event === 'SIGTERM') {
        listeners[event] = handler as () => void;
        return process;
      }
      return originalOn(event as never, handler as never);
    }) as never);

    const pending = main(['node', 'git-cockpit', 'start']);
    await vi.waitFor(() => expect(mocks.createWebServer).toHaveBeenCalled());
    expect(mocks.createWebServer).toHaveBeenCalledWith(expect.anything(), { host: '127.0.0.1', port: 4321 });
    expect(onSpy).toHaveBeenCalled();

    listeners.SIGINT?.();
    await expect(pending).resolves.toBe(0);
    onSpy.mockRestore();
  });
});
