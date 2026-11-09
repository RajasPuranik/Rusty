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
    pub active: bool,
    pub is_discarded: bool,
    pub sleeping: bool,
    pub pinned: bool,
    pub muted: bool,
    pub group_id: Option<String>,
    pub zoom_percent: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NavHint {
    Back,
    Forward,
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
    /// Whether the tab is pinned.
    pub pinned: bool,
    /// Whether the tab audio is muted.
    pub muted: bool,
    /// Associated tab group ID.
    pub group_id: Option<String>,
    /// When the tab was last viewed or interacted with.
    pub last_active: Instant,
    /// Saved vertical scroll position restored when waking a discarded tab.
    pub scroll_y: f64,
    /// Current zoom level factor (1.0 = 100%).
    pub zoom_level: f64,
    /// Visited URL stack for middle-click Back/Forward history cloning.
    nav_history: Vec<String>,
    /// Current index within `nav_history`.
    nav_index: usize,
    /// Optional directional hint when WebView Back/Forward skips redirect hops.
    pending_nav_hint: Option<NavHint>,
}

fn is_internal_newtab_alias(u: &str) -> bool {
    u == "about:blank"
        || u == "about:newtab"
        || u.contains("rusty.app/newtab.html")
        || u.contains("rusty://app/newtab.html")
}

fn canonical_history_key(u: &str) -> String {
    if is_internal_newtab_alias(u) {
        return "about:blank".to_owned();
    }
    if u.contains("://") {
        if let Ok(parsed) = url::Url::parse(u) {
            return parsed.as_str().to_owned();
        }
    }
    u.to_owned()
}

/// Compare two URLs modulo internal newtab aliases and root trailing slash/default port normalization.
pub fn urls_equivalent(a: &str, b: &str) -> bool {
    a == b || canonical_history_key(a) == canonical_history_key(b)
}

impl Tab {
    pub fn new(id: TabId, url: String) -> Self {
        let initial_history = if url.is_empty() {
            vec!["about:blank".to_owned()]
        } else {
            vec![url.clone()]
        };
        Self {
            id,
            title: "New Tab".to_owned(),
            url,
            has_webview: false,
            is_discarded: false,
            pinned: false,
            muted: false,
            group_id: None,
            last_active: Instant::now(),
            scroll_y: 0.0,
            zoom_level: 1.0,
            nav_history: initial_history,
            nav_index: 0,
            pending_nav_hint: None,
        }
    }

    pub fn set_pending_nav(&mut self, hint: Option<NavHint>) {
        self.pending_nav_hint = hint;
    }

    /// Record a committed navigation URL, keeping Back/Forward pointers in sync
    /// across redirects, `pushState` updates, and trailing-slash differences.
    pub fn record_navigation(&mut self, url: &str) {
        if url.is_empty() || url.starts_with("data:") {
            return;
        }
        let normalized = if is_internal_newtab_alias(url) {
            "about:blank".to_owned()
        } else {
            url.to_owned()
        };

        let hint = self.pending_nav_hint;

        if let Some(current) = self.nav_history.get(self.nav_index) {
            if urls_equivalent(current, &normalized) {
                self.pending_nav_hint = None;
                return;
            }
        }
        if self.nav_index > 0 {
            if let Some(prev) = self.nav_history.get(self.nav_index - 1) {
                if urls_equivalent(prev, &normalized) {
                    self.nav_index -= 1;
                    self.pending_nav_hint = None;
                    return;
                }
            }
        }
        if let Some(next) = self.nav_history.get(self.nav_index + 1) {
            if urls_equivalent(next, &normalized) {
                self.nav_index += 1;
                self.pending_nav_hint = None;
                return;
            }
        }

        if hint == Some(NavHint::Back) && self.nav_index > 0 {
            if let Some(pos) = self.nav_history[..self.nav_index]
                .iter()
                .rposition(|u| urls_equivalent(u, &normalized))
            {
                self.nav_index = pos;
                self.pending_nav_hint = None;
                return;
            }
        }
        if hint == Some(NavHint::Forward) && self.nav_index + 1 < self.nav_history.len() {
            if let Some(rel) = self.nav_history[self.nav_index + 1..]
                .iter()
                .position(|u| urls_equivalent(u, &normalized))
            {
                self.nav_index += 1 + rel;
                self.pending_nav_hint = None;
                return;
            }
        }

        self.pending_nav_hint = None;
        self.nav_history.truncate(self.nav_index + 1);
        self.nav_history.push(normalized);
        if self.nav_history.len() > 200 {
            let overflow = self.nav_history.len() - 200;
            self.nav_history.drain(0..overflow);
        }
        self.nav_index = self.nav_history.len().saturating_sub(1);
    }

