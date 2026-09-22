# Git Cockpit

基于 MCP（Model Context Protocol）的 Git 可视化操作工具：Web 端界面 + 供宿主 Agent 调用的 MCP 工具，支持多仓库管理与安全的 Git 操作。

> 完整设计见 [设计文档.md](docs/设计文档.md)。本产品 **不做** Cursor/VS Code 扩展，也不做冲突自动选边。可选聊天（同一 Web + `/api/chat` + Electron 宿主）见 [docs/聊天壳方案.md](docs/聊天壳方案.md)。在 Cursor 里配 MCP **不会**打开聊天页。

## Monorepo 结构

```
packages/
├── core/        # 共享核心逻辑：GitService、权限、备份、日志（简单）
├── mcp-server/  # MCP Server + Fastify Web 服务 + CLI（发布包）
├── web/         # Vue 3 前端（构建产物由 web 服务托管）
└── e2e/         # Playwright：只测发布形态，不进 `pnpm test`
```

## 快速开始（开发）

```bash
pnpm install
pnpm build
node packages/mcp-server/dist/cli-entry.js start   # 本地构建产物直接启动
```

网页回归（Playwright）测 **build 后的 daemon 静态页**，不测 Vite，也不进 `pnpm test`。默认用本机 Edge/Chrome：

```bash
pnpm test:e2e
```

## CLI 与 bin 用法

全局安装 `@shaohui_jin/git-cockpit-mcp-server`（或本地构建）后，提供 `git-cockpit` 命令：

```bash
git-cockpit start    # 启动常驻服务：Web UI + MCP Server（Streamable HTTP），默认 http://localhost:3000
git-cockpit mcp      # 以 stdio 方式运行 MCP Server（供 Claude Desktop / Cursor 连接）
git-cockpit version  # 输出版本号
git-cockpit help     # 显示帮助
```

### bin 前缀约定：`git cockpit` 等价写法

bin 命令名带 `git-` 前缀，因此**也可以写成 `git cockpit`**，两者参数转发完全等价：

```bash
git cockpit start   # 等价 git-cockpit start
git cockpit mcp     # 等价 git-cockpit mcp
```

这是 Git 的**外部子命令机制**：当 `xxx` 不是内置子命令时，git 会沿 PATH 查找名为 `git-xxx` 的可执行文件并转发参数执行（`git-lfs`、`git-flow` 等工具均基于此约定）。npm 全局安装时生成的 `git-cockpit` 正是无扩展名 + shebang 的脚本形态，Linux/macOS 与 Windows（含 Git for Windows）均可被 git 定位执行；而纯 `.cmd`/`.bat` 形态的文件不会被 git 的 PATH 查找命中。

## MCP 使用

Git Cockpit 提供 **stdio** 与 **Streamable HTTP** 两种 MCP 接入方式。

### 方式一：stdio（单机直连）

```bash
git-cockpit mcp
```

在 Claude Desktop / Cursor 等 MCP 客户端中配置（命令方式）：

```json
{
  "mcpServers": {
    "git-cockpit": {
      "command": "git-cockpit",
      "args": ["mcp"]
    }
  }
}
```

> 若客户端无法直接解析全局命令（部分 Windows 环境），可用 `npm root -g` 查看全局 bin 目录，改用完整路径或 `git-cockpit.cmd`。

### 方式二：Streamable HTTP（常驻服务，多客户端共享）

```bash
git-cockpit start
# Web UI:  http://localhost:3000
# MCP:     http://localhost:3000/mcp
```

客户端通过 `/mcp` 端点接入（URL 方式）：

```json
{
  "mcpServers": {
    "git-cockpit-http": {
      "url": "http://localhost:3000/mcp"
    }
  }
}
```

**多窗口一起用**（网页 + Cursor，或两个聊天窗口）：只跑 `git-cockpit start`，都连上面这个 `/mcp`。不要再开一个 `git-cockpit mcp`——那是另一个进程，和网页不共用同一份任务队列。

**不要**和 Git Insight（或其它会直接改同一仓的 Git MCP）同时用于同一个仓库。

### Agent 该怎么用

配好之后，让模型按下面四件事做。不要用终端 git 代替「预演、落盘、开 PR」。

默认只给摘要；要看某文件正文时再说路径，或加 `detail=true`。写操作先干跑（`dry_run=true`）。高风险操作默认关着。

**1. 提交**  
先看工作区有没有改、改了什么，再暂存，再提交。不要一上来就提交。

对应工具：`git_status` → `git_diff` → 按需 `git_add` → `git_commit`。

**2. 合不合得进去，以及写进仓库**  
先看工作区是不是已经卡在 merge / rebase 里。卡住了走第 3 条，不要走这条。

问能不能合进去时，只做预演，**不要**在当前工作区执行 merge。`into` 是要合进去的目标（线上），`from` 是你的分支。有冲突时把 `webUrl` 给人打开合并页（`/#/merge?into=&from=&preview=1`），然后停止。不要选边，不要传 `files` / `resolvedContent`，不要在冲突时 `git_mr_create`（含 dry_run）。

看完要写进仓库：仅干净合并才用独立目录落盘，不要切走你正在干活的分支。人口头说解决了不算：用原来的 into/from 再预演，认这一对的 `merge/<from>-into-<into>`（或 `origin/merge/…`）。别人的 `merge/*` 当噪音。

对应工具：`git_merge_preview` / `git_merge_rehearse`（冲突行是谁改的用 `git_merge_blame`，只读）。干净才 `git_apply_resolve`。禁止用 `git_merge` 冒充预演。

