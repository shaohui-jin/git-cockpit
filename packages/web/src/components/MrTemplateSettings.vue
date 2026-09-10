<script setup lang="ts">
import { computed, ref, toRaw, watch } from 'vue';
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

const typeOptions: Array<{ value: MrTemplateFieldType; label: string }> = [
  { value: 'textarea', label: '多行文本' },
  { value: 'select', label: '单选' },
  { value: 'checkboxes', label: '勾选' },
  { value: 'markdown', label: '说明（不填）' }
];

const saved = computed(() => settings.mr?.template ?? null);
const hasFillable = computed(() => draft.value.fields.some((f) => f.type !== 'markdown'));
const dirty = computed(() => JSON.stringify(plainTemplate(draft.value)) !== JSON.stringify(plainTemplate(saved.value)));

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
  preview.value = '';
}

watch(
  saved,
  () => {
    const blank = draft.value.fields.length === 0 && !draft.value.sourceMd && !draft.value.filename;
    if (!dirty.value || blank) syncFromSaved();
  },
  { immediate: true }
);

async function refreshPreview(): Promise<void> {
  if (draft.value.fields.length === 0) {
    preview.value = '';
    return;
  }
  previewing.value = true;
  try {
    const res = await api.previewMrTemplate(draft.value);
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
    label: `字段 ${n}`,
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

function typeLabel(t: MrTemplateFieldType): string {
  return typeOptions.find((o) => o.value === t)?.label ?? t;
}
</script>

<template>
  <el-card shadow="never" class="mb tmpl-card">
    <template #header>
      <div class="card-head">
        <span>MR 正文规范</span>
        <el-tag v-if="saved?.enabled" size="small" type="success" effect="plain">已启用</el-tag>
        <el-tag v-else-if="saved?.fields.length" size="small" effect="plain">已导入未启用</el-tag>
        <el-tag v-else size="small" effect="plain">未导入</el-tag>
      </div>
    </template>

    <p class="mr-hint">
      导入团队的 MR Markdown，转成填写模块。表格和引用默认当说明，不进表单。保存后 Web 与 MCP 共用这一份；开单时按字段校验下一期再接。
    </p>

    <div class="tmpl-toolbar">
      <el-form-item label="启用规范" class="tmpl-switch">
        <el-switch v-model="draft.enabled" :disabled="!hasFillable" />
      </el-form-item>
      <el-form-item label="MCP 填写" class="tmpl-fill">
        <el-radio-group v-model="draft.agentFill" :disabled="!hasFillable">
          <el-radio value="allow">允许 AI 按字段填写</el-radio>
          <el-radio value="forbid">须人工填写</el-radio>
        </el-radio-group>
      </el-form-item>
    </div>

    <div class="tmpl-actions">
      <el-button :loading="parsing" @click="fileInput?.click()">导入 Markdown</el-button>
      <el-button @click="pasteOpen = !pasteOpen">粘贴导入</el-button>
      <el-button :disabled="draft.fields.length === 0" :loading="previewing" @click="refreshPreview">
        刷新预览
      </el-button>
      <span v-if="draft.filename" class="mono muted">{{ draft.filename }}</span>
      <input
        ref="fileInput"
        type="file"
        accept=".md,.markdown,text/markdown,text/plain"
        class="file-hidden"
        @change="onPickFile"
      />
    </div>

    <el-input
      v-if="pasteOpen"
      v-model="pasteText"
      type="textarea"
      :rows="8"
      class="tmpl-paste"
      placeholder="粘贴 MR 模板 Markdown"
    />
    <div v-if="pasteOpen" class="tmpl-actions">
      <el-button type="primary" :loading="parsing" @click="importPaste">识别粘贴内容</el-button>
    </div>

    <div v-if="draft.fields.length === 0" class="mr-hint">还没有字段。先导入一份 .md，例如团队的 Default.md。</div>

    <div v-for="(field, index) in draft.fields" :key="field.id + index" class="tmpl-field">
      <div class="tmpl-field-head">
        <el-tag size="small" effect="plain">{{ typeLabel(field.type) }}</el-tag>
        <span class="mono muted">{{ field.id }}</span>
        <el-button link type="danger" @click="removeField(index)">删除</el-button>
      </div>
      <el-form label-width="72px" label-position="left" class="tmpl-form" @submit.prevent>
        <el-form-item label="标题">
          <el-input v-model="field.label" />
        </el-form-item>
        <el-form-item label="类型">
          <el-select :model-value="field.type" @change="(v: MrTemplateFieldType) => onTypeChange(field, v)">
            <el-option v-for="opt in typeOptions" :key="opt.value" :label="opt.label" :value="opt.value" />
          </el-select>
        </el-form-item>
        <el-form-item v-if="field.type !== 'markdown'" label="必填">
          <el-switch v-model="field.required" />
        </el-form-item>
        <el-form-item v-if="field.type !== 'markdown'" label="说明">
          <el-input v-model="field.help" type="textarea" :rows="2" placeholder="导入时从注释带出，开单时给填写人看" />
        </el-form-item>
        <el-form-item v-if="field.type === 'textarea'" label="占位">
          <el-input v-model="field.placeholder" />
        </el-form-item>
        <el-form-item v-if="field.type === 'select'" label="选项">
          <div class="tmpl-list">
            <div v-for="(_opt, oi) in field.options" :key="oi" class="tmpl-list-row">
              <el-input v-model="field.options![oi]" />
              <el-button link @click="removeOption(field, oi)">删</el-button>
            </div>
            <el-button link type="primary" @click="addOption(field)">添加选项</el-button>
          </div>
        </el-form-item>
        <el-form-item v-if="field.type === 'checkboxes'" label="条目">
          <div class="tmpl-list">
            <div v-for="(item, ii) in field.items" :key="item.id" class="tmpl-list-row">
              <el-input v-model="item.label" />
              <el-checkbox v-model="item.required">必勾</el-checkbox>
              <el-button link @click="removeItem(field, ii)">删</el-button>
            </div>
            <el-button link type="primary" @click="addItem(field)">添加条目</el-button>
          </div>
        </el-form-item>
        <el-form-item v-if="field.type === 'markdown'" label="正文">
          <el-input v-model="field.content" type="textarea" :rows="5" />
        </el-form-item>
      </el-form>
    </div>

    <div v-if="draft.fields.length > 0" class="tmpl-actions">
      <el-button @click="addField">添加字段</el-button>
    </div>

    <div v-if="preview" class="tmpl-preview">
      <div class="tmpl-preview-label">渲染预览</div>
      <pre class="tmpl-preview-body">{{ preview }}</pre>
    </div>

    <div class="tmpl-actions">
      <el-button type="primary" :loading="settings.saving" :disabled="!dirty" @click="save">保存规范</el-button>
      <el-button :disabled="!dirty" @click="syncFromSaved">放弃修改</el-button>
      <el-button :disabled="!saved" @click="clearTemplate">清除</el-button>
    </div>
  </el-card>
</template>

<style scoped>
.card-head {
  display: flex;
  align-items: center;
  gap: var(--gc-gap);
}
.mr-hint {
  margin: 0 0 var(--gc-gap);
  font-size: var(--gc-text);
  line-height: 1.5;
  color: var(--el-text-color-secondary);
}
.muted {
  color: var(--el-text-color-secondary);
}
.tmpl-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: var(--gc-gap) 24px;
  margin-bottom: var(--gc-gap);
}
.tmpl-switch,
.tmpl-fill {
  margin-bottom: 0;
}
.tmpl-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--gc-gap);
  margin: var(--gc-gap) 0;
}
.file-hidden {
  display: none;
}
.tmpl-paste {
  margin-top: var(--gc-gap);
}
.tmpl-field {
  border-top: 1px solid var(--el-border-color-lighter);
  padding: var(--gc-gap) 0;
}
.tmpl-field-head {
  display: flex;
  align-items: center;
  gap: var(--gc-gap);
  min-height: var(--gc-line);
  margin-bottom: var(--gc-gap);
}
.tmpl-form {
  max-width: 640px;
}
.tmpl-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 100%;
}
.tmpl-list-row {
  display: flex;
  align-items: center;
  gap: var(--gc-gap);
}
.tmpl-preview-label {
  font-size: var(--gc-text);
  color: var(--el-text-color-secondary);
  margin-bottom: 6px;
}
.tmpl-preview-body {
  margin: 0;
  padding: var(--gc-pad);
  font-size: var(--gc-text);
  line-height: 1.5;
  white-space: pre-wrap;
  background: var(--el-fill-color-lighter);
  color: var(--el-text-color-regular);
}
</style>
