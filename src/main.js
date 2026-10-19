const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
const http = require('node:http');
const fs = require('node:fs');
const mineflayer = require('mineflayer');
let mcDataFactory;
try { mcDataFactory = require('minecraft-data'); } catch {}
const { mineflayer: startViewer } = require('prismarine-viewer');

let win;
let bot;
let viewerStarted = false;
let closing = false;
const VIEWER_PORT = Number(process.env.VIEWER_PORT || 3007);
const controls = new Set();
const allowedControls = new Set(['forward', 'back', 'left', 'right', 'jump', 'sprint', 'sneak']);

const chatLogPath = () => path.join(app.getPath('userData'), 'chat.log');
function recordChat(message, type = 'chat') {
  const entry = { timestamp: new Date().toISOString(), type, message: String(message ?? '') };
  try { fs.appendFileSync(chatLogPath(), JSON.stringify(entry) + '\\n', 'utf8'); } catch (err) { console.warn('Could not write chat log:', err.message); }
  send('chat-log', entry);
}
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
    inventory: items.map((item, slot) => item ? ({ name:item.name, displayName:item.displayName || item.name, count:item.count, slot }) : null),
    position: bot.entity?.position ? { x: bot.entity.position.x, y: bot.entity.position.y, z: bot.entity.position.z } : null,
    vehicle: bot.vehicle ? { name: bot.vehicle.name || bot.vehicle.displayName || 'vehicle', type: bot.vehicle.type || 'unknown' } : null
  };
}
function publishState() { send('bot-state', stateSnapshot()); }
function clearControls() {
  if (bot) for (const c of controls) { try { bot.setControlState(c, false); } catch {} }
  controls.clear();
  updateVehicleMovement();
}
function updateVehicleMovement() {
  if (!bot || !bot.entity || !bot.vehicle || typeof bot.moveVehicle !== 'function') return;
  const left = controls.has('left') ? 1 : controls.has('right') ? -1 : 0;
  const forward = controls.has('forward') ? 1 : controls.has('back') ? -1 : 0;
  try { bot.moveVehicle(left, forward); } catch {}
}
function isRideableEntity(entity) {
  if (!entity) return false;
  const name = String(entity.name || entity.displayName || '').toLowerCase().replace(/[ -]/g, '_');
  return /(?:^|_)(?:boat|raft|minecart|horse|donkey|mule|pig|strider|camel|skeleton_horse|zombie_horse|llama|trader_llama)(?:$|_)/.test(name)
    || /(?:boat|minecart|horse|donkey|mule|pig|strider|camel|llama)/.test(name);
}
async function tryMountTarget() {
  if (!bot || !bot.entity) return false;
  const target = typeof bot.entityAtCursor === 'function' ? bot.entityAtCursor(5) : null;
  if (!target || !isRideableEntity(target)) return false;
  try {
    if (typeof bot.activateEntity === 'function') await bot.activateEntity(target);
    else if (typeof bot.activateEntityAt === 'function') await bot.activateEntityAt(target);
    else { send('connection-status', { status: 'connected', message: 'This Mineflayer build does not expose entity interaction for mounting.' }); return true; }
    send('connection-status', { status: 'connected', message: `Interacting with ${target.name || 'rideable entity'}… If mountable, the server will attach you.` });
    return true;
  } catch (err) {
    send('connection-status', { status: 'connected', message: `Could not mount: ${err.message || err}` });
    return true;
  }
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

ipcMain.handle('supported-versions', () => [
  '1.21.4',
  '1.21.1',
  '1.20.1',
  '1.19',
  '1.18.1',
  '1.17.1',
  '1.16.4',
  '1.16.1',
  '1.15.2',
  '1.14.4',
  '1.13.2',
  '1.12.2',
  '1.11.2',
  '1.10.2',
  '1.9.4',
  '1.8.8'
]);

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
  current.on('messagestr', message => recordChat(message, 'server'));
  current.on('mount', () => { updateVehicleMovement(); publishState(); send('connection-status', { status: 'connected', message: `Mounted ${current.vehicle?.name || 'vehicle'}. Use WASD/arrows to steer and Shift to dismount.` }); });
  current.on('dismount', () => { clearControls(); publishState(); });
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
    if (down && !controls.has(payload.control)) { controls.add(payload.control); if (bot.vehicle) updateVehicleMovement(); else bot.setControlState(payload.control, true); }
    else if (!down && controls.has(payload.control)) { controls.delete(payload.control); if (bot.vehicle) updateVehicleMovement(); else bot.setControlState(payload.control, false); }
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
  if (bot && typeof message === 'string' && message.trim()) { const text = message.slice(0, 256); try { bot.chat(text); recordChat(`<${bot.username}> ${text}`, 'outgoing'); } catch {} }
});
ipcMain.on('disconnect', () => { closeBot(); send('bot-state', { connected: false }); send('connection-status', { status: 'disconnected', message: 'Disconnected.' }); });
ipcMain.on('request-state', publishState);

