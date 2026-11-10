# BRIEFING — 2026-11-09T17:50:34Z

## Mission
Plan the Linux side of Milestone R0:
1. Design `src/platform/linux.rs` conforming to `PlatformWebView` and `PlatformHost` via wry `build_gtk` with `gtk::Fixed` container.
2. Design cross-platform memory telemetry in `src/telemetry.rs` using `/proc/<pid>/smaps_rollup` on Linux to replace the dummy fallback stub.
3. Verify that conditional compilation flags (`#[cfg(target_os = "windows")]`, `#[cfg(target_os = "linux")]`) allow Windows compilation to pass `cargo check` and `cargo test` cleanly without broken symbols.
4. Provide a step-by-step implementation guide for the Worker.
5. Deliver comprehensive report in `survey_r0_linux.md` and handoff in `handoff.md`.

## 🔒 My Identity
- Archetype: spec_miner
- Roles: linux_platform_specialist, webkitgtk_expert, cross_platform_architect
- Working directory: d:\browser\.agents\teamwork\spec_miner_r0_3\
- Original parent: 9fd6bf4a-eddf-4493-a145-b4754fea5785
- Milestone: R0

## 🔒 Key Constraints
- Pure investigation & planning — do NOT implement production source code changes directly
- Authoritative reference: ORIGINAL_REQUEST.md and PROJECT.md
- Conform to unified `PlatformWebView` and `PlatformHost` traits
- WebKitGTK 4.1 via wry `build_gtk` with `gtk::Fixed` container
- Smaps_rollup PSS / Private WS memory telemetry on Linux
- Clean conditional compilation (`target_os = "windows"` vs `"linux"`) without breaking Windows `cargo check`/`test`
- Step-by-step implementation plan for Worker
- Deliverables: `survey_r0_linux.md`, `handoff.md`, completion message via `send_message`

## Current Parent
- Conversation ID: 9fd6bf4a-eddf-4493-a145-b4754fea5785
- Updated: 2026-11-09T17:50:34Z

## Task Summary
- **What to build**: Full Linux specification and design for Milestone R0 (Platform abstraction trait mapping to GTK/WebKitGTK and smaps_rollup telemetry)
- **Success criteria**: Exhaustive technical report covering webview lifecycle under GTK, `gtk::Fixed` bounds and layout, request blocking / content filtering, SOCKS5 proxy configuration, `/proc/<pid>/smaps_rollup` parsing, conditional compilation verification, and step-by-step worker plan.
- **Interface contracts**: `PROJECT.md` § Interface Contracts, `src/platform/mod.rs`
- **Code layout**: `PROJECT.md` § Code Layout (`src/platform/linux.rs`, `src/telemetry.rs`)

## Key Decisions Made
- [2026-11-09] GTK container strategy confirmed: `gtk::Fixed` inside Tao `default_vbox()` allows arbitrary pixel positioning for chrome webview, content webviews, and split view panes.
- [2026-11-09] Wry 0.57 provides `WebViewBuilderExtUnix::build_gtk(&fixed)` which automatically handles `GtkFixed` container positioning via `put(webview, x, y)` and `set_size_request(w, h)`.
- [2026-11-09] Memory telemetry on Linux will parse `/proc/<pid>/smaps_rollup` for `Pss`, `Private_Clean`, `Private_Dirty`, `Rss`, `Swap`, with fallback to `/proc/<pid>/statm`.
- [2026-11-09] Telemetry text parsers designed as pure functions taking `&str` so they can be unit-tested on Windows without requiring Linux `/proc` filesystem.

## Artifact Index
- `d:\browser\.agents\teamwork\spec_miner_r0_3\DISPATCH.md` — Received dispatch assignment and prompt
- `d:\browser\.agents\teamwork\spec_miner_r0_3\BRIEFING.md` — Situational awareness and identity
- `d:\browser\.agents\teamwork\spec_miner_r0_3\progress.md` — Liveness and task tracking
- `d:\browser\.agents\teamwork\spec_miner_r0_3\survey_r0_linux.md` — Comprehensive Linux architectural specification
- `d:\browser\.agents\teamwork\spec_miner_r0_3\handoff.md` — Self-contained handoff report
