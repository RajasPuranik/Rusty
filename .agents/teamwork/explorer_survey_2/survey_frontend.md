# Comprehensive Frontend UI, Skins & WebGL Survey Report

**Date**: 2026-11-09  
**Explorer**: Explorer 2 (Frontend UI, Skins & WebGL Explorer)  
**Scope**: In-depth survey of `d:\browser\ui`, mock bridge runner, skin loading architecture, WebGL canvas / 3D globe, and requirements for Milestones R5, R6, and R7.  
**Integrity Mode**: Read-Only Survey & Architectural Blueprint  

---

## Executive Summary

Rusty Browser's frontend is an ultra-lightweight, zero-framework, dependency-free vanilla web application located in `d:\browser\ui`. It is statically served at compile-time by the Rust backend via a custom `rusty://app/` scheme (implemented in `src/ui/app_protocol.rs` with `include_bytes!`).

Key findings of this survey:
1. **Mock Bridge Runner**: The standalone preview mode built into `ui/js/bridge.js` and `ui/js/chrome.js` functions seamlessly without requiring the Rust backend or native IPC. Headless Edge DevTools Protocol (CDP) testing verified **zero console errors and zero uncaught exceptions** across all pages (`index.html`, `newtab.html`) and skin configurations.
2. **Skin Invariant Enforcement**: The invariant *"Only the active skin's code loads into memory"* is strictly enforced by `ui/js/boot.js`. Boot settings are parsed synchronously before DOM rendering, dynamically appending `<link rel="stylesheet" href="css/skin-${activeSkin}.css">`. Skin-specific scripts (such as `fx-crazy.js` and `pet-crazy.js`) are appended exclusively when `activeSkin === 'crazy'`. Skin transitions execute via `window.location.replace(...)`, completely purging inactive skin stylesheets and JS runtime memory.
3. **WebGL Globe Architecture**: The 3D Earth globe (`ui/js/globe.js`) is a zero-dependency, hand-crafted WebGL sphere (1,189 vertices, 6,720 indices). It strictly honors eco rules: capped at 30 FPS via timestamp pacing, pauses immediately upon `document.hidden`, handles WebGL context loss and recovery, and falls back to a static pre-rendered image when `effects_intensity <= 0` or on WebGL failure.
4. **Readiness for R5, R6, R7**: The codebase possesses clear modular seams to accommodate the upcoming requirements:
   - **R5**: Softer Dark skin (muted palettes, 1px low-contrast borders, double shadows, 1.5px search outline) and Mayank White skin (neumorphic surfaces, floating pill address bar, 30 FPS wind lines, weather orb).
   - **R6**: Modular background registry with a standard `mount`/`pause`/`resume`/`destroy` lifecycle, strict eco rules (30 FPS cap, 10 FPS idle freeze after 60s, single WebGL context constraint), and the Night Globe upgrade (20% size increase, R8 4096x2048 texture, twilight shader).
   - **R7**: Customizable launch cards with 3-6 capacity, drag-and-drop reordering, JSON import/export, preset configs, and safe local application execution with allowlist verification.

---

## 1. Frontend Codebase & Styling Architecture Map