function publishInventory() {
  if (!bot) return;
  let items = [];
  try {
    const version = bot.version || bot._client?.version;
    const data = mcDataFactory && mcDataFactory(version);
    if (data?.itemsArray) items = data.itemsArray.map(item => ({ name:item.name, displayName:item.displayName || item.name, count:64, type:item.id }));
  } catch {}
  send('inventory-data', { state: stateSnapshot(), items });
}
ipcMain.on('inventory-open-table', async () => {
  if (!bot || !bot.entity) return;
  try {
    const table = bot.findBlock({ matching:b=>b && b.name==='crafting_table', maxDistance:4 });
    if (!table) { send('connection-status',{status:'connected',message:'No crafting table found within 4 blocks.'}); return; }
    if (!bot.openWorkbench) { send('connection-status',{status:'connected',message:'Crafting-table support is unavailable for this protocol.'}); return; }
    await bot.openWorkbench(table);
    publishInventory();
  } catch (err) { send('connection-status',{status:'connected',message:`Could not open crafting table: ${err.message}`}); }
});
ipcMain.on('inventory-request', () => {
  if (!bot) return;
  publishInventory();
  try {
    const block = bot.findBlock({ matching: b => b && b.name === 'crafting_table', maxDistance: 4 });
    if (block && !bot.currentWindow && bot.openWorkbench) {
      // Do not open the physical table just because the inventory screen was opened.
    }
  } catch {}
});
ipcMain.on('inventory-click', (_event, payload) => {
  if (!bot || !payload || !Number.isInteger(Number(payload.slot))) return;
  const slot = Number(payload.slot);
  if (payload.kind === 'crafting' || payload.kind === 'crafting-result') return;
  try {
    if (bot.currentWindow && typeof bot.clickWindow === 'function') {
      bot.clickWindow(slot, payload.button === 1 ? 1 : 0, payload.mode || 0).then(publishInventory).catch(err => send('connection-status',{status:'connected',message:`Inventory click failed: ${err.message}`}));
    } else if (typeof bot.clickWindow === 'function' && slot >= 0 && slot < 46) {
      bot.clickWindow(slot, payload.button === 1 ? 1 : 0, 0).then(publishInventory).catch(err => send('connection-status',{status:'connected',message:`Inventory click failed: ${err.message}`}));
    }
  } catch (err) { send('connection-status',{status:'connected',message:`Inventory click failed: ${err.message}`}); }
});
ipcMain.on('inventory-give', (_event, payload) => {
  if (!bot || !payload || !bot.creative || typeof bot.creative.setInventorySlot !== 'function') return;
  const gameMode = String(bot.game?.gameMode ?? '').toLowerCase();
  if (!(gameMode === '1' || gameMode === 'creative' || gameMode === 'creative_mode')) {
    send('connection-status',{status:'connected',message:'The server must put you in Creative mode to create items.'}); return;
  }
  try {
    const data = mcDataFactory && mcDataFactory(bot.version);
    const definition = data?.itemsByName?.[String(payload.name)];
    if (!definition) return;
    const count = Math.max(1, Math.min(64, Number(payload.count) || 1));
    const slot = 36 + (bot.quickBarSlot || 0);
    bot.creative.setInventorySlot(slot, {type:definition.id,count,metadata:0,nbt:null}).then(publishInventory).catch(err=>send('connection-status',{status:'connected',message:`Creative item request failed: ${err.message}`}));
  } catch (err) { send('connection-status',{status:'connected',message:`Creative item request failed: ${err.message}`}); }
});
ipcMain.on('inventory-craft', async (_event, payload) => {
  if (!bot || !bot.entity) return;
  try {
    let table = null;
    if (payload?.craftingTable) {
      table = bot.findBlock({ matching:b=>b && b.name==='crafting_table', maxDistance:4 });
      if (!table) { send('connection-status',{status:'connected',message:'Place a crafting table nearby to craft 3×3 recipes.'}); return; }
    }
    const recipes = bot.recipesFor(bot.heldItem?.type || 0, null, 1, table);
    if (!recipes?.length) { send('connection-status',{status:'connected',message:'No matching recipe found for the current ingredients.'}); return; }
    if (table && bot.openWorkbench) {
      const window = await bot.openWorkbench(table);
      await bot.craft(recipes[0], 1, window);
      window.close();
    } else {
      await bot.craft(recipes[0], 1, null);
    }
    publishState(); publishInventory();
  } catch (err) { send('connection-status',{status:'connected',message:`Crafting failed: ${err.message}`}); }
});
ipcMain.on('dismount', () => {
  if (!bot || !bot.entity || !bot.vehicle || typeof bot.dismount !== 'function') return;
  try { bot.dismount(); send('connection-status', { status: 'connected', message: 'Dismount requested.' }); } catch (err) { send('connection-status', { status: 'connected', message: `Could not dismount: ${err.message || err}` }); }
});
ipcMain.on('dig', (_event, action) => {
  if (!bot || !bot.entity) return;
  try {
    if (action === 'stop') {
      if (typeof bot.stopDigging === 'function') bot.stopDigging();
      return;
    }
    if (action === 'start') {
      const target = typeof bot.entityAtCursor === 'function' ? bot.entityAtCursor(5) : null;
      if (target && target.type === 'mob' && target.isValid !== false) {
        bot.attack(target, true);
        return;
      }
      const block = bot.blockAtCursor(5);
      if (block && block.name !== 'air' && block.boundingBox !== 'empty' && typeof bot.dig === 'function') {
        bot.dig(block, true).catch(err => send('connection-status', { status:'connected', message:`Could not break block: ${err.message}` }));
      }
      return;
    }
    if (action === 'place') {
      tryMountTarget().then(async mountedOrHandled => {
        if (mountedOrHandled || !bot || !bot.entity) return;
        const item = bot.heldItem;
        const block = bot.blockAtCursor(5);
        if (!item) { send('connection-status',{status:'connected',message:'Select a block in your hotbar to place it.'}); return; }
        if (!block || block.name === 'air' || block.boundingBox === 'empty') { send('connection-status',{status:'connected',message:'Aim at a solid block face to place a block.'}); return; }
        // Mineflayer requires the outward face vector of the targeted block.
        const yaw = bot.entity.yaw || 0;
        const pitch = bot.entity.pitch || 0;
        const dir = { x: -Math.sin(yaw) * Math.cos(pitch), y: -Math.sin(pitch), z: -Math.cos(yaw) * Math.cos(pitch) };
        const Vec3 = require('vec3').Vec3;
        // The face vector points outward from the targeted block, opposite the look ray.
        let face;
        if (Math.abs(dir.x) >= Math.abs(dir.y) && Math.abs(dir.x) >= Math.abs(dir.z)) face = new Vec3(dir.x > 0 ? -1 : 1, 0, 0);
        else if (Math.abs(dir.y) >= Math.abs(dir.x) && Math.abs(dir.y) >= Math.abs(dir.z)) face = new Vec3(0, dir.y > 0 ? -1 : 1, 0);
        else face = new Vec3(0, 0, dir.z > 0 ? -1 : 1);
        await bot.placeBlock(block, face);
      }).catch(err => send('connection-status',{status:'connected',message:`Could not place block: ${err.message || err}`}));
    }
  } catch (err) { send('connection-status',{status:'connected',message:`Action failed: ${err.message || err}`}); }
});
