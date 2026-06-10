const { clipboard, screen } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const state = require('../state');

// ============================================================
// CONFIGURATION
// ============================================================

const CFG = {
  python:            'D:\\Python\\python.exe',
  windowPlaceScript: path.join(__dirname, '../../scripts/window_place.py'),

  // Timeouts for Python window-placement calls (ms)
  openNativeTimeoutMs: 25_000,
  moveWindowTimeoutMs: 15_000,

  // Must mirror the panel CSS geometry so snap coordinates stay accurate:
  //   top: 4vh, right: 1.5vw, width: 58vw, height: 92vh
  panel: {
    topVh:    0.04,
    rightVw:  0.015,
    widthVw:  0.58,
    heightVh: 0.92,
    headerH:  44,   // px — #panel-header (padding + font + border)
  },
};

function getTime() {
  const now = new Date();
  return {
    date:      now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
    time:      now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    timezone:  Intl.DateTimeFormat().resolvedOptions().timeZone,
    timestamp: now.toISOString(),
  };
}

function getClipboard() {
  const text = clipboard.readText();
  return { content: text || '(clipboard is empty)', length: text.length };
}

function getSystemInfo() {
  const total = os.totalmem();
  const free  = os.freemem();
  const used  = total - free;
  return {
    hostname:       os.hostname(),
    platform:       os.platform(),
    cpuModel:       os.cpus()[0]?.model || 'unknown',
    cpuCores:       os.cpus().length,
    totalMemGB:     (total / 1024 ** 3).toFixed(2),
    usedMemGB:      (used  / 1024 ** 3).toFixed(2),
    memUsedPercent: ((used / total) * 100).toFixed(1),
    uptimeHours:    (os.uptime() / 3600).toFixed(1),
  };
}

