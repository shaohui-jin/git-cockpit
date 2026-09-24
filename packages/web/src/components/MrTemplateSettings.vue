<script setup lang="ts">
import { computed, onUnmounted, ref, toRaw, watch } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import * as api from '@/api/client';
import { useSettingsStore } from '@/stores/settings';
import type { MrTemplate, MrTemplateField, MrTemplateFieldType } from '@/api/types';

const settings = useSettingsStore();
const fileInput = ref<HTMLInputElement | null>(null);
const pasteOpen = ref(false);
const pasteText = ref('');
const parsing = ref(false);
const previewing = ref(false);
const preview = ref('');
const draft = ref<MrTemplate>(emptyDraft());
let previewTimer: ReturnType<typeof setTimeout> | null = null;

const typeOptions: Array<{ value: MrTemplateFieldType; label: string }> = [
  { value: 'textarea', label: '多行文本' },
  { value: 'select', label: '单选' },
  { value: 'checkboxes', label: '勾选' },
  { value: 'markdown', label: '说明（不填）' }
];

const saved = computed(() => settings.mr?.template ?? null);
const hasFillable = computed(() => draft.value.fields.some((f) => f.type !== 'markdown'));
const dirty = computed(() => JSON.stringify(plainTemplate(draft.value)) !== JSON.stringify(plainTemplate(saved.value)));
const draftKey = computed(() => JSON.stringify(plainTemplate(draft.value)));

function emptyDraft(): MrTemplate {
  return { enabled: false, agentFill: 'allow', filename: '', sourceMd: '', fields: [] };
}

function plainTemplate(t: MrTemplate | null | undefined): MrTemplate {
  if (!t) return emptyDraft();
  return JSON.parse(JSON.stringify(toRaw(t))) as MrTemplate;
}

function normalizeDraft(t: MrTemplate | null): MrTemplate {
  return plainTemplate(t);
}

function syncFromSaved(): void {
  draft.value = normalizeDraft(saved.value);
}

watch(
  saved,
  () => {
    const blank = draft.value.fields.length === 0 && !draft.value.sourceMd && !draft.value.filename;
    if (!dirty.value || blank) syncFromSaved();
  },
  { immediate: true }
);

watch(draftKey, () => {
  if (previewTimer) clearTimeout(previewTimer);
  previewTimer = setTimeout(() => void refreshPreview(), 400);
});

onUnmounted(() => {
  if (previewTimer) clearTimeout(previewTimer);
});

async function refreshPreview(): Promise<void> {
  if (draft.value.fields.length === 0) {
    preview.value = '';
    return;
  }
  previewing.value = true;
  try {
    const res = await api.previewMrTemplate(plainTemplate(draft.value));
    preview.value = res.preview;
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : String(err));
  } finally {
    previewing.value = false;
  }
}

async function applyParsed(template: MrTemplate, nextPreview: string): Promise<void> {
  draft.value = {
    ...template,
    enabled: template.fields.some((f) => f.type !== 'markdown'),
    agentFill: draft.value.agentFill || template.agentFill
  };
  preview.value = nextPreview;
}

async function onPickFile(ev: Event): Promise<void> {
  const input = ev.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  const markdown = await file.text();
  await importMarkdown(markdown, file.name);
}

async function importPaste(): Promise<void> {
  if (!pasteText.value.trim()) {
    ElMessage.warning('请粘贴 Markdown');
    return;
  }
  await importMarkdown(pasteText.value, 'pasted.md');
}

async function importMarkdown(markdown: string, filename: string): Promise<void> {
  parsing.value = true;
  try {
    const res = await api.parseMrTemplate(markdown, filename);
    await applyParsed(res.template, res.preview);
    pasteOpen.value = false;
    ElMessage.success(`已识别 ${res.template.fields.length} 个模块，请校对后保存`);
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : String(err));
  } finally {
    parsing.value = false;
  }
}

function onTypeChange(field: MrTemplateField, next: MrTemplateFieldType): void {
  field.type = next;
  field.required = next !== 'markdown' && (next === 'textarea' || next === 'select');
  if (next === 'select' && (!field.options || field.options.length < 2)) {
    field.options = ['低', '中', '高'];
  }
  if (next === 'checkboxes' && (!field.items || field.items.length === 0)) {
    field.items = [{ id: `${field.id}_1`, label: '（请填写）', required: false }];
  }
  if (next === 'markdown' && field.content == null) field.content = '';
}

function addOption(field: MrTemplateField): void {
  field.options = [...(field.options ?? []), ''];
}

