# 设置页设计规范 · Git Cockpit（Phase 2）

> 设计系统专家：彩格调（Cai）· Phase 2 产出
> 上游：requirements-settings.md（Phase 1 需求摘要）｜下游：筑原型（HTML 设计稿）
> 设计体系：assets/tokens.css + assets/chrome.css（--gc-* 令牌），不引入第二套设计语言

## 0. 总则

- 唯一设计语言：--gc-* 令牌 + chrome.css 原子件。本规范所有数值均为现有令牌或由现有令牌推导的复合值。
- 信息密度优先；禁渐变、禁 emoji；圆角 ≤ var(--gc-r)（6px），信号件圆角 var(--gc-r-tag)（4px）；发光仅信号件，loading 用旋转环不发光。
- 双主色兼容：teal（默认）与极地白（html[data-accent='white']）下均不得破损；凡使用 accent 边框的位置必须补白主题覆盖（见 6.6）。
- mono 用途：host / Token / 路径 / 字段 id / 工具芯片名 / 远程 URL / 版本号 chip。
- 图标一律用 assets/icons.js 现有图标（remote/key/cpu/list/shield/copy/eye/refresh/check/info/alert/external/plus/minus/close/terminal/file），不新增图标。

## 1. 页面骨架与 tab 自适应宽度

### 1.1 结构

```
main.page（chrome.css：flex:1、overflow:auto、padding: var(--gc-s3)、gap: var(--gc-s3)）
└─ .settings-col                 ← 唯一容器，JS 按 tab 切换 .wide
   ├─ .page-head                 ← h1 设置 + sub 本机保存，不上传 + 右侧 chip mono「服务 {版本号}」
   ├─ .set-alert（仅 settings.error 存在时，见 1.5）
   ├─ .gc-chip-tabs              ← 四 tab
   └─ .tab-pane.on               ← 当前 tab 内容
```

### 1.2 容器宽度（tab 级自适应）

```css
.settings-col { width:100%; max-width:880px; margin:0 auto; display:flex; flex-direction:column; gap: var(--gc-s3); padding-bottom: var(--gc-s4); }
.settings-col.wide { max-width:1200px; }
```

- 单栏 tab：MR 配置、模型 → 容器 880px 居中（不加 .wide）。
- 双 pane tab：正文规范、Git 操作 → 容器 1200px（加 .wide）。
- tab 切换时 JS 增删 .wide；max-width 不加 transition（工具感，瞬切）。
- 页头与 tab 栏同在 .settings-col 内，随容器一起对齐、一起换宽；三者左右边界始终一致。

### 1.3 tab 栏

```css
.gc-chip-tabs { display:flex; flex-wrap:wrap; gap: var(--gc-s2); flex:none; }
.gc-chip-tabs button { height: var(--gc-control); padding: 0 var(--gc-s3); border-radius: var(--gc-r); border:1px solid var(--gc-line); background: var(--gc-overlay); color: var(--gc-text-2); font-size: var(--gc-fs-body); font-weight:500; line-height:1; white-space:nowrap; cursor:pointer; transition: background var(--gc-t-micro) var(--gc-ease), border-color var(--gc-t-micro) var(--gc-ease), color var(--gc-t-micro) var(--gc-ease); }
.gc-chip-tabs button:hover { background: var(--gc-btn-hover); color: var(--gc-text); border-color: var(--gc-line-strong); }
.gc-chip-tabs button.on { background: var(--gc-accent-weak); border-color: rgba(20,200,184,.28); color: var(--gc-accent-text); font-weight:600; }
```

- 顺序固定：MR 配置（默认 .on）/ 正文规范 / 模型 / Git 操作。
- .on 取值逐字复刻 chrome.css 的 .chip.accent（accent-weak 底 + 28% accent 边 + accent-text 字），不造新值。
- 切回 MR 配置 tab：MR pane 整体盖 .pane-loading 遮罩（见 6.4），spinner + 「校验中…」，600ms 后消失（原型演示用）。

### 1.4 tab pane

```css
.tab-pane { display:none; }
.tab-pane.on { display:flex; flex-direction:column; gap: var(--gc-s3); min-width:0; }
```

### 1.5 全局错误 alert

```css
.set-alert { display:flex; align-items:flex-start; gap: var(--gc-s2); padding: var(--gc-s2) var(--gc-s3); border:1px solid rgba(255,133,133,.35); background: var(--gc-red-weak); border-radius: var(--gc-r); color: var(--gc-red); font-size: var(--gc-fs-meta); line-height: var(--gc-lh-body); }
.set-alert .ico { flex:none; margin-top:1px; }   /* data-icon="alert" */
```

