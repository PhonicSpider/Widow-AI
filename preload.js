const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('widow', {
  // Send a message to the harness agent
  chat: (message) => ipcRenderer.invoke('harness:chat', message),

  // Wake / sleep controls
  wake: () => ipcRenderer.invoke('widow:wake'),
  sleep: () => ipcRenderer.invoke('widow:sleep'),

  // Listen for events from main process
  onStateChange:  (callback) => ipcRenderer.on('widow:state',        (_event, state)  => callback(state)),
  onResponse:     (callback) => ipcRenderer.on('harness:response',   (_event, data)   => callback(data)),
  onPanelChange:  (callback) => ipcRenderer.on('widow:panel',        (_event, panel)  => callback(panel)),
  onVoiceCommand: (callback) => ipcRenderer.on('widow:voice-command', (_event, cmd)   => callback(cmd)),
  onSessionChange:(callback) => ipcRenderer.on('widow:session',      (_event, active) => callback(active)),
  onConsoleLog:   (callback) => ipcRenderer.on('widow:console-log',  (_event, msg)    => callback(msg)),
  onMuteChange:   (callback) => ipcRenderer.on('widow:mute',         (_event, muted)  => callback(muted)),

  // Monitor control
  getCurrentMonitor: () => ipcRenderer.invoke('get-current-monitor'),
  moveToMonitor:     (n) => ipcRenderer.invoke('move-to-monitor', n),
});
