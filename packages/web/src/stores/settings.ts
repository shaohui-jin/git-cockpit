import { defineStore } from 'pinia';
import * as api from '@/api/client';
import type { PermissionsPayload, ToolSummary } from '@/api/types';

interface State {
  permissions: PermissionsPayload | null;
  tools: ToolSummary[];
  loading: boolean;
  saving: boolean;
  error: string | null;
}

/** 权限/设置：工具开关与审批规则 */
export const useSettingsStore = defineStore('settings', {
  state: (): State => ({
    permissions: null,
    tools: [],
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
      } catch (err) {
        this.error = err instanceof Error ? err.message : String(err);
      } finally {
        this.loading = false;
      }
    },
    async save(patch: Partial<PermissionsPayload>): Promise<void> {
      if (!this.permissions) return;
      this.saving = true;
      this.error = null;
      try {
        await api.updateSettings(patch);
        this.permissions = { ...this.permissions, ...patch };
      } catch (err) {
        this.error = err instanceof Error ? err.message : String(err);
        throw err;
      } finally {
        this.saving = false;
      }
    }
  }
});