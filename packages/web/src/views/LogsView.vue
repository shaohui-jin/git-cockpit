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

function riskOf(t: string): string {
  if (t.includes('reset') || t.includes('clean') || t.includes('force') || t.includes('rebase')) return 'high';
  return 'write';
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

function sourceLabel(src: string): string {
  if (src === 'mcp') return 'MCP';
  if (src === 'web') return 'Web';
  if (src === 'chat') return 'Chat';
  return 'CLI';
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
  <div class="page logs-page">
    <h2 class="page-title">操作日志</h2>

    <div class="bar gc-glass">
      <label>
        工具
        <el-select v-model="logs.toolFilter" clearable placeholder="全部" class="tool-select" @change="logs.load">
          <el-option v-for="t in tools" :key="t" :label="t" :value="t" />
        </el-select>
      </label>
      <el-select v-model="logs.limit" class="limit-select" @change="logs.load">
        <el-option label="最近 20 条" :value="20" />
        <el-option label="最近 50 条" :value="50" />
        <el-option label="最近 100 条" :value="100" />
      </el-select>
      <el-button :loading="logs.loading" @click="logs.load">刷新</el-button>
      <span class="tip">只记写入。来源：Web / MCP / CLI / Chat。参数已脱敏。</span>
    </div>

    <div v-if="!logs.loading && logs.logs.length === 0" class="empty gc-glass">
      <strong>还没有操作日志</strong>
      <p>预览确认后的写操作会记在这里。只读预演不记。</p>
    </div>
    <div v-else class="table gc-glass" v-loading="logs.loading">
      <div class="th">
        <span>时间</span>
        <span>来源</span>
        <span>工具</span>
        <span>仓库</span>
        <span>参数（脱敏）</span>
        <span>结果</span>
        <span>耗时</span>
      </div>
      <div v-for="row in logs.logs" :key="row.id" class="tr">
        <span>{{ formatTime(row.timestamp) }}</span>
        <span>{{ sourceLabel(row.source) }}</span>
        <span class="tool-cell">
          <code :class="riskOf(row.tool)">{{ row.tool }}</code>
          <em v-if="row.dryRun">dry-run</em>
        </span>
        <span class="mono" :title="row.repoPath ?? ''">{{ row.repoPath ?? '—' }}</span>
        <span class="mono" :title="parseParams(row.params)">{{ parseParams(row.params) || '—' }}</span>
        <span :class="{ bad: !!row.error }" :title="row.error || row.result">
          {{ row.error ? `失败 · ${row.error}` : `成功${row.result ? ' · ' + row.result : ''}` }}
        </span>
        <span>{{ row.durationMs }} ms</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.logs-page {
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: var(--gc-pad);
  overflow: hidden;
}
.bar {
  flex: none;
  display: flex;
  align-items: center;
  gap: var(--gc-pad);
  padding: var(--gc-gap) var(--gc-pad);
  flex-wrap: wrap;
}
.bar label {
  display: flex;
  align-items: center;
  gap: var(--gc-gap);
  font-size: var(--gc-text);
}
.tool-select {
  width: 200px;
}
.limit-select {
  width: 120px;
}
.tip {
  font-size: var(--gc-text);
  color: var(--el-text-color-secondary);
}
.table {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 0;
}
.th,
.tr {
  display: grid;
  grid-template-columns:
    150px 56px minmax(160px, 1.1fr) minmax(140px, 1fr) minmax(140px, 1fr) minmax(160px, 1.2fr)
    72px;
  gap: var(--gc-gap);
  padding: 0 var(--gc-pad);
  min-height: var(--gc-line);
  align-items: center;
  font-size: var(--gc-text);
}
.th {
  position: sticky;
  top: 0;
  z-index: 1;
  color: var(--el-text-color-secondary);
  font-weight: 600;
  background: color-mix(in srgb, var(--el-bg-color) 92%, transparent);
}
.tr {
  border-top: 1px solid var(--el-border-color-lighter);
}
.tr span,
.tr .mono {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tool-cell {
  display: flex;
  align-items: center;
  gap: var(--gc-gap);
  min-width: 0;
}
.tool-cell code {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tool-cell em {
  flex: none;
  font-style: normal;
  color: var(--el-text-color-secondary);
}
code.high {
  color: var(--el-color-danger);
}
.bad {
  color: var(--el-color-danger);
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
  font-size: var(--gc-text);
}
</style>
