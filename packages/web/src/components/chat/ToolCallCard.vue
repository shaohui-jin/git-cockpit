<script setup lang="ts">
defineProps<{
  tool: string;
  success: boolean;
}>();
</script>

<template>
  <div class="tool-card" :class="success ? 'ok' : 'bad'">
    <i class="tc-ico"><GcIcon :name="success ? 'check' : 'close'" :size="12" /></i>
    <span class="tool-name mono">{{ tool }}</span>
    <span class="chip" :class="success ? 'green' : 'red'">{{ success ? '成功' : '失败' }}</span>
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
  border: 1px solid var(--gc-line);
  border-radius: var(--gc-r);
  background: var(--gc-card);
  font-size: var(--gc-fs-body);
}
.tc-ico {
  display: inline-flex;
  flex: none;
  color: var(--gc-green);
}
.tool-card.bad .tc-ico {
  color: var(--gc-red);
}
.tool-name {
  color: var(--gc-text-2);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.chip {
  margin-left: auto;
  flex: none;
  height: 18px;
  padding: 0 8px;
  border-radius: var(--gc-r-tag);
  font-size: var(--gc-fs-meta);
  font-weight: 500;
  display: inline-flex;
  align-items: center;
}
.chip.green {
  background: var(--gc-green-weak);
  color: var(--gc-green);
}
.chip.red {
  background: var(--gc-red-weak);
  color: var(--gc-red);
}
</style>