### 1.1 Directory Structure
```
d:\browser\ui\
├── IPC_CONTRACT.md              # Bidirectional JSON protocol specification
├── index.html                   # Main browser shell (header, tabs, viewport, panels)
├── newtab.html                  # New Tab Page (NTP) dashboard
├── assets\
│   ├── README.txt               # Asset attribution and replacement guidelines
│   ├── logo.svg                 # Rusty Browser vector logo (28x28)
│   ├── earth-day.webp           # 2048x1024 procedural Earth day map (PLACEHOLDER)
│   ├── earth-night.webp         # 2048x1024 procedural Earth night lights map (PLACEHOLDER)
│   └── earth-fallback.webp      # 512x512 static pre-rendered Earth orb (PLACEHOLDER)
├── css\
│   ├── base.css                 # Base layout, typography, CSS Houdini @property, primitives
│   ├── themes.css               # 8 color themes (:root, [data-theme="..."])
│   ├── newtab.css               # NTP 3-column grid, widgets, speed dial, cards
│   ├── skin-crazy.css           # Crazy skin: 3D pop, glassmorphism, spring physics, conic glow
│   └── skin-minimal.css         # Minimal skin: flat surfaces, 1px borders, zero blur/shadows
└── js\
    ├── boot.js                  # Early boot: synchronous settings read & active skin injection
    ├── icons.js                 # Zero-dependency SVG icon sprite generator (Icons.get)
    ├── bridge.js                # Bidirectional IPC bridge with standalone MOCK mode
    ├── settings.js              # SettingsStore: localStorage sync & IPC broadcasting
    ├── engines.js               # Search engines definition, templates, outline styles
    ├── locations.js             # Offline timezone centroid and country coordinate lookups
    ├── chrome.js                # Top chrome UI controller: tabs, omnibox, split view, modals
    ├── newtab.js                # NTP controller: search, dials, action cards, widgets
    ├── globe.js                 # Zero-dependency WebGL 3D globe & country raycaster
    ├── fx-crazy.js              # Crazy skin effects: spotlight, 3D tilt, magnetic drift, canvas
    └── pet-crazy.js             # Crazy skin companion pet state machine & modular SVGs
```

### 1.2 Layout & DOM Structure Breakdown

#### A. Main Application Shell (`ui/index.html`)
- **Header (`#chrome-header`)**:
  - Navigation controls (`#btn-back`, `#btn-forward`, `#btn-reload`, `#btn-toggle-tabs`).
  - Omnibox (`.omnibox-wrapper`): security lock badge, text input, reader mode toggle, bookmark star button.
  - Action utilities (`.actions-group`): Find in Page, Bookmarks/History/Downloads panel triggers, Split View toggle (`#btn-split-view`), Zen Focus mode (`#btn-zen`), Settings (`#btn-settings`), live RAM counter badge (`#memory-badge`), Command Palette trigger (`#btn-palette`).
- **Find in Page Bar (`#find-bar`)**: Collapsible search bar pushing viewport down, case-sensitive toggle, match counter.
- **Horizontal Tab Strip (`#tabs-horizontal`)**: Drag-and-drop tab items, new tab `+` button, audio indicators, tab close buttons.
- **Workspace Body (`#body-container`)**:
  - Vertical Tab Sidebar (`#tabs-sidebar`): Expandable/collapsible sidebar for vertical tab management.
  - Content Viewport (`#content-viewport`): Native WebView2 child viewport anchor (or mock `iframe` in standalone browser preview). Hosts Split View controls bar (`#split-controls-bar`) and dual panes.
  - Side Panel (`#side-panel`): Slide-out drawer for Bookmarks, History, and Downloads.
- **Modals & Overlays**:
  - Command Palette (`#command-palette-modal`): Fuzzy search across tabs, actions, skins, themes, workspaces.
  - Settings Modal (`#settings-modal`): General, Appearance, Performance, Privacy, and About configuration tabs.
  - Memory Breakdown Modal (`#memory-modal`): Detailed process tree table (Host, Renderers, GPU, Utility).
  - Tab Context Menu (`#tab-context-menu`): Right-click context actions (mute, pin, duplicate, group, close others/below).

#### B. New Tab Page Dashboard (`ui/newtab.html`)
- **3-Column Grid (`.ntp-shell`)**:
  - **Left Rail (`.ntp-left-rail`)**:
    - Quick navigation dock (8 icon buttons: Home, Apps, Workspaces, AI, Bookmarks, History, Downloads, Settings).
    - Workspaces list (`.workspaces-list`): Main, College, Projects, Media, Games chips + Add Workspace button.
    - Companion Pet Rail Slot (`#left-rail-bottom-slot`): Hosts Crazy skin pet module (hidden in Minimal).
  - **Center Stage (`.ntp-center`)**:
    - Brand Hero (`#brand-hero`): Logo SVG, title, tagline ("Browse • Create • Focus • Automate").
    - Search Section (`.search-section`): Search box with dynamic search engine color outline, AI prompt shortcut, search engine chips row (Google, DuckDuckGo, Bing, Brave, YouTube, GitHub, Custom).
    - Speed Dial Grid (`#speed-dial-grid`): Custom pills with letter avatars, favicon support, and add button.
    - Action Cards Grid (`.action-cards-grid`): 4 bottom quick-access cards (Quick Search, Command Palette, Media Hub, Customize UI).
  - **Right Rail (`.ntp-right-rail`)**:
    - Merged Time & Weather Card (`#widget-time-weather`): Digital clock, current conditions, temperature, and 3D globe slot (`#globe-slot`). Expandable drawer for 5-day forecast, world clocks, city search, cloud toggle.
    - Quick Notes (`#widget-notes`): Interactive checklist + freeform scratchpad textarea.
    - Focus Timer (`#widget-focus`): Pomodoro timer with Study/Work/Deep modes, countdown display, play/reset controls.
    - System Monitor (`#widget-monitor`): Live OS CPU & GPU SVG sparklines, RAM usage bar, browser private WS counter, network speed.

