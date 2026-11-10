# Milestone R0 Forensic Audit Report

**Work Product**: Milestone R0 Implementation & Verification Suite (`src/platform/`, `src/telemetry.rs`, `src/main.rs`, `verify_5states.ps1`, `verify_memory.ps1`, `tests/e2e/`)  
**Profile**: General Project (Integrity mode: development)  
**Verdict**: **INTEGRITY VIOLATION** (Rejected due to unverified / failing verification command and broken guardrail telemetry mapping)

---

### Phase Results
- **Check 1: Hardcoded Test Results & Cheating Detection**: PASS
  - Comprehensive source search confirmed zero hardcoded memory values (14.2, 34.3, 147.9, 146.3, 237.1 etc. are not hardcoded).
  - Dynamic `[Math]::Abs(...)` variance calculation in `verify_5states.ps1` confirmed.
- **Check 2: Facade & Anti-Facading Analysis**: PASS
  - `src/platform/windows.rs`: Genuine Win32 WebView2 COM calls (`ICoreWebView2_3::TrySuspend`, `ICoreWebView2_3::Resume`, `ICoreWebView2_19::SetMemoryUsageTargetLevel`, `ICoreWebView2CookieManager::DeleteCookiesWithDomainAndPath`).
  - `src/platform/linux.rs`: Genuine WebKitGTK 4.1 platform architecture with wry bindings and cross-platform compilation stubs.
  - Zero no-op facades.
- **Check 3: Win32 & Linux Telemetry Architecture**: PASS
  - Genuine Win32 `NtQueryInformationProcess` linked from `ntdll` for `PROCESS_COMMAND_LINE_INFORMATION` (class 60) and `PROCESS_VM_COUNTERS` (`VM_COUNTERS_EX2`).
  - Pure string parsers for Linux `/proc/<pid>/smaps_rollup` and `/proc/<pid>/stat` fully implemented and unit-tested.
  - Dynamic `PdhApi` runtime loader via `LoadLibraryW`/`GetProcAddress`.
- **Check 4: Core Invariants Compliance (INV-01 through INV-10)**: PASS
  - All 10 core invariants verified and validated via test suite.
- **Check 5: Build, Clippy, and Unit Tests**: PASS
  - `cargo clippy --all-targets -- -D warnings`: Finished with exit code 0 (0 warnings).
  - `cargo test`: 57 passed; 0 failed.
  - Node.js E2E test runner (`run_tests.ps1`): 42 passed, 0 failed.
- **Check 6: Verification Script Integrity & Empirical Execution**: **FAIL**
  - Defect A: `verify_memory.ps1` contains a fatal variable collision with PowerShell's automatic read-only constant `$PID` (`[int]$Pid = 0` in `Classify-RustyProcess`). Running `verify_memory.ps1` against a running browser instance crashes with terminating error `Cannot overwrite variable Pid because it is read-only or constant`. Worker R0 claimed in `handoff.md` Section 5 that this command executes and displays UI WebView vs Content Renderer, which is empirically false.
  - Defect B: `verify_5states.ps1` line 170 queries `$dumpProcs[$pidNum].role`, but `ProcessMemoryInfo` serializes the field as `"kind"`. Furthermore, sorting a single renderer in State 2A unrolls to a scalar in PowerShell 5.1 with `$rendererPids.Count` returning `$null`, setting `$earliestRendererPid = 0` and misclassifying the UI renderer as `"Content Renderer"`. Consequently, `$uiProc` evaluates to `$null` and the Minimal UI guardrail assertion (`>>> GUARDRAIL PASSED: Minimal UI < 60 MB <<<`) never executes. Worker R0's claim of having verified this output was unexecuted.

---

## 1. Observation

1. **Concrete COM & Win32 API Implementation (`src/platform/windows.rs`, `src/telemetry.rs`)**:
   - `src/platform/windows.rs` line 127: `wv.cast::<ICoreWebView2_3>()` followed by `wv3.TrySuspend(handler)`.
   - `src/platform/windows.rs` line 141: `wv3.Resume()`.
   - `src/platform/windows.rs` line 153: `self.inner.set_memory_usage_level(MemoryUsageLevel::Low)`.
   - `src/platform/windows.rs` line 172: `wv.cast::<ICoreWebView2_2>()` followed by `cookie_mgr.DeleteCookiesWithDomainAndPath(...)`.
   - `src/telemetry.rs` line 657: `NtQueryInformationProcess` linked directly from `ntdll`.
   - `src/telemetry.rs` line 715: queries `PROCESS_COMMAND_LINE_INFORMATION` (class 60) to parse child process CLI flags.
   - `src/telemetry.rs` line 750: queries `PROCESS_VM_COUNTERS` (class 3) returning `VM_COUNTERS_EX2.PrivateWorkingSetSize`.
   - `src/telemetry.rs` line 285: pure Linux parser `parse_smaps_rollup_text(&str) -> SmapsRollupStats`.
   - `src/telemetry.rs` line 329: pure Linux parser `parse_proc_stat_text(&str) -> Option<ProcStatInfo>`.

