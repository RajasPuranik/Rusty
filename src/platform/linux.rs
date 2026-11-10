//! Linux WebKitGTK platform implementation and cross-platform trait stubs.
//!
//! Provides WebKitGTK 4.1 platform integration for Linux, and trait stubs for
//! non-Linux platforms allowing cross-platform syntax and unit test verification.

#![allow(dead_code)]
#![allow(unused_imports)]

use std::any::Any;
use std::path::PathBuf;
use anyhow::{Context, Result};

use tao::window::Window;
use wry::Rect;

use super::{
    PlatformHost, PlatformWebView, WebViewConfig,
};
use crate::telemetry::{self, BrowserMemoryBreakdown};

/// Linux WebKitGTK platform webview implementation (or cross-platform stub on non-Linux).
pub struct LinuxWebView {
    url: std::sync::Mutex<String>,
    bounds: std::sync::Mutex<Rect>,
    visible: std::sync::atomic::AtomicBool,
    suspended: std::sync::atomic::AtomicBool,
    memory_target_low: std::sync::atomic::AtomicBool,
    #[cfg(target_os = "linux")]
    inner: Option<wry::WebView>,
}

unsafe impl Send for LinuxWebView {}
unsafe impl Sync for LinuxWebView {}

impl LinuxWebView {
    pub fn new_stub(bounds: Rect, url: String) -> Self {
        Self {
            url: std::sync::Mutex::new(url),
            bounds: std::sync::Mutex::new(bounds),
            visible: std::sync::atomic::AtomicBool::new(true),
            suspended: std::sync::atomic::AtomicBool::new(false),
            memory_target_low: std::sync::atomic::AtomicBool::new(false),
            #[cfg(target_os = "linux")]
            inner: None,
        }
    }

    #[cfg(target_os = "linux")]
    pub fn new_linux(inner: wry::WebView, bounds: Rect, url: String) -> Self {
        Self {
            url: std::sync::Mutex::new(url),
            bounds: std::sync::Mutex::new(bounds),
            visible: std::sync::atomic::AtomicBool::new(true),
            suspended: std::sync::atomic::AtomicBool::new(false),
            memory_target_low: std::sync::atomic::AtomicBool::new(false),
            inner: Some(inner),
        }
    }
}

impl PlatformWebView for LinuxWebView {
    fn set_visible(&self, visible: bool) -> Result<()> {
        self.visible.store(visible, std::sync::atomic::Ordering::SeqCst);
        #[cfg(target_os = "linux")]
        if let Some(ref wv) = self.inner {
            wv.set_visible(visible).context("Failed to set WebKit visibility")?;
        }
        Ok(())
    }

    fn set_bounds(&self, rect: Rect) -> Result<()> {
        if let Ok(mut b) = self.bounds.lock() {
            *b = rect;
        }
        #[cfg(target_os = "linux")]
        if let Some(ref wv) = self.inner {
            wv.set_bounds(rect).context("Failed to set WebKit bounds")?;
        }
        Ok(())
    }

    fn bounds(&self) -> Result<Rect> {
        Ok(*self.bounds.lock().unwrap())
    }

    fn focus(&self) -> Result<()> {
        #[cfg(target_os = "linux")]
        if let Some(ref wv) = self.inner {
            wv.focus().context("Failed to focus WebKit view")?;
        }
        Ok(())
    }

    fn load_url(&self, url: &str) -> Result<()> {
        if let Ok(mut u) = self.url.lock() {
            *u = url.to_string();
        }
        #[cfg(target_os = "linux")]
        if let Some(ref wv) = self.inner {
            wv.load_url(url).context("Failed to load URL on WebKit")?;
        }
        Ok(())
    }

    fn load_html(&self, html: &str) -> Result<()> {
        if let Ok(mut u) = self.url.lock() {
            *u = "about:blank".to_string();
        }
        #[cfg(target_os = "linux")]
        if let Some(ref wv) = self.inner {
            wv.load_html(html).context("Failed to load HTML on WebKit")?;
        }
        let _ = html;
        Ok(())
    }

