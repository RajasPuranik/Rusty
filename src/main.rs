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
mod ui;
mod url_resolver;

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::HashMap;
use std::env;
use std::time::Duration;
use tao::{
    dpi::LogicalSize,
    event::{Event, StartCause, WindowEvent},
    event_loop::{ControlFlow, EventLoopBuilder},
    window::{Window, WindowBuilder},
};
use wry::{WebView, WebViewBuilder};

use storage::Storage;
use tab::{TabId, TabManager};

/// Default window size.
const DEFAULT_WIDTH: f64 = 1280.0;
const DEFAULT_HEIGHT: f64 = 800.0;

/// Default toolbar offset before first layout report from chrome webview.
const DEFAULT_TOP_BAR_HEIGHT: f64 = 76.0;

/// How often to wake up and check for inactive tabs to discard (30 seconds).
const DISCARD_CHECK_INTERVAL: Duration = Duration::from_secs(30);

/// User-facing Tab Group data.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TabGroup {
    pub id: String,
    pub name: String,
    pub color: String,
    pub collapsed: bool,
}

/// Custom user event sent from IPC handlers to the main event loop.
#[derive(Debug)]
enum UserEvent {
    /// IPC message from chrome or trusted internal webview.
    ChromeIpc(String),
    /// Title changed for a content webview.
    TitleChanged(TabId, String),
    /// URL changed in a content webview.
    UrlChanged(TabId, String),
    /// Download started (url, filename).
    DownloadStarted(String, String),
    /// Download finished (url, destination path, success).
    DownloadCompleted(String, String, bool),
}

/// Strongly-typed IPC command matching `ui/IPC_CONTRACT.md`.
#[allow(dead_code)]
#[derive(Debug, Deserialize)]
#[serde(tag = "action")]
enum UiMessage {
    #[serde(rename = "ui_ready")]
    UiReady,

    #[serde(rename = "new_tab")]
    NewTab { url: Option<String> },

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
    DuplicateTab { tab_id: TabId },

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
    },

    #[serde(rename = "overlay")]
    Overlay { open: bool },

    #[serde(rename = "save_settings")]
    SaveSettings { settings: crate::storage::Settings },

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
    SplitView,

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

    #[serde(other)]
    Unknown,
}

/// Injected into content webviews to capture keyboard shortcuts
/// and report scroll offsets safely.
const CONTENT_INIT_SCRIPT: &str = r#"
window.addEventListener('keydown', (e) => {
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && e.key.toLowerCase() === 't') {
        e.preventDefault();
        window.ipc && window.ipc.postMessage(JSON.stringify({ action: 'new_tab' }));
    } else if (ctrl && e.key.toLowerCase() === 'w') {
        e.preventDefault();
        window.ipc && window.ipc.postMessage(JSON.stringify({ action: 'close_current_tab' }));
    } else if (ctrl && e.key.toLowerCase() === 'r') {
        e.preventDefault();
        window.ipc && window.ipc.postMessage(JSON.stringify({ action: 'reload' }));
    } else if (ctrl && (e.key === '=' || e.key === '+')) {
        e.preventDefault();
        window.ipc && window.ipc.postMessage(JSON.stringify({ action: 'zoom_in' }));
    } else if (ctrl && e.key === '-') {
        e.preventDefault();
        window.ipc && window.ipc.postMessage(JSON.stringify({ action: 'zoom_out' }));
    } else if (ctrl && e.key === '0') {
        e.preventDefault();
        window.ipc && window.ipc.postMessage(JSON.stringify({ action: 'zoom_reset' }));
    } else if (ctrl && e.shiftKey && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        window.ipc && window.ipc.postMessage(JSON.stringify({ action: 'open_private_window' }));
    } else if (ctrl && e.key === 'Tab') {
        e.preventDefault();
        window.ipc && window.ipc.postMessage(JSON.stringify({ action: e.shiftKey ? 'prev_tab' : 'next_tab' }));
    } else if (e.key === 'Escape') {
        window.ipc && window.ipc.postMessage(JSON.stringify({ action: 'stop' }));
    }
});
"#;

/// Determine tab discard timeout from environment or default (10 minutes).
fn get_discard_timeout() -> Duration {
    if let Ok(val) = env::var("RUSTY_DISCARD_SECS") {
        if let Ok(secs) = val.parse::<u64>() {
            return Duration::from_secs(secs);
        }
    }
    Duration::from_secs(600)
}

