<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import DemoFrame from './DemoFrame.vue';
import MiniHeat from './MiniHeat.vue';
import { mockChat, mockFiles, mockJobs, mockRepos, paletteActions } from './mock';

type Page = 'board' | 'status' | 'merge';

const page = ref<Page>('board');
const currentId = ref(1);
const expanded = ref<number | null>(1);
const chatOpen = ref(true);
const paletteOpen = ref(false);
const query = ref('');
const toast = ref<string | null>(null);
const lines = ref([...mockChat]);
const chatInput = ref('');
const paletteIndex = ref(0);
const hotkey = /Mac|iPhone/i.test(navigator.platform) ? '⌘K' : 'Ctrl+K';

const current = computed(() => mockRepos.find((r) => r.id === currentId.value) ?? mockRepos[0]!);
const filtered = computed(() => {
  const q = query.value.trim().toLowerCase();
  if (!q) return paletteActions;
  return paletteActions.filter((a) => (a.label + a.hint + a.group).toLowerCase().includes(q));
});

function toggle(id: number): void {
  expanded.value = expanded.value === id ? null : id;
  currentId.value = id;
}
function runAction(id: string): void {
  paletteOpen.value = false;
  query.value = '';
  if (id === 'status') page.value = 'status';
  else if (id === 'merge' || id === 'mr') page.value = 'merge';
  else if (id === 'chat') chatOpen.value = true;
  else if (id === 'fetch') pulse('已开始 fetch · payment-core');
  else if (id === 'commit') pulse('dry-run：git commit（未写入）');
  else if (id === 'jobs') pulse(mockJobs[0]?.title ?? '任务');
  else if (id === 'settings') pulse('设置仍在现有页，这是示意');
}
function pulse(msg: string): void {
  toast.value = msg;
  window.setTimeout(() => {
    if (toast.value === msg) toast.value = null;
  }, 2400);
}
function send(): void {
  const t = chatInput.value.trim();
  if (!t) return;
  lines.value.push({ role: 'user', text: t });
  lines.value.push({ role: 'assistant', text: '示意：命令面板和侧聊共用同一套动作，不占一个完整路由。' });
  chatInput.value = '';
}
function onKey(e: KeyboardEvent): void {
  const meta = e.metaKey || e.ctrlKey;
  if ((meta && e.key.toLowerCase() === 'k') || e.key === '/') {
    if ((e.target as HTMLElement | null)?.closest?.('input, textarea')) {
      if (e.key === '/') return;
    }
    e.preventDefault();
    paletteOpen.value = !paletteOpen.value;
    paletteIndex.value = 0;
  } else if (e.key === 'Escape') {
    paletteOpen.value = false;
  } else if (paletteOpen.value && e.key === 'ArrowDown') {
    e.preventDefault();
    paletteIndex.value = Math.min(filtered.value.length - 1, paletteIndex.value + 1);
  } else if (paletteOpen.value && e.key === 'ArrowUp') {
    e.preventDefault();
    paletteIndex.value = Math.max(0, paletteIndex.value - 1);
  } else if (paletteOpen.value && e.key === 'Enter') {
    const a = filtered.value[paletteIndex.value];
    if (a) runAction(a.id);
  }
}

onMounted(() => window.addEventListener('keydown', onKey));
onUnmounted(() => window.removeEventListener('keydown', onKey));
</script>

