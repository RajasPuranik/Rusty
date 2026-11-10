# Dispatch: Worker R0 (Baseline Measurement & Platform Layer Abstraction Implementation)

## Role & Mission
You are the **Worker for Milestone R0**. Your mission is to implement, build, test, and verify Milestone R0 of Rusty Browser in accordance with the authoritative plans created by Explorer R0-1, Explorer R0-2, and Spec Miner R0-3.

## Working Directory
`d:\browser\.agents\teamwork\worker_r0\`

## Authoritative Inputs
- `d:\browser\.agents\teamwork\ORIGINAL_REQUEST.md` (MANDATORY: Read first and completely!)
- `d:\browser\PROJECT.md`
- `d:\browser\.agents\teamwork\explorer_r0_1\survey_r0_telemetry.md` & `handoff.md` (Exact telemetry, process classification, and 5-state test script)
- `d:\browser\.agents\teamwork\explorer_r0_2\survey_r0_platform.md` & `handoff.md` (Exact platform trait definitions and Windows WebView2 implementation)
- `d:\browser\.agents\teamwork\spec_miner_r0_3\survey_r0_linux.md` & `handoff.md` (Exact Linux platform trait and /proc/<pid>/smaps_rollup implementation)

## Exclusive File Ownership
You exclusively own and may edit or create:
- `src/platform/mod.rs`
- `src/platform/windows.rs`
- `src/platform/linux.rs`
- `src/telemetry.rs`
- `src/main.rs`
- `verify_5states.ps1`

## Implementation Tasks
1. **Platform Layer Module (`src/platform/`)**:
   - Create `src/platform/mod.rs` with `PlatformWebView`, `PlatformHost`, `WebViewConfig`, `PlatformPermission*`, and error handling.
   - Create `src/platform/windows.rs` implementing `PlatformWebView` and `PlatformHost` for Windows WebView2 COM interfaces (`ICoreWebView2Controller`, `ICoreWebView2_3` with `TrySuspend`/`Resume`, `ICoreWebView2_19` with `SetMemoryUsageTargetLevel`, `ICoreWebView2_2` with `CookieManager`).
   - Create `src/platform/linux.rs` providing the Linux WebKitGTK platform implementation and trait stubs conforming to `PlatformWebView` / `PlatformHost`.
2. **Telemetry & Process Classification (`src/telemetry.rs`)**:
   - Isolate the UI Webview renderer process from content renderers by registering the initial shell renderer PID.
   - Replace the non-Windows placeholder with pure `/proc/<pid>/smaps_rollup` and `/proc/<pid>/stat` parsers, fully unit-tested.
   - Ensure `sample_process_tree` correctly classifies roles (Host, UI WebView, Content Renderer, GPU, Network, Storage, Audio).
3. **Application Loop Integration (`src/main.rs`)**:
   - Integrate `src/platform/` into `src/main.rs`, updating `content_webviews` to `HashMap<TabId, Box<dyn PlatformWebView>>` and `chrome_wv` to `Box<dyn PlatformWebView>`.
   - Add CLI flags `--skin <minimal|crazy>`, `--split`, and `--dump-telemetry <path>` for headless/automated testing.
4. **Automated 5-State Verification Script (`verify_5states.ps1`)**:
   - Implement `verify_5states.ps1` executing and recording private working set and working set across all 5 states:
     - State 1: Empty window
     - State 2: New tab page per skin (Minimal < 60 MB UI, Crazy < 120 MB UI)
     - State 3: 5 tabs
     - State 4: 10 tabs (asserting >= 15% less RAM than Chrome)
     - State 5: Split view
   - Reconcile in-browser telemetry against Task Manager Details active private working set (variance <= 2%).
5. **Build & Test Verification**:
   - Run `cargo check`
   - Run `cargo clippy --all-targets -- -D warnings`
   - Run `cargo test`
   - Run `powershell -ExecutionPolicy Bypass -File .\verify_5states.ps1`
6. **Reporting**:
   - Write full implementation report to `d:\browser\.agents\teamwork\worker_r0\implementation.md`.
   - Write self-contained handoff to `d:\browser\.agents\teamwork\worker_r0\handoff.md`.


## 2026-11-09T18:08:14Z
You are Worker R0 (Milestone R0 Implementation Worker).
Your working directory is d:\browser\.agents\teamwork\worker_r0\
Read your dispatch instructions at d:\browser\.agents\teamwork\worker_r0\DISPATCH.md.
MANDATORY: You MUST read the authoritative user request at d:\browser\.agents\teamwork\ORIGINAL_REQUEST.md and d:\browser\PROJECT.md before beginning.

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

Your task is to implement Milestone R0 in accordance with the designs from Explorer R0-1, Explorer R0-2, and Spec Miner R0-3:
1. Platform Layer Module:
   - Create src/platform/mod.rs (PlatformWebView, PlatformHost traits, WebViewConfig, PlatformError).
   - Create src/platform/windows.rs (Windows WebView2 COM implementation wrapping wry and raw handles: TrySuspend, Resume, SetMemoryUsageTargetLevel, CookieManager).
   - Create src/platform/linux.rs (WebKitGTK implementation and trait stubs).
2. Telemetry & Process Classification:
   - Update src/telemetry.rs to distinguish UI Webview renderer from Content renderers by capturing the initial shell renderer PID.
   - Replace the non-Windows placeholder with pure /proc/<pid>/smaps_rollup and /proc/<pid>/stat parsers with 100% unit test coverage.
3. Integrate into src/main.rs:
   - Update content_webviews and chrome_wv to Box<dyn PlatformWebView>.
   - Add CLI flags --skin <minimal|crazy>, --split, and --dump-telemetry <path>.
4. Verification & Testing:
   - Implement verify_5states.ps1 and run it.
   - Run cargo check, cargo clippy --all-targets -- -D warnings, and cargo test.
   - Document all verification commands and outputs.
5. Produce d:\browser\.agents\teamwork\worker_r0\implementation.md and d:\browser\.agents\teamwork\worker_r0\handoff.md following the Handoff Protocol.
6. Send a completion message to the caller with your results and file paths.