取值复刻 chrome.css .chip.red 的边框/弱底/文字三件套；不可关闭、无关闭按钮。

## 2. set-card 框架规格

```css
.set-card { position:relative; display:flex; flex-direction:column; min-width:0; background: var(--gc-card); border:1px solid var(--gc-line); border-radius: var(--gc-r); overflow:hidden; }
.set-card > .card-head { height:36px; padding: 0 var(--gc-s3); background: var(--gc-page); border-bottom:1px solid var(--gc-line); display:flex; align-items:center; gap: var(--gc-s2); flex:none; }
.set-card > .card-head .ico { color: var(--gc-text-3); }        /* .ico.sm 12px */
.set-card > .card-head h3 { font-size: var(--gc-fs-title); font-weight:600; color: var(--gc-text); line-height:1; }
.set-card > .card-head .spacer { flex:1; }
.set-body { padding: var(--gc-s3); display:flex; flex-direction:column; gap:10px; min-width:0; }
.card-foot { display:flex; align-items:center; gap: var(--gc-s2); padding: 9px var(--gc-s3); border-top:1px solid var(--gc-line); background: var(--gc-page); flex:none; }
.card-foot .spacer { flex:1; }
.card-foot .foot-note { display:inline-flex; align-items:center; gap:5px; font-size: var(--gc-fs-meta); color: var(--gc-text-3); line-height:1; }
.card-foot .foot-note .ico { width:11px; height:11px; color: var(--gc-green); }  /* 有保存态时 */
```

- card-head 高 36px 固定；右侧 chip 用 .chip.sm（中性）/ .chip.green.sm / .chip.amber.sm / .chip.accent.sm。
- set-body 内区块间距 10px（沿用旧稿 .set-body gap）。
- card-foot 左侧为状态文字位（.foot-note，如「任务执行本身不消耗模型额度」），右侧按钮右对齐（.spacer 推开）。

## 3. 分栏规格（痛点 1）

### 3.1 两套栅格

```css
/* 正文规范：结构 : 预览 = 5 : 7 */
.pane-split { display:grid; grid-template-columns: minmax(360px,5fr) minmax(360px,7fr); gap: var(--gc-s3); min-height:0; }
/* Git 操作：默认行为表单 : 工具墙 = 4 : 6 */
.git-ops-split { display:grid; grid-template-columns: minmax(320px,4fr) minmax(600px,6fr); gap: var(--gc-s3); align-items:start; }
```

- pane 最小宽：结构 ≥360px、预览 ≥360px、工具墙 ≥600px、默认行为表单 ≥320px（写进 minmax 第一参数，低于即降级）。
- 判定优先级：双 pane 完整可见且无横向滚动 > 分栏形态；否则退化，禁止双 pane 同时残缺。

### 3.2 可用宽度与两档验收视口验算

- 内容可用宽 = 视口宽 − 10px（滚动条）− 24px（.page padding s3×2）。
- 1280×800：可用 1246px → 容器被 1200 上限截断为 1200px。
- 1440×900：可用 1406px → 容器 1200px。
- 1200px 下分栏实测（gap 12px）：
  - 正文规范：结构 555px / 预览 633px（均 ≥360 ✓）。
  - Git 操作：表单 427px / 工具墙 761px（均 ≥320 / ≥600 ✓）。

### 3.3 分栏成立条件与降级规则

- 分栏成立条件：正文规范容器 ≥ 732px（视口 ≥ 756px）；Git 操作容器 ≥ 932px（视口 ≥ 956px）。取严者，统一断点 959px：

```css
@media (max-width: 959px) {
  .settings-col.wide { max-width: 880px; }              /* 退化即回单栏 */
  .pane-split, .git-ops-split { grid-template-columns: 1fr; }
  .spec-card .pane-split { height: auto; }
  .pane.preview { max-height: 320px; }                  /* 次要 pane 独立滚动 */
  .tool-wall-scroll { max-height: 420px; overflow-y: auto; }
}
```

- 退化形态（视口 ≤959px 时强制）：
  - 正文规范：结构 pane 完整展开（自然高度，随页滚动）；预览 pane 限高 320px、内部滚动（.pane-body 已 overflow-y:auto）。
  - Git 操作：默认行为卡完整（保存按钮在卡内 foot，随卡完整显示）；工具开关卡的工具墙限高 420px 内部滚动（首屏可见 ≥3 组：查看 / 分支 / 写入）。
