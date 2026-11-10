<#
.SYNOPSIS
    Cross-platform PowerShell runner for Rusty Browser E2E Test Suite.
.DESCRIPTION
    Executes the requirement-driven E2E tests, verifying Invariants (INV-01 to INV-10),
    Mock Bridge preview, Platform contracts, and Telemetry reconciliation.
.PARAMETER Filter
    Optional regex/string filter to select specific test suite files (e.g. -Filter invariants).
.PARAMETER Spec
    Enables spec-style verbose test reporter.
.EXAMPLE
    .\tests\e2e\run_tests.ps1
    .\tests\e2e\run_tests.ps1 -Filter invariants
    .\tests\e2e\run_tests.ps1 -Spec
#>

[CmdletBinding()]
param(
    [string]$Filter = "",
    [switch]$Spec = $false
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir = Split-Path -Parent (Split-Path -Parent $ScriptDir)

Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host "  RUSTY BROWSER E2E TEST RUNNER (PowerShell Launcher)" -ForegroundColor Cyan
Write-Host "======================================================================" -ForegroundColor Cyan

# Verify Node.js is available
$NodePath = Get-Command node -ErrorAction SilentlyContinue
if (-not $NodePath) {
    Write-Error "Node.js (node) is not installed or not in PATH. Required for running E2E test runner."
    exit 1
}

$RunnerScript = Join-Path $ScriptDir "runner.js"
if (-not (Test-Path $RunnerScript)) {
    Write-Error "Runner script not found at $RunnerScript"
    exit 1
}

$Arguments = @($RunnerScript)
if ($Filter) {
    $Arguments += @("--filter", $Filter)
}
if ($Spec) {
    $Arguments += @("--spec")
}

Write-Host "Launching: node $Arguments" -ForegroundColor DarkGray
& node $Arguments
$ExitCode = $LASTEXITCODE

if ($ExitCode -eq 0) {
    Write-Host ""
    Write-Host "[PASS] All E2E test suites passed cleanly with exit code 0." -ForegroundColor Green
    exit 0
} else {
    Write-Host ""
    Write-Host "[FAIL] E2E test suite failed with exit code $ExitCode." -ForegroundColor Red
    exit $ExitCode
}
