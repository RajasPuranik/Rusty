## 2026-11-09T20:17:48Z
You are Worker R0-2 for Milestone R0 (Iteration 2 Remediation).
Your working directory: d:\browser\.agents\teamwork\worker_r0_2\

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

## Mandatory Context Files (Read First!)
- ORIGINAL_REQUEST.md: d:\browser\ORIGINAL_REQUEST.md (MANDATORY: read this first before starting work)
- PROJECT.md: d:\browser\PROJECT.md
- Full Forensic Auditor Evidence Report: d:\browser\.agents\teamwork\auditor_r0\handoff.md
- Explorer 1 (PowerShell Remediation) Handoff & Analysis:
  - d:\browser\.agents\teamwork\explorer_r0_iter2_1\handoff.md
  - d:\browser\.agents\teamwork\explorer_r0_iter2_1\analysis.md
  - d:\browser\.agents\teamwork\explorer_r0_iter2_1\scripts_remediation.patch
- Explorer 2 (Telemetry Hardening) Handoff & Analysis:
  - d:\browser\.agents\teamwork\explorer_r0_iter2_2\handoff.md
  - d:\browser\.agents\teamwork\explorer_r0_iter2_2\analysis.md

## Exclusive File Ownership
You exclusively own and may edit:
1. `d:\browser\verify_memory.ps1`
2. `d:\browser\verify_5states.ps1`
3. `d:\browser\src\telemetry.rs`
4. `d:\browser\tests\stress_telemetry.rs`
Do NOT edit other source files without justification.

## Implementation Tasks

### 1. Fix `verify_memory.ps1` (Explorer 1 Plan)
- Rename parameter `[int]$Pid = 0` to `[int]$TargetProcessId = 0` in `function Classify-RustyProcess` at line 29.
- Update line 34 to reference `$TargetProcessId`: `if ($EarliestRendererPid -ne 0 -and $TargetProcessId -eq $EarliestRendererPid)`.
- Wrap the pipeline in `@(...)` at line 181: `$rendererPids = @($rendererPids | Sort-Object CreationDate)`.
- Wrap the pipeline in `@(...)` at line 218: `$rows = @($rows | Sort-Object -Property PrivateWS_MB -Descending)`.

### 2. Fix `verify_5states.ps1` (Explorer 1 Plan)
- Line 170: Update property check to inspect `.kind` first, then fallback to `.role`:
  `} elseif ($dumpProcs.ContainsKey($pidNum) -and ($dumpProcs[$pidNum].kind -or $dumpProcs[$pidNum].role)) { if ($dumpProcs[$pidNum].kind) { $dumpProcs[$pidNum].kind } else { $dumpProcs[$pidNum].role } }`
- Line 145: Wrap the pipeline in `@(...)`: `$rendererPids = @($rendererPids | Sort-Object CreationDate)`.
- Line 208: Wrap the pipeline in `@(...)`: `$processRows = @($processRows | Sort-Object -Property PrivateWS_MB -Descending)`.
- In `Measure-BrowserTree`: snapshot `Win32_PerfFormattedData_PerfProc_Process` at function entry immediately after the telemetry pulse to eliminate CIM query latency skew.
- Line 311: Update State 2B stabilization wait time from 12s to 15s (`-WaitSecs ($StabilizationSeconds + 3)`).

### 3. Harden `src/telemetry.rs` & `tests/stress_telemetry.rs` (Explorer 2 Plan)
- In `SmapsRollupStats::private_ws_kb(&self) -> u64` and `commit_mb(&self) -> f64`, replace raw `+` with `.saturating_add(...)`. Add `pub fn commit_kb(&self) -> u64`.
- Introduce platform-agnostic helper `select_earliest_renderer_pid(candidates: &[(u64, u32)]) -> Option<u32>` that sorts candidates by earliest creation timestamp (non-zero first), breaking ties deterministically by lowest PID.
- Add `pub creation_time: u64` to `CandSnap` struct on Windows.
- Update Windows line 949 and Linux line 417 to sort candidates using `select_earliest_renderer_pid`.
- On Windows line 117, unify role fallback to return `"Content Renderer"` when `UI_WEBVIEW_RENDERER_PID == 0`, matching Linux line 149 and preventing multi-tab misclassification.
- In `tests/stress_telemetry.rs:28`, invert the test assertion from expecting panic to asserting no panic and `u64::MAX` saturation:
  `assert!(!did_panic_private_ws, "saturating_add must prevent panic on u64::MAX + 1");`
  `assert_eq!(stats.private_ws_kb(), u64::MAX);`

### 4. Build, Test, and Verify Execution
Run and verify all of the following commands:
1. `cargo check`
2. `cargo clippy --all-targets -- -D warnings` (must pass with 0 warnings)
3. `cargo test` (all unit and integration tests must pass)
4. `node tests/e2e/runner.js` (all 42 E2E tests must pass)
5. Live `verify_memory.ps1` verification:
   Launch `rusty_browser.exe about:blank`, run `powershell -ExecutionPolicy Bypass -File .\verify_memory.ps1 -TargetPid <PID>`, and stop the browser. Confirm return code 0, no `VariableNotWritable` error, and table printed with UI WebView and Top 5 Process Consumers.
6. Live `verify_5states.ps1` verification:
   Run `powershell -ExecutionPolicy Bypass -File .\verify_5states.ps1 -State all`.
   Verify:
   - All 5 states report `>>> RECONCILIATION PASSED: Variance <= 2.0% <<<`.
   - State 2A reports `Minimal UI WebView Private WS: ... MB (Guardrail: < 60 MB)` AND `>>> GUARDRAIL PASSED: Minimal UI < 60 MB <<<`.
   - State 2B reports `Crazy UI WebView Private WS: ... MB (Guardrail: < 120 MB)` AND `>>> GUARDRAIL PASSED: Crazy UI < 120 MB <<<`.
   - Final 5-State Measurement Summary exits with code 0.

## Deliverables
- Write full implementation log to `d:\browser\.agents\teamwork\worker_r0_2\implementation.md`.
- Write complete handoff report with exact command execution transcripts to `d:\browser\.agents\teamwork\worker_r0_2\handoff.md`.
- Send message to parent orchestrator when complete.
