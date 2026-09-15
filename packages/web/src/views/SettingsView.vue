<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { useSettingsStore } from '@/stores/settings';
import MrTemplateSettings from '@/components/MrTemplateSettings.vue';
import { useReposStore } from '@/stores/repos';
import type { MrMethod, ToolSummary } from '@/api/types';

const settings = useSettingsStore();
const repos = useReposStore();
const route = useRoute();
const router = useRouter();

const GH_INSTALL_URL = 'https://cli.github.com/';
const GLAB_INSTALL_URL = 'https://gitlab.com/gitlab-org/cli/-/releases';
const GH_TOKEN_CREATE_URL = 'https://github.com/settings/tokens/new?scopes=repo&description=Git%20Cockpit';

type SettingsTab = 'git' | 'mr' | 'template' | 'llm';
const activeTab = computed<SettingsTab>({
  get: () => {
    const tab = route.query.tab;
    if (tab === 'git' || tab === 'template' || tab === 'llm') return tab;
    return 'mr';
  },
  set: (name) => {
    const query = name === 'mr' ? {} : { tab: name };
    void router.replace({ path: '/settings', query });
  }
});

interface GitDraft {
  disabledTools: string[];
  requireApprovalFor: string[];
  dryRunDefault: boolean;
  allowedReposText: string;
}
const gitDraft = reactive<GitDraft>({
  disabledTools: [],
  requireApprovalFor: [],
  dryRunDefault: false,
  allowedReposText: ''
});
const loaded = ref(false);
const method = ref<MrMethod>('browser');
const selectedRemote = ref('origin');
const tokenInput = ref('');
const llmKeyInput = ref('');
const llmModel = ref('gpt-4.1');
const llmBaseUrl = ref('');
const apiBaseUrl = ref('');
const showAdvanced = ref(false);
const validatingToken = ref(false);

const ghInstallUrl = computed(() => settings.mr?.cli.gh.installUrl || GH_INSTALL_URL);
const glabInstallUrl = computed(() => settings.mr?.cli.glab.installUrl || GLAB_INSTALL_URL);

const gitDirty = computed(() => {
  const p = settings.permissions;
  if (!p) return false;
  return (
    JSON.stringify([...gitDraft.disabledTools].sort()) !== JSON.stringify([...p.disabledTools].sort()) ||
    JSON.stringify([...gitDraft.requireApprovalFor].sort()) !== JSON.stringify([...p.requireApprovalFor].sort()) ||
    gitDraft.dryRunDefault !== p.dryRunDefault ||
    parseAllowedRepos(gitDraft.allowedReposText).join('\n') !== settings.allowedRepos.join('\n')
  );
});

const current = computed(() => settings.mr?.current ?? null);
const remotes = computed(() => settings.mr?.remotes ?? []);
const hasRepoRemotes = computed(() => remotes.value.length > 0);
const platform = computed(() => current.value?.platform ?? 'unknown');

const selectedRemoteInfo = computed(() => {
  const name = selectedRemote.value;
  return remotes.value.find((r) => r.name === name) ?? remotes.value[0] ?? null;
});
const selectedRemoteUrl = computed(() => {
  const r = selectedRemoteInfo.value;
  return (r?.pushUrl || r?.fetchUrl || current.value?.remoteUrl || '').trim();
});

const currentHostProfile = computed(() => {
  const host = current.value?.host;
  if (!host || platform.value === 'unknown') return null;
  return settings.mr?.hosts.find((h) => h.host === host) ?? null;
});

const showCurrentHostCard = computed(() => Boolean(currentHostProfile.value));

const tokenDirty = computed(() => {
  if (!current.value?.host) return tokenInput.value.trim().length > 0;
  const savedApi = currentHostProfile.value?.apiBaseUrl ?? current.value.apiBaseUrl ?? '';
  return tokenInput.value.trim().length > 0 || apiBaseUrl.value !== savedApi;
});

const showGhCli = computed(() => platform.value !== 'gitlab');
const showGlabCli = computed(() => platform.value !== 'github');

