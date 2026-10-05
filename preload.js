const { contextBridge, ipcRenderer } = require('electron');
const IN = ['state', 'level', 'amp', 'score', 'wake', 'status'];
contextBridge.exposeInMainWorld('orb', {
  on: (ch, fn) => IN.includes(ch) && ipcRenderer.on(ch, (_e, ...a) => fn(...a)),
  getConfig: () => ipcRenderer.invoke('get-config'),
  saveConfig: (c) => ipcRenderer.invoke('save-config', c),
  pickModel: () => ipcRenderer.invoke('pick-model'),
  launch: (u) => ipcRenderer.send('launch', u),
  launchAll: () => ipcRenderer.send('launch-all'),
  ignore: (b) => ipcRenderer.send('ignore', b),
  dragStart: () => ipcRenderer.send('drag-start'),
  dragMove: (dx, dy) => ipcRenderer.send('drag-move', dx, dy),
  dragEnd: () => ipcRenderer.send('drag-end'),
  quit: () => ipcRenderer.send('quit'),
});
