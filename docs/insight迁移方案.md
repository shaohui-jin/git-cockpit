# Git Insight → Git Cockpit：迁移与未实现功能方案

> **日期**：2026-08-28  
> **对照**：`D:\_myproject\git-insight` 与本仓库 core + mcp-server + web  
> **已拍板**：不做 Cursor 扩展；Git 能力用本仓库 `GitService` / simple-git 重写，不引进 insight-core；Insight「Git 配置」在此改名为 **MR 配置**（方式 A 本机 gh/glab、C Token、D 浏览器页，**不做 B 下载 CLI**）；**不配置 LLM、不做网页 AI 选边**；Cockpit **不内置对话或选边模型**，只提供工具给外部 Agent 调用。Insight 后期全部下架。  
> **设计文档**只描述已落地行为。规划与迁入一律以本文为准。

---

## 0. Cockpit 和「AI」的关系（避免理解偏差）

Cockpit **没有产品级「AI 入口」**（没有聊天框、没有选边模型、没有 API Key 配置）。

| 角色 | 做什么 |
|------|--------|
| Cockpit | 执行 git / 预演 / 落盘 / 开 MR；通过 **MCP 工具** 和 **Web REST** 暴露能力 |
| Cursor / Claude 等宿主 | 用户在 **编辑器聊天窗口** 里说话；宿主模型决定何时 `callTool` |
| 网页 | 人点按钮；冲突只能 **手动三栏** |

因此对比表里不再写「Cockpit 的 AI 入口」。MCP 对日常 `git_status` 和以后的 `git_merge_rehearse` 是同一件事：**工具在这边，脑子在宿主那边**。

五种启动方式下冲突怎么处理见 **§4**。

---

## 1. 两个产品实际在解决什么

| | Git Insight | Git Cockpit（现状 + 迁入后） |
|--|-------------|------------------------------|
| 主问题 | 「合不合得进去」：不碰工作区算合并；worktree 落盘、开 MR | 「日常怎么安全地 git」+ 迁入后的预演/手选/落盘/MR |
| Git 执行 | 自研 `runGit` spawn | **本仓库 GitService + simple-git**（`raw` / 将补 `runAllowFail`），同一套队列与校验 |
| 写隔离 | 预演在对象库；落盘独立 worktree | 日常写打在当前工作区；**迁入的落盘也必须 worktree**，不污染主区 |
| 与模型的关系 | 扩展内调 vscode.lm / Chat 桥 / OpenAI HTTP | **不调任何模型**。宿主 Agent 可选调用 MCP 工具 |
| 开 MR | 设置里叫「Git 配置」：A/B/C/D | **MR 配置**：仅 A / C / D |
| 进程 | 扩展 + 可选 stdio MCP | daemon：`start` 时 Web 与 `/mcp` 同进程 |

Insight 里拼 git/glab/gh，是因为 merge-tree / worktree / MR API 不是「再包一层 add/commit」。迁入时用 **simple-git 调同一批 git 命令**（无高层 API 的走 `raw`），算法从 Insight 移植，执行栈不换第二套。

---

## 2. Insight 功能迁入判定

| Insight 能力 | 迁入 Cockpit | 做法 |
|--------------|--------------|------|
| 合并预演 `merge-tree` | 要 | 新只读工具，禁止复用工作区 `git_merge` |
| 冲突正文 + blame | 要 | `show` + `merge-file --diff3` + `blame`，经 GitService |
| 合并矩阵 / 合入顺序 | 要 | 只读；survey 一次 fetch；顺序用 `commit-tree` 游离 commit |
| 三栏手动选边 | 要 | Web 移植 hunk UI；数据来自 rehearsal |
| 「AI 选边」产品功能 | **不迁** | 不调模型。聊天里由宿主自己读工具结果并选边（§4） |
| 一键解决并推送 | 要 | `git_apply_resolve` + worktree |
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

创建 PR/MR **不是 git 操作**，单独模块（建议目录 `packages/core/src/mr/`），不要散落在 GitService 里 spawn glab。

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

### 5.1 不要做的事

- 依赖 `git-insight-core` 或 Insight 的 `runGit`。
- 在 `git_merge` 上叠预演参数。
- 做扩展、LLM 配置、网页 AI。
- 在 GitService 里到处拼 `glab`/`gh` 字符串（收到 `mr/`）。

### 5.2 模块

```
packages/core/src/
  gitService.ts     现有 + runAllowFail + worktree 工厂（仍 simple-git）
  merge/            移植预演 / rehearsal / survey / chain / applyResolve / resolvers
  mr/               探测平台、github/gitlab REST、可选 CLI、createMr
packages/web        合并页 + 三栏 + MR 配置表单（无 AI 按钮）
packages/mcp-server 只注册工具，executeTool 收口
```

### 5.3 GitService 原语

