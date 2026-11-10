# Survey & Architecture Specification: Platform Layer Abstraction & Windows WebView2 Isolation (Milestone R0)

**Document Target**: `d:\browser`  
**Milestone**: R0 (Baseline Measurement & Platform Layer Abstraction)  
**Author**: Explorer R0-2 (Platform Layer Trait & Windows WebView2 Isolation Explorer)  
**Date**: 2026-11-09  
**Status**: Ready for Worker Implementation  

---

## 1. Executive Summary

Milestone R0 requires isolating all WebView2 (and future WebKitGTK 4.1) platform-specific operations behind a modular Rust abstraction layer (`PlatformLayer` / `PlatformWebView` / `PlatformHost`). Currently, `src/main.rs` directly instantiates `wry::WebViewBuilder`, binds Windows-specific extensions (`wry::WebViewBuilderExtWindows`, `wry::WebViewExtWindows`), and manages webviews using concrete `wry::WebView` structs.

This architectural survey presents the complete design for:
1. `src/platform/mod.rs`: Platform-agnostic trait definitions (`PlatformWebView`, `PlatformHost`), configuration structs (`WebViewConfig`), and error types (`PlatformError`).
2. `src/platform/windows.rs`: Concrete Windows implementation wrapping `wry::WebView` and Microsoft Edge WebView2 COM interfaces (`ICoreWebView2Controller`, `ICoreWebView2_3`, `ICoreWebView2_19`, `ICoreWebView2_2`, `ICoreWebView2CookieManager`).
3. Clean integration with `src/main.rs`: Migrating `content_webviews: HashMap<TabId, Box<dyn PlatformWebView>>` and `chrome_wv: Box<dyn PlatformWebView>` while completely preserving dual-layer windowing, split-view layout deduplication, modal occlusion protocols, and watchdog event tracking.
4. Step-by-step worker implementation guide: Direct file additions, signature adaptations, and verification commands.

---

## 2. Platform Architecture & Module Layout

The codebase will introduce a dedicated `src/platform/` directory structure:

```text
src/
├── platform/
│   ├── mod.rs          // Engine-agnostic traits (PlatformWebView, PlatformHost), configs, errors
│   ├── windows.rs      // Concrete Windows implementation (wry + WebView2 COM)
│   └── linux.rs        // Forward-compatible Linux stub / WebKitGTK placeholder (for R3)
├── main.rs             // Tao event loop, IPC router, window lifecycle (integrates PlatformHost)
├── tab.rs              // Pure Rust tab domain model (completely decoupled from webviews)
├── telemetry.rs        // Process-tree memory sampling & Task Manager reconciliation
└── storage.rs          // Atomic persistence and settings
```

### 2.1 Separation of Concerns

| Component | Responsibility | Boundary |
| :--- | :--- | :--- |
| `PlatformHost` | Manages environment lifecycle, shared runtime context, proxy configuration, profile directory isolation, and process-tree memory sampling. | Factory & Host Coordinator |
| `PlatformWebView` | Encapsulates single webview instance: bounds, visibility, navigation, script evaluation, tab suspension (`TrySuspend`), memory target tuning (`MemoryUsageTargetLevel`), history navigation, and cookie cleanup. | Instance Interface |
| `WebViewConfig` | Parameter payload defining URL, initial bounds, origin permissions, script injection, incognito flag, isolated profile name, and event callbacks. | Construction Specification |
| `src/main.rs` | Drives Tao window event loop, translates user actions into UI IPC messages, enforces modal occlusion, handles keyboard shortcuts, and triggers telemetry sync. | Application Controller |

---

## 3. Platform Trait Definitions (`src/platform/mod.rs`)

`src/platform/mod.rs` defines the authoritative contract for the entire platform subsystem.

