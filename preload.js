'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// Безопасный мост: renderer видит только эти методы, без доступа к Node.
contextBridge.exposeInMainWorld('api', {
  accounts: {
    list: () => ipcRenderer.invoke('accounts:list'),
    importCurrent: () => ipcRenderer.invoke('accounts:importCurrent'),
    addManual: (apiKey, label) => ipcRenderer.invoke('accounts:addManual', { apiKey, label }),
    delete: (id) => ipcRenderer.invoke('accounts:delete', { id }),
    rename: (id, label) => ipcRenderer.invoke('accounts:rename', { id, label }),
  },
  limits: {
    fetch: (id, force) => ipcRenderer.invoke('limits:fetch', { id, force }),
  },
  switchAndLaunch: (id) => ipcRenderer.invoke('account:switchAndLaunch', { id }),
});
