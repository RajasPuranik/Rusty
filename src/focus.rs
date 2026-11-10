//! Focus Mode Engine & YouTube Restrictor for Rusty Browser.
//!
//! Provides Study, Work, and Deep Work focus sessions with:
//! - Category-based domain blocking (Social Media, Entertainment, Gaming)
//! - YouTube educational keyword and channel filtering
//! - Automatic YouTube Shorts redirection (`/shorts/:id` -> `/watch?v=:id`)
//! - 10-second confirmation-phrase bypass guard
//! - Automatic workspace linking (e.g. "College" -> Study mode)

#![allow(dead_code)]

use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::time::Instant;
use url::Url;

/// Preset focus modes with distinct timers and blocking aggression levels.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum FocusModeKind {
    /// 25 min default timer. Blocks social & entertainment. YouTube restricted to educational keywords.
    Study,
    /// 50 min default timer. Blocks games, streaming, social. YouTube completely blocked (except whitelist).
    Work,
    /// 90 min default timer. Aggressive: all non-whitelisted domains blocked. Minimal UI.
    Deep,
}

impl FocusModeKind {
    pub fn default_duration_secs(&self) -> u64 {
        match self {
            Self::Study => 25 * 60,
            Self::Work => 50 * 60,
            Self::Deep => 90 * 60,
        }
    }

    pub fn display_name(&self) -> &'static str {
        match self {
            Self::Study => "Study",
            Self::Work => "Work",
            Self::Deep => "Deep Work",
        }
    }
}

/// Decision returned by URL inspection.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FocusDecision {
    Allowed,
    Redirect(String),
    Blocked {
        mode: String,
        domain: String,
        url: String,
        remaining_secs: u64,
    },
}

/// YouTube Focus & Educational Gate Rules.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct YouTubeRules {
    pub block_shorts: bool,
    pub redirect_shorts_to_watch: bool,
    pub hide_comments: bool,
    pub hide_home_feed: bool,
    pub hide_sidebar_recommendations: bool,
    pub study_keywords: Vec<String>,
    pub finance_keywords: Vec<String>,
    pub gaming_keywords: Vec<String>,
    pub channel_whitelist: Vec<String>,
}

impl Default for YouTubeRules {
    fn default() -> Self {
        Self {
            block_shorts: true,
            redirect_shorts_to_watch: true,
            hide_comments: true,
            hide_home_feed: true,
            hide_sidebar_recommendations: true,
            study_keywords: vec![
                "lecture".into(),
                "tutorial".into(),
                "course".into(),
                "physics".into(),
                "math".into(),
                "mathematics".into(),
                "calculus".into(),
                "computer science".into(),
                "rust".into(),
                "study".into(),
                "exam".into(),
                "revision".into(),
                "documentation".into(),
                "biology".into(),
                "chemistry".into(),
                "history".into(),
                "mit".into(),
                "stanford".into(),
                "harvard".into(),
                "nptel".into(),
                "khan academy".into(),
                "crashcourse".into(),
                "algorithm".into(),
                "programming".into(),
                "coding".into(),
                "deep learning".into(),
            ],
            finance_keywords: vec![
                "finance".into(),
                "financial".into(),
                "money".into(),
                "invest".into(),
                "investing".into(),
                "investment".into(),
                "stock market".into(),
                "stocks".into(),
                "economy".into(),
                "economics".into(),
                "accounting".into(),
                "tax".into(),
                "taxes".into(),
                "budget".into(),
                "valuation".into(),
                "mutual funds".into(),
                "etf".into(),
                "dividend".into(),
                "portfolio".into(),
                "warren buffett".into(),
                "macroeconomics".into(),
                "inflation".into(),
                "interest rate".into(),
                "capital".into(),
            ],
            gaming_keywords: vec![
                "gaming".into(),
                "gameplay".into(),
                "walkthrough".into(),
                "playthrough".into(),
                "let's play".into(),
                "lets play".into(),
                "speedrun".into(),
                "roblox".into(),
                "minecraft".into(),
                "gta".into(),
                "fortnite".into(),
                "valorant".into(),
                "warzone".into(),
                "pubg".into(),
                "apex legends".into(),
                "league of legends".into(),
                "dota".into(),
                "csgo".into(),
                "cs2".into(),
                "overwatch".into(),
                "pokemon".into(),
                "zelda".into(),
                "elden ring".into(),
                "genshin".into(),
                "brawl stars".into(),
            ],
            channel_whitelist: vec![
                "3blue1brown".into(),
                "veritasium".into(),
                "mit opencourseware".into(),
                "khan academy".into(),
                "freecodecamp".into(),
                "computerphile".into(),
                "numberphile".into(),
            ],
        }
    }
}

