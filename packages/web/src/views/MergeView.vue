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
import MrCreateDialog from '@/components/MrCreateDialog.vue';
import BranchTreeSelect from '@/components/BranchTreeSelect.vue';
import ConflictResolvePanel from '@/components/ConflictResolvePanel.vue';
import MatrixView from '@/views/MatrixView.vue';
import type { ApplyResolveResult, BranchInfo, CreateMrResult, MergePreviewResult, PrepareMrResult, ToolExecResult } from '@/api/types';
import { copyToClipboard } from '@/utils/clipboard';

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
const lastWriteTool = ref<'git_apply_resolve' | 'git_mr_create' | 'git_push' | null>(null);
const pendingMrPair = ref<{ into: string; from: string } | null>(null);
const mrDialogVisible = ref(false);
const mrDialogInto = ref('');
const mrDialogFrom = ref('');
const mrDialogSource = ref('');
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

const situation = computed(() => preview.value?.situation ?? preview.value?.outcome ?? '');

const outcomeType = computed(() => {
  const s = situation.value;
  if (s === 'conflicts') return 'danger';
  if (s === 'unrelated') return 'warning';
  if (s === 'temp_local' || s === 'looking_at_temp') return 'info';
  if (s === 'already_merged') return 'info';
  if (s === 'clean' || s === 'temp_remote') return 'success';
  return 'info';
});

const outcomeLabel = computed(() => {
  const s = situation.value;
  if (s === 'looking_at_temp') return '这是落盘临时分支';
  if (s === 'temp_remote') return '临时分支已在远程';
  if (s === 'temp_local') return '临时分支在本地';
  if (s === 'already_merged') return '没有新提交';
  if (s === 'clean') return '可干净合并';
  if (s === 'unrelated') return '无关历史';
  if (s === 'conflicts') return '存在冲突';
  return '';
});

const canApply = computed(() => {
  if (!canRun.value || !preview.value) return false;
  if (truncatedConflicts.value) return false;
  const s = situation.value;
  if (s === 'looking_at_temp' || s === 'temp_remote' || s === 'temp_local' || s === 'already_merged') return false;
  if (preview.value.outcome === 'unrelated' && preview.value.conflictFiles.length === 0) return false;
  if (preview.value.clean) return true;
  return preview.value.outcome === 'conflicts' && resolvePending.value === 0;
});

const canPushTemp = computed(() => {
  const p = preview.value;
  if (!p || !hasRemote.value) return false;
  if (situation.value === 'temp_local') return Boolean(p.pairTempBranch?.name);
  if (situation.value === 'looking_at_temp') return Boolean(p.pairTempBranch?.local && !p.pairTempBranch.remote);
  return false;
});

const canOpenMr = computed(() => {
  const p = preview.value;
  if (!p) return false;
  if (situation.value === 'temp_remote') return Boolean(p.pairTempBranch?.name);
  if (situation.value === 'looking_at_temp') {
    return Boolean(p.pairTempBranch?.remote && p.recoveredPair?.into);
  }
  return false;
});

const busy = computed(() => loading.value || matrixLoading.value);

function queryBranch(key: string): string {
  const v = route.query[key];
  return typeof v === 'string' ? v : '';
}

function selectableBranches(list: BranchInfo[]): BranchInfo[] {
  return list.filter((b) => !isMergeTempBranchName(b.name));
}

function pickDefaultInto(list: BranchInfo[]): string {
  const remotesOnly = selectableBranches(list).filter((b) => b.remote);
  const prefer = ['origin/main', 'origin/master', 'origin/develop'];
  for (const name of prefer) {
    if (remotesOnly.some((b) => b.name === name)) return name;
  }
  if (remotesOnly[0]) return remotesOnly[0].name;
  const cur = selectableBranches(list).find((b) => b.current);
  return cur?.name ?? selectableBranches(list)[0]?.name ?? '';
}

