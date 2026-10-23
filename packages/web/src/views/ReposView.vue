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
import { jobLine, notifyJobStarted } from '@/utils/jobNotify';
import {
  attentionOf,
  attentionRank,
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
  let lost = 0;
  for (const r of repos.repos) {
    const a = attentionOf(overviewOf(r.path));
    if (a === 'lost') lost += 1;
    else if (a === 'stuck') stuck += 1;
    else if (a === 'dirty') dirty += 1;
    else if (a === 'sync') sync += 1;
    else quiet += 1;
  }
  return { stuck, dirty, sync, quiet, lost };
});

const filterTabs = computed(() => {
  const n = repos.repos.length;
  const c = filterCounts.value;
  return [
    { key: 'all' as const, weather: '全部', count: n, aria: filterAriaName('all', n), hint: '所有已打开的仓库' },
    {
      key: 'stuck' as const,
      weather: '雷雨',
      count: c.stuck,
      aria: filterAriaName('stuck', c.stuck),
      hint: weatherHint('stuck')
    },
    {
      key: 'dirty' as const,
      weather: '薄雾',
      count: c.dirty,
      aria: filterAriaName('dirty', c.dirty),
      hint: weatherHint('dirty')
    },
    {
      key: 'sync' as const,
      weather: '刮风',
      count: c.sync,
      aria: filterAriaName('sync', c.sync),
      hint: weatherHint('sync')
    },
    {
      key: 'quiet' as const,
      weather: '晴天',
      count: c.quiet,
      aria: filterAriaName('quiet', c.quiet),
      hint: weatherHint('quiet')
    },
    {
      key: 'lost' as const,
      weather: '失效',
      count: c.lost,
      aria: filterAriaName('lost', c.lost),
      hint: weatherHint('lost')
    }
  ];
});

const cardRepos = computed(() => repos.repos.filter((r) => matchesFilter(overviewOf(r.path), filter.value)));

/* 三组分区：需要处理 / 干净 / 失效（均受筛选影响，组内按严重度排序） */
function bySeverity(a: { path: string }, b: { path: string }): number {
  const ra = attentionRank(attentionOf(overviewOf(a.path)));
  const rb = attentionRank(attentionOf(overviewOf(b.path)));
  if (ra !== rb) return ra - rb;
  return a.path.localeCompare(b.path);
}
const actionRepos = computed(() =>
  cardRepos.value.filter((r) => ['stuck', 'dirty', 'sync'].includes(attentionOf(overviewOf(r.path)))).sort(bySeverity)
);
const cleanRepos = computed(() =>
  cardRepos.value.filter((r) => attentionOf(overviewOf(r.path)) === 'quiet').sort(bySeverity)
);
const lostRepos = computed(() =>
  cardRepos.value.filter((r) => attentionOf(overviewOf(r.path)) === 'lost').sort(bySeverity)
);
const lostOpen = ref(false);
const showLost = computed(() => filter.value === 'lost' || lostOpen.value);

/** 当前仓（跟随卡片点击联动） */
const current = computed(() => repos.repos.find((r) => r.id === repos.currentId) ?? repos.repos[0] ?? null);
const currentOv = computed(() => (current.value ? overviewOf(current.value.path) : undefined));
const currentAttention = computed(() => attentionOf(currentOv.value));
const currentMissing = computed(() => currentOv.value?.available === false);

/** 当前仓 12 周提交趋势（按周聚合，联动条迷你热力用） */
const currentWeeks = computed<number[]>(() => {
  const days = currentOv.value?.activity ?? [];
  const weeks: number[] = [];
  for (let i = 0; i + 7 <= days.length; i += 7) {
    weeks.push(days.slice(i, i + 7).reduce((a, b) => a + b, 0));
  }
  return weeks.slice(-12);
});
const weekLevels = computed<number[]>(() => {
  const ws = currentWeeks.value;
  const max = Math.max(1, ...ws);
  return ws.map((v) => (v === 0 ? 0 : Math.min(4, Math.max(1, Math.ceil((v / max) * 4)))));
});

