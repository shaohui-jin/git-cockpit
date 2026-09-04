import * as path from 'node:path';
import { GitOperationError } from './types.ts';

function normalizeRepoPath(p: string): string {
  let n = path.resolve(p.trim());
  if (process.platform === 'win32') n = n.toLowerCase();
  return n;
}

/** 名单为空 = 不限制。非空时仓库根必须等于某条，或落在某条目录之下。 */
export function isRepoAllowed(repoPath: string, allowedRepos: string[] | undefined): boolean {
  const list = (allowedRepos ?? []).map((p) => p.trim()).filter(Boolean);
  if (list.length === 0) return true;
  const target = normalizeRepoPath(repoPath);
  return list.some((entry) => {
    const root = normalizeRepoPath(entry);
    return target === root || target.startsWith(root + path.sep);
  });
}

export function assertRepoAllowed(repoPath: string, allowedRepos: string[] | undefined): void {
  if (isRepoAllowed(repoPath, allowedRepos)) return;
  throw new GitOperationError(
    `仓库不在 allowedRepos 白名单内：${path.resolve(repoPath)}`,
    'REPO_NOT_ALLOWED'
  );
}
