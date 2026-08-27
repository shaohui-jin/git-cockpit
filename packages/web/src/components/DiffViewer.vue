<script setup lang="ts">
import { computed } from 'vue';
import { html as diffToHtml } from 'diff2html';
import { ColorSchemeType } from 'diff2html/lib-esm/types';
import 'diff2html/bundles/css/diff2html.min.css';

const props = defineProps<{
  patch: string;
}>();

/**
 * 将 git diff 文本渲染为 diff2html（GitHub 风格）：
 * - 每文件独立成块，带文件头 / 左右行号 / 增删着色 / 行内高亮
 * - colorScheme: dark + theme.css 中的 .d2h-* 覆盖对齐 --gc 令牌
 * - 空文本或解析异常时回退为「无差异」，由父级 empty 兜底
 */
const rendered = computed<string>(() => {
  if (!props.patch.trim()) return '';
  try {
    return diffToHtml(props.patch, {
      drawFileList: false,
      outputFormat: 'line-by-line',
      matching: 'lines',
      colorScheme: ColorSchemeType.DARK,
      renderNothingWhenEmpty: true
    });
  } catch {
    return '';
  }
});

/** 渲染失败或空补丁时，用轻量方式展示原始文本（保底不出白屏） */
const fallbackLines = computed<string[]>(() =>
  rendered.value === '' ? props.patch.split('\n') : []
);
</script>

<template>
  <div class="diff-viewer">
    <!-- eslint-disable-next-line vue/no-v-html -- diff2html 输出，非用户输入 -->
    <div v-if="rendered" class="diff-html" v-html="rendered" />
    <pre v-else-if="fallbackLines.length" class="diff-fallback mono"><template v-for="(l, i) in fallbackLines" :key="i">{{ l }}
</template></pre>
  </div>
</template>

<style scoped>
.diff-viewer {
  font-size: var(--gc-text);
}
/* 让 diff2html 覆盖样式（theme.css 全局定义 .d2h-*）在 scoped 内仍生效 */
.diff-html :deep(.d2h-wrapper) {
  display: block;
}
</style>
