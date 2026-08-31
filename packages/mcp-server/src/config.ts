/**
 * 配置管理：默认值 <- 配置文件（config.json）合并（浅/深合并）。
 * 运行时通过 ConfigStore 读写，权限配置界面直接修改其内部状态并持久化。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { DEFAULT_CONFIG, expandHome, normalizeMrConfig } from '@shaohui_jin/git-cockpit-core';
import type { GitCockpitConfig, MrConfigRaw } from '@shaohui_jin/git-cockpit-core';

export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

/** 递归合并：target 上已存在的值优先保留，仅用 source 填充缺失字段与新增对象 */
function deepMerge<T>(target: T, source: unknown): T {
  if (source === null || source === undefined) return target;
  if (Array.isArray(source)) {
    return (source as unknown[]) as T;
  }
  if (typeof source === 'object' && typeof target === 'object' && target !== null) {
    const out = { ...(target as Record<string, unknown>) } as Record<string, unknown>;
    for (const [k, v] of Object.entries(source as Record<string, unknown>)) {
      if (v !== undefined) out[k] = deepMerge(out[k], v);
    }
    return out as T;
  }
  return source as T;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * ConfigStore：
 * - 配置存储在 <dataDir>/config.json；
 * - 数据目录默认 ~/.git-cockpit（支持 ~ 展开）。
 */
export class ConfigStore {
  private config: GitCockpitConfig;

  constructor(
    private readonly dataDir: string,
    overrides?: DeepPartial<GitCockpitConfig>
  ) {
    const dir = expandHome(dataDir);
    const file = path.join(dir, 'config.json');
    // 数据目录同时写入 storage.dataDir，保证数据库与配置存放在同一目录
    this.config = {
      ...this.load(file, overrides),
      storage: { dataDir: dir }
    };
  }

  private load(file: string, overrides?: DeepPartial<GitCockpitConfig>): GitCockpitConfig {
    let fileConfig: unknown = {};
    try {
      if (fs.existsSync(file)) {
        fileConfig = JSON.parse(fs.readFileSync(file, 'utf8'));
      }
    } catch (err) {
      // 配置文件损坏时回退默认（不阻断启动）
      console.warn(`[git-cockpit] 配置文件 ${file} 无法解析，已使用默认配置:`, (err as Error).message);
    }
    let merged = deepMerge(structuredClone(DEFAULT_CONFIG), fileConfig);
    if (overrides) merged = deepMerge(merged, overrides);
    merged.mr = normalizeMrConfig(merged.mr as MrConfigRaw);
    return merged;
  }

  get(): GitCockpitConfig {
    return this.config;
  }

  /** 合并并持久化；返回新配置 */
  update(patch: DeepPartial<GitCockpitConfig>): GitCockpitConfig {
    this.config = deepMerge(this.config, patch);
    this.config = { ...this.config, mr: normalizeMrConfig(this.config.mr as MrConfigRaw) };
    this.save();
    return this.config;
  }

  save(): void {
    const dir = expandHome(this.config.storage.dataDir);
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'config.json');
    fs.writeFileSync(file, JSON.stringify(this.config, null, 2), 'utf8');
  }

  /** 供日志/调试：仅返回脱敏后的配置快照（隐藏敏感键名） */
  snapshot(): Record<string, unknown> {
    const copy = structuredClone(this.config);
    const redact = (v: unknown): unknown => {
      if (isPlainObject(v)) {
        const out: Record<string, unknown> = {};
        for (const [k, val] of Object.entries(v)) {
          const lower = k.toLowerCase();
          if (/password|token|secret|authorization/i.test(lower)) out[k] = '[REDACTED]';
          else out[k] = redact(val);
        }
        return out;
      }
      if (Array.isArray(v)) return v.map(redact);
      return v;
    };
    return redact(copy) as Record<string, unknown>;
  }
}