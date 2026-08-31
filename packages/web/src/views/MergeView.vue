<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { storeToRefs } from 'pinia';
import { ElMessage } from 'element-plus';
import * as api from '@/api/client';
import { useReposStore } from '@/stores/repos';
import { useBranchesStore } from '@/stores/branches';
import { useMergeSessionStore } from '@/stores/mergeSession';
import { useToolAction } from '@/composables/useToolAction';
import ConfirmDialog from '@/components/ConfirmDialog.vue';
import BranchTreeSelect from '@/components/BranchTreeSelect.vue';
import ConflictResolvePanel from '@/components/ConflictResolvePanel.vue';
import MatrixView from '@/views/MatrixView.vue';
import type { ApplyResolveResult, BranchInfo, CreateMrResult, MergePreviewResult, PrepareMrResult, ToolExecResult } from '@/api/types';

const repos = useReposStore();
const branchStore = useBranchesStore();
const session = useMergeSessionStore();
const { mode, pairInto, pairFrom, fetchRemote, trail, trailCurrent, trailRemaining, fromMatrix, loading: matrixLoading } =
  storeToRefs(session);
const route = useRoute();
const router = useRouter();
const repoId = (): number | null => repos.currentId;

const { confirmVisible, pending, canRun, previewAndConfirm, executeConfirmed, cancel } = useToolAction(repoId);

const loading = ref(false);
const loadError = ref('');
const preview = ref<MergePreviewResult | null>(null);
const applyResult = ref<ApplyResolveResult | null>(null);
const prResult = ref<CreateMrResult | null>(null);
const mrPrep = ref<PrepareMrResult | null>(null);
const mrReviewers = ref<string[]>([]);
const lastWriteTool = ref<'git_apply_resolve' | 'git_mr_create' | 'git_push' | null>(null);
const pendingMrPair = ref<{ into: string; from: string } | null>(null);
const resolvePanel = ref<{ buildFiles: () => Array<{ path: string; resolvedContent: string }> } | null>(null);
const resolvePending = ref(0);
const redoRecorded = ref(false);

const currentPairDone = computed(() =>
  session.isPairDone({ into: pairInto.value, from: pairFrom.value })
);
const recordedCell = computed(() =>
  session.survey?.cells.find((c) => c.into === pairInto.value && c.from === pairFrom.value) ?? null
);
const showRecorded = computed(
  () => fromMatrix.value && currentPairDone.value && !redoRecorded.value && !preview.value
);

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

const busy = computed(() => loading.value || matrixLoading.value);

function queryBranch(key: string): string {
  const v = route.query[key];
  return typeof v === 'string' ? v : '';
}

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
  const qInto = queryBranch('into');
  const qFrom = queryBranch('from');
  if (qInto && list.some((b) => b.name === qInto)) {
    pairInto.value = qInto;
  } else if (!pairInto.value || !list.some((b) => b.name === pairInto.value)) {
    pairInto.value = pickDefaultInto(list);
  }
  if (qFrom && list.some((b) => b.name === qFrom)) {
    pairFrom.value = qFrom;
  } else if (!pairFrom.value || !list.some((b) => b.name === pairFrom.value)) {
    pairFrom.value = pickDefaultFrom(list, pairInto.value);
  }
}

function syncModeToRoute(): void {
  const q = route.query.mode;
  const want = mode.value === 'matrix' ? 'matrix' : undefined;
  const have = q === 'matrix' ? 'matrix' : undefined;
  if (want === have) return;
  const query = { ...route.query };
  if (want) query.mode = want;
  else delete query.mode;
  void router.replace({ path: '/merge', query });
}

async function runPreview(): Promise<void> {
  const id = repoId();
  if (id === null) {
    ElMessage.warning('请先选择仓库');
    return;
  }
  if (!pairInto.value || !pairFrom.value) {
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
      into: pairInto.value,
      from: pairFrom.value,
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
    into: pairInto.value,
    from: pairFrom.value,
    files,
    push: fromMatrix.value ? false : hasRemote.value,
    keepLocal: fromMatrix.value ? true : undefined
  };
  lastWriteTool.value = 'git_apply_resolve';
  const ok = await previewAndConfirm('git_apply_resolve', params);
  if (!ok) lastWriteTool.value = null;
}