function pickDefaultFrom(list: BranchInfo[], intoName: string): string {
  const pool = selectableBranches(list);
  const cur = pool.find((b) => b.current && !b.remote);
  if (cur && cur.name !== intoName) return cur.name;
  const local = pool.find((b) => !b.remote && b.name !== intoName);
  return local?.name ?? '';
}

function applyDefaults(list: BranchInfo[]): void {
  const pool = selectableBranches(list);
  const qInto = queryBranch('into');
  const qFrom = queryBranch('from');
  if (qInto && pool.some((b) => b.name === qInto) && !isMergeTempBranchName(qInto)) {
    pairInto.value = qInto;
  } else if (!pairInto.value || !pool.some((b) => b.name === pairInto.value) || isMergeTempBranchName(pairInto.value)) {
    pairInto.value = pickDefaultInto(list);
  }
  if (qFrom && pool.some((b) => b.name === qFrom) && !isMergeTempBranchName(qFrom)) {
    pairFrom.value = qFrom;
  } else if (!pairFrom.value || !pool.some((b) => b.name === pairFrom.value) || isMergeTempBranchName(pairFrom.value)) {
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
    preview.value = await api.mergeRehearse(id, {
      into: pairInto.value,
      from: pairFrom.value,
      fetch: fetchRemote.value,
      maxFiles: 80
    });
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

function openMrDialog(opts: { into: string; from: string; sourceBranch?: string }): void {
  if (repoId() == null) {
    ElMessage.warning('请先选择仓库');
    return;
  }
  mrDialogInto.value = opts.into;
  mrDialogFrom.value = opts.from;
  mrDialogSource.value = opts.sourceBranch ?? '';
  mrDialogVisible.value = true;
}

function runCreatePr(): void {
  if (applyResult.value) {
    openMrDialog({
      into: pairInto.value,
      from: pairFrom.value,
      sourceBranch: applyResult.value.tempBranch
    });
    return;
  }
  const p = preview.value;
  if (!p || !canOpenMr.value) return;
  const recovered = p.recoveredPair;
  openMrDialog({
    into: recovered?.into ?? pairInto.value,
    from: recovered?.from ?? pairFrom.value,
    sourceBranch: p.pairTempBranch?.name
  });
}

function runPushTempFromPreview(): void {
  const name = preview.value?.pairTempBranch?.name;
  if (!name) return;
  void onMatrixPushTemp({ into: pairInto.value, from: pairFrom.value, branch: name });
}

function restoreRecoveredPair(): void {
  const recovered = preview.value?.recoveredPair;
  if (!recovered) return;
  pairInto.value = recovered.into;
  pairFrom.value = recovered.from;
  void runPreview();
}

function onMatrixCreateMr(payload: { into: string; from: string; sourceBranch: string }): void {
  openMrDialog(payload);
}

async function onMrCreateSubmit(payload: Record<string, unknown>): Promise<void> {
  pendingMrPair.value = { into: String(payload.into ?? ''), from: String(payload.from ?? '') };
  lastWriteTool.value = 'git_mr_create';
  const ok = await previewAndConfirm('git_mr_create', payload);
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
        mrPrep.value = await api.mrPrepare(id, {
          into: pairInto.value,
          from: pairFrom.value,
          sourceBranch: applyResult.value.tempBranch
        });
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
      via === 'token' || via === 'gh' || via === 'glab'
        ? '已创建 PR/MR'
        : prResult.value.body?.trim()
          ? '已返回浏览器创建页，请复制正文后粘贴'
          : '已返回浏览器创建页'
    );
  }
}

