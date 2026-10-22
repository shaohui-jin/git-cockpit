<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRevision } from '@/composables/revision';
import { useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { useReposStore } from '@/stores/repos';
import { useOverviewStore } from '@/stores/overview';
import { useJobsStore } from '@/stores/jobs';
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
const repos = useReposStore();
const overview = useOverviewStore();
const { revision } = useRevision();
const jobs = useJobsStore();
const router = useRouter();

const newPath = ref('');
const opening = ref(false);
const cloneVisible = ref(false);
const cloneRetrying = ref(false);
const cloneUrl = ref('');
const cloneDest = ref('');
const cloning = ref(false);
const filter = ref<RepoFilter>('all');
const dragId = ref<number | null>(null);
const overId = ref<number | null>(null);
const fetching = ref(false);

const overviewOf = overview.overviewOf;

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
    {
      key: 'stuck' as const,
      weather: '雷雨',
      count: c.stuck,
      hint: weatherHint('stuck'),
      aria: filterAriaName('stuck', c.stuck)
    },
    {
      key: 'dirty' as const,
      weather: '薄雾',
      count: c.dirty,
      hint: weatherHint('dirty'),
      aria: filterAriaName('dirty', c.dirty)    },
    {
      key: 'sync' as const,
      weather: '刮风',
      count: c.sync,
      hint: weatherHint('sync'),
      aria: filterAriaName('sync', c.sync)
    },
    {
      key: 'quiet' as const,
      weather: '晴天',
      count: c.quiet,
      hint: weatherHint('quiet'),
      aria: filterAriaName('quiet', c.quiet)
    }
  ];
});

const cardRepos = computed(() => repos.repos.filter((r) => matchesFilter(overviewOf(r.path), filter.value)));

const current = computed(() => repos.repos.find((r) => r.id === repos.currentId) ?? repos.repos[0] ?? null);
const currentOv = computed(() => (current.value ? overviewOf(current.value.path) : undefined));
const currentAttention = computed(() => attentionOf(currentOv.value));
const currentMissing = computed(() => currentOv.value?.available === false);

/* ---- 需要关注（对齐设计稿 attention 三联）：每类取最严重的一仓，真实数据推导 ---- */
interface AttentionItem {
  tone: 'red' | 'amber' | 'accent';
  icon: string;
  name: string;
  text: string;
  repoId: number;
  to: '/merge' | '/status';
}
const attentionItems = computed<AttentionItem[]>(() => {
  const usable = repos.repos
    .map((r) => ({ repo: r, ov: overviewOf(r.path) }))
    .filter((x): x is { repo: (typeof repos.repos)[number]; ov: NonNullable<ReturnType<typeof overviewOf>> } =>
      Boolean(x.ov) && x.ov!.available !== false
    );
  const worst = (pred: (ov: NonNullable<ReturnType<typeof overviewOf>>) => boolean, score: (ov: NonNullable<ReturnType<typeof overviewOf>>) => number) =>
    usable.filter((x) => pred(x.ov)).sort((a, b) => score(b.ov) - score(a.ov))[0];
  const items: AttentionItem[] = [];
  const conflict = worst((ov) => ov.conflictCount > 0, (ov) => ov.conflictCount);
  if (conflict) {
    items.push({
      tone: 'red',
      icon: 'conflict',
      name: conflict.ov.name,
      text: `${conflict.ov.conflictCount} 个冲突未解决，合并已暂停`,
      repoId: conflict.repo.id,
      to: '/merge'
    });
  }
  const op = worst((ov) => ov.operation !== 'none', () => 1);
  if (op && items.length < 3) {
    const label = op.ov.operation === 'merge' ? '合并' : op.ov.operation === 'rebase' ? '变基' : '拣选';
    items.push({
      tone: 'red',
      icon: 'alert',
      name: op.ov.name,
      text: `有${label}未完成，先继续或中止`,
      repoId: op.repo.id,
      to: '/status'
    });
  }
  const dirty = worst((ov) => ov.dirtyCount > 0, (ov) => ov.dirtyCount);
  if (dirty && items.length < 3) {
    items.push({
      tone: 'amber',
      icon: 'file',
      name: dirty.ov.name,
      text: `${dirty.ov.dirtyCount} 个文件未提交`,
      repoId: dirty.repo.id,
      to: '/status'
    });
  }
  const behind = worst((ov) => ov.behind > 0, (ov) => ov.behind);
  if (behind && items.length < 3) {
    items.push({
      tone: 'accent',
      icon: 'pull',
      name: behind.ov.name,
      text: `落后远程 ${behind.ov.behind} 个提交`,
      repoId: behind.repo.id,
      to: '/status'
    });
  }
  return items;
});