const cliReady = computed(() => {
  const cli = settings.mr?.cli;
  if (!cli) return false;
  if (platform.value === 'github') return cli.gh.loggedIn;
  if (platform.value === 'gitlab') return cli.glab.loggedIn;
  return cli.gh.loggedIn || cli.glab.loggedIn;
});
const tokenReady = computed(() => {
  if (!current.value?.tokenSet) return false;
  const s = current.value.tokenStatus;
  if (!s) return true;
  return s.ok;
});

const tokenStatusText = computed(() => {
  if (validatingToken.value) return '校验中…';
  return current.value?.tokenStatus?.titleStatus || '';
});

const tokenStatusClass = computed(() => {
  if (validatingToken.value || !current.value?.tokenStatus) return 'muted';
  return current.value.tokenStatus.ok ? 'ok' : 'bad';
});

const gitlabTokenCreateUrl = computed(() => {
  const origin = (current.value?.origin || '').replace(/\/+$/, '');
  return `${origin || 'https://gitlab.com'}/-/user_settings/personal_access_tokens`;
});

const dangerTools = computed(() => settings.tools.filter((t) => t.riskLevel === 'dangerous'));

const methodOptions = computed(() => [
  { id: 'cli' as const, title: cliCardTitle(), ready: cliReady.value },
  { id: 'token' as const, title: tokenCardTitle(), ready: tokenReady.value },
  { id: 'browser' as const, title: 'C. 仅打开浏览器创建页', ready: true }
]);

const tokenHint = computed(() => {
  if (platform.value === 'github') return '需 repo 权限。Token 不进工具参数。';
  if (platform.value === 'gitlab') return '审核人用户名会解析成数字 id。Token 不进工具参数。';
  return 'Token 不进工具参数。';
});

const tokenPlaceholder = computed(() => {
  const preview = current.value?.tokenPreview?.trim();
  if (current.value?.tokenSet && preview) return `已保存 ${preview}，输入新 Token 覆盖`;
  if (platform.value === 'github') return 'ghp_… 或 github_pat_…';
  if (platform.value === 'gitlab') return 'glpat-…';
  return '输入 Token';
});

function repoId(): number | null {
  return repos.currentId;
}

function platformLabel(p: string): string {
  if (p === 'github') return 'GitHub';
  if (p === 'gitlab') return 'GitLab';
  return '未识别';
}

function cliCardTitle(): string {
  if (platform.value === 'github') return 'A. 本机已安装的 gh';
  if (platform.value === 'gitlab') return 'A. 本机已安装的 glab';
  return 'A. 本机已安装的 gh / glab';
}

function tokenCardTitle(): string {
  const host = current.value?.host;
  if (!host) return 'B. Token（API）';
  if (platform.value === 'github') return `B. GitHub Token（${host}）`;
  if (platform.value === 'gitlab') return `B. GitLab Token（${host}）`;
  return `B. Token（${host}）`;
}

function cliStatusText(c: { found: boolean; loggedIn: boolean } | undefined): string {
  if (!c?.found) return '未下载';
  return c.loggedIn ? '已登录' : '未登录';
}

function cliTokenStatusClass(c: { tokenStatus?: { ok: boolean } | null } | undefined): string {
  if (!c?.tokenStatus) return 'muted';
  return c.tokenStatus.ok ? 'ok' : 'bad';
}

function parseAllowedRepos(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}

function syncGitDraft(): void {
  const p = settings.permissions;
  if (!p) return;
  gitDraft.disabledTools = [...p.disabledTools];
  gitDraft.requireApprovalFor = [...p.requireApprovalFor];
  gitDraft.dryRunDefault = p.dryRunDefault;
  gitDraft.allowedReposText = settings.allowedRepos.join('\n');
  loaded.value = true;
}

function coerceMethod(m: string | undefined | null): MrMethod {
  return m === 'cli' || m === 'token' || m === 'browser' ? m : 'browser';
}

function syncMrForm(): void {
  method.value = coerceMethod(settings.mr?.method);
  selectedRemote.value = current.value?.remote || settings.mr?.defaultRemote || remotes.value[0]?.name || 'origin';
  apiBaseUrl.value = currentHostProfile.value?.apiBaseUrl ?? current.value?.apiBaseUrl ?? '';
  tokenInput.value = '';
}

