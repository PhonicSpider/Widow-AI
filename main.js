require('dotenv').config();

const { app, BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');
const { chat } = require('./src/agents/harness');

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

  // Uncomment to debug:
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

// ============================================================
// IPC HANDLERS
// ============================================================

// Main chat handler — renderer sends a message, harness responds
ipcMain.handle('harness:chat', async (_event, userMessage) => {
  try {
    // Tell the renderer we're thinking
    recluseWindow.webContents.send('recluse:state', 'THINKING');

    const response = await chat(userMessage);

    // Tell the renderer we're speaking
    recluseWindow.webContents.send('recluse:state', 'SPEAKING');

    // Send the response back
    recluseWindow.webContents.send('harness:response', {
      userMessage,
      response,
    });

    // Back to dormant after a delay
    setTimeout(() => {
      recluseWindow.webContents.send('recluse:state', 'DORMANT');
    }, 3000);

    return { success: true };
  } catch (err) {
    console.error('Harness error:', err);
    recluseWindow.webContents.send('recluse:state', 'DORMANT');
    return { success: false, error: err.message };
  }
});

// Wake / sleep
ipcMain.handle('recluse:wake', () => {
  recluseWindow.webContents.send('recluse:state', 'LISTENING');
});

ipcMain.handle('recluse:sleep', () => {
  recluseWindow.webContents.send('recluse:state', 'DORMANT');
});