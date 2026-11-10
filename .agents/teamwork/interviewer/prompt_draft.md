Continuing development of Rusty Browser (Rust, tao + wry; currently Windows 11 + WebView2) for production daily-driver use, executing all milestones R0 through R9 sequentially in specified order, verifying each milestone before proceeding.

Working directory: d:\browser
Integrity mode: development

## Verification Resources
- RAM measurement scripts: `benchmark.ps1`, `verify_memory.ps1`
- CI configuration for cross-platform validation: GitHub Actions workflow (`.github/workflows/`) building and testing Windows and Linux
- UI mockup reference specifications: `ui/` directory stylesheets and assets
- NASA public domain imagery slot for high-resolution night globe texture

## Requirements

### Scope & Invariant Rules
- Execute milestones sequentially in the defined order (R0 through R9).
- Maintain all core invariants throughout:
  - Only the active skin's code loads into memory.
  - Typed IPC communication across rusty://app/ origin only.
  - Mock bridge preview runs cleanly without console errors.
  - PLACEHOLDER comments for all user-supplied assets.
  - Never copy real brand logos (use favicons from Rust or letter avatars).
  - Honest security limits (never claim "infostealer-proof").
  - Preserve earlier security capabilities (V1 ad blocker, V2 VPN/proxy, V3 vault, V4 session protection).
  - If anything is impossible or unwise, state so clearly and propose an alternative instead of faking it.
  - If code or assets are copied or adapted from any external source, explicitly report what was copied and where from in the final milestone documentation.
  - Provide complete files with no truncated "...rest of code" blocks.

### R0. Baseline Measurement & Platform Layer Abstraction
- Measurement & reconciliation: Produce a process-tree breakdown table (browser, each renderer, GPU, utility, UI webview, Rust shell) using private working set on Windows and PSS from `/proc/<pid>/smaps_rollup` on Linux across 5 states: empty window, new tab page per skin, 5 tabs, 10 tabs, split view. Reconcile the in-browser badge against Windows Task Manager and rank top consumers. Ensure reproducible via script.
- Platform layer trait: Isolate all WebView2 and WebKitGTK specific calls behind a unified platform trait covering webview lifecycle (create, destroy, show, hide, suspend, discard), layout/bounds, request blocking/interception, proxy configuration, cookie management, and memory statistics.

### R1. Workspaces
- State owned by Rust: open tabs (URL, title, favicon, scroll position, pinned status, tab group, back/forward history where feasible), name, icon, color, theme/background, default engine, optional Focus mode link.
- Only the active workspace has live webviews; switching persists current tab state and restores the target workspace's tabs while destroying webviews of inactive workspaces.
- Crash-safe persistence (temp file + atomic rename, debounced), restore on launch, recently closed tabs per workspace, create/rename/reorder/delete with undo, move tab across workspaces (context menu or drag to rail), Ctrl+Alt+1..9 hotkeys, tab-count badge per workspace.
- Optional isolated workspace with dedicated cookie store/profile, with documented and measured RAM cost.

### R2. RAM Optimization Pass
- Background tabs: invoke `TrySuspend` and set `MemoryUsageTargetLevel = Low` via raw WebView2 handles, discarding after N minutes of inactivity. Destroy webviews for non-active workspaces.
- Renderer process count: evaluate flags such as `--renderer-process-limit`, presenting savings vs security trade-offs (no silent enablement).
- UI webview & NTP: single WebGL context, release canvases (width=0) and textures when hidden, virtualized lists, bounded DOM, avoid gratuitous `will-change`, limit `backdrop-filter`, cap history and search suggestions, store no full-size thumbnails or favicons in memory, resolve listener and timer leaks.
- Rust allocator & subsystems: remove unnecessary clones, lazy-initialize subsystems, evaluate mimalloc (and jemalloc on Linux) against default allocator.
- Lite mode toggle: Minimal skin + no background + no globe + no pet. Add per-feature RAM budget table in Settings.

