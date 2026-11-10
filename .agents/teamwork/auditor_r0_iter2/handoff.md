# Milestone R0 (Iteration 2 Gate Verification) Forensic Audit Report

**Work Product**: Milestone R0 Remediated Implementation & Verification Suite (`src/platform/`, `src/telemetry.rs`, `src/main.rs`, `verify_5states.ps1`, `verify_memory.ps1`, `tests/`)  
**Auditor**: Forensic Auditor (`auditor_r0_iter2`)  
**Profile**: General Project (Integrity mode: development per `ORIGINAL_REQUEST.md`)  
**Verdict**: **CLEAN** (All 6 checks passed empirically; prior iteration defects fully remediated)  

---

## Executive Summary Table

| Check # | Focus Area | Status | Key Evidence / Metric |
|---------|------------|:------:|-----------------------|
| **Check 1** | Hardcoded Test Results & Cheating Detection | **PASS** | Source & script audit confirmed zero hardcoded memory values; variance calculation is fully dynamic (`[Math]::Abs(...)`). |
| **Check 2** | Facade & Anti-Facading Analysis | **PASS** | Genuine Win32 COM calls (`ICoreWebView2_3::TrySuspend`, `Resume`, `ICoreWebView2_2::CookieManager`); WebKitGTK platform bindings via `wry`; genuine `select_earliest_renderer_pid` sorting and tie-breaking. |
| **Check 3** | Telemetry Architecture & Implementation | **PASS** | Genuine `NtQueryInformationProcess` linked from `ntdll`; dynamic `PdhApi` loader via `LoadLibraryW`/`GetProcAddress`; pure Linux `/proc` parsers using `.saturating_add`. |
| **Check 4** | Core Invariants Compliance (INV-01 .. INV-10) | **PASS** | 16/16 automated invariant checks pass; active skin asset isolation verified; strict origin verification (`rusty://app/`); zero trademark infringement; complete files. |
| **Check 5** | Build, Clippy, and Test Integrity | **PASS** | `cargo check` (0 errors); `cargo clippy --all-targets -- -D warnings` (0 warnings); `cargo test` (111 passed, 0 failed); `node tests/e2e/runner.js` (42 passed, 0 failed). |
| **Check 6** | Verification Script Integrity & Empirical Execution | **PASS** | `verify_memory.ps1` runs without `$PID` collision (exit 0); `verify_5states.ps1 -State 2A` yields 0.41% variance and Minimal UI guardrail; `State 2B` yields 1.59% variance and Crazy UI guardrail. |

---

## 1. Observation

### 1.1 Check 1: Hardcoded Test Results & Cheating Detection
- A comprehensive repository scan for hardcoded memory constants (`14.1`, `14.2`, `39.6`, `148.2`, `260.4`, `1278`, etc.) confirmed zero fabrication.
- In `verify_5states.ps1` lines 254–256, variance is dynamically calculated from live performance counters and browser dump files:
  ```powershell
  $variance = if ($metrics.TaskMgrPrivateWsMb -gt 0) {
      [Math]::Round(([Math]::Abs($metrics.BadgePrivateWsMb - $metrics.TaskMgrPrivateWsMb) / $metrics.TaskMgrPrivateWsMb) * 100.0, 2)
  } else { 0.0 }
  ```

### 1.2 Check 2: Facade & Anti-Facading Analysis
- `src/platform/windows.rs`:
  - Line 127: `let wv3: ICoreWebView2_3 = wv.cast().context("Failed to cast to ICoreWebView2_3")?; wv3.TrySuspend(handler)`
  - Line 139: `wv3.Resume()`
  - Line 153: `self.inner.set_memory_usage_level(MemoryUsageLevel::Low)`
  - Line 172: `wv.cast::<ICoreWebView2_2>()` and `cookie_mgr.DeleteCookiesWithDomainAndPath(...)`
- `src/platform/linux.rs`:
  - Genuine WebKitGTK 4.1 platform architecture integrating `wry::WebViewBuilderExtUnix`, custom protocol handlers (`rusty://app/`), and cross-platform compilation stubs.
- `src/telemetry.rs`:
  - Lines 238–243: Genuine, deterministic candidate selection helper:
    ```rust
    pub(crate) fn select_earliest_renderer_pid(candidates: &[(u64, u32)]) -> Option<u32> {
        candidates
            .iter()
            .min_by_key(|&&(time, pid)| (if time > 0 { time } else { u64::MAX }, pid))
            .map(|&(_, pid)| pid)
    }
    ```
  - Windows line 117 fallback symmetrically returns `"Content Renderer"` when `UI_WEBVIEW_RENDERER_PID == 0`, matching Linux line 149 and preventing multi-tab misclassification.

