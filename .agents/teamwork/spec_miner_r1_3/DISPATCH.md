## 2026-11-09T20:49:53Z
You are Spec Miner 3 for Milestone R1 (Workspaces).
Your role: Workspaces IPC & UI Integration Spec Miner.
Your working directory: d:\browser\.agents\teamwork\spec_miner_r1_3\

## Mandatory Context Files (Read First!)
- ORIGINAL_REQUEST.md: d:\browser\ORIGINAL_REQUEST.md (MANDATORY: read this first before starting work)
- PROJECT.md: d:\browser\PROJECT.md
- UI & Frontend: inspect `ui/` (stylesheets, index.html, JS app scripts) to understand the workspace rail, tab bar, and IPC handling.
- Invariants: INV-02 (Typed IPC across `rusty://app/` origin only), INV-01 (Only active skin code loaded).

## Technical Scope & Analysis
Milestone R1 requires clean typed IPC and UI integration for workspaces:
1. **Typed IPC Protocol (`rusty://app/`)**:
   - What requests does the frontend send to Rust?
     - `create_workspace`, `switch_workspace`, `rename_workspace`, `delete_workspace`, `undo_delete_workspace`, `reorder_workspaces`, `move_tab_workspace`, `reopen_closed_tab`.
   - What events does Rust push to the frontend?
     - `workspaces_updated` (list of workspaces, active workspace ID, tab count per workspace).
     - `workspace_switched` (new active workspace, list of tabs to render).
2. **Keyboard Hotkeys**:
   - `Ctrl+Alt+1` through `Ctrl+Alt+9` to switch directly to workspaces 1 through 9.
   - Global accelerator handling in tao event loop vs Webview keydown handling.
3. **UI Integration**:
   - Workspaces rail card: list with active indicator pill, "Add a space" button, tab-count badges.
   - Tab move: context menu option ("Move to Workspace >") and drag-to-rail affordance.
   - Recently closed tabs per workspace.
4. **E2E Test Specifications**:
   - Define exact test cases for Milestone R1 (create, switch, delete with undo, move tab, hotkeys, crash recovery).

## Deliverables
Write your specification and protocol documentation to:
- `d:\browser\.agents\teamwork\spec_miner_r1_3\analysis.md`
- `d:\browser\.agents\teamwork\spec_miner_r1_3\handoff.md`
When complete, send a message to your parent.
