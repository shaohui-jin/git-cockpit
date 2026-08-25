<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import * as api from '@/api/client';
import { useReposStore } from '@/stores/repos';
import { useToolAction } from '@/composables/useToolAction';
import { useRevision } from '@/composables/revision';
import ConfirmDialog from '@/components/ConfirmDialog.vue';
import DiffViewer from '@/components/DiffViewer.vue';
import type { BranchInfo, DiffResult, FileStatus, RepoStatus } from '@/api/types';

const repos = useReposStore();
const { revision } = useRevision();
const repoId = (): number | null => repos.currentId;

const status = ref<RepoStatus | null>(null);
const branches = ref<BranchInfo[]>([]);
const loading = ref(false);
const loadError = ref('');

/** 文件差异抽屉 */
const drawerVisible = ref(false);
const drawerTitle = ref('');
const diff = ref<DiffResult | null>(null);
const diffLoading = ref(false);

/** 参数录入对话框 */
const commitVisible = ref(false);
const commitMessage = ref('');
const branchVisible = ref(false);
const branchName = ref('');
const branchStart = ref('');
const checkoutVisible = ref(false);
const checkoutBranch = ref('');
const stashVisible = ref(false);
const stashUntracked = ref(false);
const resetVisible = ref(false);
const resetTarget = ref('');

const { confirmVisible, pending, canRun, previewAndConfirm, executeConfirmed, cancel } = useToolAction(repoId);

const currentPath = computed(() => repos.current?.path ?? '');
const currentBranch = computed(() => status.value?.currentShort ?? status.value?.current ?? '');
const ahead = computed(() => status.value?.ahead ?? 0);
const behind = computed(() => status.value?.behind ?? 0);
const stagedCount = computed(() => status.value?.staged.length ?? 0);
const unstagedCount = computed(() => status.value?.unstaged.length ?? 0);
const untrackedCount = computed(() => status.value?.untracked.length ?? 0);
const localBranches = computed(() => branches.value.filter((b) => !b.remote));

async function loadStatus(): Promise<void> {
  const id = repoId();
  if (id === null) return;
  loading.value = true;
  loadError.value = '';
  try {
    status.value = await api.getStatus(id);
  } catch (err) {
    loadError.value = err instanceof Error ? err.message : String(err);
    status.value = null;
  } finally {
    loading.value = false;
  }
}

async function loadBranches(): Promise<void> {
  const id = repoId();
  if (id === null) return;
  try {
    const { branches: bs } = await api.listBranches(id);
    branches.value = bs;
  } catch {
    /* branch 列表失败不阻塞状态页 */
  }
}

async function refresh(): Promise<void> {
  await Promise.all([loadStatus(), loadBranches()]);
}

/** 通用流程：参数就绪后 dry-run 预览 → ConfirmDialog → 真实执行 → 刷新 */
async function run(tool: string, params: Record<string, unknown> = {}): Promise<void> {
  const ok = await previewAndConfirm(tool, params);
  if (ok) ElMessage.info('请在确认对话框中查看 dry-run 预览');
}

async function onConfirmed(): Promise<void> {
  const res = await executeConfirmed();
  if (res?.success) await refresh();
}

/** 文件行内操作 */
async function stageFile(f: FileStatus): Promise<void> {
  await run('git_add', { paths: [f.path] });
}
async function unstageFile(f: FileStatus): Promise<void> {
  await run('git_unstage', { paths: [f.path] });
}
async function stageAll(): Promise<void> {
  await run('git_add', {});
}
async function unstageAll(): Promise<void> {
  const all = status.value?.staged.map((f) => f.path) ?? [];
  if (all.length === 0) {
    ElMessage.info('没有已暂存的文件');
    return;
  }
  await run('git_unstage', { paths: all });
}

/** 查看单个文件差异 */
async function showDiff(f: FileStatus): Promise<void> {
  const id = repoId();
  if (id === null) return;
  drawerVisible.value = true;
  drawerTitle.value = f.path + (f.staged ? '（已暂存）' : '（工作区）');
  diff.value = null;
  diffLoading.value = true;
  try {
    diff.value = await api.getDiff(id, { path: f.path, staged: f.staged });
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : String(err));
    drawerVisible.value = false;
  } finally {
    diffLoading.value = false;
  }
}