    /// URL behind current history position (if any).
    pub fn peek_back_url(&self) -> Option<&str> {
        if self.nav_index > 0 {
            self.nav_history.get(self.nav_index - 1).map(|s| s.as_str())
        } else {
            None
        }
    }

    /// URL ahead of current history position (if any).
    pub fn peek_forward_url(&self) -> Option<&str> {
        self.nav_history.get(self.nav_index + 1).map(|s| s.as_str())
    }

    pub fn info(&self, active_id: Option<TabId>) -> TabInfo {
        TabInfo {
            id: self.id,
            title: self.title.clone(),
            url: self.url.clone(),
            active: Some(self.id) == active_id,
            is_discarded: self.is_discarded,
            sleeping: self.is_discarded,
            pinned: self.pinned,
            muted: self.muted,
            group_id: self.group_id.clone(),
            zoom_percent: (self.zoom_level * 100.0).round() as u32,
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

    /// Create a new tab immediately after `after_id` (or at the end if not found).
    /// Preserves the currently active tab so background opens stay unobtrusive.
    pub fn create_tab_after(&mut self, after_id: Option<TabId>, url: String) -> TabId {
        let id = self.next_id;
        self.next_id += 1;
        let mut tab = Tab::new(id, url);
        if let Some(aid) = after_id {
            if let Some(pos) = self.tabs.iter().position(|t| t.id == aid) {
                tab.group_id = self.tabs[pos].group_id.clone();
                self.tabs.insert(pos + 1, tab);
            } else {
                self.tabs.push(tab);
            }
        } else {
            self.tabs.push(tab);
        }
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

    /// Get info for all tabs (for UI rendering).
    pub fn all_info(&self) -> Vec<TabInfo> {
        self.tabs.iter().map(|t| t.info(self.active)).collect()
    }

    /// Reorder tabs via drag-and-drop.
    pub fn reorder(&mut self, from_id: TabId, to_id: TabId, position: &str) {
        let from_idx = match self.tabs.iter().position(|t| t.id == from_id) {
            Some(i) => i,
            None => return,
        };
        let to_idx = match self.tabs.iter().position(|t| t.id == to_id) {
            Some(i) => i,
            None => return,
        };
        if from_idx == to_idx {
            return;
        }

        let mut moved = self.tabs.remove(from_idx);
        let target_idx = self.tabs.iter().position(|t| t.id == to_id).unwrap_or(0);
        // Adopt group of adjacent tab if not pinned
        if !moved.pinned {
            if let Some(target) = self.tabs.get(target_idx) {
                moved.group_id = target.group_id.clone();
            }
        }

        let insert_idx = if position == "after" {
            (target_idx + 1).min(self.tabs.len())
        } else {
            target_idx
        };
        self.tabs.insert(insert_idx, moved);
    }

    /// Pin or unpin a tab.
    pub fn set_pinned(&mut self, id: TabId, pinned: bool) {
        if let Some(tab) = self.get_mut(id) {
            tab.pinned = pinned;
        }
    }

    /// Mute or unmute tab audio.
    pub fn set_muted(&mut self, id: TabId, muted: bool) {
        if let Some(tab) = self.get_mut(id) {
            tab.muted = muted;
        }
    }

    /// Duplicate an existing tab. Returns ID of the newly created tab.
    pub fn duplicate(&mut self, id: TabId) -> Option<TabId> {
        let (url, title, zoom, nav_history, nav_index, group_id) = {
            let tab = self.get(id)?;
            (
                tab.url.clone(),
                tab.title.clone(),
                tab.zoom_level,
                tab.nav_history.clone(),
                tab.nav_index,
                tab.group_id.clone(),
            )
        };
        let new_id = self.next_id;
        self.next_id += 1;
        let mut new_tab = Tab::new(new_id, url);
        new_tab.title = format!("{title} (Copy)");
        new_tab.zoom_level = zoom;
        new_tab.nav_history = nav_history;
        new_tab.nav_index = nav_index;
        new_tab.group_id = group_id;
        let pos = self.tabs.iter().position(|t| t.id == id).unwrap_or(self.tabs.len());
        self.tabs.insert(pos + 1, new_tab);
        Some(new_id)
    }

    /// Close all tabs except `id` and pinned tabs. Returns IDs of closed tabs.
    pub fn close_others(&mut self, id: TabId) -> Vec<TabId> {
        let mut closed = Vec::new();
        self.tabs.retain(|t| {
            if t.id == id || t.pinned {
                true
            } else {
                closed.push(t.id);
                false
            }
        });
        self.active = Some(id);
        closed
    }

    /// Close all tabs after `id` except pinned tabs. Returns IDs of closed tabs.
    pub fn close_below(&mut self, id: TabId) -> Vec<TabId> {
        let pos = match self.tabs.iter().position(|t| t.id == id) {
            Some(p) => p,
            None => return Vec::new(),
        };
        let mut closed = Vec::new();
        let mut keep = Vec::new();
        for (i, t) in self.tabs.drain(..).enumerate() {
            if i <= pos || t.pinned {
                keep.push(t);
            } else {
                closed.push(t.id);
            }
        }
        self.tabs = keep;
        closed
    }

    /// Assign or remove tab from a group.
    pub fn set_group(&mut self, id: TabId, group_id: Option<String>) {
        if let Some(tab) = self.get_mut(id) {
            tab.group_id = group_id;
        }
    }

    /// Return IDs of all open tabs.
    pub fn all_ids(&self) -> Vec<TabId> {
        self.tabs.iter().map(|t| t.id).collect()
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

    #[test]
    fn tab_reordering() {
        let mut mgr = TabManager::new();
        let t1 = mgr.create_tab("https://1.com".into());
        let t2 = mgr.create_tab("https://2.com".into());
        let t3 = mgr.create_tab("https://3.com".into());

        assert_eq!(mgr.all_ids(), vec![t1, t2, t3]);

        // Move t1 after t2 -> [t2, t1, t3]
        mgr.reorder(t1, t2, "after");
        assert_eq!(mgr.all_ids(), vec![t2, t1, t3]);

        // Move t3 before t2 -> [t3, t2, t1]
        mgr.reorder(t3, t2, "before");
        assert_eq!(mgr.all_ids(), vec![t3, t2, t1]);
    }

    #[test]
    fn tab_pin_mute_group() {
        let mut mgr = TabManager::new();
        let t1 = mgr.create_tab("https://1.com".into());

        mgr.set_pinned(t1, true);
        assert!(mgr.get(t1).unwrap().pinned);

        mgr.set_muted(t1, true);
        assert!(mgr.get(t1).unwrap().muted);

        mgr.set_group(t1, Some("group_a".into()));
        assert_eq!(mgr.get(t1).unwrap().group_id, Some("group_a".into()));
    }

    #[test]
    fn tab_duplication() {
        let mut mgr = TabManager::new();
        let t1 = mgr.create_tab("https://example.com".into());
        if let Some(t) = mgr.get_mut(t1) {
            t.title = "Example".into();
            t.zoom_level = 1.25;
        }

        let dup_id = mgr.duplicate(t1).expect("duplication failed");
        let dup = mgr.get(dup_id).expect("dup tab exists");
        assert_eq!(dup.url, "https://example.com");
        assert_eq!(dup.title, "Example (Copy)");
        assert_eq!(dup.zoom_level, 1.25);
        assert_eq!(mgr.all_ids(), vec![t1, dup_id]);
    }

    #[test]
    fn close_others_and_below() {
        let mut mgr = TabManager::new();
        let t1 = mgr.create_tab("https://1.com".into());
        let t2 = mgr.create_tab("https://2.com".into());
        let t3 = mgr.create_tab("https://3.com".into());
        let t4 = mgr.create_tab("https://4.com".into());

        // Pin t1
        mgr.set_pinned(t1, true);

        // Close others of t3 -> t2 and t4 should be closed, t1 (pinned) and t3 remain
        let closed = mgr.close_others(t3);
        assert_eq!(closed, vec![t2, t4]);
        assert_eq!(mgr.all_ids(), vec![t1, t3]);

        // Add more tabs
        let t5 = mgr.create_tab("https://5.com".into());
        let t6 = mgr.create_tab("https://6.com".into());
        assert_eq!(mgr.all_ids(), vec![t1, t3, t5, t6]);

        // Close below t3 -> t5 and t6 should be closed
        let closed_below = mgr.close_below(t3);
        assert_eq!(closed_below, vec![t5, t6]);
        assert_eq!(mgr.all_ids(), vec![t1, t3]);
    }

    #[test]
    fn nav_history_and_create_tab_after() {
        let mut mgr = TabManager::new();
        let t1 = mgr.create_tab("about:blank".into());
        let t2 = mgr.create_tab("https://end.com".into());

        if let Some(tab) = mgr.get_mut(t1) {
            tab.record_navigation("http://rusty.app/newtab.html?skin=crazy");
            assert_eq!(tab.peek_back_url(), None);
            tab.record_navigation("https://one.com");
            assert_eq!(tab.peek_back_url(), Some("about:blank"));
            tab.record_navigation("https://two.com");
            assert_eq!(tab.peek_back_url(), Some("https://one.com"));
            assert_eq!(tab.peek_forward_url(), None);

            // Simulate clicking Back -> WebView navigates to one.com
            tab.record_navigation("https://one.com");
            assert_eq!(tab.peek_back_url(), Some("about:blank"));
            assert_eq!(tab.peek_forward_url(), Some("https://two.com"));
        }

        // Background insertion preserves active tab (t1) and inserts immediately after t1
        let t_bg = mgr.create_tab_after(Some(t1), "https://bg.com".into());
        assert_eq!(mgr.active_id(), Some(t1));
        assert_eq!(mgr.all_ids(), vec![t1, t_bg, t2]);
    }

    #[test]
    fn test_back_forward_redirect_preserves_forward_history() {
        let mut mgr = TabManager::new();
        let t1 = mgr.create_tab("about:blank".into());
        let tab = mgr.get_mut(t1).unwrap();

        tab.record_navigation("https://site.test/page-a");
        tab.record_navigation("https://site.test/redir");
        tab.record_navigation("https://site.test/final");
        assert_eq!(tab.peek_back_url(), Some("https://site.test/redir"));
        assert_eq!(tab.peek_forward_url(), None);

        // Simulate WebView2 Back skipping redirect hop directly to page-a
        tab.set_pending_nav(Some(NavHint::Back));
        tab.record_navigation("https://site.test/page-a");
        assert_eq!(tab.peek_back_url(), Some("about:blank"));
        assert!(tab.peek_forward_url().is_some());

        // Simulate WebView2 Forward skipping redirect hop directly to final
        tab.set_pending_nav(Some(NavHint::Forward));
        tab.record_navigation("https://site.test/final");
        assert_eq!(tab.peek_forward_url(), None);
        assert!(tab.peek_back_url().is_some());
    }

    #[test]
    fn test_root_trailing_slash_normalization() {
        assert!(urls_equivalent("http://127.0.0.1:8080", "http://127.0.0.1:8080/"));
        assert!(urls_equivalent("https://Example.COM:443/path", "https://example.com/path"));
        assert!(!urls_equivalent("https://example.com/a", "https://example.com/b"));

        let mut mgr = TabManager::new();
        let t1 = mgr.create_tab("about:blank".into());
        let tab = mgr.get_mut(t1).unwrap();
        tab.record_navigation("http://127.0.0.1:8080");
        tab.record_navigation("http://127.0.0.1:8080/");
        assert_eq!(tab.peek_back_url(), Some("about:blank"));
        assert_eq!(tab.peek_forward_url(), None);
    }
}
