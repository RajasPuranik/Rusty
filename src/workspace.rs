//! Rust-owned workspace state manager and lifecycle controller.
//!
//! Tracks open tabs per workspace, maintains live webviews strictly in the active
//! workspace to guarantee 0 MB RAM cost for inactive workspaces, and provides
//! crash-safe persistence and migration operations.

use crate::tab::TabManager;
use serde::{Deserialize, Serialize};

/// Serializable snapshot of a tab's state within a workspace.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TabMetadata {
    pub url: String,
    pub title: String,
    #[serde(default)]
    pub favicon: Option<String>,
    #[serde(default)]
    pub scroll_y: f64,
    #[serde(default)]
    pub pinned: bool,
    #[serde(default)]
    pub muted: bool,
    #[serde(default)]
    pub group_id: Option<String>,
    #[serde(default)]
    pub nav_history: Vec<String>,
    #[serde(default)]
    pub nav_index: usize,
}

impl TabMetadata {
    pub fn new(url: String, title: String) -> Self {
        let nav_history = if url.is_empty() || url == "about:blank" {
            vec!["about:blank".to_owned()]
        } else {
            vec![url.clone()]
        };
        Self {
            url,
            title,
            favicon: None,
            scroll_y: 0.0,
            pinned: false,
            muted: false,
            group_id: None,
            nav_history,
            nav_index: 0,
        }
    }
}

/// A workspace encapsulates a collection of tabs, visual appearance,
/// and optional isolation / focus mode properties.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Workspace {
    pub id: String,
    pub name: String,
    pub icon: String,
    pub color: String,
    #[serde(default = "default_ws_theme")]
    pub theme: String,
    #[serde(default = "default_ws_engine")]
    pub default_engine: String,
    #[serde(default)]
    pub focus_mode: Option<String>,
    #[serde(default)]
    pub is_isolated: bool,
    #[serde(default)]
    pub tabs: Vec<TabMetadata>,
    #[serde(default)]
    pub active_tab_index: usize,
    #[serde(default)]
    pub recently_closed: Vec<TabMetadata>,
}

fn default_ws_theme() -> String {
    "sunset".to_owned()
}
fn default_ws_engine() -> String {
    "google".to_owned()
}

/// Summary object sent to UI over IPC for left-rail rendering and tab-count badges.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct WorkspaceSummary {
    pub id: String,
    pub name: String,
    pub icon: String,
    pub color: String,
    pub theme: String,
    pub active: bool,
    pub tab_count: usize,
    pub is_isolated: bool,
    pub focus_mode: Option<String>,
}

/// Manages all workspaces, active workspace switching, and undo operations.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkspaceManager {
    workspaces: Vec<Workspace>,
    active_workspace_id: String,
    #[serde(skip)]
    undo_deleted: Option<(usize, Workspace)>,
}

impl Default for WorkspaceManager {
    fn default() -> Self {
        Self::new()
    }
}

impl WorkspaceManager {
    /// Create a workspace manager with the 5 standard default workspaces matching
    /// the UI reference (Main, College, Projects, Media, Games).
    pub fn new() -> Self {
        let initial_tab = TabMetadata::new("about:blank".to_owned(), "New Tab".to_owned());
        let workspaces = vec![
            Workspace {
                id: "main".to_owned(),
                name: "Main".to_owned(),
                icon: "home".to_owned(),
                color: "#f97316".to_owned(),
                theme: "sunset".to_owned(),
                default_engine: "google".to_owned(),
                focus_mode: None,
                is_isolated: false,
                tabs: vec![initial_tab.clone()],
                active_tab_index: 0,
                recently_closed: Vec::new(),
            },
            Workspace {
                id: "college".to_owned(),
                name: "College".to_owned(),
                icon: "book".to_owned(),
                color: "#3b82f6".to_owned(),
                theme: "aurora".to_owned(),
                default_engine: "google".to_owned(),
                focus_mode: Some("study".to_owned()),
                is_isolated: false,
                tabs: vec![initial_tab.clone()],
                active_tab_index: 0,
                recently_closed: Vec::new(),
            },
            Workspace {
                id: "projects".to_owned(),
                name: "Projects".to_owned(),
                icon: "code".to_owned(),
                color: "#10b981".to_owned(),
                theme: "cyberpunk".to_owned(),
                default_engine: "duckduckgo".to_owned(),
                focus_mode: Some("work".to_owned()),
                is_isolated: false,
                tabs: vec![initial_tab.clone()],
                active_tab_index: 0,
                recently_closed: Vec::new(),
            },
            Workspace {
                id: "media".to_owned(),
                name: "Media".to_owned(),
                icon: "video".to_owned(),
                color: "#ec4899".to_owned(),
                theme: "sakura".to_owned(),
                default_engine: "google".to_owned(),
                focus_mode: None,
                is_isolated: false,
                tabs: vec![initial_tab.clone()],
                active_tab_index: 0,
                recently_closed: Vec::new(),
            },
            Workspace {
                id: "games".to_owned(),
                name: "Games".to_owned(),
                icon: "gamepad".to_owned(),
                color: "#8b5cf6".to_owned(),
                theme: "midnight".to_owned(),
                default_engine: "google".to_owned(),
                focus_mode: None,
                is_isolated: false,
                tabs: vec![initial_tab],
                active_tab_index: 0,
                recently_closed: Vec::new(),
            },
        ];

        Self {
            workspaces,
            active_workspace_id: "main".to_owned(),
            undo_deleted: None,
        }
    }

