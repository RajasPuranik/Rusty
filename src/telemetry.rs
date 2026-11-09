//! Real OS & Browser Telemetry Collector.
//!
//! Samples genuine Windows hardware metrics and accurate process tree memory:
//! - System CPU utilization via `GetSystemTimes` differential deltas.
//! - System RAM utilization & gigabytes via `GlobalMemoryStatusEx`.
//! - Browser tree Private Working Set (Task Manager metric), Working Set, and Commit
//!   via Toolhelp32 process-tree walk + `--user-data-dir` command-line matching +
//!   `NtQueryInformationProcess(ProcessVmCounters)`.
//! - Live Chrome whole-process-tree Private Working Set comparison when `chrome.exe` is present.
//! - System GPU utilization & Network throughput via persistent `pdh.dll` WDDM counters.

use serde::Serialize;
use std::path::Path;
use std::sync::OnceLock;

static WEBVIEW_DATA_DIR_NORM: OnceLock<String> = OnceLock::new();

/// Register this browser instance's unique WebView2 user-data directory so telemetry
/// identifies sibling `msedgewebview2.exe` processes owned by this data dir while
/// never matching unrelated apps' WebView2 processes (e.g. Teams, Widgets) by exe name.
pub fn set_webview_data_dir(dir: &Path) {
    let norm = normalize_path_match(&dir.to_string_lossy());
    if !norm.is_empty() {
        let _ = WEBVIEW_DATA_DIR_NORM.set(norm);
    }
}

fn normalize_path_match(s: &str) -> String {
    s.trim()
        .trim_matches('"')
        .replace('/', "\\")
        .to_lowercase()
}

/// Per-process memory details for the Rusty Browser process tree.
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

/// Complete memory breakdown across host + owned WebView2 child processes.
#[derive(Debug, Clone, Serialize)]
pub struct BrowserMemoryBreakdown {
    pub total_private_ws_mb: f64,
    pub total_working_set_mb: f64,
    pub total_commit_mb: f64,
    pub host_private_ws_mb: f64,
    pub process_count: usize,
    pub processes: Vec<ProcessMemoryInfo>,
    pub chrome_live_measured: bool,
    pub chrome_process_count: usize,
    pub chrome_live_private_ws_mb: f64,
}

/// Real-time system and browser telemetry snapshot pushed to UI.
#[derive(Debug, Clone, Serialize)]
pub struct TelemetrySnapshot {
    pub sys_cpu_percent: f64,
    pub sys_ram_percent: f64,
    pub sys_ram_used_gb: f64,
    pub sys_ram_total_gb: f64,
    pub sys_gpu_percent: Option<f64>,
    pub net_kbps: f64,
    /// Headline memory metric: Private Working Set (Task Manager "Memory" metric).
    pub browser_mb: f64,
    pub browser_working_set_mb: f64,
    pub browser_commit_mb: f64,
    pub breakdown: BrowserMemoryBreakdown,
}

/// Extract canonical physical engine key from a Windows GPU Engine PDH instance name.
/// e.g. `"pid_4212_luid_0x00000000_0x00010539_phys_0_eng_0_engtype_3D"` -> `"luid_0x00000000_0x00010539_phys_0_eng_0"`.
fn extract_gpu_engine_key(instance_name: &str) -> &str {
    let from_luid = instance_name
        .find("luid_")
        .map(|idx| &instance_name[idx..])
        .unwrap_or(instance_name);
    from_luid
        .find("_engtype_")
        .map(|idx| &from_luid[..idx])
        .unwrap_or(from_luid)
}

/// Classify a process into a human-readable browser role from executable & command line flags.
pub fn classify_process(exe_name: &str, cmd_line: &str, is_host_pid: bool) -> String {
    if is_host_pid || exe_name.eq_ignore_ascii_case("rusty_browser.exe") {
        return "Host (Rusty)".to_owned();
    }
    let cmd_lower = cmd_line.to_lowercase();
    if exe_name.eq_ignore_ascii_case("msedgewebview2.exe") {
        if cmd_lower.contains("--type=renderer") {
            return "Renderer (Tab/UI)".to_owned();
        }
        if cmd_lower.contains("--type=gpu-process") {
            return "GPU Process".to_owned();
        }
        if cmd_lower.contains("--utility-sub-type=network.mojom.networkservice") {
            return "Network Service".to_owned();
        }
        if cmd_lower.contains("--utility-sub-type=storage.mojom.storageservice") {
            return "Storage Service".to_owned();
        }
        if cmd_lower.contains("--utility-sub-type=audio.mojom.audioservice") {
            return "Audio Service".to_owned();
        }
        if cmd_lower.contains("--type=utility") {
            return "Utility Process".to_owned();
        }
        if cmd_lower.contains("--type=crashpad-handler") {
            return "Crashpad Handler".to_owned();
        }
        if cmd_lower.contains("--type=") {
            return "WebView2 Helper".to_owned();
        }
        return "WebView2 Manager".to_owned();
    }
    if cmd_lower.contains("--type=crashpad-handler") {
        return "Crashpad Handler".to_owned();
    }
    exe_name.to_owned()
}

/// Check if a command line belongs to this browser's `--user-data-dir` path.
fn cmdline_matches_data_dir(cmd_line: &str, norm_data_dir: &str) -> bool {
    if norm_data_dir.is_empty() || cmd_line.is_empty() {
        return false;
    }
    let norm_cmd = cmd_line.replace('/', "\\").to_lowercase();
    norm_cmd.contains("--user-data-dir") && norm_cmd.contains(norm_data_dir)
}

