<script setup lang="ts">
import { computed } from 'vue';
import { iconSvg } from '@/utils/icons';

const props = defineProps<{
  /** 图标名（见 utils/icons.ts 的 PATHS 表） */
  name: string;
  /** 尺寸（px），默认 16（dock/内联档）；传 12/14 等小档用于 chip 内 */
  size?: number;
}>();

const svg = computed(() => iconSvg(props.name));
const style = computed(() => ({ width: `${props.size ?? 16}px`, height: `${props.size ?? 16}px` }));
</script>

<template>
  <span v-if="svg" class="gc-icon" :style="style" v-html="svg" />
</template>

<style scoped>
.gc-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  line-height: 0;
}
.gc-icon :deep(svg) {
  display: block;
  width: 100%;
  height: 100%;
}
</style>
