const { app, BrowserWindow, dialog, shell } = require('electron');
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const NODE_DOWNLOAD = 'https://nodejs.org/en/download';
const MIN_NODE = [22, 5, 0];
const SQLITE_UNFLAGGED = [22, 13, 0];

const PORT = Number(process.env.GIT_COCKPIT_PORT) || 3000;
const DEV_UI_PORT = Number(process.env.GIT_COCKPIT_DEV_UI_PORT) || 5173;
const HOSTS = Array.from(
  new Set([process.env.GIT_COCKPIT_HOST || '127.0.0.1', '127.0.0.1', 'localhost'])
);

let child = null;
let spawnedByUs = false;
let mainWindow = null;
let spawnLog = '';
let systemNode = null;

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

async function waitHealth(ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await probeDaemon()) return true;
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

function parseVersion(raw) {
  const m = String(raw).trim().match(/(\d+)\.(\d+)\.(\d+)/);
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
  return found.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
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

function resolveGlobalEntry(nodePath) {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const prefix = spawnSync(npm, ['prefix', '-g'], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 20000,
    shell: process.platform === 'win32',
    env: pathWithNode(nodePath)
  });
  if (prefix.status !== 0) return null;
  const entry = path.join(
    prefix.stdout.trim(),
    'node_modules',
    '@shaohui_jin',
    'git-cockpit-mcp-server',
    'dist',
    'cli-entry.js'
  );
  return fs.existsSync(entry) ? entry : null;
}

function attachSpawnLog(proc) {
  const onChunk = (buf) => {
    spawnLog += buf.toString();
    if (spawnLog.length > 4000) spawnLog = spawnLog.slice(-4000);
  };
  proc.stdout?.on('data', onChunk);
  proc.stderr?.on('data', onChunk);
}

function spawnDaemon() {
  const nodePath = systemNode.path;
  const env = pathWithNode(nodePath);
  if (!versionAtLeast(systemNode.version, SQLITE_UNFLAGGED)) {
    env.NODE_OPTIONS = [env.NODE_OPTIONS, '--experimental-sqlite'].filter(Boolean).join(' ');
  }
  spawnLog = '';
  const devEntry = resolveDevEntry();
  const entry = devEntry || resolveGlobalEntry(nodePath);
  if (entry) {
    child = spawn(nodePath, [entry, 'start'], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: path.resolve(path.dirname(entry), '..'),
      windowsHide: true
    });
  } else {
    const shim = whereCommand('git-cockpit')[0];
    if (!shim) {
      throw new Error(
        '没有找到 git-cockpit。安装包不带服务。\n\n请先执行：\nnpm i -g @shaohui_jin/git-cockpit-mcp-server\n\n然后重新打开。'
      );
    }
    child = spawn(shim, ['start'], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
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
    await promptNode('没有在 PATH 里找到 node。请安装 Node.js 22 或更高版本后再打开。使用 nvm 时，需要让 node 出现在系统 PATH 中。');
    throw new Error('__node_prompted__');
  }
  if (!versionAtLeast(systemNode.version, MIN_NODE)) {
    await promptNode(`当前是 Node.js ${formatVersion(systemNode.version)}。请安装 22 或更高版本后再打开。`);
    throw new Error('__node_prompted__');
  }
  spawnDaemon();
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
  mainWindow.setTitle(`Git Cockpit · ${origin}`);
  void mainWindow.loadURL(url);
  mainWindow.on('closed', () => {
    mainWindow = null;
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
    offerUpdate();
  } catch (err) {
    if (!(err instanceof Error) || err.message !== '__node_prompted__') {
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
    mainWindow.setTitle(`Git Cockpit · ${origin}`);
  });
});

app.on('window-all-closed', () => {
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
          if (response === 0) void autoUpdater.downloadUpdate();
        })
        .catch(() => undefined);
    });
    autoUpdater.on('update-downloaded', () => {
      const extra = spawnedByUs
        ? ''
        : '\n\n本窗口没有拉起 :3000。若外部 git-cockpit start 占着端口，请先自己关掉它。';
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
  }
  autoUpdater.checkForUpdates().catch(() => undefined);
}
