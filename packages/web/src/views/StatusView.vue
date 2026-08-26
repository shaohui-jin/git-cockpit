<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import * as api from '@/api/client';
import { useReposStore } from '@/stores/repos';
import { useToolAction } from '@/composables/useToolAction';
import { useRevision } from '@/composables/revision';
import ConfirmDialog from '@/components/ConfirmDialog.vue';
import DiffViewer from '@/components/DiffViewer.vue';
import type { BranchInfo, DiffResult, FileStatus, RepoStatus, StashInfo, ToolExecResult } from '@/api/types';

const repos = useReposStore();
const { revision } = useRevision();
const repoId = (): number | null => repos.currentId;

const status = ref<RepoStatus | null>(null);
const branches = ref<BranchInfo[]>([]);
const stashes = ref<StashInfo[]>([]);
const loading = ref(false);
const loadError = ref('');

/** 文件差异抽屉（文件 diff 或 stash diff 共用） */
const drawer = reactive<{ visible: boolean; title: string; diff: DiffResult | null; patch: string; loading: boolean }>({
  visible: false,
  title: '',
  diff: null,
  patch: '',
  loading: false
});

/** 参数录入对话框 */
const commitVisible = ref(false);
const commitMessage = ref('');
const branchVisible = ref(false);
const branchName = ref('');
const branchStart = ref('');
const stashVisible = ref(false);
const stashMessage = ref('');
const stashIncludeUntracked = ref(false);
const resetVisible = ref(false);
const resetTarget = ref('');

/** 更改文件勾选集合：既用于行内选择，也作为 stash 的选择文件来源 */
const checkedFiles = reactive<Set<string>>(new Set());
const checkedCount = computed(() => checkedFiles.size);

const activeTab = ref<'unstaged' | 'staged' | 'untracked' | 'all'>('unstaged');

const { confirmVisible, pending, canRun, previewAndConfirm, executeConfirmed, cancel } = useToolAction(repoId);

const currentPath = computed(() => repos.current?.path ?? '');
const currentBranch = computed(() => status.value?.currentShort ?? status.value?.current ?? '');
const ahead = computed(() => status.value?.ahead ?? 0);
const behind = computed(() => status.value?.behind ?? 0);

/** 各标签页文件列表（untracked 转成 FileStatus 统一渲染） */
const tabLists = computed(() => {
  const s = status.value;
  if (!s) {
    return { unstaged: [] as FileStatus[], staged: [] as FileStatus[], untracked: [] as FileStatus[], all: [] as FileStatus[] };
  }
  const untracked: FileStatus[] = s.untracked.map((p) => ({
    path: p,
    status: '??',
    indexStatus: '?',
    workTreeStatus: '?',
    staged: false,
    untracked: true,
    conflicted: false
  }));
  const merged: FileStatus[] = [...s.staged, ...s.unstaged, ...untracked];
  const seen = new Set<string>();
  const all = merged.filter((f) => {
    if (seen.has(f.path)) return false;
    seen.add(f.path);
    return f.path !== '';
  });
  return { unstaged: s.unstaged, staged: s.staged, untracked, all };
});

const tabs = computed(() => [
  { key: 'unstaged' as const, label: '未暂存', hint: '已修改，未 git add', count: tabLists.value.unstaged.length },
  { key: 'staged' as const, label: '已暂存', hint: '已 git add，未提交', count: tabLists.value.staged.length },
  { key: 'untracked' as const, label: '未跟踪', hint: '工作区新文件', count: tabLists.value.untracked.length },
  { key: 'all' as const, label: '全部', hint: '全部更改', count: tabLists.value.all.length }
]);

const activeList = computed<FileStatus[]>(() => tabLists.value[activeTab.value] ?? []);
const totalFiles = computed(() => tabLists.value.all.length);

/** 分支树节点：叶子带 branch（fullName 为完整分支名），非叶子为按 '/' 拆分的目录 */
interface BranchTreeNode {
  key: string;
  label: string;
  fullName?: string;
  branch?: BranchInfo;
  remote?: boolean;
  children?: BranchTreeNode[];
}

