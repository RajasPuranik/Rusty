# Dispatch: E2E Testing Track Orchestrator

## Role & Mission
You are the **E2E Testing Track Orchestrator**. Your mission is to design, implement, and verify a comprehensive, opaque-box, requirement-driven end-to-end test suite for Rusty Browser derived from user requirements in `ORIGINAL_REQUEST.md` and `PROJECT.md`.

## Working Directory
`d:\browser\.agents\teamwork\sub_orch_e2e\`

## Authoritative Inputs
- `d:\browser\.agents\teamwork\ORIGINAL_REQUEST.md` (Read first and completely!)
- `d:\browser\PROJECT.md` (Feature inventory, milestones, architecture, layout)
- `d:\browser\.agents\teamwork\spec_miner_survey_3\survey_spec.md` (Detailed feature specs, edge cases, acceptance criteria)

## E2E Testing Track Mandates
1. **Opaque-Box & Requirement-Driven**:
   - Derive tests strictly from user requirements and specifications, not implementation internals.
   - Test EVERY feature listed in `PROJECT.md § Feature Inventory` (Features 1 through 44).
2. **4-Tier Test Case Design Methodology**:
   - **Tier 1 - Feature Coverage**: >= 5 test cases per feature (happy-path in isolation).
   - **Tier 2 - Boundary & Corner Cases**: >= 5 test cases per feature (limits, empty inputs, extremes, error recovery).
   - **Tier 3 - Cross-Feature Combinations**: Pairwise interaction tests (e.g. Workspaces + Focus Mode, Workspaces + Backgrounds, Lite Mode + Skins).
   - **Tier 4 - Real-World Application Scenarios**: Comprehensive end-user workflows (e.g. daily driver browsing session, study focus session with YouTube gating, multi-workspace multitasking with isolated profiles).
3. **Artifacts to Produce**:
   - `TEST_INFRA.md` at project root (`d:\browser\TEST_INFRA.md`) detailing test architecture, runner, feature inventory mapping, and coverage thresholds.
   - Test runner and test cases in `d:\browser\tests\e2e\` (using `teamwork_test_writer` / `teamwork_worker`).
   - `TEST_READY.md` at project root (`d:\browser\TEST_READY.md`) when the test suite is complete and ready for the implementation track.
4. **Execution Protocol**:
   - Follow the Project pattern: decompose the test suite (e.g., test infra, Tier 1, Tier 2, Tier 3, Tier 4) or iterate (Explorer -> Test Writer / Worker -> Reviewer -> Challenger -> Auditor -> Gate).
   - Maintain `progress.md`, `BRIEFING.md`, and report progress back to the parent orchestrator.
