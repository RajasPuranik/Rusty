//! Local data storage for history, bookmarks, and settings.
//!
//! Stored in `%APPDATA%\rusty_browser\data.json` (Windows)
//! or `~/.config/rusty_browser/data.json` (Linux/macOS).
//!
//! Lazily initialized on first access so cold startup to first paint
//! incurs zero disk I/O.

use serde::{Deserialize, Serialize};
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

/// Maximum number of history entries kept in the local log.
const MAX_HISTORY_ENTRIES: usize = 2000;

/// A single browsing history record.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HistoryEntry {
    pub url: String,
    pub title: String,
    pub timestamp_secs: u64,
}

/// A bookmark record.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Bookmark {
    pub url: String,
    pub title: String,
    pub added_secs: u64,
}

/// A record of a completed or in-progress download.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadRecord {
    pub url: String,
    pub filename: String,
    pub path: String,
    pub success: bool,
    pub timestamp_secs: u64,
}

fn default_true() -> bool {
    true
}
fn default_search() -> String {
    "https://duckduckgo.com/?q=%s".to_owned()
}
fn default_discard() -> u64 {
    600
}
fn default_zoom() -> f64 {
    1.0
}

/// Browser user settings.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Settings {
    #[serde(default = "default_search")]
    pub default_search_template: String,
    #[serde(default = "default_discard")]
    pub discard_timeout_secs: u64,
    #[serde(default = "default_zoom")]
    pub default_zoom: f64,
    #[serde(default = "default_true")]
    pub block_camera: bool,
    #[serde(default = "default_true")]
    pub block_microphone: bool,
    #[serde(default = "default_true")]
    pub block_geolocation: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            default_search_template: default_search(),
            discard_timeout_secs: default_discard(),
            default_zoom: default_zoom(),
            block_camera: true,
            block_microphone: true,
            block_geolocation: true,
        }
    }
}

/// Root data structure serialized to `data.json`.
#[derive(Debug, Default, Clone, Serialize, Deserialize)]
pub struct StorageData {
    pub history: Vec<HistoryEntry>,
    pub bookmarks: Vec<Bookmark>,
    pub downloads: Vec<DownloadRecord>,
    pub settings: Settings,
}

/// Manages lazy persistent storage.
pub struct Storage {
    data_dir: PathBuf,
    file_path: PathBuf,
    data: StorageData,
    loaded: bool,
}

impl Storage {
    pub fn new() -> Self {
        let data_dir = Self::resolve_data_dir();
        let file_path = data_dir.join("data.json");
        Self {
            data_dir,
            file_path,
            data: StorageData::default(),
            loaded: false,
        }
    }

    /// Resolve platform data directory:
    /// Windows: `%APPDATA%\rusty_browser`
    /// Unix: `~/.config/rusty_browser`
    pub fn resolve_data_dir() -> PathBuf {
        #[cfg(target_os = "windows")]
        {
            if let Ok(appdata) = env::var("APPDATA") {
                return PathBuf::from(appdata).join("rusty_browser");
            }
            if let Ok(userprofile) = env::var("USERPROFILE") {
                return PathBuf::from(userprofile).join(".rusty_browser");
            }
        }

        #[cfg(not(target_os = "windows"))]
        {
            if let Ok(home) = env::var("HOME") {
                return PathBuf::from(home).join(".config").join("rusty_browser");
            }
        }

        PathBuf::from(".rusty_browser")
    }

    /// Resolve platform downloads directory:
    /// Windows: `%USERPROFILE%\Downloads`
    /// Unix: `~/Downloads`
    pub fn resolve_downloads_dir() -> PathBuf {
        #[cfg(target_os = "windows")]
        {
            if let Ok(userprofile) = env::var("USERPROFILE") {
                let dl = PathBuf::from(userprofile).join("Downloads");
                if dl.exists() {
                    return dl;
                }
            }
        }

        #[cfg(not(target_os = "windows"))]
        {
            if let Ok(home) = env::var("HOME") {
                let dl = PathBuf::from(home).join("Downloads");
                if dl.exists() {
                    return dl;
                }
            }
        }

        PathBuf::from("Downloads")
    }