#[inline]
fn round1(v: f64) -> f64 {
    (v * 10.0).round() / 10.0
}

#[inline]
fn round2(v: f64) -> f64 {
    (v * 100.0).round() / 100.0
}

#[allow(dead_code)]
#[derive(Debug, Clone)]
pub(crate) struct ProcNode {
    pub pid: u32,
    pub parent_pid: u32,
    pub creation_time: u64,
}

/// Expand process tree from `seeds`, rejecting child candidates whose `creation_time`
/// predates their matched parent (Windows PID reuse protection).
#[allow(dead_code)]
pub(crate) fn build_process_tree_pids(nodes: &[ProcNode], seeds: &[u32]) -> std::collections::HashSet<u32> {
    use std::collections::{HashMap, HashSet};

    let mut ct_by_pid: HashMap<u32, u64> = HashMap::with_capacity(nodes.len());
    for n in nodes {
        ct_by_pid.insert(n.pid, n.creation_time);
    }

    let mut tree: HashSet<u32> = HashSet::new();
    for &seed in seeds {
        if seed != 0 {
            tree.insert(seed);
        }
    }

    let mut changed = true;
    while changed {
        changed = false;
        for n in nodes {
            if n.pid == 0 || tree.contains(&n.pid) {
                continue;
            }
            if let Some(&parent_ct) = ct_by_pid.get(&n.parent_pid) {
                if !tree.contains(&n.parent_pid) {
                    continue;
                }
                let valid_lineage = parent_ct == 0
                    || (n.creation_time > 0 && n.creation_time >= parent_ct);
                if valid_lineage && tree.insert(n.pid) {
                    changed = true;
                }
            }
        }
    }
    tree
}

#[inline]
fn bytes_to_mb(bytes: usize) -> f64 {
    round1((bytes as f64) / (1024.0 * 1024.0))
}

/// Measure full memory breakdown across host + owned WebView2 processes.
pub fn sample_browser_memory_breakdown(fallback_active_webviews: usize) -> BrowserMemoryBreakdown {
    #[cfg(target_os = "windows")]
    {
        win32_mem::sample_process_tree(fallback_active_webviews)
    }

    #[cfg(not(target_os = "windows"))]
    {
        let est = 35.0 + (fallback_active_webviews as f64 * 30.0);
        BrowserMemoryBreakdown {
            total_private_ws_mb: est,
            total_working_set_mb: est,
            total_commit_mb: est,
            host_private_ws_mb: 5.0,
            process_count: 1,
            processes: Vec::new(),
            chrome_live_measured: false,
            chrome_process_count: 0,
            chrome_live_private_ws_mb: 0.0,
        }
    }
}

/// Measure total Private Working Set memory in MB across host process + owned WebView2 children.
#[allow(dead_code)]
pub fn sample_browser_memory_mb(fallback_active_webviews: usize) -> f64 {
    sample_browser_memory_breakdown(fallback_active_webviews).total_private_ws_mb
}

/// Start background collector thread sending real telemetry snapshots every `interval`.
pub fn spawn_telemetry_collector<F>(interval: std::time::Duration, mut on_sample: F)
where
    F: FnMut(TelemetrySnapshot) -> bool + Send + 'static,
{
    std::thread::spawn(move || {
        #[cfg(target_os = "windows")]
        {
            let mut collector = win32::WinCollector::new();
            // Short warmup gap so differential CPU & PDH rate counters return genuine initial numbers
            std::thread::sleep(std::time::Duration::from_millis(160));
            loop {
                let snap = collector.collect();
                if !on_sample(snap) {
                    break;
                }
                std::thread::sleep(interval);
            }
        }

        #[cfg(not(target_os = "windows"))]
        {
            loop {
                let breakdown = sample_browser_memory_breakdown(1);
                let snap = TelemetrySnapshot {
                    sys_cpu_percent: 0.0,
                    sys_ram_percent: 0.0,
                    sys_ram_used_gb: 0.0,
                    sys_ram_total_gb: 0.0,
                    sys_gpu_percent: None,
                    net_kbps: 0.0,
                    browser_mb: breakdown.total_private_ws_mb,
                    browser_working_set_mb: breakdown.total_working_set_mb,
                    browser_commit_mb: breakdown.total_commit_mb,
                    breakdown,
                };
                if !on_sample(snap) {
                    break;
                }
                std::thread::sleep(interval);
            }
        }
    });
}

#[cfg(target_os = "windows")]
mod win32_mem {
    use super::{
        build_process_tree_pids, bytes_to_mb, classify_process, cmdline_matches_data_dir,
        BrowserMemoryBreakdown, ProcNode, ProcessMemoryInfo, WEBVIEW_DATA_DIR_NORM,
    };
    use std::collections::HashSet;

    #[repr(C)]
    #[derive(Copy, Clone, Default)]
    #[allow(clippy::upper_case_acronyms)]
    struct FILETIME {
        dw_low: u32,
        dw_high: u32,
    }

    impl FILETIME {
        fn to_u64(self) -> u64 {
            ((self.dw_high as u64) << 32) | (self.dw_low as u64)
        }
    }

