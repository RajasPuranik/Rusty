//! Rusty Browser – Milestone 2
//!
//! Multi-tab browser with address bar, navigation buttons, and keyboard shortcuts.
//! Uses a two-webview architecture:
//!   1. A small toolbar webview (40px tall) at the top — renders tabs, URL bar, buttons
//!   2. A content webview filling the rest — shows the active tab's page
//!
//! IPC flow:
//!   Toolbar JS → `window.ipc.postMessage(JSON)` → Rust handler
//!   Rust → `toolbar_webview.evaluate_script("updateState(...)")` → Toolbar JS

mod tab;
mod ui;
mod url_resolver;

use anyhow::{Context, Result};
use serde::Deserialize;
use serde_json::json;
use std::collections::HashMap;
use std::env;
use tao::{
    dpi::LogicalSize,
    event::{Event, WindowEvent},
    event_loop::{ControlFlow, EventLoopBuilder},
    window::{Window, WindowBuilder},
};
use wry::{WebView, WebViewBuilder};

use tab::{TabId, TabManager};

/// Height of the toolbar in logical pixels.
const TOOLBAR_HEIGHT: f64 = 40.0;

/// Default window size.
const DEFAULT_WIDTH: f64 = 1280.0;
const DEFAULT_HEIGHT: f64 = 800.0;

/// Custom user event sent from IPC handler to the event loop.
#[derive(Debug)]
enum UserEvent {
    /// IPC message from the toolbar webview.
    ToolbarIpc(String),
    /// IPC message from a content webview (tab_id, message).
    ContentIpc(TabId, String),
    /// Title changed for a content webview.
    TitleChanged(TabId, String),
    /// URL changed in a content webview.
    UrlChanged(TabId, String),
}

/// IPC command from toolbar JS.
#[derive(Debug, Deserialize)]
struct IpcCommand {
    action: String,
    url: Option<String>,
    tab_id: Option<TabId>,
}

const CONTENT_INIT_SCRIPT: &str = r#"
window.addEventListener('keydown', (e) => {
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && e.key.toLowerCase() === 't') {
        e.preventDefault();
        window.ipc.postMessage(JSON.stringify({ action: 'new_tab' }));
    } else if (ctrl && e.key.toLowerCase() === 'w') {
        e.preventDefault();
        window.ipc.postMessage(JSON.stringify({ action: 'close_current_tab' }));
    } else if (ctrl && e.key.toLowerCase() === 'r') {
        e.preventDefault();
        window.ipc.postMessage(JSON.stringify({ action: 'reload' }));
    } else if (ctrl && e.key.toLowerCase() === 'l') {
        e.preventDefault();
        window.ipc.postMessage(JSON.stringify({ action: 'focus_address_bar' }));
    } else if (ctrl && e.key === 'Tab') {
        e.preventDefault();
        window.ipc.postMessage(JSON.stringify({ action: e.shiftKey ? 'prev_tab' : 'next_tab' }));
    } else if (e.key === 'Escape') {
        window.ipc.postMessage(JSON.stringify({ action: 'stop' }));
    }
});
"#;

/// Build a content webview for a tab positioned below the toolbar.
fn build_content_webview(
    window: &Window,
    url: &str,
    tab_id: TabId,
    proxy: tao::event_loop::EventLoopProxy<UserEvent>,
    window_width: f64,
    window_height: f64,
) -> Result<WebView> {
    let title_proxy = proxy.clone();
    let url_proxy = proxy.clone();

    let builder = WebViewBuilder::new()
        .with_bounds(wry::Rect {
            position: wry::dpi::Position::Logical(wry::dpi::LogicalPosition::new(
                0.0,
                TOOLBAR_HEIGHT,
            )),
            size: wry::dpi::Size::Logical(wry::dpi::LogicalSize::new(
                window_width,
                window_height - TOOLBAR_HEIGHT,
            )),
        })
        .with_url(url)
        .with_devtools(cfg!(debug_assertions))
        .with_initialization_script(CONTENT_INIT_SCRIPT)
        .with_ipc_handler(move |req| {
            let _ = proxy.send_event(UserEvent::ContentIpc(tab_id, req.body().to_string()));
        })
        .with_document_title_changed_handler(move |title| {
            let _ = title_proxy.send_event(UserEvent::TitleChanged(tab_id, title));
        })
        .with_navigation_handler(move |url| {
            let _ = url_proxy.send_event(UserEvent::UrlChanged(tab_id, url.clone()));
            // Allow all http/https navigation; block file:// from web content
            if url.starts_with("http://") || url.starts_with("https://") || url.starts_with("about:") {
                true
            } else {
                eprintln!("[security] Blocked navigation to: {url}");
                false
            }
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

    Ok(webview)
}

/// Build the toolbar webview.
fn build_toolbar_webview(
    window: &Window,
    proxy: tao::event_loop::EventLoopProxy<UserEvent>,
    window_width: f64,
) -> Result<WebView> {
    let builder = WebViewBuilder::new()
        .with_bounds(wry::Rect {
            position: wry::dpi::Position::Logical(wry::dpi::LogicalPosition::new(0.0, 0.0)),
            size: wry::dpi::Size::Logical(wry::dpi::LogicalSize::new(window_width, TOOLBAR_HEIGHT)),
        })
        .with_html(ui::toolbar::TOOLBAR_HTML)
        .with_ipc_handler(move |req| {
            let _ = proxy.send_event(UserEvent::ToolbarIpc(req.body().to_string()));
        })
        // Prevent the toolbar from navigating away
        .with_navigation_handler(|_url| false)
        .with_devtools(cfg!(debug_assertions));

    #[cfg(any(
        target_os = "windows",
        target_os = "macos",
        target_os = "ios",
        target_os = "android"
    ))]
    let webview = builder.build_as_child(window).context("Failed to create toolbar WebView")?;

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
        builder.build_gtk(vbox).context("Failed to create toolbar WebView (GTK)")?
    };

    Ok(webview)
}

