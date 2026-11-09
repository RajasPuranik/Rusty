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
fn default_search_template() -> String {
    "https://www.google.com/search?q=%s".to_owned()
}
fn default_discard() -> u64 {
    600
}
fn default_zoom() -> f64 {
    1.0
}
fn default_skin() -> String {
    "crazy".to_owned()
}
fn default_theme() -> String {
    "sunset".to_owned()
}
fn default_accent() -> String {
    "#f97316".to_owned()
}
fn default_tabs_layout() -> String {
    "horizontal".to_owned()
}
fn default_density() -> String {
    "normal".to_owned()
}
fn default_search_id() -> String {
    "google".to_owned()
}
fn default_effects_intensity() -> u8 {
    80
}
fn default_pet_name() -> String {
    "Pixel".to_owned()
}
fn default_pet_color() -> String {
    "#f97316".to_owned()
}
fn default_pet_accessory() -> String {
    "none".to_owned()
}
fn default_pet_mood() -> String {
    "content".to_owned()
}

fn is_valid_hex_color(s: &str) -> bool {
    s.len() == 7 && s.starts_with('#') && s[1..].bytes().all(|b| b.is_ascii_hexdigit())
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CustomEngine {
    pub id: String,
    pub name: String,
    pub template: String,
    pub color: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorldClockCity {
    #[serde(default)]
    pub id: String,
    #[serde(default, alias = "city")]
    pub name: String,
    #[serde(default, alias = "tz")]
    pub timezone: String,
}

pub fn search_template_for_id(id: &str) -> String {
    match id {
        "yahoo" => "https://search.yahoo.com/search?p=%s",
        "duckduckgo" => "https://duckduckgo.com/?q=%s",
        "bing" => "https://www.bing.com/search?q=%s",
        "brave" => "https://search.brave.com/search?q=%s",
        "youtube" => "https://www.youtube.com/results?search_query=%s",
        "github" => "https://github.com/search?q=%s",
        _ => "https://www.google.com/search?q=%s",
    }
    .to_owned()
}

pub fn resolve_search_template(id: &str, custom_engines: &[CustomEngine]) -> String {
    if let Some(custom) = custom_engines.iter().find(|e| e.id == id && e.template.contains("%s")) {
        return custom.template.clone();
    }
    search_template_for_id(id)
}

/// Browser user settings (persisted in `data.json` & synchronized with UI `localStorage`).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Settings {
    #[serde(default = "default_search_template")]
    pub default_search_template: String,
    #[serde(default = "default_discard", alias = "memory_saver_timeout_secs")]
    pub discard_timeout_secs: u64,
    #[serde(default = "default_zoom")]
    pub default_zoom: f64,
    #[serde(default = "default_true")]
    pub block_camera: bool,
    #[serde(default = "default_true")]
    pub block_microphone: bool,
    #[serde(default = "default_true")]
    pub block_geolocation: bool,

    // UI & Skin state
    #[serde(default = "default_skin")]
    pub skin: String,
    #[serde(default = "default_theme")]
    pub theme: String,
    #[serde(default = "default_accent")]
    pub custom_accent: String,
    #[serde(default)]
    pub use_custom_accent: bool,
    #[serde(default = "default_tabs_layout")]
    pub tabs_layout: String,
    #[serde(default)]
    pub vertical_collapsed: bool,
    #[serde(default = "default_density")]
    pub density: String,
    #[serde(default = "default_search_id")]
    pub default_search: String,
    #[serde(default = "default_true")]
    pub omnibox_engine_outline: bool,
    #[serde(default)]
    pub custom_engines: Vec<CustomEngine>,
    #[serde(default = "default_effects_intensity")]
    pub effects_intensity: u8,
    #[serde(default = "default_true")]
    pub fx_glow: bool,
    #[serde(default = "default_true")]
    pub fx_tilt: bool,
    #[serde(default = "default_true")]
    pub fx_magnetic: bool,
    #[serde(default = "default_true")]
    pub fx_ripple: bool,
    #[serde(default)]
    pub fx_trail: bool,
    #[serde(default = "default_true")]
    pub fx_confetti: bool,
    #[serde(default = "default_true")]
    pub fx_canvas_bg: bool,
    #[serde(default = "default_true")]
    pub show_memory_badge: bool,
    #[serde(default = "default_true")]
    pub open_tabs_in_background: bool,
    #[serde(default = "default_true")]
    pub ntp_show_clock: bool,
    #[serde(default = "default_true")]
    pub ntp_show_greeting: bool,
    #[serde(default = "default_true")]
    pub ntp_show_speed_dial: bool,
    #[serde(default = "default_true")]
    pub ntp_show_notes: bool,
    #[serde(default = "default_true")]
    pub ntp_show_weather: bool,
    #[serde(default)]
    pub weather_location: String,
    #[serde(default)]
    pub world_clocks: Vec<WorldClockCity>,
    #[serde(default)]
    pub ntp_globe_clouds: bool,

    // Crazy-skin companion pet state
    #[serde(default)]
    pub pet_type: String,
    #[serde(default = "default_pet_name")]
    pub pet_name: String,
    #[serde(default = "default_pet_color")]
    pub pet_color: String,
    #[serde(default = "default_pet_accessory")]
    pub pet_accessory: String,
    #[serde(default = "default_pet_mood")]
    pub pet_mood: String,
    #[serde(default)]
    pub pet_roam: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            default_search_template: default_search_template(),
            discard_timeout_secs: default_discard(),
            default_zoom: default_zoom(),
            block_camera: true,
            block_microphone: true,
            block_geolocation: true,
            skin: default_skin(),
            theme: default_theme(),
            custom_accent: default_accent(),
            use_custom_accent: false,
            tabs_layout: default_tabs_layout(),
            vertical_collapsed: false,
            density: default_density(),
            default_search: default_search_id(),
            omnibox_engine_outline: true,
            custom_engines: Vec::new(),
            effects_intensity: default_effects_intensity(),
            fx_glow: true,
            fx_tilt: true,
            fx_magnetic: true,
            fx_ripple: true,
            fx_trail: false,
            fx_confetti: true,
            fx_canvas_bg: true,
            show_memory_badge: true,
            open_tabs_in_background: true,
            ntp_show_clock: true,
            ntp_show_greeting: true,
            ntp_show_speed_dial: true,
            ntp_show_notes: true,
            ntp_show_weather: true,
            weather_location: String::new(),
            world_clocks: Vec::new(),
            ntp_globe_clouds: false,
            pet_type: String::new(),
            pet_name: default_pet_name(),
            pet_color: default_pet_color(),
            pet_accessory: default_pet_accessory(),
            pet_mood: default_pet_mood(),
            pet_roam: false,
        }
    }
}

