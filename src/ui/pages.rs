//! Internal browser pages: about:history, about:bookmarks, about:downloads.
//!
//! Generated dynamically as lightweight, self-contained HTML strings.

use crate::storage::{Bookmark, DownloadRecord, HistoryEntry, Settings};

/// Render `about:history` HTML.
pub fn render_history_page(entries: &[HistoryEntry]) -> String {
    let mut rows = String::new();
    for entry in entries {
        let safe_url = html_escape(&entry.url);
        let safe_title = html_escape(&entry.title);
        rows.push_str(&format!(
            r#"<tr>
                <td class="time">{}</td>
                <td><a href="{}" class="hist-link">{}</a></td>
                <td class="url">{}</td>
            </tr>"#,
            format_time(entry.timestamp_secs),
            safe_url,
            safe_title,
            safe_url
        ));
    }

    if rows.is_empty() {
        rows = r#"<tr><td colspan="3" class="empty">No browsing history yet</td></tr>"#.to_owned();
    }

    format!(
        r#"<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>History — Rusty Browser</title>
<style>
  body {{ font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #1f1f23; color: #efeff1; margin: 0; padding: 24px 40px; }}
  h1 {{ font-size: 24px; font-weight: 500; margin-bottom: 20px; color: #8ab4f8; }}
  table {{ width: 100%; border-collapse: collapse; margin-top: 10px; }}
  th, td {{ text-align: left; padding: 10px 14px; border-bottom: 1px solid #303036; font-size: 13px; }}
  th {{ color: #9aa0a6; font-weight: 500; text-transform: uppercase; font-size: 11px; }}
  tr:hover {{ background: #2b2b32; }}
  a {{ color: #8ab4f8; text-decoration: none; }}
  a:hover {{ text-decoration: underline; }}
  .time {{ color: #9aa0a6; width: 140px; }}
  .url {{ color: #9aa0a6; max-width: 400px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }}
  .empty {{ text-align: center; color: #9aa0a6; padding: 40px; }}
</style>
</head>
<body>
  <h1>Browsing History</h1>
  <table>
    <thead><tr><th>Time</th><th>Title</th><th>URL</th></tr></thead>
    <tbody>{rows}</tbody>
  </table>
</body>
</html>"#
    )
}

/// Render `about:bookmarks` HTML.
pub fn render_bookmarks_page(bookmarks: &[Bookmark]) -> String {
    let mut rows = String::new();
    for bm in bookmarks {
        let safe_url = html_escape(&bm.url);
        let safe_title = html_escape(&bm.title);
        rows.push_str(&format!(
            r#"<tr>
                <td><a href="{}" class="bm-link">{}</a></td>
                <td class="url">{}</td>
                <td class="time">{}</td>
            </tr>"#,
            safe_url,
            safe_title,
            safe_url,
            format_time(bm.added_secs)
        ));
    }

    if rows.is_empty() {
        rows = r#"<tr><td colspan="3" class="empty">No bookmarks saved yet. Click the ⭐ in the address bar to bookmark pages!</td></tr>"#.to_owned();
    }

    format!(
        r#"<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Bookmarks — Rusty Browser</title>
<style>
  body {{ font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #1f1f23; color: #efeff1; margin: 0; padding: 24px 40px; }}
  h1 {{ font-size: 24px; font-weight: 500; margin-bottom: 20px; color: #ffd700; }}
  table {{ width: 100%; border-collapse: collapse; margin-top: 10px; }}
  th, td {{ text-align: left; padding: 10px 14px; border-bottom: 1px solid #303036; font-size: 13px; }}
  th {{ color: #9aa0a6; font-weight: 500; text-transform: uppercase; font-size: 11px; }}
  tr:hover {{ background: #2b2b32; }}
  a {{ color: #ffd700; text-decoration: none; font-weight: 500; }}
  a:hover {{ text-decoration: underline; }}
  .time {{ color: #9aa0a6; width: 140px; }}
  .url {{ color: #9aa0a6; max-width: 450px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }}
  .empty {{ text-align: center; color: #9aa0a6; padding: 40px; }}
</style>
</head>
<body>
  <h1>★ Saved Bookmarks</h1>
  <table>
    <thead><tr><th>Title</th><th>URL</th><th>Saved</th></tr></thead>
    <tbody>{rows}</tbody>
  </table>
</body>
</html>"#
    )
}

/// Render `about:downloads` HTML.
pub fn render_downloads_page(downloads: &[DownloadRecord]) -> String {
    let mut rows = String::new();
    for dl in downloads.iter().rev() {
        let safe_url = html_escape(&dl.url);
        let safe_name = html_escape(&dl.filename);
        let safe_path = html_escape(&dl.path);
        let status_badge = if dl.success {
            r#"<span style="color:#81c995;">✓ Completed</span>"#
        } else {
            r#"<span style="color:#f28b82;">✕ Incomplete</span>"#
        };

        rows.push_str(&format!(
            r#"<tr>
                <td><strong>{}</strong><br><span class="url">{}</span></td>
                <td>{}</td>
                <td>{}</td>
                <td class="time">{}</td>
            </tr>"#,
            safe_name,
            safe_path,
            status_badge,
            format_time(dl.timestamp_secs),
            safe_url,
        ));
    }

    if rows.is_empty() {
        rows = r#"<tr><td colspan="4" class="empty">No downloads yet</td></tr>"#.to_owned();
    }

    format!(
        r#"<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Downloads — Rusty Browser</title>
<style>
  body {{ font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #1f1f23; color: #efeff1; margin: 0; padding: 24px 40px; }}
  h1 {{ font-size: 24px; font-weight: 500; margin-bottom: 20px; color: #8ab4f8; }}
  table {{ width: 100%; border-collapse: collapse; margin-top: 10px; }}
  th, td {{ text-align: left; padding: 12px 14px; border-bottom: 1px solid #303036; font-size: 13px; }}
  th {{ color: #9aa0a6; font-weight: 500; text-transform: uppercase; font-size: 11px; }}
  tr:hover {{ background: #2b2b32; }}
  .time {{ color: #9aa0a6; width: 140px; }}
  .url {{ color: #9aa0a6; font-size: 11px; }}
  .empty {{ text-align: center; color: #9aa0a6; padding: 40px; }}
</style>
</head>
<body>
  <h1>📥 Downloads</h1>
  <table>
    <thead><tr><th>File</th><th>Status</th><th>Date</th></tr></thead>
    <tbody>{rows}</tbody>
  </table>
</body>
</html>"#
    )
}

/// Render `about:settings` HTML.
pub fn render_settings_page(settings: &Settings) -> String {
    let cam_checked = if settings.block_camera { "checked" } else { "" };
    let mic_checked = if settings.block_microphone { "checked" } else { "" };
    let geo_checked = if settings.block_geolocation { "checked" } else { "" };

    let search_ddg = if settings.default_search_template.contains("duckduckgo.com") { "selected" } else { "" };
    let search_google = if settings.default_search_template.contains("google.com") { "selected" } else { "" };
    let search_bing = if settings.default_search_template.contains("bing.com") { "selected" } else { "" };
    let search_brave = if settings.default_search_template.contains("brave.com") { "selected" } else { "" };

    let disc_300 = if settings.discard_timeout_secs == 300 { "selected" } else { "" };
    let disc_600 = if settings.discard_timeout_secs == 600 { "selected" } else { "" };
    let disc_900 = if settings.discard_timeout_secs == 900 { "selected" } else { "" };
    let disc_1800 = if settings.discard_timeout_secs == 1800 { "selected" } else { "" };
    let disc_0 = if settings.discard_timeout_secs == 0 { "selected" } else { "" };

    let zoom_80 = if (settings.default_zoom - 0.8).abs() < 0.01 { "selected" } else { "" };
    let zoom_90 = if (settings.default_zoom - 0.9).abs() < 0.01 { "selected" } else { "" };
    let zoom_100 = if (settings.default_zoom - 1.0).abs() < 0.01 { "selected" } else { "" };
    let zoom_110 = if (settings.default_zoom - 1.1).abs() < 0.01 { "selected" } else { "" };
    let zoom_125 = if (settings.default_zoom - 1.25).abs() < 0.01 { "selected" } else { "" };
    let zoom_150 = if (settings.default_zoom - 1.5).abs() < 0.01 { "selected" } else { "" };

    format!(
        r#"<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Settings — Rusty Browser</title>
<style>
  body {{ font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #1f1f23; color: #efeff1; margin: 0; padding: 32px 48px; max-width: 780px; }}
  h1 {{ font-size: 24px; font-weight: 500; margin-bottom: 24px; color: #8ab4f8; }}
  .section {{ background: #2b2b32; border-radius: 8px; padding: 20px; margin-bottom: 20px; border: 1px solid #3c3c44; }}
  .section h2 {{ font-size: 16px; font-weight: 500; margin: 0 0 14px 0; color: #e8eaed; }}
  .row {{ display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }}
  .row:last-child {{ margin-bottom: 0; }}
  .label {{ font-size: 13px; color: #dadce0; }}
  .subtext {{ font-size: 11px; color: #9aa0a6; margin-top: 3px; }}
  select, input[type="text"] {{ background: #18181b; border: 1px solid #484852; color: #efeff1; padding: 6px 10px; border-radius: 4px; font-size: 13px; outline: none; }}
  select:focus, input[type="text"]:focus {{ border-color: #8ab4f8; }}
  input[type="checkbox"] {{ width: 16px; height: 16px; accent-color: #8ab4f8; cursor: pointer; }}
  .btn {{ background: #3b3e48; color: #e8eaed; border: 1px solid #555764; border-radius: 4px; padding: 7px 14px; font-size: 12px; cursor: pointer; transition: background 0.15s; }}
  .btn:hover {{ background: #4a4e5c; }}
  .btn-primary {{ background: #1a73e8; color: white; border: none; font-weight: 500; font-size: 13px; padding: 8px 18px; }}
  .btn-primary:hover {{ background: #1557b0; }}
  .btn-danger {{ background: #5c2020; border-color: #823030; color: #ffb4b4; }}
  .btn-danger:hover {{ background: #782828; }}
  .banner {{ display: none; background: #134e48; color: #99f6e4; padding: 10px 16px; border-radius: 4px; margin-bottom: 18px; font-size: 13px; }}
  .actions-row {{ margin-top: 24px; display: flex; gap: 12px; align-items: center; }}
</style>
</head>
<body>
  <h1>⚙ Settings</h1>
  <div class="banner" id="saveBanner">✓ Settings saved successfully</div>

  <div class="section">
    <h2>Search Engine</h2>
    <div class="row">
      <div>
        <div class="label">Default Search Provider</div>
        <div class="subtext">Used when typing non-URL queries into the address bar</div>
      </div>
      <select id="searchEngine">
        <option value="https://duckduckgo.com/?q=%s" {search_ddg}>DuckDuckGo</option>
        <option value="https://www.google.com/search?q=%s" {search_google}>Google</option>
        <option value="https://www.bing.com/search?q=%s" {search_bing}>Bing</option>
        <option value="https://search.brave.com/search?q=%s" {search_brave}>Brave</option>
      </select>
    </div>
  </div>

  <div class="section">
    <h2>Memory Saver & Tab Discarding</h2>
    <div class="row">
      <div>
        <div class="label">Discard Inactive Tabs</div>
        <div class="subtext">Frees WebView process memory while preserving tab title and scroll position</div>
      </div>
      <select id="discardTimeout">
        <option value="300" {disc_300}>After 5 minutes</option>
        <option value="600" {disc_600}>After 10 minutes (Recommended)</option>
        <option value="900" {disc_900}>After 15 minutes</option>
        <option value="1800" {disc_1800}>After 30 minutes</option>
        <option value="0" {disc_0}>Never discard</option>
      </select>
    </div>
  </div>

  <div class="section">
    <h2>Appearance & Page Zoom</h2>
    <div class="row">
      <div>
        <div class="label">Default Page Zoom Level</div>
        <div class="subtext">Applied to newly opened tabs</div>
      </div>
      <select id="defaultZoom">
        <option value="0.8" {zoom_80}>80%</option>
        <option value="0.9" {zoom_90}>90%</option>
        <option value="1.0" {zoom_100}>100%</option>
        <option value="1.1" {zoom_110}>110%</option>
        <option value="1.25" {zoom_125}>125%</option>
        <option value="1.5" {zoom_150}>150%</option>
      </select>
    </div>
  </div>

  <div class="section">
    <h2>Hardware & Permission Sandbox</h2>
    <div class="row">
      <div>
        <div class="label">Block Camera Access by Default</div>
        <div class="subtext">Uncheck to allow native per-site permission prompts</div>
      </div>
      <input type="checkbox" id="blockCamera" {cam_checked}>
    </div>
    <div class="row">
      <div>
        <div class="label">Block Microphone Access by Default</div>
        <div class="subtext">Uncheck to allow native per-site permission prompts</div>
      </div>
      <input type="checkbox" id="blockMicrophone" {mic_checked}>
    </div>
    <div class="row">
      <div>
        <div class="label">Block Geolocation (GPS) by Default</div>
        <div class="subtext">Uncheck to allow native per-site permission prompts</div>
      </div>
      <input type="checkbox" id="blockGeolocation" {geo_checked}>
    </div>
  </div>

  <div class="section">
    <h2>Clear Browsing Data</h2>
    <div class="row">
      <div>
        <div class="label">Browsing History</div>
        <div class="subtext">Clear saved list of visited websites</div>
      </div>
      <button class="btn btn-danger" onclick="clearData('clear_history', 'Clear browsing history?')">Clear History</button>
    </div>
    <div class="row">
      <div>
        <div class="label">Saved Bookmarks</div>
        <div class="subtext">Clear all saved bookmarks</div>
      </div>
      <button class="btn btn-danger" onclick="clearData('clear_bookmarks', 'Clear all bookmarks?')">Clear Bookmarks</button>
    </div>
    <div class="row">
      <div>
        <div class="label">Downloads Record</div>
        <div class="subtext">Clear download history log (does not delete downloaded files)</div>
      </div>
      <button class="btn btn-danger" onclick="clearData('clear_downloads', 'Clear download history?')">Clear Downloads</button>
    </div>
  </div>

  <div class="actions-row">
    <button class="btn btn-primary" onclick="saveSettings()">Save Changes</button>
  </div>

<script>
function saveSettings() {{
  const payload = {{
    action: 'save_settings',
    settings: {{
      default_search_template: document.getElementById('searchEngine').value,
      discard_timeout_secs: parseInt(document.getElementById('discardTimeout').value, 10),
      default_zoom: parseFloat(document.getElementById('defaultZoom').value),
      block_camera: document.getElementById('blockCamera').checked,
      block_microphone: document.getElementById('blockMicrophone').checked,
      block_geolocation: document.getElementById('blockGeolocation').checked,
    }}
  }};
  if (window.ipc && window.ipc.postMessage) {{
    window.ipc.postMessage(JSON.stringify(payload));
    const b = document.getElementById('saveBanner');
    b.style.display = 'block';
    setTimeout(() => {{ b.style.display = 'none'; }}, 2500);
  }}
}}

function clearData(action, promptText) {{
  if (confirm(promptText)) {{
    if (window.ipc && window.ipc.postMessage) {{
      window.ipc.postMessage(JSON.stringify({{ action: action }}));
      alert('Data cleared successfully.');
    }}
  }}
}}
</script>
</body>
</html>"#
    )
}

fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

fn format_time(timestamp_secs: u64) -> String {
    // Simple format without pulling in huge chrono dependencies
    let hours = (timestamp_secs % 86400) / 3600;
    let mins = (timestamp_secs % 3600) / 60;
    let secs = timestamp_secs % 60;
    format!("{hours:02}:{mins:02}:{secs:02} UTC")
}