function removeOption(field: MrTemplateField, index: number): void {
  field.options = (field.options ?? []).filter((_, i) => i !== index);
}

function addItem(field: MrTemplateField): void {
  const items = field.items ?? [];
  field.items = [...items, { id: `${field.id}_${items.length + 1}`, label: '', required: false }];
}

function removeItem(field: MrTemplateField, index: number): void {
  field.items = (field.items ?? []).filter((_, i) => i !== index);
}

function removeField(index: number): void {
  draft.value.fields.splice(index, 1);
  if (!hasFillable.value) draft.value.enabled = false;
}

function addField(): void {
  const n = draft.value.fields.length + 1;
  draft.value.fields.push({
    id: `custom_${n}`,
    type: 'textarea',
    label: '',
    required: true,
    placeholder: '（请填写）'
  });
}

async function save(): Promise<void> {
  if (draft.value.enabled && !hasFillable.value) {
    ElMessage.warning('没有可填写字段时不能启用规范');
    return;
  }
  try {
    await settings.save({ mr: { template: plainTemplate(draft.value) } });
    syncFromSaved();
    ElMessage.success('MR 正文规范已保存');
    await refreshPreview();
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : String(err));
  }
}

async function clearTemplate(): Promise<void> {
  try {
    await ElMessageBox.confirm('清除已保存的正文规范？未启用时开单行为与现在相同。', '清除模板', {
      confirmButtonText: '清除',
      cancelButtonText: '取消',
      type: 'warning'
    });
  } catch {
    return;
  }
  try {
    await settings.save({ mr: { template: emptyDraft() } });
    syncFromSaved();
    ElMessage.success('已清除');
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : String(err));
  }
}
</script>

<template>
  <div class="tmpl">
    <header class="tmpl-head">
      <div class="tmpl-head-row">
        <el-tag v-if="saved?.enabled" size="small" type="success" effect="plain">已启用</el-tag>
        <el-tag v-else-if="saved?.fields.length" size="small" effect="plain">已导入未启用</el-tag>
        <el-tag v-else size="small" effect="plain">未导入</el-tag>
        <el-switch v-model="draft.enabled" :disabled="!hasFillable" />
        <span class="tmpl-label">启用规范</span>
        <el-radio-group v-model="draft.agentFill" :disabled="!hasFillable" class="tmpl-fill">
          <el-radio value="allow">允许 AI 填写</el-radio>
          <el-radio value="forbid">须人工填写</el-radio>
        </el-radio-group>
        <span v-if="draft.filename" class="mono muted tmpl-file">{{ draft.filename }}</span>
      </div>
      <div class="tmpl-head-row">
        <el-button :loading="parsing" @click="fileInput?.click()">导入 Markdown</el-button>
        <el-button @click="pasteOpen = !pasteOpen">粘贴导入</el-button>
        <el-button type="primary" :loading="settings.saving" :disabled="!dirty" @click="save">保存规范</el-button>
        <el-button :disabled="!dirty" @click="syncFromSaved">放弃修改</el-button>
        <el-button :disabled="!saved" @click="clearTemplate">清除</el-button>
        <input
          ref="fileInput"
          type="file"
          accept=".md,.markdown,text/markdown,text/plain"
          class="file-hidden"
          @change="onPickFile"
        />
      </div>
    </header>

    <div v-if="pasteOpen" class="tmpl-paste-bar">
      <el-input
        class="gc-grow-input"
        v-model="pasteText"
        type="textarea"
        :rows="4"
        placeholder="粘贴 MR 模板 Markdown"
      />
      <el-button type="primary" :loading="parsing" @click="importPaste">识别</el-button>
    </div>

    <div class="tmpl-split">
      <section class="pane">
        <div class="pane-head">
          <span>结构</span>
          <el-button link type="primary" @click="addField">添加</el-button>
        </div>
        <div class="pane-body">
          <p v-if="draft.fields.length === 0" class="muted">还没有章节。导入一份 .md，或点右上角添加。</p>
          <article v-for="(field, index) in draft.fields" :key="field.id + index" class="tmpl-field">
            <div class="tmpl-field-head">
              <el-select
                :model-value="field.type"
                class="tmpl-type"
                @change="(v: MrTemplateFieldType) => onTypeChange(field, v)"
              >
                <el-option v-for="opt in typeOptions" :key="opt.value" :label="opt.label" :value="opt.value" />
              </el-select>
              <el-input v-model="field.label" class="tmpl-title" placeholder="标题" />
              <el-checkbox v-if="field.type !== 'markdown'" v-model="field.required">必填</el-checkbox>
              <span class="mono muted tmpl-id">{{ field.id }}</span>
              <el-button link type="danger" @click="removeField(index)">删除</el-button>
            </div>
            <el-input
              v-if="field.type !== 'markdown'"
              v-model="field.help"
              type="textarea"
              :rows="2"
              placeholder="说明（开单时给填写人看）"
            />
            <el-input v-if="field.type === 'textarea'" v-model="field.placeholder" placeholder="占位" />
            <div v-if="field.type === 'select'" class="tmpl-list">
              <div v-for="(_opt, oi) in field.options" :key="oi" class="tmpl-list-row">
                <el-input v-model="field.options![oi]" placeholder="选项" />
                <el-button link @click="removeOption(field, oi)">删</el-button>
              </div>
              <el-button link type="primary" @click="addOption(field)">添加选项</el-button>
            </div>
            <div v-if="field.type === 'checkboxes'" class="tmpl-list">
              <div v-for="(item, ii) in field.items" :key="item.id" class="tmpl-list-row">
                <el-input v-model="item.label" placeholder="条目" />
                <el-checkbox v-model="item.required">必勾</el-checkbox>
                <el-button link @click="removeItem(field, ii)">删</el-button>
              </div>
              <el-button link type="primary" @click="addItem(field)">添加条目</el-button>
            </div>
            <el-input
              v-if="field.type === 'markdown'"
              v-model="field.content"
              type="textarea"
              :rows="6"
              placeholder="说明正文"
            />
          </article>
        </div>
      </section>

      <section class="pane">
        <div class="pane-head">
          <span>预览</span>
          <el-button
            link
            type="primary"
            :disabled="draft.fields.length === 0"
            :loading="previewing"
            @click="refreshPreview"
          >
            刷新
          </el-button>
        </div>
        <pre v-if="preview" class="pane-body preview-body">{{ preview }}</pre>
        <p v-else class="pane-body muted">导入或修改字段后，这里显示渲染出的 MR 正文。</p>
      </section>
    </div>
  </div>