    /// Lazy load on demand (only when first history/bookmark/settings action happens).
    fn ensure_loaded(&mut self) {
        if self.loaded {
            return;
        }
        self.loaded = true;

        if let Ok(content) = fs::read_to_string(&self.file_path) {
            if let Ok(parsed) = serde_json::from_str::<StorageData>(&content) {
                self.data = parsed;
                return;
            }
        }
        // First run or corrupt file — use defaults
        self.data = StorageData::default();
    }

    /// Save current state atomically to disk via a temporary file.
    pub fn save(&self) {
        if !self.loaded {
            return;
        }

        let _ = fs::create_dir_all(&self.data_dir);
        let tmp_path = self.file_path.with_extension("tmp");

        if let Ok(serialized) = serde_json::to_string_pretty(&self.data) {
            if fs::write(&tmp_path, serialized).is_ok() {
                let _ = fs::rename(&tmp_path, &self.file_path);
            }
        }
    }

    /// Record a visited URL in history. Avoids duplicate entries if visited consecutively.
    pub fn record_history(&mut self, url: &str, title: &str) {
        if url.is_empty() || url == "about:blank" || url.starts_with("data:") {
            return;
        }

        self.ensure_loaded();

        // If the last entry has the exact same URL, update its title and timestamp
        if let Some(last) = self.data.history.last_mut() {
            if last.url == url {
                if !title.is_empty() {
                    last.title = title.to_owned();
                }
                last.timestamp_secs = now_secs();
                self.save();
                return;
            }
        }

        let entry = HistoryEntry {
            url: url.to_owned(),
            title: if title.is_empty() { url.to_owned() } else { title.to_owned() },
            timestamp_secs: now_secs(),
        };

        self.data.history.push(entry);

        // Cap history length to avoid unbounded memory / disk growth
        if self.data.history.len() > MAX_HISTORY_ENTRIES {
            let overflow = self.data.history.len() - MAX_HISTORY_ENTRIES;
            self.data.history.drain(0..overflow);
        }

        self.save();
    }

    /// Add or toggle a bookmark. Returns `true` if bookmarked, `false` if removed.
    pub fn toggle_bookmark(&mut self, url: &str, title: &str) -> bool {
        if url.is_empty() || url == "about:blank" {
            return false;
        }

        self.ensure_loaded();

        if let Some(pos) = self.data.bookmarks.iter().position(|b| b.url == url) {
            self.data.bookmarks.remove(pos);
            self.save();
            false
        } else {
            self.data.bookmarks.push(Bookmark {
                url: url.to_owned(),
                title: if title.is_empty() { url.to_owned() } else { title.to_owned() },
                added_secs: now_secs(),
            });
            self.save();
            true
        }
    }

    /// Check if a URL is currently bookmarked.
    pub fn is_bookmarked(&mut self, url: &str) -> bool {
        self.ensure_loaded();
        self.data.bookmarks.iter().any(|b| b.url == url)
    }

    /// Get all bookmarks.
    pub fn bookmarks(&mut self) -> &[Bookmark] {
        self.ensure_loaded();
        &self.data.bookmarks
    }

    /// Record a download event.
    pub fn record_download(&mut self, url: &str, filename: &str, path: &str, success: bool) {
        self.ensure_loaded();
        self.data.downloads.push(DownloadRecord {
            url: url.to_owned(),
            filename: filename.to_owned(),
            path: path.to_owned(),
            success,
            timestamp_secs: now_secs(),
        });
        self.save();
    }

    /// Get all download records.
    pub fn downloads(&mut self) -> &[DownloadRecord] {
        self.ensure_loaded();
        &self.data.downloads
    }

