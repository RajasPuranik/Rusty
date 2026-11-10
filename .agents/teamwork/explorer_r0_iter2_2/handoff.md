# Milestone R0 Iteration 2 Explorer 2 Handoff Report: Telemetry Hardening & Robustness

**Agent**: Explorer 2 (`explorer_r0_iter2_2`)  
**Role**: Telemetry Hardening & Robustness Explorer  
**Working Directory**: `d:\browser\.agents\teamwork\explorer_r0_iter2_2\`  
**Milestone**: Milestone R0 (Baseline Measurement & Platform Layer Abstraction — Iteration 2 Remediation)  
**Handoff Type**: Hard (Investigation complete, actionable remediation plan provided)  
**Target File**: `src/telemetry.rs` (with test updates in `tests/stress_telemetry.rs`)  

---

## 1. Observation

1. **Integer Overflow in Linux Smaps Rollup Arithmetic (`src/telemetry.rs:258, 279`)**:
   - In `src/telemetry.rs` lines 257–260 and 278–280:
     ```rust
     pub fn private_ws_kb(&self) -> u64 {
         self.private_clean_kb + self.private_dirty_kb
     }
     ...
     pub fn commit_mb(&self) -> f64 {
         round1(((self.private_dirty_kb + self.swap_kb) as f64) / 1024.0)
     }
     ```
   - In `tests/stress_telemetry.rs` lines 12–29, Challenger R0-1 constructed an adversarial smaps input with `Private_Clean: 18446744073709551615 kB` (`u64::MAX`) and `Private_Dirty: 1 kB`:
     ```rust
     let res1 = std::panic::catch_unwind(|| {
         let _ = stats.private_ws_kb();
     });
     let did_panic_private_ws = res1.is_err();
     ...
     assert!(did_panic_private_ws, "Raw u64 addition without saturating_add must panic on u64::MAX + 1 in debug mode");
     ```
     Execution confirmed that `stats.private_ws_kb()` panics with `attempt to add with overflow` in debug mode. In release mode, the calculation wraps to 0.

2. **Non-Monotonic Fallback Process Sorting (`src/telemetry.rs:417, 949`)**:
   - In Linux fallback (`src/telemetry.rs:412–421`):
     ```rust
     // Auto-register UI WebView renderer if not set
     if UI_WEBVIEW_RENDERER_PID.load(Ordering::Relaxed) == 0 {
         let mut web_procs: Vec<&ProcStatInfo> = procs_info
             .iter()
             .filter(|p| owned_pids.contains(&p.pid) && p.comm.contains("WebKitWebProcess"))
             .collect();
         web_procs.sort_by_key(|p| p.pid);
         if let Some(first) = web_procs.first() {
             UI_WEBVIEW_RENDERER_PID.store(first.pid, Ordering::Relaxed);
         }
     }
     ```
   - In Windows fallback (`src/telemetry.rs:944–953`):
     ```rust
     // Auto-register UI WebView renderer if not explicitly registered:
     // The earliest created renderer among owned processes is the UI WebView
     if UI_WEBVIEW_RENDERER_PID.load(Ordering::Relaxed) == 0 {
         let mut renderers: Vec<&CandSnap> = cands
             .iter()
             .filter(|c| owned_pids.contains(&c.pid) && c.cmd_line.to_lowercase().contains("--type=renderer"))
             .collect();
         renderers.sort_by_key(|c| c.pid);
         if let Some(first_renderer) = renderers.first() {
             UI_WEBVIEW_RENDERER_PID.store(first_renderer.pid, Ordering::Relaxed);
         }
     }
     ```
   - Both comments claim: *"The earliest created renderer among owned processes is the UI WebView"*. However, both routines call `.sort_by_key(|p| p.pid)` or `.sort_by_key(|c| c.pid)`.
   - On Windows, process IDs are recycled aggressively by the NT kernel table manager; on Linux, PIDs wrap at `pid_max`. Sorting by PID rather than creation time can falsely assign the UI WebView role to a younger tab renderer.
   - On Windows, `creation_time` is already queried via `read_process_creation_time(handle)` at line 881, but was omitted from `CandSnap` (line 851).
   - On Linux, `ProcStatInfo` already holds field 22 `pub starttime: u64` from `/proc/<pid>/stat` (line 321).

3. **Platform Asymmetry in Role Fallback (`src/telemetry.rs:117 vs 149`)**:
   - In `classify_process_with_pid` on Windows (`src/telemetry.rs:110–118`):
     ```rust
     if cmd_lower.contains("--type=renderer") {
         let ui_pid = UI_WEBVIEW_RENDERER_PID.load(Ordering::Relaxed);
         if ui_pid != 0 && pid == ui_pid {
             return "UI WebView".to_owned();
         } else if ui_pid != 0 {
             return "Content Renderer".to_owned();
         } else {
             return "UI WebView".to_owned(); // <-- Line 117
         }
     }
     ```
   - In `classify_process_with_pid` on Linux (`src/telemetry.rs:144–150`):
     ```rust
     if exe_name.contains("WebKitWebProcess") || cmd_lower.contains("webkitwebprocess") {
         let ui_pid = UI_WEBVIEW_RENDERER_PID.load(Ordering::Relaxed);
         if ui_pid != 0 && pid == ui_pid {
             return "UI WebView".to_owned();
         } else {
             return "Content Renderer".to_owned(); // <-- Line 149
         }
     }
     ```
   - When `UI_WEBVIEW_RENDERER_PID == 0`, Windows classifies ALL renderer processes as `"UI WebView"`, whereas Linux classifies them as `"Content Renderer"`.
   - In `test_classify_process_and_data_dir_match` (`src/telemetry.rs:1452–1456`), Windows explicitly tested:
     ```rust
     UI_WEBVIEW_RENDERER_PID.store(0, Ordering::SeqCst);
     assert_eq!(classify_process("msedgewebview2.exe", "...--type=renderer", false), "UI WebView");
     ```
   - In `verify_memory.ps1` lines 34–37 and `verify_5states.ps1` lines 173–177, the PowerShell verification scripts default unmapped renderers to `"Content Renderer"`.

4. **Baseline Command Verification**:
   - `cargo check`: Finished in 0.11s with exit code 0.
   - `cargo test`: Finished in 0.28s, 57 passed, 0 failed.
   - `node tests/e2e/runner.js`: Finished in 2.94s, 4 suites passed, 42 tests passed, 0 failed.

---

## 2. Logic Chain

1. **Integer Overflow Hardening**:
   - Observation 1 demonstrates that adding `private_clean_kb + private_dirty_kb` or `private_dirty_kb + swap_kb` with raw `+` causes a runtime panic when parsed values sum to $\ge 2^{64}$.
   - Telemetry must remain non-crashing under adversarial or corrupt operating system inputs.
   - Applying `.saturating_add(...)` guarantees that values saturate at `u64::MAX` without panicking or wrapping to zero.
   - Introducing `commit_kb(&self) -> u64` provides symmetric saturating commit calculation.
   - Because `tests/stress_telemetry.rs:28` currently asserts that the unhardened code panics (`assert!(did_panic_private_ws)`), this test must be updated to assert that panic is prevented and saturated arithmetic is returned.

2. **Creation-Time Renderer Sorting**:
   - Observation 2 demonstrates that PIDs are recycled on Windows and wrapped on Linux, meaning lower PID $\ne$ earlier creation time.
   - The design requires the earliest created renderer to be designated as the UI WebView shell.
   - Windows already queries `creation_time: u64` from `GetProcessTimes` at line 881. Adding `creation_time: u64` to `CandSnap` makes this metric available during candidate sorting.
   - Linux already parses `starttime: u64` from `/proc/<pid>/stat` at line 352.
   - Designing a platform-agnostic helper `select_earliest_renderer_pid(candidates: &[(u64, u32)]) -> Option<u32>` that sorts by `(if time > 0 { time } else { u64::MAX }, pid)` ensures:
     a) Valid timestamps sort in ascending chronological order (earliest first).
     b) Unrecorded or failed timestamps (`0`) are pushed to the end.
     c) Timestamp ties break deterministically by lowest PID.
     d) The logic is pure, platform-independent, and 100% unit-testable on all targets.

3. **Platform Role Fallback Symmetry**:
   - Observation 3 shows that Windows line 117 defaults to `"UI WebView"` when `UI_WEBVIEW_RENDERER_PID == 0`, whereas Linux line 149 defaults to `"Content Renderer"`.
   - In a multi-tab browser, there is only ONE UI WebView shell. If `UI_WEBVIEW_RENDERER_PID == 0`, classifying multiple renderers as `"UI WebView"` is a critical domain violation: all tab renderers are falsely labeled as the UI shell, multiplying reported UI memory and breaching the Minimal UI (< 60 MB) and Crazy UI (< 120 MB) guardrails.
   - Defaulting to `"Content Renderer"` when `ui_pid == 0` is safe, bounded, matches Linux, matches `verify_memory.ps1` and `verify_5states.ps1`, and matches `tests/e2e/telemetry_win.test.js`.
   - Furthermore, in both Windows and Linux `sample_process_tree`, fallback auto-registration via `select_earliest_renderer_pid` executes *before* process classification. Therefore, whenever an owned renderer exists, `UI_WEBVIEW_RENDERER_PID` is always set to the earliest renderer PID, and that renderer is properly classified as `"UI WebView"`. The fallback is only reached for foreign/untracked processes or before any renderer spawns.
   - Updating `test_classify_process_and_data_dir_match` to expect `"Content Renderer"` when `UI_WEBVIEW_RENDERER_PID == 0` cements cross-platform symmetry.

---

## 3. Caveats

1. **Non-Implementation Mandate**: Explorer 2 is strictly read-only. No edits have been made to `src/telemetry.rs` or `tests/stress_telemetry.rs`. All proposed changes are documented as machine-applicable diffs and test snippets for Worker R0.
2. **Stress Test Inversion Dependency**: When Worker R0 applies `.saturating_add(...)`, `cargo test` will fail on `tests/stress_telemetry.rs:28` unless that test assertion is simultaneously updated from `assert!(did_panic_private_ws)` to `assert!(!did_panic_private_ws)`.
3. **PowerShell 5.1 Verification Scripts**: The PowerShell fixes (`verify_memory.ps1` `$Pid` parameter rename and `verify_5states.ps1` `.kind` property mapping) are separate deliverables tracked by Auditor R0 and Reviewer R0-2.

---

## 4. Conclusion & Actionable Remediation Plan

Worker R0 must apply the following hardened changes:

### 4.1 Proposed Machine-Applicable Diff for `src/telemetry.rs`

```diff
--- a/src/telemetry.rs
+++ b/src/telemetry.rs
@@ -112,9 +112,7 @@ pub fn classify_process_with_pid(pid: u32, exe_name: &str, cmd_line: &str, is_h
             let ui_pid = UI_WEBVIEW_RENDERER_PID.load(Ordering::Relaxed);
             if ui_pid != 0 && pid == ui_pid {
                 return "UI WebView".to_owned();
-            } else if ui_pid != 0 {
-                return "Content Renderer".to_owned();
             } else {
-                return "UI WebView".to_owned();
+                return "Content Renderer".to_owned();
             }
         }
