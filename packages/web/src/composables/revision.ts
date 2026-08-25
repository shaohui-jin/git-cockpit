import { ref } from 'vue';

/** 全局修订号：SSE 事件到达时 +1，各视图 watch 后自动刷新 */
const revision = ref(0);
const bump = (): void => {
  revision.value += 1;
};

export function useRevision(): { revision: typeof revision; bump: typeof bump } {
  return { revision, bump };
}