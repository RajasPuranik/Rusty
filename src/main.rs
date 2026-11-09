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

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::HashMap;
use std::env;
use std::time::{Duration, Instant};
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

/// Custom user event sent from IPC handlers and worker threads to the main event loop.
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
    /// Real-time OS and process tree telemetry snapshot.
    Telemetry(telemetry::TelemetrySnapshot),
    /// Live weather lookup completed in worker thread.
    WeatherFetched(Result<weather::WeatherData, String>),
}

/// Strongly-typed IPC command matching `ui/IPC_CONTRACT.md`.
#[allow(dead_code)]
#[derive(Debug, Deserialize)]
#[serde(tag = "action")]
enum UiMessage {
    #[serde(rename = "ui_ready")]
    UiReady { role: Option<String> },

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
    const key = e.key.toLowerCase();
    if (ctrl && key === 't') {
        e.preventDefault();
        window.ipc && window.ipc.postMessage(JSON.stringify({ action: 'new_tab' }));
    } else if (ctrl && key === 'w') {
        e.preventDefault();
        window.ipc && window.ipc.postMessage(JSON.stringify({ action: 'close_current_tab' }));
    } else if (ctrl && key === 'r') {
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
    } else if (ctrl && key === 'k') {
        e.preventDefault();
        window.ipc && window.ipc.postMessage(JSON.stringify({ action: 'open_command_palette' }));
    } else if (ctrl && key === 'f') {
        e.preventDefault();
        window.ipc && window.ipc.postMessage(JSON.stringify({ action: 'open_find_bar' }));
    } else if (ctrl && e.key === ',') {
        e.preventDefault();
        window.ipc && window.ipc.postMessage(JSON.stringify({ action: 'open_settings' }));
    } else if (ctrl && key === 'h') {
        e.preventDefault();
        window.ipc && window.ipc.postMessage(JSON.stringify({ action: 'open_side_panel', panel: 'history' }));
    } else if (ctrl && key === 'j') {
        e.preventDefault();
        window.ipc && window.ipc.postMessage(JSON.stringify({ action: 'open_side_panel', panel: 'downloads' }));
    } else if (ctrl && e.shiftKey && key === 'n') {
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
    let skin = if settings.skin == "minimal" { "minimal" } else { "crazy" };
    let theme = percent_encoding::utf8_percent_encode(
        &settings.theme,
        percent_encoding::NON_ALPHANUMERIC,
    );
    let tabs = if settings.tabs_layout == "vertical" {
        "vertical"
    } else {
        "horizontal"
    };
    let sep = if base.contains('?') { '&' } else { '?' };
    format!("{base}{sep}skin={skin}&theme={theme}&tabs={tabs}")
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
    let _ = wv.evaluate_script(&js);
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

fn build_memory_payload(browser_mb: f64, tab_count: usize) -> serde_json::Value {
    let chrome_baseline = 236.0 + (tab_count.max(1) as f64 * 75.0);
    let savings = ((chrome_baseline - browser_mb) / chrome_baseline * 100.0).clamp(0.0, 95.0);
    json!({
        "type": "memory_stats",
        "total_mb": (browser_mb * 10.0).round() / 10.0,
        "chrome_baseline_mb": (chrome_baseline * 10.0).round() / 10.0,
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
    })
}

fn build_weather_payload(w: &weather::WeatherData) -> serde_json::Value {
    let mut val = serde_json::to_value(w).unwrap_or_else(|_| json!({}));
    if let Some(obj) = val.as_object_mut() {
        obj.insert("type".to_owned(), json!("weather_update"));
    }
    val
}

fn spawn_weather_fetch(proxy: tao::event_loop::EventLoopProxy<UserEvent>, location: String) {
    std::thread::spawn(move || {
        let res = weather::fetch_weather(&location);
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
                        let allowed_panel = action == "open_side_panel"
                            && matches!(
                                val.get("panel").and_then(|p| p.as_str()),
                                Some("bookmarks" | "history" | "downloads")
                            );
                        if allowed_panel
                            || matches!(
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
                                    | "open_command_palette"
                                    | "open_find_bar"
                                    | "open_settings"
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
    settings: &storage::Settings,
) -> Result<WebView> {
    let chrome_url = resolve_content_url_with_settings("rusty://app/index.html", settings);
    let builder = WebViewBuilder::new()
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

    let mem_mb = telemetry::sample_browser_memory_mb(content_webviews.len());
    let mem_payload = build_memory_payload(mem_mb, tabs.count());

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
            "total_mb": mem_payload["total_mb"],
            "chrome_baseline_mb": mem_payload["chrome_baseline_mb"],
            "savings_percent": mem_payload["savings_percent"],
        }
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

            let settings = storage.settings().clone();
            let initial_url = resolve_content_url_with_settings(&url, &settings);
            let needs_html_page = matches!(
                url.as_str(),
                "about:history" | "about:bookmarks" | "about:downloads" | "about:settings"
            );
            println!("[memory] Lazily creating webview for tab #{active_id} (url={url}, scroll={scroll_y:.0}px, incognito={is_incognito})");
            let wv = build_content_webview(ContentWebViewParams {
                window,
                url: if needs_html_page { "about:blank" } else { &initial_url },
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

            if needs_html_page {
                load_target_url(&wv, &url, storage);
            }
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

    // ── Persistent storage ─────────────────────────────────────────────
    let mut storage = Storage::new();
    println!("[storage] Data directory: {}", storage.data_dir().display());
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

    let mut latest_telemetry: Option<telemetry::TelemetrySnapshot> = None;
    let mut latest_weather: Option<weather::WeatherData> = None;
    let mut last_weather_error: Option<String> = None;
    let mut last_weather_fetch = Instant::now();
    let mut next_maintenance_at = Instant::now() + DISCARD_CHECK_INTERVAL;

    let mut current_content_rect = wry::Rect {
        position: wry::dpi::Position::Logical(wry::dpi::LogicalPosition::new(0.0, DEFAULT_TOP_BAR_HEIGHT)),
        size: wry::dpi::Size::Logical(wry::dpi::LogicalSize::new(
            DEFAULT_WIDTH,
            DEFAULT_HEIGHT - DEFAULT_TOP_BAR_HEIGHT,
        )),
    };

    // ── Build Chrome UI WebView ────────────────────────────────────────
    let chrome_wv = build_chrome_webview(
        &window,
        proxy.clone(),
        DEFAULT_WIDTH,
        DEFAULT_HEIGHT,
        &initial_settings,
    )?;

    // ── Background Real OS Telemetry & Live Weather ────────────────────
    let tel_proxy = proxy.clone();
    telemetry::spawn_telemetry_collector(Duration::from_secs(2), move |snap| {
        tel_proxy.send_event(UserEvent::Telemetry(snap)).is_ok()
    });
    spawn_weather_fetch(proxy.clone(), initial_settings.weather_location.clone());

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
                }) {
                    if needs_html_page {
                        load_target_url(&wv, &url, &mut storage);
                    }
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
        if *control_flow != ControlFlow::Exit {
            *control_flow = ControlFlow::WaitUntil(next_maintenance_at);
        }

        match event {
            // ── Periodic timer for automatic tab discarding & weather refresh ─
            Event::NewEvents(StartCause::ResumeTimeReached { .. }) => {
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
                    );
                }

                if last_weather_fetch.elapsed() >= Duration::from_secs(900) {
                    last_weather_fetch = now;
                    spawn_weather_fetch(proxy.clone(), storage.settings().weather_location.clone());
                }

                if latest_telemetry.is_none() {
                    let mem_mb = telemetry::sample_browser_memory_mb(content_webviews.len());
                    let mem_json = build_memory_payload(mem_mb, tabs.count());
                    broadcast_to_internal_views(&chrome_wv, &tabs, &content_webviews, &mem_json);
                }
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
                    UiMessage::UiReady { role } => {
                        let settings_msg = json!({
                            "type": "ui_settings_sync",
                            "settings": storage.settings().to_ui_json(),
                        });

                        if role.as_deref() == Some("newtab") {
                            broadcast_to_newtab_views(&tabs, &content_webviews, &settings_msg);
                            if let Some(snap) = &latest_telemetry {
                                let tel_msg = build_telemetry_payload(snap);
                                let mem_msg = build_memory_payload(snap.browser_mb, tabs.count());
                                broadcast_to_newtab_views(&tabs, &content_webviews, &tel_msg);
                                broadcast_to_newtab_views(&tabs, &content_webviews, &mem_msg);
                            } else {
                                let mem_mb = telemetry::sample_browser_memory_mb(content_webviews.len());
                                let mem_msg = build_memory_payload(mem_mb, tabs.count());
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
                            if let Some(active_id) = tabs.active_id() {
                                if let Some(wv) = content_webviews.get(&active_id) {
                                    let _ = wv.set_visible(true);
                                    let _ = wv.set_bounds(current_content_rect);
                                }
                            }
                            sync_chrome_ui(&chrome_wv, &tabs, &groups, &content_webviews, &mut storage, is_incognito);
                            eval_on_webview(&chrome_wv, &settings_msg);
                            if let Some(snap) = &latest_telemetry {
                                let tel_msg = build_telemetry_payload(snap);
                                let mem_msg = build_memory_payload(snap.browser_mb, tabs.count());
                                eval_on_webview(&chrome_wv, &tel_msg);
                                eval_on_webview(&chrome_wv, &mem_msg);
                            }
                        }
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
                                if !is_incognito && !url.starts_with("about:") && !is_trusted_origin(&url) {
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

                    UiMessage::SetSetting { key, value } => {
                        let old_skin = storage.settings().skin.clone();
                        if storage.set_setting(&key, &value) {
                            println!("[settings] Updated `{key}` = {value}");
                            let skin_changed = key == "skin" && storage.settings().skin != old_skin;
                            if skin_changed {
                                is_overlay_open = false;
                                let nt_target = resolve_content_url_with_settings("about:blank", storage.settings());
                                for (tid, wv) in &content_webviews {
                                    if tabs.get(*tid).map(|t| is_newtab_url(&t.url)).unwrap_or(false) {
                                        let _ = wv.load_url(&nt_target);
                                    }
                                    if Some(*tid) == tabs.active_id() {
                                        let _ = wv.set_visible(true);
                                        let _ = wv.set_bounds(current_content_rect);
                                    }
                                }
                                let sync_msg = json!({
                                    "type": "ui_settings_sync",
                                    "settings": storage.settings().to_ui_json(),
                                });
                                eval_on_webview(&chrome_wv, &sync_msg);
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
                        if storage.merge_settings_json(&settings) {
                            println!("[settings] Saved updated browser settings");
                            if storage.settings().skin != old_skin {
                                is_overlay_open = false;
                                let nt_target = resolve_content_url_with_settings("about:blank", storage.settings());
                                for (tid, wv) in &content_webviews {
                                    if tabs.get(*tid).map(|t| is_newtab_url(&t.url)).unwrap_or(false) {
                                        let _ = wv.load_url(&nt_target);
                                    }
                                    if Some(*tid) == tabs.active_id() {
                                        let _ = wv.set_visible(true);
                                        let _ = wv.set_bounds(current_content_rect);
                                    }
                                }
                            }
                            let sync_msg = json!({
                                "type": "ui_settings_sync",
                                "settings": storage.settings().to_ui_json(),
                            });
                            broadcast_to_internal_views(&chrome_wv, &tabs, &content_webviews, &sync_msg);
                        }
                    }

                    UiMessage::FetchWeather { location, force } => {
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

                        let loc_changed = query_loc != prev_loc;
                        let force_refresh = force.unwrap_or(false)
                            || loc_changed
                            || latest_weather.is_none();

                        if force_refresh {
                            last_weather_fetch = Instant::now();
                            spawn_weather_fetch(proxy.clone(), query_loc);
                        } else if let Some(w) = &latest_weather {
                            let w_msg = build_weather_payload(w);
                            broadcast_to_newtab_views(&tabs, &content_webviews, &w_msg);
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

            // ── Real-time OS & Process Telemetry Snapshot ──────────────
            Event::UserEvent(UserEvent::Telemetry(snap)) => {
                let tel_msg = build_telemetry_payload(&snap);
                let mem_msg = build_memory_payload(snap.browser_mb, tabs.count());
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
                        );
                    }
                    if last_weather_fetch.elapsed() >= Duration::from_secs(900) {
                        last_weather_fetch = now;
                        spawn_weather_fetch(proxy.clone(), storage.settings().weather_location.clone());
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
}
