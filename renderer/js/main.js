// renderer/js/main.js — Widow UI controller

// ============================================================
// STATE
// ============================================================

const State = {
  DORMANT:   'DORMANT',
  LISTENING: 'LISTENING',
  THINKING:  'THINKING',
  SPEAKING:  'SPEAKING',
  WORKING:   'WORKING',
};

let currentState = State.DORMANT;
let inSession    = false;

// ============================================================
// ELEMENTS
// ============================================================

const statusText          = document.getElementById('status-text');
const muteIndicator       = document.getElementById('mute-indicator');
const transcriptEl        = document.getElementById('transcript-inner');
const transcriptContainer = document.getElementById('transcript');
const widowCore         = document.getElementById('widow-core');
const sidePanel           = document.getElementById('side-panel');
const panelTitle          = document.getElementById('panel-title');
const panelContent        = document.getElementById('panel-content');
const panelWebview        = document.getElementById('panel-webview');
const chatBar             = document.getElementById('chat-bar');
const chatInput           = document.getElementById('chat-input');
const chatSend            = document.getElementById('chat-send');
const consoleToggle       = document.getElementById('console-toggle');
const devToggle           = document.getElementById('dev-toggle');
const sysConsole          = document.getElementById('sys-console');
const sysConsoleInner     = document.getElementById('sys-console-inner');

// ============================================================
// DEV MODE
// ============================================================

let devMode = false;

devToggle.addEventListener('click', () => {
  devMode = !devMode;
  devToggle.classList.toggle('active', devMode);
});

// ============================================================
// ELECTRON ORB — active tool tracking
// ============================================================
// The harness fires onConsoleLog messages with a '▸' prefix when a tool
// starts and a '✓' prefix when it finishes. We count these to maintain
// an activeToolCount and drive the electron orb display.

let activeToolCount = 0;
let codingToolCount = 0;   // ▸ coding: / ✓ coding: pairs — drives rainbow mode
let orbClearTimer   = null;

function setActiveToolCount(n) {
  activeToolCount = Math.max(0, n);

  if (activeToolCount > 0) {
    clearTimeout(orbClearTimer);
    orbClearTimer = null;
    document.body.classList.add('tools-active');
    if (window.ElectronOrbs) ElectronOrbs.setCount(activeToolCount);
  } else {
    clearTimeout(orbClearTimer);
    orbClearTimer = setTimeout(() => {
      orbClearTimer = null;
      if (activeToolCount === 0) {
        document.body.classList.remove('tools-active');
        if (window.ElectronOrbs) ElectronOrbs.setCount(0);
      }
    }, 1500);
  }
}

function updateCodingMode(delta) {
  codingToolCount = Math.max(0, codingToolCount + delta);
  if (window.ElectronOrbs) {
    ElectronOrbs.setMode(codingToolCount > 0 ? 'rainbow' : 'default');
  }
}

// ============================================================
// STATE MANAGEMENT
// ============================================================

function setState(state) {
  currentState = state;

  // Session-dormant: widow is awake but quiet — show "READY" instead of "DORMANT"
  const displayState = (state === State.DORMANT && inSession) ? 'READY' : state;
  statusText.textContent = displayState;
  statusText.classList.remove('active');

  if (state === State.LISTENING) {
    statusText.classList.add('active');
    chatInput.focus();
  } else if (state === State.SPEAKING) {
    statusText.classList.add('active');
  } else if (state === State.THINKING) {
    statusText.classList.add('active');
  } else if (state === State.WORKING) {
    statusText.textContent = 'WORKING...';
    statusText.classList.add('active');
  }

  // Body classes for CSS state hooks
  document.body.classList.toggle('in-session', inSession);
  const active = state === State.WORKING || state === State.THINKING || state === State.SPEAKING;
  document.body.classList.toggle('state-active', active);

  // Sync 3D orb — add/remove working class on the orb container
  const orbContainer = document.getElementById('orb-container');
  if (orbContainer) {
    orbContainer.classList.toggle('orb--working', state === State.WORKING);
  }
  if (window.Orb3D) Orb3D.setState(state);

  // When fully dormant: clear everything — cancels any debounce timer first
  // so the hold delay doesn't re-show orbs after state is already DORMANT
  if (state === State.DORMANT) {
    clearTimeout(orbClearTimer);
    orbClearTimer   = null;
    activeToolCount = 0;
    codingToolCount = 0;
    document.body.classList.remove('tools-active');
    if (window.ElectronOrbs) ElectronOrbs.reset();
  }

  // Disable input while thinking, working, or speaking
  const busy = state === State.THINKING || state === State.SPEAKING || state === State.WORKING;
  chatInput.disabled = busy;
  chatSend.disabled = busy;
}

