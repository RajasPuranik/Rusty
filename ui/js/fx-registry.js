// Modular Background Registry (18 styles with standard lifecycle & eco rules)
// Eco rules: 30 FPS max, auto-pause when document.hidden, prefers-reduced-motion support, clean destroy()
(function (root) {
  'use strict';

  const FPS_INTERVAL = 1000 / 30; // 30 FPS cap

  class BackgroundRegistry {
    constructor() {
      this.styles = new Map();
      this.currentStyle = null;
      this.canvas = null;
      this.ctx = null;
      this.animId = null;
      this.lastTime = 0;
      this.mouse = { x: -1000, y: -1000 };
      this.accentRgb = '249, 115, 22';
      this.isHidden = document.hidden;
      this.reducedMotion = false;
      this.width = 0;
      this.height = 0;

      const mediaQuery = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
      this.reducedMotion = mediaQuery ? mediaQuery.matches : false;
      if (mediaQuery && typeof mediaQuery.addEventListener === 'function') {
        mediaQuery.addEventListener('change', (e) => {
          this.reducedMotion = e.matches;
          this.sync();
        });
      }

      this.initDefaultStyles();
      this.bindEvents();
    }

    register(styleDef) {
      if (!styleDef || !styleDef.name) return;
      this.styles.set(styleDef.name, styleDef);
    }

    get(name) {
      return this.styles.get(name);
    }

    list() {
      return Array.from(this.styles.values()).map(s => ({ name: s.name, title: s.title, type: s.type }));
    }

    resolveThemeStyle(theme, skin) {
      if (skin === 'mayank') return 'wind_lines';
      switch (theme) {
        case 'aurora': return 'aurora';
        case 'sunset': return 'sunset_horizon';
        case 'matcha': return 'fireflies';
        case 'cyberpunk': return 'cyber_mesh';
        case 'slate':
        case 'graphite': return 'minimal_grid';
        case 'light': return 'waves';
        case 'amoled':
        case 'midnight':
        case 'midnight_blue':
        default: return 'deep_space';
      }
    }

    mount(canvasEl, preferredName) {
      if (!canvasEl) return;
      this.canvas = canvasEl;
      this.ctx = canvasEl.getContext('2d');
      this.updateDimensions();

      const chosen = preferredName === 'match_theme' || !preferredName
        ? this.resolveThemeStyle(document.documentElement.getAttribute('data-theme'), document.documentElement.getAttribute('data-skin'))
        : preferredName;

      this.switchTo(chosen);
    }

    switchTo(name) {
      const styleDef = this.styles.get(name) || this.styles.get('constellation') || this.styles.values().next().value;
      if (!styleDef) return;

      if (this.currentStyle && typeof this.currentStyle.destroy === 'function') {
        this.currentStyle.destroy();
      }

      this.currentStyle = styleDef;
      if (this.canvas && this.ctx && typeof this.currentStyle.init === 'function') {
        this.currentStyle.init(this.canvas, this.ctx, this.width, this.height);
      }

      this.refreshAccentColor();
      this.sync();
    }

    updateDimensions() {
      if (!this.canvas) return;
      this.width = this.canvas.width = window.innerWidth;
      this.height = this.canvas.height = window.innerHeight;
    }

    refreshAccentColor() {
      try {
        const hex = getComputedStyle(document.documentElement).getPropertyValue('--accent-primary').trim();
        if (/^#[0-9a-fA-F]{6}$/.test(hex)) {
          const r = parseInt(hex.slice(1, 3), 16);
          const g = parseInt(hex.slice(3, 5), 16);
          const b = parseInt(hex.slice(5, 7), 16);
          this.accentRgb = `${r}, ${g}, ${b}`;
        }
      } catch (_) {}
    }

    bindEvents() {
      window.addEventListener('resize', () => {
        this.updateDimensions();
        if (this.currentStyle && typeof this.currentStyle.onResize === 'function') {
          this.currentStyle.onResize(this.width, this.height);
        }
      });

      window.addEventListener('mousemove', (e) => {
        this.mouse.x = e.clientX;
        this.mouse.y = e.clientY;
      }, { passive: true });

      document.addEventListener('visibilitychange', () => {
        this.isHidden = document.hidden;
        this.sync();
      });
    }

    sync() {
      const shouldRun = !this.isHidden && !this.reducedMotion && this.canvas && this.currentStyle;
      if (!shouldRun && this.animId !== null) {
        cancelAnimationFrame(this.animId);
        this.animId = null;
        if (this.ctx && this.canvas) {
          this.ctx.clearRect(0, 0, this.width, this.height);
        }
      } else if (shouldRun && this.animId === null) {
        this.lastTime = performance.now();
        this.animId = requestAnimationFrame((t) => this.render(t));
      }
    }

    render(time) {
      if (this.isHidden || this.reducedMotion || !this.currentStyle) {
        this.animId = null;
        return;
      }
      this.animId = requestAnimationFrame((t) => this.render(t));
      if (time - this.lastTime < FPS_INTERVAL) return;
      const delta = (time - this.lastTime) * 0.001;
      this.lastTime = time;

      this.ctx.clearRect(0, 0, this.width, this.height);
      if (typeof this.currentStyle.update === 'function') {
        this.currentStyle.update(delta, this.mouse);
      }
      if (typeof this.currentStyle.draw === 'function') {
        this.currentStyle.draw(this.ctx, this.width, this.height, this.mouse, this.accentRgb);
      }
    }

    destroy() {
      if (this.animId !== null) {
        cancelAnimationFrame(this.animId);
        this.animId = null;
      }
      if (this.currentStyle && typeof this.currentStyle.destroy === 'function') {
        this.currentStyle.destroy();
      }
      this.currentStyle = null;
      if (this.ctx && this.canvas) {
        this.ctx.clearRect(0, 0, this.width, this.height);
      }
    }

    // ── 18 Built-in Background Styles ───────────────────────────────────────
    initDefaultStyles() {
      // 1. Aurora
      this.register({
        name: 'aurora',
        title: 'Aurora',
        type: 'canvas-2d',
        phase: 0,
        init(canvas, ctx, w, h) { this.phase = 0; },
        update(delta) { this.phase += delta * 0.45; },
        draw(ctx, w, h, mouse, accent) {
          for (let band = 0; band < 3; band++) {
            ctx.beginPath();
            const yOffset = h * 0.35 + band * 60;
            ctx.moveTo(0, yOffset);
            for (let x = 0; x <= w; x += 40) {
              const y = yOffset + Math.sin(x * 0.003 + this.phase + band) * 55 + Math.cos(x * 0.006 - this.phase) * 35;
              ctx.lineTo(x, y);
            }
            ctx.lineTo(w, h);
            ctx.lineTo(0, h);
            ctx.closePath();
            const grad = ctx.createLinearGradient(0, yOffset - 40, 0, yOffset + 120);
            grad.addColorStop(0, `rgba(${accent}, ${0.12 - band * 0.03})`);
            grad.addColorStop(0.5, `rgba(45, 212, 191, ${0.16 - band * 0.04})`);
            grad.addColorStop(1, 'rgba(15, 23, 42, 0)');
            ctx.fillStyle = grad;
            ctx.fill();
          }
        }
      });

      // 2. Deep Space
      this.register({
        name: 'deep_space',
        title: 'Deep Space',
        type: 'canvas-2d',
        stars: [],
        init(canvas, ctx, w, h) {
          this.stars = [];
          for (let i = 0; i < 70; i++) {
            this.stars.push({ x: Math.random() * w, y: Math.random() * h, r: Math.random() * 1.5 + 0.5, alpha: Math.random(), speed: Math.random() * 0.6 + 0.2 });
          }
        },
        update(delta) {
          for (let s of this.stars) {
            s.alpha += s.speed * delta;
          }
        },
        draw(ctx, w, h, mouse, accent) {
          for (let s of this.stars) {
            const a = (Math.sin(s.alpha) + 1) * 0.4 + 0.1;
            ctx.fillStyle = `rgba(255, 255, 255, ${a})`;
            ctx.beginPath();
            ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      });

      // 3. Constellation
      this.register({
        name: 'constellation',
        title: 'Constellation',
        type: 'canvas-2d',
        points: [],
        init(canvas, ctx, w, h) {
          this.points = [];
          for (let i = 0; i < 42; i++) {
            this.points.push({ x: Math.random() * w, y: Math.random() * h, vx: (Math.random() - 0.5) * 0.8, vy: (Math.random() - 0.5) * 0.8, r: Math.random() * 1.8 + 1 });
          }
        },
        update(delta) {
          for (let p of this.points) {
            p.x += p.vx;
            p.y += p.vy;
            if (p.x < 0 || p.x > window.innerWidth) p.vx *= -1;
            if (p.y < 0 || p.y > window.innerHeight) p.vy *= -1;
          }
        },
        draw(ctx, w, h, mouse, accent) {
          ctx.lineWidth = 0.65;
          for (let i = 0; i < this.points.length; i++) {
            const p1 = this.points[i];
            const dxm = mouse.x - p1.x;
            const dym = mouse.y - p1.y;
            const distM = Math.sqrt(dxm * dxm + dym * dym);
            if (distM < 140) {
              ctx.strokeStyle = `rgba(${accent}, ${(1 - distM / 140) * 0.4})`;
              ctx.beginPath();
              ctx.moveTo(p1.x, p1.y);
              ctx.lineTo(mouse.x, mouse.y);
              ctx.stroke();
            }
            for (let j = i + 1; j < this.points.length; j++) {
              const p2 = this.points[j];
              const dist = Math.hypot(p1.x - p2.x, p1.y - p2.y);
              if (dist < 105) {
                ctx.strokeStyle = `rgba(${accent}, ${(1 - dist / 105) * 0.22})`;
                ctx.beginPath();
                ctx.moveTo(p1.x, p1.y);
                ctx.lineTo(p2.x, p2.y);
                ctx.stroke();
              }
            }
            ctx.fillStyle = `rgba(${accent}, 0.55)`;
            ctx.beginPath();
            ctx.arc(p1.x, p1.y, p1.r, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      });

      // 4. Matrix Rain
      this.register({
        name: 'matrix_rain',
        title: 'Matrix Rain',
        type: 'canvas-2d',
        cols: [],
        chars: '0123456789ABCDEF<>*+-/=',
        init(canvas, ctx, w, h) {
          const colCount = Math.floor(w / 28);
          this.cols = new Array(colCount).fill(0).map(() => Math.random() * -100);
        },
        update() {
          for (let i = 0; i < this.cols.length; i++) {
            this.cols[i] += 12;
            if (this.cols[i] > window.innerHeight && Math.random() > 0.95) {
              this.cols[i] = 0;
            }
          }
        },
        draw(ctx, w, h, mouse, accent) {
          ctx.font = '12px monospace';
          ctx.fillStyle = `rgba(${accent}, 0.38)`;
          for (let i = 0; i < this.cols.length; i++) {
            const char = this.chars[Math.floor(Math.random() * this.chars.length)];
            ctx.fillText(char, i * 28, this.cols[i]);
          }
        }
      });

      // 5. Waves
      this.register({
        name: 'waves',
        title: 'Waves',
        type: 'canvas-2d',
        step: 0,
        init() { this.step = 0; },
        update(delta) { this.step += delta * 1.2; },
        draw(ctx, w, h, mouse, accent) {
          for (let k = 0; k < 3; k++) {
            ctx.beginPath();
            const base = h - 90 + k * 25;
            ctx.moveTo(0, base);
            for (let x = 0; x <= w; x += 30) {
              const y = base + Math.sin(x * 0.005 + this.step + k) * 22;
              ctx.lineTo(x, y);
            }
            ctx.strokeStyle = `rgba(${accent}, ${0.18 - k * 0.05})`;
            ctx.lineWidth = 1.6;
            ctx.stroke();
          }
        }
      });

      // 6. Fireflies
      this.register({
        name: 'fireflies',
        title: 'Fireflies',
        type: 'canvas-2d',
        bugs: [],
        init(canvas, ctx, w, h) {
          this.bugs = [];
          for (let i = 0; i < 30; i++) {
            this.bugs.push({ x: Math.random() * w, y: Math.random() * h, vy: -(Math.random() * 0.5 + 0.3), phase: Math.random() * Math.PI * 2 });
          }
        },
        update(delta) {
          for (let b of this.bugs) {
            b.y += b.vy;
            b.x += Math.sin(b.phase) * 0.4;
            b.phase += 0.03;
            if (b.y < -10) b.y = window.innerHeight + 10;
          }
        },
        draw(ctx, w, h, mouse, accent) {
          for (let b of this.bugs) {
            const glow = (Math.sin(b.phase) + 1) * 0.35 + 0.15;
            ctx.fillStyle = `rgba(${accent}, ${glow})`;
            ctx.beginPath();
            ctx.arc(b.x, b.y, 2.4, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      });

      // 7. Minimal Grid
      this.register({
        name: 'minimal_grid',
        title: 'Minimal Grid',
        type: 'canvas-2d',
        draw(ctx, w, h, mouse, accent) {
          const step = 48;
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.035)';
          ctx.lineWidth = 1;
          for (let x = 0; x <= w; x += step) {
            ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
          }
          for (let y = 0; y <= h; y += step) {
            ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
          }
          if (mouse.x > 0) {
            const grad = ctx.createRadialGradient(mouse.x, mouse.y, 0, mouse.x, mouse.y, 160);
            grad.addColorStop(0, `rgba(${accent}, 0.14)`);
            grad.addColorStop(1, 'transparent');
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, w, h);
          }
        }
      });

      // 8. Geometric Drift
      this.register({
        name: 'geometric_drift',
        title: 'Geometric Drift',
        type: 'canvas-2d',
        shapes: [],
        init(canvas, ctx, w, h) {
          this.shapes = [];
          for (let i = 0; i < 14; i++) {
            this.shapes.push({ x: Math.random() * w, y: Math.random() * h, rot: Math.random() * Math.PI, size: Math.random() * 24 + 16, rotSpeed: (Math.random() - 0.5) * 0.02 });
          }
        },
        update() {
          for (let s of this.shapes) { s.rot += s.rotSpeed; }
        },
        draw(ctx, w, h, mouse, accent) {
          ctx.strokeStyle = `rgba(${accent}, 0.18)`;
          ctx.lineWidth = 1.2;
          for (let s of this.shapes) {
            ctx.save();
            ctx.translate(s.x, s.y);
            ctx.rotate(s.rot);
            ctx.strokeRect(-s.size / 2, -s.size / 2, s.size, s.size);
            ctx.restore();
          }
        }
      });

      // 9. Sunset Horizon
      this.register({
        name: 'sunset_horizon',
        title: 'Sunset Horizon',
        type: 'canvas-2d',
        phase: 0,
        update(delta) { this.phase += delta * 0.2; },
        draw(ctx, w, h, mouse, accent) {
          const grad = ctx.createLinearGradient(0, h * 0.5, 0, h);
          grad.addColorStop(0, `rgba(${accent}, 0.08)`);
          grad.addColorStop(0.5, 'rgba(236, 72, 153, 0.06)');
          grad.addColorStop(1, 'transparent');
          ctx.fillStyle = grad;
          ctx.fillRect(0, h * 0.4, w, h * 0.6);
        }
      });

      // 10. Bioluminescence
      this.register({
        name: 'bioluminescence',
        title: 'Bioluminescence',
        type: 'canvas-2d',
        blobs: [],
        init(canvas, ctx, w, h) {
          this.blobs = [];
          for (let i = 0; i < 18; i++) {
            this.blobs.push({ x: Math.random() * w, y: Math.random() * h, r: Math.random() * 32 + 20, phase: Math.random() * Math.PI * 2 });
          }
        },
        update(delta) {
          for (let b of this.blobs) { b.phase += delta * 0.8; }
        },
        draw(ctx, w, h, mouse, accent) {
          for (let b of this.blobs) {
            const alpha = (Math.sin(b.phase) + 1) * 0.12 + 0.04;
            const grad = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.r);
            grad.addColorStop(0, `rgba(${accent}, ${alpha})`);
            grad.addColorStop(1, 'transparent');
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      });

      // 11. Cyber Mesh
      this.register({
        name: 'cyber_mesh',
        title: 'Cyber Mesh',
        type: 'canvas-2d',
        offset: 0,
        update(delta) { this.offset = (this.offset + delta * 24) % 36; },
        draw(ctx, w, h, mouse, accent) {
          ctx.strokeStyle = `rgba(${accent}, 0.16)`;
          ctx.lineWidth = 1;
          const horizon = h * 0.6;
          for (let x = 0; x <= w; x += 60) {
            ctx.beginPath(); ctx.moveTo(w / 2, horizon); ctx.lineTo(x, h); ctx.stroke();
          }
          for (let y = horizon; y <= h; y += 24) {
            ctx.beginPath(); ctx.moveTo(0, y + this.offset); ctx.lineTo(w, y + this.offset); ctx.stroke();
          }
        }
      });

      // 12. Wind Lines (Mayank Skin Signature)
      this.register({
        name: 'wind_lines',
        title: 'Wind Lines',
        type: 'canvas-2d',
        lines: [],
        init(canvas, ctx, w, h) {
          this.lines = [];
          for (let i = 0; i < 14; i++) {
            this.lines.push({ x: Math.random() * w, y: Math.random() * h, len: Math.random() * 180 + 120, speed: Math.random() * 0.9 + 0.4, amp: Math.random() * 16 + 8, phase: Math.random() * Math.PI * 2 });
          }
        },
        update() {
          for (let l of this.lines) {
            l.x += l.speed;
            l.phase += 0.02;
            if (l.x - l.len > window.innerWidth) { l.x = -l.len; l.y = Math.random() * window.innerHeight; }
          }
        },
        draw(ctx, w, h, mouse, accent) {
          ctx.lineWidth = 1.4;
          for (let l of this.lines) {
            ctx.beginPath();
            for (let s = 0; s <= 16; s++) {
              const px = l.x - (s / 16) * l.len;
              const py = l.y + Math.sin(px * 0.008 + l.phase) * l.amp;
              if (s === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
            }
            const grad = ctx.createLinearGradient(l.x - l.len, l.y, l.x, l.y);
            grad.addColorStop(0, 'transparent');
            grad.addColorStop(0.5, 'rgba(148, 163, 184, 0.12)');
            grad.addColorStop(1, 'transparent');
            ctx.strokeStyle = grad;
            ctx.stroke();
          }
        }
      });

      // 13. Fog
      this.register({
        name: 'fog',
        title: 'Fog',
        type: 'canvas-2d',
        shift: 0,
        update(delta) { this.shift += delta * 15; },
        draw(ctx, w, h) {
          const grad = ctx.createLinearGradient(this.shift % w, 0, (this.shift % w) + w, h);
          grad.addColorStop(0, 'rgba(255, 255, 255, 0.03)');
          grad.addColorStop(0.5, 'transparent');
          grad.addColorStop(1, 'rgba(255, 255, 255, 0.03)');
          ctx.fillStyle = grad;
          ctx.fillRect(0, 0, w, h);
        }
      });

      // 14. Bokeh
      this.register({
        name: 'bokeh',
        title: 'Bokeh',
        type: 'canvas-2d',
        circles: [],
        init(canvas, ctx, w, h) {
          this.circles = [];
          for (let i = 0; i < 20; i++) {
            this.circles.push({ x: Math.random() * w, y: Math.random() * h, r: Math.random() * 45 + 15, alpha: Math.random() * 0.08 + 0.02 });
          }
        },
        draw(ctx, w, h, mouse, accent) {
          for (let c of this.circles) {
            ctx.fillStyle = `rgba(${accent}, ${c.alpha})`;
            ctx.beginPath();
            ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      });

      // 15. Warp Speed
      this.register({
        name: 'warp_speed',
        title: 'Warp Speed',
        type: 'canvas-2d',
        streaks: [],
        init(canvas, ctx, w, h) {
          this.streaks = [];
          for (let i = 0; i < 40; i++) {
            this.streaks.push({ x: (Math.random() - 0.5) * w, y: (Math.random() - 0.5) * h, z: Math.random() * w });
          }
        },
        update(delta) {
          for (let s of this.streaks) {
            s.z -= delta * 300;
            if (s.z <= 10) s.z = window.innerWidth;
          }
        },
        draw(ctx, w, h, mouse, accent) {
          const cx = w / 2;
          const cy = h / 2;
          ctx.fillStyle = `rgba(${accent}, 0.45)`;
          for (let s of this.streaks) {
            const k = 200 / s.z;
            const px = cx + s.x * k;
            const py = cy + s.y * k;
            if (px > 0 && px < w && py > 0 && py < h) {
              ctx.fillRect(px, py, Math.max(1, (1 - s.z / w) * 2.5), Math.max(1, (1 - s.z / w) * 2.5));
            }
          }
        }
      });

      // 16. Starfield
      this.register({
        name: 'starfield',
        title: 'Starfield',
        type: 'canvas-2d',
        dots: [],
        init(canvas, ctx, w, h) {
          this.dots = [];
          for (let i = 0; i < 60; i++) {
            this.dots.push({ x: Math.random() * w, y: Math.random() * h, r: Math.random() * 1.5 + 0.5, vy: -(Math.random() * 0.3 + 0.1) });
          }
        },
        update() {
          for (let d of this.dots) {
            d.y += d.vy;
            if (d.y < 0) d.y = window.innerHeight;
          }
        },
        draw(ctx) {
          ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
          for (let d of this.dots) {
            ctx.beginPath(); ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2); ctx.fill();
          }
        }
      });

      // 17. Solar Flare
      this.register({
        name: 'solar_flare',
        title: 'Solar Flare',
        type: 'canvas-2d',
        pulse: 0,
        update(delta) { this.pulse += delta * 1.5; },
        draw(ctx, w, h, mouse, accent) {
          const r = Math.sin(this.pulse) * 12 + 110;
          const grad = ctx.createRadialGradient(w / 2, h / 2, 20, w / 2, h / 2, r);
          grad.addColorStop(0, `rgba(${accent}, 0.15)`);
          grad.addColorStop(1, 'transparent');
          ctx.fillStyle = grad;
          ctx.beginPath(); ctx.arc(w / 2, h / 2, r, 0, Math.PI * 2); ctx.fill();
        }
      });

      // 18. Ripple Pond
      this.register({
        name: 'ripple_pond',
        title: 'Ripple Pond',
        type: 'canvas-2d',
        ripples: [],
        init(canvas, ctx, w, h) {
          this.ripples = [];
          window.addEventListener('click', (e) => {
            if (this.ripples.length < 8) {
              this.ripples.push({ x: e.clientX, y: e.clientY, r: 0, maxR: 120, alpha: 0.35 });
            }
          });
        },
        update(delta) {
          for (let i = this.ripples.length - 1; i >= 0; i--) {
            const rip = this.ripples[i];
            rip.r += delta * 60;
            rip.alpha -= delta * 0.18;
            if (rip.alpha <= 0 || rip.r >= rip.maxR) {
              this.ripples.splice(i, 1);
            }
          }
        },
        draw(ctx, w, h, mouse, accent) {
          for (let rip of this.ripples) {
            ctx.strokeStyle = `rgba(${accent}, ${Math.max(0, rip.alpha)})`;
            ctx.lineWidth = 1.4;
            ctx.beginPath();
            ctx.arc(rip.x, rip.y, rip.r, 0, Math.PI * 2);
            ctx.stroke();
          }
        }
      });
    }
  }

  root.BackgroundRegistry = new BackgroundRegistry();
})(window);