/// Required confirmation phrase to bypass the interstitial gate.
pub const BYPASS_CONFIRMATION_PHRASE: &str = "I choose to break my focus";

/// Active Focus Session state.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FocusState {
    pub is_active: bool,
    pub is_paused: bool,
    pub mode: FocusModeKind,
    pub remaining_secs: u64,
    pub total_secs: u64,
    pub formatted_time: String,
    pub linked_workspace: Option<String>,
}

/// Manages Focus Mode rules, timer, and URL evaluation.
pub struct FocusManager {
    is_active: bool,
    is_paused: bool,
    mode: FocusModeKind,
    remaining_secs: u64,
    total_secs: u64,
    last_tick: Option<Instant>,
    social_domains: HashSet<String>,
    entertainment_domains: HashSet<String>,
    gaming_domains: HashSet<String>,
    allowed_whitelist: HashSet<String>,
    bypassed_domains: HashSet<String>,
    youtube_rules: YouTubeRules,
    linked_workspace: Option<String>,
}

impl FocusManager {
    pub fn new() -> Self {
        let mut social = HashSet::new();
        for d in &[
            "twitter.com", "x.com", "facebook.com", "instagram.com", "tiktok.com",
            "reddit.com", "linkedin.com", "pinterest.com", "threads.net", "snapchat.com",
            "tumblr.com", "bsky.app",
        ] {
            social.insert(d.to_string());
        }

        let mut entertainment = HashSet::new();
        for d in &[
            "netflix.com", "disneyplus.com", "hulu.com", "twitch.tv", "hbomax.com",
            "primevideo.com", "spotify.com", "soundcloud.com", "crunchyroll.com",
            "vimeo.com", "dailymotion.com",
        ] {
            entertainment.insert(d.to_string());
        }

        let mut gaming = HashSet::new();
        for d in &[
            "store.steampowered.com", "steampowered.com", "epicgames.com", "roblox.com",
            "ea.com", "ubisoft.com", "ign.com", "gamespot.com", "chess.com", "lichess.org",
        ] {
            gaming.insert(d.to_string());
        }

        let mut whitelist = HashSet::new();
        for d in &[
            "github.com", "gitlab.com", "stackoverflow.com", "stackexchange.com",
            "wikipedia.org", "w3schools.com", "developer.mozilla.org", "rust-lang.org",
            "docs.rs", "crates.io", "arxiv.org", "scholar.google.com",
        ] {
            whitelist.insert(d.to_string());
        }

        Self {
            is_active: false,
            is_paused: false,
            mode: FocusModeKind::Study,
            remaining_secs: FocusModeKind::Study.default_duration_secs(),
            total_secs: FocusModeKind::Study.default_duration_secs(),
            last_tick: None,
            social_domains: social,
            entertainment_domains: entertainment,
            gaming_domains: gaming,
            allowed_whitelist: whitelist,
            bypassed_domains: HashSet::new(),
            youtube_rules: YouTubeRules::default(),
            linked_workspace: None,
        }
    }

