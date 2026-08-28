<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import * as api from '@/api/client';
import { useReposStore } from '@/stores/repos';
import { useBranchesStore } from '@/stores/branches';
import { useToolAction } from '@/composables/useToolAction';
import ConfirmDialog from '@/components/ConfirmDialog.vue';
import BranchTreeSelect from '@/components/BranchTreeSelect.vue';
import type { ApplyResolveResult, BranchInfo, MergePreviewResult, ToolExecResult } from '@/api/types';

const repos = useReposStore();
const branchStore = useBranchesStore();
const repoId = (): number | null => repos.currentId;

const { confirmVisible, pending, canRun, previewAndConfirm, executeConfirmed, cancel } = useToolAction(repoId);

const into = ref('');
const from = ref('');
const fetchRemote = ref(true);
const loading = ref(false);
const loadError = ref('');
const preview = ref<MergePreviewResult | null>(null);
const applyResult = ref<ApplyResolveResult | null>(null);

const hasRemote = computed(() => branchStore.hasRemote);

const outcomeType = computed(() => {
  const o = preview.value?.outcome;
  if (o === 'clean') return 'success';
  if (o === 'unrelated') return 'warning';
  if (o === 'conflicts') return 'danger';
  return 'info';
});

const outcomeLabel = computed(() => {
  const o = preview.value?.outcome;
  if (o === 'clean') return '可干净合并';
  if (o === 'unrelated') return '无关历史';
  if (o === 'conflicts') return '存在冲突';
  return '';
});

const canApply = computed(() => !!preview.value?.clean && canRun.value);

function pickDefaultInto(list: BranchInfo[]): string {
  const remotesOnly = list.filter((b) => b.remote);
  const prefer = ['origin/main', 'origin/master', 'origin/develop'];
  for (const name of prefer) {
    if (remotesOnly.some((b) => b.name === name)) return name;
  }
  if (remotesOnly[0]) return remotesOnly[0].name;
  const cur = list.find((b) => b.current);
  return cur?.name ?? list[0]?.name ?? '';
}

function pickDefaultFrom(list: BranchInfo[], intoName: string): string {
  const cur = list.find((b) => b.current && !b.remote);
  if (cur && cur.name !== intoName) return cur.name;
  const local = list.find((b) => !b.remote && b.name !== intoName);
  return local?.name ?? '';
}

function applyDefaults(list: BranchInfo[]): void {
  if (!into.value || !list.some((b) => b.name === into.value)) {
    into.value = pickDefaultInto(list);
  }
  if (!from.value || !list.some((b) => b.name === from.value)) {
    from.value = pickDefaultFrom(list, into.value);
  }
}

async function runPreview(): Promise<void> {
  const id = repoId();
  if (id === null) {
    ElMessage.warning('请先选择仓库');
    return;
  }
  if (!into.value || !from.value) {
    ElMessage.warning('请选择合入目标与我的分支');
    return;
  }
  loading.value = true;
  loadError.value = '';
  preview.value = null;
  applyResult.value = null;
  try {
    const exec = await api.runTool(id, 'git_merge_preview', {
      into: into.value,
      from: from.value,
      fetch: fetchRemote.value,
      dryRun: false
    });
    if (!exec.success) {
      loadError.value = exec.error?.message ?? '预演失败';
      return;
    }
    preview.value = exec.result as MergePreviewResult;
  } catch (err) {
    loadError.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
  }
}

async function runApply(): Promise<void> {
  if (!canApply.value) return;
  const params: Record<string, unknown> = {
    into: into.value,
    from: from.value,
    files: [],
    push: hasRemote.value
  };
  const ok = await previewAndConfirm('git_apply_resolve', params);
  if (!ok) return;
}

async function onConfirmed(): Promise<void> {
  const exec: ToolExecResult | null = await executeConfirmed();
  if (exec?.success && exec.result && typeof exec.result === 'object') {
    applyResult.value = exec.result as ApplyResolveResult;
    ElMessage.success(applyResult.value.pushed ? '已落盘并推送临时分支' : '已落盘到本地临时分支');
  }
}

watch(
  () => repos.currentId,
  () => {
    preview.value = null;
    applyResult.value = null;
    into.value = '';
    from.value = '';
  }
);

watch(
  () => [branchStore.repoId, branchStore.list] as const,
  ([id, list]) => {
    if (id !== repos.currentId) return;
    applyDefaults(list);
  },
  { deep: true, immediate: true }
);
</script>