### 1.3 CSS Architecture & Design Token System
The CSS styling is structured into four distinct layers:
1. **Primitives & Base (`css/base.css`)**: Defines CSS Houdini `@property` custom properties for smooth color transitions, dimensions (`--header-height: 40px`, `--sidebar-width: 240px`), font stacks, and z-index layers.
2. **Themes (`css/themes.css`)**: 8 global color themes defined on `:root` and `[data-theme="..."]`:
   - `midnight` (dark navy matching default UI)
   - `light` (clean white/slate)
   - `amoled` (pure `#000000` for OLED displays)
   - `aurora` (deep teal & emerald)
   - `cyberpunk` (neon yellow, magenta & cyan)
   - `sunset` (warm twilight, tangerine & rose)
   - `matcha` (forest sage & soothing green)
   - `sakura` (blossom plum & soft rose)
3. **Skins**:
   - `skin-crazy.css`: Loaded only when `data-skin="crazy"`. Heavy 3D pop, spring bezier curves (`cubic-bezier(0.34, 1.56, 0.64, 1)`), glassmorphism with `backdrop-filter: blur(18px)`, spotlight glow, and conic keyframe glows.
   - `skin-minimal.css`: Loaded only when `data-skin="minimal"`. Strict flat aesthetic, 1px low-contrast borders (`var(--border-subtle)`), zero box-shadows, zero `backdrop-filter`, and CSS transitions strictly capped at 100ms color fades.
4. **NTP Dashboard (`css/newtab.css`)**: Comprehensive layout rules, responsive breakpoints (`@media (max-width: 1200px)` and `@media (max-width: 980px)`), widget styling, and speed-dial squircle layouts.

---

## 2. Mock Bridge Preview Runner Inspection

### 2.1 How the Mock Bridge Operates
The mock bridge is implemented inside `ui/js/bridge.js` (lines 6-67, 109-579).
- **Auto-Detection**: It detects the runtime environment at boot:
  ```javascript
  const isRealIpc = typeof window.ipc !== 'undefined' && typeof window.ipc.postMessage === 'function';
  ```
- **Mock State Store**: In mock mode (`Bridge.isMock === true`), it instantiates an in-memory database of mock tabs (4 tabs: New Tab, GitHub, Rust Lang, YouTube), tab groups, bookmarks, history, downloads, memory stats (simulating 5 processes: Host, WebView2 Manager, GPU, Renderer, Network), and Split View state.
- **Chrome Mock Viewport Handling (`ui/js/chrome.js:1896-1940`)**:
  When `window.bridge.isMock === true` and `index.html` loads in an ordinary browser, `chrome.js` dynamically creates an `<iframe>` inside `#content-viewport` and points it to:
  ```
  newtab.html?skin=${encodeURIComponent(skin)}&theme=${encodeURIComponent(theme)}
  ```
  This creates a fully functional, interactive browser simulator inside any standard desktop browser without needing Rust or WebView2!

### 2.2 Empirical Verification: Zero Console Errors
To empirically verify the mock bridge runner and validate acceptance criteria, we executed a headless Chrome/Edge DevTools Protocol (CDP) test script (`test_mock_bridge.mjs`) on Edge 157.0.4341.42 against an HTTP server serving `ui/`:

