<script setup lang="ts">
defineProps<{
  tool: string;
  success: boolean;
}>();
</script>

<template>
  <div class="tool-card" :class="{ ok: success, bad: !success }">
    <span class="tool-name mono">{{ tool }}</span>
    <span class="tool-state">{{ success ? '已返回' : '失败' }}</span>
  </div>
</template>

<style scoped>
.tool-card {
  display: flex;
  align-items: center;
  gap: var(--gc-gap);
  margin: 0 auto var(--gc-gap);
  max-width: 90%;
  padding: 6px var(--gc-pad);
  border: 1px solid var(--el-border-color-lighter);
  border-radius: var(--gc-radius);
  background: var(--el-bg-color);
  font-size: 12px;
}
.tool-card.ok {
  border-color: var(--el-color-success-light-5);
}
.tool-card.bad {
  border-color: var(--el-color-danger-light-5);
}
.tool-name {
  color: var(--el-color-primary);
}
.tool-state {
  margin-left: auto;
  color: var(--el-text-color-secondary);
}
</style>
