# Dispatch: Spec Miner R0-3 (Linux WebKitGTK 4.1 Trait Contract & Cross-Platform Parity)

## Working Directory
`d:\browser\.agents\teamwork\spec_miner_r0_3\`

## Reference Documents
- `d:\browser\.agents\teamwork\ORIGINAL_REQUEST.md` (MANDATORY: read first!)
- `d:\browser\PROJECT.md`
- `d:\browser\.agents\teamwork\spec_miner_survey_3\survey_spec.md`

## Objectives
1. Inspect `src/platform/` requirements for Linux WebKitGTK 4.1 via wry `build_gtk` with `gtk::Fixed` container.
2. Design `src/platform/linux.rs` conforming to the unified `PlatformWebView` / `PlatformHost` traits.
3. Detail how the platform trait will support Linux:
   - Webview lifecycle under GTK (container attach/detach, show/hide, destroy).
   - Layout / bounds in `gtk::Fixed` container (pixel positioning vs `Rect`).
   - Request blocking / content filter compilation (`WebKitUserContentFilterStore`).
   - SOCKS5 proxy configuration via `WebKitNetworkProxySettings`.
   - Memory sampling from `/proc/<pid>/smaps_rollup` (replacing the hardcoded dummy stub in `src/telemetry.rs:208-222`).
4. Ensure conditional compilation flags (`#[cfg(target_os = "windows")]`, `#[cfg(target_os = "linux")]`) compile cleanly on Windows without breaking `cargo check` and `cargo test`.
5. Provide a step-by-step implementation plan for the Worker.
6. Write findings to `survey_r0_linux.md` and complete handoff in `handoff.md`.


## 2026-11-09T17:50:34Z
You are Spec Miner R0-3 (Linux WebKitGTK 4.1 Trait Contract & Cross-Platform Parity Miner).
Your working directory is d:\browser\.agents\teamwork\spec_miner_r0_3\
Read your dispatch instructions at d:\browser\.agents\teamwork\spec_miner_r0_3\DISPATCH.md.
MANDATORY: Read the authoritative user request at d:\browser\.agents\teamwork\ORIGINAL_REQUEST.md and d:\browser\PROJECT.md before beginning.

Your task is to plan the Linux side of Milestone R0:
1. Design src/platform/linux.rs conforming to PlatformWebView and PlatformHost via wry build_gtk and gtk::Fixed container.
2. Design the cross-platform memory telemetry in src/telemetry.rs using /proc/<pid>/smaps_rollup on Linux to replace the dummy fallback stub.
3. Verify that conditional compilation flags (#[cfg(target_os = "windows")], #[cfg(target_os = "linux")]) allow Windows compilation to pass cargo check/test cleanly without broken symbols.
4. Provide a step-by-step implementation guide for the Worker.
5. Write your report to d:\browser\.agents\teamwork\spec_miner_r0_3\survey_r0_linux.md.
6. Write your self-contained handoff to d:\browser\.agents\teamwork\spec_miner_r0_3\handoff.md.
7. Send a completion message to the caller with your findings and file paths.
