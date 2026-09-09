<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { useJobsStore } from '@/stores/jobs';
import * as api from '@/api/client';
import CloneDialog from '@/components/CloneDialog.vue';
import { kindLabel, notifyJobStarted, statusLabel, statusTag } from '@/utils/jobNotify';
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
const jobLogText = computed(() =>
  (activeJob.value?.logs ?? []).join('\n').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
);

function jobLine(j: CloneJobSummary): string {
  if (j.kind === 'clone') return [j.url, j.destDir ? `→ ${j.destDir}` : ''].filter(Boolean).join(' ');
  return j.title || j.repoPath || j.id;
}

function tailOf(j: CloneJobSummary): string {
  if (j.error) return j.error;
  if (j.tail) return j.tail.split('\n').filter(Boolean).at(-1) ?? '';
  return '';
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
  <div class="page">
    <h2 class="page-title">任务</h2>

    <div class="split" v-loading="jobs.loading && !jobs.jobs.length">
      <section class="pane list-pane">
        <div class="pane-head">
          <div class="chips">
            <button type="button" class="chip" :class="{ on: filter === 'all' }" @click="setFilter('all')">
              全部 {{ counts.all }}
            </button>
            <button
              type="button"
              class="chip running"
              :class="{ on: filter === 'running' }"
              @click="setFilter('running')"
            >
              进行中 {{ counts.running }}
            </button>
            <button
              type="button"
              class="chip error"
              :class="{ on: filter === 'error' }"
              @click="setFilter('error')"
            >
              失败 {{ counts.error }}
            </button>
            <button type="button" class="chip ok" :class="{ on: filter === 'ok' }" @click="setFilter('ok')">
              成功 {{ counts.ok }}
            </button>
          </div>
          <el-button text type="primary" :loading="jobs.loading" @click="jobs.load()">刷新</el-button>
        </div>

        <el-empty
          v-if="!jobs.loading && !jobs.jobs.length"
          description="还没有后台任务。可在工作台克隆仓库。"
          :image-size="48"
        />
        <el-empty v-else-if="!visibleJobs.length" description="没有这类任务" :image-size="48" />

        <div v-else class="job-list">
          <button
            v-for="j in visibleJobs"
            :key="j.id"
            type="button"
            class="job-row"
            :class="[j.status, { current: j.id === activeJobId }]"
            @click="openJob(j.id)"
          >
            <div class="row-top">
              <el-tag :type="statusTag(j.status)" size="small" effect="plain">{{ statusLabel(j.status) }}</el-tag>
              <span class="kind">{{ kindLabel(j.kind) }}</span>
              <span class="time">{{ formatTime(j.startedAt) }}</span>
              <el-button
                v-if="j.status === 'running'"
                size="small"
                text
                type="danger"
                :loading="cancellingId === j.id"
                @click.stop="cancelJob(j.id)"
              >取消</el-button>
              <el-button
                v-if="j.status === 'error' && j.kind === 'clone'"
                size="small"
                text
                type="primary"
                @click.stop="retryClone(j)"
              >重试</el-button>
            </div>
            <div class="row-title mono" :title="jobLine(j)">{{ jobLine(j) }}</div>
            <div class="row-tail" :class="{ err: !!j.error }">{{ tailOf(j) }}</div>
          </button>
        </div>
      </section>

      <section class="pane log-pane" v-loading="jobDetailLoading">
        <template v-if="activeJob">
          <div class="log-head">
            <div class="log-title">
              <el-tag :type="statusTag(activeJob.status)" size="small" effect="plain">{{
                statusLabel(activeJob.status)
              }}</el-tag>
              <span>{{ kindLabel(activeJob.kind) }}</span>
              <span class="time">{{ formatTime(activeJob.startedAt) }}</span>
            </div>
            <div class="log-actions">
              <el-button
                v-if="activeJob.status === 'running'"
                type="danger"
                plain
                :loading="cancellingId === activeJob.id"
                @click="cancelJob(activeJob.id)"
              >取消</el-button>
              <el-button
                v-if="activeJob.status === 'error' && activeJob.kind === 'clone'"
                type="primary"
                plain
                @click="retryClone(activeJob)"
              >修改并重试</el-button>
            </div>
          </div>
          <div class="job-meta mono">{{ jobLine(activeJob) }}</div>
          <el-alert
            v-if="activeJob.error"
            :title="activeJob.error"
            type="error"
            :closable="false"
            show-icon
            class="mb"
          />
          <pre ref="logEl" class="job-log">{{ jobLogText || '（等待输出）' }}</pre>
        </template>
        <el-empty v-else description="点左侧任务看日志" :image-size="48" />
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
.page {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.page-title {
  margin: 0 0 var(--gc-gap);
  font-size: 14px;
  flex: none;
}
.split {
  flex: 1;
  min-height: 0;
  display: flex;
  gap: var(--gc-gap);
}
.pane {
  min-height: 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: var(--gc-radius);
  background: var(--el-bg-color);
}
.list-pane {
  flex: 0 0 360px;
  width: 360px;
}
.log-pane {
  flex: 1;
  padding: var(--gc-pad);
}
.pane-head {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--gc-gap);
  padding: var(--gc-gap) var(--gc-pad);
  border-bottom: 1px solid var(--el-border-color-lighter);
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
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
.chip.running.on {
  border-color: var(--el-color-warning);
  color: var(--el-color-warning);
  background: var(--el-color-warning-light-9);
}
.chip.error.on {
  border-color: var(--el-color-danger);
  color: var(--el-color-danger);
  background: var(--el-color-danger-light-9);
}
.chip.ok.on {
  border-color: var(--el-color-success);
  color: var(--el-color-success);
  background: var(--el-color-success-light-9);
}
.job-list {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 4px;
}
.job-row {
  display: block;
  width: 100%;
  text-align: left;
  margin-bottom: 4px;
  padding: 6px 8px;
  border: 1px solid transparent;
  border-radius: var(--gc-radius);
  background: transparent;
  color: inherit;
  cursor: pointer;
}
.job-row:hover {
  background: var(--el-fill-color-light);
}
.job-row.current {
  border-color: var(--el-color-primary-light-5);
  background: var(--el-color-primary-light-9);
  box-shadow: 0 4px 12px color-mix(in srgb, var(--el-color-primary) 12%, transparent);
}
.job-row.running:not(.current) {
  background: color-mix(in srgb, var(--el-color-warning) 6%, transparent);
}
.row-top {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 22px;
}
.kind {
  font-size: 12px;
  color: var(--el-text-color-regular);
}
.time {
  margin-left: auto;
  font-size: 11px;
  color: var(--el-text-color-secondary);
  flex: none;
}
.row-title,
.row-tail {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.row-title {
  margin-top: 2px;
  font-size: var(--gc-text);
}
.row-tail {
  margin-top: 2px;
  font-size: 11px;
  color: var(--el-text-color-secondary);
}
.row-tail.err {
  color: var(--el-color-danger);
}
.log-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--gc-gap);
  flex: none;
}
.log-title {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.log-actions {
  flex: none;
}
.job-meta {
  margin: var(--gc-gap) 0;
  font-size: var(--gc-text);
  color: var(--el-text-color-secondary);
  word-break: break-all;
}
.mb {
  margin-bottom: var(--gc-gap);
}
.job-log {
  flex: 1;
  min-height: 0;
  margin: 0;
  overflow: auto;
  padding: var(--gc-pad);
  background: var(--el-fill-color-light);
  border-radius: var(--gc-radius);
  font-size: 12px;
  line-height: 1.45;
  white-space: pre-wrap;
  word-break: break-all;
}
</style>
