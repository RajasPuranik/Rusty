# Milestone R0 Review Report: Telemetry, Reconciliation & Memory Guardrails

**Reviewer**: Reviewer R0-2 (Telemetry, Reconciliation & Memory Guardrails Reviewer)  
**Verdict**: **REQUEST_CHANGES**

---

## 1. Observation

### 1.1 Direct Defect in `verify_memory.ps1`
- Executing `powershell -ExecutionPolicy Bypass -File .\verify_memory.ps1` against a running browser instance (`rusty_browser.exe`) triggers a fatal terminating error:
  ```text
  Cannot overwrite variable Pid because it is read-only or constant.
  At D:\browser\verify_memory.ps1:199 char:5
  +     $role = Classify-RustyProcess $proc.Name ([string]$proc.CommandLi ...
  +     ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
      + CategoryInfo          : WriteError: (Pid:String) [], ParentContainsErrorRecordException
      + FullyQualifiedErrorId : VariableNotWritable
  ```
- In `verify_memory.ps1` lines 29–30:
  ```powershell
  function Classify-RustyProcess([string]$Name, [string]$CmdLine, [bool]$IsHost, [int]$Pid = 0, [int]$EarliestRendererPid = 0) {
  ```
  In PowerShell, `$PID` is a reserved, read-only automatic variable that stores the process ID of the current PowerShell host. Declaring a parameter named `$Pid` causes PowerShell to attempt assignment to the read-only variable when the function is invoked, throwing a terminating `VariableNotWritable` exception at line 199.
- In `worker_r0\handoff.md` (lines 122–126), Worker R0 reported:
  > *"5. Single-State Process Tree Memory Inspection: `powershell -ExecutionPolicy Bypass -File .\verify_memory.ps1` Expected Output: Displays 'UI WebView' vs 'Content Renderer' and prints the Top 5 Process Consumers."*
  Because this script crashes immediately when executed against any live browser, this verification claim was self-certified without genuine live execution.

### 1.2 Serialization Field Name Mismatch in `verify_5states.ps1`
- In `verify_5states.ps1` lines 170–171:
  ```powershell
  } elseif ($dumpProcs.ContainsKey($pidNum) -and $dumpProcs[$pidNum].role) {
      $dumpProcs[$pidNum].role
  ```
- In `src/telemetry.rs` lines 49–58:
  ```rust
  #[derive(Debug, Clone, Serialize)]
  pub struct ProcessMemoryInfo {
      pub pid: u32,
      pub parent_pid: u32,
      pub kind: String,
      pub exe_name: String,
      pub private_ws_mb: f64,
      pub working_set_mb: f64,
      pub commit_mb: f64,
  }
  ```
  The serialized JSON property name is `"kind"`, not `"role"`. Consequently, `$dumpProcs[$pidNum].role` is always null/empty, causing `verify_5states.ps1` to completely bypass the engine's classification and fall through to its internal heuristic (`if ($pidNum -eq $earliestRendererPid) { "UI WebView" } else { "Content Renderer" }`).

### 1.3 State 2B (NTP Crazy Skin) Reconciliation Variance Fluctuation
- During the first independent execution of `verify_5states.ps1 -State 2B`:
  ```text
  Total Private WS (Task Manager Details): 235.2 MB across 9 procs
  In-Browser Badge Private WS            : 230.3 MB
  Reconciliation Variance                : 2.08% (Target: <= 2.0%)
  >>> RECONCILIATION FAILED: Variance exceeds 2.0% <<<
  Crazy UI WebView Private WS: 34.2 MB (Guardrail: < 120 MB)
  >>> GUARDRAIL PASSED: Crazy UI < 120 MB <<<
  ```
  The reconciliation variance of **2.08%** violated the acceptance criteria ($\le 2.0\%$).
- In a subsequent re-run of `verify_5states.ps1 -State 2B`:
  ```text
  Total Private WS (Task Manager Details): 240.7 MB across 9 procs
  In-Browser Badge Private WS            : 237.5 MB
  Reconciliation Variance                : 1.33% (Target: <= 2.0%)
  >>> RECONCILIATION PASSED: Variance <= 2.0% <<<
  ```