```rust
//! Platform abstraction layer for Rusty Browser.
//!
//! Decouples webview runtime implementations (WebView2 on Windows, WebKitGTK on Linux)
//! from the browser core application logic.

use std::any::Any;
use std::path::PathBuf;
use anyhow::Result;

#[cfg(target_os = "windows")]
pub mod windows;

#[cfg(not(target_os = "windows"))]
pub mod linux;

pub use wry::Rect;
pub use wry::ProxyConfig;

/// Permission kind requested by web content.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PlatformPermissionKind {
    Camera,
    Microphone,
    Geolocation,
    Other,
}

/// Permission response decision.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PlatformPermissionResponse {
    Allow,
    Deny,
    Default,
}

/// Configuration options and event callbacks for constructing a webview instance.
pub struct WebViewConfig {
    /// Initial URL to load.
    pub url: String,
    /// Bounding rectangle for the webview inside the host window.
    pub bounds: wry::Rect,
    /// Whether this webview hosts the Chrome UI shell (`rusty://app/index.html`) or web content.
    pub is_chrome: bool,
    /// Whether to enable private / incognito browsing.
    pub is_incognito: bool,
    /// Optional isolated profile name (for R1 isolated workspaces sharing the environment).
    pub profile_name: Option<String>,
    /// Optional dedicated user data directory (for full runtime isolation).
    pub data_directory: Option<PathBuf>,
    /// JavaScript code injected at document creation before any other scripts run.
    pub initialization_script: Option<String>,
    /// Initial zoom level (1.0 = 100%).
    pub zoom_level: Option<f64>,
    /// Privacy sandbox permission policies.
    pub block_camera: bool,
    pub block_microphone: bool,
    pub block_geolocation: bool,
    /// Optional proxy configuration for this webview.
    pub proxy_config: Option<wry::ProxyConfig>,

    // Event Callbacks (Send + Sync closures)
    pub on_ipc: Option<Box<dyn Fn(&str, &str) + Send + Sync>>,
    pub on_navigation: Option<Box<dyn Fn(&str) -> bool + Send + Sync>>,
    pub on_title_changed: Option<Box<dyn Fn(String) + Send + Sync>>,
    pub on_new_window: Option<Box<dyn Fn(String) -> bool + Send + Sync>>,
    pub on_permission: Option<Box<dyn Fn(PlatformPermissionKind) -> PlatformPermissionResponse + Send + Sync>>,
    pub on_download_started: Option<Box<dyn Fn(String, &mut PathBuf) -> bool + Send + Sync>>,
    pub on_download_completed: Option<Box<dyn Fn(String, Option<PathBuf>, bool) + Send + Sync>>,
}

/// Abstract interface for a single webview instance.
pub trait PlatformWebView: Send + Sync {
    // --- Layout & Visibility ---
    /// Show or hide the webview (used for tab switching and modal occlusion).
    fn set_visible(&mut self, visible: bool) -> Result<()>;
    /// Update webview bounds (coordinates relative to window client area).
    fn set_bounds(&mut self, rect: wry::Rect) -> Result<()>;
    /// Get the current bounds of the webview.
    fn bounds(&self) -> Result<wry::Rect>;
    /// Focus the webview input.
    fn focus(&self) -> Result<()>;

    // --- Navigation & Scripts ---
    /// Navigate to a specific URL.
    fn load_url(&mut self, url: &str) -> Result<()>;
    /// Load an HTML string directly into the webview.
    fn load_html(&mut self, html: &str) -> Result<()>;
    /// Execute arbitrary JavaScript asynchronously in the webview.
    fn evaluate_script(&mut self, js: &str) -> Result<()>;
    /// Read the current actual committed URL from the webview.
    fn url(&self) -> Result<String>;
    /// Set the zoom magnification factor.
    fn zoom(&mut self, level: f64) -> Result<()>;

    // --- History Navigation ---
    /// Returns true if the webview history can navigate backward.
    fn can_go_back(&self) -> bool;
    /// Returns true if the webview history can navigate forward.
    fn can_go_forward(&self) -> bool;
    /// Navigate one step backward in history.
    fn go_back(&mut self) -> Result<()>;
    /// Navigate one step forward in history.
    fn go_forward(&mut self) -> Result<()>;

