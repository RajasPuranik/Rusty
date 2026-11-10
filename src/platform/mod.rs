//! Platform abstraction layer for Rusty Browser.
//!
//! Isolates engine-specific and OS-specific webview implementations (WebView2 on Windows,
//! WebKitGTK 4.1 on Linux) behind unified trait contracts (`PlatformWebView`, `PlatformHost`).

#![allow(dead_code)]
#![allow(unused_imports)]
#![allow(clippy::type_complexity)]

use std::any::Any;
use std::fmt;
use std::path::PathBuf;
use anyhow::Result;

pub use wry::Rect;
pub use wry::ProxyConfig;

#[cfg(target_os = "windows")]
pub mod windows;

pub mod linux;

/// Errors arising from the platform abstraction layer.
#[derive(Debug)]
pub enum PlatformError {
    InitializationFailed(String),
    OperationFailed(String),
    UnsupportedOperation(String),
}

impl fmt::Display for PlatformError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InitializationFailed(msg) => write!(f, "Platform initialization failed: {msg}"),
            Self::OperationFailed(msg) => write!(f, "Platform operation failed: {msg}"),
            Self::UnsupportedOperation(msg) => write!(f, "Platform operation unsupported: {msg}"),
        }
    }
}

impl std::error::Error for PlatformError {}

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
    /// Whether developer tools / inspect element is enabled.
    pub devtools: bool,
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

impl WebViewConfig {
    pub fn new(url: impl Into<String>) -> Self {
        Self {
            url: url.into(),
            bounds: wry::Rect {
                position: tao::dpi::Position::Logical(tao::dpi::LogicalPosition::new(0.0, 0.0)),
                size: tao::dpi::Size::Logical(tao::dpi::LogicalSize::new(800.0, 600.0)),
            },
            is_chrome: false,
            is_incognito: false,
            devtools: false,
            profile_name: None,
            data_directory: None,
            initialization_script: None,
            zoom_level: None,
            block_camera: false,
            block_microphone: false,
            block_geolocation: false,
            proxy_config: None,
            on_ipc: None,
            on_navigation: None,
            on_title_changed: None,
            on_new_window: None,
            on_permission: None,
            on_download_started: None,
            on_download_completed: None,
        }
    }
}

impl Default for WebViewConfig {
    fn default() -> Self {
        Self::new("about:blank")
    }
}

/// Abstract interface for a single webview instance.
pub trait PlatformWebView: Send + Sync {
    // --- Layout & Visibility ---
    /// Show or hide the webview (used for tab switching and modal occlusion).
    fn set_visible(&self, visible: bool) -> Result<()>;
    /// Update webview bounds (coordinates relative to window client area).
    fn set_bounds(&self, rect: wry::Rect) -> Result<()>;
    /// Get the current bounds of the webview.
    fn bounds(&self) -> Result<wry::Rect>;
    /// Focus the webview input.
    fn focus(&self) -> Result<()>;

    // --- Navigation & Scripts ---
    /// Navigate to a specific URL.
    fn load_url(&self, url: &str) -> Result<()>;
    /// Load an HTML string directly into the webview.
    fn load_html(&self, html: &str) -> Result<()>;
    /// Execute arbitrary JavaScript asynchronously in the webview.
    fn evaluate_script(&self, js: &str) -> Result<()>;
    /// Read the current actual committed URL from the webview.
    fn url(&self) -> Result<String>;
    /// Set the zoom magnification factor.
    fn zoom(&self, level: f64) -> Result<()>;

    // --- History Navigation ---
    /// Returns true if the webview history can navigate backward.
    fn can_go_back(&self) -> bool;
    /// Returns true if the webview history can navigate forward.
    fn can_go_forward(&self) -> bool;
    /// Navigate one step backward in history.
    fn go_back(&self) -> Result<()>;
    /// Navigate one step forward in history.
    fn go_forward(&self) -> Result<()>;

    // --- Lifecycle & RAM Optimization (R0 / R2) ---
    /// Suspend execution, pause timers, and release background resources.
    fn suspend(&self) -> Result<()>;
    /// Resume execution of a suspended webview.
    fn resume(&self) -> Result<()>;
    /// Whether the webview is currently suspended.
    fn is_suspended(&self) -> bool;
    /// Instruct the renderer to minimize its private working set (MemoryUsageTargetLevel = Low).
    fn set_memory_target_low(&self) -> Result<()>;
    /// Restore normal memory target level when the tab becomes active.
    fn set_memory_target_normal(&self) -> Result<()>;

