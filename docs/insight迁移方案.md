# Git Insight → Git Cockpit：迁移与未实现功能方案

> **日期**：2026-08-28  
> **对照**：`D:\_myproject\git-insight` 与本仓库 core + mcp-server + web  
> **已拍板**：不做 Cursor 扩展；Git 能力用本仓库 `GitService` / simple-git 重写，不引进 insight-core；Insight「Git 配置」在此改名为 **MR 配置**（方式 A 本机 gh/glab、C Token、D 浏览器页，**不做 B 下载 CLI**）；**不配置 LLM、不做网页 AI 选边**；Cockpit **不内置对话或选边模型**，只提供工具给外部 Agent 调用。Insight 后期全部下架。  
> **硬约束（执行栈，必须遵守）**：仓库里的 git 事实一律走 **现有 `GitService` / simple-git**。simple-git 有高层 API 用高层；没有的用现有 `raw` / `runAllowFail`。禁止再按 Insight 自研 `runGit` 另装一套命令封装。只有 git/simple-git **确实做不到** 的事（SSH remote → https 网页/API、GitHub/GitLab REST、gh/glab CLI）才允许手写，且不得与已有方法重复。详见 **§5.0**。  
> **设计文档**只描述已落地行为（含 merge-tree 预演与 worktree 落盘）。规划与尚未迁入项以本文为准。

---

## 0. Cockpit 和「AI」的关系（避免理解偏差）

Cockpit **没有产品级「AI 入口」**（没有聊天框、没有选边模型、没有 API Key 配置）。

| 角色 | 做什么 |
|------|--------|
| Cockpit | 执行 git / 预演 / 落盘 / 开 MR；通过 **MCP 工具** 和 **Web REST** 暴露能力 |
| Cursor / Claude 等宿主 | 用户在 **编辑器聊天窗口** 里说话；宿主模型决定何时 `callTool` |
| 网页 | 人点按钮；冲突走 **手动三栏**（尚未做，现状仅冲突列表） |

因此对比表里不再写「Cockpit 的 AI 入口」。MCP 对日常 `git_status` 和 `git_merge_rehearse` 是同一件事：**工具在这边，脑子在宿主那边**。

五种启动方式下冲突怎么处理见 **§4**。

---

## 1. 两个产品实际在解决什么

| | Git Insight | Git Cockpit（现状 + 迁入后） |
|--|-------------|------------------------------|
| 主问题 | 「合不合得进去」：不碰工作区算合并；worktree 落盘、开 MR | 「日常怎么安全地 git」+ 已有预演/落盘 + 待迁入手选/MR |
| Git 执行 | 自研 `runGit` spawn | **本仓库 GitService + simple-git**（`raw` / `runAllowFail`），同一套队列与校验 |
| 写隔离 | 预演在对象库；落盘独立 worktree | 日常写打在当前工作区；**落盘已走独立 worktree**，不污染主区 |
| 与模型的关系 | 扩展内调 vscode.lm / Chat 桥 / OpenAI HTTP | **不调任何模型**。宿主 Agent 可选调用 MCP 工具 |
| 开 MR | 设置里叫「Git 配置」：A/B/C/D | **MR 配置**：仅 A / C / D |
| 进程 | 扩展 + 可选 stdio MCP | daemon：`start` 时 Web 与 `/mcp` 同进程 |

Insight 里拼 git/glab/gh，是因为 merge-tree / worktree / MR API 不是「再包一层 add/commit」。迁入时 **算法可以对照 Insight，执行必须落在本仓库 GitService 上**（§5.0），禁止把 Insight 的 spawn/URL 组装原样搬过来当第二套 git 层。

---

## 2. Insight 功能迁入判定

