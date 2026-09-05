# Git Insight → Git Cockpit：迁移与未实现功能方案

> **日期**：2026-09-05  
> **对照**：`D:\_myproject\git-insight` 与本仓库 core + mcp-server + web  
> **已拍板**：不做 Cursor 扩展；Git 能力用本仓库 `GitService` / simple-git 重写，不引进 insight-core；Insight「Git 配置」在此改名为 **MR 配置**（方式 A 本机 gh/glab、B Token、C 浏览器页，**不做 Insight 原方式 B 下载 CLI**）；**不配置 LLM、不做网页 AI 选边**；Cockpit **不内置对话或选边模型**，只提供工具给外部 Agent 调用。Insight 后期全部下架。  
> **硬约束（执行栈，必须遵守）**：仓库里的 git 事实一律走 **现有 `GitService` / simple-git**。simple-git 有高层 API 用高层；没有的用现有 `raw` / `runAllowFail`。禁止再按 Insight 自研 `runGit` 另装一套命令封装。只有 git/simple-git **确实做不到** 的事（SSH remote → https 网页/API、GitHub/GitLab REST、gh/glab CLI）才允许手写，且不得与已有方法重复。详见 **§5.0**。  
> **设计文档**只描述已落地行为。本文只保留规划、硬约束与 **尚未迁入** 项。已完成能力的实现口径已写入 [设计文档.md](./设计文档.md)，本文不再重复。

---

## 已完成迁入（打标）

下列能力已落地，**实现方案已从本文移除**，以设计文档为准。

| 能力 | 状态 | 见设计文档 |
|------|------|------------|
| merge-tree 预演、worktree 落盘 | ✅ v2.3 | 4.1 / 6.4 |
| 网页三栏 hunk 选边 | ✅ v2.5 | 4.2 |
| 开 PR/MR（`git_mr_prepare` / `git_mr_create`）、设置「MR 配置」 | ✅ v2.5–2.6 | 4.2 / 6.4 / 9 |
| 合并矩阵与合入顺序、合并页单对/矩阵闭环 | ✅ v2.7 | 4.1 / 4.2 |
| 冲突行 blame（`git_merge_blame`） | ✅ v2.7 | 4.1 |
| `allowedRepos` 打开时校验 | ✅ v2.7 | 6.5 / 9 |
| 状态页 G6 分支 tip 图（`git_branch_graph`） | ✅ v2.8 | 4.1 / 4.2 |
| 工作区 merge / tag / rebase / force-push / 删分支；分支树右键菜单 | ✅ v2.8 | 4.1 / 4.2 |
| 备份 / reflog UI（「记录」卡片） | ✅ v2.8 | 4.2 / 6.6 |
| 后台克隆任务（`POST /api/jobs/clone` + SSE `job-progress`） | ✅ v2.8 | 4.2 / 6.8 |
| 历史/日志 `--gc-line` 单行；浮层 `--gc-shadow-menu` | ✅ v2.8 | 4.2 |
| 克隆任务 `clone_jobs` 落盘、重启中断、SSE 攒 chunk、日志按行 | ✅ v2.9 | 4.2 / 6.8 / 9 |
| Node fetch 合并系统 CA（Token 校验 / 开 PR） | ✅ v2.9 | 4.2 |
| DiffViewer 行号对齐、长文件折叠；历史抽屉标题；更改路径树 | ✅ v2.9 | 4.2 |

---

## 0. Cockpit 和「AI」的关系（避免理解偏差）

Cockpit **没有产品级「AI 入口」**（没有聊天框、没有选边模型、没有 API Key 配置）。

| 角色 | 做什么 |
|------|--------|
| Cockpit | 执行 git / 预演 / 网页手选 / 落盘 / 开 MR；通过 **MCP 工具** 和 **Web REST** 暴露能力 |
| Cursor / Claude 等宿主 | 用户在 **编辑器聊天窗口** 里说话；宿主模型决定何时 `callTool` |
| 网页 | 人点按钮；冲突走 **手动三栏**（已落地，无 AI 按钮） |

