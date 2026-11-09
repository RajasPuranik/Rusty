// Crazy Skin Effects Module: Spotlight glow, magnetic drift, 3D tilt, ripples, comet trail, particle poof, confetti burst, constellation canvas
(function () {
  'use strict';

  const STORAGE_KEY = 'rusty_browser_settings_v4';

  // 1. Check prefers-reduced-motion
  const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  if (mediaQuery.matches) {
    console.info('[fx-crazy] Reduced motion preferred. Bypassing heavy animations.');
    return;
  }

  // 2. Dynamic intensity and toggle state
  let intensity = 0.8;
  let fxGlow = true;
  let fxTilt = true;
  let fxMagnetic = true;
  let fxRipple = true;
  let fxTrail = false;
  let fxConfetti = true;
  let fxCanvasBg = true;
  let accentRgb = '249, 115, 22';

  function refreshAccentRgb() {
    try {
      const hex = getComputedStyle(document.documentElement).getPropertyValue('--accent-primary').trim();
      if (/^#[0-9a-fA-F]{6}$/.test(hex)) {
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        accentRgb = `${r}, ${g}, ${b}`;
      }
    } catch (_) {}
  }

  function applySettingsObj(s) {
    if (!s || typeof s !== 'object') return;
    if (s.effects_intensity !== undefined) intensity = Math.max(0, Math.min(1, Number(s.effects_intensity) / 100));
    if (s.fx_glow !== undefined) fxGlow = Boolean(s.fx_glow);
    if (s.fx_tilt !== undefined) fxTilt = Boolean(s.fx_tilt);
    if (s.fx_magnetic !== undefined) fxMagnetic = Boolean(s.fx_magnetic);
    if (s.fx_ripple !== undefined) fxRipple = Boolean(s.fx_ripple);
    if (s.fx_trail !== undefined) fxTrail = Boolean(s.fx_trail);
    if (s.fx_confetti !== undefined) fxConfetti = Boolean(s.fx_confetti);
    if (s.fx_canvas_bg !== undefined) fxCanvasBg = Boolean(s.fx_canvas_bg);
    refreshAccentRgb();
    if (typeof window.__fxCrazySyncCanvas === 'function') {
      window.__fxCrazySyncCanvas();
    }
  }

  function loadFxSettings() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        applySettingsObj(JSON.parse(raw));
      } else if (window.BOOT_SETTINGS) {
        applySettingsObj(window.BOOT_SETTINGS);
      }
    } catch (_) {}
    refreshAccentRgb();
  }

  loadFxSettings();
  window.addEventListener('settings-changed', (e) => applySettingsObj(e.detail));
  if (window.bridge && typeof window.bridge.on === 'function') {
    window.bridge.on('ui_settings_sync', (data) => {
      if (data && data.settings) applySettingsObj(data.settings);
    });
  }

  // ── 3. Cursor Spotlight Glow Overlay ─────────────────────────────────────
  document.addEventListener('mousemove', (e) => {
    if (!fxGlow || intensity <= 0.01) return;
    const target = e.target.closest('.btn-icon, .btn-new-tab, .tab-item, .dial-card, .dial-pill, .action-card, .chip, .skin-card, .dock-btn');
    if (!target) return;
    target.classList.add('spotlight-glow');
    const rect = target.getBoundingClientRect();
    target.style.setProperty('--mouse-x', `${e.clientX - rect.left}px`);
    target.style.setProperty('--mouse-y', `${e.clientY - rect.top}px`);
  }, { passive: true });

  // ── 4. Magnetic Buttons (Drift gently toward cursor) ──────────────────────
  document.addEventListener('mousemove', (e) => {
    if (!fxMagnetic || intensity <= 0.01) return;
    const btn = e.target.closest('.btn-icon, .btn-new-tab, .dock-btn');
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const dx = (e.clientX - centerX) * 0.22 * intensity;
    const dy = (e.clientY - centerY) * 0.22 * intensity;
    btn.style.transform = `translate(${dx}px, ${dy}px)`;
  }, { passive: true });

  document.addEventListener('mouseout', (e) => {
    const btn = e.target.closest('.btn-icon, .btn-new-tab, .dock-btn');
    if (btn) {
      btn.style.transform = '';
    }
  });

  // ── 5. 3D Card & Speed-Dial Tile Tilt ────────────────────────────────────
  document.addEventListener('mousemove', (e) => {
    if (!fxTilt || intensity <= 0.01) return;
    if (e.target.closest('#globe-slot')) return;
    const card = e.target.closest('.dial-card, .dial-pill, .action-card, .skin-card, .widget-card:not(:focus-within):not(.expanded)');
    if (!card) return;
    const rect = card.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;
    const rotateX = ((y - centerY) / centerY) * -8 * intensity;
    const rotateY = ((x - centerX) / centerX) * 8 * intensity;
    card.style.transform = `perspective(600px) rotateX(${rotateX.toFixed(1)}deg) rotateY(${rotateY.toFixed(1)}deg) scale3d(1.015, 1.015, 1.015)`;
  }, { passive: true });

  document.addEventListener('mouseout', (e) => {
    const card = e.target.closest('.dial-card, .dial-pill, .action-card, .skin-card, .widget-card');
    if (card) {
      card.style.transform = '';
    }
  });

  // ── 6. Click Ripple Effect ───────────────────────────────────────────────
  document.addEventListener('click', (e) => {
    if (!fxRipple || intensity <= 0.01) return;
    const btn = e.target.closest('.btn-icon, .btn-new-tab, .dial-card, .dial-pill, .chip, .palette-item, .theme-swatch, .dock-btn');
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

    setTimeout(() => ripple.remove(), 420);
  });

  // ── 7. Optional Comet Cursor Trail (Off by default, toggleable in Settings) ─
  let lastTrailTime = 0;
  document.addEventListener('mousemove', (e) => {
    if (!fxTrail || intensity <= 0.01) return;
    const now = performance.now();
    if (now - lastTrailTime < 35) return;
    lastTrailTime = now;

    const spark = document.createElement('div');
    spark.className = 'fx-burst-particle';
    const size = Math.random() * 4 + 2;
    spark.style.width = `${size}px`;
    spark.style.height = `${size}px`;
    spark.style.left = `${e.clientX}px`;
    spark.style.top = `${e.clientY}px`;
    spark.style.background = `radial-gradient(circle, rgb(${accentRgb}) 0%, #ec4899 100%)`;
    spark.style.opacity = '0.8';
    spark.style.boxShadow = `0 0 6px rgba(${accentRgb}, 0.8)`;
    spark.style.transition = 'transform 0.35s ease-out, opacity 0.35s ease-out';
    document.body.appendChild(spark);

    requestAnimationFrame(() => {
      spark.style.transform = `translate(${(Math.random() - 0.5) * 16}px, ${(Math.random() - 0.5) * 16 + 8}px) scale(0)`;
      spark.style.opacity = '0';
    });
    setTimeout(() => spark.remove(), 360);
  }, { passive: true });

  // ── 8. Tab Close Particle "Poof" ─────────────────────────────────────────
  window.fxTabPoof = function (x, y) {
    if (!fxConfetti || intensity <= 0.01) return;
    const colors = ['#8ab4f8', '#38bdf8', '#ec4899', '#facc15', '#4ade80'];
    const count = Math.floor(14 * intensity);

    for (let i = 0; i < count; i++) {
      const p = document.createElement('div');
      p.className = 'fx-burst-particle';
      const size = Math.random() * 6 + 3;
      p.style.width = `${size}px`;
      p.style.height = `${size}px`;
      p.style.left = `${x}px`;
      p.style.top = `${y}px`;
      p.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
      p.style.boxShadow = `0 0 6px ${p.style.backgroundColor}`;
      p.style.transition = 'transform 0.45s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.45s ease-out';
      document.body.appendChild(p);

      const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.4;
      const dist = Math.random() * 32 + 20;
      const destX = Math.cos(angle) * dist;
      const destY = Math.sin(angle) * dist;

      requestAnimationFrame(() => {
        p.style.transform = `translate(${destX}px, ${destY}px) scale(0.2)`;
        p.style.opacity = '0';
      });

      setTimeout(() => p.remove(), 460);
    }
  };

  // ── 9. Confetti Burst (Bookmark Added / Download Finished) ───────────────
  window.fxConfettiBurst = function (originX, originY) {
    if (!fxConfetti || intensity <= 0.01) return;
    const colors = ['#3b82f6', '#ec4899', '#f59e0b', '#10b981', '#8b5cf6', '#06b6d4', '#f43f5e'];
    const count = Math.floor(45 * intensity);
    const startX = originX || window.innerWidth / 2;
    const startY = originY || 40;

    for (let i = 0; i < count; i++) {
      const c = document.createElement('div');
      c.className = 'fx-burst-particle';
      const isRect = Math.random() > 0.5;
      const w = Math.random() * 8 + 4;
      const h = isRect ? Math.random() * 12 + 6 : w;
      c.style.width = `${w}px`;
      c.style.height = `${h}px`;
      c.style.borderRadius = isRect ? '2px' : '50%';
      c.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
      c.style.left = `${startX}px`;
      c.style.top = `${startY}px`;
      c.style.transition = 'transform 0.8s cubic-bezier(0.25, 1, 0.5, 1), opacity 0.8s ease-in';
      document.body.appendChild(c);

      const angle = Math.random() * Math.PI * 2;
      const speed = Math.random() * 160 + 60;
      const destX = Math.cos(angle) * speed;
      const destY = Math.sin(angle) * speed + 120;
      const rot = Math.random() * 720 - 360;

      requestAnimationFrame(() => {
        c.style.transform = `translate(${destX}px, ${destY}px) rotate(${rot}deg) scale(0.6)`;
        c.style.opacity = '0';
      });

      setTimeout(() => c.remove(), 850);
    }
  };

  // Trigger confetti burst on bookmark star click
  const starBtn = document.getElementById('btn-star');
  if (starBtn) {
    starBtn.addEventListener('click', () => {
      const rect = starBtn.getBoundingClientRect();
      window.fxConfettiBurst(rect.left + rect.width / 2, rect.top + rect.height / 2);
    });
  }

  // ── 10. Constellation Canvas Background (Cap at 30 FPS, Pause on Hidden) ──
  const canvas = document.getElementById('ntp-canvas');
  if (canvas) {
    const ctx = canvas.getContext('2d');
    let width = (canvas.width = window.innerWidth);
    let height = (canvas.height = window.innerHeight);
    let mouse = { x: -1000, y: -1000 };
    let animId = null;
    let isHidden = document.hidden;

    window.addEventListener('resize', () => {
      width = canvas.width = window.innerWidth;
      height = canvas.height = window.innerHeight;
    });

    window.addEventListener('mousemove', (e) => {
      mouse.x = e.clientX;
      mouse.y = e.clientY;
    }, { passive: true });

    const points = [];
    for (let i = 0; i < 42; i++) {
      points.push({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.85,
        vy: (Math.random() - 0.5) * 0.85,
        radius: Math.random() * 1.8 + 1
      });
    }

    let lastTime = 0;
    const interval = 1000 / 30;

    function syncCanvas() {
      const shouldRun = fxCanvasBg && intensity > 0.01 && !isHidden;
      canvas.style.display = (fxCanvasBg && intensity > 0.01) ? 'block' : 'none';
      if (!shouldRun && animId !== null) {
        cancelAnimationFrame(animId);
        animId = null;
        ctx.clearRect(0, 0, width, height);
      } else if (shouldRun && animId === null) {
        lastTime = performance.now();
        animId = requestAnimationFrame(render);
      }
    }

    window.__fxCrazySyncCanvas = syncCanvas;

    function render(time) {
      if (isHidden || !fxCanvasBg || intensity <= 0.01) {
        animId = null;
        return;
      }
      animId = requestAnimationFrame(render);
      if (time - lastTime < interval) return;
      lastTime = time;

      ctx.clearRect(0, 0, width, height);

      const activeCount = Math.max(0, Math.floor(points.length * intensity));
      ctx.lineWidth = 0.65;
      for (let i = 0; i < activeCount; i++) {
        const p1 = points[i];
        p1.x += p1.vx * Math.max(0.25, intensity);
        p1.y += p1.vy * Math.max(0.25, intensity);
        if (p1.x < 0 || p1.x > width) p1.vx *= -1;
        if (p1.y < 0 || p1.y > height) p1.vy *= -1;

        const dxm = mouse.x - p1.x;
        const dym = mouse.y - p1.y;
        const distM = Math.sqrt(dxm * dxm + dym * dym);
        if (distM < 150) {
          ctx.strokeStyle = `rgba(${accentRgb}, ${(1 - distM / 150) * 0.45 * intensity})`;
          ctx.beginPath();
          ctx.moveTo(p1.x, p1.y);
          ctx.lineTo(mouse.x, mouse.y);
          ctx.stroke();
        }

        for (let j = i + 1; j < activeCount; j++) {
          const p2 = points[j];
          const dx = p1.x - p2.x;
          const dy = p1.y - p2.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 110) {
            ctx.strokeStyle = `rgba(${accentRgb}, ${(1 - dist / 110) * 0.22 * intensity})`;
            ctx.beginPath();
            ctx.moveTo(p1.x, p1.y);
            ctx.lineTo(p2.x, p2.y);
            ctx.stroke();
          }
        }

        ctx.fillStyle = `rgba(${accentRgb}, 0.55)`;
        ctx.beginPath();
        ctx.arc(p1.x, p1.y, p1.radius, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    document.addEventListener('visibilitychange', () => {
      isHidden = document.hidden;
      syncCanvas();
    });

    syncCanvas();
  }
})();
