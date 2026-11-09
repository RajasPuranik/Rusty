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
| `reorder_tabs` | `{"action": "reorder_tabs", "from_id": number, "to_id": number, "position": "before" \| "after"}` | Reorder tabs via drag-and-drop. |
| `pin_tab` | `{"action": "pin_tab", "tab_id": number, "pinned": boolean}` | Toggle or set pinned status for tab. |
| `mute_tab` | `{"action": "mute_tab", "tab_id": number, "muted": boolean}` | Toggle or set audio mute for tab. |
| `duplicate_tab` | `{"action": "duplicate_tab", "tab_id": number}` | Clone tab and insert duplicate. |
| `close_other_tabs` | `{"action": "close_other_tabs", "tab_id": number}` | Close all other unpinned tabs. |
| `close_tabs_below` | `{"action": "close_tabs_below", "tab_id": number}` | Close all unpinned tabs below/to right of specified tab. |
| `create_group` | `{"action": "create_group", "name": string, "color": string, "tab_id"?: number}` | Create a colored tab group. |
| `set_tab_group` | `{"action": "set_tab_group", "tab_id": number, "group_id": string \| null}` | Assign or remove tab from a tab group. |
| `toggle_group_collapse` | `{"action": "toggle_group_collapse", "group_id": string}` | Toggle collapsed view state for tab group. |
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

### 1.4 Bookmarks, Storage, Settings, Telemetry & Weather
| Action | Payload Schema | Description |
|---|---|---|
| `ui_ready` | `{"action": "ui_ready", "role"?: "chrome" \| "newtab"}` | Emitted once DOM scripts have registered listeners so Rust syncs initial state, settings, telemetry, and weather. |
| `toggle_bookmark` | `{"action": "toggle_bookmark", "url": string}` | Add or remove URL from bookmarks. |
| `set_setting` | `{"action": "set_setting", "key": string, "value": any}` | Atomically update a single persisted setting (`skin`, `theme`, `tabs_layout`, `weather_location`, etc.), reload internal New Tab views on skin change, and broadcast `ui_settings_sync`. |
| `save_settings` | `{"action": "save_settings", "settings": object}` | Merge updated settings keys into `data.json` without clobbering unrelated fields and broadcast `ui_settings_sync`. |
| `fetch_weather` | `{"action": "fetch_weather", "location"?: string, "force"?: boolean}` | Trigger Rust WinHTTP HTTPS weather lookup via auto IP geolocation (`""`) or city query and emit `weather_update` / `weather_error`. |
| `open_settings` | `{"action": "open_settings"}` | Instruct Chrome UI to open the Settings modal. |
| `open_command_palette` | `{"action": "open_command_palette"}` | Instruct Chrome UI to open the Command Palette. |
| `open_side_panel` | `{"action": "open_side_panel", "panel": "bookmarks" \| "history" \| "downloads"}` | Instruct Chrome UI to toggle the requested side panel. |
| `open_find_bar` | `{"action": "open_find_bar"}` | Instruct Chrome UI to toggle the Find-in-Page bar. |
| `zoom` | `{"action": "zoom", "level": number}` | Set active tab zoom factor (e.g. `1.1` = 110%). |
| `find_in_page` | `{"action": "find_in_page", "query": string, "forward": boolean, "match_case"?: boolean}` | Execute find-in-page match. |

---

## 2. Rust ➔ UI Messages

Dispatched from Rust by evaluating `window.__onRustMessage(json)` on the Chrome webview and trusted internal New Tab webviews.

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

### 2.3 Real-Time System & Browser Telemetry (`telemetry_stats`)
Pushed every 2 seconds from Rust's background Win32 telemetry collector (`GetSystemTimes`, `GlobalMemoryStatusEx`, PDH WDDM GPU & Network counters, Toolhelp32 process tree):
```json
{
  "type": "telemetry_stats",
  "sys_cpu_percent": 14.2,
  "sys_ram_percent": 41.0,
  "sys_ram_used_gb": 6.56,
  "sys_ram_total_gb": 16.0,
  "sys_gpu_percent": 5.3,
  "net_kbps": 12.4,
  "browser_mb": 85.2
}
```
(`sys_gpu_percent` is `null` if no GPU PDH counter is exposed by the active display driver.)

### 2.4 Live Weather Updates (`weather_update` & `weather_error`)
Fetched asynchronously in Rust via WinHTTP (`api.open-meteo.com` + GeoJS/ipwho.is):
```json
{
  "type": "weather_update",
  "temperature_c": 26.4,
  "apparent_c": 27.0,
  "humidity": 44,
  "wind_kmh": 9.2,
  "condition": "Clear Sky",
  "icon": "sun",
  "location": "Indore, IN",
  "is_day": true,
  "weather_code": 0,
  "updated_secs": 1794213908,
  "query": ""
}
```
Error fallback:
```json
{
  "type": "weather_error",
  "message": "Could not detect IP geolocation (offline or service unreachable)"
}
```

### 2.5 Settings & Modal Sync (`ui_settings_sync`, `open_*`)
- `{"type": "ui_settings_sync", "settings": { ... }}` — Broadcasts persisted settings so Chrome and all open New Tab pages stay synchronized in real time.
- `{"type": "open_settings"}` / `{"type": "open_command_palette"}` / `{"type": "open_find_bar"}` / `{"type": "open_side_panel", "panel": "..."}` — Forwarded UI trigger events from New Tab shortcuts and content webview accelerators.

### 2.6 Download Progress (`download_progress`)
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