因此对比表里不再写「Cockpit 的 AI 入口」。MCP 对日常 `git_status` 和 `git_merge_rehearse` 是同一件事：**工具在这边，脑子在宿主那边**。

五种启动方式下冲突怎么处理见 **§4**。

---

## 1. 两个产品实际在解决什么

| | Git Insight | Git Cockpit（已落地） |
|--|-------------|------------------------------|
| 主问题 | 「合不合得进去」：不碰工作区算合并；worktree 落盘、开 MR | 「日常怎么安全地 git」+ 预演/手选/落盘 + 矩阵闭环 + Token/CLI/浏览器开 PR/MR |
| Git 执行 | 自研 `runGit` spawn | **本仓库 GitService + simple-git**（`raw` / `runAllowFail`），同一套队列与校验 |
| 写隔离 | 预演在对象库；落盘独立 worktree | 日常写打在当前工作区；**落盘已走独立 worktree**，不污染主区 |
| 与模型的关系 | 扩展内调 vscode.lm / Chat 桥 / OpenAI HTTP | **不调任何模型**。宿主 Agent 可选调用 MCP 工具 |
| 开 MR | 设置里叫「Git 配置」：A/B/C/D | **已落地**（设计文档 4.2：A PATH 上 gh/glab、B Token、C 浏览器页；**不做 Insight B 下载 CLI**） |
| 进程 | 扩展 + 可选 stdio MCP | daemon：`start` 时 Web 与 `/mcp` 同进程 |

Insight 里拼 git/glab/gh，是因为 merge-tree / worktree / MR API 不是「再包一层 add/commit」。迁入时 **算法可以对照 Insight，执行必须落在本仓库 GitService 上**（§5.0），禁止把 Insight 的 spawn/URL 组装原样搬过来当第二套 git 层。

---

## 2. Insight 功能迁入判定

| Insight 能力 | 迁入 Cockpit | 做法 |
|--------------|--------------|------|
| 「AI 选边」产品功能 | **不迁** | 不调模型。聊天里由宿主自己读工具结果并选边（§4） |
| Insight 的 LLM / AI 设置项 | **不迁** | 无 `aiApiBaseUrl` / Key / Model |
| 机械 resolver（gitignore 并集等） | **不迁** | 已拍板不做 |
| 冲突预警 | **不迁** | 已拍板不做 |
| 多条合成一条批量分支再推 | **不做本期** | 与「矩阵逐条推送」分开；风险高 |
| 选边 / trail 入库 | **不迁** | 会话在 Pinia；做成的结果认 Git 临时分支 |
| Skill markdown | **不迁** | 改为项目 Cursor rule（什么时候调 MCP），不单独做 Skill |
| Cursor 扩展 / vscode.lm 桥 | **不做** | Insight 下架后无替代壳 |

不能拿 `git_merge`+`dry_run`、工作区 merge、或 `git_push` 冒充预演和落盘。

---

## 3. MR 配置

已迁入设计文档，**不是待办**。实现口径见 [设计文档.md](./设计文档.md) 4.2 / 6.4 / 9。

明确不做（仍有效）：下载 gh/glab 到数据目录（Insight 原方式 B）；LLM / AI 设置；机械 resolver；冲突预警；选边/trail 入库。

---

## 4. 冲突选边：五种用法（Cockpit 不提供 AI 入口）

Cockpit 只提供预演数据、网页手选和落盘接口。所谓「丢给 AI」= **人在宿主聊天窗口里让模型调工具**，不是 Cockpit 去聊。

```text
用户在 Cursor 说：feature 合进 origin/master，冲突帮我选边并落盘
  → 宿主模型调 git_merge_rehearse
  → 工具返回 ours/base/theirs
  → 模型在对话里裁决
  → 宿主模型调 git_apply_resolve
```

网页有手动三栏。无 LLM 配置，无网页一键 AI。

