<script setup lang="ts">
import { computed, onMounted, watch } from 'vue';
import { useLogsStore } from '@/stores/logs';
import { useRevision } from '@/composables/revision';

const logs = useLogsStore();
const { revision } = useRevision();

const tools = computed(() => {
  const set = new Set<string>();
  for (const l of logs.logs) set.add(l.tool);
  return [...set].sort();
});

const riskOf = (t: string): string => {
  if (t.includes('reset') || t.includes('clean') || t.includes('force') || t.includes('rebase')) return 'dangerous';
  return 'write';
};

function tagType(tool: string): 'success' | 'primary' | 'danger' | '' {
  const r = riskOf(tool);
  return r === 'dangerous' ? 'danger' : tool.startsWith('git_') ? 'primary' : 'success';
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

function sourceTag(src: string): 'primary' | 'success' | 'warning' {
  return src === 'mcp' ? 'primary' : src === 'web' ? 'success' : 'warning';
}

function parseParams(p: unknown): string {
  if (p === undefined || p === null) return '';
  if (typeof p === 'string') return p;
  try {
    const s = JSON.stringify(p);
    return s === undefined ? '' : s;
  } catch {
    return String(p);
  }
}

watch(revision, () => {
  void logs.load();
});

onMounted(() => {
  void logs.load();
});
</script>

<template>
  <div class="page">
    <h2 class="page-title">操作日志</h2>

    <el-card shadow="never" class="mb">
      <div class="filter-bar">
        <el-select v-model="logs.toolFilter" clearable placeholder="按工具过滤" class="tool-select" @change="logs.load">
          <el-option v-for="t in tools" :key="t" :label="t" :value="t" />
        </el-select>
        <el-select v-model="logs.limit" class="limit-select" @change="logs.load">
          <el-option label="最近 20 条" :value="20" />
          <el-option label="最近 50 条" :value="50" />
          <el-option label="最近 100 条" :value="100" />
        </el-select>
        <el-button :loading="logs.loading" @click="logs.load">刷新</el-button>
        <span class="tip">记录来源：Web / MCP / CLI 全部写入操作（只读操作不记录）</span>
      </div>
    </el-card>

    <el-card shadow="never">
      <el-table :data="logs.logs" v-loading="logs.loading" size="default">
        <el-table-column label="时间" width="150">
          <template #default="{ row }">{{ formatTime(row.timestamp) }}</template>
        </el-table-column>
        <el-table-column label="来源" width="90">
          <template #default="{ row }">
            <el-tag :type="sourceTag(row.source)" size="small" effect="plain">{{ row.source.toUpperCase() }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="工具" width="260" show-overflow-tooltip>
          <template #default="{ row }">
            <span class="tool-cell">
              <el-tag :type="tagType(row.tool)" size="small" effect="dark">{{ row.tool }}</el-tag>
              <el-tag v-if="row.dryRun" size="small" type="info" effect="plain">dry-run</el-tag>
            </span>
          </template>
        </el-table-column>
        <el-table-column label="仓库" min-width="200" show-overflow-tooltip>
          <template #default="{ row }">
            <span class="mono repo-path">{{ row.repoPath ?? '—' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="参数（脱敏）" min-width="180" show-overflow-tooltip>
          <template #default="{ row }">
            <span class="mono params">{{ parseParams(row.params) || '—' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="结果" min-width="150" show-overflow-tooltip>
          <template #default="{ row }">
            <span v-if="row.error" class="result-line">
              <el-tag type="danger" size="small" effect="plain">失败</el-tag>
              {{ row.error }}
            </span>
            <span v-else class="result-line">
              <el-tag type="success" size="small" effect="plain">成功</el-tag>
              {{ row.result }}
            </span>
          </template>
        </el-table-column>
        <el-table-column label="耗时" width="90">
          <template #default="{ row }">{{ row.durationMs }} ms</template>
        </el-table-column>
      </el-table>
      <el-empty v-if="!logs.loading && logs.logs.length === 0" description="暂无操作日志" />
    </el-card>
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
.tool-select {
  width: 200px;
}
.limit-select {
  width: 120px;
}
.tip {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.tool-cell {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  vertical-align: middle;
}
.repo-path,
.params,
.result-line {
  font-size: 12px;
}
</style>