    // --- Lifecycle & RAM Optimization (R0 / R2) ---
    /// Suspend execution, pause timers, and release background resources.
    fn suspend(&mut self) -> Result<()>;
    /// Resume execution of a suspended webview.
    fn resume(&mut self) -> Result<()>;
    /// Whether the webview is currently suspended.
    fn is_suspended(&self) -> bool;
    /// Instruct the renderer to minimize its private working set (MemoryUsageTargetLevel = Low).
    fn set_memory_target_low(&mut self) -> Result<()>;
    /// Restore normal memory target level when the tab becomes active.
    fn set_memory_target_normal(&mut self) -> Result<()>;

    // --- Cookies & Storage ---
    /// Clear all browsing data (cache, cookies, local storage).
    fn clear_all_browsing_data(&mut self) -> Result<()>;
    /// Delete cookies associated with a specific domain or URL.
    fn delete_cookies_for_url(&mut self, url: &str) -> Result<()>;

    // --- Downcasting Escape Hatch ---
    fn as_any(&self) -> &dyn Any;
    fn as_any_mut(&mut self) -> &mut dyn Any;
}

/// Abstract interface for the host platform environment and webview factory.
pub trait PlatformHost: Send + Sync {
    /// Create a new webview attached to the specified window.
    fn create_webview(
        &mut self,
        window: &tao::window::Window,
        config: WebViewConfig,
    ) -> Result<Box<dyn PlatformWebView>>;

    /// Sample process-tree memory telemetry across all host and child processes.
    fn sample_memory(&self) -> Result<crate::telemetry::BrowserMemoryBreakdown>;

    /// Update the active proxy configuration for newly created webviews.
    fn configure_proxy(&mut self, proxy_url: Option<&str>) -> Result<()>;

    /// Downcasting escape hatch.
    fn as_any(&self) -> &dyn Any;
    fn as_any_mut(&mut self) -> &mut dyn Any;
}

/// Platform factory function.
#[cfg(target_os = "windows")]
pub fn create_platform_host(user_data_dir: Option<PathBuf>) -> Result<Box<dyn PlatformHost>> {
    Ok(Box::new(windows::WindowsPlatformHost::new(user_data_dir)?))
}
```

---

## 4. Windows Concrete Implementation (`src/platform/windows.rs`)

### 4.1 Architecture & COM Interface Integration

On Windows 11, `WindowsPlatformHost` and `WindowsWebView` leverage `wry 0.57.1`, `webview2-com 0.39.1`, and raw COM interfaces:

```
┌────────────────────────────────────────────────────────┐
│ WindowsPlatformHost                                    │
│ - user_data_dir: PathBuf                               │
│ - web_context: wry::WebContext                         │
│ - shared_env: Option<ICoreWebView2Environment>         │
│ - active_proxy: Option<wry::ProxyConfig>               │
└───────────────────────────┬────────────────────────────┘
                            │ creates
                            ▼
┌────────────────────────────────────────────────────────┐
│ WindowsWebView                                         │
│ - inner: wry::WebView                                  │
│ - is_suspended: bool                                   │
│ - last_bounds: wry::Rect                               │
│ ┌────────────────────────────────────────────────────┐ │
│ │ Raw COM Interfaces:                                │ │
│ │ - ICoreWebView2Controller (via controller())       │ │
│ │ - ICoreWebView2 (via webview())                    │ │
│ │ - ICoreWebView2_3 (TrySuspend, Resume)             │ │
│ │ - ICoreWebView2_19 (SetMemoryUsageTargetLevel)     │ │
│ │ - ICoreWebView2_2 (CookieManager)                  │ │
│ └────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────┘
```

### 4.2 Handling `Send` + `Sync` Thread Safety

`wry::WebView` internally contains a `RefCell<HWND>` and raw Win32 HWND handles, which prevents compiler auto-trait derivation for `Send` and `Sync`. 

However, in Rusty Browser:
- All `PlatformWebView` instances reside strictly on the Tao UI thread (STA apartment).
- The `PlatformWebView` trait specifies `Send + Sync` to permit storage in dynamic trait objects (`Box<dyn PlatformWebView>`) and cross-module interfaces.
- Therefore, we implement `unsafe impl Send for WindowsWebView {}` and `unsafe impl Sync for WindowsWebView {}` with explicit safety comments:

```rust
// SAFETY: WindowsWebView instances are created, manipulated, and dropped exclusively
// on the main Tao UI thread (Windows STA apartment). wry::WebView contains Win32 HWND
// handles and RefCell which prevent compiler auto-traits, but single-threaded UI loop
// ownership ensures absence of data races.
unsafe impl Send for WindowsWebView {}
unsafe impl Sync for WindowsWebView {}
```

### 4.3 Concrete Implementation Code (`src/platform/windows.rs`)

```rust
//! Concrete Windows platform implementation using wry and WebView2 COM interfaces.

