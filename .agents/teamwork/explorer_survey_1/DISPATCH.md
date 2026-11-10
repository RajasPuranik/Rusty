## Task: Rust Backend & Architecture Survey

### Working Directory
`d:\browser\.agents\teamwork\explorer_survey_1\`

### Reference Documents
- `d:\browser\.agents\teamwork\ORIGINAL_REQUEST.md` (Read this first and completely!)

### Objectives
1. Map the existing Rust codebase in `d:\browser`:
   - Inspect `Cargo.toml`, dependencies, build targets, directory structure in `src/`.
   - Inspect how `tao` and `wry` are initialized and configured on Windows (and any existing Linux stubs).
   - Inspect existing IPC communication mechanism, message handlers, and origin checks (`rusty://app/`).
   - Inspect existing security capabilities: V1 ad blocker, V2 VPN/proxy, V3 vault, V4 session protection.
   - Inspect existing memory/benchmark scripts (`benchmark.ps1`, `verify_memory.ps1`).
2. Identify architectural gaps and extension points for:
   - R0: Process-tree memory breakdown, platform layer trait isolating WebView2/WebKitGTK.
   - R1: Workspaces state in Rust, active-only live webview management, crash-safe persistence.
   - R2: WebView2 raw handles (`TrySuspend`, `MemoryUsageTargetLevel`), allocator (`mimalloc`/`jemalloc`).
   - R3: Linux platform abstraction (`WebKitGTK 4.1`, `gtk::Fixed`, Wayland/X11, Secret Service, SOCKS5).
3. Produce a structured analysis report in `survey_backend.md` and complete handoff in `handoff.md`.


## 2026-11-09T17:30:33Z
You are Explorer 1 (Rust Backend & Architecture Explorer).
Your working directory is d:\browser\.agents\teamwork\explorer_survey_1\
Read your dispatch instructions at d:\browser\.agents\teamwork\explorer_survey_1\DISPATCH.md.
MANDATORY: You MUST read the authoritative user request at d:\browser\.agents\teamwork\ORIGINAL_REQUEST.md before beginning.

Your task is to conduct an in-depth survey of the Rust codebase in d:\browser:
1. Examine Cargo.toml, dependencies, source structure in src/, and build configurations.
2. Examine how tao and wry are currently initialized on Windows, the webview window structure, and IPC handling across rusty://app/.
3. Inspect how existing security capabilities are implemented: V1 ad blocker, V2 VPN/proxy, V3 vault, V4 session protection.
4. Inspect existing measurement scripts (benchmark.ps1, verify_memory.ps1) and understand how memory is currently measured and reported.
5. Identify the exact architectural changes required for:
   - R0: Platform abstraction trait (separating WebView2/WebKitGTK lifecycle, bounds, blocking, proxy, cookies, memory stats) and process-tree memory telemetry.
   - R1: Workspaces state in Rust, restoring tabs on switch, destroying webviews for inactive workspaces.
   - R2: WebView2 raw handles (TrySuspend, MemoryUsageTargetLevel), custom allocators (mimalloc/jemalloc).
   - R3: Linux WebKitGTK platform implementation, XDG directories, Secret Service keyring, userspace WireGuard / SOCKS5 proxy.
6. Write your comprehensive findings to d:\browser\.agents\teamwork\explorer_survey_1\survey_backend.md.
7. Write your self-contained handoff to d:\browser\.agents\teamwork\explorer_survey_1\handoff.md following the Handoff Protocol (Observation, Logic Chain, Caveats, Conclusion, Verification).
8. Send a completion message to the caller with your findings and file paths.