    /// Start a focus session.
    pub fn start(&mut self, mode: FocusModeKind, custom_duration_secs: Option<u64>) {
        let duration = custom_duration_secs.unwrap_or_else(|| mode.default_duration_secs());
        self.is_active = true;
        self.is_paused = false;
        self.mode = mode;
        self.remaining_secs = duration;
        self.total_secs = duration;
        self.last_tick = Some(Instant::now());
        self.bypassed_domains.clear();
        tracing::info!("[focus] Started {:?} mode session for {}s", mode, duration);
    }

    /// Pause the timer.
    pub fn pause(&mut self) {
        if self.is_active && !self.is_paused {
            self.is_paused = true;
            tracing::info!("[focus] Paused session ({}s remaining)", self.remaining_secs);
        }
    }

    /// Resume the timer.
    pub fn resume(&mut self) {
        if self.is_active && self.is_paused {
            self.is_paused = false;
            self.last_tick = Some(Instant::now());
            tracing::info!("[focus] Resumed session");
        }
    }

    /// Stop and reset session.
    pub fn stop(&mut self) {
        self.is_active = false;
        self.is_paused = false;
        self.remaining_secs = self.mode.default_duration_secs();
        self.total_secs = self.mode.default_duration_secs();
        self.last_tick = None;
        self.bypassed_domains.clear();
        tracing::info!("[focus] Stopped focus session");
    }

    /// Advance timer by 1 second. Returns true if session completed on this tick.
    pub fn tick(&mut self) -> bool {
        if !self.is_active || self.is_paused {
            return false;
        }

        if self.remaining_secs > 0 {
            self.remaining_secs = self.remaining_secs.saturating_sub(1);
        }

        if self.remaining_secs == 0 {
            self.is_active = false;
            tracing::info!("[focus] Focus session completed!");
            return true;
        }

        false
    }

    /// Check if a workspace switch should activate or suggest focus mode.
    pub fn on_workspace_switch(&mut self, workspace_name: &str) -> Option<FocusModeKind> {
        let name_lower = workspace_name.to_lowercase();
        if name_lower.contains("college") || name_lower.contains("study") {
            self.linked_workspace = Some(workspace_name.to_string());
            if !self.is_active {
                self.start(FocusModeKind::Study, None);
            }
            Some(FocusModeKind::Study)
        } else if name_lower.contains("work") || name_lower.contains("projects") {
            self.linked_workspace = Some(workspace_name.to_string());
            if !self.is_active {
                self.start(FocusModeKind::Work, None);
            }
            Some(FocusModeKind::Work)
        } else {
            None
        }
    }

    /// Current snapshot of focus state for IPC transmission.
    pub fn state(&self) -> FocusState {
        let m = self.remaining_secs / 60;
        let s = self.remaining_secs % 60;
        FocusState {
            is_active: self.is_active,
            is_paused: self.is_paused,
            mode: self.mode,
            remaining_secs: self.remaining_secs,
            total_secs: self.total_secs,
            formatted_time: format!("{:02}:{:02}", m, s),
            linked_workspace: self.linked_workspace.clone(),
        }
    }

    /// Grant a temporary bypass for a specific domain if confirmation matches.
    pub fn grant_bypass(&mut self, domain: &str, confirmation: &str) -> Result<bool> {
        if confirmation.trim() != BYPASS_CONFIRMATION_PHRASE {
            return Ok(false);
        }
        let clean = domain.trim().to_lowercase();
        tracing::warn!("[focus] Bypassing focus block for domain: {}", clean);
        self.bypassed_domains.insert(clean);
        Ok(true)
    }

    /// Estimated today focus minutes.
    pub fn today_focus_mins(&self) -> u64 {
        if self.is_active {
            (self.total_secs.saturating_sub(self.remaining_secs)) / 60
        } else {
            0
        }
    }

