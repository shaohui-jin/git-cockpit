<script setup lang="ts">
import { ref } from 'vue';
import DemoFrame from './DemoFrame.vue';
import { mockCommits, mockConflict, mockFiles, mockRepos } from './mock';

type View = 'workspace' | 'merge' | 'matrix';
type Side = 'ours' | 'theirs' | null;

const view = ref<View>('merge');
const file = ref(mockFiles[0]?.path ?? 'App.vue');
const repoName = mockRepos[0]?.name ?? 'git-cockpit';
const pick = ref<Side>(null);
const step = ref(0);
const cell = ref('a');

const matrix = [
  { id: 'a', from: 'feat/ui-lab', into: 'origin/main', state: 'clean' },
  { id: 'b', from: 'hotfix/login', into: 'origin/main', state: 'conflict' },
  { id: 'c', from: 'feat/pay-sheet', into: 'release/3.2', state: 'clean' },
  { id: 'd', from: 'develop', into: 'origin/main', state: 'same' },
  { id: 'e', from: 'feat/ui-lab', into: 'release/0.1', state: 'conflict' },
  { id: 'f', from: 'hotfix/login', into: 'develop', state: 'unrelated' }
];

const branches = [
  { name: 'feat/ui-lab', current: true, extra: '3↑ 1↓' },
  { name: 'origin/main', current: false, extra: '' },
  { name: 'release/0.1', current: false, extra: '' },
  { name: 'hotfix/login', current: false, extra: '冲突' }
];

function openCell(id: string, state: string): void {
  cell.value = id;
  view.value = 'merge';
  pick.value = state === 'conflict' ? null : 'theirs';
  step.value = 0;
}
</script>

<template>
  <DemoFrame kicker="Studio" title="合并剧场">
    <div class="studio">
      <nav class="bar">
        <button :class="{ on: view === 'workspace' }" @click="view = 'workspace'">工作区</button>
        <button :class="{ on: view === 'merge' }" @click="view = 'merge'">一对预演</button>
        <button :class="{ on: view === 'matrix' }" @click="view = 'matrix'">矩阵</button>
        <span class="repo">{{ repoName }}</span>
      </nav>

      <div v-if="view === 'workspace'" class="stage three">
        <aside class="col">
          <h3>分支</h3>
          <button v-for="b in branches" :key="b.name" class="br" :class="{ on: b.current }">
            <code>{{ b.name }}</code>
            <small>{{ b.extra }}</small>
          </button>
        </aside>
        <section class="col files">
          <h3>更改</h3>
          <button
            v-for="f in mockFiles"
            :key="f.path"
            class="file"
            :class="{ on: file === f.path }"
            @click="file = f.path"
          >
            <i :class="f.kind">{{ f.letter }}</i>
            <code>{{ f.path.split('/').slice(-2).join('/') }}</code>
          </button>
        </section>
        <section class="col diff">
          <h3>差异 · 像监视器</h3>
          <div class="monitor">
            <header>{{ file }}</header>
            <pre>
<span class="del">- const menuWork = [menuWorkRest]</span>
<span class="add">+ const menuWork = computed(() =>
+   settings.llm?.tokenSet ? [menuChat, ...menuWorkRest] : [...menuWorkRest, menuChat]
+ )</span>
            </pre>
          </div>
          <ul class="commits">
            <li v-for="c in mockCommits" :key="c.sha">
              <code>{{ c.sha }}</code>
              {{ c.msg }}
            </li>
          </ul>
        </section>
      </div>

      <div v-else-if="view === 'merge'" class="stage merge">
        <section class="river">
          <div class="from">
            <small>theirs · 我的</small>
            <strong>feat/ui-lab</strong>
          </div>
          <svg class="join" viewBox="0 0 320 140">
            <path class="p1" d="M0 36 C 120 36, 120 70, 320 70" />
            <path class="p2" d="M0 104 C 120 104, 120 70, 320 70" />
            <circle cx="318" cy="70" r="6" />
          </svg>
          <div class="into">
            <small>ours · 线上</small>
            <strong>origin/main</strong>
          </div>
        </section>

        <ol class="film">
          <li v-for="(s, i) in ['预演', '落盘', '推送', '开单']" :key="s" :class="{ on: step === i }" @click="step = i">
            {{ s }}
          </li>
        </ol>

        <section class="theater">
          <article class="side ours" :class="{ picked: pick === 'ours' }" @click="pick = 'ours'">
            <header>线上 ≪</header>
            <pre>{{ mockConflict.ours }}</pre>
          </article>
          <article class="side theirs" :class="{ picked: pick === 'theirs' }" @click="pick = 'theirs'">
            <header>我的 ≫</header>
            <pre>{{ mockConflict.theirs }}</pre>
          </article>
        </section>
        <p class="note">
          {{
            pick
              ? `已选 ${pick === 'ours' ? '线上' : '我的'}。示意里不会写回文件；真产品仍要你自己点边。`
              : '点一侧选边。冲突是舞台中央，不是卡片里的红字。'
          }}
        </p>
      </div>

      <div v-else class="stage matrix">
        <p class="lead">格子收成星图。干净是暖点，冲突是红点，点一下飞进那一对。</p>
        <div class="sky">
          <button
            v-for="m in matrix"
            :key="m.id"
            class="star"
            :class="[m.state, { on: cell === m.id }]"
            @click="openCell(m.id, m.state)"
          >
            <i />
            <span>{{ m.from }}</span>
            <em>→ {{ m.into }}</em>
          </button>
        </div>
      </div>
    </div>
  </DemoFrame>
</template>