    /// Construct from persisted storage list, guaranteeing at least one valid workspace
    /// and a valid active_workspace_id.
    pub fn from_persisted(mut workspaces: Vec<Workspace>, mut active_id: String) -> Self {
        if workspaces.is_empty() {
            return Self::new();
        }
        if !workspaces.iter().any(|w| w.id == active_id) {
            active_id = workspaces[0].id.clone();
        }
        // Ensure every workspace has at least one tab
        for ws in &mut workspaces {
            if ws.tabs.is_empty() {
                ws.tabs.push(TabMetadata::new("about:blank".to_owned(), "New Tab".to_owned()));
                ws.active_tab_index = 0;
            }
            if ws.active_tab_index >= ws.tabs.len() {
                ws.active_tab_index = 0;
            }
        }
        Self {
            workspaces,
            active_workspace_id: active_id,
            undo_deleted: None,
        }
    }

    pub fn workspaces(&self) -> &[Workspace] {
        &self.workspaces
    }

    pub fn active_id(&self) -> &str {
        &self.active_workspace_id
    }

    pub fn active_workspace(&self) -> &Workspace {
        self.workspaces
            .iter()
            .find(|w| w.id == self.active_workspace_id)
            .unwrap_or(&self.workspaces[0])
    }

    pub fn active_workspace_mut(&mut self) -> &mut Workspace {
        let active_id = self.active_workspace_id.clone();
        if let Some(pos) = self.workspaces.iter().position(|w| w.id == active_id) {
            &mut self.workspaces[pos]
        } else {
            &mut self.workspaces[0]
        }
    }

    pub fn get(&self, id: &str) -> Option<&Workspace> {
        self.workspaces.iter().find(|w| w.id == id)
    }

    pub fn get_mut(&mut self, id: &str) -> Option<&mut Workspace> {
        self.workspaces.iter_mut().find(|w| w.id == id)
    }

    /// Save current runtime tab state into the currently active workspace.
    pub fn sync_current_tabs(&mut self, tabs: &TabManager) {
        let (metadata, active_idx) = export_tabs(tabs);
        if let Some(ws) = self.workspaces.iter_mut().find(|w| w.id == self.active_workspace_id) {
            ws.tabs = metadata;
            ws.active_tab_index = active_idx;
        }
    }

    /// Switch active workspace:
    /// 1. Saves runtime tabs from `current_tabs` into current workspace.
    /// 2. Updates `active_workspace_id` to `target_id`.
    /// 3. Returns the target workspace's tab metadata and active tab index for restoration.
    pub fn switch_workspace(
        &mut self,
        target_id: &str,
        current_tabs: &TabManager,
    ) -> Option<(Vec<TabMetadata>, usize)> {
        if target_id == self.active_workspace_id {
            return None;
        }
        if !self.workspaces.iter().any(|w| w.id == target_id) {
            return None;
        }

        // 1. Save current tabs
        self.sync_current_tabs(current_tabs);

        // 2. Switch active ID
        self.active_workspace_id = target_id.to_owned();

        // 3. Return target tabs
        let target = self.active_workspace();
        Some((target.tabs.clone(), target.active_tab_index))
    }

