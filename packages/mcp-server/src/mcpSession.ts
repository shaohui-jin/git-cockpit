import type { Runtime } from './runtime.ts';

export interface McpRepoBinding {
  repoId: number;
  repoPath: string;
  boundAt: string;
  generation: number;
}

/** MCP 连接私有的仓库上下文；不写入 SQLite，也不与其他连接共享。 */
export class McpSessionContext {
  private binding: McpRepoBinding | null = null;
  private generation = 0;

  constructor(private readonly runtime: Runtime) {}

  getBinding(): McpRepoBinding | null {
    return this.binding ? { ...this.binding } : null;
  }

  async select(input: { repoId?: number; repoPath?: string; clear?: boolean }): Promise<McpRepoBinding | null> {
    if (input.clear) {
      if (input.repoId !== undefined || input.repoPath) {
        throw new Error('clear=true 不能同时传 repoId 或 repoPath');
      }
      this.binding = null;
      this.generation += 1;
      return null;
    }

    if (input.repoId === undefined && !input.repoPath) {
      throw new Error('需要提供 repoId 或 repoPath；如需清除绑定请传 clear=true');
    }
    if (input.repoId !== undefined && input.repoPath) {
      throw new Error('repoId 与 repoPath 只能传一个');
    }

    const handle =
      input.repoId !== undefined
        ? await this.runtime.repoManager.getById(input.repoId)
        : await this.runtime.repoManager.open(input.repoPath!);
    if (!handle) {
      throw new Error(`仓库不存在: id=${input.repoId}`);
    }

    this.generation += 1;
    this.binding = {
      repoId: handle.record.id,
      repoPath: handle.service.repoPath,
      boundAt: new Date().toISOString(),
      generation: this.generation
    };
    return this.getBinding();
  }
}