- 1280×800 与 1440×900 两档视口均满足分栏成立条件，验收态为完整分栏，不触发降级。

### 3.4 正文规范外层卡与 pane 高度

```css
.spec-card { display:flex; flex-direction:column; min-height:0; }
.spec-card .set-body { flex:1; min-height:0; }
.spec-card .pane-split { height: 480px; }   /* 800/900 两档视口下 card 总高约 592px，首屏放得下 */
```

pane 通用规格：

```css
.pane { display:flex; flex-direction:column; min-width:0; background: var(--gc-card); border:1px solid var(--gc-line); border-radius: var(--gc-r); }
.pane-head { display:flex; align-items:center; gap: var(--gc-s2); height: var(--gc-row); padding: 0 var(--gc-s3); border-bottom:1px solid var(--gc-line-weak); flex:none; }
.pane-head b { font-size: var(--gc-fs-body); font-weight:600; color: var(--gc-text); line-height:1; }
.pane-head .spacer { flex:1; }
.pane-body { padding: var(--gc-s2); display:flex; flex-direction:column; gap: var(--gc-s2); min-height:0; overflow-y:auto; }
.pane-empty { padding: var(--gc-s4) var(--gc-s2); text-align:center; font-size: var(--gc-fs-meta); color: var(--gc-text-3); line-height:1.6; }
```

预览 pre 块：

```css
.preview-box { background: var(--gc-page); border:1px solid var(--gc-line-weak); border-radius: var(--gc-r); padding: var(--gc-s2); }
.preview-box pre { margin:0; font-family: var(--gc-font-mono); font-size:11px; line-height:1.7; color: var(--gc-text-2); white-space:pre-wrap; word-break:break-word; }
```

### 3.5 首屏一票否决项落点

- 正文规范：启用开关 / 单选组 / 导入·粘贴导入·保存规范·放弃修改·清除 按钮全部在 pane 之上的头部两行，任何视口首屏可见。
- Git 操作：保存/放弃在默认行为卡 foot，卡片自然高度约 407px（36 head + 24 body-pad + 40 swrow + 170 仓库行 + 100 密钥行 + 37 foot），卡顶距页顶约 74px，底部约 481px < 688px 首屏高度，通过。
- 工具墙 52 芯片 10 组在 761px 墙宽下总高约 610px ≤ 可用约 686px；若个别视口略超高，允许工具墙内部纵向滚动（仍 ≥3 组首屏可见），禁止横向滚动。

## 4. 表单标签分级（痛点 2）

### 4.1 判定规则（按卡片内字段构成决策，同卡内一致）

| 模式 | 判定 | 样式 |
|---|---|---|
| frow 紧凑 | 标签 ≤5 个汉字/英文词（模型名 / Base URL / API Key / Token） | 标签列定宽 88px、右对齐、与控件基线对齐 |
| 标签上置 | 大控件（≥3 行 textarea）或说明 ≥2 行的字段：允许打开的仓库 / 本机访问密钥 / 正文规范字段编辑卡 | 标签左对齐置于控件上方，与控件同宽起点，说明跟在控件下方 |
| swrow | 「标题 + 说明 + 右侧开关」行：dry-run 默认 | 见 4.3，吸收设计稿 swrow 形态，取代 140px frow+switch |

- 标签列占位不得超过控件列 1/3（紧凑模式 88px 即此约束的具体化；140px 旧值废止）。
- 全站不强制统一标签宽度，按卡片定；88px 为紧凑模式上限（满足 ≤96px 要求）。

### 4.2 frow 两种模式

```css
.frow { display:flex; align-items:flex-start; gap: var(--gc-s3); min-width:0; }
.frow > label { flex:none; width:88px; font-size: var(--gc-fs-body); color: var(--gc-text-2); line-height: var(--gc-control); text-align:right; }
.frow > .fc { flex:1; min-width:0; display:flex; flex-direction:column; gap:5px; }
.frow.stack { flex-direction:column; gap:5px; }
.frow.stack > label { width:auto; text-align:left; line-height: var(--gc-lh-body); }
.fctrl { display:flex; align-items:center; gap:6px; min-width:0; }
.fctrl .input, .fctrl .select-wrap { flex:1; min-width:0; }
.fhint { font-size: var(--gc-fs-meta); color: var(--gc-text-3); line-height:1.5; }
.fhint code { font-family: var(--gc-font-mono); font-size:10px; color: var(--gc-text-2); background: var(--gc-page); border:1px solid var(--gc-line-weak); border-radius:3px; padding:0 4px; }
```

