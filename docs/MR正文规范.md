# MR 正文规范

> **状态**：部分落地（设置导入 / 存盘已做；开单校验与填表未做）  
> **范围**：只覆盖发起 Pull Request / Merge Request。Commit message 规范另议，不要和本文混做。  
> **对照**：[设计文档](./设计文档.md) 只写已发布行为；本文是本需求的完整设计，后续实现以本文为准。

团队开 MR 往往有固定正文（分节、风险等级、勾选检查）。Web 和 MCP 必须走同一份配置：网页配一次，Agent 开单也按同一套字段填、同一套规则校验。Cockpit **不内置模型**，不在服务端代写正文。

参考样例：团队常用的 `Default.md`（变更目的 / 主要改动 / 风险等级 / 验证方式 / 评审提示 / 提交前检查 + 文末 CI 说明表）。黄金样例在 `packages/core/test/fixtures/mr-default.md`。

---

## 1. 目标

1. 设置里导入 Markdown，转成可校对的字段表，写入 `~/.git-cockpit/config.json` 的 `mr.template`。
2. 启用后，网页开 MR 和 MCP `git_mr_create` 都必须按字段填写；服务端渲染成同一份 Markdown 正文。
3. MCP 可选「允许 AI 填」或「须人工填」。这是策略，不是两套后端。
4. 未导入或未启用时，开单行为与现在完全相同（标题缺省 `Merge <source> into <target>`，正文可空）。

---

## 2. 原则

| 原则 | 含义 |
|------|------|
| Markdown 只负责导入 | 运行时认 JSON schema，禁止每次开单现场再解析 MD |
| 有模板才强制 | 空字段 + 默认开启会挡住所有仓。无 `fields` 视为未启用 |
| 服务端渲染 | Agent / 网页只交 `fields`；Cockpit 拼 body，保证两边开出来长得一样 |
| 不能用裸 body 绕过 | 启用后 `fields` 为准；缺字段返回 `TEMPLATE_INCOMPLETE`，不要接受「我自己拼好的 body」 |
| 不保证诚实 | 只校验结构完整（必填有值、选项合法、必勾已勾）。模型把风险填「低」也能过，产品上要写清 |
| Token 仍不进工具参数 | 与现有 MR 配置相同 |
| into / from 语义不变 | `into` = 合入目标 / 线上；`from` = 我的分支 |

**明确不做**

- 服务端调模型自动写正文
- 用 MCP Prompt 软提醒代替校验
- v1 一起做 commit message 规范
- 开单时再去拉 GitLab/GitHub 仓库内模板覆盖 Cockpit schema
- `skipTemplate` 后门（要跳过就在设置里关 `enabled`）
- 网页内置 AI 入口

---

## 3. 落地进度

| 项 | 状态 | 说明 |
|----|------|------|
| 模板类型 / `normalizeMrTemplate` / 解析 MD / `renderMrTemplate` / `validateMrTemplateFields` | **已做** | `packages/core/src/mrTemplate.ts`，Default.md 单测 |
| `config.json` → `mr.template` | **已做** | `normalizeMrConfig` 带上；空 fields 且无 sourceMd → `null` |
| 设置「正文规范」Tab：导入、校对、启用、`agentFill`、预览、保存 | **已做** | `/settings?tab=template`；解析不落盘，保存才写配置 |
| REST `POST /api/settings/mr-template/parse`、`/preview`；`PUT /api/settings` 的 `mr.template` | **已做** | GET settings 的 `mr.template` 原样回（无密钥） |
| `git_mr_prepare` 返回 template | **未做** | 开单前 Agent / 网页要拿到字段表 |
| `git_mr_create` 收 `fields`，启用时校验并渲染 body | **未做** | 纯函数已有，handler 未接 |
| 合并页开 MR 弹出生成表单 + 渲染预览 | **未做** | 现在直接 `git_mr_create`，没有 title/body |
| `open_mr` Prompt 改成「先 prepare 看 template，再带 fields 干跑」 | **未做** | |
| browser 开单：复制渲染正文；规范启用时提示走 Token/CLI | **未做** | |
| 按仓库覆盖模板（类似 `repoMethods`） | **未做** | 现在是全局一份 `mr.template` |
| 从仓内 `.gitlab/merge_request_templates` / `PULL_REQUEST_TEMPLATE.md` 一键导入 | **未做** | P2 |

---

## 4. 数据

存在 `config.json` 的 `mr.template`，与 Token、开单方式同一文件。Web / MCP / `start` 同进程即时生效；stdio `git-cockpit mcp` 要重启才读到新配置。

### 4.1 `MrTemplate`