| Page / Scenario Tested | URL | Runtime State Verified | Console Logs | Uncaught Exceptions | Status |
|---|---|---|---|---|---|
| `index.html` (Crazy Skin) | `http://127.0.0.1:8976/index.html?skin=crazy` | `isMock: true`, `skin: crazy`, 8 tabs rendered, iframe initialized | 2 mock info notices | **0 exceptions** | **PASS** |
| `index.html` (Minimal Skin) | `http://127.0.0.1:8976/index.html?skin=minimal` | `isMock: true`, `skin: minimal`, 8 tabs rendered, flat surfaces | 2 mock info notices | **0 exceptions** | **PASS** |
| `newtab.html` (Standalone Crazy) | `http://127.0.0.1:8976/newtab.html?skin=crazy` | `isMock: true`, WebGL globe active, 2 textures loaded, RAF active | 1 mock info notice | **0 exceptions** | **PASS** |
| `newtab.html` (Standalone Minimal) | `http://127.0.0.1:8976/newtab.html?skin=minimal` | `isMock: true`, WebGL globe active, constellation canvas disabled | 1 mock info notice | **0 exceptions** | **PASS** |

**Total Uncaught Exceptions across all configurations: 0.**  
The mock bridge runner satisfies all functional and error-free execution requirements.

---

## 3. Skin Architecture & Memory Invariant Verification

### 3.1 The Invariant
> **Core Invariant**: "Only the active skin's code loads into memory."

### 3.2 How `boot.js` Enforces the Invariant
In `ui/js/boot.js`:
1. **Synchronous Boot Execution**:
   - `boot.js` is placed at the top of `<head>` before any body markup.
   - It reads settings synchronously from `localStorage` (`rusty_browser_settings_v4`) and parses URL parameters (`?skin=...`).
   - It applies `data-skin`, `data-theme`, `data-tabs` attributes to `document.documentElement` **before** the DOM begins rendering, ensuring **zero Flash of Unstyled Content (FOUC)**.
2. **Selective CSS Injection (`ui/js/boot.js:126-131`)**:
   ```javascript
   const head = document.head || document.getElementsByTagName('head')[0];
   const skinCssLink = document.createElement('link');
   skinCssLink.rel = 'stylesheet';
   skinCssLink.href = `css/skin-${activeSkin}.css`;
   head.appendChild(skinCssLink);
   ```
   Notice that `skin-crazy.css` is NEVER added to the DOM when `activeSkin === 'minimal'`.
3. **Selective JS Injection (`ui/js/boot.js:133-146`)**:
   ```javascript
   if (activeSkin === 'crazy') {
     const fxScript = document.createElement('script');
     fxScript.src = 'js/fx-crazy.js';
     fxScript.defer = true;
     fxScript.async = false;
     head.appendChild(fxScript);

     const petScript = document.createElement('script');
     petScript.src = 'js/pet-crazy.js';
     petScript.defer = true;
     petScript.async = false;
     head.appendChild(petScript);
   }
   ```
   When `activeSkin === 'minimal'`, neither `fx-crazy.js` (378 lines) nor `pet-crazy.js` (1,303 lines) are inserted into the DOM. Their scripts are never parsed, their listeners are never registered, and their objects never consume memory.
4. **Clean Navigation on Skin Switch (`ui/js/boot.js:149-179`)**:
   When `window.switchSkin(newSkin)` is invoked:
   ```javascript
   window.switchSkin = function (newSkin) {
     // ... updates settings ...
     window.__isSwitchingSkin = true;
     const nextUrl = new URL(window.location.href);
     nextUrl.searchParams.set('skin', newSkin);
     setTimeout(() => {
       window.location.replace(nextUrl.toString());
     }, 25);
   };
   ```
   Calling `window.location.replace()` forces the browser engine to tear down the entire JS environment, unload all script contexts, free all DOM nodes and listeners, and reboot cleanly. The new page loads with only the targeted skin's stylesheet and scripts.

---

## 4. WebGL Canvas, 3D Globe & Rendering Loop

### 4.1 Implementation Architecture (`ui/js/globe.js`)
The 3D globe in `#globe-slot` is a custom WebGL sphere implementation:
- **Sphere Mesh Generation (`createSphereGeometry(28, 40)`)**:
  - Latitude bands: 28, Longitude bands: 40.
  - Generates 1,189 vertices (interleaved `[x, y, z, u, v]`, 23.8 KB) and 6,720 triangle indices (13.4 KB).
  - Clean memory allocation using `Float32Array` and `Uint16Array`.
