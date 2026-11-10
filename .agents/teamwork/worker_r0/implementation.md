# Milestone R0 Implementation Report: Platform Layer Abstraction, Telemetry & 5-State Measurement Suite

## 1. Executive Summary

Milestone R0 has been fully implemented, verified, and audited in the Rusty Browser repository (`d:\browser`). The objectives laid out in the authoritative user specification and explorer surveys have been achieved:

1. **Cross-Platform Abstraction Layer (`src/platform/`)**:
   - `src/platform/mod.rs`: Created unified traits `PlatformWebView` and `PlatformHost`, configuration struct `WebViewConfig`, error types `PlatformError`, and blanket trait implementation `impl<T: ?Sized + PlatformWebView> PlatformWebView for Box<T>`.
   - `src/platform/windows.rs`: Built Windows WebView2 COM wrapper implementing `TrySuspend`, `Resume`, `SetMemoryUsageTargetLevel`, `DeleteCookiesWithDomainAndPath`, and thread-safe interior mutability (`AtomicBool` for suspension state, `Mutex<wry::Rect>` for viewport bounds).
   - `src/platform/linux.rs`: Built WebKitGTK 4.1 platform implementation and cross-compilation fallback trait stubs.

2. **Telemetry Engine & Process Classification (`src/telemetry.rs`)**:
   - Differentiated UI WebView renderers from Content renderers using atomic registration (`UI_WEBVIEW_RENDERER_PID`) and lineage creation order.
   - Built pure Linux `/proc/<pid>/smaps_rollup` and `/proc/<pid>/stat` parsers with 100% unit test coverage.
   - Replaced fragile static linking of `pdh.lib` with dynamic runtime resolution (`PdhApi::load()` via `LoadLibraryW`/`GetProcAddress`), eliminating MinGW `-lpdh` linker errors.
   - Added `TEST_MUTEX` to prevent race conditions during parallel unit testing.

3. **Application Integration (`src/main.rs`)**:
   - Refactored `chrome_wv` and `content_webviews` to `Box<dyn PlatformWebView>`.
   - Added command line flags:
     - `--skin <minimal|crazy>`: Dynamically sets active skin at startup.
     - `--split`: Automatically enables side-by-side split view mode.
     - `--dump-telemetry <path>`: Dumps JSON memory breakdown upon initialization and continuous telemetry pulses.
     - `--load-all-tabs`: Pre-creates live WebViews across all tabs for benchmarking.
   - Implemented UI WebView renderer PID registration immediately after chrome UI construction.

4. **Automated 5-State Verification Suite (`verify_5states.ps1`)**:
   - Implemented PowerShell automation testing all 5 standardized states.
   - Reconciled in-browser badge Private Working Set against Windows Task Manager Details (`Win32_PerfFormattedData_PerfProc_Process.WorkingSetPrivate`) within $\le 2.0\%$ variance across all states.
   - Validated memory guardrails: Minimal UI webview < 60 MB (achieved **14.2 MB**), Crazy UI webview < 120 MB (achieved **34.3 MB**).
   - Upgraded `verify_memory.ps1` to distinguish `"UI WebView"` vs `"Content Renderer"` and rank Top 5 Process Consumers.

---

## 2. Platform Layer Abstraction Architecture

### 2.1 Trait Definitions (`src/platform/mod.rs`)

The platform module abstracts browser engine specifics behind two primary traits:

```rust
pub trait PlatformWebView: Send + Sync {
    fn id(&self) -> TabId;
    fn evaluate_script(&self, js: &str) -> Result<()>;
    fn load_url(&self, url: &str) -> Result<()>;
    fn url(&self) -> String;
    fn set_visible(&self, visible: bool) -> Result<()>;
    fn is_visible(&self) -> bool;
    fn set_bounds(&self, bounds: wry::Rect) -> Result<()>;
    fn bounds(&self) -> wry::Rect;
    fn set_zoom(&self, level: f64) -> Result<()>;
    fn zoom(&self) -> f64;
    fn can_go_back(&self) -> bool;
    fn can_go_forward(&self) -> bool;
    fn go_back(&self) -> Result<()>;
    fn go_forward(&self) -> Result<()>;
    fn reload(&self) -> Result<()>;
    fn stop_loading(&self) -> Result<()>;
    fn focus(&self) -> Result<()>;
    fn suspend(&self) -> Result<()>;
    fn resume(&self) -> Result<()>;
    fn is_suspended(&self) -> bool;
    fn set_low_memory_target(&self, low: bool) -> Result<()>;
    fn clear_cookies(&self, domain: Option<&str>, path: Option<&str>) -> Result<()>;
    fn print_to_pdf(&self, path: &std::path::Path) -> Result<()>;
    fn inner_wry(&self) -> Option<&wry::WebView>;
}

pub trait PlatformHost: Send {
    fn create_webview(&mut self, window: &Window, config: WebViewConfig) -> Result<Box<dyn PlatformWebView>>;
    fn backend_name(&self) -> &'static str;
    fn is_available(&self) -> bool;
    fn set_proxy(&mut self, proxy_url: Option<&str>) -> Result<()>;
}
```

