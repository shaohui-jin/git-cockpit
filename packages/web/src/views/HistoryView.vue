<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import * as api from '@/api/client';
import { useReposStore } from '@/stores/repos';
import { useRevision } from '@/composables/revision';
import DiffViewer from '@/components/DiffViewer.vue';
import type { BranchInfo, CommitInfo, DiffResult } from '@/api/types';

const repos = useReposStore();
const { revision } = useRevision();
const repoId = (): number | null => repos.currentId;

const commits = ref<CommitInfo[]>([]);
const branches = ref<BranchInfo[]>([]);
const loading = ref(false);
const loadError = ref('');

const mode = ref<'head' | 'all' | 'branch'>('head');
const selectedBranch = ref('');
const pathFilter = ref('');
const maxCount = ref(50);

/** 提交详情抽屉：openCommit 成功后再置 visible，失败则拦截展开 */
const showVisible = ref(false);
const showCommit = ref<CommitInfo | null>(null);
const showDiff = ref<DiffResult | null>(null);

const localBranches = computed(() => branches.value.filter((b) => !b.remote));
const currentBranch = computed(() => branches.value.find((b) => b.current)?.name ?? '');

async function loadBranches(): Promise<void> {
  const id = repoId();
  if (id === null) return;
  try {
    const { branches: bs } = await api.listBranches(id);
    branches.value = bs;
  } catch {
    /* ignore */
  }
}

async function loadLog(): Promise<void> {
  const id = repoId();
  if (id === null) return;
  loading.value = true;
  loadError.value = '';
  try {
    const opts: Parameters<typeof api.getLog>[1] = {
      maxCount: maxCount.value
    };
    if (mode.value === 'all') {
      opts.all = true;
    } else if (mode.value === 'branch' && selectedBranch.value) {
      opts.from = selectedBranch.value;
    }
    if (pathFilter.value.trim()) opts.path = pathFilter.value.trim();
    commits.value = await api.getLog(id, opts);
  } catch (err) {
    loadError.value = err instanceof Error ? err.message : String(err);
    commits.value = [];
  } finally {
    loading.value = false;
  }
}

async function refresh(): Promise<void> {
  await Promise.all([loadBranches(), loadLog()]);
}

