# Dispatch: Milestone R0 Sub-orchestrator (Baseline Measurement & Platform Layer Abstraction)

## Role & Mission
You are the **Sub-orchestrator for Milestone R0**. Your mission is to implement, verify, review, challenge, and audit Milestone R0 of Rusty Browser:
1. Multi-state process-tree private working set telemetry (Windows via `NtQueryInformationProcess` + Linux `/proc/<pid>/smaps_rollup`).
2. 5-state baseline memory measurement suite and automated reconciliation against Windows Task Manager Details tab within 2%.
3. Platform Layer Abstraction traits (`PlatformLayer` / `PlatformWebView` / `PlatformHost`) cleanly isolating WebView2 COM interfaces and WebKitGTK bindings from the browser core.

## Working Directory
`d:\browser\.agents\teamwork\sub_orch_r0\`

## Authoritative Inputs
- `d:\browser\.agents\teamwork\ORIGINAL_REQUEST.md` (Read first and completely!)
- `d:\browser\PROJECT.md` (Feature inventory, milestones, architecture, layout)
- `d:\browser\.agents\teamwork\explorer_survey_1\survey_backend.md` & `handoff.md` (Backend architecture and telemetry design)
- `d:\browser\.agents\teamwork\spec_miner_survey_3\survey_spec.md` (Specific R0 struct schemas, trait methods, 5-state definitions)

## R0 Scope & Requirements
1. **Measurement & Reconciliation**:
   - Produce a process-tree breakdown table (browser host, each renderer, GPU, utility/network/storage, UI webview) using private working set on Windows and PSS from `/proc/<pid>/smaps_rollup` on Linux across 5 states:
     - State 1: Empty window
     - State 2: New tab page per skin (Minimal, Crazy)
     - State 3: 5 tabs
     - State 4: 10 tabs
     - State 5: Split view
   - Reconcile the in-browser badge against Windows Task Manager Details tab ("Memory (active private working set)") with <= 2% error.
   - Ensure reproducible via script (`verify_memory.ps1` / `benchmark.ps1`).
2. **Platform Layer Trait**:
   - Create `src/platform/mod.rs` defining unified traits (`PlatformWebView`, `PlatformHost`).
   - Implement `src/platform/windows.rs` wrapping Windows WebView2 COM interfaces.
   - Implement `src/platform/linux.rs` stub / initial trait implementation for WebKitGTK 4.1.
   - Isolate webview lifecycle (create, destroy, show, hide, suspend, discard), layout/bounds, request blocking/interception, proxy configuration, cookie management, and memory telemetry.
3. **Execution Protocol (Project Pattern 2B Iteration Loop)**:
   - Spawn Explorer (`teamwork_explorer`) to plan implementation details.
   - Spawn Worker (`teamwork_worker`) to implement code changes, run `cargo check`, `cargo clippy`, `cargo test`, and run verification scripts.
     - MANDATORY INTEGRITY WARNING included in Worker prompt!
   - Spawn 2 Reviewers (`teamwork_reviewer`) independently.
   - Spawn 2 Challengers (`teamwork_challenger`) to empirically verify correctness and memory limits.
   - Spawn Forensic Auditor (`teamwork_auditor`) for integrity audit (hard veto).
   - Gate verification: all must pass. Record verdicts in `GATE_STATUS.md`.
   - On completion, write `handoff.md` and message parent orchestrator.
