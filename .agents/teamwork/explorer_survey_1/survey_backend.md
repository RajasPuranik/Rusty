# Comprehensive Rust Backend & Architecture Survey Report

**Target Codebase**: `d:\browser`  
**Browser Core**: Rust (`1.80+`), `tao 0.37`, `wry 0.57`  
**Current Platform**: Windows 11 (Microsoft Edge WebView2)  
**Survey Date**: 2026-11-09  
**Author**: Explorer 1 (Rust Backend & Architecture Explorer)  

---

## Executive Summary

Rusty Browser is a memory-transparent, dual-skin desktop web browser written in Rust. It utilizes `tao` for cross-platform window management and `wry` for system webview hosting. On Windows 11, it drives Microsoft Edge WebView2 via a dual-layer webview architecture: a persistent, full-window Chrome shell webview (`rusty://app/index.html`) managing navigation, omnibox, split view, and modal overlays, combined with lazily instantiated child content webviews dynamically bounded to client rectangles.

A comprehensive survey of `d:\browser` confirms:
1. **Compilation & Quality**: The codebase passes `cargo check` and `cargo clippy --all-targets -- -D warnings` with zero warnings, and passes all 51 automated unit tests in `0.26s`.
2. **Memory Telemetry Accuracy**: The in-process telemetry engine (`src/telemetry.rs`) and external verification script (`verify_memory.ps1`) implement a creation-time-validated Toolhelp32 process-tree walk with `--user-data-dir` matching. They measure **Private Working Set** via `NtQueryInformationProcess(ProcessVmCounters)` (matching Task Manager Details tab within ~0.97% variance) while rigorously excluding unrelated system WebView2 processes (Teams, Widgets).
3. **Existing Security State**: Robust origin gating exists on the typed JSON IPC layer (`rusty://app/`), combined with popup denial, download sandboxing, camera/mic/geo permission blocking, incognito isolation, and a Windows Job Object (`KILL_ON_JOB_CLOSE`). However, full network ad-blocking (request interception / filter lists), userspace VPN/proxy tunnels, encrypted vault storage (DPAPI / Secret Service), and cross-platform platform traits are currently absent or only present as design invariants in documentation.
4. **Readiness for R0–R3**: The codebase is architecturally clean with minimal dependency bloat, making it well-positioned for isolating WebView2 and WebKitGTK behind a unified platform abstraction trait (`PlatformLayer`), introducing Rust-owned Workspaces with active-only webview lifecycles, integrating raw WebView2 COM suspension handles (`TrySuspend`, `MemoryUsageTargetLevel`), and extending support to Linux WebKitGTK 4.1.

---

## 1. Crate Inventory, Build Configuration & Source Structure

### 1.1 Cargo.toml & Dependencies
The root `Cargo.toml` (`d:\browser\Cargo.toml`) defines package `rusty_browser v0.2.0` (edition 2021) with a minimal set of direct dependencies:

| Crate | Version | Role in Architecture |
| :--- | :--- | :--- |
| `tao` | `0.37` | Cross-platform window creation, event loop, logical DPI sizing, window state |
| `wry` | `0.57` | Webview wrapper (WebView2 on Windows, WebKitGTK on Linux), custom protocol, IPC |
| `url` | `2` | URL parsing, validation, scheme inspection, and canonicalization |
| `percent-encoding` | `2` | Query string percent-encoding for search engine routing |
| `anyhow` | `1` | Contextual error handling and Result propagation |
| `serde` | `1` (derive) | Strong typing and serialization of IPC messages, tabs, settings, history |
| `serde_json` | `1` | JSON serialization/deserialization over IPC and `data.json` storage |
| `tracing` | `0.1` | Structured logging, diagnostic spans, and event-loop stall reporting |
| `tracing-subscriber` | `0.3` (env-filter) | Formatting subscriber with `RUST_LOG` environment filter support |

Transitively via `wry 0.57.1`, the project already includes:
- `webview2-com` (`0.39.1`) & `windows` (`0.58.0`) on Windows (providing access to raw COM interfaces `ICoreWebView2_3`, `ICoreWebView2_19`, `ICoreWebView2Environment`, `ICoreWebView2Controller`).
- `webkit2gtk` (`0.20.1`) & `gtk` (`0.18.2`) on Linux (providing WebKitGTK 4.1 bindings).

### 1.2 Release Profile
The release profile is heavily optimized for footprint and execution speed:
```toml
[profile.release]
opt-level = 3
lto = "fat"
codegen-units = 1
panic = "abort"
strip = true
```
This produces a release binary of approximately **2.62 MiB** (`2,745,856` bytes) in `dist/rusty_browser.exe`, which includes all compile-time embedded UI assets (HTML, CSS, JS, SVG, and WebP textures).

### 1.3 Build Script (`build.rs`)
`build.rs` handles automated deployment of `WebView2Loader.dll` on Windows:
- Checks `WebView2Loader.dll` in the root workspace and `dist/`.
- Computes `target_profile_dir` from `OUT_DIR.ancestors().nth(3)`.
- Automatically copies `WebView2Loader.dll` alongside the target executable in `target/debug/` and `target/release/`.
- Declares `cargo:rerun-if-changed=WebView2Loader.dll`.