async function runCreatePr(): Promise<void> {
  if (!applyResult.value) return;
  pendingMrPair.value = { into: pairInto.value, from: pairFrom.value };
  lastWriteTool.value = 'git_mr_create';
  const ok = await previewAndConfirm('git_mr_create', {
    into: pairInto.value,
    from: pairFrom.value,
    sourceBranch: applyResult.value.tempBranch,
    reviewers: mrReviewers.value
  });
  if (!ok) {
    lastWriteTool.value = null;
    pendingMrPair.value = null;
  }
}

async function onMatrixCreateMr(payload: { into: string; from: string; sourceBranch: string }): Promise<void> {
  pendingMrPair.value = { into: payload.into, from: payload.from };
  lastWriteTool.value = 'git_mr_create';
  const ok = await previewAndConfirm('git_mr_create', {
    into: payload.into,
    from: payload.from,
    sourceBranch: payload.sourceBranch
  });
  if (!ok) {
    lastWriteTool.value = null;
    pendingMrPair.value = null;
  }
}

async function onMatrixPushTemp(payload: { into: string; from: string; branch: string }): Promise<void> {
  if (!hasRemote.value) {
    ElMessage.warning('没有远程，无法推送临时分支');
    return;
  }
  const remote = branchStore.remotes[0]?.name ?? 'origin';
  lastWriteTool.value = 'git_push';
  const ok = await previewAndConfirm('git_push', { remote, branch: payload.branch });
  if (!ok) lastWriteTool.value = null;
}

async function onConfirmed(): Promise<void> {
  const exec: ToolExecResult | null = await executeConfirmed();
  if (!exec?.success) return;
  if (lastWriteTool.value === 'git_push') {
    ElMessage.success('已推送临时分支，可在矩阵申请 MR');
    void session.refreshSurvey();
    void branchStore.load();
    return;
  }
  if (!exec.result || typeof exec.result !== 'object') return;
  if (lastWriteTool.value === 'git_apply_resolve') {
    applyResult.value = exec.result as ApplyResolveResult;
    prResult.value = null;
    mrPrep.value = null;
    mrReviewers.value = [];
    session.markPairDone({ into: pairInto.value, from: pairFrom.value });
    ElMessage.success(
      fromMatrix.value || !applyResult.value.pushed
        ? '已记到本地临时分支，回矩阵统一处理'
        : '已落盘并推送临时分支'
    );
    if (fromMatrix.value) {
      redoRecorded.value = false;
      preview.value = null;
      backToMatrix();
      return;
    }
    const id = repoId();
    if (id != null) {
      try {
        const prepExec = await api.runTool(id, 'git_mr_prepare', {
          into: pairInto.value,
          from: pairFrom.value,
          sourceBranch: applyResult.value.tempBranch
        });
        if (prepExec.success && prepExec.result && typeof prepExec.result === 'object') {
          mrPrep.value = prepExec.result as PrepareMrResult;
        }
      } catch {
        mrPrep.value = null;
      }
    }
    void session.refreshSurvey();
  } else if (lastWriteTool.value === 'git_mr_create') {
    prResult.value = exec.result as CreateMrResult;
    const via = prResult.value.via;
    const pair = pendingMrPair.value ?? { into: pairInto.value, from: pairFrom.value };
    pendingMrPair.value = null;
    session.markPairMr(pair, { url: prResult.value.url, via });
    ElMessage.success(
      via === 'token' || via === 'gh' || via === 'glab' ? '已创建 PR/MR' : '已返回浏览器创建页'
    );
  }
}

function trailGo(delta: number): void {
  session.trailGo(delta);
}

function trailNextPending(): void {
  session.trailNextPending();
  syncModeToRoute();
}

function backToMatrix(): void {
  session.backToMatrix();
  syncModeToRoute();
}

function redoRecordedPreview(): void {
  redoRecorded.value = true;
  void runPreview();
}

watch(
  () => repos.currentId,
  (id) => {
    session.resetIfRepoChanged(id);
    preview.value = null;
    applyResult.value = null;
    prResult.value = null;
    loadError.value = '';
  },
  { immediate: true }
);

watch(
  () => [branchStore.repoId, branchStore.list] as const,
  ([id, list]) => {
    if (id !== repos.currentId) return;
    applyDefaults(list);
  },
  { deep: true, immediate: true }
);

watch(
  () => route.query.mode,
  (q) => {
    if (q === 'matrix' || q === 'pair') session.setMode(q);
  },
  { immediate: true }
);

watch(mode, () => syncModeToRoute());

onMounted(() => {
  syncModeToRoute();
  if (route.query.preview === '1') return;
  if (session.trail && pairInto.value && pairFrom.value && mode.value === 'pair') {
    void runPreview();
  }
});