/// Send the full UI state to the toolbar webview.
fn sync_toolbar(
    toolbar_wv: &WebView,
    tabs: &TabManager,
    content_webviews: &HashMap<TabId, WebView>,
) {
    let tab_infos = tabs.all_info();
    let active_id = tabs.active_id().unwrap_or(0);
    let active_url = tabs
        .active_tab()
        .map(|t| t.url.as_str())
        .unwrap_or("");

    let (can_back, can_fwd) = if let Some(wv) = content_webviews.get(&active_id) {
        (
            wv.can_go_back().unwrap_or(false),
            wv.can_go_forward().unwrap_or(false),
        )
    } else {
        (false, false)
    };

    let state = json!({
        "tabs": tab_infos,
        "active_tab": active_id,
        "url": active_url,
        "can_go_back": can_back,
        "can_go_forward": can_fwd,
    });

    let js = format!("updateState({})", state);
    let _ = toolbar_wv.evaluate_script(&js);
}

/// Resize all webviews when the window size changes.
fn resize_webviews(
    toolbar_wv: &WebView,
    content_webviews: &HashMap<TabId, WebView>,
    active_tab: Option<TabId>,
    width: f64,
    height: f64,
) {
    let _ = toolbar_wv.set_bounds(wry::Rect {
        position: wry::dpi::Position::Logical(wry::dpi::LogicalPosition::new(0.0, 0.0)),
        size: wry::dpi::Size::Logical(wry::dpi::LogicalSize::new(width, TOOLBAR_HEIGHT)),
    });

    if let Some(active_id) = active_tab {
        if let Some(wv) = content_webviews.get(&active_id) {
            let _ = wv.set_bounds(wry::Rect {
                position: wry::dpi::Position::Logical(wry::dpi::LogicalPosition::new(
                    0.0,
                    TOOLBAR_HEIGHT,
                )),
                size: wry::dpi::Size::Logical(wry::dpi::LogicalSize::new(
                    width,
                    height - TOOLBAR_HEIGHT,
                )),
            });
        }
    }
}

