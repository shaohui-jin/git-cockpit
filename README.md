# Git Cockpit

基于 MCP（Model Context Protocol）的 Git 可视化操作工具：Web 端界面 + AI 调用能力，支持多仓库管理、安全的 Git 操作、与 Cursor/VS Code 集成。

> 完整设计见 [设计文档.md](docs/设计文档.md)。

## Monorepo 结构

```
packages/
├── core/        # 共享核心逻辑：GitService、权限、备份、日志（简单）
├── mcp-server/  # MCP Server + Fastify Web 服务 + CLI（发布包）
└── web/         # Vue 3 前端（构建产物由 web 服务托管）
```

## 快速开始（开发）

```bash
pnpm install
pnpm build
node packages/mcp-server/dist/cli-entry.js start   # 本地构建产物直接启动
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

### 端点一览

| 端点 | 说明 |
| --- | --- |
| `/mcp` | MCP Streamable HTTP 接入点（常驻服务模式） |
| `/api/*` | Web 前端 REST API（仓库、状态、设置、日志） |
| `/` | Web 管理界面（仓库管理、状态/历史/日志/设置） |

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

## 开发阶段

- 阶段 1：基础架构与只读功能（当前）
- 阶段 2：写操作与安全机制
- 阶段 3：高级功能与扩展
- 阶段 4：发布与部署