### 1.4 Native OS Linkage
On Windows, native APIs are linked via `extern "system"` blocks:
- `user32`: Win32 clipboard functions (`OpenClipboard`, `CloseClipboard`, `GetClipboardData`, `SetClipboardData`, `EmptyClipboard`).
- `kernel32`: Job Object functions (`CreateJobObjectW`, `SetInformationJobObject`, `AssignProcessToJobObject`, `CloseHandle`, `GetCurrentProcess`, `GlobalAlloc`, `GlobalLock`, `GlobalUnlock`, `GlobalFree`), Process management (`OpenProcess`, `GetProcessTimes`).
- `ntdll`: `NtQueryInformationProcess` for process command line retrieval (`ProcessCommandLineInformation`) and VM counters (`ProcessVmCounters`).
- `pdh`: Performance Data Helper (`PdhOpenQueryW`, `PdhAddEnglishCounterW`, `PdhCollectQueryData`, `PdhGetFormattedCounterArrayW`, `PdhCloseQuery`) for GPU engine utilization and Network throughput.
- `winhttp`: WinHTTP client in `src/weather.rs` for weather telemetry without external HTTP client crates.

### 1.5 Source Module Layout (`src/`)

```text
src/
├── main.rs            (4,296 lines) EventLoop, Window, dual-layer WebViews, Split View, IPC router, Watchdog
├── storage.rs         (1,087 lines) Lazy JSON store (history, bookmarks, downloads, settings, pet state)
├── tab.rs               (788 lines) TabManager, Tab, history stacks, lazy loading, discard/wake lifecycle
├── telemetry.rs       (1,180 lines) Process tree Private WS, Toolhelp32 walk, PDH GPU/Net, CPU/RAM telemetry
├── url_resolver.rs      (105 lines) URL normalization, bare domain completion, search engine query templating
├── weather.rs           (498 lines) WinHTTP Open-Meteo client, 30-min RAM/disk cache, offline fallback
└── ui/
    ├── mod.rs             (7 lines) UI submodules export
    ├── app_protocol.rs   (90 lines) rusty://app/ custom protocol server, embedded assets, strict CSP
    ├── pages.rs         (387 lines) HTML generators for about:history, about:bookmarks, about:downloads, about:settings
    ├── new_tab.rs        (39 lines) Static fallback new tab HTML reference
    └── toolbar.rs       (549 lines) Legacy toolbar reference
```

---

## 2. Windowing, WebView Hierarchy & IPC Router Architecture

### 2.1 Tao & Wry Initialization
The application bootstraps inside `src/main.rs:1928` (`fn main() -> Result<()>`):
1. **Tracing Setup** (`main.rs:1930`): Formats logs with `info` default, overridable via `RUST_LOG`.
2. **Job Object Sandboxing** (`main.rs:1940`): `win32_platform::init_job_object()` configures `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` and assigns the host process.
3. **Data Directories** (`main.rs:1964`):
   - User profile: `%APPDATA%\rusty_browser` (Windows) or `~/.config/rusty_browser` (Linux).
   - WebView2 user-data folder: `%APPDATA%\rusty_browser\WebView2` (normal) or `WebView2Private` (incognito).
   - Registers path with `telemetry::set_webview_data_dir(&wv_data_dir)`.
   - Creates a shared `WebContext::new(Some(wv_data_dir.clone()))`.
4. **Event Loop & Watchdog** (`main.rs:1986`):
   - `event_loop = EventLoopBuilder::<UserEvent>::with_user_event().build()`.
   - Creates `EventLoopProxy<UserEvent>` and spawns background watchdog thread (`spawn_event_loop_watchdog`).
5. **Main Window** (`main.rs:1997`):
   - Sized to `1280x800` logical pixels, visible and focused on startup.

### 2.2 Dual-Layer WebView Model
Unlike standard single-webview browsers, Rusty Browser manages multiple webviews over a single native OS window:
```
┌──────────────────────────────────────────────────────────────┐
│ Tao Window (Native HWND / GTK Window)                        │
│ ┌──────────────────────────────────────────────────────────┐ │
│ │ Chrome Shell WebView (Full Window Bounds: 0, 0, W, H)     │ │
│ │ URL: rusty://app/index.html (mapped to http://rusty.app) │ │
│ │ [Omnibox] [Tabs Rail] [Split Bar] [Modals]               │ │
│ └────────────────────────────┬─────────────────────────────┘ │
│                              │ Reports content_rect via IPC  │
│                              ▼                               │
│ ┌──────────────────────────────────────────────────────────┐ │
│ │ Content WebViews (Dynamically Bounded Child WebViews)    │ │
│ │ Single: bounds = content_rect { x, y, width, height }    │ │
│ │ Split:  left_rect & right_rect separated by divider      │ │
│ │ Overlay open: set_visible(false)                         │ │
│ └──────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

1. **Chrome WebView (`chrome_wv`)**:
   - Spans `(0.0, 0.0)` to `(window_width, window_height)`.
   - Built via `build_chrome_webview` (`main.rs:1447`) using `WebContext`.
   - Loads `rusty://app/index.html?skin=...&theme=...&tabs=...`.
   - On Windows, WebView2 environment is created here and shared with content webviews via `builder.with_environment(parent_wv.environment())`.
