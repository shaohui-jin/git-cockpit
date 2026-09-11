# @shaohui_jin/git-cockpit-mcp-server

Git Cockpit —— 基于 **MCP（Model Context Protocol）** 的 Git 可视化操作工具。一个包同时提供三种形态：**MCP Server**（供 AI 客户端调用 Git 操作）、**Web 管理界面**（浏览器可视化操作）、**CLI**（命令行启动）。支持多仓库管理、权限审批与 dry-run 预览等安全机制。

## 环境要求

- Node.js **>= 22.5.0**（底层 core 包使用 `node:sqlite`）

## 安装

```bash
# 全局安装（提供 git-cockpit 命令）
pnpm add -g @shaohui_jin/git-cockpit-mcp-server
# 或
npm install -g @shaohui_jin/git-cockpit-mcp-server
```

包为纯 ESM，内置 Web 前端（`dist/web`），无需额外安装静态资源。

## 快速开始

```bash
git-cockpit start   # 启动常驻服务：Web UI + MCP Server（Streamable HTTP），默认 http://localhost:3000
git-cockpit mcp     # 以 stdio 模式运行 MCP Server（供 Claude Desktop / Cursor 等客户端连接）
git-cockpit version # 输出版本号
```

启动后浏览器访问 `http://localhost:3000` 即可使用 Web 界面；`/mcp` 端点提供 MCP Streamable HTTP 接入。

### 接入 MCP 客户端（stdio）

以 Claude Desktop / Cursor 为例，在 MCP 配置中加入：

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

网页和聊天窗口要一起用时，改跑 `git-cockpit start`，客户端连 `http://localhost:3000/mcp`。不要再开一个 `git-cockpit mcp` 抢同一仓。

**不要**和 Git Insight（或其它会直接改同一仓的 Git MCP）同时用于同一个仓库。

### Agent 该怎么用

和仓库根 [README.md](../../README.md) 同一套，这里再写一遍（npm 包装的人看不到仓库根文档）：

**1. 提交** — 先看改了什么，再暂存、再提交。写之前先 `dry_run=true`。  
`git_status` → `git_diff` → 按需 `git_add` → `git_commit`。

**2. 合不合得进去，以及写进仓库** — 先看工作区是不是已经卡在 merge / rebase 里（卡住了走第 3 条）。问能不能合时只做预演，不要在当前目录 merge。`into` 是线上目标，`from` 是你的分支。有冲突把 `webUrl` 给人打开合并页，然后停止。不要选边，不要传 `files`。不要 `git_mr_create`（含 dry_run）。仅干净合并才 `git_apply_resolve`。不要用 `git_merge` 冒充预演。人口头说解决了不算：用原来的 into/from 再预演，认这一对的 `merge/<from>-into-<into>`。

**3. 工作区已经卡在 merge 或 rebase 里** — 看状态。人先解决，再继续或放弃。不要传 `files`。不要用第 2 条的落盘去收尾。  
`git_status` → `git_merge_continue` / `git_rebase_continue`（不要带 `files`）或 abort。禁止 `git_apply_resolve`。

**4. 开 Pull Request / Merge Request** — 先预演。有冲突则停。干净则落盘并推送临时枝，再 `git_mr_prepare`；只有 `mergeGate.ok` 才 `git_mr_create`，且只 dry_run。Token 在网页设置里，不要塞进工具参数。  
`git_merge_preview` → `git_apply_resolve` / `git_push` → `git_mr_prepare` → `git_mr_create`（只 dry_run）。

宿主可插入这四条 Prompt（`safe_commit` / `merge_preview_apply` / `workspace_continue` / `open_mr`），正文即上面四段。只读状态也可读 Resource：`git-cockpit://repos`、`git-cockpit://repo/current`、`git-cockpit://jobs`、`git-cockpit://jobs/{id}`。

默认只给摘要；要某文件正文加 `path` 或 `detail=true`。

### 环境变量

| 变量 | 说明 | 默认 |
| --- | --- | --- |
| `GIT_COCKPIT_DATA_DIR` | 数据目录（仓库列表、审计日志、备份） | `~/.git-cockpit` |
| `GIT_COCKPIT_PORT` | Web 服务端口 | `3000` |
| `GIT_COCKPIT_HOST` | 监听地址 | `localhost` |

## 主要特性

- **多仓库管理**：统一打开/移除仓库，跨仓库操作
- **安全机制**：工具按风险分级（readonly / write / dangerous），写操作 dry-run 预览 → 确认 → 执行；高危操作可配置人工审批
- **MCP 默认摘要**：`git_diff` / `git_show` / `git_merge_rehearse` 默认不回完整正文；要正文请加 `path` 或 `detail=true`（网页 GET 仍是全文）
- **内置 Web UI**：工作台 / 状态 / 合并 / 任务 / 操作日志 / 设置，支持提交、分支、stash、pull/push、硬重置等操作
- **审计日志**：所有工具调用记录落库，可回溯
- **备份**：高危操作前自动备份分支引用与 stash 快照

## 发布说明（维护者）

版本号维护在 `packages/mcp-server/package.json`，发布由仓库根目录 `.github/workflows/release.yml` 的 `release-mcp-server` job 负责（不是历史上的 `release-mcp-server.yml`）：

- **判据**：远程不存在 `mcp-server-v{version}` tag 才发布
- **流程**：构建 web → 构建 mcp-server（`prepublishOnly` 自动把 web/dist 内嵌进 `dist/web`）→ `pnpm publish` → 成功后才推送 tag `mcp-server-v{version}`
- **依赖**：mcp-server 依赖 `@shaohui_jin/git-cockpit-core`（`workspace:^`，发布时转为 `^0.1.0`），workflow 会先确保 core 已发布（缺失则顺带发布）
- **触发**：push 到 `master`/`main`，或 GitHub Actions 手动 `workflow_dispatch`
- **需要仓库 Secret**：`NPM_TOKEN`（npm Automation token）

完整发布手册（含 tag 协议、版本管理、本地发布注意事项）见仓库内 [docs/release.md](../../docs/release.md)。

## License

MIT