- **Shaders**:
  - **Vertex Shader (`VS_SRC:326-359`)**: Transforms positions by Longitude and Latitude rotation angles, applies perspective projection `gl_Position = vec4(p2.x / denom, p2.y / denom, ndcZ, 1.0)`.
  - **Fragment Shader (`FS_SRC:361-437`)**: Samples Day and Night textures, computes dynamic sun direction vector based on UTC day-of-year and UTC hour, blends day/night with smoothstep, adds a golden twilight terminator band, applies optional procedural FBM clouds, and computes Fresnel atmosphere rim.
- **Eco Rules & Throttling**:
  - **FPS Capping**: `TARGET_FPS_MS = 1000 / 30`. Loop checks `nowMs - lastDrawMs >= TARGET_FPS_MS` to strictly cap rendering at 30 FPS.
  - **Visibility Awareness**: `visibilitychange` listener cancels `requestAnimationFrame` when `document.hidden === true`.
  - **Idle Auto-Recenter**: Returns smoothly to the user's home location after 10s of inactivity.
  - **Low-Power Context**: Created with `powerPreference: 'low-power'`.
  - **Clean Unload**: Disposes WebGL buffers, textures, program, and forces context release via `WEBGL_lose_context` on `pagehide` and `beforeunload`.

### 4.2 Texture Sizes & Memory Calculations
Currently, the globe utilizes two 2048x1024 WebP textures:
- `earth-day.webp` (RGBA8, 2048 x 1024 x 4 bytes = 8.39 MB uncompressed in GPU memory)
- `earth-night.webp` (RGBA8, 2048 x 1024 x 4 bytes = 8.39 MB uncompressed in GPU memory)
- Total current GPU texture allocation: ~16.78 MB.

### 4.3 Analysis of the Single WebGL Context Rule
In the current codebase:
- Globe uses WebGL (`ui/js/globe.js`).
- Constellation background uses Canvas 2D (`ui/js/fx-crazy.js`).
- Total WebGL contexts active in `newtab.html`: **Exactly 1**.

For R6, when interactive background modules (such as WebGL Fluid Ink) are introduced, having multiple WebGL contexts creates severe memory overhead and increases process crash risks on low-end GPUs.
**Architectural solution for Single WebGL Context**:
A centralized `WebGLCanvasManager` service should own a single canvas element. When an interactive 3D background is active:
- It renders the background full-screen in viewport `[0, 0, width, height]`.
- It renders the 3D globe into `#globe-slot` using `gl.viewport(slotX, slotY, slotW, slotH)` and `gl.scissor(...)`.
- Alternatively, when a WebGL background is active, the globe can switch to the high-quality pre-rendered static fallback or weather orb, maintaining exactly one active WebGL context at all times.

---

## 5. Architectural Requirements & Blueprint for R5, R6, and R7

### 5.1 R5: Visual Skins — Softer Dark & Mayank White

#### 5.1.1 Softer Dark Skin Specification
- **Design Intent**: Eliminate all jarring neon glow, oversaturated bloom, and harsh contrast, replacing them with refined, muted ergonomics for prolonged daily-driver use.
- **Color Palettes (4 Variants)**:
  1. **Graphite**: Neutral charcoal surfaces (`#18181b`, `#27272a`), muted silver borders (`#3f3f46`), cool gray accents (`#94a3b8`).
  2. **Slate**: Deep slate navy (`#0f172a`, `#1e293b`), soft slate borders (`#334155`), muted ice blue accents (`#60a5fa`).
  3. **Mocha**: Warm roasted coffee (`#1c1917`, `#292524`), warm sepia borders (`#44403c`), muted warm amber accents (`#d97706`).
  4. **Midnight Blue**: Subdued midnight (`#090d16`, `#111827`), soft indigo borders (`#1f2937`), muted royal blue accents (`#3b82f6`).
- **Surface Elevation & Shadows**:
  - 1px low-contrast borders: `border: 1px solid rgba(255, 255, 255, 0.08)`.
  - Double shadows: Subtle top-left highlight + deep bottom-right shadow:
    ```css
    box-shadow: -1px -1px 1px rgba(255, 255, 255, 0.04), 2px 2px 8px rgba(0, 0, 0, 0.35);
    ```
  - Pressed/active states: `box-shadow: inset 1px 1px 3px rgba(0, 0, 0, 0.5);`.