</template>

<style scoped>
.tmpl {
  flex: 1;
  min-height: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: var(--gc-gap);
}
.tmpl-head {
  flex: none;
  display: flex;
  flex-direction: column;
  gap: var(--gc-gap);
}
.tmpl-head-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--gc-gap);
  min-height: var(--gc-line);
}
.tmpl-label {
  font-size: var(--gc-text);
  color: var(--el-text-color-regular);
}
.tmpl-fill {
  margin-left: 8px;
}
.tmpl-file {
  margin-left: auto;
}
.muted {
  margin: 0;
  font-size: var(--gc-text);
  color: var(--el-text-color-secondary);
}
.file-hidden {
  display: none;
}
.tmpl-paste-bar {
  flex: none;
  display: flex;
  align-items: flex-start;
  gap: var(--gc-gap);
}
.tmpl-split {
  flex: 1;
  min-height: 0;
  display: flex;
  gap: var(--gc-gap);
}
.pane {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: var(--gc-radius);
  background: var(--el-bg-color);
}
.pane-head {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--gc-gap);
  min-height: var(--gc-line);
  padding: 0 var(--gc-pad);
  border-bottom: 1px solid var(--el-border-color-lighter);
  font-size: var(--gc-text);
}
.pane-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: var(--gc-pad);
}
.preview-body {
  margin: 0;
  font-size: var(--gc-text);
  line-height: 1.5;
  white-space: pre-wrap;
  color: var(--el-text-color-regular);
}
.tmpl-field {
  padding-bottom: var(--gc-pad);
  margin-bottom: var(--gc-pad);
  border-bottom: 1px solid var(--el-border-color-lighter);
  display: flex;
  flex-direction: column;
  gap: var(--gc-gap);
}
.tmpl-field:last-child {
  margin-bottom: 0;
  padding-bottom: 0;
  border-bottom: none;
}
.tmpl-field-head {
  display: flex;
  align-items: center;
  gap: var(--gc-gap);
  min-height: var(--gc-line);
}
.tmpl-type {
  width: 120px;
  flex: none;
}
.tmpl-title {
  flex: 1;
  min-width: 0;
}
.tmpl-id {
  flex: none;
}
.tmpl-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.tmpl-list-row {
  display: flex;
  align-items: center;
  gap: var(--gc-gap);
}
</style>
