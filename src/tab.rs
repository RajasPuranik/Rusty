//! Tab management — tracks open tabs, their URLs, titles, webview state,
//! lazy creation, and inactivity-based discarding.
//!
//! Each tab has:
//! - A unique `TabId` (monotonically increasing `u32`)
//! - URL, title, and saved scroll position
//! - Inactivity tracker (`last_active: Instant`)
//! - Discarded state flag (`is_discarded`)
//! - Lazy webview lifecycle (only created when active, dropped on discard)

use serde::Serialize;
use std::time::{Duration, Instant};

/// Unique identifier for a tab. Cheap to copy.
pub type TabId = u32;

/// Metadata for a single tab (serializable for IPC to toolbar).
#[derive(Debug, Clone, Serialize)]
pub struct TabInfo {
    pub id: TabId,
    pub title: String,
    pub url: String,
    pub is_discarded: bool,
}

/// Internal state for a tab.
pub struct Tab {
    pub id: TabId,
    pub url: String,
    pub title: String,
    /// Whether this tab currently has a live, allocated `WebView`.
    pub has_webview: bool,
    /// Whether this tab has been discarded from RAM due to inactivity.
    pub is_discarded: bool,
    /// When the tab was last viewed or interacted with.
    pub last_active: Instant,
    /// Saved vertical scroll position restored when waking a discarded tab.
    pub scroll_y: f64,
}

impl Tab {
    pub fn new(id: TabId, url: String) -> Self {
        Self {
            id,
            title: "New Tab".to_owned(),
            url,
            has_webview: false,
            is_discarded: false,
            last_active: Instant::now(),
            scroll_y: 0.0,
        }
    }

    pub fn info(&self) -> TabInfo {
        TabInfo {
            id: self.id,
            title: self.title.clone(),
            url: self.url.clone(),
            is_discarded: self.is_discarded,
        }
    }
}

/// Manages the collection of open tabs.
pub struct TabManager {
    tabs: Vec<Tab>,
    active: Option<TabId>,
    next_id: TabId,
}

impl TabManager {
    pub fn new() -> Self {
        Self {
            tabs: Vec::new(),
            active: None,
            next_id: 1,
        }
    }

    /// Create a new tab with the given URL. Returns its ID.
    /// Notice: Webview is NOT created here — it is created lazily on first show.
    pub fn create_tab(&mut self, url: String) -> TabId {
        let id = self.next_id;
        self.next_id += 1;
        self.tabs.push(Tab::new(id, url));
        if self.active.is_none() {
            self.active = Some(id);
        }
        id
    }

    /// Switch to the tab with the given ID.
    /// Updates the tab's `last_active` timestamp.
    pub fn switch_to(&mut self, id: TabId) -> bool {
        if let Some(pos) = self.tabs.iter().position(|t| t.id == id) {
            self.active = Some(id);
            self.tabs[pos].last_active = Instant::now();
            true
        } else {
            false
        }
    }

    /// Close a tab. Returns the ID of the tab to switch to (if any).
    pub fn close_tab(&mut self, id: TabId) -> Option<TabId> {
        let pos = self.tabs.iter().position(|t| t.id == id)?;
        self.tabs.remove(pos);

        if self.tabs.is_empty() {
            self.active = None;
            return None;
        }

        // If we closed the active tab, switch to the nearest one
        if self.active == Some(id) {
            let new_pos = pos.min(self.tabs.len() - 1);
            let new_id = self.tabs[new_pos].id;
            self.active = Some(new_id);
            if let Some(tab) = self.tabs.get_mut(new_pos) {
                tab.last_active = Instant::now();
            }
            Some(new_id)
        } else {
            self.active
        }
    }

    /// Return tab IDs that are eligible for discarding:
    /// - Must NOT be the currently active tab
    /// - Must currently have a live webview (`has_webview == true`)
    /// - Inactive duration must meet or exceed `threshold`
    pub fn tabs_to_discard(&self, threshold: Duration) -> Vec<TabId> {
        self.tabs
            .iter()
            .filter(|t| {
                Some(t.id) != self.active
                    && t.has_webview
                    && t.last_active.elapsed() >= threshold
            })
            .map(|t| t.id)
            .collect()
    }

    /// Mark a tab as discarded and preserve its scroll position.
    pub fn mark_discarded(&mut self, id: TabId, scroll_y: f64) {
        if let Some(tab) = self.get_mut(id) {
            tab.has_webview = false;
            tab.is_discarded = true;
            tab.scroll_y = scroll_y;
        }
    }

    /// Mark a tab as restored with an active webview.
    pub fn mark_restored(&mut self, id: TabId) {
        if let Some(tab) = self.get_mut(id) {
            tab.has_webview = true;
            tab.is_discarded = false;
            tab.last_active = Instant::now();
        }
    }

    /// Update the saved scroll position for a tab.
    pub fn update_scroll(&mut self, id: TabId, scroll_y: f64) {
        if let Some(tab) = self.get_mut(id) {
            tab.scroll_y = scroll_y;
        }
    }

    /// Get the active tab ID.
    pub fn active_id(&self) -> Option<TabId> {
        self.active
    }

    /// Get mutable reference to a tab by ID.
    pub fn get_mut(&mut self, id: TabId) -> Option<&mut Tab> {
        self.tabs.iter_mut().find(|t| t.id == id)
    }

    /// Get reference to a tab by ID.
    pub fn get(&self, id: TabId) -> Option<&Tab> {
        self.tabs.iter().find(|t| t.id == id)
    }

    /// Get reference to the active tab.
    pub fn active_tab(&self) -> Option<&Tab> {
        self.active.and_then(|id| self.get(id))
    }