// ============================================================
// TRANSCRIPT
// ============================================================

function addTranscriptLine(text, role = 'widow') {
  const line = document.createElement('div');
  line.classList.add('transcript-line', role);
  line.textContent = role === 'widow' ? `> ${text}` : text;
  transcriptEl.appendChild(line);

  const lines = transcriptEl.querySelectorAll('.transcript-line');
  if (lines.length > 8) lines[0].remove();

  transcriptEl.scrollTop = transcriptEl.scrollHeight;
}

// ============================================================
// CHAT — send message to harness
// ============================================================

async function sendMessage() {
  const message = chatInput.value.trim();
  if (!message || currentState === State.THINKING || currentState === State.WORKING) return;

  chatInput.value = '';
  setState(State.THINKING);
  addTranscriptLine(message, 'user');

  await window.widow.chat(message);
}

chatSend.addEventListener('click', sendMessage);

chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

// ============================================================
// SIDE PANEL
// ============================================================

function openPanel(title, content, url) {
  panelTitle.textContent = title;

  if (url) {
    panelWebview.src = url;
    panelWebview.classList.remove('hidden');
    panelContent.classList.add('hidden');
  } else {
    panelContent.innerHTML = content || '';
    panelContent.classList.remove('hidden');
    panelWebview.classList.add('hidden');
  }

  sidePanel.classList.remove('hidden');
  requestAnimationFrame(() => sidePanel.classList.add('visible'));
  widowCore.classList.add('panel-open');
  chatBar.classList.add('panel-open');
  transcriptContainer.classList.add('panel-open');
  document.body.classList.add('panel-open');
}

function closePanel() {
  sidePanel.classList.remove('visible');
  widowCore.classList.remove('panel-open');
  chatBar.classList.remove('panel-open');
  transcriptContainer.classList.remove('panel-open');
  document.body.classList.remove('panel-open');
  setTimeout(() => {
    sidePanel.classList.add('hidden');
    panelWebview.src = 'about:blank';
    panelWebview.classList.add('hidden');
    panelContent.classList.remove('hidden');
  }, 800);
}

// ============================================================
// MUTE
// ============================================================

function setMuted(muted) {
  document.body.classList.toggle('muted', muted);
  if (window.CatHeadphones) {
    muted ? CatHeadphones.show() : CatHeadphones.hide();
  }
}

// ============================================================
// 3D ORB — init on load
// ============================================================

window.addEventListener('load', () => {
  if (window.Orb3D) Orb3D.init('orb-container');
  if (window.CatHeadphones) CatHeadphones.init('orb-container');
});

window.addEventListener('resize', () => {
  if (window.Orb3D) {
    Orb3D.resize('orb-container');
  }
});

// ============================================================
// EMBER PARTICLES
// ============================================================

const particleContainer = document.getElementById('ember-particles');
const EMBER_COUNT = 18;

function createEmber() {
  const el = document.createElement('div');
  el.classList.add('ember');
  const size = Math.random() * 3 + 1;
  const x = Math.random() * 100;
  const duration = Math.random() * 8 + 6;
  const delay = Math.random() * 10;
  const drift = (Math.random() - 0.5) * 200;
  const colors = ['#e84800', '#f07000', '#f5a000', '#ffd000', '#cc1100'];
  const color = colors[Math.floor(Math.random() * colors.length)];

  el.style.cssText = `
    width: ${size}px;
    height: ${size}px;
    left: ${x}vw;
    bottom: -10px;
    background: ${color};
    box-shadow: 0 0 ${size * 2}px ${color};
    --drift: ${drift}px;
    animation-duration: ${duration}s;
    animation-delay: ${delay}s;
  `;

  particleContainer.appendChild(el);

  setTimeout(() => {
    el.remove();
    createEmber();
  }, (duration + delay) * 1000);
}

for (let i = 0; i < EMBER_COUNT; i++) createEmber();

// TTS is handled by the main process via edge-tts (scripts/tts_speak.py).
// DORMANT state is set by main.js after audio finishes — nothing to do here.

// ============================================================
// CONSOLE TOGGLE
// ============================================================

