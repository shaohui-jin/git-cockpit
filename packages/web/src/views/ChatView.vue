<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { useReposStore } from '@/stores/repos';
import { useSettingsStore } from '@/stores/settings';
import * as api from '@/api/client';
import MessageList from '@/components/chat/MessageList.vue';
import ConfirmBar from '@/components/chat/ConfirmBar.vue';
import type { ChatLine, PendingConfirm } from '@/components/chat/types';

const repos = useReposStore();
const settings = useSettingsStore();
const router = useRouter();

const input = ref('');
const streaming = ref(false);
const confirming = ref(false);
const lines = ref<ChatLine[]>([]);
const pending = ref<PendingConfirm[]>([]);
let seq = 0;
const listEl = ref<HTMLElement | null>(null);

const repoPath = computed(() => repos.currentPath);
const canSend = computed(() => Boolean(repoPath.value && settings.llm?.tokenSet && input.value.trim() && !streaming.value));

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

watch(repoPath, () => {
  lines.value = [];
  pending.value = [];
});

async function send(): Promise<void> {
  const text = input.value.trim();
  const path = repoPath.value;
  if (!text || !path || streaming.value) return;
  if (!settings.llm?.tokenSet) {
    ElMessage.warning('请先在设置「模型」填写 API Key');
    return;
  }
  input.value = '';
  push('user', text);
  const assistant = push('assistant', '');
  streaming.value = true;
  await scrollBottom();
  const history = lines.value
    .filter((l) => l.role === 'user' || (l.role === 'assistant' && l.text.trim()))
    .map((l) => ({ role: l.role as 'user' | 'assistant', content: l.text }));
  try {
    await api.streamChat(
      { messages: history, repoPath: path, sessionId: sessionIdFor(path) },
      {
        onDelta: (t) => {
          assistant.text += t;
          void scrollBottom();
        },
        onConfirm: (p) => {
          pending.value.push({
            token: p.token,
            tool: p.tool,
            command: p.preview.command,
            affectedFiles: p.preview.affectedFiles ?? [],
            note: p.preview.note
          });
        },
        onTool: (p) => {
          push('tool', '', { tool: p.tool, success: p.success });
          void scrollBottom();
        },
        onError: (msg) => {
          if (!assistant.text) assistant.text = msg;
          else assistant.text += `\n${msg}`;
        }
      }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!assistant.text) assistant.text = msg;
    ElMessage.error(msg);
  } finally {
    streaming.value = false;
    await scrollBottom();
  }
}

async function confirmOne(item: PendingConfirm): Promise<void> {
  confirming.value = true;
  try {
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
</script>

<template>
  <div class="page chat-page">
    <h2 class="page-title">聊天</h2>
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
      v-else-if="!settings.llm?.tokenSet"
      title="尚未配置模型 API Key"
      type="warning"
      :closable="false"
      show-icon
      class="mb"
    >
      <el-button link type="primary" @click="router.push({ path: '/settings', query: { tab: 'llm' } })">去设置</el-button>
    </el-alert>
    <el-alert
      v-else-if="!repoPath"
      title="请先在工作台打开并选择仓库"
      type="info"
      :closable="false"
      show-icon
      class="mb"
    >
      <el-button link type="primary" @click="router.push('/dashboard')">去工作台</el-button>
    </el-alert>

    <div ref="listEl" class="chat-list">
      <MessageList :lines="lines" :streaming="streaming" />
    </div>

    <ConfirmBar :items="pending" :confirming="confirming" @confirm="confirmOne" @cancel="cancelOne" />

    <div class="composer">
      <el-input
        v-model="input"
        type="textarea"
        :rows="3"
        :disabled="streaming || !repoPath || !settings.llm?.tokenSet"
        placeholder="例如：看看改了什么，帮我提交"
        @keydown.enter.exact.prevent="send"
      />
      <el-button type="primary" :disabled="!canSend" :loading="streaming" @click="send">发送</el-button>
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
  border: 1px solid var(--el-border-color-lighter);
  border-radius: var(--gc-radius);
  background: var(--el-fill-color-lighter);
}
.composer {
  flex: none;
  display: flex;
  gap: var(--gc-gap);
  align-items: flex-end;
  margin-top: var(--gc-gap);
}
.composer .el-textarea {
  flex: 1;
}
</style>
