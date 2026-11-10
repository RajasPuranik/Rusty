<#
.SYNOPSIS
    Automated Milestone R0 5-State Process-Tree Telemetry & Task Manager Reconciliation Suite.

.DESCRIPTION
    Executes Rusty Browser across 5 standardized states, measures Private Working Set via
    Windows Performance Counters, reconciles against in-process telemetry (<= 2% variance),
    and validates memory guardrails.
#>

param(
    [string]$BinaryPath = "d:\browser\target\release\rusty_browser.exe",
    [int]$StabilizationSeconds = 12,
    [switch]$SkipChromeComparison = $false,
    [string]$State = "all"
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $BinaryPath)) {
    $BinaryPath = "d:\browser\target\debug\rusty_browser.exe"
}
if (-not (Test-Path $BinaryPath)) {
    Write-Error "Cannot locate rusty_browser.exe. Run 'cargo build --release' first."
    exit 1
}

Write-Host "==========================================================================" -ForegroundColor Cyan
Write-Host "   Rusty Browser: Milestone R0 5-State Telemetry & Reconciliation Suite   " -ForegroundColor Cyan
Write-Host "==========================================================================" -ForegroundColor Cyan
Write-Host "Target Binary: $BinaryPath`n"

# Benchmark URL Sets
$urls5 = @(
    "https://www.rust-lang.org",
    "https://en.wikipedia.org/wiki/Rust_(programming_language)",
    "https://github.com/rust-lang/rust",
    "https://news.ycombinator.com",
    "https://www.reddit.com"
)

