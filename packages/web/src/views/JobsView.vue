<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { useJobsStore } from '@/stores/jobs';
import * as api from '@/api/client';
import CloneDialog from '@/components/CloneDialog.vue';
import { jobLine, kindLabel, notifyJobStarted, statusLabel } from '@/utils/jobNotify';
import { repoLeaf } from '@/stores/chat';
import { relTime } from '@/utils/time';
import { getDesktopBridge } from '@/desktopBridge';
import type { CloneJobSummary, JobStatus } from '@/api/types';

type Filter = 'all' | JobStatus;

const jobs = useJobsStore();
const route = useRoute();
const router = useRouter();

const activeJobId = ref<string | null>(null);
const filter = ref<Filter>('all');
const jobDetailLoading = ref(false);
const cancellingId = ref<string | null>(null);
const cloneVisible = ref(false);
const cloneRetrying = ref(false);
const cloneUrl = ref('');
const cloneDest = ref('');
const cloning = ref(false);
const logEl = ref<HTMLElement | null>(null);
const nowTick = ref(Date.now());

const counts = computed(() => ({
  all: jobs.jobs.length,
  running: jobs.jobs.filter((j) => j.status === 'running').length,
  error: jobs.jobs.filter((j) => j.status === 'error').length,
  ok: jobs.jobs.filter((j) => j.status === 'ok').length
}));

const visibleJobs = computed(() => {
  const list = filter.value === 'all' ? jobs.jobs.slice() : jobs.jobs.filter((j) => j.status === filter.value);
  return list.sort((a, b) => {
    if (a.status === 'running' && b.status !== 'running') return -1;
    if (a.status !== 'running' && b.status === 'running') return 1;
    return a.startedAt < b.startedAt ? 1 : -1;
  });
});

/* 分组卡片流：进行中 / 失败 / 成功 */
const groups = [
  { key: 'running' as const, label: '进行中', icon: 'activity' },
  { key: 'error' as const, label: '失败', icon: 'alert' },
  { key: 'ok' as const, label: '成功', icon: 'check' }
];
const groupJobs = (key: JobStatus): CloneJobSummary[] => visibleJobs.value.filter((j) => j.status === key);

const activeJob = computed(() => jobs.jobs.find((j) => j.id === activeJobId.value) ?? null);
const jobLogText = computed(() => (activeJob.value?.logs ?? []).join('\n').replace(/\r\n/g, '\n').replace(/\r/g, '\n'));

function jobPercent(j: CloneJobSummary): number | null {
  if (!j.progress || !j.progress.total) return null;
  return Math.max(0, Math.min(100, Math.round((j.progress.current / j.progress.total) * 100)));
}

function installReady(j: CloneJobSummary): boolean {
  return j.kind === 'desktop-download' && j.status === 'ok' && j.payload?.installReady === true;
}

function tailOf(j: CloneJobSummary): string {
  if (j.error) return j.error;
  if (j.kind === 'desktop-download') {
    const percent = jobPercent(j);
    if (j.status === 'running' && percent != null) return `下载 ${percent}%`;
    if (installReady(j)) return '下载完成，可以安装';
  }
  if (j.tail) return j.tail.split('\n').filter(Boolean).at(-1) ?? '';
  return '';
}

function kindIcon(kind: string): string {
  if (kind === 'clone') return 'pull';
  if (kind === 'survey') return 'layers';
  if (kind === 'fetch') return 'refresh';
  if (kind === 'desktop-download') return 'arrow-down';
  return 'commit';
}

function repoLeafOf(j: CloneJobSummary): string {
  return j.repoPath ? repoLeaf(j.repoPath) : '本机';
}

/** 耗时 mm:ss（运行中实时走秒） */
function durOf(j: CloneJobSummary): string {
  const start = new Date(j.startedAt).getTime();
  if (Number.isNaN(start)) return '—';
  const end = j.finishedAt ? new Date(j.finishedAt).getTime() : nowTick.value;
  const s = Math.max(0, Math.floor((end - start) / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

async function openJob(id: string): Promise<void> {
  const row = jobs.jobs.find((j) => j.id === id);
  if (row && filter.value !== 'all' && row.status !== filter.value) filter.value = 'all';
  activeJobId.value = id;
  if (route.query.id !== id) {
    await router.replace({ path: '/jobs', query: { id } });
  }
  jobDetailLoading.value = true;
  try {
    await jobs.loadDetail(id);
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : String(err));
  } finally {
    jobDetailLoading.value = false;
  }
}

function closeDrawer(): void {
  activeJobId.value = null;
  if (route.query.id) void router.replace({ path: '/jobs' });
}

function setFilter(next: Filter): void {
  filter.value = filter.value === next && next !== 'all' ? 'all' : next;
}

async function cancelJob(id: string): Promise<void> {
  cancellingId.value = id;
  try {
    const row = jobs.jobs.find((j) => j.id === id);
    if (row?.kind === 'desktop-download') {
      const bridge = getDesktopBridge();
      if (bridge) {
        const result = await bridge.cancelDownload();
        if (!result.ok && result.error) ElMessage.error(result.error);
        else ElMessage.success('已请求取消');
        return;
      }
    }
    await jobs.cancel(id);
    ElMessage.success('已请求取消');
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : String(err));
  } finally {
    cancellingId.value = null;
  }
}

function retryClone(job: CloneJobSummary): void {
  cloneRetrying.value = true;
  cloneUrl.value = job.url ?? '';
  cloneDest.value = job.destDir ?? '';
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
    notifyJobStarted({ id: job.id, kind: 'clone', title: `${url} → ${dest}`, router });
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : String(err));
  } finally {
    cloning.value = false;
  }
}