    #[repr(C)]
    #[allow(non_snake_case)]
    struct PROCESS_MEMORY_COUNTERS_EX {
        cb: u32,
        PageFaultCount: u32,
        PeakWorkingSetSize: usize,
        WorkingSetSize: usize,
        QuotaPeakPagedPoolUsage: usize,
        QuotaPagedPoolUsage: usize,
        QuotaPeakNonPagedPoolUsage: usize,
        QuotaNonPagedPoolUsage: usize,
        PagefileUsage: usize,
        PeakPagefileUsage: usize,
        PrivateUsage: usize,
    }

    #[repr(C)]
    #[allow(non_snake_case)]
    pub(super) struct VM_COUNTERS_EX2 {
        pub PeakVirtualSize: usize,
        pub VirtualSize: usize,
        pub PageFaultCount: u32,
        pub PeakWorkingSetSize: usize,
        pub WorkingSetSize: usize,
        pub QuotaPeakPagedPoolUsage: usize,
        pub QuotaPagedPoolUsage: usize,
        pub QuotaPeakNonPagedPoolUsage: usize,
        pub QuotaNonPagedPoolUsage: usize,
        pub PagefileUsage: usize,
        pub PeakPagefileUsage: usize,
        pub PrivateUsage: usize,
        pub PrivateWorkingSetSize: usize,
        pub SharedCommitUsage: u64,
    }

    #[repr(C)]
    #[allow(non_snake_case)]
    struct UNICODE_STRING {
        Length: u16,
        MaximumLength: u16,
        Buffer: *const u16,
    }

    #[repr(C)]
    #[allow(non_snake_case)]
    struct PROCESSENTRY32W {
        dwSize: u32,
        cntUsage: u32,
        th32ProcessID: u32,
        th32DefaultHeapID: usize,
        th32ModuleID: u32,
        cntThreads: u32,
        th32ParentProcessID: u32,
        pcPriClassBase: i32,
        dwFlags: u32,
        szExeFile: [u16; 260],
    }

    #[link(name = "ntdll")]
    extern "system" {
        fn NtQueryInformationProcess(
            process_handle: isize,
            process_information_class: u32,
            process_information: *mut u8,
            process_information_length: u32,
            return_length: *mut u32,
        ) -> i32;
    }

    extern "system" {
        fn GetCurrentProcess() -> isize;
        fn GetCurrentProcessId() -> u32;
        fn CreateToolhelp32Snapshot(dwFlags: u32, th32ProcessID: u32) -> isize;
        fn Process32FirstW(hSnapshot: isize, lppe: *mut PROCESSENTRY32W) -> i32;
        fn Process32NextW(hSnapshot: isize, lppe: *mut PROCESSENTRY32W) -> i32;
        fn OpenProcess(dwDesiredAccess: u32, bInheritHandle: i32, dwProcessId: u32) -> isize;
        fn CloseHandle(hObject: isize) -> i32;
        fn GetProcessTimes(
            hProcess: isize,
            lpCreationTime: *mut FILETIME,
            lpExitTime: *mut FILETIME,
            lpKernelTime: *mut FILETIME,
            lpUserTime: *mut FILETIME,
        ) -> i32;
        fn K32GetProcessMemoryInfo(
            process: isize,
            ppsmc: *mut PROCESS_MEMORY_COUNTERS_EX,
            cb: u32,
        ) -> i32;
    }

    const TH32CS_SNAPPROCESS: u32 = 0x0000_0002;
    const PROCESS_QUERY_LIMITED_INFORMATION: u32 = 0x1000;
    const PROCESS_VM_COUNTERS: u32 = 3;
    const PROCESS_COMMAND_LINE_INFORMATION: u32 = 60;
    const INVALID_HANDLE_VALUE: isize = -1;
    const STATUS_INFO_LENGTH_MISMATCH: i32 = -1073741820; // 0xC0000004_u32 as i32

    fn exe_name_from_wide(buf: &[u16; 260]) -> String {
        let len = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
        String::from_utf16_lossy(&buf[..len])
    }

    unsafe fn read_process_creation_time(handle: isize) -> u64 {
        let mut ct = FILETIME::default();
        let mut exit = FILETIME::default();
        let mut kernel = FILETIME::default();
        let mut user = FILETIME::default();
        if GetProcessTimes(handle, &mut ct, &mut exit, &mut kernel, &mut user) != 0 {
            ct.to_u64()
        } else {
            0
        }
    }

    unsafe fn read_process_cmdline(handle: isize) -> String {
        let mut words = vec![0usize; 512]; // 4096 bytes, 8-byte aligned
        let mut ret_len: u32 = 0;
        let mut st = NtQueryInformationProcess(
            handle,
            PROCESS_COMMAND_LINE_INFORMATION,
            words.as_mut_ptr() as *mut u8,
            (words.len() * std::mem::size_of::<usize>()) as u32,
            &mut ret_len,
        );
        if st == STATUS_INFO_LENGTH_MISMATCH && ret_len > 0 && ret_len <= 131_072 {
            let needed_words = ((ret_len as usize) + std::mem::size_of::<usize>() - 1)
                / std::mem::size_of::<usize>();
            words.resize(needed_words, 0);
            st = NtQueryInformationProcess(
                handle,
                PROCESS_COMMAND_LINE_INFORMATION,
                words.as_mut_ptr() as *mut u8,
                (words.len() * std::mem::size_of::<usize>()) as u32,
                &mut ret_len,
            );
        }
        if st != 0 {
            return String::new();
        }
        let ustr = &*(words.as_ptr() as *const UNICODE_STRING);
        if ustr.Buffer.is_null() || ustr.Length == 0 {
            return String::new();
        }
        let char_len = (ustr.Length as usize) / 2;
        let slice = std::slice::from_raw_parts(ustr.Buffer, char_len);
        String::from_utf16_lossy(slice)
    }

