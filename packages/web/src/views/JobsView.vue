<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { useJobsStore } from '@/stores/jobs';
import * as api from '@/api/client';
import CloneDialog from '@/components/CloneDialog.vue';
import { kindLabel, notifyJobStarted } from '@/utils/jobNotify';
import type { CloneJobSummary, JobKind } from '@/api/types';

const KIND_ORDER: JobKind[] = ['clone', 'survey', 'fetch'];

const jobs = useJobsStore();
const route = useRoute();
const router = useRouter();

const jobDrawer = ref(false);
const activeJobId = ref<string | null>(null);
const jobDetailLoading = ref(false);
const cancellingId = ref<string | null>(null);
const cloneVisible = ref(false);
const cloneRetrying = ref(false);
const cloneUrl = ref('');
const cloneDest = ref('');
const cloning = ref(false);

const activeJob = computed(() => jobs.jobs.find((j) => j.id === activeJobId.value) ?? null);
const jobLogText = computed(() =>
  (activeJob.value?.logs ?? []).join('\n').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
);

const groups = computed(() =>
  KIND_ORDER.map((kind) => ({
    kind,
    label: kindLabel(kind),
    items: jobs.jobs.filter((j) => j.kind === kind)
  })).filter((g) => g.items.length > 0)
);

function jobTag(status: string): 'success' | 'danger' | 'warning' {
  if (status === 'ok') return 'success';
  if (status === 'error') return 'danger';
  return 'warning';
}

async function openJob(id: string): Promise<void> {
  activeJobId.value = id;
  jobDrawer.value = true;
  jobDetailLoading.value = true;
  if (route.query.id !== id) {
    await router.replace({ path: '/jobs', query: { id } });
  }
  try {
    await jobs.loadDetail(id);
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : String(err));
  } finally {
    jobDetailLoading.value = false;
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
  jobDrawer.value = false;
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

function jobLine(j: CloneJobSummary): string {
  if (j.kind === 'clone') return [j.url, j.destDir ? `→ ${j.destDir}` : ''].filter(Boolean).join(' ');
  return j.title || j.repoPath || j.id;
}

watch(
  () => route.query.id,
  (id) => {
    if (typeof id === 'string' && id && id !== activeJobId.value) void openJob(id);
  }
);

onMounted(() => {
  void jobs.load();
  const id = route.query.id;
  if (typeof id === 'string' && id) void openJob(id);
});
</script>

<template>
  <div class="page">
    <h2 class="page-title">任务</h2>

    <el-card shadow="never" class="list-card" v-loading="jobs.loading">
      <template #header>
        <div class="list-header">
          <span>后台任务{{ jobs.runningCount ? `（进行中 ${jobs.runningCount}）` : '' }}</span>
          <el-button text type="primary" :loading="jobs.loading" @click="jobs.load()">刷新</el-button>
        </div>
      </template>

      <el-empty v-if="!jobs.loading && !jobs.jobs.length" description="还没有后台任务。可在工作台克隆仓库。" />

      <div v-else class="groups">
        <section v-for="g in groups" :key="g.kind" class="group">
          <div class="group-title">{{ g.label }}（{{ g.items.length }}）</div>
          <div
            v-for="j in g.items"
            :key="j.id"
            class="job-row"
            :class="{ active: j.id === activeJobId }"
            @click="openJob(j.id)"
          >
            <el-tag :type="jobTag(j.status)" size="small" effect="plain">{{ j.status }}</el-tag>
            <span class="job-line mono" :title="jobLine(j)">{{ jobLine(j) }}</span>
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
            <el-button size="small" text type="primary" @click.stop="openJob(j.id)">日志</el-button>
          </div>
        </section>
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

    <el-drawer v-model="jobDrawer" size="48%" destroy-on-close>
      <template #header>
        <div class="drawer-head">
          <span v-if="activeJob">{{ kindLabel(activeJob.kind) }} · {{ activeJob.status }}</span>
          <span v-else>任务日志</span>
          <el-button
            v-if="activeJob?.status === 'running'"
            type="danger"
            plain
            :loading="cancellingId === activeJob.id"
            @click="cancelJob(activeJob.id)"
          >取消</el-button>
          <el-button
            v-if="activeJob?.status === 'error' && activeJob.kind === 'clone'"
            type="primary"
            plain
            @click="retryClone(activeJob)"
          >修改并重试</el-button>
        </div>
      </template>
      <div v-loading="jobDetailLoading">
        <template v-if="activeJob">
          <div class="job-meta mono">{{ jobLine(activeJob) }}</div>
          <el-alert v-if="activeJob.error" :title="activeJob.error" type="error" :closable="false" show-icon class="mb" />
          <pre class="job-log">{{ jobLogText || '（等待输出）' }}</pre>
        </template>
      </div>
    </el-drawer>
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
  overflow: auto;
}
.list-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.group {
  margin-bottom: var(--gc-pad);
}
.group-title {
  height: var(--gc-line);
  line-height: var(--gc-line);
  font-size: 12px;
  font-weight: 600;
  color: var(--el-text-color-regular);
}
.job-row {
  display: flex;
  align-items: center;
  gap: var(--gc-gap);
  height: var(--gc-line);
  padding: 0 4px;
  cursor: pointer;
  border-radius: var(--gc-radius);
}
.job-row:hover,
.job-row.active {
  background: var(--el-fill-color-light);
}
.job-line {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--gc-text);
}
.drawer-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--gc-gap);
  width: 100%;
}
.job-meta {
  margin-bottom: var(--gc-gap);
  font-size: var(--gc-text);
  color: var(--el-text-color-secondary);
  word-break: break-all;
}
.mb {
  margin-bottom: var(--gc-gap);
}
.job-log {
  margin: 0;
  max-height: calc(100vh - 180px);
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