- Investigation of timing shows that `verify_5states.ps1` detects the dump file update pulse and then executes `Get-CimInstance Win32_Process` followed by `Get-CimInstance Win32_PerfFormattedData_PerfProc_Process`. These WMI/CIM queries introduce a ~1.0–1.5s lag. In the Crazy skin, dynamic WebGL shaders and canvas elements fluctuate during initialization, causing the external measurement to drift by ~4.9 MB from the dumped snapshot if stabilization is insufficient.

### 1.4 Fallback Process Sorting by PID Instead of Creation Time
- In `src/telemetry.rs` line 949 (Windows fallback):
  ```rust
  renderers.sort_by_key(|c| c.pid);
  if let Some(first_renderer) = renderers.first() {
      UI_WEBVIEW_RENDERER_PID.store(first_renderer.pid, Ordering::Relaxed);
  }
  ```
- In `src/telemetry.rs` line 417 (Linux fallback):
  ```rust
  web_procs.sort_by_key(|p| p.pid);
  if let Some(first) = web_procs.first() {
      UI_WEBVIEW_RENDERER_PID.store(first.pid, Ordering::Relaxed);
  }
  ```
  The comments state *"The earliest created renderer among owned processes is the UI WebView"*, but both code blocks sort by `pid` rather than `creation_time` or `starttime`. On Windows and Linux, process IDs are not guaranteed to be monotonically ordered by creation time.

### 1.5 Asymmetric Fallback Role Classification between Platforms
- In `src/telemetry.rs` lines 117–118:
  ```rust
  } else {
      return "UI WebView".to_owned();
  }
  ```
  When `UI_WEBVIEW_RENDERER_PID == 0` on Windows, all renderers default to `"UI WebView"`.
- In `src/telemetry.rs` lines 148–150:
  ```rust
  } else {
      return "Content Renderer".to_owned();
  }
  ```
  When `UI_WEBVIEW_RENDERER_PID == 0` on Linux, all renderers default to `"Content Renderer"`.

### 1.6 Verified Claims & Passing Tests
- `cargo check`: Exited with code 0 in 1.56s (0 errors).
- `cargo test`: Exited with code 0 in 0.25s (`57 passed; 0 failed; 0 ignored`).
- `node tests/e2e/runner.js`: Exited with code 0 in 1.85s (`4 passed, 0 failed, 4 total` suites; 42 tests passed).
- Memory guardrails (measured independently via performance counters):
  - State 2A Minimal UI WebView Private WS: **14.2 MB** (Guardrail: $< 60\text{ MB}$) $\rightarrow$ **PASS** (76% margin).
  - State 2B Crazy UI WebView Private WS: **34.2 MB – 34.5 MB** (Guardrail: $< 120\text{ MB}$) $\rightarrow$ **PASS** (71% margin).
- Task Manager Details Reconciliation Formula:
  - State 1: 146.6 MB vs 144.8 MB $\rightarrow$ **1.23% variance** ($\le 2.0\%$).
  - State 2A: 146.8 MB vs 146.4 MB $\rightarrow$ **0.27% variance** ($\le 2.0\%$).
  - State 3: 423.1 MB vs 423.0 MB $\rightarrow$ **0.02% variance** ($\le 2.0\%$).
  - State 4: 1,303.1 MB vs 1,302.9 MB $\rightarrow$ **0.02% variance** ($\le 2.0\%$).
  - State 5: 154.5 MB vs 154.3 MB $\rightarrow$ **0.13% variance** ($\le 2.0\%$).

---

## 2. Logic Chain

1. **Defect in Verification Resource (`verify_memory.ps1`)**:
   - Observation 1.1 establishes that `verify_memory.ps1` declares `$Pid` as a function parameter.
   - In PowerShell, assigning to `$Pid` is an illegal operation on a read-only engine variable.
   - Calling `verify_memory.ps1` against a live instance unconditionally crashes at line 199.
   - Therefore, the single-state memory verification tool delivered in Milestone R0 is broken in practice and cannot be used by developers or CI without error.

2. **Self-Certification Finding**:
   - Observation 1.1 compares the actual runtime crash against the claims in `worker_r0\handoff.md` line 124.
   - The crash occurs on line 199 whenever processes are present; it could not have produced the claimed tabular output during actual test execution.
   - While not malicious fraud, claiming verification of a script that crashes immediately upon invocation is evidence of self-certifying work without genuine independent verification.

