<script setup lang="ts">
import { computed, ref } from 'vue';
import DemoFrame from './DemoFrame.vue';
import MiniHeat from './MiniHeat.vue';
import { attentionLabel, mockChat, mockFiles, mockRepos, type Attention, type MockRepo } from './mock';

type Scene = 'garden' | 'bench' | 'graft' | 'note';

const scene = ref<Scene>('garden');
const currentId = ref(1);
const weather = ref<Attention | 'all'>('all');
const lines = ref([...mockChat]);
const note = ref('');

const current = computed(() => mockRepos.find((r) => r.id === currentId.value) ?? mockRepos[0]!);
const plots = computed(() =>
  mockRepos.filter((r) => (weather.value === 'all' ? true : r.attention === weather.value))
);

function weatherOf(a: Attention): string {
  if (a === 'stuck') return '雷雨';
  if (a === 'dirty') return '薄雾';
  if (a === 'sync') return '刮风';
  return '晴天';
}
function open(r: MockRepo): void {
  currentId.value = r.id;
}
function send(): void {
  const t = note.value.trim();
  if (!t) return;
  lines.value.push({ role: 'user', text: t });
  lines.value.push({ role: 'assistant', text: '记在手帐里了。这是示意，不会调用模型。' });
  note.value = '';
}
</script>

<template>
  <DemoFrame kicker="Grove" title="园圃">
    <div class="grove">
      <header class="top">
        <div>
          <p class="kicker">今天的园子</p>
          <h2>{{ current.name }}</h2>
        </div>
        <div class="wx">
          <button :class="{ on: weather === 'all' }" @click="weather = 'all'">全部</button>
          <button :class="{ on: weather === 'stuck' }" @click="weather = 'stuck'">雷雨</button>
          <button :class="{ on: weather === 'dirty' }" @click="weather = 'dirty'">薄雾</button>
          <button :class="{ on: weather === 'sync' }" @click="weather = 'sync'">刮风</button>
          <button :class="{ on: weather === 'clean' }" @click="weather = 'clean'">晴天</button>
        </div>
      </header>

      <main v-if="scene === 'garden'" class="plots">
        <article
          v-for="r in plots"
          :key="r.id"
          class="plot"
          :class="[r.attention, { on: r.id === currentId }]"
          @click="open(r)"
        >
          <div class="plot-top">
            <strong>{{ r.name }}</strong>
            <span>{{ weatherOf(r.attention) }}</span>
          </div>
          <code>{{ r.branch }}</code>
          <MiniHeat :days="r.activity" :size="7" />
          <footer>
            <span>{{ attentionLabel(r.attention) }}</span>
            <span>{{ r.lastOpened }}</span>
          </footer>
        </article>
      </main>

      <main v-else-if="scene === 'bench'" class="bench">
        <section class="paper">
          <h3>工作台纸</h3>
          <p>文件像叠着的草稿纸，而不是树控件。</p>
          <div v-for="f in mockFiles" :key="f.path" class="slip" :class="f.kind">
            <b>{{ f.letter }}</b>
            <code>{{ f.path }}</code>
          </div>
        </section>
        <section class="tools">
          <h3>手边工具</h3>
          <button>暂存</button>
          <button>提交</button>
          <button>stash</button>
          <button class="warn">硬重置</button>
        </section>
      </main>

      <main v-else-if="scene === 'graft'" class="graft">
        <svg viewBox="0 0 640 280">
          <path class="limb a" d="M40 200 C 160 200, 220 80, 320 80" />
          <path class="limb b" d="M40 80 C 160 80, 220 80, 320 80" />
          <path class="limb c" d="M320 80 C 420 80, 500 140, 600 140" />
          <circle cx="40" cy="80" r="7" class="b" />
          <circle cx="40" cy="200" r="7" class="a" />
          <circle cx="320" cy="80" r="9" class="join" />
          <circle cx="600" cy="140" r="7" class="join" />
          <text x="52" y="76" class="t">feat/ui-lab</text>
          <text x="52" y="224" class="t dim">origin/main</text>
          <text x="430" y="128" class="t">临时枝 · 可推送</text>
        </svg>
        <p>两条枝接到一起。干净合并像嫁接成活，冲突则在接合处停住等你动手。</p>
      </main>

      <main v-else class="note-page">
        <div class="book">
          <p v-for="(m, i) in lines" :key="i" :class="m.role">{{ m.text }}</p>
        </div>
        <form @submit.prevent="send">
          <input v-model="note" placeholder="写一句给助手…" />
        </form>
      </main>

      <nav class="soil">
        <button :class="{ on: scene === 'garden' }" @click="scene = 'garden'">园圃</button>
        <button :class="{ on: scene === 'bench' }" @click="scene = 'bench'">工作台</button>
        <button :class="{ on: scene === 'graft' }" @click="scene = 'graft'">嫁接</button>
        <button :class="{ on: scene === 'note' }" @click="scene = 'note'">手帐</button>
      </nav>
    </div>
  </DemoFrame>
</template>

