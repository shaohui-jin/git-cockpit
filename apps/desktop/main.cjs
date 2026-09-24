const { app, BrowserWindow, dialog, shell } = require('electron');
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const NODE_DOWNLOAD = 'https://nodejs.org/en/download';
const MIN_NODE = [22, 5, 0];
const SQLITE_UNFLAGGED = [22, 13, 0];

const DAEMON_PKG = '@shaohui_jin/git-cockpit-mcp-server';
const DAEMON_SPEC = process.env.GIT_COCKPIT_DAEMON_SPEC || `${DAEMON_PKG}@latest`;
const INSTALL_TIMEOUT_MS = 5 * 60 * 1000;
const PROBE_TIMEOUT_MS = 15 * 1000;

const PORT = Number(process.env.GIT_COCKPIT_PORT) || 3000;
const DEV_UI_PORT = Number(process.env.GIT_COCKPIT_DEV_UI_PORT) || 5173;
const HOSTS = Array.from(new Set([process.env.GIT_COCKPIT_HOST || '127.0.0.1', '127.0.0.1', 'localhost']));

let child = null;
let spawnedByUs = false;
let mainWindow = null;
let spawnLog = '';
let systemNode = null;

let starting = true;
let installWindow = null;
let installProc = null;
let installReady = false;
let installCancelled = false;
let pendingLog = '';
/** 主窗正常标题；下载/安装进度结束后恢复。 */
let baseMainTitle = '';
/** 非空表示正在显示宿主级进度（任务栏 + 标题），second-instance 不要覆盖标题。 */
let hostProgressLabel = null;

function probeUrl(url) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      res.resume();
      resolve(res.statusCode != null && res.statusCode < 500);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(1500, () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function probeDaemon() {
  for (const h of HOSTS) {
    if (await probeUrl(`http://${h}:${PORT}/api/health`)) return true;
  }
  return false;
}

function daemonOrigin(host) {
  return `http://${host}:${PORT}`;
}

function requestJson(method, url, options = {}) {
  const { secret, body, timeout = 15000 } = options;
  return new Promise((resolve) => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      resolve({ ok: false, status: 0, data: null });
      return;
    }
    const payload = body != null ? JSON.stringify(body) : null;
    const headers = { Accept: 'application/json' };
    if (secret) headers['X-Git-Cockpit-Secret'] = secret;
    if (payload) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(payload);
    }
    const req = http.request(
      {
        hostname: parsed.hostname,
        port: parsed.port,
        path: `${parsed.pathname}${parsed.search}`,
        method,
        headers,
        timeout
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => {
          raw += chunk;
          if (raw.length > 200000) raw = raw.slice(-200000);
        });
        res.on('end', () => {
          let data = null;
          if (raw) {
            try {
              data = JSON.parse(raw);
            } catch {
              data = null;
            }
          }
          resolve({
            ok: res.statusCode != null && res.statusCode >= 200 && res.statusCode < 300,
            status: res.statusCode ?? 0,
            data
          });
        });
      }
    );
    req.on('error', () => resolve({ ok: false, status: 0, data: null }));
    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, status: 0, data: null });
    });
    if (payload) req.write(payload);
    req.end();
  });
}

async function fetchDaemonHealth() {
  for (const h of HOSTS) {
    const res = await requestJson('GET', `${daemonOrigin(h)}/api/health`);
    if (res.ok && res.data?.version) {
      return { ok: true, version: String(res.data.version), host: h };
    }
  }
  return { ok: false, version: '', host: HOSTS[0] };
}

