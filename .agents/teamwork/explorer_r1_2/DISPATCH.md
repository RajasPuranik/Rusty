## 2026-11-09T20:49:40Z
You are Explorer 2 for Milestone R1 (Workspaces).
Your role: Active-Only Webview Lifecycle & Profile Isolation Explorer.
Your working directory: d:\browser\.agents\teamwork\explorer_r1_2\

## Mandatory Context Files (Read First!)
- ORIGINAL_REQUEST.md: d:\browser\ORIGINAL_REQUEST.md (MANDATORY: read this first before starting work)
- PROJECT.md: d:\browser\PROJECT.md
- Existing codebase: inspect `src/main.rs`, `src/platform/`, `src/platform/windows.rs`, `src/platform/linux.rs`.

## Technical Scope & Analysis
Milestone R1 requires strict lifecycle management for webviews:
1. **Active-Only Webview Lifecycle Invariant**:
   - ONLY the active workspace has live webviews instantiated in memory.
   - When switching from Workspace A to Workspace B:
     a) Capture current tab state of Workspace A (current URL, title, scroll position via JS eval / window.scrollX/Y, back/forward history).
     b) Destroy all content webviews of Workspace A (drop `Box<dyn PlatformWebView>`, releasing Win32 COM / WebKitGTK handles).
     c) Activate Workspace B: instantiate live webviews for Workspace B's open tabs (or restore active tab first, lazy-loading background tabs).
     d) Guarantee 0 MB webview RAM overhead for inactive workspaces.
2. **Isolated Workspace Profile (Dedicated Cookie Store / Profile)**:
   - An optional isolated workspace must use a dedicated, isolated cookie store / profile data directory (e.g. `EBWebView_Isolated_<id>` on Windows, separate `WebKitWebsiteDataManager` on Linux).
   - Cookies, session storage, and cache do NOT bleed between default and isolated workspaces.
   - Measure and document the exact RAM cost of the isolated profile.
3. **Platform Trait Integration**:
   - Evaluate how `PlatformHost::create_webview(&WebViewConfig)` in `src/platform/mod.rs` supports custom `data_directory` / cookie profiles.
   - Formulate exact changes needed in `src/platform/mod.rs`, `src/platform/windows.rs`, and `src/main.rs`.

## Deliverables
Write your technical design and implementation plan to:
- `d:\browser\.agents\teamwork\explorer_r1_2\analysis.md`
- `d:\browser\.agents\teamwork\explorer_r1_2\handoff.md`
When complete, send a message to your parent.