### R3. Linux Platform Support
- Platform layer implementation on Linux using wry on WebKitGTK 4.1 via the GTK path (`build_gtk` with a `gtk::Fixed` container) supporting X11 and Wayland. Custom title bar, dragging, and window controls operational on both.
- Replace Windows-specific facilities: XDG data paths via `directories` crate, Secret Service via `keyring` crate instead of DPAPI, memory telemetry via PSS from `/proc/<pid>/smaps_rollup` across process tree (WebKitWebProcess, WebKitNetworkProcess), GPU % via sysfs/NVML with graceful "n/a".
- Ad blocker on Linux: convert filter lists to WebKit content-blocking rules (`adblock-rust`) installed via `WebKitUserContentFilterStore`. Enforce cosmetic filtering through injected CSS. Document known limitations compared to Windows request interception.
- VPN on Linux: userspace WireGuard + local SOCKS5 proxy configuration applied through wry/WebKit proxy settings without root requirement. Verify kill switch, DNS leaks, and WebRTC leak prevention.
- Packaging: AppImage and .deb (via `cargo-deb`), optional Flatpak. GitHub Actions CI workflow building Windows and Linux. Document required system packages and NVIDIA/Wayland workarounds in README.

### R4. Focus Mode & YouTube Restrictor
- Modes (Study, Work, Deep) linked to Focus timer widget and workspaces (e.g. College workspace = Study).
- Site blocking by category with toggles and custom lists (social, short-form video, games) enforced in Rust navigation handler + new-window handler, accompanied by injected JS history hooks (`pushState`/`replaceState`/`popstate`, plus `SourceChanged` on Windows).
- Calm interstitial page displaying reason, remaining time, and options (go back, allow 5 min countdown, end focus). Strict mode requires 60s delay or confirmation phrase to end early. Scheduled breaks automatically relax rules.
- YouTube Study filter (client-side, best effort):
  - Remove Shorts: hide shelves and tabs, redirect `/shorts/ID` to `/watch?v=ID`.
  - Remove recommendations: hide home feed (replace with Study home: search box + selected playlists/channels), watch-page sidebar suggestions, end-screen suggestions, autoplay.
  - Educational-only watch gate: read video category from `playerMicroformatRenderer.category` and allow only approved categories (default: Education, Science & Technology, Howto & Style) plus channel allowlist; non-approved videos display interstitial. Search results hide matches against keyword and channel blocklists.
  - Selectors and rules maintained in an editable data file, with documented gaps (uploader miscategorization, DOM changes).
- Daily stats: focused minutes, blocked attempts, streak.

