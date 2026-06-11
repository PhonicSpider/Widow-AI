// renderer/js/electron-orbs.js — Animated electron orbs orbiting the main orb cluster
//
// Architecture:
//   - A <canvas> element is injected into #orb-container, sized to match it, layered
//     above the Three.js canvas but behind status text (z-index 5).
//   - Each "electron orb" is an independent object with its own phase, speed, opacity,
//     fade state, and comet-trail history.
//   - Canvas is only rendered while at least one orb exists — rAF loop is started/stopped
//     dynamically to avoid burning GPU when idle.
//   - Public API: ElectronOrbs.setCount(n) — smoothly transitions to n active orbs.

(function (global) {
  'use strict';

  // ============================================================
  // CONFIGURATION
  // ============================================================

  const CFG = {
    // Orbit geometry
    orbitRadiusRatio: 0.45,   // fraction of canvas half-size (1.0 = canvas edge)
                               // 0.62 puts orbs just outside the ~550px orb shell
    orbitYSquish:     0.28,   // vertical squish factor — makes it look like a tilted ring
                               // 0 = flat line, 1 = circle, 0.28 = slight tilt

    // Orb appearance
    orbRadius:        6,       // px — core dot radius
    glowRadius:       18,      // px — outer glow radius
    orbColor:         '#00BCD4',
    orbGlowColor:     'rgba(0, 188, 212,',   // prefix — append alpha + ')'
    orbCoreColor:     'rgba(180, 248, 255,',  // bright cyan-white core

    // Trail (comet tail)
    trailLength:      45,      // how many historical positions to store per orb
    trailInterval:    1,       // store a position every N frames (1 = every frame)
    trailMaxAlpha:    0.55,    // alpha of the newest trail segment

    // Orbit speed
    baseSpeed:        1.4,     // radians per second for a single orb
    speedJitter:      0.18,    // ± random variation added to each orb's speed

    // Fade
    fadeInSpeed:      0.045,   // opacity increment per frame (0→1)
    fadeOutSpeed:     0.030,   // opacity decrement per frame (1→0)

    // Phase distribution
    // Each new orb is placed as far from existing orbs as possible on the ring.
  };

  // ============================================================
  // STATE
  // ============================================================

  let canvas  = null;
  let ctx     = null;
  let running = false;
  let rafId   = null;
  let lastTs  = 0;

  // Array of orb objects
  const orbs = [];
  let nextOrbId = 0;

  // Target count set by setCount()
  let targetCount = 0;

  // Rainbow mode — activated by setMode('rainbow'), cleared by setMode('default')
  let rainbowMode = false;
  let globalHue   = 0;   // degrees, advances over time when rainbowMode is on

  // ============================================================
  // ORB FACTORY
  // ============================================================

  function createOrb(phaseOffset) {
    const speed = CFG.baseSpeed + (Math.random() - 0.5) * 2 * CFG.speedJitter;
    return {
      id:         nextOrbId++,
      angle:      phaseOffset,
      speed,
      dir:        Math.random() < 0.5 ? 1 : -1,
      opacity:    0,
      fading:     'in',
      trail:      [],
      frameCount: 0,
      // Each orb gets a fixed hue offset so orbs in a group spread across the spectrum
      hueOffset:  (nextOrbId * 137.5) % 360,  // golden-angle spacing = no two look alike
    };
  }

  // Pick the phase that is maximally spread from existing orbs
  function bestPhaseForNewOrb() {
    if (orbs.length === 0) return 0;
    if (orbs.length === 1) return orbs[0].angle + Math.PI; // opposite side

    // Find the largest gap between existing orb angles
    const angles = orbs.map(o => ((o.angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2))
                       .sort((a, b) => a - b);

    let maxGap = 0;
    let bestStart = 0;
    for (let i = 0; i < angles.length; i++) {
      const next = angles[(i + 1) % angles.length];
      const gap  = i === angles.length - 1
        ? (Math.PI * 2 - angles[i] + angles[0])
        : (next - angles[i]);
      if (gap > maxGap) {
        maxGap = gap;
        bestStart = angles[i];
      }
    }
    return bestStart + maxGap / 2;
  }

  // ============================================================
  // CANVAS SETUP
  // ============================================================

  function ensureCanvas() {
    if (canvas) return;

    const container = document.getElementById('orb-container');
    if (!container) return;

    canvas = document.createElement('canvas');
    canvas.id = 'electron-orb-canvas';
    canvas.style.cssText = [
      'position: absolute',
      'top: 0',
      'left: 0',
      'width: 100%',
      'height: 100%',
      'pointer-events: none',
      'z-index: 5',        // above Three.js canvas (z-index auto), below status bar (z-index 10+)
    ].join(';');

    // Size the canvas buffer to the container
    resizeCanvas(container);

    // Insert AFTER the Three.js canvas so it paints on top
    container.appendChild(canvas);
    ctx = canvas.getContext('2d');

    // Keep canvas sized on window resize
    window.addEventListener('resize', () => resizeCanvas(container));
  }

  function resizeCanvas(container) {
    if (!canvas) return;
    const w = container.offsetWidth  || 550;
    const h = container.offsetHeight || 550;
    canvas.width  = w;
    canvas.height = h;
  }

  // ============================================================
  // ANIMATION LOOP
  // ============================================================

  function startLoop() {
    if (running) return;
    running = true;
    lastTs  = performance.now();
    rafId   = requestAnimationFrame(frame);
  }

  function stopLoop() {
    running = false;
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    // Clear canvas on stop
    if (ctx && canvas) ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  function frame(ts) {
    if (!running) return;
    const dt = Math.min((ts - lastTs) / 1000, 0.1); // seconds, capped at 100ms
    lastTs = ts;

    update(dt);
    draw();

    // If all orbs have finished fading out and target is 0, stop the loop
    if (targetCount === 0 && orbs.length === 0) {
      stopLoop();
      return;
    }

    rafId = requestAnimationFrame(frame);
  }

  // ============================================================
  // UPDATE
  // ============================================================

  function update(dt) {
    // Advance the global hue when in rainbow mode (~72°/s = full cycle every 5 seconds)
    if (rainbowMode) globalHue = (globalHue + 72 * dt) % 360;

    // ── Spawn new orbs if below target ──
    while (orbs.filter(o => o.fading !== 'out').length < targetCount) {
      const phase = bestPhaseForNewOrb();
      orbs.push(createOrb(phase));
    }

    // ── Mark excess orbs for fade-out ──
    const activeOrbs = orbs.filter(o => o.fading !== 'out');
    const excess     = activeOrbs.length - targetCount;
    for (let i = 0; i < excess; i++) {
      activeOrbs[activeOrbs.length - 1 - i].fading = 'out';
    }

    // ── Update each orb ──
    for (let i = orbs.length - 1; i >= 0; i--) {
      const orb = orbs[i];

      // Advance orbit angle
      orb.angle += orb.dir * orb.speed * dt;

      // Fade in/out
      if (orb.fading === 'in') {
        orb.opacity = Math.min(1, orb.opacity + CFG.fadeInSpeed);
        if (orb.opacity >= 1) orb.fading = 'steady';
      } else if (orb.fading === 'out') {
        orb.opacity = Math.max(0, orb.opacity - CFG.fadeOutSpeed);
        if (orb.opacity <= 0) {
          orbs.splice(i, 1); // remove fully faded orb
          continue;
        }
      }

      // Compute canvas position
      const cx = canvas.width  / 2;
      const cy = canvas.height / 2;
      const r  = Math.min(canvas.width, canvas.height) * CFG.orbitRadiusRatio;

      const x = cx + r * Math.cos(orb.angle);
      const y = cy + r * Math.sin(orb.angle) * CFG.orbitYSquish
                   + (1 - CFG.orbitYSquish) * 0; // squish around centre Y

      // Append to trail every N frames
      orb.frameCount++;
      if (orb.frameCount % CFG.trailInterval === 0) {
        orb.trail.push({ x, y });
        if (orb.trail.length > CFG.trailLength) orb.trail.shift();
      }

      // Store current position for drawing
      orb.x = x;
      orb.y = y;
    }
  }

  // ============================================================
  // DRAW
  // ============================================================

  // Returns color strings for an orb — either the fixed cyan palette or a rainbow hue
  function orbColors(orb, masterAlpha) {
    if (!rainbowMode) {
      return {
        glow: (a) => `${CFG.orbGlowColor}${a})`,
        core: (a) => `${CFG.orbCoreColor}${a})`,
      };
    }
    const hue        = (globalHue + orb.hueOffset) % 360;
    const glowBase   = `hsla(${hue.toFixed(1)}, 100%, 60%,`;
    const coreBase   = `hsla(${hue.toFixed(1)}, 80%, 88%,`;
    return {
      glow: (a) => `${glowBase}${a})`,
      core: (a) => `${coreBase}${a})`,
    };
  }

  function draw() {
    if (!ctx || !canvas) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    for (const orb of orbs) {
      if (!orb.x) continue;
      const masterAlpha = orb.opacity;
      const col = orbColors(orb, masterAlpha);

      // ── Draw comet trail ──
      const tLen = orb.trail.length;
      if (tLen > 1) {
        for (let i = 1; i < tLen; i++) {
          const t     = i / tLen;
          const alpha = t * CFG.trailMaxAlpha * masterAlpha;
          const width = Math.max(0.5, CFG.orbRadius * t * 0.85);

          const prev = orb.trail[i - 1];
          const curr = orb.trail[i];

          ctx.beginPath();
          ctx.moveTo(prev.x, prev.y);
          ctx.lineTo(curr.x, curr.y);
          ctx.strokeStyle = col.glow(alpha.toFixed(3));
          ctx.lineWidth   = width;
          ctx.lineCap     = 'round';
          ctx.stroke();
        }
      }

      // ── Draw orb glow (outer radial) ──
      const glow = ctx.createRadialGradient(orb.x, orb.y, 0, orb.x, orb.y, CFG.glowRadius);
      glow.addColorStop(0,    col.glow((0.85 * masterAlpha).toFixed(3)));
      glow.addColorStop(0.35, col.glow((0.40 * masterAlpha).toFixed(3)));
      glow.addColorStop(1,    col.glow('0'));

      ctx.beginPath();
      ctx.arc(orb.x, orb.y, CFG.glowRadius, 0, Math.PI * 2);
      ctx.fillStyle = glow;
      ctx.fill();

      // ── Draw orb core (bright centre dot) ──
      const core = ctx.createRadialGradient(orb.x, orb.y, 0, orb.x, orb.y, CFG.orbRadius);
      core.addColorStop(0,   col.core(masterAlpha.toFixed(3)));
      core.addColorStop(0.6, col.glow((0.9 * masterAlpha).toFixed(3)));
      core.addColorStop(1,   col.glow((0.3 * masterAlpha).toFixed(3)));

      ctx.beginPath();
      ctx.arc(orb.x, orb.y, CFG.orbRadius, 0, Math.PI * 2);
      ctx.fillStyle = core;
      ctx.fill();
    }
  }

  // ============================================================
  // PUBLIC API
  // ============================================================

  /**
   * Set the number of active electron orbs.
   * Orbs smoothly fade in when added, fade out when removed.
   * setCount(0) removes all orbs and eventually stops the canvas loop.
   */
  function setCount(n) {
    targetCount = Math.max(0, n);

    if (targetCount > 0) {
      ensureCanvas();
      startLoop();
    }
    // If dropping to 0 the loop will self-terminate once all orbs finish fading
  }

  /**
   * Immediately clear all orbs (hard reset, no fade).
   * Used when switching fully to DORMANT.
   */
  function reset() {
    targetCount = 0;
    rainbowMode = false;
    orbs.length = 0;
    stopLoop();
  }

  /**
   * Switch colour mode.
   * setMode('rainbow') — orbs cycle through a hue sequence (coding agent active)
   * setMode('default') — standard cyan palette
   */
  function setMode(mode) {
    rainbowMode = (mode === 'rainbow');
    if (!rainbowMode) globalHue = 0;
  }

  // Expose globally
  global.ElectronOrbs = { setCount, reset, setMode };

})(window);
