const { app } = require('electron');
const path   = require('path');

// In packaged builds .env is copied to resources/ via extraResources;
// in dev it lives in the project root alongside main.js.
require('dotenv').config({
  path: app.isPackaged
    ? path.join(process.resourcesPath, '.env')
    : path.join(__dirname, '.env'),
});

const { BrowserWindow, ipcMain, screen, session, globalShortcut } = require('electron');
const http   = require('http');
const { spawn } = require('child_process');
const { chat } = require('./src/agents/harness');
const speechListener = require('./src/speech/listener');
const speaker = require('./src/tts/speaker');
const { getDisplayMap, moveWidowToMonitor } = require('./src/tools/system');
const state = require('./src/state');

// ============================================================
// CHATTERBOX AUTO-START
// ============================================================

function isChatterboxRunning() {
  const base = process.env.CHATTERBOX_URL || 'http://localhost:8004';
  return new Promise((resolve) => {
    const req = http.get(`${base}/api/model-info`, { timeout: 2000 }, (res) => {
      resolve(res.statusCode < 500);
    });
    req.on('error',   () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

async function waitForChatterbox(maxMs = 90_000) {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    if (await isChatterboxRunning()) return true;
    await new Promise(r => setTimeout(r, 2500));
  }
  return false;
}

async function ensureChatterbox() {
  if (await isChatterboxRunning()) {
    console.log('[Chatterbox] Already running');
    return;
  }

  const dir    = process.env.CHATTERBOX_DIR || 'D:\\Widow files\\Chatterbox-TTS-Server';
  // Use the embedded Python that ships with the portable Chatterbox install —
  // it has all dependencies pre-installed. Spawn server.py directly, bypassing
  // start.bat entirely so no CMD window appears.
  const embeddedPython = path.join(dir, 'python_embedded', 'python.exe');
  const embeddedDir    = path.join(dir, 'python_embedded');

  console.log(`[Chatterbox] Not running — starting from ${dir}`);

  // Prepend the embedded Python dir to PATH so native DLLs resolve correctly.
  const env = {
    ...process.env,
    PATH: `${embeddedDir};${path.join(embeddedDir, 'Scripts')};${process.env.PATH || ''}`,
  };

  const proc = spawn(embeddedPython, ['server.py'], {
    cwd:         dir,
    detached:    true,
    stdio:       'ignore',
    windowsHide: true,
    env,
  });
  proc.unref();

  console.log('[Chatterbox] Waiting for server to become ready...');
  const ready = await waitForChatterbox(90_000);
  if (ready) {
    console.log('[Chatterbox] Ready');
  } else {
    console.warn('[Chatterbox] Did not become ready within 90s — TTS may not work');
  }
}

let widowWindow    = null;
let micMuted       = false;
let harnessRunning = false;  // true while chat() is executing — gates DORMANT on speaker 'done'

function createWindow() {
  // Monitor 1 = rightmost non-primary = Widow's home display.
  // getDisplayMap() is safe here because createWindow() is called after app.whenReady().
  const map           = getDisplayMap();
  const targetDisplay = map[1];
  const { bounds }    = targetDisplay;

  widowWindow = new BrowserWindow({
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

  widowWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // DevTools — Ctrl+Shift+I opens inspector in both dev and packaged builds
  widowWindow.webContents.on('before-input-event', (event, input) => {
    if (input.control && input.shift && input.key === 'I') {
      widowWindow.webContents.toggleDevTools();
    }
  });

  // Publish window + display into shared state so tools can access them
  state.widowWindow  = widowWindow;
  state.currentDisplay = targetDisplay;
}

app.whenReady().then(async () => {
  await ensureChatterbox();

  // Grant microphone access for TTS (renderer side)
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(permission === 'media');
  });

  createWindow();

  // Wire speaker state → Widow UI state
  speaker.on('start', () => {
    if (widowWindow) widowWindow.webContents.send('widow:state', 'SPEAKING');
  });
  speaker.on('done', () => {
    // Only go DORMANT if the harness has finished — if it's still running tools,
    // the narration TTS ending should not drop us out of WORKING state.
    if (widowWindow && !harnessRunning) {
      widowWindow.webContents.send('widow:state', 'DORMANT');
    }
  });

  // ── Mic mute toggle — Right Control + NumPad 5 ──────────────────────────────
  // globalShortcut does not distinguish left vs right modifier keys on Windows;
  // this shortcut fires on either Ctrl key. Use Right Ctrl by habit to avoid
  // accidental triggers in games (Left Ctrl is common for crouch/run).
  const registered = globalShortcut.register('Control+num5', () => {
    micMuted = !micMuted;
    if (widowWindow) widowWindow.webContents.send('widow:mute', micMuted);
    console.log(`[Mute] mic ${micMuted ? 'MUTED' : 'unmuted'}`);
  });
  if (!registered) console.warn('[Mute] Could not register Control+num5 — another app may own it.');

  // Start offline speech recognition
  speechListener.start();

  let inSession = false;

  speechListener.on('wake', () => {
    if (micMuted) return;
    inSession = true;
    if (widowWindow) {
      widowWindow.webContents.send('widow:state', 'LISTENING');
      widowWindow.webContents.send('widow:session', true);
    }
  });

  // User started speaking mid-session — shift back to LISTENING visually
  speechListener.on('active', () => {
    if (micMuted) return;
    if (inSession && widowWindow) {
      widowWindow.webContents.send('widow:state', 'LISTENING');
    }
  });

  speechListener.on('command', (command) => {
    if (micMuted) return;
    if (widowWindow) widowWindow.webContents.send('widow:voice-command', command);
  });

  // Whisper found no speech after energy trigger — put UI back to dormant
  speechListener.on('cancel', () => {
    if (inSession && widowWindow) {
      widowWindow.webContents.send('widow:state', 'DORMANT');
    }
  });

  speechListener.on('sleep', async () => {
    inSession = false;
    speaker.cancel(); // cut any ongoing TTS immediately
    if (widowWindow) {
      // speak() cancels then enqueues — speaker events handle SPEAKING/DORMANT
      await speaker.speak('Goodnight.');
      widowWindow.webContents.send('widow:session', false);
    }
  });

  speechListener.on('timeout', () => {
    inSession = false;
    if (widowWindow) widowWindow.webContents.send('widow:state', 'DORMANT');
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  globalShortcut.unregisterAll();
  speechListener.stop();
  speaker.stop();
  if (process.platform !== 'darwin') app.quit();
});

// ============================================================
// IPC HANDLERS
// ============================================================

// Main chat handler — renderer sends a message, harness responds
ipcMain.handle('harness:chat', async (_event, userMessage) => {
  harnessRunning = true;
  try {
    speaker.cancel(); // Cut any ongoing TTS immediately on new input
    widowWindow.webContents.send('widow:state', 'THINKING');

    let anySentenceEnqueued = false;

    const response = await chat(userMessage, {
      onPanel: (panel) => {
        if (widowWindow) widowWindow.webContents.send('widow:panel', panel);
      },
      onSentence: (sentence) => {
        anySentenceEnqueued = true;
        speaker.enqueue(sentence);
        // speaker.on('start') → SPEAKING, speaker.on('done') → DORMANT
      },
      onStateChange: (newState) => {
        if (widowWindow) widowWindow.webContents.send('widow:state', newState);
      },
      onConsoleLog: (msg) => {
        if (widowWindow) widowWindow.webContents.send('widow:console-log', msg);
      },
    });

    // Full response text → transcript immediately (audio may still be playing)
    widowWindow.webContents.send('harness:response', { userMessage, response });

    // If nothing was enqueued (e.g. tool-only turn with no spoken reply),
    // go dormant now — speaker events won't fire in that case.
    if (!anySentenceEnqueued) {
      widowWindow.webContents.send('widow:state', 'DORMANT');
    }

    return { success: true };
  } catch (err) {
    console.error('Harness error:', err);
    speaker.cancel();
    widowWindow.webContents.send('widow:state', 'DORMANT');
    widowWindow.webContents.send('harness:response', { userMessage, response: `[Error: ${err.message}]` });
    return { success: false, error: err.message };
  } finally {
    harnessRunning = false;
    // If TTS already drained while the harness was mid-run (speaker.on('done') was
    // suppressed), it won't fire again — send DORMANT here to avoid getting stuck.
    if (!speaker.busy && widowWindow) {
      widowWindow.webContents.send('widow:state', 'DORMANT');
    }
  }
});

// Wake / sleep
ipcMain.handle('widow:wake', () => {
  widowWindow.webContents.send('widow:state', 'LISTENING');
});

ipcMain.handle('widow:sleep', () => {
  widowWindow.webContents.send('widow:state', 'DORMANT');
});

// Monitor awareness — renderer can query which display Widow is currently on
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

// Move Widow to a different monitor (1 = rightmost, 2 = primary, 3 = leftmost)
ipcMain.handle('move-to-monitor', async (_event, monitorNumber) => {
  return moveWidowToMonitor(monitorNumber);
});