### R5. Visual Skins: Softer Dark & Mayank White
- Softer Dark Skin: eliminate neon glow, bloom, and saturated accents. Implement muted warm/cool accents, soft layered gradients, 1px low-contrast borders, and soft double shadows (subtle top-left highlight + deep bottom-right shadow) on search bar, widgets, tiles, and buttons (pressed state = inset shadow). 1.5px muted search outline. Provide 4 soft dark palettes (Graphite, Slate, Mocha, Midnight Blue) plus accent picker.
- Mayank Skin (White UI):
  - Layout: floating pill address bar centered at top; tabs at top-left; download/bookmark/notification and window controls at top-right; left rail card (icon buttons, Workspaces list with blue-dot active pill, "Add a space", brand + version chip); center hero (3D logo tile, title, tagline with side lines, search with camera/mic/arrow, engine chips, shortcut tiles, 4 launch cards); right column (Time & Weather, Quick Notes with input, Focus, System Monitor with uptime/version); bottom-center dock pill; bottom-right search button.
  - Two design pillars:
    (A) Soft 3D elements: light neumorphic surfaces (#eef2f8 to #f7f9fc, 24-32px radii, double shadows, glossy blue 3D primary button, pressed inset, active blue gradient with soft glow).
    (B) Wind lines: crisp-edged curved swoosh shapes with thin glowing blue edges drifting slowly like wind with subtle mouse parallax, built as SVG or canvas animated with transform only at 30 fps cap (optional cursor-bending mode).
  - Weather orb replacing globe slot (weather-reactive clouds, sun, moon), with toggle to switch to daylight Earth.
  - Performance: avoid `backdrop-filter`, limit shadow blur radii, report idle RAM/CPU compared to dark skin.

### R6. Interactive Modular Background Registry & Night Globe Upgrade
- Modular background registry: lazy-loaded modules with `mount`/`pause`/`resume`/`destroy` lifecycle; only the active background loaded. RAM/CPU estimates shown in picker. Static picker thumbnails; single live preview on hover.
- Background catalog: Constellation, Aurora, Fluid ink (WebGL cursor-stirred), Gradient blobs, Starfield warp, Rain on glass, Sakura/snow, Fireflies, Synthwave grid, Ocean waves, Lava lamp, Wind lines, Soft clouds, Bokeh light, Water ripples, Gradient mesh, solid/gradient, user image/video (720p cap, paused when hidden), time-of-day auto.
- Eco rules: 30 fps cap, pause when hidden, drop to 10 fps or freeze after 60s idle, auto-disable on battery saver, honor `prefers-reduced-motion`, low-RAM mode. Single WebGL context.
- Night globe upgrade: 20% size increase via `--globe-size` CSS variable. Single-channel R8 4096x2048 night-lights texture (~11 MB GPU) with mipmaps, anisotropic filtering, and warm shader tint. Optional Ultra 8192x4096 restricted to high-VRAM GPUs. Shader-only soft twilight band, atmosphere rim, night-side glow, drag-to-spin, 30 fps cap, pause when hidden. Public domain verified NASA imagery in PLACEHOLDER slot. Report GPU/RAM at 2048/4096/8192.

### R7. Customizable Launch Cards
- Bottom 4 launch cards: title, description, icon placeholder, and ordered action sequence (open URLs in tab group, open in workspace, execute command palette action, launch local app via executable path + args without shell strings, backed by allowlist and confirmation dialog).
- Edit mode: drag-and-drop reordering, 3 to 6 card capacity, JSON import/export, Alt+1..4 hotkeys. Presets for Stream Hub, Study, Dev, Creator. Default cards: Quick Search, Command Palette, Stream Hub, Customize UI.

### R8. Extensions & Userscripts
- Windows (WebView2): Enable browser extensions via raw handles (`AreBrowserExtensionsEnabled` / `AddBrowserExtension`). Test and document supported extension APIs. Extension manager UI: load unpacked folder or .crx/.zip, enable/disable/remove, permission inspection before activation. Extensions disabled by default in Secure-mode sites and vault workspace. No scraping of Chrome Web Store; licensing detailed in README.
- Linux (WebKitGTK): Provide userscripts (Tampermonkey-style) via `UserContentManager`, built-in content blocker, focus mode, and launch cards as Linux alternative to Chromium extensions.
- Update threat model documentation covering extension permissions and attack surface.

### R9. Final Cross-Platform Polish & Deliverables
- Comprehensive documentation:
  - README updated with Linux system dependencies and NVIDIA/Wayland workarounds.
  - Updated typed IPC schema contract.
  - Updated threat model covering Linux components and extensions.
  - Complete enumerated list of all PLACEHOLDER assets requiring user replacement.
  - Explicit list of any external open-source code or assets adapted, naming the source and components.
- Final benchmark: Re-run measurement suite across both Windows and Linux, confirming memory targets.

## Acceptance Criteria

### Performance & Memory Guardrails
- [ ] Minimal UI webview RAM under 60 MB.
- [ ] Crazy and Mayank UI webviews RAM under 120 MB at effects level 50.
- [ ] 10 open tabs consume at least 15% less RAM than Chrome on identical sites and metrics.
- [ ] All reported RAM figures are reproducible using the provided test scripts.

### Platform Support & Packaging
- [ ] Platform abstraction trait cleanly isolates all WebView2 and WebKitGTK specific operations.
- [ ] Application builds and runs on Windows 11 with WebView2.
- [ ] Linux build succeeds on WebKitGTK 4.1 with GTK container path, compatible with X11 and Wayland.
- [ ] Linux packaging scripts generate AppImage and .deb packages.
- [ ] GitHub Actions CI workflow builds and tests both Windows and Linux targets.

### Features & User Interface
- [ ] Workspaces maintain tab metadata in Rust, restoring tabs on switch and keeping live webviews only in the active workspace.
- [ ] Focus mode blocks configured categories and single-page app navigations in Rust and JS hooks.
- [ ] YouTube Study filter hides Shorts, replaces recommendations with Study home, and enforces category gate on watch page via editable config.
- [ ] Softer dark skin provides 4 muted palettes and 1.5px search outline without neon bloom.
- [ ] Mayank white skin implements neumorphic styling, wind lines animation at 30 fps, and weather orb.
- [ ] Background registry loads only the active background, enforces eco rules (30 fps cap, idle freeze, pause when hidden), and shares a single WebGL context.
- [ ] Night globe renders 20% larger using R8 4096x2048 texture with warm twilight shader.
- [ ] Launch cards support reordering, JSON import/export, and verified local app execution.
- [ ] WebView2 extensions load and toggle in UI; WebKitGTK userscripts execute via UserContentManager.

### Code Quality & Integrity
- [ ] Complete files provided with no truncated "...rest of code" blocks.
- [ ] `cargo check` and `cargo clippy` pass cleanly on Windows and Linux targets.
- [ ] Mock bridge preview runs in browser with zero console errors.
- [ ] Side-by-side comparison with reference screenshots is documented with an explicit list of any deliberate deviations.
- [ ] Any external references or copied code snippets are documented with their source.
