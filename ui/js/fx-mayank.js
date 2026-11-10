// Mayank Skin Effects: Crisp Wind Lines with Glowing Electric Blue Edge & Weather Orb
// High efficiency 2D Canvas (< 15MB RAM) with transform-only drift and mouse parallax
(function () {
  'use strict';

  // Weather orb slot support for Mayank skin (weather-orb-canvas)
  const globeSlot = document.getElementById('globe-slot');
  if (globeSlot) {
    let orbCanvas = document.getElementById('weather-orb-canvas');
    if (!orbCanvas) {
      orbCanvas = document.createElement('canvas');
      orbCanvas.id = 'weather-orb-canvas';
      orbCanvas.className = 'weather-orb-canvas';
      orbCanvas.width = 160;
      orbCanvas.height = 160;
      orbCanvas.style.display = 'none'; // Controlled by weather widget
      globeSlot.appendChild(orbCanvas);
    }
  }

  const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  const reducedMotion = mediaQuery.matches;

  const canvas = document.getElementById('ntp-canvas');
  if (!canvas || reducedMotion) return;

  const ctx = canvas.getContext('2d');
  let width = (canvas.width = window.innerWidth);
  let height = (canvas.height = window.innerHeight);

  let animId = null;
  let isHidden = document.hidden;
  const FPS_INTERVAL = 1000 / 30; // 30 FPS cap
  let lastTime = 0;

  let accentRgb = '56, 189, 248'; // Default electric sky blue
  let accentSecondaryRgb = '14, 165, 233';

  function refreshColors() {
    try {
      const style = getComputedStyle(document.documentElement);
      const acc = (style.getPropertyValue('--accent-primary') || style.getPropertyValue('--accent') || '#38bdf8').trim();
      const acc2 = (style.getPropertyValue('--accent-secondary') || style.getPropertyValue('--accent-2') || '#0ea5e9').trim();

      if (/^#[0-9a-fA-F]{6}$/.test(acc)) {
        const r = parseInt(acc.slice(1, 3), 16);
        const g = parseInt(acc.slice(3, 5), 16);
        const b = parseInt(acc.slice(5, 7), 16);
        accentRgb = `${r}, ${g}, ${b}`;
      }
      if (/^#[0-9a-fA-F]{6}$/.test(acc2)) {
        const r = parseInt(acc2.slice(1, 3), 16);
        const g = parseInt(acc2.slice(3, 5), 16);
        const b = parseInt(acc2.slice(5, 7), 16);
        accentSecondaryRgb = `${r}, ${g}, ${b}`;
      }
    } catch (_) {}
  }

  refreshColors();
  window.addEventListener('themechange', refreshColors);
  window.addEventListener('resize', () => {
    width = canvas.width = window.innerWidth;
    height = canvas.height = window.innerHeight;
  });

  // Mouse Parallax
  let mouseX = width / 2;
  let mouseY = height / 2;
  let offsetX = 0;
  let offsetY = 0;

  window.addEventListener('mousemove', (e) => {
    mouseX = e.clientX;
    mouseY = e.clientY;
  }, { passive: true });

  let driftPhase = 0;

  function drawGlowArc(cx, cy, radius, startAngle, endAngle, crispAlpha, auraAlpha) {
    // 1. Soft diffuse aura along the curved rim
    ctx.beginPath();
    ctx.arc(cx, cy, radius, startAngle, endAngle);
    ctx.strokeStyle = `rgba(${accentRgb}, ${auraAlpha})`;
    ctx.lineWidth = 10;
    ctx.stroke();

    // 2. Secondary soft aura
    ctx.beginPath();
    ctx.arc(cx, cy, radius, startAngle, endAngle);
    ctx.strokeStyle = `rgba(${accentSecondaryRgb}, ${auraAlpha * 1.5})`;
    ctx.lineWidth = 4.5;
    ctx.stroke();

    // 3. Crisp luminous glowing inner edge
    ctx.beginPath();
    ctx.arc(cx, cy, radius, startAngle, endAngle);
    ctx.strokeStyle = `rgba(${accentRgb}, ${crispAlpha})`;
    ctx.lineWidth = 1.8;
    ctx.stroke();
  }

  function render(time) {
    if (isHidden) {
      animId = null;
      return;
    }
    animId = requestAnimationFrame(render);
    if (time - lastTime < FPS_INTERVAL) return;
    lastTime = time;

    // Smooth parallax lerp
    const targetX = (mouseX - width / 2) * 0.025;
    const targetY = (mouseY - height / 2) * 0.025;
    offsetX += (targetX - offsetX) * 0.08;
    offsetY += (targetY - offsetY) * 0.08;

    driftPhase += 0.008;
    const driftSin = Math.sin(driftPhase) * 6;
    const driftCos = Math.cos(driftPhase * 0.8) * 5;

    ctx.clearRect(0, 0, width, height);

    const minDim = Math.min(width, height);

    // ── 1. Top-Left Nested Arcs (Sweeping from Left Rail toward Address Bar) ──
    const tlCx = -width * 0.04 + offsetX + driftSin;
    const tlCy = -height * 0.06 + offsetY + driftCos;

    // Outer Arc
    drawGlowArc(
      tlCx,
      tlCy,
      minDim * 0.68,
      0.08 * Math.PI,
      0.52 * Math.PI,
      0.82,
      0.18
    );

    // Inner Arc
    drawGlowArc(
      tlCx,
      tlCy,
      minDim * 0.52,
      0.12 * Math.PI,
      0.56 * Math.PI,
      0.65,
      0.12
    );

    // ── 2. Bottom-Right Nested Arcs (Rising toward Right Widget Column) ───────
    const brCx = width * 1.04 + offsetX - driftSin;
    const brCy = height * 1.06 + offsetY - driftCos;

    // Outer Arc
    drawGlowArc(
      brCx,
      brCy,
      minDim * 0.62,
      1.06 * Math.PI,
      1.52 * Math.PI,
      0.85,
      0.20
    );

    // Inner Arc
    drawGlowArc(
      brCx,
      brCy,
      minDim * 0.46,
      1.10 * Math.PI,
      1.56 * Math.PI,
      0.60,
      0.12
    );

    // ── 3. Bottom-Left Faint Arc ──────────────────────────────────────────────
    const blCx = -width * 0.02 + offsetX * 0.5;
    const blCy = height * 1.02 + offsetY * 0.5;

    drawGlowArc(
      blCx,
      blCy,
      minDim * 0.38,
      1.58 * Math.PI,
      1.96 * Math.PI,
      0.40,
      0.08
    );
  }

  function sync() {
    if (!isHidden && animId === null) {
      lastTime = performance.now();
      animId = requestAnimationFrame(render);
    } else if (isHidden && animId !== null) {
      cancelAnimationFrame(animId);
      animId = null;
      ctx.clearRect(0, 0, width, height);
    }
  }

  document.addEventListener('visibilitychange', () => {
    isHidden = document.hidden;
    sync();
  });

  sync();
})();
