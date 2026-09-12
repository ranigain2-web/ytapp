// ============================================================================
// YouTube (ytapp) — macOS desktop shell (Electron, Intel x64)
// ----------------------------------------------------------------------------
// This app is FULLY SELF-CONTAINED. It bundles and runs the entire stack:
//   1. pot-provider  (bgutil PO-token server)   → 127.0.0.1:<potPort>  (default 4416)
//   2. yt-api        (YouTube API gateway)      → 127.0.0.1:<apiPort>  (default 3001)
//   3. web frontend  (static build in /web)     — served BY yt-api itself
// The window loads http://127.0.0.1:<apiPort>/ so the app is same-origin with
// its API (no CORS, no pushState/file:// issues, no external backend needed).
//
// The API base is injected into localStorage by preload.cjs BEFORE any page
// script runs (overwritten every launch, so dynamic ports stay correct).
// ============================================================================
const { app, BrowserWindow, Menu, shell } = require('electron');
const { spawn } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');

const isDev = !app.isPackaged;

// ---- Resource roots --------------------------------------------------------
// Packaged layout (electron-builder extraResources):
//   YouTube.app/Contents/Resources/{server,pot-provider,web}
// Dev layout: project root siblings of electron/
const ROOT = isDev ? path.join(__dirname, '..') : process.resourcesPath;
const SERVER_DIR = path.join(ROOT, 'server');
const POT_DIR = path.join(ROOT, 'pot-provider');
const WEB_DIR = path.join(ROOT, 'web');

const PREF_API_PORT = parseInt(process.env.YTAPP_API_PORT || '3001', 10);
const PREF_POT_PORT = parseInt(process.env.YTAPP_POT_PORT || '4416', 10);

let apiPort = PREF_API_PORT;
let potPort = PREF_POT_PORT;
let apiChild = null;
let potChild = null;
let mainWindow = null;
let backendLog = null;

const log = (...a) => console.log('[ytapp]', ...a);

// ---- Backend log (diagnosability for support/handover) --------------------
function openBackendLog() {
  try {
    const dir = path.join(app.getPath('userData'), 'logs');
    fs.mkdirSync(dir, { recursive: true });
    backendLog = fs.createWriteStream(path.join(dir, 'backend.log'), { flags: 'a' });
    backendLog.write(`\n===== ${new Date().toISOString()} launch (electron ${process.versions.electron}, node ${process.versions.node}) =====\n`);
  } catch { /* logging is best-effort */ }
}
function childLog(prefix) {
  return (data) => {
    const text = String(data).trimEnd();
    if (!text) return;
    if (backendLog) backendLog.write(`[${prefix}] ${text}\n`);
    if (isDev || process.env.YTAPP_VERBOSE) console.log(`[${prefix}]`, text);
  };
}

// ---- Free-port resolution ---------------------------------------------------
function portFree(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => srv.close(() => resolve(true)));
    srv.listen(port, '127.0.0.1');
  });
}
async function resolvePort(preferred) {
  if (await portFree(preferred)) return preferred;
  return await new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('listening', () => { const p = srv.address().port; srv.close(() => resolve(p)); });
    srv.listen(0, '127.0.0.1');
  });
}

// ---- HTTP health polling ----------------------------------------------------
function fetchText(url, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve(body));
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.on('error', reject);
  });
}
async function waitHealthy(url, needle, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const body = await fetchText(url);
      if (body.includes(needle)) return true;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

// ---- Spawn helpers (Electron binary as plain Node via ELECTRON_RUN_AS_NODE) --
function spawnNode(args, cwd, extraEnv) {
  return spawn(process.execPath, args, {
    cwd,
    env: { ...process.env, ...extraEnv, ELECTRON_RUN_AS_NODE: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
}

// ---- Backend bootstrap -------------------------------------------------------
async function startBackend() {
  openBackendLog();

  potPort = await resolvePort(PREF_POT_PORT);
  apiPort = await resolvePort(PREF_API_PORT);
  log(`ports → pot-provider:${potPort} yt-api:${apiPort}`);

  // 1) PO-token provider (bgutil)
  if (!fs.existsSync(path.join(POT_DIR, 'build', 'main.js'))) {
    throw new Error(`pot-provider missing at ${POT_DIR}`);
  }
  potChild = spawnNode(['build/main.js', '--port', String(potPort)], POT_DIR, {});
  potChild.stdout.on('data', childLog('pot'));
  potChild.stderr.on('data', childLog('pot!'));
  potChild.on('exit', (code) => log(`pot-provider exited with code ${code}`));

  const potOk = await waitHealthy(`http://127.0.0.1:${potPort}/ping`, 'server_uptime', 120000);
  if (!potOk) throw new Error('PO-token provider failed to become healthy within 120s');
  log('pot-provider healthy');

  // 2) yt-api (serves /api/* AND the static frontend)
  if (!fs.existsSync(path.join(SERVER_DIR, 'index.mjs'))) {
    throw new Error(`server missing at ${SERVER_DIR}`);
  }
  apiChild = spawnNode(['index.mjs'], SERVER_DIR, {
    PORT: String(apiPort),
    BGUTIL_URL: `http://127.0.0.1:${potPort}`,
    URL_SUFFIX: '',      // no sandbox gateway suffix inside the desktop app
    STATIC_DIR: WEB_DIR, // yt-api hosts the frontend on the same port
  });
  apiChild.stdout.on('data', childLog('api'));
  apiChild.stderr.on('data', childLog('api!'));
  apiChild.on('exit', (code) => log(`yt-api exited with code ${code}`));

  const apiOk = await waitHealthy(`http://127.0.0.1:${apiPort}/api/health`, '"ok":true', 60000);
  if (!apiOk) throw new Error('yt-api failed to become healthy within 60s');
  log('yt-api healthy — serving app at', `http://127.0.0.1:${apiPort}/`);
}

// ---- Window ------------------------------------------------------------------
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 400,
    minHeight: 400,
    backgroundColor: '#0f0f0f',
    title: 'YouTube',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      additionalArguments: [`--ytapp-api-base=http://127.0.0.1:${apiPort}`],
      spellcheck: false,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.loadURL(`http://127.0.0.1:${apiPort}/`);

  // Open target=_blank / window.open links in the system browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url) && !url.startsWith(`http://127.0.0.1:${apiPort}`)) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  // Self-heal if the renderer crashes
  mainWindow.webContents.on('render-process-gone', () => {
    log('renderer gone — reloading');
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.reload();
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

// ---- Menu --------------------------------------------------------------------
function buildMenu() {
  const template = [
    ...(process.platform === 'darwin' ? [{
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    }] : []),
    {
      label: 'File',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'closeWindow' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { role: 'front' },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---- App lifecycle ------------------------------------------------------------
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    buildMenu();
    try {
      await startBackend();
      createWindow();
    } catch (err) {
      log('FATAL:', err.message);
      const { dialog } = require('electron');
      dialog.showErrorBox(
        'YouTube failed to start',
        `The bundled backend did not start:\n\n${err.message}\n\nLogs: ~/Library/Application Support/YouTube/logs/backend.log`
      );
      app.quit();
      return;
    }
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  const killChildren = () => {
    for (const child of [apiChild, potChild]) {
      if (child && child.exitCode === null) {
        try { child.kill('SIGTERM'); } catch { /* already gone */ }
      }
    }
  };
  app.on('before-quit', killChildren);
  app.on('will-quit', () => {
    killChildren();
    if (backendLog) { backendLog.end(); backendLog = null; }
  });
}