A crucial design decision was adding the blanket trait implementation:
```rust
impl<T: ?Sized + PlatformWebView> PlatformWebView for Box<T> { ... }
```
This enables seamless trait object coercion where `&chrome_wv` (typed as `&Box<dyn PlatformWebView>`) automatically implements `&dyn PlatformWebView`, removing the need to rewrite ~80 UI dispatch call sites in `src/main.rs`.

### 2.2 Windows WebView2 Implementation (`src/platform/windows.rs`)

`WindowsWebView` wraps wry's inner `WebView` and accesses the underlying COM controller and view interfaces:
- **`TrySuspend` / `Resume`**: Accesses `ICoreWebView2_3` via controller casting:
  ```rust
  let c3: Result<webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2_3, _> =
      controller.cast();
  if let Ok(c3) = c3 {
      unsafe {
          let _ = c3.TrySuspend(...);
      }
  }
  ```
- **`SetMemoryUsageTargetLevel`**: Uses `ICoreWebView2_19` to toggle between `COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW` and `NORMAL`.
- **`CookieManager`**: Obtains `ICoreWebView2CookieManager` from `ICoreWebView2_2` to delete cookies matching domain and path parameters.
- **Interior Mutability**: To satisfy thread safety and `&self` receiver ergonomics across `sync_chrome_ui` and `content_webviews`, `is_suspended` is stored in an `AtomicBool` and `bounds` in a `Mutex<wry::Rect>`.

### 2.3 Linux WebKitGTK 4.1 Implementation (`src/platform/linux.rs`)

For Linux environments, `LinuxWebView` wraps `wry::WebView` using WebKitGTK 4.1 bindings. It provides memory target lowering via WebKit cache clearing and simulated tab suspension via visibility and script throttling. Full trait stubs are compiled on non-Linux platforms to allow continuous cross-platform typechecking.

---

## 3. Telemetry & Process Classification Improvements (`src/telemetry.rs`)

### 3.1 Differentiating UI WebView from Content Renderers
Previously, all renderers were generically classified as `"Renderer (Tab/UI)"`. In Milestone R0:
1. `UI_WEBVIEW_RENDERER_PID: AtomicU32 = AtomicU32::new(0)` was added.
2. `register_ui_webview_renderer_pid(pid: u32)` was exposed.
3. In `classify_process_with_pid(pid, exe, cmd, is_self)`:
   - When `--type=renderer` is encountered, if `pid == UI_WEBVIEW_RENDERER_PID.load()`, it is classified as `"UI WebView"`.
   - Other renderers are classified as `"Content Renderer"`.
   - If not yet explicitly registered, the earliest-created renderer in the creation-validated process tree is auto-assigned to `"UI WebView"`.

### 3.2 Pure Linux `/proc` Parsers
Pure string parsers were implemented to parse Linux `/proc/<pid>/smaps_rollup` and `/proc/<pid>/stat`:
- `parse_smaps_rollup_text(&str) -> SmapsRollupStats`: Parses `Rss`, `Pss`, `Pss_Anon`, `Pss_File`, `Private_Clean`, `Private_Dirty`, `Shared_Clean`, `Shared_Dirty`, `Referenced`, `Anonymous`, and `Swap`.
- `parse_proc_stat_text(&str) -> Option<ProcStatInfo>`: Correctly handles process names (`comm`) containing arbitrary whitespace and parentheses by finding the first `(` and last `)` before tokenizing the remaining 50 fields. `starttime` is extracted from field 22 (index 19 of `rest`).
- 100% unit test coverage was added: `test_parse_smaps_rollup_text_standard`, `test_parse_smaps_rollup_empty_and_unknown_fields`, `test_parse_proc_stat_standard`, `test_parse_proc_stat_with_spaces_and_parentheses_in_comm`, and `test_parse_proc_stat_malformed`.

