<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { useReposStore } from '@/stores/repos';
import { useSettingsStore } from '@/stores/settings';
import { repoLeaf, sameRepoPath, useChatStore } from '@/stores/chat';
import * as api from '@/api/client';
import MessageList from '@/components/chat/MessageList.vue';
import ConfirmBar from '@/components/chat/ConfirmBar.vue';
import { readChatByteStream, type ChatEvent } from '@/components/chat/events';
import { isMockConfirmToken, mockChatBody } from '@/components/chat/mockReplies';
import type { ChatLine, PendingConfirm } from '@/components/chat/types';

const props = defineProps<{
  embedded?: boolean;
}>();
const emit = defineEmits<{
  leave: [];
  phase: [phase: 'idle' | 'streaming' | 'confirm' | 'error'];
}>();

const repos = useReposStore();
const settings = useSettingsStore();
const chat = useChatStore();
const router = useRouter();

function leaveTo(path: string, query?: Record<string, string>): void {
  emit('leave');
  void router.push(query ? { path, query } : path);
}

const input = ref('');
const errorHold = ref(false);
let errorPending = false;
let errorTimer = 0;
const listEl = ref<HTMLElement | null>(null);

const mockPreview = computed(() => !settings.llm?.tokenSet);
const repoOpen = computed(() => repos.repos.some((r) => chat.repoPath && sameRepoPath(r.path, chat.repoPath)));
const repoChoices = computed(() => {
  const paths = repos.repos.map((r) => r.path);
  const rows = repos.repos.map((r) => ({ path: r.path, label: choiceLabel(r.path, paths) }));
  if (chat.repoPath && !rows.some((r) => sameRepoPath(r.path, chat.repoPath!))) {
    rows.unshift({ path: chat.repoPath, label: repoLeaf(chat.repoPath) });
  }
  return rows;
});
const selectedPath = computed(() => {
  if (!chat.repoPath) return '';
  return repoChoices.value.find((r) => sameRepoPath(r.path, chat.repoPath!))?.path ?? chat.repoPath;
});
const canSend = computed(() => Boolean(repoOpen.value && repos.healthOk && input.value.trim() && !chat.streaming));
const chatPhase = computed(() => {
  if (chat.pending.length) return 'confirm' as const;
  if (chat.streaming) return 'streaming' as const;
  if (errorHold.value) return 'error' as const;
  return 'idle' as const;
});

watch(chatPhase, (phase) => emit('phase', phase), { immediate: true });

function noteStreamError(): void {
  errorPending = true;
}

watch(
  () => chat.streaming,
  (on) => {
    if (on || !errorPending) return;
    errorPending = false;
    errorHold.value = true;
    window.clearTimeout(errorTimer);
    errorTimer = window.setTimeout(() => {
      errorHold.value = false;
    }, 1200);
  }
);

watch(
  () => chat.repoPath,
  (next, prev) => {
    if (!prev || !next || sameRepoPath(prev, next)) return;
    input.value = '';
  }
);

watch(
  () => [repos.healthOk, repos.currentPath] as const,
  () => {
    if (repos.healthOk !== true) return;
    void chat.boot(repos.currentPath).then((err) => {
      if (err) ElMessage.error(err);
    });
  },
  { immediate: true }
);

function choiceLabel(path: string, all: string[]): string {
  const leaf = repoLeaf(path);
  if (all.filter((p) => repoLeaf(p) === leaf).length < 2) return leaf;
  const parts = path.replace(/\\/g, '/').split('/').filter(Boolean);
  return parts.slice(-2).join('/') || leaf;
}

async function onPick(path: string | number | boolean): Promise<void> {
  if (typeof path !== 'string' || !path) return;
  const err = await chat.selectRepo(path);
  if (err) ElMessage.error(err);
}

async function onNew(): Promise<void> {
  const err = await chat.startBlank();
  if (err) ElMessage.error(err);
}

async function saveTurn(): Promise<void> {
  const err = await chat.flush();
  if (err) ElMessage.error(err);
}

