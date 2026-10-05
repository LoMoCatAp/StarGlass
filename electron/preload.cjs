const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('starglass', {
  getState: () => ipcRenderer.invoke('get-state'),
  setRepoVisible: (repo,visible) => ipcRenderer.invoke('set-repo-visible',repo,visible),
  switchProject: index => ipcRenderer.invoke('switch-project',index),
  saveSettings: value => ipcRenderer.invoke('save-settings', value),
  setToken: value => ipcRenderer.invoke('set-token', value),
  refresh: () => ipcRenderer.invoke('refresh'),
  openSettings: () => ipcRenderer.invoke('open-settings'),
  openRepo: repo => ipcRenderer.invoke('open-repo', repo),
  hide: () => ipcRenderer.invoke('hide'),
  menu: () => ipcRenderer.invoke('menu'),
  onGlass: callback => { const listener = (_, value) => callback(value); ipcRenderer.on('glass-frame', listener); return () => ipcRenderer.removeListener('glass-frame', listener); },
  onState: callback => { const listener = (_, value) => callback(value); ipcRenderer.on('state', listener); return () => ipcRenderer.removeListener('state', listener); }
});
