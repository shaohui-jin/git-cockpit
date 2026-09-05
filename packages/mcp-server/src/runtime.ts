/**
 * Runtime：mcp-server 共享运行时上下文。
 * - 唯一数据库实例、审计日志、权限管理器、仓库存储与其管理模式；
 * - eventBus 承载 Git 变更事件（changed / log），被 Web SSE 与订阅者消费。
 */
import { EventEmitter } from 'node:events';
import type { DatabaseSync } from 'node:sqlite';
import {
  AuditLogger,
  PermissionManager,
  RepoStore,
  openDatabase,
  trustSystemCa
} from '@shaohui_jin/git-cockpit-core';
import type { GitCockpitConfig } from '@shaohui_jin/git-cockpit-core';
import { ConfigStore } from './config.ts';
import { RepoManager } from './repoManager.ts';

export interface RuntimeOptions {
  dataDir?: string;
  configOverrides?: ConstructorParameters<typeof ConfigStore>[1];
  db?: DatabaseSync;
}

export interface Runtime {
  configStore: ConfigStore;
  config: GitCockpitConfig;
  db: DatabaseSync;
  auditLogger: AuditLogger;
  permissions: PermissionManager;
  repoStore: RepoStore;
  repoManager: RepoManager;
  /** 全局事件总线：'repo-changed' | 'log' */
  eventBus: EventEmitter;
}

/** 创建运行时（唯一后端共享）；须在进程生命周期内调用一次 */
export function createRuntime(options: RuntimeOptions = {}): Runtime {
  trustSystemCa();
  const configStore = new ConfigStore(options.dataDir ?? '~/.git-cockpit', options.configOverrides);
  const config = configStore.get();
  const db = options.db ?? openDatabase(config.storage.dataDir);
  const eventBus = new EventEmitter();
  eventBus.setMaxListeners(200);

  const auditLogger = new AuditLogger(db, config.logging);
  const permissions = new PermissionManager(config);
  const repoStore = new RepoStore(db);
  const repoManager = new RepoManager({ repoStore, eventBus, getConfig: () => configStore.get() });

  return {
    configStore,
    config,
    db,
    auditLogger,
    permissions,
    repoStore,
    repoManager,
    eventBus
  };
}

/** 关闭运行时占用的资源（数据库等） */
export function disposeRuntime(runtime: Runtime): void {
  try {
    runtime.eventBus.removeAllListeners();
    runtime.repoManager.dispose();
  } catch {
    /* ignore */
  }
  try {
    runtime.db.close();
  } catch {
    /* ignore */
  }
}