async function reloadSettings(opts?: { validateToken?: boolean }): Promise<void> {
  await settings.load(repoId(), { validateToken: opts?.validateToken ?? activeTab.value === 'mr' });
  if (!gitDirty.value) syncGitDraft();
  if (!tokenDirty.value) syncMrForm();
  else {
    method.value = coerceMethod(settings.mr?.method ?? method.value);
    selectedRemote.value = current.value?.remote || selectedRemote.value;
  }
  syncLlmForm();
}

onMounted(async () => {
  await reloadSettings();
  syncGitDraft();
  syncMrForm();
  syncLlmForm();
});

watch(
  () => [settings.permissions] as const,
  () => {
    if (settings.permissions && !gitDirty.value) syncGitDraft();
  }
);

watch(
  () => settings.mr,
  () => {
    if (!tokenDirty.value) syncMrForm();
    else method.value = coerceMethod(settings.mr?.method ?? method.value);
  }
);

watch(
  () => repos.currentId,
  () => {
    void reloadSettings();
  }
);

watch(activeTab, (tab, prev) => {
  if (tab === 'mr' && prev !== 'mr') void reloadSettings({ validateToken: true });
});

const settingTabs: Array<{ id: SettingsTab; label: string }> = [
  { id: 'mr', label: 'MR 配置' },
  { id: 'template', label: '正文规范' },
  { id: 'llm', label: '模型' },
  { id: 'git', label: 'Git 操作' }
];

async function toggleEnabled(t: ToolSummary, enabled: boolean): Promise<void> {
  if (enabled) {
    gitDraft.disabledTools = gitDraft.disabledTools.filter((n) => n !== t.name);
  } else {
    if (!gitDraft.disabledTools.includes(t.name)) gitDraft.disabledTools.push(t.name);
    gitDraft.requireApprovalFor = gitDraft.requireApprovalFor.filter((n) => n !== t.name);
  }
}

function onToolEnabled(t: ToolSummary, ev: Event): void {
  void toggleEnabled(t, (ev.target as HTMLInputElement).checked);
}

function onApproval(name: string, ev: Event): void {
  const on = (ev.target as HTMLInputElement).checked;
  const i = gitDraft.requireApprovalFor.indexOf(name);
  if (on && i < 0) gitDraft.requireApprovalFor.push(name);
  if (!on && i >= 0) gitDraft.requireApprovalFor.splice(i, 1);
}

async function saveGit(): Promise<void> {
  try {
    await settings.save(
      {
        permissions: {
          disabledTools: [...gitDraft.disabledTools],
          requireApprovalFor: [...gitDraft.requireApprovalFor],
          dryRunDefault: gitDraft.dryRunDefault
        },
        git: { allowedRepos: parseAllowedRepos(gitDraft.allowedReposText) }
      },
      repoId()
    );
    ElMessage.success('Git 操作设置已保存');
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : String(err));
  }
}

async function selectMethod(next: MrMethod): Promise<void> {
  if (!repoId()) {
    ElMessage.warning('请先在工作台打开并选择仓库');
    return;
  }
  const prev = method.value;
  method.value = next;
  if (prev === next && settings.mr?.method === next) return;
  try {
    await settings.save({ mr: { method: next } }, repoId());
  } catch (err) {
    method.value = prev;
    ElMessage.error(err instanceof Error ? err.message : String(err));
  }
}

async function onRemoteChange(name: string | number | boolean): Promise<void> {
  const remote = String(name);
  const prev = current.value?.remote || settings.mr?.defaultRemote || 'origin';
  selectedRemote.value = remote;
  try {
    await settings.save({ mr: { defaultRemote: remote } }, repoId());
    syncMrForm();
  } catch (err) {
    selectedRemote.value = prev;
    ElMessage.error(err instanceof Error ? err.message : String(err));
  }
}

async function pickPlatform(p: 'github' | 'gitlab'): Promise<void> {
  const host = current.value?.host;
  if (!host) return;
  try {
    await settings.save({ mr: { upsertHost: { host, platform: p } } }, repoId());
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : String(err));
  }
}

