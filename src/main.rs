//! Rusty Browser – Milestone 1
//!
//! A minimal browser window that loads a single URL using the platform's native
//! webview (WebView2 on Windows, WebKit on macOS, WebKitGTK on Linux).
//!
//! Usage:
//!   cargo run                           → opens Wikipedia
//!   cargo run -- https://www.youtube.com → opens YouTube
//!   cargo run -- rust programming       → searches DuckDuckGo

use anyhow::{Context, Result};
use percent_encoding::{utf8_percent_encode, NON_ALPHANUMERIC};
use std::env;
use tao::{
    event::{Event, WindowEvent},
    event_loop::{ControlFlow, EventLoop},
    window::WindowBuilder,
};
use url::Url;
use wry::WebViewBuilder;

/// The default page when no URL is provided.
const DEFAULT_URL: &str = "https://www.wikipedia.org";

/// The search engine template. `%s` is replaced with the percent-encoded query.
const SEARCH_TEMPLATE: &str = "https://duckduckgo.com/?q=%s";

/// Resolve a raw string into a navigable URL.
///
/// - If it parses as an http(s) URL, use it directly.
/// - If it contains a dot and no spaces, prepend `https://`.
/// - Otherwise treat it as a search query.
fn resolve_url(raw: &str) -> String {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return DEFAULT_URL.to_owned();
    }

    // Already a valid http(s) URL?
    if let Ok(parsed) = Url::parse(trimmed) {
        if parsed.scheme() == "http" || parsed.scheme() == "https" {
            return parsed.into();
        }
    }

    // Looks like a bare domain (contains a dot, no spaces)?
    if !trimmed.contains(' ') && trimmed.contains('.') {
        let with_scheme = format!("https://{trimmed}");
        if Url::parse(&with_scheme).is_ok() {
            return with_scheme;
        }
    }

    // Treat as a search query.
    let encoded = utf8_percent_encode(trimmed, NON_ALPHANUMERIC).to_string();
    SEARCH_TEMPLATE.replace("%s", &encoded)
}

fn main() -> Result<()> {
    // ── 1. Resolve target URL ──────────────────────────────────────────
    let target = resolve_url(&env::args().skip(1).collect::<Vec<_>>().join(" "));
    println!("[rusty_browser] Loading: {target}");

    // ── 2. Create the native event loop & window ───────────────────────
    let event_loop = EventLoop::new();

    let window = WindowBuilder::new()
        .with_title("Rusty Browser")
        .with_inner_size(tao::dpi::LogicalSize::new(1280.0, 800.0))
        .build(&event_loop)
        .context("Failed to create window")?;

    // ── 3. Attach the webview ──────────────────────────────────────────
    // On Windows/macOS/iOS/Android the webview fills the whole window.
    // On Linux (GTK) we must use the GTK-specific builder.
    let builder = WebViewBuilder::new()
        .with_url(&target)
        // Allow devtools in debug builds only
        .with_devtools(cfg!(debug_assertions));

    #[cfg(any(
        target_os = "windows",
        target_os = "macos",
        target_os = "ios",
        target_os = "android"
    ))]
    let _webview = builder.build(&window).context("Failed to create WebView")?;

    #[cfg(not(any(
        target_os = "windows",
        target_os = "macos",
        target_os = "ios",
        target_os = "android"
    )))]
    let _webview = {
        use tao::platform::unix::WindowExtUnix;
        use wry::WebViewBuilderExtUnix;
        let vbox = window
            .default_vbox()
            .context("Failed to get GTK vbox from window")?;
        builder
            .build_gtk(vbox)
            .context("Failed to create WebView (GTK)")?
    };

    // ── 4. Run the event loop ──────────────────────────────────────────
    event_loop.run(move |event, _, control_flow| {
        *control_flow = ControlFlow::Wait;

        if let Event::WindowEvent {
            event: WindowEvent::CloseRequested,
            ..
        } = event
        {
            *control_flow = ControlFlow::Exit;
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_full_url() {
        let url = resolve_url("https://www.youtube.com");
        assert_eq!(url, "https://www.youtube.com/");
    }

    #[test]
    fn resolve_bare_domain() {
        let url = resolve_url("github.com");
        assert_eq!(url, "https://github.com");
    }

    #[test]
    fn resolve_search_query() {
        let url = resolve_url("rust programming");
        assert!(url.starts_with("https://duckduckgo.com/?q="));
        assert!(url.contains("rust"));
    }

    #[test]
    fn resolve_empty() {
        assert_eq!(resolve_url(""), DEFAULT_URL);
    }
}