- **Search Bar Outline**:
  - 1.5px muted outline with subtle engine color tint (`border: 1.5px solid var(--engine-color-muted)`), zero bloom or pulsating glow.
- **File Structure**:
  - `ui/css/skin-softer-dark.css`: Pure stylesheet for `[data-skin="softer-dark"]`.
  - Register in `src/ui/app_protocol.rs` and `ui/js/boot.js`.

#### 5.1.2 Mayank White Skin Specification
- **Design Intent**: Elegant, light neumorphic daily-driver layout inspired by modern soft 3D UI principles.
- **Layout Architecture**:
  - **Top Bar**: Floating pill address bar centered at top; active tabs clustered at top-left; downloads/bookmarks/notifications and window controls grouped at top-right.
  - **Left Rail**: Neumorphic card containing icon dock buttons, Workspaces list with active blue-dot pill indicator, "Add a space" button, and brand/version chip.
  - **Center Hero**: 3D logo tile, title, tagline flanked by decorative horizontal lines, search bar with camera/mic/arrow icons, engine chips, shortcut tiles, and 4 launch cards.
  - **Right Column**: Widgets card (Time & Weather / Weather Orb, Quick Notes with input, Focus mode, System Monitor with uptime and version).
  - **Bottom Dock**: Floating pill dock centered at bottom; floating search button at bottom-right.
- **Neumorphism & Materials**:
  - Base surface color: `#eef2f8` to `#f7f9fc`.
  - Corner radii: Generous `24px` to `32px` on cards, full pill radius on search and dock.
  - Double Neumorphic Shadows:
    ```css
    box-shadow: -5px -5px 12px rgba(255, 255, 255, 0.95), 5px 5px 14px rgba(166, 180, 200, 0.45);
    ```
  - Pressed button states: Inset dual shadows (`box-shadow: inset 2px 2px 5px rgba(166, 180, 200, 0.5), inset -2px -2px 5px #ffffff`).
  - Primary button: Glossy 3D blue gradient (`linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)`) with soft outer glow.
- **Wind Lines Pillar**:
  - Crisp-edged curved swoosh shapes with thin glowing blue edges drifting slowly like wind across the canvas.
  - Implemented as canvas or SVG animated strictly using `transform: translate3d(...)` at a **30 FPS cap**.
  - Parallax mode reacting subtly to mouse position.
- **Weather Orb Pillar**:
  - Replaces 3D globe slot inside `#globe-slot`.
  - Dynamically renders weather states: floating volumetric cloud layers, animated radiant sun with corona rays, or crescent moon with starry night glow.
  - Click toggle to flip between Weather Orb and Daylight Earth view.
- **Performance Guardrails**:
  - Avoid `backdrop-filter` in light mode (reduces GPU raster load).
  - Limit shadow blur radii to under 16px to maintain high paint framerates.
  - Only `skin-mayank.css` and `skin-mayank.js` load into memory when Mayank skin is active.

---

### 5.2 R6: Interactive Modular Background Registry & Night Globe Upgrade

#### 5.2.1 Modular Background Registry Architecture
- **Lifecycle Interface**:
  Every background module conforms to a strict contract:
  ```typescript
  interface BackgroundModule {
    id: string;
    name: string;
    category: 'abstract' | 'nature' | 'retro' | 'ambient';
    estimatedRamMb: number;
    estimatedCpuPercent: number;
    mount(container: HTMLElement, ctx: RegistryContext): void;
    pause(): void;
    resume(): void;
    destroy(): void;
  }
  ```
- **Lazy Loading**:
  Only the active background's script is dynamically imported. Inactive modules remain on disk.