async function saveToken(): Promise<void> {
  const host = current.value?.host;
  if (!host) {
    ElMessage.warning(repos.currentId ? '当前仓库没有可识别的远程地址' : '请先在工作台打开并选择仓库');
    return;
  }
  if (platform.value === 'unknown') {
    ElMessage.warning('请先选择 GitHub 或 GitLab');
    return;
  }
  const nextToken = tokenInput.value.trim();
  const savedApi = currentHostProfile.value?.apiBaseUrl ?? current.value.apiBaseUrl ?? '';
  if (!nextToken && apiBaseUrl.value === savedApi) {
    ElMessage.warning('请填写 Token');
    return;
  }
  validatingToken.value = true;
  try {
    await settings.save(
      {
        mr: {
          upsertHost: {
            host,
            platform: platform.value,
            ...(nextToken ? { token: nextToken } : {}),
            apiBaseUrl: apiBaseUrl.value
          }
        }
      },
      repoId()
    );
    tokenInput.value = '';
    ElMessage.success(nextToken ? `已校验并保存 ${host} 的 Token` : `已保存 ${host} 的 API 地址`);
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : String(err));
  } finally {
    validatingToken.value = false;
  }
}

async function revalidateToken(): Promise<void> {
  if (!current.value?.tokenSet) return;
  validatingToken.value = true;
  try {
    await settings.load(repoId(), { validateToken: true });
    if (!tokenDirty.value) syncMrForm();
    const status = settings.mr?.current?.tokenStatus;
    if (status?.ok) ElMessage.success(status.titleStatus);
    else ElMessage.warning(status?.titleStatus || '校验未通过');
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : String(err));
  } finally {
    validatingToken.value = false;
  }
}

async function removeHost(host: string): Promise<void> {
  try {
    await ElMessageBox.confirm(`清除 ${host} 上保存的 Token 与覆盖项？`, '删除域名配置', {
      confirmButtonText: '清除',
      cancelButtonText: '取消',
      type: 'warning'
    });
  } catch {
    return;
  }
  try {
    await settings.save({ mr: { deleteHost: host } }, repoId());
    if (!tokenDirty.value) syncMrForm();
    ElMessage.success('已清除');
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : String(err));
  }
}

async function redetectCli(): Promise<void> {
  await reloadSettings();
  if (settings.error) {
    ElMessage.error(settings.error);
    return;
  }
  ElMessage.success('已重新检测本机 gh / glab');
}

function syncLlmForm(): void {
  llmModel.value = settings.llm?.model || 'gpt-4.1';
  llmBaseUrl.value = settings.llm?.baseUrl || '';
  llmKeyInput.value = '';
}

async function saveLlm(): Promise<void> {
  try {
    await settings.save(
      {
        llm: {
          provider: 'openai',
          model: llmModel.value.trim() || 'gpt-4.1',
          baseUrl: llmBaseUrl.value.trim(),
          ...(llmKeyInput.value.trim() ? { apiKey: llmKeyInput.value.trim() } : {})
        }
      },
      repoId()
    );
    llmKeyInput.value = '';
    ElMessage.success('已保存模型配置');
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : String(err));
  }
}

async function clearLlmKey(): Promise<void> {
  try {
    await ElMessageBox.confirm('清除已保存的模型 API Key？聊天将无法调用模型。', '确认', {
      confirmButtonText: '清除',
      cancelButtonText: '取消',
      type: 'warning'
    });
  } catch {
    return;
  }
  try {
    await settings.save({ llm: { clearKey: true } }, repoId());
    llmKeyInput.value = '';
    ElMessage.success('已清除');
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : String(err));
  }
}
</script>

