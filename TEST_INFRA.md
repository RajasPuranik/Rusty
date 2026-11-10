# E2E Test Infrastructure & Methodology Specification

**Target System**: Rusty Browser (`rusty_browser`)  
**Target Environments**: Windows 11 (Microsoft Edge WebView2) & Linux (WebKitGTK 4.1)  
**Document Status**: Authoritative E2E Test Specification  
**Document Path**: `d:\browser\TEST_INFRA.md`  

---

## 1. Test Philosophy & Design Methodology

### 1.1 Opaque-Box & Requirement-Driven Testing
The Rusty Browser End-to-End (E2E) test suite is strictly opaque-box and requirement-driven. Tests are derived directly from the authoritative product requirements in `ORIGINAL_REQUEST.md`, architectural definitions in `PROJECT.md`, and specification mappings in `survey_spec.md`. The test track operates independently of internal implementation quirks, verifying external observables:
1. **Host-Level Observables**: Process creation, command-line arguments, memory usage (Private Working Set / PSS), exit codes, signal handling, and file system modifications (atomic persistence, directory structures).
2. **IPC Protocol Observables**: Strict origin validation, typed message contracts, schema enforcement, serialization/deserialization integrity, and unauthorized origin rejection.
3. **Platform Interface Observables**: Trait contract compliance, webview lifecycle state transitions (create, destroy, suspend, resume, hide, show), bounds calculation, and proxy routing.
4. **UI & Webview Observables**: DOM structure, CSS link loading/unloading (asset isolation), canvas rendering lifecycle, mock bridge event dispatching, and zero console errors in standalone preview mode.

### 1.2 4-Tier Test Design Methodology
To guarantee both breadth of coverage and depth of verification, test cases are structured into four distinct hierarchical tiers:

```
+-------------------------------------------------------------------------+
|                Tier 4: Real-World Application Scenarios                 |
|     (Full-lifecycle end-user browsing workflows & multi-feature flows)  |
+-------------------------------------------------------------------------+
                                    ^
+-------------------------------------------------------------------------+
|              Tier 3: Cross-Feature Combinations (Pairwise)              |
|        (Combinatorial interactions between subsystems and features)     |
+-------------------------------------------------------------------------+
                                    ^
+-------------------------------------------------------------------------+
|              Tier 2: Boundary Value Analysis & Corner Cases             |
|   (Limits, extremes, empty inputs, network disconnects, error handling) |
+-------------------------------------------------------------------------+
                                    ^
+-------------------------------------------------------------------------+
|                  Tier 1: Feature Coverage & Happy Paths                 |
|    (Category-Partition equivalence classes, isolated primary behavior)  |
+-------------------------------------------------------------------------+
```

1. **Tier 1 — Feature Coverage (Category-Partition)**:
   - For every feature (Features 1 through 44), identify functional equivalence classes and valid input partitions.
   - Requirement: **Minimum 5 test cases per feature** covering primary operational paths in isolation.
2. **Tier 2 — Boundary Value Analysis (BVA) & Corner Cases**:
   - For every feature, evaluate boundary values, empty string/collection cases, extreme counts (0 tabs, 100 tabs, 4K textures, 0s timeouts), malformed payloads, file system permission errors, and abrupt process exits.
   - Requirement: **Minimum 5 test cases per feature** targeting error handling and edge states.
3. **Tier 3 — Cross-Feature Combinations (Pairwise Testing)**:
   - Evaluates pairwise feature interactions that risk conflicting resource constraints or state corruption.
   - Key interaction pairs: Workspaces + Focus Mode, Workspaces + Background Registry, Lite Mode + Visual Skins, Background Tab Suspension + Audio Playback, Isolated Profiles + Vault Storage.
4. **Tier 4 — Real-World Application Scenarios (Workload Testing)**:
   - End-to-end multi-step synthetic user sessions representing daily-driver browsing: morning briefings, deep work study blocks, multi-window research marathons, and private authenticated sessions.

