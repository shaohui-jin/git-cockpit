<script setup lang="ts">
import { ref, watch } from 'vue';
import { html as diffToHtml, parse } from 'diff2html';
import { ColorSchemeType, type DiffFile } from 'diff2html/lib-esm/types';

const props = defineProps<{
  patch: string;
}>();

/** 变更行达到该数则默认收起；lock 文件无论行数都收起 */
const COLLAPSE_CHANGED_LINES = 200;
const LOCKFILE_RE = /(?:^|[/\\])(pnpm-lock\.yaml|package-lock\.json|yarn\.lock)$/i;

const D2H_OPTS = {
  drawFileList: false,
  outputFormat: 'line-by-line' as const,
  matching: 'lines' as const,
  colorScheme: ColorSchemeType.DARK,
  renderNothingWhenEmpty: true
};

const files = ref<DiffFile[]>([]);
const parseFailed = ref(false);
const expanded = ref<Set<string>>(new Set());
const htmlByKey = ref<Record<string, string>>({});

function fileKey(file: DiffFile, index: number): string {
  return `${index}\0${file.oldName}\0${file.newName}`;
}

function shouldCollapse(file: DiffFile): boolean {
  if (LOCKFILE_RE.test(file.newName) || LOCKFILE_RE.test(file.oldName)) return true;
  return file.addedLines + file.deletedLines >= COLLAPSE_CHANGED_LINES;
}

function displayPath(file: DiffFile): string {
  if (file.isRename || file.isCopy) return `${file.oldName} → ${file.newName}`;
  return file.newName || file.oldName;
}

function statusTag(file: DiffFile): { label: string; cls: string } {
  if (file.isBinary) return { label: 'BINARY', cls: 'd2h-changed' };
  if (file.isNew) return { label: 'ADDED', cls: 'd2h-added' };
  if (file.isDeleted) return { label: 'DELETED', cls: 'd2h-deleted' };
  if (file.isRename) return { label: 'RENAMED', cls: 'd2h-moved' };
  if (file.isCopy) return { label: 'COPIED', cls: 'd2h-moved' };
  return { label: 'CHANGED', cls: 'd2h-changed' };
}

function renderFileHtml(file: DiffFile): string {
  try {
    return diffToHtml([file], D2H_OPTS);
  } catch {
    return '';
  }
}

function isOpen(file: DiffFile, index: number): boolean {
  return expanded.value.has(fileKey(file, index));
}

function toggle(file: DiffFile, index: number): void {
  const key = fileKey(file, index);
  const next = new Set(expanded.value);
  if (next.has(key)) {
    next.delete(key);
  } else {
    next.add(key);
    if (!htmlByKey.value[key]) {
      htmlByKey.value = { ...htmlByKey.value, [key]: renderFileHtml(file) };
    }
  }
  expanded.value = next;
}

watch(
  () => props.patch,
  (patch) => {
    parseFailed.value = false;
    htmlByKey.value = {};
    const next = new Set<string>();
    if (!patch.trim()) {
      files.value = [];
      expanded.value = next;
      return;
    }
    try {
      const parsed = parse(patch);
      files.value = parsed;
      if (parsed.length === 0) {
        parseFailed.value = true;
        expanded.value = next;
        return;
      }
      const html: Record<string, string> = {};
      parsed.forEach((file, i) => {
        if (shouldCollapse(file)) return;
        const key = fileKey(file, i);
        next.add(key);
        html[key] = renderFileHtml(file);
      });
      htmlByKey.value = html;
      expanded.value = next;
    } catch {
      files.value = [];
      parseFailed.value = true;
      expanded.value = next;
    }
  },
  { immediate: true }
);
</script>

<template>
  <div class="diff-viewer">
    <div v-if="files.length" class="diff-files">
      <section v-for="(file, i) in files" :key="fileKey(file, i)" class="diff-file" :class="{ 'is-open': isOpen(file, i) }">
        <button type="button" class="diff-file-head" @click="toggle(file, i)">
          <span class="diff-file-chevron" aria-hidden="true">{{ isOpen(file, i) ? '▾' : '▸' }}</span>
          <span class="diff-file-path mono" :title="displayPath(file)">{{ displayPath(file) }}</span>
          <span class="d2h-tag" :class="statusTag(file).cls">{{ statusTag(file).label }}</span>
          <span class="diff-file-stats">
            <span class="add">+{{ file.addedLines }}</span>
            <span class="del">-{{ file.deletedLines }}</span>
          </span>
          <span v-if="!isOpen(file, i) && shouldCollapse(file)" class="diff-file-hint">点击展开</span>
        </button>
        <!-- eslint-disable-next-line vue/no-v-html -- diff2html 输出，非用户输入 -->
        <div
          v-if="isOpen(file, i) && htmlByKey[fileKey(file, i)]"
          class="diff-file-body diff-html"
          v-html="htmlByKey[fileKey(file, i)]"
        />
      </section>
    </div>
    <pre v-else-if="parseFailed" class="diff-fallback mono"><template v-for="(l, i) in patch.split('\n')" :key="i">{{ l }}
</template></pre>
  </div>
</template>

<style scoped>
.diff-viewer {
  font-size: var(--gc-text);
}

.diff-file {
  margin-bottom: var(--gc-gap);
  border: 1px solid var(--el-border-color);
  border-radius: var(--gc-radius);
  overflow: hidden;
  background: var(--el-bg-color);
}

.diff-file-head {
  display: flex;
  align-items: center;
  gap: var(--gc-gap);
  width: 100%;
  height: var(--gc-line);
  line-height: var(--gc-line);
  padding: 0 var(--gc-pad);
  border: 0;
  box-sizing: border-box;
  background: var(--el-fill-color-light);
  color: var(--el-text-color-regular);
  cursor: pointer;
  text-align: left;
  font: inherit;
  font-size: var(--gc-text);
}

.diff-file-head:hover {
  background: var(--el-fill-color);
}

.diff-file.is-open .diff-file-head {
  border-bottom: 1px solid var(--el-border-color-lighter);
}

.diff-file-chevron {
  flex: none;
  width: 12px;
  color: var(--el-text-color-secondary);
}

.diff-file-path {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.diff-file-stats {
  flex: none;
  display: inline-flex;
  gap: var(--gc-gap);
  font-size: var(--gc-text);
}

.diff-file-stats .add {
  color: var(--el-color-success);
}

.diff-file-stats .del {
  color: var(--el-color-danger);
}

.diff-file-hint {
  flex: none;
  color: var(--el-text-color-secondary);
  font-size: var(--gc-text);
}

.diff-file-head :deep(.d2h-tag) {
  margin-left: 0;
  flex: none;
}

.diff-file-body :deep(.d2h-file-wrapper) {
  margin: 0;
  border: 0;
  border-radius: 0;
}

.diff-file-body :deep(.d2h-file-header),
.diff-file-body :deep(.d2h-file-collapse) {
  display: none;
}

.diff-html :deep(.d2h-wrapper) {
  display: block;
}
</style>
