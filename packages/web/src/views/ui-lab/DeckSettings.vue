<script setup lang="ts">
import { ref } from 'vue';
import { mockGitTools, mockSettings, mockTemplateFields } from './mock';
import type { Edge } from './mock';

const props = defineProps<{ edge: Edge }>();

type Tab = 'mr' | 'git' | 'template' | 'llm';
const tab = ref<Tab>('mr');
const method = ref<'cli' | 'token' | 'browser'>('cli');
const toast = ref('');
const tokenBad = () => props.edge === 'nokey';

function ping(msg: string): void {
  toast.value = msg;
  window.setTimeout(() => {
    if (toast.value === msg) toast.value = '';
  }, 1800);
}
</script>

<template>
  <div class="set">
    <p v-if="edge === 'offline'" class="banner err">后端离线。设置读不到，保存会失败。</p>
    <p v-else-if="edge === 'empty'" class="banner info">还没选仓库。MR 远程、Token 绑定的是当前仓的 hostname。</p>
    <p v-else-if="edge === 'nokey'" class="banner warn">模型 API Key 未配置。聊天发不出去。高风险 Git 工具默认仍是关的。</p>

    <div class="tabs">
      <button v-for="t in (['mr', 'git', 'template', 'llm'] as const)" :key="t" :class="{ on: tab === t }" @click="tab = t">
        {{ { mr: 'MR 配置', git: 'Git 操作', template: '正文规范', llm: '模型' }[t] }}
      </button>
    </div>

    <section v-if="tab === 'mr'" class="stack">
      <div class="glass pad">
        <p class="eyebrow">默认远程</p>
        <p><code>origin</code> · git@github.com:acme/git-cockpit.git <em>GitHub</em></p>
      </div>
      <button
        v-for="m in ([
          { id: 'cli' as const, title: 'A 本机 CLI', ready: mockSettings.mr.gh === '已登录', hint: 'gh ' + mockSettings.mr.gh + ' · glab ' + mockSettings.mr.glab },
          { id: 'token' as const, title: 'B Token', ready: !tokenBad(), hint: tokenBad() ? '未配置或校验失败' : '有效 · login · 至 2027/08/19' },
          { id: 'browser' as const, title: 'C 浏览器页', ready: true, hint: '打开创建页，正文需自己贴' }
        ])"
        :key="m.id"
        class="glass opt"
        :class="{ on: method === m.id }"
        @click="method = m.id"
      >
        <header>
          <strong>{{ m.title }}</strong>
          <span :class="m.ready ? 'ok' : 'bad'">{{ m.ready ? '可用' : '未就绪' }}</span>
        </header>
        <p>{{ m.hint }}</p>
        <div v-if="method === m.id && m.id === 'token'" class="panel">
          <input :placeholder="tokenBad ? 'ghp_… 保存前会校验' : '已保存 ghp_••••abcd'" />
          <button class="btn primary" @click="ping('示意：校验并保存 Token')">保存</button>
        </div>
        <div v-if="method === m.id && m.id === 'cli'" class="panel">
          <p>未下载时给官方链接，不替你装。已登录会用 gh/glab 的 token 走和 B 相同的校验。</p>
        </div>
      </button>
    </section>

    <section v-else-if="tab === 'git'" class="stack">
      <div class="glass pad">
        <p class="eyebrow">高风险默认关 · 执行前自动备份</p>
        <label v-for="g in mockGitTools" :key="g.id" class="tool">
          <input type="checkbox" :checked="g.on" @change="ping('示意：权限只在真设置页落盘')" />
          <code>{{ g.id }}</code>
          <span>{{ g.label }}</span>
          <em v-if="g.risk === 'high'">高风险</em>
        </label>
        <p class="hint">allowedRepos 空 = 不限制。dry-run 默认 {{ mockSettings.git.dryRunDefault ? '开' : '关' }}。</p>
      </div>
    </section>

    <section v-else-if="tab === 'template'" class="stack">
      <div class="glass pad">
        <p class="eyebrow">MR 正文规范</p>
        <p class="hint">启用后网页弹层和 MCP git_mr_create 都要按字段填。浏览器开单只给正文复制。</p>
        <div v-for="f in mockTemplateFields" :key="f.key" class="field">
          <span>{{ f.label }}</span>
          <em>{{ f.required ? '必填' : '选填' }}</em>
        </div>
        <button class="btn" @click="ping('示意：从 Default.md 导入')">导入 Markdown</button>
      </div>
    </section>

    <section v-else class="stack">
      <div class="glass pad">
        <p class="eyebrow">聊天模型</p>
        <label class="kv">模型 <input :value="mockSettings.llm.model" readonly /></label>
        <label class="kv">Base URL <input placeholder="可空，OpenAI 兼容" /></label>
        <label class="kv">
          API Key
          <input :placeholder="edge === 'nokey' ? '未配置' : mockSettings.llm.tokenPreview" />
        </label>
        <div class="row">
          <button class="btn primary" @click="ping('示意：保存并探活')">保存</button>
          <button class="btn" @click="ping('示意：已清除 Key')">清除 Key</button>
        </div>
      </div>
    </section>
    <div v-if="toast" class="toast">{{ toast }}</div>
  </div>