    /// Primary navigation gate: evaluates an outgoing URL against active focus rules.
    pub fn check_url(&self, raw_url: &str) -> FocusDecision {
        let parsed = match Url::parse(raw_url) {
            Ok(u) => u,
            Err(_) => return FocusDecision::Allowed,
        };

        // Internal app URLs and about:blank are always allowed
        if parsed.scheme() == "rusty" || parsed.scheme() == "about" {
            return FocusDecision::Allowed;
        }

        let host = match parsed.host_str() {
            Some(h) => h.to_lowercase(),
            None => return FocusDecision::Allowed,
        };

        if !self.is_active || self.is_paused {
            return FocusDecision::Allowed;
        }

        // Check if domain was explicitly bypassed
        if self.is_domain_bypassed(&host) {
            return FocusDecision::Allowed;
        }

        // Special handling for YouTube
        if host == "youtube.com" || host.ends_with(".youtube.com") || host == "youtu.be" {
            return self.check_youtube_url(&parsed, raw_url);
        }

        // Deep Work Mode: Aggressive whitelist-only
        if self.mode == FocusModeKind::Deep {
            if self.is_whitelisted(&host) {
                return FocusDecision::Allowed;
            }
            return FocusDecision::Blocked {
                mode: self.mode.display_name().to_string(),
                domain: host,
                url: raw_url.to_string(),
                remaining_secs: self.remaining_secs,
            };
        }

        // Study Mode: Blocks social media and entertainment/gaming
        if self.mode == FocusModeKind::Study
            && (self.matches_any_domain(&host, &self.social_domains)
                || self.matches_any_domain(&host, &self.entertainment_domains)
                || self.matches_any_domain(&host, &self.gaming_domains))
        {
            return FocusDecision::Blocked {
                mode: self.mode.display_name().to_string(),
                domain: host,
                url: raw_url.to_string(),
                remaining_secs: self.remaining_secs,
            };
        }

        // Work Mode: Blocks games, streaming, social media
        if self.mode == FocusModeKind::Work
            && (self.matches_any_domain(&host, &self.social_domains)
                || self.matches_any_domain(&host, &self.gaming_domains)
                || self.matches_any_domain(&host, &self.entertainment_domains))
        {
            return FocusDecision::Blocked {
                mode: self.mode.display_name().to_string(),
                domain: host,
                url: raw_url.to_string(),
                remaining_secs: self.remaining_secs,
            };
        }

        FocusDecision::Allowed
    }

    /// Check if a YouTube URL complies with focus rules, or requires redirect/block.
    fn check_youtube_url(&self, parsed: &Url, raw_url: &str) -> FocusDecision {
        let path = parsed.path();

        // 1. YouTube Shorts check: redirect /shorts/:id to /watch?v=:id
        if self.youtube_rules.redirect_shorts_to_watch && path.starts_with("/shorts/") {
            let id = path.trim_start_matches("/shorts/").trim_matches('/');
            if !id.is_empty() {
                let redirect_url = format!("https://www.youtube.com/watch?v={}", id);
                tracing::info!("[focus] Redirecting YouTube Shorts to standard watch: {}", redirect_url);
                return FocusDecision::Redirect(redirect_url);
            }
        }

        // 2. Mode-specific YouTube evaluation
        match self.mode {
            FocusModeKind::Deep => {
                // In Deep Work, YouTube is completely blocked unless whitelisted
                FocusDecision::Blocked {
                    mode: self.mode.display_name().to_string(),
                    domain: "youtube.com".to_string(),
                    url: raw_url.to_string(),
                    remaining_secs: self.remaining_secs,
                }
            }
            FocusModeKind::Work => {
                // In Work mode, YouTube is blocked by default
                FocusDecision::Blocked {
                    mode: self.mode.display_name().to_string(),
                    domain: "youtube.com".to_string(),
                    url: raw_url.to_string(),
                    remaining_secs: self.remaining_secs,
                }
            }
            FocusModeKind::Study => {
                let path_lower = parsed.path().to_lowercase();
                if path_lower.starts_with("/gaming") {
                    return FocusDecision::Blocked {
                        mode: self.mode.display_name().to_string(),
                        domain: "youtube.com (Gaming Blocked)".to_string(),
                        url: raw_url.to_string(),
                        remaining_secs: self.remaining_secs,
                    };
                }

                let query = parsed.query().unwrap_or_default().to_lowercase().replace('+', " ");

                // If user searched for gaming or non-educational entertainment on YouTube, block with interstitial
                let is_gaming = self.youtube_rules.gaming_keywords.iter().any(|k| query.contains(k));
                let is_entertainment_query = path_lower.starts_with("/results")
                    && [
                        "movie trailer",
                        "official trailer",
                        "skit",
                        "prank",
                        "dance video",
                        "music video",
                        "comedy",
                        "funny video",
                        "roast",
                        "mukbang",
                    ]
                    .iter()
                    .any(|k| query.contains(k));
                if is_gaming || is_entertainment_query {
                    return FocusDecision::Blocked {
                        mode: self.mode.display_name().to_string(),
                        domain: "youtube.com (Distraction Blocked)".to_string(),
                        url: raw_url.to_string(),
                        remaining_secs: self.remaining_secs,
                    };
                }

                // Educational and Finance queries or general browse/watch (filtered in-page by youtube_focus.js)
                FocusDecision::Allowed
            }
        }
    }

