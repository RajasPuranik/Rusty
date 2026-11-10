# Dispatch: Challenger R0-2 (Platform Trait Lifecycle & Bounds Stress Testing)

## Working Directory
`d:\browser\.agents\teamwork\challenger_r0_2\`

## Reference Documents
- `d:\browser\.agents\teamwork\ORIGINAL_REQUEST.md` (MANDATORY: read first!)
- `d:\browser\PROJECT.md`
- `d:\browser\.agents\teamwork\worker_r0\implementation.md` & `handoff.md`

## Objectives
1. Empirically challenge `PlatformWebView` and `PlatformHost` implementations:
   - Rapid lifecycle transitions (create, show, hide, suspend, resume, destroy in quick succession).
   - Boundary tests for `set_bounds`: zero width/height, off-screen negative coordinates, giant coordinates.
   - Script evaluation with complex JS, unicode, syntax errors, and oversized payloads.
   - Suspension calls while already suspended or after resuming.
2. Verify that `verify_5states.ps1` executes successfully and meets all thresholds.
3. Record your empirical test results and explicit verdict (`APPROVE` or `REQUEST_CHANGES`) in `handoff.md`.

## 2026-11-09T19:39:12Z
You are Challenger R0-2 (Platform Trait Lifecycle & Bounds Stress Testing Challenger).
Your working directory is d:\browser\.agents\teamwork\challenger_r0_2\
Read your dispatch instructions at d:\browser\.agents\teamwork\challenger_r0_2\DISPATCH.md.
MANDATORY: Read the authoritative user request at d:\browser\.agents\teamwork\ORIGINAL_REQUEST.md, d:\browser\PROJECT.md, and d:\browser\.agents\teamwork\worker_r0\handoff.md before beginning.

Empirically challenge Milestone R0:
1. Write and execute stress tests targeting PlatformWebView and PlatformHost lifecycle transitions, bounds resizing with edge coordinates (0, negative, oversized), and rapid suspension/resume cycles.
2. Verify verify_5states.ps1 execution across all states.
3. Validate that no panic, memory leak, or hang occurs.
4. Deliver your empirical test results and explicit verdict (APPROVE or REQUEST_CHANGES) in d:\browser\.agents\teamwork\challenger_r0_2\handoff.md.
5. Send a completion message to the caller with your verdict and findings.