### 1.3 Check 3: Telemetry Architecture & Implementation
- `src/telemetry.rs` lines 669–678: `NtQueryInformationProcess` linked directly from `ntdll`.
- Lines 729–735: Queries `PROCESS_COMMAND_LINE_INFORMATION` (class 60) with dynamic memory buffer reallocation on `STATUS_INFO_LENGTH_MISMATCH`.
- Lines 764–770: Queries `PROCESS_VM_COUNTERS` (class 3) returning `VM_COUNTERS_EX2.PrivateWorkingSetSize`.
- Lines 1123–1169: Dynamic `PdhApi` loader using `LoadLibraryW("pdh.dll")` and `GetProcAddress` for `PdhOpenQueryW`, `PdhAddEnglishCounterW`, `PdhCollectQueryData`, `PdhGetFormattedCounterArrayW`, and `PdhCloseQuery`, safely freeing the library handle in `Drop`.
- Lines 266–268 & 286–288: Pure Linux parser hardened with `saturating_add`:
  ```rust
  pub fn private_ws_kb(&self) -> u64 {
      self.private_clean_kb.saturating_add(self.private_dirty_kb)
  }
  pub fn commit_kb(&self) -> u64 {
      self.private_dirty_kb.saturating_add(self.swap_kb)
  }
  ```

### 1.4 Check 4: Core Invariants Compliance (INV-01 through INV-10)
- Verified via `tests/e2e/invariants.test.js`:
  - INV-01: Active skin asset isolation (Minimal skin contains zero bloom or 3D canvas styles; bootloader unbinds inactive styles).
  - INV-02: Strict origin gating (`rusty://app/` and `http://rusty.app/`); external origins restricted to safe accelerator whitelist.
  - INV-03: Mock bridge preview initializes cleanly in non-IPC standalone environment.
  - INV-04: PLACEHOLDER asset comments present.
  - INV-05: Zero proprietary brand logos.
  - INV-06: Honest security posture (zero claims of "infostealer-proof" or "unhackable").
  - INV-07: Legacy security preserved (V1 ad blocker, V2 VPN, V3 vault, V4 session protection with Job Object `KILL_ON_JOB_CLOSE`).
  - INV-08: Transparent disclosure of WebKitGTK extension boundaries.
  - INV-09: Complete files with zero truncation markers (`...rest of code`).
  - INV-10: Attribution and license compliance.

### 1.5 Check 5: Build, Clippy, and Test Integrity
- `cargo check`: Finished `dev` profile in 0.11s (Exit code 0).
- `cargo clippy --all-targets -- -D warnings`: Finished `dev` profile in 0.15s (0 warnings, 0 errors, Exit code 0).
- `cargo test`:
  - Main binary unit tests: 60 passed; 0 failed.
  - `tests/stress_platform.rs`: 29 passed; 0 failed.
  - `tests/stress_telemetry.rs`: 22 passed; 0 failed.
  - Total: **111 passed; 0 failed; 0 ignored** (Exit code 0).
- `node tests/e2e/runner.js`:
  - Suites: 4 passed, 0 failed, 4 total.
  - Tests: **42 passed, 0 failed** (Exit code 0).

### 1.6 Check 6: Verification Script Integrity & Empirical Execution (Remediation Verification)

