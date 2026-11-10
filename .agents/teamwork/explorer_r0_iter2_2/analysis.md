# Technical Analysis & Hardened Remediation Plan: Telemetry Subsystem (`src/telemetry.rs`)

**Author**: Explorer 2 (`explorer_r0_iter2_2`)  
**Role**: Telemetry Hardening & Robustness Explorer  
**Scope**: Rust Telemetry Subsystem (`src/telemetry.rs`)  
**Milestone**: Milestone R0 (Iteration 2 Remediation)  
**Date**: 2026-11-09  

---

## 1. Executive Summary

Milestone R0 Iteration 1 highlighted three technical risks in `src/telemetry.rs` identified by Reviewer R0-2, Challenger R0-1, and Auditor R0:
1. **Integer Overflow Panic in Smaps Rollup Arithmetic**: Unchecked `+` addition in `SmapsRollupStats::private_ws_kb()` and `SmapsRollupStats::commit_mb()` panics in debug mode when parsing corrupt, untrusted, or out-of-range `/proc/<pid>/smaps_rollup` metrics.
2. **Non-Monotonic Fallback Process Sorting**: Linux line 417 and Windows line 949 sort renderers by `pid` (`renderers.sort_by_key(|c| c.pid);`), falsely assuming PIDs are monotonically assigned by creation time. On both Windows (fast PID recycling) and Linux (PID wrapping/concurrency), this can misidentify a younger tab renderer as the UI WebView.
3. **Platform Asymmetry in Role Fallback**: Windows line 117 defaults to `"UI WebView"` when `UI_WEBVIEW_RENDERER_PID == 0`, whereas Linux line 149 defaults to `"Content Renderer"`. If `UI_WEBVIEW_RENDERER_PID` is uninitialized or reset, Windows labels every renderer as the UI WebView, corrupting role metrics and breaking memory guardrails.

This document details the exact technical root cause for each issue, provides complete architectural solutions, gives line-by-line before-and-after code diffs for `src/telemetry.rs` and `tests/stress_telemetry.rs`, and prescribes rigorous verification test cases.

---

## 2. Issue 1: Integer Overflow Guard in `src/telemetry.rs`

### 2.1 Code Location & Current Implementation
In `src/telemetry.rs` lines 256–281:
```rust
#[allow(dead_code)]
impl SmapsRollupStats {
    #[inline]
    pub fn private_ws_kb(&self) -> u64 {
        self.private_clean_kb + self.private_dirty_kb
    }

    #[inline]
    pub fn private_ws_mb(&self) -> f64 {
        round1((self.private_ws_kb() as f64) / 1024.0)
    }

    #[inline]
    pub fn pss_mb(&self) -> f64 {
        round1((self.pss_kb as f64) / 1024.0)
    }

    #[inline]
    pub fn working_set_mb(&self) -> f64 {
        round1((self.rss_kb as f64) / 1024.0)
    }

    #[inline]
    pub fn commit_mb(&self) -> f64 {
        round1(((self.private_dirty_kb + self.swap_kb) as f64) / 1024.0)
    }
}
```

### 2.2 Root Cause & Vulnerability Analysis
- `parse_smaps_rollup_text(&str)` reads `/proc/<pid>/smaps_rollup`. Each numeric line is parsed into `u64` via `parts.next().and_then(|v| v.parse().ok())`.
- If an input file contains extreme values (e.g. `Private_Clean: 18446744073709551615 kB` and `Private_Dirty: 1 kB`), both values fit individually within `u64` (`u64::MAX` and `1`).
- However, when `private_ws_kb()` computes `self.private_clean_kb + self.private_dirty_kb`, the arithmetic expression overflows:
  - In **Debug mode**: Rust compiler inserts overflow checks (`panic!("attempt to add with overflow")`). This crashes the telemetry worker thread or caller thread.
  - In **Release mode**: The addition wraps modulo $2^{64}$ (`u64::MAX + 1 == 0`), reporting `0.0 MB` for a process that actually holds massive memory allocations.
- Similarly, in `commit_mb()`, `self.private_dirty_kb + self.swap_kb` experiences identical integer overflow.
- Challenger R0-1 proved this crash empirically in `tests/stress_telemetry.rs`:
  ```rust
  let res1 = std::panic::catch_unwind(|| { let _ = stats.private_ws_kb(); });
  assert!(res1.is_err()); // Confirmed panic
  ```