use std::any::Any;
use std::path::PathBuf;
use anyhow::{Context, Result, anyhow};

use tao::window::Window;
use wry::{WebContext, WebView, WebViewBuilder};
use wry::{WebViewBuilderExtWindows, WebViewExtWindows};
use wry::MemoryUsageLevel;

use webview2_com::Microsoft::Web::WebView2::Win32::{
    ICoreWebView2, ICoreWebView2Controller, ICoreWebView2Environment,
    ICoreWebView2_2, ICoreWebView2_3, ICoreWebView2_19,
    COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW,
    COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL,
};
use windows::core::Interface;

use super::{
    PlatformHost, PlatformPermissionKind, PlatformPermissionResponse,
    PlatformWebView, WebViewConfig,
};
use crate::telemetry::{self, BrowserMemoryBreakdown};

/// Concrete Windows implementation of PlatformWebView.
pub struct WindowsWebView {
    inner: WebView,
    is_suspended: bool,
    last_bounds: wry::Rect,
}

unsafe impl Send for WindowsWebView {}
unsafe impl Sync for WindowsWebView {}

impl WindowsWebView {
    pub fn new(inner: WebView, bounds: wry::Rect) -> Self {
        Self {
            inner,
            is_suspended: false,
            last_bounds: bounds,
        }
    }

    /// Access the underlying wry::WebView.
    pub fn inner(&self) -> &WebView {
        &self.inner
    }

    /// Access the raw ICoreWebView2Controller pointer.
    pub fn raw_controller(&self) -> ICoreWebView2Controller {
        self.inner.controller()
    }

    /// Access the raw ICoreWebView2 pointer.
    pub fn raw_webview(&self) -> ICoreWebView2 {
        self.inner.webview()
    }

    /// Access the raw ICoreWebView2Environment pointer.
    pub fn raw_environment(&self) -> ICoreWebView2Environment {
        self.inner.environment()
    }
}

impl PlatformWebView for WindowsWebView {
    fn set_visible(&mut self, visible: bool) -> Result<()> {
        self.inner.set_visible(visible).context("Failed to set webview visibility")
    }

    fn set_bounds(&mut self, rect: wry::Rect) -> Result<()> {
        self.last_bounds = rect;
        self.inner.set_bounds(rect).context("Failed to set webview bounds")
    }

    fn bounds(&self) -> Result<wry::Rect> {
        Ok(self.last_bounds)
    }

    fn focus(&self) -> Result<()> {
        self.inner.focus().context("Failed to focus webview")
    }

    fn load_url(&mut self, url: &str) -> Result<()> {
        self.inner.load_url(url).context("Failed to load URL")
    }

    fn load_html(&mut self, html: &str) -> Result<()> {
        self.inner.load_html(html).context("Failed to load HTML")
    }

    fn evaluate_script(&mut self, js: &str) -> Result<()> {
        self.inner.evaluate_script(js).context("Failed to evaluate script")
    }

    fn url(&self) -> Result<String> {
        self.inner.url().context("Failed to read webview URL")
    }

    fn zoom(&mut self, level: f64) -> Result<()> {
        self.inner.zoom(level).context("Failed to set webview zoom level")
    }

    fn can_go_back(&self) -> bool {
        self.inner.can_go_back().unwrap_or(false)
    }

    fn can_go_forward(&self) -> bool {
        self.inner.can_go_forward().unwrap_or(false)
    }

    fn go_back(&mut self) -> Result<()> {
        self.inner.go_back().context("Failed to navigate back")
    }

    fn go_forward(&mut self) -> Result<()> {
        self.inner.go_forward().context("Failed to navigate forward")
    }

