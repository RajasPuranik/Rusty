//! Rusty Browser – Milestone 5
//!
//! Dual-skin architecture ("Minimal" vs "Crazy") with shared codebase:
//!   1. Complete UI rewrite embedded in the binary via `rusty://app/` custom protocol.
//!   2. Bidirectional, strongly-typed IPC contract between Chrome WebView and Rust backend.
//!   3. Zero-overlap layout management: child content webviews are dynamically bounded
//!      to `content_rect { x, y, width, height }` reported by CSS/JS layout.
//!   4. Overlay modal management: content webviews are seamlessly hidden during modals
//!      (`overlay { open: true/false }`) so Command Palette and Settings render unobscured.
//!   5. Tab groups, tab pinning, drag-and-drop reordering, tab duplication, sleep/wake states.
//!   6. Live memory badge telemetry comparing working set vs Chrome baseline.
//!   7. Security sandbox: IPC is restricted to `rusty://app/` origin; untrusted web pages
//!      cannot execute arbitrary browser commands.

mod storage;
mod tab;
mod telemetry;
mod ui;
mod url_resolver;
mod weather;
pub mod workspace;
pub mod adblock;
pub mod vault;
pub mod vpn;
pub mod focus;
pub mod extensions;
mod platform;
#[allow(unused_imports)]
use platform::{
    create_platform_host, PlatformHost, PlatformPermissionKind, PlatformPermissionResponse,
    PlatformWebView, WebViewConfig,
};

static GLOBAL_FOCUS_MANAGER: std::sync::OnceLock<Arc<std::sync::Mutex<focus::FocusManager>>> =
    std::sync::OnceLock::new();

pub fn global_focus_manager() -> &'static Arc<std::sync::Mutex<focus::FocusManager>> {
    GLOBAL_FOCUS_MANAGER.get_or_init(|| Arc::new(std::sync::Mutex::new(focus::FocusManager::new())))
}

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::HashMap;
use std::env;
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicU8, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tao::{
    dpi::LogicalSize,
    event::{Event, StartCause, WindowEvent},
    event_loop::{ControlFlow, EventLoopBuilder},
    window::{Window, WindowBuilder},
};
use wry::{WebContext, WebView, WebViewBuilder};

#[cfg(target_os = "windows")]
use wry::{WebViewBuilderExtWindows, WebViewExtWindows};

use storage::Storage;
use tab::{TabId, TabManager};

#[cfg(target_os = "windows")]
mod win32_platform {
    use std::ptr;

    #[repr(C)]
    #[allow(non_snake_case)]
    struct JOBOBJECT_BASIC_LIMIT_INFORMATION {
        PerProcessUserTimeLimit: i64,
        PerJobUserTimeLimit: i64,
        LimitFlags: u32,
        MinimumWorkingSetSize: usize,
        MaximumWorkingSetSize: usize,
        ActiveProcessLimit: u32,
        Affinity: usize,
        PriorityClass: u32,
        SchedulingClass: u32,
    }

    #[repr(C)]
    #[allow(non_snake_case)]
    struct IO_COUNTERS {
        ReadOperationCount: u64,
        WriteOperationCount: u64,
        OtherOperationCount: u64,
        ReadTransferCount: u64,
        WriteTransferCount: u64,
        OtherTransferCount: u64,
    }

    #[repr(C)]
    #[allow(non_snake_case)]
    pub(super) struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION {
        BasicLimitInformation: JOBOBJECT_BASIC_LIMIT_INFORMATION,
        IoInfo: IO_COUNTERS,
        ProcessMemoryLimit: usize,
        JobMemoryLimit: usize,
        PeakProcessMemoryUsed: usize,
        PeakJobMemoryUsed: usize,
    }

    #[link(name = "user32")]
    extern "system" {
        fn OpenClipboard(hWndNewOwner: isize) -> i32;
        fn CloseClipboard() -> i32;
        fn EmptyClipboard() -> i32;
        fn GetClipboardData(uFormat: u32) -> isize;
        fn SetClipboardData(uFormat: u32, hMem: isize) -> isize;
        fn MessageBoxW(hWnd: isize, lpText: *const u16, lpCaption: *const u16, uType: u32) -> i32;
    }

    extern "system" {
        fn CreateJobObjectW(lpJobAttributes: *const u8, lpName: *const u16) -> isize;
        fn SetInformationJobObject(
            hJob: isize,
            JobObjectInformationClass: u32,
            lpJobObjectInformation: *const u8,
            cbJobObjectInformationLength: u32,
        ) -> i32;
        fn AssignProcessToJobObject(hJob: isize, hProcess: isize) -> i32;
        fn GetCurrentProcess() -> isize;
        fn CloseHandle(hObject: isize) -> i32;
        fn GlobalAlloc(uFlags: u32, dwBytes: usize) -> isize;
        fn GlobalLock(hMem: isize) -> *mut u8;
        fn GlobalUnlock(hMem: isize) -> i32;
        fn GlobalFree(hMem: isize) -> isize;
    }

    const JOB_OBJECT_EXTENDED_LIMIT_INFORMATION_CLASS: u32 = 9;
    const JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE: u32 = 0x2000;
    const JOB_OBJECT_LIMIT_BREAKAWAY_OK: u32 = 0x0800;
    const CF_UNICODETEXT: u32 = 13;
    const GMEM_MOVEABLE: u32 = 0x0002;

    /// Keeps a Windows Job Object handle alive so all child WebView2 processes
    /// spawned under this process tree terminate cleanly when the browser exits.
    pub struct JobObjectGuard(isize);

    impl Drop for JobObjectGuard {
        fn drop(&mut self) {
            if self.0 != 0 {
                unsafe {
                    CloseHandle(self.0);
                }
                self.0 = 0;
            }
        }
    }

    pub(super) fn create_kill_on_close_job() -> Option<JobObjectGuard> {
        unsafe {
            let job = CreateJobObjectW(ptr::null(), ptr::null());
            if job == 0 {
                return None;
            }
            let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
            // Keep child WebView2 processes inside this job via KILL_ON_JOB_CLOSE so they
            // stay tracked and terminate cleanly when the browser exits.
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            let ok = SetInformationJobObject(
                job,
                JOB_OBJECT_EXTENDED_LIMIT_INFORMATION_CLASS,
                (&info as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION) as *const u8,
                std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            );
            if ok == 0 {
                // Retry with BREAKAWAY_OK fallback
                info.BasicLimitInformation.LimitFlags =
                    JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE | JOB_OBJECT_LIMIT_BREAKAWAY_OK;
                let retry = SetInformationJobObject(
                    job,
                    JOB_OBJECT_EXTENDED_LIMIT_INFORMATION_CLASS,
                    (&info as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION) as *const u8,
                    std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
                );
                if retry == 0 {
                    CloseHandle(job);
                    return None;
                }
            }
            Some(JobObjectGuard(job))
        }
    }

    pub fn init_job_object() -> Option<JobObjectGuard> {
        let guard = create_kill_on_close_job()?;
        unsafe {
            let assigned = AssignProcessToJobObject(guard.0, GetCurrentProcess());
            if assigned == 0 {
                eprintln!("[job] Notice: AssignProcessToJobObject returned 0 (process may already belong to an outer non-nested job)");
            } else {
                println!("[job] Windows Job Object active (KILL_ON_JOB_CLOSE)");
            }
        }
        Some(guard)
    }

    pub fn read_clipboard_text() -> Option<String> {
        unsafe {
            if OpenClipboard(0) == 0 {
                return None;
            }
            let h = GetClipboardData(CF_UNICODETEXT);
            if h == 0 {
                CloseClipboard();
                return None;
            }
            let ptr = GlobalLock(h) as *const u16;
            let text = if !ptr.is_null() {
                let mut len = 0usize;
                while len < 16_384 && *ptr.add(len) != 0 {
                    len += 1;
                }
                let slice = std::slice::from_raw_parts(ptr, len);
                let s = String::from_utf16_lossy(slice);
                GlobalUnlock(h);
                Some(s)
            } else {
                None
            };
            CloseClipboard();
            text
        }
    }

    pub fn write_clipboard_text(text: &str) -> bool {
        unsafe {
            if OpenClipboard(0) == 0 {
                return false;
            }
            let _ = EmptyClipboard();
            let wide: Vec<u16> = text.encode_utf16().chain(std::iter::once(0)).collect();
            let byte_len = wide.len() * std::mem::size_of::<u16>();
            let hmem = GlobalAlloc(GMEM_MOVEABLE, byte_len);
            if hmem == 0 {
                CloseClipboard();
                return false;
            }
            let dst = GlobalLock(hmem) as *mut u16;
            if dst.is_null() {
                GlobalFree(hmem);
                CloseClipboard();
                return false;
            }
            ptr::copy_nonoverlapping(wide.as_ptr(), dst, wide.len());
            GlobalUnlock(hmem);
            let res = SetClipboardData(CF_UNICODETEXT, hmem);
            if res == 0 {
                GlobalFree(hmem);
                CloseClipboard();
                return false;
            }
            CloseClipboard();
            true
        }
    }

    pub fn show_error_box(message: &str, title: &str) {
        unsafe {
            let wide_msg: Vec<u16> = message.encode_utf16().chain(std::iter::once(0)).collect();
            let wide_title: Vec<u16> = title.encode_utf16().chain(std::iter::once(0)).collect();
            MessageBoxW(0, wide_msg.as_ptr(), wide_title.as_ptr(), 0x00000010 /* MB_ICONERROR */);
        }
    }
}

#[cfg(target_os = "windows")]
use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2_3;
#[cfg(target_os = "windows")]
use windows::core::Interface;
#[cfg(target_os = "windows")]
use wry::MemoryUsageLevel;

pub trait WebViewMemoryExt {
    fn suspend(&self) -> Result<()>;
    fn resume(&self) -> Result<()>;
    fn set_memory_target_low(&self) -> Result<()>;
    fn set_memory_target_normal(&self) -> Result<()>;
}

#[cfg(target_os = "windows")]
impl WebViewMemoryExt for WebView {
    fn suspend(&self) -> Result<()> {
        let wv = self.webview();
        let wv3: ICoreWebView2_3 = wv.cast().context("Failed cast to ICoreWebView2_3")?;
        unsafe {
            let handler = None::<&webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2TrySuspendCompletedHandler>;
            wv3.TrySuspend(handler).ok().context("TrySuspend failed")?;
        }
        Ok(())
    }
    fn resume(&self) -> Result<()> {
        let wv = self.webview();
        let wv3: ICoreWebView2_3 = wv.cast().context("Failed cast to ICoreWebView2_3")?;
        unsafe {
            wv3.Resume().ok().context("Resume failed")?;
        }
        Ok(())
    }
    fn set_memory_target_low(&self) -> Result<()> {
        self.set_memory_usage_level(MemoryUsageLevel::Low)
            .context("Failed to set memory usage level to Low")
    }
    fn set_memory_target_normal(&self) -> Result<()> {
        self.set_memory_usage_level(MemoryUsageLevel::Normal)
            .context("Failed to set memory usage level to Normal")
    }
}

#[cfg(not(target_os = "windows"))]
impl WebViewMemoryExt for WebView {
    fn suspend(&self) -> Result<()> { Ok(()) }
    fn resume(&self) -> Result<()> { Ok(()) }
    fn set_memory_target_low(&self) -> Result<()> { Ok(()) }
    fn set_memory_target_normal(&self) -> Result<()> { Ok(()) }
}

/// Default window size.
const DEFAULT_WIDTH: f64 = 1280.0;
const DEFAULT_HEIGHT: f64 = 800.0;

/// Default toolbar offset before first layout report from chrome webview.
const DEFAULT_TOP_BAR_HEIGHT: f64 = 76.0;

/// How often to wake up and check for inactive tabs to discard & update memory telemetry (3 seconds).
const DISCARD_CHECK_INTERVAL: Duration = Duration::from_secs(3);

/// User-facing Tab Group data.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TabGroup {
    pub id: String,
    pub name: String,
    pub color: String,
    pub collapsed: bool,
}

const WATCHDOG_STALL_THRESHOLD_MS: u64 = 500;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
enum LoopPhase {
    Idle = 0,
    IpcDispatch = 1,
    WebViewCreation = 2,
    ContentRectLayout = 3,
    WindowResize = 4,
    SplitViewHandler = 5,
}

impl LoopPhase {
    fn from_u8(v: u8) -> &'static str {
        match v {
            0 => "idle",
            1 => "ipc_dispatch",
            2 => "webview_creation",
            3 => "content_rect_layout",
            4 => "window_resize",
            5 => "split_view_handler",
            _ => "unknown",
        }
    }
}

struct WatchdogHandle {
    start: Instant,
    last_ack_ms: Arc<AtomicU64>,
    phase: Arc<AtomicU8>,
    active: Arc<AtomicBool>,
}

impl WatchdogHandle {
    fn now_ms(&self) -> u64 {
        self.start.elapsed().as_millis() as u64
    }

    fn set_phase(&self, phase: LoopPhase) {
        self.phase.store(phase as u8, Ordering::Relaxed);
    }

    fn ack(&self) {
        self.last_ack_ms.store(self.now_ms(), Ordering::Relaxed);
        self.phase.store(LoopPhase::Idle as u8, Ordering::Relaxed);
    }
}

impl Drop for WatchdogHandle {
    fn drop(&mut self) {
        self.active.store(false, Ordering::Relaxed);
    }
}

fn spawn_event_loop_watchdog(proxy: tao::event_loop::EventLoopProxy<UserEvent>) -> Arc<WatchdogHandle> {
    let start = Instant::now();
    let last_ack_ms = Arc::new(AtomicU64::new(0));
    let phase = Arc::new(AtomicU8::new(LoopPhase::Idle as u8));
    let active = Arc::new(AtomicBool::new(true));

    let handle = Arc::new(WatchdogHandle {
        start,
        last_ack_ms: Arc::clone(&last_ack_ms),
        phase: Arc::clone(&phase),
        active: Arc::clone(&active),
    });

    std::thread::spawn(move || {
        let mut last_warn_ms: u64 = 0;
        let mut was_stalled = false;
        while active.load(Ordering::Relaxed) {
            std::thread::sleep(Duration::from_millis(200));
            if !active.load(Ordering::Relaxed) {
                break;
            }
            if proxy.send_event(UserEvent::WatchdogPing).is_err() {
                break;
            }
            let elapsed_ms = start.elapsed().as_millis() as u64;
            let ack_ms = last_ack_ms.load(Ordering::Relaxed);
            let stall_ms = elapsed_ms.saturating_sub(ack_ms);
            if stall_ms >= WATCHDOG_STALL_THRESHOLD_MS {
                if !was_stalled || elapsed_ms.saturating_sub(last_warn_ms) >= 500 {
                    let cur_phase = LoopPhase::from_u8(phase.load(Ordering::Relaxed));
                    tracing::warn!(
                        stall_ms,
                        phase = cur_phase,
                        "[watchdog] UI event loop stalled over {}ms!",
                        WATCHDOG_STALL_THRESHOLD_MS
                    );
                    last_warn_ms = elapsed_ms;
                    was_stalled = true;
                }
            } else if was_stalled {
                tracing::info!(recovered_at_ms = elapsed_ms, "[watchdog] UI event loop recovered");
                was_stalled = false;
            }
        }
    });

    handle
}

#[derive(Debug, Clone, Deserialize)]
struct RectPayload {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

impl RectPayload {
    fn to_wry_rect(&self) -> wry::Rect {
        logical_rect(self.x, self.y, self.width.max(10.0), self.height.max(10.0))
    }
}

fn logical_rect(x: f64, y: f64, w: f64, h: f64) -> wry::Rect {
    wry::Rect {
        position: wry::dpi::Position::Logical(wry::dpi::LogicalPosition::new(x, y)),
        size: wry::dpi::Size::Logical(wry::dpi::LogicalSize::new(w.max(10.0), h.max(10.0))),
    }
}

fn extract_logical_rect(rect: wry::Rect) -> (f64, f64, f64, f64) {
    let (x, y) = match rect.position {
        wry::dpi::Position::Logical(p) => (p.x, p.y),
        wry::dpi::Position::Physical(p) => (p.x as f64, p.y as f64),
    };
    let (w, h) = match rect.size {
        wry::dpi::Size::Logical(s) => (s.width, s.height),
        wry::dpi::Size::Physical(s) => (s.width as f64, s.height as f64),
    };
    (x, y, w, h)
}

fn rects_approx_eq(a: wry::Rect, b: wry::Rect, eps: f64) -> bool {
    let (ax, ay, aw, ah) = extract_logical_rect(a);
    let (bx, by, bw, bh) = extract_logical_rect(b);
    (ax - bx).abs() <= eps
        && (ay - by).abs() <= eps
        && (aw - bw).abs() <= eps
        && (ah - bh).abs() <= eps
}

fn compute_split_subrects(
    outer: wry::Rect,
    ratio: f64,
    bar_height: f64,
    divider_width: f64,
) -> (wry::Rect, wry::Rect) {
    let (ox, oy, ow, oh) = extract_logical_rect(outer);
    let clamped_ratio = ratio.clamp(0.20, 0.80);
    let inner_y = oy + bar_height.max(0.0);
    let inner_h = (oh - bar_height.max(0.0)).max(24.0);
    let usable_w = (ow - divider_width.max(0.0)).max(20.0);
    let left_w = (usable_w * clamped_ratio).round().clamp(10.0, usable_w - 10.0);
    let right_w = (usable_w - left_w).max(10.0);
    let right_x = ox + left_w + divider_width.max(0.0);
    (
        logical_rect(ox, inner_y, left_w, inner_h),
        logical_rect(right_x, inner_y, right_w, inner_h),
    )
}

struct SplitState {
    enabled: bool,
    left_tab_id: Option<TabId>,
    right_tab_id: Option<TabId>,
    focused_pane: u8,
    ratio: f64,
    left_rect: Option<wry::Rect>,
    right_rect: Option<wry::Rect>,
    applied_bounds: HashMap<TabId, wry::Rect>,
    applied_visible: HashMap<TabId, bool>,
}

impl SplitState {
    fn new() -> Self {
        Self {
            enabled: false,
            left_tab_id: None,
            right_tab_id: None,
            focused_pane: 0,
            ratio: 0.5,
            left_rect: None,
            right_rect: None,
            applied_bounds: HashMap::new(),
            applied_visible: HashMap::new(),
        }
    }

    fn contains_tab(&self, tab_id: TabId) -> bool {
        self.enabled && (self.left_tab_id == Some(tab_id) || self.right_tab_id == Some(tab_id))
    }

    fn tab_for_pane(&self, pane: u8) -> Option<TabId> {
        if pane == 1 {
            self.right_tab_id
        } else {
            self.left_tab_id
        }
    }

    fn pane_for_tab(&self, tab_id: TabId) -> Option<u8> {
        if !self.enabled {
            return None;
        }
        if self.left_tab_id == Some(tab_id) {
            Some(0)
        } else if self.right_tab_id == Some(tab_id) {
            Some(1)
        } else {
            None
        }
    }
}

/// Custom user event sent from IPC handlers and worker threads to the main event loop.
#[derive(Debug)]
enum UserEvent {
    /// Watchdog heartbeat ensuring event loop responsiveness.
    WatchdogPing,
    /// Deferred Split View enable/disable/toggle dispatched safely on the UI event loop.
    ApplySplitView { enabled: Option<bool> },
    /// Content WebView received focus / pointer interaction (for Split View pane focus sync).
    TabFocused(TabId),
    /// IPC message from chrome or trusted internal webview.
    ChromeIpc(String),
    /// Title changed for a content webview.
    TitleChanged(TabId, String),
    /// URL changed in a content webview.
    UrlChanged(TabId, String),
    /// Check WebView2-reported URL after SPA history state update.
    CheckTabUrl(TabId),
    /// WebView2 `NewWindowRequested` handler request (`target="_blank"`, `window.open`).
    OpenNewWindowTab { source_tab_id: TabId, url: String },
    /// Download started (url, filename).
    DownloadStarted(String, String),
    /// Download finished (url, destination path, success).
    DownloadCompleted(String, String, bool),
    /// Real-time OS and process tree telemetry snapshot.
    Telemetry(telemetry::TelemetrySnapshot),
    /// Live weather lookup completed in worker thread.
    WeatherFetched(Result<weather::WeatherData, String>),
    /// Navigate a content webview to a specific URL (used by Focus Mode and Interstitial).
    NavigateTab(TabId, String),
    /// 1-second timer tick for Focus Mode sessions.
    FocusTick,
    /// Toggle Focus Mode session (Study / Inactive).
    ToggleFocus,
    /// Push current Focus Mode state to a specific content webview.
    SyncFocusToTab(TabId),
}

/// Strongly-typed IPC command matching `ui/IPC_CONTRACT.md`.
#[allow(dead_code)]
#[derive(Debug, Deserialize)]
#[serde(tag = "action")]
enum UiMessage {
    #[serde(rename = "ui_ready")]
    UiReady { role: Option<String> },

    #[serde(rename = "new_tab")]
    NewTab {
        url: Option<String>,
        background: Option<bool>,
        title: Option<String>,
    },

    #[serde(rename = "paste_new_tab")]
    PasteNewTab,

    #[serde(rename = "open_history_entry_in_new_tab")]
    OpenHistoryEntryInNewTab {
        direction: String,
        background: Option<bool>,
    },

    #[serde(rename = "switch_tab")]
    SwitchTab { tab_id: TabId },

    #[serde(rename = "close_tab")]
    CloseTab { tab_id: Option<TabId> },

    #[serde(rename = "close_current_tab")]
    CloseCurrentTab,

    #[serde(rename = "reorder_tabs")]
    ReorderTabs {
        from_id: TabId,
        to_id: TabId,
        position: String,
    },

    #[serde(rename = "pin_tab")]
    PinTab { tab_id: TabId, pinned: bool },

    #[serde(rename = "mute_tab")]
    MuteTab { tab_id: TabId, muted: bool },

    #[serde(rename = "duplicate_tab")]
    DuplicateTab {
        tab_id: TabId,
        background: Option<bool>,
    },

    #[serde(rename = "close_other_tabs")]
    CloseOtherTabs { tab_id: TabId },

    #[serde(rename = "close_tabs_below")]
    CloseTabsBelow { tab_id: TabId },

    #[serde(rename = "create_group")]
    CreateGroup {
        name: String,
        color: Option<String>,
        tab_id: Option<TabId>,
    },

    #[serde(rename = "set_tab_group")]
    SetTabGroup {
        tab_id: TabId,
        group_id: Option<String>,
    },

    #[serde(rename = "toggle_group_collapse")]
    ToggleGroupCollapse { group_id: String },

    #[serde(rename = "navigate")]
    Navigate { url: String },

    #[serde(rename = "back")]
    Back,

    #[serde(rename = "forward")]
    Forward,

    #[serde(rename = "reload")]
    Reload,

    #[serde(rename = "stop")]
    Stop,

    #[serde(rename = "sleep_tab")]
    SleepTab { tab_id: TabId },

    #[serde(rename = "wake_tab")]
    WakeTab { tab_id: TabId },

    #[serde(rename = "toggle_bookmark")]
    ToggleBookmark { url: Option<String> },