@@ -235,6 +233,16 @@ pub(crate) fn build_process_tree_pids(nodes: &[ProcNode], seeds: &[u32]) -> std
     tree
 }
 
+/// Helper to identify the earliest renderer PID given candidate tuples of (creation_timestamp, pid).
+/// Candidates with timestamp > 0 are prioritized by earliest timestamp;
+/// unrecorded timestamps (0) are pushed to the end as u64::MAX. Ties are broken by lowest PID.
+pub(crate) fn select_earliest_renderer_pid(candidates: &[(u64, u32)]) -> Option<u32> {
+    candidates
+        .iter()
+        .min_by_key(|&&(time, pid)| (if time > 0 { time } else { u64::MAX }, pid))
+        .map(|&(_, pid)| pid)
+}
+
 #[inline]
 fn bytes_to_mb(bytes: usize) -> f64 {
     round1((bytes as f64) / (1024.0 * 1024.0))
@@ -256,7 +264,7 @@ pub struct SmapsRollupStats {
 impl SmapsRollupStats {
     #[inline]
     pub fn private_ws_kb(&self) -> u64 {
-        self.private_clean_kb + self.private_dirty_kb
+        self.private_clean_kb.saturating_add(self.private_dirty_kb)
     }
 
     #[inline]
@@ -276,7 +284,12 @@ impl SmapsRollupStats {
     }
 
     #[inline]
+    pub fn commit_kb(&self) -> u64 {
+        self.private_dirty_kb.saturating_add(self.swap_kb)
+    }
+
+    #[inline]
     pub fn commit_mb(&self) -> f64 {
-        round1(((self.private_dirty_kb + self.swap_kb) as f64) / 1024.0)
+        round1((self.commit_kb() as f64) / 1024.0)
     }
 }
@@ -410,13 +423,13 @@ mod linux_mem {
         }
 
-        // Auto-register UI WebView renderer if not set
+        // Auto-register UI WebView renderer if not set:
+        // The earliest created renderer among owned processes is the UI WebView
         if UI_WEBVIEW_RENDERER_PID.load(Ordering::Relaxed) == 0 {
-            let mut web_procs: Vec<&ProcStatInfo> = procs_info
+            let web_procs: Vec<(u64, u32)> = procs_info
                 .iter()
                 .filter(|p| owned_pids.contains(&p.pid) && p.comm.contains("WebKitWebProcess"))
+                .map(|p| (p.starttime, p.pid))
                 .collect();
-            web_procs.sort_by_key(|p| p.pid);
-            if let Some(first) = web_procs.first() {
-                UI_WEBVIEW_RENDERER_PID.store(first.pid, Ordering::Relaxed);
+            if let Some(first_pid) = select_earliest_renderer_pid(&web_procs) {
+                UI_WEBVIEW_RENDERER_PID.store(first_pid, Ordering::Relaxed);
             }
         }
@@ -851,6 +864,7 @@ mod win32_mem {
             struct CandSnap {
                 pid: u32,
                 parent_pid: u32,
+                creation_time: u64,
                 exe: String,
                 is_wv2: bool,
                 cmd_line: String,
@@ -899,6 +913,7 @@ mod win32_mem {
                 cands.push(CandSnap {
                     pid: p.pid,
                     parent_pid: p.parent_pid,
+                    creation_time,
                     exe: p.exe.clone(),
                     is_wv2,
                     cmd_line,
@@ -944,11 +959,12 @@ mod win32_mem {
             if UI_WEBVIEW_RENDERER_PID.load(Ordering::Relaxed) == 0 {
-                let mut renderers: Vec<&CandSnap> = cands
+                let renderers: Vec<(u64, u32)> = cands
                     .iter()
                     .filter(|c| owned_pids.contains(&c.pid) && c.cmd_line.to_lowercase().contains("--type=renderer"))
+                    .map(|c| (c.creation_time, c.pid))
                     .collect();
-                renderers.sort_by_key(|c| c.pid);
-                if let Some(first_renderer) = renderers.first() {
-                    UI_WEBVIEW_RENDERER_PID.store(first_renderer.pid, Ordering::Relaxed);
+                if let Some(first_pid) = select_earliest_renderer_pid(&renderers) {
+                    UI_WEBVIEW_RENDERER_PID.store(first_pid, Ordering::Relaxed);
                 }
             }
@@ -957,9 +973,9 @@ mod win32_mem {
                 if owned_pids.contains(&c.pid) {
                     if let Some((priv_ws, ws, commit)) = c.mem {
                         let is_self = c.pid == my_pid;
-                        total_priv_ws += priv_ws;
-                        total_ws += ws;
-                        total_commit += commit;
+                        total_priv_ws = total_priv_ws.saturating_add(priv_ws);
+                        total_ws = total_ws.saturating_add(ws);
+                        total_commit = total_commit.saturating_add(commit);
                         if is_self {
                             host_priv_ws = priv_ws;
                         }
@@ -976,7 +992,7 @@ mod win32_mem {
                 } else if chrome_pids.contains(&c.pid) {
                     if let Some((priv_ws, _, _)) = c.mem {
-                        chrome_priv_ws += priv_ws;
+                        chrome_priv_ws = chrome_priv_ws.saturating_add(priv_ws);
                         chrome_count += 1;
                     }
                 }
@@ -1450,11 +1466,15 @@ mod tests {
         assert_eq!(
             classify_process("rusty_browser.exe", "", false),
             "Host (Rusty)"
         );
-        // Without registered UI PID, default renderer role is UI WebView
+        // Without registered UI PID, default renderer role is Content Renderer (symmetric across platforms)
         UI_WEBVIEW_RENDERER_PID.store(0, Ordering::SeqCst);
         assert_eq!(
             classify_process("msedgewebview2.exe", "msedgewebview2.exe --type=renderer", false),
-            "UI WebView"
+            "Content Renderer"
+        );
+        assert_eq!(
+            classify_process("WebKitWebProcess", "WebKitWebProcess", false),
+            "Content Renderer"
         );
 
         // With registered UI PID:
```

### 4.2 Proposed Diff for `tests/stress_telemetry.rs`

```diff
--- a/tests/stress_telemetry.rs
+++ b/tests/stress_telemetry.rs
@@ -20,10 +20,12 @@ fn test_stress_smaps_rollup_addition_overflow_edge_cases() {
     let res1 = std::panic::catch_unwind(|| {
         let _ = stats.private_ws_kb();
     });
     let did_panic_private_ws = res1.is_err();
     let res2 = std::panic::catch_unwind(|| {
         let _ = stats.commit_mb();
     });
     let did_panic_commit = res2.is_err();
-    assert!(did_panic_private_ws, "Raw u64 addition without saturating_add must panic on u64::MAX + 1 in debug mode");
+    assert!(!did_panic_private_ws, "saturating_add must prevent panic on private_ws u64::MAX + 1 in debug mode");
+    assert!(!did_panic_commit, "saturating_add must prevent panic on commit u64::MAX + 1 in debug mode");
+    assert_eq!(stats.private_ws_kb(), u64::MAX);
+    assert_eq!(stats.commit_kb(), u64::MAX);
 }
```

### 4.3 Proposed Unit Tests for `src/telemetry.rs`
Append to `mod tests` in `src/telemetry.rs`:
1. `test_smaps_rollup_saturating_add_prevents_overflow_panic`: Tests `u64::MAX + 100` in `private_ws_kb()` and `commit_kb()`.
2. `test_select_earliest_renderer_pid_ordering_and_ties`: Tests timestamp sorting over inverted PIDs, ties, zero fallback, and empty slices.
3. `test_platform_symmetry_in_role_fallback`: Tests symmetric classification when `UI_WEBVIEW_RENDERER_PID == 0` and when registered.

---

## 5. Verification Method

To independently verify the implementation:

1. **Compilation & Strict Linting**:
   ```powershell
   cargo clippy --all-targets -- -D warnings
   ```
   *Expected*: Zero warnings and zero errors.

2. **Unit & Stress Tests**:
   ```powershell
   cargo test -- --nocapture
   ```
   *Expected*: All 60+ tests pass, including:
   - `telemetry::tests::test_smaps_rollup_saturating_add_prevents_overflow_panic`
   - `telemetry::tests::test_select_earliest_renderer_pid_ordering_and_ties`
   - `telemetry::tests::test_platform_symmetry_in_role_fallback`
   - `test_stress_smaps_rollup_addition_overflow_edge_cases` (no panic on `u64::MAX + 1`)

3. **Node.js Contract & Invariants Suite**:
   ```powershell
   node tests/e2e/runner.js
   ```
   *Expected*: All 4 suites pass (42 tests total).

4. **5-State Process-Tree Telemetry Suite**:
   ```powershell
   powershell -ExecutionPolicy Bypass -File .\verify_5states.ps1 -State 1
   powershell -ExecutionPolicy Bypass -File .\verify_5states.ps1 -State 2A
   powershell -ExecutionPolicy Bypass -File .\verify_5states.ps1 -State 2B
   ```
   *Expected*: Reconciles within $\le 2.0\%$ variance and passes UI WebView RAM guardrails (< 60 MB Minimal, < 120 MB Crazy).

**Invalidation Conditions**:
- Any `attempt to add with overflow` panic in debug mode during smaps parsing.
- A newly created tab renderer with a recycled lower PID misclassified as `"UI WebView"`.
- Asymmetric fallback behavior where Windows and Linux assign different roles to an unmapped renderer.