- `runAllowFail`：merge-tree 冲突 exit 1 是结果不是异常。
- worktree：子目录另 `GitService.open`，创建/删除/push 仍排进 **主仓库队列**。
- 命令一律参数数组：`merge-tree --write-tree`、`commit-tree`、`worktree`、`merge --no-commit`、`merge-file`、`blame`、非交互 `fetch`。
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
| A | `runAllowFail`、merge-tree 预演工具 + 合并页选分支 |
| B | Web 三栏手动选边（无 AI 按钮） |
| C | worktree `git_apply_resolve`；主区 status 不变 |
| D | MR 配置 + prepare/create（D→C→A，无下载 CLI） |
| E | 矩阵、合入顺序、可选预警（默认关） |
| F | 可选 Skill markdown；停发 Insight MCP；扩展与 npm 下架 |

A–C：预演 + 手选 + 落盘。聊天里的选边不另开发，只要 A/C 的工具对宿主可用。D 才是一键 MR。

---

## 8. 工具草案

只读：`git_merge_preview`、`git_merge_rehearse`、`git_merge_survey`、`git_merge_order`、`git_mr_prepare`  
写：`git_apply_resolve`、`git_mr_create`  

Web 预演可用 GET 以免大 patch 进审计；**落盘与建 MR 必须 executeTool**。

---

## 10. 原设计文档中的未实现项（实现口径）

下列从设计文档挪出，**明确不做**与 **仍要做** 分开。实现时仍走 GitService / executeTool / 现有 Web，不另起技术栈。

### 10.1 明确不做

| 项 | 原因 |
|----|------|
| Cursor / VS Code 扩展 | 已拍板；Insight 下架后不保留壳 |
| 网页 AI 选边、LLM 配置、Chat 桥、vscode.lm | Cockpit 不内置模型 |
| 下载 gh/glab 到本机目录（原方式 B） | 无扩展可写路径；用户自装或用 Token |
| 远程 Docker 多租户 / 扩展市场 ID | 继续本地单用户 daemon；需要时另立项 |

### 10.2 随 Insight 迁入做（§7）

预演、三栏、worktree 落盘、MR 配置、矩阵/顺序、可选预警与 Skill markdown。

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

对照 2026-08-28 代码：日常 Git 与 **A 预演 + C 落盘**已落地（左侧「合并」页、`git_merge_preview` / `git_merge_rehearse` / `git_apply_resolve`，MCP 32 工具）。仍未做：三栏手选（B）、完整 MR 配置（D，落盘结果已带浏览器创建 URL）、矩阵、Insight 下架。

工作量按 **1 名熟悉本仓库的全栈、可对着 Insight 源码搬** 估人天（含自测；不含 Insight 下架流程）。

### 11.1 还要做（迁入）

| 优先级 | 项 | 人天 | 做成后能用什么 | 依赖 |
|--------|----|------|----------------|------|
| **已完成** | **A 预演** | — | 聊天里问「合不合得进」；网页能看冲突文件名 | — |
| **已完成** | **C 落盘** | — | 场景 2/3/5：宿主模型选边后真正推临时分支 | A |
| **P1** | **B 三栏手选**（整文件/逐 hunk，无 AI 按钮；blame 可第二批） | 5–8 | 纯网页用户也能选边再点落盘 | A；落盘按钮依赖 C |
| **P1** | **D-lite MR**：D 浏览器 URL + C 的 GitHub Token 开 PR + 设置页 | 3–4 | 常见 GitHub 一键开单 | 有可推的源分支（通常先有 C） |
| **P2** | **D 补全**：GitLab Token（含 user id）、本机 gh/glab、审核人 | 3–5 | GitLab / 已装 CLI 的机器 | D-lite |
| **P2** | **E 矩阵 + 合入顺序**（先 API，矩阵 UI 另计） | API 3–4；矩阵 UI 3–5 | 多分支发布前扫描 | A |
| **P3** | 预警（默认关）、Skill markdown、Insight 下架 | 1–2 + 流程 | 锦上添花 | A 至少有 |

**聊天窗口处理冲突** 不单独排期：有 **A+C** 即可（B 不是前提）。

### 11.2 还要做（原设计、可后排）

| 项 | 人天 | 建议 |
|----|------|------|
| `allowedRepos` 打开时校验 | 0.5–1 | 安全小补丁，可插在任何空隙 |
| 状态页补 merge/tag/删分支等按钮 | 1–2 | 工具已有，套现有确认框 |
| 克隆远程 | 1–2 | 与预演无关 |
| reflog / 备份分支恢复 UI | 2–3 | 高危配套，晚于 C |
| 分支图 UI | 4–8 | `git_graph` 已有数据；不挡 A–D |
| Playwright E2E | 2–4 | 有 A+C 后再写 |

### 11.3 建议你先做哪几块

两条主线，按你最急的入口选：

1. **先打通「对话里解决冲突」**（推荐若你主要用 Cursor）：**A → C**（约 8–12 人天）。做完就能 `start` + `/mcp` 让模型预演并落盘。网页此时只有冲突列表，还不能手选 hunk。
2. **先打通「网页手选」**：**A → B → C**（约 13–20 人天）。纯浏览器用户才能闭环。

**不要先做**：矩阵、分支图、克隆、扩展、LLM。  
**D（开 MR）** 放在至少有一条能推上去的临时分支之后（即 C 之后）；若现在几乎只用 GitHub.com，D-lite 即可，GitLab/CLI 可再缓。

建议第一批交付：**A + C**，第二批 **B**，第三批 **D-lite**。
