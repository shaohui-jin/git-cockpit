import { defineStore } from 'pinia';
import * as api from '@/api/client';
import type { CloneJobDetail, CloneJobSummary, JobProgressPayload, JobStatus } from '@/api/types';

interface JobRow extends CloneJobSummary {
  logs: string[];
}

interface State {
  jobs: JobRow[];
  loading: boolean;
}

function upsert(list: JobRow[], row: JobRow): JobRow[] {
  const i = list.findIndex((j) => j.id === row.id);
  if (i < 0) return [row, ...list];
  const next = list.slice();
  next[i] = row;
  return next.sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
}

export const useJobsStore = defineStore('jobs', {
  state: (): State => ({
    jobs: [],
    loading: false
  }),
  getters: {
    runningCount(state): number {
      return state.jobs.filter((j) => j.status === 'running').length;
    }
  },
  actions: {
    async load(): Promise<void> {
      this.loading = true;
      try {
        const { jobs } = await api.listJobs();
        const prev = new Map(this.jobs.map((j) => [j.id, j]));
        this.jobs = jobs.map((j) => ({
          ...j,
          logs: prev.get(j.id)?.logs ?? (j.tail ? j.tail.split('\n') : [])
        }));
      } finally {
        this.loading = false;
      }
    },
    async loadDetail(id: string): Promise<CloneJobDetail | null> {
      const { job } = await api.getJob(id);
      this.applyDetail(job);
      return job;
    },
    applyDetail(job: CloneJobDetail): void {
      this.jobs = upsert(this.jobs, {
        ...job,
        logCount: job.logs.length,
        tail: job.logs.slice(-3).join('\n'),
        logs: job.logs
      });
    },
    onProgress(p: JobProgressPayload): void {
      const cur = this.jobs.find((j) => j.id === p.id);
      const logs = cur?.logs ? cur.logs.slice() : [];
      if (p.chunk) logs.push(p.chunk);
      const status: JobStatus = p.status;
      this.jobs = upsert(this.jobs, {
        id: p.id,
        kind: 'clone',
        status,
        url: p.url,
        destDir: p.destDir,
        error: p.error,
        startedAt: p.startedAt,
        finishedAt: p.finishedAt,
        repoId: p.repoId,
        logCount: p.logCount,
        tail: logs.slice(-3).join(''),
        logs
      });
    }
  }
});