- 紧凑模式适用：模型 tab 三行（模型名 / Base URL / API Key）、MR Token 表单（标签 Token，88px）。
- 上置模式适用：允许打开的仓库（6 行 textarea）、本机访问密钥（按钮 + 3 行说明）、正文规范字段编辑卡内各输入区。

### 4.3 swrow（标题 + 说明 + 右侧开关）

```css
.swrow { display:flex; align-items:center; gap: var(--gc-s3); padding:7px 0; border-bottom:1px solid var(--gc-line-weak); }
.swrow:last-child { border-bottom:0; padding-bottom:0; }
.swrow .sw-copy { flex:1; min-width:0; display:flex; flex-direction:column; gap:2px; }
.swrow .sw-copy b { font-size: var(--gc-fs-body); font-weight:500; color: var(--gc-text); line-height:1.35; }
.swrow .sw-copy span { font-size: var(--gc-fs-meta); color: var(--gc-text-3); line-height:1.45; }
.sw { flex:none; position:relative; width:32px; height:18px; border-radius:9px; background: var(--gc-sw-off); transition: background var(--gc-t-micro) var(--gc-ease); }
.sw::after { content:''; position:absolute; top:2px; left:2px; width:14px; height:14px; border-radius:50%; background: var(--gc-knob); transition: transform var(--gc-t-micro) var(--gc-ease), background var(--gc-t-micro) var(--gc-ease); }
.sw.on { background: var(--gc-accent); }
.sw.on::after { transform:translateX(14px); background: var(--gc-accent-ink); }
.sw.is-disabled { opacity:.42; cursor:not-allowed; }
```

- Git 操作「dry-run 默认」行用 swrow：b=「dry-run 默认」，span=「开启后写操作（MCP / CLI）默认只生成预览，不真正执行。」，右侧 .sw。
- 正文规范「启用规范」开关用 swrow 变体（标题 + 开关，说明可省），与单选组、状态 tag 同行排布（见 5.6）。

## 5. 组件规格

### 5.1 MR 方式三选卡

```css
.mr-card { display:block; width:100%; text-align:left; background: var(--gc-card); border:1px solid var(--gc-line); border-radius: var(--gc-r); padding: var(--gc-s2) var(--gc-s3); cursor:pointer; transition: background var(--gc-t-micro) var(--gc-ease), border-color var(--gc-t-micro) var(--gc-ease); }
.mr-card:hover { border-color: var(--gc-line-strong); background: var(--gc-btn-hover); }
.mr-card.on { background: var(--gc-accent-weak); border-color: var(--gc-accent); }
.mr-title { display:flex; align-items:center; gap: var(--gc-s2); min-width:0; }
.mr-title .ico { color: var(--gc-text-3); }         /* terminal / key / external */
.mr-title b { font-size: var(--gc-fs-body); font-weight:600; color: var(--gc-text); line-height:1; }
.mr-title .st { margin-left:auto; flex:none; font-size: var(--gc-fs-meta); font-weight:500; line-height:1; }
.st.ok { color: var(--gc-green); }                    /* 可用 */
.st.bad { color: var(--gc-red); }                     /* 未就绪 */
.mr-panel { margin-top: var(--gc-s2); padding-top: var(--gc-s2); border-top:1px solid var(--gc-line-weak); display:flex; flex-direction:column; gap: var(--gc-s2); }
```

- 整卡为 button 元素，原生支持 Enter 键盘；选中态 aria-pressed="true" + .on。
- 三卡：A（terminal 图标，标题随平台变化）/ B（key 图标，标题带 host）/ C（external 图标，始终可用，st 恒为 ok「可用」）。
- 卡片间距：MR tab 内三卡纵向排列，gap var(--gc-s3)（继承 .tab-pane.on 的 gap）。

### 5.2 CLI 三态行（卡片 A 展开面板）

```css
.cli-row { display:flex; align-items:center; gap: var(--gc-s2); min-width:0; }
.cli-row .name { flex:none; width:48px; font-family: var(--gc-font-mono); font-size: var(--gc-fs-body); color: var(--gc-text-2); }
.cli-st { font-size: var(--gc-fs-meta); line-height: var(--gc-lh-body); }
.cli-st.is-missing { color: var(--gc-text-3); }       /* 未下载 */
.cli-st.is-out { color: var(--gc-amber); }            /* 未登录 */
.cli-st.is-in { color: var(--gc-text-2); }            /* 已登录 */
.cli-st.is-ok { color: var(--gc-green); }             /* 已登录 + 校验 ok */
.cli-st.is-bad { color: var(--gc-red); }              /* 已登录 + 校验 bad */
```

