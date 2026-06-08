// orb3d.js — Shader-based orb with fixed spiral waveform and cracked ember core

// ============================================================
// GLOBAL CONFIGURATION — edit these to customize the orb
// ============================================================
const CONFIG = {

  // ── CAMERA ──────────────────────────────────────────────
  camera: {
    distance: 3.5,          // how far the camera is from the orb (higher = more zoomed out)
  },

  // ── OUTER SHELL (hex grid layer) ────────────────────────
  hexShell: {
    opacity:          0.38, // how visible the hex grid is (0 = invisible, 1 = fully opaque)
    color:            0x09e0e0, // hex grid color
    emissiveColor:    0x003333, // hex grid glow color
    emissiveIntensity:1.2,  // how much the hex grid glows
    hexSize:          28,   // size of each hexagon cell in the texture
    hexOpacity:       0.9,  // hex line opacity within the texture (0-1 as rgba fraction)
    nodeDensity:      20,   // number of bright node dots on the hex texture
  },

  // ── WAVEFORM SPHERE ─────────────────────────────────────
  waveform: {
    // Geometry
    segments:         200,  // sphere resolution (higher = smoother but slower, min 128)

    // Spiral lines
    spiralCount:      6,   // number of spiral lines wrapping around the orb
    spiralTwist:      12.0,  // how many full rotations the spirals make top to bottom (higher = more twisted)
    lineWidth:       0.38, // how wide the spiral lines are (lower = narrower, 0.1 = very thin, 0.5 = half the way to next line)

    // Spike appearance
    spikesPerLine:    6,   // how many spike opportunities exist per spiral line
    spikeSharpness:   4.0,  // how pointy the spikes are (higher = sharper, 2=round, 10=needle)
    spikeNoiseAmount: 0.65, // how much random variation in spike height (0=uniform, 1=very random)
    spikeDuty:       1.0, // 0.1=very short narrow spikes, 0.5=half slot, 1.0=fills full gap

    // Colors
    baseColor:        0x000000, // color of the flat surface between spikes (invisible base)
    peakColor:        0xcc22ff, // color at the very tip of spikes (purple)
    baseOpacity:      0.10,     // opacity of the flat base surface
    peakOpacityBoost: 2.00,     // how much more opaque the spike tips are vs base

    // Dormant state
    dormantAmplitude: 0.0,    // spike height when dormant
    dormantOpacity:   0.12,     // shell opacity when dormant

    // Thinking state
    thinkingAmplitude:0.10,     // spike height when thinking
    thinkingOpacity:  0.15,     // shell opacity when thinking
    thinkingPulseRate:0.9,      // speed of the thinking pulse (hz)
    thinkingPulseDepth:0.015,   // how much the thinking amplitude pulses

    // Listening state
    listeningAmplitude:0.15,    // spike height when listening
    listeningOpacity:  0.20,    // shell opacity when listening
    listeningPulseRate:2.1,     // speed of the listening pulse
    listeningPulseDepth:0.02,   // how much the listening amplitude pulses

    // Speaking state
    speakingAmplitude: 0.62,    // base spike height when speaking
    speakingOpacity:   0.25,    // shell opacity when speaking
    // Speech rhythm simulation — three non-harmonic frequencies create organic feel
    speechBreathRate:  3.1,     // slow breath cycle (hz) — contributes 20% of amplitude variation
    speechSyllableRate:7.3,     // syllable rate (hz) — contributes 10% of amplitude variation
    speechConsonantRate:19.7,   // consonant bursts (hz) — contributes 5% of amplitude variation

    // State transition speed
    transitionSpeed:   0.05,    // how fast values lerp between states (0.01=slow, 0.2=instant)
  },

  // ── INNER CORE ──────────────────────────────────────────
  core: {
    radius:            0.54,    // size of the solid inner core sphere
    baseColor:         0x050000,// core surface color (near black)
    emissiveColor:     0x1a0000,// core inner glow color (dark red)

    // Breathing animation
    breatheRate:       1.4,     // how fast the core pulses (hz)
    breatheDepth:      0.03,    // how much it scales up/down (0.03 = 3% size change)

    // Emissive intensity per state
    dormantGlow:       0.25,    // how much the core glows when dormant
    thinkingGlow:      0.40,    // how much the core glows when thinking
    listeningGlow:     0.65,    // how much the core glows when listening
    speakingGlow:      0.90,    // how much the core glows when speaking
    speakingGlowPulse: 0.25,    // extra glow pulse amplitude when speaking
  },

  // ── CRACK MESH (wireframe layer over core) ───────────────
  cracks: {
    detail:            2,       // icosahedron subdivision level (1=20 faces, 2=80 faces, 3=320 faces)
    displacement:      0.055,   // random vertex push/pull for organic irregularity (0=perfect sphere, 0.1=very jagged)
    radiusOffset:      0.012,   // how far above the core surface the cracks sit
    rotationSpeed:     0.0015,  // how fast the crack pattern slowly rotates (radians/frame)

    // Cold rock color (dark facets)
    coldColor:         [0.0, 0.04, 0.01],  // RGB 0-1 — very dark green

    // Mid-heat crack color
    hotColor:          [0.0, 0.75, 0.28],  // RGB 0-1 — vivid green

    // Hottest crack tips
    tipsColor:         [0.35, 1.0, 0.35],  // RGB 0-1 — bright lime green

    // Pulse intensity per state (how bright the cracks glow)
    dormantPulse:      0.35,
    thinkingPulse:     0.50,
    listeningPulse:    0.65,
    speakingPulse:     0.85,
    pulsVariation:     0.25,     // how much the pulse flickers (0=steady, 1=strong flicker)
    pulseRate:         4.14,     // flicker speed when speaking (hz)
  },

  // ── EMBER GLOW HALO ─────────────────────────────────────
  glow: {
    radius:            0.70,    // size of the glow halo (should be > core radius)
    color:             0xcc3300,// glow color
    emissiveColor:     0x8b1a00,// inner emissive color
    emissiveIntensity: 0.6,     // emissive strength

    // Opacity per state
    dormantOpacity:    0.06,
    thinkingOpacity:   0.08,
    listeningOpacity:  0.10,
    speakingOpacity:   0.12,
    pulseDepth:        0.03,    // how much opacity pulses
    pulseRate:         1.4,     // pulse speed (hz)
  },

  // ── SCENE LIGHTS ─────────────────────────────────────────
  lights: {
    ambientColor:      0x110000,// ambient light color
    ambientIntensity:  3,       // ambient light strength

    keyColor:          0xe84800,// key light color (main orange)
    keyIntensity:      4,       // key light strength
    keyDistance:       12,      // key light range
    keyPosition:       [0, 0, 3],// key light xyz position

    sideColor:         0xff4400,// side fill light color
    sideIntensity:     2,       // side fill light strength
    sideDistance:      10,      // side fill light range
    sidePosition:      [-3, 2, 1],

    cyanColor:         0x09e0e0,// cyan accent light color
    cyanIntensity:     1.5,     // cyan light strength
    cyanDistance:      8,       // cyan light range
    cyanPosition:      [2, -1, 2],
  },

};
// ============================================================
// END CONFIGURATION
// ============================================================