<style scoped>
.grove {
  height: 100%;
  position: relative;
  display: flex;
  flex-direction: column;
  background:
    radial-gradient(800px 400px at 10% 0%, rgb(212 163 115 / 0.12), transparent 50%),
    #16110c;
  color: #f3eadc;
  --heat-0: rgb(255 255 255 / 0.06);
  --heat-1: rgb(132 204 22 / 0.28);
  --heat-2: rgb(132 204 22 / 0.5);
  --heat-3: rgb(202 138 4 / 0.7);
  --heat-4: #d4a373;
}
.top {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  padding: 18px 24px 8px;
  gap: 16px;
}
.kicker {
  margin: 0 0 4px;
  font-size: 11px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: #d4a373;
}
h2 {
  margin: 0;
  font-family: Fraunces, Georgia, serif;
  font-size: 30px;
  font-weight: 600;
}
.wx {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.wx button,
.soil button,
.tools button {
  border: 0;
  background: rgb(255 255 255 / 0.06);
  color: inherit;
  padding: 7px 12px;
  border-radius: 999px;
  cursor: pointer;
  font: inherit;
  font-size: 12px;
}
.wx button.on,
.soil button.on {
  background: #d4a373;
  color: #2a1c10;
  font-weight: 600;
}
.plots {
  flex: 1;
  min-height: 0;
  overflow: auto;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 14px;
  padding: 12px 24px 84px;
  align-content: start;
}
.plot {
  padding: 16px;
  border-radius: 22px;
  background: #221c16;
  border: 1px solid rgb(212 163 115 / 0.12);
  display: flex;
  flex-direction: column;
  gap: 10px;
  cursor: pointer;
  animation: breathe 5s ease-in-out infinite;
  transition: transform 0.2s ease;
}
.plot:hover,
.plot.on {
  transform: translateY(-4px);
  border-color: #d4a373;
}
.plot.stuck {
  animation-duration: 1.8s;
  border-color: rgb(190 18 60 / 0.45);
}
.plot-top {
  display: flex;
  justify-content: space-between;
  font-size: 13px;
}
.plot-top span {
  opacity: 0.55;
}
.plot footer {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  opacity: 0.5;
}
@keyframes breathe {
  50% {
    box-shadow: 0 8px 24px rgb(0 0 0 / 0.25);
  }
}
.bench,
.graft,
.note-page {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 12px 24px 84px;
}
.bench {
  display: grid;
  grid-template-columns: 1.4fr 0.6fr;
  gap: 16px;
}
.paper,
.tools {
  background: #221c16;
  border-radius: 22px;
  padding: 18px;
}
h3 {
  margin: 0 0 8px;
  font-family: Fraunces, Georgia, serif;
}
.paper p {
  margin: 0 0 14px;
  opacity: 0.6;
  font-size: 13px;
}
.slip {
  display: flex;
  gap: 10px;
  align-items: center;
  padding: 10px 12px;
  margin-bottom: 8px;
  border-radius: 12px;
  background: #2a231c;
  transform: rotate(-0.4deg);
}
.slip:nth-child(odd) {
  transform: rotate(0.5deg);
}
.slip b {
  width: 20px;
  height: 20px;
  border-radius: 6px;
  display: grid;
  place-items: center;
  font-size: 11px;
  background: #d4a373;
  color: #2a1c10;
}
.tools {
  display: flex;
  flex-direction: column;
  gap: 8px;
  height: fit-content;
}
.tools .warn {
  background: rgb(190 18 60 / 0.25);
  color: #fecdd3;
}
.graft svg {
  display: block;
  width: min(720px, 100%);
  height: auto;
  margin: 24px auto 8px;
}
.limb {
  fill: none;
  stroke-width: 4;
  stroke-linecap: round;
}
.limb.a {
  stroke: #78716c;
}
.limb.b {
  stroke: #84cc16;
}
.limb.c {
  stroke: #d4a373;
}
circle.a {
  fill: #78716c;
}
circle.b {
  fill: #84cc16;
}
circle.join {
  fill: #d4a373;
}
.t {
  fill: #f3eadc;
  font-size: 14px;
  font-family: Outfit, sans-serif;
}
.t.dim {
  fill: #a8a29e;
}
.graft p {
  max-width: 52ch;
  margin: 12px auto 0;
  text-align: center;
  font-size: 14px;
  line-height: 1.6;
  opacity: 0.8;
}
.note-page {
  font-size: 14px;
  line-height: 1.6;
  opacity: 0.8;
}
.book {
  background: #f3eadc;
  color: #3f2e1f;
  border-radius: 8px 18px 18px 8px;
  padding: 22px 24px;
  min-height: 280px;
  box-shadow: 8px 12px 0 #2a231c;
  font-family: Fraunces, Georgia, serif;
}
.book p {
  margin: 0 0 12px;
  white-space: pre-wrap;
}
.book .user {
  color: #9a3412;
}
.note-page form {
  margin-top: 14px;
}
.note-page input {
  width: 100%;
  border: 0;
  border-radius: 12px;
  padding: 12px 14px;
  background: #221c16;
  color: inherit;
  font: inherit;
  outline: none;
}
.soil {
  position: absolute;
  left: 50%;
  bottom: 16px;
  transform: translateX(-50%);
  display: flex;
  gap: 6px;
  padding: 6px;
  border-radius: 999px;
  background: #221c16;
  border: 1px solid rgb(212 163 115 / 0.2);
}
</style>