| Insight 能力 | 迁入 Cockpit | 做法 |
|--------------|--------------|------|
| 合并预演 `merge-tree` | **已落地** | 见设计文档 4.1 / 6.4；`git_merge_preview` / `git_merge_rehearse` |
| 冲突正文 + blame | 正文 **已落地**；blame 可后置 | `show` + `merge-file --diff3` 已接 rehearsal；blame 未做 |
| 合并矩阵 / 合入顺序 | 要 | 只读；survey 一次 fetch；顺序用 `commit-tree` 游离 commit |
| 三栏手动选边 | 要 | Web 移植 hunk UI；数据来自 rehearsal |
| 「AI 选边」产品功能 | **不迁** | 不调模型。聊天里由宿主自己读工具结果并选边（§4） |
| 一键解决并推送 | **已落地** | `git_apply_resolve` + worktree；见设计文档 |
| 一键申请 MR | 要 | **MR 配置** + `git_mr_prepare` / `git_mr_create`（§3） |
| Insight 的 LLM / AI 设置项 | **不迁** | 无 `aiApiBaseUrl` / Key / Model |
| 机械 resolver（gitignore 并集等） | 可后置 | 配置只来自 `~/.git-cockpit`，禁止读仓库文件 |
| 冲突预警 | 可后置 | daemon + SSE，默认关；无状态栏 |
| 分支图 G6 | 见 §10 | `git_graph` 已有数据，前端另做 |
| Skill | 可做薄 markdown | 只写「请调 Cockpit 哪些工具」，不是扩展 |
| Cursor 扩展 / vscode.lm 桥 | **不做** | Insight 下架后无替代壳 |

不能拿 `git_merge`+`dry_run`、工作区 merge、或 `git_push` 冒充预演和落盘。

---

## 3. MR 配置（原 Insight「Git 配置」）

创建 PR/MR **不是 git 操作**，放 `mr.ts`（或日后的 `mr/`），不要在 GitService 里 spawn glab。仓库侧仍走 GitService：remote URL 用 `listRemotes()`，分支用 `listBranches()`，https 网页地址用已有 `toHttpsRemoteUrl` / `buildCreateMrUrl`。

| 方式 | 是否实现 |
|------|----------|
| A. 本机已登录的 `gh` / `glab` | 要（可选加速） |
| B. 下载 CLI 到扩展目录 | **不做** |
| C. Token + REST | 要（主路径） |
| D. 只打开浏览器创建页 | 要（无 Token 时的兜底，不假装已创建） |

设置页名称用 **MR 配置**：方式、GitHub/GitLab Token、默认 remote；自建实例可覆盖平台与 `apiBaseUrl`。Token 只放 `~/.git-cockpit/config.json`，审计脱敏。GitLab 审核人需先把 username 换成数字 id。

工具：`git_mr_prepare`（只读）、`git_mr_create`（写，建议默认要审批，以免宿主 Agent 误开单）。

实现顺序建议：D → C → A。

---

## 4. 冲突选边：五种用法（Cockpit 不提供 AI 入口）

Cockpit 只提供预演数据和落盘接口。所谓「丢给 AI」= **人在宿主聊天窗口里让模型调工具**，不是 Cockpit 去聊。

```text
用户在 Cursor 说：feature 合进 origin/master，冲突帮我选边并落盘
  → 宿主模型调 git_merge_rehearse
  → 工具返回 ours/base/theirs
  → 模型在对话里裁决
  → 宿主模型调 git_apply_resolve
```

网页只有手动三栏。无 LLM 配置，无网页一键 AI。

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

## 5. 接到本仓库技术栈

### 5.0 硬约束：能走 GitService / simple-git 就必须走（先读这条）

这是迁入时的 **默认路径，不是建议**。对照 Insight 源码只为搞清「要算出什么」；「怎么调 git」以本仓库为准。实现前先搜 `GitService` 有没有现成方法，有就调用，没有再加到 `GitService` 上，而不是在旁边新写一套。

| 要的东西 | 必须用 | 禁止 |
|----------|--------|------|
| remote 名、fetch/push URL | 已有 `listRemotes()`（内部 `this.git.getRemotes(true)`） | 再 spawn `git remote get-url`，或 Insight 式自己读 config |
| 本地/远程分支是否存在 | 已有 `listBranches()` | 再 spawn `show-ref` 做「分支在不在」 |
| status / add / commit / push / diff / show 文件 | 已有 GitService 方法 | 再包一层 Insight `runGit` |
| merge-tree、worktree、merge-file、非交互 fetch | 已有 `runAllowFail` / `previewMerge` / `applyResolve` | 另起 spawn 封装；禁止退回工作区 `git merge` 冒充预演 |
| SSH/`git@` remote → https 网页或 API 地址 | **一处**：`merge.ts` 的 `toHttpsRemoteUrl`（simple-git 不会做这种转换） | 再写 `normalizeRemoteHttps` 之类第二套 |
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

