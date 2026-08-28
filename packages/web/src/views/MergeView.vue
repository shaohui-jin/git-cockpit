<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import * as api from '@/api/client';
import { useReposStore } from '@/stores/repos';
import { useBranchesStore } from '@/stores/branches';
import { useSettingsStore } from '@/stores/settings';
import { useToolAction } from '@/composables/useToolAction';
import ConfirmDialog from '@/components/ConfirmDialog.vue';
import BranchTreeSelect from '@/components/BranchTreeSelect.vue';
import ConflictResolvePanel from '@/components/ConflictResolvePanel.vue';
import type { ApplyResolveResult, BranchInfo, CreateMrResult, MergePreviewResult, ToolExecResult } from '@/api/types';

const repos = useReposStore();
const branchStore = useBranchesStore();
const settingsStore = useSettingsStore();
const repoId = (): number | null => repos.currentId;

const { confirmVisible, pending, canRun, previewAndConfirm, executeConfirmed, cancel } = useToolAction(repoId);

const into = ref('');
const from = ref('');
const fetchRemote = ref(true);
const loading = ref(false);
const loadError = ref('');
const preview = ref<MergePreviewResult | null>(null);
const applyResult = ref<ApplyResolveResult | null>(null);
const prResult = ref<CreateMrResult | null>(null);
const lastWriteTool = ref<'git_apply_resolve' | 'git_mr_create' | null>(null);
const resolvePanel = ref<{ buildFiles: () => Array<{ path: string; resolvedContent: string }> } | null>(null);
const resolvePending = ref(0);

const hasRemote = computed(() => branchStore.hasRemote);
const truncatedConflicts = computed(() =>
  (preview.value?.conflictFiles ?? []).some((f) => (f.conflictContent ?? '').includes('超出展示上限'))
);

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

const canApply = computed(() => {
  if (!canRun.value || !preview.value) return false;
  if (truncatedConflicts.value) return false;
  if (preview.value.outcome === 'unrelated' && preview.value.conflictFiles.length === 0) return false;
  if (preview.value.clean) return true;
  return preview.value.outcome === 'conflicts' && resolvePending.value === 0;
});

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
  prResult.value = null;
  try {
    const exec = await api.runTool(id, 'git_merge_rehearse', {
      into: into.value,
      from: from.value,
      fetch: fetchRemote.value,
      maxFiles: 80,
      dryRun: false
    });
    if (!exec.success) {
      loadError.value = exec.error?.message ?? '预演失败';
      return;
    }
    preview.value = exec.result as MergePreviewResult;
    resolvePending.value = preview.value.outcome === 'conflicts' ? preview.value.conflictFiles.length : 0;
  } catch (err) {
    loadError.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
  }
}

async function runApply(): Promise<void> {
  if (!canApply.value || !preview.value) return;
  const files =
    preview.value.outcome === 'conflicts' ? (resolvePanel.value?.buildFiles() ?? []) : [];
  if (preview.value.outcome === 'conflicts' && files.length === 0) {
    ElMessage.warning('请先完成选边');
    return;
  }
  const params: Record<string, unknown> = {
    into: into.value,
    from: from.value,
    files,
    push: hasRemote.value
  };
  lastWriteTool.value = 'git_apply_resolve';
  const ok = await previewAndConfirm('git_apply_resolve', params);
  if (!ok) lastWriteTool.value = null;
}

async function runCreatePr(): Promise<void> {
  if (!applyResult.value) return;
  lastWriteTool.value = 'git_mr_create';
  const ok = await previewAndConfirm('git_mr_create', {
    into: into.value,
    from: from.value,
    sourceBranch: applyResult.value.tempBranch
  });
  if (!ok) lastWriteTool.value = null;
}

async function onConfirmed(): Promise<void> {
  const exec: ToolExecResult | null = await executeConfirmed();
  if (!exec?.success || !exec.result || typeof exec.result !== 'object') return;
  if (lastWriteTool.value === 'git_apply_resolve') {
    applyResult.value = exec.result as ApplyResolveResult;
    prResult.value = null;
    ElMessage.success(applyResult.value.pushed ? '已落盘并推送临时分支' : '已落盘到本地临时分支');
  } else if (lastWriteTool.value === 'git_mr_create') {
    prResult.value = exec.result as CreateMrResult;
    ElMessage.success(prResult.value.via === 'token' ? '已用 Token 创建 PR' : '已返回浏览器创建页');
  }
}

onMounted(() => {
  void settingsStore.load();
});

