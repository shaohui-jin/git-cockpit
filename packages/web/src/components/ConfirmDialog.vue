<script setup lang="ts">
import { computed } from 'vue';
import { ElMessage } from 'element-plus';
import type { ToolExecResult, WritePreview } from '@/api/types';

interface Props {
  visible: boolean;
  tool: string;
  /** dry-run 结果（含命令与风险） */
  preview?: WritePreview | ToolExecResult | null;
  /** 自定义补充说明（如有） */
  note?: string;
}

const props = withDefaults(defineProps<Props>(), {
  preview: null,
  note: ''
});

const emit = defineEmits<{
  (e: 'update:visible', v: boolean): void;
  (e: 'confirm'): void;
  (e: 'cancel'): void;
}>();

const command = computed(() => {
  const p = props.preview;
  if (!p) return '';
  if ('command' in p && typeof p.command === 'string') return p.command;
  return '';
});

const risk = computed(() => {
  const p = props.preview;
  const raw = p && 'risk' in p && typeof (p as { risk?: unknown }).risk === 'string' ? String((p as { risk: string }).risk) : 'write';
  if (raw === 'dangerous' || raw === 'high') return 'dangerous';
  if (raw === 'readonly') return 'readonly';
  return 'write';
});

const affectedFiles = computed(() => {
  const p = props.preview;
  if (p && 'affectedFiles' in p && Array.isArray((p as { affectedFiles?: unknown }).affectedFiles)) {
    return (p as { affectedFiles: string[] }).affectedFiles;
  }
  return [];
});

const riskText = computed(() =>
  risk.value === 'dangerous' ? { type: 'danger', label: '高风险' } : risk.value === 'write' ? { type: 'warning', label: '写操作' } : { type: 'info', label: '只读' }
);

function onConfirm(): void {
  emit('confirm');
}

function onCancel(): void {
  emit('cancel');
  emit('update:visible', false);
  ElMessage.info('操作已取消');
}
</script>

<template>
  <el-dialog
    :model-value="visible"
    :title="`执行操作：${tool}`"
    width="560px"
    :close-on-click-modal="false"
    @closed="emit('update:visible', false)"
  >
    <el-alert v-if="risk === 'dangerous'" type="error" :closable="false" show-icon class="risk-alert">
      <template #title>这是<b>高风险</b>操作，将自动创建备份（临时分支 + stash）</template>
    </el-alert>
    <el-alert v-else-if="risk === 'write'" type="warning" :closable="false" show-icon class="risk-alert">
      <template #title>写操作：执行后将修改仓库状态</template>
    </el-alert>

    <div v-if="command" class="cmd-box">
      <div class="cmd-label">将执行的命令（dry-run 预览，未实际执行）</div>
      <pre class="cmd-pre mono">{{ command }}</pre>
    </div>

    <div v-if="affectedFiles.length" class="files-box">
      <div class="cmd-label">涉及文件（{{ affectedFiles.length }}）</div>
      <el-scrollbar max-height="140px">
        <div v-for="f in affectedFiles" :key="f" class="file-item mono">{{ f }}</div>
      </el-scrollbar>
    </div>

    <div v-if="note" class="note-text">{{ note }}</div>

    <template #footer>
      <span class="risk-tag">
        <el-tag :type="riskText.type" size="small" effect="dark">{{ riskText.label }}</el-tag>
      </span>
      <el-button @click="onCancel">取消</el-button>
      <el-button type="primary" :danger="risk === 'dangerous'" @click="onConfirm">确认执行</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.risk-alert {
  margin-bottom: var(--gc-gap);
}
.cmd-box,
.files-box {
  margin-bottom: var(--gc-gap);
}
.cmd-label {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  margin-bottom: 6px;
}
.cmd-pre {
  margin: 0;
  padding: 10px 12px;
  background: var(--el-fill-color-light);
  border-radius: 6px;
  overflow-x: auto;
  font-size: 12px;
}
.file-item {
  font-size: 12px;
  padding: 2px 0;
}
.note-text {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.risk-tag {
  float: left;
}
</style>