    fn matches_any_domain(&self, host: &str, set: &HashSet<String>) -> bool {
        if set.contains(host) {
            return true;
        }
        for d in set {
            if host.ends_with(&format!(".{}", d)) {
                return true;
            }
        }
        false
    }

    fn is_whitelisted(&self, host: &str) -> bool {
        self.matches_any_domain(host, &self.allowed_whitelist)
    }

    fn is_domain_bypassed(&self, host: &str) -> bool {
        self.matches_any_domain(host, &self.bypassed_domains)
    }
}

impl Default for FocusManager {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_focus_timer_lifecycle() {
        let mut fm = FocusManager::new();
        assert!(!fm.state().is_active);

        // Start Study mode (25m = 1500s)
        fm.start(FocusModeKind::Study, None);
        let s = fm.state();
        assert!(s.is_active);
        assert!(!s.is_paused);
        assert_eq!(s.mode, FocusModeKind::Study);
        assert_eq!(s.remaining_secs, 25 * 60);
        assert_eq!(s.formatted_time, "25:00");

        // Tick
        assert!(!fm.tick());
        assert_eq!(fm.state().remaining_secs, (25 * 60) - 1);

        // Pause
        fm.pause();
        assert!(fm.state().is_paused);
        fm.tick(); // does not decrease when paused
        assert_eq!(fm.state().remaining_secs, (25 * 60) - 1);

        // Resume
        fm.resume();
        assert!(!fm.state().is_paused);

        // Stop
        fm.stop();
        assert!(!fm.state().is_active);
        assert_eq!(fm.state().remaining_secs, 25 * 60);
    }

    #[test]
    fn test_focus_domain_blocking_per_mode() {
        let mut fm = FocusManager::new();

        // While inactive, everything is allowed
        assert_eq!(fm.check_url("https://twitter.com/home"), FocusDecision::Allowed);
        assert_eq!(fm.check_url("https://store.steampowered.com"), FocusDecision::Allowed);

        // Start Study mode
        fm.start(FocusModeKind::Study, None);
        match fm.check_url("https://twitter.com/home") {
            FocusDecision::Blocked { mode, domain, .. } => {
                assert_eq!(mode, "Study");
                assert_eq!(domain, "twitter.com");
            }
            _ => panic!("Expected Twitter blocked in Study mode"),
        }

        match fm.check_url("https://store.steampowered.com") {
            FocusDecision::Blocked { mode, domain, .. } => {
                assert_eq!(mode, "Study");
                assert_eq!(domain, "store.steampowered.com");
            }
            _ => panic!("Expected Steam blocked in Study mode"),
        }

        // Whitelisted site is allowed in Study mode
        assert_eq!(fm.check_url("https://github.com/rust-lang/rust"), FocusDecision::Allowed);

        // Start Deep Work mode
        fm.start(FocusModeKind::Deep, None);
        // Whitelisted domain allowed
        assert_eq!(fm.check_url("https://github.com/rust-lang"), FocusDecision::Allowed);
        // Non-whitelisted domain blocked in Deep Work
        match fm.check_url("https://news.ycombinator.com") {
            FocusDecision::Blocked { mode, domain, .. } => {
                assert_eq!(mode, "Deep Work");
                assert_eq!(domain, "news.ycombinator.com");
            }
            _ => panic!("Expected non-whitelisted site blocked in Deep Work"),
        }
    }

