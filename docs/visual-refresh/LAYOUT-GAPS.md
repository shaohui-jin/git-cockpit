# 布局级改造量化清单（LAYOUT-GAPS）

> 2026-10-22 梳理。三阶段生产落地（令牌/chrome/语义化/d2h）完成后，剩余「布局按设计稿重建」的完整盘点。
> 判据基线：信息密度优先（驾驶舱工具），e2e 契约冻结类名，布局重建须完整迁移交互。
> 阅读顺序：先看「结论」与「执行顺序」，逐页明细含工时与风险。

## 一、结论

- **8 个页面中：4 页大差异**（对话记录 / 工作台 / 任务 / 合并）、**2 页中差异**（状态 / 设置）、**2 页小差异**（日志 / 矩阵内嵌）
- **总工时估算：11–13.5 小时**（含每页门禁与目视）
- **e2e 暴露面：2 页高**（工作台 overview.spec、合并 matrix/merge-pair.spec）、**2 页中**（任务 clone.spec、状态 open-commit.spec）、**4 页零/低**
- 对话记录页 e2e 零覆盖 → **天然试点页**

## 执行状态（2026-10-22 晚更新）

- [x] **P0 对话记录**：双栏重建完成（288px 会话列表 + 内嵌详情；新增搜索框、复制全部；dialog 改内嵌）。e2e 零覆盖，无契约风险。
- [x] **P1 日志**：工具栏加搜索框（工具/仓库/参数/结果全字段过滤），行结构不变。
- [x] **P1 设置**：set-card 框架落地（page-head + card-head/set-body/card-foot + frow/fctrl 表单行），保留 tab 信息架构与全部交互；删除死规则 `.kv`。
- [x] **P2 工作台**：page-head + 常驻打开栏（原两处 open-row 合一）+ **attention 三联智能横幅**（真实数据推导：冲突/进行中操作→红、脏工作区→琥珀、落后→青，各取最严重一仓，可点击跳转）+ 空态简化 + 卡片加仓库图标与 SVG 更多按钮。
- [x] **P2 任务**：左右分栏 → **分组卡片流**（进行中/失败/成功三组 job-group，job 卡含类型图标/主副标题/双段进度条/状态 chip/实时耗时/日志尾行）；**日志 pane 迁入右侧抽屉**（点卡滑出，原能力全保留：取消/修改重试/安装/自动滚动）；clone.spec 行定位随布局更新（`aside.list .row` → `.job`）。
- [ ] **P3 合并 / 状态**（深水区，未开始）：合并表单 sec-block 卡片化 + 结果区 file-row 加 stat/conflict 列；状态页 toolbar 化 + 分支树分组。
- **附带收官**：glass 零残留——`gc-glass` 类/规则/令牌、ReposView 本地 `.glass`、StatusView 本地 `.glass` 与 6 处类名、`--gc-r-glass` 令牌全部清除，表面统一走 `gc-card`。
- **门禁**：stylelint / vue-tsc / build / **e2e 5/5**（P0-P2 改后复跑确认；中途 2 个 merge spec 在落盘阶段的环境抖动重跑即过，非回归）。

## 二、逐页量化对照

### 1. 对话记录 ConversationsView —— 大差异 · 风险零 · 1.5h ★试点

| 维度 | 设计稿                                                                                                                | 生产现状                                                      |
| ---- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| 布局 | 双栏：288px 会话列表（conv-list：conv-list-top + conv-search + conv-items/conv-item[ct/when/cmeta]）+ 右侧详情 flex:1 | 单表（5 列 grid：标题/仓库/时间/条数/操作）+ 底部 dialog 详情 |
| 形态 | 行 = 标题 + 摘要元信息 + 时间；选中态 is-active 左指示                                                                | 表格行 + 行内文字按钮（查看/继续/删除）                       |