async function installDownloaded(): Promise<void> {
  const bridge = getDesktopBridge();
  if (!bridge) {
    ElMessage.warning('请在桌面窗口里安装');
    return;
  }
  const result = await bridge.install();
  if (!result.ok && result.error) ElMessage.error(result.error);
}

function scrollLog(): void {
  void nextTick(() => {
    const el = logEl.value;
    if (el) el.scrollTop = el.scrollHeight;
  });
}

watch(jobLogText, () => scrollLog());

let timer: number | undefined;
onMounted(() => {
  void jobs.load();
  if (route.query.id) void openJob(String(route.query.id));
  timer = window.setInterval(() => {
    if (jobs.jobs.some((j) => j.status === 'running')) nowTick.value = Date.now();
  }, 1000);
});
onUnmounted(() => {
  if (timer) window.clearInterval(timer);
});
</script>

<template>
  <div class="page jobs-page">
    <div class="chips">
      <el-radio-group :model-value="filter">
        <el-radio-button value="all" @click="setFilter('all')">全部 {{ counts.all }}</el-radio-button>
        <el-radio-button value="running" @click="setFilter('running')">进行中 {{ counts.running }}</el-radio-button>
        <el-radio-button value="error" @click="setFilter('error')">失败 {{ counts.error }}</el-radio-button>
        <el-radio-button value="ok" @click="setFilter('ok')">成功 {{ counts.ok }}</el-radio-button>
      </el-radio-group>
      <span class="spacer" />
      <el-button :loading="jobs.loading" @click="jobs.load">刷新</el-button>
    </div>

    <div class="jobs-scroll">
      <div v-if="!jobs.loading && visibleJobs.length === 0" class="empty gc-card">
        <strong>还没有后台任务</strong>
        <p>克隆、矩阵扫描、抓取远程会排在这里。去工作台克隆一个仓。</p>
      </div>

      <template v-for="g in groups" :key="g.key">
        <section v-if="groupJobs(g.key).length" class="job-group">
          <header class="card-head">
            <GcIcon :name="g.icon" :size="14" />
            <h3>{{ g.label }}</h3>
            <span class="cnt">{{ groupJobs(g.key).length }}</span>
            <span class="spacer" />
            <span v-if="g.key === 'running'" class="chip plain">并发上限 2</span>
          </header>
          <button
            v-for="j in groupJobs(g.key)"
            :key="j.id"
            type="button"
            class="job"
            :class="{ on: j.id === activeJobId }"
            @click="openJob(j.id)"
          >
            <span class="job-top">
              <span class="job-ico" :class="j.status"><GcIcon :name="kindIcon(j.kind)" :size="14" /></span>
              <span class="job-main">
                <span class="job-title" :title="jobLine(j)">{{ jobLine(j) }}</span>
                <span class="job-sub">{{ kindLabel(j.kind) }} · {{ repoLeafOf(j) }} · {{ relTime(j.startedAt) }}</span>
              </span>
              <span v-if="j.kind === 'desktop-download' && jobPercent(j) != null" class="job-prog">
                <span class="bar" :class="j.status">
                  <i class="fill" :style="{ width: (jobPercent(j) ?? 0) + '%' }" />
                  <i v-if="j.status === 'running'" class="scan" />
                </span>
                <span class="pct">{{ jobPercent(j) }}%</span>
              </span>
              <span class="st" :class="j.status">{{ statusLabel(j.status) }}</span>
              <span class="job-dur">{{ durOf(j) }}</span>
            </span>
            <span v-if="tailOf(j)" class="job-log" :title="tailOf(j)">{{ tailOf(j) }}</span>
          </button>
        </section>
      </template>
    </div>

    <!-- 日志抽屉：点任务卡右侧滑出，保留原日志面板全部能力 -->
    <div v-if="activeJob" class="drawer-mask" @click="closeDrawer" />
    <aside v-if="activeJob" class="log-drawer" v-loading="jobDetailLoading">
      <header class="drawer-head">
        <span class="st" :class="activeJob.status">{{ statusLabel(activeJob.status) }}</span>
        <span class="drawer-title">{{ kindLabel(activeJob.kind) }} · {{ relTime(activeJob.startedAt) }}</span>
        <span class="spacer" />
        <el-button
          v-if="activeJob.status === 'running'"
          size="small"
          :loading="cancellingId === activeJob.id"
          @click="cancelJob(activeJob.id)"
          >取消</el-button
        >
        <el-button
          v-if="activeJob.status === 'error' && activeJob.kind === 'clone'"
          size="small"
          type="primary"
          plain
          @click="retryClone(activeJob)"
          >修改并重试</el-button
        >
        <el-button
          v-if="activeJob.kind === 'desktop-download'"
          size="small"
          type="primary"
          plain
          :disabled="!installReady(activeJob)"
          @click="installDownloaded"
          >安装</el-button
        >
        <el-button size="small" text @click="closeDrawer">关闭</el-button>
      </header>
      <p class="meta mono">{{ jobLine(activeJob) }}</p>
      <p v-if="activeJob.error" class="banner-err">{{ activeJob.error }}</p>
      <div v-if="activeJob.kind === 'desktop-download'" class="dl">
        <div class="bar" :class="activeJob.status">
          <i class="fill" :style="{ width: (jobPercent(activeJob) ?? 0) + '%' }" />
          <i v-if="activeJob.status === 'running'" class="scan" />
        </div>
        <p v-if="activeJob.status === 'running'">正在下载桌面安装包。</p>
        <p v-else-if="installReady(activeJob)">下载完成。安装会退出并重启应用。</p>
      </div>
      <pre ref="logEl" class="log-pre">{{ jobLogText || '（等待输出）' }}</pre>
    </aside>

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
.jobs-page {
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: var(--gc-pad);
  overflow: hidden;
}
.jobs-scroll {
  flex: 1;
  min-height: 0;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: var(--gc-pad);
}
.chips {
  flex: none;
  display: flex;
  flex-wrap: wrap;
  gap: var(--gc-gap);
  align-items: center;
}
.chips .spacer {
  flex: 1;
}
.empty {
  flex: none;
  display: grid;
  place-content: center;
  text-align: center;
  padding: var(--gc-pad);
  gap: var(--gc-gap);
  color: var(--gc-text-3);
}
.empty strong {
  font-size: var(--el-font-size-extra-large);
  color: var(--gc-text);
  font-weight: 600;
}
.empty p {
  margin: 0;
  font-size: var(--gc-fs-body);
}

