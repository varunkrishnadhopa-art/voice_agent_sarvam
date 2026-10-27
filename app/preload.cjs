const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('voiceApp', {
  bootstrap: () => ipcRenderer.invoke('app:bootstrap'),
  save: settings => ipcRenderer.invoke('settings:save', settings),
  devices: () => ipcRenderer.invoke('agent:devices'),
  start: settings => ipcRenderer.invoke('agent:start', settings),
  stop: () => ipcRenderer.invoke('agent:stop'),
  tone: settings => ipcRenderer.invoke('agent:tone', settings),
  onEvent: callback => { const listener = (_event, value) => callback(value);
    ipcRenderer.on('agent:event', listener);
    return () => ipcRenderer.removeListener('agent:event', listener); }
});