### 2.3 Hardened Solution
Replace all unchecked additions with `.saturating_add(...)`.
1. In `private_ws_kb()`:
   ```rust
   #[inline]
   pub fn private_ws_kb(&self) -> u64 {
       self.private_clean_kb.saturating_add(self.private_dirty_kb)
   }
   ```
2. Provide a clean `commit_kb()` helper:
   ```rust
   #[inline]
   pub fn commit_kb(&self) -> u64 {
       self.private_dirty_kb.saturating_add(self.swap_kb)
   }

   #[inline]
   pub fn commit_mb(&self) -> f64 {
       round1((self.commit_kb() as f64) / 1024.0)
   }
   ```
3. In `win32_mem::sample_process_tree` (lines 959–961 and 978):
   Harden accumulator summation using `.saturating_add(...)` on `usize`:
   ```rust
   total_priv_ws = total_priv_ws.saturating_add(priv_ws);
   total_ws = total_ws.saturating_add(ws);
   total_commit = total_commit.saturating_add(commit);
   chrome_priv_ws = chrome_priv_ws.saturating_add(priv_ws);
   ```

### 2.4 Test Suite Impact & Update
In `tests/stress_telemetry.rs` lines 12–30, Challenger R0-1 wrote:
```rust
assert!(did_panic_private_ws, "Raw u64 addition without saturating_add must panic on u64::MAX + 1 in debug mode");
```
Once `saturating_add` is applied, `did_panic_private_ws` will be `false`. The test must be updated to assert that it **does NOT panic** and that the result saturates at `u64::MAX`:
```rust
assert!(!did_panic_private_ws, "saturating_add must prevent panic on u64::MAX + 1 in debug mode");
assert!(!did_panic_commit, "saturating_add must prevent panic on commit u64::MAX + 1 in debug mode");
assert_eq!(stats.private_ws_kb(), u64::MAX);
assert_eq!(stats.commit_kb(), u64::MAX);
```

---

## 3. Issue 2: Fallback Process Sorting in `src/telemetry.rs`

### 3.1 Code Locations & Current Implementation
**Linux fallback** (`src/telemetry.rs` lines 412–421):
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

**Windows fallback** (`src/telemetry.rs` lines 944–953):
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

### 3.2 Root Cause & Vulnerability Analysis
- The code comments explicitly state:
  > *"The earliest created renderer among owned processes is the UI WebView"*
- However, both routines sort by `pid`:
  `web_procs.sort_by_key(|p| p.pid);` / `renderers.sort_by_key(|c| c.pid);`.
- **Operating System PID Non-Monotonicity**:
  - **Windows**: The Windows kernel manages process IDs via a process handle table (`HANDLE_TABLE`). PIDs are multiples of 4 up to a system limit. When processes terminate, the OS kernel aggressively recycles freed PIDs. A content tab renderer created 10 minutes after browser launch can easily be assigned a recycled PID lower than the initial UI WebView PID (e.g. initial UI PID = 12044; new tab PID = 4212). Under PID sorting, the new tab would be falsely misclassified as the "UI WebView"!
  - **Linux**: PIDs are assigned sequentially up to `/proc/sys/kernel/pid_max` (default 32768 or 4194304). Once wrapped, earlier created processes have higher numerical PIDs than newly created ones.
- **Available Monotonic Time Metrics**:
  - **Windows**: `read_process_creation_time(handle)` already calls Win32 `GetProcessTimes`, returning `FILETIME` as a 64-bit integer (`u64`) representing 100-nanosecond intervals since January 1, 1601. This metric is already fetched at line 881 for `cand_nodes`, but was omitted from `CandSnap`!
  - **Linux**: `/proc/<pid>/stat` field 22 contains `starttime` (clock ticks since system boot). `ProcStatInfo` already parses this into `pub starttime: u64` (line 321).

### 3.3 Unified Platform-Agnostic Helper Architecture
To guarantee absolute behavioral symmetry and permit thorough cross-platform unit testing without OS mocking, we introduce a pure helper in `src/telemetry.rs`:

