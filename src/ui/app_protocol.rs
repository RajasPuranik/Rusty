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

static CSS_BASE: &[u8] = include_bytes!("../../ui/css/base.css");
static CSS_THEMES: &[u8] = include_bytes!("../../ui/css/themes.css");
static CSS_SKIN_MINIMAL: &[u8] = include_bytes!("../../ui/css/skin-minimal.css");
static CSS_SKIN_CRAZY: &[u8] = include_bytes!("../../ui/css/skin-crazy.css");
static CSS_NEWTAB: &[u8] = include_bytes!("../../ui/css/newtab.css");

static JS_BOOT: &[u8] = include_bytes!("../../ui/js/boot.js");
static JS_ICONS: &[u8] = include_bytes!("../../ui/js/icons.js");
static JS_BRIDGE: &[u8] = include_bytes!("../../ui/js/bridge.js");
static JS_SETTINGS: &[u8] = include_bytes!("../../ui/js/settings.js");
static JS_CHROME: &[u8] = include_bytes!("../../ui/js/chrome.js");
static JS_NEWTAB: &[u8] = include_bytes!("../../ui/js/newtab.js");
static JS_FX_CRAZY: &[u8] = include_bytes!("../../ui/js/fx-crazy.js");

static ASSET_LOGO: &[u8] = include_bytes!("../../ui/assets/logo.svg");
static ASSET_WALLPAPER: &[u8] = include_bytes!("../../ui/assets/wallpaper.jpg");

const CSP_VALUE: &str = "default-src 'self' 'unsafe-inline' data:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self';";

/// Handle incoming HTTP requests on the `rusty://` custom protocol scheme.
pub fn handle_rusty_request(_id: WebViewId, req: Request<Vec<u8>>) -> Response<Cow<'static, [u8]>> {
    let path = req.uri().path().trim_start_matches('/');

    let (content_type, body): (&str, &'static [u8]) = match path {
        "" | "index.html" | "chrome" => ("text/html; charset=utf-8", INDEX_HTML),
        "newtab.html" | "newtab" => ("text/html; charset=utf-8", NEWTAB_HTML),

        "css/base.css" => ("text/css; charset=utf-8", CSS_BASE),
        "css/themes.css" => ("text/css; charset=utf-8", CSS_THEMES),
        "css/skin-minimal.css" => ("text/css; charset=utf-8", CSS_SKIN_MINIMAL),
        "css/skin-crazy.css" => ("text/css; charset=utf-8", CSS_SKIN_CRAZY),
        "css/newtab.css" => ("text/css; charset=utf-8", CSS_NEWTAB),

        "js/boot.js" => ("text/javascript; charset=utf-8", JS_BOOT),
        "js/icons.js" => ("text/javascript; charset=utf-8", JS_ICONS),
        "js/bridge.js" => ("text/javascript; charset=utf-8", JS_BRIDGE),
        "js/settings.js" => ("text/javascript; charset=utf-8", JS_SETTINGS),
        "js/chrome.js" => ("text/javascript; charset=utf-8", JS_CHROME),
        "js/newtab.js" => ("text/javascript; charset=utf-8", JS_NEWTAB),
        "js/fx-crazy.js" => ("text/javascript; charset=utf-8", JS_FX_CRAZY),

        "assets/logo.svg" => ("image/svg+xml", ASSET_LOGO),
        "assets/wallpaper.jpg" => ("image/jpeg", ASSET_WALLPAPER),

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