async function scrollBottom(): Promise<void> {
  await nextTick();
  if (listEl.value) listEl.value.scrollTop = listEl.value.scrollHeight;
}

async function send(): Promise<void> {
  const text = input.value.trim();
  const path = chat.repoPath;
  if (!text || !path || chat.streaming || !repoOpen.value) return;
  if (!chat.conversationId) {
    const err = await chat.startBlank();
    if (err) {
      ElMessage.error(err);
      return;
    }
  }
  const sessionId = chat.conversationId;
  if (!sessionId) return;
  input.value = '';
  chat.pushLine({ role: 'user', text });
  const assistant = chat.pushLine({ role: 'assistant', text: '' });
  chat.streaming = true;
  await scrollBottom();
  try {
    const onEvent = (event: ChatEvent) => {
      applyEvent(assistant, event);
      void scrollBottom();
    };
    if (mockPreview.value) {
      await readChatByteStream(mockChatBody(), onEvent);
    } else {
      const history = chat.lines
        .filter((l) => l.role === 'user' || (l.role === 'assistant' && l.text.trim()))
        .map((l) => ({ role: l.role as 'user' | 'assistant', content: l.text }));
      await api.streamChat({ messages: history, repoPath: path, sessionId }, { onEvent });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const row = chat.lines.find((l) => l.id === assistant.id);
    if (row && !row.text) row.text = msg;
    noteStreamError();
    ElMessage.error(msg);
  } finally {
    chat.streaming = false;
    await saveTurn();
    await scrollBottom();
  }
}

function applyEvent(assistant: ChatLine, event: ChatEvent): void {
  const row = chat.lines.find((l) => l.id === assistant.id) ?? assistant;
  if (event.type === 'delta') row.text += event.text;
  else if (event.type === 'confirm') {
    chat.pending.push({
      token: event.token,
      tool: event.tool,
      command: event.preview.command,
      affectedFiles: event.preview.affectedFiles ?? [],
      note: event.preview.note
    });
  } else if (event.type === 'tool') {
    chat.pushLine({ role: 'tool', text: '', tool: event.tool, success: event.success });
  } else if (event.type === 'error') {
    noteStreamError();
    if (!row.text) row.text = event.error;
    else row.text += `\n${event.error}`;
  }
}

async function confirmOne(item: PendingConfirm): Promise<void> {
  chat.confirming = true;
  try {
    if (isMockConfirmToken(item.token)) {
      chat.pending = chat.pending.filter((p) => p.token !== item.token);
      chat.pushLine({ role: 'system', text: `本地预览：未执行 ${item.tool}：${item.command}` });
      return;
    }
    const res = await api.confirmChat(item.token);
    chat.pending = chat.pending.filter((p) => p.token !== item.token);
    if (!res.ok) {
      ElMessage.error(res.error || '确认失败');
      chat.pushLine({ role: 'system', text: res.error || '确认失败，请重新让模型预览' });
      return;
    }
    chat.pushLine({ role: 'system', text: `已执行 ${res.tool}：${item.command}` });
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : String(err));
  } finally {
    chat.confirming = false;
    await saveTurn();
  }
}

async function cancelOne(item: PendingConfirm): Promise<void> {
  chat.confirming = true;
  try {
    if (isMockConfirmToken(item.token)) {
      chat.pending = chat.pending.filter((p) => p.token !== item.token);
      chat.pushLine({ role: 'system', text: `已取消 ${item.tool}` });
      return;
    }
    const res = await api.confirmChat(item.token, { cancel: true });
    chat.pending = chat.pending.filter((p) => p.token !== item.token);
    if (!res.ok) {
      ElMessage.error(res.error || '取消失败');
      return;
    }
    chat.pushLine({ role: 'system', text: `已取消 ${item.tool}` });
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : String(err));
  } finally {
    chat.confirming = false;
    await saveTurn();
  }
}

onMounted(() => {
  void settings.load(repos.currentId).catch(() => undefined);
});

onUnmounted(() => {
  window.clearTimeout(errorTimer);
});
</script>

