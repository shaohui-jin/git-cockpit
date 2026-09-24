import type { NextStep } from './types.ts';

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function compact(args: Record<string, unknown>): Record<string, unknown> | undefined {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    if (v !== undefined && v !== '') out[k] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

function isWritePreview(result: unknown): boolean {
  const r = asRecord(result);
  return r?.dryRun === true && typeof r.command === 'string';
}

/**
 * 高信号、少条数。附在 MCP 摘要对象上，不把现有结果改成新信封。
 */
export function suggestNext(
  tool: string,
  result: unknown,
  args: Record<string, unknown> = {},
  meta: { dryRun?: boolean } = {}
): NextStep[] {
  const dryRun = meta.dryRun === true || args.dryRun === true || isWritePreview(result);
  const row = asRecord(result);

  switch (tool) {
    case 'git_status': {
      const op = row?.operation;
      if (op === 'merge') return [{ tool: 'git_merge_continue' }];
      if (op === 'rebase') return [{ tool: 'git_rebase_continue' }];
      if (op === 'cherry-pick') {
        return [{ tool: 'git_cherry_pick_continue' }, { tool: 'git_cherry_pick_abort' }];
      }
      const unstaged = Array.isArray(row?.unstaged) ? row.unstaged : [];
      const untracked = Array.isArray(row?.untracked) ? row.untracked : [];
      if (unstaged.length || untracked.length) {
        return [{ tool: 'git_add', args: { dryRun: true } }];
      }
      const staged = Array.isArray(row?.staged) ? row.staged : [];
      if (staged.length) return [{ tool: 'git_commit', args: { dryRun: true } }];
      return [];
    }
    case 'git_add':
      if (dryRun) return [];
      return [{ tool: 'git_commit', args: { dryRun: true } }];
    case 'git_commit':
      if (dryRun) return [];
      return [{ tool: 'git_status' }];
    case 'git_merge_preview':
    case 'git_merge_rehearse': {
      const into = row?.into ?? args.into;
      const from = row?.from ?? args.from;
      const situation = typeof row?.situation === 'string' ? row.situation : '';
      const temp = asRecord(row?.pairTempBranch) ?? asRecord(row?.tempBranch);
      const recovered = asRecord(row?.recoveredPair);
      if (situation === 'already_merged') return [];
      if (situation === 'temp_local' || (situation === 'looking_at_temp' && temp?.remote !== true)) {
        return [{ tool: 'git_push', args: compact({ branch: temp?.name, dryRun: true }) }];
      }
      if (situation === 'temp_remote' || situation === 'looking_at_temp') {
        return [
          {
            tool: 'git_mr_prepare',
            args: compact({
              into: recovered?.into ?? into,
              from: recovered?.from ?? from,
              sourceBranch: temp?.name
            })
          }
        ];
      }
      if (row?.clean === true) {
        return [{ tool: 'git_apply_resolve', args: compact({ into, from, dryRun: true }) }];
      }
      return [];
    }
    case 'git_merge_survey': {
      if (typeof row?.jobId === 'string' && row.jobId) {
        return [{ tool: 'git_job_get', args: { id: row.jobId } }];
      }
      const cells = Array.isArray(row?.cells) ? row.cells : [];
      const conflict = cells
        .map(asRecord)
        .find(
          (c) => c && (c.outcome === 'conflicts' || (Array.isArray(c.conflictPaths) && c.conflictPaths.length > 0))
        );
      if (conflict) {
        return [{ tool: 'git_merge_rehearse', args: compact({ into: conflict.into, from: conflict.from }) }];
      }
      return [];
    }
    case 'git_apply_resolve':
      if (dryRun) return [];
      return [
        {
          tool: 'git_mr_prepare',
          args: compact({
            into: row?.into ?? args.into,
            from: args.from ?? row?.from,
            sourceBranch: row?.tempBranch
          })
        }
      ];
    case 'git_mr_prepare': {
      const gate = asRecord(row?.mergeGate);
      if (gate?.ok !== true) {
        if (gate?.code === 'TEMP_NOT_PUSHED') {
          return [
            { tool: 'git_push', args: compact({ branch: args.sourceBranch ?? row?.sourceBranch, dryRun: true }) }
          ];
        }
        if (gate?.code === 'NOT_LANDED') {
          return [
            {
              tool: 'git_apply_resolve',
              args: compact({ into: args.into ?? row?.targetBranch, from: args.from, dryRun: true })
            }
          ];
        }
        return [];
      }
      const tmpl = asRecord(row?.template);
      return [
        {
          tool: 'git_mr_create',
          args: compact({
            into: args.into ?? row?.into,
            from: args.from ?? row?.from,
            sourceBranch: args.sourceBranch ?? row?.sourceBranch,
            dryRun: true,
            ...(tmpl?.enabled ? { fields: {} } : {})
          })
        }
      ];
    }
    case 'git_mr_create':
      return [];
    case 'git_job_list': {
      const jobs = Array.isArray(row?.jobs) ? row.jobs : [];
      const running = jobs.map(asRecord).find((j) => j?.status === 'running' || j?.status === 'queued');
      if (running && typeof running.id === 'string') {
        return [{ tool: 'git_job_get', args: { id: running.id } }];
      }
      return [];
    }
    case 'git_job_get':
      if (row?.status === 'running' || row?.status === 'queued') {
        return [{ tool: 'git_job_get', args: compact({ id: args.id ?? row.id }) }];
      }
      return [];
    default:
      if (dryRun) return [];
      return [];
  }
}