```ts
type MrTemplateAgentFill = 'allow' | 'forbid';
type MrTemplateFieldType = 'markdown' | 'textarea' | 'select' | 'checkboxes';

interface MrTemplate {
  enabled: boolean;          // 无 fillable 字段时 normalize 会压成 false
  agentFill: MrTemplateAgentFill; // 默认 allow
  filename: string;          // 导入文件名，仅展示
  sourceMd: string;          // 导入原文，便于对照 / 再导入
  fields: MrTemplateField[]; // 有序；上限 48
}

interface MrTemplateField {
  id: string;                // 稳定 id，MCP 用这个填
  type: MrTemplateFieldType;
  label: string;
  help?: string;             // 从 HTML 注释带出，给填写人看，不进渲染正文
  required: boolean;         // markdown 恒 false
  placeholder?: string;      // textarea
  options?: string[];        // select，至少 2 个
  items?: { id: string; label: string; required: boolean }[]; // checkboxes
  content?: string;          // markdown 静态正文
}
```

`fields` 取值约定（给 `git_mr_create` / 预览）：

| type | `values[id]` |
|------|----------------|
| textarea | `string` |
| select | `string`（必须落在 `options` 里） |
| checkboxes | `string[]`（勾中的 item.id）或 `{ [itemId]: true }` |
| markdown | 不填 |

上限：导入 MD ≤ 256KiB（`MAX_MR_TEMPLATE_MD`）。

### 4.2 已知标题 → 稳定 id

解析时这些中文标题写成固定 id，方便 Agent 和测试：

| 标题 | id |
|------|-----|
| 变更目的 | `purpose` |
| 主要改动 | `changes` |
| 开发者自评 | `self_review` |
| 本次提交的验证方式 | `verification` |
| 评审提示 | `review_notes` |
| 提交前检查 | `preflight` |

其它标题：能 slugs 成 ASCII 就用 slug，否则 `section_N`。文末说明段为 `{base}_note`。

### 4.3 Default.md 怎么拆

| 原文 | 类型 | 必填 |
|------|------|------|
| `## 变更目的` + 注释 | textarea | 是 |
| `## 主要改动` + `（请填写）` | textarea | 是 |
| `风险等级：低 / 中 / 高` | select | 是 |
| 验证方式 `- [ ]` | checkboxes | 条目不必勾（至少一项互斥 v1 不做） |
| `## 评审提示` | textarea | 是 |
| 提交前检查 `- [ ]` | checkboxes | 条目建议必勾 |
| `> AI Coding Review…` | markdown | 否 |
| `情况 / Job` 表 | markdown | 否 |

启发式（`parseMrTemplateMarkdown`）：

- `##` 分段；段前无标题的前言 → markdown
- `<!-- -->` → `help`，不进渲染
- `- [ ]` → checkboxes；标题为「本次提交的验证方式」时条目 `required=false`，否则 `true`
- `- 标签：A / B / C` → select
- `- （请填写）` 或只有注释的段落 → textarea
- 引用、表格、`---` 出现在填空项之后 → 单独 markdown，禁止变成表单

导入后必须能在设置页改类型 / 必填 / 删段。识别不了的整段变 markdown。

---

## 5. 已做：设置导入

入口：设置 → **正文规范**（`/settings?tab=template`）。不要把这块再塞回「MR 配置」，那页只留开单方式与凭证。

用户路径：选 `.md` 或粘贴 → `POST /api/settings/mr-template/parse`（不落盘）→ 校对字段 → 保存 `PUT /api/settings` `{ mr: { template } }`。

- 启用开关：没有可填字段（全是 markdown）时禁用
- MCP 填写：`allow` = 允许 AI 按字段填；`forbid` = 须人工（开单校验接上后才真正挡）
- 清除：存空 template，normalize 成 `null`
- 前端拷贝模板用 `JSON.parse(JSON.stringify(toRaw(...)))`，不要 `structuredClone` Vue/Pinia 代理

相关文件：

- `packages/core/src/mrTemplate.ts`、`packages/core/src/types.ts`（`MrTemplate*`）
- `packages/mcp-server/src/webServer.ts`（parse / preview / settings 读写）
- `packages/web/src/views/SettingsView.vue`、`packages/web/src/components/MrTemplateSettings.vue`

---

## 6. 未做：开单怎么串

核心：配置进 `config.json`，不进工具参数。启用后同 dataDir 下没有「自由正文」旁路。

```
git_mr_prepare
  → 现有源/目标/创建页/审核人
  → 加上 template（enabled、agentFill、fields，不要 sourceMd 全文除非 detail）
  → next: git_mr_create（带 into/from/sourceBranch、dryRun=true；启用时提示要 fields）

填写
  Web：合并页弹层，按 fields 生成模块 + 渲染预览
  MCP allow：读 diff / 提交列表，填 fields
  MCP forbid：缺字段直接失败，提示去网页填或等人回填

git_mr_create
  dry_run：校验 + 渲染 body，返回将 POST 的标题/正文，不创建
  正式：validateMrTemplateFields → renderMrTemplate → 现有 token/cli/browser 创建
```

### 6.1 `git_mr_prepare`（只读，已有工具加字段）

返回增加：

```ts
template: {
  enabled: boolean;
  agentFill: 'allow' | 'forbid';
  fields: MrTemplateField[]; // 不要 sourceMd
} | null
```

