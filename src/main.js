const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
const http = require('node:http');
const mineflayer = require('mineflayer');
const { mineflayer: startViewer } = require('prismarine-viewer');

let win;
let bot;
let viewerStarted = false;
let closing = false;
const VIEWER_PORT = Number(process.env.VIEWER_PORT || 3007);
const controls = new Set();
const allowedControls = new Set(['forward', 'back', 'left', 'right', 'jump', 'sprint', 'sneak']);

function send(channel, data) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, data);
}
function stateSnapshot() {
  if (!bot) return { connected: false };
  const items = bot.inventory?.slots || [];
  const quickbar = items.slice(36, 45).map((item, i) => item ? ({ name: item.name, displayName: item.displayName || item.name, count: item.count, slot: i }) : null);
  return {
    connected: bot.player?.username ? true : Boolean(bot.entity),
    username: bot.username,
    health: Number.isFinite(bot.health) ? bot.health : 20,
    food: Number.isFinite(bot.food) ? bot.food : 20,
    experience: bot.experience ? bot.experience.progress : 0,
    level: bot.experience ? bot.experience.level : 0,
    gameMode: bot.game?.gameMode ?? null,
    heldItem: bot.heldItem ? { name: bot.heldItem.name, displayName: bot.heldItem.displayName || bot.heldItem.name, count: bot.heldItem.count } : null,
    quickbar,
    position: bot.entity?.position ? { x: bot.entity.position.x, y: bot.entity.position.y, z: bot.entity.position.z } : null
  };
}
function publishState() { send('bot-state', stateSnapshot()); }
function clearControls() {
  if (bot) for (const c of controls) { try { bot.setControlState(c, false); } catch {} }
  controls.clear();
}
function closeBot() {
  clearControls();
  if (bot) {
    try { bot.removeAllListeners(); bot.quit('Client closed'); } catch {}
    bot = null;
  }
  viewerStarted = false;
}
function viewerHealthy() {
  return new Promise(resolve => {
    const req = http.get(`http://127.0.0.1:${VIEWER_PORT}/`, res => { res.resume(); resolve(res.statusCode >= 200 && res.statusCode < 500); });
    req.setTimeout(700, () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
  });
}
function createWindow() {
  win = new BrowserWindow({ fullscreen: true, autoHideMenuBar: true, backgroundColor: '#000000', title: 'Voxel Desktop Client', webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false } });
  win.loadFile(path.join(__dirname, 'index.html'));
  win.on('blur', clearControls);
  win.on('closed', () => { win = null; closeBot(); });
}
app.whenReady().then(createWindow);
app.on('before-quit', () => { closing = true; closeBot(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

ipcMain.handle('connect', async (_event, cfg) => {
  closeBot();
  const host = String(cfg?.host || '').trim();
  const port = Number(cfg?.port || 25565);
  const username = String(cfg?.username || 'DesktopPlayer').trim().slice(0, 32);
  const version = String(cfg?.version || 'auto').trim();
  const auth = cfg?.auth === 'microsoft' ? 'microsoft' : 'offline';
  if (!host) throw new Error('Enter a server address first.');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Port must be between 1 and 65535.');
  send('connection-status', { status: 'connecting', message: `Connecting to ${host}:${port}…` });
  try {
    bot = mineflayer.createBot({ host, port, username, version: version === 'auto' ? false : version, auth, hideErrors: false });
  } catch (err) { send('connection-status', { status: 'error', message: err.message }); throw err; }
  const current = bot;
  current.once('login', () => send('connection-status', { status: 'connected', message: `Logged in as ${current.username}` }));
  current.once('spawn', async () => {
    try {
      const alreadyRunning = await viewerHealthy();
      if (!alreadyRunning) startViewer(current, { port: VIEWER_PORT, firstPerson: true, viewDistance: 8 });
      viewerStarted = true;
      send('viewer-url', `http://127.0.0.1:${VIEWER_PORT}/`);
      send('connection-status', { status: 'connected', message: 'World loaded. Click the game view to lock the mouse.' });
      publishState();
    } catch (err) { send('connection-status', { status: 'error', message: `Viewer failed: ${err.message}` }); }
  });
  for (const event of ['health', 'food', 'experience', 'heldItemChanged', 'playerCollect', 'windowUpdate', 'game']) current.on(event, publishState);
  current.on('inventory', publishState);
  current.on('kicked', reason => { clearControls(); send('connection-status', { status: 'disconnected', message: `Kicked: ${typeof reason === 'string' ? reason : JSON.stringify(reason)}` }); });
  current.on('end', reason => { clearControls(); send('connection-status', { status: 'disconnected', message: `Disconnected${reason ? `: ${reason}` : ''}` }); send('bot-state', { connected: false }); });
  current.on('error', err => send('connection-status', { status: 'error', message: err.message }));
  return { ok: true };
});
ipcMain.on('control', (_event, payload) => {
  if (!bot || !bot.entity || !payload || !allowedControls.has(payload.control)) return;
  const down = Boolean(payload.down);
  try {
    if (down && !controls.has(payload.control)) { controls.add(payload.control); bot.setControlState(payload.control, true); }
    else if (!down && controls.has(payload.control)) { controls.delete(payload.control); bot.setControlState(payload.control, false); }
  } catch {}
});
ipcMain.on('release-controls', clearControls);
ipcMain.on('look', (_event, payload) => {
  if (!bot || !bot.entity || !Number.isFinite(payload?.yaw) || !Number.isFinite(payload?.pitch)) return;
  const yaw = payload.yaw;
  const pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, payload.pitch));
  bot.look(yaw, pitch, true).catch(() => {});
});
ipcMain.on('select-hotbar', (_event, slot) => {
  if (bot && Number.isInteger(slot) && slot >= 0 && slot <= 8) bot.setQuickBarSlot(slot);
});
ipcMain.on('chat', (_event, message) => {
  if (bot && typeof message === 'string' && message.trim()) { try { bot.chat(message.slice(0, 256)); } catch {} }
});
ipcMain.on('disconnect', () => { closeBot(); send('bot-state', { connected: false }); send('connection-status', { status: 'disconnected', message: 'Disconnected.' }); });
ipcMain.on('request-state', publishState);
ipcMain.on('dig', (_event, action) => {
  if (!bot || !bot.entity) return;
  try {
    if (action === 'start') {
      const target = typeof bot.entityAtCursor === 'function' ? bot.entityAtCursor(5) : null;
      if (target && target.type === 'mob' && target.isValid !== false) {
        bot.attack(target, true);
      } else {
        const block = bot.blockAtCursor(5);
        if (block && block.name !== 'air') bot.dig(block, true).catch(() => {});
      }
    } else if (action === 'place') {
      const item = bot.heldItem;
      const block = bot.blockAtCursor(5);
      if (item && block) bot.placeBlock(block, { x: 0, y: 1, z: 0 }).catch(() => {});
    }
  } catch {}
});
