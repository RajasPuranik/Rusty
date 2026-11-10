//! Custom protocol handler for `rusty://app/` serving embedded UI assets.
//!
//! Provides compile-time embedded assets for standalone execution, with strict
//! Content-Security-Policy (CSP) headers and MIME type mappings.

use std::borrow::Cow;
use wry::http::{header, Request, Response, StatusCode};
use wry::WebViewId;

// Compile-time embedded UI files (zero runtime disk dependencies)
static INDEX_HTML: &[u8] = include_bytes!("../../ui/index.html");
static NEWTAB_HTML: &[u8] = include_bytes!("../../ui/newtab.html");
static INTERSTITIAL_HTML: &[u8] = include_bytes!("../../ui/interstitial.html");

static CSS_BASE: &[u8] = include_bytes!("../../ui/css/base.css");
static CSS_THEMES: &[u8] = include_bytes!("../../ui/css/themes.css");
static CSS_SKIN_MINIMAL: &[u8] = include_bytes!("../../ui/css/skin-minimal.css");
static CSS_SKIN_CRAZY: &[u8] = include_bytes!("../../ui/css/skin-crazy.css");
static CSS_SKIN_MAYANK: &[u8] = include_bytes!("../../ui/css/skin-mayank.css");
static CSS_NEWTAB: &[u8] = include_bytes!("../../ui/css/newtab.css");

static JS_BOOT: &[u8] = include_bytes!("../../ui/js/boot.js");
static JS_ICONS: &[u8] = include_bytes!("../../ui/js/icons.js");
static JS_BRIDGE: &[u8] = include_bytes!("../../ui/js/bridge.js");
static JS_SETTINGS: &[u8] = include_bytes!("../../ui/js/settings.js");
static JS_ENGINES: &[u8] = include_bytes!("../../ui/js/engines.js");
static JS_LOCATIONS: &[u8] = include_bytes!("../../ui/js/locations.js");
static JS_CHROME: &[u8] = include_bytes!("../../ui/js/chrome.js");
static JS_NEWTAB: &[u8] = include_bytes!("../../ui/js/newtab.js");
static JS_FX_CRAZY: &[u8] = include_bytes!("../../ui/js/fx-crazy.js");
static JS_FX_MAYANK: &[u8] = include_bytes!("../../ui/js/fx-mayank.js");
static JS_FX_REGISTRY: &[u8] = include_bytes!("../../ui/js/fx-registry.js");
static JS_PET_CRAZY: &[u8] = include_bytes!("../../ui/js/pet-crazy.js");
static JS_GLOBE: &[u8] = include_bytes!("../../ui/js/globe.js");
static JS_YOUTUBE_FOCUS: &[u8] = include_bytes!("../../ui/js/youtube_focus.js");

/// Returns the embedded YouTube focus filter script content for webview injection.
pub fn get_youtube_focus_script() -> &'static str {
    std::str::from_utf8(JS_YOUTUBE_FOCUS).unwrap_or("")
}

static ASSET_LOGO: &[u8] = include_bytes!("../../ui/assets/logo.svg");
// PLACEHOLDER: self-generated procedural WebP Earth maps; verify license if replacing with NASA/Natural Earth assets.
static ASSET_EARTH_DAY: &[u8] = include_bytes!("../../ui/assets/earth-day.webp");
static ASSET_EARTH_NIGHT: &[u8] = include_bytes!("../../ui/assets/earth-night.webp");
static ASSET_EARTH_FALLBACK: &[u8] = include_bytes!("../../ui/assets/earth-fallback.webp");

const CSP_VALUE: &str = "default-src 'self' 'unsafe-inline' data:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self';";

/// Handle incoming HTTP requests on the `rusty://` custom protocol scheme.
pub fn handle_rusty_request(_id: WebViewId, req: Request<Vec<u8>>) -> Response<Cow<'static, [u8]>> {
    let raw = req.uri().path().trim_start_matches('/');
    let stripped = raw.strip_prefix("app/").unwrap_or(raw);
    let path = stripped.split('?').next().unwrap_or(stripped).trim_end_matches('/');

    let (content_type, body): (&str, &'static [u8]) = match path {
        "" | "index.html" | "chrome" => ("text/html; charset=utf-8", INDEX_HTML),
        "newtab.html" | "newtab" => ("text/html; charset=utf-8", NEWTAB_HTML),
        "interstitial.html" | "interstitial" => ("text/html; charset=utf-8", INTERSTITIAL_HTML),

        "css/base.css" => ("text/css; charset=utf-8", CSS_BASE),
        "css/themes.css" => ("text/css; charset=utf-8", CSS_THEMES),
        "css/skin-minimal.css" => ("text/css; charset=utf-8", CSS_SKIN_MINIMAL),
        "css/skin-crazy.css" => ("text/css; charset=utf-8", CSS_SKIN_CRAZY),
        "css/skin-mayank.css" => ("text/css; charset=utf-8", CSS_SKIN_MAYANK),
        "css/newtab.css" => ("text/css; charset=utf-8", CSS_NEWTAB),

        "js/boot.js" => ("text/javascript; charset=utf-8", JS_BOOT),
        "js/icons.js" => ("text/javascript; charset=utf-8", JS_ICONS),
        "js/bridge.js" => ("text/javascript; charset=utf-8", JS_BRIDGE),
        "js/settings.js" => ("text/javascript; charset=utf-8", JS_SETTINGS),
        "js/engines.js" => ("text/javascript; charset=utf-8", JS_ENGINES),
        "js/locations.js" => ("text/javascript; charset=utf-8", JS_LOCATIONS),
        "js/chrome.js" => ("text/javascript; charset=utf-8", JS_CHROME),
        "js/newtab.js" => ("text/javascript; charset=utf-8", JS_NEWTAB),
        "js/fx-crazy.js" => ("text/javascript; charset=utf-8", JS_FX_CRAZY),
        "js/fx-mayank.js" => ("text/javascript; charset=utf-8", JS_FX_MAYANK),
        "js/fx-registry.js" => ("text/javascript; charset=utf-8", JS_FX_REGISTRY),
        "js/pet-crazy.js" => ("text/javascript; charset=utf-8", JS_PET_CRAZY),
        "js/globe.js" => ("text/javascript; charset=utf-8", JS_GLOBE),
        "js/youtube_focus.js" => ("text/javascript; charset=utf-8", JS_YOUTUBE_FOCUS),

        "assets/logo.svg" => ("image/svg+xml", ASSET_LOGO),
        "assets/earth-day.webp" => ("image/webp", ASSET_EARTH_DAY),
        "assets/earth-night.webp" => ("image/webp", ASSET_EARTH_NIGHT),
        "assets/earth-fallback.webp" => ("image/webp", ASSET_EARTH_FALLBACK),

        _ => {
            return Response::builder()
                .status(StatusCode::NOT_FOUND)
                .header(header::CONTENT_TYPE, "text/plain; charset=utf-8")
                .body(Cow::Borrowed(b"404 Not Found" as &'static [u8]))
                .unwrap();
        }
    };

    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, content_type)
        .header("Content-Security-Policy", CSP_VALUE)
        .header("X-Content-Type-Options", "nosniff")
        .body(Cow::Borrowed(body))
        .unwrap()
}