    #[serde(rename = "content_rect")]
    ContentRect {
        x: f64,
        y: f64,
        width: f64,
        height: f64,
        left: Option<RectPayload>,
        right: Option<RectPayload>,
        ratio: Option<f64>,
    },

    #[serde(rename = "overlay")]
    Overlay { open: bool },

    #[serde(rename = "set_setting")]
    SetSetting {
        key: String,
        value: serde_json::Value,
    },

    #[serde(rename = "save_settings")]
    SaveSettings { settings: serde_json::Value },

    #[serde(rename = "fetch_weather")]
    FetchWeather {
        location: Option<String>,
        lat: Option<f64>,
        lon: Option<f64>,
        label: Option<String>,
        country: Option<String>,
        force: Option<bool>,
    },

    #[serde(rename = "open_settings")]
    OpenSettings,

    #[serde(rename = "open_command_palette")]
    OpenCommandPalette,

    #[serde(rename = "open_side_panel")]
    OpenSidePanel { panel: String },

    #[serde(rename = "open_find_bar")]
    OpenFindBar,

    #[serde(rename = "focus_omnibox")]
    FocusOmnibox,

    #[serde(rename = "copy_to_clipboard")]
    CopyToClipboard { text: String },

    #[serde(rename = "zoom")]
    Zoom { level: f64 },

    #[serde(rename = "zoom_in")]
    ZoomIn,

    #[serde(rename = "zoom_out")]
    ZoomOut,

    #[serde(rename = "zoom_reset")]
    ZoomReset,

    #[serde(rename = "find_in_page")]
    FindInPage {
        query: String,
        forward: Option<bool>,
        match_case: Option<bool>,
    },

    #[serde(rename = "find_close")]
    FindClose,

    #[serde(rename = "clear_browsing_data")]
    ClearBrowsingData {
        history: Option<bool>,
        cache: Option<bool>,
    },

    #[serde(rename = "new_window")]
    NewWindow { incognito: Option<bool> },

    #[serde(rename = "split_view")]
    SplitView { enabled: Option<bool> },

    #[serde(rename = "split_close")]
    SplitClose,

    #[serde(rename = "split_swap")]
    SplitSwap,

    #[serde(rename = "split_focus")]
    SplitFocus { pane: u8 },

    #[serde(rename = "split_navigate")]
    SplitNavigate { pane: u8, url: String },

    #[serde(rename = "toggle_reader")]
    ToggleReader { active: Option<bool> },

    #[serde(rename = "save_scroll")]
    SaveScroll { scroll_y: Option<f64> },

    #[serde(rename = "next_tab")]
    NextTab,

    #[serde(rename = "prev_tab")]
    PrevTab,

    #[serde(rename = "discard_background_tabs")]
    DiscardBackgroundTabs,

    #[serde(rename = "open_private_window")]
    OpenPrivateWindow,

    #[serde(rename = "clear_history")]
    ClearHistory,

    #[serde(rename = "clear_bookmarks")]
    ClearBookmarks,

    #[serde(rename = "clear_downloads")]
    ClearDownloads,

    #[serde(rename = "switch_workspace")]
    SwitchWorkspace { workspace_id: String },

    #[serde(rename = "create_workspace")]
    CreateWorkspace {
        name: String,
        icon: Option<String>,
        color: Option<String>,
        is_isolated: Option<bool>,
    },

    #[serde(rename = "rename_workspace")]
    RenameWorkspace {
        workspace_id: String,
        name: String,
    },

    #[serde(rename = "delete_workspace")]
    DeleteWorkspace { workspace_id: String },

    #[serde(rename = "undo_delete_workspace")]
    UndoDeleteWorkspace,

    #[serde(rename = "reorder_workspaces")]
    ReorderWorkspaces { workspace_ids: Vec<String> },

    #[serde(rename = "move_tab_to_workspace")]
    MoveTabToWorkspace {
        tab_id: TabId,
        target_workspace_id: String,
    },

    #[serde(rename = "restore_recently_closed_tab")]
    RestoreRecentlyClosedTab { workspace_id: Option<String> },

    #[serde(rename = "toggle_focus")]
    ToggleFocus,

    #[serde(rename = "start_focus")]
    StartFocus {
        mode: String,
        duration_secs: Option<u64>,
    },

    #[serde(rename = "pause_focus")]
    PauseFocus,

    #[serde(rename = "resume_focus")]
    ResumeFocus,

    #[serde(rename = "stop_focus")]
    StopFocus,

    #[serde(rename = "get_focus_state")]
    GetFocusState,

    #[serde(rename = "get_workspaces")]
    GetWorkspaces,

    #[serde(rename = "get_settings")]
    GetSettings,

    #[serde(rename = "bypass_focus_domain")]
    BypassFocusDomain {
        domain: String,
        confirmation: String,
    },

    #[serde(rename = "launch_local_app")]
    LaunchLocalApp { app: String },

    #[serde(rename = "get_mini_widget_stat")]
    GetMiniWidgetStat { widget: String },

    #[serde(rename = "load_unpacked_extension")]
    LoadUnpackedExtension { path: String },

    #[serde(rename = "toggle_extension")]
    ToggleExtension { id: String, enabled: bool },

    #[serde(rename = "remove_extension")]
    RemoveExtension { id: String },

    #[serde(rename = "inspect_extension")]
    InspectExtension { path: String },

    #[serde(rename = "save_userscript")]
    SaveUserScript { script: storage::UserScript },

    #[serde(rename = "toggle_userscript")]
    ToggleUserScript { id: String, enabled: bool },

    #[serde(rename = "delete_userscript")]
    DeleteUserScript { id: String },

    #[serde(rename = "get_extensions_and_scripts")]
    GetExtensionsAndScripts,

    #[serde(other)]
    Unknown,
}

/// Injected into content webviews to capture keyboard shortcuts,
/// middle/Ctrl/Shift link clicks (while keeping WebView2 native autoscroll on non-links),
/// and SPA history state changes.
const CONTENT_INIT_SCRIPT: &str = r#"
(() => {
  const isInternal = location.hostname === 'rusty.app' || location.protocol === 'rusty:';
  const IS_TOP = window === window.top;
  const FRAME_TOKEN = "__RUSTY_FRAME_TOKEN__";

  function postRawIpc(msg) {
      if (typeof msg !== 'string') return;
      try {
          if (IS_TOP) {
              if (window.ipc && typeof window.ipc.postMessage === 'function') {
                  window.ipc.postMessage(msg);
              }
              return;
          }
          try {
              if (window.top && window.top.ipc && typeof window.top.ipc.postMessage === 'function') {
                  window.top.ipc.postMessage(msg);
                  return;
              }
          } catch (_) {}
          if (window.top && typeof window.top.postMessage === 'function') {
              window.top.postMessage({ __rustyFrameIpc: msg, token: FRAME_TOKEN }, '*');
          }
      } catch (_) {}
  }

  if (!isInternal && IS_TOP) {
      const ALLOWED_RELAY_ACTIONS = new Set([
          'tab_focus_ping',
          'tab_url_ping',
          'new_tab',
          'close_current_tab',
          'back',
          'forward',
          'reload',
          'next_tab',
          'prev_tab',
          'stop',
          'focus_omnibox',
          'zoom_in',
          'zoom_out',
          'zoom_reset',
          'open_command_palette',
          'open_find_bar',
          'open_settings',
          'open_side_panel',
          'split_view',
          'toggle_focus',
          'start_focus',
          'stop_focus',
          'get_focus_state'
      ]);
      window.addEventListener('message', (e) => {
          const data = e && e.data;
          if (!data || typeof data !== 'object') return;
          if (e.source === window || data.token !== FRAME_TOKEN) return;
          if (typeof data.__rustyFrameIpc !== 'string') return;
          try {
              const parsed = JSON.parse(data.__rustyFrameIpc);
              if (!parsed || typeof parsed !== 'object' || typeof parsed.action !== 'string') return;
              if (!ALLOWED_RELAY_ACTIONS.has(parsed.action)) return;
              const sanitized = { action: parsed.action };
              if (parsed.action === 'new_tab') {
                  if (parsed.url !== undefined && parsed.url !== null) {
                      if (typeof parsed.url !== 'string' || (!parsed.url.startsWith('http://') && !parsed.url.startsWith('https://'))) {
                          return;
                      }
                      sanitized.url = parsed.url;
                  }
                  if (typeof parsed.background === 'boolean' || parsed.background === null) {
                      sanitized.background = parsed.background;
                  }
                  if (typeof parsed.title === 'string') {
                      sanitized.title = parsed.title.slice(0, 120);
                  }
              } else if (parsed.action === 'open_side_panel') {
                  if (parsed.panel !== 'bookmarks' && parsed.panel !== 'history' && parsed.panel !== 'downloads') {
                      return;
                  }
                  sanitized.panel = parsed.panel;
              }
              if (window.ipc && typeof window.ipc.postMessage === 'function') {
                  window.ipc.postMessage(JSON.stringify(sanitized));
              }
          } catch (_) {}
      }, true);
  }

  window.addEventListener('keydown', (e) => {
      const ctrl = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (ctrl && key === 't') {
          e.preventDefault();
          postRawIpc(JSON.stringify({ action: 'new_tab' }));
      } else if (ctrl && key === 'w') {
          e.preventDefault();
          postRawIpc(JSON.stringify({ action: 'close_current_tab' }));
      } else if ((ctrl && key === 'r') || e.key === 'F5') {
          e.preventDefault();
          postRawIpc(JSON.stringify({ action: 'reload' }));
      } else if (e.altKey && e.key === 'ArrowLeft') {
          e.preventDefault();
          postRawIpc(JSON.stringify({ action: 'back' }));
      } else if (e.altKey && e.key === 'ArrowRight') {
          e.preventDefault();
          postRawIpc(JSON.stringify({ action: 'forward' }));
      } else if (ctrl && key === 'l') {
          e.preventDefault();
          postRawIpc(JSON.stringify({ action: 'focus_omnibox' }));
      } else if (ctrl && (e.key === '=' || e.key === '+')) {
          e.preventDefault();
          postRawIpc(JSON.stringify({ action: 'zoom_in' }));
      } else if (ctrl && e.key === '-') {
          e.preventDefault();
          postRawIpc(JSON.stringify({ action: 'zoom_out' }));
      } else if (ctrl && e.key === '0') {
          e.preventDefault();
          postRawIpc(JSON.stringify({ action: 'zoom_reset' }));
      } else if (ctrl && key === 'k') {
          e.preventDefault();
          postRawIpc(JSON.stringify({ action: 'open_command_palette' }));
      } else if (ctrl && key === 'f') {
          e.preventDefault();
          postRawIpc(JSON.stringify({ action: 'open_find_bar' }));
      } else if (ctrl && e.key === ',') {
          e.preventDefault();
          postRawIpc(JSON.stringify({ action: 'open_settings' }));
      } else if (ctrl && key === 'h') {
          e.preventDefault();
          postRawIpc(JSON.stringify({ action: 'open_side_panel', panel: 'history' }));
      } else if (ctrl && key === 'j') {
          e.preventDefault();
          postRawIpc(JSON.stringify({ action: 'open_side_panel', panel: 'downloads' }));
      } else if (ctrl && e.key === '\\') {
          e.preventDefault();
          postRawIpc(JSON.stringify({ action: 'split_view' }));
      } else if (ctrl && e.shiftKey && key === 'n') {
          e.preventDefault();
          postRawIpc(JSON.stringify({ action: 'open_private_window' }));
      } else if (ctrl && e.key === 'Tab') {
          e.preventDefault();
          postRawIpc(JSON.stringify({ action: e.shiftKey ? 'prev_tab' : 'next_tab' }));
      } else if (ctrl && e.altKey && (key === 'f' || e.code === 'KeyF')) {
          e.preventDefault();
          postRawIpc(JSON.stringify({ action: 'toggle_focus' }));
      } else if (e.key === 'Escape') {
          postRawIpc(JSON.stringify({ action: 'stop' }));
      }
  });

  const pingFocus = () => postRawIpc(JSON.stringify({ action: 'tab_focus_ping' }));
  window.addEventListener('pointerdown', pingFocus, true);
  window.addEventListener('focus', pingFocus, true);

  if (!isInternal) {
      function findNavigableAnchor(target) {
          if (!target || typeof target.closest !== 'function') return null;
          const a = target.closest('a[href]');
          if (!a) return null;
          const raw = (a.getAttribute('href') || '').trim();
          if (!raw || raw.startsWith('#') || raw.toLowerCase().startsWith('javascript:')) return null;
          const href = a.href;
          if (!href || (!href.startsWith('http://') && !href.startsWith('https://'))) return null;
          return a;
      }

      // Suppress middle-click autoscroll ONLY on actual links; keep WebView2 native autoscroll everywhere else
      window.addEventListener('mousedown', (e) => {
          if (e.button === 1 && findNavigableAnchor(e.target)) {
              e.preventDefault();
          }
      }, true);

      window.addEventListener('auxclick', (e) => {
          if (e.button !== 1) return;
          const a = findNavigableAnchor(e.target);
          if (!a) return;
          e.preventDefault();
          e.stopPropagation();
          const title = (a.innerText || a.title || '').trim().slice(0, 120);
          postRawIpc(JSON.stringify({
              action: 'new_tab',
              url: a.href,
              background: e.shiftKey ? false : null,
              title: title || null
          }));
      }, true);

      window.addEventListener('click', (e) => {
          if (e.button !== 0) return;
          const ctrl = e.ctrlKey || e.metaKey;
          if (!ctrl && !e.shiftKey) return;
          const a = findNavigableAnchor(e.target);
          if (!a) return;
          e.preventDefault();
          e.stopPropagation();
          const forceForeground = e.shiftKey; // Ctrl+Shift+click or Shift+click -> foreground
          const title = (a.innerText || a.title || '').trim().slice(0, 120);
          postRawIpc(JSON.stringify({
              action: 'new_tab',
              url: a.href,
              background: forceForeground ? false : null,
              title: title || null
          }));
      }, true);

      if (IS_TOP) {
          const isFocusOnNow = () => Boolean(
              window.__RUSTY_FOCUS_STATE__
              && window.__RUSTY_FOCUS_STATE__.is_active
              && !window.__RUSTY_FOCUS_STATE__.is_paused
          );
          const checkShorts = () => {
              if (isFocusOnNow() && location.hostname.includes('youtube.com') && location.pathname.startsWith('/shorts/')) {
                  const id = location.pathname.replace('/shorts/', '').split('/')[0].split('?')[0];
                  if (id) {
                      location.replace('https://www.youtube.com/watch?v=' + id);
                  }
              }
          };

          // YouTube Shorts Restrictor: auto-redirect /shorts/:id to standard watch and hide shorts shelves when Focus Mode is on
          if (location.hostname.includes('youtube.com')) {
              postRawIpc(JSON.stringify({ action: 'get_focus_state' }));
              if (isFocusOnNow()) {
                  try {
                      const s = document.createElement('style');
                      s.id = 'rusty-early-shorts-hide';
                      s.textContent = [
                          'ytd-rich-shelf-renderer[is-shorts],ytd-reel-shelf-renderer,ytm-shorts-lockup-view-model,ytm-shorts-lockup-view-model-v2,#shorts-container,ytd-reel-video-renderer,a#endpoint[title="Shorts"],a[title="Shorts"],ytd-guide-entry-renderer a[title="Shorts"],ytd-guide-entry-renderer a[href*="/shorts"],ytd-mini-guide-entry-renderer[aria-label="Shorts"],ytd-mini-guide-entry-renderer a[href*="/shorts"],[data-rusty-shorts="true"]{display:none!important;}',
                          'ytd-rich-section-renderer:has(ytd-reel-shelf-renderer){display:none!important;}',
                          'ytd-rich-section-renderer:has(a[href*="/shorts"]){display:none!important;}',
                          'grid-shelf-view-model:has(a[href*="/shorts"]){display:none!important;}',
                          'ytd-rich-item-renderer:has(a[href*="/shorts"]){display:none!important;}',
                          'ytd-video-renderer:has(a[href*="/shorts"]){display:none!important;}',
                          'ytd-grid-video-renderer:has(a[href*="/shorts"]){display:none!important;}',
                          'ytd-compact-video-renderer:has(a[href*="/shorts"]){display:none!important;}',
                          'yt-lockup-view-model:has(a[href*="/shorts"]){display:none!important;}'
                      ].join('\n');
                      (document.head || document.documentElement).appendChild(s);
                  } catch (_) {}
              }
              checkShorts();
          }

          // Notify Rust to re-read verified WebView2 URL after SPA pushState/popstate updates
          const pingUrl = () => postRawIpc(JSON.stringify({ action: 'tab_url_ping' }));
          const origPush = history.pushState;
          const origReplace = history.replaceState;
          history.pushState = function () {
              const r = origPush.apply(this, arguments);
              checkShorts();
              setTimeout(pingUrl, 0);
              return r;
          };
          history.replaceState = function () {
              const r = origReplace.apply(this, arguments);
              checkShorts();
              setTimeout(pingUrl, 0);
              return r;
          };
          window.addEventListener('popstate', () => {
              checkShorts();
              pingUrl();
          });
          window.addEventListener('hashchange', pingUrl);
      }
  }
})();
"#;

fn generate_frame_token(tab_id: TabId) -> String {
    use std::collections::hash_map::RandomState;
    use std::hash::{BuildHasher, Hasher};

    static FRAME_TOKEN_SEQ: AtomicU64 = AtomicU64::new(1);
    let seq = FRAME_TOKEN_SEQ.fetch_add(1, Ordering::Relaxed);
    let now = Instant::now();

    let mut h1 = RandomState::new().build_hasher();
    h1.write_u32(tab_id);
    h1.write_u64(seq);
    h1.write_usize(std::ptr::addr_of!(seq) as usize);

    let mut h2 = RandomState::new().build_hasher();
    h2.write_u64(seq.wrapping_mul(0x9E37_79B9_7F4A_7C15));
    h2.write_u128(now.elapsed().as_nanos());

    format!("{:016x}{:016x}", h1.finish(), h2.finish())
}

/// Return optional `RUSTY_DISCARD_SECS` environment override.
fn get_discard_timeout_override() -> Option<Duration> {
    if let Ok(val) = env::var("RUSTY_DISCARD_SECS") {
        if let Ok(secs) = val.parse::<u64>() {
            return Some(Duration::from_secs(secs));
        }
    }
    None
}

/// Compute effective background tab discard timeout from settings or env override.
fn effective_discard_timeout(
    settings: &storage::Settings,
    override_timeout: Option<Duration>,
) -> Option<Duration> {
    if let Some(d) = override_timeout {
        return if d.is_zero() { None } else { Some(d) };
    }
    if settings.discard_timeout_secs == 0 {
        None
    } else {
        Some(Duration::from_secs(settings.discard_timeout_secs))
    }
}

/// Check whether a tab URL represents the internal New Tab page.
fn is_newtab_url(url: &str) -> bool {
    url == "about:blank"
        || url == "about:newtab"
        || (is_trusted_origin(url) && url.contains("newtab.html"))
}

/// Append active skin/theme/layout query parameters for internal chrome and newtab pages.
fn append_skin_theme_query(base: &str, settings: &storage::Settings) -> String {
    let skin = match settings.skin.as_str() {
        "minimal" => "minimal",
        "mayank" => "mayank",
        _ => "crazy",
    };
    let theme = percent_encoding::utf8_percent_encode(
        &settings.theme,
        percent_encoding::NON_ALPHANUMERIC,
    );
    let tabs = if settings.tabs_layout == "vertical" {
        "vertical"
    } else {
        "horizontal"
    };
    let palette = percent_encoding::utf8_percent_encode(
        &settings.accent_palette,
        percent_encoding::NON_ALPHANUMERIC,
    );
    let sep = if base.contains('?') { '&' } else { '?' };
    format!("{base}{sep}skin={skin}&theme={theme}&tabs={tabs}&palette={palette}")
}

/// Resolve virtual URLs and inject current skin/theme/layout params for internal UI pages.
fn resolve_content_url_with_settings(url: &str, settings: &storage::Settings) -> String {
    let resolved = resolve_content_url(url);
    if is_trusted_origin(&resolved)
        && (resolved.contains("index.html") || resolved.contains("newtab.html"))
    {
        append_skin_theme_query(&resolved, settings)
    } else {
        resolved
    }
}

fn eval_on_webview(wv: &WebView, msg: &serde_json::Value) {
    let js = format!("if (window.__onRustMessage) {{ window.__onRustMessage({msg}); }}");
    if let Err(err) = wv.evaluate_script(&js) {
        tracing::debug!(error = %err, "[ipc] eval_on_webview evaluation error");
    }
}

fn broadcast_to_newtab_views(
    tabs: &TabManager,
    content_webviews: &HashMap<TabId, WebView>,
    msg: &serde_json::Value,
) {
    for (tab_id, wv) in content_webviews {
        if let Some(tab) = tabs.get(*tab_id) {
            if is_newtab_url(&tab.url) {
                eval_on_webview(wv, msg);
            }
        }
    }
}

fn broadcast_to_internal_views(
    chrome_wv: &WebView,
    tabs: &TabManager,
    content_webviews: &HashMap<TabId, WebView>,
    msg: &serde_json::Value,
) {
    eval_on_webview(chrome_wv, msg);
    broadcast_to_newtab_views(tabs, content_webviews, msg);
}

fn broadcast_focus_state_to_all(
    chrome_wv: &WebView,
    tabs: &TabManager,
    content_webviews: &HashMap<TabId, WebView>,
    msg: &serde_json::Value,
) {
    broadcast_to_internal_views(chrome_wv, tabs, content_webviews, msg);
    let js = format!("if (window.__rustyOnFocusState) {{ window.__rustyOnFocusState({msg}); }}");
    for wv in content_webviews.values() {
        let _ = wv.evaluate_script(&js);
    }
}

fn enforce_focus_on_open_tabs(tabs: &TabManager, content_webviews: &HashMap<TabId, WebView>) {
    let mut actions: Vec<(TabId, String)> = Vec::new();
    if let Ok(fm) = global_focus_manager().lock() {
        if !fm.state().is_active || fm.state().is_paused {
            return;
        }
        for (tab_id, wv) in content_webviews {
            let candidate_url = wv
                .url()
                .ok()
                .filter(|u| !u.is_empty())
                .or_else(|| tabs.get(*tab_id).map(|t| t.url.clone()))
                .unwrap_or_default();
            if candidate_url.is_empty() || is_trusted_origin(&candidate_url) || candidate_url.starts_with("about:") {
                continue;
            }
            match fm.check_url(&candidate_url) {
                focus::FocusDecision::Blocked { mode, domain: _, url: dest_url, remaining_secs } => {
                    let interstitial_url = format!(
                        "rusty://app/interstitial.html?url={}&mode={}&remaining={}",
                        percent_encoding::percent_encode(dest_url.as_bytes(), percent_encoding::NON_ALPHANUMERIC),
                        percent_encoding::percent_encode(mode.as_bytes(), percent_encoding::NON_ALPHANUMERIC),
                        remaining_secs
                    );
                    actions.push((*tab_id, interstitial_url));
                }
                focus::FocusDecision::Redirect(redirect_url) => {
                    actions.push((*tab_id, redirect_url));
                }
                focus::FocusDecision::Allowed => {}
            }
        }
    }
    for (tab_id, target_url) in actions {
        if let Some(wv) = content_webviews.get(&tab_id) {
            let _ = wv.load_url(&target_url);
        }
    }
}

fn emit_pet_event(
    chrome_wv: &WebView,
    tabs: &TabManager,
    content_webviews: &HashMap<TabId, WebView>,
    storage: &mut Storage,
    event: &str,
) {
    if storage.settings().skin != "crazy" {
        return;
    }
    let msg = json!({
        "type": "pet_event",
        "event": event,
    });
    broadcast_to_internal_views(chrome_wv, tabs, content_webviews, &msg);
}

fn build_memory_payload(bd: &telemetry::BrowserMemoryBreakdown, tab_count: usize) -> serde_json::Value {
    let chrome_baseline = if bd.chrome_live_measured && bd.chrome_live_private_ws_mb > 0.5 {
        bd.chrome_live_private_ws_mb
    } else {
        // Private Working Set baseline when Chrome is not running (~125 MB base + ~45 MB/tab Private WS)
        125.0 + (tab_count.max(1) as f64 * 45.0)
    };
    let savings = if chrome_baseline > 0.5 {
        ((chrome_baseline - bd.total_private_ws_mb) / chrome_baseline * 100.0).clamp(-99.0, 99.0)
    } else {
        0.0
    };
    json!({
        "type": "memory_stats",
        "metric": "private_working_set",
        "total_mb": (bd.total_private_ws_mb * 10.0).round() / 10.0,
        "private_ws_mb": (bd.total_private_ws_mb * 10.0).round() / 10.0,
        "working_set_mb": (bd.total_working_set_mb * 10.0).round() / 10.0,
        "commit_mb": (bd.total_commit_mb * 10.0).round() / 10.0,
        "host_private_ws_mb": (bd.host_private_ws_mb * 10.0).round() / 10.0,
        "process_count": bd.process_count,
        "processes": bd.processes,
        "chrome_baseline_mb": (chrome_baseline * 10.0).round() / 10.0,
        "chrome_live_measured": bd.chrome_live_measured,
        "chrome_process_count": bd.chrome_process_count,
        "savings_percent": (savings * 10.0).round() / 10.0,
    })
}

fn build_telemetry_payload(snap: &telemetry::TelemetrySnapshot) -> serde_json::Value {
    json!({
        "type": "telemetry_stats",
        "sys_cpu_percent": snap.sys_cpu_percent,
        "sys_ram_percent": snap.sys_ram_percent,
        "sys_ram_used_gb": snap.sys_ram_used_gb,
        "sys_ram_total_gb": snap.sys_ram_total_gb,
        "sys_gpu_percent": snap.sys_gpu_percent,
        "net_kbps": snap.net_kbps,
        "browser_mb": snap.browser_mb,
        "browser_working_set_mb": snap.browser_working_set_mb,
        "browser_commit_mb": snap.browser_commit_mb,
    })
}

fn build_weather_payload(w: &weather::WeatherData) -> serde_json::Value {
    let mut val = serde_json::to_value(w).unwrap_or_else(|_| json!({}));
    if let Some(obj) = val.as_object_mut() {
        obj.insert("type".to_owned(), json!("weather_update"));
    }
    val
}

fn spawn_weather_fetch(
    proxy: tao::event_loop::EventLoopProxy<UserEvent>,
    req: weather::WeatherRequest,
    force: bool,
    cache_dir: std::path::PathBuf,
) {
    std::thread::spawn(move || {
        let res = weather::fetch_weather_cached(req, force, Some(&cache_dir));
        let _ = proxy.send_event(UserEvent::WeatherFetched(res));
    });
}

/// Validate whether an origin URI corresponds to trusted internal browser chrome/pages.
/// Handles both raw custom protocol `rusty://app/...` and WebView2-mapped `http(s)://rusty.app/...`.
pub fn is_trusted_origin(uri: &str) -> bool {
    if let Some(rest) = uri.strip_prefix("rusty://") {
        return rest.starts_with("app") || rest.starts_with('/');
    }
    if let Some(rest) = uri.strip_prefix("http://rusty.app") {
        return rest.is_empty() || rest.starts_with('/') || rest.starts_with('?');
    }
    if let Some(rest) = uri.strip_prefix("https://rusty.app") {
        return rest.is_empty() || rest.starts_with('/') || rest.starts_with('?');
    }
    uri.starts_with("data:text/html")
}

/// Validate whether an external URL requested by content JS / popups is a safe web URL.
fn is_safe_web_url(url: &str) -> bool {
    url.starts_with("http://") || url.starts_with("https://")
}

/// Resolve internal virtual URLs to their canonical custom-protocol destination.
/// On Windows, maps `rusty://` custom schemes to `http://rusty.*` so WebView2 can navigate properly.
pub fn resolve_content_url(url: &str) -> String {
    #[cfg(target_os = "windows")]
    match url {
        "about:blank" | "about:newtab" => "http://rusty.app/newtab.html".to_owned(),
        other if other.starts_with("rusty://") => {
            let rest = other.trim_start_matches("rusty://");
            format!("http://rusty.{rest}")
        }
        other => other.to_owned(),
    }
    #[cfg(not(target_os = "windows"))]
    match url {
        "about:blank" | "about:newtab" => "rusty://app/newtab.html".to_owned(),
        other => other.to_owned(),
    }
}

/// Parameters for constructing a content webview.
struct ContentWebViewParams<'a> {
    window: &'a Window,
    shared_webview: Option<&'a WebView>,
    url: &'a str,
    tab_id: TabId,
    proxy: tao::event_loop::EventLoopProxy<UserEvent>,
    content_rect: wry::Rect,
    scroll_y: f64,
    zoom_level: f64,
    is_incognito: bool,
    block_camera: bool,
    block_microphone: bool,
    block_geolocation: bool,
    userscripts: &'a [storage::UserScript],
    is_vault: bool,
}

