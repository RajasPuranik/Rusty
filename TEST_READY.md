# TEST_READY: E2E Test Infrastructure & Baseline Suite

**Date**: 2026-11-09  
**Status**: TEST TRACK READY FOR IMPLEMENTATION  
**Document Path**: `d:\browser\TEST_READY.md`  
**Test Specification**: `d:\browser\TEST_INFRA.md`  

---

## 1. Test Track Overview

The End-to-End (E2E) Test Track infrastructure for Rusty Browser is fully established and verified. The test suite operates independently as an opaque-box, requirement-driven harness derived from `ORIGINAL_REQUEST.md` and `PROJECT.md § Feature Inventory`.

All test suites execute cleanly with exit code 0.

---

## 2. Test Execution Commands

Developers and CI workflows can run the test suite via multiple cross-platform mechanisms:

### 2.1 Primary Runner (Cross-Platform Node.js)
```bash
# Run all E2E test suites with structured summary
node tests/e2e/runner.js

# Run with verbose spec reporter
node tests/e2e/runner.js --spec

# Run filtered test suites (e.g. only invariants or preview runner)
node tests/e2e/runner.js --filter invariants
node tests/e2e/runner.js --filter preview_runner
```

### 2.2 PowerShell Runner (Windows Native)
```powershell
# Run full suite
powershell -ExecutionPolicy Bypass -File tests/e2e/run_tests.ps1

# Run with filter
powershell -ExecutionPolicy Bypass -File tests/e2e/run_tests.ps1 -Filter invariants -Spec
```

### 2.3 Unit Test Suite (Cargo)
```bash
# Verify internal unit tests (51 unit tests)
cargo test --bin rusty_browser
```

---

## 3. Baseline Suite Coverage Status

| Suite File | Focus Area | Features / Invariants Covered | Tests | Status |
|---|---|---|---|---|
| `tests/e2e/invariants.test.js` | Core Invariants | **INV-01 through INV-10** (Asset isolation, origin gating, mock preview, placeholders, trademarks, honest security, legacy security, anti-faking, complete code, attribution) | 16 | **PASS (100%)** |
| `tests/e2e/preview_runner.test.js` | Mock Bridge & UI Preview | **INV-03**, standalone bridge state transitions, real headless Edge/Chrome DOM render for `ui/index.html` and `ui/newtab.html` | 8 | **PASS (100%)** |
| `tests/e2e/platform_contract.test.js` | Platform Trait & IPC | **Feature 5** (`PlatformWebView`, `PlatformHost`), `RectPayload`, `ProcessMemoryRecord`, `UiMessage` schemas | 9 | **PASS (100%)** |
| `tests/e2e/telemetry_win.test.js` | Telemetry & Reconciliation | **Features 1, 3, 4** (Role classification, Task Manager Details <= 2% reconciliation, `--user-data-dir` filtering, PID reuse rejection) | 9 | **PASS (100%)** |
| **Total** | **Baseline Initial Suite** | **4 Suites** | **42** | **PASS (100%)** |

---

## 4. Progressive Test Plan Across Milestones R0–R9

As sequential milestones progress, additional Tier 1, Tier 2, Tier 3, and Tier 4 test suites will be added to `tests/e2e/` adhering to `TEST_INFRA.md`:

- **Milestone R0**: `telemetry_win.test.js`, `telemetry_linux.test.js`, `platform_contract.test.js`
- **Milestone R1**: `workspaces_state.test.js`, `webview_lifecycle.test.js`, `atomic_storage.test.js`, `workspace_ui.test.js`, `isolated_profile.test.js`
- **Milestone R2**: `tab_suspension.test.js`, `tab_discard.test.js`, `renderer_limit.test.js`, `dom_virtualization.test.js`, `lite_mode.test.js`
- **Milestone R3**: `webkitgtk_platform.test.js`, `linux_csd.test.js`, `xdg_compliance.test.js`, `secret_service.test.js`, `webkit_adblock.test.js`, `wireguard_proxy.test.js`, `packaging_ci.test.js`
- **Milestone R4**: `focus_modes.test.js`, `domain_blocking.test.js`, `calm_interstitial.test.js`, `yt_shorts.test.js`, `yt_recommendations.test.js`, `yt_watch_gate.test.js`, `focus_stats.test.js`
- **Milestone R5**: `softer_dark.test.js`, `mayank_skin.test.js`, `wind_lines.test.js`, `weather_orb.test.js`
- **Milestone R6**: `background_registry.test.js`, `background_catalog.test.js`, `background_eco.test.js`, `night_globe.test.js`
- **Milestone R7**: `launch_cards.test.js`, `secure_exec.test.js`
- **Milestone R8**: `wv2_extensions.test.js`, `webkit_userscripts.test.js`
- **Milestone R9**: Full suite 100% pass across all 4 tiers, Tier 5 adversarial hardening, and documentation verification.

---

## 5. Escalated Implementation Findings

During test track setup, the following build finding was discovered:
- **MinGW GCC Linker Warning**: Compiling separate integration test binaries (`tests/*.rs`) on Windows with target `x86_64-pc-windows-gnu` fails during linking with `ld: cannot find -lpdh: No such file or directory`. The primary application binary links correctly via `cargo test --bin rusty_browser`. Recommend that the implementation worker/orchestrator add `pdh.lib` / MinGW import library or configure `build.rs` linker paths when adding Rust-side integration test binaries.

---

*Published by E2E Test Track Infrastructure Specialist.*