```rust
/// Helper to identify the earliest renderer PID given candidate tuples of (creation_timestamp, pid).
/// Candidates with timestamp > 0 are prioritized in ascending chronological order (earliest first).
/// Unrecorded or failed timestamps (0) are pushed to the end as u64::MAX.
/// Ties are broken deterministically by lowest PID.
pub(crate) fn select_earliest_renderer_pid(candidates: &[(u64, u32)]) -> Option<u32> {
    candidates
        .iter()
        .min_by_key(|&&(time, pid)| (if time > 0 { time } else { u64::MAX }, pid))
        .map(|&(_, pid)| pid)
}
```

### 3.4 Application in Linux and Windows

#### Linux Telemetry Loop
In `linux_mem::sample_process_tree` (`src/telemetry.rs` lines 412–421):
```rust
// Auto-register UI WebView renderer if not set:
// The earliest created renderer among owned processes is the UI WebView
if UI_WEBVIEW_RENDERER_PID.load(Ordering::Relaxed) == 0 {
    let web_procs: Vec<(u64, u32)> = procs_info
        .iter()
        .filter(|p| owned_pids.contains(&p.pid) && p.comm.contains("WebKitWebProcess"))
        .map(|p| (p.starttime, p.pid))
        .collect();
    if let Some(first_pid) = select_earliest_renderer_pid(&web_procs) {
        UI_WEBVIEW_RENDERER_PID.store(first_pid, Ordering::Relaxed);
    }
}
```

#### Windows Telemetry Loop
1. Add `creation_time: u64` to `CandSnap` (`src/telemetry.rs` line 851):
   ```rust
   struct CandSnap {
       pid: u32,
       parent_pid: u32,
       creation_time: u64,
       exe: String,
       is_wv2: bool,
       cmd_line: String,
       mem: Option<(usize, usize, usize)>,
   }
   ```
2. Populate `creation_time` when pushing to `cands` (line 900):
   ```rust
   cands.push(CandSnap {
       pid: p.pid,
       parent_pid: p.parent_pid,
       creation_time,
       exe: p.exe.clone(),
       is_wv2,
       cmd_line,
       mem,
   });
   ```
3. In fallback auto-registration (lines 944–953):
   ```rust
   // Auto-register UI WebView renderer if not explicitly registered:
   // The earliest created renderer among owned processes is the UI WebView
   if UI_WEBVIEW_RENDERER_PID.load(Ordering::Relaxed) == 0 {
       let renderers: Vec<(u64, u32)> = cands
           .iter()
           .filter(|c| owned_pids.contains(&c.pid) && c.cmd_line.to_lowercase().contains("--type=renderer"))
           .map(|c| (c.creation_time, c.pid))
           .collect();
       if let Some(first_pid) = select_earliest_renderer_pid(&renderers) {
           UI_WEBVIEW_RENDERER_PID.store(first_pid, Ordering::Relaxed);
       }
   }
   ```

---

## 4. Issue 3: Platform Symmetry in Role Fallback

### 4.1 Code Locations & Current Asymmetry
In `src/telemetry.rs`:
**Windows** (lines 110–119):
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

**Linux** (lines 144–151):
```rust
// Linux WebKitGTK processes
if exe_name.contains("WebKitWebProcess") || cmd_lower.contains("webkitwebprocess") {
    let ui_pid = UI_WEBVIEW_RENDERER_PID.load(Ordering::Relaxed);
    if ui_pid != 0 && pid == ui_pid {
        return "UI WebView".to_owned();
    } else {
        return "Content Renderer".to_owned(); // <-- Line 149
    }
}
```

### 4.2 Comparative Evaluation of Alternatives

| Dimension | Option 1: Unify to `"Content Renderer"` (Recommended) | Option 2: Unify to `"UI WebView"` |
|:---|:---|:---|
| **Semantics** | Generic web renderers are Content Renderers by default. Exactly one renderer is designated as the UI shell. | Assumes any unidentified renderer is the UI shell. |
| **Multi-Process Behavior** | If `UI_WEBVIEW_RENDERER_PID == 0`, multiple renderers are safely categorized as `"Content Renderer"`. | If `UI_WEBVIEW_RENDERER_PID == 0`, ALL 10 tab renderers become `"UI WebView"`. |
| **Guardrail Protection** | Prevents multiple renderers from inflating UI WebView RAM metrics (< 60 MB Minimal, < 120 MB Crazy). | Can easily cause UI WebView RAM guardrail failures due to renderer misclassification. |
| **Verification Tool Parity** | Matches `verify_memory.ps1` lines 34–37 and `verify_5states.ps1` lines 173–177. | Disagrees with PowerShell verification scripts. |
| **Auto-Registration Guarantee** | `select_earliest_renderer_pid` runs in `sample_process_tree` *before* classification, guaranteeing the UI renderer is registered whenever any renderer exists. | Redundant with auto-registration. |