    /// Returns `(private_ws_bytes, working_set_bytes, commit_bytes)`.
    unsafe fn read_process_memory(handle: isize) -> Option<(usize, usize, usize)> {
        let mut vm: VM_COUNTERS_EX2 = std::mem::zeroed();
        let mut ret_len: u32 = 0;
        let st = NtQueryInformationProcess(
            handle,
            PROCESS_VM_COUNTERS,
            (&mut vm as *mut VM_COUNTERS_EX2) as *mut u8,
            std::mem::size_of::<VM_COUNTERS_EX2>() as u32,
            &mut ret_len,
        );
        if st == 0 && ret_len as usize >= std::mem::size_of::<VM_COUNTERS_EX2>() {
            return Some((
                vm.PrivateWorkingSetSize,
                vm.WorkingSetSize,
                vm.PrivateUsage,
            ));
        }

        // Fallback if older OS lacks VM_COUNTERS_EX2: use K32GetProcessMemoryInfo
        let mut counters: PROCESS_MEMORY_COUNTERS_EX = std::mem::zeroed();
        counters.cb = std::mem::size_of::<PROCESS_MEMORY_COUNTERS_EX>() as u32;
        if K32GetProcessMemoryInfo(handle, &mut counters, counters.cb) != 0 {
            return Some((
                counters.PrivateUsage.min(counters.WorkingSetSize),
                counters.WorkingSetSize,
                counters.PrivateUsage,
            ));
        }
        None
    }

