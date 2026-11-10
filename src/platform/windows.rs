//! Concrete Windows platform implementation using wry and WebView2 COM interfaces.

#![allow(dead_code)]

use std::any::Any;
use std::path::PathBuf;
use anyhow::{Context, Result};

use tao::window::Window;
use wry::{MemoryUsageLevel, WebContext, WebView, WebViewBuilder};
use wry::{WebViewBuilderExtWindows, WebViewExtWindows};

use webview2_com::Microsoft::Web::WebView2::Win32::{
    ICoreWebView2, ICoreWebView2Controller, ICoreWebView2Environment,
    ICoreWebView2_2, ICoreWebView2_3,
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
    is_suspended: std::sync::atomic::AtomicBool,
    last_bounds: std::sync::Mutex<wry::Rect>,
}

// SAFETY: WindowsWebView instances are created, manipulated, and dropped exclusively
// on the main Tao UI thread (Windows STA apartment). wry::WebView contains Win32 HWND
// handles and RefCell which prevent compiler auto-traits, but single-threaded UI loop
// ownership ensures absence of data races.
unsafe impl Send for WindowsWebView {}
unsafe impl Sync for WindowsWebView {}

impl WindowsWebView {
    pub fn new(inner: WebView, bounds: wry::Rect) -> Self {
        Self {
            inner,
            is_suspended: std::sync::atomic::AtomicBool::new(false),
            last_bounds: std::sync::Mutex::new(bounds),
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
    fn set_visible(&self, visible: bool) -> Result<()> {
        self.inner.set_visible(visible).context("Failed to set webview visibility")
    }

    fn set_bounds(&self, rect: wry::Rect) -> Result<()> {
        if let Ok(mut b) = self.last_bounds.lock() {
            *b = rect;
        }
        self.inner.set_bounds(rect).context("Failed to set webview bounds")
    }

    fn bounds(&self) -> Result<wry::Rect> {
        Ok(*self.last_bounds.lock().unwrap())
    }

    fn focus(&self) -> Result<()> {
        self.inner.focus().context("Failed to focus webview")
    }

    fn load_url(&self, url: &str) -> Result<()> {
        self.inner.load_url(url).context("Failed to load URL")
    }

    fn load_html(&self, html: &str) -> Result<()> {
        self.inner.load_html(html).context("Failed to load HTML")
    }

    fn evaluate_script(&self, js: &str) -> Result<()> {
        self.inner.evaluate_script(js).context("Failed to evaluate script")
    }

    fn url(&self) -> Result<String> {
        self.inner.url().context("Failed to read webview URL")
    }

    fn zoom(&self, level: f64) -> Result<()> {
        self.inner.zoom(level).context("Failed to set webview zoom level")
    }

    fn can_go_back(&self) -> bool {
        self.inner.can_go_back().unwrap_or(false)
    }

    fn can_go_forward(&self) -> bool {
        self.inner.can_go_forward().unwrap_or(false)
    }

    fn go_back(&self) -> Result<()> {
        self.inner.go_back().context("Failed to navigate back")
    }

    fn go_forward(&self) -> Result<()> {
        self.inner.go_forward().context("Failed to navigate forward")
    }

    fn suspend(&self) -> Result<()> {
        let wv = self.inner.webview();
        let wv3: ICoreWebView2_3 = wv.cast().context("Failed to cast to ICoreWebView2_3")?;
        unsafe {
            let handler = None::<&webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2TrySuspendCompletedHandler>;
            wv3.TrySuspend(handler).ok().context("TrySuspend failed")?;
        }
        self.is_suspended.store(true, std::sync::atomic::Ordering::SeqCst);
        tracing::info!("[platform] Successfully suspended WebView2 tab");
        Ok(())
    }

    fn resume(&self) -> Result<()> {
        let wv = self.inner.webview();
        let wv3: ICoreWebView2_3 = wv.cast().context("Failed to cast to ICoreWebView2_3")?;
        unsafe {
            wv3.Resume().ok().context("Resume failed")?;
        }
        self.is_suspended.store(false, std::sync::atomic::Ordering::SeqCst);
        tracing::info!("[platform] Successfully resumed WebView2 tab");
        Ok(())
    }

    fn is_suspended(&self) -> bool {
        self.is_suspended.load(std::sync::atomic::Ordering::Relaxed)
    }

    fn set_memory_target_low(&self) -> Result<()> {
        self.inner
            .set_memory_usage_level(MemoryUsageLevel::Low)
            .context("Failed to set memory usage level to Low")
    }

    fn set_memory_target_normal(&self) -> Result<()> {
        self.inner
            .set_memory_usage_level(MemoryUsageLevel::Normal)
            .context("Failed to set memory usage level to Normal")
    }

    fn clear_all_browsing_data(&self) -> Result<()> {
        self.inner
            .clear_all_browsing_data()
            .context("Failed to clear browsing data")
    }

    fn delete_cookies_for_url(&self, url: &str) -> Result<()> {
        let wv = self.inner.webview();
        if let Ok(wv2) = wv.cast::<ICoreWebView2_2>() {
            unsafe {
                if let Ok(cookie_mgr) = wv2.CookieManager() {
                    let parsed = url::Url::parse(url).unwrap_or_else(|_| url::Url::parse("http://localhost").unwrap());
                    let domain = parsed.host_str().unwrap_or("");
                    let name_hstring = windows::core::HSTRING::new();
                    let domain_hstring = windows::core::HSTRING::from(domain);
                    let path_hstring = windows::core::HSTRING::from("/");
                    let _ = cookie_mgr.DeleteCookiesWithDomainAndPath(
                        &name_hstring,
                        &domain_hstring,
                        &path_hstring,
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
            crate::storage::Storage::resolve_data_dir().join("WebView2")
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

    pub fn user_data_dir(&self) -> &PathBuf {
        &self.user_data_dir
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

        if let Some(proxy) = config.proxy_config.as_ref().or(self.active_proxy.as_ref()) {
            builder = builder.with_proxy_config(proxy.clone());
        }

        if let Some(ref profile_name) = config.profile_name {
            builder = builder.with_profile_name(profile_name);
        }

        // Share runtime environment across content webviews to save memory
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
            builder = builder.with_document_title_changed_handler(on_title);
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

        let inner_wv = builder
            .build_as_child(window)
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

    fn sample_memory(&self, fallback_active_webviews: usize) -> Result<BrowserMemoryBreakdown> {
        Ok(telemetry::sample_browser_memory_breakdown(fallback_active_webviews))
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
