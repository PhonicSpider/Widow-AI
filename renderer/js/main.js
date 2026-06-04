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

// ============================================================
// ELEMENTS
// ============================================================

const orbGlow       = document.getElementById('orb-glow');
const statusText    = document.getElementById('status-text');
const transcriptEl  = document.getElementById('transcript-inner');
const transcriptContainer = document.getElementById('transcript');
const recluseCore   = document.getElementById('recluse-core');
const sidePanel     = document.getElementById('side-panel');
const panelTitle    = document.getElementById('panel-title');
const panelContent  = document.getElementById('panel-content');
const canvas        = document.getElementById('waveform-canvas');
const ctx           = canvas.getContext('2d');
const chatBar       = document.getElementById('chat-bar');
const chatInput     = document.getElementById('chat-input');
const chatSend      = document.getElementById('chat-send');

// ============================================================
// STATE MANAGEMENT
// ============================================================

function setState(state) {
  currentState = state;
  statusText.textContent = state;

  orbGlow.classList.remove('listening', 'speaking', 'thinking');
  statusText.classList.remove('active');

  if (state === State.LISTENING) {
    orbGlow.classList.add('listening');
    statusText.classList.add('active');
    chatInput.focus();
  } else if (state === State.SPEAKING) {
    orbGlow.classList.add('speaking');
    statusText.classList.add('active');
  } else if (state === State.THINKING) {
    orbGlow.classList.add('thinking');
    statusText.classList.add('active');
  }

  // Disable input while thinking
  const busy = state === State.THINKING;
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

  // Scroll inner container to bottom
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

function openPanel(title, content) {
  panelTitle.textContent = title;
  panelContent.innerHTML = content;
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
  setTimeout(() => sidePanel.classList.add('hidden'), 800);
}

// ============================================================
// WAVEFORM CANVAS
// ============================================================

canvas.width  = canvas.offsetWidth  || 260;
canvas.height = canvas.offsetHeight || 260;

let wavePhase = 0;
let waveAmplitude = 6;
let waveTargetAmplitude = 6;

function drawWaveform() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const cx = canvas.width  / 2;
  const cy = canvas.height / 2;
  const radius = cx * 0.68;

  waveAmplitude += (waveTargetAmplitude - waveAmplitude) * 0.08;

  const points = 200;
  ctx.beginPath();

  for (let i = 0; i <= points; i++) {
    const angle = (i / points) * Math.PI * 2;
    const wave =
      Math.sin(angle * 5  + wavePhase)        * waveAmplitude +
      Math.sin(angle * 11 + wavePhase * 1.4)  * (waveAmplitude * 0.35) +
      Math.sin(angle * 3  - wavePhase * 0.6)  * (waveAmplitude * 0.5);
    const r = radius + wave;
    const x = cx + Math.cos(angle) * r;
    const y = cy + Math.sin(angle) * r;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }

  ctx.closePath();

  // Color shifts per state
  const strokeColor =
    currentState === State.SPEAKING  ? '#09e0e0cc' :
    currentState === State.LISTENING ? '#09e0e0aa' :
    currentState === State.THINKING  ? '#09e0e077' : '#09e0e055';

  const glowColor = '#09e0e0';

  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = 1.2;
  ctx.shadowColor = glowColor;
  ctx.shadowBlur = 10;
  ctx.stroke();

  // Inner ring — subtle second wave slightly smaller
  ctx.beginPath();
  for (let i = 0; i <= points; i++) {
    const angle = (i / points) * Math.PI * 2;
    const wave =
      Math.sin(angle * 7  - wavePhase * 1.1) * (waveAmplitude * 0.5) +
      Math.sin(angle * 4  + wavePhase * 0.8) * (waveAmplitude * 0.3);
    const r = (radius * 0.82) + wave;
    const x = cx + Math.cos(angle) * r;
    const y = cy + Math.sin(angle) * r;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.strokeStyle = strokeColor.replace('99', '44').replace('bb', '44').replace('77', '33').replace('66', '33');
  ctx.lineWidth = 0.8;
  ctx.shadowBlur = 4;
  ctx.stroke();

  wavePhase += currentState === State.LISTENING ? 0.055 :
               currentState === State.SPEAKING  ? 0.07  :
               currentState === State.THINKING  ? 0.035 : 0.012;

  waveTargetAmplitude =
    currentState === State.LISTENING ? 18  :
    currentState === State.SPEAKING  ? 20  :
    currentState === State.THINKING  ? 11  : 6;

  requestAnimationFrame(drawWaveform);
}

drawWaveform();

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

  // Recycle
  setTimeout(() => {
    el.remove();
    createEmber();
  }, (duration + delay) * 1000);
}

for (let i = 0; i < EMBER_COUNT; i++) createEmber();

// ============================================================
// IPC — Wire up to main process
// ============================================================

if (window.recluse) {
  // State changes from main process
  window.recluse.onStateChange((state) => {
    setState(state);
  });

  // Responses from harness
  window.recluse.onResponse((data) => {
    if (data.response) addTranscriptLine(data.response, 'recluse');
    if (data.panel)    openPanel(data.panel.title, data.panel.content);
    setState(State.DORMANT);
  });

  window.recluse.onPanelChange((panel) => {
    if (panel) openPanel(panel.title, panel.content);
    else closePanel();
  });
}

// ============================================================
// DEV — keyboard shortcuts
// ============================================================

document.addEventListener('keydown', (e) => {
  // Don't fire shortcuts when typing in the input
  if (e.target === chatInput) return;

  // Shortcuts for testing states and UI
  if (e.key === '1') setState(State.DORMANT);
  if (e.key === '2') setState(State.LISTENING);
  if (e.key === '3') setState(State.THINKING);
  if (e.key === '4') setState(State.SPEAKING);
  if (e.key === '5') addTranscriptLine('Open the RSM project for me.', 'user');
  if (e.key === '6') addTranscriptLine('Sure. Though I\'d have opened it faster if you\'d asked nicely.', 'recluse');
  if (e.key === '7') openPanel('WORKSPACE — RSM', '<pre style="color:#f07000;font-size:12px">// ronin-server-manager\n// main.js loaded\n\nReady.</pre>');
  if (e.key === '8') closePanel();
});