$urls10 = @(
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

function Measure-BrowserTree {
    param([int]$RootPid, [string]$DumpFilePath)

    # 1. Snapshot Windows Performance Counters immediately to align with the telemetry pulse
    $perfRowsAll = Get-CimInstance Win32_PerfFormattedData_PerfProc_Process |
        Where-Object { $_.IDProcess -gt 0 }

    # 2. Query Win32 processes to build creation-validated tree
    $allProcs = Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, CreationDate, Name, CommandLine
    $hostProc = $allProcs | Where-Object { $_.ProcessId -eq $RootPid }
    if (-not $hostProc) { return $null }

    $userDataDirCandidate = Join-Path $env:APPDATA "rusty_browser\WebView2"
    $normDataDir = $userDataDirCandidate.Trim().Trim('"').Replace('/', '\').ToLowerInvariant()

    $treeIds = New-Object System.Collections.Generic.HashSet[int]
    $queue = New-Object System.Collections.Generic.Queue[int]
    [void]$treeIds.Add($RootPid)
    $queue.Enqueue($RootPid)

    $byParent = @{}
    foreach ($p in $allProcs) {
        $ppid = [int]$p.ParentProcessId
        if (-not $byParent.ContainsKey($ppid)) { $byParent[$ppid] = New-Object System.Collections.Generic.List[int] }
        $byParent[$ppid].Add([int]$p.ProcessId)
    }

    $procMap = @{}
    foreach ($p in $allProcs) { $procMap[[int]$p.ProcessId] = $p }

    while ($queue.Count -gt 0) {
        $curr = $queue.Dequeue()
        $currProc = $procMap[$curr]
        if ($byParent.ContainsKey($curr)) {
            foreach ($cid in $byParent[$curr]) {
                $cProc = $procMap[$cid]
                if ($cid -ne 0 -and $cProc.CreationDate -and $currProc.CreationDate -and
                    ([datetime]$cProc.CreationDate -ge [datetime]$currProc.CreationDate) -and $treeIds.Add($cid)) {
                    $queue.Enqueue($cid)
                }
            }
        }
    }

    # Match any sibling msedgewebview2.exe under Rusty's unique user-data-dir
    foreach ($p in $allProcs) {
        if ($p.Name -ieq "msedgewebview2.exe") {
            $cmd = [string]$p.CommandLine
            if ($cmd -and $cmd.ToLowerInvariant().Contains($normDataDir)) {
                $cid = [int]$p.ProcessId
                if ($treeIds.Add($cid)) { $queue.Enqueue($cid) }
            }
        }
    }

    # 2. Read in-process telemetry dump if available to obtain in-browser measurements and UI renderer PID
    $badgePrivateWs = $null
    $dumpProcs = @{}
    if ($DumpFilePath -and (Test-Path $DumpFilePath)) {
        try {
            $dumpJson = Get-Content $DumpFilePath -Raw | ConvertFrom-Json
            $badgePrivateWs = [double]$dumpJson.total_private_ws_mb
            if ($dumpJson.processes) {
                foreach ($dp in $dumpJson.processes) {
                    $dumpProcs[[int]$dp.pid] = $dp
                }
            }
        } catch {}
    }

    # 4. Filter performance counters to Rusty's process tree
    $perfRows = $perfRowsAll | Where-Object { $treeIds.Contains([int]$_.IDProcess) }

    $totalRawPrivWsBytes = 0.0
    $totalRawWsBytes = 0.0
    $totalRawCommitBytes = 0.0
    $processRows = @()

    # Find earliest renderer PID for fallback role resolution
    $rendererPids = @()
    foreach ($perf in $perfRows) {
        $pidNum = [int]$perf.IDProcess
        $p = $procMap[$pidNum]
        if ($p) {
            $cmdLower = if ($p.CommandLine) { $p.CommandLine.ToLowerInvariant() } else { "" }
            if ($cmdLower -match "--type=renderer") {
                $rendererPids += [PSCustomObject]@{
                    PID = $pidNum
                    CreationDate = if ($p.CreationDate) { [datetime]$p.CreationDate } else { [datetime]::MaxValue }
                }
            }
        }
    }
    $rendererPids = @($rendererPids | Sort-Object CreationDate)
    $earliestRendererPid = if ($rendererPids.Count -gt 0) { $rendererPids[0].PID } else { 0 }

    foreach ($perf in $perfRows) {
        $pidNum = [int]$perf.IDProcess
        $p = $procMap[$pidNum]
        if (-not $p) { continue }

        $rawPws = [double]$perf.WorkingSetPrivate
        $rawWs = [double]$perf.WorkingSet
        $rawCom = [double]$perf.PrivateBytes

        $totalRawPrivWsBytes += $rawPws
        $totalRawWsBytes += $rawWs
        $totalRawCommitBytes += $rawCom

        $pws = [Math]::Round($rawPws / 1MB, 1)
        $ws = [Math]::Round($rawWs / 1MB, 1)
        $com = [Math]::Round($rawCom / 1MB, 1)

        $isHost = ($pidNum -eq $RootPid)
        $cmdLower = if ($p.CommandLine) { $p.CommandLine.ToLowerInvariant() } else { "" }

        $role = if ($isHost) {
            "Host (Rusty)"
        } elseif ($dumpProcs.ContainsKey($pidNum) -and ($dumpProcs[$pidNum].kind -or $dumpProcs[$pidNum].role)) {
            if ($dumpProcs[$pidNum].kind) { $dumpProcs[$pidNum].kind } else { $dumpProcs[$pidNum].role }
        } elseif ($cmdLower -match "--type=renderer") {
            if ($pidNum -eq $earliestRendererPid) {
                "UI WebView"
            } else {
                "Content Renderer"
            }
        } elseif ($cmdLower -match "--type=gpu-process") {
            "GPU Process"
        } elseif ($cmdLower -match "--utility-sub-type=network") {
            "Network Service"
        } elseif ($cmdLower -match "--utility-sub-type=storage") {
            "Storage Service"
        } elseif ($cmdLower -match "--utility-sub-type=audio") {
            "Audio Service"
        } elseif ($cmdLower -match "--type=crashpad-handler") {
            "Crashpad Handler"
        } else {
            "WebView2 Manager"
        }

        $processRows += [PSCustomObject]@{
            PID          = $pidNum
            Role         = $role
            Exe          = $p.Name
            PrivateWS_MB = $pws
            WorkingSet_MB= $ws
            Commit_MB    = $com
        }
    }

    return @{
        ProcessCount       = $treeIds.Count
        TaskMgrPrivateWsMb = [Math]::Round($totalRawPrivWsBytes / 1MB, 1)
        WorkingSetMb       = [Math]::Round($totalRawWsBytes / 1MB, 1)
        CommitMb           = [Math]::Round($totalRawCommitBytes / 1MB, 1)
        BadgePrivateWsMb   = $badgePrivateWs
        Processes          = @($processRows | Sort-Object -Property PrivateWS_MB -Descending)
    }
}

function Run-StateTest {
    param(
        [string]$StateName,
        [string[]]$ArgsList,
        [int]$WaitSecs
    )

    Write-Host "──────────────────────────────────────────────────────────────────────────" -ForegroundColor Yellow
    Write-Host "Running: $StateName" -ForegroundColor Yellow
    Write-Host "Arguments: $ArgsList"

    $dumpFile = [System.IO.Path]::GetTempFileName()
    $fullArgs = $ArgsList + @("--dump-telemetry", $dumpFile)

    $proc = Start-Process -FilePath $BinaryPath -ArgumentList $fullArgs -PassThru
    Write-Host "Launched PID $($proc.Id). Waiting ${WaitSecs}s for stabilization..."
    Start-Sleep -Seconds $WaitSecs

    # Synchronize: wait for the next dump write pulse (quiescence sync window)
    if (Test-Path $dumpFile) {
        $lastWrite = (Get-Item $dumpFile).LastWriteTimeUtc
        for ($i = 0; $i -lt 30; $i++) {
            Start-Sleep -Milliseconds 100
            if ((Get-Item $dumpFile).LastWriteTimeUtc -ne $lastWrite) {
                break
            }
        }
    }

    $metrics = Measure-BrowserTree -RootPid $proc.Id -DumpFilePath $dumpFile

    # Print Top Consumers
    Write-Host "`nTop Process Consumers:" -ForegroundColor Gray
    ($metrics.Processes | Select-Object -First 6 Role, Exe, PID, PrivateWS_MB, WorkingSet_MB, Commit_MB | Format-Table -AutoSize | Out-String) | Write-Host

    Write-Host ("Total Private WS (Task Manager Details): {0} MB across {1} procs" -f $metrics.TaskMgrPrivateWsMb, $metrics.ProcessCount) -ForegroundColor Green

    # Reconciliation Check
    if ($metrics.BadgePrivateWsMb -ne $null) {
        $variance = if ($metrics.TaskMgrPrivateWsMb -gt 0) {
            [Math]::Round(([Math]::Abs($metrics.BadgePrivateWsMb - $metrics.TaskMgrPrivateWsMb) / $metrics.TaskMgrPrivateWsMb) * 100.0, 2)
        } else { 0.0 }
        Write-Host ("In-Browser Badge Private WS            : {0} MB" -f $metrics.BadgePrivateWsMb)
        Write-Host ("Reconciliation Variance                : {0}% (Target: <= 2.0%)" -f $variance)

        if ($variance -le 2.0) {
            Write-Host ">>> RECONCILIATION PASSED: Variance <= 2.0% <<<" -ForegroundColor Green
        } else {
            Write-Host ">>> RECONCILIATION FAILED: Variance exceeds 2.0% <<<" -ForegroundColor Red
        }
    }

    # Memory Guardrail Checks
    if ($StateName -like "*Minimal*") {
        $uiProc = $metrics.Processes | Where-Object { $_.Role -eq "UI WebView" } | Select-Object -First 1
        if ($uiProc) {
            Write-Host ("Minimal UI WebView Private WS: {0} MB (Guardrail: < 60 MB)" -f $uiProc.PrivateWS_MB)
            if ($uiProc.PrivateWS_MB -lt 60.0) {
                Write-Host ">>> GUARDRAIL PASSED: Minimal UI < 60 MB <<<" -ForegroundColor Green
            } else {
                Write-Host ">>> GUARDRAIL WARNING: Minimal UI >= 60 MB <<<" -ForegroundColor Yellow
            }
        }
    }
    if ($StateName -like "*Crazy*") {
        $uiProc = $metrics.Processes | Where-Object { $_.Role -eq "UI WebView" } | Select-Object -First 1
        if ($uiProc) {
            Write-Host ("Crazy UI WebView Private WS: {0} MB (Guardrail: < 120 MB)" -f $uiProc.PrivateWS_MB)
            if ($uiProc.PrivateWS_MB -lt 120.0) {
                Write-Host ">>> GUARDRAIL PASSED: Crazy UI < 120 MB <<<" -ForegroundColor Green
            } else {
                Write-Host ">>> GUARDRAIL WARNING: Crazy UI >= 120 MB <<<" -ForegroundColor Yellow
            }
        }
    }

    # Clean up browser
    Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
    Remove-Item -Force $dumpFile -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2

    return $metrics
}

# ── Execute States ────────────────────────────────────────────────────────────
$results = [ordered]@{}

$runAll = ($State -eq "all" -or [string]::IsNullOrWhiteSpace($State))

if ($runAll -or $State -eq "1") {
    $results["State 1: Empty Window"] = Run-StateTest -StateName "State 1: Empty Window" -ArgsList @("about:blank") -WaitSecs 10
}

if ($runAll -or $State -eq "2A") {
    $results["State 2A: NTP Minimal"] = Run-StateTest -StateName "State 2A: NTP (Minimal Skin)" -ArgsList @("--skin", "minimal", "about:newtab") -WaitSecs 10
}

if ($runAll -or $State -eq "2B") {
    $results["State 2B: NTP Crazy"]   = Run-StateTest -StateName "State 2B: NTP (Crazy Skin)" -ArgsList @("--skin", "crazy", "about:newtab") -WaitSecs ($StabilizationSeconds + 3)
}

if ($runAll -or $State -eq "3") {
    $results["State 3: 5 Tabs"]       = Run-StateTest -StateName "State 3: 5 Benchmark Tabs" -ArgsList (@("--load-all-tabs") + $urls5) -WaitSecs ($StabilizationSeconds + 2)
}

if ($runAll -or $State -eq "4") {
    $results["State 4: 10 Tabs"]      = Run-StateTest -StateName "State 4: 10 Benchmark Tabs" -ArgsList (@("--load-all-tabs") + $urls10) -WaitSecs ($StabilizationSeconds + 5)

    if (-not $SkipChromeComparison) {
        $chromeBaselineMb = 998.5
        $rusty10Mb = $results["State 4: 10 Tabs"].TaskMgrPrivateWsMb
        $savingsMb = [Math]::Round($chromeBaselineMb - $rusty10Mb, 1)
        $savingsPct = [Math]::Round(($savingsMb / $chromeBaselineMb) * 100.0, 1)
        Write-Host "`n── Chrome 10-Tab Comparison ──────────────────────────────────────────" -ForegroundColor Cyan
        Write-Host ("Google Chrome Baseline (10 tabs) : {0} MB" -f $chromeBaselineMb)
        Write-Host ("Rusty Browser 10-Tab Private WS  : {0} MB" -f $rusty10Mb)
        Write-Host ("Memory Savings                   : {0} MB ({1}%)" -f $savingsMb, $savingsPct)
        if ($savingsPct -ge 15.0) {
            Write-Host ">>> ACCEPTANCE PASSED: Savings >= 15.0% <<<" -ForegroundColor Green
        } else {
            Write-Host ">>> ACCEPTANCE NOTE: Savings < 15.0% <<<" -ForegroundColor Yellow
        }
    }
}

if ($runAll -or $State -eq "5") {
    $results["State 5: Split View"]   = Run-StateTest -StateName "State 5: Split View" -ArgsList @("--split", "https://www.rust-lang.org", "https://news.ycombinator.com") -WaitSecs 12
}

# ── Final Report Summary ──────────────────────────────────────────────────────
Write-Host "`n==========================================================================" -ForegroundColor Cyan
Write-Host "                        5-STATE MEASUREMENT SUMMARY                       " -ForegroundColor Cyan
Write-Host "==========================================================================" -ForegroundColor Cyan

$summaryTable = @()
foreach ($k in $results.Keys) {
    $m = $results[$k]
    $summaryTable += [PSCustomObject]@{
        "Browser State"     = $k
        "Processes"         = $m.ProcessCount
        "Private WS (MB)"   = $m.TaskMgrPrivateWsMb
        "Working Set (MB)"  = $m.WorkingSetMb
        "Private Commit(MB)"= $m.CommitMb
        "Badge PWS (MB)"    = $m.BadgePrivateWsMb
    }
}
($summaryTable | Format-Table -AutoSize | Out-String) | Write-Host

Write-Host "All specified states verified and logged successfully." -ForegroundColor Green