<template>
  <div class="page settings-page">
    <h2 class="page-title">设置</h2>
    <p v-if="repos.serverVersion" class="page-version">服务 {{ repos.serverVersion }}</p>
    <el-alert v-if="settings.error" :title="settings.error" type="error" :closable="false" show-icon class="mb" />

    <div class="gc-chip-tabs">
      <button
        v-for="t in settingTabs"
        :key="t.id"
        type="button"
        :class="{ on: activeTab === t.id }"
        @click="activeTab = t.id"
      >
        {{ t.label }}
      </button>
    </div>

    <div class="settings-body" :class="{ fill: activeTab === 'template' }">
      <section v-show="activeTab === 'mr'" class="stack">
        <div class="gc-glass pad">
          <p class="gc-eyebrow">默认远程</p>
          <div class="remote-bar">
            <template v-if="hasRepoRemotes">
              <el-select
                v-model="selectedRemote"
                class="remote-select"
                :disabled="settings.saving"
                @change="onRemoteChange"
              >
                <el-option v-for="r in remotes" :key="r.name" :label="r.name" :value="r.name" />
              </el-select>
              <span class="mono muted remote-url" :title="selectedRemoteUrl">{{ selectedRemoteUrl || '—' }}</span>
              <el-tag size="small" effect="plain">{{ platformLabel(platform) }}</el-tag>
            </template>
            <span v-else class="mr-hint">{{
              repos.currentId ? '当前仓库没有 remote' : '未选择仓库，请先在工作台打开仓库'
            }}</span>
          </div>
          <p class="mr-hint">用于 fetch、MR 短名剥前缀、CLI 未传远程时的默认值。切换后立即保存。</p>
          <div v-if="hasRepoRemotes && platform === 'unknown'" class="mr-platform-row">
            <span class="mr-hint">未能自动识别远程平台，请手动选择。</span>
            <el-button :disabled="!current?.host || settings.saving" @click="pickPlatform('github')">GitHub</el-button>
            <el-button :disabled="!current?.host || settings.saving" @click="pickPlatform('gitlab')">GitLab</el-button>
          </div>
        </div>

        <div
          v-for="opt in methodOptions"
          :key="opt.id"
          class="gc-glass opt"
          :class="{ on: method === opt.id, disabled: settings.saving }"
          role="button"
          tabindex="0"
          @click="selectMethod(opt.id)"
          @keydown.enter.prevent="selectMethod(opt.id)"
        >
          <header class="opt-head">
            <strong>{{ opt.title }}</strong>
            <span :class="opt.ready ? 'ok' : 'bad'">{{ opt.ready ? '可用' : '未就绪' }}</span>
          </header>

          <div v-if="method === opt.id" class="mr-panel" @click.stop>
            <div v-if="opt.id === 'cli'" class="mr-stack">
              <template v-if="showGhCli">
                <div class="mr-kv">
                  <span class="mono">gh</span>
                  <span>{{ cliStatusText(settings.mr?.cli.gh) }}</span>
                  <el-link
                    v-if="!settings.mr?.cli.gh.found"
                    type="primary"
                    :href="ghInstallUrl"
                    target="_blank"
                  >去下载</el-link>
                  <span
                    v-else-if="settings.mr?.cli.gh.loggedIn && settings.mr?.cli.gh.tokenStatus"
                    class="token-title-status"
                    :class="cliTokenStatusClass(settings.mr?.cli.gh)"
                  >{{ settings.mr?.cli.gh.tokenStatus.titleStatus }}</span>
                </div>
              </template>
              <template v-if="showGlabCli">
                <div class="mr-kv">
                  <span class="mono">glab</span>
                  <span>{{ cliStatusText(settings.mr?.cli.glab) }}</span>
                  <el-link
                    v-if="!settings.mr?.cli.glab.found"
                    type="primary"
                    :href="glabInstallUrl"
                    target="_blank"
                  >去下载</el-link>
                  <span
                    v-else-if="settings.mr?.cli.glab.loggedIn && settings.mr?.cli.glab.tokenStatus"
                    class="token-title-status"
                    :class="cliTokenStatusClass(settings.mr?.cli.glab)"
                  >{{ settings.mr?.cli.glab.tokenStatus.titleStatus }}</span>
                </div>
              </template>
              <el-button @click="redetectCli">重新检测</el-button>
            </div>

            <div v-if="opt.id === 'token'" class="mr-stack">
              <template v-if="!current?.host">
                <p class="mr-hint">{{
                  repos.currentId ? '当前仓库没有可识别的远程地址，无法绑定 Token。' : '请先在工作台打开并选择仓库。Token 始终绑定当前远程的域名。'
                }}</p>
              </template>
              <template v-else>
                <el-form class="mr-form gc-form-narrow" label-width="100px" label-position="left" @submit.prevent>
                  <el-form-item label="Token">
                    <div class="mr-field">
                      <p v-if="tokenStatusText" class="token-title-status" :class="tokenStatusClass">{{ tokenStatusText }}</p>
                      <el-input
                        v-model="tokenInput"
                        type="password"
                        show-password
                        autocomplete="new-password"
                        :placeholder="tokenPlaceholder"
                        :disabled="platform === 'unknown' || validatingToken"
                      />
                      <p v-if="current.tokenSet && current.tokenPreview" class="mr-hint">
                        已保存 {{ current.tokenPreview }}（明文不回填，输入新 Token 可覆盖）
                      </p>
                      <p class="mr-hint">{{ tokenHint }}</p>
                    </div>
                  </el-form-item>
                  <el-form-item>
                    <div class="mr-inline">
                      <el-link v-if="platform !== 'gitlab'" type="primary" :href="GH_TOKEN_CREATE_URL" target="_blank">
                        打开 GitHub 创建 Token 页面
                      </el-link>
                      <el-link v-if="platform !== 'github'" type="primary" :href="gitlabTokenCreateUrl" target="_blank">
                        打开 GitLab 创建 Token 页面
                      </el-link>
                      <el-button link type="primary" @click="showAdvanced = !showAdvanced">
                        {{ showAdvanced ? '收起自建选项' : '自建 / API Base URL' }}
                      </el-button>
                    </div>
                  </el-form-item>
                  <el-form-item v-if="showAdvanced" label="API Base URL">
                    <el-input
                      v-model="apiBaseUrl"
                      placeholder="空则按域名惯例推断，如 https://git.a.com/api/v4"
                    />
                  </el-form-item>
                  <el-form-item>
                    <el-button
                      type="primary"
                      :loading="settings.saving || validatingToken"
                      :disabled="!tokenDirty || validatingToken"
                      @click="saveToken"
                    >
                      保存此远程配置
                    </el-button>
                    <el-button
                      :disabled="!current.tokenSet || tokenDirty || validatingToken"
                      :loading="validatingToken && !tokenDirty"
                      @click="revalidateToken"
                    >
                      重新校验
                    </el-button>
                    <el-button :disabled="!tokenDirty" @click="syncMrForm">放弃修改</el-button>
                  </el-form-item>
                </el-form>
              </template>
            </div>

            <p v-if="opt.id === 'browser'" class="mr-hint">
              确认后只返回浏览器创建页，不调用 Token 或本机 CLI。
              <template v-if="settings.mr?.template?.enabled">
                已启用正文规范时，平台创建页不会写入正文，请复制后粘贴，或改用 Token / 本机 CLI。
              </template>
            </p>
          </div>
        </div>

        <div v-if="showCurrentHostCard && currentHostProfile" class="gc-glass pad">
          <p class="gc-eyebrow">当前远程凭证</p>
          <p class="mr-hint">只显示当前选中远程的域名。其它实例上的 Token 不在这里列出。</p>
          <ul class="host-list">
            <li class="host-row">
              <span class="mono">{{ currentHostProfile.host }}</span>
              <el-tag size="small" effect="plain">{{
                currentHostProfile.platform === 'github' ? 'GitHub' : 'GitLab'
              }}</el-tag>
              <el-tag size="small" :type="currentHostProfile.tokenSet ? 'success' : 'info'" effect="plain">
                {{
                  currentHostProfile.tokenSet
                    ? currentHostProfile.tokenPreview || '已配置 Token'
                    : '无 Token'
                }}
              </el-tag>
              <el-button link type="danger" @click="removeHost(currentHostProfile.host)">清除</el-button>
            </li>
          </ul>
        </div>
      </section>

      <section v-show="activeTab === 'template'" class="template-pane">
        <MrTemplateSettings />
      </section>

      <section v-show="activeTab === 'llm'" class="stack">
        <div class="gc-glass pad">
          <p class="gc-eyebrow">聊天模型</p>
          <p class="mr-hint">
            Key 与 MR Token 一样只存在本机设置里，不进 MCP 工具参数，页面不回填明文。浏览器和桌面同一套配置。
          </p>
          <label class="kv">
            供应商
            <el-select model-value="openai" disabled>
              <el-option label="OpenAI 兼容" value="openai" />
            </el-select>
          </label>
          <label class="kv">
            模型名
            <el-input v-model="llmModel" placeholder="gpt-4.1" />
          </label>
          <label class="kv">
            Base URL
            <el-input v-model="llmBaseUrl" placeholder="空 = https://api.openai.com/v1 ；兼容网关填到 /v1" />
          </label>
          <label class="kv">
            API Key
            <el-input
              v-model="llmKeyInput"
              type="password"
              show-password
              :placeholder="
                settings.llm?.tokenSet ? `已保存 ${settings.llm.tokenPreview}，输入新 Key 覆盖` : 'sk-…'
              "
            />
          </label>
          <div class="row">
            <el-button type="primary" :loading="settings.saving" @click="saveLlm">保存</el-button>
            <el-button :disabled="!settings.llm?.tokenSet || settings.saving" @click="clearLlmKey">清除 Key</el-button>
          </div>
        </div>
      </section>

      <section v-show="activeTab === 'git'" class="stack">
        <div class="gc-glass pad">
          <p class="gc-eyebrow">默认行为</p>
          <label class="kv">
            写操作默认 dry-run
            <el-switch v-model="gitDraft.dryRunDefault" />
          </label>
          <p class="hint">开启后所有写操作（MCP / CLI）默认只生成预览，不真正执行。</p>
          <p class="field-label">允许打开的仓库</p>
          <el-input
            v-model="gitDraft.allowedReposText"
            type="textarea"
            :rows="4"
            placeholder="一行一个本地路径。留空 = 不限制"
          />
          <p class="hint">非空时，打开的仓库根路径必须等于其中一条，或位于其目录下。MCP 带 repoPath 同样校验。</p>
        </div>

        <div class="gc-glass pad" v-loading="settings.loading">
          <p class="gc-eyebrow">工具开关</p>
          <p class="hint">高风险默认关 · 执行前自动备份。勾选即启用。</p>
          <label v-for="t in settings.tools" :key="t.name" class="tool">
            <input
              type="checkbox"
              :checked="!gitDraft.disabledTools.includes(t.name)"
              @change="onToolEnabled(t, $event)"
            />
            <code>{{ t.name }}</code>
            <span>{{ t.description }}</span>
            <em v-if="t.riskLevel === 'dangerous'">高风险</em>
          </label>
        </div>

        <div class="gc-glass pad">
          <p class="gc-eyebrow">审批规则</p>
          <p class="hint">勾选后，执行时需在确认框中手工确认。仅对已启用的高危工具生效；禁用后自动移除。</p>
          <label v-for="t in dangerTools" :key="t.name" class="tool">
            <input
              type="checkbox"
              :checked="gitDraft.requireApprovalFor.includes(t.name)"
              :disabled="gitDraft.disabledTools.includes(t.name)"
              @change="onApproval(t.name, $event)"
            />
            <code>{{ t.name }}</code>
            <span>{{ t.description }}</span>
          </label>
        </div>

        <div v-if="loaded" class="row">
          <el-button type="primary" :loading="settings.saving" :disabled="!gitDirty" @click="saveGit">保存 Git 设置</el-button>
          <el-button :disabled="!gitDirty" @click="syncGitDraft">放弃修改</el-button>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.settings-page {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.page-title,
.page-version,
.settings-page > .el-alert,
.gc-chip-tabs {
  flex: none;
}
.settings-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
}
.settings-body.fill {
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.stack {
  display: flex;
  flex-direction: column;
  gap: var(--gc-gap);
  max-width: 720px;
  padding-bottom: var(--gc-pad);
}
.pad {
  padding: var(--gc-pad);
}
.opt {
  padding: var(--gc-pad);
  text-align: left;
  color: inherit;
  cursor: pointer;
  font: inherit;
  width: 100%;
}
.opt.on {
  box-shadow: 0 0 0 1px var(--el-color-primary) inset;
}
.opt.disabled {
  cursor: default;
}
.opt-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: var(--gc-control);
  gap: var(--gc-gap);
}
.opt-head strong {
  font-size: var(--gc-text);
}
.ok {
  color: var(--el-color-success);
  font-size: var(--gc-text);
}
.bad {
  color: var(--el-color-danger);
  font-size: var(--gc-text);
}
.hint {
  margin: var(--gc-gap) 0 0;
  font-size: var(--gc-text);
  line-height: 1.5;
  color: var(--el-text-color-secondary);
}
.field-label {
  margin: var(--gc-pad) 0 var(--gc-gap);
  font-size: var(--gc-text);
}
.tool,
.kv {
  display: flex;
  align-items: center;
  gap: var(--gc-gap);
  min-height: var(--gc-line);
  font-size: var(--gc-text);
}
.tool {
  padding: 0;
}
.tool code {
  flex: none;
  font-family: inherit;
  font-size: var(--gc-text);
}
.tool span {
  min-width: 0;
  color: var(--el-text-color-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tool em {
  margin-left: auto;
  flex: none;
  font-style: normal;
  color: var(--el-color-danger);
}
.tool input:disabled {
  opacity: 0.35;
}
.kv {
  display: grid;
  grid-template-columns: 140px minmax(0, 1fr);
  align-items: center;
  margin-top: var(--gc-gap);
}
.row {
  display: flex;
  gap: var(--gc-gap);
  margin-top: var(--gc-gap);
}
.template-pane {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.template-pane :deep(.tmpl) {
  flex: 1;
}
.template-pane :deep(.pane) {
  background: color-mix(in srgb, var(--el-bg-color) 82%, transparent);
  box-shadow: var(--gc-shadow-menu);
}
.mr-hint {
  margin: 0;
  font-size: var(--gc-text);
  line-height: 1.5;
  color: var(--el-text-color-secondary);
}
.mr-hint + .mr-hint {
  margin-top: var(--gc-gap);
}
.remote-bar {
  display: flex;
  align-items: center;
  min-height: var(--gc-line);
  gap: var(--gc-gap);
  flex-wrap: wrap;
}
.remote-bar + .mr-hint {
  margin-top: var(--gc-gap);
}
.remote-select {
  width: 160px;
}
.remote-url {
  max-width: 420px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--el-text-color-secondary);
  font-size: var(--gc-text);
}
.mr-platform-row {
  display: flex;
  align-items: center;
  min-height: var(--gc-line);
  gap: var(--gc-gap);
  flex-wrap: wrap;
  margin-top: var(--gc-gap);
}
.mr-panel {
  display: flex;
  flex-direction: column;
  gap: var(--gc-gap);
  margin-top: var(--gc-gap);
  padding: var(--gc-pad);
  border-radius: var(--gc-radius);
  background: var(--el-fill-color-light);
}
.mr-stack {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--gc-gap);
}
.mr-kv {
  display: flex;
  align-items: center;
  min-height: var(--gc-line);
  gap: var(--gc-gap);
  font-size: var(--gc-text);
  color: var(--el-text-color-regular);
}
.mr-kv span:first-child {
  min-width: 48px;
  color: var(--el-text-color-secondary);
}
.mr-field {
  display: flex;
  flex-direction: column;
  gap: var(--gc-gap);
  width: 100%;
  max-width: 420px;
}
.mr-form {
  width: 100%;
}
.mr-inline {
  display: flex;
  align-items: center;
  min-height: var(--gc-line);
  gap: var(--gc-gap);
  flex-wrap: wrap;
}
.token-title-status {
  margin: 0;
  font-size: var(--gc-text);
  line-height: 1.5;
}
.token-title-status.ok {
  color: var(--el-color-success);
}
.token-title-status.bad {
  color: var(--el-color-danger);
}
.token-title-status.muted {
  color: var(--el-text-color-secondary);
}
.host-list {
  list-style: none;
  margin: var(--gc-gap) 0 0;
  padding: 0;
}
.host-row {
  display: flex;
  align-items: center;
  min-height: var(--gc-line);
  gap: var(--gc-gap);
}
</style>