/** 分支面板：本地分支 或 单个远程分组 */
interface BranchPane {
  key: string;
  title: string;
  tree: BranchTreeNode[];
}

/** 按 '/' 分层构建分支树（忽略空分段） */
function buildTree(entries: { name: string; branch: BranchInfo }[]): BranchTreeNode[] {
  const roots: BranchTreeNode[] = [];
  for (const { name, branch } of entries) {
    const parts = name.split('/').filter((p) => p.length > 0);
    if (parts.length === 0) continue;
    let level = roots;
    let prefix = '';
    for (const [i, part] of parts.entries()) {
      prefix = prefix ? `${prefix}/${part}` : part;
      const existing = level.find((n) => n.label === part);
      const node: BranchTreeNode = existing ?? { key: 'node:' + prefix, label: part };
      if (!existing) level.push(node);
      if (i === parts.length - 1) {
        node.branch = branch;
        node.fullName = name;
        node.remote = branch.remote;
      } else {
        if (!node.children) node.children = [];
        level = node.children;
      }
    }
  }
  sortTree(roots);
  return roots;
}

/** 每层排序：目录在前，同级按名称字典序 */
function sortTree(nodes: BranchTreeNode[]): void {
  nodes.sort((a, b) => {
    const ad = a.branch ? 1 : 0;
    const bd = b.branch ? 1 : 0;
    if (ad !== bd) return ad - bd;
    return a.label.localeCompare(b.label);
  });
  for (const n of nodes) if (n.children) sortTree(n.children);
}

/** 递归统计叶子（分支）数，供标题计数 */
function leafCount(nodes: BranchTreeNode[]): number {
  let n = 0;
  for (const node of nodes) n += node.branch ? 1 : leafCount(node.children ?? []);
  return n;
}

const branchPanes = computed<BranchPane[]>(() => {
  const locals = branches.value.filter((b) => !b.remote);
  const remotes = branches.value.filter((b) => b.remote);
  // 远程按前缀分组；跳过无实际分支名的残缺 ref（如仅名为 'origin' 的空条目，正是之前空行的来源）
  const remoteMap = new Map<string, { name: string; branch: BranchInfo }[]>();
  for (const r of remotes) {
    const slash = r.name.indexOf('/');
    const remoteName = slash === -1 ? '' : r.name.slice(0, slash);
    if (!remoteName) continue;
    const list = remoteMap.get(remoteName) ?? [];
    list.push({ name: r.name.slice(slash + 1), branch: r });
    remoteMap.set(remoteName, list);
  }
  const panes: BranchPane[] = [];
  if (locals.length) {
    panes.push({ key: 'local', title: `本地分支（${locals.length}）`, tree: buildTree(locals.map((b) => ({ name: b.name, branch: b }))) });
  }
  for (const [remote, list] of remoteMap) {
    const tree = buildTree(list);
    panes.push({ key: 'remote:' + remote, title: `远程 · ${remote}（${leafCount(tree)}）`, tree });
  }
  return panes;
});

function syncText(b?: BranchInfo): string {
  if (!b || b.remote || !b.upstream) return '';
  const parts: string[] = [];
  if ((b.ahead ?? 0) > 0) parts.push(`↑${b.ahead}`);
  if ((b.behind ?? 0) > 0) parts.push(`↓${b.behind}`);
  return parts.join(' ');
}

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
    /* 分支列表失败不阻塞状态页 */
  }
}

async function loadStashes(): Promise<void> {
  const id = repoId();
  if (id === null) return;
  try {
    stashes.value = await api.listStashes(id);
  } catch {
    /* stash 列表失败不阻塞状态页 */
  }
}

async function refresh(): Promise<void> {
  await Promise.all([loadStatus(), loadBranches(), loadStashes()]);
}

