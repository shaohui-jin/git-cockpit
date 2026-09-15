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
import ActivityHeatmap from '@/components/ActivityHeatmap.vue';
import { jobLine, notifyJobStarted } from '@/utils/jobNotify';
import {
  attentionOf,
  filterAriaName,
  matchesFilter,
  weatherHint,
  weatherOf,
  type RepoFilter
} from '@/utils/repoAttention';
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
const fetching = ref(false);
const { revision } = useRevision();

function overviewOf(path: string): RepoOverview | undefined {
  return overviews.value.find((o) => o.path === path);
}

const filterCounts = computed(() => {
  let stuck = 0;
  let dirty = 0;
  let sync = 0;
  let quiet = 0;
  for (const r of repos.repos) {
    const a = attentionOf(overviewOf(r.path));
    if (a === 'stuck') stuck += 1;
    else if (a === 'dirty') dirty += 1;
    else if (a === 'sync') sync += 1;
    else quiet += 1;
  }
  return { stuck, dirty, sync, quiet };
});

const weatherTabs = computed(() => {
  const n = repos.repos.length;
  const c = filterCounts.value;
  return [
    { key: 'all' as const, weather: '全部', count: n, hint: '所有已打开的仓库', aria: filterAriaName('all', n) },
    { key: 'stuck' as const, weather: '雷雨', count: c.stuck, hint: weatherHint('stuck'), aria: filterAriaName('stuck', c.stuck) },
    { key: 'dirty' as const, weather: '薄雾', count: c.dirty, hint: weatherHint('dirty'), aria: filterAriaName('dirty', c.dirty) },
    { key: 'sync' as const, weather: '刮风', count: c.sync, hint: weatherHint('sync'), aria: filterAriaName('sync', c.sync) },
    { key: 'quiet' as const, weather: '晴天', count: c.quiet, hint: weatherHint('quiet'), aria: filterAriaName('quiet', c.quiet) }
  ];
});

const cardRepos = computed(() =>
  repos.repos.filter((r) => matchesFilter(overviewOf(r.path), filter.value))
);

const current = computed(
  () => repos.repos.find((r) => r.id === repos.currentId) ?? repos.repos[0] ?? null
);
const currentOv = computed(() => (current.value ? overviewOf(current.value.path) : undefined));
const currentAttention = computed(() => attentionOf(currentOv.value));
const currentMissing = computed(() => currentOv.value?.available === false);

function formatOpened(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function setFilter(next: RepoFilter): void {
  filter.value = filter.value === next && next !== 'all' ? 'all' : next;
}

async function fetchAll(): Promise<void> {
  const ids = repos.repos
    .filter((r) => overviewOf(r.path)?.available !== false)
    .map((r) => r.id);
  if (!ids.length) {
    ElMessage.warning('没有可抓取的仓库');
    return;
  }
  fetching.value = true;
  try {
    const { job } = await api.startJob('fetch', { payload: { repoIds: ids } });
    await jobs.load();
    notifyJobStarted({
      id: job.id,
      kind: 'fetch',
      title: jobLine({ ...job, title: job.title || `fetch ${ids.length} 个仓库` }),
      router
    });
    ElMessage.success(`已开始抓取 ${ids.length} 个仓库（一条任务）`);
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : String(err));
  } finally {
    fetching.value = false;
  }
}

