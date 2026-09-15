export type Attention = 'clean' | 'dirty' | 'sync' | 'stuck';

export interface MockRepo {
  id: number;
  name: string;
  path: string;
  branch: string;
  ahead: number;
  behind: number;
  dirty: number;
  conflicts: number;
  operation: 'none' | 'merge' | 'rebase';
  drafts: number;
  attention: Attention;
  activity: number[];
  lastOpened: string;
  available?: boolean;
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function activityFrom(seed: string): number[] {
  const out: number[] = [];
  let h = hash(seed);
  for (let i = 0; i < 84; i++) {
    h = (Math.imul(h, 1664525) + 1013904223) >>> 0;
    const n = h % 13;
    out.push(n > 9 ? n - 7 : n > 6 ? 1 : 0);
  }
  return out;
}

export const mockRepos: MockRepo[] = [
  {
    id: 1,
    name: 'git-cockpit',
    path: 'D:\\_myproject\\git-cockpit',
    branch: 'feat/ui-lab',
    ahead: 3,
    behind: 1,
    dirty: 7,
    conflicts: 0,
    operation: 'none',
    drafts: 1,
    attention: 'dirty',
    activity: activityFrom('git-cockpit'),
    lastOpened: '今天 16:20'
  },
  {
    id: 2,
    name: 'ops-portal',
    path: 'D:\\work\\ops-portal',
    branch: 'hotfix/login',
    ahead: 2,
    behind: 0,
    dirty: 12,
    conflicts: 3,
    operation: 'merge',
    drafts: 0,
    attention: 'stuck',
    activity: activityFrom('ops-portal'),
    lastOpened: '今天 14:02'
  },
  {
    id: 3,
    name: 'payment-core',
    path: 'D:\\work\\payment-core',
    branch: 'release/3.2',
    ahead: 0,
    behind: 4,
    dirty: 0,
    conflicts: 0,
    operation: 'none',
    drafts: 0,
    attention: 'sync',
    activity: activityFrom('payment-core'),
    lastOpened: '昨天 19:40'
  },
  {
    id: 4,
    name: 'mobile-wallet',
    path: 'D:\\work\\mobile-wallet',
    branch: 'feat/pay-sheet',
    ahead: 8,
    behind: 0,
    dirty: 12,
    conflicts: 0,
    operation: 'none',
    drafts: 0,
    attention: 'dirty',
    activity: activityFrom('mobile-wallet'),
    lastOpened: '昨天 11:18'
  },
  {
    id: 5,
    name: 'design-tokens',
    path: 'D:\\work\\design-tokens',
    branch: 'main',
    ahead: 0,
    behind: 0,
    dirty: 0,
    conflicts: 0,
    operation: 'none',
    drafts: 0,
    attention: 'clean',
    activity: activityFrom('design-tokens'),
    lastOpened: '周一 09:12'
  },
  {
    id: 6,
    name: 'infra-playbooks',
    path: 'D:\\work\\infra-playbooks',
    branch: 'develop',
    ahead: 0,
    behind: 2,
    dirty: 0,
    conflicts: 0,
    operation: 'none',
    drafts: 2,
    attention: 'sync',
    activity: activityFrom('infra-playbooks'),
    lastOpened: '上周五'
  },
  {
    id: 7,
    name: 'legacy-billing',
    path: 'D:\\work\\legacy-billing',
    branch: '—',
    ahead: 0,
    behind: 0,
    dirty: 0,
    conflicts: 0,
    operation: 'none',
    drafts: 0,
    attention: 'stuck',
    activity: activityFrom('legacy-billing'),
    lastOpened: '路径不存在',
    available: false
  }
];

export const mockFiles = [
  { path: 'packages/web/src/App.vue', letter: 'M', kind: 'mod' as const, staged: false },
  { path: 'packages/web/src/views/ReposView.vue', letter: 'M', kind: 'mod' as const, staged: false },
  { path: 'packages/web/src/theme.css', letter: 'M', kind: 'mod' as const, staged: true },
  { path: 'packages/web/src/router.ts', letter: 'M', kind: 'mod' as const, staged: true },
  { path: 'packages/web/src/views/ui-lab/UiLabHub.vue', letter: '?', kind: 'new' as const, staged: false },
  { path: 'packages/web/src/views/ui-lab/mock.ts', letter: '?', kind: 'new' as const, staged: false },
  { path: 'docs/设计文档.md', letter: 'M', kind: 'mod' as const, staged: false }
];

export const mockConflict = {
  path: 'packages/web/src/App.vue',
  ours: `const menuWork = [
  { path: '/dashboard', label: '工作台' },
  { path: '/status', label: '状态' },
  { path: '/merge', label: '合并' }
];`,
  theirs: `const menuWork = computed(() =>
  settings.llm?.tokenSet
    ? [menuChat, ...menuWorkRest]
    : [...menuWorkRest, menuChat]
);`
};

export const mockCommits = [
  { sha: 'b7c21a4', msg: 'feat: 布局实验室入口', time: '16 分钟前', author: 'you' },
  { sha: '9e10d2c', msg: 'fix: 合并预演截断冲突正文', time: '2 小时前', author: 'you' },
  { sha: '3aa81f0', msg: 'chore: 收紧卡片间距', time: '昨天', author: 'lin' },
  { sha: 'c12e90b', msg: 'feat: 工作台仓库筛选芯片', time: '昨天', author: 'you' }
];

export const mockJobs = [
  {
    id: 'j1',
    kind: 'fetch',
    title: 'fetch origin → D:\\work\\payment-core',
    status: 'running' as const,
    time: '进行中',
    tail: 'Receiving objects: 62%',
    logs: ['$ git fetch origin --prune', 'remote: Counting objects: 128', 'Receiving objects: 62%']
  },
  {
    id: 'j2',
    kind: 'survey',
    title: '矩阵扫描 → git-cockpit',
    status: 'error' as const,
    time: '12 分钟前',
    tail: 'SURVEY_TOO_LARGE：组合超过 200',
    logs: ['扫描 18 条 from × 12 条 into', 'error SURVEY_TOO_LARGE']
  },
  {
    id: 'j3',
    kind: 'clone',
    title: 'https://github.com/acme/tokens.git → D:\\work\\design-tokens',
    status: 'ok' as const,
    time: '昨天',
    tail: 'done.',
    logs: ['Cloning into D:\\work\\design-tokens', 'Receiving objects: 100%', 'done.']
  },
  {
    id: 'j4',
    kind: 'clone',
    title: 'https://github.com/acme/ghost.git → D:\\work\\ghost',
    status: 'error' as const,
    time: '3 小时前',
    tail: 'destination path already exists and is not an empty directory',
    logs: ['Cloning into D:\\work\\ghost', 'fatal: destination path already exists and is not an empty directory']
  }
];

export const mockLogs = [
  { time: '今天 16:18:02', source: 'chat', tool: 'git_commit', result: 'ok', dryRun: true, repo: 'git-cockpit' },
  { time: '今天 16:12:40', source: 'web', tool: 'git_add', result: 'ok', dryRun: false, repo: 'git-cockpit' },
  { time: '今天 15:40:11', source: 'mcp', tool: 'git_merge_preview', result: 'ok', dryRun: false, repo: 'ops-portal' },
  { time: '昨天 19:02:18', source: 'web', tool: 'git_push_force', result: 'denied', dryRun: false, repo: 'payment-core' },
  { time: '昨天 11:20:04', source: 'cli', tool: 'git_stash_push', result: 'ok', dryRun: false, repo: 'git-cockpit' }
];

export const mockMatrix = [
  { from: 'feat/ui-lab', into: 'main', cell: 'clean' as const },
  { from: 'hotfix/login', into: 'main', cell: 'conflict' as const },
  { from: 'release/3.2', into: 'main', cell: 'behind' as const },
  { from: 'feat/pay-sheet', into: 'main', cell: 'landed' as const },
  { from: 'develop', into: 'main', cell: 'clean' as const },
  { from: 'main', into: 'release/3.2', cell: 'same' as const }
];

export const mockStashes = [
  { ref: 'stash@{0}', msg: 'WIP: 布局实验室', time: '今天 15:01' },
  { ref: 'stash@{1}', msg: '试 matrix 星图', time: '昨天 18:22' }
];
export const mockBackups = [
  { name: 'backup/pre-reset-feat-ui-lab', time: '今天 11:20' },
  { name: 'backup/pre-rebase-hotfix', time: '周一 09:40' }
];
export const mockReflog = [
  { ref: 'HEAD@{0}', msg: 'commit: feat: 布局实验室入口', time: '16 分钟前' },
  { ref: 'HEAD@{1}', msg: 'checkout: moving from main to feat/ui-lab', time: '昨天' },
  { ref: 'HEAD@{2}', msg: 'pull: Fast-forward', time: '昨天' }
];
export const mockWorktrees = [
  { path: 'D:\\_myproject\\git-cockpit', branch: 'feat/ui-lab', main: true },
  { path: 'D:\\wt\\git-cockpit-mr', branch: 'merge/feat-ui-lab-into-origin-main', main: false }
];

export const mockGitTools = [
  { id: 'git_reset_hard', label: '硬重置', on: false, risk: 'high' as const },
  { id: 'git_clean', label: '清理未跟踪', on: false, risk: 'high' as const },
  { id: 'git_push_force', label: '强制推送', on: false, risk: 'high' as const },
  { id: 'git_rebase', label: '变基', on: false, risk: 'high' as const },
  { id: 'git_commit', label: '提交', on: true, risk: 'write' as const },
  { id: 'git_push', label: '推送', on: true, risk: 'write' as const }
];

export const mockTemplateFields = [
  { key: 'what', label: '做了什么', required: true },
  { key: 'how', label: '怎么验', required: true },
  { key: 'risk', label: '风险', required: false }
];

export const mockMatrixIntos = ['origin/main', 'release/3.2'];
export const mockMatrixFroms = ['feat/ui-lab', 'hotfix/login', 'feat/pay-sheet', 'develop'];
export const mockMatrixCells: Array<{
  from: string;
  into: string;
  outcome: 'clean' | 'conflicts' | 'unrelated' | 'same' | 'error';
  stage: '' | 'local' | 'resolved' | 'mr';
}> = [
  { from: 'feat/ui-lab', into: 'origin/main', outcome: 'clean', stage: '' },
  { from: 'hotfix/login', into: 'origin/main', outcome: 'conflicts', stage: '' },
  { from: 'feat/pay-sheet', into: 'origin/main', outcome: 'clean', stage: 'local' },
  { from: 'develop', into: 'origin/main', outcome: 'same', stage: '' },
  { from: 'feat/ui-lab', into: 'release/3.2', outcome: 'conflicts', stage: 'resolved' },
  { from: 'hotfix/login', into: 'release/3.2', outcome: 'unrelated', stage: '' },
  { from: 'feat/pay-sheet', into: 'release/3.2', outcome: 'error', stage: '' },
  { from: 'develop', into: 'release/3.2', outcome: 'clean', stage: 'mr' }
];

export function matrixText(o: (typeof mockMatrixCells)[number]['outcome']): string {
  if (o === 'conflicts') return '冲突';
  if (o === 'unrelated') return '无共祖';
  if (o === 'same') return '同名';
  if (o === 'error') return '失败';
  return '干净';
}

export const mockSettings = {
  llm: { model: 'gpt-4.1', baseUrl: '', tokenPreview: 'sk-••••wxyz', tokenSet: true },
  mr: { method: 'cli', remote: 'origin', gh: '已登录', glab: '未安装' },
  git: { dryRunDefault: false, allowed: '（空 = 不限制）' }
};

export type Edge = 'ok' | 'offline' | 'empty' | 'nokey';

export const edgeHints: Record<Edge, string> = {
  ok: '有仓、有 Key、有任务。主路径。',
  offline: '后端离线。所有写入口停，只留空态和重连。',
  empty: '还没打开仓库。工作台/状态/合并都该把人送去打开或克隆。',
  nokey: '仓在，模型 Key 没有。聊天不能发，设置模型 Tab 要醒目。'
};

export function matrixLabel(cell: (typeof mockMatrix)[number]['cell']): string {
  if (cell === 'conflict') return '冲突';
  if (cell === 'behind') return '落后';
  if (cell === 'landed') return '已落盘';
  if (cell === 'same') return '—';
  return '干净';
}

export const mockChat = [
  { role: 'user' as const, text: '看看改了什么，能不能干净合进 main' },
  {
    role: 'assistant' as const,
    text: '当前 feat/ui-lab 相对 origin/main 超前 3、落后 1，工作区 7 个文件未提交。预演结果：可干净合并。要先提交再落盘，还是只看正文？'
  },
  { role: 'user' as const, text: '先帮我提交这些布局草稿' },
  {
    role: 'assistant' as const,
    text: '将执行 git commit。建议信息：\n\nfeat(web): 增加四套布局实验室 demo\n\n点确认后才会真正写入。'
  }
];

export const paletteActions = [
  { id: 'status', group: '仓库', label: '打开状态', hint: '工作区 · 图 · 日志' },
  { id: 'merge', group: '合并', label: '预演合进 main', hint: 'feat/ui-lab → origin/main' },
  { id: 'commit', group: '工作区', label: '提交 7 个更改', hint: '先 dry-run' },
  { id: 'fetch', group: '远程', label: '抓取选中仓库', hint: 'fetch --prune' },
  { id: 'mr', group: '合并', label: '申请 MR 正文', hint: 'dry_run，不真开' },
  { id: 'chat', group: '助手', label: '问一句：卡住了吗', hint: '聊天侧栏' },
  { id: 'jobs', group: '系统', label: '看正在跑的任务', hint: '1 个 fetch' },
  { id: 'settings', group: '系统', label: '打开设置', hint: '模型 / Token' }
];

export function weatherOf(a: Attention): string {
  if (a === 'stuck') return '雷雨';
  if (a === 'dirty') return '薄雾';
  if (a === 'sync') return '刮风';
  return '晴天';
}

export function weatherHint(a: Attention): string {
  if (a === 'stuck') return '工作区卡住，或还有冲突';
  if (a === 'dirty') return '有未提交的更改';
  if (a === 'sync') return '超前或落后远程';
  return '干净，可以先不管';
}

export const mockDiffLines: Array<{ kind: 'del' | 'add' | 'ctx'; text: string }> = [
  { kind: 'ctx', text: ' const menuChat = { path: \'/chat\', label: \'聊天\' };' },
  { kind: 'del', text: '-const menuWork = [...menuWorkRest, menuChat];' },
  { kind: 'add', text: '+const menuWork = computed(() =>' },
  { kind: 'add', text: '+  settings.llm?.tokenSet' },
  { kind: 'add', text: '+    ? [menuChat, ...menuWorkRest]' },
  { kind: 'add', text: '+    : [...menuWorkRest, menuChat]' },
  { kind: 'add', text: '+);' },
  { kind: 'ctx', text: ' const menuSystem = [' }
];

export const labDemos = [
  {
    id: 'deck',
    path: '/ui-lab/deck',
    name: 'Deck',
    title: '整合方案',
    tag: '全模块示意 · mock · 边界态',
    pitch: '工作台 / 状态 / 合并（含矩阵）/ 聊天 / 任务 / 日志 / 设置。顶上可切离线、无仓、无 Key。'
  },
  {
    id: 'cards',
    path: '/ui-lab/board-cards',
    name: '仓卡',
    title: '工作台卡片方案',
    tag: '按钮过多 · 两个刷新',
    pitch: '卡片零按钮，⋯ 菜单挂 body。刷新对全部可用仓 fetch，合成一条 Job。'
  },
  {
    id: 'aurora',
    path: '/ui-lab/aurora',
    name: 'Aurora',
    title: '指挥台',
    tag: '玻璃 · 光晕 · 底栏',
    pitch: '当前仓做主角，其它仓收成马赛克。导航沉到底部，聊天从底栏升起。'
  },
  {
    id: 'orbit',
    path: '/ui-lab/orbit',
    name: 'Orbit',
    title: '命令优先',
    tag: '⌘K · 顶栏 · 侧聊',
    pitch: '少铬、多空气。仓库是宽松行，聊天是右抽屉，所有动作进命令面板。'
  },
  {
    id: 'studio',
    path: '/ui-lab/studio',
    name: 'Studio',
    title: '合并剧场',
    tag: '分栏 · 河流 · 选边',
    pitch: '状态像剪辑台，合并像两条河汇流。冲突文件是舞台，不是表格。'
  },
  {
    id: 'grove',
    path: '/ui-lab/grove',
    name: 'Grove',
    title: '园圃',
    tag: '暖色 · 天气 · 嫁接',
    pitch: '仓是地块，热力是苔藓，卡住像雷雨。合并画成嫁接，聊天是手帐。'
  }
] as const;

export function attentionLabel(a: Attention): string {
  if (a === 'stuck') return '卡住';
  if (a === 'dirty') return '有更改';
  if (a === 'sync') return '未同步';
  return '干净';
}

export function heatLevel(n: number): number {
  if (n <= 0) return 0;
  if (n === 1) return 1;
  if (n <= 3) return 2;
  if (n <= 6) return 3;
  return 4;
}