- 「去下载」为 .tbtn + external 图标（见 5.7）；面板底部「重新检测」为 .btn.h24；成功提示「已重新检测本机 gh / glab」用 .fhint 且 color: var(--gc-green)。

### 5.3 Token 表单与校验三态（卡片 B）

- 结构：紧凑 frow（label「Token」88px 右对齐）> .fc > fctrl（密码 input flex + 「显示」.tbtn）+ 状态行 + fhint + 链接行 + 按钮行。
- 状态行三色 + 等待 + 空态：

```css
.vline { display:flex; align-items:center; gap:6px; font-size: var(--gc-fs-meta); line-height: var(--gc-lh-body); min-width:0; }
.vline.is-ok { color: var(--gc-green); }
.vline.is-bad { color: var(--gc-red); }
.vline.is-wait { color: var(--gc-amber); }             /* 校验中… */
.vline.is-idle { color: var(--gc-text-3); }
```

- 密码输入 type=password + 「显示」切换（eye 图标 .tbtn）；placeholder 三态按需求清单逐字。
- platform 未识别或校验中：input disabled（chrome.css .input:disabled）。
- 链接行：「打开 GitHub 创建 Token 页面」/「打开 GitLab 创建 Token 页面」为 .tbtn + external 图标；「自建 / API Base URL」为 .tbtn 展开收起，展开后 API Base URL 输入（mono，placeholder「空则按域名惯例推断，如 https://git.a.com/api/v4」）。
- 按钮行（右对齐，gap var(--gc-s2)）：「保存此远程配置」.btn.primary.h24（无修改或校验中 disabled；含 loading 时加 .is-loading）/「重新校验」.btn.h24（未保存过 Token / 有未保存修改 / 校验中时 disabled）/「放弃修改」.btn.ghost.h24（无修改时 disabled）。
- 无 host 空态两种文案用 .pane-empty 同级文本（fs-meta、text-3、居中，padding var(--gc-s3)）。

### 5.4 工具芯片墙（Git 操作 · 工具开关卡）

```css
.tool-group + .tool-group { margin-top: var(--gc-s2); }
.tg-head { display:flex; align-items:center; gap:6px; height:20px; }
.tg-head b { font-size: var(--gc-fs-meta); font-weight:600; color: var(--gc-text-2); line-height:20px; }
.tg-head .n { font-size: var(--gc-fs-micro); color: var(--gc-text-3); font-variant-numeric: tabular-nums; line-height:20px; }
.tool-wall { display:flex; flex-wrap:wrap; gap:6px; margin-top:6px; }
.tool-chip { position:relative; height: var(--gc-btn-mini); padding:0 8px; border-radius: var(--gc-r-tag); border:1px solid var(--gc-line); background: var(--gc-overlay); color: var(--gc-text-3); font-family: var(--gc-font-mono); font-size:11px; line-height:20px; white-space:nowrap; cursor:pointer; transition: background var(--gc-t-micro) var(--gc-ease), border-color var(--gc-t-micro) var(--gc-ease), color var(--gc-t-micro) var(--gc-ease); }
.tool-chip:hover { border-color: var(--gc-line-strong); color: var(--gc-text); }
.tool-chip.on { background: var(--gc-accent-weak); border-color: rgba(20,200,184,.28); color: var(--gc-accent-text); }
.tool-chip.risk { border-left:2px solid var(--gc-red-strong); padding-left:7px; }   /* 高风险 2px 红左条，padding 补偿防抖宽 */
.tool-wall-hint { margin-top:6px; font-size: var(--gc-fs-meta); color: var(--gc-text-3); line-height: var(--gc-lh-body); min-height: var(--gc-lh-body); }
```

- 组头格式「{组名} {数量}」：b=组名，.n=数量（如「查看 9」）。
- 10 组 52 芯片，顺序固定，芯片名为生产真实工具名去 git_ 前缀（mono 11px）：查看 9 / 分支 7 / 写入 9 / 同步 4 / 合并 9 / 变基 3 / MR 2 / 任务 4 / Worktree 3 / 高风险 2（reset_hard、clean 默认关 + .risk）。
- 启用态：.on（accent-weak 底 + 28% accent 边 + accent-text 字，同 .chip.accent）；未启用：默认态。
- hover 显示工具描述：chip 挂 title 属性兜底；同时 .tool-wall-hint 行由 JS 在 mouseenter 时更新为「{工具名} — {描述}」，离开清空（min-height 占位防抖）。描述文案由筑原型按生产工具功能简短填写，工具名必须真实。
- 卡加载态：loading 遮罩盖住 set-body（见 6.4）。