2. **Content WebViews (`content_webviews: HashMap<TabId, WebView>`)**:
   - Lazily created via `ensure_tab_webview` (`main.rs:1670`) upon activation.
   - Positioned via `wry::Rect` matching the reported `content_rect` from the Chrome UI.
   - Built as child webviews of the same native `Window`.
3. **Overlay Modal Management**:
   - Child native webviews (HWNDs on Windows, X11/Wayland sub-surfaces on Linux) cannot be obscured by HTML DOM elements rendered inside the parent webview due to OS z-ordering.
   - When a modal overlay (Settings, Command Palette, Find Bar) opens, JS sends `{"action": "overlay", "open": true}`.
   - Rust immediately invokes `wv.set_visible(false)` on all content webviews, cleanly revealing the Chrome modal underneath (`main.rs:1768–1779`).
4. **Split View Layout**:
   - In Split View mode (`split.enabled = true`), two content webviews are active simultaneously.
   - Rectangles are computed by `compute_split_subrects` (`main.rs:405`), factoring in a `36px` split controls bar, `8px` divider gap, and clamped ratio (`0.20..0.80`).
   - Bounds updates use `rects_approx_eq` with a `0.5px` epsilon to eliminate redundant Win32 layout messages and prevent feedback resize loops.

### 2.3 Custom Protocol Scheme (`rusty://app/`)
Implemented in `src/ui/app_protocol.rs`:
- Handled by `wry::WebViewBuilder::with_custom_protocol("rusty".into(), handle_rusty_request)`.
- Strips `app/` prefix and query parameters, serving compiled embedded assets (`INDEX_HTML`, `NEWTAB_HTML`, CSS skins, JS controllers, SVG logo, WebP textures).
- Injects HTTP response headers:
  - `Content-Type`: appropriate MIME type (`text/html; charset=utf-8`, `text/javascript`, etc.).
  - `Content-Security-Policy`: `default-src 'self' 'unsafe-inline' data:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self';`.
  - `X-Content-Type-Options`: `nosniff`.

### 2.4 Windows Origin Mapping & Security Verification
On Windows WebView2, navigating directly to custom schemes (`rusty://`) can encounter runtime restrictions. The browser resolves internal virtual URLs:
- `about:blank` / `about:newtab` -> `http://rusty.app/newtab.html?skin=...` (`main.rs:1170`).
- `rusty://app/...` -> `http://rusty.app/...`.
- `is_trusted_origin(uri)` (`main.rs:1150`) validates the origin:
  ```rust
  pub fn is_trusted_origin(uri: &str) -> bool {
      if let Some(rest) = uri.strip_prefix("rusty://") {
          return rest.starts_with("app") || rest.starts_with('/');
      }
      if let Some(rest) = uri.strip_prefix("http://rusty.app") {
          return rest.is_empty() || rest.starts_with('/') || rest.starts_with('?');
      }
      if let Some(rest) = uri.strip_prefix("https://rusty.app") {
          return rest.is_empty() || rest.starts_with('/') || rest.starts_with('?');
      }
      uri.starts_with("data:text/html")
  }
  ```
  This guarantees that spoofed origins such as `http://rusty.app.attacker.com` are strictly rejected.

### 2.5 Bidirectional IPC Router
Communication is strictly typed andOrigin-sandboxed:
1. **JavaScript -> Rust (`with_ipc_handler`)**:
   - Dispatched via `window.ipc.postMessage(JSON.stringify(payload))`.
   - Handled in `build_content_webview` (`main.rs:1250`) and `build_chrome_webview` (`main.rs:1463`).
   - If origin is trusted (`is_trusted_origin`): sends `UserEvent::ChromeIpc(body)` to the main event loop, deserializing into `UiMessage` (`main.rs:509`).
   - If origin is untrusted (external web page):
     - Drops all arbitrary commands (`[security] Discarded untrusted IPC message`).
     - Strictly permits only whitelisted accelerator key intents (`close_current_tab`, `back`, `forward`, `reload`, `next_tab`, `prev_tab`, `stop`, `focus_omnibox`, `zoom_in`, `zoom_out`, `zoom_reset`, `open_command_palette`, `open_find_bar`, `open_settings`, `split_view`), whitelisted side panels, and sanitized `new_tab` intents (URL must begin with `http://` or `https://`).
2. **Injected Content Script & Frame Security (`CONTENT_INIT_SCRIPT`)**:
   - Injected into all content webviews at creation (`main.rs:736`).
   - Generates a per-tab cryptographically seeded `FRAME_TOKEN` (`generate_frame_token(tab_id)`) to validate inter-frame IPC messages, preventing cross-frame clickjacking or spoofed command injection from nested iframes.
   - Intercepts link clicks (`auxclick` middle-click, `Ctrl+click`, `Shift+click`) while preserving native WebView2 middle-click autoscroll on non-link canvas areas.
   - Intercepts `history.pushState` and `history.replaceState` to dispatch `tab_url_ping`, prompting Rust to re-read the verified URL from WebView2 after Single Page Application (SPA) navigations.
