// Crazy Skin Effects Module: Reactive particle canvas, 3D tilt, magnetic buttons, ripples
(function () {
  'use strict';

  // Respect prefers-reduced-motion
  const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  if (mediaQuery.matches) {
    console.info('[fx-crazy] Reduced motion preferred. Disabling heavy animations.');
    return;
  }

  let intensity = 0.6; // Default intensity 60%
  try {
    const raw = localStorage.getItem('rusty_browser_settings');
    if (raw) {
      const s = JSON.parse(raw);
      if (s.effects_intensity !== undefined) {
        intensity = s.effects_intensity / 100;
      }
    }
  } catch (_) {}

  if (intensity <= 0) return;

  // ── 1. Click Ripple Effect ───────────────────────────────────────────────
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.btn-icon, .btn-new-tab, .dial-card, .chip');
    if (!btn) return;

    const rect = btn.getBoundingClientRect();
    const ripple = document.createElement('span');
    const size = Math.max(rect.width, rect.height) * 2;
    ripple.style.width = `${size}px`;
    ripple.style.height = `${size}px`;
    ripple.style.position = 'absolute';
    ripple.style.borderRadius = '50%';
    ripple.style.background = 'radial-gradient(circle, rgba(255,255,255,0.4) 0%, rgba(255,255,255,0) 70%)';
    ripple.style.left = `${e.clientX - rect.left - size / 2}px`;
    ripple.style.top = `${e.clientY - rect.top - size / 2}px`;
    ripple.style.pointerEvents = 'none';
    ripple.style.transform = 'scale(0)';
    ripple.style.opacity = '1';
    ripple.style.transition = 'transform 0.4s ease-out, opacity 0.4s ease-out';

    btn.style.position = 'relative';
    btn.style.overflow = 'hidden';
    btn.appendChild(ripple);

    requestAnimationFrame(() => {
      ripple.style.transform = 'scale(1)';
      ripple.style.opacity = '0';
    });

    setTimeout(() => ripple.remove(), 450);
  });

  // ── 2. Constellation / Starfield Canvas Background (for NTP) ──────────────
  const canvas = document.getElementById('ntp-canvas');
  if (canvas) {
    const ctx = canvas.getContext('2d');
    let width = (canvas.width = window.innerWidth);
    let height = (canvas.height = window.innerHeight);
    let mouse = { x: -1000, y: -1000 };
    let animId = null;
    let isHidden = false;

    window.addEventListener('resize', () => {
      width = canvas.width = window.innerWidth;
      height = canvas.height = window.innerHeight;
    });

    window.addEventListener('mousemove', (e) => {
      mouse.x = e.clientX;
      mouse.y = e.clientY;
    });

    const numPoints = Math.floor(40 * intensity);
    const points = [];
    for (let i = 0; i < numPoints; i++) {
      points.push({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.8 * intensity,
        vy: (Math.random() - 0.5) * 0.8 * intensity,
        radius: Math.random() * 2 + 1
      });
    }

    // Cap at ~30 FPS to save CPU and RAM
    let lastTime = 0;
    const interval = 1000 / 30;

    function render(time) {
      if (isHidden) return;
      animId = requestAnimationFrame(render);
      if (time - lastTime < interval) return;
      lastTime = time;

      ctx.clearRect(0, 0, width, height);

      // Draw connecting lines
      ctx.lineWidth = 0.5;
      for (let i = 0; i < points.length; i++) {
        const p1 = points[i];
        p1.x += p1.vx;
        p1.y += p1.vy;
        if (p1.x < 0 || p1.x > width) p1.vx *= -1;
        if (p1.y < 0 || p1.y > height) p1.vy *= -1;

        // Line to mouse
        const dxm = mouse.x - p1.x;
        const dym = mouse.y - p1.y;
        const distM = Math.sqrt(dxm * dxm + dym * dym);
        if (distM < 140) {
          ctx.strokeStyle = `rgba(138, 180, 248, ${(1 - distM / 140) * 0.35 * intensity})`;
          ctx.beginPath();
          ctx.moveTo(p1.x, p1.y);
          ctx.lineTo(mouse.x, mouse.y);
          ctx.stroke();
        }

        // Connect nearby points
        for (let j = i + 1; j < points.length; j++) {
          const p2 = points[j];
          const dx = p1.x - p2.x;
          const dy = p1.y - p2.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 100) {
            ctx.strokeStyle = `rgba(138, 180, 248, ${(1 - dist / 100) * 0.18 * intensity})`;
            ctx.beginPath();
            ctx.moveTo(p1.x, p1.y);
            ctx.lineTo(p2.x, p2.y);
            ctx.stroke();
          }
        }

        ctx.fillStyle = 'rgba(138, 180, 248, 0.4)';
        ctx.beginPath();
        ctx.arc(p1.x, p1.y, p1.radius, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Pause animation when minimized or hidden
    document.addEventListener('visibilitychange', () => {
      isHidden = document.hidden;
      if (isHidden) {
        cancelAnimationFrame(animId);
      } else {
        lastTime = performance.now();
        animId = requestAnimationFrame(render);
      }
    });

    animId = requestAnimationFrame(render);
  }
})();