async function waitDaemonDown(ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (!(await probeDaemon())) return true;
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

async function waitHealth(ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await probeDaemon()) return true;
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

function parseVersion(raw) {
  const m = String(raw)
    .trim()
    .match(/(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function versionAtLeast(v, min) {
  for (let i = 0; i < 3; i += 1) {
    if (v[i] !== min[i]) return v[i] > min[i];
  }
  return true;
}

function formatVersion(v) {
  return v.join('.');
}

function whereCommand(name) {
  const cmd = process.platform === 'win32' ? 'where.exe' : 'which';
  const found = spawnSync(cmd, [name], { encoding: 'utf8', windowsHide: true });
  if (found.status !== 0) return [];
  return found.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function nodeCandidates() {
  const listed = [];
  if (process.env.GIT_COCKPIT_NODE) listed.push(process.env.GIT_COCKPIT_NODE);
  if (process.platform === 'win32') {
    const programFiles = [process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(Boolean);
    for (const root of programFiles) listed.push(path.join(root, 'nodejs', 'node.exe'));
    if (process.env.LOCALAPPDATA) {
      listed.push(path.join(process.env.LOCALAPPDATA, 'Programs', 'nodejs', 'node.exe'));
    }
  }
  listed.push(...whereCommand('node'));
  const seen = new Set();
  return listed.filter((bin) => {
    if (!bin || seen.has(bin)) return false;
    seen.add(bin);
    if (/electron\.exe$/i.test(bin)) return false;
    if (/\\WindowsApps\\/i.test(bin)) return false;
    return fs.existsSync(bin);
  });
}

function probeNodeBinary(bin) {
  const found = spawnSync(bin, ['-p', 'process.versions.node'], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 8000
  });
  if (found.status !== 0) return null;
  const version = parseVersion(found.stdout);
  if (!version) return null;
  return { path: bin, version };
}

function findSystemNode() {
  for (const bin of nodeCandidates()) {
    const hit = probeNodeBinary(bin);
    if (hit) return hit;
  }
  return null;
}

function pathWithNode(nodePath) {
  const dir = path.dirname(nodePath);
  return {
    ...process.env,
    PATH: `${dir}${path.delimiter}${process.env.PATH || ''}`,
    GIT_COCKPIT_HOST: HOSTS[0],
    GIT_COCKPIT_PORT: String(PORT)
  };
}

function resolveDevEntry() {
  if (process.env.GIT_COCKPIT_CLI && fs.existsSync(process.env.GIT_COCKPIT_CLI)) {
    return process.env.GIT_COCKPIT_CLI;
  }
  if (app.isPackaged) return null;
  const entry = path.resolve(__dirname, '..', '..', 'packages', 'mcp-server', 'dist', 'cli-entry.js');
  return fs.existsSync(entry) ? entry : null;
}

function npmGlobalPrefix(nodePath) {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const res = spawnSync(npm, ['prefix', '-g'], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 20000,
    shell: process.platform === 'win32',
    env: pathWithNode(nodePath)
  });
  if (res.status !== 0) return null;
  return res.stdout.trim() || null;
}

function pkgEntry(prefix) {
  return path.join(prefix, 'node_modules', '@shaohui_jin', 'git-cockpit-mcp-server', 'dist', 'cli-entry.js');
}

/** 全局目录不可写时的兜底安装位置（用户可写，不需要管理员）。 */
function customPrefix() {
  const base =
    process.platform === 'win32'
      ? process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local')
      : process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local');
  return path.join(base, 'git-cockpit', 'npm');
}

/** 按优先级找到可运行的 daemon 入口。只看文件在不在不够，必须由 probeEntry 试跑确认。 */
function resolveDaemonEntry(nodePath) {
  const dev = resolveDevEntry();
  if (dev) return { entry: dev, kind: 'dev' };
  // 上次若因权限装到用户目录，这里按路径解析，保证后续启动还能找到。
  const custom = pkgEntry(customPrefix());
  if (fs.existsSync(custom)) return { entry: custom, kind: 'custom' };
  const prefix = npmGlobalPrefix(nodePath);
  if (prefix) {
    const entry = pkgEntry(prefix);
    if (fs.existsSync(entry)) return { entry, kind: 'global' };
  }
  const shim = whereCommand('git-cockpit')[0];
  if (shim) return { entry: shim, kind: 'shim' };
  return null;
}

/** 试跑 version：退出码 0 且能解析出版本号才算可用，可覆盖「包在但依赖坏了」。 */
function probeEntry(nodePath, resolved) {
  const run =
    resolved.kind === 'shim'
      ? spawnSync(resolved.entry, ['version'], {
          encoding: 'utf8',
          windowsHide: true,
          timeout: PROBE_TIMEOUT_MS,
          shell: process.platform === 'win32'
        })
      : spawnSync(nodePath, [resolved.entry, 'version'], {
          encoding: 'utf8',
          windowsHide: true,
          timeout: PROBE_TIMEOUT_MS,
          env: pathWithNode(nodePath)
        });
  const output = `${run.stdout || ''}${run.stderr || ''}`.trim();
  const version = parseVersion(output);
  return {
    ok: run.status === 0 && !run.error && !!version,
    version: version ? formatVersion(version) : '',
    output
  };
}

function tail(text, max) {
  const value = String(text || '').trim();
  if (!value) return '';
  return value.length > max ? `…${value.slice(-max)}` : value;
}

function resolveNpmCli(nodePath) {
  const dir = path.dirname(nodePath);
  const candidates = [
    path.join(dir, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.resolve(dir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js')
  ];
  return candidates.find((p) => fs.existsSync(p)) || null;
}

function logDir() {
  const base =
    process.platform === 'win32'
      ? process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local')
      : os.tmpdir();
  return path.join(base, 'git-cockpit-desktop', 'logs');
}

function writeInstallLog(text) {
  try {
    const dir = logDir();
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `install-${new Date().toISOString().replace(/[:.]/g, '-')}.log`);
    fs.writeFileSync(file, String(text || ''), 'utf8');
    return file;
  } catch {
    return null;
  }
}

function writeUpdateLog(text) {
  try {
    const dir = logDir();
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `daemon-update-${new Date().toISOString().replace(/[:.]/g, '-')}.log`);
    fs.writeFileSync(file, String(text || ''), 'utf8');
    return file;
  } catch {
    return null;
  }
}

function attachSpawnLog(proc) {
  const onChunk = (buf) => {
    spawnLog += buf.toString();
    if (spawnLog.length > 4000) spawnLog = spawnLog.slice(-4000);
  };
  proc.stdout?.on('data', onChunk);
  proc.stderr?.on('data', onChunk);
}

const INSTALL_PAGE = `data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>安装 Git Cockpit 服务</title>
<style>body{margin:0;padding:16px;background:#ffffff;color:#1f2328;font-family:system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif}
h1{margin:0 0 4px;font-size:14px;font-weight:500}
p{margin:0 0 12px;font-size:12px;color:#57606a}
pre{margin:0;padding:10px;background:#f6f8fa;border-radius:6px;font:12px/1.6 ui-monospace,Consolas,monospace;white-space:pre-wrap;word-break:break-all;height:calc(100vh - 110px);overflow:auto}
</style></head>
<body><h1>正在安装 Git Cockpit 服务</h1><p>首次启动需要下载 npm 包，只需一次。关闭此窗口即取消安装。</p><pre id="log"></pre>
<script>window.appendLog=function(t){var p=document.getElementById('log');if(!p)return;p.textContent+=t;p.scrollTop=p.scrollHeight;};</script>
</body></html>`)}`;

function openInstallWindow() {
  if (installWindow && !installWindow.isDestroyed()) return;
  installReady = false;
  installCancelled = false;
  pendingLog = '';
  installWindow = new BrowserWindow({
    width: 640,
    height: 400,
    title: '安装 Git Cockpit 服务',
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  installWindow.webContents.on('did-finish-load', () => {
    installReady = true;
    flushInstallLog();
  });
  installWindow.on('closed', () => {
    installWindow = null;
    installReady = false;
    if (installProc && !installProc.killed) {
      installProc.kill();
      installCancelled = true;
    }
  });
  void installWindow.loadURL(INSTALL_PAGE);
}

function flushInstallLog() {
  if (!installReady || !installWindow || installWindow.isDestroyed() || !pendingLog) return;
  const chunk = pendingLog;
  pendingLog = '';
  void installWindow.webContents.executeJavaScript(`window.appendLog(${JSON.stringify(chunk)})`).catch(() => undefined);
}

function appendInstallLog(text) {
  if (!text) return;
  pendingLog += text;
  if (pendingLog.length > 40000) pendingLog = pendingLog.slice(-40000);
  flushInstallLog();
}

function closeInstallWindow() {
  if (installWindow && !installWindow.isDestroyed()) installWindow.close();
  installWindow = null;
  installReady = false;
}

function runNpm(nodePath, args) {
  return new Promise((resolve) => {
    const env = pathWithNode(nodePath);
    const npmCli = resolveNpmCli(nodePath);
    let proc;
    if (npmCli) {
      proc = spawn(nodePath, [npmCli, ...args], {
        env,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
      });
    } else {
      const npmBin = process.platform === 'win32' ? 'npm.cmd' : 'npm';
      proc = spawn(npmBin, args, {
        env,
        windowsHide: true,
        shell: process.platform === 'win32',
        stdio: ['ignore', 'pipe', 'pipe']
      });
    }
    installProc = proc;
    let out = '';
    let done = false;
    let timer = null;
    const push = (buf) => {
      const text = buf.toString();
      out += text;
      if (out.length > 200000) out = out.slice(-200000);
      appendInstallLog(text);
    };
    const finish = (ok, extra = '') => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      installProc = null;
      resolve({ ok, output: `${out}${extra}` });
    };
    proc.stdout?.on('data', push);
    proc.stderr?.on('data', push);
    timer = setTimeout(() => {
      appendInstallLog(`\n[git-cockpit] 安装超过 ${Math.round(INSTALL_TIMEOUT_MS / 1000)} 秒，已取消。\n`);
      proc.kill();
      finish(false, '\n[timeout]');
    }, INSTALL_TIMEOUT_MS);
    proc.on('error', (err) => finish(false, `\n[error] ${err.message}`));
    proc.on('close', (code) => finish(code === 0, code === 0 ? '' : `\n[npm exit ${code}]`));
  });
}

/** 全局目录不可写（EACCES / EPERM）时才考虑换到用户目录。 */
function needsPrefixFallback(output) {
  return /EACCES|EPERM|permission denied|Operation not permitted/i.test(output || '');
}

async function installDaemonPackage(nodePath, spec, { preferCustom = false } = {}) {
  const base = ['install', '-g', spec, '--no-audit', '--no-fund'];
  const fallback = customPrefix();
  const attempts = preferCustom
    ? [{ args: [...base, '--prefix', fallback], prefix: fallback }]
    : [
        { args: base, prefix: null },
        { args: [...base, '--prefix', fallback], prefix: fallback }
      ];
  let last = '';
  for (const attempt of attempts) {
    appendInstallLog(`\n$ npm ${attempt.args.join(' ')}\n`);
    const res = await runNpm(nodePath, attempt.args);
    if (res.ok) {
      writeInstallLog(res.output);
      return { ok: true, output: res.output };
    }
    last = res.output;
    if (preferCustom || !needsPrefixFallback(last)) break;
    appendInstallLog(`\n[git-cockpit] 全局目录不可写，改安装到 ${fallback}\n`);
  }
  return { ok: false, output: last, logFile: writeInstallLog(last) };
}

async function installDaemon(nodePath) {
  return installDaemonPackage(nodePath, DAEMON_SPEC);
}

async function promptInstall(failed) {
  const detail = failed
    ? `已装的 ${DAEMON_PKG} 无法运行（来源：${failed.kind}）。\n${tail(failed.output, 300) || '（无输出）'}\n\n将重新安装：npm i -g ${DAEMON_SPEC}`
    : `桌面窗需要 Git Cockpit 服务才能工作，安装包本身不带服务。\n\n将执行：npm i -g ${DAEMON_SPEC}\n使用本机 Node.js ${systemNode ? formatVersion(systemNode.version) : ''}。首次启动需要联网，只需一次，安装过程会显示日志。`;
  const { response } = await dialog.showMessageBox({
    type: 'question',
    title: 'Git Cockpit',
    message: '需要安装 Git Cockpit 服务（npm 包）。',
    detail,
    buttons: ['安装', '退出'],
    defaultId: 0,
    cancelId: 1
  });
  return response === 0;
}

function spawnDaemon(resolved) {
  const nodePath = systemNode.path;
  const env = pathWithNode(nodePath);
  if (!versionAtLeast(systemNode.version, SQLITE_UNFLAGGED)) {
    env.NODE_OPTIONS = [env.NODE_OPTIONS, '--experimental-sqlite'].filter(Boolean).join(' ');
  }
  spawnLog = '';
  if (resolved.kind === 'shim') {
    child = spawn(resolved.entry, ['start'], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
      windowsHide: true
    });
  } else {
    child = spawn(nodePath, [resolved.entry, 'start'], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: path.resolve(path.dirname(resolved.entry), '..'),
      windowsHide: true
    });
  }
  spawnedByUs = true;
  attachSpawnLog(child);
  return child;
}

async function promptNode(detail) {
  const { response } = await dialog.showMessageBox({
    type: 'warning',
    title: 'Git Cockpit',
    message: '需要本机的 Node.js 22 或更高版本。',
    detail,
    buttons: ['打开 Node.js 下载页', '关闭'],
    defaultId: 0,
    cancelId: 1
  });
  if (response === 0) await shell.openExternal(NODE_DOWNLOAD);
}

async function ensureDaemon() {
  if (await probeDaemon()) {
    spawnedByUs = false;
    return;
  }
  systemNode = findSystemNode();
  if (!systemNode) {
    await promptNode(
      '没有在 PATH 里找到 node。请安装 Node.js 22 或更高版本后再打开。使用 nvm 时，需要让 node 出现在系统 PATH 中。'
    );
    throw new Error('__node_prompted__');
  }
  if (!versionAtLeast(systemNode.version, MIN_NODE)) {
    await promptNode(`当前是 Node.js ${formatVersion(systemNode.version)}。请安装 22 或更高版本后再打开。`);
    throw new Error('__node_prompted__');
  }

  let resolved = resolveDaemonEntry(systemNode.path);
  let probe = resolved ? probeEntry(systemNode.path, resolved) : null;

  if (!probe || !probe.ok) {
    // 开发态不自动装全局包：缺失时优先提示 pnpm build，避免把全局包当成开发依赖。
    if (!app.isPackaged) {
      throw new Error(
        `没有找到可运行的 git-cockpit。请先执行 pnpm build，或安装全局包：\n\nnpm i -g ${DAEMON_PKG}` +
          (probe ? `\n\n试跑输出：\n${tail(probe.output, 400)}` : '')
      );
    }
    const agreed = await promptInstall(probe ? { kind: resolved.kind, output: probe.output } : null);
    if (!agreed) throw new Error('__install_declined__');

    openInstallWindow();
    setHostProgress('安装服务', null);
    let installed;
    try {
      installed = await installDaemon(systemNode.path);
    } finally {
      clearHostProgress();
      closeInstallWindow();
    }
    if (!installed.ok) {
      // 用户主动关掉日志窗 == 取消，不再弹错误框。
      if (installCancelled) throw new Error('__install_declined__');
      const hint = installed.logFile ? `\n\n完整日志：${installed.logFile}` : '';
      throw new Error(
        `安装 Git Cockpit 服务失败。\n\n${tail(installed.output, 900)}${hint}\n\n也可手动执行：npm i -g ${DAEMON_PKG}`
      );
    }

    resolved = resolveDaemonEntry(systemNode.path);
    probe = resolved ? probeEntry(systemNode.path, resolved) : null;
    if (!probe || !probe.ok) {
      throw new Error(
        `服务已安装，但仍无法运行（${resolved ? resolved.kind : '未找到入口'}）。\n\n${tail(probe ? probe.output : '', 900)}`
      );
    }
  }

  spawnDaemon(resolved);
  const ok = await waitHealth(25000);
  if (!ok) {
    const hint = spawnLog.trim()
      ? `\n\n${spawnLog.trim().slice(-800)}`
      : `\n若 ${PORT} 已被占用，请关掉占用进程后再开。`;
    throw new Error(`无法连接 Git Cockpit（:${PORT}）。${hint}`);
  }
}

async function resolveUiOrigin() {
  if (process.env.GIT_COCKPIT_UI) return process.env.GIT_COCKPIT_UI.replace(/\/$/, '');
  const preferVite = !app.isPackaged;
  if (preferVite) {
    for (const h of HOSTS) {
      const origin = `http://${h}:${DEV_UI_PORT}`;
      if (await probeUrl(origin)) return origin;
    }
  }
  for (const h of HOSTS) {
    const origin = `http://${h}:${PORT}`;
    if (await probeUrl(`${origin}/api/health`)) return origin;
  }
  return `http://${HOSTS[0]}:${preferVite ? DEV_UI_PORT : PORT}`;
}

function hostProgressWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) return mainWindow;
  if (installWindow && !installWindow.isDestroyed()) return installWindow;
  return null;
}

/** 方案 D：Windows 任务栏进度 + 窗口标题。percent 为 0–100；null 表示 npm 类无百分比任务。 */
function setHostProgress(label, percent) {
  hostProgressLabel = label;
  const win = hostProgressWindow();
  if (!win) return;
  if (typeof percent === 'number' && Number.isFinite(percent)) {
    win.setProgressBar(Math.min(1, Math.max(0, percent / 100)));
    win.setTitle(`Git Cockpit · ${label} ${Math.round(percent)}%`);
    return;
  }
  win.setProgressBar(2);
  win.setTitle(`Git Cockpit · ${label}…`);
}

function clearHostProgress() {
  hostProgressLabel = null;
  for (const win of [mainWindow, installWindow]) {
    if (!win || win.isDestroyed()) continue;
    win.setProgressBar(-1);
    if (win === mainWindow && baseMainTitle) win.setTitle(baseMainTitle);
  }
}

function createWindow(origin) {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  const url = `${origin}/#/dashboard`;
  baseMainTitle = `Git Cockpit · ${origin}`;
  mainWindow.setTitle(baseMainTitle);
  void mainWindow.loadURL(url);
  mainWindow.on('closed', () => {
    mainWindow = null;
    baseMainTitle = '';
  });
}

