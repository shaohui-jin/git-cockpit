/**
 * 为 README 截取 Git Cockpit 的真实界面。
 *
 * 自包含：自己起 daemon、造示例仓库、截完清理。
 *
 * 为什么不用空态截图：工作台在没有任何仓库时只显示「还没有打开仓库」，
 * 读者看不出这工具能干什么。所以先造一个带冲突的仓库，
 * 才能截到「合并预演」这类真正有信息量的界面。
 *
 * 运行：pnpm build && node packages/e2e/shoot-readme.mjs
 * 产物：docs/images/*.png
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const CLI = join(ROOT, "packages", "mcp-server", "dist", "cli-entry.js");
const WEB_DIST = join(ROOT, "packages", "web", "dist", "index.html");
const OUT_DIR = join(ROOT, "docs", "images");
const TMP = join(ROOT, ".tmp-shoot-readme");
const DATA = join(TMP, "data");
// 示例仓库放在一个更像真实项目的位置，截图里不要出现 .tmp-xxx 这种目录名
const REPO = join(TMP, "workspace", "demo-repo");
const PORT = 3922;
const BASE = `http://127.0.0.1:${PORT}`;

function sh(cmd, args, cwd) {
  // 不用 shell: true —— 中文 commit message 会被 Windows shell 拆词
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} 失败：${r.stderr || r.stdout}`);
  return r.stdout;
}

/** 造一个带冲突的仓库：main 与 feature 改同一文件 */
function makeConflictRepo() {
  rmSync(REPO, { recursive: true, force: true });
  mkdirSync(REPO, { recursive: true });
  const g = (...a) => sh("git", a, REPO);
  g("init", "-b", "main");
  g("config", "user.email", "demo@example.com");
  g("config", "user.name", "Demo User");
  g("config", "core.autocrlf", "false");

  const write = (name, body) => {
    // 用 Node 写文件，避免 shell 引号转义问题
    require("node:fs").writeFileSync(join(REPO, name), body, "utf8");
  };

  writeFileSync(join(REPO, "README.md"), "# Demo\n\n用于截图的示例仓库。\n", "utf8");
  writeFileSync(join(REPO, "app.js"), "export const version = '1.0.0';\n", "utf8");
  g("add", ".");
  g("commit", "-m", "init: 初始提交");

  g("checkout", "-b", "feature/payment");
  writeFileSync(join(REPO, "app.js"), "export const version = '1.1.0';\n", "utf8");
  g("add", ".");
  g("commit", "-m", "feat: 升级到 1.1.0");

  g("checkout", "main");
  writeFileSync(join(REPO, "app.js"), "export const version = '1.0.1';\n", "utf8");
  g("add", ".");
  g("commit", "-m", "fix: 补丁版本");

  // 再留一点未提交改动，让工作台卡片显示「有更改」
  writeFileSync(join(REPO, "README.md"), "# Demo\n\n用于截图的示例仓库。\n\n补充说明。\n", "utf8");
}

