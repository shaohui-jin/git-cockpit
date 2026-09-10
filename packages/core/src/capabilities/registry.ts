import type { RiskLevel } from '../types.ts';
import type { Capability } from './types.ts';

/**
 * 进程内 Capability 注册表。mcp-server 加载 tools/index 时 registerAll(TOOL_DEFS)；
 * 权限等级优先读这里，避免「加工具改三处」。
 */
export class CapabilityRegistry {
  private readonly items = new Map<string, Capability>();

  register(cap: Capability): void {
    this.items.set(cap.name, cap);
  }

  registerAll(caps: readonly Capability[]): void {
    for (const cap of caps) this.register(cap);
  }

  list(): Capability[] {
    return [...this.items.values()];
  }

  get(name: string): Capability | undefined {
    return this.items.get(name);
  }

  riskLevels(): Record<string, RiskLevel> {
    const out: Record<string, RiskLevel> = {};
    for (const cap of this.items.values()) out[cap.name] = cap.risk;
    return out;
  }

  /** 仅测试用：避免 vitest 同进程污染 PermissionManager */
  reset(): void {
    this.items.clear();
  }
}

const globalRegistry = new CapabilityRegistry();

export function getCapabilityRegistry(): CapabilityRegistry {
  return globalRegistry;
}
