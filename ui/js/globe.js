// Interactive 3D Earth Globe (A2) — Hand-written zero-dependency WebGL sphere
// Replaced decorative orb inside #globe-slot.
//
// PLACEHOLDER: Earth textures (ui/assets/earth-day.webp, earth-night.webp, earth-fallback.webp)
// are procedural placeholder maps. Before shipping public builds, you may swap in
// NASA Blue Marble / Black Marble (public domain) or Natural Earth maps and verify
// their license terms.
(function (root) {
  'use strict';

  const STORAGE_KEY = 'rusty_browser_settings_v4';
  const IDLE_RECENTER_MS = 10000;
  const TARGET_FPS_MS = 1000 / 30;
  const CAM_DIST = 4.0;
  const TAN_HALF_FOV = 1.0 / (0.88 * Math.sqrt(CAM_DIST * CAM_DIST - 1.0));
  const DEG2RAD = Math.PI / 180;
  const RAD2DEG = 180 / Math.PI;

  const slot = document.getElementById('globe-slot');
  if (!slot) return;

  // Replace placeholder orb with structured WebGL canvas + static fallback + pin + hover tooltip
  slot.innerHTML = '';

  const atmoBg = document.createElement('div');
  atmoBg.className = 'globe-atmo-halo';
  slot.appendChild(atmoBg);

  function createGlobeCanvas() {
    const c = document.createElement('canvas');
    c.id = 'globe-canvas';
    c.className = 'globe-canvas';
    c.setAttribute('aria-label', 'Interactive 3D Earth globe');
    return c;
  }

  let canvas = createGlobeCanvas();
  slot.appendChild(canvas);

  // PLACEHOLDER static pre-rendered Earth image used when WebGL is unavailable or effects_intensity === 0
  const fallbackImg = document.createElement('img');
  fallbackImg.id = 'globe-fallback-img';
  fallbackImg.className = 'globe-fallback-img';
  fallbackImg.src = 'assets/earth-fallback.webp';
  fallbackImg.alt = 'Earth';
  fallbackImg.hidden = true;
  slot.appendChild(fallbackImg);

  const pinEl = document.createElement('div');
  pinEl.id = 'globe-pin';
  pinEl.className = 'globe-pin';
  pinEl.hidden = true;
  slot.appendChild(pinEl);

  const tooltipEl = document.createElement('div');
  tooltipEl.id = 'globe-tooltip';
  tooltipEl.className = 'globe-tooltip';
  tooltipEl.hidden = true;
  slot.appendChild(tooltipEl);

  // Read initial settings synchronously
  function readSettings() {
    let merged = {};
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) merged = JSON.parse(raw) || {};
    } catch (_) {}
    if (root.Settings && root.Settings.data) {
      merged = Object.assign(merged, root.Settings.data);
    } else if (root.BOOT_SETTINGS) {
      merged = Object.assign(merged, root.BOOT_SETTINGS);
    }
    return merged;
  }

  let settingsSnapshot = readSettings();
  let effectsIntensity = settingsSnapshot.effects_intensity !== undefined
    ? Number(settingsSnapshot.effects_intensity)
    : 80;
  let cloudsEnabled = Boolean(settingsSnapshot.ntp_globe_clouds);
  const reducedMotionQuery = typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : null;
  let reducedMotion = reducedMotionQuery ? reducedMotionQuery.matches : false;

  // Location priority state:
  // (2) embedded timezone/locale centroid default -> overridden by (1) settings city or (3) manual "Use my location"
  const initialCentroid = (root.RustyLocations && typeof root.RustyLocations.resolveLocalCentroid === 'function')
    ? root.RustyLocations.resolveLocalCentroid()
    : { lat: 51.51, lon: -0.13, city: 'London', country: 'United Kingdom' };

  let homeLocation = {
    lat: Number(initialCentroid.lat) || 28.61,
    lon: Number(initialCentroid.lon) || 77.21,
    city: initialCentroid.city || '',
    country: initialCentroid.country || '',
    source: 'centroid'
  };

  // Start slightly rotated East/West so load-time arrival rotates smoothly onto user's country
  let viewLat = Math.max(-72, Math.min(72, homeLocation.lat * 0.6));
  let viewLon = wrapLon(homeLocation.lon - 52);

  let velLat = 0;
  let velLon = 0;
  let isDragging = false;
  let dragLastX = 0;
  let dragLastY = 0;
  let pointerHovering = false;
  let lastInteractionMs = performance.now();
  let easingToHome = true;
  let animStartMs = performance.now();
  let animFromLat = viewLat;
  let animFromLon = viewLon;
  let idleCycleStartMs = performance.now();
  let lastHoverCheckMs = 0;
  let lastDrawMs = 0;
  let rafId = null;
  let webglLost = false;
  let contextForceLost = false;
  let isFallbackMode = false;

  // WebGL handles
  let gl = null;
  let program = null;
  let vbo = null;
  let ibo = null;
  let indexCount = 0;
  let texDay = null;
  let texNight = null;
  let texturesLoaded = 0;
  let uniforms = {};
  let aPosLoc = -1;
  let aUvLoc = -1;
  let slotSizePx = 128;

  function wrapLon(lonDeg) {
    let x = ((lonDeg + 180) % 360 + 360) % 360 - 180;
    return x === -180 ? 180 : x;
  }

  function shortestAngleDeltaDeg(fromDeg, toDeg) {
    return ((toDeg - fromDeg + 540) % 360) - 180;
  }

  function clampLat(latDeg) {
    return Math.max(-75, Math.min(75, latDeg));
  }

  function easeOutCubic(t) {
    const u = 1 - Math.max(0, Math.min(1, t));
    return 1 - u * u * u;
  }

  function computeSunDirectionLocal() {
    const now = new Date();
    const startOfYear = Date.UTC(now.getUTCFullYear(), 0, 1);
    const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const dayOfYear = Math.floor((todayUtc - startOfYear) / 86400000) + 1;
    const decl = -23.44 * DEG2RAD * Math.cos((2 * Math.PI / 365) * (dayOfYear + 10));
    const utcHours = now.getUTCHours() + now.getUTCMinutes() / 60 + now.getUTCSeconds() / 3600;
    const sunLon = (12.0 - utcHours) * 15.0 * DEG2RAD;
    const cd = Math.cos(decl);
    return [
      cd * Math.sin(sunLon),
      Math.sin(decl),
      cd * Math.cos(sunLon)
    ];
  }

  function latLonToLocal(latDeg, lonDeg) {
    const lat = latDeg * DEG2RAD;
    const lon = lonDeg * DEG2RAD;
    const cl = Math.cos(lat);
    return [cl * Math.sin(lon), Math.sin(lat), cl * Math.cos(lon)];
  }

  function localToView(px, py, pz, vLatDeg, vLonDeg) {
    const rLon = vLonDeg * DEG2RAD;
    const cLon = Math.cos(rLon);
    const sLon = Math.sin(rLon);
    const x1 = px * cLon - pz * sLon;
    const z1 = px * sLon + pz * cLon;
    const y1 = py;

    const rLat = vLatDeg * DEG2RAD;
    const cLat = Math.cos(rLat);
    const sLat = Math.sin(rLat);
    return [
      x1,
      y1 * cLat - z1 * sLat,
      y1 * sLat + z1 * cLat
    ];
  }

  function viewToLatLon(vx, vy, vz, vLatDeg, vLonDeg) {
    const rLat = vLatDeg * DEG2RAD;
    const cLat = Math.cos(rLat);
    const sLat = Math.sin(rLat);
    const x1 = vx;
    const y1 = vy * cLat + vz * sLat;
    const z1 = -vy * sLat + vz * cLat;

    const rLon = vLonDeg * DEG2RAD;
    const cLon = Math.cos(rLon);
    const sLon = Math.sin(rLon);
    const px = x1 * cLon + z1 * sLon;
    const py = y1;
    const pz = -x1 * sLon + z1 * cLon;

    const lat = Math.asin(Math.max(-1, Math.min(1, py))) * RAD2DEG;
    const lon = Math.atan2(px, pz) * RAD2DEG;
    return { lat, lon };
  }

  function raycastGlobeAtClientPoint(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = 1 - ((clientY - rect.top) / rect.height) * 2;
    const dx = ndcX * TAN_HALF_FOV;
    const dy = ndcY * TAN_HALF_FOV;
    const dz = -1;
    const len = Math.hypot(dx, dy, dz);
    const ux = dx / len;
    const uy = dy / len;
    const uz = dz / len;

    // Sphere origin at (0,0,0), camera at (0,0,CAM_DIST)
    const b = CAM_DIST * uz;
    const c = CAM_DIST * CAM_DIST - 1;
    const disc = b * b - c;
    if (disc < 0) return null;
    const t = -b - Math.sqrt(disc);
    if (t <= 0) return null;

    const vx = t * ux;
    const vy = t * uy;
    const vz = CAM_DIST + t * uz;
    return viewToLatLon(vx, vy, vz, viewLat, viewLon);
  }

  function updatePinOverlay() {
    if (isFallbackMode || !gl || webglLost) {
      pinEl.hidden = true;
      return;
    }
    const [px, py, pz] = latLonToLocal(homeLocation.lat, homeLocation.lon);
    const [vx, vy, vz] = localToView(px, py, pz, viewLat, viewLon);
    if (vz <= (1.0 / CAM_DIST) + 0.03) {
      pinEl.hidden = true;
      return;
    }
    const denom = (CAM_DIST - vz) * TAN_HALF_FOV;
    const ndcX = vx / denom;
    const ndcY = vy / denom;
    const leftPx = (0.5 + 0.5 * ndcX) * slotSizePx;
    const topPx = (0.5 - 0.5 * ndcY) * slotSizePx;
    pinEl.style.transform = `translate3d(${leftPx.toFixed(1)}px, ${topPx.toFixed(1)}px, 0)`;
    pinEl.title = [homeLocation.city, homeLocation.country].filter(Boolean).join(', ');
    pinEl.hidden = false;
  }

  function resizeCanvasIfNeeded() {
    const rect = slot.getBoundingClientRect();
    const cssSize = Math.max(96, Math.round(Math.min(rect.width || 128, rect.height || 128)));
    slotSizePx = cssSize;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const targetW = Math.round(cssSize * dpr);
    const targetH = Math.round(cssSize * dpr);
    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW;
      canvas.height = targetH;
      if (gl) gl.viewport(0, 0, targetW, targetH);
    }
  }

  function createSphereGeometry(latBands, lonBands) {
    const positions = [];
    const uvs = [];
    const indices = [];

    for (let y = 0; y <= latBands; y++) {
      const v = y / latBands;
      const lat = (0.5 - v) * Math.PI;
      const sinLat = Math.sin(lat);
      const cosLat = Math.cos(lat);

      for (let x = 0; x <= lonBands; x++) {
        const u = x / lonBands;
        const lon = (u - 0.5) * 2.0 * Math.PI;
        const px = cosLat * Math.sin(lon);
        const py = sinLat;
        const pz = cosLat * Math.cos(lon);
        positions.push(px, py, pz);
        uvs.push(u, v);
      }
    }

    const stride = lonBands + 1;
    for (let y = 0; y < latBands; y++) {
      for (let x = 0; x < lonBands; x++) {
        const a = y * stride + x;
        const b = a + stride;
        const c = a + 1;
        const d = b + 1;
        indices.push(a, b, c);
        indices.push(c, b, d);
      }
    }

    const interleaved = new Float32Array((latBands + 1) * (lonBands + 1) * 5);
    for (let i = 0, vi = 0, ui = 0; i < interleaved.length; i += 5, vi += 3, ui += 2) {
      interleaved[i] = positions[vi];
      interleaved[i + 1] = positions[vi + 1];
      interleaved[i + 2] = positions[vi + 2];
      interleaved[i + 3] = uvs[ui];
      interleaved[i + 4] = uvs[ui + 1];
    }
    return {
      vertices: interleaved,
      indices: new Uint16Array(indices)
    };
  }

  const VS_SRC = `
    precision mediump float;
    attribute vec3 aPos;
    attribute vec2 aUv;
    uniform float uViewLonRad;
    uniform float uViewLatRad;
    uniform float uCamDist;
    uniform float uTanHalfFov;
    varying vec2 vUv;
    varying vec3 vLocalDir;
    varying vec3 vViewPos;
    void main() {
      float cLon = cos(uViewLonRad);
      float sLon = sin(uViewLonRad);
      vec3 p1 = vec3(
        aPos.x * cLon - aPos.z * sLon,
        aPos.y,
        aPos.x * sLon + aPos.z * cLon
      );
      float cLat = cos(uViewLatRad);
      float sLat = sin(uViewLatRad);
      vec3 p2 = vec3(
        p1.x,
        p1.y * cLat - p1.z * sLat,
        p1.y * sLat + p1.z * cLat
      );
      float denom = (uCamDist - p2.z) * uTanHalfFov;
      float ndcZ = clamp(0.5 - p2.z * 0.45, -0.95, 0.95);
      gl_Position = vec4(p2.x / denom, p2.y / denom, ndcZ, 1.0);
      vUv = aUv;
      vLocalDir = aPos;
      vViewPos = p2;
    }
  `;

  const FS_SRC = `
    precision mediump float;
    uniform sampler2D uDayTex;
    uniform sampler2D uNightTex;
    uniform vec3 uSunDir;
    uniform float uCamDist;
    uniform float uClouds;
    uniform float uTime;
    varying vec2 vUv;
    varying vec3 vLocalDir;
    varying vec3 vViewPos;

    float hash21(vec2 p) {
      p = fract(p * vec2(123.34, 456.21));
      p += dot(p, p + 45.32);
      return fract(p.x * p.y);
    }

    float valueNoise(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      float a = hash21(i);
      float b = hash21(i + vec2(1.0, 0.0));
      float c = hash21(i + vec2(0.0, 1.0));
      float d = hash21(i + vec2(1.0, 1.0));
      return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
    }

    float fbmClouds(vec2 p) {
      float v = 0.0;
      v += 0.55 * valueNoise(p);
      v += 0.30 * valueNoise(p * 2.1 + vec2(4.2, 1.7));
      v += 0.15 * valueNoise(p * 4.3 + vec2(-2.1, 3.4));
      return v;
    }

    void main() {
      vec3 nLocal = normalize(vLocalDir);
      vec3 nView = normalize(vViewPos);
      vec3 viewDir = normalize(vec3(0.0, 0.0, uCamDist) - vViewPos);

      vec3 dayCol = texture2D(uDayTex, vUv).rgb;
      vec4 nightRaw = texture2D(uNightTex, vUv);

      float sunDot = dot(nLocal, normalize(uSunDir));
      float dayWeight = smoothstep(-0.12, 0.15, sunDot);
      float diffuse = 0.24 + 0.88 * pow(max(sunDot, 0.0), 0.85);
      vec3 litDay = dayCol * diffuse;

      // Golden twilight band along terminator
      float terminator = exp(-pow((sunDot - 0.01) * 9.0, 2.0));
      litDay += vec3(0.55, 0.24, 0.07) * terminator * 0.35;

      // Single-channel R8 (4096x2048) night lights texture tinted warm amber (~11 MB GPU VRAM instead of 32+ MB)
      vec3 litNight = (nightRaw.g < 0.05 && nightRaw.b < 0.05 && nightRaw.r > 0.0)
        ? vec3(nightRaw.r * 1.18, nightRaw.r * 0.84, nightRaw.r * 0.44) * 1.35
        : nightRaw.rgb * 1.25;
      vec3 earthCol = mix(litNight, litDay, dayWeight);

      // Optional procedural cloud layer toggle
      if (uClouds > 0.5) {
        vec2 cUv = vec2(fract(vUv.x + uTime * 0.0045) * 8.0, vUv.y * 4.0);
        float cMask = smoothstep(0.56, 0.78, fbmClouds(cUv));
        float latMask = smoothstep(0.02, 0.14, vUv.y) * smoothstep(0.98, 0.86, vUv.y);
        float cloudLight = mix(0.14, 0.96, dayWeight) * (0.45 + 0.55 * max(sunDot, 0.0));
        vec3 cloudCol = vec3(0.93, 0.96, 1.0) * cloudLight;
        earthCol = mix(earthCol, cloudCol, cMask * latMask * 0.62);
      }

      // Soft atmospheric Fresnel rim
      float ndotv = max(dot(nView, viewDir), 0.0);
      float fresnel = pow(1.0 - ndotv, 2.75);
      vec3 rimColor = mix(vec3(0.22, 0.48, 0.95), vec3(0.45, 0.80, 1.0), dayWeight * 0.8 + 0.2);
      earthCol += rimColor * fresnel * 0.68;

      gl_FragColor = vec4(earthCol, 1.0);
    }
  `;

  function compileShader(type, src) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      console.warn('[globe] Shader compile error:', gl.getShaderInfoLog(sh));
      gl.deleteShader(sh);
      return null;
    }
    return sh;
  }

  function createSolidPlaceholderTexture(r, g, b) {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      1,
      1,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      new Uint8Array([r, g, b, 255])
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  function loadTextureUrl(url, targetTex, unit) {
    const img = new Image();
    img.onload = () => {
      if (!gl || webglLost) return;
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, targetTex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);

      // Enable Mipmaps and Anisotropic Filtering for high-detail 4096x2048 textures
      const isPowerOfTwo = (img.width & (img.width - 1)) === 0 && (img.height & (img.height - 1)) === 0;
      if (isPowerOfTwo) {
        gl.generateMipmap(gl.TEXTURE_2D);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        const anisoExt = gl.getExtension('EXT_texture_filter_anisotropic') ||
                         gl.getExtension('WEBKIT_EXT_texture_filter_anisotropic');
        if (anisoExt) {
          const maxAniso = gl.getParameter(anisoExt.MAX_TEXTURE_MAX_ANISOTROPY_EXT) || 4;
          gl.texParameterf(gl.TEXTURE_2D, anisoExt.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(4, maxAniso));
        }
      } else {
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      }
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      texturesLoaded += 1;
      drawFrameNow(performance.now());
    };
    img.src = url;
  }

  function initWebGL() {
    if (gl && !webglLost) return true;
    webglLost = false;
    if (contextForceLost) {
      const fresh = createGlobeCanvas();
      fresh.hidden = canvas.hidden;
      if (canvas.parentNode) {
        canvas.parentNode.replaceChild(fresh, canvas);
      } else {
        slot.insertBefore(fresh, fallbackImg);
      }
      canvas = fresh;
      bindCanvasListeners(canvas);
      contextForceLost = false;
    }
    let ctx = null;
    try {
      ctx = canvas.getContext('webgl', {
        alpha: true,
        antialias: true,
        depth: true,
        powerPreference: 'low-power',
        preserveDrawingBuffer: false
      }) || canvas.getContext('experimental-webgl', {
        alpha: true,
        antialias: true,
        depth: true,
        powerPreference: 'low-power'
      });
    } catch (_) {
      ctx = null;
    }

    if (!ctx) return false;
    gl = ctx;

    const vs = compileShader(gl.VERTEX_SHADER, VS_SRC);
    const fs = compileShader(gl.FRAGMENT_SHADER, FS_SRC);
    if (!vs || !fs) {
      disposeWebGL(false);
      return false;
    }

    program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.warn('[globe] Program link error:', gl.getProgramInfoLog(program));
      disposeWebGL(false);
      return false;
    }

    const mesh = createSphereGeometry(28, 40);
    indexCount = mesh.indices.length;

    vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.vertices, gl.STATIC_DRAW);

    ibo = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW);

    aPosLoc = gl.getAttribLocation(program, 'aPos');
    aUvLoc = gl.getAttribLocation(program, 'aUv');

    uniforms = {
      viewLon: gl.getUniformLocation(program, 'uViewLonRad'),
      viewLat: gl.getUniformLocation(program, 'uViewLatRad'),
      camDist: gl.getUniformLocation(program, 'uCamDist'),
      tanHalfFov: gl.getUniformLocation(program, 'uTanHalfFov'),
      dayTex: gl.getUniformLocation(program, 'uDayTex'),
      nightTex: gl.getUniformLocation(program, 'uNightTex'),
      sunDir: gl.getUniformLocation(program, 'uSunDir'),
      clouds: gl.getUniformLocation(program, 'uClouds'),
      time: gl.getUniformLocation(program, 'uTime')
    };

    texDay = createSolidPlaceholderTexture(14, 65, 122);
    texNight = createSolidPlaceholderTexture(5, 12, 28);
    texturesLoaded = 0;
    loadTextureUrl('assets/earth-day.webp', texDay, 0);
    loadTextureUrl('assets/earth-night.webp', texNight, 1);

    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.clearColor(0, 0, 0, 0);

    resizeCanvasIfNeeded();
    return true;
  }

  function disposeWebGL(loseCtx) {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    if (!gl) return;
    try {
      if (vbo) gl.deleteBuffer(vbo);
      if (ibo) gl.deleteBuffer(ibo);
      if (texDay) gl.deleteTexture(texDay);
      if (texNight) gl.deleteTexture(texNight);
      if (program) gl.deleteProgram(program);
      if (loseCtx) {
        contextForceLost = true;
        if (canvas) canvas.__forceLost = true;
        const ext = gl.getExtension('WEBGL_lose_context');
        if (ext) ext.loseContext();
      }
    } catch (_) {}
    vbo = null;
    ibo = null;
    texDay = null;
    texNight = null;
    program = null;
    gl = null;
    indexCount = 0;
    texturesLoaded = 0;
  }

  function drawFrameNow(nowMs) {
    if (isFallbackMode || !gl || webglLost || document.hidden) return;
    resizeCanvasIfNeeded();

    const sun = computeSunDirectionLocal();
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(program);

    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);

    gl.enableVertexAttribArray(aPosLoc);
    gl.vertexAttribPointer(aPosLoc, 3, gl.FLOAT, false, 20, 0);
    gl.enableVertexAttribArray(aUvLoc);
    gl.vertexAttribPointer(aUvLoc, 2, gl.FLOAT, false, 20, 12);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texDay);
    gl.uniform1i(uniforms.dayTex, 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, texNight);
    gl.uniform1i(uniforms.nightTex, 1);

    gl.uniform1f(uniforms.viewLon, viewLon * DEG2RAD);
    gl.uniform1f(uniforms.viewLat, viewLat * DEG2RAD);
    gl.uniform1f(uniforms.camDist, CAM_DIST);
    gl.uniform1f(uniforms.tanHalfFov, TAN_HALF_FOV);
    gl.uniform3f(uniforms.sunDir, sun[0], sun[1], sun[2]);
    gl.uniform1f(uniforms.clouds, cloudsEnabled ? 1.0 : 0.0);
    gl.uniform1f(uniforms.time, ((nowMs || 0) * 0.001) % (1.0 / 0.0045));

    gl.drawElements(gl.TRIANGLES, indexCount, gl.UNSIGNED_SHORT, 0);
    updatePinOverlay();
  }

  function startEasingHome(durationReset) {
    easingToHome = true;
    animStartMs = performance.now();
    animFromLat = viewLat;
    animFromLon = viewLon;
    velLat = 0;
    velLon = 0;
    if (durationReset) {
      idleCycleStartMs = animStartMs;
    }
    ensureLoopRunning();
  }

  function stepAnimation(nowMs) {
    const dtSec = Math.min(0.1, Math.max(0.001, (nowMs - lastDrawMs) * 0.001));

    if (isDragging) {
      return;
    }

    if (easingToHome) {
      const targetLat = clampLat(homeLocation.lat * 0.72);
      const targetLon = homeLocation.lon;
      const elapsed = nowMs - animStartMs;
      const t = Math.min(1, elapsed / 1200);
      const e = easeOutCubic(t);
      viewLat = animFromLat + (targetLat - animFromLat) * e;
      viewLon = wrapLon(animFromLon + shortestAngleDeltaDeg(animFromLon, targetLon) * e);
      if (t >= 1) {
        viewLat = targetLat;
        viewLon = targetLon;
        easingToHome = false;
        idleCycleStartMs = nowMs;
      }
      return;
    }

    // Apply pointer-release inertia
    if (Math.abs(velLon) > 0.04 || Math.abs(velLat) > 0.04) {
      viewLon = wrapLon(viewLon + velLon);
      viewLat = clampLat(viewLat + velLat);
      const decay = Math.pow(0.92, dtSec * 60);
      velLon *= decay;
      velLat *= decay;
      if (Math.abs(velLon) <= 0.04) velLon = 0;
      if (Math.abs(velLat) <= 0.04) velLat = 0;
      return;
    }

    // Re-center smoothly back to user's country after 10 seconds of idle
    const idleSinceInteraction = nowMs - lastInteractionMs;
    const awayDeg = Math.hypot(
      shortestAngleDeltaDeg(viewLon, homeLocation.lon),
      viewLat - clampLat(homeLocation.lat * 0.72)
    );
    if (idleSinceInteraction >= IDLE_RECENTER_MS && awayDeg > 6.0) {
      startEasingHome(false);
      lastInteractionMs = nowMs;
      return;
    }

    // Gentle idle auto-rotation when not dragging or hovering and motion allowed
    if (!reducedMotion && !pointerHovering) {
      viewLon = wrapLon(viewLon + 2.2 * dtSec);
      const targetIdleLat = clampLat(homeLocation.lat * 0.72);
      viewLat += (targetIdleLat - viewLat) * Math.min(1, dtSec * 0.8);
      if (nowMs - idleCycleStartMs >= IDLE_RECENTER_MS && awayDeg > 18.0) {
        startEasingHome(true);
      }
    }
  }

  function tick(nowMs) {
    rafId = null;
    if (document.hidden || isFallbackMode || !gl || webglLost) {
      return;
    }

    if (nowMs - lastDrawMs >= TARGET_FPS_MS) {
      stepAnimation(nowMs);
      lastDrawMs = nowMs;
      drawFrameNow(nowMs);
    }

    if (!document.hidden && !isFallbackMode && gl && !webglLost) {
      if (!reducedMotion || easingToHome || isDragging || Math.abs(velLon) > 0.04 || Math.abs(velLat) > 0.04) {
        rafId = requestAnimationFrame(tick);
      }
    }
  }

  function ensureLoopRunning() {
    if (document.hidden || isFallbackMode || webglLost || !gl) return;
    if (rafId === null) {
      lastDrawMs = performance.now() - TARGET_FPS_MS;
      rafId = requestAnimationFrame(tick);
    }
  }

  function applyRenderMode() {
    const wantFallback = effectsIntensity <= 0 || webglLost;
    if (wantFallback) {
      isFallbackMode = true;
      canvas.hidden = true;
      fallbackImg.hidden = false;
      pinEl.hidden = true;
      tooltipEl.hidden = true;
      if (effectsIntensity <= 0 && gl && !webglLost) {
        disposeWebGL(true);
      } else if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      slot.classList.add('globe-static-mode');
      return;
    }

    slot.classList.remove('globe-static-mode');
    if (!initWebGL()) {
      isFallbackMode = true;
      canvas.hidden = true;
      fallbackImg.hidden = false;
      pinEl.hidden = true;
      slot.classList.add('globe-static-mode');
      return;
    }

    isFallbackMode = false;
    fallbackImg.hidden = true;
    canvas.hidden = false;
    drawFrameNow(performance.now());
    ensureLoopRunning();
  }

  // Drag to spin, inertia, hover country tooltip, double-click to re-center
  function bindCanvasListeners(el) {
    if (!el) return;
    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || isFallbackMode) return;
      e.stopPropagation();
      isDragging = true;
      easingToHome = false;
      velLat = 0;
      velLon = 0;
      dragLastX = e.clientX;
      dragLastY = e.clientY;
      lastInteractionMs = performance.now();
      tooltipEl.hidden = true;
      try { el.setPointerCapture(e.pointerId); } catch (_) {}
    });

    el.addEventListener('pointermove', (e) => {
      if (isFallbackMode || !gl) return;
      if (isDragging) {
        e.stopPropagation();
        const dx = e.clientX - dragLastX;
        const dy = e.clientY - dragLastY;
        dragLastX = e.clientX;
        dragLastY = e.clientY;
        const dLon = -dx * 0.72;
        const dLat = dy * 0.62;
        viewLon = wrapLon(viewLon + dLon);
        viewLat = clampLat(viewLat + dLat);
        velLon = dLon * 0.45;
        velLat = dLat * 0.45;
        lastInteractionMs = performance.now();
        drawFrameNow(lastInteractionMs);
        return;
      }

      pointerHovering = true;
      const now = performance.now();
      if (now - lastHoverCheckMs < 40) return;
      lastHoverCheckMs = now;
      const hit = raycastGlobeAtClientPoint(e.clientX, e.clientY);
      if (!hit) {
        tooltipEl.hidden = true;
        return;
      }
      const label = (root.RustyLocations && typeof root.RustyLocations.lookupCountryAt === 'function')
        ? root.RustyLocations.lookupCountryAt(hit.lat, hit.lon)
        : '';
      if (label) {
        tooltipEl.textContent = label;
        tooltipEl.hidden = false;
      } else {
        tooltipEl.hidden = true;
      }
    });

    function endDrag(e) {
      if (!isDragging) return;
      isDragging = false;
      lastInteractionMs = performance.now();
      try { el.releasePointerCapture(e.pointerId); } catch (_) {}
      ensureLoopRunning();
    }

    el.addEventListener('pointerup', endDrag);
    el.addEventListener('pointercancel', endDrag);

    el.addEventListener('pointerleave', () => {
      pointerHovering = false;
      tooltipEl.hidden = true;
    });

    el.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      if (el.__forceLost || el !== canvas) return;
      webglLost = true;
      applyRenderMode();
    });

    el.addEventListener('webglcontextrestored', () => {
      if (el.__forceLost || el !== canvas) return;
      webglLost = false;
      applyRenderMode();
    });
  }

  bindCanvasListeners(canvas);

  slot.addEventListener('dblclick', (e) => {
    e.stopPropagation();
    lastInteractionMs = performance.now();
    startEasingHome(true);
  });

  // Prevent Time & Weather card click-expand from hijacking clicks on the interactive globe
  slot.addEventListener('click', (e) => {
    e.stopPropagation();
  });

  // Pause rendering when NTP is hidden / tab backgrounded / window minimized
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
    } else if (!isFallbackMode) {
      lastDrawMs = performance.now() - TARGET_FPS_MS;
      drawFrameNow(performance.now());
      ensureLoopRunning();
    }
  });

  // Dispose WebGL context & GPU resources cleanly when leaving New Tab
  function cleanupOnUnload() {
    disposeWebGL(true);
    isFallbackMode = true;
    canvas.hidden = true;
    fallbackImg.hidden = false;
    updatePinOverlay();
  }
  window.addEventListener('pagehide', cleanupOnUnload);
  window.addEventListener('beforeunload', cleanupOnUnload);
  window.addEventListener('pageshow', (e) => {
    if (e && e.persisted) {
      webglLost = false;
      applyRenderMode();
    }
  });

  // React live to location changes from Settings / Weather / "Use my location"
  window.addEventListener('rusty-globe-location', (e) => {
    const d = e && e.detail;
    if (!d || !Number.isFinite(d.lat) || !Number.isFinite(d.lon)) return;
    homeLocation = {
      lat: Number(d.lat),
      lon: Number(d.lon),
      city: d.city || '',
      country: d.country || '',
      source: d.source || 'weather'
    };
    startEasingHome(true);
  });

  function syncSettings(s) {
    if (!s || typeof s !== 'object') return;
    const prevInt = effectsIntensity;
    if (s.effects_intensity !== undefined) {
      effectsIntensity = Number(s.effects_intensity);
    }
    if (s.ntp_globe_clouds !== undefined) {
      cloudsEnabled = Boolean(s.ntp_globe_clouds);
    }
    if (prevInt !== effectsIntensity) {
      applyRenderMode();
    } else if (!isFallbackMode && !document.hidden) {
      drawFrameNow(performance.now());
    }
  }

  window.addEventListener('settings-changed', (e) => syncSettings(e.detail));
  if (root.bridge && typeof root.bridge.on === 'function') {
    root.bridge.on('ui_settings_sync', (d) => {
      if (d && d.settings) syncSettings(d.settings);
    });
  }

  if (reducedMotionQuery && typeof reducedMotionQuery.addEventListener === 'function') {
    reducedMotionQuery.addEventListener('change', (ev) => {
      reducedMotion = ev.matches;
      if (!reducedMotion) ensureLoopRunning();
    });
  }

  if (typeof ResizeObserver === 'function') {
    const ro = new ResizeObserver(() => {
      resizeCanvasIfNeeded();
      if (!isFallbackMode && !document.hidden) drawFrameNow(performance.now());
    });
    ro.observe(slot);
  }

  applyRenderMode();

  // Exposed diagnostic helper for live tests and status inspection
  root.RustyGlobe = {
    getState: () => ({
      mode: isFallbackMode ? 'static-fallback' : 'webgl',
      viewLat: Number(viewLat.toFixed(2)),
      viewLon: Number(viewLon.toFixed(2)),
      homeLocation: { ...homeLocation },
      cloudsEnabled,
      effectsIntensity,
      texturesLoaded,
      rafActive: rafId !== null,
      pinVisible: !pinEl.hidden,
      slotSizePx
    }),
    recenter: () => startEasingHome(true),
    setClouds: (on) => {
      cloudsEnabled = Boolean(on);
      if (!isFallbackMode && !document.hidden) drawFrameNow(performance.now());
    }
  };
})(typeof window !== 'undefined' ? window : this);
