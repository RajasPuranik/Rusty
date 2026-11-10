// Mayank Skin Effects Module: 30 FPS Wind Lines 2D Background & Glowing Weather Orb
// Designed for ultra-low memory (< 15 MB RAM) with zero WebGL dependencies.
(function () {
  'use strict';

  // 1. Reduced motion check
  const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  const reducedMotion = mediaQuery.matches;

  let animId = null;
  let orbAnimId = null;
  let isHidden = document.hidden;
  const FPS_INTERVAL = 1000 / 30; // 30 FPS cap

  // ── 2. Wind Lines Background Canvas ─────────────────────────────────────
  const canvas = document.getElementById('ntp-canvas');
  if (canvas && !reducedMotion) {
    const ctx = canvas.getContext('2d');
    let width = (canvas.width = window.innerWidth);
    let height = (canvas.height = window.innerHeight);

    window.addEventListener('resize', () => {
      width = canvas.width = window.innerWidth;
      height = canvas.height = window.innerHeight;
    });

    // 14 faint breeze curves
    const lines = [];
    for (let i = 0; i < 14; i++) {
      lines.push({
        x: Math.random() * width,
        y: Math.random() * height,
        len: Math.random() * 180 + 120,
        speed: Math.random() * 0.9 + 0.4,
        amplitude: Math.random() * 16 + 8,
        freq: Math.random() * 0.015 + 0.005,
        opacity: Math.random() * 0.12 + 0.05,
        phase: Math.random() * Math.PI * 2
      });
    }

    let lastTime = 0;
    function renderWind(time) {
      if (isHidden) {
        animId = null;
        return;
      }
      animId = requestAnimationFrame(renderWind);
      if (time - lastTime < FPS_INTERVAL) return;
      lastTime = time;

      ctx.clearRect(0, 0, width, height);

      for (let i = 0; i < lines.length; i++) {
        const l = lines[i];
        l.x += l.speed;
        l.phase += 0.02;

        if (l.x - l.len > width) {
          l.x = -l.len;
          l.y = Math.random() * height;
        }

        ctx.beginPath();
        const steps = 18;
        for (let s = 0; s <= steps; s++) {
          const px = l.x - (s / steps) * l.len;
          const py = l.y + Math.sin(px * l.freq + l.phase) * l.amplitude;
          if (s === 0) {
            ctx.moveTo(px, py);
          } else {
            ctx.lineTo(px, py);
          }
        }

        // Soft gradient for each breeze curve
        const grad = ctx.createLinearGradient(l.x - l.len, l.y, l.x, l.y);
        grad.addColorStop(0, 'rgba(163, 177, 198, 0)');
        grad.addColorStop(0.5, `rgba(148, 163, 184, ${l.opacity})`);
        grad.addColorStop(1, 'rgba(249, 115, 22, 0)');

        ctx.strokeStyle = grad;
        ctx.lineWidth = 1.4;
        ctx.stroke();
      }
    }

    function syncWindCanvas() {
      if (!isHidden && animId === null) {
        lastTime = performance.now();
        animId = requestAnimationFrame(renderWind);
      } else if (isHidden && animId !== null) {
        cancelAnimationFrame(animId);
        animId = null;
        ctx.clearRect(0, 0, width, height);
      }
    }

    syncWindCanvas();
  }

  // ── 3. Glowing Weather Orb (Sun / Moon) ──────────────────────────────────
  const globeSlot = document.getElementById('globe-slot');
  if (globeSlot) {
    // Hide WebGL globe elements in Mayank skin
    const globeCanvas = document.getElementById('globe-canvas');
    if (globeCanvas) globeCanvas.hidden = true;
    const fallbackImg = document.getElementById('globe-fallback-img');
    if (fallbackImg) fallbackImg.hidden = true;
    const halo = document.querySelector('.globe-atmo-halo');
    if (halo) halo.style.display = 'none';

    // Create or locate the 2D weather orb canvas
    let orbCanvas = document.getElementById('weather-orb-canvas');
    if (!orbCanvas) {
      orbCanvas = document.createElement('canvas');
      orbCanvas.id = 'weather-orb-canvas';
      orbCanvas.className = 'weather-orb-canvas';
      orbCanvas.width = 160;
      orbCanvas.height = 160;
      globeSlot.appendChild(orbCanvas);
    }

    const orbCtx = orbCanvas.getContext('2d');
    const isDaytime = () => {
      const h = new Date().getHours();
      return h >= 6 && h < 19;
    };

    let pulsePhase = 0;
    let lastOrbTime = 0;

    function renderOrb(time) {
      if (isHidden) {
        orbAnimId = null;
        return;
      }
      orbAnimId = requestAnimationFrame(renderOrb);
      if (time - lastOrbTime < FPS_INTERVAL) return;
      lastOrbTime = time;

      pulsePhase += 0.035;
      const pulse = Math.sin(pulsePhase) * 4;

      orbCtx.clearRect(0, 0, 160, 160);
      const cx = 80;
      const cy = 80;
      const day = isDaytime();

      if (day) {
        // Warm Radiant Sun Orb with pulsing corona
        const outerGrad = orbCtx.createRadialGradient(cx, cy, 32, cx, cy, 54 + pulse);
        outerGrad.addColorStop(0, 'rgba(249, 115, 22, 0.45)');
        outerGrad.addColorStop(0.6, 'rgba(251, 146, 60, 0.22)');
        outerGrad.addColorStop(1, 'rgba(251, 146, 60, 0)');
        orbCtx.fillStyle = outerGrad;
        orbCtx.beginPath();
        orbCtx.arc(cx, cy, 54 + pulse, 0, Math.PI * 2);
        orbCtx.fill();

        // Inner glowing core
        const coreGrad = orbCtx.createRadialGradient(cx - 8, cy - 8, 4, cx, cy, 34);
        coreGrad.addColorStop(0, '#fef08a');
        coreGrad.addColorStop(0.5, '#f97316');
        coreGrad.addColorStop(1, '#ea580c');
        orbCtx.fillStyle = coreGrad;
        orbCtx.beginPath();
        orbCtx.arc(cx, cy, 34, 0, Math.PI * 2);
        orbCtx.fill();
      } else {
        // Serene Glowing Moon Orb with soft indigo halo
        const moonHalo = orbCtx.createRadialGradient(cx, cy, 30, cx, cy, 52 + pulse * 0.7);
        moonHalo.addColorStop(0, 'rgba(148, 163, 184, 0.35)');
        moonHalo.addColorStop(0.7, 'rgba(100, 116, 139, 0.15)');
        moonHalo.addColorStop(1, 'rgba(100, 116, 139, 0)');
        orbCtx.fillStyle = moonHalo;
        orbCtx.beginPath();
        orbCtx.arc(cx, cy, 52 + pulse * 0.7, 0, Math.PI * 2);
        orbCtx.fill();

        // Moon crescent / orb
        const moonCore = orbCtx.createRadialGradient(cx - 6, cy - 6, 2, cx, cy, 32);
        moonCore.addColorStop(0, '#ffffff');
        moonCore.addColorStop(0.6, '#e2e8f0');
        moonCore.addColorStop(1, '#94a3b8');
        orbCtx.fillStyle = moonCore;
        orbCtx.beginPath();
        orbCtx.arc(cx, cy, 32, 0, Math.PI * 2);
        orbCtx.fill();
      }
    }

    function syncOrb() {
      if (!isHidden && orbAnimId === null) {
        lastOrbTime = performance.now();
        orbAnimId = requestAnimationFrame(renderOrb);
      } else if (isHidden && orbAnimId !== null) {
        cancelAnimationFrame(orbAnimId);
        orbAnimId = null;
        orbCtx.clearRect(0, 0, 160, 160);
      }
    }

    syncOrb();
  }

  // ── 4. Lifecycle Event Listeners ─────────────────────────────────────────
  document.addEventListener('visibilitychange', () => {
    isHidden = document.hidden;
    if (typeof syncWindCanvas === 'function') syncWindCanvas();
    if (typeof syncOrb === 'function') syncOrb();
  });

  // Global unmount hook for clean skin switching
  window.__fxMayankUnmount = function () {
    if (animId !== null) {
      cancelAnimationFrame(animId);
      animId = null;
    }
    if (orbAnimId !== null) {
      cancelAnimationFrame(orbAnimId);
      orbAnimId = null;
    }
    const orb = document.getElementById('weather-orb-canvas');
    if (orb) orb.remove();
  };
})();