    /// Create a new workspace. Returns its generated or given ID.
    pub fn create_workspace(
        &mut self,
        name: String,
        icon: Option<String>,
        color: Option<String>,
        is_isolated: bool,
    ) -> String {
        let clean_name = if name.trim().is_empty() {
            "New Space".to_owned()
        } else {
            name.trim().to_owned()
        };
        let mut base_id = clean_name.to_lowercase().replace(' ', "-");
        base_id.retain(|c| c.is_alphanumeric() || c == '-');
        if base_id.is_empty() {
            base_id = "space".to_owned();
        }

        let mut candidate_id = base_id.clone();
        let mut counter = 2;
        while self.workspaces.iter().any(|w| w.id == candidate_id) {
            candidate_id = format!("{base_id}-{counter}");
            counter += 1;
        }

        let ws = Workspace {
            id: candidate_id.clone(),
            name: clean_name,
            icon: icon.unwrap_or_else(|| "layers".to_owned()),
            color: color.unwrap_or_else(|| "#3b82f6".to_owned()),
            theme: "sunset".to_owned(),
            default_engine: "google".to_owned(),
            focus_mode: None,
            is_isolated,
            tabs: vec![TabMetadata::new("about:blank".to_owned(), "New Tab".to_owned())],
            active_tab_index: 0,
            recently_closed: Vec::new(),
        };

        self.workspaces.push(ws);
        candidate_id
    }

    /// Rename an existing workspace.
    pub fn rename_workspace(&mut self, id: &str, new_name: String) -> bool {
        let clean_name = new_name.trim();
        if clean_name.is_empty() {
            return false;
        }
        if let Some(ws) = self.workspaces.iter_mut().find(|w| w.id == id) {
            ws.name = clean_name.to_owned();
            true
        } else {
            false
        }
    }

    /// Reorder workspaces based on an ordered list of IDs.
    pub fn reorder_workspaces(&mut self, ordered_ids: &[String]) -> bool {
        if ordered_ids.is_empty() {
            return false;
        }
        let mut reordered = Vec::with_capacity(self.workspaces.len());
        for id in ordered_ids {
            if let Some(pos) = self.workspaces.iter().position(|w| w.id == *id) {
                reordered.push(self.workspaces.remove(pos));
            }
        }
        // Append any remaining workspaces not explicitly listed
        reordered.append(&mut self.workspaces);
        self.workspaces = reordered;
        true
    }

    /// Delete a workspace. Guarantees at least 1 workspace remains.
    /// If deleting the active workspace, returns the new active workspace ID to switch to.
    pub fn delete_workspace(
        &mut self,
        id: &str,
    ) -> Result<Option<String>, &'static str> {
        if self.workspaces.len() <= 1 {
            return Err("Cannot delete the only remaining workspace");
        }
        let pos = match self.workspaces.iter().position(|w| w.id == id) {
            Some(p) => p,
            None => return Err("Workspace not found"),
        };

        let removed = self.workspaces.remove(pos);
        self.undo_deleted = Some((pos, removed));

        if self.active_workspace_id == id {
            let new_active = self.workspaces[0].id.clone();
            self.active_workspace_id = new_active.clone();
            Ok(Some(new_active))
        } else {
            Ok(None)
        }
    }

    /// Undo the most recent deletion.
    pub fn undo_delete(&mut self) -> Option<String> {
        if let Some((pos, ws)) = self.undo_deleted.take() {
            let id = ws.id.clone();
            let insert_pos = pos.min(self.workspaces.len());
            self.workspaces.insert(insert_pos, ws);
            Some(id)
        } else {
            None
        }
    }

    /// Whether an undoable deletion exists.
    pub fn has_undo(&self) -> bool {
        self.undo_deleted.is_some()
    }

    /// Move a tab from the active workspace to a target workspace.
    pub fn move_tab_to_workspace(
        &mut self,
        tab: TabMetadata,
        target_id: &str,
    ) -> bool {
        if let Some(ws) = self.workspaces.iter_mut().find(|w| w.id == target_id) {
            ws.tabs.push(tab);
            true
        } else {
            false
        }
    }

    /// Push a recently closed tab into the workspace's history.
    pub fn push_recently_closed(&mut self, workspace_id: &str, tab: TabMetadata) {
        if let Some(ws) = self.workspaces.iter_mut().find(|w| w.id == workspace_id) {
            ws.recently_closed.push(tab);
            if ws.recently_closed.len() > 50 {
                ws.recently_closed.remove(0);
            }
        }
    }

    /// Pop and restore the most recently closed tab for a workspace.
    pub fn pop_recently_closed(&mut self, workspace_id: &str) -> Option<TabMetadata> {
        if let Some(ws) = self.workspaces.iter_mut().find(|w| w.id == workspace_id) {
            ws.recently_closed.pop()
        } else {
            None
        }
    }

    /// Export summary list for IPC, updating the active workspace's live tab count.
    pub fn summaries(&self, active_tab_count: usize) -> Vec<WorkspaceSummary> {
        self.workspaces
            .iter()
            .map(|w| {
                let is_active = w.id == self.active_workspace_id;
                let count = if is_active {
                    active_tab_count
                } else {
                    w.tabs.len()
                };
                WorkspaceSummary {
                    id: w.id.clone(),
                    name: w.name.clone(),
                    icon: w.icon.clone(),
                    color: w.color.clone(),
                    theme: w.theme.clone(),
                    active: is_active,
                    tab_count: count,
                    is_isolated: w.is_isolated,
                    focus_mode: w.focus_mode.clone(),
                }
            })
            .collect()
    }
}

