<script setup lang="ts">
import { ref, watch } from 'vue';
import { parse } from 'diff2html';
import type { DiffBlock, DiffFile, DiffLine } from 'diff2html/lib-esm/types';

const props = defineProps<{
  patch: string;
}>();

/** 变更行达到该数则默认收起；lock 文件无论行数都收起 */
const COLLAPSE_CHANGED_LINES = 200;
const LOCKFILE_RE = /(?:^|[/\\])(pnpm-lock\.yaml|package-lock\.json|yarn\.lock)$/i;

const files = ref<DiffFile[]>([]);
const parseFailed = ref(false);
const expanded = ref<Set<string>>(new Set());

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
  if (file.isBinary) return { label: 'BINARY', cls: 'bin' };
  if (file.isNew) return { label: 'ADDED', cls: 'add' };
  if (file.isDeleted) return { label: 'DELETED', cls: 'del' };
  if (file.isRename) return { label: 'RENAMED', cls: 'ren' };
  if (file.isCopy) return { label: 'COPIED', cls: 'ren' };
  return { label: 'CHANGED', cls: 'mod' };
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
  }
  expanded.value = next;
}

/** hunk 头拆出 @@ 范围段与函数上下文段 */
function hunkParts(header: string): { rng: string; ctx: string } {
  const m = /^(@@[^@]*@@)\s*(.*)$/.exec(header);
  if (!m) return { rng: header, ctx: '' };
  return { rng: m[1] ?? header, ctx: m[2] ?? '' };
}

/** 行类型 → 设计稿类名：add / del / ctx */
function lineCls(line: DiffLine): string {
  if (line.type === 'insert') return 'add';
  if (line.type === 'delete') return 'del';
  return 'ctx';
}

/** 行首符号：ctx 空、del −、add + */
function lineSign(line: DiffLine): string {
  if (line.type === 'insert') return '+';
  if (line.type === 'delete') return '−';
  return '';
}

/** 行号：设计稿只显示旧侧行号，新增行为空 */
function lineNumber(line: DiffLine): string {
  return line.oldNumber != null ? String(line.oldNumber) : '';
}

/** 去掉 diff 行首前缀（合并 diff 为两字符） */
function lineCode(line: DiffLine, combined: boolean): string {
  const cut = combined ? 2 : 1;
  return line.content.length > cut ? line.content.slice(cut) : '';
}

function hasBlocks(file: DiffFile): boolean {
  return !!file.blocks && file.blocks.some((b: DiffBlock) => b.lines.length > 0);
}

