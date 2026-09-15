<script setup lang="ts">
import { onMounted } from 'vue';
import { RouterLink, useRoute } from 'vue-router';
import { labDemos } from './mock';
import { ensureLabFonts } from './labFonts';

defineProps<{
  title: string;
  kicker?: string;
}>();

const route = useRoute();

onMounted(() => ensureLabFonts());
</script>

<template>
  <div class="frame">
    <header class="bar">
      <RouterLink class="back" to="/ui-lab">← 实验室</RouterLink>
      <span class="kicker" v-if="kicker">{{ kicker }}</span>
      <strong class="title">{{ title }}</strong>
      <span class="hint">示意数据 · 可点可切 · 不会改仓库</span>
      <nav class="jumps">
        <RouterLink
          v-for="d in labDemos"
          :key="d.id"
          :to="d.path"
          class="jump"
          :class="{ on: route.path === d.path }"
        >
          {{ d.name }}
        </RouterLink>
      </nav>
    </header>
    <div class="body">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.frame {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  font-family: inherit;
  font-size: var(--gc-text);
}
.bar {
  flex: none;
  display: flex;
  align-items: center;
  gap: var(--gc-gap);
  height: var(--gc-line);
  padding: 0 var(--gc-pad);
  z-index: 20;
  background: rgb(0 0 0 / 0.35);
  backdrop-filter: blur(12px);
  border-bottom: 1px solid rgb(255 255 255 / 0.08);
  color: #e8eef8;
  font-size: var(--gc-text);
}
.back {
  color: inherit;
  text-decoration: none;
  display: inline-flex;
  align-items: center;
  height: var(--gc-control);
  padding: 0 var(--gc-gap);
  border-radius: var(--gc-radius);
  background: rgb(255 255 255 / 0.08);
}
.back:hover {
  background: rgb(255 255 255 / 0.14);
}
.kicker {
  opacity: 0.55;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  font-size: var(--gc-text);
}
.title {
  font-size: var(--gc-text);
  font-weight: 600;
}
.hint {
  opacity: 0.45;
}
.jumps {
  margin-left: auto;
  display: flex;
  gap: var(--gc-gap);
}
.jump {
  color: inherit;
  text-decoration: none;
  display: inline-flex;
  align-items: center;
  height: var(--gc-control);
  padding: 0 var(--gc-pad);
  border-radius: var(--gc-radius);
  opacity: 0.55;
}
.jump.on,
.jump:hover {
  opacity: 1;
  background: rgb(255 255 255 / 0.1);
}
.body {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
</style>
