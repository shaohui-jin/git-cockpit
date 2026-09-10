<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { useReposStore } from '@/stores/repos';
import { useJobsStore } from '@/stores/jobs';
import { useRevision } from '@/composables/revision';
import * as api from '@/api/client';
import CloneDialog from '@/components/CloneDialog.vue';
import RepoCard from '@/components/RepoCard.vue';
import { jobLine, notifyJobStarted } from '@/utils/jobNotify';
import { attentionOf, matchesFilter, type RepoFilter } from '@/utils/repoAttention';
import { moveAmong } from '@/utils/repoOrder';
import type { RepoOverview } from '@/api/types';

const repos = useReposStore();
const jobs = useJobsStore();
const router = useRouter();

const newPath = ref('');
const opening = ref(false);
const cloneVisible = ref(false);
const cloneRetrying = ref(false);
const cloneUrl = ref('');
const cloneDest = ref('');
const cloning = ref(false);
const overviews = ref<RepoOverview[]>([]);
const overviewLoading = ref(false);
const filter = ref<RepoFilter>('all');
const dragId = ref<number | null>(null);
const overId = ref<number | null>(null);
const selectedIds = ref<Set<number>>(new Set());
const fetching = ref(false);
const { revision } = useRevision();

function overviewOf(path: string): RepoOverview | undefined {
  return overviews.value.find((o) => o.path === path);
}

const filterCounts = computed(() => {
  let stuck = 0;
  let dirty = 0;
  let sync = 0;
  for (const r of repos.repos) {
    const a = attentionOf(overviewOf(r.path));
    if (a === 'stuck') stuck += 1;
    else if (a === 'dirty') dirty += 1;
    else if (a === 'sync') sync += 1;
  }
  return { stuck, dirty, sync };
});

const cardRepos = computed(() =>
  repos.repos.filter((r) => matchesFilter(overviewOf(r.path), filter.value))
);

function setFilter(next: RepoFilter): void {
  filter.value = filter.value === next && next !== 'all' ? 'all' : next;
}

function toggleSelect(id: number): void {
  const next = new Set(selectedIds.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  selectedIds.value = next;
}

const selectedCount = computed(() => selectedIds.value.size);

async function fetchSelected(): Promise<void> {
  const ids = [...selectedIds.value];
  if (!ids.length) {
    ElMessage.warning('请先勾选要刷新远程的仓库');
    return;
  }
  fetching.value = true;
  let ok = 0;
  const errors: string[] = [];
  try {
    for (const id of ids) {
      const repo = repos.repos.find((r) => r.id === id);
      const ov = repo ? overviewOf(repo.path) : undefined;
      if (!repo || ov?.available === false) {
        errors.push(repo?.path ?? String(id));
        continue;
      }
      try {
        const { job } = await api.startJob('fetch', { repoId: id });
        ok += 1;
        notifyJobStarted({
          id: job.id,
          kind: 'fetch',
          title: jobLine({ ...job, repoPath: job.repoPath || repo.path }),
          router
        });
      } catch (err) {
        errors.push(err instanceof Error ? err.message : String(err));
      }
    }
    await jobs.load();
    if (ok && !errors.length) ElMessage.success(`已开始抓取 ${ok} 个仓库`);
    else if (ok) ElMessage.warning(`已开始 ${ok} 个，失败 ${errors.length}`);
    else ElMessage.error(errors[0] || '无法开始抓取');
    selectedIds.value = new Set();
  } finally {
    fetching.value = false;
  }
}

function onCardDragStart(e: DragEvent, id: number): void {
  dragId.value = id;
  e.dataTransfer?.setData('text/plain', String(id));
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
}

function onCardDragOver(e: DragEvent, id: number): void {
  if (dragId.value == null || dragId.value === id) return;
  e.preventDefault();
  overId.value = id;
}

async function onCardDrop(e: DragEvent, id: number): Promise<void> {
  e.preventDefault();
  const from = dragId.value;
  overId.value = null;
  dragId.value = null;
  if (from == null || from === id) return;
  const full = repos.repos.map((r) => r.id);
  const visible = cardRepos.value.map((r) => r.id);
  const next = moveAmong(full, visible, from, id);
  await repos.reorder(next);
}

function onCardDragEnd(): void {
  dragId.value = null;
  overId.value = null;
}

async function loadOverview(): Promise<void> {
  overviewLoading.value = true;
  try {
    const { repos: rows } = await api.listOverview();
    overviews.value = rows;
  } catch {
    overviews.value = [];
  } finally {
    overviewLoading.value = false;
  }
}

async function openRepo(): Promise<void> {
  const p = newPath.value.trim();
  if (!p) {
    ElMessage.warning('请输入仓库路径');
    return;
  }
  opening.value = true;
  try {
    const repo = await repos.open(p);
    ElMessage.success(`已打开 ${repo.path}`);
    repos.switchTo(repo.id);
    newPath.value = '';
    await loadOverview();
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : String(err));
  } finally {
    opening.value = false;
  }
}

async function removeRepo(id: number, path: string): Promise<void> {
  try {
    await ElMessageBox.confirm(`确定从列表移除 ${path}？注意：不会删除磁盘上的仓库文件。`, '移除仓库', {
      type: 'warning',
      confirmButtonText: '移除',
      cancelButtonText: '取消'
    });
  } catch {
    return;
  }
  try {
    await repos.remove(id);
    ElMessage.success('已移除');
    await loadOverview();
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : String(err));
  }
}

async function openStatus(id: number): Promise<void> {
  try {
    await repos.activate(id);
  } catch {
    repos.switchTo(id);
  }
  await router.push('/status');
}