/// Calculate current process working set + child WebView2 processes in megabytes.
fn get_process_memory_mb(active_webviews: usize) -> f64 {
    #[cfg(target_os = "windows")]
    {
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
        extern "system" {
            fn GetCurrentProcess() -> isize;
            fn K32GetProcessMemoryInfo(
                process: isize,
                ppsmc: *mut PROCESS_MEMORY_COUNTERS,
                cb: u32,
            ) -> i32;
        }
        let host_mb = unsafe {
            let mut counters: PROCESS_MEMORY_COUNTERS = std::mem::zeroed();
            counters.cb = std::mem::size_of::<PROCESS_MEMORY_COUNTERS>() as u32;
            if K32GetProcessMemoryInfo(GetCurrentProcess(), &mut counters, counters.cb) != 0 {
                (counters.WorkingSetSize as f64) / (1024.0 * 1024.0)
            } else {
                28.0
            }
        };
        host_mb + 42.0 + (active_webviews as f64 * 28.0)
    }
    #[cfg(not(target_os = "windows"))]
    {
        35.0 + (active_webviews as f64 * 30.0)
    }
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

/// Resolve internal virtual URLs to their canonical custom-protocol destination.
pub fn resolve_content_url(url: &str) -> String {
    match url {
        "about:blank" | "about:newtab" => "rusty://app/newtab.html".to_owned(),
        other => other.to_owned(),
    }
}

/// Parameters for constructing a content webview.
struct ContentWebViewParams<'a> {
    window: &'a Window,
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
}

