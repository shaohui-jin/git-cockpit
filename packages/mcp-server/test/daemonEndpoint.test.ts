/**
 * 回归测试：daemon 地址解析必须在 start / mcp / bridge 三处一致。
 *
 * 背景：`start` 用配置里的 host，而 `mcp` 曾硬编码 127.0.0.1，
 * 配置成局域网地址时探活必然失败；桥接拼 URL 也没处理 IPv6 字面量
 * （`http://::1:3000/mcp` 是非法 URL）。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '@shaohui_jin/git-cockpit-core';
import type { GitCockpitConfig } from '@shaohui_jin/git-cockpit-core';
import { formatDaemonUrl, resolveDaemonEndpoint } from '../src/daemonEndpoint.ts';

function configWith(server: Partial<GitCockpitConfig['server']>): GitCockpitConfig {
  return { ...DEFAULT_CONFIG, server: { ...DEFAULT_CONFIG.server, ...server } };
}

describe('resolveDaemonEndpoint', () => {
  afterEach(() => {
    delete process.env.GIT_COCKPIT_HOST;
    delete process.env.GIT_COCKPIT_PORT;
  });

  it('默认取配置里的 host 与 port，start 与 mcp 因此一致', () => {
    const endpoint = resolveDaemonEndpoint(configWith({ host: '192.168.1.20', port: 3100 }));
    expect(endpoint).toMatchObject({
      host: '192.168.1.20',
      port: 3100,
      baseUrl: 'http://192.168.1.20:3100',
      healthUrl: 'http://192.168.1.20:3100/api/health',
      mcpUrl: 'http://192.168.1.20:3100/mcp'
    });
  });

  it('环境变量优先于配置', () => {
    process.env.GIT_COCKPIT_HOST = '127.0.0.1';
    process.env.GIT_COCKPIT_PORT = '4000';
    const endpoint = resolveDaemonEndpoint(configWith({ host: '192.168.1.20', port: 3100 }));
    expect(endpoint.host).toBe('127.0.0.1');
    expect(endpoint.port).toBe(4000);
  });

  it('IPv6 字面量必须加方括号，否则 URL 非法', () => {
    expect(formatDaemonUrl('::1', 3000, '/mcp')).toBe('http://[::1]:3000/mcp');
    expect(resolveDaemonEndpoint(configWith({ host: '::1', port: 3000 })).healthUrl).toBe(
      'http://[::1]:3000/api/health'
    );
  });

  it('已带方括号的 host 不重复包裹', () => {
    expect(formatDaemonUrl('[::1]', 3000, '/mcp')).toBe('http://[::1]:3000/mcp');
  });
});
