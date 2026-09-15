<script setup lang="ts">
import { computed, ref } from 'vue';
import DemoFrame from './DemoFrame.vue';
import MiniHeat from './MiniHeat.vue';
import DeckJobs from './DeckJobs.vue';
import DeckLogs from './DeckLogs.vue';
import DeckSettings from './DeckSettings.vue';
import {
  edgeHints,
  mockBackups,
  mockChat,
  mockCommits,
  mockConflict,
  mockDiffLines,
  mockFiles,
  mockJobs,
  mockMatrixCells,
  mockMatrixFroms,
  mockMatrixIntos,
  mockReflog,
  mockRepos,
  mockStashes,
  mockWorktrees,
  matrixText,
  weatherHint,
  weatherOf,
  type Attention,
  type Edge,
  type MockRepo
} from './mock';

type Scene = 'board' | 'status' | 'merge' | 'jobs' | 'logs' | 'settings';
type Side = 'ours' | 'theirs' | null;
type StatusMode = 'workspace' | 'graph' | 'log';
type RecordTab = 'stash' | 'backup' | 'reflog' | 'worktree';
type MergeMode = 'pair' | 'matrix';

const scene = ref<Scene>('board');
const chatOpen = ref(false);
const currentId = ref(1);
const filter = ref<Attention | 'all'>('all');
const chatInput = ref('');
const lines = ref([...mockChat]);
const file = ref(mockFiles[0]?.path ?? 'App.vue');
const pick = ref<Side>(null);
const mergePhase = ref<'preview' | 'landed' | 'pushed' | 'mr'>('preview');
const edge = ref<Edge>('ok');
const statusMode = ref<StatusMode>('workspace');
const recordTab = ref<RecordTab>('stash');
const mergeMode = ref<MergeMode>('pair');
const cloneOpen = ref(false);
const confirmOpen = ref(false);
const newPath = ref('');

const dock: Array<{ id: Scene; label: string }> = [
  { id: 'board', label: '工作台' },
  { id: 'status', label: '状态' },
  { id: 'merge', label: '合并' },
  { id: 'jobs', label: '任务' },
  { id: 'logs', label: '日志' },
  { id: 'settings', label: '设置' }
];

const visibleRepos = computed(() => (edge.value === 'empty' ? [] : mockRepos));
const current = computed(() => visibleRepos.value.find((r) => r.id === currentId.value) ?? visibleRepos.value[0]);
const liveJob = mockJobs[0]?.title ?? '任务';
const runningJobs = computed(() => mockJobs.filter((j) => j.status === 'running').length);
const counts = computed(() => ({
  stuck: visibleRepos.value.filter((r) => r.attention === 'stuck' || r.available === false).length,
  dirty: visibleRepos.value.filter((r) => r.attention === 'dirty').length,
  sync: visibleRepos.value.filter((r) => r.attention === 'sync').length,
  clean: visibleRepos.value.filter((r) => r.attention === 'clean').length
}));
const mosaic = computed(() =>
  visibleRepos.value.filter((r) => filter.value === 'all' || r.attention === filter.value)
);
const weatherTabs = computed(() => [
  { key: 'all' as const, label: '全部', count: visibleRepos.value.length, hint: '所有已打开的仓库' },
  { key: 'stuck' as const, label: '雷雨', count: counts.value.stuck, hint: weatherHint('stuck') },
  { key: 'dirty' as const, label: '薄雾', count: counts.value.dirty, hint: weatherHint('dirty') },
  { key: 'sync' as const, label: '刮风', count: counts.value.sync, hint: weatherHint('sync') },
  { key: 'clean' as const, label: '晴天', count: counts.value.clean, hint: weatherHint('clean') }
]);

const branches = [
  { name: 'feat/ui-lab', current: true, extra: '3↑ 1↓' },
  { name: 'origin/main', current: false, extra: '' },
  { name: 'release/0.1', current: false, extra: '' },
  { name: 'hotfix/login', current: false, extra: '冲突' }
];

const wsClean = computed(() => edge.value === 'empty' || current.value?.attention === 'clean');
const wsConflict = computed(
  () => current.value?.attention === 'stuck' && current.value.available !== false
);
const needsConflict = computed(() => current.value?.attention === 'stuck' && current.value.available !== false);
const tempBranch = computed(() => {
  const b = current.value?.branch ?? 'feat';
  return `merge/${b.replace(/\//g, '-')}-into-origin-main`;
});
const files = computed(() => (wsClean.value ? [] : mockFiles));
const noRepo = computed(() => edge.value === 'empty' || !current.value);
const chatBlocked = computed(() => edge.value === 'nokey' || edge.value === 'offline' || noRepo.value);

function open(r: MockRepo): void {
  currentId.value = r.id;
  mergePhase.value = 'preview';
  pick.value = null;
}
function go(s: Scene): void {
  scene.value = s;
  chatOpen.value = false;
  if (s === 'merge') {
    mergePhase.value = 'preview';
    pick.value = null;
  }
}
function setFilter(a: Attention | 'all'): void {
  filter.value = filter.value === a ? 'all' : a;
}
function send(): void {
  const t = chatInput.value.trim();
  if (!t || chatBlocked.value) return;
  lines.value.push({ role: 'user', text: t });
  lines.value.push({ role: 'assistant', text: '示意回复。写操作会先 dry-run，确认条贴在输入框上方。' });
  chatInput.value = '';
}
function setEdge(next: Edge): void {
  edge.value = next;
  if (next === 'nokey') chatOpen.value = true;
  if (next === 'offline' || next === 'empty') chatOpen.value = false;
}
</script>