    fn suspend(&mut self) -> Result<()> {
        let wv = self.inner.webview();
        let wv3: ICoreWebView2_3 = wv.cast().context("Failed to cast to ICoreWebView2_3")?;
        unsafe {
            wv3.TrySuspend(None).ok().context("TrySuspend failed")?;
        }
        self.is_suspended = true;
        tracing::info!("[platform] Successfully suspended WebView2 tab");
        Ok(())
    }

    fn resume(&mut self) -> Result<()> {
        let wv = self.inner.webview();
        let wv3: ICoreWebView2_3 = wv.cast().context("Failed to cast to ICoreWebView2_3")?;
        unsafe {
            wv3.Resume().ok().context("Resume failed")?;
        }
        self.is_suspended = false;
        tracing::info!("[platform] Successfully resumed WebView2 tab");
        Ok(())
    }

    fn is_suspended(&self) -> bool {
        self.is_suspended
    }

    fn set_memory_target_low(&mut self) -> Result<()> {
        self.inner.set_memory_usage_level(MemoryUsageLevel::Low)
            .context("Failed to set memory usage level to Low")
    }

    fn set_memory_target_normal(&mut self) -> Result<()> {
        self.inner.set_memory_usage_level(MemoryUsageLevel::Normal)
            .context("Failed to set memory usage level to Normal")
    }

    fn clear_all_browsing_data(&mut self) -> Result<()> {
        self.inner.clear_all_browsing_data().context("Failed to clear browsing data")
    }

    fn delete_cookies_for_url(&mut self, url: &str) -> Result<()> {
        let wv = self.inner.webview();
        if let Ok(wv2) = wv.cast::<ICoreWebView2_2>() {
            unsafe {
                if let Ok(cookie_mgr) = wv2.CookieManager() {
                    let parsed = url::Url::parse(url).unwrap_or_else(|_| url::Url::parse("http://localhost").unwrap());
                    let domain = parsed.host_str().unwrap_or("");
                    let domain_hstring = windows::core::HSTRING::from(domain);
                    let path_hstring = windows::core::HSTRING::from("/");
                    let _ = cookie_mgr.DeleteCookiesWithDomainAndPath(
                        &windows::core::PCWSTR(domain_hstring.as_wide().as_ptr()),
                        &windows::core::PCWSTR(path_hstring.as_wide().as_ptr()),
                    );
                }
            }
        }
        Ok(())
    }

    fn as_any(&self) -> &dyn Any {
        self
    }

    fn as_any_mut(&mut self) -> &mut dyn Any {
        self
    }
}

/// Concrete Windows implementation of PlatformHost.
pub struct WindowsPlatformHost {
    user_data_dir: PathBuf,
    web_context: WebContext,
    shared_env: Option<ICoreWebView2Environment>,
    active_proxy: Option<wry::ProxyConfig>,
}

unsafe impl Send for WindowsPlatformHost {}
unsafe impl Sync for WindowsPlatformHost {}

impl WindowsPlatformHost {
    pub fn new(user_data_dir: Option<PathBuf>) -> Result<Self> {
        let dir = user_data_dir.unwrap_or_else(|| {
            dirs::data_dir()
                .unwrap_or_else(|| PathBuf::from("."))
                .join("rusty_browser")
                .join("WebView2")
        });

        std::fs::create_dir_all(&dir)
            .with_context(|| format!("Failed to create WebView2 data dir: {}", dir.display()))?;

        telemetry::set_webview_data_dir(&dir);

        let web_context = WebContext::new(Some(dir.clone()));

        Ok(Self {
            user_data_dir: dir,
            web_context,
            shared_env: None,
            active_proxy: None,
        })
    }
}