`next` 仍指向 `git_mr_create`。启用时 args 里不要只给 into/from，应带 `fields` 占位说明。

### 6.2 `git_mr_create`（写，已有工具加参数）

在现有 `title` / `body` / `reviewers` 上增加：

```ts
fields?: Record<string, unknown>
```

启用且 `template.enabled` 时：

1. 没有 `fields` 或校验失败 → 错误码 `TEMPLATE_INCOMPLETE`，`missing: [{ id, label }]`。不要改去收裸 `body`。
2. 有 `fields` → `body = renderMrTemplate(template, fields)`，忽略传入的 `body`。
3. `title` 仍可选手写；缺省保持现在的 `Merge <source> into <target>`。标题格式规范不在本期。

未启用：保持现在，`fields` 可忽略。

`dry_run=true` 必须先走同一套校验/渲染，预览里能看到拼好的正文。

实现落点：`packages/core/src/capabilities/git/mr.ts` 的 create handler；`GitMrCreateSchema` 加 `fields`。`validateMrTemplateFields` / `renderMrTemplate` 已在 core，不要再写一份。

错误码：

| code | 何时 |
|------|------|
| `TEMPLATE_INCOMPLETE` | 启用但缺必填 / 选项非法 / 必勾未勾 |
| `TEMPLATE_REQUIRED` | 启用但完全没传 `fields`（可与上一码合并，实现时二选一，文档与代码一致即可） |

### 6.3 Web 合并页

现在 `MergeView` / 矩阵「申请 MR」直接 `previewAndConfirm('git_mr_create', { into, from, sourceBranch, reviewers })`，没有标题正文。

应改为：

1. 先 `git_mr_prepare`（或 REST 已有的 prepare）
2. 若 `template?.enabled`：弹层按 `fields` 画表单（textarea / radio 或 select / checkbox / 静态 markdown），右侧或下方预览 `render`（可调 `/mr-template/preview`）
3. 确认后 `git_mr_create` 带 `fields` + `reviewers` + `title`
4. 未启用：至少补一个可选标题/正文框，不要永远空 body

单对与矩阵共用同一弹层。

### 6.4 MCP `agentFill`

Cockpit 不跑模型。

- `allow`（默认）：Prompt / prepare 说明「读变更后填 fields」。校验与 Web 相同。
- `forbid`：未交齐必填就失败；文案指向设置页或等人把字段给 Agent。不要在服务端等网页草稿（v1 不做 `mr_drafts` 表）。

更新 Prompt `open_mr`（`packages/mcp-server/src/tools/prompts.ts`，正文与 README「Agent 该怎么用」同步）：先 `git_mr_prepare` 看 `template`，再带 `fields` 干跑，确认后去掉 `dryRun`。Token 仍不进参数。

### 6.5 `method=browser`

现在只返回 compare URL，平台不一定吃 body 查询参数。规范启用后：

- Token / CLI 才算真正开出单（正文已写入远程）
- browser：返回 URL + 渲染正文，提示复制；结果里写明「未调用 Token / CLI」

不要静默丢掉填好的字段。

---

## 7. 风险（实现时按此收）

| 风险 | 收法 |
|------|------|
| Default.md 后半段 CI 表被拆成表单 | 表格/引用默认 markdown；导入后必须能人工改类型 |
| 模型全勾、风险永远「低」 | 只保证结构；不在产品里假装审查过内容 |
| 与仓内 GitLab `merge_request_templates` 重复 | v1 以 Cockpit schema 为准；需要时把那份文件当导入源 |
| 空规范默认开 | 无 fillable fields 不能 `enabled` |
| MD 方言（HTML、折叠、图） | 认不了的整段 markdown |
| stdio MCP 读到旧配置 | 同现有：改完设置后重启 MCP；`/mcp` 同进程立即生效 |
| 热修要跳过 | 关 `enabled`，不做工具参数后门 |

---

## 8. 建议下一刀（按序）

1. **P0 开单闸门**：`git_mr_prepare` 带回 template；`git_mr_create` 收 `fields`，启用则校验+渲染。补单测（启用缺字段失败；未启用不挡）。
2. **P0 合并页弹层**：按 fields 生成表单 + 预览，单对/矩阵共用。
3. **P1 Prompt**：`open_mr` / README 与 `next[]` 带上 fields。
4. **P1 browser**：复制正文；启用规范时提示 Token/CLI。
5. **P2** 按仓覆盖；从仓内模板文件一键导入。Commit 规范另开文档，不要续写本文当同一需求。

---

## 9. 和现有架构的对齐

- Web 按钮与 MCP 都走 `executeTool` → `executeCapability`。规范校验放在 create handler 里，不要在 Vue 里单独做一份「能不能开单」。
- 设置与 Token 一样在网页配，工具参数里没有密钥、没有「另一套模板」。
- 主设计文档 §13 只保留一行指向本文；实现完成后把已做部分写进设计文档正文，并删掉 §13 那一行。