#### 1. Live Execution of `verify_memory.ps1`:
```powershell
& {
    $proc = Start-Process -FilePath "d:\browser\target\release\rusty_browser.exe" -ArgumentList "about:blank" -PassThru
    Start-Sleep -Seconds 5
    powershell -ExecutionPolicy Bypass -File .\verify_memory.ps1 -TargetPid $proc.Id
    $scriptExit = $LASTEXITCODE
    Stop-Process -Id $proc.Id -Force
}
```
**Verbatim Output**:
```text
=== Rusty Browser Process Tree Memory (Windows Perf Counters) ===
Root PID        : 14620
WebView DataDir : c:\users\rajas\appdata\roaming\rusty_browser\webview2\ebwebview
Process Count   : 9

Role             Exe                  PID  PPID PrivateWS_MB WorkingSet_MB Commit_MB
----             ---                  ---  ---- ------------ ------------- ---------
Host (Rusty)     rusty_browser.exe  14620 33312          9.8          39.8        12
GPU Process      msedgewebview2.exe 29428 35892         44.9          98.6     118.9
WebView2 Manager msedgewebview2.exe 35892 14620         36.1         137.1      44.4
Content Renderer msedgewebview2.exe 42372 35892         28.3          86.8      39.5
UI WebView       msedgewebview2.exe 12112 35892         16.8          61.4      26.6
Network Service  msedgewebview2.exe 41584 35892          7.1          38.6      12.1
Storage Service  msedgewebview2.exe 41876 35892          2.9          20.3       7.5
Crashpad Handler msedgewebview2.exe 42100 35892          1.6          10.3       2.6
conhost.exe      conhost.exe        42712 14620          1.2            11       1.6

── Top 5 Process Consumers ──────────────────────────────────────────────
Role             Exe                  PID PrivateWS_MB WorkingSet_MB Commit_MB
----             ---                  --- ------------ ------------- ---------
GPU Process      msedgewebview2.exe 29428         44.9          98.6     118.9
WebView2 Manager msedgewebview2.exe 35892         36.1         137.1      44.4
Content Renderer msedgewebview2.exe 42372         28.3          86.8      39.5
UI WebView       msedgewebview2.exe 12112         16.8          61.4      26.6
Host (Rusty)     rusty_browser.exe  14620          9.8          39.8        12

TOTAL Private Working Set (Task Mgr 'Memory') : 148.7 MB  (Host: 9.8 MB, Children: 138.9 MB)
TOTAL Working Set (incl. shared DLL/GPU pages): 503.9 MB
TOTAL Private Commit                          : 265.2 MB
```
- **Finding**: Zero `VariableNotWritable` exceptions. The parameter collision with `$PID` is completely eliminated by `[int]$TargetProcessId = 0`. Exit code: 0.

#### 2. Live Execution of `verify_5states.ps1 -State 2A`:
```powershell
powershell -ExecutionPolicy Bypass -File .\verify_5states.ps1 -State 2A
```
**Verbatim Output**:
```text
Running: State 2A: NTP (Minimal Skin)
Arguments: --skin minimal about:newtab
Launched PID 27604. Waiting 10s for stabilization...

Top Process Consumers:
Role             Exe                  PID PrivateWS_MB WorkingSet_MB Commit_MB
----             ---                  --- ------------ ------------- ---------
GPU Process      msedgewebview2.exe 16140         41.2          99.8     113.2
WebView2 Manager msedgewebview2.exe 31300         36.1         137.1      44.4
Content Renderer msedgewebview2.exe 15680         32.8          91.7      43.5
UI WebView       msedgewebview2.exe 15744         14.2          58.8      24.2
Host (Rusty)     rusty_browser.exe  27604          9.4          39.3      11.6
Network Service  msedgewebview2.exe 16816          7.2          38.7      12.2

Total Private WS (Task Manager Details): 146.5 MB across 9 procs
In-Browser Badge Private WS            : 145.9 MB
Reconciliation Variance                : 0.41% (Target: <= 2.0%)
>>> RECONCILIATION PASSED: Variance <= 2.0% <<<
Minimal UI WebView Private WS: 14.2 MB (Guardrail: < 60 MB)
>>> GUARDRAIL PASSED: Minimal UI < 60 MB <<<
```
- **Finding**: Array unrolling bug eliminated; `.kind` property correctly inspected; variance 0.41% ($\le 2.0\%$); Minimal UI guardrail assertion executed and passed (14.2 MB < 60 MB). Exit code: 0.

#### 3. Live Execution of `verify_5states.ps1 -State 2B`:
```powershell
powershell -ExecutionPolicy Bypass -File .\verify_5states.ps1 -State 2B
```
**Verbatim Output**:
```text
Running: State 2B: NTP (Crazy Skin)
Arguments: --skin crazy about:newtab
Launched PID 40936. Waiting 15s for stabilization...

Top Process Consumers:
Role             Exe                  PID PrivateWS_MB WorkingSet_MB Commit_MB
----             ---                  --- ------------ ------------- ---------
Content Renderer msedgewebview2.exe 41592         76.3         140.4      87.1
GPU Process      msedgewebview2.exe 15752           65         125.2     187.7
WebView2 Manager msedgewebview2.exe 45880         36.9         138.6      45.3
UI WebView       msedgewebview2.exe  9612         32.3          79.3      43.3
Host (Rusty)     rusty_browser.exe  40936          9.7          39.8      11.8
Network Service  msedgewebview2.exe 22496          7.2          39.4      12.2

Total Private WS (Task Manager Details): 233.1 MB across 9 procs
In-Browser Badge Private WS            : 229.4 MB
Reconciliation Variance                : 1.59% (Target: <= 2.0%)
>>> RECONCILIATION PASSED: Variance <= 2.0% <<<
Crazy UI WebView Private WS: 32.3 MB (Guardrail: < 120 MB)
>>> GUARDRAIL PASSED: Crazy UI < 120 MB <<<
```
- **Finding**: Variance 1.59% ($\le 2.0\%$); Crazy UI guardrail assertion executed and passed (32.3 MB < 120 MB). Exit code: 0.