async function removeAllLost(): Promise<void> {
  const lost = repos.repos.filter((r) => overviewOf(r.path)?.available === false);
  if (!lost.length) return;
  try {
    await ElMessageBox.confirm(`从列表移除 ${lost.length} 个失效仓库？不会删除磁盘上的文件。`, '批量移除失效仓库', {
      type: 'warning',
      confirmButtonText: '移除',
      cancelButtonText: '取消',
      closeOnClickModal: false
    });
  } catch {
    return;
  }
  for (const r of lost) {
    try {
      await repos.remove(r.id);
      overview.remove([r.id]);
    } catch {
      // 单个失败不阻断其余
    }
  }
  ElMessage.success(`已移除 ${lost.length} 个失效仓库`);
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
    <el-alert
      v-if="repos.healthOk === false"
      title="后端离线。请先启动 git-cockpit start，或用桌面应用拉起 daemon。"
      type="error"
      :closable="false"
      show-icon
      class="offline"
    />

    <!-- 工具栏：状态筛选（失效独立档）+ 打开 / 克隆 / 抓取（常驻，无仓时也能打开第一个仓） -->
    <section class="toolbar">
      <div v-if="repos.repos.length" class="seg" role="group" aria-label="按状态筛选仓库">
        <button
          v-for="w in filterTabs"
          :key="w.key"
          type="button"
          :class="[w.key, { on: filter === w.key }]"
          :aria-label="w.aria"
          :title="w.hint"
          @click="setFilter(w.key)"
        >
          {{ w.weather }}<span class="n">{{ w.count }}</span>
        </button>
      </div>
      <span class="spacer" />
      <span v-if="overview.refreshing" class="overview-refreshing" aria-live="polite">更新中…</span>
      <el-input
        v-model="newPath"
        class="open-input"
        placeholder="输入本地 Git 仓库路径，例如 D:/project/repo 或 /Users/me/code/app"
        clearable
        @keyup.enter="openRepo"
      />
      <el-button type="primary" :loading="opening" @click="openRepo">打开</el-button>
      <el-button @click="openCloneDialog">克隆到本地</el-button>
      <el-tooltip content="对所有可用仓 git fetch，合成一条后台任务。失效仓会跳过。" placement="top">
        <el-button :loading="fetching" @click="fetchAll">刷新</el-button>
      </el-tooltip>
    </section>

    <!-- 当前仓联动条：点网格卡片即切换，这里同步名称/分支/统计与快捷操作 -->
    <section v-if="repos.repos.length && current" class="current-bar">
      <GcIcon name="repo" :size="14" class="cb-ico" />
      <b class="cb-name mono">{{ currentOv?.name || current.path.split(/[\\/]/).pop() }}</b>
      <span class="cb-path mono" :title="current.path">{{ current.path }}</span>
      <span class="wx" :class="currentAttention">{{ weatherOf(currentAttention) }}</span>
      <code class="cb-branch mono">{{ currentMissing ? '不可用' : currentOv?.current || '…' }}</code>
      <template v-if="currentOv && !currentMissing">
        <span class="cb-stats mono"
          ><b :class="{ on: currentOv.ahead > 0 }">{{ currentOv.ahead }}</b
          >↑ <b :class="{ on: currentOv.behind > 0 }">{{ currentOv.behind }}</b
          >↓</span
        >
        <span v-if="currentOv.dirtyCount" class="cb-chip dirty">{{ currentOv.dirtyCount }} 更改</span>
        <span v-if="currentOv.conflictCount" class="cb-chip danger">{{ currentOv.conflictCount }} 冲突</span>
        <span v-if="currentOv.operation !== 'none'" class="cb-chip danger">{{ currentOv.operation }}</span>
      </template>
      <span class="spacer" />
      <span
        v-if="!currentMissing && weekLevels.length"
        class="cb-heat"
        :title="`近 12 周提交 ${currentOv?.activityTotal ?? 0} 次`"
        aria-label="近 12 周提交趋势"
      >
        <i v-for="(lv, i) in weekLevels" :key="i" :class="'lv' + lv" />
      </span>
      <el-button size="small" type="primary" :disabled="currentMissing" @click="openStatus(current.id)"
        >进入工作区</el-button
      >
      <el-button size="small" :disabled="currentMissing" @click="openMerge(current.id)">预演合并</el-button>
    </section>

    <div v-if="!repos.repos.length" class="empty-state">
      <strong>还没有打开仓库</strong>
      <p>输入本地 Git 路径，或从远程克隆。不会删盘上的文件。</p>
    </div>

    <!-- 需要处理：真卡住 + 脏区 + 待同步 -->
    <section v-if="actionRepos.length" class="section">
      <div class="sec-head">
        <span class="t">需要处理</span>
        <span class="n">{{ actionRepos.length }}</span>
        <span class="line" />
        <span class="hint">冲突 / 操作未完成 / 未提交改动</span>
      </div>
      <div class="grid">
        <RepoCard
          v-for="r in actionRepos"
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

    <!-- 干净：零彩色装饰 -->
    <section v-if="cleanRepos.length" class="section">
      <div class="sec-head">
        <span class="t">干净</span>
        <span class="n">{{ cleanRepos.length }}</span>
        <span class="line" />
        <span class="hint">可直接开工</span>
      </div>
      <div class="grid">
        <RepoCard
          v-for="r in cleanRepos"
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

    <!-- 失效：默认折叠，独立计数，支持批量移除 -->
    <section v-if="lostRepos.length" class="section">
      <div class="sec-head">
        <span class="t">失效</span>
        <span class="n">{{ lostRepos.length }}</span>
        <span class="line" />
        <span class="hint">路径不存在或不是 Git 仓库</span>
        <el-button text size="small" @click="lostOpen = !lostOpen">{{ showLost ? '收起' : '展开' }}</el-button>
        <el-button text size="small" type="danger" @click="removeAllLost">批量移除</el-button>
      </div>
      <div v-if="showLost" class="grid">
        <RepoCard
          v-for="r in lostRepos"
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
  gap: var(--gc-s3);
  overflow: auto;
  width: 100%;
  max-width: 1280px;
  margin: 0 auto;
}
.overview-refreshing {
  font-size: var(--gc-fs-meta);
  color: var(--gc-text-3);
  animation: overview-pulse 1.2s ease-in-out infinite;
}
/* 工具栏：状态筛选 + 打开 / 克隆 / 抓取（一行） */
/* 工具栏：裸行，不加卡片壳（同设置页 gc-chip-tabs 的语言） */
.toolbar {
  flex: none;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--gc-s2);
  min-width: 0;
}
.toolbar .spacer {
  flex: 1;
}
.seg {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 2px;
  border-radius: var(--gc-radius);
  background: var(--gc-page);
  border: 1px solid var(--gc-line);
  flex: none;
}
.seg button {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 24px;
  padding: 0 9px;
  border: 0;
  border-radius: var(--gc-r-tag);
  background: transparent;
  color: var(--gc-text-3);
  font: inherit;
  font-size: var(--gc-fs-meta);
  cursor: pointer;
  white-space: nowrap;
  transition:
    background var(--gc-t-micro) var(--gc-ease),
    color var(--gc-t-micro) var(--gc-ease);
}
.seg button:hover {
  color: var(--gc-text-2);
}
.seg button.on {
  background: var(--gc-accent-weak);
  color: var(--gc-accent-text);
}
.seg button.lost.on {
  background: rgba(255, 255, 255, 0.06);
  color: var(--gc-text-2);
}
.seg .n {
  font-family: var(--gc-font-mono);
  font-size: var(--gc-fs-micro);
  font-variant-numeric: tabular-nums;
  opacity: 0.85;
}
.open-input {
  width: 480px;
  max-width: 100%;
}
.eyebrow {
  margin: 0;
  font-size: var(--gc-fs-meta);
  letter-spacing: 0.04em;
  color: var(--gc-text-3);
}
/* 空态：无仓时给引导 */
/* 当前仓联动条（单行，跟随网格选中） */
.current-bar {
  flex: none;
  display: flex;
  align-items: center;
  gap: var(--gc-s2);
  min-width: 0;
  padding: var(--gc-gap) var(--gc-s3);
  background: var(--gc-card);
  border: 1px solid var(--gc-line);
  border-left: 2px solid var(--gc-accent);
  border-radius: var(--gc-radius);
}
.cb-ico {
  flex: none;
  color: var(--gc-text-3);
}
.cb-name {
  flex: none;
  font-size: var(--gc-fs-body);
  font-weight: 600;
  color: var(--gc-text);
  white-space: nowrap;
}
.cb-path {
  flex: 0 1 auto;
  min-width: 0;
  max-width: 380px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--gc-fs-meta);
  color: var(--gc-text-3);
}
.cb-branch {
  flex: none;
  font-size: var(--gc-fs-meta);
  color: var(--gc-text-2);
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cb-stats {
  flex: none;
  font-size: var(--gc-fs-meta);
  color: var(--gc-text-3);
  font-variant-numeric: tabular-nums;
}
.cb-stats b.on {
  color: var(--gc-amber);
}
.cb-chip {
  flex: none;
  height: 18px;
  padding: 0 7px;
  border-radius: var(--gc-r-tag);
  font-size: var(--gc-fs-micro);
  display: inline-flex;
  align-items: center;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid var(--gc-line);
  color: var(--gc-text-3);
}
.cb-chip.danger {
  background: var(--gc-red-weak);
  border-color: rgba(255, 133, 133, 0.28);
  color: var(--gc-red);
}
.current-bar .spacer {
  flex: 1;
}
/* 当前仓迷你热力：12 周周聚合，柱高表达强度 */
.cb-heat {
  flex: none;
  display: inline-flex;
  align-items: flex-end;
  gap: 2px;
  height: 14px;
}
.cb-heat i {
  width: 4px;
  border-radius: 1px;
  background: var(--gc-line);
}
.cb-heat i.lv0 {
  height: 2px;
  background: var(--gc-line);
}
.cb-heat i.lv1 {
  height: 4px;
  background: rgba(20, 200, 184, 0.35);
}
.cb-heat i.lv2 {
  height: 7px;
  background: rgba(20, 200, 184, 0.6);
}
.cb-heat i.lv3 {
  height: 10px;
  background: var(--gc-accent);
}
.cb-heat i.lv4 {
  height: 13px;
  background: var(--gc-accent);
  box-shadow: var(--gc-glow-sm);
}
/* 天气徽标（联动条复用） */
.wx {
  flex: none;
  height: 18px;
  padding: 0 7px;
  border-radius: var(--gc-r-tag);
  font-size: var(--gc-fs-micro);
  font-weight: 500;
  line-height: 1;
  display: inline-flex;
  align-items: center;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid var(--gc-line);
  color: var(--gc-text-3);
}
.wx.stuck {
  color: var(--gc-red);
  background: var(--gc-red-weak);
  border-color: rgba(255, 133, 133, 0.28);
}
.wx.dirty {
  color: var(--gc-amber);
  background: var(--gc-amber-weak);
  border-color: rgba(242, 201, 76, 0.28);
}
.wx.sync {
  color: var(--gc-accent-text);
  background: var(--gc-accent-weak);
  border-color: rgba(20, 200, 184, 0.28);
}
.wx.quiet {
  color: var(--gc-green);
  background: var(--gc-green-weak);
  border-color: rgba(86, 217, 122, 0.28);
}
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--gc-gap);
  padding: var(--gc-s4) var(--gc-pad);
  background: var(--gc-card);
  border: 1px solid var(--gc-line);
  border-radius: var(--gc-radius);
  text-align: center;
}
.empty-state strong {
  font-size: var(--el-font-size-extra-large);
  font-weight: 600;
  color: var(--gc-text);
}
.empty-state p {
  margin: 0;
  font-size: var(--gc-fs-body);
  color: var(--gc-text-3);
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
/* 分区：需要处理 / 干净 / 失效 */
.section {
  flex: none;
  display: flex;
  flex-direction: column;
  gap: var(--gc-s2);
}
.sec-head {
  display: flex;
  align-items: center;
  gap: var(--gc-s2);
  min-width: 0;
}
.sec-head .t {
  font-size: var(--gc-fs-body);
  font-weight: 600;
  color: var(--gc-text);
  white-space: nowrap;
}
.sec-head .n {
  font-family: var(--gc-font-mono);
  font-size: var(--gc-fs-meta);
  color: var(--gc-text-3);
  font-variant-numeric: tabular-nums;
}
.sec-head .line {
  flex: 1;
  height: 1px;
  background: var(--gc-line-weak);
}
.sec-head .hint {
  font-size: var(--gc-fs-meta);
  color: var(--gc-text-3);
  white-space: nowrap;
}
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(236px, 1fr));
  gap: var(--gc-s2);
  align-content: start;
}
</style>
