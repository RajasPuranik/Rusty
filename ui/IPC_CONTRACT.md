# RUSTY BROWSER — IPC CONTRACT SPECIFICATION

Bidirectional JSON messaging protocol between internal UI WebViews (`rusty://app/`, mapped to `http://rusty.app/` on Windows WebView2) and the Rust backend (`tao` + `wry`).

All messages are serialized as JSON strings and validated with strongly-typed Rust serde enums (`UiMessage`). Full IPC execution is **strictly restricted** to trusted `rusty://app/` origins. Untrusted web pages are blocked from privileged IPC and may only forward safe navigation/accelerator intents (`new_tab` validated to `http(s)` or empty, `close_current_tab`, `back`, `forward`, `reload`, `next_tab`, `prev_tab`, `stop`, `focus_omnibox`, `zoom_in`, `zoom_out`, `zoom_reset`, `open_command_palette`, `open_find_bar`, `open_settings`, `split_view`, and whitelisted `open_side_panel`).

---

## 1. UI ➔ Rust Messages (`UiMessage`)

Dispatched from JavaScript via `window.ipc.postMessage(JSON.stringify(msg))`.

### 1.1 Navigation, Tabs & Clipboard
| Action | Payload Schema | Description |
|---|---|---|
| `new_tab` | `{"action": "new_tab", "url"?: string, "background"?: boolean \| null, "title"?: string}` | Open a new tab. When `background` is `null` and a URL is present, uses `open_tabs_in_background`. |
| `paste_new_tab` | `{"action": "paste_new_tab"}` | Reads clipboard URL/query in Rust and opens a new tab (middle-click on `+`). |
| `open_history_entry_in_new_tab` | `{"action": "open_history_entry_in_new_tab", "direction": "back" \| "forward", "background"?: boolean \| null}` | Middle-clicking Back/Forward opens the target entry in a new tab. |
| `switch_tab` | `{"action": "switch_tab", "tab_id": number}` | Switch active tab to `tab_id` (and focus active split pane if split is enabled). |
| `close_tab` | `{"action": "close_tab", "tab_id"?: number}` | Close specified tab (or active tab if omitted). Emits `pet_event: "tab_closed"` in Crazy skin. |
| `close_current_tab` | `{"action": "close_current_tab"}` | Close currently focused tab (`Ctrl+W`). |
| `next_tab` / `prev_tab` | `{"action": "next_tab" \| "prev_tab"}` | Cycle next/previous tab (`Ctrl+Tab` / `Ctrl+Shift+Tab`). |
| `reorder_tabs` | `{"action": "reorder_tabs", "from_id": number, "to_id": number, "position": "before" \| "after"}` | Reorder tabs via drag-and-drop. |
| `pin_tab` | `{"action": "pin_tab", "tab_id": number, "pinned": boolean}` | Toggle or set pinned status for tab. |
| `mute_tab` | `{"action": "mute_tab", "tab_id": number, "muted": boolean}` | Toggle or set audio mute for tab. |
| `duplicate_tab` | `{"action": "duplicate_tab", "tab_id": number, "background"?: boolean \| null}` | Clone tab and insert duplicate (also used on Reload middle-click). |
| `close_other_tabs` | `{"action": "close_other_tabs", "tab_id": number}` | Close all other unpinned tabs. |
| `close_tabs_below` | `{"action": "close_tabs_below", "tab_id": number}` | Close all unpinned tabs below/to right of specified tab. |
| `create_group` | `{"action": "create_group", "name": string, "color"?: string, "tab_id"?: number}` | Create a colored tab group. |
| `set_tab_group` | `{"action": "set_tab_group", "tab_id": number, "group_id": string \| null}` | Assign or remove tab from a tab group. |
| `toggle_group_collapse` | `{"action": "toggle_group_collapse", "group_id": string}` | Toggle collapsed state for tab group. |
| `navigate` | `{"action": "navigate", "url": string}` | Navigate active tab (or focused split pane) to `url` or search query. |
| `back` / `forward` | `{"action": "back" \| "forward"}` | History back / forward navigation. |
| `reload` / `stop` | `{"action": "reload" \| "stop"}` | Reload or stop loading active content WebView2. |
| `copy_to_clipboard` | `{"action": "copy_to_clipboard", "text": string}` | Native Win32 Unicode clipboard copy (e.g., Memory Breakdown report). |
| `new_window` | `{"action": "new_window", "incognito"?: boolean}` | Spawn new normal or `--incognito` browser process. |
| `open_private_window` | `{"action": "open_private_window"}` | Spawn separate `--incognito` private process (`Ctrl+Shift+N`). |

