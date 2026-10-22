<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import * as api from '@/api/client';
import type { ChatConversationSummary, ChatLogMessage } from '@/api/types';
import MessageList from '@/components/chat/MessageList.vue';
import type { ChatLine } from '@/components/chat/types';
import { repoLeaf, sameRepoPath, useChatStore } from '@/stores/chat';
import { useReposStore } from '@/stores/repos';
import { relTime } from '@/utils/time';

const chat = useChatStore();
const repos = useReposStore();
const rows = ref<ChatConversationSummary[]>([]);
const loading = ref(false);
const repoFilter = ref('');
const searchText = ref('');
const detailId = ref('');
const detailTitle = ref('');
const detailRepo = ref('');
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
  const kw = searchText.value.trim().toLowerCase();
  return rows.value.filter((row) => {
    if (repoFilter.value && !sameRepoPath(row.repoPath, repoFilter.value)) return false;
    if (!kw) return true;
    return titleOf(row).toLowerCase().includes(kw) || repoLeaf(row.repoPath).toLowerCase().includes(kw);
  });
});

const detailOpen = computed(() => Boolean(detailId.value));

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
    detailRepo.value = res.conversation.repoPath;
    detailLines.value = toLines(res.messages);
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : String(err));
  }
}

async function continueActive(): Promise<void> {
  if (!detailId.value) return;
  const err = await chat.openConversation(detailId.value);
  if (err) ElMessage.error(err);
}

async function copyAll(): Promise<void> {
  if (!detailLines.value.length) return;
  const text = detailLines.value.map((l) => `${l.role === 'user' ? '我' : 'Agent'}：${l.text}`).join('\n');
  try {
    await navigator.clipboard.writeText(text);
    ElMessage.success('已复制全部消息');
  } catch {
    ElMessage.warning('浏览器拒绝了剪贴板访问');
  }
}

async function removeActive(): Promise<void> {
  if (!detailId.value) return;
  const row = rows.value.find((item) => item.id === detailId.value);
  if (!row) return;
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
  detailId.value = '';
  detailLines.value = [];
}

onMounted(() => {
  void load();
});
</script>

<template>
  <div class="page conv-page">
    <div class="page-head">
      <h1>对话记录</h1>
      <span class="sub">与 Agent 的每一次协作都留有上下文</span>
      <span class="spacer" />
      <el-button :loading="loading" @click="load">刷新</el-button>
    </div>

    <div class="conv-wrap">
      <!-- 左：会话列表 -->
      <aside class="conv-list" v-loading="loading">
        <div class="conv-list-top">
          <div class="conv-search">
            <GcIcon name="search" :size="12" />
            <input v-model="searchText" type="text" placeholder="搜索会话 / 仓库" />
          </div>
          <el-select v-model="repoFilter" clearable placeholder="全部仓库" class="conv-repo">
            <el-option v-for="opt in repoOptions" :key="opt.path" :label="opt.label" :value="opt.path" />
          </el-select>
        </div>
        <div class="conv-items">
          <p v-if="!loading && visible.length === 0" class="conv-miss">没有匹配的对话</p>
          <button
            v-for="row in visible"
            :key="row.id"
            type="button"
            class="conv-item"
            :class="{ 'is-active': row.id === detailId }"
            @click="openDetail(row)"
          >
            <span class="ct">
              <b>{{ titleOf(row) }}</b>
              <span class="when">{{ relTime(row.updatedAt) }}</span>
            </span>
            <span class="cmeta">
              <span class="mono">{{ repoLeaf(row.repoPath) }}</span>
              <span class="sp" />
              <span>{{ row.messageCount }} 条</span>
            </span>
          </button>
        </div>
      </aside>

      <!-- 右：详情 -->
      <section v-if="detailOpen" class="conv-detail">
        <header class="detail-head">
          <GcIcon name="bubble" :size="14" class="head-ico" />
          <b class="dt">{{ detailTitle }}</b>
          <span class="repo mono" :title="detailRepo">{{ repoLeaf(detailRepo) }}</span>
          <span class="spacer" />
          <span class="chip plain">{{ detailLines.length }} 条消息</span>
          <el-button size="small" type="primary" @click="continueActive">继续对话</el-button>
          <el-button size="small" @click="copyAll">复制全部</el-button>
          <el-button size="small" type="danger" plain @click="removeActive">删除</el-button>
        </header>
        <div class="msgs">
          <MessageList :lines="detailLines" :streaming="false" />
        </div>
        <footer class="detail-foot">
          <GcIcon name="lock" :size="12" class="foot-ico" />
          <span class="note">对话只读留档 · 写操作需回到状态页或聊天面板确认</span>
        </footer>
      </section>
      <section v-else class="conv-detail is-empty">
        <div class="empty-inner">
          <GcIcon name="bubble" :size="20" />
          <strong>选一组对话查看上下文</strong>
          <p>在聊天面板里发送后会出现在这里，本地预览也会记下来。</p>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.conv-page {
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: var(--gc-gap);
  overflow: hidden;
}
.page-head {
  flex: none;
  display: flex;
  align-items: center;
  gap: var(--gc-gap);
  min-width: 0;
}
.page-head h1 {
  margin: 0;
  font-size: var(--gc-fs-page);
  font-weight: 600;
  line-height: var(--gc-lh-page);
  color: var(--gc-text);
  letter-spacing: -0.01em;
}
.page-head .sub {
  font-size: var(--gc-fs-body);
  color: var(--gc-text-3);
}
.page-head .spacer {
  flex: 1;
}

