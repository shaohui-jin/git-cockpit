<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import { useLogsStore } from '@/stores/logs';
import { useRevision } from '@/composables/revision';

const logs = useLogsStore();
const { revision } = useRevision();

const tools = computed(() => {
  const set = new Set<string>();
  for (const l of logs.logs) set.add(l.tool);
  return [...set].sort();
});

const searchText = ref('');
const statusFilter = ref<'all' | 'ok' | 'bad'>('all');
const visible = computed(() => {
  const kw = searchText.value.trim().toLowerCase();
  return logs.logs.filter((l) => {
    if (statusFilter.value === 'ok' && l.error) return false;
    if (statusFilter.value === 'bad' && !l.error) return false;
    if (!kw) return true;
    return [l.tool, l.repoPath ?? '', parseParams(l.params), l.result ?? '', l.error ?? ''].some((s) =>
      s.toLowerCase().includes(kw)
    );
  });
});

/** 导出 CSV（客户端生成，不落后端） */
function exportCsv(): void {
  const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const head = ['时间', '来源', '工具', '仓库', '参数', '结果', '耗时ms'].map(esc).join(',');
  const body = visible.value
    .map((l) =>
      [
        formatTime(l.timestamp),
        sourceLabel(l.source),
        l.tool,
        l.repoPath ?? '',
        parseParams(l.params),
        l.error ? `失败: ${l.error}` : `成功${l.result ? ': ' + l.result : ''}`,
        String(l.durationMs)
      ]
        .map(esc)
        .join(',')
    )
    .join('\r\n');
  const blob = new Blob(['\ufeff' + head + '\r\n' + body], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `git-cockpit-logs-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
  ElMessage.success(`已导出 ${visible.value.length} 条`);
}

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
    <div class="log-toolbar">
      <el-input v-model="searchText" class="log-search" placeholder="搜索工具 / 参数 / 仓库">
        <template #prefix><GcIcon name="search" :size="12" /></template>
      </el-input>
      <el-radio-group v-model="statusFilter">
        <el-radio-button value="all">全部</el-radio-button>
        <el-radio-button value="ok">成功</el-radio-button>
        <el-radio-button value="bad">失败</el-radio-button>
      </el-radio-group>
      <el-select v-model="logs.toolFilter" clearable placeholder="全部工具" class="tool-select" @change="logs.load">
        <el-option v-for="t in tools" :key="t" :label="t" :value="t" />
      </el-select>
      <el-select v-model="logs.limit" class="limit-select" @change="logs.load">
        <el-option label="最近 20 条" :value="20" />
        <el-option label="最近 50 条" :value="50" />
        <el-option label="最近 100 条" :value="100" />
      </el-select>
      <span class="spacer" />
      <span class="log-count"
        >共 <b>{{ logs.logs.length }}</b> 条 · 显示 <b>{{ visible.length }}</b> 条</span
      >
      <el-button :loading="logs.loading" @click="logs.load">刷新</el-button>
      <el-button :disabled="!visible.length" @click="exportCsv">导出 CSV</el-button>
    </div>

    <div v-if="!logs.loading && logs.logs.length === 0" class="empty gc-card">
      <strong>还没有操作日志</strong>
      <p>预览确认后的写操作会记在这里。只读预演不记。</p>
    </div>
    <div v-else class="table gc-card" v-loading="logs.loading">
      <div class="th">
        <span>时间</span>
        <span>来源</span>
        <span>工具</span>
        <span>仓库</span>
        <span>参数（脱敏）</span>
        <span>结果</span>
        <span>耗时</span>
      </div>
      <div v-for="row in visible" :key="row.id" class="tr">
        <span class="tm">{{ formatTime(row.timestamp) }}</span>
        <span>{{ sourceLabel(row.source) }}</span>
        <span class="tool-cell">
          <code :class="riskOf(row.tool)">{{ row.tool }}</code>
          <em v-if="row.dryRun">dry-run</em>
        </span>
        <span class="mono" :title="row.repoPath ?? ''">{{ row.repoPath ?? '—' }}</span>
        <span class="mono" :title="parseParams(row.params)">{{ parseParams(row.params) || '—' }}</span>
        <span class="res-cell">
          <span class="res" :class="row.error ? 'bad' : 'ok'">
            <GcIcon :name="row.error ? 'close' : 'check'" :size="10" />
            {{ row.error ? '失败' : '成功' }}
          </span>
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
/* 工具栏：裸行，不加卡片壳（同设置页 gc-chip-tabs 的语言） */
.log-toolbar {
  flex: none;
  display: flex;
  align-items: center;
  gap: var(--gc-pad);
  flex-wrap: wrap;
}
.log-search {
  width: 260px;
}
.log-toolbar .spacer {
  flex: 1;
}
.log-count {
  font-size: var(--gc-fs-meta);
  color: var(--gc-text-3);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.log-count b {
  color: var(--gc-text-2);
  font-weight: 600;
}
.tool-select {
  width: 200px;
}
.limit-select {
  width: 120px;
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
  min-height: var(--gc-row-lg);
  align-items: center;
  font-size: var(--gc-fs-body);
}
.th {
  position: sticky;
  top: 0;
  z-index: 1;
  color: var(--gc-text-3);
  font-weight: 600;
  background: var(--gc-card);
}
.tr {
  border-top: 1px solid var(--gc-line-weak);
}
.tr:hover {
  background: var(--gc-btn-hover);
}
.tr .tm {
  font-family: 'JetBrains Mono', 'Cascadia Code', Consolas, monospace;
  color: var(--gc-text-3);
  font-variant-numeric: tabular-nums;
  font-size: var(--gc-fs-meta);
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
  height: 18px;
  padding: 0 6px;
  border-radius: var(--gc-r-tag);
  font-size: var(--gc-fs-meta);
  display: inline-flex;
  align-items: center;
}
.tool-cell code.write {
  background: var(--gc-amber-weak);
  color: var(--gc-amber);
}
.tool-cell em {
  flex: none;
  font-style: normal;
  height: 18px;
  padding: 0 6px;
  border-radius: var(--gc-r-tag);
  background: var(--gc-amber-weak);
  color: var(--gc-amber);
  font-size: var(--gc-fs-meta);
  display: inline-flex;
  align-items: center;
}
code.high {
  background: var(--gc-red-weak);
  color: var(--gc-red);
}
.res-cell {
  display: flex;
  align-items: center;
}
/* 结果 chip：图标 + 语义色（对齐设计稿 res） */
.res {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  height: 18px;
  padding: 0 6px;
  border-radius: var(--gc-r-tag);
  font-size: var(--gc-fs-meta);
  font-weight: 500;
  line-height: 1;
}
.res.ok {
  color: var(--gc-green);
  background: var(--gc-green-weak);
}
.res.bad {
  color: var(--gc-red);
  background: var(--gc-red-weak);
}
.empty {
  flex: 1;
  display: grid;
  place-content: center;
  text-align: center;
  padding: var(--gc-pad);
  gap: var(--gc-gap);
  color: var(--gc-text-3);
}
.empty strong {
  font-size: var(--el-font-size-extra-large);
  color: var(--gc-text);
  font-weight: 600;
}
.empty p {
  margin: 0;
  font-size: var(--gc-fs-body);
}
</style>
