<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { useReposStore } from '@/stores/repos';

const repos = useReposStore();
const router = useRouter();

const newPath = ref('');
const opening = ref(false);

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

function rowClass({ row }: { row: { id: number } }): string {
  return row.id === repos.currentId ? 'is-current' : '';
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
          <span>最近打开的仓库</span>
          <el-button text type="primary" :loading="repos.loading" @click="repos.load()">刷新</el-button>
        </div>
      </template>

      <el-empty v-if="!repos.loading && repos.repos.length === 0" description="尚未打开任何仓库" />

      <el-table v-else :data="repos.repos" size="default" highlight-current-row :row-class-name="rowClass">
        <el-table-column label="路径" min-width="320">
          <template #default="{ row }">
            <div class="repo-path mono">{{ row.path }}</div>
          </template>
        </el-table-column>
        <el-table-column label="最近打开" width="190">
          <template #default="{ row }">{{ formatTime(row.lastOpenedAt) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="180" align="right">
          <template #default="{ row }">
            <el-button size="small" text type="primary" @click="openStatus(row.id)">进入</el-button>
            <el-button size="small" text type="danger" @click="removeRepo(row.id, row.path)">移除</el-button>
          </template>
        </el-table-column>
      </el-table>
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
.repo-path {
  font-size: 12px;
}
</style>

<style>
.el-table .is-current > td {
  background: var(--el-color-primary-light-9) !important;
}
</style>