- 需重写：整个模板（table → conv-list/conv-item 双栏）
- 交互迁移：仓库筛选、刷新、行点击查看（dialog → 内嵌详情）、继续对话、删除确认、空态
- e2e：**零覆盖**（已核查 5 spec 均不触碰）
- 数据层：无需改动（rows/detail/repoFilter 全部复用）

### 2. 工作台 ReposView —— 大差异 · 风险高 · 2–3h

| 维度     | 设计稿                                                                                | 生产现状                                |
| -------- | ------------------------------------------------------------------------------------- | --------------------------------------- |
| 头部     | page-head（标题+副题）+ pulse-count                                                   | page-title h2 + bar（weather 四联 tab） |
| 智能横幅 | **attention 横幅**（att-item ×3：red/amber/accent 三色提醒 + att-copy）——原型标志组件 | 无此组件                                |
| 主体     | repo-grid 卡片（repo-top/repo-name + 卡内 wx 天气胶囊 + stats）                       | mosaic-block 卡片 + 顶部四联天气 tab    |

- 需重写：头部 + 新增 attention 横幅组件（需定义数据源：哪些仓值得提醒——如卡住/脏/同步失败，可从 weather 统计推导）+ 卡片字段重排
- 交互迁移：卡片拖拽排序、更多菜单、双击进入、克隆入口、天气筛选（tab → 卡内胶囊后筛选入口要重新安置）
- e2e：**高**（overview.spec 锁 `.repo-card`、天气按钮文案「有更改」、heading 工作台）
- 注意：attention 横幅是净新增功能组件，不只是布局

### 3. 任务 JobsView —— 大差异 · 风险中 · 2h

| 维度 | 设计稿                                                                                                         | 生产现状                                               |
| ---- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| 布局 | 分组卡片流：job-group（card-head + cnt）+ job 卡（job-top/job-ico/job-main/job-title/job-sub/job-prog 进度条） | 左右分栏：aside 列表（chips + rows）+ 右栏日志 pre     |
| 日志 | 原型无日志 pane                                                                                                | 生产有完整日志 pane（v-loading + pre + 取消/重试按钮） |

- 需重写：split → job-group 卡片流；卡内嵌 4px 双段进度条（2B 已做好组件，搬迁即用）
- 交互迁移：筛选 chips、行选中、日志 pane 须重新安置（建议点卡片展开抽屉或右侧弹出，不能直接砍）、取消/重试/安装按钮、自动滚动
- e2e：中（clone.spec 锁 `aside.list .row`）
- 判定难点：**生产分栏信息密度高于原型卡片流**；若按稿改需为日志 pane 找新家，否则功能回归

### 4. 合并 MergeView（含矩阵） —— 中大差异 · 风险高 · 2h

| 维度   | 设计稿                                                               | 生产现状                                                           |
| ------ | -------------------------------------------------------------------- | ------------------------------------------------------------------ |
| 表单   | sec-block 卡片化（card-head/sec-body/sel-row/select-wrap/sel-arrow） | 平铺 filter-bar 字段                                               |
| 结果区 | result-chip + file-list（file-row/stat/conflict/fp/num 列）          | next-pane + ConflictResolvePanel（file-list + 三栏 merge）         |
| 矩阵   | 原型含矩阵 grid + legend                                             | 生产矩阵为增强页（filter-card + summary + legend + grid + detail） |

- 需重写：表单区卡片化包装（sel-row 结构）；结果区 file-row 加 stat/conflict 列
- 交互迁移： BranchTreeSelect、fetch 开关、预演按钮、落盘流程（dialog 契约 `将执行的命令` 须保留）、矩阵全套（2B 已对齐的 legend/cell 不动）
- e2e：**高**（matrix/merge-pair 深度锁 `.field`/`.el-select__wrapper`/`.stamp`/`.river`/`.merge-row`/`.gc-chip-tabs`）

### 5. 状态 StatusView —— 中差异 · 风险中 · 1.5–2h

