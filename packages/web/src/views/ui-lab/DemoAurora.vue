<script setup lang="ts">
import { computed, ref } from 'vue';
import DemoFrame from './DemoFrame.vue';
import MiniHeat from './MiniHeat.vue';
import { attentionLabel, mockChat, mockFiles, mockJobs, mockRepos, type Attention, type MockRepo } from './mock';

type Scene = 'board' | 'status' | 'merge';

const scene = ref<Scene>('board');
const chatOpen = ref(false);
const currentId = ref(1);
const filter = ref<Attention | 'all'>('all');
const chatInput = ref('');
const lines = ref([...mockChat]);

const current = computed(() => mockRepos.find((r) => r.id === currentId.value) ?? mockRepos[0]!);
const liveJob = mockJobs[0]?.title ?? '任务';
const counts = computed(() => ({
  stuck: mockRepos.filter((r) => r.attention === 'stuck').length,
  dirty: mockRepos.filter((r) => r.attention === 'dirty').length,
  sync: mockRepos.filter((r) => r.attention === 'sync').length
}));
const mosaic = computed(() =>
  mockRepos.filter((r) => (filter.value === 'all' ? true : r.attention === filter.value) && r.id !== currentId.value)
);

function pick(r: MockRepo): void {
  currentId.value = r.id;
}
function setFilter(a: Attention | 'all'): void {
  filter.value = filter.value === a ? 'all' : a;
}
function send(): void {
  const t = chatInput.value.trim();
  if (!t) return;
  lines.value.push({ role: 'user', text: t });
  lines.value.push({
    role: 'assistant',
    text: '示意回复：这是指挥台里的升起聊天，不会真的调模型。确认条会贴在输入框上方。'
  });
  chatInput.value = '';
}
</script>

