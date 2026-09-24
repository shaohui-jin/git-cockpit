<script setup lang="ts">
import { computed, onUnmounted, reactive, ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import * as api from '@/api/client';
import type { MrTemplateField, PrepareMrResult } from '@/api/types';
import { copyToClipboard } from '@/utils/clipboard';

const props = defineProps<{
  modelValue: boolean;
  repoId: number | null;
  into: string;
  from: string;
  sourceBranch?: string;
}>();

const emit = defineEmits<{
  'update:modelValue': [boolean];
  submit: [payload: Record<string, unknown>];
}>();

const loading = ref(false);
const previewing = ref(false);
const error = ref('');
const prepare = ref<PrepareMrResult | null>(null);
const title = ref('');
const body = ref('');
const reviewers = ref<string[]>([]);
const values = reactive<Record<string, unknown>>({});
const previewMd = ref('');
let previewTimer: ReturnType<typeof setTimeout> | undefined;

const visible = computed({
  get: () => props.modelValue,
  set: (v: boolean) => emit('update:modelValue', v)
});

const template = computed(() => prepare.value?.template ?? null);
const fields = computed(() => template.value?.fields ?? []);
const fillable = computed(() => fields.value.filter((f) => f.type !== 'markdown'));
const enabled = computed(() => Boolean(template.value?.enabled && fillable.value.length));

const missingRequired = computed(() => {
  if (!enabled.value) return [];
  return fillable.value.filter((f) => {
    if (!f.required && f.type !== 'checkboxes') return false;
    if (f.type === 'checkboxes') {
      const picked = checkedVal(f.id);
      return f.items?.some((it) => it.required && !picked.includes(it.id)) ?? false;
    }
    return strVal(f.id).trim() === '';
  });
});

const canSubmit = computed(() => Boolean(prepare.value && title.value.trim() && missingRequired.value.length === 0));
const browserMethod = computed(() => prepare.value?.method === 'browser');
const browserTemplateHint = computed(() => Boolean(enabled.value && browserMethod.value));

async function copyPreview(): Promise<void> {
  const text = previewMd.value.trim();
  if (!text) {
    ElMessage.warning('没有可复制的正文');
    return;
  }
  const ok = await copyToClipboard(text);
  ElMessage[ok ? 'success' : 'error'](ok ? '已复制正文' : '复制失败，请手动选择预览区');
}

function strVal(id: string): string {
  const v = values[id];
  return typeof v === 'string' ? v : '';
}

function checkedVal(id: string): string[] {
  return Array.isArray(values[id]) ? (values[id] as string[]) : [];
}

function fieldHint(field: MrTemplateField): string {
  if (field.type === 'checkboxes' && field.items?.some((it) => it.required)) {
    return field.help ? `${field.help}（带 * 的项必须勾选）` : '带 * 的项必须勾选';
  }
  return field.help || '';
}

function initValues(next: MrTemplateField[]): void {
  for (const key of Object.keys(values)) delete values[key];
  for (const field of next) {
    if (field.type === 'markdown') continue;
    values[field.id] = field.type === 'checkboxes' ? [] : '';
  }
}

function schedulePreview(): void {
  if (previewTimer) clearTimeout(previewTimer);
  previewTimer = setTimeout(() => void refreshPreview(), 400);
}

async function refreshPreview(): Promise<void> {
  if (!enabled.value || !template.value) {
    previewMd.value = body.value;
    return;
  }
  previewing.value = true;
  try {
    const result = await api.previewMrTemplate(
      {
        enabled: true,
        agentFill: template.value.agentFill,
        filename: '',
        sourceMd: '',
        fields: template.value.fields
      },
      { ...values }
    );
    previewMd.value = result.preview;
  } catch (e) {
    previewMd.value = e instanceof Error ? e.message : String(e);
  } finally {
    previewing.value = false;
  }
}

async function loadPrepare(): Promise<void> {
  if (props.repoId == null) {
    error.value = '请先选择仓库';
    return;
  }
  loading.value = true;
  error.value = '';
  prepare.value = null;
  previewMd.value = '';
  try {
    const result = await api.mrPrepare(props.repoId, {
      into: props.into,
      from: props.from,
      sourceBranch: props.sourceBranch || undefined
    });
    prepare.value = result;
    title.value = result.title;
    body.value = '';
    reviewers.value = [];
    initValues(result.template?.fields ?? []);
    await refreshPreview();
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    loading.value = false;
  }
}

function submit(): void {
  if (!canSubmit.value) return;
  const payload: Record<string, unknown> = {
    into: props.into,
    from: props.from,
    title: title.value.trim()
  };
  if (props.sourceBranch) payload.sourceBranch = props.sourceBranch;
  if (reviewers.value.length) payload.reviewers = reviewers.value;
  if (enabled.value) payload.fields = { ...values };
  else if (body.value.trim()) payload.body = body.value;
  emit('submit', payload);
  visible.value = false;
}

watch(
  () => [props.modelValue, props.repoId, props.into, props.from, props.sourceBranch] as const,
  ([open]) => {
    if (open) void loadPrepare();
  }
);

watch(values, () => schedulePreview(), { deep: true });
watch(body, () => schedulePreview());

onUnmounted(() => {
  if (previewTimer) clearTimeout(previewTimer);
});
</script>

<template>
  <el-dialog v-model="visible" width="920px" class="mr-create-dialog" destroy-on-close append-to-body>
    <template #header>
      <div class="dlg-head">
        <p class="gc-eyebrow">申请 MR</p>
        <span>创建 PR / MR</span>
      </div>
    </template>
    <el-alert v-if="error" type="error" :closable="false" :title="error" class="mb" />
    <el-skeleton v-if="loading" :rows="6" animated />
    <template v-else-if="prepare">
      <p class="pair">{{ into }} ← {{ from }}</p>
      <el-alert v-if="prepare.cliError" type="warning" :closable="false" :title="prepare.cliError" class="mb" />
      <el-alert
        v-if="prepare.cliInstallUrl && !prepare.cli"
        type="info"
        :closable="false"
        class="mb"
        :title="`未检测到本机 CLI，可安装 ${prepare.cliInstallUrl}`"
      />
      <el-alert
        v-if="browserTemplateHint"
        type="warning"
        :closable="false"
        class="mb"
        title="当前仓开单方式是浏览器页。平台创建页不会写入这段正文，请复制预览后粘贴；或到设置 → MR 配置改用 Token / 本机 CLI。"
      />
      <div class="split">
        <div class="pane form">
          <el-form label-position="top">
            <el-form-item label="标题" required>
              <el-input v-model="title" />
            </el-form-item>
            <template v-if="enabled">
              <template v-for="field in fields" :key="field.id">
                <div v-if="field.type === 'markdown'" class="md-block">
                  <pre>{{ field.content || '（空说明）' }}</pre>
                </div>
                <el-form-item
                  v-else
                  :required="field.required || (field.type === 'checkboxes' && field.items?.some((it) => it.required))"
                >
                  <template #label>
                    <span class="gc-field-label">
                      {{ field.label }}
                      <el-tooltip
                        v-if="fieldHint(field)"
                        :content="fieldHint(field)"
                        placement="top"
                        :show-after="300"
                        popper-class="gc-help-tip"
                      >
                        <span class="gc-field-help" tabindex="0">?</span>
                      </el-tooltip>
                    </span>
                  </template>
                  <el-input
                    v-if="field.type === 'textarea'"
                    :model-value="strVal(field.id)"
                    type="textarea"
                    :rows="4"
                    :placeholder="field.placeholder"
                    @update:model-value="values[field.id] = $event"
                  />
                  <el-select
                    v-else-if="field.type === 'select'"
                    :model-value="strVal(field.id) || undefined"
                    clearable
                    :placeholder="field.placeholder || '选择一项'"
                    @update:model-value="values[field.id] = $event ?? ''"
                  >
                    <el-option v-for="opt in field.options ?? []" :key="opt" :label="opt" :value="opt" />
                  </el-select>
                  <el-checkbox-group
                    v-else-if="field.type === 'checkboxes'"
                    class="gc-check-col"
                    :model-value="checkedVal(field.id)"
                    @update:model-value="values[field.id] = $event"
                  >
                    <el-checkbox v-for="item in field.items ?? []" :key="item.id" :value="item.id">
                      {{ item.label }}<span v-if="item.required" class="req"> *</span>
                    </el-checkbox>
                  </el-checkbox-group>
                </el-form-item>
              </template>
            </template>
            <el-form-item v-else label="正文（可选）">
              <el-input v-model="body" type="textarea" :rows="8" placeholder="未启用正文规范时，可直接写正文" />
            </el-form-item>
            <el-form-item label="审核人">
              <el-select
                v-model="reviewers"
                multiple
                filterable
                allow-create
                default-first-option
                placeholder="可选，回车添加用户名"
              >
                <el-option
                  v-for="c in prepare.candidates"
                  :key="c.username"
                  :label="c.name ? `${c.name} (${c.username})` : c.username"
                  :value="c.username"
                />
              </el-select>
            </el-form-item>
          </el-form>
        </div>
        <div class="pane preview gc-glass">
          <header>
            <strong>预览</strong>
            <span class="preview-actions">
              <span v-if="previewing" class="muted">刷新中…</span>
              <el-button size="small" :disabled="!previewMd.trim()" @click="copyPreview">复制正文</el-button>
            </span>
          </header>
          <pre>{{ previewMd || '（空）' }}</pre>
        </div>
      </div>
    </template>
    <template #footer>
      <span v-if="missingRequired.length" class="missing"
        >还缺：{{ missingRequired.map((f) => f.label).join('、') }}</span
      >
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" :disabled="!canSubmit" @click="submit">{{
        browserMethod ? '打开创建页' : '创建'
      }}</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.dlg-head .gc-eyebrow {
  margin: 0 0 4px;
}
.mb {
  margin-bottom: var(--gc-gap);
}
.pair {
  margin: 0 0 var(--gc-gap);
  color: var(--el-text-color-secondary);
  font-family: ui-monospace, monospace;
}
.split {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(240px, 0.9fr);
  gap: var(--gc-pad);
}
.pane {
  min-width: 0;
}
.req {
  color: var(--el-color-danger);
}
.md-block {
  margin-bottom: var(--gc-gap);
  padding: var(--gc-gap) var(--gc-pad);
  border-radius: var(--gc-radius);
  background: var(--el-fill-color-light);
}
.md-block pre {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  font-size: var(--gc-text);
  line-height: 1.5;
  color: var(--el-text-color-regular);
}
.preview {
  padding: var(--gc-gap) var(--gc-pad);
  display: flex;
  flex-direction: column;
  min-height: 0;
  position: sticky;
  top: 0;
  max-height: calc(100vh - 160px);
}
.preview header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--gc-gap);
}
.preview-actions {
  display: flex;
  align-items: center;
  gap: var(--gc-gap);
}
.preview pre {
  margin: 0;
  flex: 1;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
  font-size: var(--gc-text);
  line-height: 1.5;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
.muted {
  font-size: var(--gc-text);
  color: var(--el-text-color-secondary);
}
.missing {
  float: left;
  line-height: var(--gc-control);
  font-size: var(--gc-text);
  color: var(--el-color-danger);
}
@media (max-width: 800px) {
  .split {
    grid-template-columns: 1fr;
  }
}
</style>
