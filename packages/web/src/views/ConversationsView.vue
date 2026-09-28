<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import * as api from '@/api/client';
import type { ChatConversationSummary, ChatLogMessage } from '@/api/types';
import MessageList from '@/components/chat/MessageList.vue';
import type { ChatLine } from '@/components/chat/types';
import { repoLeaf, sameRepoPath, useChatStore } from '@/stores/chat';
import { useReposStore } from '@/stores/repos';

const chat = useChatStore();
const repos = useReposStore();
const rows = ref<ChatConversationSummary[]>([]);
const loading = ref(false);
const repoFilter = ref('');
const detailOpen = ref(false);
const detailId = ref('');
const detailTitle = ref('');
const detailLines = ref<ChatLine[]>([]);

const repoOptions = computed(() => {
  const paths: string[] = [];
  const push = (path: string) => {
    if (!path || paths.some((p) => sameRepoPath(p, path))) return;
    paths.push(path);
  };
  for (const repo of repos.repos) push(repo.path);
  for (const row of rows.value) push(row.repoPath);
  return paths.map((path) => ({ path, label: repoLeaf(path) }));
});

const visible = computed(() => {
  if (!repoFilter.value) return rows.value;
  return rows.value.filter((row) => sameRepoPath(row.repoPath, repoFilter.value));
});

function formatTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

function titleOf(row: ChatConversationSummary): string {
  return row.title.trim() || '新对话';
}

async function load(): Promise<void> {
  loading.value = true;
  try {
    const res = await api.listChatConversations({ limit: 200 });
    rows.value = res.conversations;
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : String(err));
  } finally {
    loading.value = false;
  }
}

function toLines(messages: ChatLogMessage[]): ChatLine[] {
  return messages.map((message) => ({
    id: message.id,
    role: message.role,
    text: message.text,
    tool: message.tool ?? undefined,
    success: message.success ?? undefined
  }));
}

async function openDetail(row: ChatConversationSummary): Promise<void> {
  try {
    const res = await api.getChatConversation(row.id);
    detailId.value = res.conversation.id;
    detailTitle.value = titleOf(res.conversation);
    detailLines.value = toLines(res.messages);
    detailOpen.value = true;
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : String(err));
  }
}

async function continueOne(row: ChatConversationSummary): Promise<void> {
  const err = await chat.openConversation(row.id);
  if (err) ElMessage.error(err);
}

async function removeOne(row: ChatConversationSummary): Promise<void> {
  try {
    await ElMessageBox.confirm(`删除「${titleOf(row)}」？正在查看这一组时，聊天面板会换成空白新对话。`, '删除对话', {
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      type: 'warning',
      closeOnClickModal: false
    });
  } catch {
    return;
  }
  const err = await chat.removeConversation(row.id);
  if (err) {
    ElMessage.error(err);
    return;
  }
  rows.value = rows.value.filter((item) => item.id !== row.id);
  if (detailId.value === row.id) detailOpen.value = false;
}

onMounted(() => {
  void load();
});
</script>

<template>
  <div class="page conv-page">
    <h2 class="page-title">对话记录</h2>

    <div class="bar gc-glass">
      <label>
        仓库
        <el-select v-model="repoFilter" clearable placeholder="全部" class="repo-select">
          <el-option v-for="opt in repoOptions" :key="opt.path" :label="opt.label" :value="opt.path" />
        </el-select>
      </label>
      <el-button :loading="loading" @click="load">刷新</el-button>
      <span class="tip">一组对话一行。最近 200 组。Git 写入另记在操作日志。</span>
    </div>

    <div v-if="!loading && visible.length === 0" class="empty gc-glass">
      <strong>还没有对话记录</strong>
      <p>在聊天面板里发送后会出现在这里，本地预览也会记下来。</p>
    </div>
    <div v-else class="table gc-glass" v-loading="loading">
      <div class="th">
        <span>标题</span>
        <span>仓库</span>
        <span>更新时间</span>
        <span>条数</span>
        <span>操作</span>
      </div>
      <div v-for="row in visible" :key="row.id" class="tr">
        <span :title="titleOf(row)">{{ titleOf(row) }}</span>
        <span class="mono" :title="row.repoPath">{{ repoLeaf(row.repoPath) }}</span>
        <span>{{ formatTime(row.updatedAt) }}</span>
        <span>{{ row.messageCount }}</span>
        <span class="ops">
          <el-button link type="primary" @click="openDetail(row)">查看</el-button>
          <el-button link type="primary" @click="continueOne(row)">继续</el-button>
          <el-button link type="danger" @click="removeOne(row)">删除</el-button>
        </span>
      </div>
    </div>

    <el-dialog v-model="detailOpen" :title="detailTitle" width="720px" :close-on-click-modal="false">
      <div class="detail">
        <MessageList :lines="detailLines" :streaming="false" />
      </div>
    </el-dialog>
  </div>
</template>

<style scoped>
.conv-page {
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: var(--gc-pad);
  overflow: hidden;
}
.bar {
  flex: none;
  display: flex;
  align-items: center;
  gap: var(--gc-pad);
  padding: var(--gc-gap) var(--gc-pad);
  flex-wrap: wrap;
}
.bar label {
  display: flex;
  align-items: center;
  gap: var(--gc-gap);
  font-size: var(--gc-text);
}
.repo-select {
  width: 200px;
}
.tip {
  font-size: var(--gc-text);
  color: var(--el-text-color-secondary);
}
.table {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 0;
}
.th,
.tr {
  display: grid;
  grid-template-columns: minmax(160px, 1.4fr) minmax(120px, 1fr) 168px 56px 148px;
  gap: var(--gc-gap);
  padding: 0 var(--gc-pad);
  min-height: var(--gc-line);
  align-items: center;
  font-size: var(--gc-text);
}
.th {
  position: sticky;
  top: 0;
  z-index: 1;
  color: var(--el-text-color-secondary);
  font-weight: 600;
  background: color-mix(in srgb, var(--el-bg-color) 92%, transparent);
}
.tr {
  border-top: 1px solid var(--el-border-color-lighter);
}
.tr > span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ops {
  display: flex;
  align-items: center;
  gap: var(--gc-gap);
}
.detail {
  max-height: 60vh;
  overflow: auto;
}
.empty {
  flex: 1;
  display: grid;
  place-content: center;
  text-align: center;
  padding: var(--gc-pad);
  gap: var(--gc-gap);
  color: var(--el-text-color-secondary);
}
.empty strong {
  font-size: var(--el-font-size-extra-large);
  color: var(--el-text-color-primary);
  font-weight: 600;
}
.empty p {
  margin: 0;
  font-size: var(--gc-text);
}
</style>
