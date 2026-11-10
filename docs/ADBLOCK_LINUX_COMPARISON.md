# Ad Blocker: Linux (WebKitGTK) vs. Windows (WebView2) Honest Comparison

This document provides an honest, technical analysis of the ad blocking capabilities and limitations of Rusty Browser on Linux (WebKitGTK 4.1) compared to Windows (WebView2).

---

## Architecture Summary

| Dimension | Windows 11 (WebView2) | Linux (WebKitGTK 4.1) |
| :--- | :--- | :--- |
| **Interception Mechanism** | `ICoreWebView2::WebResourceRequested` | `WebKitUserContentFilterStore` (compiled rules) |
| **Execution Point** | Rust host process IPC callback per request | Inside WebKit engine / WebKitWebProcess bytecode VM |
| **Filter Specification** | Dynamic `adblock-rust` rule matcher | Declarative WebKit JSON Content-Blocking schema |
| **Cosmetic Filtering** | DOM script injection / `execute_script` | `css-display-none` action & `WebKitUserContentManager` stylesheet |
| **Rule Count Limit** | Unlimited (bounded only by host RAM) | **~150,000 rules** max per content filter store |
| **Latency / Overhead** | 0.5–2.0 ms per network request IPC roundtrip | **Zero IPC latency** (compiled native bytecode filter) |

---

## What the Linux Blocker CANNOT Do Compared to Windows

1. **No On-The-Fly HTTP Request Header Rewriting**:
   - On Windows, `WebResourceRequested` permits inspecting and mutating request headers before departure (e.g. stripping `Referer`, modifying `User-Agent`, stripping tracking cookies).
   - On Linux WebKitGTK, declarative content rules cannot modify headers unless a custom C/C++ `WebKitWebExtension` shared object is loaded directly inside the child `WebKitWebProcess`.

2. **No Dynamic Response Modification / Replacement**:
   - On Windows, the browser can synthesize a custom `200 OK` response with dummy tracking scripts (`script:noop`) or clean blank pixel data.
   - On Linux, WebKit only supports `"block"`, `"block-cookies"`, or `"ignore-previous-rules"`. Blocked requests fail with network error `ERR_BLOCKED_BY_CLIENT`.

3. **Strict Rule-Count Budget**:
   - WebKit's native JSON filter compiler enforces an internal limitation (~150,000 rules). Comprehensive filter combinations (e.g. EasyList + EasyPrivacy + Fanboy's Annoyance) can exceed 250,000 rules, requiring rule deduplication, prioritization, and splitting across multiple user content filters.

4. **No POST Body Inspection**:
   - Outgoing form data and telemetry beacon payloads cannot be inspected on Linux declarative rules.

---

## Advantages of the Linux WebKitGTK Implementation

1. **Zero IPC Latency**:
   - Because rules are compiled by `WebKitUserContentFilterStore` into a native binary automaton, request evaluation runs entirely within the network thread of `WebKitNetworkProcess`. Navigation and page load times are faster than round-tripping every asset through Rust IPC.
2. **Minimal RAM Overhead**:
   - Compiled WebKit filters consume under 4 MB of memory in the WebKit process, whereas in-memory rule tries in Rust can consume 20–40 MB.