### 1.3 Progressive Testability & Milestone Alignment
Tests must be verifiable progressively using only features available in the corresponding milestone:
- **Milestone R0 Tests**: Focus exclusively on baseline process-tree telemetry, 5-state measurement reconciliation, and platform abstraction trait definitions.
- **Milestone R1 Tests**: Add workspace lifecycle, active-only webview destruction, atomic disk persistence, and profile isolation.
- **Milestone R2 Tests**: Add tab suspension (`TrySuspend`), inactivity discard, DOM virtualization, allocator comparisons, and Lite Mode.
- **Milestone R3 Tests**: Add WebKitGTK platform backend, CSD titlebars, XDG directory paths, Secret Service vault, content blocker, and userspace WireGuard proxy.
- **Milestone R4 Tests**: Add Focus mode timers, domain category blocking, interstitial workflows, and YouTube study filters.
- **Milestone R5 Tests**: Add Softer Dark palettes, Mayank White neumorphism, 30 FPS wind lines, and weather orb.
- **Milestone R6 Tests**: Add modular background registry, 18 background styles, eco rules, and high-res night globe shaders.
- **Milestone R7 Tests**: Add launch cards, drag-and-drop reordering, JSON import/export, and verified local app execution.
- **Milestone R8 Tests**: Add WebView2 extension manager and Linux WebKitGTK userscripts engine.
- **Milestone R9 Tests**: Verify 100% test pass across all tiers, documentation completeness, and final benchmarks.

### 1.4 Test Integrity & Anti-Facading Mandate
- **No Facade Tests**: Tests must assert genuine properties, invariants, schemas, and outputs. Tests that blindly return `assert!(true)` or `expect(true).toBe(true)` are strictly prohibited.
- **Authoritative Expected Outputs**: Expected outputs must be derived from specifications or reference oracles (e.g., Task Manager private working set, Open-Meteo schemas, W3C URL standards, IPC JSON schemas).
- **Adversarial Verification**:
  - *Encoding & Escaping*: Verify JSON strings with escape sequences, UTF-8 surrogate pairs, zero-width characters, and script injection vectors (`<script>`, `javascript:`).
  - *Invalid Inputs*: Combination of nulls, negative bounds, non-numeric PIDs, missing fields, and spoofed origins.
  - *Resource Stress*: High process counts, rapid workspace switching (epoch cancellation), and out-of-memory simulation.

---

## 2. Core Invariants Verification (INV-01 through INV-10)

All test suites verify compliance with the 10 universal system invariants:

| Invariant | Rule Name | Verification Mechanism | Test Suite File |
|---|---|---|---|
| **INV-01** | Active Skin Asset Isolation | Verify that when skin is switched to Minimal, Crazy/Mayank CSS link tags and scripts are completely detached, canvas animation loops are cancelled, and zero inactive skin memory remains allocated. | `tests/e2e/invariants.test.js` |
| **INV-02** | Strict IPC Origin Gating | Send simulated IPC messages with varying origins (`http://evil.com`, `null`, `rusty://app/`, `http://rusty.app/`). Verify non-rusty origins are strictly rejected with zero state alteration. | `tests/e2e/invariants.test.js` |
| **INV-03** | Clean Mock Bridge Preview | Load `ui/index.html` and `ui/newtab.html` in headless Edge/Chrome using standalone mock bridge mode. Monitor CDP console events; assert zero errors or uncaught exceptions. | `tests/e2e/preview_runner.test.js` |
| **INV-04** | Placeholder Asset Discipline | Static code inspection scanning all asset files, SVG definitions, and mock scripts; assert all placeholder assets contain explicit `PLACEHOLDER` comments. | `tests/e2e/invariants.test.js` |
| **INV-05** | Zero Brand Trademark Infringement | Inspect asset directories and markup; verify no proprietary third-party logos (Google, YouTube, Twitch) are statically bundled; letter avatars or dynamic favicons only. | `tests/e2e/invariants.test.js` |
| **INV-06** | Honest Security Posture | Grep all documentation, UI strings, and tooltips; assert no claims of "infostealer-proof" or "impenetrable sandbox" exist. | `tests/e2e/invariants.test.js` |
| **INV-07** | Legacy Security Preservation | Verify that security layers (V1 Ad Blocker, V2 VPN/Proxy, V3 Vault, V4 Session Protection) are retained in architecture and interface traits. | `tests/e2e/invariants.test.js` |
| **INV-08** | Strict Anti-Faking Mandate | Inspect platform feature fallbacks (e.g., WebKitGTK extension handling); ensure unsupported features explicitly declare limitations rather than silently faking them. | `tests/e2e/invariants.test.js` |
| **INV-09** | Complete Code Delivery | Scan all source and test files; assert absence of truncation markers such as `// ... rest of code`, `/* ... TODO ... */`, or ellipsis placeholders. | `tests/e2e/invariants.test.js` |
| **INV-10** | External Code Attribution | Check third-party algorithms, shaders, or asset sources; assert corresponding licenses and attribution entries exist in documentation. | `tests/e2e/invariants.test.js` |