    /// Get info for all tabs (for toolbar rendering).
    pub fn all_info(&self) -> Vec<TabInfo> {
        self.tabs.iter().map(|t| t.info()).collect()
    }

    /// Number of open tabs.
    #[allow(dead_code)]
    pub fn count(&self) -> usize {
        self.tabs.len()
    }

    /// Switch to next tab (wraps around).
    pub fn next_tab(&mut self) {
        if self.tabs.len() <= 1 {
            return;
        }
        if let Some(active) = self.active {
            let pos = self.tabs.iter().position(|t| t.id == active).unwrap_or(0);
            let next = (pos + 1) % self.tabs.len();
            self.active = Some(self.tabs[next].id);
            self.tabs[next].last_active = Instant::now();
        }
    }

    /// Switch to previous tab (wraps around).
    pub fn prev_tab(&mut self) {
        if self.tabs.len() <= 1 {
            return;
        }
        if let Some(active) = self.active {
            let pos = self.tabs.iter().position(|t| t.id == active).unwrap_or(0);
            let prev = if pos == 0 { self.tabs.len() - 1 } else { pos - 1 };
            self.active = Some(self.tabs[prev].id);
            self.tabs[prev].last_active = Instant::now();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn create_and_switch() {
        let mut mgr = TabManager::new();
        let t1 = mgr.create_tab("https://a.com".into());
        let t2 = mgr.create_tab("https://b.com".into());
        assert_eq!(mgr.active_id(), Some(t1));
        mgr.switch_to(t2);
        assert_eq!(mgr.active_id(), Some(t2));
    }

    #[test]
    fn lazy_tab_creation_state() {
        let mut mgr = TabManager::new();
        let id = mgr.create_tab("https://example.com".into());
        let tab = mgr.get(id).unwrap();
        // Webviews are NOT created upon tab creation (lazy loading)
        assert!(!tab.has_webview);
        assert!(!tab.is_discarded);
        assert_eq!(tab.scroll_y, 0.0);
    }

    #[test]
    fn close_active_switches() {
        let mut mgr = TabManager::new();
        let t1 = mgr.create_tab("https://a.com".into());
        let t2 = mgr.create_tab("https://b.com".into());
        mgr.switch_to(t2);
        let next = mgr.close_tab(t2);
        assert_eq!(next, Some(t1));
        assert_eq!(mgr.active_id(), Some(t1));
    }

    #[test]
    fn close_last_tab() {
        let mut mgr = TabManager::new();
        let t1 = mgr.create_tab("https://a.com".into());
        let next = mgr.close_tab(t1);
        assert_eq!(next, None);
        assert_eq!(mgr.count(), 0);
    }

    #[test]
    fn next_prev_tab() {
        let mut mgr = TabManager::new();
        let t1 = mgr.create_tab("https://a.com".into());
        let t2 = mgr.create_tab("https://b.com".into());
        let t3 = mgr.create_tab("https://c.com".into());
        mgr.switch_to(t1);

        mgr.next_tab();
        assert_eq!(mgr.active_id(), Some(t2));
        mgr.next_tab();
        assert_eq!(mgr.active_id(), Some(t3));
        mgr.next_tab(); // wraps
        assert_eq!(mgr.active_id(), Some(t1));

        mgr.prev_tab(); // wraps back
        assert_eq!(mgr.active_id(), Some(t3));
    }

    #[test]
    fn tab_discarding_and_restoration() {
        let mut mgr = TabManager::new();
        let t1 = mgr.create_tab("https://a.com".into());
        let t2 = mgr.create_tab("https://b.com".into());

        // Mark t1 as having an active webview
        mgr.mark_restored(t1);
        // Active tab is t1; switch to t2
        mgr.switch_to(t2);
        mgr.mark_restored(t2);

        // Active tab is t2. t1 is in the background.
        // With Duration::ZERO, t1 should be eligible for discard because it has a webview
        let to_discard = mgr.tabs_to_discard(Duration::ZERO);
        assert!(to_discard.contains(&t1));
        // t2 is ACTIVE so it should NEVER be discarded
        assert!(!to_discard.contains(&t2));

        // Discard t1 and save its scroll position
        mgr.mark_discarded(t1, 1250.5);
        let tab1 = mgr.get(t1).unwrap();
        assert!(!tab1.has_webview);
        assert!(tab1.is_discarded);
        assert_eq!(tab1.scroll_y, 1250.5);

        // After discarding, t1 is no longer eligible for discard
        let to_discard2 = mgr.tabs_to_discard(Duration::ZERO);
        assert!(!to_discard2.contains(&t1));

        // Restore t1
        mgr.mark_restored(t1);
        let tab1_restored = mgr.get(t1).unwrap();
        assert!(tab1_restored.has_webview);
        assert!(!tab1_restored.is_discarded);
        // Scroll position was preserved!
        assert_eq!(tab1_restored.scroll_y, 1250.5);
    }

    #[test]
    fn scroll_update() {
        let mut mgr = TabManager::new();
        let id = mgr.create_tab("https://a.com".into());
        mgr.update_scroll(id, 450.0);
        assert_eq!(mgr.get(id).unwrap().scroll_y, 450.0);
    }

    #[test]
    fn all_info_includes_discarded() {
        let mut mgr = TabManager::new();
        let _t1 = mgr.create_tab("https://a.com".into());
        let t2 = mgr.create_tab("https://b.com".into());
        mgr.mark_discarded(t2, 0.0);

        let info = mgr.all_info();
        assert_eq!(info.len(), 2);
        assert!(!info[0].is_discarded);
        assert!(info[1].is_discarded);
    }
}