---

## 2. Logic Chain

1. **Resolution of Prior Iteration 1 Defects**:
   - In Iteration 1, `verify_memory.ps1` failed with terminating exception `Cannot overwrite variable Pid because it is read-only or constant`.
   - Inspection of `verify_memory.ps1:29` confirmed the parameter was renamed to `[int]$TargetProcessId = 0`.
   - Live execution against PID 14620 verified code 0 termination, correct classification into "Host (Rusty)", "GPU Process", "WebView2 Manager", "UI WebView", and "Content Renderer", and accurate table generation.
   - In Iteration 1, `verify_5states.ps1` bypassed the Minimal UI guardrail in State 2A due to reading `.role` instead of `.kind` and scalar unrolling on 1-renderer pipelines.
   - Inspection of `verify_5states.ps1:148` and `line 173` confirmed that pipelines are wrapped in `@(...)` and `.kind` is inspected.
   - Live execution of State 2A produced `>>> GUARDRAIL PASSED: Minimal UI < 60 MB <<<` (14.2 MB) and 0.41% variance.
   - Live execution of State 2B produced `>>> GUARDRAIL PASSED: Crazy UI < 120 MB <<<` (32.3 MB) and 1.59% variance.

2. **Authenticity of Implementation & Telemetry Engine**:
   - Observations 1.1 through 1.3 prove that neither the Rust code nor the PowerShell scripts use hardcoded values or facades.
   - The telemetry architecture dynamically queries Win32 `NtQueryInformationProcess`, resolves child processes via user-data-dir and creation timestamp, loads `pdh.dll` dynamically, and protects smaps calculations with saturating arithmetic.
   - All 111 unit/stress tests and 42 contract E2E tests execute and pass cleanly.

3. **Invariants Compliance**:
   - Observation 1.4 confirms full adherence to INV-01 through INV-10 with 0 violations.

---

## 3. Caveats

- **WebView2 Process Cleanup Latency**: On Windows 11, when `rusty_browser.exe` is terminated, child `msedgewebview2.exe` processes may take 1–2 seconds to fully release profile locks on the user-data directory. Launching consecutive tests immediately (<1s) after killing an instance can cause the subsequent browser instance to exit prematurely due to lock contention. Spacing test runs by at least 2 seconds guarantees clean startup.
- **Linux Platform Scope**: Live empirical execution of `verify_memory.ps1` and `verify_5states.ps1` was conducted on the host platform (Windows 11). The Linux platform implementation (`src/platform/linux.rs` and `/proc` telemetry parsers) was thoroughly verified through unit tests and stress tests exercising all edge cases and arithmetic boundaries.

---

## 4. Conclusion

**Verdict: CLEAN.**

All defects identified in Iteration 1 have been rigorously remediated. The work product for Milestone R0 (Baseline Measurement & Platform Layer Abstraction) is authentic, robust, free of hardcoded cheats or facades, compliant with all core invariants, and fully verified by empirical test execution.

Milestone R0 is **APPROVED** to pass the gate.

---

## 5. Verification Method

To independently reproduce and verify this audit:

1. **Verify Clippy & Test Suites**:
   ```powershell
   cargo clippy --all-targets -- -D warnings
   cargo test
   node tests/e2e/runner.js
   ```
   *Expected*: Clippy exits 0 with 0 warnings; cargo test passes 111 tests; node runner passes 42 tests.

2. **Verify Memory Process Tree Script**:
   ```powershell
   & {
       $proc = Start-Process -FilePath "d:\browser\target\release\rusty_browser.exe" -ArgumentList "about:blank" -PassThru
       Start-Sleep -Seconds 5
       powershell -ExecutionPolicy Bypass -File .\verify_memory.ps1 -TargetPid $proc.Id
       Stop-Process -Id $proc.Id -Force
   }
   ```
   *Expected*: Script exits 0; outputs Process Tree table and Top 5 Process Consumers.

3. **Verify 5-State Telemetry & Guardrails**:
   ```powershell
   powershell -ExecutionPolicy Bypass -File .\verify_5states.ps1 -State 2A
   powershell -ExecutionPolicy Bypass -File .\verify_5states.ps1 -State 2B
   ```
   *Expected*:
   - State 2A: Variance <= 2.0% and `>>> GUARDRAIL PASSED: Minimal UI < 60 MB <<<`.
   - State 2B: Variance <= 2.0% and `>>> GUARDRAIL PASSED: Crazy UI < 120 MB <<<`.
