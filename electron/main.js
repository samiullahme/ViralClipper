// electron/main.js — Electron main process entry point.
// Creates the window, registers the vc:// media protocol, wires IPC handlers,
// and kicks off the first-run binary check (ffmpeg / embedded python).
const path = require('path');
const fs = require('fs');
const { app, BrowserWindow, protocol, net, shell } = require('electron');
const { pathToFileURL } = require('url');
const { buildPaths } = require('./paths');
const { initDb } = require('./db');
const { registerIpcHandlers } = require('./ipcHandlers');
const binaries = require('./binaries');

// ---- Custom protocol must be registered before app.ready --------------------
// vc:// streams local video/image files into <video>/<img> tags with Range
// support so seeking works. Only whitelisted media extensions are served.
protocol.registerSchemesAsPrivileged([
  { scheme: 'vc', privileges: { secure: true, supportFetchAPI: true, stream: true } },
]);

const MEDIA_EXT = new Set([
  '.mp4', '.mkv', '.mov', '.avi', '.webm', '.m4v',
  '.jpg', '.jpeg', '.png', '.webp', '.gif', '.ico',
]);

let mainWindow = null;
const P = {}; // resolved paths, filled on ready

/** Decode a vc:// URL back to an absolute filesystem path. */
function vcUrlToPath(rawUrl) {
  try {
    const u = new URL(rawUrl);
    let p = decodeURIComponent(u.pathname); // "/C:/Users/foo/bar.mp4"
    if (/^\/[A-Za-z]:/.test(p)) p = p.slice(1); // strip leading slash on Windows
    return path.normalize(p);
  } catch {
    return null;
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1160,
    minHeight: 760,
    backgroundColor: '#0f0f0f',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  if (process.env.VITE_DEV) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(() => {
  Object.assign(P, buildPaths());

  // Ensure writable folders exist.
  for (const d of [P.dbDir, P.thumbsDir, P.previewsDir, P.tmpDir]) {
    fs.mkdirSync(d, { recursive: true });
  }

  // Serve local media over vc:// with Range support (needed for video seek).
  protocol.handle('vc', (request) => {
    const fp = vcUrlToPath(request.url);
    if (!fp) return new Response('bad url', { status: 400 });
    const ext = path.extname(fp).toLowerCase();
    if (!MEDIA_EXT.has(ext)) return new Response('forbidden', { status: 403 });
    if (!fs.existsSync(fp)) return new Response('not found', { status: 404 });
    return net.fetch(pathToFileURL(fp).toString(), { headers: request.headers });
  });

  initDb(P.dbFile);
  registerIpcHandlers(P, () => mainWindow);
  createWindow();

  // First-run convenience: quietly verify ffmpeg/python; auto-download missing
  // pieces (streams progress events to the renderer).
  binaries.ensure((s) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('binaries:progress', s);
      if (s.done || s.error) {
        mainWindow.webContents.send('binaries:status', binaries.status());
      }
    }
  }).catch(() => {});
});

app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => {
  // Kill any running child processes (ffmpeg export / whisper transcription).
  require('./ipcHandlers').shutdown();
});
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
