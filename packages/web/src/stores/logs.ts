import { defineStore } from 'pinia';
import * as api from '@/api/client';
import type { LogEntry } from '@/api/types';

interface State {
  logs: LogEntry[];
  loading: boolean;
  error: string | null;
  limit: number;
  toolFilter: string;
}

/** 操作日志（Web / MCP / CLI 全部来源，脱敏展示） */
export const useLogsStore = defineStore('logs', {
  state: (): State => ({
    logs: [],
    loading: false,
    error: null,
    limit: 50,
    toolFilter: ''
  }),
  actions: {
    async load(): Promise<void> {
      this.loading = true;
      this.error = null;
      try {
        const { logs } = await api.listLogs({
          limit: this.limit,
          tool: this.toolFilter || undefined
        });
        this.logs = logs;
      } catch (err) {
        this.error = err instanceof Error ? err.message : String(err);
      } finally {
        this.loading = false;
      }
    }
  }
});