### 5.2 模块

```
packages/core/src/
  gitService.ts     现有（含 runAllowFail、previewMerge / rehearseMerge / applyResolve；remote/分支用 listRemotes / listBranches）
  merge.ts          已落地：预演解析 / 分支短名 / diff3 / toHttpsRemoteUrl / 浏览器 MR URL
  mr.ts             GitHub Token REST 等非 git 能力；URL 解析复用 merge.ts，不自建第二套
packages/web        合并预演页已有（选分支 + 冲突列表 + 干净落盘）；待做三栏 + MR 配置表单（无 AI 按钮）
packages/mcp-server 只注册工具，executeTool 收口；`/docs` 已有
```

### 5.3 GitService 原语（预演/落盘已按此实现）

- `runAllowFail`：merge-tree 冲突 exit 1 是结果不是异常。
- worktree：创建/删除/push 排进 **主仓库队列**；主工作区不切换。
- 命令一律参数数组：`merge-tree --write-tree`、`worktree`、`merge --no-commit`、`merge-file`、非交互 `fetch`。矩阵阶段再补 `commit-tree` / `blame`——同样进 GitService，不另起执行层。
- Git **≥ 2.38**，否则预演直接报错，禁止退回工作区 merge。

### 5.4 权限

预演类只读；`git_apply_resolve` 为写（push 可进审批）；`git_mr_create` 建议默认审批。沿用现有 `disabledTools`，不必 `GIT_INSIGHT_MCP_ALLOW_WRITE`。

---

## 6. 风险

| 风险 | 缓解 |
|------|------|
| 工作区被当成预演 | 只允许 merge-tree；落盘只允许 worktree |
| exit 1 当失败 | `runAllowFail` |
| worktree 与主区抢 `.git` | 主队列串行化生命周期 |
| into/from 左右颠倒 | schema/UI 写死：into=远程目标 |
| Token 进日志 | redact；工具返回禁止带 token |
| 宿主一次拉太大冲突 | 工具支持按 path 再取 |
| 两套 MCP 并存 | 迁移期只配 git-cockpit |

---

## 7. Insight 迁入分期

Insight 停更并下架；**不**做「扩展改壳」。

| 阶段 | 内容 |
|------|------|
| B | Web 三栏手动选边（无 AI 按钮） |
| D | MR 配置 + prepare/create（先浏览器 URL / GitHub Token，再 GitLab 与本机 gh/glab；**不做下载 CLI**） |
| E | 矩阵、合入顺序、可选预警（默认关） |
| F | 可选 Skill markdown；停发 Insight MCP；扩展与 npm 下架 |

预演与 worktree 落盘已在设计文档，本表不再列。聊天里的选边不另开发。网页手选靠 **B**。**D** 才是 Token / CLI 一键 MR（落盘已返回浏览器创建 URL）。

---

## 8. 工具草案（尚未落地）

已落地见设计文档：`git_merge_preview`、`git_merge_rehearse`、`git_apply_resolve`。

只读待做：`git_merge_survey`、`git_merge_order`、`git_mr_prepare`  
写待做：`git_mr_create`  

Web 预演可用 GET 以免大 patch 进审计（当前预演仍走 tools POST）；**落盘与建 MR 必须 executeTool**。

---

## 10. 原设计文档中的未实现项（实现口径）

下列从设计文档挪出，**明确不做**与 **仍要做** 分开。实现时仍走 GitService / executeTool / 现有 Web，不另起技术栈。**§5.0 优先于 Insight 源码里的任何 git 封装。**

### 10.1 明确不做

| 项 | 原因 |
|----|------|
| Cursor / VS Code 扩展 | 已拍板；Insight 下架后不保留壳 |
| 网页 AI 选边、LLM 配置、Chat 桥、vscode.lm | Cockpit 不内置模型 |
| 下载 gh/glab 到本机目录（原方式 B） | 无扩展可写路径；用户自装或用 Token |
| 远程 Docker 多租户 / 扩展市场 ID | 继续本地单用户 daemon；需要时另立项 |