<template>
  <DemoFrame kicker="Deck" title="整合方案">
    <div class="deck">
      <div class="blob cyan" />
      <div class="blob violet" />
      <div class="blob mint" />

      <header class="top">
        <div class="brand"><span class="mark">⌘</span> Git Cockpit</div>
        <div class="edges">
          <button v-for="(hint, key) in edgeHints" :key="key" :class="{ on: edge === key }" :title="hint" @click="setEdge(key)">
            {{ { ok: '正常', offline: '离线', empty: '无仓', nokey: '无 Key' }[key] }}
          </button>
        </div>
        <div v-if="edge !== 'offline'" class="pulse" :title="liveJob"><i />{{ liveJob }}</div>
      </header>

      <p v-if="edge === 'offline'" class="page-banner err">后端离线。请先 git-cockpit start，或用桌面应用拉起 daemon。</p>

      <main v-if="scene === 'board'" class="board">
        <section class="hero glass">
          <div v-if="!current" class="hero-copy">
            <p class="eyebrow">工作台</p>
            <h2>还没有打开仓库</h2>
            <p class="hero-hint">输入本地 Git 路径，或从远程克隆。不会删盘上的文件。</p>
            <div class="open-row">
              <input v-model="newPath" placeholder="D:\project\repo 或 /Users/me/app" />
              <button class="btn primary">打开</button>
              <button class="btn" @click="cloneOpen = true">克隆到本地</button>
            </div>
          </div>
          <template v-else>
            <div class="hero-copy">
              <p class="eyebrow">当前仓库</p>
              <h2>{{ current.name }}</h2>
              <p class="path">{{ current.path }}</p>
              <div class="branch">
                <span class="wx" :class="current.attention">{{
                  current.available === false ? '丢失' : weatherOf(current.attention)
                }}</span>
                <code>{{ current.branch }}</code>
                <span class="ab"><b>{{ current.ahead }}</b>↑ <b>{{ current.behind }}</b>↓</span>
                <span v-if="current.dirty" class="chip">{{ current.dirty }} 更改</span>
                <span v-if="current.conflicts" class="chip danger">{{ current.conflicts }} 冲突</span>
              </div>
              <p class="hero-hint">
                {{
                  current.available === false
                    ? '路径不存在或不是 Git 仓库。可以从列表移除，不会删磁盘。'
                    : weatherHint(current.attention) + ' · 打开 ' + current.lastOpened
                }}
              </p>
              <div class="hero-actions">
                <button class="btn primary" :disabled="current.available === false" @click="go('status')">进入工作区</button>
                <button class="btn" :disabled="current.available === false" @click="go('merge')">预演合并</button>
                <button class="btn" @click="cloneOpen = true">克隆到本地</button>
              </div>
            </div>
            <MiniHeat v-if="current.available !== false" :days="current.activity" :size="9" />
          </template>
        </section>

        <section v-if="visibleRepos.length" class="weather">
          <button
            v-for="w in weatherTabs"
            :key="w.key"
            class="wx-tab glass"
            :class="[w.key, { on: filter === w.key }]"
            :title="w.hint"
            @click="setFilter(w.key)"
          >
            <strong>{{ w.count }}</strong>
            <span>{{ w.label }}</span>
            <small>{{ w.hint }}</small>
          </button>
        </section>

        <section class="mosaic-block">
          <p class="eyebrow">仓库一览 · 点卡片换当前仓，不会跟上面的数字挤在同一格</p>
          <div class="mosaic">
            <article
              v-for="r in mosaic"
              :key="r.id"
              class="tile glass"
              :class="[r.attention, { on: r.id === currentId, miss: r.available === false }]"
              @click="open(r)"
            >
              <header>
                <strong>{{ r.name }}</strong>
                <em :class="r.attention">{{ r.available === false ? '丢失' : weatherOf(r.attention) }}</em>
              </header>
              <code>{{ r.branch }}</code>
              <MiniHeat :days="r.activity" :size="6" />
              <footer>
                <span>{{ r.ahead }}↑ {{ r.behind }}↓</span>
                <span>{{ r.lastOpened }}</span>
              </footer>
            </article>
          </div>
        </section>
      </main>

      <main v-else-if="scene === 'status'" class="status-wrap">
        <p v-if="noRepo" class="page-banner warn">请先在工作台打开仓库。</p>
        <p v-else-if="current?.available === false" class="page-banner err">{{ current.path }} 不可用。</p>
        <p v-else-if="wsConflict" class="page-banner err">
          工作区 merge 进行中，还有冲突。这是当前目录里的冲突，不是合并页的 merge-tree 预演。
          <button class="btn primary">完成选边并继续</button>
          <button class="btn danger">中止</button>
        </p>
        <div class="subnav">
          <button :class="{ on: statusMode === 'workspace' }" @click="statusMode = 'workspace'">工作区</button>
          <button :class="{ on: statusMode === 'graph' }" @click="statusMode = 'graph'">分支图</button>
          <button :class="{ on: statusMode === 'log' }" @click="statusMode = 'log'">提交</button>
        </div>

        <div v-if="statusMode === 'workspace'" class="status">
          <aside class="glass pane">
            <p class="eyebrow">分支 · 双击切换</p>
            <button v-for="b in branches" :key="b.name" class="br" :class="{ on: b.current }">
              <code>{{ b.name }}</code>
              <small>{{ b.extra }}</small>
            </button>
          </aside>
          <section class="glass pane files">
            <p class="eyebrow">更改 · {{ files.length }}</p>
            <p v-if="!files.length" class="quiet">工作区干净。没有未提交的文件。</p>
            <button
              v-for="f in files"
              :key="f.path"
              class="file"
              :class="{ on: file === f.path }"
              @click="file = f.path"
            >
              <span class="letter" :class="f.kind">{{ f.letter }}</span>
              <code>{{ f.path.split('/').slice(-2).join('/') }}</code>
            </button>
            <div v-if="files.length" class="hero-actions">
              <button class="btn primary">暂存所选</button>
              <button class="btn" @click="confirmOpen = true">提交…</button>
              <button class="btn">stash</button>
            </div>
          </section>
          <section class="glass pane diff-pane">
            <p class="eyebrow">差异监视器</p>
            <div v-if="files.length" class="monitor">
              <header>{{ file }}</header>
              <pre><span v-for="(ln, i) in mockDiffLines" :key="i" :class="ln.kind">{{ ln.text }}</span></pre>
            </div>
            <p v-else class="quiet">没有差异可看。</p>
            <div class="rec-tabs">
              <button v-for="t in (['stash', 'backup', 'reflog', 'worktree'] as const)" :key="t" :class="{ on: recordTab === t }" @click="recordTab = t">
                {{ { stash: 'Stash', backup: '备份', reflog: 'Reflog', worktree: 'Worktree' }[t] }}
              </button>
            </div>
            <ul class="commits">
              <template v-if="recordTab === 'stash'">
                <li v-for="s in mockStashes" :key="s.ref">
                  <code>{{ s.ref }}</code> {{ s.msg }} · {{ s.time }}
                </li>
              </template>
              <template v-else-if="recordTab === 'backup'">
                <li v-for="s in mockBackups" :key="s.name">
                  <code>{{ s.name }}</code> · {{ s.time }}
                </li>
              </template>
              <template v-else-if="recordTab === 'reflog'">
                <li v-for="s in mockReflog" :key="s.ref">
                  <code>{{ s.ref }}</code> {{ s.msg }}
                </li>
              </template>
              <template v-else>
                <li v-for="s in mockWorktrees" :key="s.path">
                  <code>{{ s.branch }}</code> {{ s.path }} {{ s.main ? '· 主区' : '' }}
                </li>
              </template>
            </ul>
          </section>
        </div>

        <div v-else-if="statusMode === 'graph'" class="glass graph-pane">
          <p class="eyebrow">分支图 · tip DAG</p>
          <p class="quiet">节点是各分支 tip，不是每条 commit。选 into/from 可看成 Y 字分叉。</p>
          <svg viewBox="0 0 560 200" class="ygraph">
            <path d="M80 40 C 200 40, 200 100, 360 100" />
            <path d="M80 160 C 200 160, 200 100, 360 100" />
            <path d="M360 100 H 500" />
            <circle cx="80" cy="40" r="7" class="c1" />
            <circle cx="80" cy="160" r="7" class="c2" />
            <circle cx="360" cy="100" r="8" class="c3" />
            <text x="96" y="44">feat/ui-lab</text>
            <text x="96" y="164">origin/main</text>
            <text x="372" y="88">merge-base</text>
          </svg>
        </div>

        <div v-else class="glass graph-pane">
          <p class="eyebrow">提交 · 当前分支</p>
          <ul class="commits log-list">
            <li v-for="c in mockCommits" :key="c.sha">
              <code>{{ c.sha }}</code> {{ c.msg }} · {{ c.author }} · {{ c.time }}
            </li>
          </ul>
        </div>
      </main>

      <main v-else-if="scene === 'merge'" class="merge">
        <p v-if="noRepo" class="page-banner warn">请先在工作台打开仓库再预演。</p>
        <div class="subnav">
          <button :class="{ on: mergeMode === 'pair' }" @click="mergeMode = 'pair'">单对预演</button>
          <button :class="{ on: mergeMode === 'matrix' }" @click="mergeMode = 'matrix'">矩阵</button>
        </div>
        <template v-if="mergeMode === 'pair' && current">
          <section class="glass river">
            <div class="lane theirs">
              <small>我的 from</small>
              <strong>{{ current.branch }}</strong>
            </div>
            <div class="flow">
              <svg viewBox="0 0 200 80" preserveAspectRatio="none">
                <path d="M0 20 C 80 20, 80 40, 200 40" />
                <path d="M0 60 C 80 60, 80 40, 200 40" />
              </svg>
              <span class="stamp" :class="{ warn: needsConflict && mergePhase === 'preview' }">
                {{ needsConflict && mergePhase === 'preview' ? '有冲突' : '可干净合并' }}
              </span>
            </div>
            <div class="lane ours">
              <small>合入 into</small>
              <strong>origin/main</strong>
            </div>
          </section>

          <section v-if="needsConflict && mergePhase === 'preview'" class="theater">
            <article class="side glass" :class="{ picked: pick === 'ours' }" @click="pick = 'ours'">
              <header>线上 ≪</header>
              <pre>{{ mockConflict.ours }}</pre>
            </article>
            <article class="side glass" :class="{ picked: pick === 'theirs' }" @click="pick = 'theirs'">
              <header>我的 ≫</header>
              <pre>{{ mockConflict.theirs }}</pre>
            </article>
          </section>

          <section class="glass pane merge-next">
            <template v-if="mergePhase === 'preview' && needsConflict">
              <p class="eyebrow">预演结果</p>
              <p class="pipe-copy">
                {{ pick ? `已选 ${pick === 'ours' ? '线上' : '我的'}。落盘只写临时枝，不改你正在看的分支。` : '点一侧选边后才能落盘。示意不写回文件。' }}
              </p>
              <div class="hero-actions">
                <button class="btn primary" :disabled="!pick" @click="mergePhase = 'landed'">落盘到临时枝</button>
              </div>
            </template>
            <template v-else-if="mergePhase === 'preview'">
              <p class="eyebrow">预演结果</p>
              <p class="pipe-copy">没有冲突。落盘会在独立目录提交到临时枝，主工作区保持不动。</p>
              <div class="hero-actions">
                <button class="btn primary" @click="mergePhase = 'landed'">落盘到临时枝</button>
              </div>
            </template>
            <template v-else-if="mergePhase === 'landed'">
              <p class="eyebrow">已落盘 · 仅本地</p>
              <p class="pipe-copy">
                临时枝 <code>{{ tempBranch }}</code>。还没推远程，也还没开单。
              </p>
              <div class="hero-actions">
                <button class="btn primary" @click="mergePhase = 'pushed'">推送临时枝</button>
                <button class="btn" @click="mergePhase = 'preview'">重新预演</button>
              </div>
            </template>
            <template v-else-if="mergePhase === 'pushed'">
              <p class="eyebrow">临时枝已在远程</p>
              <p class="pipe-copy">可以看 MR 正文（dry-run，不会真开）。</p>
              <div class="hero-actions">
                <button class="btn primary" @click="mergePhase = 'mr'">看 MR 正文</button>
              </div>
            </template>
            <template v-else>
              <p class="eyebrow">MR 正文 · dry-run</p>
              <pre class="mr-body">## 做了什么