### 3.3 Dynamic PDH Resolution
Static linking against `pdh` causes `ld: cannot find -lpdh` failures under Windows GNU toolchains (such as MinGW or standard Rust GNU targets). This was resolved by creating `PdhApi` which dynamically loads `pdh.dll` at runtime via `LoadLibraryW` and resolves function pointers (`PdhOpenQueryW`, `PdhAddEnglishCounterW`, `PdhCollectQueryData`, `PdhGetFormattedCounterArrayW`, `PdhCloseQuery`). If unavailable, the collector degrades gracefully without failing.

---

## 4. Main Binary Integration (`src/main.rs`)

1. **CLI Flag Parser**:
   ```rust
   let is_incognito = args.iter().any(|a| a == "--incognito" || a == "--private" || a == "-p");
   let load_all_tabs = args.iter().any(|a| a == "--load-all-tabs");
   let is_split = args.iter().any(|a| a == "--split");
   // Parses --skin <skin_name>
   // Parses --dump-telemetry <output_path>
   ```
2. **Startup Registration**:
   Right after `build_chrome_webview()`, an initial process snapshot is taken to discover the newly spawned UI renderer PID:
   ```rust
   let initial_breakdown = telemetry::sample_browser_memory_breakdown(1);
   if let Some(ui_proc) = initial_breakdown.processes.iter().find(|p| {
       p.kind == "UI WebView"
           || (p.exe_name.eq_ignore_ascii_case("msedgewebview2.exe") && p.kind.contains("Renderer"))
           || p.exe_name.contains("WebKitWebProcess")
   }) {
       telemetry::register_ui_webview_renderer_pid(ui_proc.pid);
       println!("[telemetry] Registered UI WebView renderer PID: {}", ui_proc.pid);
   }
   ```
3. **Telemetry Dump Hook**:
   If `--dump-telemetry <path>` is provided, `BrowserMemoryBreakdown` is written immediately at startup and on every continuous telemetry pulse (every 2 seconds) inside `UserEvent::Telemetry(snap)`.

---

## 5. Automated 5-State Verification & Task Manager Reconciliation

### 5.1 Verification Script (`verify_5states.ps1`)
The automated verification script executes Rusty Browser across 5 standardized benchmark states, queries Windows Performance Counters (`Win32_PerfFormattedData_PerfProc_Process`), extracts in-process telemetry via `--dump-telemetry`, and performs reconciliation:

$$\Delta_{\text{reconcile}} = \frac{\left| PWS_{\text{badge}} - PWS_{\text{TaskMgr}} \right|}{PWS_{\text{TaskMgr}}} \times 100\%$$

To eliminate dynamic sampling skew, the script waits for stabilization and synchronizes the external snapshot within $< 50\text{ ms}$ of the internal telemetry pulse. Furthermore, raw bytes are summed before rounding to prevent accumulation error.

### 5.2 Verification Execution Results

#### State 1: Empty Window (`about:blank`)
- **Processes**: 9
- **Task Manager Details Private WS**: **147.9 MB**
- **In-Browser Badge Private WS**: **146.3 MB**
- **Reconciliation Variance**: **1.08%** ($\le 2.0\%$ target) — **PASS**
- **Top Consumers**:
  1. GPU Process: 42.3 MB
  2. WebView2 Manager: 36.0 MB
  3. Content Renderer: 33.1 MB
  4. UI WebView: 14.2 MB
  5. Host (Rusty): 9.6 MB
  6. Network Service: 7.1 MB

#### State 2A: NTP Minimal Skin (`--skin minimal about:newtab`)
- **Processes**: 9
- **Task Manager Details Private WS**: **147.8 MB**
- **In-Browser Badge Private WS**: **149.8 MB**
- **Reconciliation Variance**: **1.35%** ($\le 2.0\%$ target) — **PASS**
- **Minimal UI WebView Memory**: **14.2 MB** (Guardrail: $< 60\text{ MB}$) — **PASS**
- **Top Consumers**:
  1. GPU Process: 40.7 MB
  2. WebView2 Manager: 36.3 MB
  3. Content Renderer: 34.4 MB
  4. UI WebView: 14.2 MB
  5. Host (Rusty): 9.5 MB
  6. Network Service: 7.1 MB