    /// Get recent history entries (most recent first).
    pub fn recent_history(&mut self, limit: usize) -> Vec<HistoryEntry> {
        self.ensure_loaded();
        self.data
            .history
            .iter()
            .rev()
            .take(limit)
            .cloned()
            .collect()
    }

    /// Get mutable reference to settings.
    #[allow(dead_code)]
    pub fn settings_mut(&mut self) -> &mut Settings {
        self.ensure_loaded();
        &mut self.data.settings
    }

    /// Get reference to settings.
    pub fn settings(&mut self) -> &Settings {
        self.ensure_loaded();
        &self.data.settings
    }

    /// Update settings and save to disk.
    pub fn update_settings(&mut self, settings: Settings) {
        self.ensure_loaded();
        self.data.settings = settings;
        self.save();
    }

    /// Clear all browsing history.
    pub fn clear_history(&mut self) {
        self.ensure_loaded();
        self.data.history.clear();
        self.save();
    }

    /// Clear all bookmarks.
    pub fn clear_bookmarks(&mut self) {
        self.ensure_loaded();
        self.data.bookmarks.clear();
        self.save();
    }

    /// Clear all download records.
    pub fn clear_downloads(&mut self) {
        self.ensure_loaded();
        self.data.downloads.clear();
        self.save();
    }

    /// Path to user data directory (for webview context / cookies).
    pub fn data_dir(&self) -> &Path {
        &self.data_dir
    }
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_record_history() {
        let mut storage = Storage::new();
        // Override with temp dir for test isolation
        let temp_dir = env::temp_dir().join("rusty_browser_test_storage");
        let _ = fs::create_dir_all(&temp_dir);
        storage.data_dir = temp_dir.clone();
        storage.file_path = temp_dir.join("test_data.json");
        let _ = fs::remove_file(&storage.file_path);

        storage.record_history("https://wikipedia.org", "Wikipedia");
        storage.record_history("https://github.com", "GitHub");

        let recent = storage.recent_history(10);
        assert_eq!(recent.len(), 2);
        assert_eq!(recent[0].url, "https://github.com");
        assert_eq!(recent[1].url, "https://wikipedia.org");

        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_record_download() {
        let mut storage = Storage::new();
        let temp_dir = env::temp_dir().join("rusty_browser_test_dl");
        let _ = fs::create_dir_all(&temp_dir);
        storage.data_dir = temp_dir.clone();
        storage.file_path = temp_dir.join("test_dl.json");
        let _ = fs::remove_file(&storage.file_path);

        storage.record_download("https://example.com/file.zip", "file.zip", "C:\\Downloads\\file.zip", true);
        assert_eq!(storage.downloads().len(), 1);
        assert_eq!(storage.downloads()[0].filename, "file.zip");
        assert!(storage.downloads()[0].success);

        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_clear_data_and_settings() {
        let mut storage = Storage::new();
        let temp_dir = env::temp_dir().join("rusty_browser_test_clear");
        let _ = fs::create_dir_all(&temp_dir);
        storage.data_dir = temp_dir.clone();
        storage.file_path = temp_dir.join("test_clear.json");
        let _ = fs::remove_file(&storage.file_path);

        storage.record_history("https://example.com", "Example");
        assert_eq!(storage.recent_history(5).len(), 1);
        storage.clear_history();
        assert_eq!(storage.recent_history(5).len(), 0);

        let mut s = storage.settings().clone();
        s.block_camera = false;
        s.default_zoom = 1.25;
        storage.update_settings(s);
        assert!(!storage.settings().block_camera);
        assert_eq!(storage.settings().default_zoom, 1.25);

        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_resolve_dirs() {
        let data_dir = Storage::resolve_data_dir();
        assert!(!data_dir.as_os_str().is_empty());

        let dl_dir = Storage::resolve_downloads_dir();
        assert!(!dl_dir.as_os_str().is_empty());
    }
}