function attentionGo(item: AttentionItem): void {
  repos.switchTo(item.repoId);
  void router.push(item.to);
}

function setFilter(next: RepoFilter): void {
  filter.value = filter.value === next && next !== 'all' ? 'all' : next;
}

async function fetchAll(): Promise<void> {
  const ids = repos.repos.filter((r) => overviewOf(r.path)?.available !== false).map((r) => r.id);
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
    overview.prune(repos.repos.map((r) => r.id));
    await overview.ensure([repo.id], repos.repos);
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
      cancelButtonText: '取消',
      closeOnClickModal: false
    });
  } catch {
    return;
  }
  try {
    await repos.remove(id);
    overview.remove([id]);
    ElMessage.success('已移除');
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

watch(
  () => repos.repos.map((r) => r.id).join(','),
  () => {
    void overview.sync(repos.repos, {
      force: overview.hasCache,
      background: overview.hasCache
    });
  },
  { immediate: true }
);

watch(revision, () => {
  if (!repos.repos.length) return;
  void overview.sync(repos.repos, { force: true, background: true });
});
</script>

<template>
  <div class="page board">
    <div class="page-head">
      <h1>工作台</h1>
      <span class="sub">本地 Git 仓库的驾驶舱</span>
      <span class="spacer" />
      <span v-if="overview.refreshing" class="overview-refreshing" aria-live="polite">更新中…</span>
    </div>

    <el-alert
      v-if="repos.healthOk === false"
      title="后端离线。请先启动 git-cockpit start，或用桌面应用拉起 daemon。"
      type="error"
      :closable="false"
      show-icon
      class="offline"
    />

    <!-- 常驻打开栏：输入路径 / 克隆 / 一键抓取 -->
    <section class="open-bar">
      <el-input
        v-model="newPath"
        class="open-input"
        placeholder="输入本地 Git 仓库路径，例如 D:\project\repo 或 /Users/me/code/app"
        clearable
        @keyup.enter="openRepo"
      />
      <el-button type="primary" :loading="opening" @click="openRepo">打开</el-button>
      <el-button @click="openCloneDialog">克隆到本地</el-button>
      <el-tooltip content="对所有可用仓 git fetch，合成一条后台任务。丢失仓会跳过。" placement="top">
        <el-button :loading="fetching" @click="fetchAll">刷新</el-button>
      </el-tooltip>
    </section>

    <!-- 需要关注：冲突 / 进行中操作 / 脏工作区 / 落后，各取最严重的一仓 -->
    <section v-if="attentionItems.length" class="attention">
      <button
        v-for="(item, i) in attentionItems"
        :key="i"
        type="button"
        class="att-item"
        :class="item.tone"
        @click="attentionGo(item)"
      >
        <GcIcon :name="item.icon" :size="16" />
        <span class="att-copy">
          <b>{{ item.name }}</b>
          <span>{{ item.text }}</span>
        </span>
        <GcIcon name="chevron" :size="12" class="att-go" />
      </button>
    </section>

    <section v-if="!current" class="hero">
      <div class="hero-copy">
        <p class="eyebrow">工作台</p>
        <h3>还没有打开仓库</h3>
        <p class="hero-hint">输入本地 Git 路径，或从远程克隆。不会删盘上的文件。</p>
      </div>
    </section>
    <section v-else class="hero">
      <div class="hero-copy">
        <div class="hero-line">
          <h3>{{ currentOv?.name || current.path.split(/[\\/]/).pop() }}</h3>
          <span class="path mono" :title="current.path">{{ current.path }}</span>
          <span class="hero-spacer" />
          <el-button type="primary" :disabled="currentMissing" @click="openStatus(current.id)">进入工作区</el-button>
          <el-button :disabled="currentMissing" @click="openMerge(current.id)">预演合并</el-button>
          <el-button v-if="currentMissing" type="danger" plain @click="removeRepo(current.id, current.path)"
            >移除</el-button
          >
        </div>
        <div class="branch">
          <span class="wx" :class="currentAttention">{{
            currentMissing ? '丢失' : weatherOf(currentAttention)
          }}</span>
          <code>{{ currentMissing ? '不可用' : currentOv?.current || '…' }}</code>
          <template v-if="currentOv && !currentMissing">
            <span class="ab"
              ><b :class="{ on: currentOv.ahead > 0 }">{{ currentOv.ahead }}</b
              >↑ <b :class="{ on: currentOv.behind > 0 }">{{ currentOv.behind }}</b
              >↓</span
            >
            <span v-if="currentOv.dirtyCount" class="chip">{{ currentOv.dirtyCount }} 更改</span>
            <span v-if="currentOv.conflictCount" class="chip danger">{{ currentOv.conflictCount }} 冲突</span>
            <span v-if="currentOv.operation !== 'none'" class="chip danger">{{ currentOv.operation }}</span>
            <span v-if="currentOv.tempMergeBranchCount" class="chip"
              >{{ currentOv.tempMergeBranchCount }} 合并草稿</span
            >
          </template>
          <span v-if="currentMissing" class="hero-hint">路径不存在或不是 Git 仓库，移除不会删磁盘</span>
        </div>
      </div>
      <ActivityHeatmap
        v-if="!currentMissing"
        :days="currentOv?.activity"
        :start="currentOv?.activityStart"
        :total="currentOv?.activityTotal"
      />
    </section>

    <section v-if="repos.repos.length" class="weather">
      <button
        v-for="w in weatherTabs"
        :key="w.key"
        type="button"
        class="wx-tab"
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
.page-head {
  flex: none;
  display: flex;
  align-items: center;
  gap: var(--gc-gap);
  min-width: 0;
}
.page-head h1 {
  margin: 0;
  font-size: var(--gc-fs-page);
  font-weight: 600;
  line-height: var(--gc-lh-page);
  color: var(--gc-text);
  letter-spacing: -0.01em;
}
.page-head .sub {
  font-size: var(--gc-fs-body);
  color: var(--gc-text-3);
}
.page-head .spacer {
  flex: 1;
}
.overview-refreshing {
  font-size: var(--gc-fs-meta);
  color: var(--gc-text-3);
  animation: overview-pulse 1.2s ease-in-out infinite;
}
/* 常驻打开栏 */
.open-bar {
  flex: none;
  display: flex;
  align-items: center;
  gap: var(--gc-gap);
  padding: var(--gc-gap) var(--gc-pad);
  background: var(--gc-card);
  border: 1px solid var(--gc-line);
  border-radius: var(--gc-radius);
}
.open-bar .open-input {
  flex: 1;
  min-width: 0;
  max-width: 560px;
}
/* 需要关注（对齐设计稿 attention 三联） */
.attention {
  flex: none;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--gc-gap);
}
.att-item {
  display: flex;
  align-items: center;
  gap: var(--gc-gap);
  padding: 9px var(--gc-pad);
  border: 1px solid var(--gc-line);
  border-left: 2px solid var(--gc-line);
  border-radius: var(--gc-radius);
  background: var(--gc-card);
  color: inherit;
  text-align: left;
  cursor: pointer;
  min-width: 0;
  transition: background var(--gc-t-micro) var(--gc-ease);
}
.att-item:hover {
  background: var(--gc-btn-hover);
}
.att-item.red {
  border-left-color: var(--gc-red);
}
.att-item.red > .gc-icon {
  color: var(--gc-red);
}
.att-item.amber {
  border-left-color: var(--gc-amber);
}
.att-item.amber > .gc-icon {
  color: var(--gc-amber);
}
.att-item.accent {
  border-left-color: var(--gc-accent);
}
.att-item.accent > .gc-icon {
  color: var(--gc-accent-text);
}
.att-copy {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.att-copy b {
  font-size: var(--gc-fs-body);
  font-weight: 600;
  color: var(--gc-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.att-copy span {
  font-size: var(--gc-fs-meta);
  color: var(--gc-text-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.att-go {
  flex: none;
  color: var(--gc-text-placeholder);
}
@keyframes overview-pulse {
  0%,
  100% {
    opacity: 0.45;
  }
  50% {
    opacity: 1;
  }
}
.offline {
  flex: none;
}
.hero {
  flex: none;
  display: flex;
  justify-content: space-between;
  gap: var(--gc-pad);
  align-items: flex-start;
  padding: var(--gc-pad);
  background: var(--gc-card);
  border: 1px solid var(--gc-line);
  border-radius: var(--gc-radius);
}
.hero-copy {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--gc-gap);
}
.eyebrow {
  margin: 0;
  font-size: var(--gc-fs-body);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--gc-accent-text);
}
.hero h3 {
  margin: 0;
  flex: none;
  font-size: var(--el-font-size-extra-large);
  font-weight: 600;
}
.hero-line {
  display: flex;
  align-items: center;
  gap: var(--gc-gap);
  min-width: 0;
}
.hero-line .path {
  min-width: 0;
}
.hero-spacer {
  flex: 1;
}
.path {
  margin: 0;
  font-size: var(--gc-fs-body);
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
  font-size: var(--gc-fs-body);
  padding: 0 var(--gc-gap);
  border-radius: var(--gc-r-tag);
  background: var(--el-fill-color-light);
}
.wx.stuck {
  color: var(--gc-red);
  background: var(--gc-red-weak);
}
.wx.dirty {
  color: var(--gc-amber);
  background: var(--gc-amber-weak);
}
.wx.sync {
  color: var(--gc-accent-text);
  background: var(--gc-accent-weak);
}
.wx.quiet {
  color: var(--gc-green);
  background: var(--gc-green-weak);
}
.ab b {
  font-size: var(--el-font-size-extra-large);
  font-weight: 600;
  margin: 0 2px 0 4px;
}
.ab b.on:first-of-type {
  color: var(--gc-green);
}
.ab b.on:last-of-type {
  color: var(--gc-red);
}
.chip {
  font-size: var(--gc-fs-body);
  padding: 0 var(--gc-gap);
  border-radius: var(--gc-r-tag);
  background: var(--el-fill-color-light);
}
.chip.danger {
  color: var(--gc-red);
  background: var(--gc-red-weak);
}
.hero-hint {
  margin: 0;
  font-size: var(--gc-fs-body);
  color: var(--el-text-color-secondary);
}
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
  text-align: left;
  color: inherit;
  padding: var(--gc-pad);
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 2px;
  font: inherit;
  background: var(--gc-card);
  border: 1px solid var(--gc-line);
  border-radius: var(--gc-radius);
  transition:
    background var(--gc-t-micro) var(--gc-ease),
    border-color var(--gc-t-micro) var(--gc-ease);
}
.wx-tab strong {
  font-size: var(--el-font-size-extra-large);
  line-height: 1;
}
.wx-tab.stuck strong {
  color: var(--gc-red);
}
.wx-tab.dirty strong {
  color: var(--gc-amber);
}
.wx-tab.sync strong {
  color: var(--gc-accent-text);
}
.wx-tab.quiet strong {
  color: var(--gc-green);
}
.wx-tab small {
  color: var(--gc-text-3);
  font-size: var(--gc-fs-body);
  line-height: 1.35;
}
.wx-tab.on {
  background: var(--gc-accent-weak);
  box-shadow: 0 0 0 1px var(--gc-accent) inset;
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
