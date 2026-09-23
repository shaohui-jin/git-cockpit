/**
 * 回归测试：MCP Streamable HTTP 端点与 stdio 桥。
 *
 * 背景（0.1.21 起的线上故障）：
 * SDK 的 DNS rebinding 校验用「带端口的 Host 头」原样比对 allowedHosts，
 * 而旧代码只把不带端口的 host 写进白名单 → 真实客户端一律
 * 403 {"message":"Invalid Host header: 127.0.0.1:3000"}，
 * 即 HTTP 方式接入 MCP 完全不可用（Cursor 配 url 必挂）。
 *
 * 同时覆盖 stdio 桥：daemon 在跑时 `git-cockpit mcp` 应转发而不是退出，
 * 否则多客户端无法共用一个后端。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import { createTestRuntime, disposeTestRuntime, cleanupTmp, commitFile, initRepo, makeTmpDir } from './helpers.ts';
import { createWebServer } from '../src/webServer.ts';
import { createMcpForwarder } from '../src/mcpBridge.ts';
import type { Runtime } from '../src/index.ts';
import type { WebServerHandle } from '../src/index.ts';

const SECRET_HEADER = 'X-Git-Cockpit-Secret';
/** SDK 要求 POST 的 Accept 同时列出两者，缺一即 406 */
const ACCEPT = 'application/json, text/event-stream';

/** MCP initialize 请求（协议版本按客户端实际会发的来） */
function initializeBody(id = 1): string {
  return JSON.stringify({
    jsonrpc: '2.0',
    id,
    method: 'initialize',
    params: {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'git-cockpit-test', version: '0.0.0' }
    }
  });
}

/** 用 node:http 发原始请求：fetch 不允许覆盖 Host 头，而 Host 校验正是本次回归的重点 */
function rawPost(
  urlStr: string,
  headers: Record<string, string>,
  body: string
): Promise<{ status: number; text: string; sessionId?: string }> {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const req = http.request(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname,
        method: 'POST',
        headers: { ...headers, 'Content-Length': Buffer.byteLength(body) }
      },
      (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (c: string) => {
          text += c;
        });
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            text,
            sessionId: res.headers['mcp-session-id'] as string | undefined
          })
        );
      }
    );
    req.on('error', reject);
    req.end(body);
  });
}

/** 关闭 MCP session，验证 DELETE 会走 SDK 生命周期回调。 */
function rawDelete(urlStr: string, headers: Record<string, string>): Promise<{ status: number }> {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const req = http.request(
      { hostname: u.hostname, port: u.port, path: u.pathname, method: 'DELETE', headers },
      (res) => {
        res.resume();
        res.on('end', () => resolve({ status: res.statusCode ?? 0 }));
      }
    );
    req.on('error', reject);
    req.end();
  });
}

/** 只声明用例真正读到的字段，避免 any */
type JsonRpcPayload = {
  result?: {
    serverInfo?: { name?: string };
    tools?: unknown[];
    content?: { type?: string; text?: string }[];
  };
  error?: { message?: string };
};

/** 建一个只含一个提交、且切到指定分支的仓库（分支名不带斜杠，规避本机 git 建目录的偶发问题） */
async function makeRepoOnBranch(branch: string): Promise<{ dir: string }> {
  const dir = makeTmpDir('mcp-session-');
  const git = await initRepo(dir);
  await commitFile(git, dir, 'a.txt', 'hello\n', 'feat: add a.txt');
  await git.checkoutLocalBranch(branch);
  return { dir };
}

/** 兼容 JSON 与 SSE 两种响应形态，取出 JSON-RPC 载荷 */
function parseMcpPayload(text: string): JsonRpcPayload {
  const line = text
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.startsWith('data:'));
  return JSON.parse(line ? line.replace(/^data:\s*/, '') : text) as JsonRpcPayload;
}