- **Catalog of 19 Backgrounds**:
  1. `constellation`: Interactive particle network with distance-based connective lines (Canvas 2D).
  2. `aurora`: Waving atmospheric green/violet curtains (Fragment shader / Canvas).
  3. `fluid-ink`: WebGL cursor-stirred Navier-Stokes smoke/ink simulation.
  4. `gradient-blobs`: Morphing soft organic SVG/Canvas color blobs.
  5. `starfield-warp`: Hyperspace perspective star streaks with velocity control.
  6. `rain-on-glass`: Refractive procedural raindrops dripping down pane.
  7. `sakura-snow`: Gentle drifting cherry blossom petals or snowflakes.
  8. `fireflies`: Warm glowing particles with organic wander routines.
  9. `synthwave-grid`: Perspective 80s neon grid scrolling into distant wireframe sun.
  10. `ocean-waves`: Layered sine-wave ocean swells with crest foam.
  11. `lava-lamp`: Rising and merging metaballs.
  12. `wind-lines`: Swooshing glowing streamlines (shared with Mayank skin).
  13. `soft-clouds`: Drifting layered cumulus clouds.
  14. `bokeh-light`: Defocused floating luminous circles.
  15. `water-ripples`: Mouse-click wave propagation and caustic reflections.
  16. `gradient-mesh`: Smooth multi-point gradient interpolation.
  17. `solid-gradient`: Static CSS linear/radial gradient (0% CPU, 0 MB extra RAM).
  18. `user-media`: User-supplied local image or video (strictly capped at 720p, paused when tab is hidden).
  19. `time-of-day`: Automatically switches between morning sunrise, afternoon clear, golden hour, and midnight aurora based on system clock.
- **Eco Rules**:
  - Hard cap at 30 FPS (`TARGET_FPS_MS = 1000 / 30`).
  - Pause rendering when `document.hidden === true`.
  - Drop from 30 FPS to 10 FPS (or complete freeze) after 60 seconds of user idle.
  - Check `navigator.getBattery()`: automatically drop to low-power or static mode if discharging below 20%.
  - Respect `prefers-reduced-motion`: freeze all animations immediately.
  - Single WebGL Context constraint strictly observed.

#### 5.2.2 Night Globe Upgrade Specification
- **Size Increase**: Increase `#globe-slot` diameter by 20% from 128px to **154px** via CSS variable `--globe-size: 154px;`.
- **R8 Single-Channel 4096x2048 Night Texture**:
  - Convert night lights to single-channel 8-bit luminance (R8).
  - VRAM Consumption:
    $$\text{Base Size} = 4096 \times 2048 \times 1\text{ byte} = 8,388,608\text{ bytes} \approx 8.39\text{ MB}$$
    $$\text{With Mipmaps } (\times 1.333) = 11.18\text{ MB}$$
    This matches the exact ~11 MB GPU memory requirement!
  - Contrast with standard RGBA8 4096x2048 which would consume 44.7 MB (a 75% memory savings).
- **Twilight & Atmosphere Shader**:
  - Warm sodium vapor tint applied in fragment shader to R8 night lights: `vec3(1.0, 0.78, 0.42) * nightLights`.
  - Soft twilight band along day/night terminator:
    ```glsl
    float terminator = exp(-pow((sunDot - 0.01) * 8.0, 2.0));
    earthCol += vec3(0.62, 0.28, 0.08) * terminator * 0.45;
    ```
  - Anisotropic filtering enabled via `EXT_texture_filter_anisotropic` (`maxAniso = gl.getParameter(ext.MAX_TEXTURE_MAX_ANISOTROPY_EXT)`).
- **GPU / RAM Benchmark Comparison**:

| Texture Resolution | Color Format | Raw Texture Size | Mipmapped GPU VRAM | Visual Quality | Target Hardware |
|---|---|---|---|---|---|
| 2048 x 1024 | RGBA8 | 8.39 MB | 11.18 MB | Baseline | Low-end / Integrated GPUs |
| **4096 x 2048 (R6 Target)** | **R8 (Single-Channel)** | **8.39 MB** | **11.18 MB** | **Ultra Crisp High-DPI** | **Standard Laptops & Desktops** |
| 8192 x 4096 (Ultra) | R8 (Single-Channel) | 33.55 MB | 44.74 MB | Extreme Detail | Dedicated High-VRAM GPUs (>4 GB) |

- **Asset Verification**: NASA public domain Black Marble / Earth Observatory night imagery placed in `ui/assets/earth-night.webp` with documented PLACEHOLDER comment.

---

### 5.3 R7: Customizable Launch Cards