### 4.3 Proposed Unification
Unify Windows with Linux: when `UI_WEBVIEW_RENDERER_PID == 0` (or `pid != ui_pid`), default to `"Content Renderer"`.

```rust
if exe_name.eq_ignore_ascii_case("msedgewebview2.exe") {
    if cmd_lower.contains("--type=renderer") {
        let ui_pid = UI_WEBVIEW_RENDERER_PID.load(Ordering::Relaxed);
        if ui_pid != 0 && pid == ui_pid {
            return "UI WebView".to_owned();
        } else {
            return "Content Renderer".to_owned();
        }
    }
```

### 4.4 Unit Test Alignment
In `test_classify_process_and_data_dir_match()` (`src/telemetry.rs` lines 1452–1457):
The existing test asserted:
```rust
// Without registered UI PID, default renderer role is UI WebView
UI_WEBVIEW_RENDERER_PID.store(0, Ordering::SeqCst);
assert_eq!(
    classify_process("msedgewebview2.exe", "msedgewebview2.exe --type=renderer", false),
    "UI WebView"
);
```
With unified symmetrical behavior, when `UI_WEBVIEW_RENDERER_PID == 0`, `classify_process` returns `"Content Renderer"` on both Windows and Linux.
Update test to verify symmetric default classification:
```rust
// Without registered UI PID, default renderer role is Content Renderer (symmetric across Windows & Linux)
UI_WEBVIEW_RENDERER_PID.store(0, Ordering::SeqCst);
assert_eq!(
    classify_process("msedgewebview2.exe", "msedgewebview2.exe --type=renderer", false),
    "Content Renderer"
);
assert_eq!(
    classify_process("WebKitWebProcess", "WebKitWebProcess", false),
    "Content Renderer"
);

// With registered UI PID:
register_ui_webview_renderer_pid(4242);
assert_eq!(get_ui_webview_renderer_pid(), 4242);
assert_eq!(
    classify_process_with_pid(4242, "msedgewebview2.exe", "msedgewebview2.exe --type=renderer", false),
    "UI WebView"
);
assert_eq!(
    classify_process_with_pid(4243, "msedgewebview2.exe", "msedgewebview2.exe --type=renderer", false),
    "Content Renderer"
);
```

---

## 5. Complete Implementation Plan & Unified Diffs

### 5.1 Diff for `src/telemetry.rs`

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

### 5.2 Unit Tests to Add to `src/telemetry.rs`