watch(
  () => props.patch,
  (patch) => {
    parseFailed.value = false;
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
      parsed.forEach((file, i) => {
        if (shouldCollapse(file)) return;
        next.add(fileKey(file, i));
      });
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
      <section
        v-for="(file, i) in files"
        :key="fileKey(file, i)"
        class="diff-file"
        :class="{ 'is-open': isOpen(file, i) }"
      >
        <button type="button" class="diff-file-head" @click="toggle(file, i)">
          <span class="diff-file-chevron" aria-hidden="true">{{ isOpen(file, i) ? '▾' : '▸' }}</span>
          <span class="diff-file-path mono" :title="displayPath(file)">{{ displayPath(file) }}</span>
          <span class="df-tag" :class="statusTag(file).cls">{{ statusTag(file).label }}</span>
          <span class="diff-file-stats">
            <span class="add">+{{ file.addedLines }}</span>
            <span class="del">-{{ file.deletedLines }}</span>
          </span>
          <span v-if="!isOpen(file, i) && shouldCollapse(file)" class="diff-file-hint">点击展开</span>
        </button>
        <div v-if="isOpen(file, i)" class="diff-file-body">
          <template v-for="(block, bi) in file.blocks" :key="bi">
            <div class="hunk">
              <span class="rng">{{ hunkParts(block.header).rng }}</span>
              <span v-if="hunkParts(block.header).ctx" class="hunk-ctx">{{ hunkParts(block.header).ctx }}</span>
            </div>
            <div v-for="(line, li) in block.lines" :key="li" class="dline" :class="lineCls(line)">
              <span class="ln">{{ lineNumber(line) }}</span>
              <span class="sign">{{ lineSign(line) }}</span>
              <span class="code">{{ lineCode(line, file.isCombined) }}</span>
            </div>
          </template>
          <p v-if="!hasBlocks(file)" class="diff-binary">二进制文件，无文本差异</p>
        </div>
      </section>
    </div>
    <pre
      v-else-if="parseFailed"
      class="diff-fallback mono"
    ><template v-for="(l, i) in patch.split('\n')" :key="i">{{ l }}
</template></pre>
  </div>
</template>

<style scoped>
.diff-viewer {
  font-size: var(--gc-fs-body);
}

/* ── 文件头：对齐设计稿 .file-head（28px / page 底 / 弱底线） ── */
.diff-file + .diff-file {
  margin-top: var(--gc-gap);
}

.diff-file-head {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  height: var(--gc-row);
  padding: 0 8px 0 10px;
  border: 0;
  box-sizing: border-box;
  background: var(--gc-page);
  color: var(--gc-text-2);
  cursor: pointer;
  text-align: left;
  font: inherit;
  font-size: var(--gc-fs-meta);
}

.diff-file-head:hover {
  background: var(--gc-btn-hover);
}

.diff-file.is-open .diff-file-head {
  border-bottom: 1px solid var(--gc-line-weak);
}

.diff-file-chevron {
  flex: none;
  width: 12px;
  color: var(--gc-text-3);
}

.diff-file-path {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--gc-text);
}

.diff-file-stats {
  flex: none;
  display: inline-flex;
  gap: var(--gc-gap);
  font-variant-numeric: tabular-nums;
}

.diff-file-stats .add {
  color: var(--gc-green);
}

.diff-file-stats .del {
  color: var(--gc-red);
}

.diff-file-hint {
  flex: none;
  color: var(--gc-text-3);
}

/* 文件状态标签：对齐设计稿 chip 形态 */
.df-tag {
  flex: none;
  display: inline-flex;
  align-items: center;
  height: var(--gc-lh-row);
  padding: 0 6px;
  border-radius: var(--gc-r-tag);
  font-size: var(--gc-fs-micro);
  letter-spacing: var(--gc-track-micro);
  text-transform: uppercase;
}

.df-tag.add {
  color: var(--gc-green);
  background: var(--gc-green-weak);
}

.df-tag.del {
  color: var(--gc-red);
  background: var(--gc-red-weak);
}

.df-tag.mod {
  color: var(--gc-amber);
  background: var(--gc-amber-weak);
}

.df-tag.ren {
  color: var(--gc-purple);
  background: var(--gc-purple-weak);
}

.df-tag.bin {
  color: var(--gc-text-3);
  background: var(--gc-card);
}

/* ── 差异主体：1:1 对齐设计稿 .diff-body / .hunk / .dline ── */
.diff-file-body {
  font-family: var(--gc-font-mono);
  font-size: var(--gc-fs-meta);
  line-height: var(--gc-lh-row);
}

.hunk {
  display: flex;
  align-items: center;
  gap: var(--gc-s2);
  height: var(--gc-lh-row);
  padding: 0 var(--gc-s2);
  background: var(--gc-card);
  color: var(--gc-text-3);
  border-top: 1px solid var(--gc-line-weak);
  border-bottom: 1px solid var(--gc-line-weak);
}

.hunk .rng {
  flex: none;
  color: var(--gc-purple);
}

.hunk .hunk-ctx {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dline {
  display: flex;
  align-items: stretch;
  min-height: var(--gc-lh-row);
}

.dline .ln {
  flex: none;
  width: 28px;
  text-align: right;
  padding-right: 6px;
  color: var(--gc-text-3);
  font-variant-numeric: tabular-nums;
  user-select: none;
  border-right: 1px solid var(--gc-line-weak);
}

.dline .sign {
  flex: none;
  width: 14px;
  text-align: center;
  color: var(--gc-text-3);
  user-select: none;
}

.dline .code {
  flex: 1;
  min-width: 0;
  padding-right: 10px;
  white-space: pre;
  overflow-x: hidden;
  color: var(--gc-text-2);
}

.dline.add {
  background: var(--gc-green-weak);
  box-shadow: inset 2px 0 0 var(--gc-green-strong);
}

.dline.add .sign,
.dline.add .code {
  color: var(--gc-green);
}

.dline.del {
  background: var(--gc-red-weak);
  box-shadow: inset 2px 0 0 var(--gc-red-strong);
}

.dline.del .sign,
.dline.del .code {
  color: var(--gc-red);
}

.dline.ctx .code {
  color: var(--gc-text-3);
}

.diff-binary {
  margin: 0;
  padding: var(--gc-s2);
  font-family: var(--gc-font-ui);
  color: var(--gc-text-3);
}
</style>
