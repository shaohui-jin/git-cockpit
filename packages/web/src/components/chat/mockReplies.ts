import { encodeChatEvent, type ChatEvent } from './events';

/**
 * 未配置模型 Key 时的本地回复。每条是一轮完整事件序列，界面按同一规范播放。
 * 确认令牌以 mock: 开头，只在页面内确认或取消，不请求后端，也不执行 git。
 */
export const MOCK_REPLIES: ChatEvent[][] = [
  [
    {
      type: 'delta',
      text: [
        '## 工作区',
        '',
        '未提交的改动可以分两步处理：',
        '',
        '- [x] 看过 README 的说明',
        '- [ ] 暂存并提交',
        '',
        '| 文件 | 状态 | 说明 |',
        '| --- | --- | --- |',
        '| README.md | 已修改 | 补了聊天壳说明 |',
        '| StatusView.vue | 已修改 | 空列表文案 |',
        '',
        '```diff',
        '--- a/README.md',
        '+++ b/README.md',
        '@@ -1,3 +1,4 @@',
        ' # Git Cockpit',
        '+聊天页和 MCP 是两条路。',
        '-打开独立聊天站。',
        '```',
        '',
        '```bash',
        '# 只暂存说明',
        'git add -- README.md',
        '```',
        '',
        '```json',
        '{ "tool": "git_add", "paths": ["README.md"] }',
        '```'
      ].join('\n')
    },
    { type: 'done' }
  ],
  [
    {
      type: 'delta',
      text: [
        '合并预演不改工作区。干净才落盘，有冲突就打开网页选边。',
        '',
        '```mermaid',
        'flowchart LR',
        '  A[预演] --> B[干净]',
        '  A --> C[冲突]',
        '  B --> D[落盘]',
        '  C --> E[网页选边]',
        '```',
        '',
        '两条分支的走向：',
        '',
        '```mermaid',
        'gitGraph',
        '  commit',
        '  branch feature',
        '  checkout feature',
        '  commit',
        '  checkout main',
        '  commit',
        '  merge feature',
        '```'
      ].join('\n')
    },
    { type: 'done' }
  ],
  [
    {
      type: 'delta',
      text: '我先看了当前仓库的工作区，没有改索引，也没有提交。你现在在 main 上，相对上游没有超前，也没有落后。未暂存的改动有两处：README.md 补了一段聊天壳的使用说明，packages/web 里的状态页调整了空列表的文案。未跟踪文件没有。接下来你可以让我只看 README 的 diff，或者把这两份一起暂存。真的 git add 之前，我会先给出命令和影响文件，等你在确认条里点确认。'
    },
    { type: 'tool', tool: 'git_status', success: true },
    { type: 'done' }
  ],
  [
    {
      type: 'delta',
      text: 'README.md 的差异不大，只有说明，没有动命令或配置。新增的段落写了三件事：聊天页和 Cursor 的 MCP 是两条路，配了 MCP 不会自动打开聊天；模型 Key 写在设置里，不进工具参数；写操作会先干跑，确认条里能看到真实的 git 命令。删除的旧句子是「打开独立聊天站」。如果你只想提交这份文档，跟我说一声，我先预览 git add README.md。'
    },
    { type: 'tool', tool: 'git_diff', success: true },
    { type: 'done' }
  ],
  [
    {
      type: 'delta',
      text: '可以只暂存 README.md，其它未提交的文件先留在工作区。这一步还没有执行。确认条里是即将运行的命令和影响文件。点确认也只是本地预览，不会真的写入仓库；点取消就当这轮没提过暂存。'
    },
    {
      type: 'confirm',
      token: 'mock:git_add',
      tool: 'git_add',
      preview: {
        command: 'git add -- README.md',
        affectedFiles: ['README.md'],
        note: '本地预览，不会写入仓库'
      }
    },
    { type: 'done' }
  ],
  [
    {
      type: 'delta',
      text: '最近五条提交都在文档和界面上，没有改核心的 Git 执行链路。最新一条是 docs: 补聊天壳说明，作者是你，时间是今天下午。往前依次是：工作台当前仓库收成两行、状态页合并 Stash 入口、去掉确认框上重复的 dry-run 文案、以及聊天白名单的单测。这些提交都已经在 main 上。若要看其中某一条改了哪些文件，告诉我提交说明或哈希前几位。'
    },
    { type: 'tool', tool: 'git_log', success: true },
    { type: 'done' }
  ],
  [
    {
      type: 'delta',
      text: '提交说明我拟成「docs: 说明当前仓库状态」。范围只含已经暂存的 README.md，不会把工作区里其它改动带进去。确认条里是完整命令。这是本地预览，点确认不会真的创建提交。'
    },
    {
      type: 'confirm',
      token: 'mock:git_commit',
      tool: 'git_commit',
      preview: {
        command: 'git commit -m "docs: 说明当前仓库状态"',
        affectedFiles: ['README.md'],
        note: '本地预览，不会写入仓库'
      }
    },
    { type: 'done' }
  ]
];

let mockCursor = 0;

const MOCK_FRAME_MS = 48;

function nextMockReply(): ChatEvent[] {
  const reply = MOCK_REPLIES[mockCursor % MOCK_REPLIES.length] ?? [];
  mockCursor += 1;
  return reply;
}

/** 长文按字拆成 SSE 字节帧。间隔在流出时，不在界面上。 */
function mockFrames(events: ChatEvent[]): Uint8Array[] {
  const frames: Uint8Array[] = [];
  for (const event of events) {
    if (event.type === 'delta') {
      for (const ch of event.text) frames.push(encodeChatEvent({ type: 'delta', text: ch }));
      continue;
    }
    frames.push(encodeChatEvent(event));
  }
  return frames;
}

export function mockChatBody(): ReadableStream<Uint8Array> {
  const frames = mockFrames(nextMockReply());
  let i = 0;
  return new ReadableStream({
    async pull(controller) {
      if (i >= frames.length) {
        controller.close();
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, MOCK_FRAME_MS));
      controller.enqueue(frames[i++]!);
    }
  });
}

export function isMockConfirmToken(token: string): boolean {
  return token.startsWith('mock:');
}