    fn evaluate_script(&self, js: &str) -> Result<()> {
        #[cfg(target_os = "linux")]
        if let Some(ref wv) = self.inner {
            wv.evaluate_script(js).context("Failed to evaluate script on WebKit")?;
        }
        let _ = js;
        Ok(())
    }

    fn url(&self) -> Result<String> {
        #[cfg(target_os = "linux")]
        if let Some(ref wv) = self.inner {
            return wv.url().context("Failed to read URL from WebKit");
        }
        Ok(self.url.lock().unwrap().clone())
    }

    fn zoom(&self, level: f64) -> Result<()> {
        #[cfg(target_os = "linux")]
        if let Some(ref wv) = self.inner {
            wv.zoom(level).context("Failed to set WebKit zoom")?;
        }
        let _ = level;
        Ok(())
    }

    fn can_go_back(&self) -> bool {
        #[cfg(target_os = "linux")]
        if let Some(ref wv) = self.inner {
            return wv.can_go_back().unwrap_or(false);
        }
        false
    }

    fn can_go_forward(&self) -> bool {
        #[cfg(target_os = "linux")]
        if let Some(ref wv) = self.inner {
            return wv.can_go_forward().unwrap_or(false);
        }
        false
    }

    fn go_back(&self) -> Result<()> {
        #[cfg(target_os = "linux")]
        if let Some(ref wv) = self.inner {
            wv.go_back().context("Failed to navigate back on WebKit")?;
        }
        Ok(())
    }

    fn go_forward(&self) -> Result<()> {
        #[cfg(target_os = "linux")]
        if let Some(ref wv) = self.inner {
            wv.go_forward().context("Failed to navigate forward on WebKit")?;
        }
        Ok(())
    }

    fn suspend(&self) -> Result<()> {
        self.suspended.store(true, std::sync::atomic::Ordering::SeqCst);
        // On WebKitGTK, suspension is achieved by freezing page execution and reducing timer cadence
        #[cfg(target_os = "linux")]
        if let Some(ref wv) = self.inner {
            let _ = wv.evaluate_script("if (window.__rustySuspend) window.__rustySuspend();");
        }
        tracing::info!("[platform] Linux WebKit tab suspended");
        Ok(())
    }

    fn resume(&self) -> Result<()> {
        self.suspended.store(false, std::sync::atomic::Ordering::SeqCst);
        #[cfg(target_os = "linux")]
        if let Some(ref wv) = self.inner {
            let _ = wv.evaluate_script("if (window.__rustyResume) window.__rustyResume();");
        }
        tracing::info!("[platform] Linux WebKit tab resumed");
        Ok(())
    }

    fn is_suspended(&self) -> bool {
        self.suspended.load(std::sync::atomic::Ordering::Relaxed)
    }

    fn set_memory_target_low(&self) -> Result<()> {
        self.memory_target_low.store(true, std::sync::atomic::Ordering::SeqCst);
        #[cfg(target_os = "linux")]
        if let Some(ref wv) = self.inner {
            let _ = wv.evaluate_script("if (window.gc) window.gc();");
        }
        Ok(())
    }

    fn set_memory_target_normal(&self) -> Result<()> {
        self.memory_target_low.store(false, std::sync::atomic::Ordering::SeqCst);
        Ok(())
    }

    fn clear_all_browsing_data(&self) -> Result<()> {
        #[cfg(target_os = "linux")]
        if let Some(ref wv) = self.inner {
            wv.clear_all_browsing_data().context("Failed to clear browsing data on WebKit")?;
        }
        Ok(())
    }

    fn delete_cookies_for_url(&self, url: &str) -> Result<()> {
        let _ = url;
        Ok(())
    }

    fn as_any(&self) -> &dyn Any {
        self
    }

    fn as_any_mut(&mut self) -> &mut dyn Any {
        self
    }
}

/// Linux WebKitGTK platform host implementation (or stub on other platforms).
pub struct LinuxPlatformHost {
    user_data_dir: PathBuf,
    active_proxy: Option<wry::ProxyConfig>,
}

unsafe impl Send for LinuxPlatformHost {}
unsafe impl Sync for LinuxPlatformHost {}