<template>
  <div class="page chat-page" :class="{ embedded: props.embedded }">
    <h2 v-if="!props.embedded" class="page-title">聊天</h2>
    <div class="chat-bar">
      <el-select
        :model-value="selectedPath"
        class="repo-select"
        placeholder="选择仓库"
        :disabled="chat.busy || repoChoices.length === 0"
        @change="onPick"
      >
        <el-option v-for="row in repoChoices" :key="row.path" :label="row.label" :value="row.path" />
      </el-select>
      <el-button :disabled="chat.busy || !chat.repoPath" @click="onNew">新对话</el-button>
    </div>
    <p class="page-lead">在这里看改动、暂存和提交。推送和合并用其它页。换仓库只影响这段聊天。</p>
    <el-alert
      v-if="!repos.healthOk"
      title="后端离线。请先启动 git-cockpit start，或用桌面应用拉起 daemon。"
      type="error"
      :closable="false"
      show-icon
      class="mb"
    />
    <el-alert
      v-else-if="mockPreview"
      title="本地预览，未连接模型。回复来自内置样本，确认不会写入仓库。对话仍会记入对话记录。"
      type="info"
      :closable="false"
      show-icon
      class="mb"
    >
      <el-button link type="primary" @click="leaveTo('/settings', { tab: 'llm' })">去配置模型</el-button>
    </el-alert>
    <el-alert
      v-if="repos.healthOk && !chat.repoPath"
      title="请先在上方选择仓库。列表来自工作台已打开的仓库。"
      type="info"
      :closable="false"
      show-icon
      class="mb"
    >
      <el-button link type="primary" @click="leaveTo('/dashboard')">去工作台</el-button>
    </el-alert>
    <el-alert
      v-else-if="repos.healthOk && chat.repoPath && !repoOpen"
      title="该仓库已从工作台关闭。记录可以查看，重新打开后才能继续发送。"
      type="info"
      :closable="false"
      show-icon
      class="mb"
    >
      <el-button link type="primary" @click="leaveTo('/dashboard')">去工作台</el-button>
    </el-alert>

    <div ref="listEl" class="chat-list gc-glass">
      <MessageList :lines="chat.lines" :streaming="chat.streaming" />
    </div>

    <div class="dock-stack" :class="{ pending: chat.pending.length }">
      <ConfirmBar :items="chat.pending" :confirming="chat.confirming" @confirm="confirmOne" @cancel="cancelOne" />
      <div class="composer">
        <el-input
          v-model="input"
          type="textarea"
          :rows="3"
          :disabled="chat.streaming || !repoOpen || !repos.healthOk"
          placeholder="例如：看看改了什么，帮我提交"
          @keydown.enter.exact.prevent="send"
        />
        <el-button type="primary" :disabled="!canSend" :loading="chat.streaming" @click="send">发送</el-button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.chat-page {
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.chat-bar {
  flex: none;
  display: flex;
  gap: var(--gc-gap);
  align-items: center;
  margin-bottom: var(--gc-gap);
}
.repo-select {
  flex: 1;
  min-width: 0;
}
.page-lead {
  flex: none;
  margin: 0 0 var(--gc-gap);
  font-size: var(--gc-text);
  color: var(--el-text-color-secondary);
}
.chat-list {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: var(--gc-pad);
}
.dock-stack {
  flex: none;
  display: flex;
  flex-direction: column;
  margin-top: var(--gc-gap);
}
.dock-stack :deep(.confirm-bar) {
  margin-top: 0;
}
.dock-stack :deep(.confirm-card) {
  border-bottom-left-radius: 0;
  border-bottom-right-radius: 0;
}
.dock-stack.pending .composer {
  margin-top: 0;
  padding: var(--gc-gap);
  border: 1px solid var(--el-color-warning);
  border-top: 0;
  border-radius: 0 0 var(--gc-radius) var(--gc-radius);
  background: var(--el-bg-color);
}
.composer {
  flex: none;
  display: flex;
  gap: var(--gc-gap);
  align-items: flex-end;
}
.composer .el-textarea {
  flex: 1;
}
.chat-page.embedded {
  overflow: hidden;
}
</style>
