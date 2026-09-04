/**
 * RepoManager：GitService 实例池 + 已打开仓库存储。
 * - 每个仓库根路径对应一个 GitService 实例（内含串行队列），Web 与 MCP 共用，
 *   保证"唯一后端"与锁全局有效；
 * - 打开仓库时校验合法性（GitService.open），并在 SQLite 中记录最近列表；
 * - 监听 Git 变更事件并转发到全局 eventBus，驱动前端实时刷新。
 */
import { EventEmitter } from 'node:events';
import * as path from 'node:path';
import {
  assertRepoAllowed,
  GitService,
  RepoNotFoundError,
  RepoStore
} from '@shaohui_jin/git-cockpit-core';
import type { GitCockpitConfig, OpenedRepo } from '@shaohui_jin/git-cockpit-core';

export interface RepoHandle {
  service: GitService;
  record: OpenedRepo;
}

export interface RepoManagerOptions {
  repoStore: RepoStore;
  eventBus: EventEmitter;
  getConfig: () => GitCockpitConfig;
}

export class RepoManager {
  /** repo 根路径（规范化绝对路径） -> repoId */
  private readonly pathToId = new Map<string, number>();
  private readonly idToService = new Map<number, GitService>();
  private readonly eventBus: EventEmitter;

  constructor(private readonly options: RepoManagerOptions) {
    this.eventBus = options.eventBus;
    // 为历史记录建立 路径->id 索引（服务实例懒创建）
    for (const repo of options.repoStore.list()) {
      this.pathToId.set(normalizePath(repo.path), repo.id);
    }
  }

  list(): (OpenedRepo & { available: boolean })[] {
    return this.options.repoStore.list().map((r) => ({
      ...r,
      available: r.path === '' || true
    }));
  }

  /** 取最近打开的仓库（懒创建服务） */
  async getCurrent(): Promise<RepoHandle | null> {
    const record = this.options.repoStore.list()[0];
    return record ? this.getByRecord(record) : null;
  }

  /** 按 id 取仓库（懒创建服务） */
  async getById(id: number): Promise<RepoHandle | null> {
    const record = this.options.repoStore.getById(id);
    if (!record) return null;
    try {
      return await this.getByRecord(record);
    } catch (err) {
      if (err instanceof Error && /NOT_A_GIT_REPO|REPO_NOT_FOUND/.test(err.message)) {
        return null;
      }
      throw err;
    }
  }

  /** 打开仓库：校验并记录；重复打开返回既有实例 */
  async open(repoPath: string): Promise<RepoHandle> {
    const service = await GitService.open(repoPath);
    assertRepoAllowed(service.repoPath, this.options.getConfig().git.allowedRepos);
    const root = service.repoPath;
    const key = normalizePath(root);
    const existingId = this.pathToId.get(key);
    if (existingId !== undefined && existingId !== 0) {
      const record = this.options.repoStore.getById(existingId);
      if (record) {
        this.options.repoStore.open(root); // 刷新最近打开时间
        this.idToService.set(record.id, service);
        this.attach(service);
        return { service, record: this.options.repoStore.getById(record.id) ?? record };
      }
    }
    const record = this.options.repoStore.open(root);
    this.pathToId.set(key, record.id);
    this.idToService.set(record.id, service);
    this.attach(service);
    return { service, record };
  }

  /** 激活仓库：刷新最近打开时间，驱动「最近打开」列表重排到首位；仓库不存在返回 null */
  activate(id: number): OpenedRepo | null {
    const record = this.options.repoStore.getById(id);
    if (!record) return null;
    this.options.repoStore.open(record.path); // 同路径 open 仅更新 last_opened_at
    return this.options.repoStore.getById(id) ?? record;
  }

  /** 按路径取服务，未打开则报错（避免隐式副作用） */
  getByPath(repoPath: string): RepoHandle {
    const key = normalizePath(repoPath);
    const id = this.pathToId.get(key);
    if (id !== undefined && id !== 0) {
      const record = this.options.repoStore.getById(id);
      if (record) {
        const service = this.idToService.get(id);
        if (service) {
          assertRepoAllowed(service.repoPath, this.options.getConfig().git.allowedRepos);
          return { service, record };
        }
      }
    }
    throw new RepoNotFoundError(`仓库未打开: ${repoPath}。请先打开仓库（POST /api/repos/open）。`);
  }

  /** 关闭：仅从内存服务池移除；保留历史记录 */
  close(id: number): void {
    const record = this.options.repoStore.getById(id);
    if (record) this.pathToId.delete(normalizePath(record.path));
    const svc = this.idToService.get(id);
    if (svc) svc.removeAllListeners('changed');
    this.idToService.delete(id);
  }

  /** 从历史记录中删除并关闭 */
  remove(id: number): void {
    this.close(id);
    this.options.repoStore.remove(id);
  }

  dispose(): void {
    for (const id of [...this.idToService.keys()]) this.close(id);
  }

  /** 按记录取句柄；服务缺失时（合法）创建并缓存 */
  private async getByRecord(record: OpenedRepo): Promise<RepoHandle> {
    let service = this.idToService.get(record.id);
    if (!service) {
      service = await GitService.open(record.path);
      assertRepoAllowed(service.repoPath, this.options.getConfig().git.allowedRepos);
      this.pathToId.set(normalizePath(service.repoPath), record.id);
      this.idToService.set(record.id, service);
      this.attach(service);
    } else {
      assertRepoAllowed(service.repoPath, this.options.getConfig().git.allowedRepos);
    }
    return { service, record };
  }

  private attach(service: GitService): void {
    service.on('changed', (payload: { repoPath: string; command: string[] }) => {
      this.eventBus.emit('repo-changed', {
        repoPath: payload.repoPath,
        command: payload.command,
        at: new Date().toISOString()
      });
    });
  }
}

function normalizePath(p: string): string {
  let normalized = path.resolve(p);
  if (process.platform === 'win32') normalized = normalized.toLowerCase();
  return normalized;
}