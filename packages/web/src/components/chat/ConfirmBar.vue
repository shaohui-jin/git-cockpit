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
    <div v-for="item in items" :key="item.token" class="dryrun is-pending">
      <div class="dryrun-head">
        <GcIcon name="dry-run" :size="14" />
        <span class="dryrun-title">写操作干跑预览</span>
        <span class="dryrun-tool mono">{{ item.tool }}</span>
      </div>
      <pre class="dryrun-cmd mono">{{ item.command || '（无命令）' }}</pre>
      <div v-if="item.affectedFiles.length" class="dryrun-files">
        <span v-for="f in item.affectedFiles" :key="f" class="f mono">{{ f }}</span>
      </div>
      <div v-if="item.note" class="dryrun-note">{{ item.note }}</div>
      <div class="dryrun-actions">
        <el-button size="small" class="h24" :disabled="confirming" @click="emit('cancel', item)">取消</el-button>
        <el-button type="primary" size="small" class="h24" :loading="confirming" @click="emit('confirm', item)">
          确认执行
        </el-button>
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
/* 干跑确认条（紧凑变体）：overlay 实底 + 琥珀顶缘 + 待确认呼吸左边框 */
.dryrun {
  position: relative;
  background: var(--gc-overlay);
  border: 1px solid var(--gc-line);
  border-radius: var(--gc-r);
  padding: var(--gc-gap) var(--gc-pad);
}
.dryrun::before {
  content: '';
  position: absolute;
  left: -1px;
  right: -1px;
  top: -1px;
  height: 2px;
  border-radius: var(--gc-r) var(--gc-r) 0 0;
  background: var(--gc-amber);
  box-shadow: 0 0 8px rgba(242, 201, 76, 0.35);
}
.dryrun.is-pending::after {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 2px;
  background: var(--gc-amber);
  animation: gc-dryrun-breathe var(--gc-t-pulse) var(--gc-ease) infinite;
}
@keyframes gc-dryrun-breathe {
  0%,
  100% {
    opacity: 0.35;
  }
  50% {
    opacity: 1;
  }
}
.dryrun-head {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--gc-amber);
}
.dryrun-title {
  font-size: var(--gc-fs-body);
  font-weight: 600;
  color: var(--gc-text);
}
.dryrun-tool {
  margin-left: auto;
  font-size: var(--gc-fs-meta);
  color: var(--gc-text-3);
}
.dryrun-cmd {
  margin: var(--gc-gap) 0;
  white-space: pre-wrap;
  word-break: break-all;
  font-size: var(--gc-fs-body);
  color: var(--gc-text-2);
}
.dryrun-files {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: var(--gc-gap);
}
.dryrun-files .f {
  height: 18px;
  padding: 0 6px;
  border-radius: var(--gc-r-tag);
  background: var(--gc-card);
  border: 1px solid var(--gc-line);
  font-size: var(--gc-fs-meta);
  color: var(--gc-text-2);
  display: inline-flex;
  align-items: center;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dryrun-note {
  font-size: var(--gc-fs-body);
  color: var(--gc-text-3);
  margin-bottom: var(--gc-gap);
}
.dryrun-actions {
  display: flex;
  gap: var(--gc-gap);
}
.dryrun-actions .h24 {
  height: var(--gc-btn-inline);
}
</style>
