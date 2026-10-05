const { app, BrowserWindow, ipcMain, dialog, shell, screen } = require('electron');
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');

if (!app.requestSingleInstanceLock()) app.quit();

const WAKE_DIR = app.isPackaged ? path.join(process.resourcesPath, 'wake') : path.join(__dirname, 'wake');
const CFG = path.join(app.getPath('userData'), 'config.json');
const DEFAULTS = {
  model: '', callName: '', threshold: 0.5, wakeHoldSec: 8,
  autostart: true, python: process.platform === 'win32' ? 'python' : 'python3',
  urls: [],            // [{ url, auto }]
  pos: null,
};
let cfg = { ...DEFAULTS };
try { cfg = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(CFG, 'utf8')) }; } catch {}
const saveCfg = () => { fs.mkdirSync(path.dirname(CFG), { recursive: true }); fs.writeFileSync(CFG, JSON.stringify(cfg, null, 2)); };

let win, sidecar, stopping = false, holdTimer, dragStart;
const W = 300, H = 560;
const send = (ch, ...a) => win && !win.isDestroyed() && win.webContents.send(ch, ...a);
const status = (text, kind = 'info') => send('status', { text, kind });

function createWindow() {
  const wa = screen.getPrimaryDisplay().workArea;
  let { x, y } = cfg.pos || { x: wa.x + wa.width - W - 24, y: wa.y + 24 };
  const d = screen.getDisplayMatching({ x, y, width: W, height: H }).workArea;
  x = Math.max(d.x - 40, Math.min(x, d.x + d.width - W + 40));
  y = Math.max(d.y - 20, Math.min(y, d.y + d.height - 120));
  win = new BrowserWindow({
    x, y, width: W, height: H, transparent: true, frame: false, alwaysOnTop: true,
    skipTaskbar: true, resizable: false, hasShadow: false, backgroundColor: '#00000000',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setIgnoreMouseEvents(true, { forward: true });   // click-through until pointer is over orb/panel
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

function setState(s, hold) {
  if (!['idle', 'listening', 'speaking'].includes(s)) return;
  clearTimeout(holdTimer);
  send('state', s);
  if (hold > 0) holdTimer = setTimeout(() => send('state', 'idle'), hold * 1000);
}

// ---- Python: run a script, stream lines ----------------------------------
function run(args, onLine) {
  return new Promise((resolve) => {
    const p = spawn(cfg.python, args, { windowsHide: true });
    let buf = '';
    const feed = (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { onLine && onLine(buf.slice(0, i).trim()); buf = buf.slice(i + 1); } };
    p.stdout.on('data', feed); p.stderr.on('data', feed);
    p.on('error', () => resolve({ code: -1, p: null }));
    p.on('close', (code) => resolve({ code, p }));
  });
}

async function ensureDeps() {
  status('Checking wake-word packages…');
  const { code } = await run([path.join(WAKE_DIR, 'ensure_deps.py')], (l) => l && status(l));
  if (code === -1) { status(`Python not found ("${cfg.python}"). Install Python 3.9+ and restart.`, 'error'); return false; }
  if (code !== 0) { status('Package install failed — see log lines above.', 'error'); return false; }
  return true;
}

function startSidecar() {
  stopSidecar(); stopping = false;
  if (!cfg.model || !fs.existsSync(cfg.model) || !cfg.callName) { status('Setup needed: pick your .onnx file and call name.', 'setup'); send('status', { text: '', kind: 'setup' }); return; }
  sidecar = spawn(cfg.python, [path.join(WAKE_DIR, 'wake_sidecar.py'), '--model', cfg.model, '--threshold', String(cfg.threshold)], { windowsHide: true });
  let buf = '';
  sidecar.stdout.on('data', (d) => {
    buf += d; let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      try {
        const m = JSON.parse(line);
        if (m.type === 'level') send('level', m.v);
        else if (m.type === 'score') send('score', m.v);
        else if (m.type === 'wake') { send('wake', m.score); setState('listening', cfg.wakeHoldSec); }
        else if (m.type === 'ready') status(`Listening for “${cfg.callName}”`, 'ok');
        else if (m.type === 'error') status(m.msg, 'error');
      } catch {}
    }
  });
  sidecar.stderr.on('data', () => {});
  sidecar.on('close', () => { sidecar = null; if (!stopping) setTimeout(startSidecar, 3000); });
}
function stopSidecar() { stopping = true; if (sidecar) { sidecar.kill(); sidecar = null; } }

// ---- URLs / autostart -------------------------------------------------------
const safeOpen = (u) => { try { const p = new URL(u); if (['http:', 'https:'].includes(p.protocol)) shell.openExternal(p.href); } catch {} };
const launchUrls = (onlyAuto) => cfg.urls.filter((u) => !onlyAuto || u.auto).forEach((u, i) => setTimeout(() => safeOpen(u.url), i * 700));
const applyLogin = () => { try { app.setLoginItemSettings({ openAtLogin: !!cfg.autostart }); } catch {} };

// ---- Local control API for your assistant -------------------------------------
// POST http://127.0.0.1:17890/state {"state":"speaking"}   |   /amp {"level":0.6}
function startApi() {
  http.createServer((req, res) => {
    let b = ''; req.on('data', (d) => (b += d));
    req.on('end', () => {
      try {
        const j = b ? JSON.parse(b) : {};
        if (req.url === '/state') setState(j.state, j.hold);
        else if (req.url === '/amp') send('amp', Math.max(0, Math.min(1, +j.level || 0)));
        res.end('ok');
      } catch { res.statusCode = 400; res.end('bad'); }
    });
  }).listen(17890, '127.0.0.1');
}

// ---- IPC ---------------------------------------------------------------------------
ipcMain.handle('get-config', () => cfg);
ipcMain.handle('save-config', (_e, c) => {
  const restart = c.model !== cfg.model || c.threshold !== cfg.threshold;
  cfg = { ...cfg, model: c.model, callName: c.callName, threshold: +c.threshold || 0.5, autostart: !!c.autostart,
          urls: (c.urls || []).filter((u) => u.url).map((u) => ({ url: u.url, auto: !!u.auto })) };
  saveCfg(); applyLogin();
  if (restart || !sidecar) startSidecar(); else status(`Listening for “${cfg.callName}”`, 'ok');
  return cfg;
});
ipcMain.handle('pick-model', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Select wake-word model', filters: [{ name: 'ONNX', extensions: ['onnx'] }], properties: ['openFile'] });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.on('launch', (_e, u) => safeOpen(u));
ipcMain.on('launch-all', () => launchUrls(false));
ipcMain.on('ignore', (_e, b) => win && win.setIgnoreMouseEvents(b, { forward: true }));
ipcMain.on('drag-start', () => { const [x, y] = win.getPosition(); dragStart = { x, y }; });
ipcMain.on('drag-move', (_e, dx, dy) => dragStart && win.setPosition(Math.round(dragStart.x + dx), Math.round(dragStart.y + dy)));
ipcMain.on('drag-end', () => { const [x, y] = win.getPosition(); cfg.pos = { x, y }; saveCfg(); dragStart = null; });
ipcMain.on('quit', () => app.quit());

app.whenReady().then(async () => {
  createWindow(); startApi(); applyLogin();
  win.webContents.once('did-finish-load', async () => {
    launchUrls(true);                         // auto-launch your server links
    if (await ensureDeps()) startSidecar();   // skip install if packages already present
  });
});
app.on('before-quit', stopSidecar);
app.on('window-all-closed', () => app.quit());