---

## 3. Feature Inventory Mapping (Features 1 through 44)

The table below maps all 44 functional features from `PROJECT.md § Feature Inventory` across test tiers, inputs, and test files:

| # | Feature Name | Milestone | Tier 1 (Equivalence Partition) | Tier 2 (BVA & Edge Cases) | Test Suite File |
|---|---|---|---|---|---|
| 1 | Multi-State Process Tree Telemetry (Windows) | R0 | Host, UI, GPU, Renderer memory; 5 state transitions | Process exit mid-walk, PID reuse check, 0-byte working set | `telemetry_win.test.js` |
| 2 | Process Tree Telemetry (Linux) | R0 | `smaps_rollup` PSS & Private WS parsing; child process walk | Missing smaps_rollup, sandbox permission denied, 0 PSS | `telemetry_linux.test.js` |
| 3 | Process Role Classification Engine | R0 | Correct role matching: RustHost, UiWebView, ContentRenderer, GPU, Network | Unknown CLI flags, missing arguments, nested subprocesses | `role_classify.test.js` |
| 4 | Task Manager Details Reconciliation | R0 | Reconciliation within 2% margin against Private Working Set | Extreme memory pressure, rapid allocations, cache drops | `taskmgr_recon.test.js` |
| 5 | Platform Abstraction Trait Definition | R0 | `PlatformWebView` & `PlatformHost` method contract compliance | Negative bounds, invalid URLs, double suspension calls | `platform_contract.test.js` |
| 6 | Rust Workspace State Manager | R1 | Workspace CRUD, tab collection ownership, active workspace switch | Delete active workspace, rename to empty string, 100 tabs | `workspaces_state.test.js` |
| 7 | Active-Only Live Webview Lifecycle | R1 | Active webview preservation; destruction of inactive workspace webviews | Rapid workspace flip (epoch cancellation), OOM on restore | `webview_lifecycle.test.js` |
| 8 | Crash-Safe Atomic Persistence | R1 | `data.json.tmp` write, fsync, atomic replace; debounced 500ms | Mid-write process termination, read-only disk, corrupted JSON | `atomic_storage.test.js` |
| 9 | Workspace Management UI & Hotkeys | R1 | `Ctrl+Alt+1..9` shortcut routing, badge counters, drag reorder | Out-of-bounds index, rapid shortcut spam, tab move edge | `workspace_ui.test.js` |
| 10 | Isolated Profile Workspace | R1 | Independent cookie store, segregated user-data-dir | Profile directory creation failure, concurrent disk access | `isolated_profile.test.js` |
| 11 | WebView2 Background Tab Suspension | R2 | `TrySuspend` COM call, `MemoryUsageTargetLevel = Low` | Suspending audio-playing tab, rapid suspend/wake cycle | `tab_suspension.test.js` |
| 12 | Inactivity Webview Discard | R2 | Discard after N minutes; metadata & scroll position retained | Discard timeout 0, negative timeout, wakeup on tab select | `tab_discard.test.js` |
| 13 | Renderer Process Limit Evaluation | R2 | Flag `--renderer-process-limit=N` configuration and parsing | Invalid limit (0, -1, 9999), renderer crash recovery | `renderer_limit.test.js` |
| 14 | Bounded DOM & Virtualized Lists | R2 | NTP list virtualization <= 100 DOM elements; scroll slicing | 0 items, 1 item, 10,000 items, rapid scroll jumping | `dom_virtualization.test.js`|
| 15 | UI Webview & NTP Memory Polish | R2 | Single WebGL context, canvas release (`width=0`), thumbnail capping | WebGL context loss recovery, large thumbnail rejection | `ui_memory_polish.test.js`|
| 16 | Custom Allocators Evaluation | R2 | Mimalloc & Jemalloc benchmarking metric recording | Allocator failure fallback, allocation profile capture | `allocator_eval.test.js` |
| 17 | Lite Mode Toggle | R2 | Force Minimal skin, 0 background FX, disable globe/pet | Rapid toggle cycles, persistent state on browser restart | `lite_mode.test.js` |
| 18 | WebKitGTK 4.1 Platform Implementation | R3 | `wry::build_gtk` with `gtk::Fixed` container on X11 and Wayland | GTK initialization failure, Wayland headless environment | `webkitgtk_platform.test.js`|
| 19 | Linux Custom Titlebar & CSD | R3 | Window drag gestures, window controls (min/max/close) | Compositor without SSD, fractional DPI scaling | `linux_csd.test.js` |
| 20 | XDG Directory Compliance | R3 | Config (`~/.config`), Data (`~/.local/share`), Cache (`~/.cache`) | Unset XDG environment variables, custom path overrides | `xdg_compliance.test.js` |
| 21 | Secret Service Integration | R3 | Credential storage via FreeDesktop Secret Service `keyring` | DBus service unavailable, locked keyring prompts | `secret_service.test.js` |
| 22 | WebKit Content Blocker (Linux) | R3 | Compile adblock rules to `WebKitUserContentFilterStore` bytecode | Malformed rule syntax, giant filter list compilation | `webkit_adblock.test.js` |
| 23 | Userspace WireGuard & SOCKS5 Proxy | R3 | Proxy routing via `WebKitNetworkProxySettings` without root | Proxy connection drop, kill switch leak verification | `wireguard_proxy.test.js` |
| 24 | Linux Packaging & CI Workflow | R3 | `.deb` package manifest, AppImage spec, GitHub Actions YAML | Missing system shared libs, broken package dependencies | `packaging_ci.test.js` |
| 25 | Focus Modes (Study, Work, Deep) | R4 | Mode switching, Pomodoro timer link, workspace linking | Timer expiration at 0, pause/resume state corruption | `focus_modes.test.js` |
| 26 | Category & Domain Blocking | R4 | Block social/video/games; Rust navigation & SPA history hooks | Encoded URLs, IP addresses, subdomains, redirect chains | `domain_blocking.test.js` |
| 27 | Calm Interstitial Page | R4 | Interstitial UI, remaining time, 5-min bypass countdown | Strict mode verification phrase typo, early exit reject | `calm_interstitial.test.js`|
| 28 | YouTube Shorts Removal | R4 | Hide Shorts elements; redirect `/shorts/:id` to `/watch?v=:id` | Embedded shorts, malformed video ID, redirect loop | `yt_shorts.test.js` |
| 29 | YouTube Recommendations Removal | R4 | Purge home feed, watch-sidebar suggestions, end-screen cards | DOM class changes, slow network hydration, dynamic load | `yt_recommendations.test.js`|
| 30 | YouTube Educational Watch Gate | R4 | Inspect `playerMicroformatRenderer.category` against allowlist | Uncategorized video, missing metadata JSON, channel pass | `yt_watch_gate.test.js` |
| 31 | Focus Daily Statistics | R4 | Track focused minutes, blocked attempts count, daily streak | Date rollover at midnight, system clock manipulation | `focus_stats.test.js` |
| 32 | Softer Dark Skin | R5 | Muted palettes (Graphite, Slate, Mocha, Midnight), 1.5px outline | Invalid palette ID fallback, accent color custom picker | `softer_dark.test.js` |
| 33 | Mayank White Skin | R5 | Neumorphic styling (#eef2f8 - #f7f9fc), double shadows, glossy blue | High-contrast accessibility mode, shadow radius clamps | `mayank_skin.test.js` |
| 34 | Wind Lines Animation | R5 | Curved swoosh SVG/canvas animation, 30 FPS throttle cap | 60s idle freeze, window blur pause, reduced-motion honor | `wind_lines.test.js` |
| 35 | Weather Orb Widget | R5 | Weather condition animation states, daylight Earth toggle | API failure fallback, invalid weather code, offline cache | `weather_orb.test.js` |
| 36 | Modular Background Registry | R6 | Dynamic module lifecycle: `mount`, `pause`, `resume`, `destroy` | Multiple simultaneous mounts, rapid switch debouncing | `background_registry.test.js`|
| 37 | Background Catalog (18 Styles) | R6 | Style instantiation (Constellation, Aurora, Fluid ink, etc.) | WebGL shader compile errors, unsupported GPU fallback | `background_catalog.test.js` |
| 38 | Background Eco Rules | R6 | 30 FPS cap, pause when hidden, 10 FPS on idle, battery saver | Visibility change events, battery API mock transitions | `background_eco.test.js` |
| 39 | High-Res Night Globe Upgrade | R6 | 20% size increase, R8 4096x2048 texture, twilight shader | Ultra 8K texture VRAM clamp, drag-to-spin boundaries | `night_globe.test.js` |
| 40 | Customizable Launch Cards | R7 | 3-6 launch cards, batch URL open, command palette execution | Card limit enforcement (min 3, max 6), hotkey Alt+1..4 | `launch_cards.test.js` |
| 41 | Secure Local Application Execution | R7 | `std::process::Command` without shell strings; allowlist check | Command injection payloads (`;`, `&`, `|`), unlisted path | `secure_exec.test.js` |
| 42 | WebView2 Extension Management | R8 | Enable extensions via `ICoreWebView2Profile7`, inspect perms | Malformed manifest, disabled in Vault & Secure sites | `wv2_extensions.test.js` |
| 43 | WebKitGTK Userscripts Engine | R8 | `WebKitUserContentManager` userscripts with `@match`/`@run-at` | Script syntax errors, match pattern wildcard edge cases | `webkit_userscripts.test.js`|
| 44 | Cross-Platform CI & Documentation | R9 | README, IPC contracts, threat model, PLACEHOLDER list | Broken markdown anchors, missing attribution entries | `docs_and_ci.test.js` |

---

## 4. Test Architecture & Runner Semantics

### 4.1 Cross-Platform Multi-Runner Architecture
The E2E test runner is designed for zero friction across developer machines (Windows 11 powershell/cmd), CI environments (GitHub Actions Ubuntu & Windows runners), and native Rust build pipelines:

1. **Primary Runner: Node.js Test Runner (`node:test` + `node:assert`)**:
   - Location: `tests/e2e/runner.js`
   - Command: `node tests/e2e/runner.js`
   - Benefits: Fast execution (< 1s), zero external dependencies, native TAP and spec reporters, built-in assertion module, full async/await support, seamless cross-platform execution on Windows and Linux.
2. **PowerShell Wrapper Runner**:
   - Location: `tests/e2e/run_tests.ps1`
   - Command: `powershell -ExecutionPolicy Bypass -File tests/e2e/run_tests.ps1`
   - Capabilities: Provides rich colorized terminal output, verifies prerequisites (Node.js, Cargo, Edge/Chrome), captures process exit codes, and reports summary tables.
3. **Cargo Integration Test Bridge**:
   - Location: `tests/e2e_runner.rs`
   - Command: `cargo test --test e2e_runner`
   - Capabilities: Invokes the test suite directly from `cargo test` to integrate into standard Rust CI workflows.

### 4.2 Standalone Preview & CDP Test Harness
To test browser UI without requiring active desktop window instantiation:
- **Headless Browser Execution**: Uses Microsoft Edge (`msedge.exe`) or Google Chrome (`chrome.exe`) in `--headless=new` mode with `--remote-debugging-port=9222`.
- **Console Error & Uncaught Exception Interception**: Connects to the browser via Chrome DevTools Protocol (CDP) WebSocket or HTTP inspect endpoint to monitor `Runtime.consoleAPICalled` and `Runtime.exceptionThrown`.
- **Mock Bridge Verification**: Ensures that when opening `ui/index.html` or `ui/newtab.html`, the standalone bridge enters mock mode seamlessly and emits 0 console errors.

---

## 5. Real-World Application Scenarios (Tier 4)

The test track defines four end-to-end synthetic user workflows executing across multiple subsystems:

### Scenario 1: Daily-Driver Morning Routine
- **Workflow**:
  1. User launches Rusty Browser; browser restores default workspace state from `data.json`.
  2. Weather orb displays cached local conditions without triggering blocking IP lookups.
  3. User presses `Alt+1` on bottom launch card to open daily news batch (3 tabs in a named tab group).
  4. User triggers Split View (`Ctrl+\`); active viewport dynamically resizes two webviews to 50/50 ratio without layout jitter.
  5. User checks memory badge in status rail: active private working set reports within 2% of OS metrics.

### Scenario 2: Deep Work & Distraction-Free Study Session
- **Workflow**:
  1. User switches to "College / Study" workspace; Focus Mode automatically activates Study mode for 45 minutes.
  2. Inactive workspace tabs are completely destroyed from OS memory.
  3. User attempts navigation to a distracting domain (`youtube.com/shorts/...` or social media).
  4. Rust core navigation handler intercepts navigation; Calm Interstitial renders remaining time and motivational countdown.
  5. User navigates to approved educational lecture on YouTube; recommendations and sidebar are stripped, video plays without interruption.

### Scenario 3: Heavy Multi-Tab Research & Memory Management
- **Workflow**:
  1. User opens 10 research tabs across documentation sites and scientific papers.
  2. Background tabs invoke `TrySuspend` and set `MemoryUsageTargetLevel = Low`.
  3. After inactivity timeout, idle tabs are discarded, freeing renderer processes while preserving tab title, favicon, and scroll offset.
  4. System telemetry measures total memory consumption, confirming >= 15% RAM savings compared to Google Chrome baseline.

### Scenario 4: Cross-Platform Privacy & Isolation
- **Workflow**:
  1. User creates an Isolated Profile Workspace with independent cookie jar and isolated user data directory.
  2. User signs into authenticated session in isolated workspace; session cookies do not leak to primary workspace.
  3. Ad-blocker blocks third-party trackers; userspace WireGuard proxy encrypts outbound traffic.
  4. Credentials and settings are encrypted at rest using DPAPI (Windows) or Secret Service (Linux).

---

## 6. Coverage Thresholds & Quality Gates

To ensure rigorous quality throughout development, the following thresholds are enforced:

| Tier | Metric | Target Threshold | Quality Gate Action |
|---|---|---|---|
| **Tier 1: Feature Coverage** | Test cases per feature (1–44) | >= 5 per feature (>= 220 total) | Gate blocks milestone if feature has < 5 tests |
| **Tier 2: Boundary & Corner Cases** | Test cases per feature (1–44) | >= 5 per feature (>= 220 total) | Gate blocks milestone if boundary tests missing |
| **Tier 3: Pairwise Interactions** | Core feature interaction pairs | >= 30 cross-feature tests | Verified during milestones R2, R4, R6, R8 |
| **Tier 4: Workload Scenarios** | End-to-end synthetic scenarios | 4 comprehensive scenarios | Verified prior to release milestone R9 |
| **Invariants (INV-01 to INV-10)** | Invariant rule coverage | 100% (all 10 rules covered) | Mandatory pass on every build |
| **Pass Rate** | Execution success rate | 100% exit code 0 | Pipeline fails on single test failure |

---

*Authored and verified by E2E Test Track Infrastructure Specialist.*