async function openCommit(c: CommitInfo): Promise<void> {
  const id = repoId();
  if (id === null) return;
  loading.value = true;
  try {
    // 先请求成功再展开抽屉：COMMIT_NOT_FOUND 等错误直接 message 提示并拦截展开
    const { diff } = await api.getShow(id, c.hash);
    showCommit.value = c;
    console.log(diff);
    showDiff.value = diff
    showVisible.value = true;
  } catch (err) {
    if (err instanceof api.ApiError && err.code === 'COMMIT_NOT_FOUND') {
      ElMessage.warning(`提交不存在（${c.shortHash}），可能已被清理，请刷新列表`);
    } else {
      ElMessage.error(err instanceof Error ? err.message : String(err));
    }
  } finally {
    loading.value = false;
  }
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

watch(repoId, () => void refresh());
watch(revision, () => void loadLog());
watch([mode, selectedBranch, maxCount], () => void loadLog());

onMounted(() => void refresh());
</script>

<template>
  <div class="page">
    <h2 class="page-title">提交历史</h2>
    <el-alert v-if="loadError" :title="loadError" type="error" :closable="false" show-icon class="mb" />

    <el-card shadow="never" class="mb">
      <div class="filter-bar">
        <el-radio-group v-model="mode">
          <el-radio-button value="head">当前分支（{{ currentBranch }}）</el-radio-button>
          <el-radio-button value="all">全部分支</el-radio-button>
          <el-radio-button value="branch">指定分支</el-radio-button>
        </el-radio-group>
        <el-select
          v-if="mode === 'branch'"
          v-model="selectedBranch"
          filterable
          placeholder="选择分支"
          class="branch-select"
        >
          <el-option v-for="b in localBranches" :key="b.name" :label="b.name" :value="b.name" />
        </el-select>
        <el-input v-model="pathFilter" clearable placeholder="按路径过滤（可选）" class="path-input" @keyup.enter="loadLog" />
        <el-select v-model="maxCount" class="count-select">
          <el-option label="20 条" :value="20" />
          <el-option label="50 条" :value="50" />
          <el-option label="100 条" :value="100" />
        </el-select>
        <el-button :loading="loading" @click="loadLog">刷新</el-button>
      </div>
    </el-card>

    <el-card shadow="never">
      <el-table :data="commits" v-loading="loading" size="default" highlight-current-row @row-click="openCommit">
        <el-table-column label="提交" width="100">
          <template #default="{ row }">
            <span class="mono hash">{{ row.shortHash }}</span>
          </template>
        </el-table-column>
        <el-table-column label="信息" min-width="300">
          <template #default="{ row }">
            <div class="subject">{{ row.subject }}</div>
            <div v-if="row.refs" class="refs">
              <el-tag v-for="r in row.refs.split(',').map((s: string) => s.trim()).filter(Boolean)" :key="r" size="small" effect="plain" class="ref-tag">
                {{ r.startsWith('tag: ') ? r : (r.includes('/') && !r.startsWith('HEAD') ? r.split('/').pop() : r) }}
              </el-tag>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="作者" width="170">
          <template #default="{ row }">
            <div>{{ row.authorName }}</div>
            <div class="sub">{{ row.authorEmail }}</div>
          </template>
        </el-table-column>
        <el-table-column label="时间" width="180">
          <template #default="{ row }">{{ formatDate(row.authorDate) }}</template>
        </el-table-column>
      </el-table>
      <el-empty v-if="!loading && commits.length === 0" description="暂无提交记录" />
    </el-card>

    <el-drawer v-model="showVisible" size="60%" destroy-on-close>
      <template v-if="showCommit">
        <div class="commit-head">
          <div class="mono commit-hash">{{ showCommit.hash }}</div>
          <h3 class="commit-subject">{{ showCommit.subject }}</h3>
          <div class="commit-meta">
            <span>{{ showCommit.authorName }} &lt;{{ showCommit.authorEmail }}&gt;</span>
            <span>{{ formatDate(showCommit.authorDate) }}</span>
            <span v-if="showCommit.refs">refs: {{ showCommit.refs }}</span>
          </div>
          <pre v-if="showCommit.body" class="commit-body">{{ showCommit.body }}</pre>
        </div>
        <el-divider />
        <div class="diff-wrap">
          <template v-if="showDiff">
            <div class="diff-summary">
              <span>{{ showDiff.files.length }} 个文件</span>
              <span class="add">+{{ showDiff.insertions }}</span>
              <span class="del">-{{ showDiff.deletions }}</span>
              <span v-if="showDiff.truncated" class="warn">（已截断）</span>
            </div>
            <DiffViewer :patch="showDiff.rawPatch" />
          </template>
          <el-empty v-else description="无差异" :image-size="60" />
        </div>
      </template>
    </el-drawer>
  </div>
</template>

<style scoped>
.page-title {
  margin: 0 0 var(--gc-gap);
  font-size: 14px;
}
.mb {
  margin-bottom: var(--gc-gap);
}
.filter-bar {
  display: flex;
  align-items: center;
  gap: var(--gc-gap);
  flex-wrap: wrap;
}
.branch-select {
  width: 180px;
}
.path-input {
  width: 220px;
}
.count-select {
  width: 110px;
}
.hash {
  font-size: 12px;
}
.subject {
  font-weight: 500;
}
.sub {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.refs {
  margin-top: 2px;
}
.ref-tag {
  margin-right: 4px;
  font-size: 11px;
}
.commit-head {
  margin-bottom: 4px;
}
.commit-hash {
  font-size: 13px;
  color: var(--el-color-primary);
  word-break: break-all;
}
.commit-subject {
  margin: var(--gc-gap) 0 6px;
  font-size: 14px;
}
.commit-meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 12.5px;
  color: var(--el-text-color-secondary);
}
.commit-body {
  margin: 10px 0 0;
  padding: 10px 12px;
  background: var(--el-fill-color-light);
  border-radius: 6px;
  white-space: pre-wrap;
  font-size: 13px;
}
.diff-wrap {
  min-height: 200px;
}
.diff-summary {
  display: flex;
  gap: var(--gc-gap);
  font-size: 12px;
  margin-bottom: var(--gc-gap);
}
.diff-summary .add {
  color: var(--el-color-success);
}
.diff-summary .del {
  color: var(--el-color-danger);
}
.diff-summary .warn {
  color: var(--el-color-warning);
}
</style>