<template>
  <DemoFrame kicker="Orbit" title="命令优先">
    <div class="orbit">
      <header class="top">
        <div class="brand">Git Cockpit</div>
        <button class="search" type="button" @click="paletteOpen = true">
          搜索仓库、预演、提交…
          <kbd>{{ hotkey }}</kbd>
        </button>
        <div class="who">
          <code>{{ current.name }}</code>
          <span>{{ current.branch }}</span>
        </div>
      </header>

      <div class="shell">
        <nav class="rail">
          <button :class="{ on: page === 'board' }" title="工作台" @click="page = 'board'">▣</button>
          <button :class="{ on: page === 'status' }" title="状态" @click="page = 'status'">⎇</button>
          <button :class="{ on: page === 'merge' }" title="合并" @click="page = 'merge'">⇄</button>
          <button class="spacer" :class="{ on: chatOpen }" title="聊天" @click="chatOpen = !chatOpen">✎</button>
        </nav>

        <main v-if="page === 'board'" class="list">
          <header class="list-head">
            <h2>仓库</h2>
            <p>{{ mockRepos.length }} 个已打开 · 点行展开，不必先「选中再进另一页」</p>
          </header>
          <article
            v-for="r in mockRepos"
            :key="r.id"
            class="row"
            :class="[r.attention, { open: expanded === r.id }]"
            @click="toggle(r.id)"
          >
            <span class="orb" />
            <div class="id">
              <strong>{{ r.name }}</strong>
              <code>{{ r.branch }}</code>
            </div>
            <MiniHeat :days="r.activity" :size="6" />
            <div class="nums">
              <span>{{ r.ahead }}↑ {{ r.behind }}↓</span>
              <span v-if="r.dirty">{{ r.dirty }} 更改</span>
            </div>
            <div v-if="expanded === r.id" class="expand" @click.stop>
              <button @click="page = 'status'">工作区</button>
              <button @click="page = 'merge'">预演合并</button>
              <button @click="pulse('已开始 fetch · ' + r.name)">刷新远程</button>
              <button class="ghost">移除</button>
            </div>
          </article>
        </main>

        <main v-else-if="page === 'status'" class="panel">
          <h2>工作区 · {{ current.name }}</h2>
          <p class="sub">文件是一条条声明，不是挤在 32px 表格里。</p>
          <div v-for="f in mockFiles" :key="f.path" class="change">
            <b :class="f.kind">{{ f.letter }}</b>
            <code>{{ f.path }}</code>
            <button>{{ f.staged ? '取消暂存' : '暂存' }}</button>
          </div>
        </main>

        <main v-else class="panel">
          <h2>预演 · {{ current.branch }} → origin/main</h2>
          <div class="outcome">可干净合并</div>
          <p class="sub">方向写在一句里。动作收在命令面板：落盘、推送、看 MR 正文。</p>
          <div class="expand show">
            <button class="primary" @click="runAction('commit')">落盘</button>
            <button @click="runAction('mr')">看 MR 正文</button>
          </div>
        </main>

        <aside v-if="chatOpen" class="chat">
          <header>
            <span>助手</span>
            <button class="ghost" @click="chatOpen = false">收起</button>
          </header>
          <div class="msgs">
            <p v-for="(m, i) in lines" :key="i" :class="m.role">{{ m.text }}</p>
          </div>
          <form @submit.prevent="send">
            <input v-model="chatInput" placeholder="问一句，或按 / 呼出命令" />
          </form>
        </aside>
      </div>

      <div v-if="paletteOpen" class="pal-mask" @click.self="paletteOpen = false">
        <div class="pal">
          <input
            v-model="query"
            placeholder="预演、提交、抓取、开单…"
            autofocus
            @input="paletteIndex = 0"
          />
          <button
            v-for="(a, i) in filtered"
            :key="a.id"
            :class="{ on: i === paletteIndex }"
            @mouseenter="paletteIndex = i"
            @click="runAction(a.id)"
          >
            <small>{{ a.group }}</small>
            <span>{{ a.label }}</span>
            <em>{{ a.hint }}</em>
          </button>
        </div>
      </div>

      <div v-if="toast" class="toast">{{ toast }}</div>
    </div>
  </DemoFrame>
</template>

