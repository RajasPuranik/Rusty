# Requirements Specification & Dependency Survey: Milestones R0–R9

**Document Version**: 1.0.0  
**Author**: Explorer 3 (Requirements Specification & Dependency Miner)  
**Date**: 2026-11-09  
**Target Repository**: `rusty_browser` (`d:\browser`)  
**Status**: Authoritative Architectural Specification  

---

## 1. Executive Summary & Core Invariant Rules

This specification establishes the authoritative roadmap, data contracts, platform API interfaces, invariant constraints, dependency graphs, and verification methodologies for milestones **R0 through R9** of Rusty Browser. Rusty Browser is a high-performance, memory-transparent desktop browser engineered in Rust using `tao` (0.37) and `wry` (0.57), targeting Windows 11 (Microsoft Edge WebView2) and Linux (WebKitGTK 4.1).

### 1.1 Invariant Rules (Universal Constraints Across All Milestones)

| Invariant ID | Rule Name | Specification & Enforcement Mechanism |
|---|---|---|
| **INV-01** | **Active Skin Asset Isolation** | Only the active skin's CSS and JavaScript code may be loaded into memory. When Minimal is active, 0 bytes of Crazy/Mayank FX, shaders, or companion pet code are parsed or executed. Swapping skins must cleanly unbind previous DOM nodes and styles. |
| **INV-02** | **Strict IPC Origin Gating** | Typed IPC communication is strictly gated to the `rusty://app/` (or mapped `http://rusty.app/` on Windows) origin. Untrusted external web content (`http://`, `https://`) is restricted to safe, sanitised accelerator intents (`new_tab`, `close_current_tab`, `back`, `forward`, `reload`, `next_tab`, `prev_tab`, `zoom_in`, `zoom_out`, `zoom_reset`). External origins cannot execute arbitrary backend commands or storage operations. |
| **INV-03** | **Clean Mock Bridge Preview** | The standalone browser preview (`ui/index.html` and `ui/newtab.html` via `ui/js/bridge.js` mock mode) must run in any evergreen browser with zero console errors or uncaught exceptions across all skins and themes. |
| **INV-04** | **Placeholder Asset Discipline** | Every non-original, demo, or placeholder asset (NASA textures, logos, SVG pet species, icon paths) must carry explicit `PLACEHOLDER` comments and documentation identifying replacement requirements. |
| **INV-05** | **Zero Brand Trademark Infringement** | Real third-party brand logos (e.g., Google, YouTube, Twitch) must never be bundled as static assets. The browser uses favicons fetched dynamically from Rust or generated SVG/canvas letter avatars. |
| **INV-06** | **Honest Security Posture** | Documentation and UI must never claim absolute security guarantees (e.g., "infostealer-proof" or "impenetrable sandbox"). Clear boundaries and threat models must be documented. |
| **INV-07** | **Legacy Security Preservation** | Capabilities from earlier versions (V1 Ad Blocker, V2 VPN/Proxy, V3 Secure Vault, V4 Session Protection) must be preserved or enhanced across platform transitions. |
| **INV-08** | **Strict Anti-Faking Mandate** | If any platform capability is impossible, buggy, or inadvisable on a specific OS/engine (e.g., Chrome extension support on WebKitGTK), state the limitation honestly and provide a clean alternative (e.g., WebKit Userscripts) rather than simulating or faking functionality. |
| **INV-09** | **Complete Code Delivery** | Every code and configuration file delivered must be 100% complete with zero truncated blocks (no `// ... rest of code ...`). |
| **INV-10** | **External Code Attribution** | Any snippet, shader, algorithm, or asset adapted from external open-source projects must be catalogued in the final milestone documentation with source URLs and licenses. |

---

## 2. Features Discovered

The following table comprehensively catalogues all functional and architectural features discovered across the authoritative user prompt, existing repository implementations, and system platform definitions.

