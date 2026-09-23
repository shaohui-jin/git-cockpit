import type { GitCockpitConfig } from '@shaohui_jin/git-cockpit-core';

export interface DaemonEndpoint {
  host: string;
  port: number;
  baseUrl: string;
  healthUrl: string;
  mcpUrl: string;
}

export function formatDaemonUrl(host: string, port: number, path = ''): string {
  const authority = `${host.includes(':') && !host.startsWith('[') ? `[${host}]` : host}:${port}`;
  return `http://${authority}${path}`;
}

/** 统一解析 daemon 地址，start/mcp/bridge 必须使用同一套优先级。 */
export function resolveDaemonEndpoint(config: GitCockpitConfig): DaemonEndpoint {
  const port = Number(process.env.GIT_COCKPIT_PORT) || config.server.port;
  const host = process.env.GIT_COCKPIT_HOST ?? config.server.host;
  return {
    host,
    port,
    baseUrl: formatDaemonUrl(host, port),
    healthUrl: formatDaemonUrl(host, port, '/api/health'),
    mcpUrl: formatDaemonUrl(host, port, '/mcp')
  };
}