let scene, camera, renderer;
let waveformMesh, hexShell;
let innerCore, crackMesh, innerGlow;
let orbState = 'DORMANT';
let clock;
let waveUniforms;

// ── HEX TEXTURE ──
function createHexTexture() {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, size, size);
  const hexSize = CONFIG.hexShell.hexSize;
  const cols = Math.ceil(size / (hexSize * 1.5)) + 2;
  const rows = Math.ceil(size / (hexSize * Math.sqrt(3))) + 2;
  ctx.strokeStyle = `rgba(9, 224, 224, ${CONFIG.hexShell.hexOpacity})`;
  ctx.lineWidth = CONFIG.waveform.lineWidth;
  for (let col = -1; col < cols; col++) {
    for (let row = -1; row < rows; row++) {
      const x = col * hexSize * 1.5;
      const y = row * hexSize * Math.sqrt(3) + (col % 2) * hexSize * (Math.sqrt(3) / 2);
      drawHex(ctx, x, y, hexSize);
    }
  }
  ctx.fillStyle = 'rgba(9, 224, 224, 0.8)';
  for (let i = 0; i < CONFIG.hexShell.nodeDensity; i++) {
    ctx.beginPath();
    ctx.arc(Math.random() * size, Math.random() * size, 1.5, 0, Math.PI * 2);
    ctx.fill();
  }
  return new THREE.CanvasTexture(canvas);
}

function drawHex(ctx, x, y, size) {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 3) * i - Math.PI / 6;
    const px = x + size * Math.cos(angle);
    const py = y + size * Math.sin(angle);
    i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.stroke();
}