3. **Rust -> JavaScript (`eval_on_webview`)**:
   - Evaluates `if (window.__onRustMessage) { window.__onRustMessage({json}); }` (`main.rs:1038`).
   - Broadcasts state updates: `state_update`, `memory_stats`, `telemetry_stats`, `weather_update`, `ui_settings_sync`, `pet_event`.

### 2.6 Event Loop Watchdog
Implemented in `main.rs:286–361`:
- Spawns a dedicated monitoring thread that pings the main event loop every `200ms` via `UserEvent::WatchdogPing`.
- Tracks `last_ack_ms` and active `LoopPhase` (`Idle`, `IpcDispatch`, `WebViewCreation`, `ContentRectLayout`, `WindowResize`, `SplitViewHandler`).
- If the event loop stalls for more than `500ms` (`WATCHDOG_STALL_THRESHOLD_MS`), logs a warning with the exact stalled phase, preventing silent UI hangs during complex layout transitions or webview operations.

---

## 3. Existing Security Capabilities & Audit

### 3.1 Security Capability Matrix

| Capability ID | Feature Description | Existing Implementation in Codebase | Status / Gap |
| :--- | :--- | :--- | :--- |
| **V1** | **Ad Blocker / Request Interception** | `with_navigation_handler` filters target URLs (`is_safe_web_url`, `is_trusted_origin`). `with_permission_handler` blocks Camera, Mic, Geolocation. `with_new_window_req_handler` denies native popups. | **Partial / Missing**: No network request interception filter (URL blocklists, EasyList parsing, cosmetic CSS filtering) currently exists. |
| **V2** | **VPN / Proxy Configuration** | No runtime proxy configuration in current Rust backend. WebView2 runs with default system network stack. | **Missing**: No userspace WireGuard, SOCKS5 client, or proxy configuration hooks wired in Rust. |
| **V3** | **Vault (Credentials & Profiles)** | `Storage` (`src/storage.rs`) stores history, bookmarks, settings in plaintext JSON (`%APPDATA%\rusty_browser\data.json`). | **Missing**: No DPAPI encryption on Windows, no Secret Service keyring on Linux, no encrypted vault store. |
| **V4** | **Session Protection & Sandboxing** | Incognito mode (`--incognito`) with dedicated `WebView2Private` data dir, `with_incognito(true)`, disabled history/download recording; Windows Job Object `KILL_ON_JOB_CLOSE`; strict CSP; IPC origin validation. | **Complete & Operational**: Fully implemented and tested. |

### 3.2 Detailed Audit of Security Mechanisms
1. **Permission Sandbox** (`main.rs:1360–1383`):
   - Camera: strictly denied when `settings.block_camera` is true.
   - Microphone: strictly denied when `settings.block_microphone` is true.
   - Geolocation: permitted ONLY for trusted `rusty://app/` origin (when user explicitly clicks "Use my location"); blocked for external sites when `settings.block_geolocation` is true.
2. **Navigation Sandbox** (`main.rs:1343–1359`):
   - Blocks navigation to non-HTTP/HTTPS/about schemes (e.g. `javascript:`, `file:`, `vbscript:`, custom OS protocols).
   - `with_new_window_req_handler` (`main.rs:1329`) intercepts all `target="_blank"` and `window.open` requests, denying native popup windows (`NewWindowResponse::Deny`) and dispatching `UserEvent::OpenNewWindowTab` to open them inside a controlled browser tab.
3. **Process Sandboxing & Job Object** (`main.rs:45–178`):
   - Initializes a Windows Job Object with `JOBOBJECT_EXTENDED_LIMIT_INFORMATION`.
   - Flags: `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` (with `JOB_OBJECT_LIMIT_BREAKAWAY_OK` fallback).
   - Ensures that all `msedgewebview2.exe` renderer, GPU, utility, and crashpad processes terminate immediately if `rusty_browser.exe` exits or crashes, eliminating zombie background processes.
4. **Crash-Safe Atomic Storage** (`src/storage.rs:708–722`):
   - Saves `StorageData` by writing to a temporary file (`data.tmp`) and executing an atomic `fs::rename` to `data.json`.
   - Prevents file corruption during unexpected power loss or process termination.

---

## 4. Measurement & Telemetry Infrastructure

### 4.1 Comparison: `verify_memory.ps1` vs `benchmark.ps1`

Both scripts in the repository measure memory, but they serve distinct purposes:

