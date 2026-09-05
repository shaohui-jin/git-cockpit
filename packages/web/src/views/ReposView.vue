<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { useReposStore } from '@/stores/repos';
import { useJobsStore } from '@/stores/jobs';
import * as api from '@/api/client';
import type { OpenedRepo } from '@/api/types';

const repos = useReposStore();
const jobs = useJobsStore();
const router = useRouter();

const newPath = ref('');
const opening = ref(false);
const cloneVisible = ref(false);
const cloneUrl = ref('');
const cloneDest = ref('');
const cloning = ref(false);
const jobDrawer = ref(false);
const activeJobId = ref<string | null>(null);
const jobDetailLoading = ref(false);

const activeJob = computed(() => jobs.jobs.find((j) => j.id === activeJobId.value) ?? null);
const jobLogText = computed(() =>
  (activeJob.value?.logs ?? []).join('\n').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
);

/** 路径树节点：叶子带 repo（完整路径），非叶子为按路径分隔符拆出的目录 */
interface PathTreeNode {
  key: string;
  label: string;
  /** 完整前缀路径（目录或仓库绝对路径） */
  fullPath: string;
  repo?: OpenedRepo;
  children?: PathTreeNode[];
}

/**
 * 把仓库列表按路径构建成树：首层为盘符（D:）或首段目录，
 * 叶子节点为仓库。目录在前按名称排序，同级仓库保持后端返回的最近打开倒序。
 */
const repoTree = computed<PathTreeNode[]>(() => {
  const roots: PathTreeNode[] = [];
  // 记录每个仓库在原列表中的顺序，用于同级叶子按最近打开排序
  const order = new Map<number, number>();
  repos.repos.forEach((r, i) => order.set(r.id, i));

  for (const repo of repos.repos) {
    const parts = repo.path.split(/[\\/]+/).filter((p) => p.length > 0);
    if (parts.length === 0) continue;
    let level = roots;
    let prefix = '';
    for (const [i, part] of parts.entries()) {
      prefix = prefix ? `${prefix}/${part}` : part;
      const isLeaf = i === parts.length - 1;
      const existing = level.find((n) => !n.repo && n.label === part);
      if (isLeaf) {
        level.push({ key: 'repo:' + repo.path, label: part, fullPath: repo.path, repo });
      } else {
        const node: PathTreeNode = existing ?? { key: 'dir:' + prefix, label: part, fullPath: prefix };
        if (!existing) level.push(node);
        node.children ??= [];
        level = node.children;
      }
    }
  }

  const sortLevel = (nodes: PathTreeNode[]): void => {
    nodes.sort((a, b) => {
      const ad = a.repo ? 1 : 0;
      const bd = b.repo ? 1 : 0;
      if (ad !== bd) return ad - bd; // 目录在前
      if (ad === 1) return (order.get(a.repo!.id) ?? 0) - (order.get(b.repo!.id) ?? 0); // 叶子按最近打开
      return a.label.localeCompare(b.label);
    });
    for (const n of nodes) if (n.children) sortLevel(n.children);
  };
  sortLevel(roots);
  return roots;
});

/** 默认展开到当前仓库的路径；无当前仓库则回退到首个根节点 */
const defaultExpandedKeys = computed<string[]>(() => {
  const cur = repos.current;
  if (cur) {
    const parts = cur.path.split(/[\\/]+/).filter((p) => p.length > 0);
    const keys: string[] = [];
    let prefix = '';
    // 最后一段是仓库名（叶子），只取目录段做展开 key
    for (const part of parts.slice(0, -1)) {
      prefix = prefix ? `${prefix}/${part}` : part;
      keys.push('dir:' + prefix);
    }
    if (keys.length > 0) return keys;
  }
  const first = repoTree.value[0];
  return first && !first.repo ? [first.key] : [];
});

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
    await router.push('/status');
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
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : String(err));
  }
}

async function openStatus(id: number): Promise<void> {
  // 进入仓库：后端刷新「最近打开」排序并记录操作日志；失败则本地切换兜底
  try {
    await repos.activate(id);
  } catch {
    repos.switchTo(id);
  }
  router.push('/status');
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

function enterNode(n: PathTreeNode): void {
  if (n.repo) void openStatus(n.repo.id);
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
    ElMessage.success('已提交克隆任务，可在下方查看日志');
    cloneVisible.value = false;
    cloneUrl.value = '';
    cloneDest.value = '';
    await jobs.load();
    await openJob(job.id);
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : String(err));
  } finally {
    cloning.value = false;
  }
}

async function openJob(id: string): Promise<void> {
  activeJobId.value = id;
  jobDrawer.value = true;
  jobDetailLoading.value = true;
  try {
    await jobs.loadDetail(id);
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : String(err));
  } finally {
    jobDetailLoading.value = false;
  }
}

function jobTag(status: string): 'success' | 'danger' | 'warning' {
  if (status === 'ok') return 'success';
  if (status === 'error') return 'danger';
  return 'warning';
}

onMounted(() => {
  void repos.load();
  void jobs.load();
});
</script>