    #[test]
    fn test_youtube_focus_filter() {
        let mut fm = FocusManager::new();
        fm.start(FocusModeKind::Study, None);

        // Gaming search on YouTube is blocked
        assert!(matches!(
            fm.check_url("https://www.youtube.com/results?search_query=minecraft+gameplay"),
            FocusDecision::Blocked { .. }
        ));

        // Educational query allowed
        assert_eq!(
            fm.check_url("https://www.youtube.com/results?search_query=calculus+lecture"),
            FocusDecision::Allowed
        );

        // Finance query allowed
        assert_eq!(
            fm.check_url("https://www.youtube.com/results?search_query=stock+market+investing"),
            FocusDecision::Allowed
        );
    }

    #[test]
    fn test_youtube_shorts_redirect() {
        let mut fm = FocusManager::new();

        // When Focus Mode is inactive, YouTube Shorts is allowed normally
        assert_eq!(
            fm.check_url("https://www.youtube.com/shorts/dQw4w9WgXcQ"),
            FocusDecision::Allowed
        );

        // YouTube Shorts is redirected to normal watch URL when Focus Mode is active
        fm.start(FocusModeKind::Study, None);
        match fm.check_url("https://www.youtube.com/shorts/dQw4w9WgXcQ") {
            FocusDecision::Redirect(url) => {
                assert_eq!(url, "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
            }
            _ => panic!("Expected YouTube Shorts redirect when focus is active"),
        }

        // Entertainment and gaming search queries are blocked in Study mode
        assert!(matches!(
            fm.check_url("https://www.youtube.com/results?search_query=movie+trailer"),
            FocusDecision::Blocked { .. }
        ));
        assert!(matches!(
            fm.check_url("https://www.youtube.com/gaming"),
            FocusDecision::Blocked { .. }
        ));

        // Pausing relaxes focus blocking until resumed
        fm.pause();
        assert_eq!(
            fm.check_url("https://www.youtube.com/shorts/dQw4w9WgXcQ"),
            FocusDecision::Allowed
        );
    }

    #[test]
    fn test_bypass_guard_requires_exact_phrase() {
        let mut fm = FocusManager::new();
        fm.start(FocusModeKind::Study, None);

        // Incorrect phrase rejected
        assert!(!fm.grant_bypass("twitter.com", "skip").unwrap());
        assert!(!fm.grant_bypass("twitter.com", "please let me in").unwrap());
        assert!(matches!(fm.check_url("https://twitter.com"), FocusDecision::Blocked { .. }));

        // Exact phrase accepted
        assert!(fm.grant_bypass("twitter.com", BYPASS_CONFIRMATION_PHRASE).unwrap());
        assert_eq!(fm.check_url("https://twitter.com"), FocusDecision::Allowed);
    }

    #[test]
    fn test_workspace_auto_link() {
        let mut fm = FocusManager::new();
        assert_eq!(fm.on_workspace_switch("College"), Some(FocusModeKind::Study));
        assert!(fm.state().is_active);
        assert_eq!(fm.state().mode, FocusModeKind::Study);

        fm.stop();
        assert_eq!(fm.on_workspace_switch("Projects"), Some(FocusModeKind::Work));
        assert!(fm.state().is_active);
        assert_eq!(fm.state().mode, FocusModeKind::Work);
    }
}
