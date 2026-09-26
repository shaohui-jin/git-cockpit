<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import mermaid from 'mermaid';
import { renderChatMarkdown } from './markdown';
import type { ChatLine } from './types';
import ToolCallCard from './ToolCallCard.vue';

const props = defineProps<{
  lines: ChatLine[];
  streaming: boolean;
}>();

const listEl = ref<HTMLElement | null>(null);
const svgCache = new Map<string, string>();

const streamingId = computed(() => {
  if (!props.streaming) return null;
  for (let i = props.lines.length - 1; i >= 0; i--) {
    if (props.lines[i]?.role === 'assistant') return props.lines[i]!.id;
  }
  return null;
});

mermaid.initialize({
  startOnLoad: false,
  securityLevel: 'strict',
  theme: 'dark',
  fontFamily: 'inherit'
});

async function paintMermaid(): Promise<void> {
  await nextTick();
  const host = listEl.value;
  if (!host) return;
  const nodes = host.querySelectorAll<HTMLElement>('.md-mermaid');
  for (const node of nodes) {
    const src = node.querySelector('.md-mermaid-src')?.textContent?.trim() ?? '';
    if (!src) continue;
    const cached = svgCache.get(src);
    if (cached) {
      node.innerHTML = cached;
      continue;
    }
    const id = `gc-mermaid-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    try {
      const { svg } = await mermaid.render(id, src);
      svgCache.set(src, svg);
      node.innerHTML = svg;
    } catch {
      /* 源码留在 pre 里 */
    }
  }
}

onMounted(() => {
  void paintMermaid();
});

watch(
  () => props.lines.map((line) => `${line.id}:${line.text}`).join('\n'),
  () => {
    void paintMermaid();
  }
);
</script>

<template>
  <div ref="listEl" class="message-list">
    <template v-for="row in lines" :key="row.id">
      <ToolCallCard v-if="row.role === 'tool'" :tool="row.tool || ''" :success="row.success !== false" />
      <div v-else class="chat-row" :class="row.role">
        <div
          v-if="row.role === 'assistant'"
          class="chat-bubble markdown"
          v-html="renderChatMarkdown(row.text || (streamingId === row.id ? '…' : ''))"
        />
        <div v-else class="chat-bubble">{{ row.text }}</div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.chat-row {
  display: flex;
  margin-bottom: var(--gc-gap);
}
.chat-row.user {
  justify-content: flex-end;
}
.chat-row.system {
  justify-content: center;
}
.chat-bubble {
  max-width: 72%;
  padding: var(--gc-gap) var(--gc-pad);
  border-radius: var(--gc-radius);
  white-space: pre-wrap;
  font-size: var(--gc-text);
  line-height: 1.5;
  background: var(--el-bg-color);
}
.chat-row.user .chat-bubble {
  background: color-mix(in srgb, var(--el-color-primary) 12%, var(--el-bg-color));
}
.chat-row:not(.user):not(.system) .chat-bubble {
  max-width: 100%;
}
.chat-row.system .chat-bubble {
  max-width: 90%;
  color: var(--el-text-color-secondary);
  background: transparent;
}
.markdown {
  white-space: normal;
}
.markdown :deep(p) {
  margin: 0 0 0.5em;
}
.markdown :deep(p:last-child) {
  margin-bottom: 0;
}
.markdown :deep(pre) {
  margin: 0.5em 0;
  padding: var(--gc-gap);
  overflow: auto;
  border-radius: var(--gc-radius);
  background: var(--el-fill-color);
  font-family: var(--el-font-family);
  font-size: 12px;
}
.markdown :deep(code) {
  font-family: var(--el-font-family);
  font-size: 12px;
}
.markdown :deep(ul),
.markdown :deep(ol) {
  margin: 0.4em 0 0.4em 1.2em;
  padding: 0;
}
.markdown :deep(a) {
  color: var(--el-color-primary);
}
.markdown :deep(h1),
.markdown :deep(h2),
.markdown :deep(h3) {
  margin: 0.2em 0 0.4em;
  font-size: 15px;
  line-height: 1.35;
}
.markdown :deep(blockquote) {
  margin: 0.4em 0;
  padding-left: 10px;
  border-left: 3px solid var(--el-color-primary);
  color: var(--el-text-color-secondary);
}
.markdown :deep(table) {
  width: 100%;
  margin: 0.4em 0 0.6em;
  border-collapse: collapse;
  font-size: 12px;
}
.markdown :deep(th),
.markdown :deep(td) {
  padding: 4px 8px;
  border: 1px solid var(--el-border-color-lighter);
  text-align: left;
}
.markdown :deep(th) {
  background: var(--el-fill-color-light);
}
.markdown :deep(li:has(> input)) {
  list-style: none;
  margin-left: -1.2em;
}
.markdown :deep(input[type='checkbox']) {
  margin-right: 6px;
}
.markdown :deep(.md-codeblock) {
  margin: 0.5em 0;
}
.markdown :deep(.md-code-lang) {
  font-size: 11px;
  color: var(--el-text-color-secondary);
  margin-bottom: 2px;
}
.markdown :deep(.md-diff-add) {
  color: var(--el-color-success);
}
.markdown :deep(.md-diff-del) {
  color: var(--el-color-danger);
}
.markdown :deep(.md-key) {
  color: var(--el-color-primary);
}
.markdown :deep(.md-str) {
  color: var(--el-color-success);
}
.markdown :deep(.md-comment) {
  color: var(--el-text-color-secondary);
}
.markdown :deep(.md-mermaid) {
  margin: 0.5em 0;
  overflow: auto;
}
.markdown :deep(.md-mermaid svg) {
  max-width: 100%;
  height: auto;
}
.markdown :deep(.md-mermaid-src) {
  margin: 0;
}
</style>
