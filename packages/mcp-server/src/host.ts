import { GitOperationError } from '@shaohui_jin/git-cockpit-core';
import type { CapabilityHost } from '@shaohui_jin/git-cockpit-core';
import { collectRepoOverviews } from './overview.ts';
import type { Runtime } from './runtime.ts';

/** 把进程壳 Runtime 收成 core executor 认识的 CapabilityHost */
export function hostFromRuntime(runtime: Runtime): CapabilityHost {
  return {
    config: runtime.config,
    permissions: runtime.permissions,
    auditLogger: runtime.auditLogger,
    eventBus: runtime.eventBus,
    jobs: runtime.jobs,
    async resolveRepo({ repoId, repoPath, argsPath }) {
      if (repoId !== undefined) {
        const handle = await runtime.repoManager.getById(repoId);
        if (handle) return { git: handle.service, repoPath: handle.service.repoPath };
        throw new GitOperationError(`仓库不存在: id=${repoId}`, 'REPO_NOT_FOUND');
      }
      if (repoPath) {
        const handle = runtime.repoManager.getByPath(repoPath);
        return { git: handle.service, repoPath: handle.service.repoPath };
      }
      if (argsPath) {
        const handle = await runtime.repoManager.open(argsPath);
        return { git: handle.service, repoPath: handle.service.repoPath };
      }
      const current = await runtime.repoManager.getCurrent();
      if (!current) {
        throw new GitOperationError('尚未打开任何仓库。请先打开仓库或提供 repoPath 参数。', 'NO_ACTIVE_REPO');
      }
      return { git: current.service, repoPath: current.service.repoPath };
    },
    listOverviews: () => collectRepoOverviews(runtime)
  };
}
