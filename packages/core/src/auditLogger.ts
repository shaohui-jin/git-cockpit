import { DatabaseSync } from 'node:sqlite';
import type { LoggingConfig, OperationLogEntry, OperationResult, OperationSource } from './types.js';

/**
 * 操作审计日志：写入 SQLite，支持脱敏与分页查询。
 * 记录每次操作的时间、来源、工具、参数（脱敏）、结果、耗时。
 */
export class AuditLogger {
  private readonly redactKeys: string[];

  constructor(
    private readonly db: DatabaseSync,
    logging: Pick<LoggingConfig, 'redact'>
  ) {
    this.redactKeys = (logging.redact ?? []).map((k) => k.toLowerCase());
  }

  /** 递归脱敏：键名包含配置的敏感词则替换值 */
  redact(value: unknown, key = ''): unknown {
    const normalizedKey = key.toLowerCase();
    if (this.redactKeys.some((k) => k && normalizedKey.includes(k))) {
      return '[REDACTED]';
    }
    if (Array.isArray(value)) {
      return value.map((v, i) => this.redact(v, `${normalizedKey}[${i}]`));
    }
    if (value !== null && typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value)) {
        out[k] = this.redact(v, normalizedKey ? `${normalizedKey}.${k}` : k);
      }
      return out;
    }
    return value;
  }

  /** 记录一条操作日志 */
  log(entry: OperationLogEntry): void {
    const params = JSON.stringify(this.redact(entry.params ?? {}));
    this.db
      .prepare(
        `INSERT INTO operations (timestamp, source, tool, repo_path, params, result, error, duration_ms, dry_run)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        entry.timestamp,
        entry.source,
        entry.tool,
        entry.repoPath ?? null,
        params,
        entry.result,
        entry.error ?? null,
        entry.durationMs,
        entry.dryRun ? 1 : 0
      );
  }

  /** 分页查询操作日志（最新的在前） */
  list(options: { limit?: number; offset?: number; tool?: string; source?: OperationSource } = {}): OperationLogEntry[] {
    const where: string[] = [];
    const params: (string | number)[] = [];
    if (options.tool) {
      where.push('tool = ?');
      params.push(options.tool);
    }
    if (options.source) {
      where.push('source = ?');
      params.push(options.source);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const limit = Math.min(Math.max(options.limit ?? 100, 1), 500);
    const offset = Math.max(options.offset ?? 0, 0);
    params.push(limit, offset);

    const rows = this.db
      .prepare(`SELECT * FROM operations ${whereSql} ORDER BY id DESC LIMIT ? OFFSET ?`)
      .all(...params) as Record<string, unknown>[];

    return rows.map((r) => this.rowToEntry(r));
  }

  private rowToEntry(r: Record<string, unknown>): OperationLogEntry {
    let params: Record<string, unknown> = {};
    try {
      params = JSON.parse(String(r.params ?? '{}')) as Record<string, unknown>;
    } catch {
      params = {};
    }
    return {
      timestamp: String(r.timestamp),
      source: r.source as OperationSource,
      tool: String(r.tool),
      repoPath: r.repo_path ? String(r.repo_path) : '',
      params,
      result: (r.result ?? 'error') as OperationResult,
      error: r.error ? String(r.error) : null,
      durationMs: Number(r.duration_ms ?? 0),
      dryRun: Boolean(r.dry_run)
    };
  }
}