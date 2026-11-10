# Handoff Report — Explorer 3 (Requirements Specification & Dependency Miner)

**Working Directory**: `d:\browser\.agents\teamwork\spec_miner_survey_3\`  
**Target Specification Document**: `d:\browser\.agents\teamwork\spec_miner_survey_3\survey_spec.md`  
**Handoff Type**: Hard (Task Complete)  
**Date**: 2026-11-09T17:48:00Z  

---

## 1. Observation

Direct observations from the authoritative user prompt and the existing repository:

1. **Authoritative Specification & Sequential Milestones** (`ORIGINAL_REQUEST.md` lines 18–34):
   - Milestones must be executed sequentially: "R0 through R9 sequentially in specified order, verifying each milestone before proceeding."
   - Invariants: "Only the active skin's code loads into memory", "Typed IPC communication across rusty://app/ origin only", "Mock bridge preview runs cleanly without console errors", "PLACEHOLDER comments for all user-supplied assets", "Never copy real brand logos", "Honest security limits", "Preserve earlier security capabilities (V1 ad blocker, V2 VPN/proxy, V3 vault, V4 session protection)", "Provide complete files with no truncated '...rest of code' blocks."
2. **Current Platform Layer Coupling** (`src/main.rs` lines 38–40, 1410–1429):
   - Direct Windows extension imports:
     ```rust
     #[cfg(target_os = "windows")]
     use wry::{WebViewBuilderExtWindows, WebViewExtWindows};
     ```
   - Current Linux build attaches to `window.default_vbox()`:
     ```rust
     let vbox = window.default_vbox().context("Failed to get GTK vbox")?;
     builder.build_gtk(vbox).context("Failed to create content WebView (GTK)")?
     ```
     This contradicts the requirement in `ORIGINAL_REQUEST.md` line 50: "via the GTK path (`build_gtk` with a `gtk::Fixed` container) supporting X11 and Wayland."
3. **Current Telemetry Platform Disparity** (`src/telemetry.rs` lines 208–222):
   - On Windows, genuine process-tree sampling is implemented via `NtQueryInformationProcess(ProcessVmCounters)`.
   - On Linux, memory telemetry is currently a hardcoded dummy stub:
     ```rust
     #[cfg(not(target_os = "windows"))]
     {
         let est = 35.0 + (fallback_active_webviews as f64 * 30.0);
         BrowserMemoryBreakdown { total_private_ws_mb: est, ... }
     }
     ```
     This violates `ORIGINAL_REQUEST.md` line 33 and line 51 requiring real PSS from `/proc/<pid>/smaps_rollup`.
4. **Current Tab Lifecycle & Workspaces Gap** (`src/tab.rs` lines 43–45, 98–104):
   - `Tab` contains `has_webview: bool` and `is_discarded: bool`, but workspace ownership, tab-group structures, and isolated profile directories are not yet defined in Rust state. Tabs are managed as a single flat `Vec<Tab>` in `TabManager`.
5. **Existing Verification Scripts** (`verify_memory.ps1` lines 8–14, `benchmark.ps1` lines 45–56):
   - `verify_memory.ps1` measures `WorkingSetPrivate`, `WorkingSet`, and `PrivateBytes` by walking the PID tree rooted at `rusty_browser.exe` and matching `--user-data-dir`.
   - `benchmark.ps1` specifies 10 test URLs: `youtube.com`, `instagram.com`, `accounts.google.com`, `wikipedia.org/wiki/Rust_(programming_language)`, `github.com/rust-lang/rust`, `bbc.com`, `reddit.com`, `news.ycombinator.com`, `rust-lang.org`, `stackoverflow.com/questions`.

---

## 2. Logic Chain

1. **From Observation 1 (Invariants & Sequential Milestones)**:
   - Because milestones must be executed sequentially (R0 -> R1 -> R2 ... -> R9) and early security capabilities must be preserved, foundational platform abstractions must be laid down in R0 before subsequent features (Workspaces in R1, RAM optimization in R2, Focus Mode in R4, Extensions in R8) can be built cleanly without platform-specific code sprawl.
2. **From Observation 2 & 3 (Platform Trait & Telemetry Stubs)**:
   - In `src/main.rs`, platform calls are currently embedded directly in the window creation and webview building pipelines. For R0, defining `PlatformWebView` and `PlatformHost` traits decouples `src/main.rs` from Windows COM (`ICoreWebView2Controller`) and GTK C types (`GtkBox`, `GtkWidget`).
   - For Linux (R3), replacing the dummy stub in `src/telemetry.rs` with `/proc/<pid>/smaps_rollup` reading guarantees cross-platform parity for memory verification.
3. **From Observation 4 (Tab State vs Workspaces)**:
   - Because R1 requires that *only the active workspace has live webviews*, the tab state machine in `src/tab.rs` must be elevated to a `WorkspaceManager`. When switching workspaces, active webviews are dropped (freeing renderer RAM) and recreated for the newly selected workspace.
4. **From Observation 5 (Measurement Reconciliation)**:
   - The user's acceptance criteria require that in-browser memory badges reconcile with Task Manager Details active private working set within 2%, and that 10 open tabs consume >= 15% less RAM than Chrome. The existing `verify_memory.ps1` and `benchmark.ps1` tools provide the exact harness to validate this across all milestones.

---

## 3. Caveats

- **YouTube Internal DOM Mutability**: As documented in `ORIGINAL_REQUEST.md` line 64, YouTube changes internal DOM elements and CSS class names periodically. The YouTube Study Filter specification is client-side best-effort, relying on externalized JSON configuration (`youtube_rules.json`) and `playerMicroformatRenderer.category` metadata rather than hardcoded class names.
- **Chrome Extension API Parity on Linux**: WebKitGTK 4.1 does not support Chrome/Chromium extension APIs (`chrome.tabs`, `chrome.runtime`). In accordance with Invariant INV-08 (Anti-Faking Mandate), Linux provides Tampermonkey-style Userscripts via `WebKitUserContentManager` rather than pretending to support `.crx` extensions.
- **NVIDIA / Wayland DMA-BUF Glitches**: WebKitGTK on Wayland with proprietary NVIDIA drivers occasionally exhibits renderer process crashes when DMA-BUF hardware acceleration is active. The documented workaround (`WEBKIT_DISABLE_DMABUF_RENDERER=1`) must be included in the README.

---

## 4. Conclusion

The specification mining phase is complete. All 10 milestones (R0 through R9) have been decomposed into:
- **38 discrete functional features** catalogued with inputs, outputs, error behaviors, and discovery provenance.
- **20 edge case scenarios** with concrete mitigation behaviors.
- **Concrete Rust struct definitions and trait method signatures** for the platform layer, workspace state, RAM optimization, focus mode, and launch cards.
- **Platform API requirements** contrasting Windows WebView2 COM interfaces (`ICoreWebView2_3`, `ICoreWebView2_4`, `ICoreWebView2Profile7`) with Linux WebKitGTK 4.1 (`build_gtk` with `gtk::Fixed`, `WebKitUserContentFilterStore`, `WebKitUserContentManager`).
- **Exact acceptance criteria and verification commands** covering memory guardrails (<60 MB minimal UI, <120 MB crazy/mayank UI, 15% lower than Chrome for 10 tabs).

The full analysis is documented in `d:\browser\.agents\teamwork\spec_miner_survey_3\survey_spec.md`.

---

## 5. Verification Method

To independently verify the findings and analysis:
1. **Inspect Specification Document**:
   - Open and review `d:\browser\.agents\teamwork\spec_miner_survey_3\survey_spec.md`.
   - Confirm coverage of all milestones (R0 to R9), the Features Discovered table (38 features), the Edge Cases table (20 cases), and detailed focus sections (R0 process tree, R4 YouTube filters, R8 extension APIs, R9 deliverables).
2. **Verify Codebase Line Citations**:
   - Check `src/main.rs:38-40` and `src/main.rs:1422-1429` for existing platform construction.
   - Check `src/telemetry.rs:208-222` for the Linux stub needing replacement.
   - Check `ORIGINAL_REQUEST.md:18-133` to verify 1:1 alignment with user constraints.
3. **Verify Build & Compilation Readiness**:
   - Run `cargo check` to confirm current project compilation status.
   - Run `cargo test` to verify all 48 existing unit tests pass before any code modifications begin.