fn main() -> Result<()> {
    // ── Parse initial URL from command line ─────────────────────────────
    let initial_url = {
        let args: Vec<String> = env::args().skip(1).collect();
        if args.is_empty() {
            None
        } else {
            Some(url_resolver::resolve(&args.join(" ")))
        }
    };

    // ── Event loop with custom UserEvent ────────────────────────────────
    let event_loop = EventLoopBuilder::<UserEvent>::with_user_event().build();
    let proxy = event_loop.create_proxy();

    // ── Main window ────────────────────────────────────────────────────
    let window = WindowBuilder::new()
        .with_title("Rusty Browser")
        .with_inner_size(LogicalSize::new(DEFAULT_WIDTH, DEFAULT_HEIGHT))
        .build(&event_loop)
        .context("Failed to create window")?;

    // ── Tab state ──────────────────────────────────────────────────────
    let mut tabs = TabManager::new();
    let mut content_webviews: HashMap<TabId, WebView> = HashMap::new();

    // ── Toolbar webview ────────────────────────────────────────────────
    let toolbar_wv = build_toolbar_webview(&window, proxy.clone(), DEFAULT_WIDTH)?;

    // ── Create the first tab ───────────────────────────────────────────
    let first_url = initial_url.unwrap_or_else(|| "about:blank".to_owned());
    let first_url_display = first_url.clone();
    let first_tab_id = tabs.create_tab(first_url.clone());

    // Create the content webview for the first tab
    let first_wv = build_content_webview(
        &window,
        &first_url,
        first_tab_id,
        proxy.clone(),
        DEFAULT_WIDTH,
        DEFAULT_HEIGHT,
    )?;
    if let Some(tab) = tabs.get_mut(first_tab_id) {
        tab.has_webview = true;
    }
    content_webviews.insert(first_tab_id, first_wv);

    println!("[rusty_browser] Started with: {first_url_display}");

    // Track current window size
    let mut win_width = DEFAULT_WIDTH;
    let mut win_height = DEFAULT_HEIGHT;

    // ── Event loop ─────────────────────────────────────────────────────
    event_loop.run(move |event, _event_loop, control_flow| {
        *control_flow = ControlFlow::Wait;

        match event {
            // ── Window resize ──────────────────────────────────────────
            Event::WindowEvent {
                event: WindowEvent::Resized(size),
                ..
            } => {
                // Convert physical size to logical using scale factor
                let scale = window.scale_factor();
                win_width = size.width as f64 / scale;
                win_height = size.height as f64 / scale;
                resize_webviews(
                    &toolbar_wv,
                    &content_webviews,
                    tabs.active_id(),
                    win_width,
                    win_height,
                );
            }

            // ── Window close ───────────────────────────────────────────
            Event::WindowEvent {
                event: WindowEvent::CloseRequested,
                ..
            } => {
                *control_flow = ControlFlow::Exit;
            }

            // ── IPC from toolbar ───────────────────────────────────────
            Event::UserEvent(UserEvent::ToolbarIpc(msg)) => {
                let cmd: IpcCommand = match serde_json::from_str(&msg) {
                    Ok(c) => c,
                    Err(e) => {
                        eprintln!("[ipc] Failed to parse toolbar command: {e}");
                        return;
                    }
                };

                match cmd.action.as_str() {
                    "toolbar_ready" => {
                        sync_toolbar(&toolbar_wv, &tabs, &content_webviews);
                    }

                    "navigate" => {
                        if let Some(raw_url) = cmd.url {
                            let url = url_resolver::resolve(&raw_url);
                            if let Some(active_id) = tabs.active_id() {
                                if let Some(tab) = tabs.get_mut(active_id) {
                                    tab.url = url.clone();
                                }
                                if let Some(wv) = content_webviews.get(&active_id) {
                                    let _ = wv.load_url(&url);
                                }
                            }
                            sync_toolbar(&toolbar_wv, &tabs, &content_webviews);
                        }
                    }

                    "back" => {
                        if let Some(active_id) = tabs.active_id() {
                            if let Some(wv) = content_webviews.get(&active_id) {
                                let _ = wv.go_back();
                            }
                        }
                    }

                    "forward" => {
                        if let Some(active_id) = tabs.active_id() {
                            if let Some(wv) = content_webviews.get(&active_id) {
                                let _ = wv.go_forward();
                            }
                        }
                    }

                    "reload" => {
                        if let Some(active_id) = tabs.active_id() {
                            if let Some(wv) = content_webviews.get(&active_id) {
                                let url = tabs.get(active_id).map(|t| t.url.as_str()).unwrap_or("about:blank");
                                let _ = wv.load_url(url);
                            }
                        }
                    }

                    "stop" => {
                        if let Some(active_id) = tabs.active_id() {
                            if let Some(wv) = content_webviews.get(&active_id) {
                                let _ = wv.evaluate_script("window.stop();");
                            }
                        }
                    }

                    "focus_address_bar" => {
                        let _ = toolbar_wv.evaluate_script("window.focusAddressBar && window.focusAddressBar();");
                    }

                    "new_tab" => {
                        // Hide current content webview
                        if let Some(old_id) = tabs.active_id() {
                            if let Some(wv) = content_webviews.get(&old_id) {
                                let _ = wv.set_visible(false);
                            }
                        }

                        let new_id = tabs.create_tab("about:blank".to_owned());
                        tabs.switch_to(new_id);

                        // Create the webview for the new tab
                        match build_content_webview(
                            &window,
                            "about:blank",
                            new_id,
                            proxy.clone(),
                            win_width,
                            win_height,
                        ) {
                            Ok(wv) => {
                                // Load new tab page
                                let _ = wv.load_html(ui::new_tab::NEW_TAB_HTML);
                                if let Some(tab) = tabs.get_mut(new_id) {
                                    tab.has_webview = true;
                                }
                                content_webviews.insert(new_id, wv);
                            }
                            Err(e) => eprintln!("[error] Failed to create tab webview: {e}"),
                        }

                        sync_toolbar(&toolbar_wv, &tabs, &content_webviews);
                    }

                    "close_tab" | "close_current_tab" => {
                        let target_id = if cmd.action == "close_current_tab" {
                            tabs.active_id()
                        } else {
                            cmd.tab_id
                        };

                        if let Some(id) = target_id {
                            // Remove the webview
                            content_webviews.remove(&id);

                            let switch_to = tabs.close_tab(id);

                            if let Some(new_active) = switch_to {
                                // Show the new active tab's webview
                                if let Some(wv) = content_webviews.get(&new_active) {
                                    let _ = wv.set_visible(true);
                                    let _ = wv.set_bounds(wry::Rect {
                                        position: wry::dpi::Position::Logical(
                                            wry::dpi::LogicalPosition::new(0.0, TOOLBAR_HEIGHT),
                                        ),
                                        size: wry::dpi::Size::Logical(wry::dpi::LogicalSize::new(
                                            win_width,
                                            win_height - TOOLBAR_HEIGHT,
                                        )),
                                    });
                                }
                                sync_toolbar(&toolbar_wv, &tabs, &content_webviews);
                            } else {
                                // No tabs left — exit
                                *control_flow = ControlFlow::Exit;
                            }
                        }
                    }

                    "switch_tab" => {
                        if let Some(target_id) = cmd.tab_id {
                            let old_id = tabs.active_id();
                            if tabs.switch_to(target_id) {
                                // Hide old webview
                                if let Some(old) = old_id {
                                    if old != target_id {
                                        if let Some(wv) = content_webviews.get(&old) {
                                            let _ = wv.set_visible(false);
                                        }
                                    }
                                }
                                // Show new webview
                                if let Some(wv) = content_webviews.get(&target_id) {
                                    let _ = wv.set_visible(true);
                                    let _ = wv.set_bounds(wry::Rect {
                                        position: wry::dpi::Position::Logical(
                                            wry::dpi::LogicalPosition::new(0.0, TOOLBAR_HEIGHT),
                                        ),
                                        size: wry::dpi::Size::Logical(wry::dpi::LogicalSize::new(
                                            win_width,
                                            win_height - TOOLBAR_HEIGHT,
                                        )),
                                    });
                                }
                                sync_toolbar(&toolbar_wv, &tabs, &content_webviews);
                            }
                        }
                    }

                    "next_tab" => {
                        let old_id = tabs.active_id();
                        tabs.next_tab();
                        let new_id = tabs.active_id();
                        if old_id != new_id {
                            if let Some(old) = old_id {
                                if let Some(wv) = content_webviews.get(&old) {
                                    let _ = wv.set_visible(false);
                                }
                            }
                            if let Some(new) = new_id {
                                if let Some(wv) = content_webviews.get(&new) {
                                    let _ = wv.set_visible(true);
                                }
                            }
                            sync_toolbar(&toolbar_wv, &tabs, &content_webviews);
                        }
                    }

                    "prev_tab" => {
                        let old_id = tabs.active_id();
                        tabs.prev_tab();
                        let new_id = tabs.active_id();
                        if old_id != new_id {
                            if let Some(old) = old_id {
                                if let Some(wv) = content_webviews.get(&old) {
                                    let _ = wv.set_visible(false);
                                }
                            }
                            if let Some(new) = new_id {
                                if let Some(wv) = content_webviews.get(&new) {
                                    let _ = wv.set_visible(true);
                                }
                            }
                            sync_toolbar(&toolbar_wv, &tabs, &content_webviews);
                        }
                    }

                    other => {
                        eprintln!("[ipc] Unknown toolbar action: {other}");
                    }
                }
            }

            // ── Title changed ──────────────────────────────────────────
            Event::UserEvent(UserEvent::TitleChanged(tab_id, title)) => {
                if let Some(tab) = tabs.get_mut(tab_id) {
                    tab.title = title;
                }
                // Update window title if this is the active tab
                if tabs.active_id() == Some(tab_id) {
                    if let Some(tab) = tabs.get(tab_id) {
                        window.set_title(&format!("{} — Rusty Browser", tab.title));
                    }
                }
                sync_toolbar(&toolbar_wv, &tabs, &content_webviews);
            }

            // ── URL changed ────────────────────────────────────────────
            Event::UserEvent(UserEvent::UrlChanged(tab_id, url)) => {
                if let Some(tab) = tabs.get_mut(tab_id) {
                    tab.url = url;
                }
                if tabs.active_id() == Some(tab_id) {
                    sync_toolbar(&toolbar_wv, &tabs, &content_webviews);
                }
            }

            // ── Content IPC ────────────────────────────────────────────
            Event::UserEvent(UserEvent::ContentIpc(_tab_id, msg)) => {
                // Forward shortcuts from content webview as toolbar IPC commands
                let _ = proxy.send_event(UserEvent::ToolbarIpc(msg));
            }

            _ => {}
        }
    });
}
