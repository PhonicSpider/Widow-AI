const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('recluse', {
  // Send a message to the harness agent
  chat: (message) => ipcRenderer.invoke('harness:chat', message),

  // Wake / sleep controls
  wake: () => ipcRenderer.invoke('recluse:wake'),
  sleep: () => ipcRenderer.invoke('recluse:sleep'),

  // Listen for events from main process
  onStateChange: (callback) => ipcRenderer.on('recluse:state', (_event, state) => callback(state)),
  onResponse: (callback) => ipcRenderer.on('harness:response', (_event, data) => callback(data)),
  onPanelChange: (callback) => ipcRenderer.on('recluse:panel', (_event, panel) => callback(panel)),
});
