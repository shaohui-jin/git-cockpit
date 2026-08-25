# Git Cockpit

基于 MCP（Model Context Protocol）的 Git 可视化操作工具：Web 端界面 + AI 调用能力，支持多仓库管理、安全的 Git 操作、与 Cursor/VS Code 集成。

> 完整设计见 [设计文档.md](./设计文档.md)。

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
node packages/mcp-server/dist/cli.js start --open
```

CLI（等价 `git cockpit ...`）：

```bash
git-cockpit start   # 启动常驻服务：含 MCP Server（Streamable HTTP）与 Web 前端（默认 3000 端口）
git-cockpit mcp     # 以 stdio 方式运行 MCP Server（供 Claude Desktop / Cursor 直接连接）
```

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