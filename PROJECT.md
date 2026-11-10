# Project: Rusty Browser (Production Daily-Driver Desktop Browser)

## Architecture

Rusty Browser is a high-performance, memory-transparent desktop browser written in Rust using `tao` (v0.37) and `wry` (v0.57), supporting Windows 11 (Microsoft Edge WebView2) and Linux (WebKitGTK 4.1).

### Dual-Layer Windowing & Layout
- **Host Window**: Single `tao::window::Window` with native or client-side decorations (CSD).
- **Chrome Webview (`rusty://app/index.html`)**: Persistent full-window webview hosting browser shell UI (tabs bar, address bar, navigation controls, bookmarks, side panels, status badge). Mapped on Windows to `http://rusty.app/` with strict origin verification.
- **Content Webviews (`content_webviews: HashMap<TabId, WebView>`)**: Dynamically created, sized, positioned, and occluded inside `#content-viewport` via `RectPayload` coordinates. Supports Split View (side-by-side active webviews).
- **Modal Occlusion Protocol**: When UI modals, dropdowns, or settings overlays open, content webviews are hidden (`set_visible(false)`) to prevent HWND/X11/Wayland window z-order fighting and render bleeding.

### Platform Abstraction Trait (`PlatformLayer` / `PlatformWebView`)
- Decouples all Windows COM (`ICoreWebView2Controller`, `ICoreWebView2_3`, `ICoreWebView2_19`, `ICoreWebView2Profile7`) and Linux GTK C bindings (`gtk::Fixed`, `WebKitWebView`, `WebKitUserContentFilterStore`, `WebKitUserContentManager`) from the browser core.
- Unified interface covering webview creation, destruction, show/hide, bounds updates, script execution, request interception, proxying, cookie isolation, and memory statistics.

### Security Architecture & Origin Sandbox
- **Origin Sandbox**: IPC handling strictly verifies `rusty://app/` or `http://rusty.app/` origin. Untrusted web page IPC messages are filtered against a strict accelerator whitelist (`back`, `forward`, `reload`, `zoom`, etc.) and protected with per-tab frame tokens.
- **V1 Ad Blocker**: Web request interception on Windows; native `WebKitUserContentFilterStore` byte-code and injected cosmetic CSS on Linux.
- **V2 VPN / Proxy**: Userspace WireGuard routing via local SOCKS5 proxy without root requirements.
- **V3 Secure Vault**: Credentials and sensitive settings protected by Windows DPAPI or Linux Secret Service via `keyring` crate.
- **V4 Session Protection**: Windows Job Object (`KILL_ON_JOB_CLOSE`), incognito mode (`with_incognito(true)`), and memory zeroization.

---

## Feature Inventory

| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | Multi-State Process Tree Telemetry (Windows) | Private Working Set & Commit telemetry using Job Objects, Toolhelp32 snapshot, and `NtQueryInformationProcess` across 5 states | R0 | survey_spec § 2.1, survey_backend § 1.2 |
| 2 | Process Tree Telemetry (Linux) | Real PSS and Private WS extraction from `/proc/<pid>/smaps_rollup` across process tree | R0 | survey_spec § 2.2, survey_backend § 2.5 |
| 3 | Process Role Classification Engine | Categorizes processes into Host, UI WebView, Content Renderer, GPU, Network, Audio, Storage | R0 | survey_spec § 4.1.1 |
| 4 | Task Manager Details Reconciliation | Reconciles in-browser badge with Task Manager active private working set within 2% | R0 | survey_spec § 4.1.1, ORIGINAL_REQUEST § R0 |
| 5 | Platform Abstraction Trait Definition | Core `PlatformLayer` / `PlatformWebView` traits isolating webview lifecycle, bounds, and memory stats | R0 | survey_spec § 2.3, survey_backend § 2.2 |
| 6 | Rust Workspace State Manager | First-class Rust domain model owning tab metadata (URL, title, favicon, scroll, pin, group, history) | R1 | survey_spec § 2.4, survey_backend § 2.3 |
| 7 | Active-Only Live Webview Lifecycle | Webviews destroyed for inactive workspaces; restored on switch to guarantee 0 MB inactive webview RAM | R1 | survey_spec § 2.5, ORIGINAL_REQUEST § R1 |
| 8 | Crash-Safe Atomic Persistence | Atomic file persistence (`data.json.tmp` -> `data.json` with fsync) debounced at 500ms | R1 | survey_spec § 2.6, survey_backend § 1.2 |
| 9 | Workspace Management UI & Hotkeys | Create, rename, reorder, delete with undo, move tabs, `Ctrl+Alt+1..9` hotkeys, badge counters | R1 | survey_spec § 4.2.1 |
| 10 | Isolated Profile Workspace | Dedicated cookie store and isolated user data directory with documented RAM cost | R1 | survey_spec § 2.7, ORIGINAL_REQUEST § R1 |
| 11 | WebView2 Background Tab Suspension | Raw COM invocation `TrySuspend` and `MemoryUsageTargetLevel = Low` on background tabs | R2 | survey_spec § 2.8, survey_backend § 2.4 |
| 12 | Inactivity Webview Discard | Destroy webviews for tabs inactive > N minutes, retaining scroll and metadata | R2 | survey_spec § 2.9, ORIGINAL_REQUEST § R2 |
| 13 | Renderer Process Limit Evaluation | Empirical evaluation of `--renderer-process-limit` flag documenting RAM savings vs security trade-offs | R2 | survey_spec § 2.10, ORIGINAL_REQUEST § R2 |
| 14 | Bounded DOM & Virtualized Lists | NTP lists virtualized to viewport-only rendering, capping active DOM elements <= 100 | R2 | survey_spec § 2.11, survey_frontend § 4 |
| 15 | UI Webview & NTP Memory Polish | Single WebGL context, canvas release (`width=0`), cap history/suggestions, no full-size thumbnails | R2 | survey_spec § 4.3.1, survey_frontend § 4 |
| 16 | Custom Allocators Evaluation | Evaluate `mimalloc` (Windows) and `jemalloc` (Linux) against default system allocator | R2 | survey_spec § 2.12, survey_backend § 2.4 |
| 17 | Lite Mode Toggle | One-click toggle forcing Minimal skin, zero background FX, no globe/pet, with per-feature budget table | R2 | survey_spec § 2.13, ORIGINAL_REQUEST § R2 |
| 18 | WebKitGTK 4.1 Platform Implementation | Linux backend using wry `build_gtk` with `gtk::Fixed` container supporting X11 and Wayland | R3 | survey_spec § 2.14, survey_backend § 2.5 |
| 19 | Linux Custom Titlebar & CSD | Window dragging, custom controls, and Wayland/X11 titlebar handling | R3 | survey_spec § 4.4.1, ORIGINAL_REQUEST § R3 |
| 20 | XDG Directory Compliance | Cross-platform data paths using `directories` crate (`~/.config`, `~/.local/share`, `~/.cache`) | R3 | survey_spec § 2.15, survey_backend § 2.5 |
| 21 | Secret Service Integration | Linux credential vault using FreeDesktop Secret Service via `keyring` crate (replacing DPAPI) | R3 | survey_spec § 2.16, survey_backend § 2.5 |
| 22 | WebKit Content Blocker (Linux) | Convert adblock rules to `WebKitUserContentFilterStore` format with cosmetic CSS injection | R3 | survey_spec § 2.17, survey_backend § 2.5 |
| 23 | Userspace WireGuard & SOCKS5 Proxy | WireGuard VPN running in userspace routing WebKit traffic via local SOCKS5 proxy without root | R3 | survey_spec § 2.18, ORIGINAL_REQUEST § R3 |
| 24 | Linux Packaging & CI Workflow | AppImage and `.deb` packaging (via `cargo-deb`), GitHub Actions cross-platform CI workflow | R3 | survey_spec § 2.19, ORIGINAL_REQUEST § R3 |
| 25 | Focus Modes (Study, Work, Deep) | Configurable focus sessions linked to Pomodoro timer widget and workspaces | R4 | survey_spec § 2.20, ORIGINAL_REQUEST § R4 |
| 26 | Category & Domain Blocking | Enforce category rules in Rust navigation handler, new-window handler, and injected JS SPA hooks | R4 | survey_spec § 2.21, ORIGINAL_REQUEST § R4 |
| 27 | Calm Interstitial Page | Interstitial showing block reason, remaining time, 5-min pass, and strict-mode delay/phrase | R4 | survey_spec § 2.22, ORIGINAL_REQUEST § R4 |
| 28 | YouTube Shorts Removal | Client-side rule hiding Shorts shelves and redirecting `/shorts/:id` to `/watch?v=:id` | R4 | survey_spec § 2.23, ORIGINAL_REQUEST § R4 |
| 29 | YouTube Recommendations Removal | Hide home feed (Study Home search + playlists), sidebar suggestions, end-screen cards, autoplay | R4 | survey_spec § 2.24, ORIGINAL_REQUEST § R4 |
| 30 | YouTube Educational Watch Gate | Verify `playerMicroformatRenderer.category` against approved list (Education, Science, Howto) | R4 | survey_spec § 2.25, ORIGINAL_REQUEST § R4 |
| 31 | Focus Daily Statistics | Track and persist focused minutes, blocked attempts count, and streak count | R4 | survey_spec § 4.5.1, ORIGINAL_REQUEST § R4 |
| 32 | Softer Dark Skin | Dark skin without neon bloom: muted warm/cool accents, layered gradients, 1.5px search outline | R5 | survey_spec § 2.26, survey_frontend § 4 |
| 33 | Mayank White Skin | Neumorphic white UI (#eef2f8 to #f7f9fc, 24-32px radii, double shadows, glossy blue button) | R5 | survey_spec § 2.27, survey_frontend § 4 |
| 34 | Wind Lines Animation | Crisp curved swoosh shapes with thin glowing blue edges drifting like wind at 30 FPS | R5 | survey_spec § 2.28, survey_frontend § 4 |
| 35 | Weather Orb Widget | Weather-reactive animated orb replacing 3D globe in Mayank skin with Earth toggle | R5 | survey_spec § 2.29, survey_frontend § 4 |
| 36 | Modular Background Registry | Registry with `mount`, `pause`, `resume`, `destroy` lifecycle; only active module in memory | R6 | survey_spec § 2.30, survey_frontend § 4 |
| 37 | Background Catalog (18 Styles) | Constellation, Aurora, Fluid ink, Blobs, Starfield, Rain, Sakura, Fireflies, Grid, Waves, etc. | R6 | survey_spec § 2.31, ORIGINAL_REQUEST § R6 |
| 38 | Background Eco Rules | 30 FPS cap, pause when hidden, 10 FPS / freeze after 60s idle, battery saver, reduced motion | R6 | survey_spec § 2.32, survey_frontend § 4 |
| 39 | High-Res Night Globe Upgrade | 20% larger globe with R8 4096x2048 texture (~11.2 MB VRAM), twilight shader, atmosphere rim | R6 | survey_spec § 2.33, survey_frontend § 4 |
| 40 | Customizable Launch Cards | 4 bottom hero cards (3-6 capacity) executing URL batches, workspace switch, command palette | R7 | survey_spec § 2.34, survey_frontend § 4 |
| 41 | Secure Local Application Execution | OS process spawn via `std::process::Command` without shell strings, backed by allowlist | R7 | survey_spec § 2.35, survey_frontend § 4 |
| 42 | WebView2 Extension Management | Extension loading via `ICoreWebView2Profile7` (`AddBrowserExtension`, toggle, permission inspection) | R8 | survey_spec § 2.36, survey_backend § 2.4 |
| 43 | WebKitGTK Userscripts Engine | Tampermonkey-style userscripts via `WebKitUserContentManager` with `@match` / `@run-at` | R8 | survey_spec § 2.37, survey_spec § 4.9.1 |
| 44 | Cross-Platform CI & Documentation Polish | Updated README, typed IPC schema, updated threat model, PLACEHOLDER asset catalog, benchmarks | R9 | survey_spec § 2.38, ORIGINAL_REQUEST § R9 |
| 45 | E2E Test Suite Pass & Adversarial Hardening | Pass 100% of E2E tests (Tiers 1-4) followed by Tier 5 adversarial coverage hardening | R9 | Project Pattern Dual Track Final Milestone |

---

## Milestones

| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M0 | Milestone R0: Baseline Measurement & Platform Layer Abstraction | Telemetry process-tree walk (Windows & Linux smaps_rollup), 5-state baseline measurement suite, `PlatformLayer` & `PlatformWebView` traits | None | PLANNED |
| M1 | Milestone R1: Workspaces | Rust-owned workspace state, active-only live webview management, crash-safe persistence, isolated profile workspace | M0 | PLANNED |
| M2 | Milestone R2: RAM Optimization Pass | Background tab suspension (`TrySuspend`, `MemoryUsageTargetLevel = Low`), inactivity discard, virtualized DOM lists, `mimalloc`/`jemalloc` evaluation, Lite mode toggle | M1 | PLANNED |
| M3 | Milestone R3: Linux Platform Support | WebKitGTK 4.1 `gtk::Fixed` container, Wayland/X11 CSD, XDG paths, Secret Service `keyring`, WebKit content blocker, userspace WireGuard/SOCKS5 proxy, `.deb`/AppImage/CI | M0, M2 | PLANNED |
| M4 | Milestone R4: Focus Mode & YouTube Restrictor | Focus timer modes, category blocking (social, video, games), calm interstitial, YouTube Shorts redirect, recommendations removal, educational watch gate | M1 | PLANNED |
| M5 | Milestone R5: Visual Skins (Softer Dark & Mayank White) | Softer Dark skin (4 muted palettes, 1.5px outline), Mayank White skin (neumorphic UI, 30 FPS wind lines, weather orb) | M0 | PLANNED |
| M6 | Milestone R6: Interactive Modular Background Registry & Night Globe Upgrade | Background registry (`mount`/`pause`/`resume`/`destroy`), 18 background styles, eco rules, R8 4096x2048 night globe texture, warm twilight shader | M5 | PLANNED |
| M7 | Milestone R7: Customizable Launch Cards | 3-6 launch cards, drag-and-drop reorder, JSON import/export, presets, verified local app execution without shell strings | M1, M5 | PLANNED |
| M8 | Milestone R8: Extensions & Userscripts | Windows WebView2 raw COM extension management (`AddBrowserExtension`, permissions inspection); Linux WebKitGTK userscripts via `UserContentManager` | M0, M3 | PLANNED |
| M9 | Milestone R9: Final Cross-Platform Polish & Deliverables | Comprehensive documentation, IPC contract, threat model, PLACEHOLDER list, external code attributions, final benchmark run, pass 100% E2E tests | M0-M8 | PLANNED |
| ME2E | E2E Testing Track | Independent requirement-driven opaque-box test suite (Tiers 1-4) producing `TEST_READY.md` | None (parallel) | PLANNED |

---

## Interface Contracts

### Rust Core ↔ PlatformLayer (`src/platform/mod.rs`)
```rust
pub trait PlatformWebView: Send + Sync {
    fn set_visible(&mut self, visible: bool) -> anyhow::Result<()>;
    fn set_bounds(&mut self, rect: wry::Rect) -> anyhow::Result<()>;
    fn load_url(&mut self, url: &str) -> anyhow::Result<()>;
    fn evaluate_script(&mut self, js: &str) -> anyhow::Result<()>;
    fn suspend(&mut self) -> anyhow::Result<()>;
    fn resume(&mut self) -> anyhow::Result<()>;
    fn set_memory_target_low(&mut self) -> anyhow::Result<()>;
}

pub trait PlatformHost: Send + Sync {
    fn create_webview(
        &mut self,
        window: &tao::window::Window,
        config: WebViewConfig,
    ) -> anyhow::Result<Box<dyn PlatformWebView>>;
    fn sample_memory(&self) -> anyhow::Result<BrowserMemoryBreakdown>;
    fn configure_proxy(&mut self, proxy_url: Option<&str>) -> anyhow::Result<()>;
}
```

### UI Webview ↔ Rust Core IPC (`rusty://app/`)
- Gated to origin `rusty://app/` (or mapped `http://rusty.app/` on Windows).
- Typed payload format: JSON `UiMessage` enums:
  - `UiMessage::TabAction { action: String, tab_id: Option<u64>, url: Option<String> }`
  - `UiMessage::WorkspaceAction { action: String, workspace_id: Option<String>, name: Option<String> }`
  - `UiMessage::FocusAction { action: String, mode: Option<String>, duration_mins: Option<u32> }`
  - `UiMessage::LaunchLocalApp { app_id: String, executable_path: String, args: Vec<String> }`
  - `UiMessage::SetSkin { skin: String, theme: Option<String> }`
  - `UiMessage::Overlay { open: bool }` (triggers modal occlusion: hides content webviews).

### Workspaces Model (`src/workspace.rs`)
```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Workspace {
    pub id: String,
    pub name: String,
    pub icon: String,
    pub color: String,
    pub theme: String,
    pub default_engine: String,
    pub focus_mode: Option<String>,
    pub is_isolated: bool,
    pub tabs: Vec<TabMetadata>,
    pub active_tab_index: usize,
}
```

---

## Code Layout

- `src/main.rs`: Tao application loop, IPC routing, window lifecycle.
- `src/platform/`: Platform abstraction module.
  - `src/platform/mod.rs`: Trait definitions (`PlatformWebView`, `PlatformHost`).
  - `src/platform/windows.rs`: Windows WebView2 COM implementation.
  - `src/platform/linux.rs`: Linux WebKitGTK 4.1 implementation.
- `src/workspace.rs`: Workspace state manager and atomic persistence.
- `src/tab.rs`: Tab metadata, lifecycle, and split view state.
- `src/focus/`: Focus mode engine and category filtering.
- `src/storage.rs`: Atomic persistence and credential vault (`keyring` / DPAPI).
- `src/telemetry.rs`: Process-tree memory sampling (Windows & Linux).
- `src/ui/app_protocol.rs`: Custom URI scheme handler for `rusty://app/`.
- `ui/`: Embedded frontend assets.
  - `ui/index.html`, `ui/newtab.html`: Chrome and NTP markup.
  - `ui/css/`: Stylesheets (`base.css`, `themes.css`, `skin-*.css`).
  - `ui/js/`: Client scripts (`boot.js`, `bridge.js`, `chrome.js`, `newtab.js`, `globe.js`).
  - `ui/js/backgrounds/`: Modular background catalog modules.
- `tests/e2e/`: Requirement-driven E2E test suite.
- `benchmark.ps1`, `verify_memory.ps1`: Performance and RAM measurement scripts.

---

## Invariant Rules & Acceptance Criteria

### Performance & Memory Guardrails
- Minimal UI webview RAM < 60 MB.
- Crazy and Mayank UI webviews RAM < 120 MB at effects level 50.
- 10 open tabs consume >= 15% less RAM than Google Chrome on identical URLs.
- In-browser telemetry badge reconciles with Windows Task Manager active private working set within 2%.

### Core Invariants
- Only the active skin's code loads into memory.
- Typed IPC strictly across `rusty://app/` origin.
- Standalone mock bridge preview runs with zero console errors.
- PLACEHOLDER comments on all demo/placeholder assets.
- Never copy real brand logos (favicons or letter avatars only).
- Honest security limits (no "infostealer-proof" claims).
- Preserve earlier security capabilities (V1-V4).
- Complete code delivery with zero truncated blocks.