<template>
  <DemoFrame kicker="Aurora" title="指挥台">
    <div class="aurora">
      <div class="blob cyan" />
      <div class="blob violet" />
      <div class="blob mint" />

      <header class="top">
        <div class="brand">
          <span class="mark">⌘</span>
          Git Cockpit
        </div>
        <div class="pills">
          <button
            v-for="r in mockRepos"
            :key="r.id"
            class="pill"
            :class="{ on: r.id === currentId }"
            @click="pick(r)"
          >
            {{ r.name }}
          </button>
        </div>
        <div class="pulse" :title="liveJob">
          <i />
          {{ liveJob }}
        </div>
      </header>

      <main v-if="scene === 'board'" class="bento">
        <section class="hero glass">
          <p class="eyebrow">当前仓库</p>
          <h2>{{ current.name }}</h2>
          <p class="path">{{ current.path }}</p>
          <div class="branch">
            <span class="dot" :class="current.attention" />
            <code>{{ current.branch }}</code>
            <span class="ab"><b>{{ current.ahead }}</b>↑ <b>{{ current.behind }}</b>↓</span>
            <span v-if="current.dirty" class="chip warn">{{ current.dirty }} 更改</span>
            <span v-if="current.conflicts" class="chip danger">{{ current.conflicts }} 冲突</span>
            <span v-if="current.drafts" class="chip">{{ current.drafts }} 合并草稿</span>
          </div>
          <MiniHeat :days="current.activity" :size="9" />
          <div class="hero-actions">
            <button class="btn primary" @click="scene = 'status'; chatOpen = false">进入工作区</button>
            <button class="btn" @click="scene = 'merge'; chatOpen = false">预演合并</button>
          </div>
        </section>

        <button class="stat glass stuck" :class="{ on: filter === 'stuck' }" @click="setFilter('stuck')">
          <strong>{{ counts.stuck }}</strong>
          <span>卡住</span>
          <small>工作区 merge / 冲突</small>
        </button>
        <button class="stat glass dirty" :class="{ on: filter === 'dirty' }" @click="setFilter('dirty')">
          <strong>{{ counts.dirty }}</strong>
          <span>有更改</span>
          <small>未提交的活</small>
        </button>
        <button class="stat glass sync" :class="{ on: filter === 'sync' }" @click="setFilter('sync')">
          <strong>{{ counts.sync }}</strong>
          <span>未同步</span>
          <small>超前或落后远程</small>
        </button>

        <article
          v-for="r in mosaic"
          :key="r.id"
          class="tile glass"
          :class="r.attention"
          @click="pick(r)"
        >
          <header>
            <strong>{{ r.name }}</strong>
            <em>{{ attentionLabel(r.attention) }}</em>
          </header>
          <code>{{ r.branch }}</code>
          <MiniHeat :days="r.activity" :size="5" />
        </article>
      </main>

      <main v-else-if="scene === 'status'" class="status">
        <aside class="glass pane">
          <p class="eyebrow">分支</p>
          <button class="br on"><code>feat/ui-lab</code><span>当前</span></button>
          <button class="br"><code>origin/main</code><span>0↑ 1↓</span></button>
          <button class="br"><code>release/0.1</code></button>
        </aside>
        <section class="glass pane files">
          <p class="eyebrow">更改 · {{ mockFiles.length }}</p>
          <label v-for="f in mockFiles" :key="f.path" class="file">
            <input type="checkbox" :checked="f.staged" />
            <span class="letter" :class="f.kind">{{ f.letter }}</span>
            <code>{{ f.path }}</code>
          </label>
          <div class="hero-actions">
            <button class="btn primary">暂存所选</button>
            <button class="btn">提交…</button>
          </div>
        </section>
        <section class="glass pane">
          <p class="eyebrow">近况</p>
          <p class="pipe-copy">热力在左侧英雄卡已经看过。这里改成「今天动过的文件」叙事，而不是再塞一张表。</p>
          <ul class="log">
            <li>16:20 打开仓库</li>
            <li>16:08 预演合并 · 干净</li>
            <li>15:40 fetch origin</li>
          </ul>
        </section>
      </main>

      <main v-else-if="scene === 'merge'" class="merge">
        <section class="glass river">
          <div class="lane theirs">
            <small>我的 from</small>
            <strong>feat/ui-lab</strong>
            <span>b7c21a4</span>
          </div>
          <div class="flow">
            <svg viewBox="0 0 200 80" preserveAspectRatio="none">
              <path d="M0 20 C 80 20, 80 40, 200 40" />
              <path d="M0 60 C 80 60, 80 40, 200 40" />
            </svg>
            <span class="stamp">可干净合并</span>
          </div>
          <div class="lane ours">
            <small>合入 into</small>
            <strong>origin/main</strong>
            <span>9e10d2c</span>
          </div>
        </section>
        <section class="glass pane">
          <p class="eyebrow">下一步</p>
          <p class="pipe-copy">没有冲突文件。点落盘会在独立目录提交临时枝，你正在看的分支不动。</p>
          <div class="hero-actions">
            <button class="btn primary">落盘并推送</button>
            <button class="btn">只预演</button>
          </div>
        </section>
      </main>

      <footer class="dock">
        <button v-for="s in (['board', 'status', 'merge'] as const)" :key="s" :class="{ on: scene === s && !chatOpen }" @click="scene = s; chatOpen = false">
          {{ { board: '工作台', status: '状态', merge: '合并' }[s] }}
        </button>
        <button :class="{ on: chatOpen }" @click="chatOpen = !chatOpen">聊天</button>
      </footer>

      <aside v-if="chatOpen" class="sheet glass">
        <p class="eyebrow">助手 · {{ current.name }}</p>
        <div class="msgs">
          <p v-for="(m, i) in lines" :key="i" :class="m.role">{{ m.text }}</p>
        </div>
        <div class="confirm">将执行 git commit · 确认后写入</div>
        <form class="composer" @submit.prevent="send">
          <input v-model="chatInput" placeholder="问问工作区，或让它预演合并" />
          <button class="btn primary" type="submit">发送</button>
        </form>
      </aside>
    </div>
  </DemoFrame>
</template>

