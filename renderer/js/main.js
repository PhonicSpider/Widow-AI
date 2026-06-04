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
const recluseCore   = document.getElementById('recluse-core');
const sidePanel     = document.getElementById('side-panel');
const panelTitle    = document.getElementById('panel-title');
const panelContent  = document.getElementById('panel-content');
const canvas        = document.getElementById('waveform-canvas');
const ctx           = canvas.getContext('2d');

// ============================================================
// STATE MANAGEMENT
// ============================================================

function setState(state) {
  currentState = state;
  statusText.textContent = state;

  orbGlow.classList.remove('listening', 'speaking');
  statusText.classList.remove('active');

  if (state === State.LISTENING) {
    orbGlow.classList.add('listening');
    statusText.classList.add('active');
  } else if (state === State.SPEAKING) {
    orbGlow.classList.add('speaking');
    statusText.classList.add('active');
  } else if (state === State.THINKING) {
    statusText.classList.add('active');
  }
}

// ============================================================
// TRANSCRIPT
// ============================================================

function addTranscriptLine(text, role = 'recluse') {
  const line = document.createElement('div');
  line.classList.add('transcript-line', role);
  line.textContent = role === 'recluse' ? `> ${text}` : text;
  transcriptEl.appendChild(line);

  // Keep only last 6 lines
  const lines = transcriptEl.querySelectorAll('.transcript-line');
  if (lines.length > 6) lines[0].remove();

  transcriptEl.scrollTop = transcriptEl.scrollHeight;
}

// ============================================================
// SIDE PANEL
// ============================================================

function openPanel(title, content) {
  panelTitle.textContent = title;
  panelContent.innerHTML = content;
  sidePanel.classList.remove('hidden');
  requestAnimationFrame(() => sidePanel.classList.add('visible'));
  recluseCore.classList.add('panel-open');
}

function closePanel() {
  sidePanel.classList.remove('visible');
  recluseCore.classList.remove('panel-open');
  setTimeout(() => sidePanel.classList.add('hidden'), 800);
}

// ============================================================
// WAVEFORM CANVAS
// ============================================================

canvas.width  = canvas.offsetWidth  || 340;
canvas.height = canvas.offsetHeight || 340;

let wavePhase = 0;
let waveAmplitude = 8;
let waveTargetAmplitude = 8;

function drawWaveform() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const cx = canvas.width  / 2;
  const cy = canvas.height / 2;
  const radius = cx * 0.72;

  waveAmplitude += (waveTargetAmplitude - waveAmplitude) * 0.1;

  const points = 180;
  ctx.beginPath();

  for (let i = 0; i <= points; i++) {
    const angle = (i / points) * Math.PI * 2;
    const wave =
      Math.sin(angle * 6 + wavePhase) * waveAmplitude +
      Math.sin(angle * 12 + wavePhase * 1.3) * (waveAmplitude * 0.4) +
      Math.sin(angle * 3  - wavePhase * 0.7) * (waveAmplitude * 0.6);
    const r = radius + wave;
    const x = cx + Math.cos(angle) * r;
    const y = cy + Math.sin(angle) * r;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }

  ctx.closePath();

  // Ember gradient stroke
  const grad = ctx.createRadialGradient(cx, cy, radius * 0.6, cx, cy, radius * 1.1);
  grad.addColorStop(0,   '#cc110088');
  grad.addColorStop(0.4, '#e8480099');
  grad.addColorStop(0.7, '#f07000aa');
  grad.addColorStop(1,   '#f5a00044');

  ctx.strokeStyle = grad;
  ctx.lineWidth = 1.5;
  ctx.shadowColor = '#e84800';
  ctx.shadowBlur = 8;
  ctx.stroke();

  wavePhase += currentState === State.LISTENING  ? 0.06 :
               currentState === State.SPEAKING   ? 0.10 :
               currentState === State.THINKING   ? 0.04 : 0.015;

  waveTargetAmplitude =
    currentState === State.LISTENING ? 20 :
    currentState === State.SPEAKING  ? 28 :
    currentState === State.THINKING  ? 14 : 8;

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
    if (data.userMessage) addTranscriptLine(data.userMessage, 'user');
    if (data.response)    addTranscriptLine(data.response, 'recluse');
    if (data.panel)       openPanel(data.panel.title, data.panel.content);
  });

  // Panel changes
  window.recluse.onPanelChange((panel) => {
    if (panel) openPanel(panel.title, panel.content);
    else closePanel();
  });
}

// ============================================================
// DEV / DEMO — keyboard shortcuts for testing
// ============================================================

document.addEventListener('keydown', (e) => {
  if (e.key === '1') setState(State.DORMANT);
  if (e.key === '2') setState(State.LISTENING);
  if (e.key === '3') setState(State.THINKING);
  if (e.key === '4') setState(State.SPEAKING);
  if (e.key === '5') addTranscriptLine('Open the RSM project for me.', 'user');
  if (e.key === '6') addTranscriptLine('Sure. Though I'd have opened it faster if you'd asked nicely.', 'recluse');
  if (e.key === '7') openPanel('WORKSPACE — RSM', '<pre style="color:#f07000;font-size:12px">// ronin-server-manager\n// main.js loaded\n\nReady.</pre>');
  if (e.key === '8') closePanel();
});