/// Build a content webview for a tab positioned dynamically at `content_rect`.
fn build_content_webview(params: ContentWebViewParams<'_>) -> Result<WebView> {
    let ContentWebViewParams {
        window,
        shared_webview,
        url,
        tab_id,
        proxy,
        content_rect,
        scroll_y,
        zoom_level,
        is_incognito,
        block_camera,
        block_microphone,
        block_geolocation,
        userscripts,
        is_vault,
    } = params;

    let title_proxy = proxy.clone();
    let url_proxy = proxy.clone();
    let nw_proxy = proxy.clone();
    let dl_start_proxy = proxy.clone();
    let dl_done_proxy = proxy.clone();
    let dl_dir = Storage::resolve_downloads_dir();
    let nav_trusted = Arc::new(AtomicBool::new(is_trusted_origin(url)));
    let perm_trusted = Arc::clone(&nav_trusted);

    let scroll_restore = if scroll_y > 0.0 {
        format!(
            "window.addEventListener('load', () => {{ setTimeout(() => window.scrollTo(0, {scroll_y}), 80); }});\n"
        )
    } else {
        String::new()
    };
    let frame_token = generate_frame_token(tab_id);
    let init_core = CONTENT_INIT_SCRIPT.replace("__RUSTY_FRAME_TOKEN__", &frame_token);
    let focus_state_json = if let Ok(fm) = global_focus_manager().lock() {
        serde_json::to_string(&fm.state()).unwrap_or_else(|_| "{}".to_string())
    } else {
        "{}".to_string()
    };
    let focus_init = format!("window.__RUSTY_FOCUS_STATE__ = {focus_state_json};\n");
    let yt_focus_js = ui::app_protocol::get_youtube_focus_script();
    let userscripts_js = extensions::build_userscripts_injection_js(userscripts, is_vault);
    let combined_script = format!("{focus_init}\n{init_core}\n{yt_focus_js}\n{scroll_restore}\n{userscripts_js}");

    #[cfg(not(target_os = "windows"))]
    let _ = shared_webview;

    let mut builder = WebViewBuilder::new()
        .with_bounds(content_rect)
        .with_custom_protocol("rusty".into(), ui::app_protocol::handle_rusty_request)
        .with_url(url)
        .with_incognito(is_incognito)
        .with_devtools(cfg!(debug_assertions))
        .with_initialization_script(&combined_script)
        .with_ipc_handler(move |req| {
            let uri = req.uri().to_string();
            let body = req.body().to_string();
            if let Ok(val) = serde_json::from_str::<serde_json::Value>(&body) {
                if let Some(action) = val.get("action").and_then(|a| a.as_str()) {
                    if action == "tab_focus_ping" {
                        let _ = proxy.send_event(UserEvent::TabFocused(tab_id));
                        return;
                    }
                    if action == "tab_url_ping" {
                        let _ = proxy.send_event(UserEvent::CheckTabUrl(tab_id));
                        return;
                    }
                    if action == "toggle_focus" {
                        let _ = proxy.send_event(UserEvent::ToggleFocus);
                        return;
                    }
                }
            }
            if is_trusted_origin(&uri) {
                // Trusted internal page (e.g. newtab.html) - full IPC access
                let _ = proxy.send_event(UserEvent::ChromeIpc(body));
            } else {
                // Untrusted external web page: whitelist safe accelerator keys, link clicks & read-only focus sync only
                if let Ok(val) = serde_json::from_str::<serde_json::Value>(&body) {
                    if let Some(action) = val.get("action").and_then(|a| a.as_str()) {
                        if action == "get_focus_state" {
                            let _ = proxy.send_event(UserEvent::SyncFocusToTab(tab_id));
                            return;
                        }
                        if action == "new_tab" {
                            let requested_url = val
                                .get("url")
                                .and_then(|u| u.as_str())
                                .filter(|u| is_safe_web_url(u))
                                .map(|u| u.to_owned());
                            let bg = val.get("background").and_then(|b| b.as_bool());
                            let title = val
                                .get("title")
                                .and_then(|t| t.as_str())
                                .map(|s| s.chars().take(120).collect::<String>());
                            // Only accept URL if missing (Ctrl+T) OR valid http(s) link
                            if val.get("url").is_none() || requested_url.is_some() {
                                let sanitized = json!({
                                    "action": "new_tab",
                                    "url": requested_url,
                                    "background": bg,
                                    "title": title,
                                })
                                .to_string();
                                let _ = proxy.send_event(UserEvent::ChromeIpc(sanitized));
                                return;
                            }
                        }
                        let allowed_panel = action == "open_side_panel"
                            && matches!(
                                val.get("panel").and_then(|p| p.as_str()),
                                Some("bookmarks" | "history" | "downloads")
                            );
                        if allowed_panel
                            || matches!(
                                action,
                                "close_current_tab"
                                    | "back"
                                    | "forward"
                                    | "reload"
                                    | "next_tab"
                                    | "prev_tab"
                                    | "stop"
                                    | "focus_omnibox"
                                    | "zoom_in"
                                    | "zoom_out"
                                    | "zoom_reset"
                                    | "open_command_palette"
                                    | "open_find_bar"
                                    | "open_settings"
                                    | "split_view"
                                    | "toggle_focus"
                                    | "start_focus"
                                    | "stop_focus"
                            )
                        {
                            let _ = proxy.send_event(UserEvent::ChromeIpc(body));
                            return;
                        }
                    }
                }
                eprintln!("[security] Discarded untrusted IPC message from web page: {uri}");
            }
        })
        .with_new_window_req_handler(move |uri, _features| {
            if is_safe_web_url(&uri) || is_trusted_origin(&uri) {
                let _ = nw_proxy.send_event(UserEvent::OpenNewWindowTab {
                    source_tab_id: tab_id,
                    url: uri,
                });
            } else {
                eprintln!("[security] Blocked popup new-window request to: {uri}");
            }
            wry::NewWindowResponse::Deny
        })
        .with_document_title_changed_handler(move |title| {
            let _ = title_proxy.send_event(UserEvent::TitleChanged(tab_id, title));
        })
        .with_navigation_handler(move |url| {
            if is_trusted_origin(&url) {
                nav_trusted.store(true, Ordering::Relaxed);
                if url.contains("newtab.html") {
                    let _ = url_proxy.send_event(UserEvent::UrlChanged(tab_id, "about:blank".to_owned()));
                }
                true
            } else if is_safe_web_url(&url) || url.starts_with("about:") {
                nav_trusted.store(false, Ordering::Relaxed);

                // Focus Mode Enforcement in Rust Navigation Handler
                if let Ok(fm) = global_focus_manager().lock() {
                    let decision = fm.check_url(&url);
                    match decision {
                        focus::FocusDecision::Blocked { mode, domain: _, url: dest_url, remaining_secs } => {
                            let interstitial_url = format!(
                                "rusty://app/interstitial.html?url={}&mode={}&remaining={}",
                                percent_encoding::percent_encode(dest_url.as_bytes(), percent_encoding::NON_ALPHANUMERIC),
                                percent_encoding::percent_encode(mode.as_bytes(), percent_encoding::NON_ALPHANUMERIC),
                                remaining_secs
                            );
                            let _ = url_proxy.send_event(UserEvent::NavigateTab(tab_id, interstitial_url));
                            return false;
                        }
                        focus::FocusDecision::Redirect(redirect_url) => {
                            let _ = url_proxy.send_event(UserEvent::NavigateTab(tab_id, redirect_url));
                            return false;
                        }
                        focus::FocusDecision::Allowed => {}
                    }
                }

                let _ = url_proxy.send_event(UserEvent::UrlChanged(tab_id, url.clone()));
                true
            } else {
                nav_trusted.store(false, Ordering::Relaxed);
                eprintln!("[security] Blocked navigation to: {url}");
                false
            }
        })
        .with_permission_handler(move |kind| {
            match kind {
                wry::PermissionKind::Camera if block_camera => {
                    eprintln!("[security] Denied camera permission (privacy sandbox)");
                    wry::PermissionResponse::Deny
                }
                wry::PermissionKind::Microphone if block_microphone => {
                    eprintln!("[security] Denied microphone permission (privacy sandbox)");
                    wry::PermissionResponse::Deny
                }
                wry::PermissionKind::Geolocation => {
                    if perm_trusted.load(Ordering::Relaxed) {
                        tracing::info!("[privacy] Granted explicit Geolocation request for trusted rusty://app/ origin");
                        wry::PermissionResponse::Allow
                    } else if block_geolocation {
                        eprintln!("[security] Denied geolocation permission (privacy sandbox)");
                        wry::PermissionResponse::Deny
                    } else {
                        wry::PermissionResponse::Default
                    }
                }
                _ => wry::PermissionResponse::Default,
            }
        })
        .with_download_started_handler(move |url, destination| {
            let filename = destination
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| "download".to_owned());
            *destination = dl_dir.join(&filename);
            println!("[download] Starting: {url} -> {}", destination.display());
            let _ = dl_start_proxy.send_event(UserEvent::DownloadStarted(url, filename));
            true
        })
        .with_download_completed_handler(move |url, dest, success| {
            let path_str = dest.map(|p| p.to_string_lossy().to_string()).unwrap_or_default();
            println!("[download] Finished (success={success}): {url} -> {path_str}");
            let _ = dl_done_proxy.send_event(UserEvent::DownloadCompleted(url, path_str, success));
        });

    let create_start = Instant::now();
    let has_shared_env = shared_webview.is_some();

    #[cfg(target_os = "windows")]
    if let Some(parent_wv) = shared_webview {
        builder = builder.with_environment(parent_wv.environment());
    }

    #[cfg(any(
        target_os = "windows",
        target_os = "macos",
        target_os = "ios",
        target_os = "android"
    ))]
    let webview = builder.build_as_child(window).context("Failed to create content WebView")?;

    #[cfg(not(any(
        target_os = "windows",
        target_os = "macos",
        target_os = "ios",
        target_os = "android"
    )))]
    let webview = {
        use tao::platform::unix::WindowExtUnix;
        use wry::WebViewBuilderExtUnix;
        let vbox = window
            .default_vbox()
            .context("Failed to get GTK vbox")?;
        builder.build_gtk(vbox).context("Failed to create content WebView (GTK)")?
    };

    tracing::info!(
        tab_id,
        url,
        has_shared_env,
        elapsed_ms = create_start.elapsed().as_millis() as u64,
        "[webview] build_content_webview completed"
    );

    if (zoom_level - 1.0).abs() > 0.01 {
        let _ = webview.zoom(zoom_level);
    }

    Ok(webview)
}

/// Build the full-window Chrome webview serving `rusty://app/index.html` using the shared `WebContext`.
fn build_chrome_webview(
    window: &Window,
    web_context: &mut WebContext,
    proxy: tao::event_loop::EventLoopProxy<UserEvent>,
    window_width: f64,
    window_height: f64,
    settings: &storage::Settings,
) -> Result<WebView> {
    let chrome_url = resolve_content_url_with_settings("rusty://app/index.html", settings);
    let builder = WebViewBuilder::new_with_web_context(web_context)
        .with_bounds(wry::Rect {
            position: wry::dpi::Position::Logical(wry::dpi::LogicalPosition::new(0.0, 0.0)),
            size: wry::dpi::Size::Logical(wry::dpi::LogicalSize::new(window_width, window_height)),
        })
        .with_custom_protocol("rusty".into(), ui::app_protocol::handle_rusty_request)
        .with_url(&chrome_url)
        .with_ipc_handler(move |req| {
            let uri = req.uri().to_string();
            if !is_trusted_origin(&uri) {
                eprintln!("[security] Blocked IPC from unauthorized origin in chrome webview: {uri}");
                return;
            }
            let _ = proxy.send_event(UserEvent::ChromeIpc(req.body().to_string()));
        })
        .with_devtools(cfg!(debug_assertions));

    #[cfg(any(
        target_os = "windows",
        target_os = "macos",
        target_os = "ios",
        target_os = "android"
    ))]
    let webview = builder.build_as_child(window).context("Failed to create chrome WebView")?;

    #[cfg(not(any(
        target_os = "windows",
        target_os = "macos",
        target_os = "ios",
        target_os = "android"
    )))]
    let webview = {
        use tao::platform::unix::WindowExtUnix;
        use wry::WebViewBuilderExtUnix;
        let vbox = window
            .default_vbox()
            .context("Failed to get GTK vbox")?;
        builder.build_gtk(vbox).context("Failed to create chrome WebView (GTK)")?
    };

    Ok(webview)
}

/// Send complete state update to the Chrome webview.
fn sync_chrome_ui(
    chrome_wv: &WebView,
    tabs: &TabManager,
    groups: &[TabGroup],
    content_webviews: &HashMap<TabId, WebView>,
    storage: &mut Storage,
    is_incognito: bool,
    split: &SplitState,
) {
    let tab_infos = tabs.all_info();
    let active_id = tabs.active_id().unwrap_or(0);
    let active_tab = tabs.active_tab();
    let active_url = active_tab.map(|t| t.url.as_str()).unwrap_or("");
    let active_title = active_tab.map(|t| t.title.as_str()).unwrap_or("New Tab");

    let tab_back = active_tab.and_then(|t| t.peek_back_url()).is_some();
    let tab_fwd = active_tab.and_then(|t| t.peek_forward_url()).is_some();

    let (can_back, can_fwd, zoom_percent) = if let Some(wv) = content_webviews.get(&active_id) {
        let zoom = tabs.get(active_id).map(|t| t.zoom_level).unwrap_or(1.0);
        (
            wv.can_go_back().unwrap_or(false) || tab_back,
            wv.can_go_forward().unwrap_or(false) || tab_fwd,
            (zoom * 100.0).round() as u32,
        )
    } else {
        (tab_back, tab_fwd, 100)
    };

    let is_bookmarked = if !active_url.is_empty() && !active_url.starts_with("about:") {
        storage.is_bookmarked(active_url)
    } else {
        false
    };

    let bookmarks: Vec<serde_json::Value> = storage
        .bookmarks()
        .iter()
        .map(|b| {
            json!({
                "title": b.title,
                "url": b.url,
                "created_at": b.added_secs * 1000,
            })
        })
        .collect();

    let history: Vec<serde_json::Value> = storage
        .recent_history(100)
        .iter()
        .map(|h| {
            json!({
                "title": h.title,
                "url": h.url,
                "visited_at": h.timestamp_secs * 1000,
            })
        })
        .collect();

    let downloads: Vec<serde_json::Value> = storage
        .downloads()
        .iter()
        .enumerate()
        .map(|(idx, d)| {
            json!({
                "id": idx + 1,
                "filename": d.filename,
                "url": d.url,
                "state": if d.success { "completed" } else { "failed" },
                "progress": 100,
            })
        })
        .collect();

    let breakdown = telemetry::sample_browser_memory_breakdown(content_webviews.len());
    let mem_payload = build_memory_payload(&breakdown, tabs.count());

    let split_payload = if split.enabled {
        let left_tab = split.left_tab_id.and_then(|id| tabs.get(id));
        let right_tab = split.right_tab_id.and_then(|id| tabs.get(id));
        json!({
            "enabled": true,
            "ratio": split.ratio,
            "focused_pane": split.focused_pane,
            "left_tab_id": split.left_tab_id,
            "right_tab_id": split.right_tab_id,
            "left_url": left_tab.map(|t| t.url.as_str()).unwrap_or(""),
            "right_url": right_tab.map(|t| t.url.as_str()).unwrap_or(""),
            "left_title": left_tab.map(|t| t.title.as_str()).unwrap_or("New Tab"),
            "right_title": right_tab.map(|t| t.title.as_str()).unwrap_or("New Tab"),
        })
    } else {
        json!({
            "enabled": false,
            "ratio": split.ratio,
            "focused_pane": 0,
            "left_tab_id": serde_json::Value::Null,
            "right_tab_id": serde_json::Value::Null,
            "left_url": "",
            "right_url": "",
            "left_title": "",
            "right_title": "",
        })
    };

    let focus_payload = if let Ok(fm) = global_focus_manager().try_lock() {
        serde_json::to_value(&fm.state()).unwrap_or(serde_json::Value::Null)
    } else {
        serde_json::Value::Null
    };

    let state = json!({
        "type": "state_update",
        "tabs": tab_infos,
        "groups": groups,
        "active_tab": active_id,
        "url": active_url,
        "title": active_title,
        "can_go_back": can_back,
        "can_go_forward": can_fwd,
        "is_bookmarked": is_bookmarked,
        "zoom_percent": zoom_percent,
        "is_incognito": is_incognito,
        "bookmarks": bookmarks,
        "history": history,
        "downloads": downloads,
        "memory": mem_payload,
        "split_view": split_payload,
        "focus": focus_payload,
    });

    eval_on_webview(chrome_wv, &state);
}