// ── VERTEX SHADER ──
// Key design: spike position is fixed in UV space using spiral coordinates
// Amplitude pulses per-spike using a hash so each spike has independent timing
// No travelling bands — spikes pop in/out in place
const vertexShader = `
  uniform float uTime;
  uniform float uWaveAmp;
  uniform float uSpikeSharpness;
  uniform float uNoiseAmount;
  uniform float uOpacity;

  // Config passed as uniforms so they update if changed at runtime
  uniform float uSpiralCount;
  uniform float uSpiralTwist;
  uniform float uSpikesPerLine;
  uniform float uSpikeDuty;
  uniform float uLineWidth;

  varying float vDisplacement;
  varying vec2  vUv;

  // Stable hash — same input always gives same output
  // Used to give each spike its own independent timing
  float hash(float n) {
    return fract(sin(n * 127.1 + 311.7) * 43758.5453123);
  }

  float hash2(float a, float b) {
    return hash(a * 1000.0 + b);
  }

  void main() {
    vUv = uv;

    float lat = uv.y;     // 0 = north pole, 1 = south pole
    float lng = uv.x;     // 0 to 1 around equator

    // ── SPIRAL COORDINATE ──
    // Which spiral line is this vertex closest to?
    // The spiral advances in longitude as latitude increases
    float spiralPhase = lng * uSpiralCount + lat * uSpiralTwist;
    float spiralIndex = floor(spiralPhase);
    float spiralFrac  = fract(spiralPhase);

    // Distance from center of nearest spiral line (0 = on the line, 0.5 = between lines)
    float distFromLine = min(spiralFrac, 1.0 - spiralFrac);

    // Only points close to a spiral line contribute to spikes
    // Narrower = more defined lines
    float onLine = max(0.0, 1.0 - distFromLine / uLineWidth);
    onLine = pow(onLine, 0.7); // softer edge = wider, more triangular spike base

    // ── SPIKE POSITION ON LINE ──
    // Which spike slot along this spiral line?
    float spikeCoord = lat * uSpikesPerLine;
    float spikeIndex = floor(spikeCoord);
    float spikeFrac  = fract(spikeCoord);
    float spikeWindow = clamp(spikeFrac / uSpikeDuty, 0.0, 1.0) *
                        clamp((1.0 - spikeFrac) / uSpikeDuty, 0.0, 1.0);

    // Sharp spike shape — power function gives needle-like peaks
    float rawSpike = sin(spikeFrac * 3.14159);
    float spikeShape = pow(max(0.0, rawSpike), uSpikeSharpness);

    // ── INDEPENDENT TIMING PER SPIKE ──
    // Each spike has its own phase so they pop in and out independently
    // spiralIndex + spikeIndex gives a unique ID per spike
    float spikeId     = spiralIndex * 1000.0 + spikeIndex;
    float spikePhase  = hash(spikeId) * 6.28318; // random phase offset 0..2PI
    float spikeRate   = 0.5 + hash2(spikeId, 1.0) * 1.5; // random rate 0.5..2.0 hz

    // Spike amplitude oscillates — when sin is negative the spike is retracted (=0)
    float rawAmp = sin(uTime * spikeRate + spikePhase);
    float spikeAmp = max(0.0, rawAmp); // only positive = spikes only pop outward

    // ── NOISE VARIATION ──
    // Slight per-spike height variation for organic look
    float noiseVar = 1.0 - uNoiseAmount + uNoiseAmount * hash2(spikeId, 2.0);

    // ── POLE FADE ──
    // Suppress spikes near poles where geometry converges
    float poleFade = sin(lat * 3.14159);
    poleFade = pow(poleFade, 0.5);

    // ── FINAL DISPLACEMENT ──
    float displacement = spikeShape * spikeAmp * noiseVar * onLine * poleFade * uWaveAmp;
    vDisplacement = displacement;

    vec3 newPos = position + normal * displacement;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(newPos, 1.0);
  }
`;