### 5.5 状态 tag 三态（正文规范）

```css
.spec-tag { display:inline-flex; align-items:center; gap:4px; height:20px; padding:0 7px; border-radius: var(--gc-r-tag); font-size: var(--gc-fs-micro); font-weight:500; line-height:1; white-space:nowrap; flex:none; }
.spec-tag.is-on { color: var(--gc-green); background: var(--gc-green-weak); border:1px solid rgba(86,217,122,.28); }       /* 已启用 */
.spec-tag.is-off { color: var(--gc-text-3); background: rgba(255,255,255,.05); border:1px solid var(--gc-line); }      /* 已导入未启用 / 未导入 */
```

- 「已导入未启用」与「未导入」同为 is-off 灰态，仅文案区分。

### 5.6 其余组件

**正文规范头部行 1**（flex、align-center、gap var(--gc-s3)、flex-wrap:wrap）：.spec-tag + swrow 变体「启用规范」（sw-copy b 只有标题无说明，右侧 .sw；无可填写字段时 .sw.is-disabled）+ .seg 单选组 + 右侧 mono 文件名（.chip.mono.sm，如 pasted.md，margin-left:auto）。

```css
.seg { display:inline-flex; border:1px solid var(--gc-line); border-radius: var(--gc-r); overflow:hidden; flex:none; }
.seg button { height: var(--gc-btn-inline); padding:0 10px; font-size: var(--gc-fs-meta); font-weight:500; color: var(--gc-text-3); background: var(--gc-card); border:0; border-left:1px solid var(--gc-line); cursor:pointer; line-height:1; transition: background var(--gc-t-micro) var(--gc-ease), color var(--gc-t-micro) var(--gc-ease); }
.seg button:first-child { border-left:0; }
.seg button:hover { color: var(--gc-text); background: var(--gc-btn-hover); }
.seg button.on { background: var(--gc-accent-weak); color: var(--gc-accent-text); font-weight:600; }
.seg.is-disabled { opacity:.42; pointer-events:none; }
```

**头部行 2**（flex、gap var(--gc-s2)）：「导入 Markdown」.btn.h24 + file 图标 /「粘贴导入」.btn.h24 + copy 图标 / .spacer /「放弃修改」.btn.ghost.h24 /「保存规范」.btn.primary.h24。解析中 / 保存中：对应按钮加 .is-loading。

**粘贴栏**（粘贴导入展开时显示）：

```css
.paste-bar { border:1px solid var(--gc-line); border-radius: var(--gc-r); background: var(--gc-page); padding: var(--gc-s2); display:flex; flex-direction:column; gap: var(--gc-s2); }
.paste-bar textarea { height:90px; }   /* 4 行 × lh-body 18 + padding 16 + border 2 */
```

「识别」.btn.h24 在栏内右下；成功提示「已识别 {N} 个模块，请校对后保存」用 .fhint 且 color: var(--gc-green)。

**字段编辑卡**（结构 pane，标签上置模式落点）：

```css
.fld-card { border:1px solid var(--gc-line); border-radius: var(--gc-r); background: var(--gc-card); }
.fld-card + .fld-card { margin-top: var(--gc-s2); }
.fld-head { display:flex; align-items:center; gap:6px; padding: var(--gc-s2); }
.fld-head .select { width:120px; flex:none; }      /* 类型下拉：多行文本/单选/勾选/说明（不填） */
.fld-head .input { flex:1; min-width:0; }          /* 标题输入，placeholder 标题 */
.fld-id { flex:none; font-family: var(--gc-font-mono); font-size: var(--gc-fs-micro); color: var(--gc-text-3); background: var(--gc-page); border:1px solid var(--gc-line-weak); border-radius:3px; padding:1px 4px; }
.fld-body { padding:0 var(--gc-s2) var(--gc-s2); display:flex; flex-direction:column; gap:5px; }
```

- 「必填」勾选：.cbx（说明类型时整项隐藏）；「删除」：.tbtn.danger。
- 单选：选项行（input flex，placeholder 选项 + 「删」.tbtn.danger）+「添加选项」.tbtn；类型切为单选时默认注入 低 / 中 / 高 三条。
- 勾选：条目行（input flex，placeholder 条目 + 「必勾」.cbx + 「删」.tbtn.danger）+「添加条目」.tbtn。
- 说明（不填）：说明正文 textarea 6 行（placeholder 说明正文）。
- 结构 pane 头部：「结构」+「添加」.tbtn + plus 图标；空态文案用 .pane-empty。