</template>

<style scoped>
@import './deck-shared.css';
.set {
  position: relative;
  z-index: 1;
  padding: var(--gc-gap) var(--gc-pad) calc(var(--gc-line) + var(--gc-pad) * 2);
  height: 100%;
  overflow: auto;
}
.tabs {
  display: flex;
  gap: var(--gc-gap);
  margin-bottom: var(--gc-pad);
}
.tabs button {
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
.tabs button.on {
  background: rgb(103 232 249 / 0.18);
}
.stack {
  display: flex;
  flex-direction: column;
  gap: var(--gc-gap);
  max-width: 720px;
}
.pad {
  padding: var(--gc-pad);
}
.opt {
  padding: var(--gc-pad);
  text-align: left;
  color: inherit;
  cursor: pointer;
  font: inherit;
  width: 100%;
}
.opt.on {
  box-shadow: 0 0 0 1px rgb(103 232 249 / 0.4) inset;
}
.opt header {
  display: flex;
  justify-content: space-between;
}
.opt p,
.hint {
  margin: var(--gc-gap) 0 0;
  font-size: var(--gc-text);
  opacity: 0.6;
  line-height: 1.5;
}
.ok {
  color: #6ee7b7;
  font-size: var(--gc-text);
}
.bad {
  color: #fda4af;
  font-size: var(--gc-text);
}
.panel {
  margin-top: var(--gc-gap);
  display: flex;
  gap: var(--gc-gap);
  align-items: center;
}
.panel p {
  margin: 0;
}
.tool,
.field,
.kv {
  display: flex;
  align-items: center;
  gap: var(--gc-gap);
  padding: 0;
  height: var(--gc-line);
  font-size: var(--gc-text);
}
.tool em,
.field em {
  margin-left: auto;
  font-style: normal;
  font-size: var(--gc-text);
  color: #fda4af;
}
.kv {
  display: grid;
  grid-template-columns: 80px 1fr;
}
input {
  flex: 1;
  border: 0;
  border-radius: var(--gc-radius);
  padding: 0 var(--gc-pad);
  height: var(--gc-control);
  background: rgb(255 255 255 / 0.08);
  color: inherit;
  font: inherit;
}
.row {
  display: flex;
  gap: var(--gc-gap);
  margin-top: var(--gc-gap);
}
.toast {
  position: absolute;
  right: var(--gc-pad);
  bottom: calc(var(--gc-control) + var(--gc-pad) * 2);
  padding: var(--gc-gap) var(--gc-pad);
  border-radius: var(--gc-radius);
  background: #121826;
  border: 1px solid rgb(103 232 249 / 0.3);
  font-size: var(--gc-text);
}
</style>
