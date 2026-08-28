<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import { useSettingsStore } from '@/stores/settings';
import type { ToolSummary } from '@/api/types';

const settings = useSettingsStore();

interface Draft {
  disabledTools: string[];
  requireApprovalFor: string[];
  dryRunDefault: boolean;
}
const draft = reactive<Draft>({
  disabledTools: [],
  requireApprovalFor: [],
  dryRunDefault: false
});
const githubTokenInput = ref('');
const clearGithubToken = ref(false);
const loaded = ref(false);
const dirty = computed(() => {
  const p = settings.permissions;
  if (!p) return false;
  const permDirty =
    JSON.stringify([...draft.disabledTools].sort()) !== JSON.stringify([...p.disabledTools].sort()) ||
    JSON.stringify([...draft.requireApprovalFor].sort()) !== JSON.stringify([...p.requireApprovalFor].sort()) ||
    draft.dryRunDefault !== p.dryRunDefault;
  return permDirty || githubTokenInput.value.trim().length > 0 || clearGithubToken.value;
});

const dangerTools = computed(() => settings.tools.filter((t) => t.riskLevel === 'dangerous'));
const dangerNames = computed(() => dangerTools.value.map((t) => t.name));

function syncDraft(): void {
  const p = settings.permissions;
  if (!p) return;
  draft.disabledTools = [...p.disabledTools];
  draft.requireApprovalFor = [...p.requireApprovalFor];
  draft.dryRunDefault = p.dryRunDefault;
  githubTokenInput.value = '';
  clearGithubToken.value = false;
  loaded.value = true;
}

watch(
  () => settings.permissions,
  (p) => {
    if (p && !dirty.value) syncDraft();
  }
);

async function toggleEnabled(t: ToolSummary, enabled: boolean): Promise<void> {
  if (enabled) {
    draft.disabledTools = draft.disabledTools.filter((n) => n !== t.name);
  } else {
    if (!draft.disabledTools.includes(t.name)) draft.disabledTools.push(t.name);
    // 工具被禁用后无法再要求审批
    draft.requireApprovalFor = draft.requireApprovalFor.filter((n) => n !== t.name);
  }
}

function riskType(r: string): 'success' | 'primary' | 'danger' {
  return r === 'readonly' ? 'success' : r === 'write' ? 'primary' : 'danger';
}
function riskLabel(r: string): string {
  return r === 'readonly' ? '只读' : r === 'write' ? '写操作' : '高风险';
}

async function save(): Promise<void> {
  try {
    const token = githubTokenInput.value.trim();
    await settings.save({
      permissions: {
        disabledTools: [...draft.disabledTools],
        requireApprovalFor: [...draft.requireApprovalFor],
        dryRunDefault: draft.dryRunDefault
      },
      ...(clearGithubToken.value
        ? { mr: { githubToken: '' } }
        : token
          ? { mr: { githubToken: token } }
          : {})
    });
    githubTokenInput.value = '';
    clearGithubToken.value = false;
    ElMessage.success('设置已保存');
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : String(err));
  }
}

onMounted(async () => {
  await settings.load();
  syncDraft();
});
</script>

<template>
  <div class="page">
    <h2 class="page-title">设置</h2>
    <el-alert v-if="settings.error" :title="settings.error" type="error" :closable="false" show-icon class="mb" />

    <el-card shadow="never" class="mb">
      <template #header>默认行为</template>
      <el-form label-width="180px" label-position="left">
        <el-form-item label="写操作默认 dry-run 预览">
          <el-switch v-model="draft.dryRunDefault" />
          <span class="form-tip">开启后所有写操作（MCP/CLI）默认只生成预览，不真正执行</span>
        </el-form-item>
      </el-form>
    </el-card>

    <el-card shadow="never" class="mb">
      <template #header>MR 配置</template>
      <el-form label-width="180px" label-position="left">
        <el-form-item label="GitHub Token">
          <div class="token-row">
            <el-input
              v-model="githubTokenInput"
              type="password"
              show-password
              autocomplete="new-password"
              placeholder="不回填已保存的 Token；留空则不改"
              style="max-width: 420px"
              :disabled="clearGithubToken"
            />
            <el-checkbox v-model="clearGithubToken" :disabled="!settings.githubTokenSet && !clearGithubToken">
              清除已保存的 Token
            </el-checkbox>
          </div>
          <div class="form-tip form-tip-block">
            {{ settings.githubTokenSet ? '已保存 Token（不会在此显示）。' : '尚未配置。' }}
            只用于 <span class="mono">git_mr_create</span> 调 GitHub REST，不进工具参数。
          </div>
        </el-form-item>
      </el-form>
    </el-card>

    <el-card shadow="never" class="mb">
      <template #header>
        <div class="card-head">
          <span>工具开关与风险等级</span>
          <el-tag size="small" type="warning" effect="plain">高危工具默认禁用，需在下方开启</el-tag>
        </div>
      </template>
      <el-table :data="settings.tools" v-loading="settings.loading" size="default">
        <el-table-column label="工具" width="230">
          <template #default="{ row }">
            <span class="mono">{{ row.name }}</span>
          </template>
        </el-table-column>
        <el-table-column label="风险" width="90">
          <template #default="{ row }">
            <el-tag :type="riskType(row.riskLevel)" size="small" effect="dark">{{ riskLabel(row.riskLevel) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="描述" min-width="240">
          <template #default="{ row }">
            <span class="desc">{{ row.description }}</span>
          </template>
        </el-table-column>
        <el-table-column label="启用" width="100" align="center">
          <template #default="{ row }">
            <el-switch
              :model-value="!draft.disabledTools.includes(row.name)"
              @change="(v: boolean | string | number) => toggleEnabled(row, v === true)"
            />
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-card shadow="never" class="mb">
      <template #header>审批规则</template>
      <el-form label-position="top">
        <el-form-item label="执行前需要审批的工具（勾选后，执行时需在确认框中手工确认）">
          <el-select
            v-model="draft.requireApprovalFor"
            multiple
            filterable
            collapse-tags
            placeholder="选择需要审批的工具"
            style="width: 100%"
          >
            <el-option
              v-for="t in dangerNames"
              :key="t"
              :label="t"
              :value="t"
              :disabled="draft.disabledTools.includes(t)"
            />
          </el-select>
          <span class="form-tip">审批仅对已启用的高危工具生效；禁用后自动移除</span>
        </el-form-item>
      </el-form>
    </el-card>

    <div class="action-bar" v-if="loaded">
      <el-button type="primary" :loading="settings.saving" :disabled="!dirty" @click="save">保存设置</el-button>
      <el-button :disabled="!dirty" @click="syncDraft">放弃修改</el-button>
    </div>
  </div>
</template>

<style scoped>
.page-title {
  margin: 0 0 var(--gc-gap);
  font-size: 14px;
}
.mb {
  margin-bottom: var(--gc-gap);
}
.form-tip {
  margin-left: var(--gc-gap);
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.form-tip-block {
  display: block;
  margin: 6px 0 0;
}
.token-row {
  display: flex;
  align-items: center;
  gap: var(--gc-gap);
  flex-wrap: wrap;
}
.card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.desc {
  font-size: 13px;
  color: var(--el-text-color-regular);
}
.action-bar {
  display: flex;
}
</style>