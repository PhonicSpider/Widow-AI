// renderer/js/cat-headphones.js — Cat-ear headphone mute indicator
// Injects an SVG overlay into #orb-container that fades in when the mic is muted.

const CatHeadphones = (() => {

  // ============================================================
  // CONFIGURATION
  // ============================================================

  const CFG = {
    // Must match --orb-size in main.css
    size: 550,

    // Visual palette
    strokeColor: '#09e0e0',
    fillDark:    '#030d14',
    fillEar:     '#0d0320',
    glowBlur:    5,

    // z-index — above electron-orbs canvas (z=5), below transcript (z=15)
    zIndex: 6,

    fadeMs: 450,
  };

  let svg     = null;
  let visible = false;

  // ------------------------------------------------------------------
  // SVG geometry (all coords in CFG.size × CFG.size space)
  //
  // Orb sphere in a 550×550 canvas, camera at distance 3.5:
  //   - visual radius ≈ 180 px, center ≈ (275, 265)
  //   - top of sphere  ≈ y  85
  //   - equator left   ≈ x  95,  y 265
  //   - equator right  ≈ x 455,  y 265
  //
  // Band arcs from left earcup top (93, 210) to right (457, 210),
  // peaking at y ≈ 60 — just above the orb.
  // Cat ears sit at t≈0.28 and t≈0.72 along the band cubic bezier.
  // ------------------------------------------------------------------

  function _buildSVG() {
    const s = CFG.size;
    const c = CFG.strokeColor;

    const el = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    el.setAttribute('xmlns',   'http://www.w3.org/2000/svg');
    el.setAttribute('viewBox', `0 0 ${s} ${s}`);
    el.style.cssText = [
      'position:absolute',
      'top:0',
      'left:0',
      `width:${s}px`,
      `height:${s}px`,
      'pointer-events:none',
      `z-index:${CFG.zIndex}`,
      'opacity:0',
      `transition:opacity ${CFG.fadeMs}ms ease`,
    ].join(';');

    el.innerHTML = `
      <defs>
        <filter id="hp-glow" x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="${CFG.glowBlur}" result="gblur"/>
          <feMerge>
            <feMergeNode in="gblur"/>
            <feMergeNode in="gblur"/>
            <feMergeNode in="SourceGraphic"/>
          </feMerge>
        </filter>
      </defs>

      <g filter="url(#hp-glow)"
         stroke="${c}" stroke-linecap="round" stroke-linejoin="round" fill="none">

        <!-- ── Headphone band arc ── -->
        <path d="M 93 212 C 93 58, 457 58, 457 212"
              stroke="${c}" stroke-width="5"/>

        <!-- ── Left earcup ── -->
        <ellipse cx="90"  cy="238" rx="41" ry="52"
                 fill="${CFG.fillDark}" stroke="${c}" stroke-width="3.5"/>
        <ellipse cx="90"  cy="238" rx="27" ry="35"
                 fill="#061620" stroke="${c}" stroke-width="1.5" opacity="0.75"/>

        <!-- ── Right earcup ── -->
        <ellipse cx="460" cy="238" rx="41" ry="52"
                 fill="${CFG.fillDark}" stroke="${c}" stroke-width="3.5"/>
        <ellipse cx="460" cy="238" rx="27" ry="35"
                 fill="#061620" stroke="${c}" stroke-width="1.5" opacity="0.75"/>

        <!-- ── Left cat ear (outer shell) ── -->
        <polygon points="143,116  164,44  200,112"
                 fill="${CFG.fillDark}" stroke="${c}" stroke-width="3.2"/>
        <!-- Left cat ear (inner pink) -->
        <polygon points="153,108  164,60  191,106"
                 fill="${CFG.fillEar}" stroke="${c}" stroke-width="1" opacity="0.65"/>

        <!-- ── Right cat ear (outer shell) ── -->
        <polygon points="350,112  386,44  407,116"
                 fill="${CFG.fillDark}" stroke="${c}" stroke-width="3.2"/>
        <!-- Right cat ear (inner pink) -->
        <polygon points="359,106  386,60  397,108"
                 fill="${CFG.fillEar}" stroke="${c}" stroke-width="1" opacity="0.65"/>

        <!-- ── Mic-off symbol on left earcup ──
             Circle with a diagonal slash = universally understood "muted" -->
        <circle cx="90" cy="238" r="12"
                stroke="${c}" stroke-width="2" fill="none" opacity="0.9"/>
        <line   x1="79" y1="226" x2="101" y2="250"
                stroke="${c}" stroke-width="2.5" opacity="0.9"/>

      </g>
    `;

    return el;
  }

  // ------------------------------------------------------------------

  function init(containerId) {
    if (svg) return;
    const container = document.getElementById(containerId);
    if (!container) return;
    svg = _buildSVG();
    container.appendChild(svg);
  }

  function show() {
    if (!svg) return;
    visible = true;
    svg.style.opacity = '1';
  }

  function hide() {
    if (!svg) return;
    visible = false;
    svg.style.opacity = '0';
  }

  function isVisible() { return visible; }

  return { init, show, hide, isVisible };
})();