    pub fn sample_process_tree(fallback_active_webviews: usize) -> BrowserMemoryBreakdown {
        unsafe {
            let my_pid = GetCurrentProcessId();
            let norm_data_dir = WEBVIEW_DATA_DIR_NORM
                .get()
                .map(|s| s.as_str())
                .unwrap_or("");

            struct ProcSnap {
                pid: u32,
                parent_pid: u32,
                exe: String,
            }

            let mut all_procs: Vec<ProcSnap> = Vec::new();
            let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
            if snapshot != INVALID_HANDLE_VALUE && snapshot != 0 {
                let mut pe: PROCESSENTRY32W = std::mem::zeroed();
                pe.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
                if Process32FirstW(snapshot, &mut pe) != 0 {
                    loop {
                        all_procs.push(ProcSnap {
                            pid: pe.th32ProcessID,
                            parent_pid: pe.th32ParentProcessID,
                            exe: exe_name_from_wide(&pe.szExeFile),
                        });
                        pe.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
                        if Process32NextW(snapshot, &mut pe) == 0 {
                            break;
                        }
                    }
                }
                CloseHandle(snapshot);
            }

            let expand_optimistic = |seeds: &[u32]| -> HashSet<u32> {
                let mut set: HashSet<u32> = seeds.iter().copied().filter(|&p| p != 0).collect();
                let mut changed = true;
                while changed {
                    changed = false;
                    for p in &all_procs {
                        if set.contains(&p.parent_pid) && set.insert(p.pid) {
                            changed = true;
                        }
                    }
                }
                set
            };

            let optimistic_rusty = expand_optimistic(&[my_pid]);
            let wv2_all_seeds: Vec<u32> = if norm_data_dir.is_empty() {
                Vec::new()
            } else {
                all_procs
                    .iter()
                    .filter(|p| p.exe.eq_ignore_ascii_case("msedgewebview2.exe"))
                    .map(|p| p.pid)
                    .collect()
            };
            let optimistic_wv2 = expand_optimistic(&wv2_all_seeds);
            let chrome_all_seeds: Vec<u32> = all_procs
                .iter()
                .filter(|p| p.exe.eq_ignore_ascii_case("chrome.exe"))
                .map(|p| p.pid)
                .collect();
            let optimistic_chrome = expand_optimistic(&chrome_all_seeds);

            let my_parent_pid = all_procs
                .iter()
                .find(|p| p.pid == my_pid)
                .map(|p| p.parent_pid)
                .unwrap_or(0);

            struct CandSnap {
                pid: u32,
                parent_pid: u32,
                exe: String,
                is_wv2: bool,
                cmd_line: String,
                mem: Option<(usize, usize, usize)>,
            }

            let mut cands: Vec<CandSnap> = Vec::new();
            let mut cand_nodes: Vec<ProcNode> = Vec::new();

            for p in &all_procs {
                let maybe_rusty = optimistic_rusty.contains(&p.pid) || optimistic_wv2.contains(&p.pid);
                let maybe_chrome = optimistic_chrome.contains(&p.pid);
                if !maybe_rusty && !maybe_chrome {
                    continue;
                }

                let is_self = p.pid == my_pid;
                let handle = if is_self {
                    GetCurrentProcess() // Pseudo-handle is -1 (== INVALID_HANDLE_VALUE)!
                } else {
                    OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, p.pid)
                };

                if !is_self && (handle == 0 || handle == INVALID_HANDLE_VALUE) {
                    continue;
                }

                let creation_time = read_process_creation_time(handle);
                let mem = read_process_memory(handle);
                let is_wv2 = p.exe.eq_ignore_ascii_case("msedgewebview2.exe");
                let cmd_line = if maybe_rusty {
                    read_process_cmdline(handle)
                } else {
                    String::new()
                };

                if !is_self {
                    CloseHandle(handle);
                }

                cand_nodes.push(ProcNode {
                    pid: p.pid,
                    parent_pid: p.parent_pid,
                    creation_time,
                });
                cands.push(CandSnap {
                    pid: p.pid,
                    parent_pid: p.parent_pid,
                    exe: p.exe.clone(),
                    is_wv2,
                    cmd_line,
                    mem,
                });
            }

            // Seed with host PID + any msedgewebview2.exe whose `--user-data-dir` matches ours,
            // then expand recursively using `GetProcessTimes` lineage validation so Windows
            // PID reuse or third-party WebView2 hosts are never falsely included.
            let mut rusty_seeds = vec![my_pid];
            if !norm_data_dir.is_empty() {
                for c in &cands {
                    if c.is_wv2 && cmdline_matches_data_dir(&c.cmd_line, norm_data_dir) {
                        rusty_seeds.push(c.pid);
                    }
                }
            }
            let owned_pids = build_process_tree_pids(&cand_nodes, &rusty_seeds);

            let chrome_seeds: Vec<u32> = cands
                .iter()
                .filter(|c| c.exe.eq_ignore_ascii_case("chrome.exe"))
                .map(|c| c.pid)
                .collect();
            let chrome_pids = if chrome_seeds.is_empty() {
                HashSet::new()
            } else {
                build_process_tree_pids(&cand_nodes, &chrome_seeds)
            };

            let mut processes: Vec<ProcessMemoryInfo> = Vec::new();
            let mut total_priv_ws: usize = 0;
            let mut total_ws: usize = 0;
            let mut total_commit: usize = 0;
            let mut host_priv_ws: usize = 0;

            let mut chrome_priv_ws: usize = 0;
            let mut chrome_count: usize = 0;

            for c in &cands {
                if owned_pids.contains(&c.pid) {
                    if let Some((priv_ws, ws, commit)) = c.mem {
                        let is_self = c.pid == my_pid;
                        total_priv_ws += priv_ws;
                        total_ws += ws;
                        total_commit += commit;
                        if is_self {
                            host_priv_ws = priv_ws;
                        }
                        let kind = classify_process(&c.exe, &c.cmd_line, is_self);
                        processes.push(ProcessMemoryInfo {
                            pid: c.pid,
                            parent_pid: c.parent_pid,
                            kind,
                            exe_name: c.exe.clone(),
                            private_ws_mb: bytes_to_mb(priv_ws),
                            working_set_mb: bytes_to_mb(ws),
                            commit_mb: bytes_to_mb(commit),
                        });
                    }
                } else if chrome_pids.contains(&c.pid) {
                    if let Some((priv_ws, _, _)) = c.mem {
                        chrome_priv_ws += priv_ws;
                        chrome_count += 1;
                    }
                }
            }

            // Ensure host process is included even if snapshot enumeration raced
            if processes.is_empty() {
                if let Some((priv_ws, ws, commit)) = read_process_memory(GetCurrentProcess()) {
                    total_priv_ws = priv_ws;
                    total_ws = ws;
                    total_commit = commit;
                    host_priv_ws = priv_ws;
                    processes.push(ProcessMemoryInfo {
                        pid: my_pid,
                        parent_pid: my_parent_pid,
                        kind: "Host (Rusty)".to_owned(),
                        exe_name: "rusty_browser.exe".to_owned(),
                        private_ws_mb: bytes_to_mb(priv_ws),
                        working_set_mb: bytes_to_mb(ws),
                        commit_mb: bytes_to_mb(commit),
                    });
                } else {
                    let est = 35.0 + (fallback_active_webviews as f64 * 30.0);
                    return BrowserMemoryBreakdown {
                        total_private_ws_mb: est,
                        total_working_set_mb: est,
                        total_commit_mb: est,
                        host_private_ws_mb: 3.5,
                        process_count: 1,
                        processes: Vec::new(),
                        chrome_live_measured: false,
                        chrome_process_count: 0,
                        chrome_live_private_ws_mb: 0.0,
                    };
                }
            }

            // Sort: host first, then highest Private Working Set first
            processes.sort_by(|a, b| {
                let a_host = a.pid == my_pid;
                let b_host = b.pid == my_pid;
                b_host
                    .cmp(&a_host)
                    .then_with(|| b.private_ws_mb.total_cmp(&a.private_ws_mb))
            });

            BrowserMemoryBreakdown {
                total_private_ws_mb: bytes_to_mb(total_priv_ws),
                total_working_set_mb: bytes_to_mb(total_ws),
                total_commit_mb: bytes_to_mb(total_commit),
                host_private_ws_mb: bytes_to_mb(host_priv_ws),
                process_count: processes.len(),
                processes,
                chrome_live_measured: chrome_count > 0 && chrome_priv_ws > 0,
                chrome_process_count: chrome_count,
                chrome_live_private_ws_mb: bytes_to_mb(chrome_priv_ws),
            }
        }
    }
}

#[cfg(target_os = "windows")]
mod win32 {
    use super::{extract_gpu_engine_key, round1, round2, sample_browser_memory_breakdown, TelemetrySnapshot};
    use std::collections::HashMap;
    use std::ffi::c_void;
    use std::ptr;