### 10.2 随 Insight 迁入做（§7 剩余）

三栏手选、完整 MR 配置、矩阵/顺序、可选预警与 Skill markdown。预演与 worktree 落盘已在设计文档。

### 10.3 设计里提过、与 Insight 无强绑定、可排期

| 项 | 建议 |
|----|------|
| 分支图 UI | `git_graph` 已返回数据；独立页 SVG 或 G6，不阻塞预演 |
| 工作区 `git_merge` 的 Web 按钮 | 工具已有，与 merge-tree 预演并存，勿混用 |
| tag / rebase / force push / 删分支的 Web 按钮 | MCP 已有；按需加到状态页，走现有确认框 |
| reflog / 从 `backup/pre-op-*` 恢复 UI | 高危备份的配套；可晚于落盘 |
| 克隆远程仓库 | 新写操作 + 路径校验；与预演无关 |
| `allowedRepos` 白名单 | 配置字段已有，打开仓库时强制校验 |
| Playwright E2E | 有预演/落盘后再补 |

克隆、白名单、reflog、分支图、E2E **不**再写进设计文档正文；做完后再把「已实现」补回设计文档。

---

## 11. 现状、剩余工作量与建议顺序

对照当前代码：日常 Git 与 **预演 + 落盘**已落地（见设计文档）。仍未做：三栏手选（B）、完整 MR 配置（D）、矩阵、Insight 下架。

工作量按 **1 名熟悉本仓库的全栈、可对着 Insight 源码搬** 估人天（含自测；不含 Insight 下架流程）。搬的是产品行为，**执行栈仍遵守 §5.0**。

### 11.1 还要做（迁入）

| 优先级 | 项 | 人天 | 做成后能用什么 | 依赖 |
|--------|----|------|----------------|------|
| **P1** | **B 三栏手选**（整文件/逐 hunk，无 AI 按钮；blame 可第二批） | 5–8 | 纯网页用户也能选边再点落盘 | 预演与落盘已有 |
| **P1** | **D-lite MR**：设置页 + GitHub Token 开 PR（浏览器 URL 落盘已返回，可复用） | 3–4 | 常见 GitHub 一键开单 | 有可推的源分支 |
| **P2** | **D 补全**：GitLab Token（含 user id）、本机 gh/glab、审核人 | 3–5 | GitLab / 已装 CLI 的机器 | D-lite |
| **P2** | **E 矩阵 + 合入顺序**（先 API，矩阵 UI 另计） | API 3–4；矩阵 UI 3–5 | 多分支发布前扫描 | 预演已有 |
| **P3** | 预警（默认关）、Skill markdown、Insight 下架 | 1–2 + 流程 | 锦上添花 | — |

**聊天窗口处理冲突** 不单独排期：预演 + 落盘工具已够（B 不是前提）。

### 11.2 还要做（原设计、可后排）

| 项 | 人天 | 建议 |
|----|------|------|
| `allowedRepos` 打开时校验 | 0.5–1 | 安全小补丁，可插在任何空隙 |
| 状态页补 merge/tag/删分支等按钮 | 1–2 | 工具已有，套现有确认框 |
| 克隆远程 | 1–2 | 与预演无关 |
| reflog / 备份分支恢复 UI | 2–3 | 高危配套 |
| 分支图 UI | 4–8 | `git_graph` 已有数据；不挡 B/D |
| Playwright E2E | 2–4 | 预演/落盘已有，可随时写 |

### 11.3 建议你先做哪几块

按入口选：

1. **纯网页用户**：先做 **B 三栏**（约 5–8 人天），选边后点已有落盘。
2. **主要用 Cursor 对话**：B 可缓；若要一键开单再做 **D-lite**（约 3–4 人天）。

**不要先做**：矩阵、分支图、克隆、扩展、LLM。  
**D（Token 开 MR）** 需要已经能推上临时分支（落盘已具备）。若几乎只用 GitHub.com，D-lite 即可，GitLab/CLI 再缓。
