# Dispatch: E2E Test Writer (Test Infrastructure & Tier 1/2 Suite)

## Working Directory
`d:\browser\.agents\teamwork\test_writer_infra\`

## Reference Documents
- `d:\browser\.agents\teamwork\ORIGINAL_REQUEST.md` (MANDATORY: read first!)
- `d:\browser\PROJECT.md`
- `d:\browser\.agents\teamwork\spec_miner_survey_3\survey_spec.md`

## Objectives
1. Design and create the E2E test infrastructure in `d:\browser\tests\e2e\`:
   - Test philosophy: Opaque-box, requirement-driven, derived from `ORIGINAL_REQUEST.md` and `PROJECT.md § Feature Inventory`.
   - Test runner script: runnable via PowerShell / Node / Cargo test, with clean exit code 0 on pass.
2. Produce `TEST_INFRA.md` at project root (`d:\browser\TEST_INFRA.md`) following the exact template from instructions:
   - Test Philosophy & Methodology (Category-Partition + BVA + Pairwise + Workload Testing).
   - Feature Inventory mapping with coverage goals for Tiers 1-4.
   - Test architecture and runner semantics.
   - Real-world application scenarios.
   - Coverage thresholds (minimum 5 per feature for Tier 1 & 2).
3. Implement initial Tier 1 test cases covering baseline features (Platform trait, Process Tree telemetry, Invariants INV-01 through INV-10, mock bridge preview CDP tests).
4. When complete, publish `TEST_READY.md` at project root summarizing test runner command and tier counts.
5. Write handoff to `d:\browser\.agents\teamwork\test_writer_infra\handoff.md`.


## 2026-11-09T17:50:40Z
[Message] timestamp=2026-11-09T17:50:40Z sender=9fd6bf4a-eddf-4493-a145-b4754fea5785 priority=MESSAGE_PRIORITY_HIGH content=You are E2E Test Writer (Test Infrastructure & Initial Suite Writer).
Your working directory is d:\browser\.agents\teamwork\test_writer_infra\
Read your dispatch instructions at d:\browser\.agents\teamwork\test_writer_infra\DISPATCH.md.
MANDATORY: Read the authoritative user request at d:\browser\.agents\teamwork\ORIGINAL_REQUEST.md and d:\browser\PROJECT.md before beginning.

Your task is to establish the E2E Test Track infrastructure:
1. Create d:\browser\TEST_INFRA.md following the exact template from project instructions (Philosophy, Feature Inventory mapping across all 44 features, Test Architecture, Real-World Application Scenarios, Coverage Thresholds).
2. Set up the test directory d:\browser\tests\e2e\ with the test runner and initial test cases.
3. Write initial test cases verifying core invariants (INV-01 through INV-10), mock bridge preview runner, and platform interface compliance.
4. When test infra is established, publish d:\browser\TEST_READY.md summarizing test runner execution command and initial coverage status.
5. Write your self-contained handoff to d:\browser\.agents\teamwork\test_writer_infra\handoff.md.
6. Send a completion message to the caller with your findings and file paths.
