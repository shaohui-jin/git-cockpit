<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{
  patch: string;
}>();

interface Line {
  type: 'meta' | 'hunk' | 'add' | 'del' | 'plain';
  text: string;
}

/** 将 git diff 文本渲染为带 + / - / hunk 高亮的行 */
const lines = computed<Line[]>(() => {
  const out: Line[] = [];
  for (const raw of props.patch.split('\n')) {
    const t: Line['type'] =
      raw.startsWith('diff --git') ||
      raw.startsWith('index ') ||
      raw.startsWith('---') ||
      raw.startsWith('+++') ||
      raw.startsWith('new file') ||
      raw.startsWith('deleted file') ||
      raw.startsWith('similarity') ||
      raw.startsWith('rename ')
        ? 'meta'
        : raw.startsWith('@@')
          ? 'hunk'
          : raw.startsWith('+')
            ? 'add'
            : raw.startsWith('-')
              ? 'del'
              : 'plain';
    out.push({ type: t, text: raw });
  }
  return out;
});
</script>

<template>
  <pre class="diff-pre mono"><template v-for="(l, i) in lines" :key="i"><span :class="l.type">{{ l.text }}</span>
</template></pre>
</template>

<style scoped>
.diff-pre .add {
  color: #198754;
  background: rgba(25, 135, 84, 0.08);
  display: block;
}
.diff-pre .del {
  color: #dc3545;
  background: rgba(220, 53, 69, 0.08);
  display: block;
}
.diff-pre .hunk {
  color: var(--el-text-color-secondary);
}
.diff-pre .meta {
  color: var(--el-color-primary);
}
</style>