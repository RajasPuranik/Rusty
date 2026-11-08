//! Internal browser pages: about:history, about:bookmarks, about:downloads.
//!
//! Generated dynamically as lightweight, self-contained HTML strings.

use crate::storage::{Bookmark, DownloadRecord, HistoryEntry};

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