<template>
  <div class="page">
    <div class="page-head">
      <h2 class="page-title">合并预演</h2>
      <el-button :loading="loading" :disabled="!canRun" type="primary" @click="runPreview">预演</el-button>
    </div>

    <el-alert v-if="loadError" :title="loadError" type="error" :closable="false" show-icon class="mb" />
    <div v-if="!canRun" class="empty-tip">请先在「仓库管理」中打开一个仓库</div>

    <template v-else>
      <el-card shadow="never" class="mb">
        <div class="filter-bar">
          <div class="field">
            <span class="field-label">合入目标 into（线上 / ours）</span>
            <BranchTreeSelect v-model="into" remote-first placeholder="选择合入目标" />
          </div>
          <div class="field">
            <span class="field-label">我的分支 from（theirs）</span>
            <BranchTreeSelect v-model="from" placeholder="选择我的分支" />
          </div>
          <div class="field field-switch">
            <span class="field-label">先 fetch</span>
            <el-switch v-model="fetchRemote" />
          </div>
        </div>
        <p class="tip">
          预演使用 <span class="mono">git merge-tree</span>，不会改工作区，也不会执行 <span class="mono">git merge</span>。
          方向：把「我的分支」合入「合入目标」。
        </p>
      </el-card>

      <el-card v-if="preview" shadow="never" class="mb">
        <template #header>
          <div class="result-head">
            <el-tag :type="outcomeType" effect="dark">{{ outcomeLabel }}</el-tag>
            <span class="mono sha">{{ preview.into }} ({{ preview.intoSha.slice(0, 7) }}) ← {{ preview.from }} ({{ preview.fromSha.slice(0, 7) }})</span>
            <el-tag v-if="preview.fetchAttempted && !preview.fetched" type="warning" effect="plain" size="small">远程未更新</el-tag>
            <el-button v-if="canApply" type="primary" @click="runApply">落盘并推送</el-button>
          </div>
        </template>

        <el-alert
          v-if="preview.outcome === 'conflicts'"
          type="warning"
          :closable="false"
          show-icon
          class="mb"
          title="网页暂不能逐文件选边。请在 Cursor 对话里让 Agent 调用 git_merge_rehearse，选边后用 git_apply_resolve 落盘。"
        />
        <el-alert
          v-else-if="preview.outcome === 'unrelated'"
          type="warning"
          :closable="false"
          show-icon
          class="mb"
          title="两条历史没有共同祖先，不能当作干净合并落盘。"
        />
        <el-alert
          v-else-if="preview.clean"
          type="success"
          :closable="false"
          show-icon
          class="mb"
          title="可干净合并。落盘会在独立 worktree 提交到临时分支，主工作区保持不变。"
        />

        <el-table v-if="preview.conflictFiles.length" :data="preview.conflictFiles" stripe class="conflict-table">
          <el-table-column prop="path" label="冲突文件" min-width="280">
            <template #default="{ row }">
              <span class="mono">{{ row.path }}</span>
            </template>
          </el-table-column>
          <el-table-column label="类型" width="120">
            <template #default>
              <el-tag size="small" type="danger" effect="plain">内容冲突</el-tag>
            </template>
          </el-table-column>
        </el-table>
        <el-empty v-else-if="preview.clean" description="没有冲突文件" />

        <div v-if="preview.messages.length" class="messages">
          <div v-for="(m, i) in preview.messages.slice(0, 8)" :key="i" class="msg-line mono">{{ m }}</div>
        </div>
      </el-card>

      <el-card v-if="applyResult" shadow="never">
        <template #header>落盘结果</template>
        <p class="tip">临时分支 <span class="mono">{{ applyResult.tempBranch }}</span> · 提交 <span class="mono">{{ applyResult.commitSha.slice(0, 7) }}</span></p>
        <p v-if="applyResult.createMrUrl" class="tip">
          <a :href="applyResult.createMrUrl" target="_blank" rel="noreferrer">打开创建 MR/PR 页面</a>
        </p>
        <div v-for="(m, i) in applyResult.messages" :key="i" class="msg-line mono">{{ m }}</div>
      </el-card>
    </template>

    <ConfirmDialog
      v-model:visible="confirmVisible"
      :tool="pending?.tool ?? ''"
      :preview="pending?.preview ?? null"
      @confirm="onConfirmed"
      @cancel="cancel"
    />
  </div>
</template>

<style scoped>
.page-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--gc-gap);
}
.page-title {
  margin: 0;
  font-size: 14px;
}
.mb {
  margin-bottom: var(--gc-gap);
}
.filter-bar {
  display: flex;
  align-items: flex-end;
  gap: var(--gc-gap);
  flex-wrap: wrap;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.field-label {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.field-switch {
  min-width: 80px;
}
.tip {
  margin: var(--gc-gap) 0 0;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.empty-tip {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.result-head {
  display: flex;
  align-items: center;
  gap: var(--gc-gap);
  flex-wrap: wrap;
}
.sha {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.conflict-table {
  width: 100%;
}
.messages {
  margin-top: var(--gc-gap);
}
.msg-line {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  padding: 2px 0;
  word-break: break-all;
}
</style>
