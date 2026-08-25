# npm 发布手册

Git Cockpit 通过 GitHub Actions 把 **core** 与 **mcp-server** 两个包发布到 npm。本文是完整的发布说明，包括包结构、tag 协议、发布流程与常见问题。

## 1. 发布哪些包

| 包 | npm 名称 | 版本维护位置 | 发布 tag |
| --- | --- | --- | --- |
| core | `@shaohui_jin/git-cockpit-core` | `packages/core/package.json` | `core-v{version}` |
| mcp-server | `@shaohui_jin/git-cockpit-mcp-server` | `packages/mcp-server/package.json` | `mcp-server-v{version}` |

web 前端**不单独发布**：mcp-server 的 `prepublishOnly` 会把 `web/dist` 复制进 `dist/web`，随包一起发布；`webServer.ts` 的 `resolveWebDist` 会在发布布局 `dist/web` 下命中，无需额外安装静态资源。

core 是 mcp-server 的**运行时依赖**（非构建期 bundle）：mcp-server 以 `workspace:^` 引用核心包，发布时自动转为 `^0.1.0`（semver 兼容范围）。

> 为什么 core 也要发布？core 包的定位是未来 git-insight 等下游项目**底层重构复用的基础包**。发布到 npm 后任何项目（包括其他仓库的基础设施）都能直接依赖，不再受 workspace 私有包限制。

## 2. Tag 协议与判据

Tag 格式统一为 `<模块短名>-v<版本号>`，例如 `core-v0.1.0`、`mcp-server-v0.1.0`。模块短名前缀避免了多个包同版本号时 tag 冲突，也与 git-insight 现有的 `mcp-server-vX` 约定一致。

**发布判据**：workflow 的 `gate` 步骤检查远程是否已存在对应 tag：

```bash
if git ls-remote --exit-code --tags origin "refs/tags/{TAG}" >/dev/null 2>&1; then
  echo "should_release=false"   # 已发布过，跳过
else
  echo "should_release=true"    # 尚未发布，开始构建
fi
```

关键设计：**tag 在发布成功之后才推送**，代表「已发布」而非「试过了」。任何一步失败（构建、权限、网络）都不会留下 tag，重跑即重试，不浪费版本号。

## 3. 前置条件

- GitHub 仓库存在（任意可见性）；发布的是 scoped public 包，package 的 `publishConfig.access` 已设为 `public`
- 仓库配置 Secret：**`NPM_TOKEN`**（npm Automation token，可在 npm 账户 → Access Tokens 创建）
- CI 环境：`pnpm/action-setup@v4`（锁 10.13.1）+ `actions/setup-node@v4`（Node 22，`registry-url: https://registry.npmjs.org`）
- 本地开发/验证：Node >= 22.5（core 使用 `node:sqlite`）、pnpm >= 10

## 4. 发布流程

### 日常发版（推荐）

1. 改对应包的版本号：`packages/core/package.json` 或 `packages/mcp-server/package.json` 的 `version`
   ```bash
   pnpm --filter @shaohui_jin/git-cockpit-core version patch   # 0.1.0 -> 0.1.1
   ```
2. 提交并 push（推送到 `master` 或 `main`），自动触发对应 workflow
3. 到 GitHub Actions 观察：gate 判定「尚未发布」→ 构建 → `pnpm publish` → 推送 tag

### 手动触发

GitHub Actions 页 → 对应 workflow → **Run workflow**（`workflow_dispatch`），无需改动任何文件。

### 各 workflow 行为

**`release-core.yml`**（tag 判据 `core-vX`）：

1. gate：`core-vX` 远程是否存在，存在则整体跳过
2. pnpm install（`--frozen-lockfile`）
3. `pnpm publish`（package 目录内执行；`prepublishOnly` 会自动 typecheck + build，build 内含 tsup 与 postbuild.mjs 对 `node:sqlite` 的修复）
4. 打 `core-vX` 并推送

**`release-mcp-server.yml`**（tag 判据 `mcp-server-vX`，多两步保障）：