#### 5.3.1 Launch Card Architecture
Currently, `ui/newtab.html` hardcodes 4 static cards (Quick Search, Command Palette, Media Hub, Customize UI).
R7 transforms these into dynamic, user-customizable launch pads:
- **Card Capacity**: Dynamic grid supporting **3 to 6 cards** (default: 4).
- **Data Model Schema**:
  ```json
  {
    "id": "card_dev_studio",
    "title": "Dev Studio",
    "desc": "Launch VS Code + Localhost + Docs",
    "icon": "code",
    "color": "#3b82f6",
    "hotkey": "Alt+1",
    "actions": [
      { "type": "open_urls", "urls": ["http://localhost:3000", "https://github.com"], "group": "Dev" },
      { "type": "open_workspace", "workspace": "projects" },
      { "type": "command_palette", "command": "toggle_vertical_tabs" },
      { "type": "launch_app", "executable": "C:\\Program Files\\Microsoft VS Code\\Code.exe", "args": ["d:\\browser"] }
    ]
  }
  ```
- **Edit Mode & Interaction**:
  - Drag-and-drop reordering using HTML5 Drag & Drop API (`draggable="true"`).
  - Inline edit modal: title, description, icon picker (using `window.Icons.list()`), and action sequence builder.
  - JSON Import / Export: Easily back up or share card decks via JSON clipboard or file download.
  - Hotkey Triggers: `Alt+1` through `Alt+6` fire card actions instantly.

#### 5.3.2 Built-In Presets
1. **Stream Hub**: Launches streaming workspace, opens Twitch Creator Dashboard + YouTube Studio in a tab group, triggers OBS executable.
2. **Study**: Switches to Study workspace, opens Notion + Google Docs, starts Focus mode 25-minute timer.
3. **Dev**: Opens GitHub + Stack Overflow, launches VS Code and local development server tab.
4. **Creator**: Opens Blender + Figma + asset repository, sets display density to relaxed.

#### 5.3.3 IPC & Security Model for Local App Execution
To satisfy security invariants:
- **No Shell Execution**: Local applications are executed directly via `std::process::Command::new(executable).args(args)` in Rust. Shell strings (`cmd.exe /c` or `/bin/sh -c`) are strictly banned to prevent command injection.
- **Allowlist & Confirmation Modal**:
  - Rust verifies the executable path against an allowlist stored in `Settings`.
  - First-time launches trigger a native confirmation modal asking:  
    *"Rusty Browser: Allow launching '{exe_name}' with args {args}? [Allow Once] [Always Allow] [Block]"*.
- **Typed IPC Message**:
  - `{"action": "launch_local_app", "executable": string, "args": string[]}` added to `UiMessage` in `src/main.rs` and documented in `IPC_CONTRACT.md`.

---

## 6. Verification Method

To independently verify all findings in this survey:
1. **Mock Bridge Runner Clean Execution**:
   Run the headless Edge CDP test script from powershell:
   ```powershell
   node d:\browser\.agents\teamwork\explorer_survey_2\test_mock_bridge.mjs
   ```
   Confirm output displays `Total Uncaught Exceptions across all pages: 0` and `Evaluated State: { isMock: true, ... }`.
2. **Skin Invariant Verification**:
   Inspect `d:\browser\ui\js\boot.js` lines 126-146 to verify dynamic stylesheet and script injection.
   Run `test_mock_bridge.mjs` and observe that `index.html?skin=minimal` reports `skin: minimal` with zero references to `fx-crazy.js` or `pet-crazy.js`.
3. **Rust Embedded Assets Registry**:
   Inspect `d:\browser\src\ui\app_protocol.rs` lines 10-80 to verify that all UI assets are embedded via `include_bytes!` and mapped to `rusty://app/`.
4. **3D Globe WebGL Loop**:
   Inspect `d:\browser\ui\js\globe.js` lines 13-15 and 724-741 to verify 30 FPS capping and `document.hidden` visibility pause.

---

## 7. Conclusion

The Rusty Browser frontend architecture is exceptionally clean, robust, and performant. It operates without external runtime dependencies, adheres strictly to memory-saving invariants, provides a flawless mock preview mode, and offers well-structured integration points for Milestones R5, R6, and R7.
