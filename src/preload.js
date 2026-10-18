const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('mcClient', {
  connect: cfg => ipcRenderer.invoke('connect', cfg),
  control: (control, down) => ipcRenderer.send('control', { control, down }),
  releaseControls: () => ipcRenderer.send('release-controls'),
  look: (yaw, pitch) => ipcRenderer.send('look', { yaw, pitch }),
  selectHotbar: slot => ipcRenderer.send('select-hotbar', slot),
  chat: message => ipcRenderer.send('chat', message),
  disconnect: () => ipcRenderer.send('disconnect'),
  requestState: () => ipcRenderer.send('request-state'),
  dig: action => ipcRenderer.send('dig', action),
  dismount: () => ipcRenderer.send('dismount'),
  inventoryRequest: () => ipcRenderer.send('inventory-request'),
  inventoryOpenTable: () => ipcRenderer.send('inventory-open-table'),
  inventoryClick: payload => ipcRenderer.send('inventory-click', payload),
  inventoryGive: (name,count) => ipcRenderer.send('inventory-give',{name,count}),
  inventoryCraft: payload => ipcRenderer.send('inventory-craft',payload),
  onInventory: cb => ipcRenderer.on('inventory-data', (_e,v) => cb(v)),
  onState: cb => ipcRenderer.on('bot-state', (_e, v) => cb(v)),
  onStatus: cb => ipcRenderer.on('connection-status', (_e, v) => cb(v)),
  onViewer: cb => ipcRenderer.on('viewer-url', (_e, v) => cb(v))
});