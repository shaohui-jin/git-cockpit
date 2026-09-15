<script setup lang="ts">
import { computed } from 'vue';
import { heatLevel } from './mock';

const props = withDefaults(
  defineProps<{
    days?: number[];
    size?: number;
  }>(),
  { days: () => [], size: 7 }
);

const cols = computed(() => {
  const days = props.days.length === 84 ? props.days : new Array(84).fill(0);
  const out: number[][] = [];
  for (let w = 0; w < 12; w++) {
    const col: number[] = [];
    for (let d = 0; d < 7; d++) col.push(heatLevel(days[w * 7 + d] ?? 0));
    out.push(col);
  }
  return out;
});
</script>

<template>
  <div class="mini-heat" :style="{ '--cell': size + 'px' }">
    <div v-for="(col, wi) in cols" :key="wi" class="col">
      <i v-for="(lv, di) in col" :key="di" class="cell" :class="'lv' + lv" />
    </div>
  </div>
</template>

<style scoped>
.mini-heat {
  display: flex;
  gap: 2px;
}
.col {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.cell {
  width: var(--cell);
  height: var(--cell);
  border-radius: 2px;
  background: var(--heat-0, rgb(255 255 255 / 0.06));
}
.cell.lv1 {
  background: var(--heat-1, rgb(56 189 248 / 0.28));
}
.cell.lv2 {
  background: var(--heat-2, rgb(56 189 248 / 0.5));
}
.cell.lv3 {
  background: var(--heat-3, rgb(56 189 248 / 0.72));
}
.cell.lv4 {
  background: var(--heat-4, rgb(56 189 248 / 1));
}
</style>