/** 通用写流程：dry-run 预览 → ConfirmDialog → 真实执行 → 刷新 */
async function run(tool: string, params: Record<string, unknown> = {}): Promise<void> {
  const ok = await previewAndConfirm(tool, params);
  if (ok) ElMessage.info('请在确认对话框中查看 dry-run 预览');
}

async function onConfirmed(): Promise<void> {
  const res = await executeConfirmed();
  if (res?.success) await refresh();
}

/** 文件行内操作 */
function stageFile(f: FileStatus): void {
  void run('git_add', { paths: [f.path] });
}
function unstageFile(f: FileStatus): void {
  void run('git_unstage', { paths: [f.path] });
}
function rowAction(f: FileStatus): void {
  if (f.staged) unstageFile(f);
  else stageFile(f);
}
function stageAll(): void {
  void run('git_add', {});
}
function unstageAll(): void {
  const all = status.value?.staged.map((f) => f.path) ?? [];
  if (all.length === 0) {
    ElMessage.info('没有已暂存的文件');
    return;
  }
  void run('git_unstage', { paths: all });
}

/** 查看单个文件差异 */
async function showDiff(f: FileStatus): Promise<void> {
  const id = repoId();
  if (id === null) return;
  drawer.title = `${f.path}（${f.staged ? '已 git add' : '工作区修改'}）`;
  drawer.diff = null;
  drawer.patch = '';
  drawer.visible = true;
  drawer.loading = true;
  try {
    drawer.diff = await api.getDiff(id, { path: f.path, staged: f.staged });
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : String(err));
    drawer.visible = false;
  } finally {
    drawer.loading = false;
  }
}

/** 查看一条 stash 的差异（只读工具，直接执行） */
async function showStashDiff(s: StashInfo): Promise<void> {
  const id = repoId();
  if (id === null) return;
  drawer.title = `${s.ref} · ${s.message || '（无说明）'}`;
  drawer.diff = null;
  drawer.patch = '';
  drawer.visible = true;
  drawer.loading = true;
  try {
    const exec: ToolExecResult = await api.runTool(id, 'git_stash_show', { index: s.index });
    if (exec.success) {
      const r = (exec.result as { patch?: string } | undefined) ?? {};
      drawer.patch = r.patch ?? '';
    } else {
      ElMessage.error(exec.error?.message ?? '查看差异失败');
      drawer.visible = false;
    }
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : String(err));
    drawer.visible = false;
  } finally {
    drawer.loading = false;
  }
}

/** 勾选交互 */
function toggleChecked(p: string): void {
  if (checkedFiles.has(p)) checkedFiles.delete(p);
  else checkedFiles.add(p);
}
function isChecked(p: string): boolean {
  return checkedFiles.has(p);
}
function clearChecked(): void {
  checkedFiles.clear();
}
function checkAllCurrentTab(): void {
  for (const f of activeList.value) checkedFiles.add(f.path);
}
function checkAllCandidates(): void {
  for (const p of stashCandidates.value) checkedFiles.add(p);
}

/** stash 可选文件：未暂存 + 未跟踪 */
const stashCandidates = computed<string[]>(() => {
  const s = status.value;
  if (!s) return [];
  const seen = new Set<string>();
  return [...s.unstaged.map((f) => f.path), ...s.untracked].filter((p) => {
    if (seen.has(p)) return false;
    seen.add(p);
    return p !== '';
  });
});

function openStashDialog(): void {
  stashVisible.value = true;
}
function confirmStash(): void {
  const candidates = stashCandidates.value;
  const selected = [...checkedFiles].filter((p) => candidates.includes(p));
  const hasUntracked = selected.some((p) => status.value?.untracked.includes(p) ?? false);
  const params: Record<string, unknown> = {};
  if (stashMessage.value.trim()) params.message = stashMessage.value.trim();
  if (selected.length) params.paths = selected;
  if (stashIncludeUntracked.value || hasUntracked) params.includeUntracked = true;
  stashVisible.value = false;
  checkedFiles.clear();
  void run('git_stash', params);
}