impl PlatformHost for WindowsPlatformHost {
    fn create_webview(
        &mut self,
        window: &Window,
        config: WebViewConfig,
    ) -> Result<Box<dyn PlatformWebView>> {
        let mut builder = WebViewBuilder::new_with_web_context(&mut self.web_context)
            .with_bounds(config.bounds)
            .with_custom_protocol("rusty".into(), crate::ui::app_protocol::handle_rusty_request)
            .with_url(&config.url)
            .with_incognito(config.is_incognito)
            .with_devtools(cfg!(debug_assertions))
            .with_browser_accelerator_keys(true)
            .with_default_context_menus(true);

        if let Some(ref script) = config.initialization_script {
            builder = builder.with_initialization_script(script);
        }

        if let Some(ref proxy) = config.proxy_config.as_ref().or(self.active_proxy.as_ref()) {
            builder = builder.with_proxy_config((*proxy).clone());
        }

        if let Some(ref profile_name) = config.profile_name {
            builder = builder.with_profile_name(profile_name);
        }

        // Share the runtime environment across content webviews to save memory
        if !config.is_chrome {
            if let Some(ref env) = self.shared_env {
                builder = builder.with_environment(env.clone());
            }
        }

        // Wire IPC handler
        if let Some(on_ipc) = config.on_ipc {
            builder = builder.with_ipc_handler(move |req| {
                let uri = req.uri().to_string();
                let body = req.body().to_string();
                on_ipc(&uri, &body);
            });
        }

        // Wire Navigation handler
        if let Some(on_nav) = config.on_navigation {
            builder = builder.with_navigation_handler(move |url| on_nav(&url));
        }

        // Wire Title changed handler
        if let Some(on_title) = config.on_title_changed {
            builder = builder.with_document_title_changed_handler(move |title| on_title(title));
        }

        // Wire New Window request handler
        if let Some(on_new_win) = config.on_new_window {
            builder = builder.with_new_window_req_handler(move |uri, _features| {
                if on_new_win(uri) {
                    wry::NewWindowResponse::Allow
                } else {
                    wry::NewWindowResponse::Deny
                }
            });
        }

        // Wire Permission handler
        let block_cam = config.block_camera;
        let block_mic = config.block_microphone;
        let block_geo = config.block_geolocation;
        let custom_perm = config.on_permission;

        builder = builder.with_permission_handler(move |kind| {
            if let Some(ref handler) = custom_perm {
                let pk = match kind {
                    wry::PermissionKind::Camera => PlatformPermissionKind::Camera,
                    wry::PermissionKind::Microphone => PlatformPermissionKind::Microphone,
                    wry::PermissionKind::Geolocation => PlatformPermissionKind::Geolocation,
                    _ => PlatformPermissionKind::Other,
                };
                return match handler(pk) {
                    PlatformPermissionResponse::Allow => wry::PermissionResponse::Allow,
                    PlatformPermissionResponse::Deny => wry::PermissionResponse::Deny,
                    PlatformPermissionResponse::Default => wry::PermissionResponse::Default,
                };
            }

            match kind {
                wry::PermissionKind::Camera if block_cam => wry::PermissionResponse::Deny,
                wry::PermissionKind::Microphone if block_mic => wry::PermissionResponse::Deny,
                wry::PermissionKind::Geolocation if block_geo => wry::PermissionResponse::Deny,
                _ => wry::PermissionResponse::Default,
            }
        });

        // Wire Download handlers
        if let Some(on_dl_start) = config.on_download_started {
            builder = builder.with_download_started_handler(move |url, dest| on_dl_start(url, dest));
        }
        if let Some(on_dl_done) = config.on_download_completed {
            builder = builder.with_download_completed_handler(move |url, dest, success| {
                on_dl_done(url, dest, success)
            });
        }

        let inner_wv = builder.build_as_child(window)
            .context("Failed to build child WebView on Windows")?;

        // Cache shared environment from Chrome webview for all subsequent child webviews
        if config.is_chrome && self.shared_env.is_none() {
            self.shared_env = Some(inner_wv.environment());
        }

        if let Some(zoom) = config.zoom_level {
            if (zoom - 1.0).abs() > 0.01 {
                let _ = inner_wv.zoom(zoom);
            }
        }

        let bounds = config.bounds;
        Ok(Box::new(WindowsWebView::new(inner_wv, bounds)))
    }

    fn sample_memory(&self) -> Result<BrowserMemoryBreakdown> {
        Ok(telemetry::sample_browser_memory_breakdown(1))
    }

