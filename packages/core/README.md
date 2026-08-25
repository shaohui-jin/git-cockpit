# @shaohui_jin/git-cockpit-core

Git Cockpit 的共享核心逻辑，作为**独立 npm 包**发布，供 MCP Server 及未来基于它重构的下游项目（如 git-insight）直接复用。

涵盖 Git 仓库操作的封装、安全权限决策、备份、审计日志与本地存储，所有模块均依赖 Node 22+ 原生 `node:sqlite`，无外部数据库依赖。

## 环境要求

- Node.js **>= 22.5.0**（使用 `node:sqlite` 原生模块）

## 安装

```bash
pnpm add @shaohui_jin/git-cockpit-core
# 或
npm install @shaohui_jin/git-cockpit-core
```

包为纯 ESM（`"type": "module"`），提供 `dist/index.d.ts` 类型声明。

## 核心能力

| 模块 | 说明 |
| --- | --- |
| `GitService` | 基于 simple-git 的 Git 操作封装：串行执行队列、`.git/index.lock` 写前检查、数组参数防注入、高/中/低风险分级与 `dry-run` 写预览 |
| `PermissionManager` | 工具级风险等级（readonly / write / dangerous）与审批规则决策 |
| `BackupManager` | 高危操作前的备份与恢复 |
| `AuditLogger` | 操作审计日志落库 |
| `RepoStore` | 已打开仓库列表管理 |
| `openDatabase` | 统一的 `node:sqlite` 数据库入口（数据目录由你传入） |

## 快速使用

```ts
import { GitService, PermissionManager, BackupManager, AuditLogger } from '@shaohui_jin/git-cockpit-core';

// 打开仓库（校验路径合法且是 Git 仓库），返回真实仓库根目录
const git = await GitService.open('/path/to/repo');

const status = await git.getStatus();             // RepoStatus 工作区状态
const preview = await git.commit('feat: x', { dryRun: true }); // 提交预览
console.log(preview.command, preview.affectedFiles);

// 权限决策
const pm = new PermissionManager({ permissions: { requireApprovalFor: ['git.reset.hard'] } });
const decision = pm.evaluate('git.reset.hard'); // { allowed: false, requiredApproval: true, ... }

// 高危操作前创建备份（保存分支引用与 stash 快照）
const backup = new BackupManager(git);
const result = await backup.createBackup();
```

## 发布说明（维护者）

版本号维护在 `packages/core/package.json`，发布由仓库根目录 `.github/workflows/release-core.yml` 负责：

- 判据：远程不存在 `core-v{version}` tag 才发布
- 流程：构建 → `pnpm publish` → 成功后才推送 tag `core-v{version}`
- 触发：push 到 `master`/`main`，或 GitHub Actions 手动 `workflow_dispatch`
- 需要仓库 Secret：`NPM_TOKEN`（npm Automation token）

详见仓库内 [docs/release.md](../../docs/release.md)。

## License

MIT