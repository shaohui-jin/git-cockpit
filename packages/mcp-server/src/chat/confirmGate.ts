import { createHash, randomUUID } from 'node:crypto';

export interface ConfirmPreview {
  command: string;
  args: string[];
  affectedFiles: string[];
  note?: string;
  risk?: string;
}

export interface ConfirmTicket {
  token: string;
  tool: string;
  repoPath: string;
  args: Record<string, unknown>;
  preview: ConfirmPreview;
  createdAt: number;
  expiresAt: number;
}

const TTL_MS = 5 * 60 * 1000;

function previewFingerprint(preview: ConfirmPreview): string {
  return JSON.stringify({
    command: preview.command,
    args: preview.args,
    affectedFiles: [...preview.affectedFiles].sort()
  });
}

function argsHash(tool: string, repoPath: string, args: Record<string, unknown>): string {
  const stable = JSON.stringify({ tool, repoPath, args });
  return createHash('sha256').update(stable).digest('hex');
}

export class ConfirmGate {
  private readonly tickets = new Map<string, ConfirmTicket>();

  issue(input: Omit<ConfirmTicket, 'token' | 'createdAt' | 'expiresAt'>): ConfirmTicket {
    this.gc();
    const now = Date.now();
    const token = `${randomUUID()}.${argsHash(input.tool, input.repoPath, input.args)}`;
    const ticket: ConfirmTicket = {
      ...input,
      token,
      createdAt: now,
      expiresAt: now + TTL_MS
    };
    this.tickets.set(token, ticket);
    return ticket;
  }

  peek(token: string): ConfirmTicket | null {
    this.gc();
    return this.tickets.get(token) ?? null;
  }

  /** 取出并作废。调用方负责重跑干跑比对后再执行。 */
  take(token: string): ConfirmTicket | null {
    this.gc();
    const ticket = this.tickets.get(token);
    if (!ticket) return null;
    this.tickets.delete(token);
    return ticket;
  }

  previewsMatch(a: ConfirmPreview, b: ConfirmPreview): boolean {
    return previewFingerprint(a) === previewFingerprint(b);
  }

  private gc(): void {
    const now = Date.now();
    for (const [k, v] of this.tickets) {
      if (v.expiresAt <= now) this.tickets.delete(k);
    }
  }
}

export function previewFromExecResult(result: unknown): ConfirmPreview {
  const row = result && typeof result === 'object' ? (result as Record<string, unknown>) : {};
  const files = Array.isArray(row.affectedFiles) ? row.affectedFiles.map((f) => String(f)) : [];
  return {
    command: typeof row.command === 'string' ? row.command : '',
    args: Array.isArray(row.args) ? row.args.map((a) => String(a)) : [],
    affectedFiles: files,
    note: typeof row.note === 'string' ? row.note : undefined,
    risk: typeof row.risk === 'string' ? row.risk : undefined
  };
}
