<script setup lang="ts">
import { computed, ref } from 'vue';
import { mockLogs } from './mock';
import type { Edge } from './mock';

defineProps<{ edge: Edge }>();

const tool = ref('');
const tools = computed(() => [...new Set(mockLogs.map((l) => l.tool))]);
const rows = computed(() => (tool.value ? mockLogs.filter((l) => l.tool === tool.value) : mockLogs));

function sourceLabel(s: string): string {
  if (s === 'mcp') return 'MCP';
  if (s === 'web') return 'Web';
  if (s === 'chat') return 'Chat';
  return 'CLI';
}
function risk(toolName: string): string {
  return /reset|clean|force|rebase/.test(toolName) ? 'high' : 'write';
}
</script>

<template>
  <div class="logs">
    <p v-if="edge === 'offline'" class="banner err">后端离线。日志是落在本机数据目录里的，重连后可以再拉。</p>
    <div class="bar glass">
      <label>
        工具
        <select v-model="tool">
          <option value="">全部</option>
          <option v-for="t in tools" :key="t" :value="t">{{ t }}</option>
        </select>
      </label>
      <span class="tip">只记写入。来源：Web / MCP / CLI / Chat。参数已脱敏。</span>
    </div>
    <div v-if="edge === 'empty'" class="empty glass">
      <strong>还没有操作日志</strong>
      <p>预览确认后的写操作会记在这里。只读预演不记。</p>
    </div>
    <div v-else class="table glass">
      <div class="th">
        <span>时间</span><span>来源</span><span>工具</span><span>结果</span><span>仓库</span>
      </div>
      <div v-for="(l, i) in rows" :key="i" class="tr">
        <span>{{ l.time }}</span>
        <span>{{ sourceLabel(l.source) }}</span>
        <code :class="risk(l.tool)">{{ l.tool }}</code>
        <span :class="{ bad: l.result !== 'ok' }">{{ l.dryRun ? 'dry-run · ' : '' }}{{ l.result }}</span>
        <span>{{ l.repo }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
@import './deck-shared.css';
.logs {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  gap: var(--gc-pad);
  padding: var(--gc-gap) var(--gc-pad) calc(var(--gc-line) + var(--gc-pad) * 2);
  height: 100%;
  min-height: 0;
}
.bar {
  flex: none;
  display: flex;
  align-items: center;
  gap: var(--gc-pad);
  padding: var(--gc-gap) var(--gc-pad);
}
.bar label {
  display: flex;
  align-items: center;
  gap: var(--gc-gap);
  font-size: var(--gc-text);
}
select {
  border: 0;
  border-radius: var(--gc-radius);
  padding: 0 var(--gc-pad);
  height: var(--gc-control);
  background: rgb(255 255 255 / 0.08);
  color: inherit;
  font: inherit;
}
.tip {
  font-size: var(--gc-text);
  opacity: 0.5;
}
.table {
  flex: 1;
  overflow: auto;
  padding: 0;
}
.th,
.tr {
  display: grid;
  grid-template-columns: 140px 70px 1.2fr 140px 1fr;
  gap: var(--gc-gap);
  padding: 0 var(--gc-pad);
  height: var(--gc-line);
  align-items: center;
  font-size: var(--gc-text);
}
.th {
  opacity: 0.45;
  font-weight: 600;
}
.tr {
  border-top: 1px solid rgb(255 255 255 / 0.05);
}
code.high {
  color: #fda4af;
}
.bad {
  color: #fda4af;
}
</style>