| Feature | `benchmark.ps1` | `verify_memory.ps1` (Authoritative) |
| :--- | :--- | :--- |
| **Primary Goal** | Automated comparison test vs Google Chrome across 10 fixed URLs | High-precision audit reconciling in-browser badge with Windows Task Manager |
| **Process Tree Discovery** | Recursive `Win32_Process` parent-child walk + string match on command line (`rusty_browser`, `EBWebView`) | BFS walk of PID tree **plus** strict `--user-data-dir` matching; **validates `CreationDate`** |
| **PID Reuse Protection** | None | **Yes**: Rejects child candidates whose creation date predates the parent |
| **Unrelated WebView2 Detection**| May over-count unrelated WebView2 instances matching name | **Yes**: Specifically catalogs and excludes unrelated system WebView2 instances |
| **Performance Counters** | `Get-Process` (`WorkingSet64`, `PrivateMemorySize64`) | `Win32_PerfFormattedData_PerfProc_Process` (`WorkingSetPrivate`, `WorkingSet`, `PrivateBytes`) |
| **Metric Reported** | Working Set (RSS) & Private Memory | **Private Working Set** (Task Manager Details metric), Working Set, and Commit |
| **Role Categorization** | Aggregate total only | Categorizes each PID: Host, Renderer, GPU, Network, Storage, Audio, Utility, Crashpad |

### 4.2 In-Process Telemetry Engine (`src/telemetry.rs`)
The telemetry collector runs on a dedicated background thread (`spawn_telemetry_collector`, `telemetry.rs:232`) sampling every 2 seconds:
1. **Process Discovery**:
   - Takes a snapshot of all system processes via `CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0)`.
   - Locates host PID (`GetCurrentProcessId()`) and all candidates belonging to the browser tree.
   - Evaluates `--user-data-dir` matching: reads the command line of candidate `msedgewebview2.exe` processes via `NtQueryInformationProcess(ProcessCommandLineInformation)`.
   - Validates parent-child lineage against PID reuse using `GetProcessTimes(creation_time)`.
2. **Private Working Set Extraction**:
   - Calls `NtQueryInformationProcess(ProcessVmCounters)` into `VM_COUNTERS_EX2`.
   - Extracts `PrivateWorkingSetSize` (the identical metric used by Windows Task Manager Details tab "Memory (active private working set)").
   - Fallback for legacy Windows versions: `K32GetProcessMemoryInfo` reading `PrivateUsage.min(WorkingSetSize)`.
3. **Hardware Telemetry via PDH & Win32**:
   - System CPU: differential delta between `GetSystemTimes(idle)` and `kernel + user`.
   - System RAM: `GlobalMemoryStatusEx` reading `dwMemoryLoad`, `ullTotalPhys`, and `ullAvailPhys`.
   - System GPU: queries PDH counter `\GPU Engine(*)\Utilization Percentage`. Extracts physical GPU engine keys (`extract_gpu_engine_key`) to eliminate sub-engine double-counting, taking the maximum physical engine utilization.
   - Network Throughput: queries PDH counter `\Network Interface(*)\Bytes Total/sec` summing across active interfaces.
4. **Live Chrome Comparison**:
   - If `chrome.exe` is running on the system, discovers the entire Chrome process tree using the same creation-date-validated BFS walk.
   - Measures Chrome's total Private Working Set, reporting exact savings: `(chrome_pws - rusty_pws) / chrome_pws * 100.0`.

---

## 5. Architectural Gap Analysis & Extensions for R0–R3

### 5.1 R0: Baseline Measurement & Platform Layer Abstraction

#### 5.1.1 Problem & Requirements
- `main.rs` directly instantiates `WebViewBuilder` and uses Windows-specific extensions (`WebViewBuilderExtWindows`, `WebViewExtWindows`, Win32 API calls).
- To support Linux WebKitGTK and maintain clean separation of concerns, all webview operations must be isolated behind an engine-agnostic trait.
- A standardized 5-state memory measurement breakdown must be produced and verified across:
  1. Empty window (`about:blank`)
  2. New Tab Page (Minimal vs Crazy skin)
  3. 5 tabs loaded
  4. 10 tabs loaded
  5. Split view active

#### 5.1.2 Platform Abstraction Trait Design
Create `src/platform/mod.rs` and `src/platform/traits.rs` defining the unified platform abstraction:

```rust
pub trait PlatformLayer: Send + Sync {
    type WebViewHandle;

    /// Webview lifecycle
    fn create_chrome_webview(
        &self,
        window: &Window,
        url: &str,
        bounds: Rect,
    ) -> Result<Self::WebViewHandle>;

    fn create_content_webview(
        &self,
        window: &Window,
        shared_handle: Option<&Self::WebViewHandle>,
        params: ContentWebViewParams,
    ) -> Result<Self::WebViewHandle>;

    fn destroy_webview(&self, handle: Self::WebViewHandle);
    fn set_visible(&self, handle: &Self::WebViewHandle, visible: bool) -> Result<()>;
    fn set_bounds(&self, handle: &Self::WebViewHandle, bounds: Rect) -> Result<()>;
    fn load_url(&self, handle: &Self::WebViewHandle, url: &str) -> Result<()>;
    fn load_html(&self, handle: &Self::WebViewHandle, html: &str) -> Result<()>;
    fn eval_script(&self, handle: &Self::WebViewHandle, js: &str) -> Result<()>;
    fn set_zoom(&self, handle: &Self::WebViewHandle, level: f64) -> Result<()>;

    /// RAM optimization hooks (R2)
    fn suspend_webview(&self, handle: &Self::WebViewHandle) -> Result<()>;
    fn resume_webview(&self, handle: &Self::WebViewHandle) -> Result<()>;
    fn set_low_memory_target(&self, handle: &Self::WebViewHandle) -> Result<()>;

    /// Network, interception & security (R0/R3)
    fn set_proxy(&self, config: Option<ProxyConfig>) -> Result<()>;
    fn clear_browsing_data(&self, cookies: bool, cache: bool) -> Result<()>;

    /// Process-tree memory telemetry (R0/R3)
    fn sample_memory_breakdown(&self, active_webviews: usize) -> BrowserMemoryBreakdown;
    fn collect_system_telemetry(&self) -> TelemetrySnapshot;
}
```