// ── FRAGMENT SHADER ──
const fragmentShader = `
  uniform float uWaveAmp;
  uniform float uOpacity;
  uniform vec3  uBaseColor;
  uniform vec3  uPeakColor;
  uniform float uPeakOpacityBoost;

  varying float vDisplacement;
  varying vec2  vUv;

  void main() {
    float t = clamp(vDisplacement / max(uWaveAmp * 0.4, 0.001), 0.0, 1.0);
    vec3 color = mix(uBaseColor, uPeakColor, t);
    color *= (1.0 + t * 0.8);
    float alpha = uOpacity + t * uPeakOpacityBoost;
    alpha = clamp(alpha, 0.0, 1.0);
    gl_FragColor = vec4(color, alpha);
  }
`;

// ── CRACK VERTEX SHADER ──
const crackVertexShader = `
  uniform float uTime;
  varying float vHeat;

  float hash3(vec3 p) {
    p = fract(p * vec3(443.8975, 397.2973, 491.1871));
    p += dot(p.zxy, p.yxz + 19.19);
    return fract(p.x * p.y * p.z);
  }

  void main() {
    vHeat = hash3(floor(position * 8.0));
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// ── CRACK FRAGMENT SHADER ──
const crackFragmentShader = `
  uniform float uTime;
  uniform float uPulse;
  uniform float uPulseVariation;
  uniform float uPulseRate;
  uniform vec3  uColdColor;
  uniform vec3  uHotColor;
  uniform vec3  uTipsColor;

  varying float vHeat;

  void main() {
    float pulse = (1.0 - uPulseVariation) + uPulseVariation * sin(uTime * uPulseRate + vHeat * 6.28318);
    pulse *= uPulse;

    vec3 color;
    if (vHeat > 0.7) {
      color = mix(uHotColor, uTipsColor, (vHeat - 0.7) / 0.3);
    } else if (vHeat > 0.4) {
      color = mix(uColdColor * 5.0, uHotColor, (vHeat - 0.4) / 0.3);
    } else {
      color = mix(uColdColor, uColdColor * 3.0, vHeat / 0.4);
    }

    color *= pulse;
    float alpha = 0.4 + 0.4 * vHeat * pulse;
    gl_FragColor = vec4(color, alpha);
  }
