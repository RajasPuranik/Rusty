# Rusty Browser: Cross-Platform Extensions & Userscripts Architecture

## 1. Architectural Overview

Rusty Browser implements a dual-path extension architecture tailored to the underlying rendering engines on Windows (WebView2 / Chromium) and Linux (WebKitGTK 4.1):

```
                     ┌────────────────────────────────────────┐
                     │          Rusty Browser Host            │
                     └───────────────────┬────────────────────┘
                                         │
                    ┌────────────────────┴────────────────────┐
                    ▼                                         ▼
         Windows 11 (WebView2)                      Linux (WebKitGTK 4.1)
┌──────────────────────────────────────┐  ┌──────────────────────────────────────┐
│  Chromium Unpacked Extension Engine  │  │  Tampermonkey-Style Userscripts     │
│  - Manifest V2 / V3 Parser           │  │  - @match pattern matching           │
│  - Permission Risk Inspection        │  │  - document_start / document_end     │
│  - Chromium Extensions Flags         │  │  - WebKitUserContentManager          │
│  - Dual-Path Content Script Runtime  │  │  - Content-Blocking Rule Engine      │
└──────────────────────────────────────┘  └──────────────────────────────────────┘
```

---

## 2. Windows 11 (WebView2 / Chromium)

On Windows, WebView2 provides native extension capabilities when enabled via `msWebView2BrowserExtensions` flags. Rusty Browser provides an extension manager in **Settings > Extensions & Userscripts**:

- **Unpacked Folder Loading**: Users point to an unpacked extension directory containing `manifest.json`.
- **Manifest V2 & V3 Support**: Automatically parses declarative net requests, background scripts, content scripts, and permissions.
- **Permission Risk Classification**:
  - **High Risk (Broad Access)**: Flagged when requesting `<all_urls>`, `*://*/*`, `webRequest`, `webRequestBlocking`, `cookies`, `nativeMessaging`, or `debugger`. Marked with a prominent red badge in the UI.
  - **Medium Risk**: Flagged for specific host patterns (e.g. `*://*.github.com/*`) or more than 6 distinct permissions.
  - **Low Risk**: Scoped permissions such as `storage`, `activeTab`, `contextMenus`, and `alarms`.
- **Dual-Path Content Script Runtime**: In addition to native Chromium extension flags, Rusty Browser's content webview initialization pipeline injects content scripts and userscripts directly, ensuring high-speed reliability across all WebView2 runtime versions.

---

## 3. Linux (WebKitGTK 4.1) & The Honest Boundary

### 3.1 Why Chrome Extensions Cannot Run on WebKitGTK
WebKitGTK 4.1 is based on Apple's WebKit engine, not Chromium. WebKitGTK does not expose Chromium Extension Manifest APIs (`chrome.runtime`, `chrome.tabs`, `chrome.webRequest`). Attempting to emulate the entirety of Chrome's multi-process extension architecture on WebKitGTK would be unstable, insecure, and fragile.

### 3.2 The Linux Solution: Userscripts Manager & WebKit Filters
To provide custom scripting and ad-blocking without faking Chrome APIs, Rusty Browser provides:
1. **Tampermonkey-Style Userscripts Manager**:
   - Supports URL wildcard `@match` patterns (`<all_urls>`, `*://*.youtube.com/*`, `https://*.github.com/*`).
   - Timing injection at `document_start` (before DOM parses) and `document_end` (`DOMContentLoaded`).
   - Built-in script editor directly in the browser settings.
2. **Pre-Installed Starter Userscripts**:
   - **Dark Reader Lite**: Automatic dark mode filter inversion for bright webpages.
   - **Clean Tracking Links**: Strips `utm_*`, `fbclid`, `gclid`, and tracking queries from URLs and history state.
   - **YouTube Ad Auto-Dismiss**: Automatically clicks skip-ad buttons and closes promo banner overlays.
3. **WebKit Content Blocker Engine**: Converts EasyList rules into WebKit JSON filters managed via `WebKitUserContentFilterStore`.

---

## 4. Security Invariants & Isolation Boundaries

1. **Privileged Chrome UI Isolation**:
   - Invariant: Extensions and userscripts **NEVER** run in `rusty://app/` or internal UI pages.
   - Enforced by URL origin checks: any attempt to execute scripts in internal virtual frames is aborted.
2. **Vault Workspace Immunity**:
   - Invariant: When the user enters an isolated workspace (e.g. `Vault`), all extensions and userscripts are **immediately inhibited**.
   - Enforced in Rust (`extensions::build_userscripts_injection_js` returns empty script if `is_vault == true`).
   - Prevents credential-stealing extensions or session-hijacking scripts from reading sensitive passwords or keys.
3. **Zero Web Store Scraping**:
   - Rusty Browser does not scrape the Chrome Web Store.
   - Users install verified unpacked extensions directly from source or local repositories.