/// Load content into a webview, routing new tabs to `rusty://app/newtab.html`.
fn load_target_url(wv: &WebView, url: &str, storage: &mut Storage) {
    match url {
        "about:blank" | "about:newtab" => {
            let target = resolve_content_url_with_settings("about:blank", storage.settings());
            println!("[content] Loading new tab page: {target}");
            let _ = wv.load_url(&target);
        }
        "about:history" => {
            let recent = storage.recent_history(200);
            let _ = wv.load_html(&ui::pages::render_history_page(&recent));
        }
        "about:bookmarks" => {
            let bms = storage.bookmarks();
            let _ = wv.load_html(&ui::pages::render_bookmarks_page(bms));
        }
        "about:downloads" => {
            let dls = storage.downloads();
            let _ = wv.load_html(&ui::pages::render_downloads_page(dls));
        }
        "about:settings" => {
            let settings = storage.settings().clone();
            let _ = wv.load_html(&ui::pages::render_settings_page(&settings));
        }
        other => {
            let target = resolve_content_url_with_settings(other, storage.settings());
            let _ = wv.load_url(&target);
        }
    }
}

fn remove_tab_webview(
    content_webviews: &mut HashMap<TabId, WebView>,
    split: &mut SplitState,
    tab_id: TabId,
) {
    content_webviews.remove(&tab_id);
    split.applied_bounds.remove(&tab_id);
    split.applied_visible.remove(&tab_id);
}

/// Ensure a given tab has a live content WebView built on the shared environment.
#[allow(clippy::too_many_arguments)]
fn ensure_tab_webview(
    tab_id: TabId,
    window: &Window,
    chrome_wv: &WebView,
    tabs: &mut TabManager,
    content_webviews: &mut HashMap<TabId, WebView>,
    proxy: &tao::event_loop::EventLoopProxy<UserEvent>,
    bounds: wry::Rect,
    is_overlay_open: bool,
    storage: &mut Storage,
    is_incognito: bool,
    split: &mut SplitState,
    watchdog: &WatchdogHandle,
) -> Result<()> {
    if content_webviews.contains_key(&tab_id) {
        return Ok(());
    }

    let (url, scroll_y, zoom) = match tabs.get(tab_id) {
        Some(t) => (t.url.clone(), t.scroll_y, t.zoom_level),
        None => return Ok(()),
    };

    let settings = storage.settings().clone();
    let initial_url = resolve_content_url_with_settings(&url, &settings);
    let needs_html_page = matches!(
        url.as_str(),
        "about:history" | "about:bookmarks" | "about:downloads" | "about:settings"
    );
    watchdog.set_phase(LoopPhase::WebViewCreation);
    tracing::info!(tab_id, url = %url, is_incognito, "[memory] Lazily creating content WebView");

    let wv = build_content_webview(ContentWebViewParams {
        window,
        shared_webview: Some(chrome_wv),
        url: if needs_html_page { "about:blank" } else { &initial_url },
        tab_id,
        proxy: proxy.clone(),
        content_rect: bounds,
        scroll_y,
        zoom_level: zoom,
        is_incognito,
        block_camera: settings.block_camera,
        block_microphone: settings.block_microphone,
        block_geolocation: settings.block_geolocation,
        userscripts: &settings.userscripts,
        is_vault: storage.is_active_workspace_vault(),
    })?;

    if needs_html_page {
        load_target_url(&wv, &url, storage);
    }
    if is_overlay_open {
        let _ = wv.set_visible(false);
    }
    tabs.mark_restored(tab_id);
    split.applied_bounds.insert(tab_id, bounds);
    split.applied_visible.insert(tab_id, !is_overlay_open);
    content_webviews.insert(tab_id, wv);
    Ok(())
}

/// Apply single-pane or split-pane bounds and visibility cleanly with epsilon deduplication.
#[allow(clippy::too_many_arguments)]
fn apply_layout_and_visibility(
    window: &Window,
    chrome_wv: &WebView,
    tabs: &mut TabManager,
    content_webviews: &mut HashMap<TabId, WebView>,
    proxy: &tao::event_loop::EventLoopProxy<UserEvent>,
    current_content_rect: wry::Rect,
    is_overlay_open: bool,
    storage: &mut Storage,
    is_incognito: bool,
    split: &mut SplitState,
    watchdog: &WatchdogHandle,
) {
    let targets: Vec<(TabId, wry::Rect)> = if split.enabled {
        let (fallback_left, fallback_right) =
            compute_split_subrects(current_content_rect, split.ratio, 36.0, 8.0);
        let left_r = split.left_rect.unwrap_or(fallback_left);
        let right_r = split.right_rect.unwrap_or(fallback_right);
        let mut out = Vec::with_capacity(2);
        if let Some(lid) = split.left_tab_id {
            out.push((lid, left_r));
        }
        if let Some(rid) = split.right_tab_id {
            if Some(rid) != split.left_tab_id {
                out.push((rid, right_r));
            }
        }
        out
    } else if let Some(active_id) = tabs.active_id() {
        vec![(active_id, current_content_rect)]
    } else {
        Vec::new()
    };

    // Hide any webviews that should not currently be visible
    let all_existing_ids: Vec<TabId> = content_webviews.keys().copied().collect();
    for tid in all_existing_ids {
        let should_be_visible = !is_overlay_open && targets.iter().any(|(t, _)| *t == tid);
        if !should_be_visible {
            let was_visible = split.applied_visible.get(&tid).copied().unwrap_or(true);
            if was_visible {
                if let Some(wv) = content_webviews.get(&tid) {
                    let _ = wv.set_visible(false);
                    let _ = wv.set_memory_target_low();
                    let _ = wv.suspend();
                }
                split.applied_visible.insert(tid, false);
            }
        }
    }

    // Ensure and position active target webview(s)
    for (tid, target_rect) in targets {
        if let Err(err) = ensure_tab_webview(
            tid,
            window,
            chrome_wv,
            tabs,
            content_webviews,
            proxy,
            target_rect,
            is_overlay_open,
            storage,
            is_incognito,
            split,
            watchdog,
        ) {
            tracing::error!(tab_id = tid, error = %err, "[split_view] Failed creating WebView");
            continue;
        }
        if let Some(wv) = content_webviews.get(&tid) {
            let need_bounds = split
                .applied_bounds
                .get(&tid)
                .map(|prev| !rects_approx_eq(*prev, target_rect, 0.5))
                .unwrap_or(true);
            if need_bounds {
                let _ = wv.set_bounds(target_rect);
                split.applied_bounds.insert(tid, target_rect);
            }
            let want_visible = !is_overlay_open;
            let cur_visible = split.applied_visible.get(&tid).copied().unwrap_or(true);
            if cur_visible != want_visible {
                let _ = wv.set_visible(want_visible);
                if want_visible {
                    let _ = wv.resume();
                    let _ = wv.set_memory_target_normal();
                    if tabs.get(tid).map(|t| is_newtab_url(&t.url)).unwrap_or(false) {
                        let sync_msg = json!({
                            "type": "ui_settings_sync",
                            "settings": storage.settings().to_ui_json(),
                        });
                        eval_on_webview(wv, &sync_msg);
                    }
                }
                split.applied_visible.insert(tid, want_visible);
            }
        }
    }
}

fn clear_split_state(split: &mut SplitState) {
    split.enabled = false;
    split.left_tab_id = None;
    split.right_tab_id = None;
    split.focused_pane = 0;
    split.left_rect = None;
    split.right_rect = None;
}

/// Discard inactive background tabs to reclaim RAM.
#[allow(clippy::too_many_arguments)]
fn discard_inactive_tabs(
    tabs: &mut TabManager,
    content_webviews: &mut HashMap<TabId, WebView>,
    threshold: Duration,
    chrome_wv: &WebView,
    groups: &[TabGroup],
    storage: &mut Storage,
    is_incognito: bool,
    split: &mut SplitState,
) {
    let to_discard: Vec<TabId> = tabs
        .tabs_to_discard(threshold)
        .into_iter()
        .filter(|id| !split.contains_tab(*id))
        .collect();
    for id in &to_discard {
        remove_tab_webview(content_webviews, split, *id);
        let scroll = tabs.get(*id).map(|t| t.scroll_y).unwrap_or(0.0);
        tabs.mark_discarded(*id, scroll);
        println!("[memory] Discarded inactive tab #{id} from RAM (scroll={scroll:.0}px)");
    }
    if !to_discard.is_empty() {
        sync_chrome_ui(
            chrome_wv,
            tabs,
            groups,
            content_webviews,
            storage,
            is_incognito,
            split,
        );
    }
}

#[allow(clippy::too_many_arguments)]
fn open_new_tab(
    window: &Window,
    chrome_wv: &WebView,
    tabs: &mut TabManager,
    groups: &[TabGroup],
    content_webviews: &mut HashMap<TabId, WebView>,
    proxy: &tao::event_loop::EventLoopProxy<UserEvent>,
    content_rect: wry::Rect,
    is_overlay_open: bool,
    storage: &mut Storage,
    is_incognito: bool,
    after_tab_id: Option<TabId>,
    target_url: String,
    background: bool,
    title_hint: Option<String>,
    split: &mut SplitState,
    watchdog: &WatchdogHandle,
) {
    let default_zoom = storage.settings().default_zoom;
    let new_id = tabs.create_tab_after(after_tab_id, target_url.clone());
    if let Some(t) = tabs.get_mut(new_id) {
        t.zoom_level = default_zoom;
        if let Some(hint) = title_hint.filter(|s| !s.trim().is_empty()) {
            t.title = hint;
        }
    }

    if !background {
        if split.enabled {
            if split.focused_pane == 1 {
                split.right_tab_id = Some(new_id);
            } else {
                split.left_tab_id = Some(new_id);
            }
        }
        tabs.switch_to(new_id);
        apply_layout_and_visibility(
            window,
            chrome_wv,
            tabs,
            content_webviews,
            proxy,
            content_rect,
            is_overlay_open,
            storage,
            is_incognito,
            split,
            watchdog,
        );
    }

    sync_chrome_ui(
        chrome_wv,
        tabs,
        groups,
        content_webviews,
        storage,
        is_incognito,
        split,
    );
}

/// Safely launch an allowlisted desktop application without shell string interpretation.
fn launch_safe_app(app: &str) -> Result<()> {
    let clean = app.trim().to_ascii_lowercase();

    #[cfg(target_os = "windows")]
    let candidates: &[&str] = match clean.as_str() {
        "terminal" | "wt" => &["wt.exe", "powershell.exe", "cmd.exe"],
        "calculator" | "calc" => &["calc.exe"],
        "explorer" | "files" => &["explorer.exe"],
        "vscode" | "code" => &["code.cmd", "code.exe"],
        "notepad" => &["notepad.exe"],
        _ => anyhow::bail!("Application not allowed: {}", app),
    };

    #[cfg(not(target_os = "windows"))]
    let candidates: &[&str] = match clean.as_str() {
        "terminal" | "wt" => &["gnome-terminal", "xterm", "konsole", "alacritty"],
        "calculator" | "calc" => &["gnome-calculator", "kcalc", "xcalc"],
        "explorer" | "files" => &["nautilus", "dolphin", "thunar"],
        "vscode" | "code" => &["code"],
        "notepad" => &["gedit", "kate", "nano"],
        _ => anyhow::bail!("Application not allowed: {}", app),
    };

    for candidate in candidates {
        if let Ok(child) = std::process::Command::new(candidate).spawn() {
            std::mem::drop(child);
            return Ok(());
        }
    }

    anyhow::bail!("Application not found: {}", app);
}

fn get_downloads_disk_space_string(storage: &mut Storage) -> String {
    let dl_dir = Storage::resolve_downloads_dir();
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::ffi::OsStrExt;
        let wide: Vec<u16> = dl_dir.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
        let mut free_bytes: u64 = 0;
        let mut total_bytes: u64 = 0;
        let mut total_free_bytes: u64 = 0;
        #[link(name = "kernel32")]
        extern "system" {
            fn GetDiskFreeSpaceExW(
                lpDirectoryName: *const u16,
                lpFreeBytesAvailableToCaller: *mut u64,
                lpTotalNumberOfBytes: *mut u64,
                lpTotalNumberOfFreeBytes: *mut u64,
            ) -> i32;
        }
        let res = unsafe {
            GetDiskFreeSpaceExW(wide.as_ptr(), &mut free_bytes, &mut total_bytes, &mut total_free_bytes)
        };
        if res != 0 {
            let gb = free_bytes as f64 / (1024.0 * 1024.0 * 1024.0);
            return format!("{:.1} GB free", gb);
        }
    }
    format!("{} items", storage.downloads().len())
}

fn main() -> Result<()> {
    // Initialize structured tracing (RUST_LOG overrides default info filter)
    let _ = tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .with_target(false)
        .try_init();

    if let Err(err) = run_browser() {
        eprintln!("[fatal] Rusty Browser terminated with error: {err:?}");
        #[cfg(target_os = "windows")]
        {
            let err_str = format!("Rusty Browser failed to start:\n\n{err:?}\n\nPlease ensure WebView2 Runtime is installed.");
            win32_platform::show_error_box(&err_str, "Rusty Browser Error");
        }
        return Err(err);
    }
    Ok(())
}