app.whenReady().then(async () => {
  // 开发时不抢单例：旧窗口会把新进程直接杀掉，改过的壳永远起不来。
  if (app.isPackaged) {
    const got = app.requestSingleInstanceLock();
    if (!got) {
      app.quit();
      return;
    }
  }
  try {
    await ensureDaemon();
    const origin = await resolveUiOrigin();
    createWindow(origin);
    starting = false;
    offerUpdate();
    offerDaemonUpdate();
  } catch (err) {
    const silent =
      err instanceof Error && (err.message === '__node_prompted__' || err.message === '__install_declined__');
    if (!silent) {
      dialog.showErrorBox('Git Cockpit', err instanceof Error ? err.message : String(err));
    }
    app.quit();
  }
});

app.on('second-instance', () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
  void resolveUiOrigin().then((origin) => {
    void mainWindow.loadURL(`${origin}/#/dashboard`);
    if (!hostProgressLabel) {
      baseMainTitle = `Git Cockpit · ${origin}`;
      mainWindow.setTitle(baseMainTitle);
    }
  });
});

app.on('window-all-closed', () => {
  // 启动期会先关安装日志窗再开主窗，这段空窗不能当成「用户关掉了应用」。
  if (starting) return;
  if (spawnedByUs && child && !child.killed) child.kill();
  app.quit();
});

