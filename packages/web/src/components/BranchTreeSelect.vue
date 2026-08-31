<script setup lang="ts">
import { computed } from 'vue';
import { useBranchesStore } from '@/stores/branches';
import { buildBranchPanes, panesToSelectTree, type BranchScope } from '@/utils/branchTree';

const props = withDefaults(
  defineProps<{
    modelValue: string | string[];
    placeholder?: string;
    scope?: BranchScope;
    /** true：远程组在前（合入目标） */
    remoteFirst?: boolean;
    multiple?: boolean;
  }>(),
  { placeholder: '选择分支', scope: 'all', remoteFirst: false, multiple: false }
);

const emit = defineEmits<{
  (e: 'update:modelValue', v: string | string[]): void;
}>();

const branches = useBranchesStore();
const data = computed(() => panesToSelectTree(buildBranchPanes(branches.list, props.scope), props.remoteFirst));

const selectedTitle = computed(() =>
  Array.isArray(props.modelValue) ? props.modelValue.filter(Boolean).join(', ') : props.modelValue
);

function optionLabel(data: { label?: string; value?: string; fullName?: string }): string {
  return data.fullName || data.label || data.value || '';
}

function filterNode(query: string, node: { label?: string; value?: string }): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  return (node.label ?? '').toLowerCase().includes(q) || (node.value ?? '').toLowerCase().includes(q);
}

function onUpdate(v: string | string[] | null): void {
  if (props.multiple) {
    emit('update:modelValue', Array.isArray(v) ? v : []);
    return;
  }
  emit('update:modelValue', typeof v === 'string' ? v : '');
}
</script>

<template>
  <el-tree-select
    :model-value="modelValue"
    :data="data"
    filterable
    :filter-node-method="filterNode"
    check-strictly
    :multiple="multiple"
    :collapse-tags="multiple"
    :collapse-tags-tooltip="multiple"
    :show-checkbox="multiple"
    default-expand-all
    :render-after-expand="false"
    :placeholder="placeholder"
    :title="selectedTitle || placeholder"
    class="branch-tree-select"
    @update:model-value="onUpdate"
  >
    <template #default="{ data: node }">
      <el-tooltip :content="optionLabel(node)" placement="top" :show-after="400" :enterable="false">
        <span class="branch-option">{{ optionLabel(node) }}</span>
      </el-tooltip>
    </template>
  </el-tree-select>
</template>

<style scoped>
.branch-tree-select {
  width: var(--gc-select-width);
  flex: none;
}
.branch-tree-select :deep(.el-select__wrapper) {
  min-height: var(--gc-control);
  height: var(--gc-control);
  font-size: var(--gc-text);
}
.branch-tree-select :deep(.el-select__selected-item),
.branch-tree-select :deep(.el-select__placeholder),
.branch-tree-select :deep(.el-select__input-wrapper) {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.branch-tree-select :deep(.el-tag) {
  height: 20px;
  max-width: 160px;
}
.branch-tree-select :deep(.el-tag .el-tag__content) {
  overflow: hidden;
  text-overflow: ellipsis;
}
.branch-option {
  display: block;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--gc-text);
  line-height: var(--gc-control);
}
</style>
