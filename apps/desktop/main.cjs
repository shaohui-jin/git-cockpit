const { app, BrowserWindow, dialog } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const PORT = Number(process.env.GIT_COCKPIT_PORT) || 3000;
const DEV_UI_PORT = Number(process.env.GIT_COCKPIT_DEV_UI_PORT) || 5173;
const HOSTS = Array.from(
  new Set([process.env.GIT_COCKPIT_HOST || '127.0.0.1', '127.0.0.1', 'localhost'])
);

let child = null;
let spawnedByUs = false;
let mainWindow = null;
let spawnLog = '';

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

function resolveRuntimeRoot() {
  const packaged = path.join(process.resourcesPath || '', 'mcp-server');
  if (fs.existsSync(path.join(packaged, 'dist', 'cli-entry.js'))) return packaged;
  const devDeploy = path.resolve(__dirname, 'runtime');
  if (fs.existsSync(path.join(devDeploy, 'dist', 'cli-entry.js'))) return devDeploy;
  return null;
}

function resolveCliEntry() {
  const extras = [
    process.env.GIT_COCKPIT_CLI,
    path.join(process.resourcesPath || '', 'mcp-server', 'dist', 'cli-entry.js'),
    path.join(process.resourcesPath || '', 'mcp-server', 'cli-entry.js'),
    path.resolve(__dirname, 'runtime', 'dist', 'cli-entry.js'),
    path.resolve(__dirname, '..', '..', 'packages', 'mcp-server', 'dist', 'cli-entry.js')
  ].filter(Boolean);
  return extras.find((p) => fs.existsSync(p)) || null;
}

function spawnDaemon() {
  const entry = resolveCliEntry();
  const runtimeRoot = resolveRuntimeRoot();
  const env = {
    ...process.env,
    GIT_COCKPIT_HOST: HOSTS[0],
    GIT_COCKPIT_PORT: String(PORT)
  };
  spawnLog = '';
  if (entry) {
    env.ELECTRON_RUN_AS_NODE = '1';
    child = spawn(process.execPath, [entry, 'start'], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: runtimeRoot || path.dirname(entry)
    });
    spawnedByUs = true;
    const onChunk = (buf) => {
      spawnLog += buf.toString();
      if (spawnLog.length > 4000) spawnLog = spawnLog.slice(-4000);
    };
    child.stdout?.on('data', onChunk);
    child.stderr?.on('data', onChunk);
    return child;
  }
  child = spawn('git-cockpit', ['start'], { env, stdio: ['ignore', 'pipe', 'pipe'], shell: true });
  spawnedByUs = true;
  const onChunk = (buf) => {
    spawnLog += buf.toString();
    if (spawnLog.length > 4000) spawnLog = spawnLog.slice(-4000);
  };
  child.stdout?.on('data', onChunk);
  child.stderr?.on('data', onChunk);
  return child;
}

async function ensureDaemon() {
  if (await probeDaemon()) {
    spawnedByUs = false;
    return;
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
  } catch (err) {
    dialog.showErrorBox('Git Cockpit', err instanceof Error ? err.message : String(err));
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
