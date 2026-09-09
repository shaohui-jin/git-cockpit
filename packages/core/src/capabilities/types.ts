import type { z } from 'zod';
import type { BackupResult } from '../backup.ts';
import type { GitService } from '../gitService.ts';
import type { JobEngine } from '../jobEngine.ts';
import type {
  GitCockpitConfig,
  OperationLogEntry,
  OperationSource,
  RepoOverview,
  RiskLevel
} from '../types.ts';

/** Agent 下一步：只给工具名和已填好的参数，不写自然语言。 */
export interface NextStep {
  tool: string;
  args?: Record<string, unknown>;
}

export interface CapabilityHandlerContext {
  source: OperationSource;
  git: GitService;
  repoPath: string;
  host: CapabilityHost;
}

/**
 * 进程壳注入的宿主。core 不认 Fastify Request。
 * 仓库解析优先级：repoId > 上下文 repoPath > args.repoPath > 最近打开。
 */
export interface CapabilityHost {
  config: GitCockpitConfig;
  permissions: {
    assertAllowed(toolName: string): void;
    getDryRunDefault(): boolean;
  };
  auditLogger: { log(entry: OperationLogEntry): void };
  eventBus: { emit(event: string, payload?: unknown): unknown };
  jobs: JobEngine;
  resolveRepo(input: {
    repoId?: number;
    repoPath?: string;
    argsPath?: string;
  }): Promise<{ git: GitService; repoPath: string }>;
  listOverviews(): Promise<RepoOverview[]>;
}

export interface Capability<TSchema extends z.ZodTypeAny = z.ZodTypeAny> {
  name: string;
  description: string;
  risk: RiskLevel;
  schema: TSchema;
  handler: (
    args: z.infer<TSchema> & { repoPath?: string; dryRun?: boolean },
    ctx: CapabilityHandlerContext
  ) => Promise<unknown>;
  /** false 时不解析仓库（任务列表、多仓脉搏） */
  needsRepo?: boolean;
}

export interface ExecutionContext {
  source: OperationSource;
  host: CapabilityHost;
  repoId?: number;
  repoPath?: string;
}

export interface ExecutionResult {
  tool: string;
  source: OperationSource;
  dryRun: boolean;
  success: boolean;
  result?: unknown;
  error?: {
    code: string;
    message: string;
    requiredApproval: boolean;
  };
  backupCreated?: BackupResult | null;
  durationMs: number;
  preview?: unknown;
  args?: Record<string, unknown>;
}