describe('MCP Streamable HTTP /mcp', () => {
  let runtime: Runtime;
  let server: WebServerHandle;
  let base: string;

  beforeAll(async () => {
    runtime = createTestRuntime();
    // 真实监听 0 端口：Host 头会带真实端口，正好复现旧代码的 403
    server = await createWebServer(runtime, { staticDir: null, port: 0, host: '127.0.0.1' });
    const addr = server.app.server.address() as AddressInfo;
    base = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    await server.close();
    disposeTestRuntime(runtime);
    cleanupTmp();
  });

  it('带密钥的 initialize 返回 200（旧版本这里是 403 Invalid Host header）', async () => {
    const res = await rawPost(
      `${base}/mcp`,
      { 'Content-Type': 'application/json', Accept: ACCEPT, [SECRET_HEADER]: runtime.config.auth.localSecret },
      initializeBody()
    );
    expect(res.status).toBe(200);
    expect(res.text).toContain('serverInfo');
    expect(res.text).not.toContain('Invalid Host header');
    // stateful 模式必须发会话 id，后续请求靠它复用同一个 server
    expect(res.sessionId).toBeTruthy();
  });

  it('DELETE /mcp 关闭 session，后续请求返回 404', async () => {
    const init = await rawPost(
      `${base}/mcp`,
      { 'Content-Type': 'application/json', Accept: ACCEPT, [SECRET_HEADER]: runtime.config.auth.localSecret },
      initializeBody(2)
    );
    expect(init.status).toBe(200);
    expect(init.sessionId).toBeTruthy();
    const deleted = await rawDelete(`${base}/mcp`, {
      Accept: 'application/json',
      [SECRET_HEADER]: runtime.config.auth.localSecret,
      'Mcp-Session-Id': init.sessionId!
    });
    expect(deleted.status).toBe(200);
    const after = await rawPost(
      `${base}/mcp`,
      {
        'Content-Type': 'application/json',
        Accept: ACCEPT,
        [SECRET_HEADER]: runtime.config.auth.localSecret,
        'Mcp-Session-Id': init.sessionId!
      },
      JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/list' })
    );
    expect(after.status).toBe(404);
  });

  it('多客户端：两个 session 各自绑定仓库，不因全局最近打开仓库而串仓', async () => {
    const repoA = await makeRepoOnBranch('alpha-only');
    const repoB = await makeRepoOnBranch('beta-only');
    const handleA = await runtime.repoManager.open(repoA.dir);
    const handleB = await runtime.repoManager.open(repoB.dir);

    const authHeaders = (sessionId: string) => ({
      'Content-Type': 'application/json',
      Accept: ACCEPT,
      [SECRET_HEADER]: runtime.config.auth.localSecret,
      'Mcp-Session-Id': sessionId
    });
    const callTool = async (sessionId: string, name: string, args: unknown, id: number): Promise<JsonRpcPayload> => {
      const res = await rawPost(
        `${base}/mcp`,
        authHeaders(sessionId),
        JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } })
      );
      expect(res.status).toBe(200);
      return parseMcpPayload(res.text);
    };
    const sessionOf = async (id: number): Promise<string> => {
      const res = await rawPost(
        `${base}/mcp`,
        { 'Content-Type': 'application/json', Accept: ACCEPT, [SECRET_HEADER]: runtime.config.auth.localSecret },
        initializeBody(id)
      );
      expect(res.sessionId).toBeTruthy();
      return res.sessionId!;
    };
    /** git_status 的正文里带当前分支，用它判断这次调用真正落在哪个仓 */
    const currentBranch = async (sessionId: string, id: number): Promise<string> => {
      const payload = await callTool(sessionId, 'git_status', {}, id);
      const text = payload.result?.content?.[0]?.text ?? '';
      expect(payload.error).toBeUndefined();
      return (JSON.parse(text) as { current?: string }).current ?? '';
    };

    const sessionA = await sessionOf(11);
    const sessionB = await sessionOf(12);

    // 两个 session 各自绑定不同仓库
    expect((await callTool(sessionA, 'git_repo_select', { repoId: handleA.record.id }, 21)).error).toBeUndefined();
    expect((await callTool(sessionB, 'git_repo_select', { repoId: handleB.record.id }, 22)).error).toBeUndefined();

    expect(await currentBranch(sessionA, 31)).toBe('alpha-only');
    expect(await currentBranch(sessionB, 32)).toBe('beta-only');

    // 全局“最近打开仓库”被改到 B 之后，A 仍然只看自己的仓
    await runtime.repoManager.open(repoB.dir);
    expect(await currentBranch(sessionA, 33)).toBe('alpha-only');

    // 单次显式指定仓库不改变 session 绑定
    expect((await callTool(sessionA, 'git_status', { repoId: handleB.record.id }, 34)).error).toBeUndefined();
    expect(await currentBranch(sessionA, 35)).toBe('alpha-only');

    // 未绑定的 session 仍兼容旧的“最近打开仓库”行为
    const sessionC = await sessionOf(13);
    expect(await currentBranch(sessionC, 36)).toBe('beta-only');
  });

  it('不带密钥返回 401', async () => {
    const res = await rawPost(
      `${base}/mcp`,
      { 'Content-Type': 'application/json', Accept: ACCEPT },
      initializeBody()
    );
    expect(res.status).toBe(401);
  });

  it('缺少 text/event-stream 的 Accept 返回 406（SDK 约定，文档需照抄）', async () => {
    const res = await rawPost(
      `${base}/mcp`,
      { 'Content-Type': 'application/json', Accept: 'application/json', [SECRET_HEADER]: runtime.config.auth.localSecret },
      initializeBody()
    );
    expect(res.status).toBe(406);
  });

  it('伪造的 Host 头仍被拒（DNS rebinding 防护未被削弱）', async () => {
    const res = await rawPost(
      `${base}/mcp`,
      {
        'Content-Type': 'application/json',
        Accept: ACCEPT,
        [SECRET_HEADER]: runtime.config.auth.localSecret,
        Host: 'evil.example:3000'
      },
      initializeBody()
    );
    expect(res.status).toBe(403);
  });

  it('stdio 桥：转发 initialize 后能复用会话并列出工具', async () => {
    const forwarder = createMcpForwarder({
      host: '127.0.0.1',
      port: Number(new URL(base).port),
      secret: runtime.config.auth.localSecret
    });

    // 预检不应抛错（这正是旧版本 403 时会炸的地方）
    await expect(forwarder.preflight()).resolves.toBeUndefined();

    const init = await forwarder.forward(initializeBody(7));
    expect(init).toBeTruthy();
    expect(parseMcpPayload(init!).result?.serverInfo?.name).toBeTruthy();
    expect(forwarder.sessionId()).toBeTruthy();

    // initialized 通知：daemon 回 202 无正文，桥不应回写任何东西
    const notify = await forwarder.forward(
      JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })
    );
    expect(notify).toBeNull();

    // 复用同一会话：tools/list 必须成功，且工具数与 TOOL_DEFS 一致
    const list = await forwarder.forward(JSON.stringify({ jsonrpc: '2.0', id: 8, method: 'tools/list' }));
    expect(list).toBeTruthy();
    const parsed = parseMcpPayload(list!);
    expect(parsed.error).toBeUndefined();
    expect(parsed.result?.tools?.length).toBeGreaterThan(0);

    // 释放：否则 SSE 通道会在 server 关闭后留下重连噪音
    await forwarder.close();
  });

  it('stdio 桥：close() 发送 DELETE，daemon 端 session 被回收', async () => {
    const forwarder = createMcpForwarder({
      host: '127.0.0.1',
      port: Number(new URL(base).port),
      secret: runtime.config.auth.localSecret
    });
    await forwarder.preflight();
    const init = await forwarder.forward(initializeBody(41));
    expect(init).toBeTruthy();
    const sid = forwarder.sessionId();
    expect(sid).toBeTruthy();

    // 关闭前会话可用
    const before = await rawPost(
      `${base}/mcp`,
      {
        'Content-Type': 'application/json',
        Accept: ACCEPT,
        [SECRET_HEADER]: runtime.config.auth.localSecret,
        'Mcp-Session-Id': sid
      },
      JSON.stringify({ jsonrpc: '2.0', id: 42, method: 'tools/list' })
    );
    expect(before.status).toBe(200);

    await forwarder.close();

    const after = await rawPost(
      `${base}/mcp`,
      {
        'Content-Type': 'application/json',
        Accept: ACCEPT,
        [SECRET_HEADER]: runtime.config.auth.localSecret,
        'Mcp-Session-Id': sid
      },
      JSON.stringify({ jsonrpc: '2.0', id: 43, method: 'tools/list' })
    );
    expect(after.status).toBe(404);
  });

  it('stdio 桥：密钥错误时预检抛错，交给调用方降级', async () => {
    const forwarder = createMcpForwarder({
      host: '127.0.0.1',
      port: Number(new URL(base).port),
      secret: 'f'.repeat(64)
    });
    await expect(forwarder.preflight()).rejects.toThrow(/401/);
  });

  it('stdio 桥：daemon 未监听时预检抛错', async () => {
    const forwarder = createMcpForwarder({
      host: '127.0.0.1',
      port: 1,
      secret: runtime.config.auth.localSecret
    });
    await expect(forwarder.preflight()).rejects.toThrow(/无法连接 daemon/);
  });

  it('stdio 桥：非法 JSON 回一条 JSON-RPC 错误而不是静默', async () => {
    const forwarder = createMcpForwarder({
      host: '127.0.0.1',
      port: Number(new URL(base).port),
      secret: runtime.config.auth.localSecret
    });
    const out = await forwarder.forward('{ not json');
    expect(out).toBeTruthy();
    expect(JSON.parse(out!).error.message).toContain('Invalid JSON-RPC');
  });
});
