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
    /** 合并页：不列出 worktree 落盘留下的 merge/… */
    excludeMergeTemp?: boolean;
  }>(),
  { placeholder: '选择分支', scope: 'all', remoteFirst: false, multiple: false, excludeMergeTemp: false }
);

const emit = defineEmits<{
  (e: 'update:modelValue', v: string | string[]): void;
}>();

const branches = useBranchesStore();
const data = computed(() =>
  panesToSelectTree(
    buildBranchPanes(branches.list, props.scope, { excludeMergeTemp: props.excludeMergeTemp }),
    props.remoteFirst
  )
);

const selectedTitle = computed(() =>
  Array.isArray(props.modelValue) ? props.modelValue.filter(Boolean).join(', ') : props.modelValue
);

function filterNode(query: string, node: { label?: string; value?: string; fullName?: string }): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  return (
    (node.label ?? '').toLowerCase().includes(q) ||
    (node.value ?? '').toLowerCase().includes(q) ||
    (node.fullName ?? '').toLowerCase().includes(q)
  );
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
      <el-tooltip :content="node.fullName || node.label" placement="top" :show-after="400" :enterable="false">
        <span class="branch-option">{{ node.label }}</span>
      </el-tooltip>
    </template>
  </el-tree-select>
</template>

<style scoped>
.branch-tree-select {
  width: var(--gc-select-width);
  flex: none;
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
