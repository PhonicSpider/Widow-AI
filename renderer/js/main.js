// renderer/js/main.js — Recluse UI controller

// ============================================================
// STATE
// ============================================================

const State = {
  DORMANT:   'DORMANT',
  LISTENING: 'LISTENING',
  THINKING:  'THINKING',
  SPEAKING:  'SPEAKING',
};

let currentState = State.DORMANT;
let inSession    = false;

// ============================================================
// ELEMENTS
// ============================================================

const statusText          = document.getElementById('status-text');
const transcriptEl        = document.getElementById('transcript-inner');
const transcriptContainer = document.getElementById('transcript');
const recluseCore         = document.getElementById('recluse-core');
const sidePanel           = document.getElementById('side-panel');
const panelTitle          = document.getElementById('panel-title');
const panelContent        = document.getElementById('panel-content');
const panelWebview        = document.getElementById('panel-webview');
const chatBar             = document.getElementById('chat-bar');
const chatInput           = document.getElementById('chat-input');
const chatSend            = document.getElementById('chat-send');
const consoleToggle       = document.getElementById('console-toggle');

// ============================================================
// STATE MANAGEMENT
// ============================================================

function setState(state) {
  currentState = state;

  // Session-dormant: recluse is awake but quiet — show "READY" instead of "DORMANT"
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
  }

  // Body class lets CSS subtly distinguish session-dormant from true dormant
  document.body.classList.toggle('in-session', inSession);

  // Sync 3D orb
  if (window.Orb3D) Orb3D.setState(state);

  // Disable input while thinking or speaking
  const busy = state === State.THINKING || state === State.SPEAKING;
  chatInput.disabled = busy;
  chatSend.disabled = busy;
}

// ============================================================
// TRANSCRIPT
// ============================================================

function addTranscriptLine(text, role = 'recluse') {
  const line = document.createElement('div');
  line.classList.add('transcript-line', role);
  line.textContent = role === 'recluse' ? `> ${text}` : text;
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
  if (!message || currentState === State.THINKING) return;

  chatInput.value = '';
  setState(State.THINKING);
  addTranscriptLine(message, 'user');

  await window.recluse.chat(message);
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
  recluseCore.classList.add('panel-open');
  chatBar.classList.add('panel-open');
  transcriptContainer.classList.add('panel-open');
}

function closePanel() {
  sidePanel.classList.remove('visible');
  recluseCore.classList.remove('panel-open');
  chatBar.classList.remove('panel-open');
  transcriptContainer.classList.remove('panel-open');
  setTimeout(() => {
    sidePanel.classList.add('hidden');
    panelWebview.src = 'about:blank';
    panelWebview.classList.add('hidden');
    panelContent.classList.remove('hidden');
  }, 800);
}

// ============================================================
// 3D ORB — init on load
// ============================================================

window.addEventListener('load', () => {
  if (window.Orb3D) Orb3D.init('orb-container');
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
});

// ============================================================
// IPC — Wire up to main process
// ============================================================

if (window.recluse) {
  window.recluse.onStateChange((state) => {
    // Don't interrupt an active response with a LISTENING state from speech detection
    if (state === 'LISTENING' && (currentState === State.THINKING || currentState === State.SPEAKING)) return;
    setState(state);
  });

  window.recluse.onResponse((data) => {
    if (data.response) addTranscriptLine(data.response, 'recluse');
    if (data.panel)    openPanel(data.panel.title, data.panel.content, data.panel.url);
  });

  window.recluse.onPanelChange((panel) => {
    if (panel) openPanel(panel.title, panel.content, panel.url);
    else closePanel();
  });

  window.recluse.onVoiceCommand(async (command) => {
    if (currentState === State.THINKING || currentState === State.SPEAKING) return;
    addTranscriptLine(command, 'user');
    setState(State.THINKING);
    await window.recluse.chat(command);
  });

  window.recluse.onSessionChange((active) => {
    inSession = active;
    // Re-apply setState so the status label and body class update immediately
    setState(currentState);
  });
}

// ============================================================
// DEV — keyboard shortcuts
// ============================================================

document.addEventListener('keydown', (e) => {
  if (e.target === chatInput) return;

  if (e.key === '1') setState(State.DORMANT);
  if (e.key === '2') setState(State.LISTENING);
  if (e.key === '3') setState(State.THINKING);
  if (e.key === '4') setState(State.SPEAKING);
  if (e.key === '5') addTranscriptLine('Open the RSM project for me.', 'user');
  if (e.key === '6') addTranscriptLine('Sure. Though I\'d have opened it faster if you\'d asked nicely.', 'recluse');
  if (e.key === '7') openPanel('WORKSPACE — RSM', '<pre style="color:#f07000;font-size:12px">// ronin-server-manager\n// main.js loaded\n\nReady.</pre>');
  if (e.key === '8') closePanel();
});