    #[repr(C)]
    #[derive(Copy, Clone, Default)]
    #[allow(clippy::upper_case_acronyms)]
    struct FILETIME {
        dw_low: u32,
        dw_high: u32,
    }

    impl FILETIME {
        fn to_u64(self) -> u64 {
            ((self.dw_high as u64) << 32) | (self.dw_low as u64)
        }
    }

    #[repr(C)]
    #[allow(non_snake_case, clippy::upper_case_acronyms)]
    struct MEMORYSTATUSEX {
        dwLength: u32,
        dwMemoryLoad: u32,
        ullTotalPhys: u64,
        ullAvailPhys: u64,
        ullTotalPageFile: u64,
        ullAvailPageFile: u64,
        ullTotalVirtual: u64,
        ullAvailVirtual: u64,
        ullAvailExtendedVirtual: u64,
    }

    #[repr(C)]
    #[allow(non_snake_case)]
    struct PDH_FMT_COUNTERVALUE {
        CStatus: u32,
        _padding: u32,
        doubleValue: f64,
    }

    #[repr(C)]
    #[allow(non_snake_case)]
    struct PDH_FMT_COUNTERVALUE_ITEM_W {
        szName: *mut u16,
        FmtValue: PDH_FMT_COUNTERVALUE,
    }

    const PDH_FMT_DOUBLE: u32 = 0x0000_0200;
    const PDH_MORE_DATA: u32 = 0x8000_07D2;
    const PDH_CSTATUS_VALID_DATA: u32 = 0x0;
    const PDH_CSTATUS_NEW_DATA: u32 = 0x1;

    extern "system" {
        fn GetSystemTimes(
            lpIdleTime: *mut FILETIME,
            lpKernelTime: *mut FILETIME,
            lpUserTime: *mut FILETIME,
        ) -> i32;
        fn GlobalMemoryStatusEx(lpBuffer: *mut MEMORYSTATUSEX) -> i32;
    }

    #[link(name = "pdh")]
    extern "system" {
        fn PdhOpenQueryW(
            szDataSource: *const u16,
            dwUserData: usize,
            phQuery: *mut *mut c_void,
        ) -> i32;
        fn PdhAddEnglishCounterW(
            hQuery: *mut c_void,
            szFullCounterPath: *const u16,
            dwUserData: usize,
            phCounter: *mut *mut c_void,
        ) -> i32;
        fn PdhCollectQueryData(hQuery: *mut c_void) -> i32;
        fn PdhGetFormattedCounterArrayW(
            hCounter: *mut c_void,
            dwFormat: u32,
            lpdwBufferSize: *mut u32,
            lpdwItemCount: *mut u32,
            ItemBuffer: *mut PDH_FMT_COUNTERVALUE_ITEM_W,
        ) -> i32;
        fn PdhCloseQuery(hQuery: *mut c_void) -> i32;
    }

    fn to_wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    unsafe fn wide_ptr_to_string(ptr: *const u16) -> String {
        if ptr.is_null() {
            return String::new();
        }
        let mut len = 0usize;
        while len < 512 && *ptr.add(len) != 0 {
            len += 1;
        }
        let slice = std::slice::from_raw_parts(ptr, len);
        String::from_utf16_lossy(slice)
    }

    pub struct WinCollector {
        prev_idle: u64,
        prev_kernel: u64,
        prev_user: u64,
        pdh_query: *mut c_void,
        gpu_counter: *mut c_void,
        net_counter: *mut c_void,
        pdh_buf: Vec<u8>,
    }

    impl Drop for WinCollector {
        fn drop(&mut self) {
            if !self.pdh_query.is_null() {
                unsafe {
                    PdhCloseQuery(self.pdh_query);
                }
                self.pdh_query = ptr::null_mut();
            }
        }
    }

    impl WinCollector {
        pub fn new() -> Self {
            let (idle, kernel, user) = Self::read_sys_times();
            let mut pdh_query: *mut c_void = ptr::null_mut();
            let mut gpu_counter: *mut c_void = ptr::null_mut();
            let mut net_counter: *mut c_void = ptr::null_mut();

            unsafe {
                if PdhOpenQueryW(ptr::null(), 0, &mut pdh_query) == 0 && !pdh_query.is_null() {
                    let gpu_path = to_wide(r"\GPU Engine(*)\Utilization Percentage");
                    if PdhAddEnglishCounterW(pdh_query, gpu_path.as_ptr(), 0, &mut gpu_counter) != 0
                    {
                        gpu_counter = ptr::null_mut();
                    }

                    let net_path = to_wide(r"\Network Interface(*)\Bytes Total/sec");
                    if PdhAddEnglishCounterW(pdh_query, net_path.as_ptr(), 0, &mut net_counter) != 0
                    {
                        net_counter = ptr::null_mut();
                    }

                    let _ = PdhCollectQueryData(pdh_query);
                } else {
                    pdh_query = ptr::null_mut();
                }
            }

            Self {
                prev_idle: idle,
                prev_kernel: kernel,
                prev_user: user,
                pdh_query,
                gpu_counter,
                net_counter,
                pdh_buf: Vec::with_capacity(131_072),
            }
        }

        fn read_sys_times() -> (u64, u64, u64) {
            let mut idle = FILETIME::default();
            let mut kernel = FILETIME::default();
            let mut user = FILETIME::default();
            unsafe {
                if GetSystemTimes(&mut idle, &mut kernel, &mut user) != 0 {
                    (idle.to_u64(), kernel.to_u64(), user.to_u64())
                } else {
                    (0, 0, 0)
                }
            }
        }

