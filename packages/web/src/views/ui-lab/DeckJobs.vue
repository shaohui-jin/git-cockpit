<script setup lang="ts">
import { computed, ref } from 'vue';
import { mockJobs } from './mock';
import type { Edge } from './mock';

defineProps<{ edge: Edge }>();

type Filter = 'all' | 'running' | 'error' | 'ok';
const filter = ref<Filter>('all');
const activeId = ref('j1');
const toast = ref('');

const list = computed(() => {
  if (filter.value === 'all') return mockJobs;
  return mockJobs.filter((j) => j.status === filter.value);
});
const active = computed(() => mockJobs.find((j) => j.id === activeId.value) ?? list.value[0] ?? null);
const counts = computed(() => ({
  all: mockJobs.length,
  running: mockJobs.filter((j) => j.status === 'running').length,
  error: mockJobs.filter((j) => j.status === 'error').length,
  ok: mockJobs.filter((j) => j.status === 'ok').length
}));

function kindLabel(k: string): string {
  if (k === 'fetch') return '抓取';
  if (k === 'survey') return '矩阵扫描';
  if (k === 'clone') return '克隆';
  return k;
}
function statusLabel(s: string): string {
  if (s === 'running') return '进行中';
  if (s === 'error') return '失败';
  return '成功';
}
function ping(msg: string): void {
  toast.value = msg;
  window.setTimeout(() => {
    if (toast.value === msg) toast.value = '';
  }, 2000);
}
</script>

<template>
  <div class="jobs">
    <p v-if="edge === 'offline'" class="banner err">后端离线。进行中的任务会在重启后标成失败。</p>
    <template v-if="edge === 'empty'">
      <div class="empty glass">
        <strong>还没有后台任务</strong>
        <p>克隆、矩阵扫描、抓取远程会排在这里。去工作台克隆一个仓。</p>
      </div>
    </template>
    <template v-else>
      <aside class="glass list">
        <div class="chips">
          <button v-for="k in (['all', 'running', 'error', 'ok'] as const)" :key="k" :class="{ on: filter === k }" @click="filter = k">
            {{ { all: '全部', running: '进行中', error: '失败', ok: '成功' }[k] }} {{ counts[k] }}
          </button>
        </div>
        <p v-if="!list.length" class="miss">没有这类任务</p>
        <button
          v-for="j in list"
          :key="j.id"
          class="row"
          :class="[j.status, { on: j.id === active?.id }]"
          @click="activeId = j.id"
        >
          <div class="top">
            <b :class="j.status">{{ statusLabel(j.status) }}</b>
            <span>{{ kindLabel(j.kind) }}</span>
            <em>{{ j.time }}</em>
          </div>
          <div class="title">{{ j.title }}</div>
          <div class="tail" :class="{ err: j.status === 'error' }">{{ j.tail }}</div>
        </button>
      </aside>
      <section v-if="active" class="glass log">
        <header>
          <b :class="active.status">{{ statusLabel(active.status) }}</b>
          <span>{{ kindLabel(active.kind) }} · {{ active.time }}</span>
          <span class="grow" />
          <button v-if="active.status === 'running'" class="btn danger" @click="ping('示意：已请求取消')">取消</button>
          <button v-if="active.status === 'error' && active.kind === 'clone'" class="btn" @click="ping('示意：打开克隆重试')">修改并重试</button>
        </header>
        <p class="meta">{{ active.title }}</p>
        <p v-if="active.status === 'error'" class="banner err">{{ active.tail }}</p>
        <pre>{{ (active.logs ?? [active.tail]).join('\n') }}</pre>
      </section>
      <section v-else class="glass log empty">
        <p>点左侧任务看日志</p>
      </section>
    </template>
    <div v-if="toast" class="toast">{{ toast }}</div>
  </div>
</template>

<style scoped>
@import './deck-shared.css';
.jobs {
  position: relative;
  z-index: 1;
  display: flex;
  gap: var(--gc-pad);
  padding: var(--gc-gap) var(--gc-pad) calc(var(--gc-line) + var(--gc-pad) * 2);
  height: 100%;
  min-height: 0;
}
.list {
  width: 340px;
  flex: none;
  overflow: auto;
  padding: var(--gc-pad);
  display: flex;
  flex-direction: column;
  gap: var(--gc-gap);
}
.log {
  flex: 1;
  min-width: 0;
  overflow: auto;
  padding: var(--gc-pad);
  display: flex;
  flex-direction: column;
  gap: var(--gc-gap);
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--gc-gap);
  margin-bottom: var(--gc-gap);
}
.chips button {
  border: 0;
  border-radius: var(--gc-radius);
  padding: 0 var(--gc-pad);
  height: var(--gc-control);
  background: rgb(255 255 255 / 0.06);
  color: inherit;
  font: inherit;
  font-size: var(--gc-text);
  cursor: pointer;
}
.chips button.on {
  background: rgb(103 232 249 / 0.18);
}
.row {
  display: block;
  width: 100%;
  text-align: left;
  border: 0;
  border-radius: var(--gc-radius);
  padding: var(--gc-gap) var(--gc-pad);
  background: transparent;
  color: inherit;
  cursor: pointer;
  font: inherit;
}
.row.on {
  background: rgb(103 232 249 / 0.1);
}
.top {
  display: flex;
  gap: var(--gc-gap);
  align-items: center;
  font-size: var(--gc-text);
}
.top em {
  margin-left: auto;
  font-style: normal;
  opacity: 0.45;
}
.title {
  font-size: var(--gc-text);
  margin: var(--gc-gap) 0 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tail {
  font-size: var(--gc-text);
  opacity: 0.5;
}
.tail.err,
.top b.error,
header b.error {
  color: #fda4af;
}
.top b.running,
header b.running {
  color: #c4b5fd;
}
.top b.ok,
header b.ok {
  color: #6ee7b7;
}
header {
  display: flex;
  gap: var(--gc-gap);
  align-items: center;
  font-size: var(--gc-text);
}
.grow {
  flex: 1;
}
.meta {
  margin: 0;
  font-size: var(--gc-text);
  opacity: 0.6;
}
pre {
  margin: 0;
  flex: 1;
  overflow: auto;
  padding: var(--gc-pad);
  border-radius: var(--gc-radius);
  background: #05080e;
  font-size: var(--gc-text);
  line-height: 1.55;
  color: rgb(232 244 255 / 0.75);
}
.miss {
  font-size: var(--gc-text);
  opacity: 0.5;
  padding: var(--gc-pad);
}
.toast {
  position: absolute;
  right: var(--gc-pad);
  bottom: calc(var(--gc-control) + var(--gc-pad) * 2);
  padding: var(--gc-gap) var(--gc-pad);
  border-radius: var(--gc-radius);
  background: #121826;
  border: 1px solid rgb(103 232 249 / 0.3);
  font-size: var(--gc-text);
}
</style>