    fn configure_proxy(&mut self, proxy_url: Option<&str>) -> Result<()> {
        if let Some(url_str) = proxy_url {
            let parsed = url::Url::parse(url_str)
                .with_context(|| format!("Invalid proxy URL: {url_str}"))?;
            let host = parsed.host_str().unwrap_or("127.0.0.1").to_string();
            let port = parsed.port().unwrap_or(8080).to_string();
            let endpoint = wry::ProxyEndpoint { host, port };

            let proxy_cfg = match parsed.scheme() {
                "socks5" | "socks5h" => wry::ProxyConfig::Socks5(endpoint),
                _ => wry::ProxyConfig::Http(endpoint),
            };
            self.active_proxy = Some(proxy_cfg);
        } else {
            self.active_proxy = None;
        }
        Ok(())
    }

    fn as_any(&self) -> &dyn Any {
        self
    }

    fn as_any_mut(&mut self) -> &mut dyn Any {
        self
    }
}
```

---

## 5. Integration Strategy for `src/main.rs`

Integrating the platform layer into `src/main.rs` is straightforward and surgical. The dual-layer windowing, Split View engine, and modal occlusion protocol are completely preserved without semantic disruption.

### 5.1 Type Definitions & Struct Fields

In `src/main.rs`:
```rust
// Replace direct wry webview imports with the platform layer
mod platform;
use platform::{
    create_platform_host, PlatformHost, PlatformWebView, WebViewConfig,
    PlatformPermissionKind, PlatformPermissionResponse,
};
```

Update state variables in `fn main()`:
```rust
// Before:
// let mut content_webviews: HashMap<TabId, WebView> = HashMap::new();
// let chrome_wv = build_chrome_webview(...)?;

// After:
let mut platform_host = create_platform_host(Some(wv_data_dir))?;
let chrome_wv = build_chrome_webview(&window, &mut *platform_host, proxy.clone(), window_width, window_height, &storage.settings())?;
let mut content_webviews: HashMap<TabId, Box<dyn PlatformWebView>> = HashMap::new();
```

### 5.2 Helper Functions Migration

1. `build_chrome_webview`:
   Takes `&mut dyn PlatformHost` instead of `&mut WebContext`.
   Constructs a `WebViewConfig` with `is_chrome: true` and calls `host.create_webview(window, config)`.
   Returns `Result<Box<dyn PlatformWebView>>`.

2. `build_content_webview`:
   Takes `&mut dyn PlatformHost` instead of `shared_webview: Option<&WebView>`.
   Constructs `WebViewConfig` with `is_chrome: false`, `bounds: content_rect`, `initialization_script`, and the existing IPC / navigation / permission callbacks.
   Returns `Result<Box<dyn PlatformWebView>>`.

3. `ensure_tab_webview` & `apply_layout_and_visibility`:
   Signatures update `content_webviews: &mut HashMap<TabId, Box<dyn PlatformWebView>>` and `chrome_wv: &dyn PlatformWebView`.
   All method invocations (`set_visible`, `set_bounds`, `load_url`, `evaluate_script`, `can_go_back`, `can_go_forward`, `go_back`, `go_forward`, `zoom`, `focus`) match `PlatformWebView` 1:1.

4. Modal Occlusion (`UiMessage::Overlay { open }`):
   When `open` is true:
   ```rust
   for wv in content_webviews.values_mut() {
       let _ = wv.set_visible(false);
   }
   ```
   Unchanged in syntax and behavior.

---

## 6. Capabilities Coverage Matrix

| Capability Area | Milestone Requirements | Platform Layer Interface & Implementation |
| :--- | :--- | :--- |
| **Webview Lifecycle** | Create, destroy, show, hide, suspend, resume, discard | `PlatformHost::create_webview`, `Drop`, `PlatformWebView::set_visible`, `PlatformWebView::suspend` (`TrySuspend`), `PlatformWebView::resume` (`Resume`), `is_suspended` |
| **Layout & Bounds** | Dynamic positioning inside `#content-viewport`, split view side-by-side | `PlatformWebView::set_bounds(wry::Rect)`, `bounds() -> Result<wry::Rect>`, deduplication with epsilon `0.5px` |
| **Request Interception & Blocking** | Origin gating, accelerator whitelisting, popup denial | `WebViewConfig::on_navigation` (URL verification), `WebViewConfig::on_new_window` (`Deny`), `WebViewConfig::on_permission` |
| **Proxy Configuration** | Userspace proxy support (HTTP & SOCKSv5) | `PlatformHost::configure_proxy(&mut self, Option<&str>)`, `wry::ProxyConfig::Http`, `wry::ProxyConfig::Socks5` |
| **Cookie Management & Isolation** | Profile isolation, cookie deletion per domain/URL | `WebViewConfig::profile_name` (`with_profile_name`), `PlatformWebView::delete_cookies_for_url` (`ICoreWebView2CookieManager::DeleteCookiesWithDomainAndPath`), `clear_all_browsing_data` |
| **Memory Telemetry** | Private Working Set process-tree walk, Task Manager reconciliation | `PlatformHost::sample_memory() -> Result<BrowserMemoryBreakdown>` delegating to `telemetry::sample_browser_memory_breakdown` |