| # | 用法 | 网页手动选边 | 聊天窗口里宿主模型处理冲突 |
|---|------|--------------|----------------------------|
| 1 | 只 `git-cockpit start` + 浏览器 | 能 | 不能（没有对话） |
| 2 | `start` + MCP URL `/mcp` | 能 | 能（须在对话框下指令；同进程，落盘后网页可 SSE 刷新） |
| 3 | stdio `git-cockpit mcp` | 该进程通常无 Web | 能；**不要**再开一个 `start` 当同一后端 |
| 4 | 对话里唤起后去网页点 | 能 | 不能（人已离开对话框） |
| 5 | 唤起后继续在对话框聊 | 可不经网页 | 能（主路径） |

只有 **2、3、5** 且人待在聊天窗口时，宿主模型才能处理冲突。1 和 4 只能手选。

不要做：网页 POST → 服务端经 MCP 去调 Cursor 对话（方向反了，且 Cursor 不支持 sampling）；也不做 daemon 调 HTTP LLM。

---

## 5. 接到本仓库技术栈（剩余工作仍遵守）

### 5.0 硬约束：能走 GitService / simple-git 就必须走

这是迁入时的 **默认路径，不是建议**。对照 Insight 源码只为搞清「要算出什么」；「怎么调 git」以本仓库为准。实现前先搜 `GitService` 有没有现成方法，有就调用，没有再加到 `GitService` 上，而不是在旁边新写一套。

已落地代码结构见设计文档 **5.2**。克隆尚未成为仓库时允许 `clone.ts` spawn `git clone --progress`（simple-git.clone 会整段缓冲，且没有当前仓队列），见设计文档 5.1。

| 要的东西 | 必须用 | 禁止 |
|----------|--------|------|
| remote 名、fetch/push URL | 已有 `listRemotes()` | 再 spawn `git remote get-url`，或 Insight 式自己读 config |
| 本地/远程分支是否存在 | 已有 `listBranches()` | 再 spawn `show-ref` 做「分支在不在」 |
| status / add / commit / push / diff / show 文件 | 已有 GitService 方法 | 再包一层 Insight `runGit` |
| merge-tree、worktree、merge-file、非交互 fetch | 已有 `runAllowFail` / `previewMerge` / `applyResolve` | 另起 spawn 封装；禁止退回工作区 `git merge` 冒充预演 |
| SSH/`git@` remote → https 网页或 API 地址 | **一处**：`merge.ts` 的 `toHttpsRemoteUrl` | 再写 `normalizeRemoteHttps` 之类第二套 |
| 创建 GitHub/GitLab PR | `mr` 模块走 REST 或本机已装的 `gh`/`glab` | 把 HTTP/CLI 塞进 GitService 当 git 命令；禁止下载 CLI |

判定顺序（写代码前过一遍）：

1. **GitService 有没有现成方法？** 有 → 直接调用。
2. **simple-git 有没有高层 API？** 有 → 加到 GitService，不要在工具 handler / `mr.ts` 里直接 `simpleGit()`。
3. **只有 raw git 能做？** → `this.run` 或已有 `runAllowFail`（exit 1 是合法结果时），参数数组、进队列。
4. **git 根本做不到？**（平台 HTTP、把 ssh remote 收成 https、浏览器创建页）→ 才允许手写；能复用 `toHttpsRemoteUrl` / `buildCreateMrUrl` 的禁止再复制一份。

反例（已经犯过，不要再犯）：为开 PR 再实现一遍 `normalizeRemoteHttps`，并用 `git remote get-url` / `show-ref` 绕开 `listRemotes` / `listBranches`。

### 5.1 不要做的事

- 依赖 `git-insight-core` 或 Insight 的 `runGit`。
- 在 `git_merge` 上叠预演参数。
- 做扩展、LLM 配置、网页 AI。
- 在 GitService 里到处拼 `glab`/`gh` 字符串（收到 `mr` 模块）。
- **再造一套 git 执行层**（新 helper 去 spawn 已有 GitService 能返回的事实）。

### 5.2 权限（剩余项仍沿用）

