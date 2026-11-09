// Crazy-Skin Companion Pet Module (Active ONLY when data-skin="crazy"; never loaded in Minimal)
// PLACEHOLDER: Companion pet characters are modular geometric layered SVGs with named
// <g data-layer="..."> groups and named animation STATES below. Swap final layered SVGs or
// sprite sheets by editing SPECIES_META / buildPetSvg() without changing the state machine.
(function (root) {
  'use strict';

  if (typeof document === 'undefined') return;
  if (document.documentElement.getAttribute('data-skin') !== 'crazy') return;

  const STATES = Object.freeze([
    'idle',
    'look',
    'follow',
    'curious',
    'happy',
    'play',
    'sleep',
    'feed',
    'celebrate',
    'loading',
    'wave',
    'worried',
    'yawn'
  ]);

  const SPECIES = Object.freeze(['dog', 'cat', 'robot', 'fox', 'slime']);
  const ACCESSORIES = Object.freeze(['none', 'collar', 'bow', 'hat', 'glasses']);

  const SPECIES_META = {
    dog: { label: 'Dog', defaultColor: '#d97706' },
    cat: { label: 'Cat', defaultColor: '#8b5cf6' },
    robot: { label: 'Robot', defaultColor: '#38bdf8' },
    fox: { label: 'Fox', defaultColor: '#f97316' },
    slime: { label: 'Slime', defaultColor: '#10b981' }
  };

  const FPS_CAP = 30;
  const FRAME_MIN_MS = 1000 / FPS_CAP; // ~33.33ms
  const CURSOR_ACTIVE_RADIUS_PX = 200;
  const IDLE_SLEEP_MS = 60000;
  const TREAT_COOLDOWN_MS = 20000;
  const LOADING_SAFETY_TIMEOUT_MS = 3200;
  const MEMORY_WORRIED_COOLDOWN_MS = 15000;

  function escapeHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function sanitizeHex(hex, fallback = '#f97316') {
    if (typeof hex === 'string' && /^#[0-9a-fA-F]{6}$/.test(hex.trim())) {
      return hex.trim().toLowerCase();
    }
    return fallback;
  }

  function shadeHex(hex, amount) {
    const clean = sanitizeHex(hex);
    const num = parseInt(clean.slice(1), 16);
    const r = Math.max(0, Math.min(255, Math.round(((num >> 16) & 255) + 255 * amount)));
    const g = Math.max(0, Math.min(255, Math.round(((num >> 8) & 255) + 255 * amount)));
    const b = Math.max(0, Math.min(255, Math.round((num & 255) + 255 * amount)));
    return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
  }

  // PLACEHOLDER: Original geometric layered SVG builder per species + accessory.
  function buildPetSvg(species, colorHex, accessory) {
    const sp = SPECIES.includes(species) ? species : 'fox';
    const base = sanitizeHex(colorHex, SPECIES_META[sp].defaultColor);
    const dark = shadeHex(base, -0.22);
    const light = shadeHex(base, 0.28);
    const acc = ACCESSORIES.includes(accessory) ? accessory : 'none';

    let tailSvg = '';
    let earsSvg = '';
    let bodySvg = '';
    let headSvg = '';
    let chestExtra = '';

    if (sp === 'dog') {
      tailSvg = `<path d="M27 65 Q12 58 17 44" fill="none" stroke="${dark}" stroke-width="6" stroke-linecap="round"/>`;
      bodySvg = `<rect x="30" y="50" width="36" height="27" rx="14" fill="${base}" stroke="${dark}" stroke-width="2"/>
                 <ellipse cx="48" cy="64" rx="10" ry="11" fill="${light}"/>`;
      earsSvg = `<ellipse cx="25" cy="40" rx="7" ry="14" transform="rotate(14 25 40)" fill="${dark}"/>
                 <ellipse cx="71" cy="40" rx="7" ry="14" transform="rotate(-14 71 40)" fill="${dark}"/>`;
      headSvg = `<rect x="26" y="23" width="44" height="36" rx="17" fill="${base}" stroke="${dark}" stroke-width="2"/>
                 <ellipse cx="48" cy="49" rx="13" ry="8.5" fill="${light}"/>
                 <ellipse cx="48" cy="46" rx="4.2" ry="2.8" fill="#1e293b"/>`;
    } else if (sp === 'cat') {
      tailSvg = `<path d="M29 67 Q10 68 14 48 Q16 39 23 41" fill="none" stroke="${dark}" stroke-width="5.5" stroke-linecap="round"/>`;
      bodySvg = `<rect x="32" y="51" width="32" height="26" rx="13" fill="${base}" stroke="${dark}" stroke-width="2"/>
                 <ellipse cx="48" cy="64" rx="8.5" ry="10" fill="${light}"/>`;
      earsSvg = `<polygon points="27,32 23,14 41,25" fill="${base}" stroke="${dark}" stroke-width="2" stroke-linejoin="round"/>
                 <polygon points="28.5,29 26.5,18.5 37,25" fill="#fda4af"/>
                 <polygon points="69,32 73,14 55,25" fill="${base}" stroke="${dark}" stroke-width="2" stroke-linejoin="round"/>
                 <polygon points="67.5,29 69.5,18.5 59,25" fill="#fda4af"/>`;
      headSvg = `<ellipse cx="48" cy="41" rx="22" ry="18" fill="${base}" stroke="${dark}" stroke-width="2"/>
                 <line x1="20" y1="45" x2="31" y2="46" stroke="${light}" stroke-width="1.6" stroke-linecap="round"/>
                 <line x1="21" y1="50" x2="31" y2="49" stroke="${light}" stroke-width="1.6" stroke-linecap="round"/>
                 <line x1="76" y1="45" x2="65" y2="46" stroke="${light}" stroke-width="1.6" stroke-linecap="round"/>
                 <line x1="75" y1="50" x2="65" y2="49" stroke="${light}" stroke-width="1.6" stroke-linecap="round"/>
                 <polygon points="45,45 51,45 48,48.5" fill="#fb7185"/>`;
    } else if (sp === 'robot') {
      tailSvg = `<path d="M48 22 L48 11" stroke="${dark}" stroke-width="3" stroke-linecap="round"/>
                 <circle cx="48" cy="9.5" r="4" fill="#fde047" stroke="${dark}" stroke-width="1.8"/>`;
      bodySvg = `<rect x="30" y="51" width="36" height="25" rx="8" fill="${base}" stroke="${dark}" stroke-width="2"/>
                 <rect x="39" y="57" width="18" height="11" rx="4" fill="#0f172a"/>
                 <circle cx="44" cy="62.5" r="2.2" fill="#34d399"/>
                 <circle cx="52" cy="62.5" r="2.2" fill="#38bdf8"/>`;
      earsSvg = `<rect x="20" y="34" width="6" height="14" rx="3" fill="${dark}"/>
                 <rect x="70" y="34" width="6" height="14" rx="3" fill="${dark}"/>`;
      headSvg = `<rect x="25" y="22" width="46" height="35" rx="11" fill="${base}" stroke="${dark}" stroke-width="2"/>
                 <rect x="30" y="29" width="36" height="21" rx="7" fill="#0f172a" stroke="${light}" stroke-width="1.4"/>`;
    } else if (sp === 'fox') {
      tailSvg = `<path d="M30 66 Q10 62 12 43 Q22 39 30 56 Z" fill="${base}" stroke="${dark}" stroke-width="2" stroke-linejoin="round"/>
                 <path d="M12 43 Q18 40 21 48 Q14 51 12 43 Z" fill="#f8fafc"/>`;
      bodySvg = `<rect x="31" y="51" width="34" height="26" rx="13" fill="${base}" stroke="${dark}" stroke-width="2"/>
                 <ellipse cx="48" cy="65" rx="9" ry="11" fill="#fff7ed"/>`;
      earsSvg = `<polygon points="27,32 22,12 41,24" fill="${base}" stroke="${dark}" stroke-width="2" stroke-linejoin="round"/>
                 <polygon points="28.5,29 25.5,17 37,24" fill="#fff7ed"/>
                 <polygon points="69,32 74,12 55,24" fill="${base}" stroke="${dark}" stroke-width="2" stroke-linejoin="round"/>
                 <polygon points="67.5,29 70.5,17 59,24" fill="#fff7ed"/>`;
      headSvg = `<ellipse cx="48" cy="41" rx="22" ry="17" fill="${base}" stroke="${dark}" stroke-width="2"/>
                 <path d="M27 42 Q37 56 48 56 Q59 56 69 42 Q59 48 48 46 Q37 48 27 42 Z" fill="#fff7ed"/>
                 <circle cx="48" cy="47" r="2.8" fill="#1e293b"/>`;
    } else {
      // slime: translucent-gleam faceted jelly drop + crest nibs
      tailSvg = `<circle cx="22" cy="69" r="5" fill="${base}" stroke="${dark}" stroke-width="1.6"/>
                 <circle cx="15" cy="74" r="2.8" fill="${light}"/>`;
      bodySvg = `<path d="M24 68 Q22 50 32 39 Q48 26 64 39 Q74 50 72 68 Q70 78 48 78 Q26 78 24 68 Z" fill="${base}" stroke="${dark}" stroke-width="2"/>
                 <ellipse cx="36" cy="46" rx="4.5" ry="2.2" transform="rotate(-32 36 46)" fill="${light}" opacity="0.85"/>`;
      earsSvg = `<circle cx="34" cy="30" r="5.5" fill="${base}" stroke="${dark}" stroke-width="1.8"/>
                 <circle cx="62" cy="30" r="5.5" fill="${base}" stroke="${dark}" stroke-width="1.8"/>`;
      headSvg = `<ellipse cx="48" cy="64" rx="14" ry="8" fill="${light}" opacity="0.35"/>`;
      chestExtra = `<circle cx="62" cy="54" r="2.3" fill="${light}" opacity="0.75"/>`;
    }

    const feetSvg = sp === 'slime'
      ? `<ellipse class="pet-foot pet-foot-left" cx="37" cy="77" rx="7" ry="3.2" fill="${dark}"/>
         <ellipse class="pet-foot pet-foot-right" cx="59" cy="77" rx="7" ry="3.2" fill="${dark}"/>`
      : `<ellipse class="pet-foot pet-foot-left" cx="37" cy="76.5" rx="7.2" ry="4.5" fill="${dark}"/>
         <ellipse class="pet-foot pet-foot-right" cx="59" cy="76.5" rx="7.2" ry="4.5" fill="${dark}"/>`;

    const eyesY = sp === 'slime' ? 47 : 40;
    const eyeFill = sp === 'robot' ? '#e0f2fe' : '#ffffff';
    const pupilFill = sp === 'robot' ? '#0284c7' : '#0f172a';
    const mouthY = sp === 'slime' ? 56 : 51.5;

    let accessorySvg = '';
    if (acc === 'collar') {
      accessorySvg = `<path d="M32 54 Q48 61 64 54" fill="none" stroke="#ef4444" stroke-width="4.5" stroke-linecap="round"/>
                      <circle cx="48" cy="60.5" r="3.6" fill="#fbbf24" stroke="#92400e" stroke-width="1.2"/>`;
    } else if (acc === 'bow') {
      accessorySvg = `<g transform="translate(61, 24) rotate(14)">
                        <polygon points="0,0 -8,-5 -8,5" fill="#ec4899" stroke="#9d174d" stroke-width="1.2"/>
                        <polygon points="0,0 8,-5 8,5" fill="#ec4899" stroke="#9d174d" stroke-width="1.2"/>
                        <circle cx="0" cy="0" r="2.6" fill="#fbcfe8" stroke="#9d174d" stroke-width="1"/>
                      </g>`;
    } else if (acc === 'hat') {
      accessorySvg = `<g transform="translate(48, 22)">
                        <path d="M-14 2 Q-12 -11 0 -11 Q12 -11 14 2 Z" fill="#3b82f6" stroke="#1d4ed8" stroke-width="1.6"/>
                        <rect x="-17" y="1" width="34" height="4.5" rx="2.2" fill="#1d4ed8"/>
                        <circle cx="0" cy="-12.5" r="2.6" fill="#facc15"/>
                      </g>`;
    } else if (acc === 'glasses') {
      accessorySvg = `<g>
                        <circle cx="38.5" cy="${eyesY}" r="6.8" fill="rgba(15,23,42,0.18)" stroke="#facc15" stroke-width="2"/>
                        <circle cx="57.5" cy="${eyesY}" r="6.8" fill="rgba(15,23,42,0.18)" stroke="#facc15" stroke-width="2"/>
                        <line x1="45.3" y1="${eyesY}" x2="50.7" y2="${eyesY}" stroke="#facc15" stroke-width="2"/>
                      </g>`;
    }

    return `<svg class="pet-svg" viewBox="0 0 96 96" aria-hidden="true">
      <g class="pet-layer-shadow" data-layer="shadow">
        <ellipse cx="48" cy="83" rx="22" ry="5" fill="rgba(0,0,0,0.28)"/>
      </g>
      <g class="pet-layer-tail" data-layer="tail">
        ${tailSvg}
      </g>
      <g class="pet-layer-feet" data-layer="feet">
        ${feetSvg}
      </g>
      <g class="pet-layer-body" data-layer="body">
        ${bodySvg}
        ${chestExtra}
      </g>
      <g class="pet-layer-head" data-layer="head">
        <g class="pet-layer-ears" data-layer="ears">
          ${earsSvg}
        </g>
        <g class="pet-layer-face-base">
          ${headSvg}
        </g>
        <g class="pet-layer-eyes" data-layer="eyes">
          <g class="pet-eyes-open">
            <circle cx="38.5" cy="${eyesY}" r="4.6" fill="${eyeFill}"/>
            <circle cx="57.5" cy="${eyesY}" r="4.6" fill="${eyeFill}"/>
            <g class="pet-pupils" data-layer="pupils">
              <circle cx="38.5" cy="${eyesY}" r="2.6" fill="${pupilFill}"/>
              <circle cx="57.5" cy="${eyesY}" r="2.6" fill="${pupilFill}"/>
              <circle cx="39.5" cy="${eyesY - 1.1}" r="0.9" fill="#ffffff"/>
              <circle cx="58.5" cy="${eyesY - 1.1}" r="0.9" fill="#ffffff"/>
            </g>
          </g>
          <g class="pet-eyes-sleep">
            <path d="M34 ${eyesY} Q38.5 ${eyesY + 3.5} 43 ${eyesY}" fill="none" stroke="#0f172a" stroke-width="2.2" stroke-linecap="round"/>
            <path d="M53 ${eyesY} Q57.5 ${eyesY + 3.5} 62 ${eyesY}" fill="none" stroke="#0f172a" stroke-width="2.2" stroke-linecap="round"/>
          </g>
          <g class="pet-eyes-happy">
            <path d="M34 ${eyesY + 1} Q38.5 ${eyesY - 4} 43 ${eyesY + 1}" fill="none" stroke="#0f172a" stroke-width="2.4" stroke-linecap="round"/>
            <path d="M53 ${eyesY + 1} Q57.5 ${eyesY - 4} 62 ${eyesY + 1}" fill="none" stroke="#0f172a" stroke-width="2.4" stroke-linecap="round"/>
          </g>
          <g class="pet-eyes-worried">
            <line x1="34" y1="${eyesY - 4}" x2="43" y2="${eyesY - 1}" stroke="#0f172a" stroke-width="2.2" stroke-linecap="round"/>
            <line x1="62" y1="${eyesY - 4}" x2="53" y2="${eyesY - 1}" stroke="#0f172a" stroke-width="2.2" stroke-linecap="round"/>
            <circle cx="38.5" cy="${eyesY + 0.5}" r="3.4" fill="${eyeFill}"/>
            <circle cx="57.5" cy="${eyesY + 0.5}" r="3.4" fill="${eyeFill}"/>
            <circle cx="38.5" cy="${eyesY + 0.5}" r="1.8" fill="#0f172a"/>
            <circle cx="57.5" cy="${eyesY + 0.5}" r="1.8" fill="#0f172a"/>
            <circle cx="67" cy="${eyesY - 5}" r="2.2" fill="#38bdf8"/>
          </g>
        </g>
        <g class="pet-layer-mouth" data-layer="mouth">
          <path class="pet-mouth-idle" d="M44 ${mouthY} Q48 ${mouthY + 3.2} 52 ${mouthY}" fill="none" stroke="#1e293b" stroke-width="2" stroke-linecap="round"/>
          <ellipse class="pet-mouth-open" cx="48" cy="${mouthY + 1.5}" rx="3.5" ry="3.8" fill="#9f1239"/>
          <path class="pet-mouth-worried" d="M43 ${mouthY + 2} Q46 ${mouthY - 0.5} 48 ${mouthY + 1.5} Q50 ${mouthY + 3.5} 53 ${mouthY + 1}" fill="none" stroke="#1e293b" stroke-width="1.9" stroke-linecap="round"/>
        </g>
        <g class="pet-layer-accessory" data-layer="accessory" data-accessory="${acc}">
          ${accessorySvg}
        </g>
      </g>
    </svg>`;
  }

  function readConfig() {
    const s = (root.Settings && root.Settings.data) || root.BOOT_SETTINGS || {};
    const pType = SPECIES.includes(s.pet_type) ? s.pet_type : '';
    const sp = pType || 'fox';
    return {
      petType: pType,
      petName: String(s.pet_name || 'Pixel').trim().slice(0, 24) || 'Pixel',
      petColor: sanitizeHex(s.pet_color, SPECIES_META[sp].defaultColor),
      petAccessory: ACCESSORIES.includes(s.pet_accessory) ? s.pet_accessory : 'none',
      petMood: String(s.pet_mood || 'content').trim().slice(0, 20) || 'content',
      petRoam: Boolean(s.pet_roam),
      effectsIntensity: s.effects_intensity !== undefined ? Math.max(0, Math.min(100, Number(s.effects_intensity))) : 80
    };
  }

  function saveConfigPatch(patch) {
    if (root.Settings && typeof root.Settings.setMany === 'function') {
      root.Settings.setMany(patch);
    } else if (root.Settings && typeof root.Settings.set === 'function') {
      Object.entries(patch).forEach(([k, v]) => root.Settings.set(k, v));
    }
  }

  function init() {
    const railSlot = document.getElementById('left-rail-bottom-slot');
    const chromeHeader = document.getElementById('chrome-header');
    if (!railSlot && !chromeHeader) return;

    const surface = railSlot ? 'rail' : 'roam';
    const reduceQuery = root.matchMedia ? root.matchMedia('(prefers-reduced-motion: reduce)') : null;
    let reducedMotion = reduceQuery ? reduceQuery.matches : false;
    let config = readConfig();
    let curState = 'idle';
    let transientUntil = 0;
    let transientTimer = 0;
    let loadingSafetyTimer = 0;
    let bubbleClearTimer = 0;
    let lastMoodPersistMs = 0;
    let lastTreatAtMs = 0;
    let treatCooldownTimer = 0;
    let lastMemoryWorriedAtMs = 0;
    let lastMidnightMinuteKey = '';

    // Spatial coordinates for CSS transform locomotion
    let posX = surface === 'rail' ? 42 : 240;
    let posY = 0;
    let targetX = posX;
    let targetY = posY;
    let facing = 1; // 1 = right, -1 = left
    let patrolPausedUntil = 0;
    let nextPatrolAt = Date.now() + 2600;

    // Pointer state (kept lightweight)
    let pointerX = -9999;
    let pointerY = -9999;
    let lastPointerTime = 0;
    let prevPointerX = 0;
    let prevPointerY = 0;
    let lastPointerSpeed = 0;
    let lastInteractionTime = Date.now();
    let pointerInsideWindow = false;
    let hoveredInteresting = false;

    // rAF loop controls (strict <=30fps, ONLY active when moving or cursor <=200px)
    let rafId = 0;
    let lastFrameMs = 0;
    let lastCenterSampleMs = 0;
    let cachedCenter = { x: 100, y: 500 };

    // Active DOM refs
    let moverEl = null;
    let hitboxEl = null;
    let visualEl = null;
    let bubbleEl = null;
    let treatBtnEl = null;
    let moodPillEl = null;
    let nameLabelEl = null;
    let roamLayerEl = null;
    let pickerBackdropEl = null;
    let pickerDraft = null;
    let renderedSignature = '';

    function refreshReducedMotionClass() {
      if (!moverEl) return;
      moverEl.classList.toggle('pet-paused', document.hidden);
      moverEl.classList.toggle('pet-intensity-zero', config.effectsIntensity <= 0);
      moverEl.setAttribute('data-reduced-motion', reducedMotion ? 'true' : 'false');
    }

    function stopRaf() {
      if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = 0;
      }
    }

    function updateHitboxCenter(force = false) {
      if (!hitboxEl) return cachedCenter;
      const now = performance.now();
      if (!force && now - lastCenterSampleMs < 140) {
        return cachedCenter;
      }
      lastCenterSampleMs = now;
      const r = hitboxEl.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        cachedCenter = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      }
      return cachedCenter;
    }

    function computeCursorDistance() {
      if (!pointerInsideWindow || pointerX < -500) return Infinity;
      const c = updateHitboxCenter(false);
      return Math.hypot(pointerX - c.x, pointerY - c.y);
    }

    function needsRaf() {
      if (!moverEl || !config.petType) return false;
      if (document.hidden || reducedMotion || config.effectsIntensity <= 0) return false;
      const now = Date.now();
      const moving = Math.abs(targetX - posX) > 0.7 || Math.abs(targetY - posY) > 0.7;
      const transientActive = now < transientUntil || curState === 'loading';
      const dist = computeCursorDistance();
      const cursorClose = pointerInsideWindow && (now - lastPointerTime < 2200) && dist <= CURSOR_ACTIVE_RADIUS_PX;
      return moving || transientActive || cursorClose;
    }

    function scheduleRafIfNeeded() {
      if (!rafId && needsRaf()) {
        lastFrameMs = 0;
        rafId = requestAnimationFrame(tick);
      }
    }

    function setBubble(text, durationMs = 1800) {
      if (!bubbleEl) return;
      if (bubbleClearTimer) {
        clearTimeout(bubbleClearTimer);
        bubbleClearTimer = 0;
      }
      if (!text) {
        bubbleEl.textContent = '';
        bubbleEl.hidden = true;
        return;
      }
      bubbleEl.textContent = text;
      bubbleEl.hidden = false;
      if (durationMs > 0) {
        bubbleClearTimer = setTimeout(() => {
          if (bubbleEl) {
            bubbleEl.textContent = '';
            bubbleEl.hidden = true;
          }
          bubbleClearTimer = 0;
        }, durationMs);
      }
    }

    function spawnFloater(glyph, color) {
      if (!hitboxEl || reducedMotion || config.effectsIntensity <= 0) return;
      const el = document.createElement('span');
      el.className = 'pet-floater';
      el.textContent = glyph;
      el.style.color = color || '#f43f5e';
      hitboxEl.appendChild(el);
      setTimeout(() => el.remove(), 980);
    }

    function persistMood(nextMood) {
      if (!config.petType || !nextMood) return;
      const clean = String(nextMood).trim().slice(0, 20);
      if (!clean) return;
      config.petMood = clean;
      if (moodPillEl) moodPillEl.textContent = clean;
      const now = Date.now();
      if (now - lastMoodPersistMs > 400) {
        lastMoodPersistMs = now;
        saveConfigPatch({ pet_mood: clean });
      }
    }

    function applyTransforms() {
      if (!moverEl) return;
      moverEl.style.transform = `translate3d(${posX.toFixed(1)}px, ${posY.toFixed(1)}px, 0)`;
      if (visualEl) {
        let tiltDeg = 0;
        if (curState === 'curious') tiltDeg = facing * 8;
        else if (curState === 'look' || curState === 'follow') tiltDeg = facing * 2.5;
        visualEl.style.transform = `scaleX(${facing}) rotate(${tiltDeg.toFixed(1)}deg)`;
      }

      const pupils = moverEl.querySelector('.pet-pupils');
      if (pupils) {
        if (reducedMotion || config.effectsIntensity <= 0 || !pointerInsideWindow || computeCursorDistance() > CURSOR_ACTIVE_RADIUS_PX) {
          pupils.style.transform = 'translate3d(0px, 0px, 0px)';
        } else {
          const c = updateHitboxCenter(false);
          const dx = (pointerX - c.x) * facing;
          const dy = pointerY - c.y;
          const dist = Math.hypot(dx, dy) || 1;
          const mag = Math.min(3.1, dist / 28);
          const px = (dx / dist) * mag;
          const py = (dy / dist) * mag;
          pupils.style.transform = `translate3d(${px.toFixed(2)}px, ${py.toFixed(2)}px, 0px)`;
        }
      }
    }

    function setState(nextState, opts = {}) {
      if (!STATES.includes(nextState)) return;
      if (transientTimer) {
        clearTimeout(transientTimer);
        transientTimer = 0;
      }
      const durationMs = Number(opts.durationMs || 0);
      const bubble = opts.bubble !== undefined ? opts.bubble : null;
      curState = nextState;
      if (durationMs > 0) {
        transientUntil = Date.now() + durationMs;
        if (nextState !== 'loading') {
          transientTimer = setTimeout(() => {
            transientTimer = 0;
            if (curState === nextState && curState !== 'sleep' && curState !== 'loading') {
              transientUntil = 0;
              const fallback = (!document.hidden && !reducedMotion && config.effectsIntensity > 0 && pointerInsideWindow && computeCursorDistance() <= CURSOR_ACTIVE_RADIUS_PX)
                ? 'look'
                : 'idle';
              setState(fallback, { clearTransient: true, bubble: '' });
            }
          }, durationMs + 25);
        }
      } else if (opts.clearTransient) {
        transientUntil = 0;
      }

      if (moverEl) {
        moverEl.setAttribute('data-state', curState);
      }

      if (bubble !== null) {
        setBubble(bubble, durationMs > 0 ? durationMs : (curState === 'sleep' ? 0 : 1800));
      } else if (curState === 'sleep') {
        setBubble('zZz', 0);
      } else if (curState === 'idle') {
        setBubble('', 0);
      }

      if (opts.mood) {
        persistMood(opts.mood);
      }
      applyTransforms();
      scheduleRafIfNeeded();
    }

    function computeRailBounds() {
      const arena = railSlot ? railSlot.querySelector('.pet-stage-arena') : null;
      if (!arena) return { minX: 0, maxX: 90, centerX: 45 };
      const w = arena.clientWidth || 156;
      const petW = 60;
      const maxX = Math.max(0, w - petW);
      return { minX: 0, maxX, centerX: Math.round(maxX / 2) };
    }

    function computeRoamRestPoint() {
      const winW = root.innerWidth || 1280;
      const activeTab = document.querySelector('#tabs-horizontal .tab-item.active');
      if (activeTab && activeTab.offsetParent !== null) {
        const r = activeTab.getBoundingClientRect();
        if (r.width >= 36 && r.height >= 16) {
          // Perch on the upper-left/middle of the active tab (away from .tab-close) and below #chrome-header button centers (y >= 28)
          const rx = Math.max(8, Math.min(winW - 52, Math.min(r.right - 68, r.left + Math.max(6, Math.round(r.width * 0.25)))));
          const ry = Math.max(28, Math.min(30, Math.round(r.bottom - 44)));
          return { x: rx, y: ry };
        }
      }
      // Vertical tabs fallback: pick open gap between omnibox and action buttons in #chrome-header if >= 48px
      const omni = document.querySelector('#chrome-header .omnibox-wrapper');
      const actions = document.querySelector('#chrome-header .actions-group');
      if (omni && actions) {
        const or = omni.getBoundingClientRect();
        const ar = actions.getBoundingClientRect();
        if (ar.left - or.right >= 48) {
          return { x: Math.round((or.right + ar.left - 44) * 0.5), y: 2 };
        }
      }
      return { x: Math.max(140, Math.min(winW - 90, Math.round(winW * 0.68))), y: 28 };
    }

    function computeRoamPatrolPoint(rest) {
      const winW = root.innerWidth || 1280;
      const horizVisible = document.getElementById('tabs-horizontal')?.offsetParent !== null;
      if (horizVisible) {
        // Patrol cleanly along empty right area of #tabs-horizontal (away from tabs and #btn-new-tab-h)
        const newTabBtn = document.getElementById('btn-new-tab-h');
        const minSafeX = newTabBtn && newTabBtn.offsetParent !== null
          ? Math.round(newTabBtn.getBoundingClientRect().right + 16)
          : Math.round(rest.x + 84);
        const maxSafeX = winW - 56;
        if (maxSafeX - minSafeX >= 60) {
          const span = Math.min(220, maxSafeX - minSafeX);
          return { x: minSafeX + Math.round(Math.random() * span), y: 28 };
        }
      }
      // Vertical tabs or packed strip: try clear gap between omnibox and actions
      const omni = document.querySelector('#chrome-header .omnibox-wrapper');
      const actions = document.querySelector('#chrome-header .actions-group');
      if (omni && actions) {
        const or = omni.getBoundingClientRect();
        const ar = actions.getBoundingClientRect();
        if (ar.left - or.right >= 52) {
          return { x: Math.round(or.right + 4 + Math.random() * (ar.left - or.right - 48)), y: 2 };
        }
      }
      return rest;
    }

    function getRemainingTreatSeconds() {
      const elapsed = Date.now() - lastTreatAtMs;
      if (!lastTreatAtMs || elapsed >= TREAT_COOLDOWN_MS) return 0;
      return Math.ceil((TREAT_COOLDOWN_MS - elapsed) / 1000);
    }

    function syncTreatButton() {
      const rem = getRemainingTreatSeconds();
      if (treatBtnEl) {
        treatBtnEl.disabled = rem > 0;
        treatBtnEl.textContent = rem > 0 ? `Cooldown ${rem}s` : 'Treat';
      }
      const settingsTreat = document.getElementById('btn-settings-pet-treat');
      if (settingsTreat) {
        settingsTreat.disabled = !config.petType || rem > 0;
        settingsTreat.textContent = rem > 0 ? `Cooldown (${rem}s)` : 'Feed Treat';
      }
      const settingsMood = document.getElementById('setting-pet-mood-label');
      if (settingsMood && config.petType) {
        settingsMood.textContent = `Mood: ${config.petMood}`;
      }
    }

    function feedTreat() {
      if (!config.petType) return false;
      if (getRemainingTreatSeconds() > 0) return false;
      lastTreatAtMs = Date.now();
      lastInteractionTime = lastTreatAtMs;
      patrolPausedUntil = lastTreatAtMs + 2400;
      setState('feed', { durationMs: 2400, bubble: 'nom!', mood: 'happy' });
      spawnFloater('♥', '#fb7185');
      spawnFloater('★', '#facc15');
      syncTreatButton();
      if (treatCooldownTimer) clearInterval(treatCooldownTimer);
      treatCooldownTimer = setInterval(() => {
        const rem = getRemainingTreatSeconds();
        syncTreatButton();
        if (rem <= 0) {
          clearInterval(treatCooldownTimer);
          treatCooldownTimer = 0;
        }
      }, 1000);
      return true;
    }

    function petTheCompanion() {
      if (!config.petType) return;
      lastInteractionTime = Date.now();
      patrolPausedUntil = lastInteractionTime + 2000;
      setState('happy', { durationMs: 2000, bubble: '♥', mood: 'happy' });
      spawnFloater('♥', '#f43f5e');
      setTimeout(() => spawnFloater('♥', '#ec4899'), 160);
    }

    function isNightHour() {
      const h = new Date().getHours();
      return h >= 23 || h < 5;
    }

    function triggerReaction(eventName) {
      if (!config.petType) return;
      const now = Date.now();
      if (eventName === 'download_finished') {
        patrolPausedUntil = now + 2600;
        setState('celebrate', { durationMs: 2600, bubble: '★', mood: 'proud' });
        spawnFloater('★', '#facc15');
        setTimeout(() => spawnFloater('♥', '#34d399'), 180);
      } else if (eventName === 'page_loading') {
        if (loadingSafetyTimer) clearTimeout(loadingSafetyTimer);
        setBubble('...', 3000);
        setState('loading', { durationMs: LOADING_SAFETY_TIMEOUT_MS, bubble: '...' });
        loadingSafetyTimer = setTimeout(() => {
          loadingSafetyTimer = 0;
          if (curState === 'loading') {
            setState(computeCursorDistance() <= CURSOR_ACTIVE_RADIUS_PX ? 'look' : 'idle', { clearTransient: true, bubble: '' });
          }
        }, LOADING_SAFETY_TIMEOUT_MS);
      } else if (eventName === 'page_loaded') {
        if (loadingSafetyTimer) {
          clearTimeout(loadingSafetyTimer);
          loadingSafetyTimer = 0;
        }
        if (curState === 'loading') {
          setState(computeCursorDistance() <= CURSOR_ACTIVE_RADIUS_PX ? 'look' : 'idle', { clearTransient: true, bubble: '' });
        }
      } else if (eventName === 'tab_closed') {
        patrolPausedUntil = now + 1800;
        setState('wave', { durationMs: 1800, bubble: 'bye!' });
      } else if (eventName === 'memory_high') {
        if (now - lastMemoryWorriedAtMs < MEMORY_WORRIED_COOLDOWN_MS && !root.__petForceEvent) return;
        lastMemoryWorriedAtMs = now;
        patrolPausedUntil = now + 3200;
        setState('worried', { durationMs: 3200, bubble: '!', mood: 'worried' });
      } else if (eventName === 'midnight') {
        patrolPausedUntil = now + 2500;
        setState('yawn', { durationMs: 2500, bubble: 'yawn~', mood: 'sleepy' });
      } else if (eventName === 'idle_sleep') {
        lastInteractionTime = now - IDLE_SLEEP_MS - 5000;
        setState('sleep', { clearTransient: true, bubble: 'zZz', mood: 'sleepy' });
      }
    }

    function evaluateBackgroundBehavior() {
      if (!config.petType || !moverEl || document.hidden) return;
      const now = Date.now();

      // Auto sleep after 60s idle or at night (with 30s wake grace after interaction)
      if (now >= transientUntil && curState !== 'loading') {
        const idleElapsed = now - lastInteractionTime;
        if (idleElapsed >= IDLE_SLEEP_MS || (isNightHour() && idleElapsed >= 30000)) {
          if (curState !== 'sleep') {
            targetX = surface === 'rail' ? computeRailBounds().centerX : computeRoamRestPoint().x;
            if (surface === 'roam') targetY = computeRoamRestPoint().y;
            setState('sleep', { clearTransient: true, bubble: 'zZz', mood: 'sleepy' });
          }
          return;
        }
      }

      // Midnight yawn check
      const d = new Date();
      if (d.getHours() === 0 && d.getMinutes() < 2) {
        const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
        if (key !== lastMidnightMinuteKey && curState !== 'sleep') {
          lastMidnightMinuteKey = key;
          triggerReaction('midnight');
          return;
        }
      }

      // Roam patrol between top tab-bar clear spots and active tab perch
      if (surface === 'roam' && config.petRoam && !reducedMotion && config.effectsIntensity > 0) {
        if (now >= patrolPausedUntil && now >= nextPatrolAt && now >= transientUntil && curState === 'idle' && computeCursorDistance() > CURSOR_ACTIVE_RADIUS_PX) {
          const rest = computeRoamRestPoint();
          const nearRest = Math.abs(posX - rest.x) < 12 && Math.abs(posY - rest.y) < 6;
          if (!nearRest) {
            targetX = rest.x;
            targetY = rest.y;
          } else {
            const patrol = computeRoamPatrolPoint(rest);
            targetX = patrol.x;
            targetY = patrol.y;
          }
          if (Math.abs(targetX - posX) > 1 || Math.abs(targetY - posY) > 1) {
            facing = targetX >= posX ? 1 : -1;
            setState('follow', { clearTransient: true, bubble: '' });
          }
          nextPatrolAt = now + 4500 + Math.random() * 2500;
        }
      }
    }

    function tick(nowMs) {
      rafId = 0;
      if (!needsRaf()) {
        return;
      }
      if (lastFrameMs && nowMs - lastFrameMs < FRAME_MIN_MS) {
        rafId = requestAnimationFrame(tick);
        return;
      }
      lastFrameMs = nowMs;

      const now = Date.now();
      const dist = computeCursorDistance();

      if (now >= transientUntil && curState !== 'loading' && curState !== 'sleep') {
        if (hoveredInteresting) {
          if (curState !== 'curious') setState('curious', { clearTransient: true, bubble: '?' });
        } else if (dist <= CURSOR_ACTIVE_RADIUS_PX && pointerInsideWindow) {
          if (lastPointerSpeed > 0.85) {
            setState('play', { durationMs: 1100, bubble: '!' });
          } else if (surface === 'rail') {
            const railEl = railSlot.closest('.ntp-left-rail');
            const railRect = railEl ? railEl.getBoundingClientRect() : null;
            const inRail = railRect && pointerX >= railRect.left && pointerX <= railRect.right && pointerY >= railRect.top && pointerY <= railRect.bottom;
            if (inRail) {
              const arenaRect = railSlot.querySelector('.pet-stage-arena').getBoundingClientRect();
              const bounds = computeRailBounds();
              targetX = Math.max(bounds.minX, Math.min(bounds.maxX, pointerX - arenaRect.left - 30));
              if (Math.abs(targetX - posX) > 1.5) {
                facing = targetX >= posX ? 1 : -1;
                if (curState !== 'follow') setState('follow', { clearTransient: true, bubble: '' });
              } else if (curState !== 'look') {
                setState('look', { clearTransient: true, bubble: '' });
              }
            } else if (curState !== 'look') {
              setState('look', { clearTransient: true, bubble: '' });
            }
          } else if (surface === 'roam') {
            if (pointerY <= 84) {
              const winW = root.innerWidth || 1280;
              targetX = Math.max(16, Math.min(winW - 60, pointerX - 22));
              targetY = 28;
              if (Math.abs(targetX - posX) > 2) {
                facing = targetX >= posX ? 1 : -1;
                if (curState !== 'follow') setState('follow', { clearTransient: true, bubble: '' });
              } else if (curState !== 'look') {
                setState('look', { clearTransient: true, bubble: '' });
              }
            } else if (curState !== 'look') {
              setState('look', { clearTransient: true, bubble: '' });
            }
          }
        } else if (Math.abs(targetX - posX) <= 0.7 && Math.abs(targetY - posY) <= 0.7) {
          if (curState !== 'idle') {
            setState('idle', { clearTransient: true, bubble: '' });
          }
        }
      } else if (transientUntil > 0 && now >= transientUntil && curState !== 'loading') {
        transientUntil = 0;
        const settledDist = computeCursorDistance();
        setState(settledDist <= CURSOR_ACTIVE_RADIUS_PX ? 'look' : 'idle', { clearTransient: true, bubble: '' });
      }

      // Smooth damped step toward targetX/targetY (zero layout thrashing)
      const dx = targetX - posX;
      const dy = targetY - posY;
      if (Math.abs(dx) > 0.4 || Math.abs(dy) > 0.4) {
        const speed = curState === 'play' ? 0.24 : 0.14;
        posX += dx * speed;
        posY += dy * speed;
        if (Math.abs(dx) <= 0.4) posX = targetX;
        if (Math.abs(dy) <= 0.4) posY = targetY;
      }

      applyTransforms();

      if (needsRaf()) {
        rafId = requestAnimationFrame(tick);
      }
    }

    // ── Surface Renderers ───────────────────────────────────────────────────
    function renderRailSurface() {
      if (!railSlot) return;
      const sig = `${config.petType}|${config.petName}|${config.petColor}|${config.petAccessory}`;
      if (!config.petType) {
        stopRaf();
        moverEl = null;
        hitboxEl = null;
        visualEl = null;
        bubbleEl = null;
        treatBtnEl = null;
        moodPillEl = null;
        nameLabelEl = null;
        if (renderedSignature !== 'NONE') {
          renderedSignature = 'NONE';
          railSlot.innerHTML = `<button type="button" id="btn-add-pet" class="pet-add-btn">+ Add a pet</button>`;
          const addBtn = railSlot.querySelector('#btn-add-pet');
          if (addBtn) addBtn.addEventListener('click', openPickerModal);
        }
        return;
      }

      if (renderedSignature === sig && moverEl) {
        if (nameLabelEl) nameLabelEl.textContent = config.petName;
        if (moodPillEl) moodPillEl.textContent = config.petMood;
        refreshReducedMotionClass();
        syncTreatButton();
        return;
      }

      renderedSignature = sig;
      railSlot.innerHTML = `
        <div class="pet-stage-card" id="pet-stage-card">
          <div class="pet-stage-arena">
            <div class="pet-mover" id="pet-rail-mover" data-state="${escapeHtml(curState)}">
              <div class="pet-bubble" id="pet-rail-bubble" hidden></div>
              <button type="button" class="pet-hitbox" id="pet-rail-hitbox" aria-label="Pet ${escapeHtml(config.petName)}" title="Click to pet ${escapeHtml(config.petName)} • Edit in Settings or pencil">
                <div class="pet-visual">${buildPetSvg(config.petType, config.petColor, config.petAccessory)}</div>
              </button>
            </div>
          </div>
          <div class="pet-stage-footer">
            <div class="pet-info-row">
              <span class="pet-name-label" id="pet-rail-name">${escapeHtml(config.petName)}</span>
              <span class="pet-mood-pill" id="pet-rail-mood">${escapeHtml(config.petMood)}</span>
            </div>
            <div class="pet-controls-row">
              <button type="button" class="pet-treat-btn" id="btn-pet-treat" title="Give a treat (20s cooldown)">Treat</button>
              <button type="button" class="btn-icon-xs" id="btn-pet-edit" title="Customize or remove pet">${root.Icons ? root.Icons.get('pencil', '', 12) : 'Edit'}</button>
            </div>
          </div>
        </div>
      `;

      moverEl = railSlot.querySelector('#pet-rail-mover');
      hitboxEl = railSlot.querySelector('#pet-rail-hitbox');
      visualEl = moverEl.querySelector('.pet-visual');
      bubbleEl = railSlot.querySelector('#pet-rail-bubble');
      treatBtnEl = railSlot.querySelector('#btn-pet-treat');
      moodPillEl = railSlot.querySelector('#pet-rail-mood');
      nameLabelEl = railSlot.querySelector('#pet-rail-name');

      const bounds = computeRailBounds();
      posX = Math.max(bounds.minX, Math.min(bounds.maxX, bounds.centerX));
      targetX = posX;
      posY = 0;
      targetY = 0;

      hitboxEl.addEventListener('click', (e) => {
        e.stopPropagation();
        petTheCompanion();
      });
      hitboxEl.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        openPickerModal();
      });
      treatBtnEl.addEventListener('click', (e) => {
        e.stopPropagation();
        feedTreat();
      });
      const editBtn = railSlot.querySelector('#btn-pet-edit');
      if (editBtn) {
        editBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          openPickerModal();
        });
      }

      refreshReducedMotionClass();
      applyTransforms();
      syncTreatButton();
      updateHitboxCenter(true);
    }

    function renderRoamSurface() {
      if (!chromeHeader) return;
      if (!config.petType || !config.petRoam) {
        stopRaf();
        if (roamLayerEl) {
          roamLayerEl.remove();
          roamLayerEl = null;
        }
        moverEl = null;
        hitboxEl = null;
        visualEl = null;
        bubbleEl = null;
        renderedSignature = 'NONE';
        return;
      }

      const sig = `${config.petType}|${config.petName}|${config.petColor}|${config.petAccessory}|ROAM`;
      if (renderedSignature === sig && roamLayerEl && moverEl) {
        refreshReducedMotionClass();
        return;
      }
      renderedSignature = sig;

      if (!roamLayerEl) {
        roamLayerEl = document.createElement('div');
        roamLayerEl.id = 'pet-roam-layer';
        roamLayerEl.className = 'pet-only-crazy';
        document.body.appendChild(roamLayerEl);
      }

      roamLayerEl.innerHTML = `
        <div class="pet-mover" id="pet-roam-mover" data-state="${escapeHtml(curState)}">
          <div class="pet-bubble" id="pet-roam-bubble" hidden></div>
          <button type="button" class="pet-hitbox" id="pet-roam-hitbox" aria-label="Pet ${escapeHtml(config.petName)}" title="${escapeHtml(config.petName)} (Click to pet!)">
            <div class="pet-visual">${buildPetSvg(config.petType, config.petColor, config.petAccessory)}</div>
          </button>
        </div>
      `;

      moverEl = roamLayerEl.querySelector('#pet-roam-mover');
      hitboxEl = roamLayerEl.querySelector('#pet-roam-hitbox');
      visualEl = moverEl.querySelector('.pet-visual');
      bubbleEl = roamLayerEl.querySelector('#pet-roam-bubble');

      const rest = computeRoamRestPoint();
      posX = rest.x;
      posY = rest.y;
      targetX = posX;
      targetY = posY;
      nextPatrolAt = Date.now() + 3600;

      hitboxEl.addEventListener('click', (e) => {
        e.stopPropagation();
        petTheCompanion();
      });

      refreshReducedMotionClass();
      applyTransforms();
      updateHitboxCenter(true);
    }

    function renderActiveSurface() {
      if (surface === 'rail') renderRailSurface();
      else renderRoamSurface();
    }

    // ── Pet Picker Modal (New Tab Page) ─────────────────────────────────────
    function closePickerModal() {
      if (pickerBackdropEl) pickerBackdropEl.hidden = true;
    }

    function renderPickerBody() {
      if (!pickerBackdropEl || !pickerDraft) return;
      const previewEl = pickerBackdropEl.querySelector('#pet-picker-preview');
      if (previewEl) {
        previewEl.innerHTML = buildPetSvg(pickerDraft.petType, pickerDraft.petColor, pickerDraft.petAccessory);
      }
      pickerBackdropEl.querySelectorAll('.pet-species-card').forEach((card) => {
        card.classList.toggle('active', card.dataset.species === pickerDraft.petType);
      });
      const removeBtn = pickerBackdropEl.querySelector('#pet-picker-remove');
      if (removeBtn) removeBtn.style.display = config.petType ? 'inline-flex' : 'none';
    }

    function openPickerModal() {
      if (!railSlot) return;
      pickerDraft = {
        petType: config.petType || 'fox',
        petName: config.petName || 'Pixel',
        petColor: config.petType ? config.petColor : SPECIES_META.fox.defaultColor,
        petAccessory: config.petAccessory || 'none'
      };

      if (!pickerBackdropEl) {
        pickerBackdropEl = document.createElement('div');
        pickerBackdropEl.className = 'pet-picker-backdrop pet-only-crazy';
        pickerBackdropEl.id = 'pet-picker-backdrop';
        pickerBackdropEl.innerHTML = `
          <div class="pet-picker-modal" id="pet-picker-modal" role="dialog" aria-modal="true" aria-labelledby="pet-picker-heading">
            <div class="pet-picker-header">
              <span class="pet-picker-title" id="pet-picker-heading">Choose Your Companion Pet</span>
              <button type="button" class="btn-icon-xs" id="pet-picker-close" title="Close">×</button>
            </div>
            <div class="pet-species-grid" id="pet-species-grid">
              ${SPECIES.map((sp) => `
                <button type="button" class="pet-species-card" data-species="${sp}">
                  <div style="width:40px;height:40px;">${buildPetSvg(sp, SPECIES_META[sp].defaultColor, 'none')}</div>
                  <span>${SPECIES_META[sp].label}</span>
                </button>
              `).join('')}
            </div>
            <div class="pet-picker-preview-row">
              <div class="pet-picker-preview-box" id="pet-picker-preview"></div>
              <div class="pet-picker-fields">
                <label class="pet-picker-row">
                  <span>Name</span>
                  <input type="text" id="pet-picker-name" class="pet-picker-input" maxlength="24" style="width: 170px;" placeholder="Pixel">
                </label>
                <label class="pet-picker-row">
                  <span>Color</span>
                  <input type="color" id="pet-picker-color" style="width: 38px; height: 26px; border: none; background: transparent; cursor: pointer;">
                </label>
                <label class="pet-picker-row">
                  <span>Accessory</span>
                  <select id="pet-picker-accessory" class="pet-picker-select" style="width: 170px;">
                    <option value="none">None</option>
                    <option value="collar">Collar</option>
                    <option value="bow">Bow</option>
                    <option value="hat">Hat</option>
                    <option value="glasses">Glasses</option>
                  </select>
                </label>
              </div>
            </div>
            <div class="pet-picker-actions">
              <button type="button" class="btn-secondary-sm" id="pet-picker-remove" style="border-color: #f87171; color: #f87171;">Remove Pet</button>
              <div style="display:flex; gap:8px; margin-left:auto;">
                <button type="button" class="btn-secondary-sm" id="pet-picker-cancel">Cancel</button>
                <button type="button" class="btn-primary-sm" id="pet-picker-save">Save Pet</button>
              </div>
            </div>
          </div>
        `;
        document.body.appendChild(pickerBackdropEl);

        pickerBackdropEl.addEventListener('click', (e) => {
          if (e.target === pickerBackdropEl) closePickerModal();
        });
        pickerBackdropEl.querySelector('#pet-picker-close').addEventListener('click', closePickerModal);
        pickerBackdropEl.querySelector('#pet-picker-cancel').addEventListener('click', closePickerModal);

        pickerBackdropEl.querySelectorAll('.pet-species-card').forEach((card) => {
          card.addEventListener('click', () => {
            const sp = card.dataset.species;
            pickerDraft.petType = sp;
            pickerDraft.petColor = SPECIES_META[sp].defaultColor;
            const cInp = pickerBackdropEl.querySelector('#pet-picker-color');
            if (cInp) cInp.value = pickerDraft.petColor;
            renderPickerBody();
          });
        });

        const nameInp = pickerBackdropEl.querySelector('#pet-picker-name');
        const colorInp = pickerBackdropEl.querySelector('#pet-picker-color');
        const accSel = pickerBackdropEl.querySelector('#pet-picker-accessory');

        nameInp.addEventListener('input', () => {
          pickerDraft.petName = nameInp.value.slice(0, 24);
        });
        colorInp.addEventListener('input', () => {
          pickerDraft.petColor = sanitizeHex(colorInp.value, SPECIES_META[pickerDraft.petType].defaultColor);
          renderPickerBody();
        });
        accSel.addEventListener('change', () => {
          pickerDraft.petAccessory = accSel.value;
          renderPickerBody();
        });

        pickerBackdropEl.querySelector('#pet-picker-save').addEventListener('click', () => {
          const finalName = String(nameInp.value || '').trim().slice(0, 24) || 'Pixel';
          const patch = {
            pet_type: pickerDraft.petType,
            pet_name: finalName,
            pet_color: pickerDraft.petColor,
            pet_accessory: pickerDraft.petAccessory,
            pet_mood: config.petMood || 'happy'
          };
          Object.assign(config, {
            petType: patch.pet_type,
            petName: patch.pet_name,
            petColor: patch.pet_color,
            petAccessory: patch.pet_accessory,
            petMood: patch.pet_mood
          });
          saveConfigPatch(patch);
          closePickerModal();
          renderActiveSurface();
          setState('happy', { durationMs: 1400, bubble: '♥' });
        });

        pickerBackdropEl.querySelector('#pet-picker-remove').addEventListener('click', () => {
          Object.assign(config, { petType: '', petRoam: false, petMood: 'content' });
          saveConfigPatch({ pet_type: '', pet_roam: false, pet_mood: 'content' });
          closePickerModal();
          renderActiveSurface();
        });
      }

      pickerBackdropEl.querySelector('#pet-picker-name').value = pickerDraft.petName;
      pickerBackdropEl.querySelector('#pet-picker-color').value = pickerDraft.petColor;
      pickerBackdropEl.querySelector('#pet-picker-accessory').value = pickerDraft.petAccessory;
      pickerBackdropEl.hidden = false;
      renderPickerBody();
    }

    // ── Event Wiring ────────────────────────────────────────────────────────
    renderActiveSurface();

    document.addEventListener('mousemove', (e) => {
      const now = Date.now();
      const dt = Math.max(1, now - lastPointerTime);
      if (lastPointerTime > 0) {
        const distStep = Math.hypot(e.clientX - prevPointerX, e.clientY - prevPointerY);
        lastPointerSpeed = distStep / dt;
      } else {
        lastPointerSpeed = 0;
      }
      prevPointerX = e.clientX;
      prevPointerY = e.clientY;
      pointerX = e.clientX;
      pointerY = e.clientY;
      lastPointerTime = now;
      lastInteractionTime = now;
      pointerInsideWindow = true;

      if (!config.petType) return;

      const hoverControl = e.target && typeof e.target.closest === 'function'
        ? e.target.closest('.dock-btn, .workspace-chip, .tab-item, .btn-icon, .btn-new-tab')
        : null;
      hoveredInteresting = Boolean(hoverControl && (!hitboxEl || !hitboxEl.contains(hoverControl)));

      if (curState === 'sleep') {
        setState('idle', { clearTransient: true, bubble: '', mood: 'awake' });
      }
      if (!reducedMotion && config.effectsIntensity > 0 && now >= transientUntil && curState !== 'loading' && curState !== 'sleep') {
        if (hoveredInteresting && curState !== 'curious') {
          setState('curious', { clearTransient: true, bubble: '?' });
        } else if (!hoveredInteresting && curState === 'curious') {
          setState(computeCursorDistance() <= CURSOR_ACTIVE_RADIUS_PX ? 'look' : 'idle', { clearTransient: true, bubble: '' });
        }
      }
      scheduleRafIfNeeded();
    }, { passive: true });

    document.addEventListener('mouseleave', () => {
      pointerInsideWindow = false;
      hoveredInteresting = false;
      if (curState === 'look' || curState === 'curious') {
        setState('idle', { clearTransient: true, bubble: '' });
      }
      applyTransforms();
    });

    document.addEventListener('pointerdown', () => {
      lastInteractionTime = Date.now();
      if (curState === 'sleep' && config.petType) {
        setState('idle', { clearTransient: true, bubble: '', mood: 'awake' });
      }
    }, { passive: true });

    document.addEventListener('visibilitychange', () => {
      refreshReducedMotionClass();
      if (document.hidden) {
        stopRaf();
      } else {
        updateHitboxCenter(true);
        scheduleRafIfNeeded();
      }
    });

    if (reduceQuery && typeof reduceQuery.addEventListener === 'function') {
      reduceQuery.addEventListener('change', (e) => {
        reducedMotion = e.matches;
        if (reducedMotion) {
          stopRaf();
          setState('idle', { clearTransient: true, bubble: '' });
        }
        refreshReducedMotionClass();
        applyTransforms();
      });
    }

    root.addEventListener('resize', () => {
      updateHitboxCenter(true);
      if (surface === 'rail' && config.petType) {
        const bounds = computeRailBounds();
        posX = Math.max(bounds.minX, Math.min(bounds.maxX, posX));
        targetX = Math.max(bounds.minX, Math.min(bounds.maxX, targetX));
        applyTransforms();
      } else if (surface === 'roam' && config.petType && config.petRoam) {
        const rest = computeRoamRestPoint();
        targetX = rest.x;
        targetY = rest.y;
        scheduleRafIfNeeded();
      }
    });

    function handleSettingsSync() {
      const next = readConfig();
      const changed =
        next.petType !== config.petType ||
        next.petName !== config.petName ||
        next.petColor !== config.petColor ||
        next.petAccessory !== config.petAccessory ||
        next.petRoam !== config.petRoam ||
        next.effectsIntensity !== config.effectsIntensity;
      config = next;
      if (changed) {
        renderActiveSurface();
        refreshReducedMotionClass();
        scheduleRafIfNeeded();
      } else if (moodPillEl) {
        moodPillEl.textContent = config.petMood;
      }
      syncTreatButton();
    }

    root.addEventListener('settings-changed', handleSettingsSync);
    if (root.bridge && typeof root.bridge.on === 'function') {
      root.bridge.on('ui_settings_sync', handleSettingsSync);
      root.bridge.on('pet_event', (data) => {
        if (data && data.event) triggerReaction(data.event);
      });
      root.bridge.on('memory_stats', (mem) => {
        if (!mem) return;
        const mb = typeof mem.private_ws_mb === 'number' ? mem.private_ws_mb : Number(mem.total_mb || 0);
        if (mb >= 350) {
          triggerReaction('memory_high');
        }
      });
      root.bridge.on('telemetry_stats', (snap) => {
        if (!snap) return;
        if (Number(snap.sys_ram_percent || 0) >= 88 || Number(snap.browser_mb || 0) >= 350) {
          triggerReaction('memory_high');
        }
      });
      root.bridge.on('state_update', () => {
        if (surface === 'roam' && config.petRoam && config.petType && !reducedMotion && config.effectsIntensity > 0) {
          const rest = computeRoamRestPoint();
          targetX = rest.x;
          targetY = rest.y;
          if (Math.abs(targetX - posX) > 2 || Math.abs(targetY - posY) > 2) {
            facing = targetX >= posX ? 1 : -1;
            setState('follow', { clearTransient: true, bubble: '' });
          }
        }
      });
    }

    const bgInterval = setInterval(evaluateBackgroundBehavior, 2000);
    root.addEventListener('unload', () => {
      stopRaf();
      clearInterval(bgInterval);
      if (treatCooldownTimer) clearInterval(treatCooldownTimer);
      if (transientTimer) clearTimeout(transientTimer);
      if (loadingSafetyTimer) clearTimeout(loadingSafetyTimer);
      if (bubbleClearTimer) clearTimeout(bubbleClearTimer);
    });

    // Public diagnostics & modular art manifest
    root.RustyPet = {
      STATES,
      SPECIES,
      ACCESSORIES,
      openPicker: openPickerModal,
      closePicker: closePickerModal,
      feedTreat,
      pet: petTheCompanion,
      triggerEvent: (evt) => {
        root.__petForceEvent = true;
        try {
          triggerReaction(evt);
        } finally {
          root.__petForceEvent = false;
        }
      },
      setReducedMotionForTest: (flag) => {
        reducedMotion = Boolean(flag);
        if (reducedMotion) stopRaf();
        refreshReducedMotionClass();
        applyTransforms();
      },
      getState: () => ({
        surface,
        state: curState,
        petType: config.petType,
        petName: config.petName,
        petColor: config.petColor,
        petAccessory: config.petAccessory,
        petMood: config.petMood,
        petRoam: config.petRoam,
        rafActive: rafId !== 0,
        fpsCap: FPS_CAP,
        pausedHidden: document.hidden,
        reducedMotion,
        effectsIntensity: config.effectsIntensity,
        cursorDist: Math.round(computeCursorDistance()),
        treatCooldownRemainingSec: getRemainingTreatSeconds(),
        position: { x: Number(posX.toFixed(1)), y: Number(posY.toFixed(1)) }
      })
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(typeof window !== 'undefined' ? window : this);