<style scoped>
.orbit {
  height: 100%;
  position: relative;
  display: flex;
  flex-direction: column;
  background: #0b0c10;
  color: #ece8f5;
  --heat-1: rgb(167 139 250 / 0.3);
  --heat-2: rgb(167 139 250 / 0.5);
  --heat-3: rgb(167 139 250 / 0.75);
  --heat-4: #c4b5fd;
}
.top {
  display: grid;
  grid-template-columns: 140px 1fr 220px;
  align-items: center;
  gap: 16px;
  padding: 12px 18px;
  border-bottom: 1px solid rgb(255 255 255 / 0.06);
}
.brand {
  font-weight: 600;
  letter-spacing: 0.04em;
}
.search {
  justify-self: center;
  width: min(420px, 100%);
  display: flex;
  justify-content: space-between;
  align-items: center;
  border: 1px solid rgb(255 255 255 / 0.1);
  background: #14151c;
  color: rgb(236 232 245 / 0.55);
  border-radius: 12px;
  padding: 10px 14px;
  cursor: text;
  font: inherit;
}
kbd {
  font-size: 11px;
  padding: 2px 6px;
  border-radius: 6px;
  background: rgb(255 255 255 / 0.08);
}
.who {
  justify-self: end;
  text-align: right;
  font-size: 12px;
}
.who code {
  display: block;
  font-size: 12px;
}
.who span {
  opacity: 0.5;
}
.shell {
  flex: 1;
  min-height: 0;
  display: flex;
}
.rail {
  width: 56px;
  flex: none;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px 8px;
  border-right: 1px solid rgb(255 255 255 / 0.06);
}
.rail button {
  height: 40px;
  border: 0;
  border-radius: 12px;
  background: transparent;
  color: inherit;
  cursor: pointer;
  font-size: 16px;
  opacity: 0.45;
}
.rail button.on,
.rail button:hover {
  opacity: 1;
  background: rgb(167 139 250 / 0.16);
}
.rail .spacer {
  margin-top: auto;
}
.list,
.panel {
  flex: 1;
  min-width: 0;
  overflow: auto;
  padding: 28px 36px 48px;
}
.list-head h2,
.panel h2 {
  margin: 0 0 6px;
  font-family: Fraunces, Georgia, serif;
  font-size: 28px;
  font-weight: 600;
}
.list-head p,
.sub {
  margin: 0 0 22px;
  color: rgb(236 232 245 / 0.5);
  font-size: 13px;
}
.row {
  display: grid;
  grid-template-columns: 10px 1fr auto auto;
  gap: 16px;
  align-items: center;
  padding: 16px 8px;
  border-bottom: 1px solid rgb(255 255 255 / 0.05);
  cursor: pointer;
}
.row.open {
  background: rgb(167 139 250 / 0.06);
  border-radius: 16px;
  border-bottom-color: transparent;
  padding: 16px 14px;
  margin: 4px -6px;
}
.orb {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #86efac;
}
.row.dirty .orb {
  background: #fbbf24;
}
.row.sync .orb {
  background: #93c5fd;
}
.row.stuck .orb {
  background: #fb7185;
}
.id strong {
  display: block;
  font-size: 15px;
}
.id code {
  font-size: 12px;
  opacity: 0.5;
}
.nums {
  font-size: 12px;
  opacity: 0.55;
  text-align: right;
}
.expand {
  grid-column: 2 / -1;
  display: flex;
  gap: 8px;
  padding-top: 8px;
}
.expand.show {
  display: flex;
  padding-top: 0;
}
.expand button,
.change button,
.chat button,
.ghost {
  border: 0;
  border-radius: 10px;
  padding: 8px 12px;
  background: #1b1c27;
  color: inherit;
  cursor: pointer;
  font: inherit;
  font-size: 12px;
}
.expand .primary,
.expand button.primary {
  background: #a78bfa;
  color: #12081f;
  font-weight: 600;
}
.ghost {
  background: transparent;
  opacity: 0.55;
}
.change {
  display: grid;
  grid-template-columns: 28px 1fr auto;
  gap: 12px;
  align-items: center;
  padding: 12px 0;
  border-bottom: 1px solid rgb(255 255 255 / 0.05);
}
.change b {
  width: 22px;
  height: 22px;
  display: grid;
  place-items: center;
  border-radius: 6px;
  font-size: 11px;
}
.change b.mod {
  background: #f59e0b;
  color: #1c1002;
}
.change b.new {
  background: #38bdf8;
  color: #04202c;
}
.outcome {
  display: inline-block;
  margin-bottom: 10px;
  padding: 6px 12px;
  border-radius: 999px;
  background: rgb(52 211 153 / 0.16);
  color: #bbf7d0;
  font-size: 13px;
}
.chat {
  width: 320px;
  flex: none;
  display: flex;
  flex-direction: column;
  border-left: 1px solid rgb(255 255 255 / 0.06);
  background: #101118;
}
.chat header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 14px;
  font-size: 13px;
}
.msgs {
  flex: 1;
  overflow: auto;
  padding: 8px 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.msgs p {
  margin: 0;
  padding: 8px 10px;
  border-radius: 12px;
  font-size: 13px;
  line-height: 1.5;
  white-space: pre-wrap;
}
.msgs .user {
  align-self: flex-end;
  background: rgb(167 139 250 / 0.18);
}
.msgs .assistant {
  background: rgb(255 255 255 / 0.05);
}
.chat form {
  padding: 12px;
}
.chat input,
.pal input {
  width: 100%;
  border: 0;
  border-radius: 10px;
  padding: 10px 12px;
  background: #1b1c27;
  color: inherit;
  font: inherit;
  outline: none;
}
.pal-mask {
  position: absolute;
  inset: 0;
  background: rgb(0 0 0 / 0.45);
  display: grid;
  place-items: start center;
  padding-top: 12vh;
  z-index: 30;
}
.pal {
  width: min(560px, 92vw);
  background: #16171f;
  border: 1px solid rgb(255 255 255 / 0.1);
  border-radius: 16px;
  overflow: hidden;
  box-shadow: 0 24px 80px rgb(0 0 0 / 0.5);
}
.pal input {
  border-radius: 0;
  padding: 16px 18px;
  font-size: 16px;
  background: transparent;
  border-bottom: 1px solid rgb(255 255 255 / 0.06);
}
.pal button {
  width: 100%;
  display: grid;
  grid-template-columns: 64px 1fr auto;
  gap: 8px;
  align-items: center;
  padding: 10px 18px;
  border: 0;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
  font: inherit;
}
.pal button.on {
  background: rgb(167 139 250 / 0.14);
}
.pal small {
  font-size: 11px;
  opacity: 0.45;
}
.pal em {
  font-style: normal;
  font-size: 12px;
  opacity: 0.4;
}
.toast {
  position: absolute;
  right: 24px;
  bottom: 24px;
  padding: 12px 16px;
  border-radius: 12px;
  background: #1b1c27;
  border: 1px solid rgb(167 139 250 / 0.35);
  font-size: 13px;
  z-index: 40;
  animation: up 0.25s ease;
}
@keyframes up {
  from {
    transform: translateY(8px);
    opacity: 0;
  }
}
</style>