fn run_browser() -> Result<()> {
    // ── Windows Job Object so all WebView2 child processes stay tracked & die with host ─
    #[cfg(target_os = "windows")]
    let _job_guard = win32_platform::init_job_object();

    // ── Parse command line arguments ───────────────────────────────────
    let args: Vec<String> = env::args().skip(1).collect();
    let is_incognito = args.iter().any(|a| a == "--incognito" || a == "--private" || a == "-p");
    let load_all_tabs = args.iter().any(|a| a == "--load-all-tabs");
    let non_flag_args: Vec<String> = args
        .into_iter()
        .filter(|a| !a.starts_with("--") && a != "-p")
        .collect();

    let initial_urls: Vec<String> = if non_flag_args.is_empty() {
        vec!["about:blank".to_owned()]
    } else if non_flag_args.len() == 1 {
        vec![url_resolver::resolve(&non_flag_args[0])]
    } else {
        non_flag_args
            .iter()
            .map(|u| url_resolver::resolve(u))
            .collect()
    };

    // ── Persistent storage & unique WebView2 user-data folder ──────────
    let mut storage = Storage::new();
    println!("[storage] Data directory: {}", storage.data_dir().display());
    let wv_data_dir = storage
        .data_dir()
        .join(if is_incognito { "WebView2Private" } else { "WebView2" });
    let _ = std::fs::create_dir_all(&wv_data_dir);
    telemetry::set_webview_data_dir(&wv_data_dir);
    let mut web_context = WebContext::new(Some(wv_data_dir.clone()));
    println!("[webview2] Shared user-data dir: {}", wv_data_dir.display());

    let initial_settings = storage.settings().clone();

    let discard_timeout_override = get_discard_timeout_override();
    let initial_discard_secs =
        effective_discard_timeout(&initial_settings, discard_timeout_override)
            .map(|d| d.as_secs())
            .unwrap_or(0);
    println!(
        "[rusty_browser] Discard timeout configured to {initial_discard_secs}s (incognito={is_incognito}, skin={}, theme={})",
        initial_settings.skin, initial_settings.theme
    );

    // ── Event loop & UI-stall Watchdog ─────────────────────────────────
    let event_loop = EventLoopBuilder::<UserEvent>::with_user_event().build();
    let proxy = event_loop.create_proxy();
    let watchdog = spawn_event_loop_watchdog(proxy.clone());

    let focus_ticker_proxy = proxy.clone();
    std::thread::spawn(move || {
        loop {
            std::thread::sleep(Duration::from_secs(1));
            if focus_ticker_proxy.send_event(UserEvent::FocusTick).is_err() {
                break;
            }
        }
    });

    // ── Main window ────────────────────────────────────────────────────
    let window_title = if is_incognito {
        "Rusty Browser (Private Browsing)"
    } else {
        "Rusty Browser"
    };

    let window = WindowBuilder::new()
        .with_title(window_title)
        .with_inner_size(LogicalSize::new(DEFAULT_WIDTH, DEFAULT_HEIGHT))
        .with_visible(true)
        .with_focused(true)
        .build(&event_loop)
        .context("Failed to create window")?;

    // ── Tab & Layout State ─────────────────────────────────────────────
    let (persisted_workspaces, persisted_active_ws) = storage.get_workspaces();
    let mut workspaces = workspace::WorkspaceManager::from_persisted(persisted_workspaces, persisted_active_ws);
    let mut tabs = TabManager::new();
    let mut groups: Vec<TabGroup> = Vec::new();
    let mut content_webviews: HashMap<TabId, WebView> = HashMap::new();
    let mut is_overlay_open = false;
    let mut split = SplitState::new();

    let mut latest_telemetry: Option<telemetry::TelemetrySnapshot> = None;
    let mut latest_weather: Option<weather::WeatherData> = None;
    let mut last_weather_error: Option<String> = None;
    let mut last_weather_request: Option<weather::WeatherRequest> = if initial_settings.weather_location.trim().is_empty() {
        None
    } else {
        Some(weather::WeatherRequest::City(initial_settings.weather_location.trim().to_owned()))
    };
    let mut last_weather_fetch = Instant::now();
    let mut next_maintenance_at = Instant::now() + DISCARD_CHECK_INTERVAL;

    let mut current_content_rect = wry::Rect {
        position: wry::dpi::Position::Logical(wry::dpi::LogicalPosition::new(0.0, DEFAULT_TOP_BAR_HEIGHT)),
        size: wry::dpi::Size::Logical(wry::dpi::LogicalSize::new(
            DEFAULT_WIDTH,
            DEFAULT_HEIGHT - DEFAULT_TOP_BAR_HEIGHT,
        )),
    };

    // ── Build Chrome UI WebView (owns shared WebContext/Environment) ───
    let chrome_wv = match build_chrome_webview(
        &window,
        &mut web_context,
        proxy.clone(),
        DEFAULT_WIDTH,
        DEFAULT_HEIGHT,
        &initial_settings,
    ) {
        Ok(wv) => wv,
        Err(err) => {
            eprintln!("[webview2] Primary user-data directory failed ({err:?}); retrying with isolated instance profile...");
            let fallback_dir = storage
                .data_dir()
                .join(format!("WebView2_inst_{}", std::process::id()));
            let _ = std::fs::create_dir_all(&fallback_dir);
            telemetry::set_webview_data_dir(&fallback_dir);
            let mut fallback_context = WebContext::new(Some(fallback_dir));
            build_chrome_webview(
                &window,
                &mut fallback_context,
                proxy.clone(),
                DEFAULT_WIDTH,
                DEFAULT_HEIGHT,
                &initial_settings,
            )
            .context("Failed to create chrome WebView (even with fallback profile)")?
        }
    };

    // ── Background Real OS Telemetry & Live Weather ────────────────────
    let tel_proxy = proxy.clone();
    telemetry::spawn_telemetry_collector(Duration::from_secs(2), move |snap| {
        tel_proxy.send_event(UserEvent::Telemetry(snap)).is_ok()
    });
    if let Some(ref req) = last_weather_request {
        spawn_weather_fetch(proxy.clone(), req.clone(), false, storage.data_dir().to_path_buf());
    }

    // ── Create tabs for initial URLs ───────────────────────────────────
    for (i, url) in initial_urls.iter().enumerate() {
        let id = tabs.create_tab(url.clone());
        if i == 0 {
            tabs.switch_to(id);
        }
    }

    if load_all_tabs {
        println!("[benchmark] Pre-creating live WebViews for all {} tabs", tabs.count());
        for tab_id in tabs.all_ids() {
            if let Some(t) = tabs.get(tab_id) {
                let url = t.url.clone();
                let settings = storage.settings().clone();
                let initial_url = resolve_content_url_with_settings(&url, &settings);
                let needs_html_page = matches!(
                    url.as_str(),
                    "about:history" | "about:bookmarks" | "about:downloads" | "about:settings"
                );
                if let Ok(wv) = build_content_webview(ContentWebViewParams {
                    window: &window,
                    shared_webview: Some(&chrome_wv),
                    url: if needs_html_page { "about:blank" } else { &initial_url },
                    tab_id,
                    proxy: proxy.clone(),
                    content_rect: current_content_rect,
                    scroll_y: 0.0,
                    zoom_level: t.zoom_level,
                    is_incognito,
                    block_camera: settings.block_camera,
                    block_microphone: settings.block_microphone,
                    block_geolocation: settings.block_geolocation,
                    userscripts: &settings.userscripts,
                    is_vault: storage.is_active_workspace_vault(),
                }) {
                    if needs_html_page {
                        load_target_url(&wv, &url, &mut storage);
                    }
                    let visible = Some(tab_id) == tabs.active_id();
                    if !visible {
                        let _ = wv.set_visible(false);
                    }
                    tabs.mark_restored(tab_id);
                    split.applied_bounds.insert(tab_id, current_content_rect);
                    split.applied_visible.insert(tab_id, visible);
                    content_webviews.insert(tab_id, wv);
                }
            }
        }
    } else {
        apply_layout_and_visibility(
            &window,
            &chrome_wv,
            &mut tabs,
            &mut content_webviews,
            &proxy,
            current_content_rect,
            is_overlay_open,
            &mut storage,
            is_incognito,
            &mut split,
            &watchdog,
        );
        watchdog.ack();
    }

    println!("[rusty_browser] Started with {} tabs", tabs.count());

    window.set_visible(true);
    window.set_focus();

    let mut content_rect_count: u64 = 0;

    // ── Event loop ─────────────────────────────────────────────────────
    event_loop.run(move |event, _event_loop, control_flow| {
        if *control_flow != ControlFlow::Exit {
            *control_flow = ControlFlow::WaitUntil(next_maintenance_at);
        }

        match event {
            Event::MainEventsCleared | Event::UserEvent(UserEvent::WatchdogPing) => {
                watchdog.ack();
            }

            // ── Deferred Split View enable/disable on main UI loop ────────
            Event::UserEvent(UserEvent::ApplySplitView { enabled }) => {
                watchdog.set_phase(LoopPhase::SplitViewHandler);
                let start_t = Instant::now();
                let want_enabled = enabled.unwrap_or(!split.enabled);
                if want_enabled && !split.enabled {
                    let left_opt = tabs.active_id().or_else(|| tabs.all_ids().into_iter().next());
                    if let Some(left_id) = left_opt {
                        let existing_ids = tabs.all_ids();
                        let pos = existing_ids.iter().position(|&id| id == left_id).unwrap_or(0);
                        let right_id = existing_ids
                            .iter()
                            .skip(pos + 1)
                            .copied()
                            .find(|&id| id != left_id)
                            .or_else(|| existing_ids.iter().copied().find(|&id| id != left_id))
                            .unwrap_or_else(|| tabs.create_tab_after(Some(left_id), "about:blank".to_owned()));

                        split.enabled = true;
                        split.left_tab_id = Some(left_id);
                        split.right_tab_id = Some(right_id);
                        split.focused_pane = 0;
                        split.left_rect = None;
                        split.right_rect = None;
                        tabs.switch_to(left_id);

                        apply_layout_and_visibility(
                            &window,
                            &chrome_wv,
                            &mut tabs,
                            &mut content_webviews,
                            &proxy,
                            current_content_rect,
                            is_overlay_open,
                            &mut storage,
                            is_incognito,
                            &mut split,
                            &watchdog,
                        );
                        sync_chrome_ui(
                            &chrome_wv,
                            &tabs,
                            &groups,
                            &content_webviews,
                            &mut storage,
                            is_incognito,
                            &split,
                        );
                        tracing::info!(
                            left_id,
                            right_id,
                            elapsed_ms = start_t.elapsed().as_millis() as u64,
                            "[split_view] Enabled split view"
                        );
                    }
                } else if !want_enabled && split.enabled {
                    let keep_id = split
                        .tab_for_pane(split.focused_pane)
                        .or(split.left_tab_id)
                        .or(split.right_tab_id)
                        .filter(|id| tabs.get(*id).is_some())
                        .or_else(|| tabs.active_id());
                    clear_split_state(&mut split);
                    if let Some(kid) = keep_id {
                        tabs.switch_to(kid);
                    }
                    apply_layout_and_visibility(
                        &window,
                        &chrome_wv,
                        &mut tabs,
                        &mut content_webviews,
                        &proxy,
                        current_content_rect,
                        is_overlay_open,
                        &mut storage,
                        is_incognito,
                        &mut split,
                        &watchdog,
                    );
                    sync_chrome_ui(
                        &chrome_wv,
                        &tabs,
                        &groups,
                        &content_webviews,
                        &mut storage,
                        is_incognito,
                        &split,
                    );
                    tracing::info!(
                        keep_id = ?keep_id,
                        elapsed_ms = start_t.elapsed().as_millis() as u64,
                        "[split_view] Closed split view"
                    );
                }
                watchdog.ack();
            }

            // ── Content WebView pointer/focus synchronization ────────────
            Event::UserEvent(UserEvent::TabFocused(tab_id)) => {
                if split.enabled {
                    if let Some(pane) = split.pane_for_tab(tab_id) {
                        if split.focused_pane != pane || tabs.active_id() != Some(tab_id) {
                            split.focused_pane = pane;
                            tabs.switch_to(tab_id);
                            if let Some(tab) = tabs.get(tab_id) {
                                let suffix = if is_incognito {
                                    " — Rusty Browser (Private)"
                                } else {
                                    " — Rusty Browser"
                                };
                                window.set_title(&format!("{}{suffix}", tab.title));
                            }
                            sync_chrome_ui(
                                &chrome_wv,
                                &tabs,
                                &groups,
                                &content_webviews,
                                &mut storage,
                                is_incognito,
                                &split,
                            );
                        }
                    }
                }
            }

            // ── Periodic timer for automatic tab discarding & weather refresh ─
            Event::NewEvents(StartCause::ResumeTimeReached { .. }) => {
                watchdog.ack();
                let now = Instant::now();
                next_maintenance_at = now + DISCARD_CHECK_INTERVAL;
                if *control_flow != ControlFlow::Exit {
                    *control_flow = ControlFlow::WaitUntil(next_maintenance_at);
                }

                if let Some(threshold) =
                    effective_discard_timeout(storage.settings(), discard_timeout_override)
                {
                    discard_inactive_tabs(
                        &mut tabs,
                        &mut content_webviews,
                        threshold,
                        &chrome_wv,
                        &groups,
                        &mut storage,
                        is_incognito,
                        &mut split,
                    );
                }

                if last_weather_fetch.elapsed() >= Duration::from_secs(weather::CACHE_TTL_SECS) {
                    if let Some(ref req) = last_weather_request {
                        last_weather_fetch = now;
                        spawn_weather_fetch(proxy.clone(), req.clone(), false, storage.data_dir().to_path_buf());
                    }
                }

                if latest_telemetry.is_none() {
                    let breakdown = telemetry::sample_browser_memory_breakdown(content_webviews.len());
                    let mem_json = build_memory_payload(&breakdown, tabs.count());
                    broadcast_to_internal_views(&chrome_wv, &tabs, &content_webviews, &mem_json);
                }
            }

            // ── Window resize ──────────────────────────────────────────
            Event::WindowEvent {
                event: WindowEvent::Resized(size),
                ..
            } => {
                watchdog.set_phase(LoopPhase::WindowResize);
                let scale = window.scale_factor();
                let win_w = size.width as f64 / scale;
                let win_h = size.height as f64 / scale;

                let start_t = Instant::now();
                let _ = chrome_wv.set_bounds(wry::Rect {
                    position: wry::dpi::Position::Logical(wry::dpi::LogicalPosition::new(0.0, 0.0)),
                    size: wry::dpi::Size::Logical(wry::dpi::LogicalSize::new(win_w, win_h)),
                });
                tracing::debug!(
                    win_w,
                    win_h,
                    scale,
                    elapsed_ms = start_t.elapsed().as_millis() as u64,
                    "[layout] WindowEvent::Resized -> chrome_wv.set_bounds"
                );
                watchdog.ack();
            }

            // ── Window close ───────────────────────────────────────────
            Event::WindowEvent {
                event: WindowEvent::CloseRequested,
                ..
            } => {
                *control_flow = ControlFlow::Exit;
            }

            // ── IPC from Chrome UI ─────────────────────────────────────
            Event::UserEvent(UserEvent::ChromeIpc(msg)) => {
                watchdog.set_phase(LoopPhase::IpcDispatch);
                let cmd: UiMessage = match serde_json::from_str(&msg) {
                    Ok(c) => c,
                    Err(e) => {
                        eprintln!("[ipc] Failed to parse UI command: {e}");
                        watchdog.ack();
                        return;
                    }
                };

                match cmd {
                    UiMessage::UiReady { role } => {
                        let settings_msg = json!({
                            "type": "ui_settings_sync",
                            "settings": storage.settings().to_ui_json(),
                        });

                        if role.as_deref() == Some("newtab") {
                            broadcast_to_newtab_views(&tabs, &content_webviews, &settings_msg);

                            let ws_msg = json!({
                                "type": "workspaces_update",
                                "workspaces": workspaces.summaries(tabs.count()),
                                "active_workspace_id": workspaces.active_id(),
                            });
                            broadcast_to_newtab_views(&tabs, &content_webviews, &ws_msg);

                            if let Ok(fm) = global_focus_manager().lock() {
                                let f_msg = json!({
                                    "type": "focus_state_changed",
                                    "state": fm.state(),
                                });
                                broadcast_to_newtab_views(&tabs, &content_webviews, &f_msg);
                            }
                            if let Some(snap) = &latest_telemetry {
                                let tel_msg = build_telemetry_payload(snap);
                                let mem_msg = build_memory_payload(&snap.breakdown, tabs.count());
                                broadcast_to_newtab_views(&tabs, &content_webviews, &tel_msg);
                                broadcast_to_newtab_views(&tabs, &content_webviews, &mem_msg);
                            } else {
                                let breakdown = telemetry::sample_browser_memory_breakdown(content_webviews.len());
                                let mem_msg = build_memory_payload(&breakdown, tabs.count());
                                broadcast_to_newtab_views(&tabs, &content_webviews, &mem_msg);
                            }

                            if let Some(w) = &latest_weather {
                                let w_msg = build_weather_payload(w);
                                broadcast_to_newtab_views(&tabs, &content_webviews, &w_msg);
                            } else if let Some(err) = &last_weather_error {
                                let err_msg = json!({
                                    "type": "weather_error",
                                    "message": err,
                                });
                                broadcast_to_newtab_views(&tabs, &content_webviews, &err_msg);
                            }
                        } else {
                            // Chrome ready (initial boot or clean skin reload)
                            is_overlay_open = false;
                            apply_layout_and_visibility(
                                &window,
                                &chrome_wv,
                                &mut tabs,
                                &mut content_webviews,
                                &proxy,
                                current_content_rect,
                                is_overlay_open,
                                &mut storage,
                                is_incognito,
                                &mut split,
                                &watchdog,
                            );
                            sync_chrome_ui(
                                &chrome_wv,
                                &tabs,
                                &groups,
                                &content_webviews,
                                &mut storage,
                                is_incognito,
                                &split,
                            );
                            eval_on_webview(&chrome_wv, &settings_msg);
                            if let Some(snap) = &latest_telemetry {
                                let tel_msg = build_telemetry_payload(snap);
                                let mem_msg = build_memory_payload(&snap.breakdown, tabs.count());
                                eval_on_webview(&chrome_wv, &tel_msg);
                                eval_on_webview(&chrome_wv, &mem_msg);
                            }
                        }
                    }

                    UiMessage::ContentRect {
                        x,
                        y,
                        width,
                        height,
                        left,
                        right,
                        ratio,
                    } => {
                        watchdog.set_phase(LoopPhase::ContentRectLayout);
                        let next_outer = logical_rect(x, y, width, height);
                        let outer_changed = !rects_approx_eq(current_content_rect, next_outer, 0.5);
                        if outer_changed {
                            current_content_rect = next_outer;
                        }

                        let mut split_rect_changed = false;
                        if split.enabled {
                            if let Some(r) = ratio {
                                let clamped = r.clamp(0.20, 0.80);
                                if (split.ratio - clamped).abs() > 0.002 {
                                    split.ratio = clamped;
                                    split_rect_changed = true;
                                }
                            }
                            if let (Some(l), Some(r)) = (left, right) {
                                let lrect = l.to_wry_rect();
                                let rrect = r.to_wry_rect();
                                let l_diff = split
                                    .left_rect
                                    .map(|prev| !rects_approx_eq(prev, lrect, 0.5))
                                    .unwrap_or(true);
                                let r_diff = split
                                    .right_rect
                                    .map(|prev| !rects_approx_eq(prev, rrect, 0.5))
                                    .unwrap_or(true);
                                if l_diff || r_diff {
                                    split.left_rect = Some(lrect);
                                    split.right_rect = Some(rrect);
                                    split_rect_changed = true;
                                }
                            }
                        }

                        if outer_changed || split_rect_changed {
                            content_rect_count += 1;
                            let start_t = Instant::now();
                            apply_layout_and_visibility(
                                &window,
                                &chrome_wv,
                                &mut tabs,
                                &mut content_webviews,
                                &proxy,
                                current_content_rect,
                                is_overlay_open,
                                &mut storage,
                                is_incognito,
                                &mut split,
                                &watchdog,
                            );
                            tracing::debug!(
                                count = content_rect_count,
                                x,
                                y,
                                width,
                                height,
                                split = split.enabled,
                                elapsed_ms = start_t.elapsed().as_millis() as u64,
                                "[layout] ContentRect updated"
                            );
                        }
                    }

                    UiMessage::Overlay { open } => {
                        is_overlay_open = open;
                        apply_layout_and_visibility(
                            &window,
                            &chrome_wv,
                            &mut tabs,
                            &mut content_webviews,
                            &proxy,
                            current_content_rect,
                            is_overlay_open,
                            &mut storage,
                            is_incognito,
                            &mut split,
                            &watchdog,
                        );
                    }

                    UiMessage::Navigate { url: raw_url } => {
                        let template = &storage.settings().default_search_template;
                        let url = url_resolver::resolve_with_template(&raw_url, template);

                        if let Some(active_id) = tabs.active_id() {
                            if let Some(tab) = tabs.get_mut(active_id) {
                                tab.url = url.clone();
                                tab.set_pending_nav(None);
                                tab.record_navigation(&url);
                            }
                            apply_layout_and_visibility(
                                &window,
                                &chrome_wv,
                                &mut tabs,
                                &mut content_webviews,
                                &proxy,
                                current_content_rect,
                                is_overlay_open,
                                &mut storage,
                                is_incognito,
                                &mut split,
                                &watchdog,
                            );
                            if let Some(wv) = content_webviews.get(&active_id) {
                                load_target_url(wv, &url, &mut storage);
                                if !url.starts_with("about:") && !is_trusted_origin(&url) {
                                    emit_pet_event(&chrome_wv, &tabs, &content_webviews, &mut storage, "page_loading");
                                    if !is_incognito {
                                        let title = tabs.get(active_id).map(|t| t.title.as_str()).unwrap_or("");
                                        storage.record_history(&url, title);
                                    }
                                }
                            }
                        }
                        sync_chrome_ui(
                            &chrome_wv,
                            &tabs,
                            &groups,
                            &content_webviews,
                            &mut storage,
                            is_incognito,
                            &split,
                        );
                    }

                    UiMessage::Back => {
                        if let Some(active_id) = tabs.active_id() {
                            if let Some(wv) = content_webviews.get(&active_id) {
                                if wv.can_go_back().unwrap_or(false) {
                                    if let Some(tab) = tabs.get_mut(active_id) {
                                        tab.set_pending_nav(Some(tab::NavHint::Back));
                                    }
                                    let _ = wv.go_back();
                                    let check_proxy = proxy.clone();
                                    std::thread::spawn(move || {
                                        std::thread::sleep(Duration::from_millis(90));
                                        let _ = check_proxy.send_event(UserEvent::CheckTabUrl(active_id));
                                    });
                                } else if let Some(prev_url) =
                                    tabs.get(active_id).and_then(|t| t.peek_back_url()).map(|s| s.to_owned())
                                {
                                    if let Some(tab) = tabs.get_mut(active_id) {
                                        tab.url = prev_url.clone();
                                        tab.set_pending_nav(None);
                                        tab.record_navigation(&prev_url);
                                    }
                                    load_target_url(wv, &prev_url, &mut storage);
                                    sync_chrome_ui(
                                        &chrome_wv,
                                        &tabs,
                                        &groups,
                                        &content_webviews,
                                        &mut storage,
                                        is_incognito,
                                        &split,
                                    );
                                }
                            }
                        }
                    }

                    UiMessage::Forward => {
                        if let Some(active_id) = tabs.active_id() {
                            if let Some(wv) = content_webviews.get(&active_id) {
                                if wv.can_go_forward().unwrap_or(false) {
                                    if let Some(tab) = tabs.get_mut(active_id) {
                                        tab.set_pending_nav(Some(tab::NavHint::Forward));
                                    }
                                    let _ = wv.go_forward();
                                    let check_proxy = proxy.clone();
                                    std::thread::spawn(move || {
                                        std::thread::sleep(Duration::from_millis(90));
                                        let _ = check_proxy.send_event(UserEvent::CheckTabUrl(active_id));
                                    });
                                } else if let Some(next_url) =
                                    tabs.get(active_id).and_then(|t| t.peek_forward_url()).map(|s| s.to_owned())
                                {
                                    if let Some(tab) = tabs.get_mut(active_id) {
                                        tab.url = next_url.clone();
                                        tab.set_pending_nav(None);
                                        tab.record_navigation(&next_url);
                                    }
                                    load_target_url(wv, &next_url, &mut storage);
                                    sync_chrome_ui(
                                        &chrome_wv,
                                        &tabs,
                                        &groups,
                                        &content_webviews,
                                        &mut storage,
                                        is_incognito,
                                        &split,
                                    );
                                }
                            }
                        }
                    }

                    UiMessage::Reload => {
                        if let Some(active_id) = tabs.active_id() {
                            apply_layout_and_visibility(
                                &window,
                                &chrome_wv,
                                &mut tabs,
                                &mut content_webviews,
                                &proxy,
                                current_content_rect,
                                is_overlay_open,
                                &mut storage,
                                is_incognito,
                                &mut split,
                                &watchdog,
                            );
                            if let Some(wv) = content_webviews.get(&active_id) {
                                let url = tabs
                                    .get(active_id)
                                    .map(|t| t.url.clone())
                                    .unwrap_or_else(|| "about:blank".to_owned());
                                load_target_url(wv, &url, &mut storage);
                                if !url.starts_with("about:") && !is_trusted_origin(&url) {
                                    emit_pet_event(&chrome_wv, &tabs, &content_webviews, &mut storage, "page_loading");
                                }
                            }
                        }
                    }

                    UiMessage::Stop => {
                        if let Some(active_id) = tabs.active_id() {
                            if let Some(wv) = content_webviews.get(&active_id) {
                                let _ = wv.evaluate_script("window.stop();");
                            }
                            emit_pet_event(&chrome_wv, &tabs, &content_webviews, &mut storage, "page_loaded");
                        }
                    }

                    UiMessage::NewTab { url, background, title } => {
                        let had_url = url.is_some();
                        let template = storage.settings().default_search_template.clone();
                        let target_url = match url {
                            Some(raw) if !raw.trim().is_empty() => {
                                if raw.starts_with("about:") || is_trusted_origin(&raw) {
                                    raw
                                } else {
                                    url_resolver::resolve_with_template(&raw, &template)
                                }
                            }
                            _ => "about:blank".to_owned(),
                        };
                        let default_bg = had_url && storage.settings().open_tabs_in_background;
                        let is_bg = background.unwrap_or(default_bg);
                        let after_id = if had_url && !target_url.starts_with("about:") {
                            tabs.active_id()
                        } else {
                            None
                        };
                        let emit_loading = !is_bg
                            && !target_url.starts_with("about:")
                            && !is_trusted_origin(&target_url);
                        open_new_tab(
                            &window,
                            &chrome_wv,
                            &mut tabs,
                            &groups,
                            &mut content_webviews,
                            &proxy,
                            current_content_rect,
                            is_overlay_open,
                            &mut storage,
                            is_incognito,
                            after_id,
                            target_url,
                            is_bg,
                            title,
                            &mut split,
                            &watchdog,
                        );
                        if emit_loading {
                            emit_pet_event(&chrome_wv, &tabs, &content_webviews, &mut storage, "page_loading");
                        }
                    }

                    UiMessage::PasteNewTab => {
                        #[cfg(target_os = "windows")]
                        let clip = win32_platform::read_clipboard_text();
                        #[cfg(not(target_os = "windows"))]
                        let clip: Option<String> = None;

                        let target_url = clip
                            .as_deref()
                            .and_then(|txt| txt.lines().map(str::trim).find(|l| !l.is_empty()))
                            .map(|line| {
                                let template = &storage.settings().default_search_template;
                                url_resolver::resolve_with_template(line, template)
                            })
                            .unwrap_or_else(|| "about:blank".to_owned());

                        open_new_tab(
                            &window,
                            &chrome_wv,
                            &mut tabs,
                            &groups,
                            &mut content_webviews,
                            &proxy,
                            current_content_rect,
                            is_overlay_open,
                            &mut storage,
                            is_incognito,
                            None,
                            target_url,
                            false,
                            None,
                            &mut split,
                            &watchdog,
                        );
                    }

                    UiMessage::OpenHistoryEntryInNewTab { direction, background } => {
                        let target_opt = tabs.active_tab().and_then(|t| {
                            if direction.eq_ignore_ascii_case("forward") {
                                t.peek_forward_url().map(|s| s.to_owned())
                            } else {
                                t.peek_back_url().map(|s| s.to_owned())
                            }
                        });
                        if let Some(target_url) = target_opt {
                            let after_id = tabs.active_id();
                            let is_bg = background.unwrap_or(storage.settings().open_tabs_in_background);
                            open_new_tab(
                                &window,
                                &chrome_wv,
                                &mut tabs,
                                &groups,
                                &mut content_webviews,
                                &proxy,
                                current_content_rect,
                                is_overlay_open,
                                &mut storage,
                                is_incognito,
                                after_id,
                                target_url,
                                is_bg,
                                None,
                                &mut split,
                                &watchdog,
                            );
                        }
                    }

                    UiMessage::SwitchTab { tab_id } => {
                        let old_id = tabs.active_id();
                        if split.enabled {
                            if let Some(pane) = split.pane_for_tab(tab_id) {
                                split.focused_pane = pane;
                                tabs.switch_to(tab_id);
                            } else {
                                if split.focused_pane == 1 {
                                    split.right_tab_id = Some(tab_id);
                                } else {
                                    split.left_tab_id = Some(tab_id);
                                }
                                tabs.switch_to(tab_id);
                            }
                            apply_layout_and_visibility(
                                &window,
                                &chrome_wv,
                                &mut tabs,
                                &mut content_webviews,
                                &proxy,
                                current_content_rect,
                                is_overlay_open,
                                &mut storage,
                                is_incognito,
                                &mut split,
                                &watchdog,
                            );
                            sync_chrome_ui(
                                &chrome_wv,
                                &tabs,
                                &groups,
                                &content_webviews,
                                &mut storage,
                                is_incognito,
                                &split,
                            );
                        } else if old_id != Some(tab_id) {
                            tabs.switch_to(tab_id);
                            apply_layout_and_visibility(
                                &window,
                                &chrome_wv,
                                &mut tabs,
                                &mut content_webviews,
                                &proxy,
                                current_content_rect,
                                is_overlay_open,
                                &mut storage,
                                is_incognito,
                                &mut split,
                                &watchdog,
                            );
                            sync_chrome_ui(
                                &chrome_wv,
                                &tabs,
                                &groups,
                                &content_webviews,
                                &mut storage,
                                is_incognito,
                                &split,
                            );
                        }
                    }

                    UiMessage::CloseTab { tab_id } => {
                        let target_id = tab_id.or_else(|| tabs.active_id());
                        if let Some(id) = target_id {
                            let surviving_split = if split.contains_tab(id) {
                                let other = if split.left_tab_id == Some(id) {
                                    split.right_tab_id
                                } else {
                                    split.left_tab_id
                                };
                                clear_split_state(&mut split);
                                other
                            } else {
                                None
                            };
                            remove_tab_webview(&mut content_webviews, &mut split, id);
                            let switch_to = tabs.close_tab(id);

                            if let Some(new_active) = surviving_split.filter(|sid| tabs.get(*sid).is_some()).or(switch_to) {
                                tabs.switch_to(new_active);
                                apply_layout_and_visibility(
                                    &window,
                                    &chrome_wv,
                                    &mut tabs,
                                    &mut content_webviews,
                                    &proxy,
                                    current_content_rect,
                                    is_overlay_open,
                                    &mut storage,
                                    is_incognito,
                                    &mut split,
                                    &watchdog,
                                );
                                sync_chrome_ui(
                                    &chrome_wv,
                                    &tabs,
                                    &groups,
                                    &content_webviews,
                                    &mut storage,
                                    is_incognito,
                                    &split,
                                );
                                emit_pet_event(&chrome_wv, &tabs, &content_webviews, &mut storage, "tab_closed");
                            } else {
                                *control_flow = ControlFlow::Exit;
                            }
                        }
                    }

                    UiMessage::CloseCurrentTab => {
                        if let Some(id) = tabs.active_id() {
                            let surviving_split = if split.contains_tab(id) {
                                let other = if split.left_tab_id == Some(id) {
                                    split.right_tab_id
                                } else {
                                    split.left_tab_id
                                };
                                clear_split_state(&mut split);
                                other
                            } else {
                                None
                            };
                            remove_tab_webview(&mut content_webviews, &mut split, id);
                            let switch_to = tabs.close_tab(id);

                            if let Some(new_active) = surviving_split.filter(|sid| tabs.get(*sid).is_some()).or(switch_to) {
                                tabs.switch_to(new_active);
                                apply_layout_and_visibility(
                                    &window,
                                    &chrome_wv,
                                    &mut tabs,
                                    &mut content_webviews,
                                    &proxy,
                                    current_content_rect,
                                    is_overlay_open,
                                    &mut storage,
                                    is_incognito,
                                    &mut split,
                                    &watchdog,
                                );
                                sync_chrome_ui(
                                    &chrome_wv,
                                    &tabs,
                                    &groups,
                                    &content_webviews,
                                    &mut storage,
                                    is_incognito,
                                    &split,
                                );
                                emit_pet_event(&chrome_wv, &tabs, &content_webviews, &mut storage, "tab_closed");
                            } else {
                                *control_flow = ControlFlow::Exit;
                            }
                        }
                    }

                    UiMessage::ReorderTabs { from_id, to_id, position } => {
                        tabs.reorder(from_id, to_id, &position);
                        sync_chrome_ui(
                            &chrome_wv,
                            &tabs,
                            &groups,
                            &content_webviews,
                            &mut storage,
                            is_incognito,
                            &split,
                        );
                    }

                    UiMessage::PinTab { tab_id, pinned } => {
                        tabs.set_pinned(tab_id, pinned);
                        sync_chrome_ui(
                            &chrome_wv,
                            &tabs,
                            &groups,
                            &content_webviews,
                            &mut storage,
                            is_incognito,
                            &split,
                        );
                    }

                    UiMessage::MuteTab { tab_id, muted } => {
                        tabs.set_muted(tab_id, muted);
                        sync_chrome_ui(
                            &chrome_wv,
                            &tabs,
                            &groups,
                            &content_webviews,
                            &mut storage,
                            is_incognito,
                            &split,
                        );
                    }

                    UiMessage::DuplicateTab { tab_id, background } => {
                        if let Some(new_id) = tabs.duplicate(tab_id) {
                            let is_bg = background.unwrap_or(storage.settings().open_tabs_in_background);
                            if !is_bg {
                                if split.enabled {
                                    if split.focused_pane == 1 {
                                        split.right_tab_id = Some(new_id);
                                    } else {
                                        split.left_tab_id = Some(new_id);
                                    }
                                }
                                tabs.switch_to(new_id);
                                apply_layout_and_visibility(
                                    &window,
                                    &chrome_wv,
                                    &mut tabs,
                                    &mut content_webviews,
                                    &proxy,
                                    current_content_rect,
                                    is_overlay_open,
                                    &mut storage,
                                    is_incognito,
                                    &mut split,
                                    &watchdog,
                                );
                            }
                            sync_chrome_ui(
                                &chrome_wv,
                                &tabs,
                                &groups,
                                &content_webviews,
                                &mut storage,
                                is_incognito,
                                &split,
                            );
                        }
                    }

                    UiMessage::CloseOtherTabs { tab_id } => {
                        let closed = tabs.close_others(tab_id);
                        let closed_any = !closed.is_empty();
                        for cid in closed {
                            if split.contains_tab(cid) {
                                clear_split_state(&mut split);
                            }
                            remove_tab_webview(&mut content_webviews, &mut split, cid);
                        }
                        apply_layout_and_visibility(
                            &window,
                            &chrome_wv,
                            &mut tabs,
                            &mut content_webviews,
                            &proxy,
                            current_content_rect,
                            is_overlay_open,
                            &mut storage,
                            is_incognito,
                            &mut split,
                            &watchdog,
                        );
                        sync_chrome_ui(
                            &chrome_wv,
                            &tabs,
                            &groups,
                            &content_webviews,
                            &mut storage,
                            is_incognito,
                            &split,
                        );
                        if closed_any {
                            emit_pet_event(&chrome_wv, &tabs, &content_webviews, &mut storage, "tab_closed");
                        }
                    }

                    UiMessage::CloseTabsBelow { tab_id } => {
                        let closed = tabs.close_below(tab_id);
                        let closed_any = !closed.is_empty();
                        for cid in closed {
                            if split.contains_tab(cid) {
                                clear_split_state(&mut split);
                            }
                            remove_tab_webview(&mut content_webviews, &mut split, cid);
                        }
                        apply_layout_and_visibility(
                            &window,
                            &chrome_wv,
                            &mut tabs,
                            &mut content_webviews,
                            &proxy,
                            current_content_rect,
                            is_overlay_open,
                            &mut storage,
                            is_incognito,
                            &mut split,
                            &watchdog,
                        );
                        sync_chrome_ui(
                            &chrome_wv,
                            &tabs,
                            &groups,
                            &content_webviews,
                            &mut storage,
                            is_incognito,
                            &split,
                        );
                        if closed_any {
                            emit_pet_event(&chrome_wv, &tabs, &content_webviews, &mut storage, "tab_closed");
                        }
                    }

                    UiMessage::CreateGroup { name, color, tab_id } => {
                        let gid = format!(
                            "grp_{}",
                            std::time::SystemTime::now()
                                .duration_since(std::time::UNIX_EPOCH)
                                .map(|d| d.as_millis())
                                .unwrap_or(1)
                        );
                        let color_val = color.unwrap_or_else(|| "#3b82f6".to_string());
                        groups.push(TabGroup {
                            id: gid.clone(),
                            name,
                            color: color_val,
                            collapsed: false,
                        });
                        if let Some(tid) = tab_id {
                            tabs.set_group(tid, Some(gid));
                        }
                        sync_chrome_ui(
                            &chrome_wv,
                            &tabs,
                            &groups,
                            &content_webviews,
                            &mut storage,
                            is_incognito,
                            &split,
                        );
                    }

                    UiMessage::SetTabGroup { tab_id, group_id } => {
                        tabs.set_group(tab_id, group_id);
                        sync_chrome_ui(
                            &chrome_wv,
                            &tabs,
                            &groups,
                            &content_webviews,
                            &mut storage,
                            is_incognito,
                            &split,
                        );
                    }

                    UiMessage::ToggleGroupCollapse { group_id } => {
                        if let Some(g) = groups.iter_mut().find(|g| g.id == group_id) {
                            g.collapsed = !g.collapsed;
                        }
                        sync_chrome_ui(
                            &chrome_wv,
                            &tabs,
                            &groups,
                            &content_webviews,
                            &mut storage,
                            is_incognito,
                            &split,
                        );
                    }

                    UiMessage::SleepTab { tab_id } => {
                        if tabs.active_id() != Some(tab_id) && !split.contains_tab(tab_id) {
                            remove_tab_webview(&mut content_webviews, &mut split, tab_id);
                            let scroll = tabs.get(tab_id).map(|t| t.scroll_y).unwrap_or(0.0);
                            tabs.mark_discarded(tab_id, scroll);
                            println!("[memory] Manual tab discard: sleeping tab #{tab_id}");
                            sync_chrome_ui(
                                &chrome_wv,
                                &tabs,
                                &groups,
                                &content_webviews,
                                &mut storage,
                                is_incognito,
                                &split,
                            );
                        }
                    }

                    UiMessage::WakeTab { tab_id } => {
                        if split.enabled {
                            if let Some(pane) = split.pane_for_tab(tab_id) {
                                split.focused_pane = pane;
                            } else if split.focused_pane == 1 {
                                split.right_tab_id = Some(tab_id);
                            } else {
                                split.left_tab_id = Some(tab_id);
                            }
                        }
                        tabs.switch_to(tab_id);
                        apply_layout_and_visibility(
                            &window,
                            &chrome_wv,
                            &mut tabs,
                            &mut content_webviews,
                            &proxy,
                            current_content_rect,
                            is_overlay_open,
                            &mut storage,
                            is_incognito,
                            &mut split,
                            &watchdog,
                        );
                        sync_chrome_ui(
                            &chrome_wv,
                            &tabs,
                            &groups,
                            &content_webviews,
                            &mut storage,
                            is_incognito,
                            &split,
                        );
                    }

                    UiMessage::ToggleBookmark { url } => {
                        let target_url = url.or_else(|| tabs.active_tab().map(|t| t.url.clone()));
                        if let Some(u) = target_url {
                            let title = tabs.active_tab().map(|t| t.title.as_str()).unwrap_or("Bookmark");
                            storage.toggle_bookmark(&u, title);
                        }
                        sync_chrome_ui(
                            &chrome_wv,
                            &tabs,
                            &groups,
                            &content_webviews,
                            &mut storage,
                            is_incognito,
                            &split,
                        );
                    }

                    UiMessage::SetSetting { key, value } => {
                        let old_skin = storage.settings().skin.clone();
                        let old_weather_loc = storage.settings().weather_location.clone();
                        if storage.set_setting(&key, &value) {
                            println!("[settings] Updated `{key}` = {value}");
                            if key == "weather_location" && storage.settings().weather_location != old_weather_loc {
                                let new_loc = storage.settings().weather_location.trim().to_owned();
                                latest_weather = None;
                                last_weather_error = None;
                                last_weather_request = if new_loc.is_empty() {
                                    None
                                } else {
                                    Some(weather::WeatherRequest::City(new_loc))
                                };
                            }
                            let skin_changed = key == "skin" && storage.settings().skin != old_skin;
                            if skin_changed {
                                is_overlay_open = false;
                                let nt_target = resolve_content_url_with_settings("about:blank", storage.settings());
                                for (tid, wv) in &content_webviews {
                                    if tabs.get(*tid).map(|t| is_newtab_url(&t.url)).unwrap_or(false) {
                                        let _ = wv.load_url(&nt_target);
                                    }
                                }
                                apply_layout_and_visibility(
                                    &window,
                                    &chrome_wv,
                                    &mut tabs,
                                    &mut content_webviews,
                                    &proxy,
                                    current_content_rect,
                                    is_overlay_open,
                                    &mut storage,
                                    is_incognito,
                                    &mut split,
                                    &watchdog,
                                );
                                let sync_msg = json!({
                                    "type": "ui_settings_sync",
                                    "settings": storage.settings().to_ui_json(),
                                });
                                broadcast_to_internal_views(&chrome_wv, &tabs, &content_webviews, &sync_msg);
                            } else {
                                let sync_msg = json!({
                                    "type": "ui_settings_sync",
                                    "settings": storage.settings().to_ui_json(),
                                });
                                broadcast_to_internal_views(&chrome_wv, &tabs, &content_webviews, &sync_msg);
                            }
                        }
                    }

                    UiMessage::SaveSettings { settings } => {
                        let old_skin = storage.settings().skin.clone();
                        let old_weather_loc = storage.settings().weather_location.clone();
                        if storage.merge_settings_json(&settings) {
                            println!("[settings] Saved updated browser settings");
                            if storage.settings().weather_location != old_weather_loc {
                                let new_loc = storage.settings().weather_location.trim().to_owned();
                                latest_weather = None;
                                last_weather_error = None;
                                last_weather_request = if new_loc.is_empty() {
                                    None
                                } else {
                                    Some(weather::WeatherRequest::City(new_loc))
                                };
                            }
                            if storage.settings().skin != old_skin {
                                is_overlay_open = false;
                                let nt_target = resolve_content_url_with_settings("about:blank", storage.settings());
                                for (tid, wv) in &content_webviews {
                                    if tabs.get(*tid).map(|t| is_newtab_url(&t.url)).unwrap_or(false) {
                                        let _ = wv.load_url(&nt_target);
                                    }
                                }
                                apply_layout_and_visibility(
                                    &window,
                                    &chrome_wv,
                                    &mut tabs,
                                    &mut content_webviews,
                                    &proxy,
                                    current_content_rect,
                                    is_overlay_open,
                                    &mut storage,
                                    is_incognito,
                                    &mut split,
                                    &watchdog,
                                );
                            }
                            let sync_msg = json!({
                                "type": "ui_settings_sync",
                                "settings": storage.settings().to_ui_json(),
                            });
                            broadcast_to_internal_views(&chrome_wv, &tabs, &content_webviews, &sync_msg);
                        }
                    }

                    UiMessage::FetchWeather {
                        location,
                        lat,
                        lon,
                        label,
                        country,
                        force,
                    } => {
                        let prev_loc = storage.settings().weather_location.clone();
                        let query_loc = match location {
                            Some(ref loc) => {
                                let trimmed = loc.trim().to_owned();
                                if trimmed != prev_loc {
                                    storage.set_setting("weather_location", &json!(trimmed));
                                }
                                trimmed
                            }
                            None => prev_loc.clone(),
                        };

                        let coords_opt = match (lat, lon) {
                            (Some(la), Some(lo))
                                if la.is_finite()
                                    && lo.is_finite()
                                    && (-90.0..=90.0).contains(&la)
                                    && (-180.0..=180.0).contains(&lo) =>
                            {
                                Some((la, lo))
                            }
                            _ => None,
                        };

                        let req_opt = if let Some((la, lo)) = coords_opt {
                            Some(weather::WeatherRequest::Coords {
                                lat: la,
                                lon: lo,
                                label,
                                country,
                                query: query_loc.clone(),
                            })
                        } else if !query_loc.is_empty() && !query_loc.eq_ignore_ascii_case("auto") {
                            Some(weather::WeatherRequest::City(query_loc.clone()))
                        } else {
                            last_weather_request.clone()
                        };

                        if let Some(req) = req_opt {
                            let req_changed = match (&last_weather_request, &req) {
                                (Some(weather::WeatherRequest::City(a)), weather::WeatherRequest::City(b)) => {
                                    !a.eq_ignore_ascii_case(b)
                                }
                                (
                                    Some(weather::WeatherRequest::Coords {
                                        lat: la1,
                                        lon: lo1,
                                        ..
                                    }),
                                    weather::WeatherRequest::Coords {
                                        lat: la2,
                                        lon: lo2,
                                        ..
                                    },
                                ) => (la1 - la2).abs() > 0.05 || (lo1 - lo2).abs() > 0.05,
                                _ => true,
                            };

                            let force_flag = force.unwrap_or(false);
                            last_weather_request = Some(req.clone());

                            if force_flag || req_changed || latest_weather.is_none() {
                                last_weather_fetch = Instant::now();
                                spawn_weather_fetch(
                                    proxy.clone(),
                                    req,
                                    force_flag,
                                    storage.data_dir().to_path_buf(),
                                );
                            } else if let Some(w) = &latest_weather {
                                let w_msg = build_weather_payload(w);
                                broadcast_to_newtab_views(&tabs, &content_webviews, &w_msg);
                            }
                        } else {
                            let err_msg = json!({
                                "type": "weather_error",
                                "message": "Set a city or click Use my location",
                            });
                            broadcast_to_newtab_views(&tabs, &content_webviews, &err_msg);
                        }
                    }

                    UiMessage::OpenSettings => {
                        eval_on_webview(&chrome_wv, &json!({ "type": "open_settings" }));
                    }

                    UiMessage::OpenCommandPalette => {
                        eval_on_webview(&chrome_wv, &json!({ "type": "open_command_palette" }));
                    }

                    UiMessage::OpenSidePanel { panel } => {
                        eval_on_webview(
                            &chrome_wv,
                            &json!({ "type": "open_side_panel", "panel": panel }),
                        );
                    }

                    UiMessage::OpenFindBar => {
                        eval_on_webview(&chrome_wv, &json!({ "type": "open_find_bar" }));
                    }

                    UiMessage::FocusOmnibox => {
                        let _ = chrome_wv.focus();
                        eval_on_webview(&chrome_wv, &json!({ "type": "focus_omnibox" }));
                    }

                    UiMessage::CopyToClipboard { text } => {
                        #[cfg(target_os = "windows")]
                        {
                            let _ = win32_platform::write_clipboard_text(&text);
                        }
                        #[cfg(not(target_os = "windows"))]
                        let _ = text;
                    }

                    UiMessage::Zoom { level } => {
                        if let Some(active_id) = tabs.active_id() {
                            if let Some(tab) = tabs.get_mut(active_id) {
                                tab.zoom_level = level.clamp(0.25, 4.0);
                                if let Some(wv) = content_webviews.get(&active_id) {
                                    let _ = wv.zoom(tab.zoom_level);
                                }
                            }
                            sync_chrome_ui(
                                &chrome_wv,
                                &tabs,
                                &groups,
                                &content_webviews,
                                &mut storage,
                                is_incognito,
                                &split,
                            );
                        }
                    }

                    UiMessage::ZoomIn => {
                        if let Some(active_id) = tabs.active_id() {
                            if let Some(tab) = tabs.get_mut(active_id) {
                                tab.zoom_level = (tab.zoom_level + 0.1).min(3.0);
                                let zoom = tab.zoom_level;
                                if let Some(wv) = content_webviews.get(&active_id) {
                                    let _ = wv.zoom(zoom);
                                }
                            }
                            sync_chrome_ui(
                                &chrome_wv,
                                &tabs,
                                &groups,
                                &content_webviews,
                                &mut storage,
                                is_incognito,
                                &split,
                            );
                        }
                    }

                    UiMessage::ZoomOut => {
                        if let Some(active_id) = tabs.active_id() {
                            if let Some(tab) = tabs.get_mut(active_id) {
                                tab.zoom_level = (tab.zoom_level - 0.1).max(0.3);
                                let zoom = tab.zoom_level;
                                if let Some(wv) = content_webviews.get(&active_id) {
                                    let _ = wv.zoom(zoom);
                                }
                            }
                            sync_chrome_ui(
                                &chrome_wv,
                                &tabs,
                                &groups,
                                &content_webviews,
                                &mut storage,
                                is_incognito,
                                &split,
                            );
                        }
                    }

                    UiMessage::ZoomReset => {
                        if let Some(active_id) = tabs.active_id() {
                            if let Some(tab) = tabs.get_mut(active_id) {
                                tab.zoom_level = 1.0;
                                if let Some(wv) = content_webviews.get(&active_id) {
                                    let _ = wv.zoom(1.0);
                                }
                            }
                            sync_chrome_ui(
                                &chrome_wv,
                                &tabs,
                                &groups,
                                &content_webviews,
                                &mut storage,
                                is_incognito,
                                &split,
                            );
                        }
                    }

                    UiMessage::FindInPage { query, forward, match_case } => {
                        if let Some(active_id) = tabs.active_id() {
                            if let Some(wv) = content_webviews.get(&active_id) {
                                let backwards = !forward.unwrap_or(true);
                                let case_sens = match_case.unwrap_or(false);
                                let js = format!(
                                    "window.find({:?}, {}, {}, true, false, false, false);",
                                    query, case_sens, backwards
                                );
                                let _ = wv.evaluate_script(&js);
                            }
                        }
                    }

                    UiMessage::FindClose => {
                        if let Some(active_id) = tabs.active_id() {
                            if let Some(wv) = content_webviews.get(&active_id) {
                                let _ = wv.evaluate_script(
                                    "window.getSelection() && window.getSelection().removeAllRanges();",
                                );
                            }
                        }
                    }

                    UiMessage::ClearBrowsingData { history, .. } => {
                        if history.unwrap_or(false) {
                            println!("[storage] Cleared browsing history");
                            storage.clear_history();
                        }
                        sync_chrome_ui(
                            &chrome_wv,
                            &tabs,
                            &groups,
                            &content_webviews,
                            &mut storage,
                            is_incognito,
                            &split,
                        );
                    }

                    UiMessage::NewWindow { incognito } => {
                        if let Ok(exe) = env::current_exe() {
                            let mut cmd = std::process::Command::new(exe);
                            if incognito.unwrap_or(false) {
                                cmd.arg("--incognito");
                            }
                            let _ = cmd.spawn();
                        }
                    }

                    UiMessage::SplitView { enabled } => {
                        watchdog.set_phase(LoopPhase::SplitViewHandler);
                        let _ = proxy.send_event(UserEvent::ApplySplitView { enabled });
                    }

                    UiMessage::SplitClose => {
                        watchdog.set_phase(LoopPhase::SplitViewHandler);
                        let _ = proxy.send_event(UserEvent::ApplySplitView {
                            enabled: Some(false),
                        });
                    }

                    UiMessage::SplitSwap => {
                        if split.enabled {
                            watchdog.set_phase(LoopPhase::SplitViewHandler);
                            std::mem::swap(&mut split.left_tab_id, &mut split.right_tab_id);
                            split.focused_pane = if split.focused_pane == 1 { 0 } else { 1 };
                            if let Some(tid) = split.tab_for_pane(split.focused_pane) {
                                tabs.switch_to(tid);
                            }
                            apply_layout_and_visibility(
                                &window,
                                &chrome_wv,
                                &mut tabs,
                                &mut content_webviews,
                                &proxy,
                                current_content_rect,
                                is_overlay_open,
                                &mut storage,
                                is_incognito,
                                &mut split,
                                &watchdog,
                            );
                            sync_chrome_ui(
                                &chrome_wv,
                                &tabs,
                                &groups,
                                &content_webviews,
                                &mut storage,
                                is_incognito,
                                &split,
                            );
                        }
                    }

                    UiMessage::SplitFocus { pane } => {
                        if split.enabled {
                            let p = if pane == 1 { 1 } else { 0 };
                            split.focused_pane = p;
                            if let Some(tid) = split.tab_for_pane(p) {
                                tabs.switch_to(tid);
                                if let Some(tab) = tabs.get(tid) {
                                    let suffix = if is_incognito {
                                        " — Rusty Browser (Private)"
                                    } else {
                                        " — Rusty Browser"
                                    };
                                    window.set_title(&format!("{}{suffix}", tab.title));
                                }
                            }
                            sync_chrome_ui(
                                &chrome_wv,
                                &tabs,
                                &groups,
                                &content_webviews,
                                &mut storage,
                                is_incognito,
                                &split,
                            );
                        }
                    }

                    UiMessage::SplitNavigate { pane, url: raw_url } => {
                        let template = &storage.settings().default_search_template;
                        let url = url_resolver::resolve_with_template(&raw_url, template);
                        if split.enabled {
                            let p = if pane == 1 { 1 } else { 0 };
                            split.focused_pane = p;
                            if let Some(tid) = split.tab_for_pane(p) {
                                tabs.switch_to(tid);
                                if let Some(tab) = tabs.get_mut(tid) {
                                    tab.url = url.clone();
                                    tab.set_pending_nav(None);
                                    tab.record_navigation(&url);
                                }
                                apply_layout_and_visibility(
                                    &window,
                                    &chrome_wv,
                                    &mut tabs,
                                    &mut content_webviews,
                                    &proxy,
                                    current_content_rect,
                                    is_overlay_open,
                                    &mut storage,
                                    is_incognito,
                                    &mut split,
                                    &watchdog,
                                );
                                if let Some(wv) = content_webviews.get(&tid) {
                                    load_target_url(wv, &url, &mut storage);
                                    if !url.starts_with("about:") && !is_trusted_origin(&url) {
                                        emit_pet_event(&chrome_wv, &tabs, &content_webviews, &mut storage, "page_loading");
                                        if !is_incognito {
                                            let title = tabs.get(tid).map(|t| t.title.as_str()).unwrap_or("");
                                            storage.record_history(&url, title);
                                        }
                                    }
                                }
                            }
                            sync_chrome_ui(
                                &chrome_wv,
                                &tabs,
                                &groups,
                                &content_webviews,
                                &mut storage,
                                is_incognito,
                                &split,
                            );
                        }
                    }

                    UiMessage::ToggleReader { .. } => {
                        // Reader toggle
                    }

                    UiMessage::SaveScroll { scroll_y } => {
                        if let Some(id) = tabs.active_id() {
                            if let Some(sy) = scroll_y {
                                tabs.update_scroll(id, sy);
                            }
                        }
                    }

                    UiMessage::NextTab => {
                        let old_id = tabs.active_id();
                        tabs.next_tab();
                        let new_id = tabs.active_id();
                        if old_id != new_id {
                            if let Some(tid) = new_id {
                                if split.enabled {
                                    if let Some(pane) = split.pane_for_tab(tid) {
                                        split.focused_pane = pane;
                                    } else if split.focused_pane == 1 {
                                        split.right_tab_id = Some(tid);
                                    } else {
                                        split.left_tab_id = Some(tid);
                                    }
                                }
                            }
                            apply_layout_and_visibility(
                                &window,
                                &chrome_wv,
                                &mut tabs,
                                &mut content_webviews,
                                &proxy,
                                current_content_rect,
                                is_overlay_open,
                                &mut storage,
                                is_incognito,
                                &mut split,
                                &watchdog,
                            );
                            sync_chrome_ui(
                                &chrome_wv,
                                &tabs,
                                &groups,
                                &content_webviews,
                                &mut storage,
                                is_incognito,
                                &split,
                            );
                        }
                    }

                    UiMessage::PrevTab => {
                        let old_id = tabs.active_id();
                        tabs.prev_tab();
                        let new_id = tabs.active_id();
                        if old_id != new_id {
                            if let Some(tid) = new_id {
                                if split.enabled {
                                    if let Some(pane) = split.pane_for_tab(tid) {
                                        split.focused_pane = pane;
                                    } else if split.focused_pane == 1 {
                                        split.right_tab_id = Some(tid);
                                    } else {
                                        split.left_tab_id = Some(tid);
                                    }
                                }
                            }
                            apply_layout_and_visibility(
                                &window,
                                &chrome_wv,
                                &mut tabs,
                                &mut content_webviews,
                                &proxy,
                                current_content_rect,
                                is_overlay_open,
                                &mut storage,
                                is_incognito,
                                &mut split,
                                &watchdog,
                            );
                            sync_chrome_ui(
                                &chrome_wv,
                                &tabs,
                                &groups,
                                &content_webviews,
                                &mut storage,
                                is_incognito,
                                &split,
                            );
                        }
                    }

                    UiMessage::DiscardBackgroundTabs => {
                        discard_inactive_tabs(
                            &mut tabs,
                            &mut content_webviews,
                            Duration::ZERO,
                            &chrome_wv,
                            &groups,
                            &mut storage,
                            is_incognito,
                            &mut split,
                        );
                    }

                    UiMessage::OpenPrivateWindow => {
                        if let Ok(exe) = env::current_exe() {
                            let _ = std::process::Command::new(exe).arg("--incognito").spawn();
                        }
                    }

                    UiMessage::ClearHistory => {
                        storage.clear_history();
                        sync_chrome_ui(
                            &chrome_wv,
                            &tabs,
                            &groups,
                            &content_webviews,
                            &mut storage,
                            is_incognito,
                            &split,
                        );
                    }

                    UiMessage::ClearBookmarks => {
                        storage.clear_bookmarks();
                        sync_chrome_ui(
                            &chrome_wv,
                            &tabs,
                            &groups,
                            &content_webviews,
                            &mut storage,
                            is_incognito,
                            &split,
                        );
                    }

                    UiMessage::ClearDownloads => {
                        storage.clear_downloads();
                        sync_chrome_ui(
                            &chrome_wv,
                            &tabs,
                            &groups,
                            &content_webviews,
                            &mut storage,
                            is_incognito,
                            &split,
                        );
                    }

                    UiMessage::SwitchWorkspace { workspace_id } => {
                        workspaces.sync_current_tabs(&tabs);
                        if let Some((target_tabs, active_idx)) = workspaces.switch_workspace(&workspace_id, &tabs) {
                            for id in tabs.all_ids() {
                                remove_tab_webview(&mut content_webviews, &mut split, id);
                            }
                            content_webviews.clear();
                            split.applied_bounds.clear();
                            split.applied_visible.clear();
                            tabs.restore_from_metadata(&target_tabs, active_idx);
                            storage.save_workspaces(workspaces.workspaces().to_vec(), workspaces.active_id().to_owned());
                            let ws_msg = json!({
                                "type": "workspaces_update",
                                "workspaces": workspaces.summaries(tabs.count()),
                                "active_workspace_id": workspaces.active_id(),
                            });
                            broadcast_to_internal_views(&chrome_wv, &tabs, &content_webviews, &ws_msg);
                            apply_layout_and_visibility(
                                &window,
                                &chrome_wv,
                                &mut tabs,
                                &mut content_webviews,
                                &proxy,
                                current_content_rect,
                                is_overlay_open,
                                &mut storage,
                                is_incognito,
                                &mut split,
                                &watchdog,
                            );
                            sync_chrome_ui(
                                &chrome_wv,
                                &tabs,
                                &groups,
                                &content_webviews,
                                &mut storage,
                                is_incognito,
                                &split,
                            );

                            if let Some(target_ws) = workspaces.get(&workspace_id) {
                                let focus_msg_opt = if let Ok(mut fm) = global_focus_manager().lock() {
                                    fm.on_workspace_switch(&target_ws.name).map(|_suggested| {
                                        json!({
                                            "type": "focus_state_changed",
                                            "state": fm.state()
                                        })
                                    })
                                } else {
                                    None
                                };
                                if let Some(focus_msg) = focus_msg_opt {
                                    broadcast_focus_state_to_all(&chrome_wv, &tabs, &content_webviews, &focus_msg);
                                    enforce_focus_on_open_tabs(&tabs, &content_webviews);
                                }
                            }
                        }
                    }

                    UiMessage::CreateWorkspace { name, icon, color, is_isolated } => {
                        let ws_id = workspaces.create_workspace(name, icon, color, is_isolated.unwrap_or(false));
                        workspaces.sync_current_tabs(&tabs);
                        storage.save_workspaces(workspaces.workspaces().to_vec(), workspaces.active_id().to_owned());
                        let ws_msg = json!({
                            "type": "workspaces_update",
                            "workspaces": workspaces.summaries(tabs.count()),
                            "active_workspace_id": workspaces.active_id(),
                        });
                        broadcast_to_internal_views(&chrome_wv, &tabs, &content_webviews, &ws_msg);
                        let _ = ws_id;
                    }

                    UiMessage::RenameWorkspace { workspace_id, name } => {
                        if workspaces.rename_workspace(&workspace_id, name) {
                            storage.save_workspaces(workspaces.workspaces().to_vec(), workspaces.active_id().to_owned());
                            let ws_msg = json!({
                                "type": "workspaces_update",
                                "workspaces": workspaces.summaries(tabs.count()),
                                "active_workspace_id": workspaces.active_id(),
                            });
                            broadcast_to_internal_views(&chrome_wv, &tabs, &content_webviews, &ws_msg);
                        }
                    }

                    UiMessage::DeleteWorkspace { workspace_id } => {
                        let active_before = workspaces.active_id().to_owned();
                        if let Ok(Some(deleted_ws)) = workspaces.delete_workspace(&workspace_id) {
                            if active_before == workspace_id {
                                let new_active = workspaces.active_id().to_owned();
                                if let Some((target_tabs, active_idx)) = workspaces.switch_workspace(&new_active, &tabs) {
                                    for id in tabs.all_ids() {
                                        remove_tab_webview(&mut content_webviews, &mut split, id);
                                    }
                                    content_webviews.clear();
                                    split.applied_bounds.clear();
                                    split.applied_visible.clear();
                                    tabs.restore_from_metadata(&target_tabs, active_idx);
                                    apply_layout_and_visibility(
                                        &window,
                                        &chrome_wv,
                                        &mut tabs,
                                        &mut content_webviews,
                                        &proxy,
                                        current_content_rect,
                                        is_overlay_open,
                                        &mut storage,
                                        is_incognito,
                                        &mut split,
                                        &watchdog,
                                    );
                                    sync_chrome_ui(&chrome_wv, &tabs, &groups, &content_webviews, &mut storage, is_incognito, &split);
                                }
                            }
                            storage.save_workspaces(workspaces.workspaces().to_vec(), workspaces.active_id().to_owned());
                            let ws_msg = json!({
                                "type": "workspaces_update",
                                "workspaces": workspaces.summaries(tabs.count()),
                                "active_workspace_id": workspaces.active_id(),
                                "can_undo": true,
                                "deleted_workspace": deleted_ws,
                            });
                            broadcast_to_internal_views(&chrome_wv, &tabs, &content_webviews, &ws_msg);
                        }
                    }

                    UiMessage::UndoDeleteWorkspace => {
                        if let Some(restored_id) = workspaces.undo_delete() {
                            storage.save_workspaces(workspaces.workspaces().to_vec(), workspaces.active_id().to_owned());
                            let ws_msg = json!({
                                "type": "workspaces_update",
                                "workspaces": workspaces.summaries(tabs.count()),
                                "active_workspace_id": workspaces.active_id(),
                                "can_undo": workspaces.has_undo(),
                            });
                            broadcast_to_internal_views(&chrome_wv, &tabs, &content_webviews, &ws_msg);
                            let _ = restored_id;
                        }
                    }

                    UiMessage::ReorderWorkspaces { workspace_ids } => {
                        if workspaces.reorder_workspaces(&workspace_ids) {
                            storage.save_workspaces(workspaces.workspaces().to_vec(), workspaces.active_id().to_owned());
                            let ws_msg = json!({
                                "type": "workspaces_update",
                                "workspaces": workspaces.summaries(tabs.count()),
                                "active_workspace_id": workspaces.active_id(),
                            });
                            broadcast_to_internal_views(&chrome_wv, &tabs, &content_webviews, &ws_msg);
                        }
                    }

                    UiMessage::MoveTabToWorkspace { tab_id, target_workspace_id } => {
                        if let Some(tab) = tabs.get(tab_id) {
                            let meta = workspace::TabMetadata {
                                url: tab.url.clone(),
                                title: tab.title.clone(),
                                favicon: tab.favicon.clone(),
                                scroll_y: tab.scroll_y,
                                pinned: tab.pinned,
                                muted: tab.muted,
                                group_id: tab.group_id.clone(),
                                nav_history: tab.nav_history().to_vec(),
                                nav_index: tab.nav_index(),
                            };
                            remove_tab_webview(&mut content_webviews, &mut split, tab_id);
                            tabs.close_tab(tab_id);
                            if tabs.count() == 0 {
                                let new_id = tabs.create_tab("about:blank".to_owned());
                                tabs.switch_to(new_id);
                            }
                            workspaces.move_tab_to_workspace(meta, &target_workspace_id);
                            workspaces.sync_current_tabs(&tabs);
                            storage.save_workspaces(workspaces.workspaces().to_vec(), workspaces.active_id().to_owned());
                            let ws_msg = json!({
                                "type": "workspaces_update",
                                "workspaces": workspaces.summaries(tabs.count()),
                                "active_workspace_id": workspaces.active_id(),
                            });
                            broadcast_to_internal_views(&chrome_wv, &tabs, &content_webviews, &ws_msg);
                            apply_layout_and_visibility(
                                &window,
                                &chrome_wv,
                                &mut tabs,
                                &mut content_webviews,
                                &proxy,
                                current_content_rect,
                                is_overlay_open,
                                &mut storage,
                                is_incognito,
                                &mut split,
                                &watchdog,
                            );
                            sync_chrome_ui(&chrome_wv, &tabs, &groups, &content_webviews, &mut storage, is_incognito, &split);
                        }
                    }

                    UiMessage::RestoreRecentlyClosedTab { workspace_id } => {
                        let ws_id = match workspace_id {
                            Some(ref id) => id.clone(),
                            None => workspaces.active_id().to_owned(),
                        };
                        if let Some(meta) = workspaces.pop_recently_closed(&ws_id) {
                            let new_id = tabs.create_tab(meta.url);
                            if let Some(t) = tabs.get_mut(new_id) {
                                t.title = meta.title;
                                t.pinned = meta.pinned;
                                t.muted = meta.muted;
                            }
                            tabs.switch_to(new_id);
                            workspaces.sync_current_tabs(&tabs);
                            storage.save_workspaces(workspaces.workspaces().to_vec(), workspaces.active_id().to_owned());
                            apply_layout_and_visibility(
                                &window,
                                &chrome_wv,
                                &mut tabs,
                                &mut content_webviews,
                                &proxy,
                                current_content_rect,
                                is_overlay_open,
                                &mut storage,
                                is_incognito,
                                &mut split,
                                &watchdog,
                            );
                            let ws_msg = json!({
                                "type": "workspaces_update",
                                "workspaces": workspaces.summaries(tabs.count()),
                                "active_workspace_id": workspaces.active_id(),
                            });
                            broadcast_to_internal_views(&chrome_wv, &tabs, &content_webviews, &ws_msg);
                            sync_chrome_ui(&chrome_wv, &tabs, &groups, &content_webviews, &mut storage, is_incognito, &split);
                        }
                    }

                    UiMessage::ToggleFocus => {
                        let state_opt = if let Ok(mut fm) = global_focus_manager().lock() {
                            if fm.state().is_active {
                                fm.stop();
                            } else {
                                fm.start(focus::FocusModeKind::Study, None);
                            }
                            Some(fm.state())
                        } else {
                            None
                        };
                        if let Some(state) = state_opt {
                            let active = state.is_active;
                            let msg = json!({
                                "type": "focus_state_changed",
                                "state": state
                            });
                            broadcast_focus_state_to_all(&chrome_wv, &tabs, &content_webviews, &msg);
                            if active {
                                enforce_focus_on_open_tabs(&tabs, &content_webviews);
                            }
                            sync_chrome_ui(&chrome_wv, &tabs, &groups, &content_webviews, &mut storage, is_incognito, &split);
                        }
                    }

                    UiMessage::StartFocus { mode, duration_secs } => {
                        let kind = match mode.to_lowercase().as_str() {
                            "work" => focus::FocusModeKind::Work,
                            "deep" | "deep work" => focus::FocusModeKind::Deep,
                            _ => focus::FocusModeKind::Study,
                        };
                        let state_opt = if let Ok(mut fm) = global_focus_manager().lock() {
                            fm.start(kind, duration_secs);
                            Some(fm.state())
                        } else {
                            None
                        };
                        if let Some(state) = state_opt {
                            let msg = json!({
                                "type": "focus_state_changed",
                                "state": state
                            });
                            broadcast_focus_state_to_all(&chrome_wv, &tabs, &content_webviews, &msg);
                            enforce_focus_on_open_tabs(&tabs, &content_webviews);
                            sync_chrome_ui(&chrome_wv, &tabs, &groups, &content_webviews, &mut storage, is_incognito, &split);
                        }
                    }

                    UiMessage::PauseFocus => {
                        let state_opt = if let Ok(mut fm) = global_focus_manager().lock() {
                            fm.pause();
                            Some(fm.state())
                        } else {
                            None
                        };
                        if let Some(state) = state_opt {
                            let msg = json!({
                                "type": "focus_state_changed",
                                "state": state
                            });
                            broadcast_focus_state_to_all(&chrome_wv, &tabs, &content_webviews, &msg);
                            sync_chrome_ui(&chrome_wv, &tabs, &groups, &content_webviews, &mut storage, is_incognito, &split);
                        }
                    }

                    UiMessage::ResumeFocus => {
                        let state_opt = if let Ok(mut fm) = global_focus_manager().lock() {
                            fm.resume();
                            Some(fm.state())
                        } else {
                            None
                        };
                        if let Some(state) = state_opt {
                            let active = state.is_active && !state.is_paused;
                            let msg = json!({
                                "type": "focus_state_changed",
                                "state": state
                            });
                            broadcast_focus_state_to_all(&chrome_wv, &tabs, &content_webviews, &msg);
                            if active {
                                enforce_focus_on_open_tabs(&tabs, &content_webviews);
                            }
                            sync_chrome_ui(&chrome_wv, &tabs, &groups, &content_webviews, &mut storage, is_incognito, &split);
                        }
                    }

                    UiMessage::StopFocus => {
                        let state_opt = if let Ok(mut fm) = global_focus_manager().lock() {
                            fm.stop();
                            Some(fm.state())
                        } else {
                            None
                        };
                        if let Some(state) = state_opt {
                            let msg = json!({
                                "type": "focus_state_changed",
                                "state": state
                            });
                            broadcast_focus_state_to_all(&chrome_wv, &tabs, &content_webviews, &msg);
                            sync_chrome_ui(&chrome_wv, &tabs, &groups, &content_webviews, &mut storage, is_incognito, &split);
                        }
                    }

                    UiMessage::GetFocusState => {
                        let state_opt = if let Ok(fm) = global_focus_manager().lock() {
                            Some(fm.state())
                        } else {
                            None
                        };
                        if let Some(state) = state_opt {
                            let msg = json!({
                                "type": "focus_state_changed",
                                "state": state
                            });
                            broadcast_focus_state_to_all(&chrome_wv, &tabs, &content_webviews, &msg);
                            sync_chrome_ui(&chrome_wv, &tabs, &groups, &content_webviews, &mut storage, is_incognito, &split);
                        }
                    }

                    UiMessage::GetWorkspaces => {
                        let ws_msg = json!({
                            "type": "workspaces_update",
                            "workspaces": workspaces.summaries(tabs.count()),
                            "active_workspace_id": workspaces.active_id(),
                        });
                        broadcast_to_internal_views(&chrome_wv, &tabs, &content_webviews, &ws_msg);
                    }

                    UiMessage::GetSettings => {
                        let s_msg = json!({
                            "type": "ui_settings_sync",
                            "settings": storage.settings().to_ui_json(),
                        });
                        broadcast_to_internal_views(&chrome_wv, &tabs, &content_webviews, &s_msg);
                    }

                    UiMessage::BypassFocusDomain { domain, confirmation } => {
                        if let Ok(mut fm) = global_focus_manager().lock() {
                            let _ = fm.grant_bypass(&domain, &confirmation);
                        }
                    }

                    UiMessage::LaunchLocalApp { app } => {
                        let res = launch_safe_app(&app);
                        let resp = json!({
                            "type": "launch_app_result",
                            "app": app,
                            "success": res.is_ok(),
                            "error": res.err().map(|e| e.to_string()),
                        });
                        broadcast_to_internal_views(&chrome_wv, &tabs, &content_webviews, &resp);
                    }

                    UiMessage::GetMiniWidgetStat { widget } => {
                        let val = match widget.as_str() {
                            "tabs_count" => tabs.all_ids().len().to_string(),
                            "focus_time" => {
                                if let Ok(fm) = global_focus_manager().lock() {
                                    format!("{}m", fm.today_focus_mins())
                                } else {
                                    "0m".to_string()
                                }
                            }
                            "downloads_disk_space" => get_downloads_disk_space_string(&mut storage),
                            _ => "--".to_string(),
                        };
                        let resp = json!({
                            "type": "mini_widget_stat",
                            "widget": widget,
                            "value": val,
                        });
                        broadcast_to_internal_views(&chrome_wv, &tabs, &content_webviews, &resp);
                    }

                    UiMessage::LoadUnpackedExtension { path } => {
                        let path_buf = std::path::PathBuf::from(&path);
                        match extensions::load_unpacked_extension(&path_buf) {
                            Ok(ext) => {
                                storage.add_extension(ext.clone());
                                let resp = json!({
                                    "type": "extension_loaded",
                                    "success": true,
                                    "extension": ext,
                                });
                                broadcast_to_internal_views(&chrome_wv, &tabs, &content_webviews, &resp);
                            }
                            Err(e) => {
                                let resp = json!({
                                    "type": "extension_loaded",
                                    "success": false,
                                    "error": e.to_string(),
                                });
                                broadcast_to_internal_views(&chrome_wv, &tabs, &content_webviews, &resp);
                            }
                        }
                    }

                    UiMessage::ToggleExtension { id, enabled } => {
                        let changed = storage.toggle_extension(&id, enabled);
                        let resp = json!({
                            "type": "extension_toggled",
                            "id": id,
                            "enabled": enabled,
                            "success": changed,
                        });
                        broadcast_to_internal_views(&chrome_wv, &tabs, &content_webviews, &resp);
                    }

                    UiMessage::RemoveExtension { id } => {
                        let changed = storage.remove_extension(&id);
                        let resp = json!({
                            "type": "extension_removed",
                            "id": id,
                            "success": changed,
                        });
                        broadcast_to_internal_views(&chrome_wv, &tabs, &content_webviews, &resp);
                    }

                    UiMessage::InspectExtension { path } => {
                        let path_buf = std::path::PathBuf::from(&path);
                        let res = extensions::inspect_extension_directory(&path_buf);
                        let resp = match res {
                            Ok(inspection) => json!({
                                "type": "extension_inspection",
                                "success": true,
                                "inspection": inspection,
                            }),
                            Err(e) => json!({
                                "type": "extension_inspection",
                                "success": false,
                                "error": e.to_string(),
                            }),
                        };
                        broadcast_to_internal_views(&chrome_wv, &tabs, &content_webviews, &resp);
                    }

                    UiMessage::SaveUserScript { script } => {
                        storage.save_userscript(script.clone());
                        let resp = json!({
                            "type": "userscript_saved",
                            "success": true,
                            "script": script,
                        });
                        broadcast_to_internal_views(&chrome_wv, &tabs, &content_webviews, &resp);
                    }

                    UiMessage::ToggleUserScript { id, enabled } => {
                        let changed = storage.toggle_userscript(&id, enabled);
                        let resp = json!({
                            "type": "userscript_toggled",
                            "id": id,
                            "enabled": enabled,
                            "success": changed,
                        });
                        broadcast_to_internal_views(&chrome_wv, &tabs, &content_webviews, &resp);
                    }

                    UiMessage::DeleteUserScript { id } => {
                        let changed = storage.delete_userscript(&id);
                        let resp = json!({
                            "type": "userscript_deleted",
                            "id": id,
                            "success": changed,
                        });
                        broadcast_to_internal_views(&chrome_wv, &tabs, &content_webviews, &resp);
                    }

                    UiMessage::GetExtensionsAndScripts => {
                        let is_vault = storage.is_active_workspace_vault();
                        let resp = json!({
                            "type": "extensions_and_scripts",
                            "is_windows": cfg!(target_os = "windows"),
                            "is_linux": cfg!(target_os = "linux"),
                            "extensions_enabled": storage.settings().extensions_enabled,
                            "extensions": storage.settings().extensions,
                            "userscripts": storage.settings().userscripts,
                            "vault_active": is_vault,
                        });
                        broadcast_to_internal_views(&chrome_wv, &tabs, &content_webviews, &resp);
                    }

                    UiMessage::Unknown => {}
                }
                watchdog.ack();
            }

            // ── Title changed ──────────────────────────────────────────
            Event::UserEvent(UserEvent::TitleChanged(tab_id, title)) => {
                let mut is_external_tab = false;
                if let Some(tab) = tabs.get_mut(tab_id) {
                    tab.title = title.clone();
                    is_external_tab = !tab.url.starts_with("about:") && !is_trusted_origin(&tab.url);
                    if !is_incognito && is_external_tab {
                        storage.record_history(&tab.url, &title);
                    }
                }
                if tabs.active_id() == Some(tab_id) {
                    if let Some(tab) = tabs.get(tab_id) {
                        let suffix = if is_incognito { " — Rusty Browser (Private)" } else { " — Rusty Browser" };
                        window.set_title(&format!("{}{suffix}", tab.title));
                    }
                }
                sync_chrome_ui(
                    &chrome_wv,
                    &tabs,
                    &groups,
                    &content_webviews,
                    &mut storage,
                    is_incognito,
                    &split,
                );
                if is_external_tab {
                    emit_pet_event(&chrome_wv, &tabs, &content_webviews, &mut storage, "page_loaded");
                    let is_yt = tabs
                        .get(tab_id)
                        .map(|t| t.url.contains("youtube.com"))
                        .unwrap_or(false);
                    if is_yt {
                        let focus_msg_opt = if let Ok(fm) = global_focus_manager().lock() {
                            Some(json!({
                                "type": "focus_state_changed",
                                "state": fm.state()
                            }))
                        } else {
                            None
                        };
                        if let (Some(focus_msg), Some(wv)) = (focus_msg_opt, content_webviews.get(&tab_id)) {
                            let js = format!("if (window.__rustyOnFocusState) {{ window.__rustyOnFocusState({focus_msg}); }}");
                            let _ = wv.evaluate_script(&js);
                        }
                    }
                }
            }

            // ── URL changed ────────────────────────────────────────────
            Event::UserEvent(UserEvent::UrlChanged(tab_id, url)) => {
                let is_external = !url.starts_with("about:") && !is_trusted_origin(&url);
                if let Some(tab) = tabs.get_mut(tab_id) {
                    tab.url = url.clone();
                    tab.record_navigation(&url);
                    if !is_incognito && is_external {
                        storage.record_history(&url, &tab.title);
                    }
                }
                if tabs.active_id() == Some(tab_id) || split.contains_tab(tab_id) {
                    sync_chrome_ui(
                        &chrome_wv,
                        &tabs,
                        &groups,
                        &content_webviews,
                        &mut storage,
                        is_incognito,
                        &split,
                    );
                }
                if is_external {
                    emit_pet_event(&chrome_wv, &tabs, &content_webviews, &mut storage, "page_loading");
                    if url.contains("youtube.com") {
                        let focus_msg_opt = if let Ok(fm) = global_focus_manager().lock() {
                            Some(json!({
                                "type": "focus_state_changed",
                                "state": fm.state()
                            }))
                        } else {
                            None
                        };
                        if let (Some(focus_msg), Some(wv)) = (focus_msg_opt, content_webviews.get(&tab_id)) {
                            let js = format!("if (window.__rustyOnFocusState) {{ window.__rustyOnFocusState({focus_msg}); }}");
                            let _ = wv.evaluate_script(&js);
                        }
                    }
                }
            }

            // ── Re-check WebView2 URL after SPA pushState/popstate ─────
            Event::UserEvent(UserEvent::CheckTabUrl(tab_id)) => {
                if let Some(wv) = content_webviews.get(&tab_id) {
                    if let Ok(actual_url) = wv.url() {
                        let clean_url = if is_trusted_origin(&actual_url) && actual_url.contains("newtab.html") {
                            "about:blank".to_owned()
                        } else {
                            actual_url
                        };

                        // Enforce Focus Mode rules on SPA transitions too (history.pushState / popstate)
                        let focus_eval_opt = if is_safe_web_url(&clean_url) {
                            if let Ok(fm) = global_focus_manager().lock() {
                                Some((
                                    fm.check_url(&clean_url),
                                    json!({
                                        "type": "focus_state_changed",
                                        "state": fm.state()
                                    }),
                                ))
                            } else {
                                None
                            }
                        } else {
                            None
                        };

                        if let Some((decision, focus_msg)) = focus_eval_opt {
                            match decision {
                                focus::FocusDecision::Blocked { mode, domain: _, url: dest_url, remaining_secs } => {
                                    let interstitial_url = format!(
                                        "rusty://app/interstitial.html?url={}&mode={}&remaining={}",
                                        percent_encoding::percent_encode(dest_url.as_bytes(), percent_encoding::NON_ALPHANUMERIC),
                                        percent_encoding::percent_encode(mode.as_bytes(), percent_encoding::NON_ALPHANUMERIC),
                                        remaining_secs
                                    );
                                    let _ = wv.load_url(&interstitial_url);
                                    return;
                                }
                                focus::FocusDecision::Redirect(redirect_url) => {
                                    let _ = wv.load_url(&redirect_url);
                                    return;
                                }
                                focus::FocusDecision::Allowed => {
                                    if clean_url.contains("youtube.com") {
                                        let js = format!("if (window.__rustyOnFocusState) {{ window.__rustyOnFocusState({focus_msg}); }}");
                                        let _ = wv.evaluate_script(&js);
                                    }
                                }
                            }
                        }

                        let mut changed = false;
                        if let Some(tab) = tabs.get_mut(tab_id) {
                            if is_safe_web_url(&clean_url) || clean_url == "about:blank" {
                                if !tab::urls_equivalent(&tab.url, &clean_url) {
                                    tab.url = clean_url.clone();
                                    tab.record_navigation(&clean_url);
                                    changed = true;
                                    if !is_incognito && !clean_url.starts_with("about:") && !is_trusted_origin(&clean_url) {
                                        storage.record_history(&clean_url, &tab.title);
                                    }
                                } else if tab.url != clean_url {
                                    tab.url = clean_url.clone();
                                }
                            }
                        }
                        if changed && (tabs.active_id() == Some(tab_id) || split.contains_tab(tab_id)) {
                            sync_chrome_ui(
                                &chrome_wv,
                                &tabs,
                                &groups,
                                &content_webviews,
                                &mut storage,
                                is_incognito,
                                &split,
                            );
                        }
                    }
                }
            }

            // ── New window request from WebView2 (target=_blank / window.open) ─
            Event::UserEvent(UserEvent::OpenNewWindowTab { source_tab_id, url }) => {
                let target_url = if is_trusted_origin(&url) && url.contains("newtab.html") {
                    "about:blank".to_owned()
                } else {
                    url
                };
                let emit_loading = !target_url.starts_with("about:") && !is_trusted_origin(&target_url);
                let after_id = if tabs.get(source_tab_id).is_some() {
                    Some(source_tab_id)
                } else {
                    tabs.active_id()
                };
                open_new_tab(
                    &window,
                    &chrome_wv,
                    &mut tabs,
                    &groups,
                    &mut content_webviews,
                    &proxy,
                    current_content_rect,
                    is_overlay_open,
                    &mut storage,
                    is_incognito,
                    after_id,
                    target_url,
                    false,
                    None,
                    &mut split,
                    &watchdog,
                );
                if emit_loading {
                    emit_pet_event(&chrome_wv, &tabs, &content_webviews, &mut storage, "page_loading");
                }
            }

            // ── Download Started ───────────────────────────────────────
            Event::UserEvent(UserEvent::DownloadStarted(_url, filename)) => {
                println!("[download] Notification: Started downloading {filename}");
            }

            // ── Download Completed ─────────────────────────────────────
            Event::UserEvent(UserEvent::DownloadCompleted(url, path, success)) => {
                if !is_incognito {
                    let filename = std::path::Path::new(&path)
                        .file_name()
                        .map(|n| n.to_string_lossy().to_string())
                        .unwrap_or_else(|| "download".to_owned());
                    storage.record_download(&url, &filename, &path, success);
                    println!("[download] Saved download to history: {filename} (success={success})");
                }
                sync_chrome_ui(
                    &chrome_wv,
                    &tabs,
                    &groups,
                    &content_webviews,
                    &mut storage,
                    is_incognito,
                    &split,
                );
                if success {
                    emit_pet_event(&chrome_wv, &tabs, &content_webviews, &mut storage, "download_finished");
                }
            }

            // ── Real-time OS & Process Telemetry Snapshot ──────────────
            Event::UserEvent(UserEvent::Telemetry(snap)) => {
                if latest_telemetry.is_none() {
                    println!(
                        "[telemetry] First snapshot: PrivateWS={:.1} MB | WorkingSet={:.1} MB | Commit={:.1} MB | Host={:.1} MB | Procs={}",
                        snap.breakdown.total_private_ws_mb,
                        snap.breakdown.total_working_set_mb,
                        snap.breakdown.total_commit_mb,
                        snap.breakdown.host_private_ws_mb,
                        snap.breakdown.process_count
                    );
                }
                let tel_msg = build_telemetry_payload(&snap);
                let mem_msg = build_memory_payload(&snap.breakdown, tabs.count());
                latest_telemetry = Some(snap);

                broadcast_to_internal_views(&chrome_wv, &tabs, &content_webviews, &tel_msg);
                broadcast_to_internal_views(&chrome_wv, &tabs, &content_webviews, &mem_msg);

                let now = Instant::now();
                if now >= next_maintenance_at {
                    next_maintenance_at = now + DISCARD_CHECK_INTERVAL;
                    if let Some(threshold) =
                        effective_discard_timeout(storage.settings(), discard_timeout_override)
                    {
                        discard_inactive_tabs(
                            &mut tabs,
                            &mut content_webviews,
                            threshold,
                            &chrome_wv,
                            &groups,
                            &mut storage,
                            is_incognito,
                            &mut split,
                        );
                    }
                    if last_weather_fetch.elapsed() >= Duration::from_secs(weather::CACHE_TTL_SECS) {
                        if let Some(ref req) = last_weather_request {
                            last_weather_fetch = now;
                            spawn_weather_fetch(proxy.clone(), req.clone(), false, storage.data_dir().to_path_buf());
                        }
                    }
                }
            }

            // ── Live Weather Lookup Result ─────────────────────────────
            Event::UserEvent(UserEvent::WeatherFetched(res)) => {
                last_weather_fetch = Instant::now();
                match res {
                    Ok(w) => {
                        println!(
                            "[weather] Updated: {} {:.1}°C ({})",
                            w.location, w.temperature_c, w.condition
                        );
                        last_weather_error = None;
                        let msg = build_weather_payload(&w);
                        latest_weather = Some(w);
                        broadcast_to_newtab_views(&tabs, &content_webviews, &msg);
                    }
                    Err(err) => {
                        eprintln!("[weather] Lookup failed: {err}");
                        last_weather_error = Some(err.clone());
                        let err_msg = json!({
                            "type": "weather_error",
                            "message": err,
                        });
                        broadcast_to_newtab_views(&tabs, &content_webviews, &err_msg);
                    }
                }
            }

            Event::UserEvent(UserEvent::NavigateTab(tab_id, target_url)) => {
                if let Some(wv) = content_webviews.get(&tab_id) {
                    let _ = wv.load_url(&target_url);
                }
            }

            Event::UserEvent(UserEvent::FocusTick) => {
                let tick_res = if let Ok(mut fm) = global_focus_manager().lock() {
                    let completed = fm.tick();
                    let is_active = fm.state().is_active;
                    let state = fm.state();
                    Some((is_active, completed, state))
                } else {
                    None
                };

                if let Some((is_active, completed, state)) = tick_res {
                    if is_active {
                        let msg = json!({
                            "type": "focus_state_changed",
                            "state": state
                        });
                        broadcast_focus_state_to_all(&chrome_wv, &tabs, &content_webviews, &msg);
                    } else if completed {
                        let msg = json!({
                            "type": "focus_session_completed",
                            "state": state
                        });
                        broadcast_focus_state_to_all(&chrome_wv, &tabs, &content_webviews, &msg);
                        sync_chrome_ui(&chrome_wv, &tabs, &groups, &content_webviews, &mut storage, is_incognito, &split);
                    }
                }
            }

            Event::UserEvent(UserEvent::ToggleFocus) => {
                let state_opt = if let Ok(mut fm) = global_focus_manager().lock() {
                    if fm.state().is_active {
                        fm.stop();
                    } else {
                        fm.start(focus::FocusModeKind::Study, None);
                    }
                    Some(fm.state())
                } else {
                    None
                };

                if let Some(state) = state_opt {
                    let active = state.is_active;
                    let msg = json!({
                        "type": "focus_state_changed",
                        "state": state
                    });
                    broadcast_focus_state_to_all(&chrome_wv, &tabs, &content_webviews, &msg);
                    if active {
                        enforce_focus_on_open_tabs(&tabs, &content_webviews);
                    }
                    sync_chrome_ui(&chrome_wv, &tabs, &groups, &content_webviews, &mut storage, is_incognito, &split);
                }
            }

            Event::UserEvent(UserEvent::SyncFocusToTab(tab_id)) => {
                let focus_msg_opt = if let Ok(fm) = global_focus_manager().lock() {
                    Some(json!({
                        "type": "focus_state_changed",
                        "state": fm.state()
                    }))
                } else {
                    None
                };
                if let (Some(focus_msg), Some(wv)) = (focus_msg_opt, content_webviews.get(&tab_id)) {
                    let js = format!("if (window.__rustyOnFocusState) {{ window.__rustyOnFocusState({focus_msg}); }}");
                    let _ = wv.evaluate_script(&js);
                }
            }

            _ => {}
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_trusted_origin_matches_internal() {
        assert!(is_trusted_origin("rusty://app/index.html"));
        assert!(is_trusted_origin("rusty://app/newtab.html"));
        assert!(is_trusted_origin("http://rusty.app"));
        assert!(is_trusted_origin("http://rusty.app/"));
        assert!(is_trusted_origin("http://rusty.app/index.html"));
        assert!(is_trusted_origin("http://rusty.app/newtab.html"));
        assert!(is_trusted_origin("http://rusty.app/newtab.html?skin=minimal&theme=sunset"));
        assert!(is_trusted_origin("https://rusty.app/index.html"));
        assert!(is_trusted_origin("data:text/html;charset=utf-8,<html></html>"));
    }

    #[test]
    fn test_is_trusted_origin_rejects_external_and_spoofed() {
        assert!(!is_trusted_origin("https://google.com"));
        assert!(!is_trusted_origin("http://example.com/index.html"));
        assert!(!is_trusted_origin("http://rusty.app.evil.com/index.html"));
        assert!(!is_trusted_origin("https://rusty.app.evil.com/"));
        assert!(!is_trusted_origin("http://rusty.app:8080/index.html"));
    }

    #[test]
    fn test_resolve_content_url() {
        #[cfg(target_os = "windows")]
        {
            assert_eq!(resolve_content_url("about:blank"), "http://rusty.app/newtab.html");
            assert_eq!(resolve_content_url("about:newtab"), "http://rusty.app/newtab.html");
            assert_eq!(resolve_content_url("rusty://app/newtab.html"), "http://rusty.app/newtab.html");
        }
        #[cfg(not(target_os = "windows"))]
        {
            assert_eq!(resolve_content_url("about:blank"), "rusty://app/newtab.html");
            assert_eq!(resolve_content_url("about:newtab"), "rusty://app/newtab.html");
        }
        assert_eq!(resolve_content_url("https://crates.io"), "https://crates.io");
    }

    #[test]
    fn test_resolve_content_url_with_settings_and_newtab_detection() {
        assert!(is_newtab_url("about:blank"));
        assert!(is_newtab_url("about:newtab"));
        assert!(is_newtab_url("http://rusty.app/newtab.html?skin=crazy"));
        assert!(!is_newtab_url("https://example.com/newtab.html"));

        let s = storage::Settings {
            skin: "minimal".to_owned(),
            theme: "aurora".to_owned(),
            tabs_layout: "vertical".to_owned(),
            ..Default::default()
        };

        let resolved = resolve_content_url_with_settings("about:blank", &s);
        assert!(resolved.contains("newtab.html?skin=minimal&theme=aurora&tabs=vertical"));
        assert_eq!(
            resolve_content_url_with_settings("https://crates.io", &s),
            "https://crates.io"
        );

        let s_mayank = storage::Settings {
            skin: "mayank".to_owned(),
            theme: "light".to_owned(),
            tabs_layout: "horizontal".to_owned(),
            ..Default::default()
        };
        let res_mayank = resolve_content_url_with_settings("about:blank", &s_mayank);
        assert!(res_mayank.contains("newtab.html?skin=mayank&theme=light&tabs=horizontal"));
    }

    #[test]
    fn test_effective_discard_timeout() {
        let mut s = storage::Settings {
            discard_timeout_secs: 0,
            ..Default::default()
        };
        assert_eq!(effective_discard_timeout(&s, None), None);
        s.discard_timeout_secs = 300;
        assert_eq!(effective_discard_timeout(&s, None), Some(Duration::from_secs(300)));
        assert_eq!(
            effective_discard_timeout(&s, Some(Duration::from_secs(45))),
            Some(Duration::from_secs(45))
        );
        assert_eq!(effective_discard_timeout(&s, Some(Duration::ZERO)), None);
    }

    #[test]
    fn test_ui_message_middle_click_variants() {
        let msg1: UiMessage = serde_json::from_str(
            r#"{"action":"new_tab","url":"https://rust-lang.org","background":true,"title":"Rust"}"#,
        )
        .unwrap();
        assert!(matches!(
            msg1,
            UiMessage::NewTab {
                background: Some(true),
                ..
            }
        ));
        let msg2: UiMessage = serde_json::from_str(r#"{"action":"paste_new_tab"}"#).unwrap();
        assert!(matches!(msg2, UiMessage::PasteNewTab));
        let msg3: UiMessage = serde_json::from_str(
            r#"{"action":"open_history_entry_in_new_tab","direction":"back","background":null}"#,
        )
        .unwrap();
        assert!(matches!(
            msg3,
            UiMessage::OpenHistoryEntryInNewTab {
                background: None,
                ..
            }
        ));
        let msg4: UiMessage = serde_json::from_str(r#"{"action":"focus_omnibox"}"#).unwrap();
        assert!(matches!(msg4, UiMessage::FocusOmnibox));
        let msg5: UiMessage =
            serde_json::from_str(r#"{"action":"copy_to_clipboard","text":"hi"}"#).unwrap();
        assert!(matches!(msg5, UiMessage::CopyToClipboard { .. }));
    }

    #[test]
    fn test_rect_epsilon_deduplication() {
        let a = logical_rect(0.0, 72.0, 1280.0, 728.0);
        let b = logical_rect(0.2, 72.3, 1279.8, 727.9);
        let c = logical_rect(0.0, 74.0, 1280.0, 726.0);
        assert!(rects_approx_eq(a, b, 0.5));
        assert!(!rects_approx_eq(a, c, 0.5));
    }

    #[test]
    fn test_split_subrects_strictly_disjoint() {
        let outer = logical_rect(0.0, 72.0, 1280.0, 728.0);
        let (left, right) = compute_split_subrects(outer, 0.5, 36.0, 8.0);
        let (lx, ly, lw, lh) = extract_logical_rect(left);
        let (rx, ry, rw, rh) = extract_logical_rect(right);
        assert_eq!(lx, 0.0);
        assert_eq!(ly, 108.0); // 72 + 36 split controls bar
        assert_eq!(ry, 108.0);
        assert_eq!(lh, 692.0);
        assert_eq!(rh, 692.0);
        // Divider gap = 8px
        assert!((rx - (lx + lw) - 8.0).abs() < 0.01);
        // Strictly disjoint (right begins past left + 8)
        assert!(rx >= lx + lw + 8.0 - 0.01);
        assert!((lw + 8.0 + rw - 1280.0).abs() < 0.01);

        // Extreme clamp check
        let (cl, cr) = compute_split_subrects(outer, 0.02, 36.0, 8.0);
        let (_, _, clw, _) = extract_logical_rect(cl);
        let (crx, _, crw, _) = extract_logical_rect(cr);
        assert!((clw / (clw + crw) - 0.20).abs() < 0.02);
        assert!(crx >= clw + 8.0 - 0.01);
    }

    #[test]
    fn test_ui_message_split_commands_deserialize() {
        let m1: UiMessage = serde_json::from_str(r#"{"action":"split_view"}"#).unwrap();
        assert!(matches!(m1, UiMessage::SplitView { enabled: None }));
        let m2: UiMessage =
            serde_json::from_str(r#"{"action":"split_view","enabled":true}"#).unwrap();
        assert!(matches!(
            m2,
            UiMessage::SplitView {
                enabled: Some(true)
            }
        ));
        let m3: UiMessage = serde_json::from_str(r#"{"action":"split_close"}"#).unwrap();
        assert!(matches!(m3, UiMessage::SplitClose));
        let m4: UiMessage = serde_json::from_str(r#"{"action":"split_swap"}"#).unwrap();
        assert!(matches!(m4, UiMessage::SplitSwap));
        let m5: UiMessage =
            serde_json::from_str(r#"{"action":"split_focus","pane":1}"#).unwrap();
        assert!(matches!(m5, UiMessage::SplitFocus { pane: 1 }));
        let m6: UiMessage = serde_json::from_str(
            r#"{"action":"split_navigate","pane":1,"url":"https://example.com"}"#,
        )
        .unwrap();
        assert!(matches!(m6, UiMessage::SplitNavigate { pane: 1, .. }));
        let m7: UiMessage = serde_json::from_str(
            r#"{"action":"content_rect","x":0,"y":72,"width":1280,"height":728,"left":{"x":0,"y":108,"width":636,"height":692},"right":{"x":644,"y":108,"width":636,"height":692},"ratio":0.5}"#,
        )
        .unwrap();
        assert!(matches!(
            m7,
            UiMessage::ContentRect {
                left: Some(_),
                right: Some(_),
                ratio: Some(_),
                ..
            }
        ));
    }

    #[test]
    fn test_watchdog_ack_and_phase() {
        let mut builder = EventLoopBuilder::<UserEvent>::with_user_event();
        #[cfg(target_os = "windows")]
        {
            use tao::platform::windows::EventLoopBuilderExtWindows;
            builder.with_any_thread(true);
        }
        let el = builder.build();
        let handle = spawn_event_loop_watchdog(el.create_proxy());
        handle.set_phase(LoopPhase::SplitViewHandler);
        assert_eq!(handle.phase.load(Ordering::Relaxed), LoopPhase::SplitViewHandler as u8);
        handle.ack();
        assert_eq!(handle.phase.load(Ordering::Relaxed), LoopPhase::Idle as u8);
        drop(handle);
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn test_job_object_struct_size_and_init() {
        assert_eq!(
            std::mem::size_of::<win32_platform::JOBOBJECT_EXTENDED_LIMIT_INFORMATION>(),
            144
        );
        // Verify Job Object creation & KILL_ON_JOB_CLOSE limit configuration without
        // assigning the cargo test runner process itself (which would terminate the runner on Drop).
        let guard = win32_platform::create_kill_on_close_job();
        assert!(guard.is_some());
    }

    #[test]
    fn test_ui_message_fetch_weather_coords_deserializes() {
        let msg: UiMessage = serde_json::from_str(
            r#"{"action":"fetch_weather","lat":19.076,"lon":72.877,"label":"Mumbai, IN","country":"India","force":true}"#,
        )
        .unwrap();
        assert!(matches!(
            msg,
            UiMessage::FetchWeather {
                lat: Some(_),
                lon: Some(_),
                force: Some(true),
                ..
            }
        ));
    }

    #[test]
    fn test_launch_safe_app_allowlist_enforcement() {
        // Disallowed / arbitrary command strings are strictly rejected
        assert!(launch_safe_app("rm -rf /").is_err());
        assert!(launch_safe_app("format C:").is_err());
        assert!(launch_safe_app("powershell.exe -enc evil").is_err());
        assert!(launch_safe_app("curl http://evil.com").is_err());

        // Allowlisted apps are recognized (calc, terminal, etc.)
        let res = launch_safe_app("calculator");
        // On headless CI calc might not exist or might spawn, but it won't fail with "not allowed"
        if let Err(e) = res {
            assert!(e.to_string().contains("not found"));
        }
    }
}
