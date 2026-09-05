<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import * as api from '@/api/client';
import { useReposStore } from '@/stores/repos';
import { useBranchesStore } from '@/stores/branches';
import { useRevision } from '@/composables/revision';
import DiffViewer from '@/components/DiffViewer.vue';
import BranchTreeSelect from '@/components/BranchTreeSelect.vue';
import type { CommitInfo, DiffResult } from '@/api/types';

const repos = useReposStore();
const branchStore = useBranchesStore();
const { revision } = useRevision();
const repoId = (): number | null => repos.currentId;

const commits = ref<CommitInfo[]>([]);
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
const bodyOpen = ref(false);

const currentBranch = computed(() => branchStore.current?.name ?? '');

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
  await loadLog();
}

async function openCommit(c: CommitInfo): Promise<void> {
  const id = repoId();
  if (id === null) return;
  loading.value = true;
  try {
    // 先请求成功再展开抽屉：COMMIT_NOT_FOUND 等错误直接 message 提示并拦截展开
    const { diff } = await api.getShow(id, c.hash);
    showCommit.value = c;
    showDiff.value = diff;
    bodyOpen.value = false;
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

watch(repoId, () => {
  selectedBranch.value = '';
  void refresh();
});
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
        <BranchTreeSelect
          v-if="mode === 'branch'"
          v-model="selectedBranch"
          placeholder="选择分支"
        />
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
        <el-table-column label="信息" min-width="300" show-overflow-tooltip>
          <template #default="{ row }">
            <span class="subject" :title="row.refs ? `${row.subject}  ·  ${row.refs}` : row.subject">{{ row.subject }}</span>
          </template>
        </el-table-column>
        <el-table-column label="作者" width="170" show-overflow-tooltip>
          <template #default="{ row }">
            <span :title="`${row.authorName} <${row.authorEmail}>`">{{ row.authorName }}</span>
          </template>
        </el-table-column>
        <el-table-column label="时间" width="180">
          <template #default="{ row }">{{ formatDate(row.authorDate) }}</template>
        </el-table-column>
      </el-table>
      <el-empty v-if="!loading && commits.length === 0" description="暂无提交记录" />
    </el-card>

    <el-drawer v-model="showVisible" size="60%" destroy-on-close>
      <template #header>
        <div v-if="showCommit" class="commit-title">
          <span class="commit-subject" :title="showCommit.subject">{{ showCommit.subject }}</span>
          <span class="commit-hash mono" :title="showCommit.hash">{{ showCommit.shortHash }}</span>
        </div>
      </template>
      <template v-if="showCommit">
        <div class="commit-meta">
          <span class="commit-meta-item" :title="`${showCommit.authorName} <${showCommit.authorEmail}>`">{{ showCommit.authorName }}</span>
          <span class="sep">·</span>
          <span class="commit-meta-item">{{ formatDate(showCommit.authorDate) }}</span>
          <template v-if="showCommit.refs">
            <span class="sep">·</span>
            <span class="commit-meta-item refs" :title="showCommit.refs">{{ showCommit.refs }}</span>
          </template>
          <template v-if="showDiff">
            <span class="sep">·</span>
            <span class="commit-meta-item">{{ showDiff.files.length }} 个文件</span>
            <span class="add">+{{ showDiff.insertions }}</span>
            <span class="del">-{{ showDiff.deletions }}</span>
            <span v-if="showDiff.truncated" class="warn">已截断</span>
          </template>
        </div>
        <button
          v-if="showCommit.body"
          type="button"
          class="commit-body-toggle"
          @click="bodyOpen = !bodyOpen"
        >
          {{ bodyOpen ? '收起说明' : '展开说明' }}
        </button>
        <pre v-if="bodyOpen && showCommit.body" class="commit-body">{{ showCommit.body }}</pre>
        <div class="diff-wrap">
          <DiffViewer v-if="showDiff" :patch="showDiff.rawPatch" />
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
.path-input {
  width: 220px;
}
.count-select {
  width: 110px;
}
.hash {
  font-size: var(--gc-text);
}
.subject {
  font-weight: 500;
}
.commit-title {
  display: flex;
  align-items: center;
  gap: var(--gc-gap);
  min-width: 0;
  flex: 1;
  height: var(--gc-line);
  padding-right: var(--gc-gap);
}
.commit-subject {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--gc-text);
  font-weight: 500;
  color: var(--el-text-color-primary);
}
.commit-hash {
  flex: none;
  font-size: var(--gc-text);
  color: var(--el-color-primary);
}
.commit-meta {
  display: flex;
  align-items: center;
  gap: var(--gc-gap);
  height: var(--gc-line);
  margin-bottom: var(--gc-gap);
  font-size: var(--gc-text);
  color: var(--el-text-color-secondary);
  min-width: 0;
  overflow: hidden;
}
.commit-meta-item {
  flex: none;
  white-space: nowrap;
}
.commit-meta .refs {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
.commit-meta .sep {
  flex: none;
  color: var(--el-text-color-placeholder);
}
.commit-meta .add {
  flex: none;
  color: var(--el-color-success);
}
.commit-meta .del {
  flex: none;
  color: var(--el-color-danger);
}
.commit-meta .warn {
  flex: none;
  color: var(--el-color-warning);
}
.commit-body-toggle {
  display: block;
  height: var(--gc-line);
  margin: 0 0 var(--gc-gap);
  padding: 0;
  border: 0;
  background: none;
  color: var(--el-color-primary);
  font: inherit;
  font-size: var(--gc-text);
  cursor: pointer;
}
.commit-body {
  margin: 0 0 var(--gc-gap);
  padding: var(--gc-gap) var(--gc-pad);
  background: var(--el-fill-color-light);
  border-radius: var(--gc-radius);
  white-space: pre-wrap;
  font-size: var(--gc-text);
}
.diff-wrap {
  min-height: 200px;
}
</style>