consoleToggle.addEventListener('click', () => {
  const hidden = transcriptContainer.classList.toggle('console-hidden');
  chatBar.classList.toggle('console-hidden', hidden);
  consoleToggle.classList.toggle('active', !hidden);
  document.body.classList.toggle('console-hidden', hidden);

  // Also show/hide the sys-console overlay
  if (sysConsole) {
    sysConsole.classList.toggle('sys-console-hidden', hidden);
  }
});

// ============================================================
// SYS-CONSOLE — append log lines from harness tool execution
// ============================================================

const MAX_CONSOLE_LINES = 200;

function appendConsoleLine(msg) {
  if (!sysConsoleInner) return;

  const line = document.createElement('div');
  line.classList.add('console-line');
  line.textContent = msg;
  sysConsoleInner.appendChild(line);

  // Cap at MAX_CONSOLE_LINES — remove from top
  const lines = sysConsoleInner.querySelectorAll('.console-line');
  if (lines.length > MAX_CONSOLE_LINES) {
    lines[0].remove();
  }

  // Auto-scroll to bottom
  if (sysConsole) {
    sysConsole.scrollTop = sysConsole.scrollHeight;
  }

  // ── Electron orb tracking ──
  // '▸' prefix = tool started  → increment active tool count
  // '✓' prefix = tool finished → decrement active tool count
  // '▸ coding:' / '✓ coding:' sub-prefix → switch to rainbow mode
  if (msg.startsWith('▸')) {
    setActiveToolCount(activeToolCount + 1);
    if (msg.startsWith('▸ coding:')) updateCodingMode(+1);
  } else if (msg.startsWith('✓')) {
    setActiveToolCount(activeToolCount - 1);
    if (msg.startsWith('✓ coding:')) updateCodingMode(-1);
  }
}

// ============================================================
// IPC — Wire up to main process
// ============================================================

if (window.widow) {
  window.widow.onStateChange((state) => {
    // Don't interrupt an active response with a LISTENING state from speech detection
    if (state === 'LISTENING' && (currentState === State.THINKING || currentState === State.SPEAKING)) return;
    setState(state);
  });

  window.widow.onResponse((data) => {
    if (data.response) addTranscriptLine(data.response, 'widow');
    if (data.panel)    openPanel(data.panel.title, data.panel.content, data.panel.url);
  });

  window.widow.onPanelChange((panel) => {
    if (panel) openPanel(panel.title, panel.content, panel.url);
    else closePanel();
  });

  window.widow.onVoiceCommand(async (command) => {
    if (currentState === State.THINKING || currentState === State.SPEAKING || currentState === State.WORKING) return;
    addTranscriptLine(command, 'user');
    setState(State.THINKING);
    await window.widow.chat(command);
  });

  window.widow.onSessionChange((active) => {
    inSession = active;
    // Re-apply setState so the status label and body class update immediately
    setState(currentState);
  });

  // Harness tool-execution log lines → sys-console overlay + electron orb counter.
  // Lines prefixed with '» ' are step narrations — also shown in the transcript.
  window.widow.onConsoleLog((msg) => {
    appendConsoleLine(msg);
    if (msg.startsWith('» ')) {
      addTranscriptLine(msg.slice(2).trim(), 'working');
    }
  });

  window.widow.onMuteChange((muted) => {
    setMuted(muted);
  });
}

// ============================================================
// DEV — keyboard shortcuts
// ============================================================

document.addEventListener('keydown', (e) => {
  if (e.target === chatInput) return;
  if (!devMode) return;

  if (e.key === '1') setState(State.DORMANT);
  if (e.key === '2') setState(State.LISTENING);
  if (e.key === '3') setState(State.THINKING);
  if (e.key === '4') setState(State.SPEAKING);
  if (e.key === '5') setState(State.WORKING);
  if (e.key === '6') addTranscriptLine('Open the RSM project for me.', 'user');
  if (e.key === '7') addTranscriptLine('Sure. Though I\'d have opened it faster if you\'d asked nicely.', 'widow');
  if (e.key === '8') openPanel('WORKSPACE — RSM', '<pre style="color:#f07000;font-size:12px">// ronin-server-manager\n// main.js loaded\n\nReady.</pre>');
  if (e.key === '9') closePanel();
  if (e.key === '0') appendConsoleLine('▸ test_tool — {"path": "/some/file.txt"}');

  if (e.key === '+' || e.key === '=') setActiveToolCount(activeToolCount + 1);
  if (e.key === '-') setActiveToolCount(Math.max(0, activeToolCount - 1));
  if (e.key === 'Backspace') setActiveToolCount(0);
});