/** 参数对话框确认 */
function confirmCommit(): void {
  const msg = commitMessage.value.trim();
  if (!msg) {
    ElMessage.warning('请输入提交信息');
    return;
  }
  commitVisible.value = false;
  void run('git_commit', { message: msg });
}
function confirmCreateBranch(): void {
  const name = branchName.value.trim();
  if (!name) {
    ElMessage.warning('请输入分支名');
    return;
  }
  branchVisible.value = false;
  void run('git_branch_create', branchStart.value.trim() ? { name, startPoint: branchStart.value.trim() } : { name });
}
function confirmCheckout(): void {
  if (!checkoutBranch.value) {
    ElMessage.warning('请选择要切换的分支');
    return;
  }
  checkoutVisible.value = false;
  const b = checkoutBranch.value;
  checkoutBranch.value = '';
  void run('git_checkout', { branch: b });
}
function confirmStash(): void {
  stashVisible.value = false;
  void run('git_stash', stashUntracked.value ? { includeUntracked: true } : {});
}
function confirmReset(): void {
  const target = resetTarget.value.trim() || 'HEAD';
  resetVisible.value = false;
  resetTarget.value = '';
  void run('git_reset_hard', { target });
}

watch(repoId, () => {
  diff.value = null;
  drawerVisible.value = false;
  void refresh();
});
watch(revision, () => {
  void refresh();
});

onMounted(() => {
  void refresh();
});
</script>

