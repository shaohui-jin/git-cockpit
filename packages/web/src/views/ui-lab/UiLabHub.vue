<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { RouterLink } from 'vue-router';
import { labDemos } from './mock';
import { ensureLabFonts } from './labFonts';

onMounted(() => ensureLabFonts());

const hovered = ref<string | null>(null);
const featured = computed(() => labDemos.find((d) => d.id === 'deck') ?? labDemos[0]);
const cards = computed(() => labDemos.find((d) => d.id === 'cards'));
const rest = computed(() => labDemos.filter((d) => d.id !== 'deck' && d.id !== 'cards'));
</script>

<template>
  <div class="hub">
    <div class="glow a" />
    <div class="glow b" />
    <header class="hero">
      <RouterLink class="back" to="/dashboard">← 回工作台</RouterLink>
      <p class="eyebrow">布局实验室 · 整合稿</p>
      <h1>按你的挑选拼了一套。<br />指挥台外壳，天气筛仓，红绿监视器。</h1>
      <p class="lead">
        原先「未同步」右边那块其实是下一张仓库卡挤进去了，看着不像功能。整合稿把数字条和仓库一览拆开。下面仍留着四套对照。
      </p>
    </header>

    <RouterLink
      v-if="featured"
      :to="featured.path"
      class="card featured deck"
      :class="{ hot: hovered === 'deck' }"
      @mouseenter="hovered = 'deck'"
      @mouseleave="hovered = null"
    >
      <div class="preview" aria-hidden="true">
        <div class="pv-deck">
          <i class="hero-block" />
          <i class="wx" /><i class="wx" /><i class="wx" /><i class="wx" />
          <i class="tile" /><i class="tile" /><i class="tile" />
          <b class="dock" />
        </div>
      </div>
      <div class="meta">
        <span class="name">{{ featured.name }}</span>
        <h2>{{ featured.title }}</h2>
        <p>{{ featured.pitch }}</p>
        <span class="tag">{{ featured.tag }}</span>
      </div>
    </RouterLink>

    <RouterLink
      v-if="cards"
      :to="cards.path"
      class="card featured cards"
      :class="{ hot: hovered === 'cards' }"
      @mouseenter="hovered = 'cards'"
      @mouseleave="hovered = null"
    >
      <div class="preview" aria-hidden="true">
        <div class="pv-cards">
          <i class="crush" /><i class="crush" /><i class="crush" />
          <i class="crush" /><i class="crush" /><i class="crush" />
        </div>
      </div>
      <div class="meta">
        <span class="name">{{ cards.name }}</span>
        <h2>{{ cards.title }}</h2>
        <p>{{ cards.pitch }}</p>
        <span class="tag">{{ cards.tag }}</span>
      </div>
    </RouterLink>

    <p class="section">对照 · 原来四套</p>
    <section class="grid">
      <RouterLink
        v-for="d in rest"
        :key="d.id"
        :to="d.path"
        class="card"
        :class="[d.id, { hot: hovered === d.id }]"
        @mouseenter="hovered = d.id"
        @mouseleave="hovered = null"
      >
        <div class="preview" aria-hidden="true">
          <div v-if="d.id === 'aurora'" class="pv-aurora">
            <i class="hero-block" />
            <i class="stat" />
            <i class="stat s2" />
            <i class="tile" /><i class="tile" /><i class="tile" />
            <b class="dock" />
          </div>
          <div v-else-if="d.id === 'orbit'" class="pv-orbit">
            <b class="top" />
            <i class="rail" />
            <span class="rows"><i /><i /><i /><i /></span>
            <i class="chat" />
          </div>
          <div v-else-if="d.id === 'studio'" class="pv-studio">
            <i class="rail" />
            <i class="col" />
            <i class="stage" />
            <i class="side" />
          </div>
          <div v-else class="pv-grove">
            <i class="plot" /><i class="plot p2" /><i class="plot p3" />
            <i class="plot" /><i class="plot p2" /><i class="plot p3" />
          </div>
        </div>
        <div class="meta">
          <span class="name">{{ d.name }}</span>
          <h2>{{ d.title }}</h2>
          <p>{{ d.pitch }}</p>
          <span class="tag">{{ d.tag }}</span>
        </div>
      </RouterLink>
    </section>

    <footer class="foot">
      现有页还在 <code>/#/dashboard</code>。实验室只加路由，不替换生产布局。
    </footer>
  </div>
</template>