watch(
  () => repos.currentId,
  () => {
    preview.value = null;
    applyResult.value = null;
    prResult.value = null;
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
  <div class="page merge-page">
    <div class="page-head">
      <h2 class="page-title">合并预演</h2>
      <el-button :loading="loading" :disabled="!canRun" type="primary" @click="runPreview">预演</el-button>
    </div>

    <el-alert v-if="loadError" :title="loadError" type="error" :closable="false" show-icon />
    <div v-if="!canRun" class="empty-tip">请先在「仓库管理」中打开一个仓库</div>

    <template v-else>
      <el-card shadow="never" class="filter-card">
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
          预演使用 <span class="mono">git merge-tree</span>，不会改工作区。方向：把「我的分支」合入「合入目标」。
        </p>
      </el-card>

      <el-card v-if="preview" shadow="never" class="preview-card">
        <template #header>
          <div class="result-head">
            <el-tag :type="outcomeType" effect="dark">{{ outcomeLabel }}</el-tag>
            <span class="mono sha">{{ preview.into }} ({{ preview.intoSha.slice(0, 7) }}) ← {{ preview.from }} ({{ preview.fromSha.slice(0, 7) }})</span>
            <el-tag v-if="preview.fetchAttempted && !preview.fetched" type="warning" effect="plain" size="small">远程未更新</el-tag>
            <el-button v-if="canApply" type="primary" @click="runApply">落盘并推送</el-button>
          </div>
        </template>

        <p v-if="preview.outcome === 'conflicts'" class="tip tip-inline">
          {{ truncatedConflicts
            ? '冲突文件超过展示上限，无法在网页选边。请缩小范围或提高 maxFiles。'
            : '红块用 ≫ / ≪ 选线上或我的；绿=新增、蓝=修改，已自动进入结果。' }}
        </p>
        <p v-else-if="preview.outcome === 'unrelated'" class="tip tip-inline">
          两条历史没有共同祖先，不能当作干净合并落盘。
        </p>
        <p v-else-if="preview.clean" class="tip tip-inline">
          可干净合并。落盘会在独立 worktree 提交到临时分支，主工作区保持不变。
        </p>

        <ConflictResolvePanel
          v-if="preview.outcome === 'conflicts' && preview.conflictFiles.length"
          ref="resolvePanel"
          :files="preview.conflictFiles"
          @progress="resolvePending = $event.pending"
        />
        <el-empty v-else-if="preview.clean" description="没有冲突文件" />
      </el-card>

      <el-card v-if="applyResult" shadow="never" class="apply-card">
        <template #header>落盘结果</template>
        <p class="tip">临时分支 <span class="mono">{{ applyResult.tempBranch }}</span> · 提交 <span class="mono">{{ applyResult.commitSha.slice(0, 7) }}</span></p>
        <p v-if="applyResult.createMrUrl" class="tip">
          <a :href="applyResult.createMrUrl" target="_blank" rel="noreferrer">打开创建 MR/PR 页面</a>
        </p>
        <p v-if="settingsStore.githubTokenSet" class="tip">
          <el-button type="primary" size="small" @click="runCreatePr">用 Token 创建 PR</el-button>
        </p>
        <p v-if="prResult?.url" class="tip">
          <a :href="prResult.url" target="_blank" rel="noreferrer">{{ prResult.via === 'token' ? `已创建 PR${prResult.number != null ? ' #' + prResult.number : ''}` : '打开创建页' }}</a>
        </p>
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
.merge-page {
  overflow: hidden;
  display: flex;
  flex-direction: column;
  gap: var(--gc-gap);
}
.page-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
}
.page-title {
  margin: 0;
  font-size: var(--el-font-size-extra-large);
}
.filter-card {
  flex-shrink: 0;
}
.preview-card {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.preview-card :deep(.el-card__body) {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.preview-card :deep(.el-card__header) {
  flex-shrink: 0;
}
.apply-card {
  flex-shrink: 0;
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
  gap: var(--gc-gap);
}
.field-label {
  font-size: var(--gc-text);
  color: var(--el-text-color-secondary);
}
.field-switch {
  min-width: 80px;
}
.tip {
  margin: var(--gc-gap) 0 0;
  font-size: var(--gc-text);
  color: var(--el-text-color-secondary);
}
.tip-inline {
  margin: 0 0 var(--gc-gap);
  flex-shrink: 0;
}
.empty-tip {
  font-size: var(--gc-text);
  color: var(--el-text-color-secondary);
}
.result-head {
  display: flex;
  align-items: center;
  gap: var(--gc-gap);
  flex-wrap: wrap;
}
.sha {
  font-size: var(--gc-text);
  color: var(--el-text-color-secondary);
}
</style>