        fn collect_cpu_percent(&mut self) -> f64 {
            let (cur_idle, cur_kernel, cur_user) = Self::read_sys_times();
            let d_idle = cur_idle.saturating_sub(self.prev_idle);
            let d_kernel = cur_kernel.saturating_sub(self.prev_kernel);
            let d_user = cur_user.saturating_sub(self.prev_user);
            self.prev_idle = cur_idle;
            self.prev_kernel = cur_kernel;
            self.prev_user = cur_user;

            let total = d_kernel.saturating_add(d_user);
            if total == 0 {
                return 0.0;
            }
            let busy = total.saturating_sub(d_idle);
            round1(((busy as f64 / total as f64) * 100.0).clamp(0.0, 100.0))
        }

        fn collect_ram_stats() -> (f64, f64, f64) {
            unsafe {
                let mut ms: MEMORYSTATUSEX = std::mem::zeroed();
                ms.dwLength = std::mem::size_of::<MEMORYSTATUSEX>() as u32;
                if GlobalMemoryStatusEx(&mut ms) != 0 && ms.ullTotalPhys > 0 {
                    let gb = 1024.0 * 1024.0 * 1024.0;
                    let total_gb = round2(ms.ullTotalPhys as f64 / gb);
                    let used_bytes = ms.ullTotalPhys.saturating_sub(ms.ullAvailPhys);
                    let used_gb = round2(used_bytes as f64 / gb);
                    let load = ms.dwMemoryLoad as f64;
                    (load, used_gb, total_gb)
                } else {
                    (0.0, 0.0, 0.0)
                }
            }
        }

        unsafe fn collect_counter_items(&mut self, counter: *mut c_void) -> usize {
            if counter.is_null() {
                return 0;
            }
            let mut buf_size: u32 = 0;
            let mut count: u32 = 0;
            let status = PdhGetFormattedCounterArrayW(
                counter,
                PDH_FMT_DOUBLE,
                &mut buf_size,
                &mut count,
                ptr::null_mut(),
            ) as u32;
            if status != PDH_MORE_DATA && status != 0 {
                return 0;
            }
            if buf_size == 0 || count == 0 {
                return 0;
            }

            let needed = buf_size as usize;
            if self.pdh_buf.len() < needed {
                self.pdh_buf.resize(needed, 0);
            }
            let ptr = self.pdh_buf.as_mut_ptr() as *mut PDH_FMT_COUNTERVALUE_ITEM_W;
            let status2 = PdhGetFormattedCounterArrayW(
                counter,
                PDH_FMT_DOUBLE,
                &mut buf_size,
                &mut count,
                ptr,
            );
            if status2 != 0 {
                return 0;
            }
            count as usize
        }

        fn collect_pdh(&mut self) -> (Option<f64>, f64) {
            if self.pdh_query.is_null() {
                return (None, 0.0);
            }
            unsafe {
                if PdhCollectQueryData(self.pdh_query) != 0 {
                    return (None, 0.0);
                }

                let gpu_pct = if !self.gpu_counter.is_null() {
                    let count = self.collect_counter_items(self.gpu_counter);
                    if count > 0 {
                        let items = std::slice::from_raw_parts(
                            self.pdh_buf.as_ptr() as *const PDH_FMT_COUNTERVALUE_ITEM_W,
                            count,
                        );
                        let mut engine_totals: HashMap<String, f64> = HashMap::new();
                        let mut saw_valid = false;
                        for item in items {
                            let cstatus = item.FmtValue.CStatus;
                            if cstatus == PDH_CSTATUS_VALID_DATA || cstatus == PDH_CSTATUS_NEW_DATA {
                                saw_valid = true;
                                let val = item.FmtValue.doubleValue;
                                if val > 0.001 && val.is_finite() {
                                    let name = wide_ptr_to_string(item.szName);
                                    let key = extract_gpu_engine_key(&name).to_owned();
                                    *engine_totals.entry(key).or_insert(0.0) += val;
                                }
                            }
                        }
                        if saw_valid {
                            let max_engine = engine_totals
                                .values()
                                .copied()
                                .fold(0.0_f64, f64::max)
                                .clamp(0.0, 100.0);
                            Some(round1(max_engine))
                        } else {
                            None
                        }
                    } else {
                        None
                    }
                } else {
                    None
                };

                let net_kbps = if !self.net_counter.is_null() {
                    let count = self.collect_counter_items(self.net_counter);
                    if count > 0 {
                        let items = std::slice::from_raw_parts(
                            self.pdh_buf.as_ptr() as *const PDH_FMT_COUNTERVALUE_ITEM_W,
                            count,
                        );
                        let mut total_bps = 0.0;
                        for item in items {
                            let cstatus = item.FmtValue.CStatus;
                            if cstatus == PDH_CSTATUS_VALID_DATA || cstatus == PDH_CSTATUS_NEW_DATA {
                                let v = item.FmtValue.doubleValue;
                                if v > 0.0 && v.is_finite() {
                                    total_bps += v;
                                }
                            }
                        }
                        round1(total_bps / 1024.0)
                    } else {
                        0.0
                    }
                } else {
                    0.0
                };

                (gpu_pct, net_kbps)
            }
        }

