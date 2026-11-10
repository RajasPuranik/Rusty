# Dispatch: Explorer R0-2 (Platform Layer Trait & Windows WebView2 Isolation)

## Working Directory
`d:\browser\.agents\teamwork\explorer_r0_2\`

## Reference Documents
- `d:\browser\.agents\teamwork\ORIGINAL_REQUEST.md` (MANDATORY: read first!)
- `d:\browser\PROJECT.md`
- `d:\browser\.agents\teamwork\explorer_survey_1\survey_backend.md`
- `d:\browser\.agents\teamwork\spec_miner_survey_3\survey_spec.md`

## Objectives
1. Inspect `src/main.rs`, `src/tab.rs`, and existing webview construction.
2. Design the modular `src/platform/` directory and traits:
   - `src/platform/mod.rs`: `PlatformWebView`, `PlatformHost`, `WebViewConfig`, `PlatformError`.
   - `src/platform/windows.rs`: Concrete Windows implementation wrapping `wry::WebView` and COM pointers (`ICoreWebView2Controller`, `ICoreWebView2_3`, `ICoreWebView2_19`).
3. Cover all required capabilities:
   - Webview lifecycle: create, destroy, show, hide, suspend, discard.
   - Layout / bounds updates (`Rect`).
   - Request blocking / interception (navigation handler, URL filtering).
   - Proxy configuration.
   - Cookie management / profile directory isolation.
   - Memory statistics integration.
4. Define clean integration points with `src/main.rs` without breaking existing windowing, split view, or modal occlusion.
5. Provide a step-by-step implementation plan for the Worker.
6. Write findings to `survey_r0_platform.md` and complete handoff in `handoff.md`.


## 2026-11-09T17:50:29Z
[Message from parent 9fd6bf4a-eddf-4493-a145-b4754fea5785]
You are Explorer R0-2 (Platform Layer Trait & Windows WebView2 Isolation Explorer).
Your working directory is d:\browser\.agents\teamwork\explorer_r0_2\
Read your dispatch instructions at d:\browser\.agents\teamwork\explorer_r0_2\DISPATCH.md.
MANDATORY: Read the authoritative user request at d:\browser\.agents\teamwork\ORIGINAL_REQUEST.md and d:\browser\PROJECT.md before beginning.

Your task is to plan the exact architecture and trait definitions for Milestone R0's platform layer:
1. Design src/platform/mod.rs (PlatformWebView and PlatformHost traits covering lifecycle, bounds, interception, proxy, cookies, and memory stats).
2. Design src/platform/windows.rs implementing PlatformWebView and PlatformHost on Windows via wry and WebView2 COM interfaces.
3. Formulate how src/main.rs will cleanly integrate with this platform layer.
4. Provide a step-by-step implementation guide for the Worker.
5. Write your report to d:\browser\.agents\teamwork\explorer_r0_2\survey_r0_platform.md.
6. Write your self-contained handoff to d:\browser\.agents\teamwork\explorer_r0_2\handoff.md.
7. Send a completion message to the caller with your findings and file paths.