`;

function initOrb(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = '';

  const W = container.offsetWidth  || 400;
  const H = container.offsetHeight || 400;

  scene  = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(45, W / H, 0.1, 100);
  camera.position.set(0, 0, CONFIG.camera.distance);
  camera.lookAt(0, 0, 0);

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setSize(W, H);
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setClearColor(0x000000, 0);
  container.appendChild(renderer.domElement);

  clock = new THREE.Clock();

  // ── HEX SHELL ──
  const hexTex = createHexTexture();
  const hexGeo = new THREE.SphereGeometry(0.99, 64, 64);
  const hexMat = new THREE.MeshPhongMaterial({
    map: hexTex, alphaMap: hexTex,
    color:             CONFIG.hexShell.color,
    emissive:          CONFIG.hexShell.emissiveColor,
    emissiveIntensity: CONFIG.hexShell.emissiveIntensity,
    transparent: true,
    opacity:     CONFIG.hexShell.opacity,
    side:        THREE.DoubleSide,
    depthWrite:  false,
    blending:    THREE.AdditiveBlending,
  });
  hexShell = new THREE.Mesh(hexGeo, hexMat);
  scene.add(hexShell);

  // ── WAVEFORM SPHERE ──
  const waveGeo = new THREE.SphereGeometry(1.0, CONFIG.waveform.segments, CONFIG.waveform.segments);

  waveUniforms = {
    uTime:            { value: 0 },
    uWaveAmp:         { value: CONFIG.waveform.dormantAmplitude },
    uSpikeSharpness:  { value: CONFIG.waveform.spikeSharpness },
    uNoiseAmount:     { value: CONFIG.waveform.spikeNoiseAmount },
    uOpacity:         { value: CONFIG.waveform.dormantOpacity },
    uSpiralCount:     { value: CONFIG.waveform.spiralCount },
    uSpiralTwist:     { value: CONFIG.waveform.spiralTwist },
    uSpikesPerLine:   { value: CONFIG.waveform.spikesPerLine },
    uSpikeDuty:       { value: CONFIG.waveform.spikeDuty },
    uLineWidth:       { value: CONFIG.waveform.lineWidth },
    uBaseColor:       { value: new THREE.Color(CONFIG.waveform.baseColor) },
    uPeakColor:       { value: new THREE.Color(CONFIG.waveform.peakColor) },
    uPeakOpacityBoost:{ value: CONFIG.waveform.peakOpacityBoost },
  };

  const waveMat = new THREE.ShaderMaterial({
    uniforms:    waveUniforms,
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite:  false,
    side:        THREE.DoubleSide,
    blending:    THREE.AdditiveBlending,
  });

  waveformMesh = new THREE.Mesh(waveGeo, waveMat);
  scene.add(waveformMesh);

  // ── INNER CORE ──
  const coreGeo = new THREE.SphereGeometry(CONFIG.core.radius, 64, 64);
  const coreMat = new THREE.MeshPhongMaterial({
    color:             CONFIG.core.baseColor,
    emissive:          CONFIG.core.emissiveColor,
    emissiveIntensity: CONFIG.core.dormantGlow,
    shininess:         2,
  });
  innerCore = new THREE.Mesh(coreGeo, coreMat);
  scene.add(innerCore);

  // ── CRACK MESH ──
  const crackRadius = CONFIG.core.radius + CONFIG.cracks.radiusOffset;
  const crackGeo    = new THREE.IcosahedronGeometry(crackRadius, CONFIG.cracks.detail);

  // Displace vertices randomly along their normals for organic, irregular cracks
  const crackPos = crackGeo.attributes.position;
  for (let i = 0; i < crackPos.count; i++) {
    const x = crackPos.getX(i), y = crackPos.getY(i), z = crackPos.getZ(i);
    const len = Math.sqrt(x * x + y * y + z * z);
    const disp = (Math.random() - 0.5) * CONFIG.cracks.displacement;
    crackPos.setXYZ(i, x + (x / len) * disp, y + (y / len) * disp, z + (z / len) * disp);
  }
  crackPos.needsUpdate = true;
  const crackUniforms = {
    uTime:          { value: 0 },
    uPulse:         { value: CONFIG.cracks.dormantPulse },
    uPulseVariation:{ value: CONFIG.cracks.pulsVariation },
    uPulseRate:     { value: CONFIG.cracks.pulseRate },
    uColdColor:     { value: new THREE.Vector3(...CONFIG.cracks.coldColor) },
    uHotColor:      { value: new THREE.Vector3(...CONFIG.cracks.hotColor) },
    uTipsColor:     { value: new THREE.Vector3(...CONFIG.cracks.tipsColor) },
  };
  const crackMat = new THREE.ShaderMaterial({
    uniforms:       crackUniforms,
    vertexShader:   crackVertexShader,
    fragmentShader: crackFragmentShader,
    wireframe:      true,
    transparent:    true,
    depthWrite:     false,
  });
  crackMesh = new THREE.Mesh(crackGeo, crackMat);
  crackMesh.userData.uniforms = crackUniforms;
  scene.add(crackMesh);

  // ── INNER GLOW ──
  const haloGeo = new THREE.SphereGeometry(CONFIG.glow.radius, 32, 32);
  const haloMat = new THREE.MeshPhongMaterial({
    color:             CONFIG.glow.color,
    emissive:          CONFIG.glow.emissiveColor,
    emissiveIntensity: CONFIG.glow.emissiveIntensity,
    transparent:       true,
    opacity:           CONFIG.glow.dormantOpacity,
    depthWrite:        false,
  });
  innerGlow = new THREE.Mesh(haloGeo, haloMat);
  // scene.add(innerGlow); — halo removed

  // ── LIGHTS ──
  scene.add(new THREE.AmbientLight(CONFIG.lights.ambientColor, CONFIG.lights.ambientIntensity));

  const key = new THREE.PointLight(CONFIG.lights.keyColor, CONFIG.lights.keyIntensity, CONFIG.lights.keyDistance);
  key.position.set(...CONFIG.lights.keyPosition);
  scene.add(key);

  const side = new THREE.PointLight(CONFIG.lights.sideColor, CONFIG.lights.sideIntensity, CONFIG.lights.sideDistance);
  side.position.set(...CONFIG.lights.sidePosition);
  scene.add(side);

  const cyan = new THREE.PointLight(CONFIG.lights.cyanColor, CONFIG.lights.cyanIntensity, CONFIG.lights.cyanDistance);
  cyan.position.set(...CONFIG.lights.cyanPosition);
  scene.add(cyan);

  animate();
}

// Smooth lerp
function lerp(a, b, t) { return a + (b - a) * t; }

const current = {
  waveAmp: CONFIG.waveform.dormantAmplitude,
  opacity: CONFIG.waveform.dormantOpacity,
};

function animate() {
  requestAnimationFrame(animate);
  const t = clock.getElapsedTime();
  const C = CONFIG.waveform;

  // ── TARGET VALUES PER STATE ──
  let targetAmp, targetOpacity;

  if (orbState === 'SPEAKING') {
    const speechMod =
      0.65 + 0.20 * Math.sin(t * C.speechBreathRate)
           + 0.10 * Math.sin(t * C.speechSyllableRate)
           + 0.05 * Math.sin(t * C.speechConsonantRate);
    targetAmp     = C.speakingAmplitude * speechMod;
    targetOpacity = C.speakingOpacity;

  } else if (orbState === 'LISTENING') {
    targetAmp     = C.listeningAmplitude + C.listeningPulseDepth * Math.sin(t * C.listeningPulseRate);
    targetOpacity = C.listeningOpacity;

  } else if (orbState === 'THINKING') {
    targetAmp     = C.thinkingAmplitude + C.thinkingPulseDepth * Math.sin(t * C.thinkingPulseRate);
    targetOpacity = C.thinkingOpacity;

  } else {
    targetAmp     = C.dormantAmplitude;
    targetOpacity = C.dormantOpacity;
  }

  // Smooth transitions
  const speed = C.transitionSpeed;
  current.waveAmp = lerp(current.waveAmp, targetAmp,     speed);
  current.opacity = lerp(current.opacity, targetOpacity, speed * 0.5);

  // Update waveform uniforms
  waveUniforms.uTime.value    = t;
  waveUniforms.uWaveAmp.value = current.waveAmp;
  waveUniforms.uOpacity.value = current.opacity;

  // Spike sharpness varies slightly per state
  waveUniforms.uSpikeSharpness.value =
    orbState === 'SPEAKING'  ? C.spikeSharpness - 1.5 + 0.8 * Math.sin(t * 3.7) :
    orbState === 'LISTENING' ? C.spikeSharpness - 0.5 :
    orbState === 'THINKING'  ? C.spikeSharpness :
                               C.spikeSharpness + 1.0;

  // Slow waveform rotation
  waveformMesh.rotation.y += 0.0005;
  hexShell.rotation.y      = waveformMesh.rotation.y;

  // ── CRACKS ──
  const crackU = crackMesh.userData.uniforms;
  const CC     = CONFIG.cracks;
  crackU.uTime.value  = t;
  crackU.uPulse.value =
    orbState === 'SPEAKING'  ? CC.speakingPulse :
    orbState === 'LISTENING' ? CC.listeningPulse :
    orbState === 'THINKING'  ? CC.thinkingPulse :
                               CC.dormantPulse;

  crackMesh.rotation.y += CC.rotationSpeed;

  // ── CORE ──
  const breathe = 1.0 + Math.sin(t * CONFIG.core.breatheRate) * CONFIG.core.breatheDepth;
  innerCore.scale.setScalar(breathe);
  crackMesh.scale.setScalar(breathe);

  const baseGlow =
    orbState === 'SPEAKING'  ? CONFIG.core.speakingGlow :
    orbState === 'LISTENING' ? CONFIG.core.listeningGlow :
    orbState === 'THINKING'  ? CONFIG.core.thinkingGlow :
                               CONFIG.core.dormantGlow;

  const glowPulse =
    orbState === 'SPEAKING'
      ? CONFIG.core.speakingGlowPulse * Math.sin(t * 5.0)
      : 0;

  innerCore.material.emissiveIntensity = baseGlow + glowPulse;

  // ── GLOW HALO ──
  const CG = CONFIG.glow;
  const baseOpacity =
    orbState === 'SPEAKING'  ? CG.speakingOpacity :
    orbState === 'LISTENING' ? CG.listeningOpacity :
    orbState === 'THINKING'  ? CG.thinkingOpacity :
                               CG.dormantOpacity;

  innerGlow.material.opacity = baseOpacity + CG.pulseDepth * Math.sin(t * CG.pulseRate);

  renderer.render(scene, camera);
}

function setOrbState(state) { orbState = state; }

function resizeOrb(containerId) {
  const container = document.getElementById(containerId);
  if (!container || !renderer) return;
  const W = container.offsetWidth;
  const H = container.offsetHeight;
  camera.aspect = W / H;
  camera.updateProjectionMatrix();
  renderer.setSize(W, H);
}

window.Orb3D = { init: initOrb, setState: setOrbState, resize: resizeOrb };