<style scoped>
.studio {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: #120f0c;
  color: #f6efe4;
}
.bar {
  display: flex;
  gap: 6px;
  align-items: center;
  padding: 10px 16px;
  background: #1a1510;
  border-bottom: 1px solid rgb(252 211 77 / 0.12);
}
.bar button {
  border: 0;
  background: transparent;
  color: inherit;
  padding: 8px 12px;
  border-radius: 8px;
  cursor: pointer;
  font: inherit;
  font-size: 13px;
  opacity: 0.55;
}
.bar button.on {
  opacity: 1;
  background: rgb(252 211 77 / 0.14);
  color: #fcd34d;
}
.repo {
  margin-left: auto;
  font-size: 12px;
  opacity: 0.5;
}
.stage {
  flex: 1;
  min-height: 0;
  overflow: auto;
}
.three {
  display: grid;
  grid-template-columns: 220px 280px 1fr;
}
.col {
  padding: 16px;
  border-right: 1px solid rgb(255 255 255 / 0.06);
  overflow: auto;
}
h3 {
  margin: 0 0 12px;
  font-family: Fraunces, Georgia, serif;
  font-size: 16px;
  font-weight: 600;
}
.br,
.file {
  width: 100%;
  display: flex;
  justify-content: space-between;
  gap: 8px;
  border: 0;
  background: transparent;
  color: inherit;
  padding: 8px 6px;
  border-radius: 8px;
  cursor: pointer;
  font: inherit;
  text-align: left;
}
.br.on,
.file.on {
  background: rgb(252 211 77 / 0.1);
}
.br small {
  opacity: 0.5;
}
.file i {
  width: 18px;
  height: 18px;
  border-radius: 4px;
  display: grid;
  place-items: center;
  font-size: 10px;
  font-style: normal;
  font-weight: 700;
  background: #d97706;
  color: #1c1002;
  flex: none;
}
.file i.new {
  background: #38bdf8;
  color: #04202c;
}
.file code {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
.diff {
  border-right: 0;
}
.monitor {
  background: #070504;
  border-radius: 12px;
  overflow: hidden;
  border: 1px solid rgb(252 211 77 / 0.16);
  box-shadow: 0 0 40px rgb(252 211 77 / 0.08);
}
.monitor header {
  padding: 8px 12px;
  font-size: 11px;
  opacity: 0.55;
  border-bottom: 1px solid rgb(255 255 255 / 0.06);
}
.monitor pre,
.side pre {
  margin: 0;
  padding: 12px;
  font-size: 12px;
  line-height: 1.55;
  overflow: auto;
}
.del {
  color: #fda4af;
}
.add {
  color: #86efac;
}
.commits {
  list-style: none;
  padding: 12px 0 0;
  margin: 0;
  font-size: 12px;
  opacity: 0.7;
  line-height: 1.8;
}
.merge {
  padding: 20px 28px 32px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.river {
  display: grid;
  grid-template-columns: 1fr 320px 1fr;
  align-items: center;
  gap: 8px;
}
.from,
.into {
  padding: 18px 20px;
  border-radius: 16px;
  background: #1c1712;
}
.from {
  border-left: 3px solid #22d3ee;
}
.into {
  border-left: 3px solid #fbbf24;
}
.from small,
.into small {
  display: block;
  opacity: 0.5;
  font-size: 11px;
  margin-bottom: 4px;
}
.from strong,
.into strong {
  font-family: Fraunces, Georgia, serif;
  font-size: 22px;
}
.join {
  width: 100%;
  height: 140px;
}
.join path {
  fill: none;
  stroke-width: 2.4;
  stroke-linecap: round;
}
.join .p1 {
  stroke: #22d3ee;
}
.join .p2 {
  stroke: #fbbf24;
}
.join circle {
  fill: #86efac;
  filter: drop-shadow(0 0 8px #86efac);
}
.film {
  display: flex;
  gap: 8px;
  list-style: none;
  margin: 0;
  padding: 0;
}
.film li {
  padding: 8px 14px;
  border-radius: 999px;
  background: #1c1712;
  font-size: 13px;
  cursor: pointer;
  opacity: 0.55;
}
.film li.on {
  opacity: 1;
  background: #fbbf24;
  color: #1c1002;
  font-weight: 600;
}
.theater {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  flex: 1;
  min-height: 0;
}
.side {
  border-radius: 16px;
  background: #1c1712;
  overflow: auto;
  cursor: pointer;
  border: 1px solid transparent;
  transition: border-color 0.2s ease, transform 0.2s ease;
}
.side:hover {
  transform: translateY(-2px);
}
.side header {
  padding: 10px 14px;
  font-size: 12px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  opacity: 0.6;
}
.side.ours.picked {
  border-color: #fbbf24;
  box-shadow: 0 0 0 1px #fbbf24 inset;
}
.side.theirs.picked {
  border-color: #22d3ee;
  box-shadow: 0 0 0 1px #22d3ee inset;
}
.note {
  margin: 0;
  font-size: 13px;
  opacity: 0.65;
}
.matrix {
  padding: 28px 32px;
}
.lead {
  margin: 0 0 20px;
  opacity: 0.65;
}
.sky {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}
.star {
  display: flex;
  flex-direction: column;
  gap: 6px;
  align-items: flex-start;
  padding: 18px;
  border: 1px solid rgb(255 255 255 / 0.08);
  border-radius: 16px;
  background: #1c1712;
  color: inherit;
  cursor: pointer;
  font: inherit;
  text-align: left;
}
.star i {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #86efac;
  box-shadow: 0 0 12px #86efac;
}
.star.conflict i {
  background: #fb7185;
  box-shadow: 0 0 12px #fb7185;
}
.star.same i,
.star.unrelated i {
  background: #78716c;
  box-shadow: none;
}
.star em {
  font-style: normal;
  font-size: 12px;
  opacity: 0.5;
}
.star.on {
  border-color: #fbbf24;
}
</style>