function isZipInstall() {
  return !fs.existsSync(path.join(path.dirname(process.execPath), 'Uninstall Git Cockpit.exe'));
}

function offerUpdate() {
  if (!app.isPackaged) return;
  let autoUpdater;
  try {
    ({ autoUpdater } = require('electron-updater'));
  } catch {
    return;
  }
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  const releaseUrl = 'https://github.com/shaohui-jin/git-cockpit/releases/latest';
  if (isZipInstall()) {
    autoUpdater.once('update-available', () => {
      dialog
        .showMessageBox({
          type: 'info',
          message: '有新版本。zip 解压版不会自动安装。',
          buttons: ['打开 Release', '稍后']
        })
        .then(({ response }) => {
          if (response === 0) void require('electron').shell.openExternal(releaseUrl);
        })
        .catch(() => undefined);
    });
  } else {
    autoUpdater.on('update-available', (info) => {
      dialog
        .showMessageBox({
          type: 'info',
          message: `有新版本 ${info.version}。下载后再决定是否安装。`,
          buttons: ['下载', '稍后']
        })
        .then(({ response }) => {
          if (response !== 0) return;
          setHostProgress('下载桌面包', null);
          void autoUpdater.downloadUpdate();
        })
        .catch(() => undefined);
    });
    autoUpdater.on('download-progress', (info) => {
      setHostProgress('下载桌面包', info.percent);
    });
    autoUpdater.on('update-downloaded', () => {
      clearHostProgress();
      const extra = spawnedByUs ? '' : '\n\n本窗口没有拉起 :3000。若外部 git-cockpit start 占着端口，请先自己关掉它。';
      dialog
        .showMessageBox({
          type: 'info',
          message: `新版本已下载。现在安装并重启？${extra}`,
          buttons: ['安装', '稍后']
        })
        .then(({ response }) => {
          if (response !== 0) return;
          if (spawnedByUs && child && !child.killed) child.kill();
          autoUpdater.quitAndInstall();
        })
        .catch(() => undefined);
    });
    autoUpdater.on('error', () => {
      clearHostProgress();
    });
  }
  autoUpdater.checkForUpdates().catch(() => undefined);
}