---

## 7. Step-by-Step Implementation Guide for the Worker

The implementing Worker should execute these steps sequentially:

### Phase 1: Create Trait Definitions
1. Create directory `src/platform/`.
2. Write `src/platform/mod.rs` with the traits, configs, and error enums specified in Section 3.
3. Include forward-compatible feature gates (`#[cfg(target_os = "windows")]`, `#[cfg(not(target_os = "windows"))]`).

### Phase 2: Create Windows Implementation
1. Write `src/platform/windows.rs` with `WindowsWebView` and `WindowsPlatformHost` as specified in Section 4.3.
2. Implement `PlatformWebView` wrapping `wry::WebView` and COM queries (`ICoreWebView2_3::TrySuspend`, `Resume`, `ICoreWebView2_19::SetMemoryUsageTargetLevel`, `ICoreWebView2_2::CookieManager`).
3. Add safety documentation for `unsafe impl Send` / `unsafe impl Sync`.

### Phase 3: Create Linux Forward-Compatible Stub
1. Write `src/platform/linux.rs` defining `LinuxPlatformHost` and `LinuxWebView` with placeholder stubs that compile cleanly on non-Windows platforms.

### Phase 4: Adapt `src/main.rs`
1. Add `mod platform;` to `src/main.rs`.
2. Update `build_chrome_webview` and `build_content_webview` to accept `&mut dyn PlatformHost`.
3. Update `content_webviews` type from `HashMap<TabId, WebView>` to `HashMap<TabId, Box<dyn PlatformWebView>>`.
4. Update `chrome_wv` to `Box<dyn PlatformWebView>`.
5. In `main()`, instantiate `create_platform_host(Some(wv_data_dir))?` and pass it to webview builders.

### Phase 5: Verification & Compilation
1. Run `cargo check` to verify successful compilation.
2. Run `cargo clippy --all-targets -- -D warnings` to verify zero warnings.
3. Run `cargo test` to confirm all 51 automated unit tests pass.
4. Run `powershell -ExecutionPolicy Bypass -File .\verify_memory.ps1` to verify process-tree memory telemetry.

---

## 8. Risks, Edge Cases & Mitigation Strategies

1. **COM STA Thread Affinity**:
   - *Risk*: Calling WebView2 COM methods from background threads (e.g., watchdog or telemetry collector) causes COM RPC marshal errors (`RPC_E_WRONG_THREAD`).
   - *Mitigation*: All `PlatformWebView` methods must only be called from the main event loop thread. Background threads dispatch `UserEvent` to the main loop via `EventLoopProxy`.

2. **Environment Sharing vs Isolation**:
   - *Risk*: Content webviews with different browser arguments or incompatible environments fail to initialize.
   - *Mitigation*: Standard content webviews share the `ICoreWebView2Environment` of the Chrome webview (`self.shared_env`). Isolated workspaces in Milestone R1 use `with_profile_name` within the same environment (or dedicated `WebContext` with isolated user data dir).

3. **Window Resizing and Bounds Synchronization**:
   - *Risk*: Rapid window resize events generate flooding Win32 messages causing visual jitter.
   - *Mitigation*: Retain `rects_approx_eq` with epsilon `0.5px` in `src/main.rs` to deduplicate unnecessary Win32 `SetWindowPos` calls.