/* ---------- 双栏骨架（对齐设计稿 conv-wrap） ---------- */
.conv-wrap {
  flex: 1;
  min-height: 0;
  display: flex;
  gap: var(--gc-gap);
}

/* 左：会话列表 288px */
.conv-list {
  flex: none;
  width: 288px;
  display: flex;
  flex-direction: column;
  background: var(--gc-card);
  border: 1px solid var(--gc-line);
  border-radius: var(--gc-radius);
  overflow: hidden;
}
.conv-list-top {
  flex: none;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: var(--gc-gap);
  border-bottom: 1px solid var(--gc-line);
}
.conv-search {
  display: flex;
  align-items: center;
  gap: 6px;
  height: var(--gc-btn-inline);
  padding: 0 8px;
  border-radius: var(--gc-r);
  border: 1px solid var(--gc-line);
  background: var(--gc-page);
  color: var(--gc-text-3);
}
.conv-search:focus-within {
  border-color: var(--gc-accent);
}
.conv-search input {
  flex: 1;
  min-width: 0;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--gc-text);
  font: inherit;
  font-size: var(--gc-fs-body);
}
.conv-search input::placeholder {
  color: var(--gc-text-placeholder);
}
.conv-items {
  flex: 1;
  min-height: 0;
  overflow: auto;
}
.conv-miss {
  margin: 0;
  padding: var(--gc-pad);
  font-size: var(--gc-fs-body);
  color: var(--gc-text-3);
  text-align: center;
}
.conv-item {
  display: flex;
  flex-direction: column;
  gap: 3px;
  width: 100%;
  padding: 8px 10px 8px 11px;
  border: 0;
  border-bottom: 1px solid var(--gc-line-weak);
  border-left: 2px solid transparent;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
  font: inherit;
  transition: background var(--gc-t-micro) var(--gc-ease);
}
.conv-item:hover {
  background: rgba(255, 255, 255, 0.05);
}
.conv-item.is-active {
  background: var(--gc-accent-weak);
  border-left-color: var(--gc-accent);
}
.conv-item .ct {
  display: flex;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
}
.conv-item .ct b {
  flex: 1;
  min-width: 0;
  font-size: var(--gc-fs-body);
  font-weight: 500;
  color: var(--gc-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.conv-item.is-active .ct b {
  color: var(--gc-accent-text);
}
.conv-item .when {
  flex: none;
  font-size: var(--gc-fs-micro);
  color: var(--gc-text-3);
  font-variant-numeric: tabular-nums;
}
.conv-item .cmeta {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--gc-fs-meta);
  color: var(--gc-text-3);
  min-width: 0;
}
.conv-item .cmeta .mono {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.conv-item .sp {
  flex: none;
  width: 3px;
  height: 3px;
  border-radius: 50%;
  background: var(--gc-text-placeholder);
}

/* 右：详情 */
.conv-detail {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  background: var(--gc-card);
  border: 1px solid var(--gc-line);
  border-radius: var(--gc-radius);
  overflow: hidden;
}
.detail-head {
  flex: none;
  display: flex;
  align-items: center;
  gap: var(--gc-gap);
  min-height: 40px;
  padding: var(--gc-gap) var(--gc-pad);
  border-bottom: 1px solid var(--gc-line);
  background: var(--gc-page);
}
.detail-head .head-ico {
  flex: none;
  color: var(--gc-accent-text);
}
.detail-head .dt {
  flex: none;
  max-width: 40%;
  font-size: var(--gc-fs-body);
  font-weight: 600;
  color: var(--gc-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.detail-head .repo {
  flex: 1;
  min-width: 0;
  font-size: var(--gc-fs-meta);
  color: var(--gc-text-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.detail-head .spacer {
  flex: 1;
}
.detail-head .chip {
  flex: none;
  height: 20px;
  padding: 0 8px;
  border-radius: var(--gc-r-tag);
  background: var(--el-fill-color);
  color: var(--gc-text-3);
  font-size: var(--gc-fs-meta);
  display: inline-flex;
  align-items: center;
}
.msgs {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: var(--gc-pad);
}
.detail-foot {
  flex: none;
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: var(--gc-row-lg);
  padding: 0 var(--gc-pad);
  border-top: 1px solid var(--gc-line);
  font-size: var(--gc-fs-meta);
  color: var(--gc-text-3);
}
.detail-foot .foot-ico {
  flex: none;
}
.conv-detail.is-empty {
  align-items: center;
  justify-content: center;
}
.empty-inner {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--gc-gap);
  color: var(--gc-text-3);
  text-align: center;
  padding: var(--gc-pad);
}
.empty-inner strong {
  font-size: var(--el-font-size-extra-large);
  color: var(--gc-text);
  font-weight: 600;
}
.empty-inner p {
  margin: 0;
  font-size: var(--gc-fs-body);
}
</style>