async function waitHealth() {
  for (let i = 0; i < 150; i++) {
    try {
      const r = await fetch(`${BASE}/api/health`);
      if (r.ok && (await r.json()).ok) return;
    } catch {
      /* 还没起 */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("daemon 健康检查超时");
}

const shots = [];

async function main() {
  if (!existsSync(CLI) || !existsSync(WEB_DIST)) {
    console.error("缺少构建产物。先跑：pnpm build");
    process.exit(1);
  }

  mkdirSync(OUT_DIR, { recursive: true });
  rmSync(DATA, { recursive: true, force: true });
  mkdirSync(DATA, { recursive: true });
  makeConflictRepo();

  const child = spawn(process.execPath, [CLI, "start"], {
    env: {
      ...process.env,
      GIT_COCKPIT_DATA_DIR: DATA,
      GIT_COCKPIT_PORT: String(PORT),
      GIT_COCKPIT_HOST: "127.0.0.1",
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let logs = "";
  child.stdout?.on("data", (b) => (logs += b));
  child.stderr?.on("data", (b) => (logs += b));

  let browser;
  const errors = [];

  try {
    await waitHealth();

    // 用本机 Edge/Chrome：与 e2e 保持一致，避免另下 chromium
    const channel = process.platform === "win32" ? "msedge" : "chrome";
    browser = await chromium.launch({ channel });
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, locale: "zh-CN" });

    page.on("console", (m) => {
      if (m.type() === "error") errors.push(`console: ${m.text()}`);
    });
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));

    // 1) 工作台：打开示例仓库后有仓库卡片
    await page.goto(`${BASE}/#/dashboard`, { waitUntil: "networkidle", timeout: 60000 });
    await page.getByText("后端已连接").waitFor({ timeout: 30000 });
    await page.getByPlaceholder(/输入本地 Git 仓库路径/).fill(REPO);
    await page.getByRole("button", { name: "打开", exact: true }).click();
    await page.locator(".repo-card").first().waitFor({ timeout: 30000 });
    // 等「已打开 xxx」的 toast 消失，否则会盖在截图上
    await page.waitForTimeout(4500);

    await page.screenshot({ path: join(OUT_DIR, "dashboard.png") });
    shots.push("dashboard.png");

    // 2) 合并预演：从仓库卡片的「更多」进
    try {
      await page.locator(".repo-card").first().getByRole("button", { name: "更多" }).click();
      await page.locator(".gc-card-menu").getByText("预演合并", { exact: true }).click();
      await page.waitForTimeout(4000);

      // 关掉「先 fetch」：示例仓库没有远程，fetch 会失败
      const fetchSwitch = page.locator(".fetch .el-switch, .field-switch .el-switch").first();
      if ((await fetchSwitch.count()) > 0) {
        const checked = await fetchSwitch.evaluate((el) => el.classList.contains("is-checked"));
        if (checked) {
          await fetchSwitch.click();
          await page.waitForTimeout(500);
        }
      }

      // 真的跑一次预演，否则页面停在「尚未预览」，看不出这功能在干什么。
      // main 与 feature/payment 改了同一个文件，应该报内容冲突。
      const pending = page
        .waitForResponse((r) => r.url().includes("/merge/rehearse"), { timeout: 30000 })
        .catch(() => null);
      await page.getByRole("button", { name: "预演", exact: true }).click();
      const res = await pending;
      console.log(res ? `预演响应 HTTP ${res.status()}` : "预演请求未捕获");
      // 等冲突块渲染
      await page.waitForTimeout(4000);
      await page.screenshot({ path: join(OUT_DIR, "merge-preview.png") });
      shots.push("merge-preview.png");
    } catch (e) {
      console.log("合并预演截图跳过：" + e.message.split("\n")[0]);
    }

    // 3) 合并矩阵：切到「矩阵」chip
    const matrixChip = page.locator(".gc-chip-tabs button", { hasText: "矩阵" });
    if ((await matrixChip.count()) > 0) {
      try {
        await matrixChip.first().click({ timeout: 10000 });
        await page.waitForTimeout(4000);
        await page.screenshot({ path: join(OUT_DIR, "merge-matrix.png") });
        shots.push("merge-matrix.png");
      } catch (e) {
        console.log("矩阵截图跳过：" + e.message.split("\n")[0]);
      }
    } else {
      console.log("未找到矩阵 chip，跳过");
    }
    // 状态页不截：它的路径栏会显示临时目录名，且「工作区 + 历史」用文字说明更清楚
  } catch (e) {
    console.error("ERR", e.message);
    console.error(logs.slice(-2000));
    process.exitCode = 1;
  } finally {
    await browser?.close();
    child.kill();
    await new Promise((r) => setTimeout(r, 1000));
    rmSync(TMP, { recursive: true, force: true });
  }

  console.log(`\n产出 ${shots.length} 张：${shots.join(", ")}`);
  if (errors.length) {
    console.log(`发现 ${errors.length} 个页面错误：`);
    for (const e of errors.slice(0, 10)) console.log("  x " + e);
  } else {
    console.log("无控制台错误");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
