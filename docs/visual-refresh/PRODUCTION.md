# PRODUCTION.md — 生产落地执行记录与契约冻结

本文件是 Git Cockpit Web UI 视觉改版（teal 终选）生产落地过程的执行清单。视觉规范以本目录原型（tokens.css / chrome.css / 8 页 HTML）为准。

## 一、e2e 选择器契约（视为 API，落地中不得破坏）

改动 DOM 前先查本表；若必须调整，同步改 e2e 后再改生产代码，并在此登记。

| 契约 | 位置 | 依赖内容 | 规则 |
|---|---|---|---|
| 连接状态文案 | `packages/e2e/helpers/ui.ts:5` | `getByText('后端已连接')` 需整串在同元素 | tag 重构时「后端已连接」四字不可拆分，版本号移入子元素 |
| 选边按钮 | `helpers/ui.ts:88-90` | `getByRole('button',{name:'≫'})` + `getByTitle('已采用线上')` | 字符图标化后按钮补 `aria-label="采用线上"`，helper 改按 aria-label 定位；title 保留为状态钩子 |
| 确认弹窗外壳 | `helpers/ui.ts:23-31` | `.el-overlay:visible .el-dialog` + 「dry-run 预览」标题 + `pre` | ConfirmDialog 外壳不动，只重写内部 |
| chip tabs | `helpers/ui.ts:46` | `.gc-chip-tabs button` | 类名不得重命名 |
| 分支河 | `helpers/ui.ts:50` | `.river` | MergeView 保留类名 |
| 开关 | `helpers/ui.ts:67-72` | `.fetch .el-switch` / `.field-switch .el-switch` + `is-checked` | 保留 `.el-switch` 元素，只换 `--el-switch-on/off-color` |
| 表单字段 | `helpers/ui.ts:76-83` | `.field`、`.el-select__wrapper`、`treeitem` role | 不换 Element 内部结构 |
| dock 按钮 | `e2e/tests/clone.spec.ts:24` | `.dock-btn` | dock 重建保留类名与中文文案 |
| 任务行 | `e2e/tests/clone.spec.ts:26` | `.job-row` | JobsView 改造保留类名 |
| 矩阵格子 | `e2e/tests/matrix.spec.ts:34-42` | `button.cell.is-conflicts` / `.is-stage-local` + 格子内中文「本地临时枝」 | 格子图标化后中文以 chip 文案或 sr-only 保留 |
| 应用元信息 | `e2e/tests/merge-pair.spec.ts:29` | `.apply-meta` | 保留类名 |
| 仓库卡 | `e2e/tests/overview.spec.ts:10` | `.repo-card` | 保留类名 |

## 二、构建与验证约定

- 本机安全策略会拦截 vite 清空 `dist/assets`（>50 文件批量删除）：一律用 `pnpm --filter @shaohui_jin/git-cockpit-web build:keep`（= `vite build --emptyOutDir false`）。
- e2e 复用已构建产物：`E2E_SKIP_BUILD=1 pnpm test:e2e`；跑全量前先 build:keep。
- 每阶段门禁：stylelint + `pnpm typecheck` + build:keep + e2e。
- 目视验收方式：与 `docs/visual-refresh/` 原型逐页对比（重点：status 分支树/选中行，merge 冲突 OURS/THEIRS 与矩阵格，dashboard 热力阶）。

## 三、落地进度

- [x] 阶段 0：基线固化（本文档 + 数字订正 + build:keep）
- [x] 阶段 1：1A 重命名 → 1B 令牌注入 → 1C EP 桥接 → 1D 品牌 chrome → 1E 干跑三件套
- [ ] 阶段 2：2A 低风险页 → 2B 中风险页 → 2C 状态页 → 2D 合并页 → 2E/2F 选边语义+冲突面板
- [ ] 阶段 3：3A 图谱 → 3B/3D d2h 映射+hunk 头 → 3C !important 收敛（≤30）→ 3E/3F 收口

## 五、阶段 1 执行记录（2026-10-21）

**已完成**：1A 重命名（147+63 处，零视觉变化）→ 1B 令牌注入（:root 全套 teal 语义令牌 + 派生业务令牌改引语义色）→ 1C 桥接（html.dark 内 `--el-color-primary/success/danger/warning/info` 全族接 gc 令牌）→ 1D chrome（utils/icons.ts 47 键 + GcIcon.vue 全局组件；App.vue：⌘-loop SVG 符号、顶栏 44px、conn-tag 三态、2px pulsebar + pulse-count、dock 重建为 44px 实底通栏、chat-ball/panel 上新色）→ 1E（ConfirmDialog 琥珀顶缘+呼吸左边框+文件chips+图标标签、ConfirmBar 干跑紧凑变体、ToolCallCard 状态 chip）。

**门禁结果**：stylelint ✓ / vue-tsc typecheck ✓ / build:keep ✓ / e2e **5/5 ✓**（1.2m）。

**修过的问题**：
1. GcIcon 未传 size 时 span 无默认尺寸，SVG 按浏览器默认替换元素尺寸展开成巨型图形，拦截页面点击（e2e matrix 失败暴露）→ 组件默认 16px 修复。
2. e2e 三处**既有**测试漂移（非改版引入，经归因确认后顺手修复，仅动测试文件）：`clone.spec` 的 `.job-row` 幽灵类名（生产实为 `aside.list .row`）→ 已修；`merge-pair/matrix` 的 `getByText('存在冲突')` strict mode 双元素 → 改精确 `.stamp` 定位；`merge-pair` 的 `.apply-meta` 断言与现行标记不符 → 改断 `.next-pane .sha` 含 `merge/`。
3. ConfirmDialog 契约漂移：生产标题本为「执行操作：{tool}」，e2e 契约文案「将执行的命令（dry-run 预览，未实际执行）」早已不在 UI 中 → 1E 重写时恢复该文案，open-commit 契约随之通过。

**注意**：e2e 全量跑用 `E2E_SKIP_BUILD=1`（复用 build:keep 产物）；run.mjs 默认 build 会再触发放量删除护栏。工作区仍是用户 3 个 WIP 未提交状态，本次改动未代为提交。

## 四、已确认决策

- 签名主色 = teal 仪表冷青（2026-10-21）；极地白留档不启用
- 12px/28px 密度、深蓝黑三分层表面延续；玻璃仅工作台（状态展示区）
- diff2html 债务：207 行 / 72 处 `!important`，收敛目标 ≤30