<style scoped>
.aurora {
  height: 100%;
  position: relative;
  overflow: hidden;
  color: #e8f4ff;
  background: #070b14;
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
  gap: 16px;
  padding: 14px 20px 8px;
}
.brand {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
}
.mark {
  color: #67e8f9;
  font-size: 18px;
}
.pills {
  display: flex;
  gap: 6px;
  flex: 1;
  overflow: auto;
}
.pill {
  border: 0;
  background: rgb(255 255 255 / 0.06);
  color: inherit;
  padding: 6px 12px;
  border-radius: 999px;
  cursor: pointer;
  font: inherit;
  font-size: 12px;
  white-space: nowrap;
}
.pill.on {
  background: rgb(103 232 249 / 0.2);
  box-shadow: 0 0 0 1px rgb(103 232 249 / 0.45);
}
.pulse {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
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
.bento {
  position: relative;
  z-index: 1;
  display: grid;
  grid-template-columns: 1.4fr 0.7fr 0.7fr;
  grid-auto-rows: minmax(88px, auto);
  gap: 12px;
  padding: 8px 20px 88px;
  height: calc(100% - 54px);
  overflow: auto;
  align-content: start;
}
.glass {
  background: rgb(12 18 30 / 0.62);
  border: 1px solid rgb(255 255 255 / 0.1);
  border-radius: 18px;
  backdrop-filter: blur(16px);
  box-shadow: 0 12px 40px rgb(0 0 0 / 0.28);
}
.hero {
  grid-row: span 2;
  padding: 22px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.eyebrow {
  margin: 0;
  font-size: 11px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: #99f6e4;
}
h2 {
  margin: 0;
  font-family: Fraunces, Georgia, serif;
  font-size: 32px;
  font-weight: 600;
}
.path,
code {
  font-family: 'JetBrains Mono', Consolas, monospace;
  font-size: 12px;
}
.path {
  margin: 0;
  opacity: 0.55;
}
.branch {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #34d399;
}
.dot.dirty {
  background: #fbbf24;
}
.dot.sync {
  background: #60a5fa;
}
.dot.stuck {
  background: #fb7185;
}
.ab b {
  font-family: Fraunces, Georgia, serif;
  font-size: 18px;
  font-weight: 600;
  margin: 0 2px 0 8px;
}
.chip {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 999px;
  background: rgb(255 255 255 / 0.08);
}
.chip.warn {
  color: #fde68a;
  background: rgb(251 191 36 / 0.16);
}
.chip.danger {
  color: #fecdd3;
  background: rgb(244 63 94 / 0.18);
}
.hero-actions {
  display: flex;
  gap: 8px;
  margin-top: auto;
}
.btn {
  border: 0;
  border-radius: 999px;
  padding: 8px 14px;
  background: rgb(255 255 255 / 0.08);
  color: inherit;
  cursor: pointer;
  font: inherit;
  font-size: 13px;
}
.btn.primary {
  background: linear-gradient(135deg, #22d3ee, #818cf8);
  color: #041016;
  font-weight: 600;
}
.stat {
  border: 0;
  text-align: left;
  color: inherit;
  padding: 16px 18px;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 2px;
  font: inherit;
}
.stat strong {
  font-family: Fraunces, Georgia, serif;
  font-size: 36px;
  line-height: 1;
}
.stat.stuck strong {
  color: #fb7185;
}
.stat.dirty strong {
  color: #fbbf24;
}
.stat.sync strong {
  color: #7dd3fc;
}
.stat small {
  opacity: 0.5;
  font-size: 11px;
}
.stat.on {
  box-shadow: 0 0 0 1px rgb(255 255 255 / 0.28) inset;
}
.tile {
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  cursor: pointer;
  transition: transform 0.2s ease;
}
.tile:hover {
  transform: translateY(-3px);
}
.tile header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
}
.tile em {
  font-style: normal;
  font-size: 11px;
  opacity: 0.6;
}
.tile.stuck {
  border-color: rgb(251 113 133 / 0.35);
}
.tile.dirty {
  border-color: rgb(251 191 36 / 0.3);
}
.pipe {
  grid-column: 1 / -1;
  padding: 16px 18px;
}
.steps {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
  margin: 10px 0;
}
.step {
  display: flex;
  gap: 10px;
  align-items: center;
  padding: 10px 12px;
  border: 0;
  border-radius: 12px;
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
  font-size: 11px;
  background: rgb(255 255 255 / 0.1);
}
.step small {
  display: block;
  opacity: 0.5;
  font-size: 11px;
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
  font-size: 13px;
  line-height: 1.55;
  opacity: 0.75;
}
.dock {
  position: absolute;
  z-index: 5;
  left: 50%;
  bottom: 18px;
  transform: translateX(-50%);
  display: flex;
  gap: 4px;
  padding: 6px;
  border-radius: 999px;
  background: rgb(8 12 22 / 0.75);
  border: 1px solid rgb(255 255 255 / 0.12);
  backdrop-filter: blur(18px);
}
.dock button {
  border: 0;
  background: transparent;
  color: inherit;
  padding: 8px 16px;
  border-radius: 999px;
  cursor: pointer;
  font: inherit;
  font-size: 13px;
  opacity: 0.65;
}
.dock button.on {
  opacity: 1;
  background: rgb(103 232 249 / 0.18);
}
.status,
.merge {
  position: relative;
  z-index: 1;
  display: grid;
  grid-template-columns: 240px 1fr 280px;
  gap: 12px;
  padding: 8px 20px 88px;
  height: calc(100% - 54px);
}
.merge {
  grid-template-columns: 1.4fr 0.8fr;
}
.pane {
  padding: 16px;
  overflow: auto;
  min-height: 0;
}
.br,
.file {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  border: 0;
  background: transparent;
  color: inherit;
  padding: 8px 4px;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.br.on {
  background: rgb(103 232 249 / 0.1);
  border-radius: 8px;
  padding-left: 8px;
}
.br span {
  margin-left: auto;
  font-size: 11px;
  opacity: 0.55;
}
.file code {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.letter {
  width: 18px;
  height: 18px;
  border-radius: 4px;
  display: grid;
  place-items: center;
  font-size: 10px;
  font-weight: 700;
}
.letter.mod {
  background: #f59e0b;
  color: #1c1002;
}
.letter.new {
  background: #38bdf8;
  color: #04202c;
}
.log {
  margin: 12px 0 0;
  padding: 0;
  list-style: none;
  font-size: 13px;
  line-height: 1.8;
  opacity: 0.75;
}
.river {
  display: grid;
  grid-template-columns: 1fr 1.2fr 1fr;
  align-items: center;
  padding: 28px;
  gap: 8px;
}
.lane {
  padding: 16px;
  border-radius: 14px;
  background: rgb(255 255 255 / 0.04);
}
.lane small {
  display: block;
  opacity: 0.5;
  font-size: 11px;
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
  stroke: url(#none);
  stroke: #67e8f9;
  stroke-width: 2;
  opacity: 0.7;
}
.stamp {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  padding: 6px 12px;
  border-radius: 999px;
  background: rgb(52 211 153 / 0.2);
  color: #bbf7d0;
  font-size: 12px;
  white-space: nowrap;
}
.sheet {
  position: absolute;
  z-index: 6;
  left: 50%;
  bottom: 78px;
  transform: translateX(-50%);
  width: min(560px, calc(100% - 40px));
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
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
  gap: 8px;
  min-height: 120px;
}
.msgs p {
  margin: 0;
  padding: 8px 12px;
  border-radius: 12px;
  font-size: 13px;
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
  font-size: 12px;
  padding: 8px 10px;
  border-radius: 10px;
  background: rgb(251 191 36 / 0.12);
  color: #fde68a;
}
.composer {
  display: flex;
  gap: 8px;
}
.composer input {
  flex: 1;
  border: 0;
  border-radius: 12px;
  padding: 10px 12px;
  background: rgb(255 255 255 / 0.08);
  color: inherit;
  font: inherit;
  outline: none;
}
</style>