watch(
  () => [route.query.into, route.query.from, route.query.preview] as const,
  () => {
    applyDefaults(branchStore.list);
    if (route.query.preview === '1' && queryBranch('into') && queryBranch('from') && repoId() !== null) {
      session.setMode('pair');
      void runPreview();
    }
  },
  { immediate: true }
);

watch(
  () => session.previewSeq,
  (seq) => {
    if (seq <= 0) return;
    preview.value = null;
    applyResult.value = null;
    prResult.value = null;
    redoRecorded.value = false;
    syncModeToRoute();
    if (fromMatrix.value && session.isPairDone({ into: pairInto.value, from: pairFrom.value })) {
      return;
    }
    void runPreview();
  }
);

watch([pairInto, pairFrom], () => {
  session.syncTrailWithPair();
});
</script>

<template>
  <div class="page merge-page">
    <div class="page-head">
      <h2 class="page-title">合并</h2>
      <div class="head-actions">
        <el-radio-group v-model="mode" size="small">
          <el-radio-button value="pair">单对预演</el-radio-button>
          <el-radio-button value="matrix">矩阵</el-radio-button>
        </el-radio-group>
        <el-button v-if="mode === 'pair'" :loading="loading" :disabled="!canRun" type="primary" @click="runPreview">预演</el-button>
      </div>
    </div>

    <div v-if="mode === 'pair' && trail && trailCurrent" class="trail">
      <el-button size="small" @click="backToMatrix">← 返回矩阵</el-button>
      <span class="trail-pos mono">{{ trail.index + 1 }} / {{ trail.pairs.length }}</span>
      <span class="trail-pair mono">
        <span class="mine">{{ trailCurrent.from }}</span>
        <span class="trail-arrow">→</span>
        <span class="online">{{ trailCurrent.into }}</span>
      </span>
      <el-tag v-if="trailRemaining > 0" type="warning" effect="plain" size="small">剩 {{ trailRemaining }} 条待处理</el-tag>
      <el-tag v-else type="success" effect="plain" size="small">这批冲突都走完了</el-tag>
      <span class="trail-spacer" />
      <el-button size="small" :disabled="busy || trail.index === 0" @click="trailGo(-1)">上一条</el-button>
      <el-button size="small" :disabled="busy || trail.index >= trail.pairs.length - 1" @click="trailGo(1)">下一条</el-button>
      <el-button size="small" type="primary" :disabled="busy" @click="trailNextPending">
        {{ trailRemaining > 0 ? '处理下一条' : '回矩阵' }}
      </el-button>
    </div>

    <el-alert v-if="loadError && mode === 'pair'" :title="loadError" type="error" :closable="false" show-icon />
    <el-alert v-else-if="session.loadError && mode === 'matrix'" :title="session.loadError" type="error" :closable="false" show-icon />
    <div v-if="!canRun" class="empty-tip">请先在「仓库管理」中打开一个仓库</div>

    <template v-else-if="mode === 'matrix'">
      <MatrixView @create-mr="onMatrixCreateMr" @push-temp="onMatrixPushTemp" />
    </template>

    <template v-else>
      <el-card shadow="never" class="filter-card">
        <div class="filter-bar">
          <div class="field">
            <span class="field-label">合入目标 into（线上 / ours）</span>
            <BranchTreeSelect v-model="pairInto" remote-first placeholder="选择合入目标" />
          </div>
          <div class="field">
            <span class="field-label">我的分支 from（theirs）</span>
            <BranchTreeSelect v-model="pairFrom" placeholder="选择我的分支" />
          </div>
          <div class="field field-switch">
            <span class="field-label">先 fetch</span>
            <el-switch v-model="fetchRemote" />
          </div>
        </div>
        <p class="tip">
          <template v-if="fromMatrix">
            从矩阵进来：选边后点「完成冲突处理」，只记到本地临时分支（不推送、不改工作区当前分支），然后回矩阵统一看。
          </template>
          <template v-else>
            预演使用 <span class="mono">git merge-tree</span>，不会改工作区。方向：把「我的分支」合入「合入目标」。
          </template>
        </p>
      </el-card>

      <el-card v-if="showRecorded" shadow="never" class="apply-card">
        <template #header>已记入本地</template>
        <p class="tip">
          选边已写到临时分支
          <span class="mono">{{ recordedCell?.tempBranch?.name ?? 'merge/…' }}</span>
          （未推送）。原始 from / into 仍然冲突，这是正常的。回矩阵看「已解决·本地」，再统一处理。
        </p>
        <p class="tip">
          <el-button type="primary" size="small" @click="backToMatrix">返回矩阵</el-button>
          <el-button size="small" @click="redoRecordedPreview">重新预演</el-button>
        </p>
      </el-card>

      <el-card v-if="preview" shadow="never" class="preview-card">
        <template #header>
          <div class="result-head">
            <el-tag :type="outcomeType" effect="dark">{{ outcomeLabel }}</el-tag>
            <span class="mono sha">{{ preview.into }} ({{ preview.intoSha.slice(0, 7) }}) ← {{ preview.from }} ({{ preview.fromSha.slice(0, 7) }})</span>
            <el-tag v-if="preview.fetchAttempted && !preview.fetched" type="warning" effect="plain" size="small">远程未更新</el-tag>
            <el-button v-if="canApply" type="primary" @click="runApply">
              {{ fromMatrix ? '完成冲突处理' : '落盘并推送' }}
            </el-button>
          </div>
        </template>

        <p v-if="preview.outcome === 'conflicts'" class="tip tip-inline">
          {{ truncatedConflicts
            ? '冲突文件超过展示上限，无法在网页选边。请缩小范围或提高 maxFiles。'
            : fromMatrix
              ? '红块选边后点「完成冲突处理」：写入本地临时分支，不推送，随后回矩阵。'
              : '红块用 ≫ / ≪ 选线上或我的；绿=新增、蓝=修改，已自动进入结果。' }}
        </p>
        <p v-else-if="preview.outcome === 'unrelated'" class="tip tip-inline">
          两条历史没有共同祖先，不能当作干净合并落盘。
        </p>
        <p v-else-if="preview.clean" class="tip tip-inline">
          {{ fromMatrix
            ? '可干净合并。点「完成冲突处理」会记到本地临时分支（不推送），再回矩阵。'
            : '可干净合并。落盘会在独立 worktree 提交到临时分支，主工作区保持不变。' }}
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
        <p v-if="mrPrep?.cliError && !mrPrep.cli" class="tip">{{ mrPrep.cliError }}</p>
        <p v-if="mrPrep?.cliInstallUrl && !mrPrep.cli" class="tip">
          官方下载：
          <a :href="mrPrep.cliInstallUrl" target="_blank" rel="noreferrer">{{ mrPrep.cliInstallUrl }}</a>
        </p>
        <div class="tip">
          <span class="field-label">审核人</span>
          <el-select
            v-model="mrReviewers"
            multiple
            filterable
            allow-create
            default-first-option
            placeholder="可选，回车添加用户名"
            style="min-width: 240px"
          >
            <el-option
              v-for="c in mrPrep?.candidates ?? []"
              :key="c.username"
              :label="c.name ? `${c.username}（${c.name}）` : c.username"
              :value="c.username"
            />
          </el-select>
        </div>
        <p class="tip">
          <el-button type="primary" size="small" @click="runCreatePr">创建 PR/MR</el-button>
          <el-button size="small" @click="router.push({ path: '/settings' })">MR 配置</el-button>
        </p>
        <p v-if="prResult?.url" class="tip">
          <a :href="prResult.url" target="_blank" rel="noreferrer">{{
            prResult.via === 'browser' ? '打开创建页' : `已创建${prResult.number != null ? ' #' + prResult.number : ''}`
          }}</a>
        </p>
        <p v-if="prResult?.cliInstallUrl" class="tip">
          未检测到本机 CLI，请自行安装：
          <a :href="prResult.cliInstallUrl" target="_blank" rel="noreferrer">{{ prResult.cliInstallUrl }}</a>
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
.head-actions {
  display: flex;
  align-items: center;
  gap: var(--gc-gap);
}
.trail {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--gc-gap);
  flex-shrink: 0;
  padding: 6px var(--gc-pad);
  border: 1px solid var(--el-border-color-lighter);
  border-radius: var(--gc-radius);
  background: var(--el-fill-color-lighter);
  font-size: var(--gc-text);
}
.trail-pos {
  color: var(--el-text-color-secondary);
}
.trail-pair {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.mine {
  color: var(--el-color-primary);
}
.online {
  color: var(--el-color-success);
}
.trail-arrow {
  color: var(--el-text-color-secondary);
}
.trail-spacer {
  flex: 1;
  min-width: 8px;
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