/* ---- 分组卡片流（对齐设计稿 job-group / job） ---- */
.job-group {
  flex: none;
  display: flex;
  flex-direction: column;
  background: var(--gc-card);
  border: 1px solid var(--gc-line);
  border-radius: var(--gc-radius);
  overflow: hidden;
}
.job-group > .card-head {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 36px;
  padding: 0 var(--gc-pad);
  background: var(--gc-page);
  border-bottom: 1px solid var(--gc-line);
}
.job-group > .card-head h3 {
  margin: 0;
  font-size: var(--gc-fs-body);
  font-weight: 600;
  color: var(--gc-text);
}
.job-group > .card-head .cnt {
  font-family: 'JetBrains Mono', 'Cascadia Code', Consolas, monospace;
  font-size: var(--gc-fs-micro);
  color: var(--gc-text-3);
  font-variant-numeric: tabular-nums;
}
.job-group > .card-head .spacer {
  flex: 1;
}
.job {
  display: flex;
  flex-direction: column;
  gap: 5px;
  width: 100%;
  padding: 9px var(--gc-pad);
  border: 0;
  border-bottom: 1px solid var(--gc-line-weak);
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
  font: inherit;
  transition: background var(--gc-t-micro) var(--gc-ease);
}
.job:last-child {
  border-bottom: 0;
}
.job:hover {
  background: var(--gc-btn-hover);
}
.job.on {
  background: var(--gc-accent-weak);
}
.job-top {
  display: flex;
  align-items: center;
  gap: var(--gc-gap);
  min-width: 0;
}
.job-ico {
  flex: none;
  width: 26px;
  height: 26px;
  border-radius: var(--gc-r-tag);
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--el-fill-color);
  color: var(--gc-text-3);
}
.job-ico.running {
  background: var(--gc-amber-weak);
  color: var(--gc-amber);
}
.job-ico.ok {
  background: var(--gc-green-weak);
  color: var(--gc-green);
}
.job-ico.error {
  background: var(--gc-red-weak);
  color: var(--gc-red);
}
.job-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.job-title {
  font-family: 'JetBrains Mono', 'Cascadia Code', Consolas, monospace;
  font-size: var(--gc-fs-body);
  color: var(--gc-text);
  line-height: 1.35;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.job-sub {
  font-family: 'JetBrains Mono', 'Cascadia Code', Consolas, monospace;
  font-size: var(--gc-fs-micro);
  color: var(--gc-text-3);
  line-height: 1.3;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.job-prog {
  flex: none;
  display: flex;
  align-items: center;
  gap: 7px;
  width: 190px;
}
.job-prog .bar {
  flex: 1;
}
.job-prog .pct {
  flex: none;
  width: 32px;
  text-align: right;
  font-family: 'JetBrains Mono', 'Cascadia Code', Consolas, monospace;
  font-size: var(--gc-fs-micro);
  color: var(--gc-text-3);
  font-variant-numeric: tabular-nums;
}
.job-dur {
  flex: none;
  font-family: 'JetBrains Mono', 'Cascadia Code', Consolas, monospace;
  font-size: var(--gc-fs-micro);
  color: var(--gc-text-3);
  font-variant-numeric: tabular-nums;
}
.job-log {
  font-family: 'JetBrains Mono', 'Cascadia Code', Consolas, monospace;
  font-size: var(--gc-fs-meta);
  color: var(--gc-text-3);
  line-height: 1.4;
  padding-left: 32px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.st {
  flex: none;
  height: 18px;
  padding: 0 8px;
  border-radius: var(--gc-r-tag);
  font-size: var(--gc-fs-meta);
  font-weight: 500;
  display: inline-flex;
  align-items: center;
}
.st.running {
  background: var(--gc-amber-weak);
  color: var(--gc-amber);
}
.st.ok {
  background: var(--gc-green-weak);
  color: var(--gc-green);
}
.st.error {
  background: var(--gc-red-weak);
  color: var(--gc-red);
}

/* 双段进度条：4px 轨道 + 信号填充 + 扫描段 */
.bar {
  position: relative;
  height: 4px;
  border-radius: 2px;
  background: var(--gc-accent-weak);
  overflow: hidden;
}
.bar .fill {
  position: absolute;
  inset: 0 auto 0 0;
  background: var(--gc-signal-bar);
  box-shadow: var(--gc-glow-bar);
  transition: width var(--gc-t-open) var(--gc-ease);
}
.bar.ok .fill {
  background: var(--gc-signal-done);
}
.bar.error .fill {
  background: var(--gc-red);
  box-shadow: 0 0 8px rgba(255, 133, 133, 0.35);
}
.bar .scan {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  width: 48px;
  background: var(--gc-signal-scan);
  opacity: 0.9;
  animation: gc-scan-bar 1800ms linear infinite;
}
@keyframes gc-scan-bar {
  from {
    left: -48px;
  }
  to {
    left: 100%;
  }
}

/* ---- 日志抽屉（右侧滑出） ---- */
.drawer-mask {
  position: fixed;
  inset: 44px 0 0;
  z-index: 24;
  background: rgba(2, 6, 12, 0.45);
}
.log-drawer {
  position: fixed;
  top: 44px;
  right: 0;
  bottom: 0;
  z-index: 26;
  width: min(560px, 92vw);
  display: flex;
  flex-direction: column;
  gap: var(--gc-gap);
  padding: var(--gc-pad);
  background: var(--gc-page);
  border-left: 1px solid var(--gc-line);
  box-shadow: var(--gc-shadow-menu);
}
.drawer-head {
  flex: none;
  display: flex;
  align-items: center;
  gap: var(--gc-gap);
  font-size: var(--gc-fs-body);
  min-width: 0;
}
.drawer-title {
  color: var(--gc-text-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.drawer-head .spacer {
  flex: 1;
}
.meta {
  margin: 0;
  font-size: var(--gc-fs-body);
  color: var(--gc-text-3);
  word-break: break-all;
}
.banner-err {
  margin: 0;
  padding: var(--gc-gap) var(--gc-pad);
  border-radius: var(--gc-radius);
  background: var(--gc-red-weak);
  color: var(--gc-red);
  font-size: var(--gc-fs-body);
  line-height: 1.45;
}
.dl {
  flex: none;
  display: flex;
  flex-direction: column;
  gap: var(--gc-gap);
}
.dl p {
  margin: 0;
  font-size: var(--gc-fs-body);
  color: var(--gc-text-3);
}
.log-pre {
  margin: 0;
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: var(--gc-pad);
  border-radius: var(--gc-radius);
  background: var(--gc-card);
  border: 1px solid var(--gc-line);
  font-size: var(--gc-fs-body);
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-all;
}
</style>
