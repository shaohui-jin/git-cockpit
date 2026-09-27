import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { AuditLogger, ChatLogStore, DEFAULT_CONFIG, openDatabase } from '../src/index.ts';
import { cleanupTmp, makeTmpDir } from './helpers.ts';

describe('ChatLogStore', () => {
  let db: DatabaseSync;
  let store: ChatLogStore;

  beforeEach(() => {
    cleanupTmp();
    db = openDatabase(makeTmpDir('chat-log-'));
    store = new ChatLogStore(db);
  });

  afterAll(() => cleanupTmp());

  it('追加消息、生成标题，并按更新时间列出', () => {
    const first = store.append('c1', '/repo/a', [
      { role: 'user', text: '看看改了什么' },
      { role: 'assistant', text: '本地预览样本' },
      { role: 'tool', text: '', tool: 'git_status', success: true }
    ]);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.conversation.title).toBe('看看改了什么');
    expect(first.conversation.messageCount).toBe(3);

    store.append('c2', '/repo/a', [{ role: 'user', text: '再开一组' }]);
    const rows = store.list({ repoPath: '/repo/a' });
    expect(rows.map((r) => r.id)).toEqual(['c2', 'c1']);

    const full = store.get('c1');
    expect(full?.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'tool']);
    expect(full?.messages[2]?.tool).toBe('git_status');
    expect(full?.messages[2]?.success).toBe(true);
  });

  it('标题超过 40 个字时截断', () => {
    const text = '一二三四五'.repeat(10);
    const saved = store.append('c-long', '/repo/a', [{ role: 'user', text }]);
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    expect([...saved.conversation.title].length).toBe(41);
    expect(saved.conversation.title.endsWith('…')).toBe(true);
  });

  it('同一组对话不能改挂到另一个仓库', () => {
    store.append('c1', '/repo/a', [{ role: 'user', text: '第一仓' }]);
    const switched = store.append('c1', '/repo/b', [{ role: 'user', text: '第二仓' }]);
    expect(switched.ok).toBe(false);
    expect(store.get('c1')?.messages).toHaveLength(1);
  });

  it('删除一组对话，操作日志仍在', () => {
    store.append('c1', '/repo/a', [{ role: 'user', text: '先记下来' }]);
    const audit = new AuditLogger(db, { redact: DEFAULT_CONFIG.logging.redact });
    audit.log({
      timestamp: '2026-09-27T00:00:00.000Z',
      source: 'chat',
      tool: 'git_commit',
      repoPath: '/repo/a',
      params: { message: 'keep' },
      result: 'success',
      durationMs: 3,
      dryRun: false
    });
    expect(store.remove('c1')).toBe(true);
    expect(store.get('c1')).toBeNull();
    expect(store.remove('c1')).toBe(false);
    expect(audit.list()).toHaveLength(1);
  });
});