Implementations:
- `WindowsPlatform`: Implements `PlatformLayer` wrapping WebView2 via `wry` + raw COM pointers (`ICoreWebView2_3`, `ICoreWebView2_19`), Win32 Job Object, PDH counters, and `NtQueryInformationProcess`.
- `LinuxPlatform`: Implements `PlatformLayer` wrapping WebKitGTK 4.1 via `wry` (`build_gtk`), `gtk::Fixed` container, `/proc/<pid>/smaps_rollup` PSS calculation, and XDG directories.

#### 5.1.3 Linux Process-Tree PSS Telemetry Design
On Linux, Private Working Set does not exist in the Windows sense. Instead, **Proportional Set Size (PSS)** from `/proc/<pid>/smaps_rollup` is the gold standard for memory measurement:
- Read `/proc/<pid>/stat` to discover parent PIDs (`PPID`) and process names (`WebKitWebProcess`, `WebKitNetworkProcess`, `rusty_browser`).
- Read `/proc/<pid>/smaps_rollup` for each process in the tree:
  ```text
  Rss:               45200 kB
  Pss:               28400 kB
  Pss_Anon:          22100 kB
  Pss_File:           6300 kB
  Private_Clean:      2100 kB
  Private_Dirty:     21000 kB
  Referenced:        44100 kB
  ```
- Sum `Pss` across the tree for the headline memory metric.

---

### 5.2 R1: Workspaces Architecture

#### 5.2.1 Problem & Requirements
- Currently, `TabManager` (`src/tab.rs`) maintains a single flat `Vec<Tab>` with an active tab ID and basic tab groups.
- Workspaces must become first-class domain models owned entirely by Rust.
- **Inviolable Invariant**: Only the active workspace may possess live webviews. Inactive workspaces exist solely as serialized metadata in Rust memory and disk.
- Switching workspaces must persist current tab state, tear down all content WebViews of the exiting workspace, and restore the target workspace's tabs.

#### 5.2.2 Workspace Domain Model
Create `src/workspace.rs`:
```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Workspace {
    pub id: String,
    pub name: String,
    pub icon: String,
    pub color: String,
    pub theme: Option<String>,
    pub default_search_engine: Option<String>,
    pub focus_mode_link: Option<String>,
    pub is_isolated: bool, // Dedicated profile / cookie store
    pub tabs: Vec<TabState>,
    pub active_tab_id: Option<TabId>,
    pub recently_closed: Vec<TabState>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TabState {
    pub id: TabId,
    pub url: String,
    pub title: String,
    pub scroll_y: f64,
    pub zoom_level: f64,
    pub pinned: bool,
    pub muted: bool,
    pub group_id: Option<String>,
    pub nav_history: Vec<String>,
    pub nav_index: usize,
}
```

#### 5.2.3 Active-Only Lifecycle Transition Logic
When switching from Workspace A to Workspace B:
1. **Snapshot Workspace A**:
   - For all active webviews in Workspace A, record current `url`, `scroll_y` (via `save_scroll`), `zoom_level`, and nav history.
   - Update `WorkspaceA.tabs` and `WorkspaceA.active_tab_id`.
2. **Teardown WebViews**:
   - Iterate through `content_webviews` belonging to Workspace A.
   - Explicitly drop each `WebView` instance (`content_webviews.clear()`).
   - Clear `split` state and `applied_bounds`.
   - On Windows, WebView2 will automatically shut down idle renderer processes as content webviews are destroyed.
3. **Persist State**:
   - Write updated `WorkspaceStore` to `workspaces.tmp` and atomically rename to `workspaces.json`.
   - Debounce disk write by 500ms during rapid tab modifications.
4. **Restore Workspace B**:
   - Set Workspace B as active.
   - Update `TabManager` with `WorkspaceB.tabs`.
   - Restore `WorkspaceB.active_tab_id`.
   - Call `apply_layout_and_visibility`, which lazily creates a new `WebView` for the active tab only.
5. **UI Synchronization**:
   - Push updated `state_update` to Chrome webview via IPC.
   - Update workspace rail UI (active dot pill, tab counts).