        pub fn collect(&mut self) -> TelemetrySnapshot {
            let sys_cpu_percent = self.collect_cpu_percent();
            let (sys_ram_percent, sys_ram_used_gb, sys_ram_total_gb) = Self::collect_ram_stats();
            let (sys_gpu_percent, net_kbps) = self.collect_pdh();
            let breakdown = sample_browser_memory_breakdown(1);

            TelemetrySnapshot {
                sys_cpu_percent,
                sys_ram_percent,
                sys_ram_used_gb,
                sys_ram_total_gb,
                sys_gpu_percent,
                net_kbps,
                browser_mb: breakdown.total_private_ws_mb,
                browser_working_set_mb: breakdown.total_working_set_mb,
                browser_commit_mb: breakdown.total_commit_mb,
                breakdown,
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_gpu_engine_key() {
        let name = "pid_4212_luid_0x00000000_0x00010539_phys_0_eng_0_engtype_3D";
        assert_eq!(
            extract_gpu_engine_key(name),
            "luid_0x00000000_0x00010539_phys_0_eng_0"
        );
        assert_eq!(extract_gpu_engine_key("simple_gpu"), "simple_gpu");
    }

    #[test]
    fn test_classify_process_and_data_dir_match() {
        assert_eq!(
            classify_process("rusty_browser.exe", "", false),
            "Host (Rusty)"
        );
        assert_eq!(
            classify_process("msedgewebview2.exe", "msedgewebview2.exe --type=renderer", false),
            "Renderer (Tab/UI)"
        );
        assert_eq!(
            classify_process("msedgewebview2.exe", "msedgewebview2.exe --type=gpu-process", false),
            "GPU Process"
        );
        assert_eq!(
            classify_process(
                "msedgewebview2.exe",
                "msedgewebview2.exe --type=utility --utility-sub-type=network.mojom.NetworkService",
                false
            ),
            "Network Service"
        );
        assert_eq!(
            classify_process("msedgewebview2.exe", "\"msedgewebview2.exe\" --user-data-dir=\"C:\\AppData\\rusty_browser\\WebView2\"", false),
            "WebView2 Manager"
        );

        let dir = normalize_path_match("C:\\Users\\Test\\AppData\\Roaming\\rusty_browser\\WebView2");
        assert!(cmdline_matches_data_dir(
            "\"msedgewebview2.exe\" --user-data-dir=\"C:/Users/Test/AppData/Roaming/rusty_browser/WebView2\\EBWebView\" --type=renderer",
            &dir
        ));
        assert!(!cmdline_matches_data_dir(
            "\"msedgewebview2.exe\" --user-data-dir=\"C:\\Users\\Test\\AppData\\Local\\Microsoft\\Teams\\EBWebView\"",
            &dir
        ));
    }

    #[test]
    fn test_sample_browser_memory_is_positive() {
        let bd = sample_browser_memory_breakdown(1);
        assert!(bd.total_private_ws_mb > 0.5 && bd.total_private_ws_mb < 64_000.0);
        assert!(bd.total_working_set_mb >= bd.total_private_ws_mb);
        assert!(bd.host_private_ws_mb > 0.5);
        assert!(bd.processes.iter().any(|p| p.pid == std::process::id()));
        assert!(!bd.processes.is_empty());
        assert_eq!(bd.process_count, bd.processes.len());
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn test_win_vm_counters_ex2_size_and_collector() {
        assert_eq!(std::mem::size_of::<win32_mem::VM_COUNTERS_EX2>(), 112);

        let mut collector = win32::WinCollector::new();
        std::thread::sleep(std::time::Duration::from_millis(120));
        let snap = collector.collect();
        assert!(snap.sys_ram_total_gb > 0.5);
        assert!(snap.sys_ram_percent >= 0.0 && snap.sys_ram_percent <= 100.0);
        assert!(snap.sys_cpu_percent >= 0.0 && snap.sys_cpu_percent <= 100.0);
        assert!(snap.browser_mb > 0.5);
        assert!(snap.browser_working_set_mb >= snap.browser_mb);
        assert!(snap.breakdown.host_private_ws_mb > 0.5);
    }

    #[test]
    fn test_process_tree_rejects_pid_reuse_by_creation_time() {
        let nodes = vec![
            ProcNode { pid: 100, parent_pid: 1, creation_time: 1000 },
            // Genuine child + grandchild created after parent
            ProcNode { pid: 101, parent_pid: 100, creation_time: 1050 },
            ProcNode { pid: 102, parent_pid: 101, creation_time: 1100 },
            // Unrelated process referencing reused parent PID 100, created BEFORE 1000
            ProcNode { pid: 103, parent_pid: 100, creation_time: 900 },
            ProcNode { pid: 104, parent_pid: 103, creation_time: 950 },
            // Secondary seed (e.g. --user-data-dir matched WebView2) + its own child
            ProcNode { pid: 200, parent_pid: 999, creation_time: 2000 },
            ProcNode { pid: 201, parent_pid: 200, creation_time: 2050 },
            // Unrelated WebView2 process (e.g. Teams) not in seeds
            ProcNode { pid: 300, parent_pid: 888, creation_time: 3000 },
        ];
        let tree = build_process_tree_pids(&nodes, &[100, 200]);
        assert!(tree.contains(&100));
        assert!(tree.contains(&101));
        assert!(tree.contains(&102));
        assert!(!tree.contains(&103));
        assert!(!tree.contains(&104));
        assert!(tree.contains(&200));
        assert!(tree.contains(&201));
        assert!(!tree.contains(&300));
    }
}
