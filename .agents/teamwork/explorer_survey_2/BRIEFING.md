# BRIEFING — 2026-11-09T17:48:00Z

## Mission
Frontend UI, Skins & WebGL Explorer for Rusty Browser: in-depth survey of existing UI codebase, mock bridge, skins loading architecture, WebGL/globe, and requirements for R5, R6, R7.

## 🔒 My Identity
- Archetype: explorer
- Roles: frontend UI, skins, and WebGL investigator
- Working directory: d:\browser\.agents\teamwork\explorer_survey_2
- Original parent: 9fd6bf4a-eddf-4493-a145-b4754fea5785
- Milestone: Survey & Planning Phase (R0-R9 preparation, focus on R5, R6, R7 frontend)

## 🔒 Key Constraints
- Read-only investigation — do NOT implement
- Invariant: Only the active skin's code loads into memory
- Invariant: Typed IPC communication across rusty://app/ origin only
- Invariant: Mock bridge preview runs cleanly without console errors
- Single WebGL context rule for backgrounds and globe
- Eco rules: 30 fps cap, pause when hidden, 10 fps idle freeze

## Current Parent
- Conversation ID: 9fd6bf4a-eddf-4493-a145-b4754fea5785
- Updated: 2026-11-09T17:48:00Z

## Investigation State
- **Explored paths**:
  - `d:\browser\ui` (index.html, newtab.html, css/*, js/*, assets/*, IPC_CONTRACT.md)
  - `d:\browser\src\ui\app_protocol.rs` (compile-time embedded UI assets mapping)
  - `d:\browser\src\main.rs` (UiMessage enum and IPC dispatch handlers)
  - Headless Edge DevTools Protocol (CDP) live preview runner test
- **Key findings**:
  - Mock bridge preview runner runs with 0 console errors and 0 exceptions across all configurations (`test_mock_bridge.mjs`).
  - Skin memory invariant enforced in `boot.js` (only active skin CSS and JS loaded; `window.location.replace` purges runtime).
  - All UI assets are compiled into the Rust binary via `src/ui/app_protocol.rs` and served over `rusty://app/`. New files must be added to this router.
  - WebGL globe caps at 30 FPS, unloads with `WEBGL_lose_context` on tab hide/destroy. Night globe upgrade to R8 4096x2048 will consume ~11.2 MB VRAM with mipmaps.
  - Full specifications and architecture for R5 (Softer Dark & Mayank White), R6 (Modular Background Registry & Night Globe), and R7 (Customizable Launch Cards) documented.
- **Unexplored areas**: None within frontend survey scope. Task complete.

## Key Decisions Made
- Executed headless Edge DevTools Protocol (CDP) test to verify zero console errors on mock bridge.
- Calculated exact GPU VRAM math for single-channel R8 night globe texture: 8.39 MB base + mipmaps = 11.18 MB VRAM.
- Identified compile-time static embedding requirement in `src/ui/app_protocol.rs` for any new UI files.

## Artifact Index
- d:\browser\.agents\teamwork\explorer_survey_2\DISPATCH.md — Task assignment and instructions
- d:\browser\.agents\teamwork\explorer_survey_2\BRIEFING.md — Persistent working memory
- d:\browser\.agents\teamwork\explorer_survey_2\progress.md — Liveness heartbeat
- d:\browser\.agents\teamwork\explorer_survey_2\test_mock_bridge.mjs — Automated CDP verification script
- d:\browser\.agents\teamwork\explorer_survey_2\survey_frontend.md — Comprehensive findings
- d:\browser\.agents\teamwork\explorer_survey_2\handoff.md — Self-contained handoff report
