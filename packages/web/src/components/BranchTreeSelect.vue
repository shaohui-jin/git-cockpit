<script setup lang="ts">
import { computed } from 'vue';
import { useBranchesStore } from '@/stores/branches';
import { buildBranchPanes, panesToSelectTree, type BranchScope } from '@/utils/branchTree';

const props = withDefaults(
  defineProps<{
    modelValue: string;
    placeholder?: string;
    scope?: BranchScope;
    /** true：远程组在前（合入目标） */
    remoteFirst?: boolean;
  }>(),
  { placeholder: '选择分支', scope: 'all', remoteFirst: false }
);

const emit = defineEmits<{
  (e: 'update:modelValue', v: string): void;
}>();

const branches = useBranchesStore();
const data = computed(() => panesToSelectTree(buildBranchPanes(branches.list, props.scope), props.remoteFirst));

function filterNode(query: string, node: { label?: string; value?: string }): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  return (node.label ?? '').toLowerCase().includes(q) || (node.value ?? '').toLowerCase().includes(q);
}
</script>

<template>
  <el-tree-select
    :model-value="modelValue"
    :data="data"
    filterable
    :filter-node-method="filterNode"
    check-strictly
    default-expand-all
    :render-after-expand="false"
    :placeholder="placeholder"
    class="branch-tree-select"
    @update:model-value="emit('update:modelValue', $event)"
  />
</template>

<style scoped>
.branch-tree-select {
  width: 280px;
}
.branch-tree-select :deep(.el-select__wrapper) {
  min-height: var(--gc-line);
}
</style>