/** 静默暂存（对应 WebStorm Shelve Silently）：默认说明，跳过参数录入，直接预览确认 */
function silentStash(): void {
  void run('git_stash', {});
}

/** stash 行内操作 */
function applyStash(s: StashInfo): void {
  void run('git_stash_apply', { index: s.index });
}
function popStash(s: StashInfo): void {
  void run('git_stash_pop', { index: s.index });
}
function dropStash(s: StashInfo): void {
  ElMessageBox.confirm(`确定删除 ${s.ref} 吗？删除后不可直接恢复。`, '删除 stash', {
    type: 'warning',
    confirmButtonText: '继续',
    cancelButtonText: '取消'
  })
    .then(() => void run('git_stash_drop', { index: s.index }))
    .catch(() => undefined);
}

/** 分支树节点操作 */
function checkoutNode(n: BranchTreeNode): void {
  if (n.branch) void run('git_checkout', { branch: n.branch.name });
}
function pull(): void {
  void run('git_pull');
}
function push(): void {
  void run('git_push');
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
function confirmReset(): void {
  const target = resetTarget.value.trim() || 'HEAD';
  resetVisible.value = false;
  resetTarget.value = '';
  void run('git_reset_hard', { target });
}

function statusLetter(f: FileStatus): string {
  if (f.untracked) return '?';
  return f.staged ? (f.indexStatus || 'M') : (f.workTreeStatus || 'M');
}
function statusClass(f: FileStatus): string {
  if (f.untracked) return 'new';
  if (f.conflicted) return 'conflict';
  return f.staged ? 'add' : 'mod';
}
function formatDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}
function firstLine(msg: string): string {
  return msg.split('\n')[0] ?? '';
}

