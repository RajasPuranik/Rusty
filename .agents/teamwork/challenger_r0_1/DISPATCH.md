# Dispatch: Challenger R0-1 (Empirical Telemetry Stress Testing & Invariant Verification)

## Working Directory
`d:\browser\.agents\teamwork\challenger_r0_1\`

## Reference Documents
- `d:\browser\.agents\teamwork\ORIGINAL_REQUEST.md` (MANDATORY: read first!)
- `d:\browser\PROJECT.md`
- `d:\browser\.agents\teamwork\worker_r0\implementation.md` & `handoff.md`

## Objectives
1. Perform empirical verification of telemetry robustness:
   - Write stress test scripts simulating rapid process spawning, abrupt terminations, and PID reuse edge cases.
   - Test telemetry parser robustness against malformed `/proc/<pid>/smaps_rollup` inputs (negative numbers, giant numbers, corrupt headers).
   - Test Task Manager reconciliation variance across rapid window resizes and multi-tab opens.
2. Confirm memory guardrails: Minimal UI webview < 60 MB, Crazy UI webview < 120 MB.
3. Verify that zero unhandled panics or crashes occur.
4. Record your empirical test results and explicit verdict (`APPROVE` or `REQUEST_CHANGES`) in `handoff.md`.

## 2026-11-09T19:39:02Z
From: 9fd6bf4a-eddf-4493-a145-b4754fea5785
Content:
You are Challenger R0-1 (Empirical Telemetry Stress Testing Challenger).
Your working directory is d:\browser\.agents\teamwork\challenger_r0_1\
Read your dispatch instructions at d:\browser\.agents\teamwork\challenger_r0_1\DISPATCH.md.
MANDATORY: Read the authoritative user request at d:\browser\.agents\teamwork\ORIGINAL_REQUEST.md, d:\browser\PROJECT.md, and d:\browser\.agents\teamwork\worker_r0\handoff.md before beginning.

Empirically challenge Milestone R0:
1. Write and execute stress tests targeting telemetry parsing robustness, rapid process creation/destruction, and PID reuse resilience.
2. Stress test the reconciliation calculation under simulated memory pressure.
3. Validate memory guardrails (< 60 MB Minimal, < 120 MB Crazy).
4. Deliver your empirical test results and explicit verdict (APPROVE or REQUEST_CHANGES) in d:\browser\.agents\teamwork\challenger_r0_1\handoff.md.
5. Send a completion message to the caller with your verdict and findings.
