# ==============================================================================
# Rusty Browser vs Google Chrome — Memory & Cold-Start Benchmark
# ==============================================================================

param(
    [int]$StabilizationSeconds = 15,
    [switch]$SkipColdStart = $false
)

$ErrorActionPreference = "Continue"

Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host "   Rusty Browser vs Google Chrome Benchmark Tool" -ForegroundColor Cyan
Write-Host "=================================================================" -ForegroundColor Cyan

# ── Locate executables ────────────────────────────────────────────────────────
$rustyExe = "d:\browser\target\release\rusty_browser.exe"
if (-not (Test-Path $rustyExe)) {
    Write-Error "Rusty Browser release binary not found at $rustyExe. Run 'cargo build --release' first."
    exit 1
}

$chromeCandidates = @(
    "${env:ProgramFiles}\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "${env:LOCALAPPDATA}\Google\Chrome\Application\chrome.exe"
)
$chromeExe = $null
foreach ($c in $chromeCandidates) {
    if (Test-Path $c) {
        $chromeExe = $c
        break
    }
}

if (-not $chromeExe) {
    Write-Error "Google Chrome executable not found."
    exit 1
}

Write-Host "[info] Rusty Browser: $rustyExe"
Write-Host "[info] Google Chrome: $chromeExe"

# ── 10 Benchmark URLs ─────────────────────────────────────────────────────────
$testUrls = @(
    "https://www.youtube.com",
    "https://www.instagram.com",
    "https://accounts.google.com",
    "https://en.wikipedia.org/wiki/Rust_(programming_language)",
    "https://github.com/rust-lang/rust",
    "https://www.bbc.com",
    "https://www.reddit.com",
    "https://news.ycombinator.com",
    "https://www.rust-lang.org",
    "https://stackoverflow.com/questions"
)

# ── Helper: Measure Process Tree Memory ───────────────────────────────────────
function Get-ProcessTreeStats {
    param(
        [int]$RootPid,
        [string]$ProcessNameFilter
    )

    $pidsToScan = [System.Collections.Generic.HashSet[int]]::new()
    $pidsToScan.Add($RootPid) | Out-Null

    # Query all processes once
    $allProcesses = Get-CimInstance Win32_Process

    # Find all descendants recursively
    $queue = [System.Collections.Queue]::new()
    $queue.Enqueue($RootPid)

    while ($queue.Count -gt 0) {
        $curr = $queue.Dequeue()
        $children = $allProcesses | Where-Object { $_.ParentProcessId -eq $curr }
        foreach ($child in $children) {
            if ($pidsToScan.Add($child.ProcessId)) {
                $queue.Enqueue($child.ProcessId)
            }
        }
    }

    # If WebView2 or Chrome spawn unparented or broker processes, also check filter
    if ($ProcessNameFilter) {
        $matching = $allProcesses | Where-Object { $_.Name -like "*$ProcessNameFilter*" }
        foreach ($m in $matching) {
            # Check if command line contains browser markers
            if ($m.CommandLine -like "*rusty_browser*" -or $m.CommandLine -like "*EBWebView*" -or $m.CommandLine -like "*chrome_bench*") {
                $pidsToScan.Add($m.ProcessId) | Out-Null
            }
        }
    }

    $totalWorkingSet = 0
    $totalPrivateBytes = 0
    $processCount = 0

    foreach ($pidNum in $pidsToScan) {
        $proc = Get-Process -Id $pidNum -ErrorAction SilentlyContinue
        if ($proc) {
            $totalWorkingSet += $proc.WorkingSet64
            $totalPrivateBytes += $proc.PrivateMemorySize64
            $processCount++
        }
    }

    return [PSCustomObject]@{
        ProcessCount = $processCount
        WorkingSetMB = [math]::Round($totalWorkingSet / 1MB, 2)
        PrivateMB    = [math]::Round($totalPrivateBytes / 1MB, 2)
        Pids         = @($pidsToScan)
    }
}

# ── 1. Cold-Start Measurement ─────────────────────────────────────────────────
$rustyColdStartMs = 0
$chromeColdStartMs = 0