| 维度   | 设计稿                                                                     | 生产现状                                                                  |
| ------ | -------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| 头部   | toolbar（分支选择 + **dirty-pill** + workbench 按钮）                      | head-branch（branch-tag）                                                 |
| 分支树 | panel-top + search-box + tree-group 分组 + tree-row（is-current/nm/ahead） | branch-panel + tree（2C 已语义化）                                        |
| 右栏   | 三卡（graph/changes/monitor）                                              | graph-pane + changes-card + monitor-card + history-card（4 卡，多记录卡） |

- 需重写：头部 toolbar 化（dirty-pill 为净新增小组件，可用 changes 统计推导）+ 树分组（tree-group）
- 交互迁移：分支树全部（搜索/分组/选中/远程优先）、暂存/提交/dry-run 流程（e2e 锁）、差异监视器、记录卡
- e2e：中（open-commit 锁暂存/提交按钮与弹窗，不依赖布局）

### 6. 设置 SettingsView —— 中差异 · 风险低 · 1.5h

| 维度 | 设计稿                                                                                            | 生产现状                                       |
| ---- | ------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| 布局 | settings-col 单列 + set-card 网格（card-head/set-body/frow/fc/fctrl/input/secret/fhint/test-tag） | 分节 + opt 卡片网格 + git-split（侧栏 + 主栏） |

- 需重写：set-card 卡片框架统一（card-head/set-body）、字段行 frow/fctrl 形态、密钥 input[type=secret] + fhint
- 交互迁移：全部开关（.el-switch 类名保留即可）、保存/测试按钮、Git 身份侧栏
- e2e：低（turnOffFetch 锁 `.field-switch`/`.fetch`/`.el-switch`，均可保留）

### 7. 日志 LogsView —— 小差异 · 风险零 · 0.5–1h

| 维度   | 设计稿                             | 生产现状                       |
| ------ | ---------------------------------- | ------------------------------ |
| 工具栏 | log-toolbar + log-search（搜索框） | bar（下拉筛选 + limit + 刷新） |
| 行     | table-wrap/trow                    | table/th/tr（2A 已对齐）       |

- 需重写：工具栏加搜索框（生产是工具名下拉筛选——两者信息架构不同，建议保留下拉 + 增搜索框）
- e2e：零

### 8. 矩阵（MergeView 内嵌） —— 小差异 · 风险高（随合并页） · 0.5h

- 2B 已完成：legend、cell 图标化、语义色
- 剩余：筛选区随 MergeView 表单卡片化一并处理；detail aside 形态对齐 sec-body

## 三、执行顺序建议

| 批次        | 页面         | 理由                                                                                 |
| ----------- | ------------ | ------------------------------------------------------------------------------------ |
| **P0 试点** | 对话记录     | 零 e2e 风险、差异最大、能完整验证「按稿改布局」流程；验收后定后续节奏                |
| P1 低风险   | 日志、设置   | e2e 零/低覆盖，形态差异小，适合连续推进建立信心                                      |
| P2 高价值   | 工作台、任务 | 用户每天看得最多的两页；attention 横幅为净新增功能；任务页需先解决日志 pane 安置设计 |
| P3 深水区   | 合并、状态   | e2e 锁最深、交互最重；合并页与 2F 冲突面板联动，状态页与 dry-run 流程联动            |

## 四、通用约束（每页必查）

1. e2e 冻结契约：`.repo-card`/`.dock-btn`/`.river`/`.stamp`/`.field`/`.el-select__wrapper`/`.el-switch`/`.gc-chip-tabs`/`.merge-row`/`.apply-meta`/`.next-pane .sha`/`aside.list .row`——布局改造不得改这些类名与可达性（role/aria-label）
2. 交互零丢失：拖拽、滚动、键盘、加载态、空态、错误态逐项迁移
3. 每页门禁：stylelint + typecheck + build + e2e 全量
4. 目视验收标准对齐 `docs/visual-refresh/` 对应原型页
