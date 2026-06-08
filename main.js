require('dotenv').config();

const { app, BrowserWindow, ipcMain, screen, session } = require('electron');
const path = require('path');
const { chat } = require('./src/agents/harness');
const speechListener = require('./src/speech/listener');
const speaker = require('./src/tts/speaker');
const { getDisplayMap, moveRecluseToMonitor } = require('./src/tools/system');
const state = require('./src/state');

let recluseWindow = null;

function createWindow() {
  // Monitor 1 = rightmost non-primary = Recluse's home display.
  // getDisplayMap() is safe here because createWindow() is called after app.whenReady().
  const map           = getDisplayMap();
  const targetDisplay = map[1];
  const { bounds }    = targetDisplay;

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
      webviewTag: true,
    },
    backgroundColor: '#00000000',
  });

  recluseWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // Publish window + display into shared state so tools can access them
  state.recluseWindow  = recluseWindow;
  state.currentDisplay = targetDisplay;
}

app.whenReady().then(() => {
  // Grant microphone access for TTS (renderer side)
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(permission === 'media');
  });

  createWindow();

  // Wire speaker state → Recluse UI state
  speaker.on('start', () => {
    if (recluseWindow) recluseWindow.webContents.send('recluse:state', 'SPEAKING');
  });
  speaker.on('done', () => {
    if (recluseWindow) recluseWindow.webContents.send('recluse:state', 'DORMANT');
  });

  // Start offline speech recognition
  speechListener.start();

  let inSession = false;

  speechListener.on('wake', () => {
    inSession = true;
    if (recluseWindow) {
      recluseWindow.webContents.send('recluse:state', 'LISTENING');
      recluseWindow.webContents.send('recluse:session', true);
    }
  });

  // User started speaking mid-session — shift back to LISTENING visually
  speechListener.on('active', () => {
    if (inSession && recluseWindow) {
      recluseWindow.webContents.send('recluse:state', 'LISTENING');
    }
  });

  speechListener.on('command', (command) => {
    if (recluseWindow) recluseWindow.webContents.send('recluse:voice-command', command);
  });

  // Whisper found no speech after energy trigger — put UI back to dormant
  speechListener.on('cancel', () => {
    if (inSession && recluseWindow) {
      recluseWindow.webContents.send('recluse:state', 'DORMANT');
    }
  });

  speechListener.on('sleep', async () => {
    inSession = false;
    speaker.cancel(); // cut any ongoing TTS immediately
    if (recluseWindow) {
      // speak() cancels then enqueues — speaker events handle SPEAKING/DORMANT
      await speaker.speak('Goodnight.');
      recluseWindow.webContents.send('recluse:session', false);
    }
  });

  speechListener.on('timeout', () => {
    inSession = false;
    if (recluseWindow) recluseWindow.webContents.send('recluse:state', 'DORMANT');
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  speechListener.stop();
  speaker.stop();
  if (process.platform !== 'darwin') app.quit();
});

// ============================================================
// IPC HANDLERS
// ============================================================

// Main chat handler — renderer sends a message, harness responds
ipcMain.handle('harness:chat', async (_event, userMessage) => {
  try {
    speaker.cancel(); // Cut any ongoing TTS immediately on new input
    recluseWindow.webContents.send('recluse:state', 'THINKING');

    let anySentenceEnqueued = false;

    const response = await chat(userMessage, {
      onPanel: (panel) => {
        if (recluseWindow) recluseWindow.webContents.send('recluse:panel', panel);
      },
      onSentence: (sentence) => {
        anySentenceEnqueued = true;
        speaker.enqueue(sentence);
        // speaker.on('start') → SPEAKING, speaker.on('done') → DORMANT
      },
    });

    // Full response text → transcript immediately (audio may still be playing)
    recluseWindow.webContents.send('harness:response', { userMessage, response });

    // If nothing was enqueued (e.g. tool-only turn with no spoken reply),
    // go dormant now — speaker events won't fire in that case.
    if (!anySentenceEnqueued) {
      recluseWindow.webContents.send('recluse:state', 'DORMANT');
    }

    return { success: true };
  } catch (err) {
    console.error('Harness error:', err);
    speaker.cancel();
    recluseWindow.webContents.send('recluse:state', 'DORMANT');
    recluseWindow.webContents.send('harness:response', { userMessage, response: `[Error: ${err.message}]` });
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

// Monitor awareness — renderer can query which display Recluse is currently on
ipcMain.handle('get-current-monitor', () => {
  const display = state.currentDisplay;
  if (!display) return null;
  const map = getDisplayMap();
  const monitorNumber = Object.keys(map).find(k => map[k]?.id === display.id);
  return {
    monitor: monitorNumber ? Number(monitorNumber) : null,
    bounds:  display.bounds,
    workArea: display.workArea,
    scaleFactor: display.scaleFactor,
  };
});

// Move Recluse to a different monitor (1 = rightmost, 2 = primary, 3 = leftmost)
ipcMain.handle('move-to-monitor', async (_event, monitorNumber) => {
  return moveRecluseToMonitor(monitorNumber);
});
