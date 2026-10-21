<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { useJobsStore } from '@/stores/jobs';
import * as api from '@/api/client';
import CloneDialog from '@/components/CloneDialog.vue';
import { jobLine, kindLabel, notifyJobStarted, statusLabel } from '@/utils/jobNotify';
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

const activeJob = computed(() => jobs.jobs.find((j) => j.id === activeJobId.value) ?? null);
const jobLogText = computed(() => (activeJob.value?.logs ?? []).join('\n').replace(/\r\n/g, '\n').replace(/\r/g, '\n'));

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

function jobPercent(j: CloneJobSummary): number | null {
  if (!j.progress || !j.progress.total) return null;
  return Math.max(0, Math.min(100, Math.round((j.progress.current / j.progress.total) * 100)));
}

function installReady(j: CloneJobSummary): boolean {
  return j.kind === 'desktop-download' && j.status === 'ok' && j.payload?.installReady === true;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const diff = Date.now() - d.getTime();
  if (diff < 60_000) return '刚刚';
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 24 * 3600_000) return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleString(undefined, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
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

function setFilter(next: Filter): void {
  filter.value = next;
  if (activeJob.value && (next === 'all' || activeJob.value.status === next)) return;
  const first = visibleJobs.value[0];
  if (first) void openJob(first.id);
  else {
    activeJobId.value = null;
    if (route.query.id) void router.replace({ path: '/jobs' });
  }
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

function retryClone(job: { url?: string; destDir?: string }): void {
  cloneRetrying.value = true;
  cloneUrl.value = (job.url ?? '').trim();
  cloneDest.value = (job.destDir ?? '').trim();
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
    await openJob(job.id);
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

async function scrollLog(): Promise<void> {
  await nextTick();
  if (logEl.value) logEl.value.scrollTop = logEl.value.scrollHeight;
}

watch(jobLogText, () => void scrollLog());
watch(
  () => route.query.id,
  (id) => {
    if (typeof id === 'string' && id && id !== activeJobId.value) void openJob(id);
  }
);

onMounted(async () => {
  await jobs.load();
  const id = route.query.id;
  if (typeof id === 'string' && id) {
    await openJob(id);
    return;
  }
  const first = visibleJobs.value[0];
  if (first) await openJob(first.id);
});
</script>

<template>
  <div class="page jobs-page">
    <h2 class="page-title">任务</h2>

    <div v-if="!jobs.loading && !jobs.jobs.length" class="empty gc-card">
      <strong>还没有后台任务</strong>
      <p>克隆、矩阵扫描、抓取远程会排在这里。去工作台克隆一个仓。</p>
    </div>

    <div v-else class="split" v-loading="jobs.loading && !jobs.jobs.length">
      <aside class="gc-card list">
        <div class="chips">
          <button type="button" class="chip" :class="{ on: filter === 'all' }" @click="setFilter('all')">
            全部 {{ counts.all }}
          </button>
          <button type="button" class="chip" :class="{ on: filter === 'running' }" @click="setFilter('running')">
            进行中 {{ counts.running }}
          </button>
          <button type="button" class="chip" :class="{ on: filter === 'error' }" @click="setFilter('error')">
            失败 {{ counts.error }}
          </button>
          <button type="button" class="chip" :class="{ on: filter === 'ok' }" @click="setFilter('ok')">
            成功 {{ counts.ok }}
          </button>
          <el-button text type="primary" :loading="jobs.loading" @click="jobs.load()">刷新</el-button>
        </div>
        <p v-if="!visibleJobs.length" class="miss">没有这类任务</p>
        <button
          v-for="j in visibleJobs"
          :key="j.id"
          type="button"
          class="row"
          :class="[j.status, { on: j.id === activeJobId }]"
          @click="openJob(j.id)"
        >
          <div class="top">
            <span class="st" :class="j.status">{{ statusLabel(j.status) }}</span>
            <span>{{ kindLabel(j.kind) }}</span>
            <em>{{ formatTime(j.startedAt) }}</em>
          </div>
          <div class="title mono" :title="jobLine(j)">{{ jobLine(j) }}</div>
          <div class="tail" :class="{ err: !!j.error }">{{ tailOf(j) }}</div>
        </button>
      </aside>

      <section class="gc-card log" v-loading="jobDetailLoading">
        <template v-if="activeJob">
          <header>
            <span class="st" :class="activeJob.status">{{ statusLabel(activeJob.status) }}</span>
            <span>{{ kindLabel(activeJob.kind) }} · {{ formatTime(activeJob.startedAt) }}</span>
            <span class="grow" />
            <el-button
              v-if="activeJob.kind === 'desktop-download'"
              type="primary"
              plain
              :disabled="!installReady(activeJob)"
              @click="installDownloaded"
              >安装</el-button
            >
            <el-button
              v-if="activeJob.status === 'running'"
              type="danger"
              plain
              :loading="cancellingId === activeJob.id"
              @click="cancelJob(activeJob.id)"
              >取消</el-button
            >
            <el-button
              v-if="activeJob.status === 'error' && activeJob.kind === 'clone'"
              type="primary"
              plain
              @click="retryClone(activeJob)"
              >修改并重试</el-button
            >
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
          <pre v-else ref="logEl">{{ jobLogText || '（等待输出）' }}</pre>
        </template>
        <p v-else class="miss">点左侧任务看日志</p>
      </section>
    </div>

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
  gap: var(--gc-gap);
  overflow: hidden;
}
.split {
  flex: 1;
  min-height: 0;
  display: flex;
  gap: var(--gc-pad);
}
.list {
  width: 340px;
  flex: none;
  overflow: auto;
  padding: var(--gc-pad);
  display: flex;
  flex-direction: column;
  gap: var(--gc-gap);
}
.log {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  padding: var(--gc-pad);
  display: flex;
  flex-direction: column;
  gap: var(--gc-gap);
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--gc-gap);
  align-items: center;
}
.chips .chip {
  border: 0;
  border-radius: var(--gc-radius);
  padding: 0 var(--gc-pad);
  height: var(--gc-control);
  background: var(--el-fill-color-light);
  color: inherit;
  font: inherit;
  font-size: var(--gc-fs-body);
  cursor: pointer;
}
.chips .chip.on {
  background: var(--gc-accent-weak);
  color: var(--gc-accent-text);
}
.row {
  display: block;
  width: 100%;
  text-align: left;
  border: 0;
  border-radius: var(--gc-radius);
  padding: var(--gc-gap) var(--gc-pad);
  background: transparent;
  color: inherit;
  cursor: pointer;
  font: inherit;
}
.row.on {
  background: var(--gc-accent-weak);
}
.top {
  display: flex;
  gap: var(--gc-gap);
  align-items: center;
  font-size: var(--gc-fs-body);
}
.top em {
  margin-left: auto;
  font-style: normal;
  color: var(--gc-text-3);
}
/* 状态 chip：进行中琥珀 / 成功绿 / 失败红 / 排队中性 */
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
.st.queued {
  background: var(--el-fill-color);
  color: var(--gc-text-3);
}
.title,
.tail {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.title {
  font-size: var(--gc-fs-body);
  margin: 2px 0;
}
.tail {
  font-size: var(--gc-fs-body);
  color: var(--gc-text-3);
}
.tail.err {
  color: var(--gc-red);
}
/* 双段进度条：4px 轨道 + 信号填充 + 运行中纯色扫描段（禁渐变） */
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
header {
  display: flex;
  gap: var(--gc-gap);
  align-items: center;
  font-size: var(--gc-fs-body);
  flex: none;
}
.grow {
  flex: 1;
}
.meta {
  margin: 0;
  font-size: var(--gc-fs-body);
  color: var(--el-text-color-secondary);
  word-break: break-all;
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
  color: var(--el-text-color-secondary);
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
pre {
  margin: 0;
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: var(--gc-pad);
  border-radius: var(--gc-radius);
  background: var(--gc-page);
  font-size: var(--gc-fs-body);
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-all;
}
.miss {
  margin: 0;
  font-size: var(--gc-fs-body);
  color: var(--el-text-color-secondary);
  padding: var(--gc-pad);
}
.empty {
  flex: 1;
  display: grid;
  place-content: center;
  text-align: center;
  padding: var(--gc-pad);
  gap: var(--gc-gap);
  color: var(--el-text-color-secondary);
}
.empty strong {
  font-size: var(--el-font-size-extra-large);
  color: var(--el-text-color-primary);
  font-weight: 600;
}
.empty p {
  margin: 0;
  font-size: var(--gc-fs-body);
}
</style>
