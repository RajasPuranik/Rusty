//! Tab management — tracks open tabs, their URLs, titles, and webview state.
//!
//! Each tab has:
//! - A unique `TabId` (monotonically increasing `u32`)
//! - URL and title
//! - An optional live `WebView` (lazy-created on first show, destroyed on discard)

use serde::Serialize;

/// Unique identifier for a tab. Cheap to copy.
pub type TabId = u32;

/// Metadata for a single tab (serializable for IPC to toolbar).
#[derive(Debug, Serialize)]
pub struct TabInfo {
    pub id: TabId,
    pub title: String,
    pub url: String,
}

/// Internal state for a tab.
pub struct Tab {
    pub id: TabId,
    pub url: String,
    pub title: String,
    /// Whether this tab has a live webview attached.
    /// The webview itself is stored in the main app state keyed by TabId,
    /// because `wry::WebView` is not `Send` and must live on the main thread.
    pub has_webview: bool,
}

impl Tab {
    pub fn new(id: TabId, url: String) -> Self {
        Self {
            id,
            title: "New Tab".to_owned(),
            url,
            has_webview: false,
        }
    }

    pub fn info(&self) -> TabInfo {
        TabInfo {
            id: self.id,
            title: self.title.clone(),
            url: self.url.clone(),
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
    pub fn switch_to(&mut self, id: TabId) -> bool {
        if self.tabs.iter().any(|t| t.id == id) {
            self.active = Some(id);
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
            Some(new_id)
        } else {
            self.active
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
    fn all_info() {
        let mut mgr = TabManager::new();
        mgr.create_tab("https://a.com".into());
        mgr.create_tab("https://b.com".into());
        let info = mgr.all_info();
        assert_eq!(info.len(), 2);
        assert_eq!(info[0].url, "https://a.com");
        assert_eq!(info[1].url, "https://b.com");
    }
}
