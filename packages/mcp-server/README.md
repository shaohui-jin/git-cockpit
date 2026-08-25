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

### 环境变量

| 变量 | 说明 | 默认 |
| --- | --- | --- |
| `GIT_COCKPIT_DATA_DIR` | 数据目录（仓库列表、审计日志、备份） | `~/.git-cockpit` |
| `GIT_COCKPIT_PORT` | Web 服务端口 | `3000` |
| `GIT_COCKPIT_HOST` | 监听地址 | `localhost` |

## 主要特性

- **多仓库管理**：统一打开/移除仓库，跨仓库操作
- **安全机制**：工具按风险分级（readonly / write / dangerous），写操作 dry-run 预览 → 确认 → 执行；高危操作可配置人工审批
- **内置 Web UI**：状态 / 历史 / 日志 / 设置视图，支持提交、分支、stash、pull/push、硬重置等操作
- **审计日志**：所有工具调用记录落库，可回溯
- **备份**：高危操作前自动备份分支引用与 stash 快照

## 发布说明（维护者）

版本号维护在 `packages/mcp-server/package.json`，发布由仓库根目录 `.github/workflows/release-mcp-server.yml` 负责：

- **判据**：远程不存在 `mcp-server-v{version}` tag 才发布
- **流程**：构建 web → 构建 mcp-server（`prepublishOnly` 自动把 web/dist 内嵌进 `dist/web`）→ `pnpm publish` → 成功后才推送 tag `mcp-server-v{version}`
- **依赖**：mcp-server 依赖 `@shaohui_jin/git-cockpit-core`（`workspace:^`，发布时转为 `^0.1.0`），workflow 会先确保 core 已发布（缺失则顺带发布）
- **触发**：push 到 `master`/`main`，或 GitHub Actions 手动 `workflow_dispatch`
- **需要仓库 Secret**：`NPM_TOKEN`（npm Automation token）

完整发布手册（含 tag 协议、版本管理、本地发布注意事项）见仓库内 [docs/release.md](../../docs/release.md)。

## License

MIT