<script setup lang="ts">
import { computed } from 'vue';

const WEEKS = 12;
const WEEKDAYS = 7;

const props = withDefaults(
  defineProps<{
    days?: number[];
    start?: string;
    total?: number;
  }>(),
  { days: () => [], start: '', total: 0 }
);

function ymdAdd(start: string, offset: number): string {
  const [y, m, d] = start.split('-').map(Number);
  if (!y || !m || !d) return '';
  const dt = new Date(y, m - 1, d + offset);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

function level(n: number): number {
  if (n <= 0) return 0;
  if (n === 1) return 1;
  if (n <= 3) return 2;
  if (n <= 6) return 3;
  return 4;
}

const cells = computed(() => {
  const days = props.days.length === WEEKS * WEEKDAYS ? props.days : new Array(WEEKS * WEEKDAYS).fill(0);
  const cols: Array<Array<{ n: number; lv: number; title: string }>> = [];
  for (let w = 0; w < WEEKS; w++) {
    const col: Array<{ n: number; lv: number; title: string }> = [];
    for (let d = 0; d < WEEKDAYS; d++) {
      const i = w * WEEKDAYS + d;
      const n = days[i] ?? 0;
      const date = ymdAdd(props.start, i);
      col.push({
        n,
        lv: level(n),
        title: date ? `${date} · ${n} 次提交` : `${n} 次提交`
      });
    }
    cols.push(col);
  }
  return cols;
});
</script>

<template>
  <div class="heat" :title="`近 12 周 ${total} 次提交`">
    <div v-for="(col, wi) in cells" :key="wi" class="heat-col">
      <span
        v-for="(c, di) in col"
        :key="di"
        class="heat-cell"
        :class="'lv' + c.lv"
        :title="c.title"
      />
    </div>
  </div>
</template>

<style scoped>
.heat {
  display: flex;
  gap: 2px;
  flex: none;
}
.heat-col {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.heat-cell {
  width: 7px;
  height: 7px;
  border-radius: 2px;
  background: var(--gc-heat-0);
}
.heat-cell.lv1 { background: var(--gc-heat-1); }
.heat-cell.lv2 { background: var(--gc-heat-2); }
.heat-cell.lv3 { background: var(--gc-heat-3); }
.heat-cell.lv4 { background: var(--gc-heat-4); }
</style>