<style scoped>
.hub {
  height: 100%;
  overflow: auto;
  position: relative;
  color: #eef3fb;
  background: #080b12;
  font-family: Outfit, Inter, 'PingFang SC', sans-serif;
  padding: 28px 40px 48px;
}
.glow {
  position: absolute;
  pointer-events: none;
  filter: blur(80px);
  opacity: 0.55;
}
.glow.a {
  width: 420px;
  height: 420px;
  left: -80px;
  top: -120px;
  background: #2dd4bf;
}
.glow.b {
  width: 380px;
  height: 380px;
  right: -40px;
  top: 40px;
  background: #818cf8;
}
.hero {
  position: relative;
  max-width: 720px;
  margin-bottom: 36px;
}
.back {
  display: inline-block;
  color: rgb(255 255 255 / 0.7);
  text-decoration: none;
  font-size: 12px;
  margin-bottom: 18px;
}
.eyebrow {
  margin: 0 0 10px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  font-size: 11px;
  color: #99f6e4;
}
h1 {
  margin: 0 0 14px;
  font-family: Fraunces, Georgia, serif;
  font-size: 40px;
  font-weight: 600;
  line-height: 1.2;
  letter-spacing: -0.02em;
}
.lead {
  margin: 0;
  font-size: 15px;
  line-height: 1.65;
  color: rgb(238 243 251 / 0.72);
  max-width: 58ch;
}
.grid {
  position: relative;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
  max-width: 1080px;
}
.card.featured {
  position: relative;
  max-width: 1080px;
  margin-bottom: 28px;
  grid-template-columns: 240px 1fr;
  padding: 20px;
}
.section {
  position: relative;
  max-width: 1080px;
  margin: 0 0 12px;
  font-size: 12px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: rgb(238 243 251 / 0.45);
}
.card {
  display: grid;
  grid-template-columns: 180px 1fr;
  gap: 16px;
  padding: 16px;
  border-radius: 20px;
  text-decoration: none;
  color: inherit;
  background: rgb(255 255 255 / 0.04);
  border: 1px solid rgb(255 255 255 / 0.08);
  transition:
    transform 0.25s ease,
    background 0.25s ease,
    border-color 0.25s ease;
}
.card:hover,
.card.hot {
  transform: translateY(-4px);
  background: rgb(255 255 255 / 0.07);
  border-color: rgb(255 255 255 / 0.18);
}
.preview {
  height: 128px;
  border-radius: 14px;
  overflow: hidden;
  background: #0c111c;
  border: 1px solid rgb(255 255 255 / 0.06);
}
.meta h2 {
  margin: 2px 0 8px;
  font-family: Fraunces, Georgia, serif;
  font-size: 22px;
  font-weight: 600;
}
.meta p {
  margin: 0 0 12px;
  font-size: 13px;
  line-height: 1.55;
  color: rgb(238 243 251 / 0.68);
}
.name {
  font-size: 11px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: #a5b4fc;
}
.aurora .name {
  color: #5eead4;
}
.deck .name {
  color: #67e8f9;
}
.cards .name {
  color: #fda4af;
}
.studio .name {
  color: #fcd34d;
}
.grove .name {
  color: #d4a373;
}
.tag {
  font-size: 11px;
  opacity: 0.5;
}
.foot {
  position: relative;
  margin-top: 28px;
  font-size: 12px;
  color: rgb(255 255 255 / 0.4);
}
.foot code {
  font-size: 11px;
}

.pv-aurora,
.pv-orbit,
.pv-studio,
.pv-grove,
.pv-deck {
  height: 100%;
  display: grid;
  padding: 10px;
  gap: 6px;
}
.pv-deck {
  grid-template-columns: repeat(4, 1fr);
  grid-template-rows: 1.1fr 0.45fr 0.55fr 10px;
}
.pv-deck .hero-block {
  grid-column: 1 / -1;
  grid-row: 1;
}
.pv-deck .wx {
  border-radius: 5px;
  background: rgb(103 232 249 / 0.28);
}
.pv-deck .tile {
  grid-row: 3;
  grid-column: auto;
}
.pv-deck .dock {
  grid-column: 1 / -1;
}
.pv-cards {
  height: 100%;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
  padding: 10px;
}
.pv-cards .crush {
  border-radius: 6px;
  background: linear-gradient(90deg, rgb(255 255 255 / 0.18) 28%, rgb(251 113 133 / 0.45) 28%);
}
.pv-aurora {
  grid-template-columns: 1.4fr 0.6fr 0.6fr;
  grid-template-rows: 1fr 0.55fr 10px;
}
.hero-block {
  grid-column: 1;
  grid-row: 1 / 3;
  border-radius: 8px;
  background: linear-gradient(160deg, #22d3ee, #6366f1 70%);
  opacity: 0.85;
}
.stat {
  border-radius: 6px;
  background: rgb(255 255 255 / 0.1);
}
.tile {
  grid-row: 2;
  border-radius: 5px;
  background: rgb(45 212 191 / 0.25);
}
.dock {
  grid-column: 1 / -1;
  height: 8px;
  border-radius: 99px;
  background: rgb(255 255 255 / 0.16);
  align-self: end;
}
.pv-orbit {
  grid-template-columns: 10px 1fr 36px;
  grid-template-rows: 12px 1fr;
}
.pv-orbit .top {
  grid-column: 1 / -1;
  border-radius: 4px;
  background: rgb(255 255 255 / 0.12);
}
.pv-orbit .rail {
  border-radius: 4px;
  background: #a78bfa;
  opacity: 0.7;
}
.rows {
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.rows i {
  height: 10px;
  border-radius: 4px;
  background: rgb(255 255 255 / 0.1);
}
.pv-orbit .chat {
  border-radius: 6px;
  background: rgb(167 139 250 / 0.28);
}
.pv-studio {
  grid-template-columns: 8px 0.7fr 1.4fr 0.7fr;
}
.pv-studio .rail {
  border-radius: 4px;
  background: #fbbf24;
  opacity: 0.75;
}
.pv-studio .col,
.pv-studio .side {
  border-radius: 6px;
  background: rgb(255 255 255 / 0.08);
}
.pv-studio .stage {
  border-radius: 6px;
  background: linear-gradient(180deg, #f59e0b 0%, #111827 70%);
  opacity: 0.85;
}
.pv-grove {
  grid-template-columns: repeat(3, 1fr);
}
.plot {
  border-radius: 10px;
  background: #3f6212;
  opacity: 0.7;
}
.plot.p2 {
  background: #b45309;
}
.plot.p3 {
  background: #9f1239;
}

@media (max-width: 860px) {
  .grid {
    grid-template-columns: 1fr;
  }
  h1 {
    font-size: 30px;
  }
}
</style>