### 1.2 Split View (B1 — Event-Loop Dispatched, Epsilon-Bounded)
| Action | Payload Schema | Description |
|---|---|---|
| `split_view` | `{"action": "split_view", "enabled"?: boolean}` | Toggle or set side-by-side Split View via `EventLoopProxy::send_event(UserEvent::ApplySplitView)` (never blocking IPC). |
| `split_close` | `{"action": "split_close"}` | Close Split View and retain the focused pane as active tab. |
| `split_swap` | `{"action": "split_swap"}` | Swap left and right split pane tabs without blocking. |
| `split_focus` | `{"action": "split_focus", "pane": 0 \| 1}` | Set focused split pane (`0` left, `1` right). |
| `split_navigate` | `{"action": "split_navigate", "pane": 0 \| 1, "url": string}` | Navigate specific split pane address bar independently. |

### 1.3 Memory Saver, Cleanup & Layout Bounds
| Action | Payload Schema | Description |
|---|---|---|
| `sleep_tab` | `{"action": "sleep_tab", "tab_id": number}` | Manually discard tab WebView2 from RAM, saving scroll position. |
| `wake_tab` | `{"action": "wake_tab", "tab_id": number}` | Re-instantiate WebView2 for discarded tab and restore scroll. |
| `discard_background_tabs` | `{"action": "discard_background_tabs"}` | Discard eligible inactive background tabs immediately. |
| `save_scroll` | `{"action": "save_scroll", "scroll_y"?: number}` | Save current scroll Y offset before discard. |
| `content_rect` | `{"action": "content_rect", "x": number, "y": number, "width": number, "height": number, "left"?: RectPayload, "right"?: RectPayload, "ratio"?: number}` | Sends viewport rectangle (and optional split pane sub-rects/ratio); Rust applies bounds only when delta > `0.5px` epsilon. |
| `overlay` | `{"action": "overlay", "open": boolean}` | Hides/restores native child WebView2 instances so Chrome modals/palettes render on top. |

### 1.4 Settings, Weather, Chrome Modals, Zoom & Find
| Action | Payload Schema | Description |
|---|---|---|
| `ui_ready` | `{"action": "ui_ready", "role"?: "chrome" \| "newtab"}` | Emitted once UI scripts finish binding; triggers initial `state_update`, `ui_settings_sync`, cached weather, and telemetry. |
| `toggle_bookmark` | `{"action": "toggle_bookmark", "url"?: string}` | Add or remove bookmark (current URL if `url` omitted). |
| `set_setting` | `{"action": "set_setting", "key": string, "value": any}` | Atomically update any persisted `Settings` key, persist `data.json`, and broadcast `ui_settings_sync`. |
| `save_settings` | `{"action": "save_settings", "settings": object}` | Partial merge into `Settings` without clobbering unrelated keys; broadcasts `ui_settings_sync`. |
| `fetch_weather` | `{"action": "fetch_weather", "location"?: string, "lat"?: number, "lon"?: number, "label"?: string, "country"?: string, "force"?: boolean}` | Triggers Rust `weather::fetch_weather_cached` (Open-Meteo via WinHTTP + 30-min cache) using city name OR explicit/centroid lat-lon coordinates (**zero IP geolocation lookups**). |
| `open_settings` / `open_command_palette` / `open_find_bar` / `focus_omnibox` | `{"action": "..."}` | Forwarded Chrome modal/focus actions (from NTP or `CONTENT_INIT_SCRIPT`). |
| `open_side_panel` | `{"action": "open_side_panel", "panel": "bookmarks" \| "history" \| "downloads"}` | Toggle Chrome side panel. |
| `zoom` / `zoom_in` / `zoom_out` / `zoom_reset` | `{"action": "zoom", "level": number}` or no payload | Control active tab WebView2 zoom level. |
| `find_in_page` / `find_close` | `{"action": "find_in_page", "query": string, "forward"?: boolean, "match_case"?: boolean}` / `{"action": "find_close"}` | Highlight/step or clear find-in-page matches. |
| `toggle_reader` | `{"action": "toggle_reader", "active"?: boolean}` | Reader mode toggle signal. |
| `clear_browsing_data` / `clear_history` / `clear_bookmarks` / `clear_downloads` | `{"action": ...}` | Clear persisted history, cache, bookmarks, or download list. |
| `load_unpacked_extension` | `{"action": "load_unpacked_extension", "path": string}` | Inspect and mount an unpacked extension folder from disk. |
| `toggle_extension` | `{"action": "toggle_extension", "id": string, "enabled": boolean}` | Enable or disable an installed extension. |
| `remove_extension` | `{"action": "remove_extension", "id": string}` | Uninstall an extension. |
| `inspect_extension` | `{"action": "inspect_extension", "path": string}` | Parse manifest without mounting and evaluate permission risk level. |
| `save_userscript` | `{"action": "save_userscript", "script": UserScript}` | Add or update a custom userscript with match patterns, timing, and code. |
| `toggle_userscript` | `{"action": "toggle_userscript", "id": string, "enabled": boolean}` | Enable or disable a userscript. |
| `delete_userscript` | `{"action": "delete_userscript", "id": string}` | Delete a userscript. |
| `get_extensions_and_scripts` | `{"action": "get_extensions_and_scripts"}` | Request active extensions and userscripts state with platform capability flags. |

