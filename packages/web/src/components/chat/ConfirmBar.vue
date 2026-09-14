<script setup lang="ts">
import type { PendingConfirm } from './types';

defineProps<{
  items: PendingConfirm[];
  confirming: boolean;
}>();

const emit = defineEmits<{
  confirm: [item: PendingConfirm];
  cancel: [item: PendingConfirm];
}>();
</script>

<template>
  <div v-if="items.length" class="confirm-bar">
    <div v-for="item in items" :key="item.token" class="confirm-card">
      <div class="confirm-title">待确认 {{ item.tool }}</div>
      <pre class="mono confirm-cmd">{{ item.command || '（无命令）' }}</pre>
      <div v-if="item.affectedFiles.length" class="confirm-files">影响文件：{{ item.affectedFiles.join('、') }}</div>
      <div v-if="item.note" class="confirm-files">{{ item.note }}</div>
      <div class="confirm-actions">
        <el-button type="primary" size="small" :loading="confirming" @click="emit('confirm', item)">确认执行</el-button>
        <el-button size="small" :disabled="confirming" @click="emit('cancel', item)">取消</el-button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.confirm-bar {
  flex: none;
  margin-top: var(--gc-gap);
  display: flex;
  flex-direction: column;
  gap: var(--gc-gap);
}
.confirm-card {
  border: 1px solid var(--el-color-warning);
  border-radius: var(--gc-radius);
  padding: var(--gc-pad);
  background: var(--el-bg-color);
}
.confirm-title {
  font-weight: 600;
  margin-bottom: 4px;
}
.confirm-cmd {
  margin: 0 0 var(--gc-gap);
  white-space: pre-wrap;
}
.confirm-files {
  font-size: var(--gc-text);
  color: var(--el-text-color-secondary);
  margin-bottom: var(--gc-gap);
}
.confirm-actions {
  display: flex;
  gap: var(--gc-gap);
}
</style>