impl LinuxPlatformHost {
    pub fn new(user_data_dir: Option<PathBuf>) -> Result<Self> {
        let dir = user_data_dir.unwrap_or_else(|| {
            crate::storage::Storage::resolve_data_dir()
        });

        std::fs::create_dir_all(&dir)
            .with_context(|| format!("Failed to create Linux data dir: {}", dir.display()))?;

        Ok(Self {
            user_data_dir: dir,
            active_proxy: None,
        })
    }

    pub fn user_data_dir(&self) -> &PathBuf {
        &self.user_data_dir
    }
}

impl PlatformHost for LinuxPlatformHost {
    fn create_webview(
        &mut self,
        window: &Window,
        config: WebViewConfig,
    ) -> Result<Box<dyn PlatformWebView>> {
        let _ = window;
        let bounds = config.bounds;
        let url = config.url.clone();

        #[cfg(target_os = "linux")]
        {
            // Full WebKitGTK 4.1 initialization with Wayland & X11 support
            use wry::WebViewBuilder;
            use wry::WebViewBuilderExtUnix;
            use tao::platform::unix::WindowExtUnix;

            let mut builder = WebViewBuilder::new()
                .with_bounds(config.bounds)
                .with_custom_protocol("rusty".into(), crate::ui::app_protocol::handle_rusty_request)
                .with_url(&config.url)
                .with_incognito(config.is_incognito)
                .with_devtools(cfg!(debug_assertions));

            if let Some(ref script) = config.initialization_script {
                builder = builder.with_initialization_script(script);
            }

            if let Some(on_ipc) = config.on_ipc {
                builder = builder.with_ipc_handler(move |req| {
                    let uri = req.uri().to_string();
                    let body = req.body().to_string();
                    on_ipc(&uri, &body);
                });
            }

            if let Some(on_nav) = config.on_navigation {
                builder = builder.with_navigation_handler(move |url| on_nav(&url));
            }

            // On Wayland & X11: use GTK container path if vbox is present (raw handles fail on Wayland)
            let inner = if let Some(vbox) = window.default_vbox() {
                builder.build_gtk(vbox)
                    .context("Failed to build WebKitGTK webview inside GTK vbox container")?
            } else {
                builder.build_as_child(window)
                    .context("Failed to build WebKitGTK child webview")?
            };

            return Ok(Box::new(LinuxWebView::new_linux(inner, bounds, url)));
        }

        #[cfg(not(target_os = "linux"))]
        {
            Ok(Box::new(LinuxWebView::new_stub(bounds, url)))
        }
    }

    fn sample_memory(&self, fallback_active_webviews: usize) -> Result<BrowserMemoryBreakdown> {
        Ok(telemetry::sample_browser_memory_breakdown(fallback_active_webviews))
    }

    fn configure_proxy(&mut self, proxy_url: Option<&str>) -> Result<()> {
        if let Some(url_str) = proxy_url {
            let parsed = url::Url::parse(url_str)
                .with_context(|| format!("Invalid proxy URL: {url_str}"))?;
            let host = parsed.host_str().unwrap_or("127.0.0.1").to_string();
            let port = parsed.port().unwrap_or(1080).to_string();
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

/// Fallback stub for unsupported platforms.
pub struct StubPlatformHost {
    user_data_dir: PathBuf,
}

impl StubPlatformHost {
    pub fn new(user_data_dir: Option<PathBuf>) -> Result<Self> {
        Ok(Self {
            user_data_dir: user_data_dir.unwrap_or_else(|| PathBuf::from(".")),
        })
    }
}

impl PlatformHost for StubPlatformHost {
    fn create_webview(
        &mut self,
        _window: &Window,
        config: WebViewConfig,
    ) -> Result<Box<dyn PlatformWebView>> {
        Ok(Box::new(LinuxWebView::new_stub(config.bounds, config.url)))
    }

    fn sample_memory(&self, fallback_active_webviews: usize) -> Result<BrowserMemoryBreakdown> {
        Ok(telemetry::sample_browser_memory_breakdown(fallback_active_webviews))
    }

    fn configure_proxy(&mut self, _proxy_url: Option<&str>) -> Result<()> {
        Ok(())
    }

    fn as_any(&self) -> &dyn Any {
        self
    }

    fn as_any_mut(&mut self) -> &mut dyn Any {
        self
    }
}