async function fetchOne(id: number): Promise<void> {
  const repo = repos.repos.find((r) => r.id === id);
  if (!repo || overviewOf(repo.path)?.available === false) {
    ElMessage.warning('路径不存在或不是 Git 仓库，不能抓取远程');
    return;
  }
  try {
    const { job } = await api.startJob('fetch', { repoId: id });
    await jobs.load();
    notifyJobStarted({
      id: job.id,
      kind: 'fetch',
      title: jobLine({ ...job, repoPath: job.repoPath || repo.path }),
      router
    });
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : String(err));
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

function repoUsable(id: number): boolean {
  const repo = repos.repos.find((r) => r.id === id);
  if (!repo) return false;
  return overviewOf(repo.path)?.available !== false;
}

async function openStatus(id: number): Promise<void> {
  if (!repoUsable(id)) {
    ElMessage.warning('路径不存在或不是 Git 仓库，不能进入工作区');
    return;
  }
  try {
    await repos.activate(id);
  } catch {
    repos.switchTo(id);
  }
  await router.push('/status');
}

async function openMerge(id: number): Promise<void> {
  if (!repoUsable(id)) {
    ElMessage.warning('路径不存在或不是 Git 仓库，不能预演合并');
    return;
  }
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
  <div class="page board">
    <h2 class="page-title">工作台</h2>

    <el-alert
      v-if="repos.healthOk === false"
      title="后端离线。请先启动 git-cockpit start，或用桌面应用拉起 daemon。"
      type="error"
      :closable="false"
      show-icon
      class="offline"
    />

    <section class="hero glass">
      <div v-if="!current" class="hero-copy">
        <p class="eyebrow">工作台</p>
        <h3>还没有打开仓库</h3>
        <p class="hero-hint">输入本地 Git 路径，或从远程克隆。不会删盘上的文件。</p>
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
      </div>
      <template v-else>
        <div class="hero-copy">
          <p class="eyebrow">当前仓库</p>
          <h3>{{ currentOv?.name || current.path.split(/[\\/]/).pop() }}</h3>
          <p class="path mono">{{ current.path }}</p>
          <div class="branch">
            <span class="wx" :class="currentAttention">{{
              currentMissing ? '丢失' : weatherOf(currentAttention)
            }}</span>
            <code>{{ currentMissing ? '不可用' : currentOv?.current || '…' }}</code>
            <template v-if="currentOv && !currentMissing">
              <span class="ab"
                ><b :class="{ on: currentOv.ahead > 0 }">{{ currentOv.ahead }}</b
                >↑
                <b :class="{ on: currentOv.behind > 0 }">{{ currentOv.behind }}</b
                >↓</span
              >
              <span v-if="currentOv.dirtyCount" class="chip">{{ currentOv.dirtyCount }} 更改</span>
              <span v-if="currentOv.conflictCount" class="chip danger">{{ currentOv.conflictCount }} 冲突</span>
              <span v-if="currentOv.operation !== 'none'" class="chip danger">{{ currentOv.operation }}</span>
              <span v-if="currentOv.tempMergeBranchCount" class="chip">{{ currentOv.tempMergeBranchCount }} 合并草稿</span>
            </template>
          </div>
          <p class="hero-hint">
            {{
              currentMissing
                ? '路径不存在或不是 Git 仓库。可以从列表移除，不会删磁盘。'
                : weatherHint(currentAttention) +
                  (formatOpened(current.lastOpenedAt) ? ` · 打开 ${formatOpened(current.lastOpenedAt)}` : '')
            }}
          </p>
          <div class="hero-actions">
            <el-button type="primary" :disabled="currentMissing" @click="openStatus(current.id)">进入工作区</el-button>
            <el-button :disabled="currentMissing" @click="openMerge(current.id)">预演合并</el-button>
            <el-button v-if="currentMissing" type="danger" plain @click="removeRepo(current.id, current.path)"
              >移除</el-button
            >
          </div>
        </div>
        <ActivityHeatmap
          v-if="!currentMissing"
          :days="currentOv?.activity"
          :start="currentOv?.activityStart"
          :total="currentOv?.activityTotal"
        />
      </template>
    </section>

    <section v-if="repos.repos.length" class="weather">
      <button
        v-for="w in weatherTabs"
        :key="w.key"
        type="button"
        class="wx-tab glass"
        :class="[w.key, { on: filter === w.key }]"
        :aria-label="w.aria"
        :title="w.hint"
        @click="setFilter(w.key)"
      >
        <strong>{{ w.count }}</strong>
        <span>{{ w.weather }}</span>
        <small>{{ w.hint }}</small>
      </button>
    </section>

    <section v-if="repos.repos.length" class="mosaic-block">
      <div class="mosaic-head">
        <p class="eyebrow">仓库一览 · 点卡片换当前仓</p>
        <div class="open-row">
          <el-input
            v-model="newPath"
            placeholder="输入本地 Git 仓库路径，例如 D:\project\repo 或 /Users/me/code/app"
            clearable
            @keyup.enter="openRepo"
          />
          <el-button type="primary" :loading="opening" @click="openRepo">打开</el-button>
          <el-button @click="openCloneDialog">克隆到本地</el-button>
          <el-tooltip content="对所有可用仓 git fetch，合成一条后台任务。丢失仓会跳过。" placement="top">
            <el-button :loading="fetching" @click="fetchAll">刷新</el-button>
          </el-tooltip>
        </div>
      </div>

      <el-empty v-if="cardRepos.length === 0" description="没有符合筛选的仓库" :image-size="40" />

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
          @select="repos.switchTo(r.id)"
          @enter="openStatus(r.id)"
          @merge="openMerge(r.id)"
          @fetch="fetchOne(r.id)"
          @remove="removeRepo(r.id, r.path)"
          @dragstart="onCardDragStart($event, r.id)"
          @dragover="onCardDragOver($event, r.id)"
          @drop="onCardDrop($event, r.id)"
          @dragend="onCardDragEnd"
        />
      </div>
    </section>

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
.board {
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: var(--gc-pad);
  overflow: auto;
}
.offline {
  flex: none;
}
.glass {
  background: color-mix(in srgb, var(--el-bg-color) 82%, transparent);
  border: 1px solid var(--el-border-color-lighter);
  border-radius: var(--gc-radius);
  box-shadow: var(--gc-shadow-menu);
}
.hero {
  flex: none;
  display: flex;
  justify-content: space-between;
  gap: var(--gc-pad);
  align-items: flex-start;
  padding: var(--gc-pad);
}
.hero-copy {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--gc-gap);
}
.eyebrow {
  margin: 0;
  font-size: var(--gc-text);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--el-color-primary);
}
.hero h3 {
  margin: 0;
  font-size: var(--el-font-size-extra-large);
  font-weight: 600;
}
.path {
  margin: 0;
  font-size: var(--gc-text);
  color: var(--el-text-color-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.branch {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--gc-gap);
}
.wx {
  font-size: var(--gc-text);
  padding: 0 var(--gc-gap);
  border-radius: 999px;
  background: var(--el-fill-color-light);
}
.wx.stuck {
  color: var(--el-color-danger);
  background: var(--el-color-danger-light-9);
}
.wx.dirty {
  color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
}
.wx.sync {
  color: var(--el-color-primary);
  background: color-mix(in srgb, var(--el-color-primary) 16%, transparent);
}
.wx.quiet {
  color: var(--el-color-success);
  background: var(--el-color-success-light-9);
}
.ab b {
  font-size: var(--el-font-size-extra-large);
  font-weight: 600;
  margin: 0 2px 0 4px;
}
.ab b.on:first-of-type {
  color: var(--el-color-success);
}
.ab b.on:last-of-type {
  color: var(--el-color-danger);
}
.chip {
  font-size: var(--gc-text);
  padding: 0 var(--gc-gap);
  border-radius: 999px;
  background: var(--el-fill-color-light);
}
.chip.danger {
  color: var(--el-color-danger);
  background: var(--el-color-danger-light-9);
}
.hero-hint {
  margin: 0;
  font-size: var(--gc-text);
  color: var(--el-text-color-secondary);
}
.hero-actions,
.open-row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--gc-gap);
  align-items: center;
}
.open-row .el-input {
  flex: 1;
  min-width: 200px;
}
.weather {
  flex: none;
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: var(--gc-gap);
}
.wx-tab {
  border: 0;
  text-align: left;
  color: inherit;
  padding: var(--gc-pad);
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 2px;
  font: inherit;
  background: color-mix(in srgb, var(--el-bg-color) 82%, transparent);
}
.wx-tab strong {
  font-size: var(--el-font-size-extra-large);
  line-height: 1;
}
.wx-tab.stuck strong {
  color: var(--el-color-danger);
}
.wx-tab.dirty strong {
  color: var(--el-color-primary);
}
.wx-tab.sync strong {
  color: var(--el-color-primary);
}
.wx-tab.quiet strong {
  color: var(--el-color-success);
}
.wx-tab small {
  color: var(--el-text-color-secondary);
  font-size: var(--gc-text);
  line-height: 1.35;
}
.wx-tab.on {
  box-shadow: 0 0 0 1px var(--el-color-primary) inset;
}
.mosaic-block {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: var(--gc-gap);
}
.mosaic-head {
  flex: none;
  display: flex;
  flex-direction: column;
  gap: var(--gc-gap);
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
@media (max-width: 900px) {
  .weather {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