1. gate：`mcp-server-vX` 远程是否存在
2. **确保 core 已发布**：检查 `core-vX`；若不存在则先构建并发布 core、推送 `core-v` tag（保证 mcp-server 发布后 npm 上的依赖可解析）
3. 构建 web 前端
4. typecheck + build mcp-server
5. `pnpm publish`（`prepublishOnly` 自动 typecheck + build + 复制 `dist/web`）
6. 打 `mcp-server-vX` 并推送

## 5. 版本管理要点

- core 与 mcp-server **版本号各自独立**。改动互不影响，按需单独发版
- mcp-server 对 core 的依赖声明为 `workspace:^`：发布时自动转换为 `^0.1.0`。core 升 `0.2.0` 等 **minor 版本时不会**被 `^0.1.0` 自动带上（0.x caret 只锁定在 0.1.x 内），需要同步在 mcp-server 中体现时另行升级其依赖范围
- 两个包发版无先后约束：先发 mcp-server 也可以，其 workflow 会自动先把 core 补发掉

## 6. 失败重试与回滚

- **任意步骤失败**：不会推送 tag → 修复后重新 push（或手动重跑 workflow）即可原样重试，不占用新版本号
- **发布成功但 tag 未推送成功**（网络抖动）：此时 npm 上已有该版本。手动 `git tag -a mcp-server-vX -m ... && git push origin mcp-server-vX`，或直接重跑 workflow（gate 发现没有 tag 会再次 `pnpm publish`，npm 对相同版本会提示已存在——此时手动补 tag 即可）
- **发布打错了想废弃**：npm 允许 unpublish（72 小时内且无下游依赖时），同时删除对应 tag。不建议覆盖同名版本

## 7. 本地发布与验证（可选）

CI 是发布主力，本地主要用于**验证**。注意两点：

```bash
# 1. 你的机器 registry 可能指向 npmmirror 镜像，发布前确认：
#    发布必须推送到官方源；CI 已通过 registry-url 强制官方源，本地请手检
npm config get registry

# 2. 工作区有未提交改动时 pnpm publish 会报 git-checks 错误，
#    发布不要用 --no-git-checks 绕过；验证打包内容时才用它
pnpm --filter @shaohui_jin/git-cockpit-core publish --dry-run --no-git-checks
pnpm --filter @shaohui_jin/git-cockpit-mcp-server publish --dry-run --no-git-checks
```

dry-run 会打印 tarball 文件清单，重点核对：

- core：4 个文件（`dist/*` + `package.json`），无多余内容
- mcp-server：`dist/*` + `dist/web/*`（index.html 与 assets 齐全），`package.json` 中 `@shaohui_jin/git-cockpit-core` 为 `^0.x.y`（`workspace:^` 已转换）

## 8. 常见问题（FAQ）

- **为什么用 `pnpm publish` 而不是 `npm publish`？** 只有 pnpm 会把 `workspace:` 协议依赖改写为真实版本号；`npm publish` 会把 `workspace:^` 原样打进包，导致安装方无法解析
- **构建产物里 `node:sqlite` 前缀**？core 的 postbuild 会在打包后把 `from "sqlite"` 修正为 `from "node:sqlite"`（esbuild external 行为剥离 node: 前缀），所以包内代码可直接运行
- **Node 版本要求**：core/mcp-server 的 `engines` 均为 `>=22.5.0`。低版本 Node 安装后运行会直接报错
- **本地静态服务找不到页面**？确认是按发布布局校验：源码布局 `../../web/dist`、发布布局 `dist/web`，`resolveWebDist` 会按优先级自动命中
- **发布后 npm 上没有 README**？packages 各自带 `README.md`，npm 打包自动包含，无需在 `files` 中声明

## 9. 相关文件

- `.github/workflows/release-core.yml` / `release-mcp-server.yml`：发布自动化
- `packages/mcp-server/scripts/copy-web.mjs`：web 产物内嵌脚本（`prepublishOnly` 调用）
- `packages/core/package.json` / `packages/mcp-server/package.json`：版本与发布配置