| # | Category | Feature | Description | Inputs | Outputs | Error Behavior | Discovered Via |
|---|---|---|---|---|---|---|---|
| 1 | Measurement | Process Tree Telemetry (Windows) | Private Working Set, Working Set, and Commit measurement across host and isolated WebView2 children using Job Objects, Toolhelp32 snapshot, and `NtQueryInformationProcess(ProcessVmCounters)`. | Host PID, unique user-data-dir path | `BrowserMemoryBreakdown` with per-PID classification and totals | Graceful fallback to host process memory if child snapshot fails | `src/telemetry.rs`, `verify_memory.ps1` |
| 2 | Measurement | Process Tree Telemetry (Linux) | PSS and Private WS memory extraction from `/proc/<pid>/smaps_rollup` across `rusty_browser`, `WebKitWebProcess`, and `WebKitNetworkProcess`. | Process PIDs | Breakdown JSON with PSS and Private MB per process | Emits `"n/a"` or 0.0 MB if smaps_rollup permission is denied | `ORIGINAL_REQUEST.md` § R0, R3 |
| 3 | Platform | Platform Abstraction Trait | Unified trait isolating all WebView2 COM and WebKitGTK C calls behind standard lifecycle, bounds, interception, cookie, and proxy methods. | Window handle, `Rect`, config structs | Trait object `Box<dyn PlatformWebView>` | Returns `Result<T, PlatformError>` | `ORIGINAL_REQUEST.md` § R0 |
| 4 | Workspaces | Rust Workspace State Manager | Rust-owned workspace state containing tabs (URL, title, favicon, scroll, pinned, group, history), name, icon, color, theme, default engine, and focus link. | User actions (`create`, `switch`, `rename`, `delete`, `move_tab`) | Synchronized `WorkspaceState` broadcast to UI | Prevents deleting last workspace; atomic rollbacks | `ORIGINAL_REQUEST.md` § R1 |
| 5 | Workspaces | Active-Only Live Webview Lifecycle | Webviews for inactive workspaces are destroyed immediately to free OS renderer processes; restored on switch. | `switch_workspace(id)` | Tab state snapshot; webview drop; active tab webview create | Recovers tab from URL if scroll position is lost | `ORIGINAL_REQUEST.md` § R1 |
| 6 | Workspaces | Crash-Safe Atomic Persistence | Atomic file persistence using temporary file writing, `fsync`, and atomic rename (`data.json.tmp` -> `data.json`). | Workspace & settings state | Serialized JSON file on disk | Preserves backup file if write/rename fails | `ORIGINAL_REQUEST.md` § R1 |
| 7 | Workspaces | Isolated Profile Workspace | Dedicated cookie store and separate profile directory for isolated sessions. | `is_isolated: true` config | Independent `WebContext` / WebView2 user-data directory | Returns error if profile directory cannot be created | `ORIGINAL_REQUEST.md` § R1 |
| 8 | RAM | WebView2 Tab Suspension | Suspend background tabs via raw COM interface `ICoreWebView2_3::TrySuspend` and set memory target to low. | Background tab handle, timeout trigger | Suspended tab state, lowered memory target level | Logs warning if COM interface query fails; leaves tab active | `ORIGINAL_REQUEST.md` § R2 |
| 9 | RAM | Inactivity Webview Discard | Destroy webviews for tabs inactive for > N minutes, keeping metadata and scroll position. | Tab inactivity duration > threshold | Webview dropped, `has_webview = false` | Automatically wakes on tab selection | `src/tab.rs`, `ORIGINAL_REQUEST.md` § R2 |
| 10 | RAM | Renderer Process Limit Evaluation | Test and document `--renderer-process-limit=N` switch in WebView2 environment options. | Limit parameter (e.g., 2, 4) | Shared renderer processes across origins | Disables switch if renderer instability occurs | `ORIGINAL_REQUEST.md` § R2 |
| 11 | RAM | Bounded DOM & Virtualized Lists | NTP lists (history, bookmarks) virtualized to display only viewport items, bounding DOM nodes <= 100. | Full item collections | Visible slice DOM nodes | Falls back to static list if virtualizer fails | `ORIGINAL_REQUEST.md` § R2 |
| 12 | RAM | Custom Memory Allocators | Benchmark and evaluate `mimalloc` (Windows) and `jemalloc` (Linux) against default system allocators. | Memory allocation requests | Lower fragmentation and working set | Reverts to system allocator if build fails | `ORIGINAL_REQUEST.md` § R2 |
| 13 | RAM | Lite Mode Toggle | One-click toggle forcing Minimal skin, zero background FX, no globe, and no pet with per-feature RAM table. | Toggle IPC message | Lowers memory consumption across all WebViews | Atomic setting sync | `ORIGINAL_REQUEST.md` § R2 |
| 14 | Linux | WebKitGTK 4.1 Platform Implementation | Linux backend using `wry` with `build_gtk` attached to a `gtk::Fixed` container, supporting X11 and Wayland. | Window handle, fixed container | WebKitGTK webview with pixel positioning | Falls back to default window if GTK init fails | `ORIGINAL_REQUEST.md` § R3 |
| 15 | Linux | XDG Directory Compliance | Replace Windows paths with XDG Base Directory specification via `directories` crate. | OS environment | Config (`~/.config`), Data (`~/.local/share`), Cache (`~/.cache`) | Falls back to home directory if XDG variables unset | `ORIGINAL_REQUEST.md` § R3 |
| 16 | Linux | Secret Service Credential Storage | Replace Windows DPAPI with FreeDesktop Secret Service DBus interface via `keyring` crate. | Key/secret pairs | Encrypted stored secrets | Falls back to encrypted file storage if DBus unavailable | `ORIGINAL_REQUEST.md` § R3 |
| 17 | Linux | WebKit Content Blocker | Compile adblock rules into `WebKitUserContentFilterStore` byte-code and inject cosmetic CSS. | Adblock filter lists | Native WebKit content filtering | Logs unparseable rules and compiles remaining rules | `ORIGINAL_REQUEST.md` § R3 |
| 18 | Linux | Userspace WireGuard & SOCKS5 Proxy | WireGuard VPN running in userspace routing WebKit traffic via local SOCKS5 proxy without root. | VPN tunnel configuration | Proxy applied via `WebKitNetworkProxySettings` | Kill switch blocks traffic if proxy drops | `ORIGINAL_REQUEST.md` § R3 |
| 19 | Linux | Linux Packaging & CI | Generation of `.deb` (via `cargo-deb`), AppImage, and GitHub Actions CI workflow for Linux & Windows. | Cargo workspace source | `.deb` installer and `.AppImage` binary | CI step fails on build or test error | `ORIGINAL_REQUEST.md` § R3 |
| 20 | Focus | Focus Modes (Study, Work, Deep) | Configurable focus sessions linked to Pomodoro timer widget and workspaces with category blocking. | Mode selection, timer duration | Navigation filtering and status updates | Reverts to neutral state on timer expiry | `ORIGINAL_REQUEST.md` § R4 |
| 21 | Focus | Category & Domain Blocking | Block social, short-form video, and games in Rust navigation starting event, new window handler, and SPA hooks. | Navigation URL, category rules | Allowed navigation or blocked interstitial | Redirects blocked navigations to `rusty://app/blocked.html` | `ORIGINAL_REQUEST.md` § R4 |
| 22 | Focus | Calm Interstitial Page | Interstitial showing block reason, remaining focus time, 5-min pass, and strict-mode delay/phrase. | Block event details | Rendered interstitial UI | Prevents bypass during strict mode | `ORIGINAL_REQUEST.md` § R4 |
| 23 | Focus | YouTube Shorts Removal | Client-side rule hiding Shorts shelves and redirecting `/shorts/:id` to `/watch?v=:id`. | YouTube DOM and navigation URLs | Cleaned feed, standard watch page | Falls back to normal page if redirect loop detected | `ORIGINAL_REQUEST.md` § R4 |
| 24 | Focus | YouTube Recommendations Removal | Hide home feed, sidebar recommendations, end-screen cards, and disable autoplay. | Watch page DOM | Study Home portal (search box + approved playlists) | Preserves player controls while hiding suggestions | `ORIGINAL_REQUEST.md` § R4 |
| 25 | Focus | YouTube Educational Watch Gate | Inspect `playerMicroformatRenderer.category` and allow only Education, Science & Tech, Howto & Style. | Video metadata JSON | Allowed playback or study gate interstitial | Shows category warning if metadata is missing | `ORIGINAL_REQUEST.md` § R4 |
| 26 | Skins | Softer Dark Skin | Dark skin without neon bloom: muted warm/cool accents, layered gradients, 1px low-contrast borders, double shadows. | Skin selection `softer_dark` | Loaded `skin-softer-dark.css` (0 neon glow) | Falls back to Minimal skin if asset missing | `ORIGINAL_REQUEST.md` § R5 |
| 27 | Skins | Mayank White Skin | Neumorphic white UI (#eef2f8 to #f7f9fc, 24-32px radii, double shadows, glossy blue button, wind lines, weather orb). | Skin selection `mayank` | Loaded `skin-mayank.css`, wind lines canvas | Throttles to 30 FPS; avoids backdrop-filter | `ORIGINAL_REQUEST.md` § R5 |
| 28 | Skins | Wind Lines Animation | Crisp curved swoosh shapes with glowing blue edges drifting like wind with mouse parallax. | Mouse coordinates, time delta | 30 FPS GPU-accelerated canvas/SVG animation | Freezes on 60s idle or reduced-motion preference | `ORIGINAL_REQUEST.md` § R5 |
| 29 | Skins | Weather Orb Widget | Weather-reactive animated orb (clouds, sun rays, moon phases) replacing 3D globe in Mayank skin. | Weather condition code, time of day | Rendered 2D/3D weather orb | Shows daylight Earth toggle on click | `ORIGINAL_REQUEST.md` § R5 |
| 30 | Backgrounds | Modular Background Registry | Dynamic module registry with `mount`, `pause`, `resume`, `destroy` lifecycle. Only active module loaded. | Background selection ID | Mounted background container | Cleans up WebGL textures and listeners on unmount | `ORIGINAL_REQUEST.md` § R6 |
| 31 | Backgrounds | Background Catalog (18 Styles) | Constellation, Aurora, Fluid ink, Blobs, Starfield, Rain, Sakura, Fireflies, Grid, Waves, Lava lamp, etc. | User selection | Active rendering loop | Capped at 30 FPS; 10 FPS on idle | `ORIGINAL_REQUEST.md` § R6 |
| 32 | Backgrounds | Background Eco Rules | 30 FPS cap, pause on hidden, 10 FPS / freeze after 60s idle, auto-disable on battery saver, reduced motion. | Window visibility, battery status, idle timer | Throttled or suspended render loop | Zero CPU usage when tab hidden | `ORIGINAL_REQUEST.md` § R6 |
| 33 | Backgrounds | High-Res Night Globe Upgrade | 20% larger globe with R8 4096x2048 night-lights texture, twilight shader, rim atmosphere, NASA imagery slot. | Texture asset, drag gesture | 30 FPS WebGL sphere with terminator shader | Falls back to static render on low VRAM | `ORIGINAL_REQUEST.md` § R6 |
| 34 | Launch Cards | Customizable Launch Cards | 4 bottom hero cards (3-6 capacity) executing URL batches, workspace switch, command palette, or local apps. | Click or `Alt+1..4` hotkeys | Action sequence execution | Confirmation prompt for local executable launch | `ORIGINAL_REQUEST.md` § R7 |
| 35 | Launch Cards | Local Application Execution | Secure process spawn via `std::process::Command` without shell string parsing, backed by allowlist. | Executable path, argument list | Spawned local OS process | Rejects unlisted or untrusted binaries | `ORIGINAL_REQUEST.md` § R7 |
| 36 | Extensions | WebView2 Extension Management | Enable extensions via `ICoreWebView2Profile7` (`AddBrowserExtension`, toggle enabled, permission audit). | Extension folder path, `.crx`, `.zip` | Loaded extension in WebView2 profile | Disabled in Vault and Secure-mode sites | `ORIGINAL_REQUEST.md` § R8 |
| 37 | Extensions | WebKitGTK Userscripts Engine | Tampermonkey-style userscripts via `WebKitUserContentManager` with `@match` and `@run-at` headers. | Userscript JS file | Injected userscript into matching web contexts | Catches and logs script syntax errors safely | `ORIGINAL_REQUEST.md` § R8 |
| 38 | Polish | Cross-Platform CI & Documentation | Comprehensive documentation (README, IPC contract, threat model, PLACEHOLDER catalogue) and CI workflow. | Codebase state, test suites | CI test passes, published release packages | Halts pipeline on clippy or test failure | `ORIGINAL_REQUEST.md` § R9 |

---

## 3. Edge Cases

| # | Feature | Input | Observed Behavior |
|---|---|---|---|
| 1 | Process Tree Telemetry | Windows process terminates unexpectedly during Toolhelp32 walk | Handle query returns `ERROR_INVALID_PARAMETER` or `STILL_ACTIVE = false`; process is safely skipped without crashing the telemetry loop. |
| 2 | Process Tree Telemetry | Third-party WebView2 app (e.g., Teams, Widgets) running simultaneously | `--user-data-dir` filtering checks normalized directory path; third-party process is completely excluded from browser Private WS total. |
| 3 | Process Tree Telemetry | Linux `/proc/<pid>/smaps_rollup` permission denied (container/sandbox) | Returns `std::io::ErrorKind::PermissionDenied`; falls back gracefully to `/proc/<pid>/statm` resident pages or reports `"n/a"`. |
| 4 | Workspaces | Rapid workspace switching before previous webviews finish cleanup | Cancellation token / epoch ID cancels pending webview construction; stale webview is immediately dropped; target workspace webviews build cleanly. |
| 5 | Workspaces | Deleting the currently active workspace | Focus automatically transfers to adjacent workspace (or default workspace); deletion is prohibited if only one workspace remains. |
| 6 | Workspaces | System crash during workspace disk persistence | Temporary file `data.json.tmp` is untouched or partially written; primary `data.json` remains uncorrupted; atomic rename guarantees all-or-nothing write. |
| 7 | RAM Optimization | Background tab suspended while playing background audio | Media state check (`tab.is_playing_audio`) prevents suspension; audio tabs remain active and unsuspended until paused. |
| 8 | RAM Optimization | Webview wake requested while system is severely out of memory | Webview creation handles `Result::Err`; tab displays lightweight "Tab Crashed / Out of Memory" fallback page with a "Reload" button. |
| 9 | Linux Platform | Wayland compositor lacks SSD (Server-Side Decorations) | Browser custom client-side decorations (CSD) handle title bar rendering, window drag gestures (`WindowExtUnix::drag_window`), and window controls natively. |
| 10 | Linux Platform | WebKitGTK WebProcess crash on NVIDIA Wayland (DMA-BUF driver bug) | Readme documents `WEBKIT_DISABLE_DMABUF_RENDERER=1` workaround; error handler detects crash event and displays recovery button. |
| 11 | Focus Mode | User navigates to blocked site via client-side SPA history (`pushState`) | Monkey-patched `history.pushState` and `popstate` intercept route change; Rust verifies URL via `SourceChanged` and replaces route with interstitial. |
| 12 | Focus Mode | User attempts to terminate Strict Focus Mode early | Interstitial blocks early termination until 60-second countdown elapses or the user types the exact verification phrase without typos. |
| 13 | YouTube Filter | Video uploaded with incorrect category (e.g., gaming marked as Education) | Known client-side gap: video is permitted; user can right-click or use toolbar action to manually add video/channel to study blocklist. |
| 14 | YouTube Filter | YouTube updates internal DOM layout or obfuscates classes | Configurable `youtube_rules.json` allows updating CSS selectors without recompiling Rust binary; fallback to `meta[itemprop="genre"]` and metadata regex. |
| 15 | Visual Skins | Switching from Crazy to Minimal skin while animations are running | `boot.js` halts `requestAnimationFrame` loops, removes skin CSS link tags, clears canvas buffers, and ensures 0 residual timers remain active. |
| 16 | Background Registry | Rapidly hovering multiple backgrounds in picker modal | Live preview debounces by 250ms; only one preview WebGL context is initialized; unhover immediately cancels pending load. |
| 17 | Night Globe | WebGL context loss event (`webglcontextlost`) | Context loss listener prevents default; pauses rendering loop; automatically restores textures and shaders on `webglcontextrestored`. |
| 18 | Launch Cards | Launching local executable with non-existent path or unapproved binary | Intercepted in Rust core: validates path against allowlist and existence check; displays error dialog instead of spawning shell process. |
| 19 | Extensions | Extension requests unauthorized or high-risk permissions | Extension manager parses manifest permissions; displays security warning modal; requires explicit user toggle before enabling in WebView2 profile. |
| 20 | Extensions | WebKitGTK attempting to load Chromium `.crx` package | System displays clear message: "Chromium extensions are not supported on WebKitGTK; use Linux Userscripts instead." No faked execution. |

---

## 4. Milestone-by-Milestone Specification (R0 through R9)

### 4.1 Milestone R0: Baseline Measurement & Platform Layer Abstraction

#### 4.1.1 Explicit Functional Features
1. **Multi-State Process-Tree Telemetry**:
   - Accurately captures process memory across 5 discrete browser states:
     - State 1: Empty window (browser shell + empty webview).
     - State 2: New Tab Page per active skin (Minimal, Crazy, Mayank).
     - State 3: 5 open tabs (predefined benchmark URLs: `rust-lang.org`, `wikipedia.org`, `github.com`, `reddit.com`, `news.ycombinator.com`).
     - State 4: 10 open tabs (comprehensive multi-tab test suite from `benchmark.ps1`).
     - State 5: Split View active (two simultaneous side-by-side content webviews).
2. **Process Classification Engine**:
   - Classifies every process into its exact role:
     - `Host (Rusty)`: Rust executable running the Tao event loop.
     - `UI WebView`: Renderer hosting `rusty://app/index.html`.
     - `Content Renderer`: Renderer hosting web content tabs.
     - `GPU Process`: Direct3D / OpenGL compositing engine.
     - `Network Service`: Out-of-process network stack.
     - `Storage Service`: IndexedDB and cache service.
     - `Audio Service`: Out-of-process audio mixer.
     - `Crashpad Handler`: Crash reporting daemon.
3. **Task Manager Reconciliation**:
   - Compares measured browser totals against Windows Task Manager Details tab **"Memory (active private working set)"** with <= 2% margin of error.
4. **Platform Layer Abstraction Trait (`PlatformWebView`)**:
   - Fully abstracts webview creation, destruction, visibility, bounds, navigation, script evaluation, request interception, proxying, and cookie operations behind a common Rust trait.

#### 4.1.2 Data Models & Struct Schemas
```rust
/// Canonical process memory record.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProcessMemoryRecord {
    pub pid: u32,
    pub parent_pid: u32,
    pub role: ProcessRole,
    pub exe_name: String,
    pub private_ws_bytes: u64,
    pub working_set_bytes: u64,
    pub commit_bytes: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ProcessRole {
    RustHost,
    UiWebView,
    ContentRenderer,
    GpuProcess,
    NetworkUtility,
    StorageUtility,
    AudioUtility,
    Crashpad,
    Unknown,
}

/// Baseline measurement report across states.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BaselineMeasurementReport {
    pub timestamp_utc: String,
    pub os_target: String,
    pub states: Vec<StateMeasurement>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StateMeasurement {
    pub state_name: String,
    pub total_private_ws_mb: f64,
    pub total_working_set_mb: f64,
    pub total_commit_mb: f64,
    pub processes: Vec<ProcessMemoryRecord>,
}

/// Rectangular bounds specification.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PlatformRect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}
```

#### 4.1.3 Platform API Requirements
- **Windows (WebView2)**:
  - Query raw COM interfaces via `wry::WebViewExtWindows::controller()`.
  - Interfaces: `ICoreWebView2Controller`, `ICoreWebView2_3`, `ICoreWebView2Environment`.
  - Process-tree telemetry: `CreateToolhelp32Snapshot`, `Process32FirstW`, `Process32NextW`, `NtQueryInformationProcess(ProcessVmCounters)`.
- **Linux (WebKitGTK 4.1)**:
  - GTK path: `wry::WebViewBuilderExtUnix::build_gtk` targeting a `gtk::Fixed` container.
  - Telemetry: Read `/proc/<pid>/smaps_rollup` parsing `Pss:` and `Private_Clean:`, `Private_Dirty:`.

#### 4.1.4 Invariants & Dependencies
- **Invariants**: INV-02 (IPC gating), INV-08 (no faked telemetry).
- **Dependencies**: None (R0 is the foundational milestone).

#### 4.1.5 Acceptance Criteria & Verification Methods
- [ ] Process breakdown script (`verify_memory.ps1`) runs and outputs all 5 states.
- [ ] In-browser memory badge matches Task Manager Details active private working set within 2%.
- [ ] `PlatformWebView` trait compiled and verified with zero direct platform calls in `src/tab.rs` or `src/ui/`.
- [ ] `cargo check --target x86_64-pc-windows-msvc` and `cargo check --target x86_64-unknown-linux-gnu` compile cleanly.

---

### 4.2 Milestone R1: Workspaces

#### 4.2.1 Explicit Functional Features
1. **Rust-Centric State Architecture**:
   - Rust core owns all workspace state: open tabs (URL, title, favicon, scroll position, pinned flag, tab group, back/forward history), workspace name, icon, color, theme override, default search engine, and linked focus mode.
2. **Active-Only Live Webview Allocation**:
   - Only tabs in the currently active workspace can possess allocated `WebView` handles.
   - When switching workspaces:
     - Persist current active tab's scroll position and history index.
     - Drop all `WebView` instances belonging to the leaving workspace.
     - Instantiate `WebView` solely for the active tab (and split pane if enabled) of the arriving workspace.
3. **Crash-Safe Persistence**:
   - Workspace state serialized to `data.json.tmp`, flushed to disk (`fsync`), and atomically renamed to `data.json`.
   - Restore on browser launch: recreates workspace definitions and tab metadata in a lazy/sleeping state.
4. **Workspace Management Capabilities**:
   - Create, rename, reorder, delete (with undo buffer) workspaces.
   - Move tabs across workspaces via tab context menu or dragging tab to workspace rail.
   - Global keyboard shortcuts: `Ctrl+Alt+1` through `Ctrl+Alt+9` for instant switching.
   - Live tab-count badge on each workspace rail icon.
5. **Optional Isolated Profile Workspace**:
   - Workspaces can be flagged as `isolated: true`, creating a dedicated profile folder (`WebView2Profile_Workspace_<id>`) and independent cookie/session jar.

#### 4.2.2 Data Models & Struct Schemas
```rust
pub type WorkspaceId = String;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Workspace {
    pub id: WorkspaceId,
    pub name: String,
    pub icon: String,
    pub color: String,
    pub theme_override: Option<String>,
    pub background_id: Option<String>,
    pub default_search_engine: Option<String>,
    pub focus_mode_id: Option<String>,
    pub is_isolated: bool,
    pub active_tab_id: Option<u32>,
    pub tabs: Vec<TabState>,
    pub recently_closed: Vec<TabState>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TabState {
    pub id: u32,
    pub url: String,
    pub title: String,
    pub favicon_url: Option<String>,
    pub pinned: bool,
    pub muted: bool,
    pub group_id: Option<String>,
    pub scroll_y: f64,
    pub zoom_level: f64,
    pub nav_history: Vec<String>,
    pub nav_index: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkspaceManager {
    pub active_workspace_id: WorkspaceId,
    pub workspaces: Vec<Workspace>,
}
```

#### 4.2.3 Platform API Requirements
- Platform abstraction trait lifecycle methods: `create_webview()`, `destroy_webview()`, `show()`, `hide()`.
- WebView2 environment creation with custom user data folder for isolated workspaces (`with_user_data_dir`).
- WebKitGTK `WebKitWebContext` creation with custom data directory for isolated workspaces.

#### 4.2.4 Invariants & Dependencies
- **Invariants**: INV-01 (only active skin/workspace resources load), INV-09 (complete file writes).
- **Dependencies**: Milestone R0 (requires `PlatformWebView` lifecycle methods).

#### 4.2.5 Acceptance Criteria & Verification Methods
- [ ] Switching workspaces destroys all webviews of inactive workspaces, verified via `verify_memory.ps1` process count decrease.
- [ ] Switching back restores the previously viewed tab and vertical scroll position accurately.
- [ ] Killing the browser process mid-session and restarting recovers all workspaces and tab URLs cleanly.
- [ ] Isolated workspace has independent cookies (e.g. logging into account in isolated workspace does not log in default workspace).
- [ ] Unit tests for workspace manager pass (`cargo test workspace`).

---

### 4.3 Milestone R2: RAM Optimization Pass

#### 4.3.1 Explicit Functional Features
1. **Background Tab Suspension & Low Memory Target**:
   - Raw WebView2 COM handles invoke `ICoreWebView2_3::TrySuspend` and set `ICoreWebView2_4::put_MemoryUsageTargetLevel(COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW)`.
   - Inactivity timer discards tabs entirely after N minutes (default 10 min), releasing the webview.
2. **Renderer Process Limit Evaluation**:
   - Configurable `--renderer-process-limit=N` switch in environment options.
   - Full evaluation report documenting memory savings vs. security trade-off (Site Isolation).
3. **UI WebView & NTP Optimization**:
   - Single WebGL context shared across UI elements.
   - Canvases released (`width = 0; height = 0`) and textures deleted when hidden.
   - Virtualized lists for history and bookmarks (DOM capped <= 100 nodes).
   - Strict CSS guardrails: zero gratuitous `will-change`, restricted `backdrop-filter`, cap autocomplete suggestions to 6.
4. **Rust Allocator Replacement**:
   - Integrated `mimalloc` on Windows and `jemalloc` on Linux.
   - Subsystems lazily initialized on first access.
5. **Lite Mode Toggle**:
   - One-click switch forcing Minimal skin + zero background + no globe + no pet.
   - Settings UI includes per-feature RAM budget table.

#### 4.3.2 Data Models & Struct Schemas
```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RamOptimizationSettings {
    pub discard_timeout_secs: u64,
    pub suspend_background_tabs: bool,
    pub renderer_process_limit: Option<u32>,
    pub lite_mode_enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FeatureRamBudget {
    pub feature_name: String,
    pub base_ram_mb: f64,
    pub active_ram_mb: f64,
    pub cpu_impact_percent: f64,
}
```

#### 4.3.3 Platform API Requirements
- WebView2: `ICoreWebView2_3::TrySuspend`, `ICoreWebView2_3::Resume`, `ICoreWebView2_4::put_MemoryUsageTargetLevel`.
- Rust allocator: `mimalloc::MiMalloc` as `#[global_allocator]` on Windows; `jemallocator::Jemalloc` on Linux.

#### 4.3.4 Invariants & Dependencies
- **Invariants**: INV-01 (asset isolation), INV-06 (honest security trade-offs).
- **Dependencies**: Milestones R0 and R1 (requires platform trait and workspace state).

#### 4.3.5 Acceptance Criteria & Verification Methods
- [ ] Minimal UI webview consumes < 60 MB Private Working Set at idle.
- [ ] Crazy UI webview consumes < 120 MB Private Working Set at effects level 50.
- [ ] 10 open tabs consume at least 15% less Private Working Set than Chrome on identical URLs (`benchmark.ps1`).
- [ ] Background tabs suspend after inactivity interval, verifiable via WebView2 process memory reduction.

---

### 4.4 Milestone R3: Linux Platform Support

#### 4.4.1 Explicit Functional Features
1. **WebKitGTK 4.1 Implementation**:
   - Linux platform layer implementation using `wry` with `build_gtk` targeting a `gtk::Fixed` container.
   - Full support for X11 and Wayland windowing systems.
   - Custom client-side title bar, dragging, and window controls operational on both.
2. **OS Facility Replacements**:
   - Configuration and data storage migrated to XDG directories via `directories` crate.
   - Credentials migrated to Secret Service API via `keyring` crate.
   - Memory telemetry implemented using `/proc/<pid>/smaps_rollup` parsing PSS and Private WS.
   - GPU telemetry via sysfs `/sys/class/drm/card0/device/gpu_busy_percent` or NVML with graceful fallback to `"n/a"`.
3. **Content & Ad Blocker on Linux**:
   - `adblock-rust` rule compiler outputting byte-compiled filters to `WebKitUserContentFilterStore`.
   - Cosmetic filtering via injected CSS rules in `WebKitUserContentManager`.
4. **Userspace WireGuard & SOCKS5 Proxy**:
   - Embedded userspace WireGuard establishing a local SOCKS5 proxy on `127.0.0.1:<port>`.
   - WebKit proxy configured via `WebKitNetworkProxySettings` without root privileges.
   - Kill switch and WebRTC leak prevention.
5. **Packaging & Cross-Platform CI**:
   - Scripts generating `.deb` and AppImage packages.
   - GitHub Actions CI workflow building and testing Windows and Linux targets.

#### 4.4.2 Data Models & Struct Schemas
```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LinuxPlatformConfig {
    pub xdg_config_home: PathBuf,
    pub xdg_data_home: PathBuf,
    pub xdg_cache_home: PathBuf,
    pub wayland_detected: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProxyConfig {
    pub host: String,
    pub port: u16,
    pub proxy_type: ProxyType,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ProxyType {
    Socks5,
    Http,
}
```

#### 4.4.3 Platform API Requirements
- Linux WebKitGTK 4.1 C/Rust bindings: `webkit2gtk`, `gtk::Fixed`, `gtk::WidgetExt`, `WebKitUserContentFilterStore`, `WebKitUserContentManager`.
- Linux Secret Service DBus interface via `keyring`.

#### 4.4.4 Invariants & Dependencies
- **Invariants**: INV-07 (preserve security features), INV-08 (no faked Chrome extension APIs).
- **Dependencies**: Milestones R0, R1, R2.

#### 4.4.5 Acceptance Criteria & Verification Methods
- [ ] Application compiles and runs cleanly on Ubuntu 22.04 LTS under both X11 and Wayland.
- [ ] Telemetry displays real PSS from `/proc/<pid>/smaps_rollup`.
- [ ] `.deb` and AppImage packages build successfully.
- [ ] GitHub Actions CI workflow completes green on both Windows and Linux runners.

---

### 4.5 Milestone R4: Focus Mode & YouTube Restrictor

#### 4.5.1 Explicit Functional Features
1. **Focus Mode Engine**:
   - Modes: Study, Work, Deep.
   - Linked to Focus timer widget and workspaces (e.g. College workspace automatically activates Study mode).
2. **Category & Domain Blocking**:
   - Blocks social media, short-form video, and games in Rust navigation handler, new-window handler, and client SPA history hooks (`pushState`/`replaceState`/`popstate`).
   - Windows WebView2 listens to `SourceChanged` event in Rust.
3. **Calm Interstitial Page**:
   - Clean page displaying block reason, remaining focus time, 5-min pass option, and strict-mode delay/phrase.
4. **YouTube Study Filter (Client-Side Best Effort)**:
   - Removes Shorts: hides shelves and redirects `/shorts/:id` to `/watch?v=:id`.
   - Removes recommendations: replaces home feed with Study Home (search box + approved playlists), hides watch-page sidebar suggestions, end screens, and disables autoplay.
   - Educational Watch Gate: extracts category from `playerMicroformatRenderer.category` and permits only approved categories (Education, Science & Tech, Howto & Style) + channel allowlist.
   - Search results filter: hides matches against keyword/channel blocklists.
   - Rules maintained in an editable JSON data file (`youtube_rules.json`).

#### 4.5.2 Data Models & Struct Schemas
```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FocusModeConfig {
    pub active_mode: Option<String>,
    pub end_timestamp_secs: Option<u64>,
    pub is_strict: bool,
    pub blocked_categories: Vec<String>,
    pub custom_blocked_domains: Vec<String>,
    pub custom_allowed_domains: Vec<String>,
    pub daily_focused_minutes: u32,
    pub daily_blocked_attempts: u32,
    pub streak_days: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct YouTubeRules {
    pub shorts_redirect_enabled: bool,
    pub hide_home_feed: bool,
    pub hide_sidebar_recommendations: bool,
    pub hide_comments: bool,
    pub disable_autoplay: bool,
    pub approved_categories: Vec<String>,
    pub allowed_channels: Vec<String>,
    pub blocked_keywords: Vec<String>,
    pub blocked_channels: Vec<String>,
    pub dom_selectors: HashMap<String, String>,
}
```

#### 4.5.3 Platform API Requirements
- Navigation interception: `PlatformWebView::add_request_interceptor` or navigation-starting event.
- Injected scripts: `PlatformWebView::evaluate_script` and init script injection.

#### 4.5.4 Invariants & Dependencies
- **Invariants**: INV-02 (IPC gating), INV-08 (honest best-effort limits documented).
- **Dependencies**: Milestones R0 and R1 (workspaces integration).

#### 4.5.5 Acceptance Criteria & Verification Methods
- [ ] Navigating to blocked domain in Study mode displays interstitial.
- [ ] Client-side SPA navigation (e.g. YouTube `/shorts/` link click) redirects immediately to standard watch URL.
- [ ] Educational watch gate blocks entertainment video with explanatory gate.
- [ ] Daily stats track focused minutes and blocked count accurately.

---

### 4.6 Milestone R5: Visual Skins: Softer Dark & Mayank White

#### 4.6.1 Explicit Functional Features
1. **Softer Dark Skin**:
   - Zero neon bloom or over-saturated glows.
   - Muted warm/cool accents, soft layered gradients, 1px low-contrast borders.
   - Soft double shadows (subtle top-left highlight + deep bottom-right shadow; pressed inset state).
   - 1.5px muted search outline.
   - 4 soft dark palettes: Graphite, Slate, Mocha, Midnight Blue.
2. **Mayank White Skin**:
   - Floating pill address bar centered at top; tabs at top-left; controls at top-right.
   - Left rail card (icon buttons, Workspaces list with blue-dot active pill, "+ Add a space", brand chip).
   - Center hero: 3D logo tile, title, tagline with side lines, search bar with camera/mic/arrow, engine chips, shortcut tiles, 4 launch cards.
   - Right column: Time & Weather, Quick Notes, Focus, System Monitor.
   - Bottom-center dock pill; bottom-right search button.
   - Design Pillar A: Soft 3D neumorphic surfaces (#eef2f8 to #f7f9fc, 24-32px radii, double shadows, glossy blue 3D button).
   - Design Pillar B: Wind lines animation (curved swoosh shapes drifting at 30 FPS cap, mouse parallax).
   - Weather orb replacing 3D globe slot, with toggle to daylight Earth.
   - Performance: zero `backdrop-filter`, limited shadow blur radii.

#### 4.6.2 Data Models & Struct Schemas
```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkinThemeConfig {
    pub skin: String, // "minimal", "crazy", "softer_dark", "mayank"
    pub palette: Option<String>,
    pub custom_accent: Option<String>,
    pub wind_lines_enabled: bool,
    pub weather_orb_mode: bool,
}
```

#### 4.6.3 Platform API Requirements
- CSS variable rendering; 2D canvas animation for wind lines.

#### 4.6.4 Invariants & Dependencies
- **Invariants**: INV-01 (strict active skin code isolation), INV-03 (clean mock preview).
- **Dependencies**: Milestones R0, R2.

#### 4.6.5 Acceptance Criteria & Verification Methods
- [ ] Mock bridge preview displays Softer Dark and Mayank White skins cleanly with zero console errors.
- [ ] Mayank White skin contains zero `backdrop-filter` CSS properties.
- [ ] Wind lines animation maintains 30 FPS cap and freezes after 60s idle.
- [ ] Idle memory for Mayank White is within 120 MB Private Working Set budget.

---

### 4.7 Milestone R6: Interactive Modular Background Registry & Night Globe Upgrade

#### 4.7.1 Explicit Functional Features
1. **Modular Background Registry**:
   - Modular architecture with `mount(container)`, `pause()`, `resume()`, `destroy()` lifecycle.
   - Only active background module loaded in memory.
   - RAM/CPU estimates shown in picker modal.
   - Static picker thumbnails; live preview only on single item hover.
2. **Background Catalog (18 Styles)**:
   - Constellation, Aurora, Fluid ink (WebGL cursor-stirred), Gradient blobs, Starfield warp, Rain on glass, Sakura/snow, Fireflies, Synthwave grid, Ocean waves, Lava lamp, Wind lines, Soft clouds, Bokeh light, Water ripples, Gradient mesh, Solid/gradient, User image/video (720p cap).
   - Time-of-day automatic switcher.
3. **Eco Rules**:
   - 30 FPS cap, pause on hidden, drop to 10 FPS or freeze after 60s idle, auto-disable on battery saver, honor `prefers-reduced-motion`.
   - Single WebGL context.
4. **Night Globe Upgrade**:
   - 20% size increase via `--globe-size` CSS variable.
   - Single-channel R8 4096x2048 night-lights texture (~11 MB GPU) with mipmaps, anisotropic filtering, and warm twilight shader.
   - Optional Ultra 8192x4096 restricted to high-VRAM GPUs.
   - Verified NASA public domain imagery slot with documentation.

#### 4.7.2 Data Models & Struct Schemas
```javascript
// Background module contract
export interface BackgroundModule {
    id: string;
    name: string;
    ram_estimate_mb: number;
    cpu_estimate_percent: number;
    mount(container: HTMLElement): void;
    pause(): void;
    resume(): void;
    destroy(): void;
}
```

#### 4.7.3 Platform API Requirements
- WebGL 2.0 / WebGL 1.0 context, WebGL debug renderer info extension (`WEBGL_debug_renderer_info`).

#### 4.7.4 Invariants & Dependencies
- **Invariants**: INV-01 (active code isolation), INV-04 (NASA placeholder license documentation).
- **Dependencies**: Milestones R0, R2, R5.

#### 4.7.5 Acceptance Criteria & Verification Methods
- [ ] Switching backgrounds completely cleans up previous WebGL textures and listeners.
- [ ] Background animation halts immediately on `document.visibilityState === 'hidden'`.
- [ ] 4096x2048 night globe renders at 30 FPS with smooth day/night terminator.

---

### 4.8 Milestone R7: Customizable Launch Cards

#### 4.8.1 Explicit Functional Features
1. **Bottom 4 Launch Cards**:
   - Title, description, icon placeholder, and ordered action sequence.
   - Action types: open URLs in tab group, switch workspace, execute command palette action, launch local app via executable path + arguments.
2. **Local Application Execution Security**:
   - Direct execution via `std::process::Command::new(path).args(args)`.
   - Shell strings (`cmd.exe /c`, `sh -c`) strictly forbidden.
   - Backed by executable allowlist and interactive confirmation dialog before launch.
3. **Card Management & Presets**:
   - Edit mode with drag-and-drop reordering.
   - 3 to 6 card capacity.
   - JSON import and export.
   - Keyboard hotkeys: `Alt+1` through `Alt+4` (or `Alt+6`).
   - Presets: Stream Hub, Study, Dev, Creator.
   - Default cards: Quick Search, Command Palette, Stream Hub, Customize UI.

#### 4.8.2 Data Models & Struct Schemas
```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LaunchCard {
    pub id: String,
    pub title: String,
    pub description: String,
    pub icon: String,
    pub color: String,
    pub actions: Vec<CardAction>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum CardAction {
    OpenUrls {
        urls: Vec<String>,
        tab_group: Option<String>,
        workspace_id: Option<String>,
    },
    SwitchWorkspace {
        workspace_id: String,
    },
    ExecuteCommand {
        command_id: String,
    },
    LaunchLocalApp {
        executable_path: String,
        arguments: Vec<String>,
    },
}
```

#### 4.8.3 Platform API Requirements
- Native process spawning via Rust standard library `std::process::Command`.

#### 4.8.4 Invariants & Dependencies
- **Invariants**: INV-02 (IPC validation), INV-06 (honest security confirmation).
- **Dependencies**: Milestones R0, R1, R5.

#### 4.8.5 Acceptance Criteria & Verification Methods
- [ ] Launch card triggers URL batch into specified tab group and workspace.
- [ ] Launching local application shows confirmation dialog; does not execute if user cancels.
- [ ] Drag-and-drop reordering persists across sessions.
- [ ] JSON export/import works reliably.

---

### 4.9 Milestone R8: Extensions & Userscripts

#### 4.9.1 Explicit Functional Features
1. **Windows (WebView2) Browser Extensions**:
   - Enable browser extensions via raw COM handles (`AreBrowserExtensionsEnabled` / `AddBrowserExtension`).
   - Extension Manager UI: load unpacked folder or `.crx` / `.zip`, enable/disable, remove.
   - Permission inspection before activation.
   - Extensions disabled by default in Secure-mode sites and vault workspace.
   - No illegal scraping of Chrome Web Store.
2. **Linux (WebKitGTK) Userscripts Alternative**:
   - Userscripts engine (Tampermonkey-style) via `WebKitUserContentManager`.
   - Built-in content blocker, focus mode, and launch cards provide Linux parity.
3. **Threat Model Updates**:
   - Complete documentation of extension privileges, attack surfaces, and mitigations.

#### 4.9.2 Data Models & Struct Schemas
```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtensionInfo {
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: String,
    pub enabled: bool,
    pub permissions: Vec<String>,
    pub install_path: PathBuf,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserscriptInfo {
    pub id: String,
    pub name: String,
    pub match_patterns: Vec<String>,
    pub run_at: String, // "document-start", "document-end"
    pub enabled: bool,
    pub code: String,
}
```

#### 4.9.3 Platform API Requirements
- Windows: `ICoreWebView2Profile7::get_AreBrowserExtensionsEnabled`, `put_AreBrowserExtensionsEnabled`, `AddBrowserExtension`, `GetBrowserExtensions`.
- Linux: `WebKitUserContentManager`, `webkit_user_script_new`, `webkit_user_content_manager_add_script`.

#### 4.9.4 Invariants & Dependencies
- **Invariants**: INV-02 (IPC gating), INV-06 (threat model honesty), INV-08 (no faked Chrome extensions on Linux).
- **Dependencies**: Milestones R0, R1, R3.

#### 4.9.5 Acceptance Criteria & Verification Methods
- [ ] Loading unpacked extension on Windows enables extension functionality in WebView2.
- [ ] Extension permissions are rendered in UI prior to activation.
- [ ] WebKitGTK executes `@match` userscripts on Linux cleanly.
- [ ] Extensions are disabled in Vault workspace and incognito mode.

---

### 4.10 Milestone R9: Final Cross-Platform Polish & Deliverables

#### 4.10.1 Explicit Functional Features
1. **Comprehensive Documentation Package**:
   - Updated `README.md` with complete Linux system dependencies and NVIDIA/Wayland workarounds.
   - Updated Typed IPC Schema contract documentation (`ui/IPC_CONTRACT.md`).
   - Updated Threat Model document covering Linux components, userspace proxy, and browser extensions.
   - Complete enumerated list of all external PLACEHOLDER assets requiring user replacement.
   - Explicit attribution list of any external open-source code or assets adapted.
2. **Final Benchmark & Verification Suite**:
   - Execution of complete measurement suite across Windows and Linux.
   - Final reconciliation of memory targets and acceptance criteria.

#### 4.10.2 Data Models & Struct Schemas
```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlaceholderAssetCatalogEntry {
    pub asset_path: String,
    pub current_format: String,
    pub purpose: String,
    pub recommended_replacement_source: String,
    pub license_notes: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExternalCodeAttribution {
    pub component_name: String,
    pub source_url: String,
    pub license: String,
    pub adaptation_summary: String,
}
```

#### 4.10.3 Platform API Requirements
- Automated CI test execution on Windows and Linux runners.

#### 4.10.4 Invariants & Dependencies
- **Invariants**: INV-04 (placeholder catalog), INV-06 (honest threat model), INV-09 (complete files), INV-10 (attribution).
- **Dependencies**: Milestones R0 through R8.

#### 4.10.5 Acceptance Criteria & Verification Methods
- [ ] All acceptance criteria across R0-R9 pass and are checked off.
- [ ] `cargo clippy --all-targets -- -D warnings` passes with 0 warnings.
- [ ] `cargo test` passes all tests.
- [ ] Benchmark verifies memory guardrails (Minimal UI < 60 MB, Crazy/Mayank < 120 MB, 10 tabs 15% lower than Chrome).

---

## 5. Deep-Dive Specification Focus Areas

### 5.1 R0: Process Tree Metrics & Platform Trait Methods

#### 5.1.1 Process Tree Breakdown Table Across 5 States
The following metrics represent target Private Working Set / PSS baselines for the browser process tree:

| State | Rust Shell | UI WebView | Tab Renderers | GPU Process | Utility / Network | Total Private WS | Task Mgr Target |
|---|---|---|---|---|---|---|---|
| **1. Empty Window** | ~10 MB | ~28 MB | 0 MB (none) | ~18 MB | ~12 MB | **~68 MB** | ~68 MB |
| **2. NTP (Minimal)** | ~10 MB | ~35 MB | 0 MB (none) | ~20 MB | ~14 MB | **~79 MB** | ~79 MB |
| **2. NTP (Crazy 50% FX)** | ~10 MB | ~52 MB | 0 MB (none) | ~28 MB | ~16 MB | **~106 MB** | ~106 MB |
| **2. NTP (Mayank White)** | ~10 MB | ~48 MB | 0 MB (none) | ~26 MB | ~16 MB | **~100 MB** | ~100 MB |
| **3. 5 Active Tabs** | ~11 MB | ~42 MB | ~125 MB (5 tabs) | ~36 MB | ~22 MB | **~236 MB** | ~236 MB |
| **4. 10 Active Tabs** | ~12 MB | ~44 MB | ~260 MB (10 tabs) | ~44 MB | ~26 MB | **~386 MB** | ~386 MB |
| **5. Split View Active** | ~11 MB | ~42 MB | ~65 MB (2 active) | ~32 MB | ~20 MB | **~170 MB** | ~170 MB |

#### 5.1.2 Platform Trait Public Interface
```rust
pub trait PlatformWebView: Send + Sync {
    /// Navigate webview to target URL.
    fn navigate(&mut self, url: &str) -> anyhow::Result<()>;

    /// Evaluate JavaScript string asynchronously in webview context.
    fn evaluate_script(&self, js: &str) -> anyhow::Result<()>;

    /// Update dynamic layout rectangle bounds (pixel-exact).
    fn set_bounds(&mut self, bounds: PlatformRect) -> anyhow::Result<()>;

    /// Show native webview container.
    fn show(&mut self) -> anyhow::Result<()>;

    /// Hide native webview container.
    fn hide(&mut self) -> anyhow::Result<()>;

    /// Suspend webview execution and lower process priority.
    fn suspend(&mut self) -> anyhow::Result<()>;

    /// Resume webview execution to normal priority.
    fn resume(&mut self) -> anyhow::Result<()>;

    /// Set memory usage target level (Low vs Normal).
    fn set_memory_target_low(&mut self, low: bool) -> anyhow::Result<()>;

    /// Zoom factor (1.0 = 100%).
    fn set_zoom(&mut self, zoom: f64) -> anyhow::Result<()>;

    /// Cookie management.
    fn get_cookies(&self, url: &str) -> anyhow::Result<Vec<String>>;
    fn clear_cookies(&mut self) -> anyhow::Result<()>;
}

pub trait PlatformHost: Send + Sync {
    /// Create new child platform webview.
    fn create_webview(
        &mut self,
        window: &tao::window::Window,
        bounds: PlatformRect,
        url: &str,
        is_incognito: bool,
        user_data_dir: Option<&Path>,
    ) -> anyhow::Result<Box<dyn PlatformWebView>>;

    /// Sample current browser process tree memory breakdown.
    fn sample_memory(&self) -> anyhow::Result<BrowserMemoryBreakdown>;

    /// Access native OS clipboard.
    fn read_clipboard(&self) -> Option<String>;
    fn write_clipboard(&self, text: &str) -> anyhow::Result<()>;
}
```

---

### 5.2 R4: Focus Modes & YouTube Study Filter

#### 5.2.1 Focus Mode Architecture & Interstitial Engine
- **Categories Enforced**:
  - `SocialMedia`: `facebook.com`, `instagram.com`, `twitter.com`, `x.com`, `reddit.com`, `tiktok.com`, `threads.net`, `linkedin.com`.
  - `ShortFormVideo`: `tiktok.com`, `instagram.com/reels`, `youtube.com/shorts`.
  - `Games`: `twitch.tv`, `discord.com`, `roblox.com`, `steampowered.com`, `epicgames.com`, `chess.com`.
- **Enforcement Pipeline**:
  ```
  User Request / SPA Navigation
                 │
                 ▼
  ┌──────────────────────────────┐
  │ Rust Navigation Starting /   │
  │ JS pushState Interceptor     │
  └──────────────┬───────────────┘
                 │
                 ▼
     Is Focus Mode Active?
        ├── NO  ─► Allow Navigation
        └── YES ─► Check Category / Blocklist
                     ├── NOT Blocked ─► Allow Navigation
                     └── Blocked ────► Serve `rusty://app/blocked.html`
  ```

#### 5.2.2 YouTube Study Filter Specification
1. **Shorts Removal & Redirection**:
   - URL Matcher: `https://www.youtube.com/shorts/:id`
   - Redirection: `https://www.youtube.com/watch?v=:id` (applied in navigation handler and client script).
   - Injected CSS:
     ```css
     ytd-rich-shelf-renderer[is-shorts],
     ytd-reel-shelf-renderer,
     a[title="Shorts"],
     ytd-guide-entry-renderer:has(a[href*="/shorts"]),
     ytd-mini-guide-entry-renderer:has(a[href*="/shorts"]) {
         display: none !important;
     }
     ```
2. **Recommendations Removal & Study Home**:
   - Hide Home Feed:
     ```css
     ytd-browse[page-subtype="home"] #contents.ytd-rich-grid-renderer {
         display: none !important;
     }
     ```
   - Study Home Injection: When on `https://www.youtube.com/`, injects a centered study interface:
     - Prominent search box targeting `https://www.youtube.com/results?search_query=...`.
     - User-curated approved educational playlists and course links.
   - Hide Watch Sidebar & Autoplay:
     ```css
     #related,
     ytd-watch-next-secondary-results-renderer,
     .ytp-endscreen-content,
     .ytp-ce-element {
         display: none !important;
     }
     ```
3. **Educational-Only Watch Gate (Client-Side JS)**:
   - Primary category extraction logic:
     ```javascript
     function getYouTubeVideoCategory() {
         try {
             // 1. Direct player microformat API
             const cat = window.ytInitialPlayerResponse?.microformat?.playerMicroformatRenderer?.category;
             if (cat) return cat.trim();

             // 2. Meta genre tag fallback
             const meta = document.querySelector('meta[itemprop="genre"]');
             if (meta && meta.content) return meta.content.trim();

             // 3. Fallback to response text regex
             const match = document.documentElement.innerHTML.match(/"category"\s*:\s*"([^"]+)"/);
             if (match) return match[1];
         } catch (e) {
             console.warn("[study-filter] Category extraction failed", e);
         }
         return null;
     }
     ```
   - Whitelist validation:
     Default allowed categories: `["Education", "Science & Technology", "Howto & Style"]`.
     If video category does not match allowlist (and channel is not in channel allowlist):
     - Immediately pause HTML5 video (`video.pause()`).
     - Render study gate overlay over video viewport (`#player-container`).
     - Show: "Study Gate: This video is classified as '[Category]'. Approved categories for Study Mode are Education, Science & Technology, and Howto & Style."
     - Action buttons: "Search Educational Content", "Allow 5-min Pass", "Add Channel to Allowlist".

---

### 5.3 R8: WebView2 Extensions vs Linux WebKitGTK Userscripts

#### 5.3.1 Windows WebView2 Browser Extensions
- **Raw COM API Mapping**:
  ```rust
  #[cfg(target_os = "windows")]
  pub unsafe fn enable_webview2_extensions(profile: *mut ICoreWebView2Profile7) -> anyhow::Result<()> {
      let mut enabled: BOOL = 0;
      (*profile).get_AreBrowserExtensionsEnabled(&mut enabled);
      if enabled == 0 {
          (*profile).put_AreBrowserExtensionsEnabled(1);
      }
      Ok(())
  }

  #[cfg(target_os = "windows")]
  pub unsafe fn install_browser_extension(
      profile: *mut ICoreWebView2Profile7,
      extension_dir: &Path,
      completed_handler: ICoreWebView2AddBrowserExtensionCompletedHandler,
  ) -> anyhow::Result<()> {
      let wide_path = to_wide_string(extension_dir.to_str().unwrap());
      (*profile).AddBrowserExtension(wide_path.as_ptr(), completed_handler);
      Ok(())
  }
  ```
- **Permission Inspection**:
  Before activation, parse `manifest.json`:
  - Enumerate `permissions`, `optional_permissions`, and `host_permissions`.
  - Warn user if extension requests `<all_urls>`, `webRequestBlocking`, or `nativeMessaging`.

#### 5.3.2 Linux WebKitGTK Userscripts Engine
- **Userscript Injection Pipeline**:
  ```rust
  #[cfg(target_os = "linux")]
  pub fn inject_userscript(
      manager: &webkit2gtk::UserContentManager,
      script_content: &str,
      run_at: webkit2gtk::UserScriptInjectionTime,
      allow_patterns: &[&str],
  ) {
      let user_script = webkit2gtk::UserScript::new(
          script_content,
          webkit2gtk::UserContentInjectedFrames::AllFrames,
          run_at,
          allow_patterns,
          &[],
      );
      manager.add_script(&user_script);
  }
  ```

---

### 5.4 R9: Final Deliverables, Threat Model & Asset Catalog

#### 5.4.1 Comprehensive Deliverables Checklist
1. **Production Executables**:
   - Windows 11 x64: `dist/rusty_browser.exe` (release build with LTO).
   - Linux x64: `dist/rusty-browser.deb` and `dist/rusty-browser.AppImage`.
2. **Configuration & Documentation**:
   - `README.md`: Linux setup (`libwebkit2gtk-4.1-dev`, `libgtk-3-dev`), Wayland/NVIDIA flags (`WEBKIT_DISABLE_DMABUF_RENDERER=1`).
   - `ui/IPC_CONTRACT.md`: Complete bidirectional typed IPC specification.
   - `THREAT_MODEL.md`: Updated threat model including Linux DBus, Secret Service, Userscripts, and WebView2 extensions.
   - `PLACEHOLDERS.md`: Complete catalog of placeholder assets.
   - `ATTRIBUTIONS.md`: Open-source attribution and provenance log.

#### 5.4.2 Threat Model Analysis Matrix

| Threat Category | Attack Vector | Security Boundary & Mitigation |
|---|---|---|
| **Untrusted Web IPC** | Malicious web page attempts to invoke privileged backend IPC | Strict origin gating: IPC handler rejects messages originating outside `rusty://app/`. External tabs restricted to safe accelerator intents (`new_tab`, `close_current_tab`). |
| **Extension Sandbox Escape** | Compromised browser extension attempts to read host filesystem | Extensions run in WebView2 extension sandbox; extensions are disabled in Vault workspace and Incognito mode; permissions audited before activation. |
| **Local App Execution** | Malicious launch card executes arbitrary shell commands | Direct `std::process::Command` execution with no shell string parsing; strictly enforced executable allowlist; interactive user confirmation modal before execution. |
| **Linux DBus Hijack** | Malicious local process snooping Secret Service credentials | Secret Service items scoped to `org.freedesktop.secrets` with application-specific attributes; session encryption used where supported. |
| **DNS / WebRTC Leak** | VPN proxy active but browser leaks requests via WebRTC or direct DNS | WebRTC ICE candidate policy set to `DisableNonProxiedUdp`; DNS queries routed through local SOCKS5 proxy tunnel. |

#### 5.4.3 PLACEHOLDER Asset Catalog

| # | Asset Path | Current Status | Description & Replacement Guidance |
|---|---|---|---|
| 1 | `ui/assets/earth-day.webp` | PLACEHOLDER | Low-res (<=1024px) placeholder day texture. Replace with verified public domain NASA Blue Marble imagery. |
| 2 | `ui/assets/earth-night.webp` | PLACEHOLDER | Low-res (<=1024px) placeholder night texture. Replace with high-resolution single-channel R8 4096x2048 NASA Black Marble imagery. |
| 3 | `ui/assets/earth-fallback.webp` | PLACEHOLDER | Static pre-rendered fallback image for 0% effects or non-WebGL environments. |
| 4 | `ui/assets/logo.svg` | PLACEHOLDER | Geometric "R" placeholder logo. Replace with final branded SVG icon. |
| 5 | `ui/js/pet-crazy.js` (SVG Species) | PLACEHOLDER | Procedural geometric SVG species (Dog, Cat, Robot, Fox, Slime). Replace with production vector character sprites. |
| 6 | `ui/js/icons.js` (Icon Paths) | PLACEHOLDER | Hand-drawn SVG path dictionary for toolbar and menu icons. |

---

## 6. Interface Contracts

### 6.1 Rust Core <-> Platform Layer Contract
- Asynchronous message passing between the Tao event loop and platform webviews via `tao::event_loop::EventLoopProxy<UserEvent>`.
- Zero raw platform headers in business logic (`tab.rs`, `storage.rs`, `weather.rs`).

### 6.2 Rust Core <-> UI WebView IPC Contract
- Bidirectional JSON protocol over `rusty://app/`.
- UI to Rust via `window.ipc.postMessage(JSON.stringify(msg))`.
- Rust to UI via `window.__onRustMessage(msg)`.

### 6.3 Workspaces <-> Focus Mode Contract
- Workspaces contain optional `focus_mode_id`. When workspace is activated, Rust automatically engages the associated focus mode and configures category filters.

### 6.4 Launch Cards <-> Local Process Contract
- Action payload `LaunchLocalApp { executable_path, arguments }` validated against allowlist and presented to user via UI confirmation dialog before `std::process::Command::spawn()`.

---

## 7. Verification & Testing Strategy

| Level | Target | Test Commands & Verification Harness |
|---|---|---|
| **Unit Tests** | Rust core data structures (TabManager, Storage, Weather, URL resolver, Workspaces) | `cargo test` (all 48+ unit tests passing) |
| **Linting & Code Quality** | Entire codebase (Windows & Linux) | `cargo clippy --all-targets -- -D warnings` (0 warnings permitted) |
| **Mock Bridge Preview** | Frontend UI & Skins standalone validation | Open `file:///D:/browser/ui/index.html` in browser; verify console has 0 errors |
| **Memory Benchmarks** | Process-tree Private Working Set verification vs Chrome | `powershell -ExecutionPolicy Bypass -File .\benchmark.ps1` and `.\verify_memory.ps1` |
| **Cross-Platform CI** | Multi-platform build & test validation | GitHub Actions workflow (`.github/workflows/ci.yml`) on `windows-latest` and `ubuntu-22.04` |