function fetchRegistryVersion(nodePath) {
  const env = pathWithNode(nodePath);
  const npmCli = resolveNpmCli(nodePath);
  let res;
  if (npmCli) {
    res = spawnSync(nodePath, [npmCli, 'view', DAEMON_PKG, 'version', '--json'], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: PROBE_TIMEOUT_MS,
      env
    });
  } else {
    const npmBin = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    res = spawnSync(npmBin, ['view', DAEMON_PKG, 'version', '--json'], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: PROBE_TIMEOUT_MS,
      shell: process.platform === 'win32',
      env
    });
  }
  const raw = `${res.stdout || ''}${res.stderr || ''}`.trim();
  if (res.status !== 0) return { ok: false, version: '', output: raw };
  const quoted = raw.match(/"(\d+\.\d+\.\d+)"/);
  const plain = parseVersion(raw);
  const version = quoted ? quoted[1] : plain ? formatVersion(plain) : '';
  return version ? { ok: true, version, output: raw } : { ok: false, version: '', output: raw };
}

async function fetchBootstrapSecret(host) {
  const res = await requestJson('GET', `${daemonOrigin(host)}/api/bootstrap`);
  const secret = res.data?.secret;
  return typeof secret === 'string' && secret ? secret : null;
}

async function daemonHasRunningJobs(host, secret) {
  const res = await requestJson('GET', `${daemonOrigin(host)}/api/jobs`, { secret });
  if (!res.ok || !Array.isArray(res.data?.jobs)) return false;
  return res.data.jobs.some((job) => job.status === 'running');
}