把 {{ current.branch }} 合入 origin/main。

## 怎么验
预演干净（或已选边），临时枝已推送。</pre>
              <div class="hero-actions">
                <button class="btn" disabled>等你说「现在开」才会真开单</button>
              </div>
            </template>
          </section>
        </template>
        <section v-else class="glass matrix-pane">
          <p class="eyebrow">矩阵 · into × from</p>
          <p class="pipe-copy">干净格可落盘；冲突格去单对选边；已解决·本地表示临时枝还没推。</p>
          <div class="mx">
            <div class="mx-head" />
            <div v-for="into in mockMatrixIntos" :key="into" class="mx-head">{{ into }}</div>
            <template v-for="from in mockMatrixFroms" :key="from">
              <div class="mx-from">{{ from }}</div>
              <button
                v-for="into in mockMatrixIntos"
                :key="from + into"
                class="mx-cell"
                :class="[mockMatrixCells.find((c) => c.from === from && c.into === into)?.outcome, mockMatrixCells.find((c) => c.from === from && c.into === into)?.stage]"
                @click="mergeMode = 'pair'"
              >
                {{
                  matrixText(mockMatrixCells.find((c) => c.from === from && c.into === into)?.outcome ?? 'clean')
                }}
                <small v-if="mockMatrixCells.find((c) => c.from === from && c.into === into)?.stage">{{
                  { local: '已解决·本地', resolved: '已处理', mr: '已提 MR', '': '' }[
                    mockMatrixCells.find((c) => c.from === from && c.into === into)?.stage ?? ''
                  ]
                }}</small>
              </button>
            </template>
          </div>
        </section>
      </main>

      <DeckJobs v-else-if="scene === 'jobs'" :edge="edge" />
      <DeckLogs v-else-if="scene === 'logs'" :edge="edge" />
      <DeckSettings v-else-if="scene === 'settings'" :edge="edge" />

      <footer class="dock">
        <button
          v-for="s in dock"
          :key="s.id"
          :class="{ on: scene === s.id && !chatOpen }"
          @click="go(s.id)"
        >
          {{ s.label }}
          <i v-if="s.id === 'jobs' && runningJobs && edge !== 'empty'" class="badge">{{ runningJobs }}</i>
        </button>
        <button :class="{ on: chatOpen }" @click="chatOpen = !chatOpen">聊天</button>
      </footer>

      <aside v-if="chatOpen" class="sheet glass">
        <p class="eyebrow">助手 · {{ current?.name || '未选择仓库' }}</p>
        <p v-if="edge === 'offline'" class="banner-in err">后端离线，发不出去。</p>
        <p v-else-if="noRepo" class="banner-in warn">请先在工作台打开仓库。</p>
        <p v-else-if="edge === 'nokey'" class="banner-in warn">尚未配置模型 API Key。去设置「模型」。</p>
        <template v-else>
          <div class="msgs">
            <p v-for="(m, i) in lines" :key="i" :class="m.role">{{ m.text }}</p>
          </div>
          <div class="confirm">将执行 git commit · dry-run 预览 · 确认后写入</div>
        </template>
        <form class="composer" @submit.prevent="send">
          <input v-model="chatInput" :disabled="chatBlocked" placeholder="例如：看看改了什么，帮我提交" />
          <button class="btn primary" type="submit" :disabled="chatBlocked">发送</button>
        </form>
      </aside>

      <div v-if="cloneOpen" class="mask" @click.self="cloneOpen = false">
        <div class="glass dlg">
          <p class="eyebrow">克隆到本地</p>
          <label>项目地址 <input placeholder="https://github.com/org/repo.git" /></label>
          <label>保存路径 <input placeholder="必须是空目录的绝对路径" /></label>
          <p class="pipe-copy">禁止 URL 里夹带 token。目标路径要过 allowedRepos。</p>
          <div class="hero-actions">
            <button class="btn" @click="cloneOpen = false">取消</button>
            <button class="btn primary" @click="cloneOpen = false; go('jobs')">开始克隆</button>
          </div>
        </div>
      </div>
      <div v-if="confirmOpen" class="mask" @click.self="confirmOpen = false">
        <div class="glass dlg">
          <p class="eyebrow">dry-run 预览</p>
          <pre class="mr-body">git add packages/web/src/theme.css packages/web/src/router.ts