watch(repoId, () => {
  drawer.diff = null;
  drawer.patch = '';
  drawer.visible = false;
  checkedFiles.clear();
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
  <div class="page status-page">
    <!-- 顶部：标题 + 当前分支信息（与右侧操作按钮分离） -->
    <div class="page-head">
      <h2 class="page-title">仓库状态</h2>
      <div class="head-branch">
        <el-tag type="primary" effect="dark" class="branch-tag">{{ currentBranch || '—' }}</el-tag>
        <span v-if="status?.tracking" class="tracking mono">{{ status.tracking }}</span>
        <span v-if="ahead" class="sync ahead">↑{{ ahead }}</span>
        <span v-if="behind" class="sync behind">↓{{ behind }}</span>
        <el-tag v-if="status?.isClean" type="success" effect="plain" size="small">工作区干净</el-tag>
        <el-tag v-else-if="status" type="warning" effect="plain" size="small">{{ totalFiles }} 处更改</el-tag>
        <span class="repo-path mono">{{ currentPath }}</span>
      </div>
      <el-button :loading="loading" @click="refresh">刷新</el-button>
    </div>

    <el-alert v-if="loadError" :title="loadError" type="error" :closable="false" show-icon class="mb" />
    <div v-if="!canRun" class="empty-tip">请先在「仓库管理」中打开一个仓库</div>

    <div v-else class="status-layout">
      <!-- 左：分支树 -->
      <el-card shadow="never" class="branch-panel">
        <template #header>
          <div class="panel-head">
            <span class="panel-title">分支 Branch</span>
            <div class="panel-actions">
              <el-button size="small" text @click="loadBranches">刷新</el-button>
              <el-button size="small" text type="primary" @click="branchVisible = true">+ 新建</el-button>
            </div>
          </div>
        </template>
        <div class="tree-scroll">
          <template v-for="pane in branchPanes" :key="pane.key">
            <div class="group-label">{{ pane.title }}</div>
            <el-tree
              v-if="pane.tree.length"
              :data="pane.tree"
              :props="{ label: 'label', children: 'children' }"
              node-key="key"
              default-expand-all
              :indent="14"
              class="branch-tree"
            >
              <template #default="{ data }">
                <span v-if="!data.branch" class="tree-dir">{{ data.label }}</span>
                <div
                  v-else
                  class="branch-node"
                  :class="{ current: data.branch?.current, remote: data.remote }"
                  :title="data.fullName"
                  @dblclick="data.branch?.current || checkoutNode(data)"
                >
                  <span class="node-name">{{ data.label }}</span>
                  <span v-if="!data.remote" class="node-sync" :class="{ clean: !syncText(data.branch) && data.branch?.upstream }">{{ syncText(data.branch) }}</span>
                  <span class="node-actions">
                    <template v-if="data.branch?.current">
                      <el-button size="small" text type="success" @click.stop="pull">拉取</el-button>
                      <el-button size="small" text type="primary" @click.stop="push">推送</el-button>
                    </template>
                    <el-button v-else size="small" text type="primary" @click.stop="checkoutNode(data)">切换</el-button>
                  </span>
                </div>
              </template>
            </el-tree>
            <div v-else class="pane-empty">暂无分支</div>
          </template>
          <el-empty v-if="branchPanes.length === 0" description="暂无分支" :image-size="60" />
        </div>
      </el-card>

      <!-- 右：状态内容（垂直弹性布局） -->
      <div class="status-content">
        <!-- 工具栏 -->
        <el-card shadow="never" class="toolbar-card">
          <div class="toolbar">
            <div class="toolbar-group">
              <el-button type="primary" @click="commitVisible = true">提交 Commit</el-button>
              <el-button plain @click="stageAll">暂存全部</el-button>
              <el-button plain :disabled="(status?.staged.length ?? 0) === 0" @click="unstageAll">取消暂存全部</el-button>
              <el-badge :value="checkedCount" :hidden="checkedCount === 0" :offset="[2, 4]">
                <el-button type="success" plain @click="openStashDialog">暂存改动 Stash</el-button>
              </el-badge>
              <el-tooltip content="Shelve Silently：使用默认说明，一键暂存全部更改" placement="top">
                <el-button plain @click="silentStash">静默 Stash</el-button>
              </el-tooltip>
              <el-button type="danger" plain @click="resetVisible = true">硬重置</el-button>
              <el-button type="danger" plain @click="run('git_clean')">清理未跟踪</el-button>
            </div>
          </div>
        </el-card>

        <el-alert
          v-if="status?.conflicted.length"
          title="存在合并冲突，请先解决冲突（修改文件后重新 git add 并提交）"
          type="error"
          :closable="false"
          show-icon
          class="mb"
        />

        <!-- 更改文件 -->
        <el-card shadow="never" class="changes-card">
          <template #header>
            <div class="card-head">
              <span class="card-title">更改 Changes</span>
              <div class="card-actions">
                <el-tag v-if="checkedCount" size="small" type="primary" effect="plain">已选 {{ checkedCount }}</el-tag>
                <el-button size="small" text @click="checkAllCurrentTab">全选本组</el-button>
                <el-button v-if="checkedCount" size="small" text type="danger" @click="clearChecked">清除选择</el-button>
              </div>
            </div>
          </template>
          <el-tabs v-model="activeTab" class="changes-tabs">
            <el-tab-pane v-for="t in tabs" :key="t.key" :name="t.key">
              <template #label>
                <span class="tab-label">
                  {{ t.label }}
                  <el-badge :value="t.count" :hidden="t.count === 0" type="primary" class="tab-badge" />
                </span>
              </template>
              <div class="tab-hint">「{{ t.hint }}」</div>
              <div v-if="t.count === 0" class="file-empty">没有{{ t.label }}的文件</div>
              <div v-else class="file-list">
                <div v-for="f in tabLists[t.key]" :key="t.key + f.path" class="file-row">
                  <el-checkbox :model-value="isChecked(f.path)" @change="toggleChecked(f.path)" />
                  <span class="file-status" :class="statusClass(f)">{{ statusLetter(f) }}</span>
                  <span class="file-path mono" :title="f.path">{{ f.path }}</span>
                  <el-button size="small" text type="primary" @click="showDiff(f)">查看差异</el-button>
                  <el-button v-if="f.conflicted" size="small" text type="warning" @click="stageFile(f)">标记已解决(git add)</el-button>
                  <el-button v-else size="small" text :type="f.staged ? 'warning' : 'success'" @click="rowAction(f)">
                    {{ f.staged ? '取消暂存' : '暂存' }}
                  </el-button>
                </div>
              </div>
            </el-tab-pane>
          </el-tabs>
        </el-card>

        <!-- 暂存列表 -->
        <el-card shadow="never" class="stash-card">
          <template #header>
            <div class="card-head">
              <span class="card-title">暂存列表 Stash（{{ stashes.length }}）</span>
              <div class="card-actions">
                <el-button size="small" text @click="loadStashes">刷新</el-button>
              </div>
            </div>
          </template>
          <div v-if="stashes.length === 0" class="file-empty">没有暂存的更改</div>
          <div v-else class="stash-list mono">
            <div v-for="s in stashes" :key="s.ref" class="stash-row">
              <div class="stash-main">
                <span class="stash-ref">{{ s.ref }}</span>
                <span class="stash-msg" :title="s.message">{{ firstLine(s.message) || '（无说明）' }}</span>
                <span v-if="s.date" class="stash-date">{{ formatDate(s.date) }}</span>
              </div>
              <div class="stash-actions">
                <el-button size="small" text type="primary" @click="showStashDiff(s)">差异</el-button>
                <el-button size="small" text type="success" @click="applyStash(s)">应用</el-button>
                <el-button size="small" text type="warning" @click="popStash(s)">恢复</el-button>
                <el-button size="small" text type="danger" @click="dropStash(s)">删除</el-button>
              </div>
            </div>
          </div>
        </el-card>
      </div>
    </div>

    <!-- 写操作确认对话框 -->
    <ConfirmDialog v-model:visible="confirmVisible" :tool="pending?.tool ?? ''" :preview="pending?.preview ?? null" @confirm="onConfirmed" @cancel="cancel" />

    <!-- 差异抽屉 -->
    <el-drawer v-model="drawer.visible" :title="drawer.title" size="56%" destroy-on-close>
      <div v-loading="drawer.loading" class="diff-wrap">
        <template v-if="drawer.diff">
          <div class="diff-summary">
            <span>{{ drawer.diff.files.length }} 个文件</span>
            <span class="add">+{{ drawer.diff.insertions }}</span>
            <span class="del">-{{ drawer.diff.deletions }}</span>
            <span v-if="drawer.diff.truncated" class="warn">（已截断）</span>
          </div>
          <DiffViewer :patch="drawer.diff.rawPatch" />
        </template>
        <template v-else-if="drawer.patch">
          <div v-if="!drawer.patch" class="file-empty">无差异</div>
          <DiffViewer v-else :patch="drawer.patch" />
        </template>
        <el-empty v-else-if="!drawer.loading" description="无差异" :image-size="60" />
      </div>
    </el-drawer>

    <!-- 提交 -->
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
      <el-form label-width="100px">
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

    <!-- stash：选择文件 + 静默选项 -->
    <el-dialog v-model="stashVisible" title="暂存改动 Stash" width="560px">
      <el-alert
        class="stash-tip"
        title="可勾选左侧更改列表的文件随本次 stash 一起保存；不勾选则保存全部更改。"
        type="info"
        :closable="false"
        show-icon
      />
      <el-form label-width="90px">
        <el-form-item label="说明（可选）">
          <el-input v-model="stashMessage" placeholder="留空则使用默认说明（WIP on 分支: 提交）" />
        </el-form-item>
        <el-form-item label="包含未跟踪">
          <el-checkbox v-model="stashIncludeUntracked">包含未跟踪文件（-u）。勾选文件后会自动包含其中的未跟踪文件</el-checkbox>
        </el-form-item>
      </el-form>
      <div v-if="stashCandidates.length" class="stash-files">
        <div class="stash-files-head">
          <span class="stash-files-title">选择文件（已选 {{ checkedCount }}）</span>
          <div class="card-actions">
            <el-button size="small" text @click="checkAllCandidates">全选</el-button>
            <el-button size="small" text @click="clearChecked">清除选择</el-button>
          </div>
        </div>
        <div class="file-list compact">
          <div v-for="p in stashCandidates" :key="p" class="file-row">
            <el-checkbox :model-value="isChecked(p)" @change="toggleChecked(p)" />
            <span class="file-status" :class="status?.untracked.includes(p) ? 'new' : 'mod'">
              {{ status?.untracked.includes(p) ? '?' : 'M' }}
            </span>
            <span class="file-path mono">{{ p }}</span>
          </div>
        </div>
      </div>
      <template #footer>
        <el-button @click="stashVisible = false">取消</el-button>
        <el-button type="primary" @click="confirmStash">下一步（dry-run 预览）</el-button>
      </template>
    </el-dialog>

    <!-- 硬重置 -->
    <el-dialog v-model="resetVisible" title="硬重置（高风险）" width="480px" @closed="resetTarget = ''">
      <el-alert title="将丢弃索引与工作区所有更改（不可逆），执行前会自动创建备份" type="error" :closable="false" show-icon class="mb" />
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
  margin: 0;
  font-size: 14px;
  flex: none;
}
.mb {
  margin-bottom: var(--gc-gap);
}
.empty-tip {
  padding: 40px 0;
  text-align: center;
  color: var(--el-text-color-secondary);
  border: 1px dashed var(--el-border-color);
  border-radius: 8px;
}

/* 整体两栏布局：占满剩余高度 */
.status-page {
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: var(--gc-gap);
  overflow: hidden;
}
.page-head {
  display: flex;
  align-items: center;
  gap: var(--gc-gap);
  flex: none;
}
.head-branch {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  overflow: hidden;
}
.branch-tag {
  flex: none;
}
.tracking {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sync {
  font-size: 12px;
  flex: none;
}
.sync.ahead {
  color: var(--el-color-success);
}
.sync.behind {
  color: var(--el-color-warning);
}
.repo-path {
  font-size: 12px;
  color: var(--el-text-color-regular);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.status-layout {
  flex: 1;
  min-height: 0;
  display: flex;
  gap: var(--gc-gap);
}

/* 左：分支树（内部滚动，占满高度） */
.branch-panel {
  width: 300px;
  flex: none;
  display: flex;
  flex-direction: column;
  height: 100%;
}
.branch-panel :deep(.el-card__header) {
  padding: 8px 12px;
}
.branch-panel :deep(.el-card__body) {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 8px;
}
.panel-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.panel-title {
  font-weight: 600;
  font-size: 13px;
}
.panel-actions {
  display: flex;
  gap: 2px;
}
.tree-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}
.group-label {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  padding: 8px 8px 4px;
}
/* 分支树（el-tree）紧凑适配 */
.branch-tree {
  background: transparent;
  --el-tree-node-hover-bg-color: var(--el-fill-color-extra-light);
}
.branch-tree :deep(.el-tree-node__content) {
  height: 28px;
  padding-right: 4px;
}
.branch-tree :deep(.el-tree-node__expand-icon) {
  font-size: 11px;
  flex: none;
}
.branch-tree :deep(.branch-node),
.branch-tree :deep(.tree-dir) {
  flex: 1;
  min-width: 0;
}
.tree-dir {
  font-size: 12px;
  font-weight: 600;
  color: var(--el-text-color-regular);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pane-empty {
  padding: 8px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.branch-node {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  border-radius: 6px;
  cursor: pointer;
  user-select: none;
}
.branch-node:hover {
  background: var(--el-fill-color-light);
}
.branch-node.current {
  background: var(--el-color-primary-light-9);
}
.branch-node.remote .node-name {
  color: var(--el-text-color-secondary);
}
.node-name {
  flex: 1;
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: 'JetBrains Mono', 'Cascadia Code', Consolas, monospace;
}
.branch-node.current .node-name {
  font-weight: 600;
  color: var(--el-color-primary);
}
.node-sync {
  flex: none;
  font-size: 11px;
  color: var(--el-color-primary);
}
.node-sync.clean {
  color: var(--el-text-color-disabled);
}
.node-actions {
  flex: none;
  visibility: hidden;
  display: flex;
  gap: 2px;
}
.branch-node:hover .node-actions {
  visibility: visible;
}

/* 右：垂直弹性布局 */
.status-content {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--gc-gap);
}
.toolbar-card {
  flex: none;
}
.toolbar-card :deep(.el-card__body) {
  padding: 8px 12px;
}
.toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.toolbar-group {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
}

/* 更改卡片：弹性占位，Tab 内容内部滚动 */
.changes-card {
  flex: 1 1 0;
  min-height: 160px;
  display: flex;
  flex-direction: column;
}
.changes-card :deep(.el-card__header) {
  padding: 8px 12px;
}
.changes-card :deep(.el-card__body) {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 0 12px 8px;
}
.card-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.card-title {
  font-weight: 600;
  font-size: 13px;
}
.card-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.changes-tabs {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.changes-tabs :deep(.el-tabs__header) {
  margin: 0;
  flex: none;
}
.changes-tabs :deep(.el-tabs__content) {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
.changes-tabs :deep(.el-tab-pane) {
  height: 100%;
  display: flex;
  flex-direction: column;
}
.tab-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.tab-badge {
  margin-right: 2px;
}
.tab-hint {
  flex: none;
  font-size: 12px;
  color: var(--el-text-color-placeholder);
  padding: 4px 2px 8px;
  border-bottom: 1px solid var(--el-border-color-lighter);
}
.file-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--el-text-color-secondary);
  font-size: 13px;
  padding: 20px 0;
}
.file-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 4px 2px 8px;
}
.file-list.compact {
  flex: none;
  max-height: 180px;
  overflow-y: auto;
}
.file-row {
  display: flex;
  align-items: center;
  gap: var(--gc-gap);
  padding: 4px;
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
.file-status.conflict {
  background: var(--el-color-danger);
}
.file-path {
  flex: 1;
  font-size: 12px;
  font-family: 'JetBrains Mono', 'Cascadia Code', Consolas, monospace;
  word-break: break-all;
}

/* Stash 列表卡片 */
.stash-card {
  flex: 1 1 0;
  min-height: 140px;
  display: flex;
  flex-direction: column;
}
.stash-card :deep(.el-card__header) {
  padding: 8px 12px;
}
.stash-card :deep(.el-card__body) {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 4px 12px 8px;
}
.stash-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}
.stash-row {
  display: flex;
  align-items: center;
  gap: var(--gc-gap);
  padding: 4px 2px;
  border-bottom: 1px solid var(--el-border-color-lighter);
}
.stash-row:last-child {
  border-bottom: none;
}
.stash-main {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: var(--gc-gap);
}
.stash-ref {
  flex: none;
  color: var(--el-color-primary);
  font-weight: 600;
}
.stash-msg {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.stash-date {
  flex: none;
  font-size: 11px;
  color: var(--el-text-color-secondary);
}
.stash-actions {
  flex: none;
  display: flex;
}

/* stash 弹窗 */
.stash-tip {
  margin-bottom: 12px;
}
.stash-files {
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
  padding: 6px 8px;
}
.stash-files-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0 4px 4px;
}
.stash-files-title {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

/* 差异抽屉 */
.diff-summary {
  display: flex;
  gap: var(--gc-gap);
  font-size: 12px;
  margin-bottom: var(--gc-gap);
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