---

## 2. Rust ➔ UI Messages (`window.__onRustMessage`)

Dispatched from Rust to Chrome and trusted internal New Tab WebViews (`rusty://app/`):

### 2.1 State Synchronization (`state_update`)
Includes: `tabs` (`id`, `title`, `url`, `active`, `sleeping`, `pinned`, `muted`, `group_id`), `groups`, `active_tab`, `url`, `title`, `can_go_back`, `can_go_forward`, `is_bookmarked`, `zoom_percent`, `is_incognito`, `bookmarks`, `history`, `downloads`, `memory` (full `memory_stats` object), and `split_view` (`enabled`, `ratio`, `focused_pane`, `left_tab_id`, `right_tab_id`, `left_url`, `right_url`, `left_title`, `right_title`).

### 2.2 Live Memory & Process Breakdown (`memory_stats`)
Uses process-tree walk + `--user-data-dir` matching + `NtQueryInformationProcess(ProcessVmCounters)`:
```json
{
  "type": "memory_stats",
  "metric": "private_working_set",
  "total_mb": 127.0,
  "private_ws_mb": 127.0,
  "working_set_mb": 435.0,
  "commit_mb": 227.8,
  "host_private_ws_mb": 10.1,
  "process_count": 8,
  "processes": [
    {
      "pid": 1234,
      "parent_pid": 567,
      "kind": "Host (Rusty)",
      "exe_name": "rusty_browser.exe",
      "private_ws_mb": 10.1,
      "working_set_mb": 44.8,
      "commit_mb": 12.7
    }
  ],
  "chrome_baseline_mb": 170.0,
  "chrome_live_measured": false,
  "chrome_process_count": 0,
  "savings_percent": 25.3
}
```
When Chrome (`chrome.exe`) is running locally, `chrome_baseline_mb` measures Chrome's entire process tree with the identical **Private Working Set** metric (`chrome_live_measured: true`).

### 2.3 Real-Time System & Browser Telemetry (`telemetry_stats`)
Pushed every 2 seconds: `sys_cpu_percent`, `sys_ram_percent`, `sys_ram_used_gb`, `sys_ram_total_gb`, `sys_gpu_percent` (nullable), `net_kbps`, `browser_mb` (Private WS), `browser_working_set_mb`, `browser_commit_mb`.

### 2.4 Live Weather Updates (`weather_update` & `weather_error`)
```json
{
  "type": "weather_update",
  "temperature_c": 24.4,
  "apparent_c": 24.9,
  "humidity": 52,
  "wind_kmh": 8.6,
  "condition": "Overcast",
  "icon": "cloud",
  "location": "New Delhi, IN",
  "country": "India",
  "latitude": 28.6139,
  "longitude": 77.2090,
  "is_day": true,
  "weather_code": 3,
  "updated_secs": 1794228760,
  "query": "New Delhi",
  "offline": false,
  "forecast": [
    {
      "date": "2026-11-09",
      "temp_max_c": 26.5,
      "temp_min_c": 14.2,
      "weather_code": 2,
      "condition": "Partly Cloudy",
      "icon": "partly-cloudy"
    }
  ]
}
```
When offline with a previously cached entry, emits `weather_update` with `"offline": true`. If uncached & unreachable, emits `{"type": "weather_error", "message": "..."}`.

### 2.5 Companion Pet Events (`pet_event`) — Crazy Skin Only
Emitted ONLY when `settings.skin == "crazy"`:
`{"type": "pet_event", "event": "page_loading" | "page_loaded" | "download_finished" | "tab_closed"}`
(Client-side pet state machine in `ui/js/pet-crazy.js` also handles `memory_high` from `memory_stats`, `midnight`, `idle_sleep`, `curious`, `follow`, `play`, `happy`, and `feed`.)

### 2.6 Persisted `Settings` Schema (`ui_settings_sync`)
`skin`, `theme`, `custom_accent`, `use_custom_accent`, `tabs_layout`, `vertical_collapsed`, `density`, `default_search`, `default_search_template`, `omnibox_engine_outline`, `custom_engines` (`[{id, name, template, color}]`), `effects_intensity`, `fx_glow`, `fx_tilt`, `fx_magnetic`, `fx_ripple`, `fx_trail`, `fx_confetti`, `fx_canvas_bg`, `show_memory_badge`, `open_tabs_in_background`, `discard_timeout_secs`, `default_zoom`, `block_camera`, `block_microphone`, `block_geolocation`, `ntp_show_clock`, `ntp_show_greeting`, `ntp_show_speed_dial`, `ntp_show_notes`, `ntp_show_weather`, `weather_location`, `world_clocks` (`[{id, name, timezone}]`), `ntp_globe_clouds`, `pet_type` (`"" | "dog" | "cat" | "robot" | "fox" | "slime"`), `pet_name`, `pet_color`, `pet_accessory` (`"none" | "collar" | "bow" | "hat" | "glasses"`), `pet_mood`, `pet_roam`.
