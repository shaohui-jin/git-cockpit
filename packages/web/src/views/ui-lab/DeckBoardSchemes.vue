<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, reactive, ref } from 'vue';
import DemoFrame from './DemoFrame.vue';
import MiniHeat from './MiniHeat.vue';
import { activityFrom, weatherOf, type Attention, type MockRepo } from './mock';
import './deck-shared.css';

const currentId = ref(1);
const menu = reactive({ id: 0 as number, x: 0, y: 0 });
const menuEl = ref<HTMLUListElement | null>(null);
const flash = ref('点右上角 ⋯ 出菜单。菜单挂在 body 上，不会被下一张卡挡住。');

const repos: MockRepo[] = [
  item(1, 'git-cockpit-frontend-workspace', 'feat/ui-lab', 'dirty', 3, 1, 14),
  item(2, 'A-account-center-service', 'master', 'stuck', 0, 0, 0, true),
  item(3, 'payment-gateway-adapter', 'feature/best-effort-timeout', 'dirty', 2, 0, 9),
  item(4, 'ops-portal-admin-console', 'master', 'sync', 0, 4, 0),
  item(5, 'legacy-billing-core', 'main', 'stuck', 0, 0, 0, true),
  item(6, 'mobile-wallet-android', 'release/3.2', 'clean', 0, 0, 0),
  item(7, 'infra-playbooks-prod', 'develop', 'sync', 0, 2, 0),
  item(8, 'C-checkout-orchestrator', 'main', 'stuck', 0, 0, 0, true)
];

function item(
  id: number,
  name: string,
  branch: string,
  attention: Attention,
  ahead: number,
  behind: number,
  dirty: number,
  missing = false
): MockRepo {
  return {
    id,
    name,
    path: `D:\\work\\${name}`,
    branch: missing ? '—' : branch,
    ahead,
    behind,
    dirty,
    conflicts: attention === 'stuck' && !missing ? 3 : 0,
    operation: attention === 'stuck' && !missing ? 'merge' : 'none',
    drafts: 0,
    attention: missing ? 'stuck' : attention,
    activity: activityFrom(name),
    lastOpened: missing ? '路径不存在' : '9/15 09:12',
    available: missing ? false : undefined
  };
}

const current = () => repos.find((r) => r.id === currentId.value) ?? repos[0];

function say(text: string): void {
  flash.value = text;
  menu.id = 0;
}

function wx(r: MockRepo): string {
  return r.available === false ? '丢失' : weatherOf(r.attention);
}

async function openMenu(e: MouseEvent, r: MockRepo): Promise<void> {
  e.stopPropagation();
  const btn = (e.currentTarget as HTMLElement).getBoundingClientRect();
  menu.id = r.id;
  menu.x = btn.right;
  menu.y = btn.bottom + 4;
  await nextTick();
  const box = menuEl.value?.getBoundingClientRect();
  const w = box?.width ?? 168;
  const h = box?.height ?? 128;
  let x = btn.right - w;
  let y = btn.bottom + 4;
  if (x < 8) x = 8;
  if (y + h > window.innerHeight - 8) y = Math.max(8, btn.top - h - 4);
  menu.x = x;
  menu.y = y;
}

function closeMenu(): void {
  menu.id = 0;
}

function onWinClick(e: MouseEvent): void {
  const t = e.target as HTMLElement | null;
  if (t?.closest?.('.dots') || t?.closest?.('.gc-card-menu')) return;
  closeMenu();
}

onMounted(() => {
  window.addEventListener('click', onWinClick, true);
  window.addEventListener('scroll', closeMenu, true);
});
onUnmounted(() => {
  window.removeEventListener('click', onWinClick, true);
  window.removeEventListener('scroll', closeMenu, true);
});
</script>