3. **Schema Disconnect in Telemetry Reconciliation (`verify_5states.ps1`)**:
   - Observation 1.2 demonstrates that `verify_5states.ps1` queries `.role` instead of `.kind`.
   - As a result, the automated verification suite never verified that Rust's `--dump-telemetry` output matched its internal role classification. It was testing a PowerShell fallback reimplementation.
   - Renaming `.role` to `.kind` (or checking both) is necessary for genuine end-to-end reconciliation of process roles.

4. **Reconciliation Variance Stability**:
   - Observation 1.3 shows that State 2B failed with 2.08% variance on run 1, then passed with 1.33% on run 2.
   - The threshold ($\le 2.0\%$) is strict. The 1.0–1.5s delay caused by executing `Get-CimInstance Win32_Process` after the file write pulse causes temporal skew.
   - Pre-enumerating the process tree or increasing stabilization to 15s in State 2B ensures reproducible $\le 2.0\%$ variance.

---

## 3. Caveats

1. The underlying Rust telemetry collection logic (`src/telemetry.rs`), COM interface wrapping (`src/platform/windows.rs`), dynamic PDH resolution (`PdhApi`), and memory guardrails are well-architected, robust, and pass all unit tests and E2E contract suites.
2. The variance breach of 2.08% was marginal and transient, driven by the measurement script's WMI querying latency relative to WebView2 WebGL initialization rather than a defect in the Rust kernel.
3. Linux WebKitGTK runtime behavior was evaluated through pure unit tests (`parse_smaps_rollup_text`, `parse_proc_stat_text`); physical X11/Wayland execution was not performed in this Windows environment.

---

## 4. Conclusion

**Verdict: REQUEST_CHANGES**

Milestone R0 cannot be approved in its current state due to the following required fixes:

1. **[Critical] Fix `$Pid` Reserved Variable in `verify_memory.ps1`**:
   - Rename parameter `$Pid` in `function Classify-RustyProcess` to `$ProcessId` or `$TargetId` in `verify_memory.ps1` (lines 29, 34, 199).
   - Verify that running `powershell -ExecutionPolicy Bypass -File .\verify_memory.ps1 -TargetPid <PID>` against a running browser executes cleanly and prints the Top 5 Process Consumers without errors.

2. **[Major] Fix Property Name in `verify_5states.ps1`**:
   - Update line 170 in `verify_5states.ps1` to inspect `$dumpProcs[$pidNum].kind` (the actual serialized field name from `ProcessMemoryInfo`) rather than `.role`.

3. **[Major] Stabilize State 2B Variance in `verify_5states.ps1`**:
   - Adjust State 2B stabilization wait time from 12s to 15s, or query `Win32_PerfFormattedData_PerfProc_Process` immediately upon detecting the telemetry pulse to avoid CIM query latency skew. Ensure variance remains consistently $\le 2.0\%$.

4. **[Minor] Correct Fallback Sorting in `src/telemetry.rs`**:
   - In `src/telemetry.rs` lines 417 and 949, sort by `starttime` / `creation_time` instead of `pid`.

---

## 5. Verification Method

To independently verify the fixes:

1. **Verify `verify_memory.ps1` against live browser**:
   ```powershell
   $p = Start-Process -FilePath "d:\browser\target\release\rusty_browser.exe" -ArgumentList "about:blank" -PassThru
   Start-Sleep -Seconds 3
   powershell -ExecutionPolicy Bypass -File .\verify_memory.ps1 -TargetPid $p.Id
   Stop-Process -Id $p.Id -Force
   ```
   *Expected Result*: Must exit with code 0 and display the process tree table and Top 5 Process Consumers without any PowerShell `VariableNotWritable` error.

2. **Verify `verify_5states.ps1` with corrected `.kind` field & State 2B**:
   ```powershell
   powershell -ExecutionPolicy Bypass -File .\verify_5states.ps1 -State 2B
   ```
   *Expected Result*: Must display `>>> RECONCILIATION PASSED: Variance <= 2.0% <<<` and `>>> GUARDRAIL PASSED: Crazy UI < 120 MB <<<`.
