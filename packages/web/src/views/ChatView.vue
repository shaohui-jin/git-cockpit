<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { useReposStore } from '@/stores/repos';
import { useSettingsStore } from '@/stores/settings';
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
const router = useRouter();

function leaveTo(path: string, query?: Record<string, string>): void {
  emit('leave');
  void router.push(query ? { path, query } : path);
}

const input = ref('');
const streaming = ref(false);
const confirming = ref(false);
const lines = ref<ChatLine[]>([]);
const pending = ref<PendingConfirm[]>([]);
const errorHold = ref(false);
let errorPending = false;
let errorTimer = 0;
let seq = 0;
const listEl = ref<HTMLElement | null>(null);

const repoPath = computed(() => repos.currentPath);
const mockPreview = computed(() => !settings.llm?.tokenSet);
const canSend = computed(() => Boolean(repoPath.value && repos.healthOk && input.value.trim() && !streaming.value));
const chatPhase = computed(() => {
  if (pending.value.length) return 'confirm' as const;
  if (streaming.value) return 'streaming' as const;
  if (errorHold.value) return 'error' as const;
  return 'idle' as const;
});

watch(chatPhase, (phase) => emit('phase', phase), { immediate: true });

function noteStreamError(): void {
  errorPending = true;
}

watch(streaming, (on) => {
  if (on || !errorPending) return;
  errorPending = false;
  errorHold.value = true;
  window.clearTimeout(errorTimer);
  errorTimer = window.setTimeout(() => {
    errorHold.value = false;
  }, 1200);
});

function sessionIdFor(path: string): string {
  const key = `gc-chat-session:${path}`;
  let id = sessionStorage.getItem(key);
  if (!id) {
    id = crypto.randomUUID();
    sessionStorage.setItem(key, id);
  }
  return id;
}

function push(role: ChatLine['role'], text: string, extra?: Partial<ChatLine>): ChatLine {
  const row: ChatLine = { id: ++seq, role, text, ...extra };
  lines.value.push(row);
  return row;
}

async function scrollBottom(): Promise<void> {
  await nextTick();
  if (listEl.value) listEl.value.scrollTop = listEl.value.scrollHeight;
}

watch(repoPath, (_next, prev) => {
  lines.value = [];
  pending.value = [];
  seq = 0;
  if (prev) sessionStorage.removeItem(`gc-chat-session:${prev}`);
});

async function send(): Promise<void> {
  const text = input.value.trim();
  const path = repoPath.value;
  if (!text || !path || streaming.value) return;
  input.value = '';
  push('user', text);
  const assistant = push('assistant', '');
  streaming.value = true;
  await scrollBottom();
  try {
    const onEvent = (event: ChatEvent) => {
      applyEvent(assistant, event);
      void scrollBottom();
    };
    if (mockPreview.value) {
      await readChatByteStream(mockChatBody(), onEvent);
    } else {
      const history = lines.value
        .filter((l) => l.role === 'user' || (l.role === 'assistant' && l.text.trim()))
        .map((l) => ({ role: l.role as 'user' | 'assistant', content: l.text }));
      await api.streamChat({ messages: history, repoPath: path, sessionId: sessionIdFor(path) }, { onEvent });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const row = lines.value.find((l) => l.id === assistant.id);
    if (row && !row.text) row.text = msg;
    noteStreamError();
    ElMessage.error(msg);
  } finally {
    streaming.value = false;
    await scrollBottom();
  }
}

function applyEvent(assistant: ChatLine, event: ChatEvent): void {
  const row = lines.value.find((l) => l.id === assistant.id) ?? assistant;
  if (event.type === 'delta') row.text += event.text;
  else if (event.type === 'confirm') {
    pending.value.push({
      token: event.token,
      tool: event.tool,
      command: event.preview.command,
      affectedFiles: event.preview.affectedFiles ?? [],
      note: event.preview.note
    });
  } else if (event.type === 'tool') {
    push('tool', '', { tool: event.tool, success: event.success });
  } else if (event.type === 'error') {
    noteStreamError();
    if (!row.text) row.text = event.error;
    else row.text += `\n${event.error}`;
  }
}

async function confirmOne(item: PendingConfirm): Promise<void> {
  confirming.value = true;
  try {
    if (isMockConfirmToken(item.token)) {
      pending.value = pending.value.filter((p) => p.token !== item.token);
      push('system', `本地预览：未执行 ${item.tool}：${item.command}`);
      confirming.value = false;
      return;
    }
    const res = await api.confirmChat(item.token);
    pending.value = pending.value.filter((p) => p.token !== item.token);
    if (!res.ok) {
      ElMessage.error(res.error || '确认失败');
      push('system', res.error || '确认失败，请重新让模型预览');
      return;
    }
    push('system', `已执行 ${res.tool}：${item.command}`);
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : String(err));
  } finally {
    confirming.value = false;
  }
}

async function cancelOne(item: PendingConfirm): Promise<void> {
  confirming.value = true;
  try {
    if (isMockConfirmToken(item.token)) {
      pending.value = pending.value.filter((p) => p.token !== item.token);
      push('system', `已取消 ${item.tool}`);
      confirming.value = false;
      return;
    }
    const res = await api.confirmChat(item.token, { cancel: true });
    pending.value = pending.value.filter((p) => p.token !== item.token);
    if (!res.ok) {
      ElMessage.error(res.error || '取消失败');
      return;
    }
    push('system', `已取消 ${item.tool}`);
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : String(err));
  } finally {
    confirming.value = false;
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
    <p class="page-lead">
      当前仓：<span class="mono">{{ repoPath || '未选择' }}</span>
      。打开/克隆请走工作台，写入同一份仓库列表。第一期只能看改动并暂存/提交；推送和合并请用其它页。
    </p>
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
      title="本地预览，未连接模型。回复来自内置样本，确认不会写入仓库。"
      type="info"
      :closable="false"
      show-icon
      class="mb"
    >
      <el-button link type="primary" @click="leaveTo('/settings', { tab: 'llm' })">去配置模型</el-button>
    </el-alert>
    <el-alert
      v-else-if="!repoPath"
      title="请先在工作台打开并选择仓库"
      type="info"
      :closable="false"
      show-icon
      class="mb"
    >
      <el-button link type="primary" @click="leaveTo('/dashboard')">去工作台</el-button>
    </el-alert>

    <div ref="listEl" class="chat-list gc-glass">
      <MessageList :lines="lines" :streaming="streaming" />
    </div>

    <div class="dock-stack" :class="{ pending: pending.length }">
      <ConfirmBar :items="pending" :confirming="confirming" @confirm="confirmOne" @cancel="cancelOne" />
      <div class="composer">
        <el-input
          v-model="input"
          type="textarea"
          :rows="3"
          :disabled="streaming || !repoPath || !repos.healthOk"
          placeholder="例如：看看改了什么，帮我提交"
          @keydown.enter.exact.prevent="send"
        />
        <el-button type="primary" :disabled="!canSend" :loading="streaming" @click="send">发送</el-button>
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