<template>
  <DemoFrame kicker="专题" title="工作台卡片 · 零按钮 + 一条 fetch">
    <div class="page">
      <aside class="brief glass">
        <p>
          卡片只留仓名、天气、热力。干活走右上角 <strong>⋯</strong>，菜单
          <code>Teleport</code> 到 body，<code>z-index: 4000</code>，不被下一张挡住。
        </p>
        <p>
          <strong>刷新</strong> = 对所有可用仓 <code>git fetch</code>，<em>合成一条 Job</em>（标题如
          <code>fetch 18 个仓库</code>）。日志按 <code>[3/18] path … ok / 失败</code> 往下写。丢失仓跳过。不要 18 条任务。
        </p>
      </aside>

      <section class="hero glass">
        <div>
          <p class="eyebrow">当前仓库</p>
          <h2>{{ current().name }}</h2>
          <div class="hero-actions">
            <button class="btn primary" :disabled="current().available === false" @click="say('进入工作区 · ' + current().name)">
              进入工作区
            </button>
            <button class="btn" :disabled="current().available === false" @click="say('预演合并 · ' + current().name)">
              预演合并
            </button>
          </div>
        </div>
      </section>

      <div class="toolbar glass">
        <span class="eyebrow tight">仓库一览</span>
        <button class="btn primary" @click="say('一条任务：fetch ' + repos.filter((r) => r.available !== false).length + ' 个仓库（丢失已跳过）')">
          刷新
        </button>
      </div>

      <div class="grid">
        <article
          v-for="r in repos"
          :key="r.id"
          class="tile glass"
          :class="[r.attention, { on: r.id === currentId, miss: r.available === false }]"
          @click="currentId = r.id"
          @dblclick="say('进入工作区 · ' + r.name)"
        >
          <header>
            <strong :title="r.name">{{ r.name }}</strong>
            <em :class="r.attention">{{ wx(r) }}</em>
            <button type="button" class="dots" aria-label="更多" @click="openMenu($event, r)">⋯</button>
          </header>
          <code>{{ r.available === false ? '不可用' : r.branch }}</code>
          <footer>
            <MiniHeat :days="r.activity" :size="5" />
            <span>{{ r.ahead }}↑ {{ r.behind }}↓</span>
          </footer>
        </article>
      </div>

      <p class="flash glass">{{ flash }}</p>
    </div>

    <Teleport to="body">
      <ul
        v-if="menu.id"
        ref="menuEl"
        class="el-dropdown-menu gc-card-menu demo-menu"
        :style="{ left: menu.x + 'px', top: menu.y + 'px' }"
        @click.stop
      >
        <li class="el-dropdown-menu__item" @click="say('进入工作区 · ' + (repos.find((x) => x.id === menu.id)?.name ?? ''))">
          进入工作区
        </li>
        <li class="el-dropdown-menu__item" @click="say('预演合并 · ' + (repos.find((x) => x.id === menu.id)?.name ?? ''))">
          预演合并
        </li>
        <li class="el-dropdown-menu__item" @click="say('抓取这一仓远程 · ' + (repos.find((x) => x.id === menu.id)?.name ?? ''))">
          抓取这一仓远程
        </li>
        <li
          class="el-dropdown-menu__item gc-danger"
          @click="say('移除（不删磁盘）· ' + (repos.find((x) => x.id === menu.id)?.name ?? ''))"
        >
          移除（不删磁盘）
        </li>
      </ul>
    </Teleport>
  </DemoFrame>
</template>

<style scoped>
.page {
  height: 100%;
  min-height: 0;
  overflow: auto;
  padding: var(--gc-pad);
  display: flex;
  flex-direction: column;
  gap: var(--gc-pad);
  color: #e8f4ff;
  background: #070b14;
  font-family: Outfit, Inter, 'PingFang SC', sans-serif;
}
.brief p {
  margin: 0 0 var(--gc-gap);
  line-height: 1.55;
  color: rgb(232 244 255 / 0.78);
}
.hero,
.toolbar {
  padding: var(--gc-pad);
}
.hero h2 {
  margin: 0 0 var(--gc-gap);
  font-size: 16px;
}
.hero-actions,
.toolbar {
  display: flex;
  gap: var(--gc-gap);
  align-items: center;
  flex-wrap: wrap;
}
.eyebrow.tight {
  margin: 0 auto 0 0;
}
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: var(--gc-gap);
}
.tile {
  padding: var(--gc-gap) var(--gc-pad);
  display: flex;
  flex-direction: column;
  gap: 6px;
  cursor: pointer;
  min-width: 0;
  border-left: 3px solid transparent;
}
.tile.on {
  box-shadow: 0 0 0 1px rgb(103 232 249 / 0.45);
}
.tile.dirty {
  border-left-color: #38bdf8;
}
.tile.stuck,
.tile.miss {
  border-left-color: #fb7185;
}
.tile.sync {
  border-left-color: #818cf8;
}
.tile.clean {
  border-left-color: #34d399;
}
header {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
header strong {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
}
header em {
  flex: none;
  font-style: normal;
  font-size: 11px;
  padding: 0 6px;
  border-radius: 999px;
  background: rgb(255 255 255 / 0.08);
}
.dots {
  flex: none;
  width: var(--gc-control);
  height: var(--gc-control);
  border: 0;
  border-radius: var(--gc-radius);
  background: transparent;
  color: inherit;
  cursor: pointer;
  font: inherit;
  font-size: 16px;
}
.dots:hover {
  background: rgb(255 255 255 / 0.08);
}
code {
  color: rgb(232 244 255 / 0.55);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
footer {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  color: rgb(232 244 255 / 0.45);
  font-size: 11px;
}
.flash {
  margin: 0;
  padding: var(--gc-gap) var(--gc-pad);
  color: #bae6fd;
}
</style>

<style>
.demo-menu {
  background: #121826;
  color: #e8f4ff;
  border: 1px solid rgb(255 255 255 / 0.12);
}
</style>