```css
.cbx { display:inline-flex; align-items:center; gap:6px; font-size: var(--gc-fs-meta); color: var(--gc-text-2); cursor:pointer; user-select:none; line-height:1; }
.cbx .box { width:13px; height:13px; border-radius:3px; border:1px solid var(--gc-line-strong); background: var(--gc-page); display:inline-flex; align-items:center; justify-content:center; flex:none; }
.cbx .box svg { width:9px; height:9px; color: var(--gc-accent-ink); opacity:0; }
.cbx.on .box { background: var(--gc-accent); border-color: var(--gc-accent); }
.cbx.on .box svg { opacity:1; }
.cbx.is-disabled { opacity:.42; cursor:not-allowed; }
```

**默认远程卡 / 当前远程凭证卡 / 模型卡**：按第 2 节框架 + 第 4 节表单模式组合，文案逐字取需求清单；平台 tag 用 .chip.sm（GitHub / GitLab 中性）、未识别用 .chip.amber.sm；远程 URL 用 .mono.nowrap；凭证行 tag：「已配置 Token」.chip.green.sm（带 preview，mono）/「无 Token」.chip.sm；「清除」.tbtn.danger，点击后行内变为确认条：

```css
.confirm-strip { display:flex; align-items:center; gap: var(--gc-s2); flex-wrap:wrap; padding: var(--gc-s2); border:1px solid rgba(255,133,133,.35); background: var(--gc-red-weak); border-radius: var(--gc-r); font-size: var(--gc-fs-meta); color: var(--gc-text-2); }
```

确认条内按钮：「清除」.btn.danger.h24 /「取消」.btn.ghost.h24。

**模型卡**：head cpu 图标 +「聊天模型」+ .chip.sm「OpenAI 兼容」；三行紧凑 frow（模型名 / Base URL / API Key）；card-foot 左侧 .foot-note「任务执行本身不消耗模型额度」，右侧「清除 Key」.btn.ghost.h24 且 color: var(--gc-red) +「保存」.btn.primary.h24。

### 5.7 按钮层级

| 层级 | 类名 | 用途 |
|---|---|---|
| 主 | .btn.primary（h28 / 卡内 .h24） | 保存此远程配置 / 保存规范 / 保存 |
| 次 | .btn（h28 / .h24） | 重新检测 / 重新校验 / 导入 Markdown / 粘贴导入 / GitHub / GitLab / 复制本机访问密钥 |
| 文字 | .btn.ghost / .tbtn | 放弃修改 / 放弃 / 添加 / 刷新 / 添加选项 / 添加条目 / 去下载 / 打开 * 创建 Token 页面 |
| 危险 | .btn.danger.h24 / .tbtn.danger | 确认条内「清除」/ 行内「删除」「删」「清除」「清除 Key」 |

```css
.tbtn { background:none; border:0; padding:0 2px; color: var(--gc-text-3); font-size: var(--gc-fs-meta); line-height: var(--gc-lh-body); cursor:pointer; border-radius: var(--gc-r-tag); white-space:nowrap; transition: color var(--gc-t-micro) var(--gc-ease), background var(--gc-t-micro) var(--gc-ease); }
.tbtn:hover { color: var(--gc-text); }
.tbtn:disabled, .tbtn.is-disabled { color: var(--gc-text-disabled); cursor:not-allowed; }
.tbtn.danger { color: var(--gc-red); }
.tbtn.danger:hover { color: var(--gc-red); background: var(--gc-red-weak); }
.tbtn.accent { color: var(--gc-accent-text); }
.tbtn.accent:hover { background: var(--gc-accent-weak); }
```

## 6. 交互态（令牌级取值）

### 6.1 hover

- 按钮：chrome.css .btn:hover 已有（底 --gc-btn-hover / 字 --gc-text / 边 --gc-line-strong，120ms --gc-ease）。
- .tbtn:hover：字 --gc-text（danger / accent 变体保持自身色 + 各自弱底）。
- .tool-chip:hover：边 --gc-line-strong、字 --gc-text。
- .mr-card:hover：边 --gc-line-strong、底 --gc-btn-hover。
- tab / seg / cbx 的 hover 见各自规则；全部过渡时长 var(--gc-t-micro)、缓动 var(--gc-ease)。