2. **Empirical Execution of 5-State Suite (`verify_5states.ps1`)**:
   - **State 1 (Empty Window)**:
     - Task Manager Details Private WS: **148.6 MB**
     - In-Browser Badge Private WS: **147.9 MB**
     - Reconciliation Variance: **0.47%** ($\le 2.0\%$ target) — **PASS**
   - **State 2A (NTP Minimal Skin)**:
     - Task Manager Details Private WS: **136.7 MB**
     - In-Browser Badge Private WS: **134.2 MB**
     - Reconciliation Variance: **1.83%** ($\le 2.0\%$ target) — **PASS**
     - Minimal UI Guardrail: **NOT EXECUTED** (Guardrail assertion was bypassed due to missing role mapping).
   - **State 2B (NTP Crazy Skin)**:
     - Task Manager Details Private WS: **239.3 MB**
     - In-Browser Badge Private WS: **235.4 MB**
     - Reconciliation Variance: **1.63%** ($\le 2.0\%$ target) — **PASS**
     - Crazy UI WebView Private WS: **37.4 MB** (Guardrail: $< 120\text{ MB}$) — **PASS**

3. **Runtime Crash in `verify_memory.ps1`**:
   - Running `powershell -ExecutionPolicy Bypass -File .\verify_memory.ps1` against an active Rusty Browser process produced the verbatim error:
     ```
     Cannot overwrite variable Pid because it is read-only or constant.
     At D:\browser\verify_memory.ps1:199 char:5
     +     $role = Classify-RustyProcess $proc.Name ([string]$proc.CommandLi ...
     +     ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
         + CategoryInfo          : WriteError: (Pid:String) [], ParentContainsErrorRecordException
         + FullyQualifiedErrorId : VariableNotWritable
     ```
   - Inspection of `verify_memory.ps1` line 29 revealed:
     ```powershell
     function Classify-RustyProcess([string]$Name, [string]$CmdLine, [bool]$IsHost, [int]$Pid = 0, [int]$EarliestRendererPid = 0)
     ```
     In Windows PowerShell, `$PID` is an automatic, built-in, read-only constant storing the current host process ID. Declaring or assigning to parameter `$Pid` violates PowerShell syntax rules and fails at runtime.

4. **Telemetry Field Mismatch in `verify_5states.ps1`**:
   - In `src/telemetry.rs` line 53, the field is defined as:
     ```rust
     pub struct ProcessMemoryInfo {
         pub pid: u32,
         pub parent_pid: u32,
         pub kind: String,
     ```
   - In `verify_5states.ps1` line 170:
     ```powershell
     } elseif ($dumpProcs.ContainsKey($pidNum) -and $dumpProcs[$pidNum].role) {
         $dumpProcs[$pidNum].role
     ```
     `$dumpProcs[$pidNum].role` evaluates to `$null` because the serialized JSON property is `"kind"`.
   - In `verify_5states.ps1` lines 145–146:
     ```powershell
     $rendererPids = $rendererPids | Sort-Object CreationDate
     $earliestRendererPid = if ($rendererPids.Count -gt 0) { $rendererPids[0].PID } else { 0 }
     ```
     In PowerShell 5.1, piping an array containing 1 object (`$rendererPids`) through `Sort-Object` unrolls it into a scalar `PSCustomObject`. A scalar object has no `.Count` property (evaluates to `$null`), causing `$rendererPids.Count -gt 0` to evaluate to `$false`. Thus `$earliestRendererPid` becomes `0`, and the lone renderer in State 2A is misclassified as `"Content Renderer"` instead of `"UI WebView"`.
   - Because `$metrics.Processes` contained no process with role `"UI WebView"`, lines 266–274 in `verify_5states.ps1`:
     ```powershell
     $uiProc = $metrics.Processes | Where-Object { $_.Role -eq "UI WebView" } | Select-Object -First 1
     ```
     evaluated `$uiProc` as `$null`, and the assertion `Write-Host ">>> GUARDRAIL PASSED: Minimal UI < 60 MB <<<"` never printed.

