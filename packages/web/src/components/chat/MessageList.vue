<script setup lang="ts">
import { computed } from 'vue';
import { renderChatMarkdown } from './markdown';
import type { ChatLine } from './types';
import ToolCallCard from './ToolCallCard.vue';

const props = defineProps<{
  lines: ChatLine[];
  streaming: boolean;
}>();

const streamingId = computed(() => {
  if (!props.streaming) return null;
  for (let i = props.lines.length - 1; i >= 0; i--) {
    if (props.lines[i]?.role === 'assistant') return props.lines[i]!.id;
  }
  return null;
});
</script>

<template>
  <div class="message-list">
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
</style>