impl Settings {
    /// Apply a single key/value update from the UI IPC channel.
    pub fn apply_setting(&mut self, key: &str, value: &serde_json::Value) -> bool {
        match key {
            "skin" => {
                if let Some(s) = value.as_str() {
                    if s == "minimal" || s == "crazy" {
                        self.skin = s.to_owned();
                        return true;
                    }
                }
            }
            "theme" => {
                if let Some(s) = value.as_str() {
                    self.theme = s.to_owned();
                    return true;
                }
            }
            "custom_accent" => {
                if let Some(s) = value.as_str() {
                    self.custom_accent = s.to_owned();
                    return true;
                }
            }
            "use_custom_accent" => {
                if let Some(b) = value.as_bool() {
                    self.use_custom_accent = b;
                    return true;
                }
            }
            "tabs_layout" => {
                if let Some(s) = value.as_str() {
                    if s == "horizontal" || s == "vertical" {
                        self.tabs_layout = s.to_owned();
                        return true;
                    }
                }
            }
            "vertical_collapsed" => {
                if let Some(b) = value.as_bool() {
                    self.vertical_collapsed = b;
                    return true;
                }
            }
            "density" => {
                if let Some(s) = value.as_str() {
                    self.density = s.to_owned();
                    return true;
                }
            }
            "default_search" => {
                if let Some(s) = value.as_str() {
                    self.default_search = s.to_owned();
                    self.default_search_template = resolve_search_template(s, &self.custom_engines);
                    return true;
                }
            }
            "default_search_template" => {
                if let Some(s) = value.as_str() {
                    self.default_search_template = s.to_owned();
                    return true;
                }
            }
            "omnibox_engine_outline" => {
                if let Some(b) = value.as_bool() {
                    self.omnibox_engine_outline = b;
                    return true;
                }
            }
            "custom_engines" => {
                if let Ok(list) = serde_json::from_value::<Vec<CustomEngine>>(value.clone()) {
                    self.custom_engines = list
                        .into_iter()
                        .filter(|e| !e.id.trim().is_empty() && e.template.contains("%s"))
                        .take(24)
                        .collect();
                    self.default_search_template =
                        resolve_search_template(&self.default_search, &self.custom_engines);
                    return true;
                }
            }
            "world_clocks" => {
                if let Ok(list) = serde_json::from_value::<Vec<WorldClockCity>>(value.clone()) {
                    self.world_clocks = list
                        .into_iter()
                        .filter(|c| !c.name.trim().is_empty() && !c.timezone.trim().is_empty())
                        .take(12)
                        .collect();
                    return true;
                }
            }
            "ntp_globe_clouds" => {
                if let Some(b) = value.as_bool() {
                    self.ntp_globe_clouds = b;
                    return true;
                }
            }
            "effects_intensity" => {
                if let Some(n) = value.as_u64() {
                    self.effects_intensity = n.min(100) as u8;
                    return true;
                }
            }
            "fx_glow" => {
                if let Some(b) = value.as_bool() {
                    self.fx_glow = b;
                    return true;
                }
            }
            "fx_tilt" => {
                if let Some(b) = value.as_bool() {
                    self.fx_tilt = b;
                    return true;
                }
            }
            "fx_magnetic" => {
                if let Some(b) = value.as_bool() {
                    self.fx_magnetic = b;
                    return true;
                }
            }
            "fx_ripple" => {
                if let Some(b) = value.as_bool() {
                    self.fx_ripple = b;
                    return true;
                }
            }
            "fx_trail" => {
                if let Some(b) = value.as_bool() {
                    self.fx_trail = b;
                    return true;
                }
            }
            "fx_confetti" => {
                if let Some(b) = value.as_bool() {
                    self.fx_confetti = b;
                    return true;
                }
            }
            "fx_canvas_bg" => {
                if let Some(b) = value.as_bool() {
                    self.fx_canvas_bg = b;
                    return true;
                }
            }
            "show_memory_badge" => {
                if let Some(b) = value.as_bool() {
                    self.show_memory_badge = b;
                    return true;
                }
            }
            "open_tabs_in_background" => {
                if let Some(b) = value.as_bool() {
                    self.open_tabs_in_background = b;
                    return true;
                }
            }
            "ntp_show_clock" => {
                if let Some(b) = value.as_bool() {
                    self.ntp_show_clock = b;
                    return true;
                }
            }
            "ntp_show_greeting" => {
                if let Some(b) = value.as_bool() {
                    self.ntp_show_greeting = b;
                    return true;
                }
            }
            "ntp_show_speed_dial" => {
                if let Some(b) = value.as_bool() {
                    self.ntp_show_speed_dial = b;
                    return true;
                }
            }
            "ntp_show_notes" => {
                if let Some(b) = value.as_bool() {
                    self.ntp_show_notes = b;
                    return true;
                }
            }
            "ntp_show_weather" => {
                if let Some(b) = value.as_bool() {
                    self.ntp_show_weather = b;
                    return true;
                }
            }
            "weather_location" => {
                if let Some(s) = value.as_str() {
                    self.weather_location = s.trim().to_owned();
                    return true;
                }
            }
            "discard_timeout_secs" | "memory_saver_timeout_secs" => {
                if let Some(n) = value.as_u64() {
                    self.discard_timeout_secs = n;
                    return true;
                }
            }
            "default_zoom" => {
                if let Some(z) = value.as_f64() {
                    self.default_zoom = z.clamp(0.25, 4.0);
                    return true;
                }
            }
            "block_camera" => {
                if let Some(b) = value.as_bool() {
                    self.block_camera = b;
                    return true;
                }
            }
            "block_microphone" => {
                if let Some(b) = value.as_bool() {
                    self.block_microphone = b;
                    return true;
                }
            }
            "block_geolocation" => {
                if let Some(b) = value.as_bool() {
                    self.block_geolocation = b;
                    return true;
                }
            }
            "pet_type" => {
                if let Some(s) = value.as_str() {
                    if matches!(s, "" | "dog" | "cat" | "robot" | "fox" | "slime") {
                        self.pet_type = s.to_owned();
                        return true;
                    }
                }
            }
            "pet_name" => {
                if let Some(s) = value.as_str() {
                    let trimmed: String = s.trim().chars().take(24).collect();
                    self.pet_name = if trimmed.is_empty() {
                        default_pet_name()
                    } else {
                        trimmed
                    };
                    return true;
                }
            }
            "pet_color" => {
                if let Some(s) = value.as_str() {
                    if is_valid_hex_color(s.trim()) {
                        self.pet_color = s.trim().to_ascii_lowercase();
                        return true;
                    }
                }
            }
            "pet_accessory" => {
                if let Some(s) = value.as_str() {
                    if matches!(s, "none" | "collar" | "bow" | "hat" | "glasses") {
                        self.pet_accessory = s.to_owned();
                        return true;
                    }
                }
            }
            "pet_mood" => {
                if let Some(s) = value.as_str() {
                    let clean: String = s.trim().chars().take(20).collect();
                    if !clean.is_empty() && clean.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-') {
                        self.pet_mood = clean;
                        return true;
                    }
                }
            }
            "pet_roam" => {
                if let Some(b) = value.as_bool() {
                    self.pet_roam = b;
                    return true;
                }
            }
            _ => {}
        }
        false
    }

    /// Merge partial JSON object updates without clobbering unspecified fields.
    pub fn merge_json(&mut self, obj: &serde_json::Value) -> bool {
        let Some(map) = obj.as_object() else {
            return false;
        };
        let mut any = false;
        if let Some(ce) = map.get("custom_engines") {
            if self.apply_setting("custom_engines", ce) {
                any = true;
            }
        }
        for (k, v) in map {
            if k == "custom_engines" {
                continue;
            }
            if self.apply_setting(k, v) {
                any = true;
            }
        }
        any
    }

    /// Serialize to a JSON value compatible with the UI `SettingsStore` schema.
    pub fn to_ui_json(&self) -> serde_json::Value {
        serde_json::json!({
            "skin": self.skin,
            "theme": self.theme,
            "custom_accent": self.custom_accent,
            "use_custom_accent": self.use_custom_accent,
            "tabs_layout": self.tabs_layout,
            "vertical_collapsed": self.vertical_collapsed,
            "density": self.density,
            "default_search": self.default_search,
            "omnibox_engine_outline": self.omnibox_engine_outline,
            "custom_engines": self.custom_engines,
            "effects_intensity": self.effects_intensity,
            "fx_glow": self.fx_glow,
            "fx_tilt": self.fx_tilt,
            "fx_magnetic": self.fx_magnetic,
            "fx_ripple": self.fx_ripple,
            "fx_trail": self.fx_trail,
            "fx_confetti": self.fx_confetti,
            "fx_canvas_bg": self.fx_canvas_bg,
            "memory_saver_timeout_secs": self.discard_timeout_secs,
            "show_memory_badge": self.show_memory_badge,
            "open_tabs_in_background": self.open_tabs_in_background,
            "ntp_show_clock": self.ntp_show_clock,
            "ntp_show_greeting": self.ntp_show_greeting,
            "ntp_show_speed_dial": self.ntp_show_speed_dial,
            "ntp_show_notes": self.ntp_show_notes,
            "ntp_show_weather": self.ntp_show_weather,
            "weather_location": self.weather_location,
            "world_clocks": self.world_clocks,
            "ntp_globe_clouds": self.ntp_globe_clouds,
            "pet_type": self.pet_type,
            "pet_name": self.pet_name,
            "pet_color": self.pet_color,
            "pet_accessory": self.pet_accessory,
            "pet_mood": self.pet_mood,
            "pet_roam": self.pet_roam,
        })
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
    #[allow(dead_code)]
    pub fn update_settings(&mut self, settings: Settings) {
        self.ensure_loaded();
        self.data.settings = settings;
        self.save();
    }

    /// Update a single setting key/value and save to disk if valid/changed.
    pub fn set_setting(&mut self, key: &str, value: &serde_json::Value) -> bool {
        self.ensure_loaded();
        let changed = self.data.settings.apply_setting(key, value);
        if changed {
            self.save();
        }
        changed
    }

    /// Merge partial JSON settings map without clobbering existing browser settings.
    pub fn merge_settings_json(&mut self, obj: &serde_json::Value) -> bool {
        self.ensure_loaded();
        let changed = self.data.settings.merge_json(obj);
        if changed {
            self.save();
        }
        changed
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

    #[test]
    fn test_legacy_settings_migration_and_apply_setting() {
        let legacy_json = r#"{
            "history": [],
            "bookmarks": [],
            "downloads": [],
            "settings": {
                "default_search_template": "https://duckduckgo.com/?q=%s",
                "discard_timeout_secs": 900,
                "default_zoom": 1.0,
                "block_camera": true,
                "block_microphone": true,
                "block_geolocation": true
            }
        }"#;
        let mut parsed: StorageData = serde_json::from_str(legacy_json).expect("legacy json");
        assert_eq!(parsed.settings.skin, "crazy");
        assert_eq!(parsed.settings.theme, "sunset");
        assert_eq!(parsed.settings.discard_timeout_secs, 900);

        assert!(parsed.settings.apply_setting("skin", &serde_json::json!("minimal")));
        assert_eq!(parsed.settings.skin, "minimal");
        assert!(!parsed.settings.apply_setting("skin", &serde_json::json!("invalid")));
        assert!(parsed.settings.apply_setting("default_search", &serde_json::json!("github")));
        assert_eq!(parsed.settings.default_search_template, "https://github.com/search?q=%s");
        assert!(parsed.settings.open_tabs_in_background);
        assert!(parsed.settings.apply_setting("open_tabs_in_background", &serde_json::json!(false)));
        assert!(!parsed.settings.open_tabs_in_background);
        assert!(parsed.settings.apply_setting("weather_location", &serde_json::json!("  Mumbai  ")));
        assert_eq!(parsed.settings.weather_location, "Mumbai");
    }

    #[test]
    fn test_yahoo_custom_engines_and_world_clocks() {
        let mut s = Settings::default();
        assert!(s.omnibox_engine_outline);
        assert!(s.apply_setting("default_search", &serde_json::json!("yahoo")));
        assert_eq!(s.default_search_template, "https://search.yahoo.com/search?p=%s");

        assert!(s.merge_json(&serde_json::json!({
            "default_search": "custom_kagi",
            "custom_engines": [
                { "id": "custom_kagi", "name": "Kagi", "template": "https://kagi.com/search?q=%s", "color": "#22c55e" }
            ],
            "omnibox_engine_outline": false,
            "world_clocks": [
                { "id": "tokyo", "name": "Tokyo", "timezone": "Asia/Tokyo" },
                { "city": "London", "tz": "Europe/London" }
            ],
            "ntp_globe_clouds": true
        })));
        assert_eq!(s.default_search_template, "https://kagi.com/search?q=%s");
        assert!(!s.omnibox_engine_outline);
        assert_eq!(s.world_clocks.len(), 2);
        assert_eq!(s.world_clocks[0].timezone, "Asia/Tokyo");
        assert_eq!(s.world_clocks[1].name, "London");
        assert_eq!(s.world_clocks[1].timezone, "Europe/London");
        assert!(s.ntp_globe_clouds);
    }

    #[test]
    fn test_pet_settings_validation_and_persistence() {
        let mut s = Settings::default();
        assert_eq!(s.pet_type, "");
        assert_eq!(s.pet_name, "Pixel");
        assert_eq!(s.pet_color, "#f97316");
        assert_eq!(s.pet_accessory, "none");
        assert_eq!(s.pet_mood, "content");
        assert!(!s.pet_roam);

        assert!(!s.apply_setting("pet_type", &serde_json::json!("pikachu")));
        assert!(!s.apply_setting("pet_accessory", &serde_json::json!("jetpack")));
        assert!(!s.apply_setting("pet_color", &serde_json::json!("not-hex")));

        assert!(s.merge_json(&serde_json::json!({
            "pet_type": "fox",
            "pet_name": "  Sparky  ",
            "pet_color": "#38BDF8",
            "pet_accessory": "glasses",
            "pet_mood": "happy",
            "pet_roam": true
        })));
        assert_eq!(s.pet_type, "fox");
        assert_eq!(s.pet_name, "Sparky");
        assert_eq!(s.pet_color, "#38bdf8");
        assert_eq!(s.pet_accessory, "glasses");
        assert_eq!(s.pet_mood, "happy");
        assert!(s.pet_roam);

        let ui = s.to_ui_json();
        assert_eq!(ui["pet_type"], "fox");
        assert_eq!(ui["pet_name"], "Sparky");
        assert_eq!(ui["pet_roam"], true);

        let temp_dir = env::temp_dir().join("rusty_browser_test_pet");
        let _ = fs::create_dir_all(&temp_dir);
        let mut st = Storage::new();
        st.data_dir = temp_dir.clone();
        st.file_path = temp_dir.join("pet_data.json");
        let _ = fs::remove_file(&st.file_path);
        st.update_settings(s);

        let mut st2 = Storage::new();
        st2.data_dir = temp_dir.clone();
        st2.file_path = temp_dir.join("pet_data.json");
        assert_eq!(st2.settings().pet_type, "fox");
        assert_eq!(st2.settings().pet_accessory, "glasses");
        assert!(st2.settings().pet_roam);
        let _ = fs::remove_dir_all(&temp_dir);
    }
}
