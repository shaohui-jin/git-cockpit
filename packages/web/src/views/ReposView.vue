<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { useReposStore } from '@/stores/repos';
import type { OpenedRepo } from '@/api/types';

const repos = useReposStore();
const router = useRouter();

const newPath = ref('');
const opening = ref(false);

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
    for (let i = 0; i < parts.length - 1; i++) {
      prefix = prefix ? `${prefix}/${parts[i]}` : parts[i];
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

onMounted(() => repos.load());
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
