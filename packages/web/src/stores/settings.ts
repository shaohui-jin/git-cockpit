import { defineStore } from 'pinia';
import * as api from '@/api/client';
import type { PermissionsPayload, ToolSummary } from '@/api/types';

interface State {
  permissions: PermissionsPayload | null;
  tools: ToolSummary[];
  githubTokenSet: boolean;
  loading: boolean;
  saving: boolean;
  error: string | null;
}

/** 权限/设置：工具开关、审批规则、MR Token */
export const useSettingsStore = defineStore('settings', {
  state: (): State => ({
    permissions: null,
    tools: [],
    githubTokenSet: false,
    loading: false,
    saving: false,
    error: null
  }),
  actions: {
    async load(): Promise<void> {
      this.loading = true;
      this.error = null;
      try {
        const data = await api.getSettings();
        this.permissions = data.permissions;
        this.tools = data.tools;
        this.githubTokenSet = Boolean(data.mr?.githubTokenSet);
      } catch (err) {
        this.error = err instanceof Error ? err.message : String(err);
      } finally {
        this.loading = false;
      }
    },
    async save(body: { permissions?: Partial<PermissionsPayload>; mr?: { githubToken?: string } }): Promise<void> {
      this.saving = true;
      this.error = null;
      try {
        const res = await api.updateSettings(body);
        if (body.permissions && this.permissions) {
          this.permissions = { ...this.permissions, ...body.permissions };
        }
        if (res.mr) this.githubTokenSet = res.mr.githubTokenSet;
        else if (body.mr?.githubToken !== undefined) {
          this.githubTokenSet = body.mr.githubToken.trim().length > 0;
        }
      } catch (err) {
        this.error = err instanceof Error ? err.message : String(err);
        throw err;
      } finally {
        this.saving = false;
      }
    }
  }
});