    // --- Cookies & Storage ---
    /// Clear all browsing data (cache, cookies, local storage).
    fn clear_all_browsing_data(&self) -> Result<()>;
    /// Delete cookies associated with a specific domain or URL.
    fn delete_cookies_for_url(&self, url: &str) -> Result<()>;

    // --- Downcasting Escape Hatch ---
    fn as_any(&self) -> &dyn Any;
    fn as_any_mut(&mut self) -> &mut dyn Any;
}

impl<T: ?Sized + PlatformWebView> PlatformWebView for Box<T> {
    fn set_visible(&self, visible: bool) -> Result<()> {
        (**self).set_visible(visible)
    }
    fn set_bounds(&self, rect: wry::Rect) -> Result<()> {
        (**self).set_bounds(rect)
    }
    fn bounds(&self) -> Result<wry::Rect> {
        (**self).bounds()
    }
    fn focus(&self) -> Result<()> {
        (**self).focus()
    }
    fn load_url(&self, url: &str) -> Result<()> {
        (**self).load_url(url)
    }
    fn load_html(&self, html: &str) -> Result<()> {
        (**self).load_html(html)
    }
    fn evaluate_script(&self, js: &str) -> Result<()> {
        (**self).evaluate_script(js)
    }
    fn url(&self) -> Result<String> {
        (**self).url()
    }
    fn zoom(&self, level: f64) -> Result<()> {
        (**self).zoom(level)
    }
    fn can_go_back(&self) -> bool {
        (**self).can_go_back()
    }
    fn can_go_forward(&self) -> bool {
        (**self).can_go_forward()
    }
    fn go_back(&self) -> Result<()> {
        (**self).go_back()
    }
    fn go_forward(&self) -> Result<()> {
        (**self).go_forward()
    }
    fn suspend(&self) -> Result<()> {
        (**self).suspend()
    }
    fn resume(&self) -> Result<()> {
        (**self).resume()
    }
    fn is_suspended(&self) -> bool {
        (**self).is_suspended()
    }
    fn set_memory_target_low(&self) -> Result<()> {
        (**self).set_memory_target_low()
    }
    fn set_memory_target_normal(&self) -> Result<()> {
        (**self).set_memory_target_normal()
    }
    fn clear_all_browsing_data(&self) -> Result<()> {
        (**self).clear_all_browsing_data()
    }
    fn delete_cookies_for_url(&self, url: &str) -> Result<()> {
        (**self).delete_cookies_for_url(url)
    }
    fn as_any(&self) -> &dyn Any {
        (**self).as_any()
    }
    fn as_any_mut(&mut self) -> &mut dyn Any {
        (**self).as_any_mut()
    }
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
    fn sample_memory(&self, fallback_active_webviews: usize) -> Result<crate::telemetry::BrowserMemoryBreakdown>;

    /// Update the active proxy configuration for newly created webviews.
    fn configure_proxy(&mut self, proxy_url: Option<&str>) -> Result<()>;

    /// Downcasting escape hatch.
    fn as_any(&self) -> &dyn Any;
    fn as_any_mut(&mut self) -> &mut dyn Any;
}

/// Create the default platform host for the current operating system.
#[cfg(target_os = "windows")]
pub fn create_platform_host(user_data_dir: Option<PathBuf>) -> Result<Box<dyn PlatformHost>> {
    Ok(Box::new(windows::WindowsPlatformHost::new(user_data_dir)?))
}

/// Create the default platform host for Linux targets.
#[cfg(target_os = "linux")]
pub fn create_platform_host(user_data_dir: Option<PathBuf>) -> Result<Box<dyn PlatformHost>> {
    Ok(Box::new(linux::LinuxPlatformHost::new(user_data_dir)?))
}

/// Fallback platform host creator for non-Windows/non-Linux targets (e.g. testing stubs).
#[cfg(not(any(target_os = "windows", target_os = "linux")))]
pub fn create_platform_host(user_data_dir: Option<PathBuf>) -> Result<Box<dyn PlatformHost>> {
    Ok(Box::new(linux::StubPlatformHost::new(user_data_dir)?))
}