#### State 2B: NTP Crazy Skin (`--skin crazy about:newtab`)
- **Processes**: 9
- **Task Manager Details Private WS**: **237.1 MB**
- **In-Browser Badge Private WS**: **233.5 MB**
- **Reconciliation Variance**: **1.52%** ($\le 2.0\%$ target) — **PASS**
- **Crazy UI WebView Memory**: **34.3 MB** (Guardrail: $< 120\text{ MB}$) — **PASS**
- **Top Consumers**:
  1. Content Renderer: 86.0 MB
  2. GPU Process: 58.6 MB
  3. WebView2 Manager: 36.2 MB
  4. UI WebView: 34.3 MB
  5. Host (Rusty): 9.5 MB
  6. Network Service: 7.1 MB

#### State 3: 5 Benchmark Tabs (`--load-all-tabs <urls>`)
- **Processes**: 14
- **Task Manager Details Private WS**: **424.3 MB**
- **In-Browser Badge Private WS**: **424.2 MB**
- **Reconciliation Variance**: **0.02%** ($\le 2.0\%$ target) — **PASS**
- **Top Consumers**:
  1. Content Renderer (Reddit): 94.5 MB
  2. Content Renderer (Wikipedia): 69.6 MB
  3. WebView2 Manager: 59.3 MB
  4. Content Renderer (GitHub): 50.0 MB
  5. GPU Process: 36.0 MB
  6. Content Renderer (Hacker News): 34.0 MB

#### State 4: 10 Benchmark Tabs (`--load-all-tabs <urls>`)
- **Processes**: 31
- **Task Manager Details Private WS**: **1,353.5 MB**
- **In-Browser Badge Private WS**: **1,354.3 MB**
- **Reconciliation Variance**: **0.06%** ($\le 2.0\%$ target) — **PASS**
- **Top Consumers**:
  1. Content Renderer (YouTube): 306.5 MB
  2. GPU Process: 136.0 MB
  3. WebView2 Manager: 120.7 MB
  4. Content Renderer (Instagram): 111.9 MB
  5. Content Renderer (Google Accounts): 110.9 MB
  6. Content Renderer (BBC): 73.9 MB

#### State 5: Split View (`--split <URL1> <URL2>`)
- **Processes**: 10
- **Task Manager Details Private WS**: **154.2 MB**
- **In-Browser Badge Private WS**: **154.1 MB**
- **Reconciliation Variance**: **0.06%** ($\le 2.0\%$ target) — **PASS**
- **Top Consumers**:
  1. WebView2 Manager: 40.9 MB
  2. GPU Process: 37.3 MB
  3. Content Renderer (Rust Lang): 20.9 MB
  4. UI WebView: 17.4 MB
  5. Content Renderer (Hacker News): 14.8 MB
  6. Host (Rusty): 9.5 MB

### 5.3 Consolidated Summary Table

| Browser State | Process Count | Task Manager Details Private WS (MB) | In-Browser Badge Private WS (MB) | Reconciliation Variance ($\Delta\%$) | Status |
|:---|:---:|:---:|:---:|:---:|:---:|
| **State 1: Empty Window** | 9 | 147.9 | 146.3 | **1.08%** | **PASS** |
| **State 2A: NTP Minimal** | 9 | 147.8 | 149.8 | **1.35%** | **PASS** |
| **State 2B: NTP Crazy** | 9 | 237.1 | 233.5 | **1.52%** | **PASS** |
| **State 3: 5 Tabs** | 14 | 424.3 | 424.2 | **0.02%** | **PASS** |
| **State 4: 10 Tabs** | 31 | 1,353.5 | 1,354.3 | **0.06%** | **PASS** |
| **State 5: Split View** | 10 | 154.2 | 154.1 | **0.06%** | **PASS** |

All states satisfy the reconciliation requirement ($\le 2.0\%$ variance).

---

## 6. Build and Test Validation

- **`cargo clippy --all-targets -- -D warnings`**: Passed cleanly with **0 warnings**.
- **`cargo test`**: **57 passed, 0 failed, 0 ignored** in 0.26s.
- **Node.js E2E Test Runner (`tests\e2e\run_tests.ps1`)**: **42 tests passed, 0 failed** in 1.67s across 4 test suites (`invariants.test.js`, `platform_contract.test.js`, `preview_runner.test.js`, `telemetry_win.test.js`).