async function shutdownDaemon(host, secret) {
  const res = await requestJson('POST', `${daemonOrigin(host)}/api/shutdown`, { secret });
  return res.status === 204;
}

async function runDaemonUpgrade(currentVersion, latestVersion) {
  const node = systemNode || findSystemNode();
  if (!node) {
    dialog.showErrorBox('Git Cockpit', '未找到 Node.js，无法升级服务。');
    return;
  }
  if (!versionAtLeast(node.version, MIN_NODE)) {
    await promptNode(`当前是 Node.js ${formatVersion(node.version)}。请安装 22 或更高版本后再升级服务。`);
    return;
  }
  systemNode = node;

  const health = await fetchDaemonHealth();
  if (!health.ok) {
    dialog.showErrorBox('Git Cockpit', '无法连接 Git Cockpit 服务，已取消升级。');
    return;
  }

  const secret = await fetchBootstrapSecret(health.host);
  if (!secret) {
    dialog.showErrorBox('Git Cockpit', '无法读取本机密钥，已取消升级。');
    return;
  }

  if (await daemonHasRunningJobs(health.host, secret)) {
    await dialog.showMessageBox({
      type: 'warning',
      title: 'Git Cockpit',
      message: '有任务进行中，无法升级服务。',
      detail: '请先在「任务」页等待任务结束，再重新打开应用或稍后重试。',
      buttons: ['知道了']
    });
    return;
  }

  const resolvedBefore = resolveDaemonEntry(node.path);
  if (resolvedBefore?.kind === 'dev') {
    dialog.showErrorBox('Git Cockpit', '开发模式不自动升级全局服务。');
    return;
  }

  const externalNote = spawnedByUs
    ? ''
    : '\n\n当前服务不是本窗口启动的（可能正在被 Cursor 使用），升级会停止 :3000 上的进程。';

  const { response } = await dialog.showMessageBox({
    type: 'question',
    title: 'Git Cockpit',
    message: '发现可升级的服务端版本',
    detail: `当前 ${currentVersion} → 最新 ${latestVersion}。确认后将自动停止服务、安装 npm 包并重启（约 1～2 分钟）。${externalNote}`,
    buttons: ['升级', '稍后'],
    defaultId: 0,
    cancelId: 1
  });
  if (response !== 0) return;

  if (await daemonHasRunningJobs(health.host, secret)) {
    await dialog.showMessageBox({
      type: 'warning',
      title: 'Git Cockpit',
      message: '有任务进行中，无法升级服务。',
      detail: '请先在「任务」页等待任务结束后再试。',
      buttons: ['知道了']
    });
    return;
  }

  setHostProgress('升级服务', null);
  try {
    const stopped = await shutdownDaemon(health.host, secret);
    if (!stopped && spawnedByUs && child && !child.killed) {
      child.kill();
    }
    if (!(await waitDaemonDown(20000))) {
      throw new Error('服务未能停止。请手动关闭 git-cockpit start 或占用 :3000 的进程后再试。');
    }
    child = null;

    const spec = `${DAEMON_PKG}@${latestVersion}`;
    const preferCustom = resolvedBefore?.kind === 'custom';
    const installed = await installDaemonPackage(node.path, spec, { preferCustom });
    if (!installed.ok) {
      if (installCancelled) return;
      const hint = installed.logFile ? `\n\n完整日志：${installed.logFile}` : '';
      throw new Error(`安装服务失败。\n\n${tail(installed.output, 900)}${hint}\n\n也可手动执行：npm i -g ${spec}`);
    }

    const resolved = resolveDaemonEntry(node.path);
    const probe = resolved ? probeEntry(node.path, resolved) : null;
    if (!probe || !probe.ok) {
      throw new Error(
        `服务已安装，但仍无法运行（${resolved ? resolved.kind : '未找到入口'}）。\n\n${tail(probe ? probe.output : '', 900)}`
      );
    }

    spawnDaemon(resolved);
    const ok = await waitHealth(25000);
    if (!ok) {
      const hint = spawnLog.trim()
        ? `\n\n${spawnLog.trim().slice(-800)}`
        : `\n若 ${PORT} 已被占用，请关掉占用进程后再开。`;
      throw new Error(`服务重启后未能连接（:${PORT}）。${hint}`);
    }

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.reload();
    }
    await dialog.showMessageBox({
      type: 'info',
      title: 'Git Cockpit',
      message: `服务已升级至 ${latestVersion}。`,
      buttons: ['好的']
    });
  } catch (err) {
    const logFile = writeUpdateLog(err instanceof Error ? err.stack || err.message : String(err));
    const hint = logFile ? `\n\n日志：${logFile}` : '';
    dialog.showErrorBox('Git Cockpit', `${err instanceof Error ? err.message : String(err)}${hint}`);
  } finally {
    clearHostProgress();
  }
}

function offerDaemonUpdate() {
  if (!app.isPackaged) return;
  if (process.env.GIT_COCKPIT_DAEMON_UPDATE === '0') return;
  void (async () => {
    try {
      const health = await fetchDaemonHealth();
      if (!health.ok) return;

      const currentParsed = parseVersion(health.version);
      if (!currentParsed) return;

      const node = systemNode || findSystemNode();
      if (!node || !versionAtLeast(node.version, MIN_NODE)) return;

      const registry = fetchRegistryVersion(node.path);
      if (!registry.ok) {
        writeUpdateLog(registry.output || 'registry lookup failed');
        return;
      }

      const latestParsed = parseVersion(registry.version);
      if (!latestParsed || versionAtLeast(currentParsed, latestParsed)) return;

      await runDaemonUpgrade(health.version, registry.version);
    } catch (err) {
      writeUpdateLog(err instanceof Error ? err.stack || err.message : String(err));
    }
  })();
}
