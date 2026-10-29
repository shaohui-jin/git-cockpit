<script setup lang="ts">
import { computed, ref, watch } from 'vue';
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

const BACKUP_TOOLS = new Set([
  'git_reset_hard',
  'git_clean',
  'git_push_force',
  'git_branch_delete_force',
  'git_rebase'
]);

const emit = defineEmits<{
  (e: 'update:visible', v: boolean): void;
  (e: 'confirm', backupBranch?: boolean): void;
  (e: 'cancel'): void;
}>();

const offerBackup = computed(() => BACKUP_TOOLS.has(props.tool));
const backupBranch = ref(true);
watch(
  () => props.visible,
  (v) => {
    if (v) backupBranch.value = true;
  }
);

const command = computed(() => {
  const p = props.preview;
  if (!p) return '';
  if ('command' in p && typeof p.command === 'string') return p.command;
  return '';
});

const risk = computed(() => {
  const p = props.preview;
  const raw =
    p && 'risk' in p && typeof (p as { risk?: unknown }).risk === 'string'
      ? String((p as { risk: string }).risk)
      : 'write';
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
  risk.value === 'dangerous'
    ? { type: 'danger' as const, label: '高风险' }
    : risk.value === 'write'
      ? { type: 'warning' as const, label: '写操作' }
      : { type: 'info' as const, label: '只读' }
);

const previewNote = computed(() => {
  if (props.note) return props.note;
  const p = props.preview as { note?: unknown } | null;
  return typeof p?.note === 'string' ? p.note : '';
});

const previewBody = computed(() => {
  const p = props.preview as { body?: unknown } | null;
  return typeof p?.body === 'string' ? p.body : '';
});

function onConfirm(): void {
  emit('confirm', offerBackup.value ? backupBranch.value : undefined);
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
    class="gc-dryrun-dialog"
    @closed="emit('update:visible', false)"
  >
    <el-checkbox v-if="offerBackup" v-model="backupBranch" class="backup-check">
      备份分支（backup/pre-op-*）
    </el-checkbox>

    <div v-if="command" class="cmd-box">
      <div class="cmd-label"><GcIcon name="dry-run" :size="14" />将执行的命令（dry-run 预览，未实际执行）</div>
      <pre class="cmd-pre mono">{{ command }}</pre>
    </div>

    <div v-if="affectedFiles.length" class="files-box">
      <div class="cmd-label">影响文件（{{ affectedFiles.length }}）</div>
      <div class="dryrun-files">
        <span v-for="f in affectedFiles" :key="f" class="f mono">{{ f }}</span>
      </div>
    </div>

    <div v-if="previewNote" class="note-text">{{ previewNote }}</div>
    <div v-if="previewBody" class="body-box">
      <div class="cmd-label">将提交的正文</div>
      <pre class="cmd-pre">{{ previewBody }}</pre>
    </div>

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
.backup-check {
  margin-bottom: var(--gc-gap);
}
.cmd-box,
.files-box,
.body-box {
  margin-bottom: var(--gc-gap);
}
.body-box .cmd-pre {
  max-height: 220px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
}
.cmd-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: var(--gc-fs-body);
  font-weight: 600;
  color: var(--gc-text-2);
  margin-bottom: 6px;
}
.cmd-pre {
  margin: 0;
  padding: 10px 12px;
  background: var(--gc-overlay);
  border: 1px solid var(--gc-line);
  border-radius: var(--gc-r);
  overflow-x: auto;
  font-size: var(--gc-fs-body);
  color: var(--gc-text-2);
}
.dryrun-files {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
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
.file-item {
  font-size: var(--gc-fs-body);
  padding: 2px 0;
}
.note-text {
  font-size: var(--gc-fs-body);
  color: var(--gc-text-3);
}
.risk-tag {
  float: left;
}
</style>

<!-- el-dialog teleport 到 body，scoped 触达不到根节点；干跑确认语言：琥珀顶缘 + 待确认呼吸左边框（「未确认不安置」） -->
<style>
.gc-dryrun-dialog {
  position: relative;
  border-radius: var(--gc-r);
  border-top: 2px solid var(--gc-amber);
  box-shadow:
    var(--gc-shadow-menu),
    0 -6px 18px rgba(242, 201, 76, 0.15);
}
.gc-dryrun-dialog::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 2px;
  background: var(--gc-amber);
  border-radius: var(--gc-r) 0 0 var(--gc-r);
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
</style>
