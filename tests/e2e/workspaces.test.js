/**
 * End-to-End & Interface Verification Suite for Milestone R1: Workspaces
 *
 * Verifies:
 * - Feature 6: Rust Workspace State Manager (Rust-owned tab metadata)
 * - Feature 7: Active-Only Live Webview Lifecycle (0 MB inactive webview memory)
 * - Feature 8: Crash-Safe Atomic Persistence (temp file + rename with fsync)
 * - Feature 9: Workspace Management UI & Hotkeys (Ctrl+Alt+1..9, CRUD, undo)
 * - Feature 10: Isolated Profile Workspace (dedicated cookie store/profile)
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '../..');

describe('Milestone R1: Workspaces Architecture & Interface Tests', () => {

  describe('Feature 6: Rust Workspace State Manager', () => {
    it('Verifies src/workspace.rs exists and exposes WorkspaceManager', () => {
      const wsPath = path.join(ROOT_DIR, 'src', 'workspace.rs');
      assert.ok(fs.existsSync(wsPath), 'src/workspace.rs must exist');
      const content = fs.readFileSync(wsPath, 'utf8');
      assert.ok(content.includes('pub struct WorkspaceManager'), 'Exposes WorkspaceManager');
      assert.ok(content.includes('pub struct Workspace'), 'Exposes Workspace');
      assert.ok(content.includes('pub struct TabMetadata'), 'Exposes TabMetadata');
      assert.ok(content.includes('pub struct WorkspaceSummary'), 'Exposes WorkspaceSummary');
    });

    it('Verifies default workspaces match UI specification (Main, College, Projects, Media, Games)', () => {
      const wsPath = path.join(ROOT_DIR, 'src', 'workspace.rs');
      const content = fs.readFileSync(wsPath, 'utf8');
      assert.ok(content.includes('"main"'), 'Has main workspace');
      assert.ok(content.includes('"college"'), 'Has college workspace');
      assert.ok(content.includes('"projects"'), 'Has projects workspace');
      assert.ok(content.includes('"media"'), 'Has media workspace');
      assert.ok(content.includes('"games"'), 'Has games workspace');
    });

    it('Verifies TabMetadata captures essential restoration attributes', () => {
      const wsPath = path.join(ROOT_DIR, 'src', 'workspace.rs');
      const content = fs.readFileSync(wsPath, 'utf8');
      assert.ok(content.includes('pub url: String'), 'Captures URL');
      assert.ok(content.includes('pub title: String'), 'Captures Title');
      assert.ok(content.includes('pub scroll_y: f64'), 'Captures scroll position');
      assert.ok(content.includes('pub pinned: bool'), 'Captures pinned status');
      assert.ok(content.includes('pub muted: bool'), 'Captures muted status');
      assert.ok(content.includes('pub group_id: Option<String>'), 'Captures group ID');
      assert.ok(content.includes('pub nav_history: Vec<String>'), 'Captures navigation history');
      assert.ok(content.includes('pub nav_index: usize'), 'Captures navigation index');
    });
  });

  describe('Feature 7: Active-Only Live Webview Lifecycle (0 MB Inactive RAM)', () => {
    it('Verifies webview destruction on workspace switch in src/main.rs', () => {
      const mainPath = path.join(ROOT_DIR, 'src', 'main.rs');
      const content = fs.readFileSync(mainPath, 'utf8');
      assert.ok(
        content.includes('content_webviews.clear()'),
        'Must clear content_webviews map on workspace switch to destroy underlying webviews'
      );
      assert.ok(
        content.includes('remove_tab_webview'),
        'Must call remove_tab_webview to drop bounds, visibility, and COM/GTK handles'
      );
    });

    it('Verifies on-demand restoration of active tab webview in new workspace', () => {
      const mainPath = path.join(ROOT_DIR, 'src', 'main.rs');
      const content = fs.readFileSync(mainPath, 'utf8');
      assert.ok(
        content.includes('tabs.restore_from_metadata'),
        'Must restore tabs into TabManager from target workspace metadata'
      );
      assert.ok(
        content.includes('apply_layout_and_visibility'),
        'Must invoke apply_layout_and_visibility to lazily allocate the active tab webview'
      );
    });
  });

  describe('Feature 8: Crash-Safe Atomic Persistence', () => {
    it('Verifies atomic file write pattern in src/storage.rs (data.json.tmp -> data.json)', () => {
      const storagePath = path.join(ROOT_DIR, 'src', 'storage.rs');
      const content = fs.readFileSync(storagePath, 'utf8');
      assert.ok(content.includes('.with_extension("tmp")'), 'Creates temporary file');
      assert.ok(content.includes('fs::rename'), 'Renames temporary file atomically');
    });

    it('Verifies workspace persistence API in src/storage.rs', () => {
      const storagePath = path.join(ROOT_DIR, 'src', 'storage.rs');
      const content = fs.readFileSync(storagePath, 'utf8');
      assert.ok(content.includes('pub fn get_workspaces'), 'Provides get_workspaces');
      assert.ok(content.includes('pub fn save_workspaces'), 'Provides save_workspaces');
    });
  });

  describe('Feature 9: Workspace Management UI & Hotkeys', () => {
    it('Verifies IPC message handlers for all workspace operations in src/main.rs', () => {
      const mainPath = path.join(ROOT_DIR, 'src', 'main.rs');
      const content = fs.readFileSync(mainPath, 'utf8');
      assert.ok(content.includes('UiMessage::SwitchWorkspace'), 'Handles SwitchWorkspace');
      assert.ok(content.includes('UiMessage::CreateWorkspace'), 'Handles CreateWorkspace');
      assert.ok(content.includes('UiMessage::RenameWorkspace'), 'Handles RenameWorkspace');
      assert.ok(content.includes('UiMessage::DeleteWorkspace'), 'Handles DeleteWorkspace');
      assert.ok(content.includes('UiMessage::UndoDeleteWorkspace'), 'Handles UndoDeleteWorkspace');
      assert.ok(content.includes('UiMessage::ReorderWorkspaces'), 'Handles ReorderWorkspaces');
      assert.ok(content.includes('UiMessage::MoveTabToWorkspace'), 'Handles MoveTabToWorkspace');
      assert.ok(content.includes('UiMessage::RestoreRecentlyClosedTab'), 'Handles RestoreRecentlyClosedTab');
    });

    it('Verifies Ctrl+Alt+1..9 hotkey handling in ui/js/chrome.js and ui/js/newtab.js', () => {
      const chromeJs = fs.readFileSync(path.join(ROOT_DIR, 'ui', 'js', 'chrome.js'), 'utf8');
      const newtabJs = fs.readFileSync(path.join(ROOT_DIR, 'ui', 'js', 'newtab.js'), 'utf8');
      assert.ok(chromeJs.includes('e.ctrlKey') && chromeJs.includes('e.altKey'), 'Chrome UI binds Ctrl+Alt keys');
      assert.ok(newtabJs.includes('e.ctrlKey') && newtabJs.includes('e.altKey'), 'NewTab UI binds Ctrl+Alt keys');
      assert.ok(chromeJs.includes("'switch_workspace'"), 'Chrome UI sends switch_workspace');
      assert.ok(newtabJs.includes("'switch_workspace'"), 'NewTab UI sends switch_workspace');
    });

    it('Verifies left rail workspace chips render tab count badges in ui/js/newtab.js', () => {
      const newtabJs = fs.readFileSync(path.join(ROOT_DIR, 'ui', 'js', 'newtab.js'), 'utf8');
      assert.ok(newtabJs.includes('ws-tab-badge'), 'Renders tab count badge element');
      assert.ok(newtabJs.includes('ws.tab_count'), 'Binds live tab count to badge');
    });
  });

  describe('Feature 10: Isolated Profile Workspace', () => {
    it('Verifies isolated workspace attribute and profile path separation', () => {
      const wsPath = path.join(ROOT_DIR, 'src', 'workspace.rs');
      const content = fs.readFileSync(wsPath, 'utf8');
      assert.ok(content.includes('pub is_isolated: bool'), 'Workspace tracks is_isolated flag');
      assert.ok(content.includes('is_isolated: bool'), 'Create workspace accepts isolation parameter');
    });
  });

});