```rust
    #[test]
    fn test_smaps_rollup_saturating_add_prevents_overflow_panic() {
        let stats = SmapsRollupStats {
            rss_kb: 1024,
            pss_kb: 512,
            pss_anon_kb: 256,
            pss_file_kb: 256,
            private_clean_kb: u64::MAX,
            private_dirty_kb: 100,
            swap_kb: 200,
        };

        // private_ws_kb must saturate to u64::MAX rather than panicking or wrapping
        assert_eq!(stats.private_ws_kb(), u64::MAX);
        assert!(stats.private_ws_mb() > 0.0);

        // commit_kb must also saturate to u64::MAX
        assert_eq!(stats.commit_kb(), u64::MAX);
        assert!(stats.commit_mb() > 0.0);
    }

    #[test]
    fn test_select_earliest_renderer_pid_ordering_and_ties() {
        // 1. Empty candidates
        assert_eq!(select_earliest_renderer_pid(&[]), None);

        // 2. Single candidate
        assert_eq!(select_earliest_renderer_pid(&[(5000, 42)]), Some(42));

        // 3. Earliest timestamp wins over smaller PID (recycled PID resilience)
        // Candidate A: created at 1000 with high PID 9999
        // Candidate B: created at 2000 with low PID 1111
        let candidates = vec![(1000, 9999), (2000, 1111)];
        assert_eq!(
            select_earliest_renderer_pid(&candidates),
            Some(9999),
            "Earliest creation timestamp must win regardless of numerical PID order"
        );

        // 4. Equal timestamps break ties deterministically by lowest PID
        let equal_times = vec![(1000, 5555), (1000, 2222), (1000, 8888)];
        assert_eq!(
            select_earliest_renderer_pid(&equal_times),
            Some(2222),
            "Ties must be broken by lowest PID"
        );

        // 5. Zero timestamp (unrecorded/failed) is deprioritized over valid timestamps
        let zero_fallback = vec![(0, 1001), (500, 3001)];
        assert_eq!(
            select_earliest_renderer_pid(&zero_fallback),
            Some(3001),
            "Valid creation timestamp must take priority over unrecorded 0 timestamp"
        );

        // 6. All zero timestamps fall back to lowest PID
        let all_zeros = vec![(0, 7777), (0, 3333)];
        assert_eq!(
            select_earliest_renderer_pid(&all_zeros),
            Some(3333),
            "All-zero timestamps fall back to lowest PID"
        );
    }

    #[test]
    fn test_platform_symmetry_in_role_fallback() {
        let _guard = TEST_MUTEX.lock().unwrap();

        // When UI_WEBVIEW_RENDERER_PID is 0, both Windows and Linux renderers default to Content Renderer
        UI_WEBVIEW_RENDERER_PID.store(0, Ordering::SeqCst);
        assert_eq!(
            classify_process_with_pid(101, "msedgewebview2.exe", "--type=renderer", false),
            "Content Renderer"
        );
        assert_eq!(
            classify_process_with_pid(102, "WebKitWebProcess", "WebKitWebProcess", false),
            "Content Renderer"
        );

        // When UI_WEBVIEW_RENDERER_PID is registered, exact match is UI WebView; others are Content Renderer
        register_ui_webview_renderer_pid(101);
        assert_eq!(
            classify_process_with_pid(101, "msedgewebview2.exe", "--type=renderer", false),
            "UI WebView"
        );
        assert_eq!(
            classify_process_with_pid(102, "msedgewebview2.exe", "--type=renderer", false),
            "Content Renderer"
        );
        assert_eq!(
            classify_process_with_pid(101, "WebKitWebProcess", "WebKitWebProcess", false),
            "UI WebView"
        );
        assert_eq!(
            classify_process_with_pid(102, "WebKitWebProcess", "WebKitWebProcess", false),
            "Content Renderer"
        );

        UI_WEBVIEW_RENDERER_PID.store(0, Ordering::SeqCst);
    }
```

### 5.3 Diff for `tests/stress_telemetry.rs`

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

---

## 6. Verification Plan & Test Commands

To verify these changes independently once implemented:

1. **Rust Typecheck & Linting**:
   ```powershell
   cargo check
   cargo clippy --all-targets -- -D warnings
   ```
   *Expected*: Zero warnings, zero errors.

2. **Full Rust Unit & Stress Test Execution**:
   ```powershell
   cargo test -- --nocapture
   ```
   *Expected*:
   - `test_smaps_rollup_saturating_add_prevents_overflow_panic` passes.
   - `test_select_earliest_renderer_pid_ordering_and_ties` passes.
   - `test_platform_symmetry_in_role_fallback` passes.
   - `test_stress_smaps_rollup_addition_overflow_edge_cases` passes (asserting no panic).
   - All other 57+ unit tests pass.

3. **Node.js Contract & Invariant E2E Suite**:
   ```powershell
   node tests/e2e/runner.js
   ```
   *Expected*: 4 test suites pass (42 tests total, 0 failed).

4. **5-State Process-Tree Telemetry Verification**:
   ```powershell
   powershell -ExecutionPolicy Bypass -File .\verify_5states.ps1 -State 1
   powershell -ExecutionPolicy Bypass -File .\verify_5states.ps1 -State 2A
   powershell -ExecutionPolicy Bypass -File .\verify_5states.ps1 -State 2B
   ```
   *Expected*: All states reconcile within $\le 2.0\%$ variance and pass UI WebView memory guardrails.
