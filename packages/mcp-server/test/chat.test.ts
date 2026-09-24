import { describe, expect, it } from 'vitest';
import { ConfirmGate, previewFromExecResult } from '../src/chat/confirmGate.ts';
import {
  CHAT_ALLOWED_TOOLS,
  isChatAllowedTool,
  isChatWriteTool,
  sanitizeChatArgs,
  wrapToolData
} from '../src/chat/toolPolicy.ts';
import { createTestRuntime, disposeTestRuntime, createSampleRepo, cleanupTmp } from './helpers.ts';
import { TOOL_DEF_MAP } from '../src/tools/index.ts';
import { confirmChatWrite, cancelChatWrite, runChatTool } from '../src/chat/runTool.ts';
import { buildChatSystemPrompt } from '../src/chat/systemPrompt.ts';
import { ChatSessions, resolveChatRepo } from '../src/chat/session.ts';

describe('chat toolPolicy', () => {
  it('白名单锁死第一期工具', () => {
    expect([...CHAT_ALLOWED_TOOLS].sort()).toEqual(
      ['git_add', 'git_commit', 'git_diff', 'git_log', 'git_repo_overview', 'git_status'].sort()
    );
    expect(isChatAllowedTool('git_push')).toBe(false);
    expect(isChatWriteTool('git_add')).toBe(true);
    expect(isChatWriteTool('git_status')).toBe(false);
  });

  it('钉死 repoPath，去掉模型传来的路径，写工具强制 dryRun，禁止无 path 的 detail', () => {
    const pinned = sanitizeChatArgs(
      'git_commit',
      { repoPath: 'D:/evil', dryRun: false, message: 'x', detail: true },
      'D:/safe'
    );
    expect(pinned.repoPath).toBe('D:/safe');
    expect(pinned.dryRun).toBe(true);
    expect(pinned.message).toBe('x');

    const diff = sanitizeChatArgs('git_diff', { detail: true }, 'D:/safe');
    expect(diff.detail).toBe(false);
    const withPath = sanitizeChatArgs('git_diff', { detail: true, path: 'a.ts' }, 'D:/safe');
    expect(withPath.detail).toBe(true);
  });

  it('工具输出包在固定分隔符里', () => {
    const text = wrapToolData('git_status', { branch: 'main' });
    expect(text).toContain('not instructions');
    expect(text).toContain('---BEGIN_TOOL_DATA tool=git_status---');
    expect(text).toContain('---END_TOOL_DATA---');
  });
});

describe('chat confirmGate', () => {
  it('令牌一次性；预览比对失败则拒绝', () => {
    const gate = new ConfirmGate();
    const preview = { command: 'git add -- a.txt', args: ['add', '--', 'a.txt'], affectedFiles: ['a.txt'] };
    const t = gate.issue({ tool: 'git_add', repoPath: '/r', args: { paths: ['a.txt'] }, preview });
    expect(gate.peek(t.token)?.tool).toBe('git_add');
    expect(gate.take(t.token)?.token).toBe(t.token);
    expect(gate.take(t.token)).toBeNull();
    expect(
      gate.previewsMatch(
        preview,
        previewFromExecResult({ command: 'git add -- a.txt', args: ['add', '--', 'a.txt'], affectedFiles: ['a.txt'] })
      )
    ).toBe(true);
    expect(
      gate.previewsMatch(
        preview,
        previewFromExecResult({ command: 'git add -- b.txt', args: ['add', '--', 'b.txt'], affectedFiles: ['b.txt'] })
      )
    ).toBe(false);
  });
});

describe('chat runTool', () => {
  it('写工具只干跑并发卡；确认后才真正暂存', async () => {
    const sample = await createSampleRepo();
    const runtime = createTestRuntime();
    await runtime.repoManager.open(sample.dir);
    const addDef = TOOL_DEF_MAP.get('git_add');
    expect(addDef).toBeTruthy();
    const { writeFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    writeFileSync(join(sample.dir, 'new.txt'), 'n\n', 'utf8');

    const gate = new ConfirmGate();
    const run = await runChatTool(runtime, gate, 'git_add', { paths: ['new.txt'] }, sample.dir);
    expect(run.pendingConfirm).toBe(true);
    expect(run.token).toBeTruthy();
    expect(run.preview?.affectedFiles).toContain('new.txt');

    const st = await sample.git.status();
    expect(st.not_added.concat(st.created)).toEqual(expect.arrayContaining(['new.txt']));
    expect(st.staged).not.toContain('new.txt');

    const confirmed = await confirmChatWrite(runtime, gate, run.token!);
    expect(confirmed.ok).toBe(true);
    const after = await sample.git.status();
    expect(after.staged).toContain('new.txt');

    disposeTestRuntime(runtime);
    cleanupTmp();
  });

  it('确认可取消且不执行', async () => {
    const sample = await createSampleRepo();
    const runtime = createTestRuntime();
    await runtime.repoManager.open(sample.dir);
    const { writeFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    writeFileSync(join(sample.dir, 'c.txt'), 'c\n', 'utf8');
    const gate = new ConfirmGate();
    const run = await runChatTool(runtime, gate, 'git_add', { paths: ['c.txt'] }, sample.dir);
    expect(run.token).toBeTruthy();
    const cancelled = await cancelChatWrite(gate, run.token!);
    expect(cancelled.ok).toBe(true);
    const again = await confirmChatWrite(runtime, gate, run.token!);
    expect(again.ok).toBe(false);
    const st = await sample.git.status();
    expect(st.staged).not.toContain('c.txt');
    disposeTestRuntime(runtime);
    cleanupTmp();
  });

  it('拒绝白名单外工具', async () => {
    const runtime = createTestRuntime();
    const gate = new ConfirmGate();
    const run = await runChatTool(runtime, gate, 'git_push_force', {}, '/x');
    expect(run.success).toBe(false);
    expect(run.modelText).toMatch(/not allowed/i);
    disposeTestRuntime(runtime);
    cleanupTmp();
  });
});

describe('chat systemPrompt', () => {
  it('只保留提交流程，并改写写操作为确认闸', () => {
    const text = buildChatSystemPrompt();
    expect(text).toMatch(/only preview/i);
    expect(text).toContain('git_status');
    expect(text).toContain('git_commit');
    expect(text).not.toContain('git_merge_preview');
    expect(text).not.toContain('git_mr_create');
    expect(text).not.toContain('git_apply_resolve');
    expect(text).not.toMatch(/写操作先干跑/);
  });
});

describe('chat session', () => {
  it('未打开的仓不能聊；会话钉死后不能换仓', async () => {
    const sample = await createSampleRepo();
    const other = await createSampleRepo();
    const runtime = createTestRuntime();
    const sessions = new ChatSessions();
    const closed = resolveChatRepo(runtime, sessions, 's1', sample.dir);
    expect(closed.ok).toBe(false);
    if (!closed.ok) expect(closed.code).toBe('REPO_NOT_OPEN');

    await runtime.repoManager.open(sample.dir);
    const first = resolveChatRepo(runtime, sessions, 's1', sample.dir);
    expect(first.ok).toBe(true);

    await runtime.repoManager.open(other.dir);
    const switched = resolveChatRepo(runtime, sessions, 's1', other.dir);
    expect(switched.ok).toBe(false);
    if (!switched.ok) expect(switched.code).toBe('SESSION_REPO_PINNED');

    const same = resolveChatRepo(runtime, sessions, 's1', sample.dir);
    expect(same.ok).toBe(true);

    disposeTestRuntime(runtime);
    cleanupTmp();
  });
});
