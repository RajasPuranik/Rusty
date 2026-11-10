# Dispatch: Forensic Auditor R0 (Integrity Verification Audit)

## Working Directory
`d:\browser\.agents\teamwork\auditor_r0\`

## Reference Documents
- `d:\browser\.agents\teamwork\ORIGINAL_REQUEST.md` (MANDATORY: read first!)
- `d:\browser\PROJECT.md`
- `d:\browser\.agents\teamwork\worker_r0\implementation.md` & `handoff.md`

## Objectives
Execute full forensic integrity audit on all changes made for Milestone R0:
1. **Anti-Facading & Genuine Logic Check**:
   - Inspect `src/platform/mod.rs`, `src/platform/windows.rs`, `src/platform/linux.rs`. Verify genuine COM / GTK calls; no fake/noop facades.
   - Inspect `src/telemetry.rs`. Verify genuine Win32 `NtQueryInformationProcess` calls and genuine `/proc/<pid>/smaps_rollup` parsers.
   - Inspect `verify_5states.ps1`. Verify that performance counter queries and in-process telemetry reading are genuine and not faked or hardcoded.
2. **Hardcoded Values & Cheating Detection**:
   - Search for hardcoded memory values (e.g. `14.2`, `34.3`, `147.9`), fake reconciliation strings, or bypassed assertions.
   - Confirm that variance calculations in `verify_5states.ps1` dynamically calculate `[math]::Abs(...)`.
3. **Core Invariant Compliance**:
   - INV-01: Only active skin code loads into memory.
   - INV-02: Typed IPC across `rusty://app/` origin only.
   - INV-03: Mock bridge runs with zero console errors.
   - INV-04 to INV-10 compliance.
4. Record your explicit verdict (`CLEAN` or `INTEGRITY VIOLATION`) with full supporting evidence in `handoff.md`.


## 2026-11-09T19:39:18Z
You are Forensic Auditor R0 (Milestone R0 Integrity Verification Auditor).
Your working directory is d:\browser\.agents\teamwork\auditor_r0\
Read your dispatch instructions at d:\browser\.agents\teamwork\auditor_r0\DISPATCH.md.
MANDATORY: Read the authoritative user request at d:\browser\.agents\teamwork\ORIGINAL_REQUEST.md, d:\browser\PROJECT.md, and d:\browser\.agents\teamwork\worker_r0\handoff.md before beginning.

Execute the full forensic integrity audit on Milestone R0:
1. Verify genuine implementations vs no-op facades:
   - Check src/platform/mod.rs, src/platform/windows.rs, src/platform/linux.rs for real COM / GTK calls.
   - Check src/telemetry.rs for real Win32 NtQueryInformationProcess and real /proc/<pid>/smaps_rollup parsing.
   - Check verify_5states.ps1 for genuine CIM performance counter queries and dynamic variance calculation.
2. Search for any hardcoded memory values, bypassed assertions, or cheating.
3. Verify compliance with core invariants INV-01 through INV-10.
4. Deliver your forensic audit report with explicit verdict (CLEAN or INTEGRITY VIOLATION) in d:\browser\.agents\teamwork\auditor_r0\handoff.md.
5. Send a completion message to the caller with your verdict and evidence.
