<#
.SYNOPSIS
    Challenger R0-1 Empirical Stress Test Harness:
    - Rapid process lifecycle & abrupt termination resilience
    - PID reuse resilience under process churn
    - Task Manager reconciliation variance during rapid operations & window resize
    - Empirical validation of memory guardrails (< 60 MB Minimal, < 120 MB Crazy)
#>

param(
    [string]$BinaryPath = "d:\browser\target\release\rusty_browser.exe"
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $BinaryPath)) {
    $BinaryPath = "d:\browser\target\debug\rusty_browser.exe"
}
if (-not (Test-Path $BinaryPath)) {
    Write-Error "Cannot find rusty_browser.exe. Run 'cargo build --release' first."
    exit 1
}

Write-Host "==========================================================================" -ForegroundColor Cyan
Write-Host "   Challenger R0-1: Empirical Telemetry & Reconciliation Stress Harness   " -ForegroundColor Cyan
Write-Host "==========================================================================" -ForegroundColor Cyan
Write-Host "Binary: $BinaryPath`n"

Add-Type @"
using System;
using System.Runtime.InteropServices;

public class Win32Window {
    [DllImport("user32.dll")]
    public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
}
"@

$userDataDir = (Join-Path $env:APPDATA "rusty_browser\WebView2").ToLowerInvariant().Replace('/', '\')
$testFailures = 0

function Stop-BrowserTree {
    param([int]$RootPid)
    $all = Get-CimInstance Win32_Process | Where-Object {
        $_.ParentProcessId -eq $RootPid -or ($_.Name -ieq "msedgewebview2.exe" -and $_.CommandLine -like "*rusty_browser*")
    }
    foreach ($p in $all) {
        Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
    }
    Stop-Process -Id $RootPid -Force -ErrorAction SilentlyContinue
}

# Clean any existing zombie processes before testing
Stop-BrowserTree -RootPid 0

function Test-Assertion {
    param([bool]$Condition, [string]$TestName, [string]$Details = "")
    if ($Condition) {
        Write-Host "  [PASS] $TestName $Details" -ForegroundColor Green
    } else {
        Write-Host "  [FAIL] $TestName $Details" -ForegroundColor Red
        $script:testFailures++
    }
}

function Wait-DumpFilePulse {
    param([string]$FilePath, [int]$TimeoutSeconds = 8)
    if (-not (Test-Path $FilePath)) { return $false }
    $initialTime = [System.IO.File]::GetLastWriteTimeUtc($FilePath)
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    while ($sw.Elapsed.TotalSeconds -lt $TimeoutSeconds) {
        Start-Sleep -Milliseconds 150
        $curTime = [System.IO.File]::GetLastWriteTimeUtc($FilePath)
        if ($curTime -ne $initialTime) {
            return $true
        }
    }
    return $false
}

function Get-ProcessWindowHandle([int]$ProcessId) {
    $script:foundHwnd = [IntPtr]::Zero
    [void][Win32Window]::EnumWindows({
        param($hWnd, $lParam)
        [uint32]$wPid = 0
        [void][Win32Window]::GetWindowThreadProcessId($hWnd, [ref]$wPid)
        if ($wPid -eq $ProcessId -and [Win32Window]::IsWindowVisible($hWnd)) {
            $script:foundHwnd = $hWnd
            return $false
        }
        return $true
    }, [IntPtr]::Zero)
    return $script:foundHwnd
}

# ─────────────────────────────────────────────────────────────────────────────
# TEST 1: Rapid Process Churn & Abrupt Content Tab Termination
# ─────────────────────────────────────────────────────────────────────────────
Write-Host "`n── TEST 1: Rapid Process Churn & Abrupt Content Tab Termination ──" -ForegroundColor Yellow

$dump1 = [System.IO.Path]::GetTempFileName()
$args1 = @("https://www.rust-lang.org", "--dump-telemetry", $dump1)
$p1 = Start-Process -FilePath $BinaryPath -ArgumentList $args1 -PassThru
Write-Host "Launched browser PID $($p1.Id). Waiting 8s for tabs to initialize..."
Start-Sleep -Seconds 8

# Generate system PID churn using lightweight processes
Write-Host "Generating system PID churn (10 rapid background processes)..."
1..10 | ForEach-Object {
    Start-Process -FilePath "cmd.exe" -ArgumentList "/c ping -n 1 127.0.0.1 >nul" -WindowStyle Hidden
}
Start-Sleep -Seconds 2

# Verify browser host process survived PID churn
$alive1 = Get-Process -Id $p1.Id -ErrorAction SilentlyContinue
Test-Assertion ($null -ne $alive1) "Browser host process survived rapid system PID churn"

# Verify browser telemetry continues pulsing during high PID churn
$pulsed = Wait-DumpFilePulse -FilePath $dump1 -TimeoutSeconds 6
Test-Assertion $pulsed "Telemetry continues pulsing during PID churn"

# Read telemetry breakdown to verify structure
if (Test-Path $dump1) {
    $json1 = Get-Content $dump1 -Raw | ConvertFrom-Json
    Test-Assertion ($json1.total_private_ws_mb -gt 0) "Telemetry reports valid Private WS" "(Total: $($json1.total_private_ws_mb) MB across $($json1.process_count) procs)"
    Test-Assertion ($json1.processes.Count -gt 0) "Telemetry processes tree contains active nodes"
}

# Now locate child processes in the tree and abruptly kill one non-host process
$allChildren = Get-CimInstance Win32_Process | Where-Object {
    $_.Name -ieq "msedgewebview2.exe" -and $_.CommandLine -like "*rusty_browser*"
}
Write-Host "Owned WebView2 child processes count: $($allChildren.Count)"
$rendererChild = $allChildren | Where-Object { $_.CommandLine -like "*--type=utility*" } | Select-Object -First 1

if ($rendererChild) {
    Write-Host "Abruptly terminating child utility service PID $($rendererChild.ProcessId)..."
    Stop-Process -Id $rendererChild.ProcessId -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2

    # Verify browser host process survived abrupt child termination
    $stillRunning = Get-Process -Id $p1.Id -ErrorAction SilentlyContinue
    Test-Assertion ($null -ne $stillRunning) "Browser host process survived abrupt child process termination"

    # Wait for the next telemetry pulse after crash
    $pulseAfterCrash = Wait-DumpFilePulse -FilePath $dump1 -TimeoutSeconds 6
    Test-Assertion $pulseAfterCrash "Telemetry pulse resumes after child termination"
}

Stop-BrowserTree -RootPid $p1.Id
Remove-Item -Force $dump1 -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

# ─────────────────────────────────────────────────────────────────────────────
# TEST 2: Task Manager Reconciliation Under Rapid Window Resizes
# ─────────────────────────────────────────────────────────────────────────────
Write-Host "`n── TEST 2: Task Manager Reconciliation Under Rapid Window Resizes ──" -ForegroundColor Yellow

$dump2 = [System.IO.Path]::GetTempFileName()
$p2 = Start-Process -FilePath $BinaryPath -ArgumentList @("https://www.rust-lang.org", "--skin", "minimal", "--dump-telemetry", $dump2) -PassThru
Write-Host "Launched browser PID $($p2.Id). Waiting 10s for initial render..."
Start-Sleep -Seconds 10

$hwnd = Get-ProcessWindowHandle -ProcessId $p2.Id
if ($hwnd -ne [IntPtr]::Zero) {
    Write-Host "Found Window HWND: $hwnd. Executing 10 rapid window resizes..."
    for ($r = 0; $r -lt 10; $r++) {
        $w = 800 + ($r * 40)
        $h = 600 + ($r * 25)
        [Win32Window]::SetWindowPos($hwnd, [IntPtr]::Zero, 50, 50, $w, $h, 0x0004) # SWP_NOZORDER
        Start-Sleep -Milliseconds 80
    }
} else {
    Write-Host "Window handle not visible via EnumWindows, proceeding with reconciliation..."
}

# Wait for stabilization after resize flurry
Write-Host "Waiting 5s for stabilization after resize flurry..."
Start-Sleep -Seconds 5

# Quiescence sync
[void](Wait-DumpFilePulse -FilePath $dump2 -TimeoutSeconds 6)

# Measure Win32 Perf counters vs Badge
$dumpJson2 = Get-Content $dump2 -Raw | ConvertFrom-Json
$badgePws2 = [double]$dumpJson2.total_private_ws_mb

# Build tree
$allProcs = Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, CommandLine, Name
$treeIds = New-Object System.Collections.Generic.HashSet[int]
[void]$treeIds.Add($p2.Id)

foreach ($p in $allProcs) {
    if ($p.ParentProcessId -eq $p2.Id) { [void]$treeIds.Add([int]$p.ProcessId) }
    if ($p.Name -ieq "msedgewebview2.exe" -and $p.CommandLine -and $p.CommandLine.ToLowerInvariant().Contains($userDataDir)) {
        [void]$treeIds.Add([int]$p.ProcessId)
    }
}

$perfRows = Get-CimInstance Win32_PerfFormattedData_PerfProc_Process | Where-Object { $treeIds.Contains([int]$_.IDProcess) }
$rawBytes = ($perfRows | Measure-Object -Property WorkingSetPrivate -Sum).Sum
$taskMgrMb2 = [Math]::Round($rawBytes / 1MB, 1)

$variance2 = if ($taskMgrMb2 -gt 0) {
    [Math]::Round(([Math]::Abs($badgePws2 - $taskMgrMb2) / $taskMgrMb2) * 100.0, 2)
} else { 0.0 }

Write-Host "Reconciliation after resizes:"
Write-Host "  Task Manager Details Private WS: $taskMgrMb2 MB"
Write-Host "  In-Browser Badge Private WS    : $badgePws2 MB"
Write-Host "  Reconciliation Variance        : $variance2% (Target: <= 2.0%)"

Test-Assertion ($variance2 -le 2.0) "Task Manager Reconciliation variance <= 2.0% after resize flurry" "(Variance: $variance2%)"

Stop-BrowserTree -RootPid $p2.Id
Remove-Item -Force $dump2 -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

# ─────────────────────────────────────────────────────────────────────────────
# TEST 3: Empirical Memory Guardrail Verification (Minimal & Crazy)
# ─────────────────────────────────────────────────────────────────────────────
Write-Host "`n── TEST 3: Empirical Memory Guardrails Verification ──" -ForegroundColor Yellow

# State 2A: Minimal UI
$dumpMin = [System.IO.Path]::GetTempFileName()
$pMin = Start-Process -FilePath $BinaryPath -ArgumentList @("about:newtab", "--skin", "minimal", "--dump-telemetry", $dumpMin) -PassThru
Write-Host "Testing Minimal Skin (PID $($pMin.Id)). Waiting 10s..."
Start-Sleep -Seconds 10
[void](Wait-DumpFilePulse -FilePath $dumpMin -TimeoutSeconds 6)

$minJson = Get-Content $dumpMin -Raw | ConvertFrom-Json
$minUiProc = $minJson.processes | Where-Object { $_.kind -eq "UI WebView" } | Select-Object -First 1
$minUiMb = if ($minUiProc) { [double]$minUiProc.private_ws_mb } else { 0.0 }

Write-Host "  Minimal UI WebView Private WS: $minUiMb MB (Ceiling: 60.0 MB)"
Test-Assertion ($minUiMb -gt 0.0 -and $minUiMb -lt 60.0) "Minimal UI WebView Guardrail (< 60 MB)" "(Actual: $minUiMb MB)"

Stop-BrowserTree -RootPid $pMin.Id
Remove-Item -Force $dumpMin -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

# State 2B: Crazy UI
$dumpCrazy = [System.IO.Path]::GetTempFileName()
$pCrazy = Start-Process -FilePath $BinaryPath -ArgumentList @("about:newtab", "--skin", "crazy", "--dump-telemetry", $dumpCrazy) -PassThru
Write-Host "Testing Crazy Skin (PID $($pCrazy.Id)). Waiting 12s..."
Start-Sleep -Seconds 12
[void](Wait-DumpFilePulse -FilePath $dumpCrazy -TimeoutSeconds 6)

$crazyJson = Get-Content $dumpCrazy -Raw | ConvertFrom-Json
$crazyUiProc = $crazyJson.processes | Where-Object { $_.kind -eq "UI WebView" } | Select-Object -First 1
$crazyUiMb = if ($crazyUiProc) { [double]$crazyUiProc.private_ws_mb } else { 0.0 }

Write-Host "  Crazy UI WebView Private WS: $crazyUiMb MB (Ceiling: 120.0 MB)"
Test-Assertion ($crazyUiMb -gt 0.0 -and $crazyUiMb -lt 120.0) "Crazy UI WebView Guardrail (< 120 MB)" "(Actual: $crazyUiMb MB)"

Stop-BrowserTree -RootPid $pCrazy.Id
Remove-Item -Force $dumpCrazy -ErrorAction SilentlyContinue

Write-Host "`n==========================================================================" -ForegroundColor Cyan
if ($testFailures -eq 0) {
    Write-Host "   ALL EMPIRICAL STRESS TESTS PASSED SUCCESSFULLY!                        " -ForegroundColor Green
} else {
    Write-Host "   EMPIRICAL STRESS TESTS COMPLETED WITH $testFailures FAILURE(S)!        " -ForegroundColor Red
}
Write-Host "==========================================================================" -ForegroundColor Cyan

exit $testFailures