<template>
  <div class="page">
    <h2 class="page-title">仓库管理</h2>

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
        <el-button @click="cloneVisible = true">克隆到本地</el-button>
      </div>
    </el-card>

    <el-card shadow="never" class="open-card">
      <template #header>
        <div class="list-header">
          <span>后台任务{{ jobs.runningCount ? `（进行中 ${jobs.runningCount}）` : '' }}</span>
          <el-button text type="primary" :loading="jobs.loading" @click="jobs.load()">刷新</el-button>
        </div>
      </template>
      <el-empty v-if="!jobs.jobs.length" description="没有克隆任务。点「克隆到本地」提交后会出现在这里。" :image-size="48" />
      <div v-else class="job-list">
        <div v-for="j in jobs.jobs" :key="j.id" class="job-row" @click="openJob(j.id)">
          <el-tag :type="jobTag(j.status)" size="small" effect="plain">{{ j.status }}</el-tag>
          <span class="job-url mono" :title="j.url">{{ j.url }}</span>
          <span class="job-dest mono" :title="j.destDir">→ {{ j.destDir }}</span>
          <el-button size="small" text type="primary" @click.stop="openJob(j.id)">日志</el-button>
        </div>
      </div>
    </el-card>

    <el-card shadow="never" class="list-card">
      <template #header>
        <div class="list-header">
          <span>最近打开的仓库（{{ repos.repos.length }}）</span>
          <el-button text type="primary" :loading="repos.loading" @click="repos.load()">刷新</el-button>
        </div>
      </template>

      <el-empty v-if="!repos.loading && repos.repos.length === 0" description="尚未打开任何仓库" />

      <div v-else class="tree-scroll">
        <el-tree
          :data="repoTree"
          :props="{ label: 'label', children: 'children' }"
          node-key="key"
          accordion
          :default-expanded-keys="defaultExpandedKeys"
          :indent="14"
          class="repo-tree"
        >
          <template #default="{ data }">
            <span v-if="!data.repo" class="tree-dir" :title="data.fullPath">{{ data.label }}</span>
            <div
              v-else
              class="repo-node"
              :class="{ current: data.repo.id === repos.currentId }"
              :title="data.repo.path"
              @dblclick="enterNode(data)"
            >
              <span class="node-name mono">{{ data.label }}</span>
              <span class="node-time">{{ formatTime(data.repo.lastOpenedAt) }}</span>
              <span class="node-actions">
                <el-button size="small" text type="primary" @click.stop="enterNode(data)">进入</el-button>
                <el-button size="small" text type="danger" @click.stop="removeRepo(data.repo.id, data.repo.path)">移除</el-button>
              </span>
            </div>
          </template>
        </el-tree>
      </div>
    </el-card>

    <el-dialog v-model="cloneVisible" title="克隆到本地" width="560px">
      <el-alert
        class="mb"
        title="提交后由后台 spawn git clone，不占用当前仓库的 Git 队列。地址不要带 token。完成后会自动加入最近打开列表。"
        type="info"
        :closable="false"
        show-icon
      />
      <el-form label-width="100px">
        <el-form-item label="项目地址">
          <el-input v-model="cloneUrl" placeholder="https://github.com/org/repo.git 或 git@host:org/repo.git" />
        </el-form-item>
        <el-form-item label="保存到">
          <el-input v-model="cloneDest" placeholder="本地空目录的绝对路径，例如 D:\_myproject\repo" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="cloneVisible = false">取消</el-button>
        <el-button type="primary" :loading="cloning" @click="startClone">开始克隆</el-button>
      </template>
    </el-dialog>

    <el-drawer v-model="jobDrawer" size="48%" destroy-on-close>
      <template #header>
        <span v-if="activeJob">克隆日志 · {{ activeJob.status }}</span>
        <span v-else>克隆日志</span>
      </template>
      <div v-loading="jobDetailLoading">
        <template v-if="activeJob">
          <div class="job-meta mono">{{ activeJob.url }} → {{ activeJob.destDir }}</div>
          <el-alert v-if="activeJob.error" :title="activeJob.error" type="error" :closable="false" show-icon class="mb" />
          <pre class="job-log">{{ jobLogText || '（等待输出）' }}</pre>
        </template>
      </div>
    </el-drawer>
  </div>
</template>

<style scoped>
.page-title {
  margin: 0 0 var(--gc-gap);
  font-size: 14px;
}
.open-card,
.list-card {
  margin-bottom: var(--gc-gap);
}
.open-row {
  display: flex;
  gap: var(--gc-gap);
}
.open-row .el-input {
  flex: 1;
}
.mb {
  margin-bottom: var(--gc-gap);
}
.job-list {
  display: flex;
  flex-direction: column;
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
.job-row:hover {
  background: var(--el-fill-color-light);
}
.job-url,
.job-dest {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--gc-text);
}
.job-url {
  flex: 1;
  min-width: 0;
}
.job-dest {
  flex: 1;
  min-width: 0;
  color: var(--el-text-color-secondary);
}
.job-meta {
  margin-bottom: var(--gc-gap);
  font-size: var(--gc-text);
  color: var(--el-text-color-secondary);
  word-break: break-all;
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
.list-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

/* 路径树（el-tree）紧凑适配：对齐状态页分支树样式 */
.tree-scroll {
  max-height: calc(100vh - 300px);
  overflow-y: auto;
}
.repo-tree {
  background: transparent;
  --el-tree-node-hover-bg-color: var(--el-fill-color-extra-light);
}
.repo-tree :deep(.el-tree-node__content) {
  height: 28px;
  padding-right: 4px;
}
.repo-tree :deep(.el-tree-node__expand-icon) {
  font-size: 11px;
  flex: none;
}
.tree-dir {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  font-weight: 600;
  color: var(--el-text-color-regular);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.repo-node {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: var(--gc-gap);
  padding: 2px 8px;
  border-radius: 6px;
  cursor: pointer;
  user-select: none;
}
.repo-node:hover {
  background: var(--el-fill-color-light);
}
.repo-node.current {
  background: var(--el-color-primary-light-9);
}
.node-name {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.repo-node.current .node-name {
  font-weight: 600;
  color: var(--el-color-primary);
}
.node-time {
  flex: none;
  font-size: 11px;
  color: var(--el-text-color-secondary);
}
.node-actions {
  flex: none;
  display: flex;
}
</style>
