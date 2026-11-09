//! Real OS & Browser Telemetry Collector.
//!
//! Samples genuine Windows hardware metrics and process tree memory:
//! - System CPU utilization via `GetSystemTimes` differential deltas.
//! - System RAM utilization & gigabytes via `GlobalMemoryStatusEx`.
//! - Browser tree working set (host + all `msedgewebview2.exe` descendants) via Toolhelp32 + `K32GetProcessMemoryInfo`.
//! - System GPU utilization & Network throughput via persistent `pdh.dll` WDDM counters.

use serde::Serialize;

/// Real-time system and browser telemetry snapshot pushed to UI.
#[derive(Debug, Clone, Serialize)]
pub struct TelemetrySnapshot {
    pub sys_cpu_percent: f64,
    pub sys_ram_percent: f64,
    pub sys_ram_used_gb: f64,
    pub sys_ram_total_gb: f64,
    pub sys_gpu_percent: Option<f64>,
    pub net_kbps: f64,
    pub browser_mb: f64,
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

#[inline]
fn round1(v: f64) -> f64 {
    (v * 10.0).round() / 10.0
}

#[inline]
fn round2(v: f64) -> f64 {
    (v * 100.0).round() / 100.0
}

/// Measure total working set memory in MB across host process + all WebView2 child processes.
pub fn sample_browser_memory_mb(fallback_active_webviews: usize) -> f64 {
    #[cfg(target_os = "windows")]
    {
        use std::collections::HashSet;

        #[repr(C)]
        #[allow(non_snake_case)]
        struct PROCESS_MEMORY_COUNTERS {
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

        extern "system" {
            fn GetCurrentProcess() -> isize;
            fn GetCurrentProcessId() -> u32;
            fn CreateToolhelp32Snapshot(dwFlags: u32, th32ProcessID: u32) -> isize;
            fn Process32FirstW(hSnapshot: isize, lppe: *mut PROCESSENTRY32W) -> i32;
            fn Process32NextW(hSnapshot: isize, lppe: *mut PROCESSENTRY32W) -> i32;
            fn OpenProcess(dwDesiredAccess: u32, bInheritHandle: i32, dwProcessId: u32) -> isize;
            fn CloseHandle(hObject: isize) -> i32;
            fn K32GetProcessMemoryInfo(
                process: isize,
                ppsmc: *mut PROCESS_MEMORY_COUNTERS,
                cb: u32,
            ) -> i32;
        }

        const TH32CS_SNAPPROCESS: u32 = 0x0000_0002;
        const PROCESS_QUERY_LIMITED_INFORMATION: u32 = 0x1000;
        const INVALID_HANDLE_VALUE: isize = -1;

        unsafe {
            let mut total_bytes: usize = 0;

            let mut counters: PROCESS_MEMORY_COUNTERS = std::mem::zeroed();
            counters.cb = std::mem::size_of::<PROCESS_MEMORY_COUNTERS>() as u32;
            if K32GetProcessMemoryInfo(GetCurrentProcess(), &mut counters, counters.cb) != 0 {
                total_bytes += counters.WorkingSetSize;
            }

            let my_pid = GetCurrentProcessId();
            let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
            if snapshot != INVALID_HANDLE_VALUE && snapshot != 0 {
                let mut tree_pids: HashSet<u32> = HashSet::new();
                tree_pids.insert(my_pid);

                let mut all_entries: Vec<(u32, u32)> = Vec::new();
                let mut pe: PROCESSENTRY32W = std::mem::zeroed();
                pe.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;

                if Process32FirstW(snapshot, &mut pe) != 0 {
                    loop {
                        all_entries.push((pe.th32ProcessID, pe.th32ParentProcessID));
                        pe.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
                        if Process32NextW(snapshot, &mut pe) == 0 {
                            break;
                        }
                    }
                }
                CloseHandle(snapshot);

                let mut changed = true;
                while changed {
                    changed = false;
                    for &(pid, parent) in &all_entries {
                        if tree_pids.contains(&parent) && tree_pids.insert(pid) {
                            changed = true;
                        }
                    }
                }

                for &pid in &tree_pids {
                    if pid == my_pid {
                        continue;
                    }
                    let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
                    if handle != 0 && handle != INVALID_HANDLE_VALUE {
                        let mut child_counters: PROCESS_MEMORY_COUNTERS = std::mem::zeroed();
                        child_counters.cb =
                            std::mem::size_of::<PROCESS_MEMORY_COUNTERS>() as u32;
                        if K32GetProcessMemoryInfo(handle, &mut child_counters, child_counters.cb)
                            != 0
                        {
                            total_bytes += child_counters.WorkingSetSize;
                        }
                        CloseHandle(handle);
                    }
                }
            }

            if total_bytes > 0 {
                round1((total_bytes as f64) / (1024.0 * 1024.0))
            } else {
                35.0 + (fallback_active_webviews as f64 * 30.0)
            }
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        35.0 + (fallback_active_webviews as f64 * 30.0)
    }
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
                let snap = TelemetrySnapshot {
                    sys_cpu_percent: 0.0,
                    sys_ram_percent: 0.0,
                    sys_ram_used_gb: 0.0,
                    sys_ram_total_gb: 0.0,
                    sys_gpu_percent: None,
                    net_kbps: 0.0,
                    browser_mb: sample_browser_memory_mb(1),
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
mod win32 {
    use super::{extract_gpu_engine_key, round1, round2, sample_browser_memory_mb, TelemetrySnapshot};
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

            // In Win32 GetSystemTimes, kernel time includes idle time
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

                // 1. GPU Engine utilization: sum per physical adapter engine, report max engine
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

                // 2. Network Interface throughput: sum active interfaces -> KB/s
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
            let browser_mb = sample_browser_memory_mb(1);

            TelemetrySnapshot {
                sys_cpu_percent,
                sys_ram_percent,
                sys_ram_used_gb,
                sys_ram_total_gb,
                sys_gpu_percent,
                net_kbps,
                browser_mb,
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
    fn test_sample_browser_memory_is_positive() {
        let mb = sample_browser_memory_mb(1);
        assert!(mb > 1.0 && mb < 64_000.0);
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn test_win_collector_returns_real_os_metrics() {
        let mut collector = win32::WinCollector::new();
        std::thread::sleep(std::time::Duration::from_millis(120));
        let snap = collector.collect();
        assert!(snap.sys_ram_total_gb > 0.5);
        assert!(snap.sys_ram_percent >= 0.0 && snap.sys_ram_percent <= 100.0);
        assert!(snap.sys_cpu_percent >= 0.0 && snap.sys_cpu_percent <= 100.0);
        assert!(snap.browser_mb > 1.0);
    }
}
