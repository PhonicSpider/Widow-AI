const { app, BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');

let recluseWindow = null;

function createWindow() {
  // Get all displays and pick the second one if available
  const displays = screen.getAllDisplays();
  const targetDisplay = displays.length > 1 ? displays[1] : displays[0];
  const { bounds } = targetDisplay;

  recluseWindow = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    fullscreen: true,
    frame: false,
    transparent: true,
    alwaysOnTop: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    backgroundColor: '#00000000',
  });

  recluseWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // Open DevTools in development
  // recluseWindow.webContents.openDevTools();
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// IPC handlers will be registered here as agents are built