if (-not $SkipColdStart) {
    Write-Host "`n[1/3] Measuring Cold-Start Times (Window paint / responsive)..." -ForegroundColor Yellow

    # Measure Rusty Browser
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $proc = Start-Process -FilePath $rustyExe -ArgumentList "about:blank" -PassThru
    try { $proc.WaitForInputIdle(5000) | Out-Null } catch {}
    $sw.Stop()
    $rustyColdStartMs = $sw.ElapsedMilliseconds
    Write-Host "  -> Rusty Browser start time: ${rustyColdStartMs} ms"
    Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2

    # Measure Chrome
    $tempUserData = Join-Path $env:TEMP "chrome_start_bench"
    Remove-Item -Recurse -Force $tempUserData -ErrorAction SilentlyContinue
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $proc = Start-Process -FilePath $chromeExe -ArgumentList "--user-data-dir=`"$tempUserData`"", "--no-first-run", "--no-default-browser-check", "about:blank" -PassThru
    try { $proc.WaitForInputIdle(5000) | Out-Null } catch {}
    $sw.Stop()
    $chromeColdStartMs = $sw.ElapsedMilliseconds
    Write-Host "  -> Google Chrome start time: ${chromeColdStartMs} ms"
    Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
    Remove-Item -Recurse -Force $tempUserData -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
}

# ── 2. Chrome: 10 Tabs Benchmark ──────────────────────────────────────────────
Write-Host "`n[2/3] Benchmarking Google Chrome with 10 tabs..." -ForegroundColor Yellow
$chromeUserData = Join-Path $env:TEMP "chrome_bench_data"
Remove-Item -Recurse -Force $chromeUserData -ErrorAction SilentlyContinue

$chromeArgs = @(
    "--user-data-dir=`"$chromeUserData`"",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking"
) + $testUrls

$chromeProc = Start-Process -FilePath $chromeExe -ArgumentList $chromeArgs -PassThru
Write-Host "  -> Launched Chrome (PID $($chromeProc.Id)). Waiting ${StabilizationSeconds}s for 10 tabs to settle..."
Start-Sleep -Seconds $StabilizationSeconds

$chromeStats = Get-ProcessTreeStats -RootPid $chromeProc.Id -ProcessNameFilter "chrome"
Write-Host "  -> Chrome Process Tree:" -ForegroundColor Green
Write-Host "     Processes   : $($chromeStats.ProcessCount)"
Write-Host "     Working Set : $($chromeStats.WorkingSetMB) MB (RSS)"
Write-Host "     Private RAM : $($chromeStats.PrivateMB) MB"

# Clean up Chrome
foreach ($p in $chromeStats.Pids) {
    Stop-Process -Id $p -Force -ErrorAction SilentlyContinue
}
Stop-Process -Id $chromeProc.Id -Force -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force $chromeUserData -ErrorAction SilentlyContinue
Start-Sleep -Seconds 3

# ── 3. Rusty Browser: 10 Tabs Benchmark ───────────────────────────────────────
Write-Host "`n[3/3] Benchmarking Rusty Browser with 10 tabs..." -ForegroundColor Yellow

$rustyProc = Start-Process -FilePath $rustyExe -ArgumentList $testUrls -PassThru
Write-Host "  -> Launched Rusty Browser (PID $($rustyProc.Id)). Waiting ${StabilizationSeconds}s for tabs to settle..."
Start-Sleep -Seconds $StabilizationSeconds

$rustyStats = Get-ProcessTreeStats -RootPid $rustyProc.Id -ProcessNameFilter "msedgewebview2"
Write-Host "  -> Rusty Browser Process Tree (Rust + System WebView2):" -ForegroundColor Green
Write-Host "     Processes   : $($rustyStats.ProcessCount)"
Write-Host "     Working Set : $($rustyStats.WorkingSetMB) MB (RSS)"
Write-Host "     Private RAM : $($rustyStats.PrivateMB) MB"

# Clean up Rusty Browser
foreach ($p in $rustyStats.Pids) {
    Stop-Process -Id $p -Force -ErrorAction SilentlyContinue
}
Stop-Process -Id $rustyProc.Id -Force -ErrorAction SilentlyContinue

# ── Comparison & Report ───────────────────────────────────────────────────────
$wsSaved = [math]::Round($chromeStats.WorkingSetMB - $rustyStats.WorkingSetMB, 2)
$wsPercent = [math]::Round(($wsSaved / $chromeStats.WorkingSetMB) * 100, 1)

$privSaved = [math]::Round($chromeStats.PrivateMB - $rustyStats.PrivateMB, 2)
$privPercent = if ($chromeStats.PrivateMB -gt 0) {
    [math]::Round(($privSaved / $chromeStats.PrivateMB) * 100, 1)
} else { 0 }

Write-Host "`n=================================================================" -ForegroundColor Cyan
Write-Host "                     BENCHMARK RESULTS" -ForegroundColor Cyan
Write-Host "=================================================================" -ForegroundColor Cyan

$formatTable = @(
    [PSCustomObject]@{
        Metric = "Cold Start Time"
        "Google Chrome" = "${chromeColdStartMs} ms"
        "Rusty Browser" = "${rustyColdStartMs} ms"
        "Difference / Savings" = if ($rustyColdStartMs -lt $chromeColdStartMs) { "-$([math]::Round(($chromeColdStartMs - $rustyColdStartMs)/$chromeColdStartMs*100, 1))% faster" } else { "N/A" }
    },
    [PSCustomObject]@{
        Metric = "Process Count"
        "Google Chrome" = "$($chromeStats.ProcessCount) processes"
        "Rusty Browser" = "$($rustyStats.ProcessCount) processes"
        "Difference / Savings" = "-$($chromeStats.ProcessCount - $rustyStats.ProcessCount) procs"
    },
    [PSCustomObject]@{
        Metric = "Working Set (RSS)"
        "Google Chrome" = "$($chromeStats.WorkingSetMB) MB"
        "Rusty Browser" = "$($rustyStats.WorkingSetMB) MB"
        "Difference / Savings" = "-${wsSaved} MB (-${wsPercent}%)"
    },
    [PSCustomObject]@{
        Metric = "Private Memory"
        "Google Chrome" = "$($chromeStats.PrivateMB) MB"
        "Rusty Browser" = "$($rustyStats.PrivateMB) MB"
        "Difference / Savings" = "-${privSaved} MB (-${privPercent}%)"
    }
)

$formatTable | Format-Table -AutoSize

if ($wsPercent -ge 15.0) {
    Write-Host ">>> TARGET MET: Rusty Browser uses $wsPercent% less RAM than Google Chrome (Goal: >=15%) <<<" -ForegroundColor Green
} else {
    Write-Host ">>> NOTICE: RAM savings ($wsPercent%) is below 15% target. Profiling required. <<<" -ForegroundColor Yellow
}
Write-Host "=================================================================`n" -ForegroundColor Cyan
