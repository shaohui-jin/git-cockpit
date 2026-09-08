<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { useReposStore } from '@/stores/repos';
import { useJobsStore } from '@/stores/jobs';
import { useRevision } from '@/composables/revision';
import * as api from '@/api/client';
import CloneDialog from '@/components/CloneDialog.vue';
import { notifyJobStarted } from '@/utils/jobNotify';
import type { OpenedRepo, RepoOverview } from '@/api/types';

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
const viewMode = ref<'table' | 'tree'>('table');
const filter = ref<'all' | 'dirty' | 'sync' | 'op'>('all');
const { revision } = useRevision();

function overviewOf(path: string): RepoOverview | undefined {
  return overviews.value.find((o) => o.path === path);
}

const tableRows = computed(() => {
  return repos.repos.filter((r) => {
    const o = overviewOf(r.path);
    if (filter.value === 'dirty') return (o?.dirtyCount ?? 0) > 0 || (o?.conflictCount ?? 0) > 0;
    if (filter.value === 'sync') return (o?.ahead ?? 0) + (o?.behind ?? 0) > 0;
    if (filter.value === 'op') return o?.operation === 'merge' || o?.operation === 'rebase';
    return true;
  });
});

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
      if (ad !== bd) return ad - bd;
      if (ad === 1) return (order.get(a.repo!.id) ?? 0) - (order.get(b.repo!.id) ?? 0);
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

async function openStatus(id: number): Promise<void> {
  try {
    await repos.activate(id);
  } catch {
    repos.switchTo(id);
  }
  await router.push('/status');
}

async function openMerge(id: number): Promise<void> {
  try {
    await repos.activate(id);
  } catch {
    repos.switchTo(id);
  }
  await router.push('/merge');
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

function enterNode(n: PathTreeNode): void {
  if (n.repo) void openStatus(n.repo.id);
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
  <div class="page">
    <h2 class="page-title">工作台</h2>

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
        <el-button @click="openCloneDialog">克隆到本地</el-button>
      </div>
    </el-card>

    <el-card shadow="never" class="list-card">
      <template #header>
        <div class="list-header">
          <span>仓库一览（{{ repos.repos.length }}）</span>
          <div class="header-actions">
            <el-radio-group v-model="filter" size="small">
              <el-radio-button value="all">全部</el-radio-button>
              <el-radio-button value="dirty">有更改</el-radio-button>
              <el-radio-button value="sync">领先/落后</el-radio-button>
              <el-radio-button value="op">进行中操作</el-radio-button>
            </el-radio-group>
            <el-radio-group v-model="viewMode" size="small">
              <el-radio-button value="table">表格</el-radio-button>
              <el-radio-button value="tree">路径树</el-radio-button>
            </el-radio-group>
            <el-button
              text
              type="primary"
              :loading="repos.loading || overviewLoading"
              @click="() => { void repos.load(); void loadOverview(); }"
            >刷新</el-button>
          </div>
        </div>
      </template>

      <el-empty
        v-if="!repos.loading && repos.repos.length === 0"
        description="还没有打开仓库。输入本地路径打开，或从远程克隆。"
      />

      <div v-else-if="viewMode === 'table'" class="table-scroll">
        <div
          v-for="r in tableRows"
          :key="r.id"
          class="repo-row"
          :class="{ current: r.id === repos.currentId }"
          @click="repos.switchTo(r.id)"
          @dblclick="openStatus(r.id)"
        >
          <span class="node-name mono" :title="r.path">{{ overviewOf(r.path)?.name || r.path.split(/[\\/]/).pop() }}</span>
          <span class="cell-branch mono">{{ overviewOf(r.path)?.available === false ? '不可用' : (overviewOf(r.path)?.current || '…') }}</span>
          <span class="cell-sync">
            <template v-if="overviewOf(r.path)">
              {{ overviewOf(r.path)!.ahead }}↑{{ overviewOf(r.path)!.behind }}↓
            </template>
          </span>
          <span class="cell-dirty">
            <template v-if="overviewOf(r.path)">
              {{ overviewOf(r.path)!.dirtyCount ? `${overviewOf(r.path)!.dirtyCount} 更改` : '干净' }}
            </template>
          </span>
          <span class="cell-op">{{ overviewOf(r.path)?.operation === 'none' ? '—' : overviewOf(r.path)?.operation }}</span>
          <span class="cell-tmp">{{ overviewOf(r.path)?.tempMergeBranchCount || '—' }}</span>
          <span class="node-actions">
            <el-button size="small" text type="primary" @click.stop="openStatus(r.id)">进入</el-button>
            <el-button size="small" text type="primary" @click.stop="openMerge(r.id)">合并</el-button>
            <el-button size="small" text type="danger" @click.stop="removeRepo(r.id, r.path)">移除</el-button>
          </span>
        </div>
        <el-empty v-if="tableRows.length === 0" description="没有符合筛选的仓库" :image-size="40" />
      </div>

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
              <span class="node-time">
                {{
                  overviewOf(data.repo.path)
                    ? `${overviewOf(data.repo.path)!.current} · ${overviewOf(data.repo.path)!.dirtyCount ? overviewOf(data.repo.path)!.dirtyCount + ' 更改' : '干净'}`
                    : formatTime(data.repo.lastOpenedAt)
                }}
              </span>
              <span class="node-actions">
                <el-button size="small" text type="primary" @click.stop="enterNode(data)">进入</el-button>
                <el-button size="small" text type="primary" @click.stop="openMerge(data.repo.id)">合并</el-button>
                <el-button size="small" text type="danger" @click.stop="removeRepo(data.repo.id, data.repo.path)">移除</el-button>
              </span>
            </div>
          </template>
        </el-tree>
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
.open-card {
  flex: none;
  margin-bottom: var(--gc-gap);
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
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.open-row {
  display: flex;
  gap: var(--gc-gap);
}
.open-row .el-input {
  flex: 1;
}
.list-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--gc-gap);
  flex-wrap: wrap;
}
.header-actions {
  display: flex;
  align-items: center;
  gap: var(--gc-gap);
  flex-wrap: wrap;
}
.table-scroll,
.tree-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}
.repo-row {
  display: flex;
  align-items: center;
  gap: var(--gc-gap);
  height: var(--gc-line);
  padding: 0 8px;
  border-radius: var(--gc-radius);
  cursor: pointer;
  font-size: var(--gc-text);
}
.repo-row:hover {
  background: var(--el-fill-color-light);
}
.repo-row.current {
  background: var(--el-color-primary-light-9);
}
.cell-branch,
.cell-sync,
.cell-dirty,
.cell-op,
.cell-tmp {
  flex: none;
  color: var(--el-text-color-secondary);
  font-size: 12px;
  white-space: nowrap;
}
.cell-branch {
  width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
}
.cell-sync {
  width: 64px;
}
.cell-dirty {
  width: 72px;
}
.cell-op {
  width: 56px;
}
.cell-tmp {
  width: 28px;
  text-align: right;
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