async function openMerge(id: number): Promise<void> {
  try {
    await repos.activate(id);
  } catch {
    repos.switchTo(id);
  }
  await router.push('/merge');
}

function openCloneDialog(): void {
  cloneRetrying.value = false;
  cloneUrl.value = '';
  cloneDest.value = '';
  cloneVisible.value = true;
}

async function startClone(): Promise<void> {
  const url = cloneUrl.value.trim();
  const dest = cloneDest.value.trim();
  if (!url || !dest) {
    ElMessage.warning('请填写项目地址和保存路径');
    return;
  }
  cloning.value = true;
  try {
    const { job } = await api.startClone(url, dest);
    cloneVisible.value = false;
    cloneUrl.value = '';
    cloneDest.value = '';
    await jobs.load();
    notifyJobStarted({
      id: job.id,
      kind: 'clone',
      title: `${url} → ${dest}`,
      router
    });
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : String(err));
  } finally {
    cloning.value = false;
  }
}

watch(revision, () => void loadOverview());

onMounted(() => {
  void repos.load();
  void loadOverview();
});
</script>

<template>
  <div class="page">
    <h2 class="page-title">工作台</h2>

    <el-card class="open-card" shadow="never">
      <template #header>打开本地仓库</template>
      <div class="open-row">
        <el-input
          v-model="newPath"
          placeholder="输入本地 Git 仓库路径，例如 D:\project\repo 或 /Users/me/code/app"
          clearable
          @keyup.enter="openRepo"
        />
        <el-button type="primary" :loading="opening" @click="openRepo">打开</el-button>
        <el-button @click="openCloneDialog">克隆到本地</el-button>
      </div>
    </el-card>

    <el-card shadow="never" class="list-card">
      <template #header>
        <div class="list-header">
          <div class="summary-chips">
            <span>仓库一览</span>
            <button type="button" class="chip" :class="{ on: filter === 'all' }" @click="setFilter('all')">
              全部 {{ repos.repos.length }}
            </button>
            <button type="button" class="chip stuck" :class="{ on: filter === 'stuck' }" @click="setFilter('stuck')">
              卡住 {{ filterCounts.stuck }}
            </button>
            <button type="button" class="chip dirty" :class="{ on: filter === 'dirty' }" @click="setFilter('dirty')">
              有更改 {{ filterCounts.dirty }}
            </button>
            <button type="button" class="chip sync" :class="{ on: filter === 'sync' }" @click="setFilter('sync')">
              未同步 {{ filterCounts.sync }}
            </button>
          </div>
          <div class="list-actions">
            <el-button
              :disabled="selectedCount === 0"
              :loading="fetching"
              @click="fetchSelected"
            >刷新远程{{ selectedCount ? ` (${selectedCount})` : '' }}</el-button>
            <el-button
              text
              type="primary"
              :loading="repos.loading || overviewLoading"
              @click="() => { void repos.load(); void loadOverview(); }"
            >刷新</el-button>
          </div>
        </div>
      </template>

      <el-empty
        v-if="!repos.loading && repos.repos.length === 0"
        description="还没有打开仓库。输入本地路径打开，或从远程克隆。"
      />

      <el-empty
        v-else-if="cardRepos.length === 0"
        description="没有符合筛选的仓库"
        :image-size="40"
      />

      <div v-else class="card-grid">
        <RepoCard
          v-for="r in cardRepos"
          :key="r.id"
          :repo="r"
          :overview="overviewOf(r.path)"
          :current="r.id === repos.currentId"
          :muted="repos.currentId != null && r.id !== repos.currentId"
          :dragging="dragId === r.id"
          :drag-over="overId === r.id"
          :selected="selectedIds.has(r.id)"
          @select="repos.switchTo(r.id)"
          @enter="openStatus(r.id)"
          @merge="openMerge(r.id)"
          @remove="removeRepo(r.id, r.path)"
          @toggle-select="toggleSelect(r.id)"
          @dragstart="onCardDragStart($event, r.id)"
          @dragover="onCardDragOver($event, r.id)"
          @drop="onCardDrop($event, r.id)"
          @dragend="onCardDragEnd"
        />
      </div>
    </el-card>

    <CloneDialog
      v-model:visible="cloneVisible"
      v-model:url="cloneUrl"
      v-model:dest="cloneDest"
      :retrying="cloneRetrying"
      :loading="cloning"
      @submit="startClone"
    />
  </div>
</template>

<style scoped>
.page {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.open-card {
  flex: none;
  margin-bottom: var(--gc-gap);
}
.list-card {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.list-card :deep(.el-card__header) {
  flex: none;
}
.list-card :deep(.el-card__body) {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.open-row {
  display: flex;
  gap: var(--gc-gap);
}
.open-row .el-input {
  flex: 1;
}
.list-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--gc-gap);
  flex-wrap: wrap;
}
.list-actions {
  display: flex;
  align-items: center;
  gap: var(--gc-gap);
  flex: none;
}
.summary-chips {
  display: flex;
  align-items: center;
  gap: var(--gc-gap);
  flex-wrap: wrap;
}
.chip {
  height: 22px;
  padding: 0 8px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 11px;
  background: transparent;
  color: var(--el-text-color-regular);
  font-size: 12px;
  cursor: pointer;
}
.chip.on {
  border-color: var(--el-color-primary);
  color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
}
.chip.stuck.on {
  border-color: var(--el-color-danger);
  color: var(--el-color-danger);
  background: var(--el-color-danger-light-9);
}
.chip.dirty.on {
  border-color: var(--el-color-warning);
  color: var(--el-color-warning);
  background: var(--el-color-warning-light-9);
}
.card-grid {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: var(--gc-gap);
  align-content: start;
}
</style>