/// Helper function to convert live TabManager tabs to serializable TabMetadata.
pub fn export_tabs(tabs: &TabManager) -> (Vec<TabMetadata>, usize) {
    let all_info = tabs.all_info();
    let active_id = tabs.active_id();
    let mut metadata = Vec::with_capacity(all_info.len());
    let mut active_idx = 0;

    for (i, info) in all_info.iter().enumerate() {
        if Some(info.id) == active_id {
            active_idx = i;
        }
        let (history, nav_idx, scroll_y) = if let Some(tab) = tabs.get(info.id) {
            (tab.nav_history().to_vec(), tab.nav_index(), tab.scroll_y)
        } else {
            (vec![info.url.clone()], 0, 0.0)
        };

        metadata.push(TabMetadata {
            url: info.url.clone(),
            title: info.title.clone(),
            favicon: info.favicon.clone(),
            scroll_y,
            pinned: info.pinned,
            muted: info.muted,
            group_id: info.group_id.clone(),
            nav_history: history,
            nav_index: nav_idx,
        });
    }

    if metadata.is_empty() {
        metadata.push(TabMetadata::new("about:blank".to_owned(), "New Tab".to_owned()));
        active_idx = 0;
    }

    (metadata, active_idx)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_workspace_defaults_and_activation() {
        let mgr = WorkspaceManager::new();
        assert_eq!(mgr.workspaces().len(), 5);
        assert_eq!(mgr.active_id(), "main");
        assert_eq!(mgr.active_workspace().name, "Main");
        assert_eq!(mgr.active_workspace().tabs.len(), 1);
    }

    #[test]
    fn test_create_and_rename_workspace() {
        let mut mgr = WorkspaceManager::new();
        let new_id = mgr.create_workspace("Research Work".to_owned(), Some("search".to_owned()), None, true);
        assert!(new_id.starts_with("research-work"));
        let ws = mgr.get(&new_id).expect("Created workspace exists");
        assert_eq!(ws.name, "Research Work");
        assert!(ws.is_isolated);

        assert!(mgr.rename_workspace(&new_id, "Advanced Research".to_owned()));
        assert_eq!(mgr.get(&new_id).unwrap().name, "Advanced Research");
    }

    #[test]
    fn test_delete_and_undo_workspace() {
        let mut mgr = WorkspaceManager::new();
        let college_id = "college";
        let res = mgr.delete_workspace(college_id).unwrap();
        assert_eq!(res, None); // Not active, so no auto-switch
        assert_eq!(mgr.workspaces().len(), 4);
        assert!(mgr.get(college_id).is_none());

        // Undo
        let restored_id = mgr.undo_delete().expect("Undo succeeds");
        assert_eq!(restored_id, college_id);
        assert_eq!(mgr.workspaces().len(), 5);
        assert!(mgr.get(college_id).is_some());
    }

    #[test]
    fn test_delete_active_workspace_auto_switches() {
        let mut mgr = WorkspaceManager::new();
        let active = mgr.active_id().to_owned();
        let new_active = mgr.delete_workspace(&active).unwrap();
        assert!(new_active.is_some());
        assert_ne!(mgr.active_id(), active);
        assert_eq!(mgr.active_id(), "college");
    }

    #[test]
    fn test_reorder_workspaces() {
        let mut mgr = WorkspaceManager::new();
        let order = vec!["games".to_owned(), "media".to_owned(), "main".to_owned()];
        assert!(mgr.reorder_workspaces(&order));
        assert_eq!(mgr.workspaces()[0].id, "games");
        assert_eq!(mgr.workspaces()[1].id, "media");
        assert_eq!(mgr.workspaces()[2].id, "main");
    }

    #[test]
    fn test_recently_closed_queue() {
        let mut mgr = WorkspaceManager::new();
        let tab = TabMetadata::new("https://example.com".to_owned(), "Example".to_owned());
        mgr.push_recently_closed("main", tab.clone());
        let restored = mgr.pop_recently_closed("main").expect("Tab popped");
        assert_eq!(restored.url, "https://example.com");
        assert!(mgr.pop_recently_closed("main").is_none());
    }
}