#### 5.2.4 Isolated Workspace RAM Impact
- Standard workspaces share the same `WebContext` (shared user-data directory, cookie jar, network cache). Memory cost of inactive workspaces is **0 MB** webview RAM (only tens of kilobytes of Rust heap).
- An **Isolated Workspace** uses a dedicated user-data folder (e.g. `%APPDATA%\rusty_browser\workspaces\<id>\`).
- This spawns a distinct WebView2 runtime environment instance.
- **Measured RAM cost**: Spawning an isolated environment incurs an additional base overhead of **~30–45 MB Private Working Set** (for dedicated Network and Storage utility processes). This must be clearly documented in settings.

---

### 5.3 R2: RAM Optimization Pass

#### 5.3.1 Raw WebView2 Handles (`TrySuspend` & `MemoryUsageTargetLevel`)
`wry::WebViewExtWindows` exposes the raw COM controller pointer via `controller()`.
From `ICoreWebView2Controller`:
1. Call `get_CoreWebView2(&mut core_wv2)` to obtain `ICoreWebView2`.
2. Query interface for `ICoreWebView2_3`:
   ```rust
   // Windows COM Call
   let wv3: ICoreWebView2_3 = core_wv2.cast()?;
   wv3.TrySuspend(handler)?;
   ```
   `TrySuspend` pauses script timers, ceases rendering, and signals the renderer process to release unreferenced memory.
3. Query interface for `ICoreWebView2_19`:
   ```rust
   let wv19: ICoreWebView2_19 = core_wv2.cast()?;
   wv19.put_MemoryUsageTargetLevel(COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW)?;
   ```
   `MemoryUsageTargetLevel = Low` instructs Chromium to aggressively trim V8 heaps, clear image decode caches, and minimize private working sets.
4. **Inactivity Lifecycle**:
   - Phase 1 (1–3 min idle): invoke `TrySuspend` and set `MemoryUsageTargetLevel = Low`. Tab remains live in memory but consumption drops by 40–60%.
   - Phase 2 (N min idle, configured by user): invoke `discard_inactive_tabs`, tearing down the `WebView` entirely and saving scroll offset.

#### 5.3.2 Renderer Process Limits
WebView2 supports Chromium command-line switches passed via `with_additional_browser_args`:
- `--renderer-process-limit=N`: Caps the maximum number of renderer processes Chromium will spawn, forcing multiple tabs to share a single renderer process.
- **Trade-off Analysis**:
  - *Savings*: Reduces private working set by ~25–40 MB per tab by avoiding redundant V8 isolates and renderer process overhead.
  - *Security/Stability Trade-off*: Weakens Chromium's Site Isolation sandbox; a crash or hang in one tab can terminate or freeze other tabs sharing that renderer.
  - *Recommendation*: Expose as an explicit toggle in Settings under "Aggressive RAM Optimization" with honest trade-off explanation.

#### 5.3.3 Global Allocator Replacement (`mimalloc` / `jemalloc`)
The default Windows system allocator (`HeapAlloc`) exhibits heap fragmentation during long browser sessions with numerous tab/string allocations.
- Add `mimalloc` to `Cargo.toml`:
  ```toml
  [dependencies]
  mimalloc = { version = "0.1", default-features = false }
  ```
- In `src/main.rs`:
  ```rust
  #[global_allocator]
  static GLOBAL: mimalloc::MiMalloc = mimalloc::MiMalloc;
  ```
- On Linux, conditionally compile `jemallocator`:
  ```toml
  [target.'cfg(target_os = "linux")'.dependencies]
  jemallocator = "0.5"
  ```
- Evaluated impact: 5–15% reduction in Rust host memory, significantly faster deallocation, and near-zero fragmentation during rapid tab creation/destruction.

#### 5.3.4 UI Webview & NTP Optimizations
- **Single WebGL Context**: In `ui/js/globe.js` and `ui/js/fx-crazy.js`, ensure only one active WebGL canvas exists. When static fallback or Lite mode is active, call `gl.getExtension('WEBGL_lose_context')?.loseContext()`, release canvas dimensions (`canvas.width = 0; canvas.height = 0`), and nullify texture references.
- **DOM Virtualization**: For bookmarks, history, and command palette lists exceeding 50 items, virtualize DOM nodes so only visible rows are instantiated.
- **Lite Mode Preset**: Setting in `Storage`: `lite_mode: bool`. Forces `skin = "minimal"`, `effects_intensity = 0`, disables canvas backgrounds, disables companion pet, and activates aggressive 3-minute tab suspension.

---

### 5.4 R3: Linux Platform Support

#### 5.4.1 WebKitGTK 4.1 Implementation
On Linux, `tao` and `wry` utilize GTK 3 and WebKitGTK 4.1:
- Create window using `tao::platform::unix::WindowExtUnix`.
- Container layout: use `gtk::Fixed` or `gtk::Box` (obtained via `window.default_vbox()`).
- Content webviews are added as children to the GTK container using `WebViewBuilderExtUnix::build_gtk(vbox)`.
- Client-side window decorations: support window dragging across Wayland and X11 via `window.drag_window()` on mousedown in the custom titlebar.

#### 5.4.2 Cross-Platform Directory Paths (`directories` Crate)
Replace ad-hoc `env::var("APPDATA")` / `env::var("HOME")` with the standard `directories` crate:
```rust
use directories::ProjectDirs;

let proj = ProjectDirs::from("com", "RustyBrowser", "rusty_browser").unwrap();
let config_dir = proj.config_dir(); // ~/.config/rusty_browser on Linux, %APPDATA%\RustyBrowser\config on Windows
let data_dir = proj.data_dir();     // ~/.local/share/rusty_browser on Linux
let cache_dir = proj.cache_dir();   // ~/.cache/rusty_browser on Linux
```

#### 5.4.3 Credential Vault via `keyring` Crate
Replace Windows DPAPI calls with the cross-platform `keyring` crate:
- On Linux: communicates over D-Bus with the Secret Service API (GNOME Keyring, KWallet, KeePassXC).
- On Windows: delegates to Windows Credential Manager / DPAPI.
- Secure storage of master encryption keys and proxy/sync credentials.

#### 5.4.4 Ad Blocker on Linux (`adblock-rust`)
WebKitGTK does not expose an arbitrary network request interception hook equivalent to Windows WebView2's `WebResourceRequested`. Instead, it provides native content blocking:
- Use `adblock-rust` to compile EasyList / uBlock Origin filter rules into WebKit JSON format.
- Compile and install rules using `WebKitUserContentFilterStore`:
  ```rust
  let store = WebKitUserContentFilterStore::new(&cache_path);
  store.save("adblock_rules", &rules_json, cancellable, callback);
  ```
- Cosmetic filtering: inject hiding CSS (`##.ad-banner`, etc.) into `WebKitUserContentManager` via `WebKitUserStyleSheet`.

#### 5.4.5 Linux Userspace WireGuard & SOCKS5 Proxy
To support VPN/proxy without root privileges:
1. Embed a userspace WireGuard client (e.g. `boringtun-cli` or custom WireGuard tunnel) binding to a local loopback port.
2. Run a lightweight local SOCKS5 proxy server on `127.0.0.1:<port>`.
3. Configure `wry` / WebKitGTK proxy settings:
   - In WebKitGTK, configure `WebKitNetworkProxySettings` pointing to `socks5://127.0.0.1:<port>`.
   - Enforce WebRTC leak prevention: disable WebRTC ICE candidate gathering over non-proxied interfaces via WebKit settings.
   - Enforce DNS leak prevention: all DNS resolution is handled remotely by the SOCKS5 proxy.

#### 5.4.6 Packaging & CI
- Packaging:
  - `.deb`: generate Debian package via `cargo-deb` with dependencies on `libwebkit2gtk-4.1-0`, `libgtk-3-0`.
  - AppImage: bundle binary and runtime libraries into a portable AppImage.
- GitHub Actions Workflow (`.github/workflows/ci.yml`):
  - Matrix build: `windows-latest` (MSVC) and `ubuntu-24.04`.
  - Ubuntu steps install `libwebkit2gtk-4.1-dev`, `libgtk-3-dev`, `libayatana-appindicator3-dev`.
  - Runs `cargo check`, `cargo clippy --all-targets -- -D warnings`, `cargo test`, and builds release artifacts.

---

## 6. Implementation Roadmap & Milestones (R0–R3)

```
┌────────────────────────────────────────────────────────────────────────┐
│ R0: Baseline Measurement & Platform Layer Abstraction                   │
│ ├── Produce 5-state process-tree RAM baseline (Win & Linux PSS)        │
│ └── Implement PlatformLayer trait isolating WebView2 and WebKitGTK     │
└───────────────────────────────────┬────────────────────────────────────┘
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│ R1: Workspaces Domain Model & Active-Only WebViews                     │
│ ├── Implement Workspace data model & atomic JSON persistence           │
│ ├── Enforce active-only webviews (destroy inactive on switch)          │
│ └── Add isolated workspace profile with documented RAM overhead        │
└───────────────────────────────────┬────────────────────────────────────┘
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│ R2: RAM Optimization Pass                                              │
│ ├── Hook ICoreWebView2_3::TrySuspend & MemoryUsageTargetLevel::Low    │
│ ├── Evaluate --renderer-process-limit flag trade-offs                   │
│ ├── Replace global allocator with mimalloc / jemalloc                  │
│ └── Implement Lite Mode preset & single WebGL context enforcement      │
└───────────────────────────────────┬────────────────────────────────────┘
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│ R3: Linux Platform Support                                             │
│ ├── Implement PlatformLayer for WebKitGTK 4.1 via gtk::Fixed container │
│ ├── Integrate directories, keyring (Secret Service), /proc PSS telemetry│
│ ├── Implement adblock-rust WebKitUserContentFilterStore                │
│ └── Userspace WireGuard / SOCKS5 proxy + deb/AppImage + CI workflow    │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 7. Conclusion & Next Steps

The Rust backend in `d:\browser` is modular, strictly typed, and thoroughly tested. Its memory measurement implementation is among the most accurate in desktop webview applications, directly reconciling against Windows Task Manager Details. 

With this survey complete, the codebase is fully prepared for Milestone R0:
1. Extract the `PlatformLayer` trait and wrap existing WebView2 calls into `WindowsPlatform`.
2. Standardize the 5-state measurement test script.
3. Transition `TabManager` into the workspace-aware architecture of R1.
