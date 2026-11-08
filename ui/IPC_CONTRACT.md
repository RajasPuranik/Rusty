# RUSTY BROWSER — IPC CONTRACT SPECIFICATION

Bidirectional JSON messaging protocol between the HTML/CSS/JS Chrome Webview (`rusty://app/`) and the Rust backend (`tao` + `wry`).

All messages are serialized as JSON strings and validated with strongly-typed Rust serde enums. Messages from any origin other than `rusty://app/` are rejected.

---

## 1. UI ➔ Rust Messages

Dispatched from JavaScript via `window.ipc.postMessage(JSON.stringify(msg))`.

### 1.1 Navigation & Tabs
| Action | Payload Schema | Description |
|---|---|---|
| `new_tab` | `{"action": "new_tab", "url": string}` | Open a new tab with the given URL (or `"about:blank"`). |
| `switch_tab` | `{"action": "switch_tab", "tab_id": number}` | Switch active tab to `tab_id`. |
| `close_tab` | `{"action": "close_tab", "tab_id": number}` | Close specified tab. If active, switches to adjacent. |
| `navigate` | `{"action": "navigate", "url": string}` | Navigate active tab to `url` or resolve search query. |
| `back` | `{"action": "back"}` | History back navigation. |
| `forward` | `{"action": "forward"}` | History forward navigation. |
| `reload` | `{"action": "reload"}` | Reload current webview content. |
| `stop` | `{"action": "stop"}` | Stop loading current page. |

### 1.2 Memory Saver & Sleep State
| Action | Payload Schema | Description |
|---|---|---|
| `sleep_tab` | `{"action": "sleep_tab", "tab_id": number}` | Manually discard tab webview from RAM, saving scroll position. |
| `wake_tab` | `{"action": "wake_tab", "tab_id": number}` | Re-instantiate webview for discarded tab and restore scroll. |

### 1.3 Layout & Native Viewport Bounds
| Action | Payload Schema | Description |
|---|---|---|
| `content_rect` | `{"action": "content_rect", "x": number, "y": number, "width": number, "height": number}` | **Critical**: Informs Rust of the exact pixel boundaries of the content viewport so child WebView2 can be sized and positioned without overlapping chrome, sidebars, or find bars. |
| `overlay` | `{"action": "overlay", "open": boolean}` | **Critical**: Informs Rust when a full modal (Command Palette, Settings) is open so Rust can temporarily hide or dim the native child webview so popups render seamlessly. |

### 1.4 Bookmarks, Storage & Settings
| Action | Payload Schema | Description |
|---|---|---|
| `toggle_bookmark` | `{"action": "toggle_bookmark", "url": string}` | Add or remove URL from bookmarks. |
| `save_settings` | `{"action": "save_settings", "settings": object}` | Persist updated settings map to `data.json`. |
| `zoom` | `{"action": "zoom", "level": number}` | Set active tab zoom factor (e.g. `1.1` = 110%). |
| `find_in_page` | `{"action": "find_in_page", "query": string, "forward": boolean}` | Execute find-in-page match. |

---

## 2. Rust ➔ UI Messages

Dispatched from Rust by evaluating `window.__onRustMessage(json)` in the chrome webview.

### 2.1 State Synchronization (`state_update`)
```json
{
  "type": "state_update",
  "tabs": [
    {
      "id": 1,
      "title": "New Tab",
      "url": "about:blank",
      "active": true,
      "sleeping": false,
      "pinned": false,
      "group_id": null
    },
    {
      "id": 2,
      "title": "GitHub",
      "url": "https://github.com",
      "active": false,
      "sleeping": true,
      "pinned": false,
      "group_id": null
    }
  ],
  "active_tab": 1,
  "url": "about:blank",
  "title": "New Tab",
  "can_go_back": false,
  "can_go_forward": false,
  "is_bookmarked": false,
  "zoom_percent": 100,
  "memory": {
    "total_mb": 84.5,
    "chrome_baseline_mb": 236.0,
    "savings_percent": 64.2
  }
}
```

### 2.2 Live Memory Telemetry (`memory_stats`)
```json
{
  "type": "memory_stats",
  "total_mb": 85.2,
  "chrome_baseline_mb": 236.0,
  "savings_percent": 63.9
}
```

### 2.3 Download Progress (`download_progress`)
```json
{
  "type": "download_progress",
  "id": 1,
  "filename": "installer.exe",
  "url": "https://example.com/installer.exe",
  "state": "in_progress",
  "progress": 68
}
```