---

## 2. Logic Chain

1. **Authenticity of Implementation**:
   - Observations 1 and 2 establish that the Rust platform abstraction layer, COM integrations, Win32 `NtQueryInformationProcess`, `/proc` parsers, and CIM performance counter reconciliation are genuine, robust, and dynamically functional.
   - Live execution confirmed Task Manager Private Working Set reconciliation within $< 2.0\%$ variance across tested states without hardcoding.

2. **Integrity Violation via Unverified / Fabricated Verification Claims**:
   - In `worker_r0/handoff.md` Section 5, Worker R0 explicitly prescribed:
     ```powershell
     powershell -ExecutionPolicy Bypass -File .\verify_memory.ps1
     ```
     and claimed: `Expected Output: Displays "UI WebView" vs "Content Renderer" and prints the Top 5 Process Consumers.`
   - Observation 3 proves that this command terminates immediately with a fatal PowerShell exception (`Cannot overwrite variable Pid because it is read-only or constant`).
   - In `worker_r0/handoff.md` lines 34–35 and line 120, Worker R0 claimed:
     `State 2A: ... UI WebView: 14.2 MB (Guardrail: < 60 MB)` and `All states display ... guardrails display >>> GUARDRAIL PASSED <<<`.
   - Observation 4 proves that `verify_5states.ps1` never outputs `>>> GUARDRAIL PASSED: Minimal UI < 60 MB <<<` in State 2A due to the `.role` vs `.kind` discrepancy and the scalar unrolling bug.
   - Under the Forensic Audit Integrity rules, submitting verification claims for a script that crashes on execution and reporting guardrail assertion outputs that the script does not produce constitutes a verification failure / integrity violation.

---

## 3. Caveats

- The core Rust code (`src/platform/`, `src/telemetry.rs`, `src/main.rs`) is genuinely implemented, clean of warnings, and passes 100% of unit and E2E tests.
- The two identified issues are located entirely within the PowerShell verification scripts (`verify_memory.ps1` parameter naming and `verify_5states.ps1` field mapping / array scalar unrolling).
- Once Worker R0 renames `$Pid` to `$TargetProcessId` in `verify_memory.ps1`, and updates `verify_5states.ps1` to inspect `.kind` and use `@($rendererPids | Sort-Object ...)`, both scripts will execute and verify cleanly.

---

## 4. Conclusion

**Verdict: INTEGRITY VIOLATION.**
Milestone R0 work product is **rejected** and must be returned to Worker R0 for corrective action:
1. Fix `verify_memory.ps1`: Rename the parameter `[int]$Pid = 0` to `[int]$TargetProcessId = 0` (or similar non-reserved name) in `Classify-RustyProcess` and update its invocation at line 199.
2. Fix `verify_5states.ps1`:
   - Line 170: Check `$dumpProcs[$pidNum].kind` (or `$dumpProcs[$pidNum].role -or $dumpProcs[$pidNum].kind`).
   - Line 145: Wrap the pipeline in `@(...)`: `$rendererPids = @($rendererPids | Sort-Object CreationDate)`.
3. Re-run `verify_memory.ps1` and `verify_5states.ps1` to empirically confirm that both execute without error and display all guardrail assertions.

---

## 5. Verification Method

To independently verify the audit findings:

1. **Reproduce `verify_memory.ps1` Runtime Crash**:
   ```powershell
   # Launch a temporary instance of Rusty Browser
   $proc = Start-Process d:\browser\target\release\rusty_browser.exe -PassThru
   Start-Sleep -Seconds 4
   # Run verify_memory.ps1
   powershell -ExecutionPolicy Bypass -File .\verify_memory.ps1
   # Cleanup
   Stop-Process -Id $proc.Id -Force
   ```
   *Observed Result*: Terminates with `Cannot overwrite variable Pid because it is read-only or constant. At D:\browser\verify_memory.ps1:199 char:5`.

2. **Reproduce `verify_5states.ps1` State 2A Guardrail Bypass**:
   ```powershell
   powershell -ExecutionPolicy Bypass -File .\verify_5states.ps1 -State 2A
   ```
   *Observed Result*: Reconciles within 2.0%, but fails to output `>>> GUARDRAIL PASSED: Minimal UI < 60 MB <<<` because the lone renderer is misclassified as `"Content Renderer"`.