<template>
  <div class="page">
    <h2 class="page-title">仓库状态</h2>
    <el-alert v-if="loadError" :title="loadError" type="error" :closable="false" show-icon class="mb" />

    <el-card shadow="never" class="mb">
      <template #header>
        <div class="card-head">
          <div class="branch-info">
            <el-tag type="primary" effect="dark" size="large">{{ currentBranch || '—' }}</el-tag>
            <span v-if="status?.tracking" class="tracking">
              {{ status.tracking }}
              <span v-if="ahead" class="ahead">↑{{ ahead }}</span>
              <span v-if="behind" class="behind">↓{{ behind }}</span>
            </span>
            <el-tag v-if="status?.isClean" type="success" effect="plain" size="small">工作区干净</el-tag>
            <el-tag v-else-if="status" type="warning" effect="plain" size="small">
              更改 {{ stagedCount }} 暂存 / {{ unstagedCount }} 未暂存 / {{ untrackedCount }} 未跟踪
            </el-tag>
          </div>
          <el-button :loading="loading" @click="refresh">刷新</el-button>
        </div>
        <div class="repo-path mono">{{ currentPath }}</div>
      </template>

      <div v-if="!canRun" class="empty-tip">请先在「仓库管理」中打开一个仓库</div>

      <template v-else>
        <div class="toolbar">
          <div class="toolbar-group">
            <el-button type="primary" plain @click="commitVisible = true">提交 Commit</el-button>
            <el-button type="success" plain @click="stageAll">暂存全部</el-button>
            <el-button type="warning" plain :disabled="stagedCount === 0" @click="unstageAll">取消暂存全部</el-button>
            <el-button plain @click="stashVisible = true">暂存改动 Stash</el-button>
            <el-button plain @click="checkoutVisible = true">切换分支</el-button>
            <el-button plain @click="branchVisible = true">新建分支</el-button>
            <el-button plain @click="run('git_pull')">拉取 Pull</el-button>
            <el-button plain @click="run('git_push')">推送 Push</el-button>
          </div>
          <div class="toolbar-group danger">
            <el-button type="danger" plain @click="resetVisible = true">硬重置</el-button>
            <el-button type="danger" plain @click="run('git_clean')">清理未跟踪</el-button>
          </div>
        </div>

        <el-alert
          v-if="status?.conflicted.length"
          title="存在合并冲突，请先解决冲突（修改文件后重新 git add 并提交）"
          type="error"
          :closable="false"
          show-icon
          class="mb"
        />

        <el-row :gutter="12" class="status-cols">
          <el-col :span="8">
            <el-card shadow="hover" class="count-card" :class="{ active: stagedCount > 0 }">
              <div class="count-label">已暂存</div>
              <div class="count-num" :class="{ primary: stagedCount > 0 }">{{ stagedCount }}</div>
            </el-card>
          </el-col>
          <el-col :span="8">
            <el-card shadow="hover" class="count-card" :class="{ active: unstagedCount > 0 }">
              <div class="count-label">未暂存</div>
              <div class="count-num" :class="{ warn: unstagedCount > 0 }">{{ unstagedCount }}</div>
            </el-card>
          </el-col>
          <el-col :span="8">
            <el-card shadow="hover" class="count-card" :class="{ active: untrackedCount > 0 }">
              <div class="count-label">未跟踪</div>
              <div class="count-num" :class="{ danger: untrackedCount > 0 }">{{ untrackedCount }}</div>
            </el-card>
          </el-col>
        </el-row>
      </template>
    </el-card>

    <template v-if="canRun && status">
      <!-- 已暂存 -->
      <el-card shadow="never" class="mb file-card">
        <template #header>已暂存（{{ stagedCount }}）</template>
        <el-empty v-if="stagedCount === 0" description="没有已暂存的文件" :image-size="60" />
        <div v-else class="file-list">
          <div v-for="f in status.staged" :key="'s' + f.path" class="file-row">
            <span class="file-status add">A</span>
            <span class="file-path mono">{{ f.path }}</span>
            <el-button size="small" text type="primary" @click="showDiff(f)">查看差异</el-button>
            <el-button size="small" text type="warning" @click="unstageFile(f)">取消暂存</el-button>
          </div>
        </div>
      </el-card>

      <!-- 未暂存 -->
      <el-card shadow="never" class="mb file-card">
        <template #header>未暂存（{{ unstagedCount }}）</template>
        <el-empty v-if="unstagedCount === 0" description="没有未暂存的文件" :image-size="60" />
        <div v-else class="file-list">
          <div v-for="f in status.unstaged" :key="'u' + f.path" class="file-row">
            <span class="file-status mod">M</span>
            <span class="file-path mono">{{ f.path }}</span>
            <el-button size="small" text type="primary" @click="showDiff(f)">查看差异</el-button>
            <el-button size="small" text type="success" @click="stageFile(f)">暂存</el-button>
          </div>
        </div>
      </el-card>

      <!-- 未跟踪 -->
      <el-card shadow="never" class="mb file-card">
        <template #header>未跟踪（{{ untrackedCount }}）</template>
        <el-empty v-if="untrackedCount === 0" description="没有未跟踪的文件" :image-size="60" />
        <div v-else class="file-list">
          <div v-for="p in status.untracked" :key="'t' + p" class="file-row">
            <span class="file-status new">?</span>
            <span class="file-path mono">{{ p }}</span>
            <el-button size="small" text type="success" @click="run('git_add', { paths: [p] })">暂存</el-button>
          </div>
        </div>
      </el-card>
    </template>

    <!-- 写操作确认对话框（dry-run 预览） -->
    <ConfirmDialog
      v-model:visible="confirmVisible"
      :tool="pending?.tool ?? ''"
      :preview="pending?.preview ?? null"
      @confirm="onConfirmed"
      @cancel="cancel"
    />

    <el-drawer v-model="drawerVisible" :title="drawerTitle" size="52%" destroy-on-close>
      <div v-loading="diffLoading" class="diff-wrap">
        <template v-if="diff">
          <div class="diff-summary">
            <span>{{ diff.files.length }} 个文件</span>
            <span class="add">+{{ diff.insertions }}</span>
            <span class="del">-{{ diff.deletions }}</span>
            <span v-if="diff.truncated" class="warn">（已截断）</span>
          </div>
          <DiffViewer :patch="diff.rawPatch" />
        </template>
        <el-empty v-else-if="!diffLoading" description="无差异" :image-size="60" />
      </div>
    </el-drawer>

    <!-- 提交信息 -->
    <el-dialog v-model="commitVisible" title="提交 Commit" width="520px" @closed="commitMessage = ''">
      <el-input
        v-model="commitMessage"
        type="textarea"
        :rows="5"
        placeholder="输入提交信息（message）"
        @keydown.ctrl.enter="confirmCommit"
      />
      <template #footer>
        <el-button @click="commitVisible = false">取消</el-button>
        <el-button type="primary" @click="confirmCommit">下一步（dry-run 预览）</el-button>
      </template>
    </el-dialog>

    <!-- 新建分支 -->
    <el-dialog v-model="branchVisible" title="新建分支" width="480px" @closed="branchName = ''; branchStart = ''">
      <el-form label-width="90px">
        <el-form-item label="分支名">
          <el-input v-model="branchName" placeholder="feature/xxx" />
        </el-form-item>
        <el-form-item label="起点（可选）">
          <el-input v-model="branchStart" placeholder="默认当前 HEAD，如 main 或 commit hash" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="branchVisible = false">取消</el-button>
        <el-button type="primary" @click="confirmCreateBranch">下一步（dry-run 预览）</el-button>
      </template>
    </el-dialog>

    <!-- 切换分支 -->
    <el-dialog v-model="checkoutVisible" title="切换分支" width="480px" @closed="checkoutBranch = ''">
      <el-select v-model="checkoutBranch" filterable allow-create placeholder="选择或输入分支名" style="width: 100%">
        <el-option v-for="b in localBranches" :key="b.name" :label="b.name + (b.current ? '（当前）' : '')" :value="b.name" />
      </el-select>
      <template #footer>
        <el-button @click="checkoutVisible = false">取消</el-button>
        <el-button type="primary" @click="confirmCheckout">下一步（dry-run 预览）</el-button>
      </template>
    </el-dialog>

    <!-- stash -->
    <el-dialog v-model="stashVisible" title="暂存改动 Stash" width="460px">
      <el-checkbox v-model="stashUntracked">包含未跟踪文件（-u）</el-checkbox>
      <template #footer>
        <el-button @click="stashVisible = false">取消</el-button>
        <el-button type="primary" @click="confirmStash">下一步（dry-run 预览）</el-button>
      </template>
    </el-dialog>

    <!-- 硬重置 -->
    <el-dialog v-model="resetVisible" title="硬重置（高风险）" width="480px" @closed="resetTarget = ''">
      <el-alert
        title="将丢弃索引与工作区所有更改（不可逆），执行前会自动创建备份"
        type="error"
        :closable="false"
        show-icon
        class="mb"
      />
      <el-input v-model="resetTarget" placeholder="重置目标，默认 HEAD，如 HEAD~1 / commit hash / main" />
      <template #footer>
        <el-button @click="resetVisible = false">取消</el-button>
        <el-button type="danger" @click="confirmReset">下一步（dry-run 预览）</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.page-title {
  margin: 0 0 16px;
  font-size: 18px;
}
.mb {
  margin-bottom: 14px;
}
.card-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.branch-info {
  display: flex;
  align-items: center;
  gap: 10px;
}
.tracking {
  font-size: 13px;
  color: var(--el-text-color-secondary);
}
.ahead {
  color: var(--el-color-success);
}
.behind {
  color: var(--el-color-warning);
}
.repo-path {
  margin-top: 8px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.empty-tip {
  padding: 24px 0;
  text-align: center;
  color: var(--el-text-color-secondary);
}
.toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
}
.toolbar-group {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.status-cols {
  margin-top: 14px;
}
.count-card {
  text-align: center;
}
.count-card :deep(.el-card__body) {
  padding: 16px;
}
.count-label {
  font-size: 13px;
  color: var(--el-text-color-secondary);
}
.count-num {
  font-size: 30px;
  font-weight: 700;
  line-height: 1.2;
  margin-top: 4px;
  color: var(--el-text-color-regular);
}
.count-num.primary {
  color: var(--el-color-primary);
}
.count-num.warn {
  color: var(--el-color-warning);
}
.count-num.danger {
  color: var(--el-color-danger);
}
.file-list {
  max-height: 320px;
  overflow-y: auto;
}
.file-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 4px;
  border-bottom: 1px solid var(--el-border-color-lighter);
}
.file-row:last-child {
  border-bottom: none;
}
.file-status {
  width: 22px;
  height: 22px;
  border-radius: 4px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 700;
  color: #fff;
  flex: none;
}
.file-status.add {
  background: var(--el-color-success);
}
.file-status.mod {
  background: var(--el-color-warning);
}
.file-status.new {
  background: var(--el-color-info);
}
.file-path {
  flex: 1;
  font-size: 13px;
  word-break: break-all;
}
.diff-summary {
  display: flex;
  gap: 12px;
  font-size: 13px;
  margin-bottom: 8px;
}
.diff-summary .add {
  color: var(--el-color-success);
}
.diff-summary .del {
  color: var(--el-color-danger);
}
.diff-summary .warn {
  color: var(--el-color-warning);
}
.diff-wrap {
  min-height: 200px;
}
</style>