import { computed, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { useRouter } from 'vue-router';
import * as api from '@/api/client';
import type { ToolExecResult, WritePreview } from '@/api/types';

export interface PendingAction {
  tool: string;
  params: Record<string, unknown>;
  preview: WritePreview | ToolExecResult | null;
}

/**
 * 通用写操作流程：dry-run 预览 → 确认对话框 → 真实执行。
 * 统一处理：权限拒绝（403 / requiredApproval 引导去设置开启与审批）、错误提示。
 */
export function useToolAction(repoId: () => number | null) {
  const router = useRouter();
  const confirmVisible = ref(false);
  const pending = ref<PendingAction | null>(null);
  const executing = ref(false);

  const canRun = computed(() => repoId() !== null);

  /** 先 dry-run 预览并弹确认框；权限被拒时给出明确引导 */
  async function previewAndConfirm(tool: string, params: Record<string, unknown> = {}): Promise<boolean> {
    const id = repoId();
    if (id === null) {
      ElMessage.warning('请先选择仓库');
      return false;
    }
    try {
      const exec = await api.runTool(id, tool, { ...params, dryRun: true });
      if (!exec.success) {
        handleFailure(exec);
        return false;
      }
      pending.value = {
        tool,
        params,
        preview: (exec.preview ?? exec.result) as WritePreview | ToolExecResult | null
      };
      confirmVisible.value = true;
      return true;
    } catch (err) {
      handleError(err);
      return false;
    }
  }

  /** 用户确认后执行真实操作 */
  async function executeConfirmed(): Promise<ToolExecResult | null> {
    const id = repoId();
    const action = pending.value;
    if (id === null || !action) return null;
    executing.value = true;
    confirmVisible.value = false;
    try {
      const exec = await api.runTool(id, action.tool, action.params);
      if (!exec.success) {
        handleFailure(exec);
        return exec;
      }
      if (exec.backupCreated) {
        ElMessage.success(`${action.tool} 执行成功（已自动备份：${exec.backupCreated.branch ?? '分支'}${exec.backupCreated.stashRef ? ` / ${exec.backupCreated.stashRef}` : ''}）`);
      } else {
        ElMessage.success(`${action.tool} 执行成功`);
      }
      return exec;
    } catch (err) {
      handleError(err);
      return null;
    } finally {
      executing.value = false;
      pending.value = null;
    }
  }

  function cancel(): void {
    confirmVisible.value = false;
    pending.value = null;
  }

  function handleFailure(exec: ToolExecResult): void {
    if (exec.error?.code === 'PERMISSION_DENIED') {
      if (exec.error.requiredApproval) {
        ElMessageBox.confirm(
          `操作 ${exec.tool} 属于高风险操作，当前默认禁用，需要在设置中开启后才能执行。是否前往设置？`,
          '需要审批',
          { confirmButtonText: '去开启', cancelButtonText: '取消', type: 'warning' }
        )
          .then(() => router.push({ path: '/settings', query: { tab: 'git' } }))
          .catch(() => undefined);
      } else {
        ElMessage.error(exec.error?.message ?? '操作被拒绝');
      }
      return;
    }
    if (exec.error?.code === 'NO_TOKEN') {
      ElMessageBox.confirm(
        exec.error.message || '当前域名尚未配置 Token。',
        '未配置 Token',
        { confirmButtonText: '去 MR 配置', cancelButtonText: '取消', type: 'warning' }
      )
        .then(() => router.push({ path: '/settings' }))
        .catch(() => undefined);
      return;
    }
    ElMessage.error(exec.error?.message ?? '操作失败');
  }

  function handleError(err: unknown): void {
    const msg = err instanceof Error ? err.message : String(err);
    ElMessage.error(msg);
  }

  return { confirmVisible, pending, executing, canRun, previewAndConfirm, executeConfirmed, cancel };
}