function openApp(name) {
  try {
    const proc = spawn('powershell.exe', [
      '-NoProfile', '-WindowStyle', 'Normal', '-Command', `Start-Process '${name.replace(/'/g, "''")}'`
    ], { detached: true, stdio: 'ignore' });
    proc.unref();
    return { success: true, launched: name };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// Calculate the panel's actual screen pixel coordinates.
// Values are driven by CFG.panel to stay in sync with the CSS geometry.
function getPanelBounds() {
  let display;
  if (state.widowWindow) {
    const b = state.widowWindow.getBounds();
    display  = screen.getDisplayNearestPoint({ x: b.x + Math.round(b.width / 2), y: b.y + Math.round(b.height / 2) });
  } else {
    display = state.currentDisplay || screen.getPrimaryDisplay();
  }
  const { x: dx, y: dy, width: dw, height: dh } = display.bounds;
  const { topVh, rightVw, widthVw, heightVh } = CFG.panel;

  const panelW = Math.round(dw * widthVw);
  const panelH = Math.round(dh * heightVh);
  const panelX = Math.round(dx + dw - dw * rightVw - panelW);
  const panelY = Math.round(dy + dh * topVh);

  return { x: panelX, y: panelY, width: panelW, height: panelH };
}

// Launch a native app and snap its window over the panel.
// Returns a Promise that resolves once the window is placed (or timeout).
function openNativeInPanel(appName, hint) {
  const panel  = getPanelBounds();
  const x      = panel.x;
  const y      = panel.y + CFG.panel.headerH;
  const width  = panel.width;
  const height = panel.height - CFG.panel.headerH;
  const args   = [CFG.windowPlaceScript, appName, String(x), String(y), String(width), String(height)];
  if (hint) args.push(hint);

  console.log('[NativePanel] bounds:', { x, y, width, height }, 'app:', appName);

  return new Promise((resolve) => {
    const proc = spawn(CFG.python, ['-u', ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let out = '';
    proc.stdout.on('data', d => { out += d.toString(); });
    proc.stderr.on('data', d => { process.stderr.write(d); });

    const timer = setTimeout(() => {
      proc.kill();
      resolve({ success: false, error: 'timeout', app: appName });
    }, CFG.openNativeTimeoutMs);

    proc.on('exit', () => {
      clearTimeout(timer);
      const placed = out.trim().includes('PLACED');
      resolve({ success: placed, app: appName });
    });
  });
}

// Internal helper — all displays sorted left-to-right.
function getAllDisplays() {
  const primary    = screen.getPrimaryDisplay();
  const nonPrimary = screen.getAllDisplays()
    .filter(d => d.id !== primary.id)
    .sort((a, b) => a.bounds.x - b.bounds.x);
  return [primary, ...nonPrimary];
}

// Maps human monitor numbers to displays. Recalculated on every call so
// runtime display changes (plug/unplug) are always reflected.
//   1 = rightmost display (highest bounds.x)  — Widow's home
//   2 = Windows primary display
//   3 = leftmost display (lowest bounds.x, 3rd monitor)
function getDisplayMap() {
  const all        = screen.getAllDisplays();
  const primary    = screen.getPrimaryDisplay();
  const nonPrimary = all
    .filter(d => d.id !== primary.id)
    .sort((a, b) => a.bounds.x - b.bounds.x); // leftmost → rightmost

  return {
    1: nonPrimary.length     ? nonPrimary[nonPrimary.length - 1] : primary, // rightmost
    2: primary,
    3: nonPrimary.length > 1 ? nonPrimary[0]                    : null,     // leftmost (only if 3+ monitors)
  };
}

// Return the workArea of monitor N using the 1/2/3 mapping. Falls back to primary.
function getDisplayBounds(monitorNumber) {
  const map     = getDisplayMap();
  const display = map[monitorNumber];
  if (!display) {
    console.warn(`[Monitor] Monitor ${monitorNumber} not found`);
    return screen.getPrimaryDisplay().workArea;
  }
  return display.workArea;
}

// Move Widow's window to a different monitor and reposition all tracked overlays.
async function moveWidowToMonitor(monitorNumber) {
  const map    = getDisplayMap();
  const target = map[monitorNumber];

  if (!target) {
    console.warn(`[Monitor] Monitor ${monitorNumber} not found`);
    return { success: false, error: `Monitor ${monitorNumber} not found` };
  }

  const win     = state.widowWindow;
  const oldDisp = state.currentDisplay;

  if (!win) return { success: false, error: 'Widow window not initialised' };

  const { bounds: nb } = target;

  // Exit fullscreen → reposition → re-enter fullscreen on new display
  win.setFullScreen(false);
  await Promise.race([
    new Promise(r => win.once('leave-full-screen', r)),
    new Promise(r => setTimeout(r, 1000)),
  ]);
  win.setBounds({ x: nb.x, y: nb.y, width: nb.width, height: nb.height });
  win.setFullScreen(true);

  state.currentDisplay = target;

  // Reposition each tracked overlay using the same relative offset
  if (oldDisp && state.overlayWindows.length > 0) {
    await new Promise(r => setTimeout(r, 400)); // let fullscreen settle first
    const { bounds: ob } = oldDisp;
    for (const overlay of state.overlayWindows) {
      const newBounds = {
        x:      nb.x + (overlay.bounds.x - ob.x),
        y:      nb.y + (overlay.bounds.y - ob.y),
        width:  overlay.bounds.width,
        height: overlay.bounds.height,
      };
      await moveWindow(overlay.hint, newBounds, true);
      overlay.bounds = newBounds;
    }
  }

  return { success: true, monitor: monitorNumber, bounds: nb };
}

// Calculate the target rect for a named snap zone within a display workArea.
function getSnapBounds(workArea, position = 'center') {
  const { x, y, width: W, height: H } = workArea;
  const h2 = Math.round(H / 2), w2 = Math.round(W / 2);
  const w3 = Math.round(W / 3);

  switch (position) {
    case 'full':          return { x, y, width: W,      height: H  };
    case 'left':
    case 'left-half':     return { x, y, width: w2,     height: H  };
    case 'right':
    case 'right-half':    return { x: x + w2,  y, width: W - w2,   height: H  };
    case 'top-left':      return { x, y, width: w2,     height: h2 };
    case 'top-right':     return { x: x + w2,  y, width: W - w2,   height: h2 };
    case 'bottom-left':   return { x, y: y + h2, width: w2,     height: H - h2 };
    case 'bottom-right':  return { x: x + w2, y: y + h2, width: W - w2, height: H - h2 };
    case 'left-third':    return { x, y, width: w3,     height: H  };
    case 'center-third':  return { x: x + w3, y, width: w3,     height: H  };
    case 'right-third':   return { x: x + w3 * 2, y, width: W - w3 * 2, height: H };
    default:
    case 'center': {
      const cw = Math.round(W * 0.8), ch = Math.round(H * 0.8);
      return { x: x + Math.round((W - cw) / 2), y: y + Math.round((H - ch) / 2), width: cw, height: ch };
    }
  }
}

// Find an already-open window by title hint and move it — no launch.
function moveWindow(hint, targetBounds, topmost = false) {
  const { x, y, width, height } = targetBounds;
  const args = [CFG.windowPlaceScript, '-', String(x), String(y), String(width), String(height), hint, topmost ? '1' : '0'];

  console.log('[MoveWindow] hint:', hint, 'target:', targetBounds, 'topmost:', topmost);

  return new Promise((resolve) => {
    const proc = spawn(CFG.python, ['-u', ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let out = '';
    proc.stdout.on('data', d => { out += d.toString(); });
    proc.stderr.on('data', d => { process.stderr.write(d); });

    const timer = setTimeout(() => {
      proc.kill();
      resolve({ success: false, error: 'timeout' });
    }, CFG.moveWindowTimeoutMs);

    proc.on('exit', () => {
      clearTimeout(timer);
      resolve({ success: out.trim().includes('PLACED') });
    });
  });
}

module.exports = {
  getTime, getClipboard, getSystemInfo, openApp,
  openNativeInPanel, moveWindow, moveWidowToMonitor,
  getPanelBounds, getAllDisplays, getDisplayMap, getDisplayBounds, getSnapBounds,
};