async function copyPrBody(): Promise<void> {
  const text = prResult.value?.body?.trim() ?? '';
  if (!text) {
    ElMessage.warning('没有可复制的正文');
    return;
  }
  const ok = await copyToClipboard(text);
  ElMessage[ok ? 'success' : 'error'](ok ? '已复制正文' : '复制失败，请手动选择正文');
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
            <BranchTreeSelect v-model="pairInto" remote-first exclude-merge-temp placeholder="选择合入目标" />
          </div>
          <div class="field">
            <span class="field-label">我的分支 from（theirs）</span>
            <BranchTreeSelect v-model="pairFrom" exclude-merge-temp placeholder="选择我的分支" />
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

      <el-card v-if="preview && !applyResult" shadow="never" class="preview-card gc-card-fill">
        <template #header>
          <div class="result-head">
            <el-tag :type="outcomeType" effect="dark">{{ outcomeLabel }}</el-tag>
            <span class="mono sha">{{ preview.into }} ({{ preview.intoSha.slice(0, 7) }}) ← {{ preview.from }} ({{ preview.fromSha.slice(0, 7) }})</span>
            <el-tag v-if="preview.fetchAttempted && !preview.fetched" type="warning" effect="plain" size="small">远程未更新</el-tag>
            <el-button v-if="canApply" type="primary" @click="runApply">
              {{ fromMatrix ? '完成冲突处理' : '落盘并推送' }}
            </el-button>
            <el-button v-if="canPushTemp" type="primary" @click="runPushTempFromPreview">推送临时分支</el-button>
            <el-button v-if="canOpenMr" type="primary" @click="runCreatePr">申请 MR</el-button>
            <el-button v-if="preview.recoveredPair && situation === 'looking_at_temp'" @click="restoreRecoveredPair">
              切回原 pair
            </el-button>
          </div>
        </template>

        <p v-if="situation === 'looking_at_temp'" class="tip tip-inline">
          合入目标是上次 worktree 落盘留下的临时分支，不是线上目标。
          <template v-if="preview.recoveredPair">
            原方向：{{ preview.recoveredPair.from }} → {{ preview.recoveredPair.into }}。
          </template>
          已推送则可申请 MR；不要再落盘。
        </p>
        <p v-else-if="situation === 'temp_remote'" class="tip tip-inline">
          这对分支已有远程临时枝
          <span class="mono">{{ preview.pairTempBranch?.name }}</span>
          ，无需再落盘，直接申请 MR。
        </p>
        <p v-else-if="situation === 'temp_local'" class="tip tip-inline">
          选边已记在本地临时枝
          <span class="mono">{{ preview.pairTempBranch?.name }}</span>
          。推送后即可申请 MR，无需再落盘。
        </p>
        <p v-else-if="situation === 'already_merged'" class="tip tip-inline">
          「我的分支」已经包含在合入目标里，没有可合并的新提交，无需操作。
        </p>
        <p v-else-if="preview.outcome === 'conflicts'" class="tip tip-inline">
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
          v-if="situation === 'conflicts' && preview.conflictFiles.length"
          ref="resolvePanel"
          :files="preview.conflictFiles"
          :repo-id="repoId()"
          :into="pairInto"
          :from="pairFrom"
          @progress="resolvePending = $event.pending"
        />
        <el-empty
          v-else-if="situation === 'already_merged'"
          description="没有可合并的新提交，无需操作"
        />
        <el-empty v-else-if="preview.clean && canApply" description="没有冲突文件" />
      </el-card>

      <el-card v-if="applyResult" shadow="never" class="apply-card gc-card-fill">
        <template #header>
          <div class="result-head">
            <el-tag type="success" effect="dark">已落盘</el-tag>
            <span class="mono sha">{{ applyResult.tempBranch }}</span>
            <el-tag v-if="applyResult.pushed" type="success" effect="plain" size="small">已推送</el-tag>
            <el-tag v-else type="info" effect="plain" size="small">仅本地</el-tag>
          </div>
        </template>
        <dl class="apply-meta">
          <div>
            <dt>临时分支</dt>
            <dd class="mono">{{ applyResult.tempBranch }}</dd>
          </div>
          <div>
            <dt>提交</dt>
            <dd class="mono">{{ applyResult.commitSha.slice(0, 7) }}</dd>
          </div>
        </dl>
        <p v-if="applyResult.createMrUrl" class="apply-link">
          <a :href="applyResult.createMrUrl" target="_blank" rel="noreferrer">打开创建 MR/PR 页面</a>
        </p>
        <el-alert
          v-if="mrPrep?.cliError && !mrPrep.cli"
          type="warning"
          :closable="false"
          :title="mrPrep.cliError"
        />
        <p v-if="mrPrep?.cliInstallUrl && !mrPrep.cli" class="apply-link">
          官方下载：
          <a :href="mrPrep.cliInstallUrl" target="_blank" rel="noreferrer">{{ mrPrep.cliInstallUrl }}</a>
        </p>
        <div class="apply-actions gc-gap-btns">
          <el-button type="primary" @click="runCreatePr">创建 PR/MR</el-button>
          <el-button @click="runPreview">重新预演</el-button>
        </div>
      </el-card>

      <el-card v-if="prResult" shadow="never" class="apply-card">
        <template #header>
          <div class="result-head">
            <el-tag :type="prResult.via === 'browser' ? 'info' : 'success'" effect="dark">
              {{ prResult.via === 'browser' ? '浏览器创建页' : '已开单' }}
            </el-tag>
            <span class="mono sha">{{ prResult.sourceBranch }} → {{ prResult.targetBranch }}</span>
          </div>
        </template>
        <el-alert
          v-for="(msg, i) in prResult.messages"
          :key="i"
          class="mb"
          :type="msg.includes('建议') ? 'warning' : 'info'"
          :closable="false"
          :title="msg"
        />
        <p v-if="prResult.url" class="apply-link">
          <a :href="prResult.url" target="_blank" rel="noreferrer">{{
            prResult.via === 'browser' ? '打开创建页' : `已创建${prResult.number != null ? ' #' + prResult.number : ''}`
          }}</a>
        </p>
        <p v-if="prResult.cliInstallUrl" class="apply-link">
          未检测到本机 CLI，请自行安装：
          <a :href="prResult.cliInstallUrl" target="_blank" rel="noreferrer">{{ prResult.cliInstallUrl }}</a>
        </p>
        <div v-if="prResult.via === 'browser' && prResult.body?.trim()" class="pr-body">
          <header>
            <strong>待粘贴正文</strong>
            <el-button size="small" @click="copyPrBody">复制正文</el-button>
          </header>
          <pre>{{ prResult.body }}</pre>
        </div>
      </el-card>
    </template>

    <MrCreateDialog
      v-model="mrDialogVisible"
      :repo-id="repoId()"
      :into="mrDialogInto"
      :from="mrDialogFrom"
      :source-branch="mrDialogSource || undefined"
      @submit="onMrCreateSubmit"
    />
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
.preview-card,
.apply-card {
  flex: 1;
  min-height: 0;
}
.apply-meta {
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: var(--gc-gap);
}
.apply-meta > div {
  display: flex;
  align-items: baseline;
  gap: var(--gc-pad);
  min-height: var(--gc-line);
}
.apply-meta dt {
  flex: none;
  width: 64px;
  color: var(--el-text-color-secondary);
}
.apply-meta dd {
  margin: 0;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.apply-link {
  margin: var(--gc-gap) 0 0;
  font-size: var(--gc-text);
}
.apply-actions {
  display: flex;
  align-items: center;
  gap: var(--gc-gap);
  margin-top: var(--gc-pad);
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
.mb { margin-bottom: var(--gc-gap); }
.pr-body {
  margin-top: var(--gc-pad);
  padding: var(--gc-gap) var(--gc-pad);
  border: 1px solid var(--el-border-color);
  border-radius: var(--gc-radius);
  background: var(--el-fill-color-lighter);
}
.pr-body header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--gc-gap);
}
.pr-body pre {
  margin: 0;
  max-height: 240px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
  font-size: var(--gc-text);
  line-height: 1.5;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
</style>
