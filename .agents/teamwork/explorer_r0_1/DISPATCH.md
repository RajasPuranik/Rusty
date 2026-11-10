# Dispatch: Explorer R0-1 (Process Tree Telemetry & 5-State Measurement)

## Working Directory
`d:\browser\.agents\teamwork\explorer_r0_1\`

## Reference Documents
- `d:\browser\.agents\teamwork\ORIGINAL_REQUEST.md` (MANDATORY: read first!)
- `d:\browser\PROJECT.md`
- `d:\browser\.agents\teamwork\explorer_survey_1\survey_backend.md`
- `d:\browser\.agents\teamwork\spec_miner_survey_3\survey_spec.md`

## Objectives
1. Inspect `src/telemetry.rs`, `verify_memory.ps1`, `benchmark.ps1`.
2. Detail the exact implementation required to produce the process-tree breakdown table (browser host, each renderer, GPU, utility/network/storage, UI webview, Rust shell) using private working set on Windows and PSS from `/proc/<pid>/smaps_rollup` on Linux.
3. Formulate the exact test procedure across the 5 states:
   - State 1: Empty window
   - State 2: New tab page per skin (Minimal, Crazy)
   - State 3: 5 tabs
   - State 4: 10 tabs
   - State 5: Split view
4. Provide the exact strategy to automate measurement and reconcile the in-browser badge against Windows Task Manager Details tab ("Memory (active private working set)") with <= 2% variance, ranking top consumers.
5. Provide a step-by-step implementation plan for the Worker.
6. Write findings to `survey_r0_telemetry.md` and complete handoff in `handoff.md`.


## 2026-11-09T17:50:24Z
[Message from 9fd6bf4a-eddf-4493-a145-b4754fea5785]
You are Explorer R0-1 (Process Tree Telemetry & 5-State Measurement Explorer).
Your working directory is d:\browser\.agents\teamwork\explorer_r0_1\
Read your dispatch instructions at d:\browser\.agents\teamwork\explorer_r0_1\DISPATCH.md.
MANDATORY: Read the authoritative user request at d:\browser\.agents\teamwork\ORIGINAL_REQUEST.md and d:\browser\PROJECT.md before beginning.

Your task is to plan the exact implementation for Milestone R0's measurement & telemetry:
1. Review src/telemetry.rs and verify_memory.ps1.
2. Detail the process-tree breakdown table across 5 states:
   - State 1: Empty window
   - State 2: New tab page per skin (Minimal, Crazy)
   - State 3: 5 tabs
   - State 4: 10 tabs
   - State 5: Split view
3. Formulate the verification script and Task Manager reconciliation methodology (<= 2% variance on active private working set).
4. Write your report to d:\browser\.agents\teamwork\explorer_r0_1\survey_r0_telemetry.md.
5. Write your self-contained handoff to d:\browser\.agents\teamwork\explorer_r0_1\handoff.md.
6. Send a completion message to the caller with your findings and file paths.