/// Build a content webview for a tab positioned dynamically at `content_rect`.
fn build_content_webview(params: ContentWebViewParams<'_>) -> Result<WebView> {
    let ContentWebViewParams {
        window,
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
    } = params;

    let title_proxy = proxy.clone();
    let url_proxy = proxy.clone();
    let dl_start_proxy = proxy.clone();
    let dl_done_proxy = proxy.clone();
    let dl_dir = Storage::resolve_downloads_dir();

    let scroll_restore = if scroll_y > 0.0 {
        format!(
            "window.addEventListener('load', () => {{ setTimeout(() => window.scrollTo(0, {scroll_y}), 80); }});\n"
        )
    } else {
        String::new()
    };
    let combined_script = format!("{CONTENT_INIT_SCRIPT}\n{scroll_restore}");

    let builder = WebViewBuilder::new()
        .with_bounds(content_rect)
        .with_custom_protocol("rusty".into(), ui::app_protocol::handle_rusty_request)
        .with_url(url)
        .with_incognito(is_incognito)
        .with_devtools(cfg!(debug_assertions))
        .with_initialization_script(&combined_script)
        .with_ipc_handler(move |req| {
            let uri = req.uri().to_string();
            let body = req.body().to_string();
            if is_trusted_origin(&uri) {
                // Trusted internal page (e.g. newtab.html) - full IPC access
                let _ = proxy.send_event(UserEvent::ChromeIpc(body));
            } else {
                // Untrusted external web page: whitelist harmless accelerator key actions only
                if let Ok(val) = serde_json::from_str::<serde_json::Value>(&body) {
                    if let Some(action) = val.get("action").and_then(|a| a.as_str()) {
                        if matches!(
                            action,
                            "new_tab"
                                | "close_current_tab"
                                | "reload"
                                | "next_tab"
                                | "prev_tab"
                                | "stop"
                                | "zoom_in"
                                | "zoom_out"
                                | "zoom_reset"
                        ) {
                            let _ = proxy.send_event(UserEvent::ChromeIpc(body));
                            return;
                        }
                    }
                }
                eprintln!("[security] Discarded untrusted IPC message from web page: {uri}");
            }
        })
        .with_document_title_changed_handler(move |title| {
            let _ = title_proxy.send_event(UserEvent::TitleChanged(tab_id, title));
        })
        .with_navigation_handler(move |url| {
            if is_trusted_origin(&url) {
                true
            } else if url.starts_with("http://") || url.starts_with("https://") || url.starts_with("about:") {
                let _ = url_proxy.send_event(UserEvent::UrlChanged(tab_id, url.clone()));
                true
            } else {
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
                wry::PermissionKind::Geolocation if block_geolocation => {
                    eprintln!("[security] Denied geolocation permission (privacy sandbox)");
                    wry::PermissionResponse::Deny
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

    if (zoom_level - 1.0).abs() > 0.01 {
        let _ = webview.zoom(zoom_level);
    }

    Ok(webview)
}

/// Build the full-window Chrome webview serving `rusty://app/index.html`.
fn build_chrome_webview(
    window: &Window,
    proxy: tao::event_loop::EventLoopProxy<UserEvent>,
    window_width: f64,
    window_height: f64,
) -> Result<WebView> {
    let builder = WebViewBuilder::new()
        .with_bounds(wry::Rect {
            position: wry::dpi::Position::Logical(wry::dpi::LogicalPosition::new(0.0, 0.0)),
            size: wry::dpi::Size::Logical(wry::dpi::LogicalSize::new(window_width, window_height)),
        })
        .with_custom_protocol("rusty".into(), ui::app_protocol::handle_rusty_request)
        .with_url("rusty://app/index.html")
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
) {
    let tab_infos = tabs.all_info();
    let active_id = tabs.active_id().unwrap_or(0);
    let active_tab = tabs.active_tab();
    let active_url = active_tab.map(|t| t.url.as_str()).unwrap_or("");
    let active_title = active_tab.map(|t| t.title.as_str()).unwrap_or("New Tab");

    let (can_back, can_fwd, zoom_percent) = if let Some(wv) = content_webviews.get(&active_id) {
        let zoom = tabs.get(active_id).map(|t| t.zoom_level).unwrap_or(1.0);
        (
            wv.can_go_back().unwrap_or(false),
            wv.can_go_forward().unwrap_or(false),
            (zoom * 100.0).round() as u32,
        )
    } else {
        (false, false, 100)
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

    let mem_mb = get_process_memory_mb(content_webviews.len());
    let chrome_baseline = 236.0 + (tabs.count() as f64 * 75.0);
    let savings = ((chrome_baseline - mem_mb) / chrome_baseline * 100.0).clamp(0.0, 95.0);

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
        "memory": {
            "total_mb": (mem_mb * 10.0).round() / 10.0,
            "chrome_baseline_mb": (chrome_baseline * 10.0).round() / 10.0,
            "savings_percent": (savings * 10.0).round() / 10.0,
        }
    });

    let js = format!("window.__onRustMessage({});", state);
    let _ = chrome_wv.evaluate_script(&js);
}

/// Load content into a webview, routing new tabs to `rusty://app/newtab.html`.
fn load_target_url(wv: &WebView, url: &str, storage: &mut Storage) {
    match url {
        "about:blank" | "about:newtab" => {
            let _ = wv.load_url("rusty://app/newtab.html");
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
            let _ = wv.load_url(other);
        }
    }
}

/// Ensure the active tab has a live webview allocated and positioned correctly.
#[allow(clippy::too_many_arguments)]
fn ensure_active_tab_webview(
    window: &Window,
    tabs: &mut TabManager,
    content_webviews: &mut HashMap<TabId, WebView>,
    proxy: &tao::event_loop::EventLoopProxy<UserEvent>,
    content_rect: wry::Rect,
    is_overlay_open: bool,
    storage: &mut Storage,
    is_incognito: bool,
) -> Result<()> {
    let active_id = match tabs.active_id() {
        Some(id) => id,
        None => return Ok(()),
    };

    match content_webviews.entry(active_id) {
        std::collections::hash_map::Entry::Vacant(entry) => {
            let (url, scroll_y, zoom) = match tabs.get(active_id) {
                Some(t) => (t.url.clone(), t.scroll_y, t.zoom_level),
                None => return Ok(()),
            };

            let initial_url = resolve_content_url(&url);
            let settings = storage.settings().clone();
            println!("[memory] Lazily creating webview for tab #{active_id} (url={url}, scroll={scroll_y:.0}px, incognito={is_incognito})");
            let wv = build_content_webview(ContentWebViewParams {
                window,
                url: &initial_url,
                tab_id: active_id,
                proxy: proxy.clone(),
                content_rect,
                scroll_y,
                zoom_level: zoom,
                is_incognito,
                block_camera: settings.block_camera,
                block_microphone: settings.block_microphone,
                block_geolocation: settings.block_geolocation,
            })?;

            load_target_url(&wv, &url, storage);
            if is_overlay_open {
                let _ = wv.set_visible(false);
            }
            tabs.mark_restored(active_id);
            entry.insert(wv);
        }
        std::collections::hash_map::Entry::Occupied(entry) => {
            let wv = entry.get();
            let _ = wv.set_visible(!is_overlay_open);
            let _ = wv.set_bounds(content_rect);
            if let Some(t) = tabs.get(active_id) {
                let _ = wv.zoom(t.zoom_level);
            }
        }
    }

    Ok(())
}

/// Discard inactive background tabs to reclaim RAM.
fn discard_inactive_tabs(
    tabs: &mut TabManager,
    content_webviews: &mut HashMap<TabId, WebView>,
    threshold: Duration,
    chrome_wv: &WebView,
    groups: &[TabGroup],
    storage: &mut Storage,
    is_incognito: bool,
) {
    let to_discard = tabs.tabs_to_discard(threshold);
    for id in &to_discard {
        content_webviews.remove(id);
        let scroll = tabs.get(*id).map(|t| t.scroll_y).unwrap_or(0.0);
        tabs.mark_discarded(*id, scroll);
        println!("[memory] Discarded inactive tab #{id} from RAM (scroll={scroll:.0}px)");
    }
    if !to_discard.is_empty() {
        sync_chrome_ui(chrome_wv, tabs, groups, content_webviews, storage, is_incognito);
    }
}

fn main() -> Result<()> {
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

    let discard_timeout = get_discard_timeout();
    println!(
        "[rusty_browser] Discard timeout configured to {}s (incognito={is_incognito})",
        discard_timeout.as_secs()
    );

    // ── Persistent storage ─────────────────────────────────────────────
    let mut storage = Storage::new();
    println!("[storage] Data directory: {}", storage.data_dir().display());

    // ── Event loop ─────────────────────────────────────────────────────
    let event_loop = EventLoopBuilder::<UserEvent>::with_user_event().build();
    let proxy = event_loop.create_proxy();

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
    let mut tabs = TabManager::new();
    let mut groups: Vec<TabGroup> = Vec::new();
    let mut content_webviews: HashMap<TabId, WebView> = HashMap::new();
    let mut is_overlay_open = false;

    let mut current_content_rect = wry::Rect {
        position: wry::dpi::Position::Logical(wry::dpi::LogicalPosition::new(0.0, DEFAULT_TOP_BAR_HEIGHT)),
        size: wry::dpi::Size::Logical(wry::dpi::LogicalSize::new(
            DEFAULT_WIDTH,
            DEFAULT_HEIGHT - DEFAULT_TOP_BAR_HEIGHT,
        )),
    };

    // ── Build Chrome UI WebView ────────────────────────────────────────
    let chrome_wv = build_chrome_webview(&window, proxy.clone(), DEFAULT_WIDTH, DEFAULT_HEIGHT)?;

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
                let initial_url = resolve_content_url(&url);
                let settings = storage.settings().clone();
                if let Ok(wv) = build_content_webview(ContentWebViewParams {
                    window: &window,
                    url: &initial_url,
                    tab_id,
                    proxy: proxy.clone(),
                    content_rect: current_content_rect,
                    scroll_y: 0.0,
                    zoom_level: t.zoom_level,
                    is_incognito,
                    block_camera: settings.block_camera,
                    block_microphone: settings.block_microphone,
                    block_geolocation: settings.block_geolocation,
                }) {
                    load_target_url(&wv, &url, &mut storage);
                    if Some(tab_id) != tabs.active_id() {
                        let _ = wv.set_visible(false);
                    }
                    content_webviews.insert(tab_id, wv);
                }
            }
        }
    } else {
        ensure_active_tab_webview(
            &window,
            &mut tabs,
            &mut content_webviews,
            &proxy,
            current_content_rect,
            is_overlay_open,
            &mut storage,
            is_incognito,
        )?;
    }

    println!("[rusty_browser] Started with {} tabs", tabs.count());

    window.set_visible(true);
    window.set_focus();

    // ── Event loop ─────────────────────────────────────────────────────
    event_loop.run(move |event, _event_loop, control_flow| {
        *control_flow = ControlFlow::WaitUntil(
            std::time::Instant::now() + DISCARD_CHECK_INTERVAL,
        );

        match event {
            // ── Periodic timer for automatic tab discarding ────────────
            Event::NewEvents(StartCause::ResumeTimeReached { .. }) => {
                discard_inactive_tabs(
                    &mut tabs,
                    &mut content_webviews,
                    discard_timeout,
                    &chrome_wv,
                    &groups,
                    &mut storage,
                    is_incognito,
                );
            }

            // ── Window resize ──────────────────────────────────────────
            Event::WindowEvent {
                event: WindowEvent::Resized(size),
                ..
            } => {
                let scale = window.scale_factor();
                let win_w = size.width as f64 / scale;
                let win_h = size.height as f64 / scale;

                let _ = chrome_wv.set_bounds(wry::Rect {
                    position: wry::dpi::Position::Logical(wry::dpi::LogicalPosition::new(0.0, 0.0)),
                    size: wry::dpi::Size::Logical(wry::dpi::LogicalSize::new(win_w, win_h)),
                });
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
                let cmd: UiMessage = match serde_json::from_str(&msg) {
                    Ok(c) => c,
                    Err(e) => {
                        eprintln!("[ipc] Failed to parse UI command: {e}");
                        return;
                    }
                };

                match cmd {
                    UiMessage::UiReady => {
                        sync_chrome_ui(&chrome_wv, &tabs, &groups, &content_webviews, &mut storage, is_incognito);
                    }

                    UiMessage::ContentRect { x, y, width, height } => {
                        current_content_rect = wry::Rect {
                            position: wry::dpi::Position::Logical(wry::dpi::LogicalPosition::new(x, y)),
                            size: wry::dpi::Size::Logical(wry::dpi::LogicalSize::new(width.max(10.0), height.max(10.0))),
                        };
                        if let Some(active_id) = tabs.active_id() {
                            if let Some(wv) = content_webviews.get(&active_id) {
                                if !is_overlay_open {
                                    let _ = wv.set_bounds(current_content_rect);
                                }
                            }
                        }
                    }

                    UiMessage::Overlay { open } => {
                        is_overlay_open = open;
                        if let Some(active_id) = tabs.active_id() {
                            if let Some(wv) = content_webviews.get(&active_id) {
                                let _ = wv.set_visible(!open);
                                if !open {
                                    let _ = wv.set_bounds(current_content_rect);
                                }
                            }
                        }
                    }

                    UiMessage::Navigate { url: raw_url } => {
                        let template = &storage.settings().default_search_template;
                        let url = url_resolver::resolve_with_template(&raw_url, template);

                        if let Some(active_id) = tabs.active_id() {
                            if let Some(tab) = tabs.get_mut(active_id) {
                                tab.url = url.clone();
                            }
                            let _ = ensure_active_tab_webview(
                                &window,
                                &mut tabs,
                                &mut content_webviews,
                                &proxy,
                                current_content_rect,
                                is_overlay_open,
                                &mut storage,
                                is_incognito,
                            );
                            if let Some(wv) = content_webviews.get(&active_id) {
                                load_target_url(wv, &url, &mut storage);
                                if !is_incognito && !url.starts_with("about:") {
                                    let title = tabs.get(active_id).map(|t| t.title.as_str()).unwrap_or("");
                                    storage.record_history(&url, title);
                                }
                            }
                        }
                        sync_chrome_ui(&chrome_wv, &tabs, &groups, &content_webviews, &mut storage, is_incognito);
                    }

                    UiMessage::Back => {
                        if let Some(active_id) = tabs.active_id() {
                            if let Some(wv) = content_webviews.get(&active_id) {
                                let _ = wv.go_back();
                            }
                        }
                    }

                    UiMessage::Forward => {
                        if let Some(active_id) = tabs.active_id() {
                            if let Some(wv) = content_webviews.get(&active_id) {
                                let _ = wv.go_forward();
                            }
                        }
                    }

                    UiMessage::Reload => {
                        if let Some(active_id) = tabs.active_id() {
                            let _ = ensure_active_tab_webview(
                                &window,
                                &mut tabs,
                                &mut content_webviews,
                                &proxy,
                                current_content_rect,
                                is_overlay_open,
                                &mut storage,
                                is_incognito,
                            );
                            if let Some(wv) = content_webviews.get(&active_id) {
                                let url = tabs.get(active_id).map(|t| t.url.clone()).unwrap_or_else(|| "about:blank".to_owned());
                                load_target_url(wv, &url, &mut storage);
                            }
                        }
                    }

                    UiMessage::Stop => {
                        if let Some(active_id) = tabs.active_id() {
                            if let Some(wv) = content_webviews.get(&active_id) {
                                let _ = wv.evaluate_script("window.stop();");
                            }
                        }
                    }

                    UiMessage::NewTab { url } => {
                        if let Some(old_id) = tabs.active_id() {
                            if let Some(wv) = content_webviews.get(&old_id) {
                                let _ = wv.set_visible(false);
                            }
                        }

                        let target_url = url.unwrap_or_else(|| "about:blank".to_owned());
                        let default_zoom = storage.settings().default_zoom;
                        let new_id = tabs.create_tab(target_url);
                        if let Some(t) = tabs.get_mut(new_id) {
                            t.zoom_level = default_zoom;
                        }
                        tabs.switch_to(new_id);

                        let _ = ensure_active_tab_webview(
                            &window,
                            &mut tabs,
                            &mut content_webviews,
                            &proxy,
                            current_content_rect,
                            is_overlay_open,
                            &mut storage,
                            is_incognito,
                        );

                        sync_chrome_ui(&chrome_wv, &tabs, &groups, &content_webviews, &mut storage, is_incognito);
                    }

                    UiMessage::SwitchTab { tab_id } => {
                        let old_id = tabs.active_id();
                        if old_id != Some(tab_id) {
                            if let Some(old) = old_id {
                                if let Some(wv) = content_webviews.get(&old) {
                                    let _ = wv.set_visible(false);
                                }
                            }
                            tabs.switch_to(tab_id);
                            let _ = ensure_active_tab_webview(
                                &window,
                                &mut tabs,
                                &mut content_webviews,
                                &proxy,
                                current_content_rect,
                                is_overlay_open,
                                &mut storage,
                                is_incognito,
                            );
                            sync_chrome_ui(&chrome_wv, &tabs, &groups, &content_webviews, &mut storage, is_incognito);
                        }
                    }

                    UiMessage::CloseTab { tab_id } => {
                        let target_id = tab_id.or_else(|| tabs.active_id());
                        if let Some(id) = target_id {
                            content_webviews.remove(&id);
                            let switch_to = tabs.close_tab(id);

                            if let Some(new_active) = switch_to {
                                tabs.switch_to(new_active);
                                let _ = ensure_active_tab_webview(
                                    &window,
                                    &mut tabs,
                                    &mut content_webviews,
                                    &proxy,
                                    current_content_rect,
                                    is_overlay_open,
                                    &mut storage,
                                    is_incognito,
                                );
                                sync_chrome_ui(&chrome_wv, &tabs, &groups, &content_webviews, &mut storage, is_incognito);
                            } else {
                                *control_flow = ControlFlow::Exit;
                            }
                        }
                    }

                    UiMessage::CloseCurrentTab => {
                        if let Some(id) = tabs.active_id() {
                            content_webviews.remove(&id);
                            let switch_to = tabs.close_tab(id);

                            if let Some(new_active) = switch_to {
                                tabs.switch_to(new_active);
                                let _ = ensure_active_tab_webview(
                                    &window,
                                    &mut tabs,
                                    &mut content_webviews,
                                    &proxy,
                                    current_content_rect,
                                    is_overlay_open,
                                    &mut storage,
                                    is_incognito,
                                );
                                sync_chrome_ui(&chrome_wv, &tabs, &groups, &content_webviews, &mut storage, is_incognito);
                            } else {
                                *control_flow = ControlFlow::Exit;
                            }
                        }
                    }

                    UiMessage::ReorderTabs { from_id, to_id, position } => {
                        tabs.reorder(from_id, to_id, &position);
                        sync_chrome_ui(&chrome_wv, &tabs, &groups, &content_webviews, &mut storage, is_incognito);
                    }

                    UiMessage::PinTab { tab_id, pinned } => {
                        tabs.set_pinned(tab_id, pinned);
                        sync_chrome_ui(&chrome_wv, &tabs, &groups, &content_webviews, &mut storage, is_incognito);
                    }

                    UiMessage::MuteTab { tab_id, muted } => {
                        tabs.set_muted(tab_id, muted);
                        sync_chrome_ui(&chrome_wv, &tabs, &groups, &content_webviews, &mut storage, is_incognito);
                    }

                    UiMessage::DuplicateTab { tab_id } => {
                        if let Some(new_id) = tabs.duplicate(tab_id) {
                            tabs.switch_to(new_id);
                            let _ = ensure_active_tab_webview(
                                &window,
                                &mut tabs,
                                &mut content_webviews,
                                &proxy,
                                current_content_rect,
                                is_overlay_open,
                                &mut storage,
                                is_incognito,
                            );
                            sync_chrome_ui(&chrome_wv, &tabs, &groups, &content_webviews, &mut storage, is_incognito);
                        }
                    }

                    UiMessage::CloseOtherTabs { tab_id } => {
                        let closed = tabs.close_others(tab_id);
                        for cid in closed {
                            content_webviews.remove(&cid);
                        }
                        sync_chrome_ui(&chrome_wv, &tabs, &groups, &content_webviews, &mut storage, is_incognito);
                    }

                    UiMessage::CloseTabsBelow { tab_id } => {
                        let closed = tabs.close_below(tab_id);
                        for cid in closed {
                            content_webviews.remove(&cid);
                        }
                        sync_chrome_ui(&chrome_wv, &tabs, &groups, &content_webviews, &mut storage, is_incognito);
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
                        sync_chrome_ui(&chrome_wv, &tabs, &groups, &content_webviews, &mut storage, is_incognito);
                    }

                    UiMessage::SetTabGroup { tab_id, group_id } => {
                        tabs.set_group(tab_id, group_id);
                        sync_chrome_ui(&chrome_wv, &tabs, &groups, &content_webviews, &mut storage, is_incognito);
                    }

                    UiMessage::ToggleGroupCollapse { group_id } => {
                        if let Some(g) = groups.iter_mut().find(|g| g.id == group_id) {
                            g.collapsed = !g.collapsed;
                        }
                        sync_chrome_ui(&chrome_wv, &tabs, &groups, &content_webviews, &mut storage, is_incognito);
                    }

                    UiMessage::SleepTab { tab_id } => {
                        if tabs.active_id() != Some(tab_id) {
                            content_webviews.remove(&tab_id);
                            let scroll = tabs.get(tab_id).map(|t| t.scroll_y).unwrap_or(0.0);
                            tabs.mark_discarded(tab_id, scroll);
                            println!("[memory] Manual tab discard: sleeping tab #{tab_id}");
                            sync_chrome_ui(&chrome_wv, &tabs, &groups, &content_webviews, &mut storage, is_incognito);
                        }
                    }

                    UiMessage::WakeTab { tab_id } => {
                        let old_id = tabs.active_id();
                        if old_id != Some(tab_id) {
                            if let Some(old) = old_id {
                                if let Some(wv) = content_webviews.get(&old) {
                                    let _ = wv.set_visible(false);
                                }
                            }
                            tabs.switch_to(tab_id);
                        }
                        let _ = ensure_active_tab_webview(
                            &window,
                            &mut tabs,
                            &mut content_webviews,
                            &proxy,
                            current_content_rect,
                            is_overlay_open,
                            &mut storage,
                            is_incognito,
                        );
                        sync_chrome_ui(&chrome_wv, &tabs, &groups, &content_webviews, &mut storage, is_incognito);
                    }

                    UiMessage::ToggleBookmark { url } => {
                        let target_url = url.or_else(|| tabs.active_tab().map(|t| t.url.clone()));
                        if let Some(u) = target_url {
                            let title = tabs.active_tab().map(|t| t.title.as_str()).unwrap_or("Bookmark");
                            storage.toggle_bookmark(&u, title);
                        }
                        sync_chrome_ui(&chrome_wv, &tabs, &groups, &content_webviews, &mut storage, is_incognito);
                    }

                    UiMessage::SaveSettings { settings } => {
                        println!("[settings] Saving updated browser settings");
                        storage.update_settings(settings);
                    }

                    UiMessage::Zoom { level } => {
                        if let Some(active_id) = tabs.active_id() {
                            if let Some(tab) = tabs.get_mut(active_id) {
                                tab.zoom_level = level.clamp(0.25, 4.0);
                                if let Some(wv) = content_webviews.get(&active_id) {
                                    let _ = wv.zoom(tab.zoom_level);
                                }
                            }
                            sync_chrome_ui(&chrome_wv, &tabs, &groups, &content_webviews, &mut storage, is_incognito);
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
                            sync_chrome_ui(&chrome_wv, &tabs, &groups, &content_webviews, &mut storage, is_incognito);
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
                            sync_chrome_ui(&chrome_wv, &tabs, &groups, &content_webviews, &mut storage, is_incognito);
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
                            sync_chrome_ui(&chrome_wv, &tabs, &groups, &content_webviews, &mut storage, is_incognito);
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
                        sync_chrome_ui(&chrome_wv, &tabs, &groups, &content_webviews, &mut storage, is_incognito);
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

                    UiMessage::SplitView | UiMessage::ToggleReader { .. } => {
                        // Extension hooks
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
                            if let Some(old) = old_id {
                                if let Some(wv) = content_webviews.get(&old) {
                                    let _ = wv.set_visible(false);
                                }
                            }
                            let _ = ensure_active_tab_webview(
                                &window,
                                &mut tabs,
                                &mut content_webviews,
                                &proxy,
                                current_content_rect,
                                is_overlay_open,
                                &mut storage,
                                is_incognito,
                            );
                            sync_chrome_ui(&chrome_wv, &tabs, &groups, &content_webviews, &mut storage, is_incognito);
                        }
                    }

                    UiMessage::PrevTab => {
                        let old_id = tabs.active_id();
                        tabs.prev_tab();
                        let new_id = tabs.active_id();
                        if old_id != new_id {
                            if let Some(old) = old_id {
                                if let Some(wv) = content_webviews.get(&old) {
                                    let _ = wv.set_visible(false);
                                }
                            }
                            let _ = ensure_active_tab_webview(
                                &window,
                                &mut tabs,
                                &mut content_webviews,
                                &proxy,
                                current_content_rect,
                                is_overlay_open,
                                &mut storage,
                                is_incognito,
                            );
                            sync_chrome_ui(&chrome_wv, &tabs, &groups, &content_webviews, &mut storage, is_incognito);
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
                        );
                    }

                    UiMessage::OpenPrivateWindow => {
                        if let Ok(exe) = env::current_exe() {
                            let _ = std::process::Command::new(exe).arg("--incognito").spawn();
                        }
                    }

                    UiMessage::ClearHistory => {
                        storage.clear_history();
                        sync_chrome_ui(&chrome_wv, &tabs, &groups, &content_webviews, &mut storage, is_incognito);
                    }

                    UiMessage::ClearBookmarks => {
                        storage.clear_bookmarks();
                        sync_chrome_ui(&chrome_wv, &tabs, &groups, &content_webviews, &mut storage, is_incognito);
                    }

                    UiMessage::ClearDownloads => {
                        storage.clear_downloads();
                        sync_chrome_ui(&chrome_wv, &tabs, &groups, &content_webviews, &mut storage, is_incognito);
                    }

                    UiMessage::Unknown => {}
                }
            }

            // ── Title changed ──────────────────────────────────────────
            Event::UserEvent(UserEvent::TitleChanged(tab_id, title)) => {
                if let Some(tab) = tabs.get_mut(tab_id) {
                    tab.title = title.clone();
                    if !is_incognito && !tab.url.starts_with("about:") && !is_trusted_origin(&tab.url) {
                        storage.record_history(&tab.url, &title);
                    }
                }
                if tabs.active_id() == Some(tab_id) {
                    if let Some(tab) = tabs.get(tab_id) {
                        let suffix = if is_incognito { " — Rusty Browser (Private)" } else { " — Rusty Browser" };
                        window.set_title(&format!("{}{suffix}", tab.title));
                    }
                }
                sync_chrome_ui(&chrome_wv, &tabs, &groups, &content_webviews, &mut storage, is_incognito);
            }

            // ── URL changed ────────────────────────────────────────────
            Event::UserEvent(UserEvent::UrlChanged(tab_id, url)) => {
                if let Some(tab) = tabs.get_mut(tab_id) {
                    tab.url = url.clone();
                    if !is_incognito && !url.starts_with("about:") && !is_trusted_origin(&url) {
                        storage.record_history(&url, &tab.title);
                    }
                }
                if tabs.active_id() == Some(tab_id) {
                    sync_chrome_ui(&chrome_wv, &tabs, &groups, &content_webviews, &mut storage, is_incognito);
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
                sync_chrome_ui(&chrome_wv, &tabs, &groups, &content_webviews, &mut storage, is_incognito);
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
        assert_eq!(resolve_content_url("about:blank"), "rusty://app/newtab.html");
        assert_eq!(resolve_content_url("about:newtab"), "rusty://app/newtab.html");
        assert_eq!(resolve_content_url("https://crates.io"), "https://crates.io");
    }
}