预演类只读；`git_apply_resolve` / `git_mr_create` 为写。沿用现有 `disabledTools`，不必 `GIT_INSIGHT_MCP_ALLOW_WRITE`。GitLab/CLI 开单仍走 `git_mr_create`，不要新工具名除非语义确实分叉。**落盘与建 MR 必须 executeTool**。Web 预演仍走 tools POST；可选优化见 §10.3。

---

## 6. 风险

| 风险 | 缓解 |
|------|------|
| 工作区被当成预演 | 只允许 merge-tree；落盘只允许 worktree |
| exit 1 当失败 | `runAllowFail` |
| worktree 与主区抢 `.git` | 主队列串行化生命周期 |
| into/from 左右颠倒 | schema/UI 写死：into=远程目标 |
| Token 进日志 | redact；工具返回禁止带 token；GET 只 `hosts[].tokenSet` + 掩码 `tokenPreview`，明文永不回显 |
| 宿主一次拉太大冲突 | 工具支持按 path 再取 |
| 两套 MCP 并存 | 迁移期只配 git-cockpit |

---

## 7. Insight 迁入分期

Insight 停更并下架；**不**做「扩展改壳」。预演、三栏手选、worktree 落盘、开 PR/MR、MR 配置、矩阵与合入顺序、矩阵只记本地并回矩阵推送/开 MR、状态页 tip 图与写操作、克隆、备份/reflog 已在设计文档，本表不再列。

| 阶段 | 内容 | 状态 |
|------|------|------|
| E | 可选预警（默认关） | **不做** |
| F | 停发 Insight MCP；扩展与 npm 下架 | 未做 |

聊天里的选边不另开发（预演 + 落盘工具已够）。

---

## 10. 原设计文档中的未实现项

下列 **明确不做** 与 **仍要做** 分开。实现时仍走 GitService / executeTool / 现有 Web，不另起技术栈。**§5.0 优先于 Insight 源码里的任何 git 封装。**

### 10.1 明确不做

| 项 | 原因 |
|----|------|
| Cursor / VS Code 扩展 | 已拍板；Insight 下架后不保留壳 |
| 网页 AI 选边、LLM 配置、Chat 桥、vscode.lm | Cockpit 不内置模型 |
| 机械 resolver、冲突预警、选边/trail 入库 | 已拍板不做 |
| 多条合成一条批量分支再推 | 不做本期；矩阵已能逐条推送临时分支 |
| 下载 gh/glab 到本机目录（原方式 B） | 无扩展可写路径；用户自装或用 Token |
| 远程 Docker 多租户 / 扩展市场 ID | 继续本地单用户 daemon；需要时另立项 |

### 10.2 随 Insight 迁入做（§7 剩余）

仍随 Insight 迁入：Insight 下架流程。Skill 已改为项目 Cursor rule，不再做。

### 10.3 设计里提过、与 Insight 无强绑定、可排期

| 项 | 建议 |
|----|------|
| 只读预演改 GET | 当前仍走 tools POST；改 GET 可避免大 patch 进审计 |
| Playwright E2E | 预演/选边/落盘/矩阵闭环已有，可随时写 |

---

## 11. 尚未实现：剩余工作量与建议顺序

工作量按 **1 名熟悉本仓库的全栈** 估人天（含自测；不含 Insight 下架流程）。**执行栈仍遵守 §5.0**。

### 11.1 还要做（迁入）

| 优先级 | 项 | 人天 | 做成后能用什么 | 依赖 |
|--------|----|------|----------------|------|
| **P3** | Insight 下架 | 流程 | 停发扩展 / npm | — |

**聊天窗口处理冲突** 与 **网页手选** 均已具备，不单独排期。

### 11.2 还要做（原设计、可后排）

| 项 | 人天 | 建议 |
|----|------|------|
| Playwright E2E | 2–4 | 预演/选边/落盘/矩阵闭环已有，可随时写 |

### 11.3 建议你先做哪几块

1. **Playwright E2E**（预演/选边/落盘/矩阵）。
2. **Insight 下架**（产品决策）。

**不要先做**：扩展、LLM、批量合入、机械 resolver、预警。