**3. 工作区已经卡在 merge 或 rebase 里**  
这是另一回事：冲突已经发生在当前目录了。看状态。人先在编辑器或网页解决，再继续或放弃。不要传 `files`，不要用第 2 条的「预演落盘」去收尾。

对应工具：`git_status`（看 `operation`）→ `git_merge_continue` / `git_rebase_continue`（不要带 `files`）或 abort。禁止用 `git_apply_resolve`。

**4. 开 Pull Request / Merge Request**  
先 `git_merge_preview`。有冲突不要 `git_mr_create`（含 dry_run），把 `webUrl` 给人在网页选边。干净则落盘并推送临时枝，再 `git_mr_prepare`；只有 `mergeGate.ok` 才 `git_mr_create`，且只 dry_run 预览正文，不要把干跑当确认开单。登录用的 Token 写在网页设置里，不要塞进工具参数。

对应工具：`git_merge_preview` →（冲突则停）`git_apply_resolve` / `git_push` → `git_mr_prepare` → `git_mr_create`（只 dry_run）。

宿主可插入这四条 Prompt（名字：`safe_commit` / `merge_preview_apply` / `workspace_continue` / `open_mr`），正文即上面四段。只读状态也可读 Resource：`git-cockpit://repos`、`git-cockpit://repo/current`、`git-cockpit://jobs`、`git-cockpit://jobs/{id}`。

### 端点一览

| 端点 | 说明 |
| --- | --- |
| `/mcp` | MCP Streamable HTTP 接入点（常驻服务模式） |
| `/api/*` | Web 前端 REST API（仓库、状态、设置、日志） |
| `/` | Web 管理界面（工作台 / 状态 / 合并 / 任务 / 操作日志 / 设置） |

### 环境变量

| 变量 | 说明 | 默认 |
| --- | --- | --- |
| `GIT_COCKPIT_DATA_DIR` | 数据目录（仓库列表、审计日志、备份） | `~/.git-cockpit` |
| `GIT_COCKPIT_PORT` | 常驻服务端口 | `3000` |
| `GIT_COCKPIT_HOST` | 监听地址 | `localhost` |

### 安全机制

写操作默认走「dry-run 预览 → 确认 → 执行」流程；高风险操作（如硬重置）默认禁用，需在 Web 设置或配置文件中开启并配置人工审批。所有工具调用均记录审计日志。

## npm 发布

发布到 npm 的是 **2 个包**（web 不单独发布，其构建产物内嵌进 mcp-server）：

| 包 | npm 名称 | 版本维护位置 | 发布 tag |
| --- | --- | --- | --- |
| core | `@shaohui_jin/git-cockpit-core` | `packages/core/package.json` | `core-v{version}` |
| mcp-server | `@shaohui_jin/git-cockpit-mcp-server` | `packages/mcp-server/package.json` | `mcp-server-v{version}` |

**判据**：GitHub Actions 检查远程是否已存在对应 tag——不存在才构建 → 发布 npm → 打 tag；tag 在**发布成功之后**才推送，失败重试不浪费版本号。

**触发**：push 到 `master`/`main`，或手动运行 workflow（`workflow_dispatch`）。需要仓库配置 Secret `NPM_TOKEN`（npm Automation token）。

core 作为 mcp-server 的运行时依赖（`workspace:^`），发布 mcp-server 时 workflow 会先确保 core 已发布。详细发布手册（tag 协议、版本管理、本地发布注意事项）见 [docs/release.md](./docs/release.md)。

## 开发

日常 Git、合并预演、矩阵、开 PR/MR、工作台、MCP 摘要输出、通用后台任务均已落地。已落地行为见 [docs/设计文档.md](docs/设计文档.md)。

可选聊天：`pnpm start` 后打开设置「模型」填 API Key（可填 OpenAI 兼容 Base URL；保存会探活）。开发可用环境变量 `GIT_COCKPIT_LLM_API_KEY` / `GIT_COCKPIT_LLM_MODEL` / `GIT_COCKPIT_LLM_BASE_URL` 覆盖，不写进设置文件。侧栏进「聊天」。写操作会先干跑，确认条展示真实 git 命令后再执行。模型 Key 与 MR Token 一样只在设置里，不进 MCP 工具参数。Cursor 直连 `/mcp` **不经**聊天确认闸。

桌面窗开发：先起带聊天的前端，再开 Electron。窗口标题会带当前地址（应是 `http://127.0.0.1:5173`）。若标题是 `:3000` 或侧栏没有「聊天」，先关掉**所有** Git Cockpit 窗口，再重新 `pnpm desktop:dev`。

```bash
pnpm start                 # 终端 1：daemon :3000 + Vite :5173
pnpm desktop:dev           # 终端 2：窗口；侧栏「工作台」下面应有「聊天」
```

形态与分期见 [docs/聊天壳方案.md](docs/聊天壳方案.md)。

安装包只带窗壳，不含服务。启动时会先探活 `:3000`，未命中则找本机 Node.js 22+，再**试跑** `git-cockpit version` 确认服务可用；不可用（没装 / 依赖损坏）时，打包版会询问后自动执行 `npm i -g @shaohui_jin/git-cockpit-mcp-server@latest`，安装过程有日志窗口、可取消，全局目录不可写时自动改装到用户目录。开发态（`pnpm desktop:dev`）不自动安装，缺失时提示先 `pnpm build`。

本地打 Windows 安装包（验证用）：`pnpm --filter @shaohui_jin/git-cockpit-desktop pack:local`，产物在 `apps/desktop/release`。步骤与排障见 [docs/桌面端本地打包.md](docs/桌面端本地打包.md)。