### 6.2 选中 / 启用

- tab .on、seg button.on：--gc-accent-weak 底 + rgba(20,200,184,.28) 边 + --gc-accent-text 字。
- .mr-card.on：--gc-accent-weak 底 + --gc-accent 1px 边。
- .sw.on：--gc-accent 轨 + --gc-accent-ink 旋钮；.cbx.on：--gc-accent 底 + --gc-accent-ink 勾。
- .tool-chip.on：同 chip.accent 三件套；.tool-chip.risk：--gc-red-strong 2px 左边条（无发光）。
- .spec-tag.is-on：--gc-green 字 + --gc-green-weak 底 + 28% 绿边。

### 6.3 禁用

- 按钮：.btn:disabled / .is-disabled → background var(--gc-card)、border-color var(--gc-line-weak)、color var(--gc-text-disabled)、cursor:not-allowed；.btn.primary:disabled 同样三值（不用 accent 底）。
- 输入：chrome.css .input:disabled（底 --gc-card / 字 --gc-text-disabled / 边 --gc-line-weak）。
- 开关：.sw.is-disabled opacity .42；分段：.seg.is-disabled opacity .42 + pointer-events:none。
- 文字按钮：.tbtn:disabled 字 --gc-text-disabled。

### 6.4 loading

- 按钮 loading：加 .is-loading = 禁用态 + 前置 12px 旋转环，文案保留。

```css
.spin { width:12px; height:12px; border-radius:50%; border:1.5px solid var(--gc-line-strong); border-top-color: var(--gc-accent); animation: gc-spin 800ms linear infinite; flex:none; }
@keyframes gc-spin { to { transform: rotate(360deg); } }
.btn.is-loading, .btn.primary.is-loading { background: var(--gc-card); border-color: var(--gc-line-weak); color: var(--gc-text-disabled); pointer-events:none; }
```

- 卡片级 loading（工具开关卡加载、MR tab 切回校验）：遮罩盖 set-body。

```css
.pane-loading { position:absolute; inset:0; z-index:5; display:flex; align-items:center; justify-content:center; gap: var(--gc-s2); background: var(--gc-glass-bg); -webkit-backdrop-filter: blur(var(--gc-glass-blur)); backdrop-filter: blur(var(--gc-glass-blur)); border-radius: var(--gc-r); color: var(--gc-text-2); font-size: var(--gc-fs-meta); }
```

（--gc-glass-* 令牌按 tokens.css 注释仅用于状态展示区，loading 遮罩属状态展示，合规。）

### 6.5 聚焦可见性

- tokens.css 已有全局 :focus-visible { outline:none; box-shadow: var(--gc-focus) }，对按钮 / 输入 / 自定义件一律生效；输入框 focus 走 chrome.css（边 --gc-accent + --gc-focus）。
- 本规范自定义件（.tbtn / .tool-chip / .mr-card / .cbx / .seg button / .gc-chip-tabs button）均为 button 或 label 包裹，自动继承全局 focus 环，无需另写；不得移除。

### 6.6 白主题（极地白）兼容

凡声明 border-color: rgba(20,200,184,.28) 的选中件（.gc-chip-tabs button.on、.tool-chip.on），必须补：

```css
html[data-accent='white'] .gc-chip-tabs button.on,
html[data-accent='white'] .tool-chip.on { border-color: rgba(238,244,249,.3); }
```

与 chrome.css 的 html[data-accent='white'] .chip.accent 覆盖逐字同值。红 / 绿 / 琥珀语义色两主色共用，无需覆盖。

## 7. 验收对照

| 验收标准 | 落点 |
|---|---|
| 功能全覆盖 | 组件规格 5.1–5.7 + 需求清单第二节；文案逐字，零虚构 |
| 痛点 1 | 第 3 节：1200px 容器、两套 minmax 栅格、959px 降级、首屏一票否决落点验算 |
| 痛点 2 | 第 4 节：88px 紧凑标签（废 140px）、上置模式三处、swrow 吸收 |
| 一致性 | 第 0 节 + 第 6 节：仅 --gc-* 令牌、双主色覆盖、禁渐变 / 大圆角 / emoji |

## 8. 新令牌申请单

**无。**

全部取值来自现有 --gc-* 令牌；仅两处 rgba 字面量（accent 选中边 28%、白主题 30%）为逐字复刻 chrome.css .chip.accent 及其白主题覆盖的既有写法，不构成新令牌、不构成第二套设计语言。