git commit -m "feat(web): 布局实验室"</pre>
          <p class="pipe-copy">确认后才会真正写入。高风险操作默认关，被拒会带到设置「Git 操作」。</p>
          <div class="hero-actions">
            <button class="btn" @click="confirmOpen = false">取消</button>
            <button class="btn primary" @click="confirmOpen = false">确认执行</button>
          </div>
        </div>
      </div>
    </div>
  </DemoFrame>
</template>

<style scoped>
.deck {
  height: 100%;
  position: relative;
  overflow: hidden;
  color: #e8f4ff;
  background: #070b14;
  font-size: var(--gc-text);
  --heat-0: rgb(255 255 255 / 0.06);
  --heat-1: rgb(45 212 191 / 0.28);
  --heat-2: rgb(34 211 238 / 0.5);
  --heat-3: rgb(56 189 248 / 0.78);
  --heat-4: #67e8f9;
}
.blob {
  position: absolute;
  border-radius: 50%;
  filter: blur(90px);
  pointer-events: none;
  animation: drift 18s ease-in-out infinite;
}
.blob.cyan {
  width: 480px;
  height: 480px;
  left: -120px;
  top: -80px;
  background: #22d3ee;
  opacity: 0.22;
}
.blob.violet {
  width: 420px;
  height: 420px;
  right: -80px;
  top: 40px;
  background: #818cf8;
  opacity: 0.2;
  animation-delay: -6s;
}
.blob.mint {
  width: 360px;
  height: 360px;
  left: 30%;
  bottom: -120px;
  background: #34d399;
  opacity: 0.12;
  animation-delay: -11s;
}
@keyframes drift {
  50% {
    transform: translate(40px, 24px) scale(1.08);
  }
}
.top {
  position: relative;
  z-index: 2;
  display: flex;
  align-items: center;
  gap: var(--gc-pad);
  height: var(--gc-line);
  padding: 0 var(--gc-pad);
}
.brand {
  display: flex;
  align-items: center;
  gap: var(--gc-gap);
  font-weight: 600;
}
.mark {
  color: #67e8f9;
  font-size: var(--el-font-size-extra-large);
}
.edges {
  display: flex;
  gap: var(--gc-gap);
  flex: none;
  margin-left: auto;
}
.edges button {
  border: 0;
  background: rgb(255 255 255 / 0.06);
  color: inherit;
  padding: 0 var(--gc-pad);
  height: var(--gc-control);
  border-radius: var(--gc-radius);
  font: inherit;
  font-size: var(--gc-text);
  cursor: pointer;
  opacity: 0.55;
}
.edges button.on {
  opacity: 1;
  background: rgb(103 232 249 / 0.2);
}
.pulse {
  display: flex;
  align-items: center;
  gap: var(--gc-gap);
  font-size: var(--gc-text);
  opacity: 0.8;
}
.pulse i {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #34d399;
  box-shadow: 0 0 12px #34d399;
  animation: blink 1.6s ease infinite;
}
@keyframes blink {
  50% {
    opacity: 0.35;
  }
}
.board {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  gap: var(--gc-pad);
  padding: var(--gc-gap) var(--gc-pad) calc(var(--gc-line) + var(--gc-pad) * 2);
  height: calc(100% - var(--gc-line));
  overflow: auto;
}
.glass {
  background: rgb(12 18 30 / 0.62);
  border: 1px solid rgb(255 255 255 / 0.1);
  border-radius: var(--gc-radius);
  backdrop-filter: blur(16px);
  box-shadow: 0 12px 40px rgb(0 0 0 / 0.28);
}
.hero {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  gap: var(--gc-pad);
  padding: var(--gc-pad);
}
.hero-copy {
  display: flex;
  flex-direction: column;
  gap: var(--gc-gap);
  min-width: 0;
}
.eyebrow {
  margin: 0 0 var(--gc-gap);
  font-size: var(--gc-text);
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: #99f6e4;
}
h2 {
  margin: 0;
  font-size: var(--el-font-size-extra-large);
  font-weight: 600;
}
.path,
code {
  font-family: 'JetBrains Mono', Consolas, monospace;
  font-size: var(--gc-text);
}
.path {
  margin: 0;
  opacity: 0.55;
}
.branch {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--gc-gap);
}
.wx {
  font-size: var(--gc-text);
  padding: 0 var(--gc-gap);
  border-radius: 999px;
  background: rgb(255 255 255 / 0.08);
}
.wx.stuck,
em.stuck {
  color: #fda4af;
  background: rgb(244 63 94 / 0.16);
}
.wx.dirty,
em.dirty {
  color: #c4b5fd;
  background: rgb(167 139 250 / 0.16);
}
.wx.sync,
em.sync {
  color: #7dd3fc;
  background: rgb(56 189 248 / 0.16);
}
.wx.clean,
em.clean {
  color: #6ee7b7;
  background: rgb(52 211 153 / 0.16);
}
.ab b {
  font-size: var(--el-font-size-extra-large);
  font-weight: 600;
  margin: 0 2px 0 8px;
}
.chip {
  font-size: var(--gc-text);
  padding: 0 var(--gc-gap);
  border-radius: 999px;
  background: rgb(255 255 255 / 0.08);
}
.chip.danger {
  color: #fecdd3;
  background: rgb(244 63 94 / 0.18);
}
.hero-hint {
  margin: 0;
  font-size: var(--gc-text);
  opacity: 0.55;
}
.hero-actions {
  display: flex;
  gap: var(--gc-gap);
  margin-top: var(--gc-gap);
}
.btn {
  border: 0;
  border-radius: var(--gc-radius);
  padding: 0 var(--gc-pad);
  height: var(--gc-control);
  display: inline-flex;
  align-items: center;
  background: rgb(255 255 255 / 0.08);
  color: inherit;
  cursor: pointer;
  font: inherit;
  font-size: var(--gc-text);
}
.btn.primary {
  background: linear-gradient(135deg, #22d3ee, #818cf8);
  color: #041016;
  font-weight: 600;
}
.btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}
.weather {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: var(--gc-gap);
}
.wx-tab {
  border: 0;
  text-align: left;
  color: inherit;
  padding: var(--gc-pad);
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 2px;
  font: inherit;
}
.wx-tab strong {
  font-size: var(--el-font-size-extra-large);
  line-height: 1;
}
.wx-tab.stuck strong {
  color: #fb7185;
}
.wx-tab.dirty strong {
  color: #c4b5fd;
}
.wx-tab.sync strong {
  color: #7dd3fc;
}
.wx-tab.clean strong {
  color: #6ee7b7;
}
.wx-tab small {
  opacity: 0.5;
  font-size: var(--gc-text);
  line-height: 1.35;
}
.wx-tab.on {
  box-shadow: 0 0 0 1px rgb(103 232 249 / 0.45) inset;
}
.mosaic-block {
  display: flex;
  flex-direction: column;
  gap: var(--gc-gap);
}
.mosaic {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--gc-gap);
}
.tile {
  padding: var(--gc-pad);
  display: flex;
  flex-direction: column;
  gap: var(--gc-gap);
  cursor: pointer;
  transition: transform 0.2s ease;
}
.tile:hover,
.tile.on {
  transform: translateY(-3px);
  border-color: rgb(103 232 249 / 0.4);
}
.tile header,
.tile footer {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: var(--gc-gap);
}
.tile em {
  font-style: normal;
  font-size: var(--gc-text);
  padding: 0 var(--gc-gap);
  border-radius: 999px;
}
.tile footer {
  font-size: var(--gc-text);
  opacity: 0.5;
}
.pipe {
  padding: var(--gc-pad);
}
.steps {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: var(--gc-gap);
  margin: var(--gc-gap) 0;
}
.step {
  display: flex;
  gap: var(--gc-gap);
  align-items: center;
  padding: var(--gc-gap) var(--gc-pad);
  border: 0;
  border-radius: var(--gc-radius);
  background: rgb(255 255 255 / 0.04);
  color: inherit;
  cursor: pointer;
  text-align: left;
  font: inherit;
}
.step i {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  font-size: var(--gc-text);
  background: rgb(255 255 255 / 0.1);
}
.step small {
  display: block;
  opacity: 0.5;
  font-size: var(--gc-text);
}
.step.on {
  background: rgb(103 232 249 / 0.14);
}
.step.done i {
  background: #22d3ee;
  color: #042024;
}
.pipe-copy {
  margin: 0;
  font-size: var(--gc-text);
  line-height: 1.55;
  opacity: 0.75;
}
.dock {
  position: absolute;
  z-index: 5;
  left: 50%;
  bottom: var(--gc-pad);
  transform: translateX(-50%);
  display: flex;
  gap: var(--gc-gap);
  padding: var(--gc-gap);
  border-radius: var(--gc-radius);
  background: rgb(8 12 22 / 0.75);
  border: 1px solid rgb(255 255 255 / 0.12);
  backdrop-filter: blur(18px);
}
.dock button {
  border: 0;
  background: transparent;
  color: inherit;
  padding: 0 var(--gc-pad);
  height: var(--gc-control);
  border-radius: var(--gc-radius);
  cursor: pointer;
  font: inherit;
  font-size: var(--gc-text);
  opacity: 0.65;
}
.dock button.on {
  opacity: 1;
  background: rgb(103 232 249 / 0.18);
}
.status {
  position: relative;
  z-index: 1;
  display: grid;
  grid-template-columns: 200px 240px 1fr;
  gap: var(--gc-pad);
  padding: 0 var(--gc-pad);
  flex: 1;
  min-height: 0;
}
.merge {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  gap: var(--gc-pad);
  padding: var(--gc-gap) var(--gc-pad) calc(var(--gc-line) + var(--gc-pad) * 2);
  height: calc(100% - var(--gc-line));
  min-height: 0;
  overflow: auto;
}
.pane {
  padding: var(--gc-pad);
  overflow: auto;
  min-height: 0;
}
.br,
.file {
  display: flex;
  align-items: center;
  gap: var(--gc-gap);
  width: 100%;
  border: 0;
  background: transparent;
  color: inherit;
  padding: 0 var(--gc-gap);
  border-radius: var(--gc-radius);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.br.on,
.file.on {
  background: rgb(103 232 249 / 0.1);
}
.br small {
  margin-left: auto;
  opacity: 0.5;
  font-size: var(--gc-text);
}
.letter {
  width: 18px;
  height: 18px;
  border-radius: 4px;
  display: grid;
  place-items: center;
  font-size: var(--gc-text);
  font-weight: 700;
  flex: none;
}
.letter.mod {
  background: #f43f5e;
  color: #fff;
}
.letter.new {
  background: #22d3ee;
  color: #042024;
}
.monitor {
  background: #05080e;
  border-radius: var(--gc-radius);
  overflow: hidden;
  border: 1px solid rgb(103 232 249 / 0.16);
  box-shadow: 0 0 40px rgb(34 211 238 / 0.06);
}
.monitor header {
  padding: 0 var(--gc-pad);
  font-size: var(--gc-text);
  opacity: 0.55;
  border-bottom: 1px solid rgb(255 255 255 / 0.06);
  font-family: 'JetBrains Mono', Consolas, monospace;
}
.monitor pre {
  margin: 0;
  padding: var(--gc-gap) 0;
  font-size: var(--gc-text);
  line-height: 1.55;
  overflow: auto;
}
.monitor span {
  display: block;
  padding: 0 var(--gc-pad);
  white-space: pre;
}
.monitor .del {
  color: #fda4af;
  background: rgb(244 63 94 / 0.12);
}
.monitor .add {
  color: #86efac;
  background: rgb(52 211 153 / 0.12);
}
.monitor .ctx {
  color: rgb(232 244 255 / 0.45);
}
.commits {
  list-style: none;
  padding: var(--gc-pad) 0 0;
  margin: 0;
  font-size: var(--gc-text);
  opacity: 0.7;
  line-height: 1.8;
}
.river {
  display: grid;
  grid-template-columns: 1fr 1.1fr 1fr;
  align-items: center;
  padding: var(--gc-pad);
  gap: var(--gc-gap);
}
.lane {
  padding: var(--gc-pad);
  border-radius: var(--gc-radius);
  background: rgb(255 255 255 / 0.04);
}
.lane small {
  display: block;
  opacity: 0.5;
  font-size: var(--gc-text);
}
.lane.theirs {
  border-left: 3px solid #22d3ee;
}
.lane.ours {
  border-left: 3px solid #818cf8;
}
.flow {
  position: relative;
  height: 80px;
}
.flow svg {
  width: 100%;
  height: 100%;
}
.flow path {
  fill: none;
  stroke: #67e8f9;
  stroke-width: 2;
  opacity: 0.7;
}
.page-banner {
  position: relative;
  z-index: 2;
  margin: 0 var(--gc-pad) var(--gc-gap);
  padding: var(--gc-gap) var(--gc-pad);
  border-radius: var(--gc-radius);
  font-size: var(--gc-text);
  display: flex;
  align-items: center;
  gap: var(--gc-gap);
  flex-wrap: wrap;
}
.page-banner.err {
  background: rgb(244 63 94 / 0.16);
  color: #fecdd3;
}
.page-banner.warn {
  background: rgb(167 139 250 / 0.16);
  color: #ddd6fe;
}
.open-row {
  display: flex;
  gap: var(--gc-gap);
  margin-top: var(--gc-gap);
}
.open-row input,
.dlg input {
  flex: 1;
  border: 0;
  border-radius: var(--gc-radius);
  padding: 0 var(--gc-pad);
  height: var(--gc-control);
  background: rgb(255 255 255 / 0.08);
  color: inherit;
  font: inherit;
  outline: none;
}
.subnav,
.rec-tabs {
  display: flex;
  gap: var(--gc-gap);
  flex: none;
}
.subnav {
  padding: 0 var(--gc-pad);
}
.subnav button,
.rec-tabs button {
  border: 0;
  background: rgb(255 255 255 / 0.06);
  color: inherit;
  padding: 0 var(--gc-pad);
  height: var(--gc-control);
  border-radius: var(--gc-radius);
  cursor: pointer;
  font: inherit;
  font-size: var(--gc-text);
}
.subnav button.on,
.rec-tabs button.on {
  background: rgb(103 232 249 / 0.18);
}
.quiet {
  font-size: var(--gc-text);
  opacity: 0.5;
  line-height: 1.5;
}
.status-wrap {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  gap: var(--gc-gap);
  padding: var(--gc-gap) 0 calc(var(--gc-line) + var(--gc-pad) * 2);
  height: calc(100% - var(--gc-line));
  min-height: 0;
}
.graph-pane {
  margin: 0 var(--gc-pad);
  padding: var(--gc-pad);
  overflow: auto;
}
.ygraph {
  width: min(560px, 100%);
  height: auto;
  margin-top: var(--gc-pad);
}
.ygraph path {
  fill: none;
  stroke: #67e8f9;
  stroke-width: 2;
}
.ygraph .c1 {
  fill: #22d3ee;
}
.ygraph .c2 {
  fill: #818cf8;
}
.ygraph .c3 {
  fill: #6ee7b7;
}
.ygraph text {
  fill: #e8f4ff;
  font-size: var(--gc-text);
  font-family: inherit;
}
.tile.miss {
  opacity: 0.55;
}
.stamp {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  padding: 0 var(--gc-pad);
  border-radius: 999px;
  background: rgb(52 211 153 / 0.2);
  color: #bbf7d0;
  font-size: var(--gc-text);
  white-space: nowrap;
}
.mx {
  display: grid;
  grid-template-columns: 140px repeat(2, 1fr);
  gap: var(--gc-gap);
  margin-top: var(--gc-pad);
}
.mx-head,
.mx-from {
  font-size: var(--gc-text);
  opacity: 0.55;
  padding: var(--gc-gap);
}
.mx-cell {
  border: 0;
  border-radius: var(--gc-radius);
  padding: var(--gc-gap) var(--gc-pad);
  background: rgb(255 255 255 / 0.05);
  color: inherit;
  cursor: pointer;
  font: inherit;
  font-size: var(--gc-text);
  text-align: left;
}
.mx-cell small {
  display: block;
  opacity: 0.55;
  margin-top: var(--gc-gap);
}
.mx-cell.conflicts {
  background: rgb(244 63 94 / 0.16);
}
.mx-cell.clean {
  background: rgb(52 211 153 / 0.12);
}
.mx-cell.unrelated,
.mx-cell.same {
  opacity: 0.55;
}
.mx-cell.error {
  background: rgb(148 163 184 / 0.16);
}
.matrix-pane {
  padding: var(--gc-pad);
}
.mask {
  position: absolute;
  inset: 0;
  z-index: 8;
  background: rgb(0 0 0 / 0.45);
  display: grid;
  place-items: center;
}
.dlg {
  width: min(460px, 92vw);
  padding: var(--gc-pad);
  display: flex;
  flex-direction: column;
  gap: var(--gc-gap);
}
.dlg label {
  display: flex;
  flex-direction: column;
  gap: var(--gc-gap);
  font-size: var(--gc-text);
}
.badge {
  display: inline-grid;
  place-items: center;
  min-width: 14px;
  height: 14px;
  margin-left: 4px;
  padding: 0 4px;
  border-radius: var(--gc-radius);
  background: #fb7185;
  color: #fff;
  font-size: var(--gc-text);
  font-style: normal;
}
.banner-in {
  margin: 0;
  padding: var(--gc-gap) var(--gc-pad);
  border-radius: var(--gc-radius);
  font-size: var(--gc-text);
}
.banner-in.err {
  background: rgb(244 63 94 / 0.16);
  color: #fecdd3;
}
.banner-in.warn {
  background: rgb(167 139 250 / 0.16);
  color: #ddd6fe;
}
.dock button {
  position: relative;
}
.merge-next {
  flex: none;
}
.mr-body {
  margin: 0 0 var(--gc-pad);
  padding: var(--gc-pad);
  border-radius: var(--gc-radius);
  background: #05080e;
  font-size: var(--gc-text);
  line-height: 1.6;
  white-space: pre-wrap;
}
.film {
  display: flex;
  grid-template-columns: none;
  margin: 0;
}
.film .step {
  flex: 1;
  justify-content: center;
}
.theater {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--gc-pad);
  flex: 1;
  min-height: 180px;
}
.side {
  overflow: auto;
  cursor: pointer;
  border: 1px solid transparent;
}
.side header {
  padding: var(--gc-gap) var(--gc-pad) 0;
  font-size: var(--gc-text);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  opacity: 0.6;
}
.side pre {
  margin: 0;
  padding: var(--gc-pad);
  font-size: var(--gc-text);
  line-height: 1.55;
}
.side.picked {
  border-color: #67e8f9;
  box-shadow: 0 0 0 1px rgb(103 232 249 / 0.4) inset;
}
.sheet {
  position: absolute;
  z-index: 6;
  left: 50%;
  bottom: calc(var(--gc-control) + var(--gc-pad) * 2 + var(--gc-gap) * 2);
  transform: translateX(-50%);
  width: min(560px, calc(100% - var(--gc-pad) * 2));
  padding: var(--gc-pad);
  display: flex;
  flex-direction: column;
  gap: var(--gc-gap);
  max-height: 52%;
  animation: rise 0.28s ease;
}
@keyframes rise {
  from {
    opacity: 0;
    transform: translate(-50%, 16px);
  }
}
.msgs {
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: var(--gc-gap);
  min-height: 120px;
}
.msgs p {
  margin: 0;
  padding: 0 var(--gc-pad);
  border-radius: var(--gc-radius);
  font-size: var(--gc-text);
  line-height: 1.5;
  white-space: pre-wrap;
  max-width: 90%;
}
.msgs .user {
  align-self: flex-end;
  background: rgb(103 232 249 / 0.16);
}
.msgs .assistant {
  background: rgb(255 255 255 / 0.06);
}
.confirm {
  font-size: var(--gc-text);
  padding: var(--gc-gap) var(--gc-pad);
  border-radius: var(--gc-radius);
  background: rgb(167 139 250 / 0.16);
  color: #ddd6fe;
}
.composer {
  display: flex;
  gap: var(--gc-gap);
}
.composer input {
  flex: 1;
  border: 0;
  border-radius: var(--gc-radius);
  padding: 0 var(--gc-pad);
  height: var(--gc-control);
  background: rgb(255 255 255 / 0.08);
  color: inherit;
  font: inherit;
  outline: none;
}
</style>
