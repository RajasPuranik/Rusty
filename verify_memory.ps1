<#
.SYNOPSIS
    Independently verifies Rusty Browser's process-tree Private Working Set,
    Working Set, and Commit memory from Windows performance counters.

.DESCRIPTION
    Walks the real process tree rooted at rusty_browser.exe (plus any sibling
    msedgewebview2.exe processes matching Rusty's unique --user-data-dir) and
    queries Win32_PerfFormattedData_PerfProc_Process for:
      - WorkingSetPrivate  (Task Manager Details "Memory (active private working set)")
      - WorkingSet         (Shared + Private physical pages)
      - PrivateBytes       (Commit charge)
    Also reports excluded unrelated msedgewebview2.exe processes (e.g. Teams,
    Widgets, Edge) and live chrome.exe whole-tree Private WS comparison.
#>
param(
    [Alias("ProcessId")]
    [int]$TargetPid = 0,
    [string]$UserDataDir = ""
)

$ErrorActionPreference = "Stop"

function Normalize-PathMatch([string]$PathStr) {
    if ([string]::IsNullOrWhiteSpace($PathStr)) { return "" }
    return $PathStr.Trim().Trim('"').Replace('/', '\').ToLowerInvariant()
}

function Classify-RustyProcess([string]$Name, [string]$CmdLine, [bool]$IsHost, [int]$TargetProcessId = 0, [int]$EarliestRendererPid = 0) {
    if ($IsHost -or $Name -ieq "rusty_browser.exe") { return "Host (Rusty)" }
    $cmd = if ($CmdLine) { $CmdLine.ToLowerInvariant() } else { "" }
    if ($Name -ieq "msedgewebview2.exe") {
        if ($cmd -match "--type=renderer") {
            if ($EarliestRendererPid -ne 0 -and $TargetProcessId -eq $EarliestRendererPid) {
                return "UI WebView"
            }
            return "Content Renderer"
        }
        if ($cmd -match "--type=gpu-process") { return "GPU Process" }
        if ($cmd -match "--utility-sub-type=network\.mojom\.networkservice") { return "Network Service" }
        if ($cmd -match "--utility-sub-type=storage\.mojom\.storageservice") { return "Storage Service" }
        if ($cmd -match "--utility-sub-type=audio\.mojom\.audioservice") { return "Audio Service" }
        if ($cmd -match "--type=utility") { return "Utility Process" }
        if ($cmd -match "--type=crashpad-handler") { return "Crashpad Handler" }
        if ($cmd -match "--type=") { return "WebView2 Helper" }
        return "WebView2 Manager"
    }
    if ($cmd -match "--type=crashpad-handler") { return "Crashpad Handler" }
    return $Name
}

function Test-ValidChildProcess($ParentProc, $ChildProc) {
    if (-not $ParentProc -or -not $ChildProc) { return $false }
    if (-not $ParentProc.CreationDate -or -not $ChildProc.CreationDate) { return $false }
    return ([datetime]$ChildProc.CreationDate -ge [datetime]$ParentProc.CreationDate)
}

$allProcs = Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, CreationDate, Name, CommandLine
if ($TargetPid -le 0) {
    $hostProc = $allProcs | Where-Object { $_.Name -ieq "rusty_browser.exe" } | Select-Object -First 1
    if (-not $hostProc) {
        Write-Host "ERROR: No running rusty_browser.exe process found. Launch Rusty Browser or pass -TargetPid <PID>." -ForegroundColor Red
        exit 1
    }
    $TargetPid = [int]$hostProc.ProcessId
}

# Build parent -> children lookup
$childrenByParent = @{}
$procById = @{}
foreach ($p in $allProcs) {
    $id = [int]$p.ProcessId
    $ppid = [int]$p.ParentProcessId
    $procById[$id] = $p
    if (-not $childrenByParent.ContainsKey($ppid)) {
        $childrenByParent[$ppid] = New-Object System.Collections.Generic.List[int]
    }
    $childrenByParent[$ppid].Add($id)
}

if (-not $procById.ContainsKey($TargetPid)) {
    Write-Host "ERROR: PID $TargetPid is not running." -ForegroundColor Red
    exit 1
}

# 1) BFS walk of the real PID tree rooted at rusty_browser.exe (CreationDate-validated against PID reuse)
$treeIds = New-Object System.Collections.Generic.HashSet[int]
$queue = New-Object System.Collections.Generic.Queue[int]
[void]$treeIds.Add($TargetPid)
$queue.Enqueue($TargetPid)
while ($queue.Count -gt 0) {
    $curr = $queue.Dequeue()
    $currProc = $procById[$curr]
    if ($childrenByParent.ContainsKey($curr)) {
        foreach ($cid in $childrenByParent[$curr]) {
            if ($cid -ne 0 -and (Test-ValidChildProcess $currProc $procById[$cid]) -and $treeIds.Add($cid)) {
                $queue.Enqueue($cid)
            }
        }
    }
}

# Infer explicit, live-child, or default --user-data-dir for strict WebView2 isolation
$normDataDir = Normalize-PathMatch $UserDataDir
if ([string]::IsNullOrEmpty($normDataDir)) {
    $rootCmd = [string]$procById[$TargetPid].CommandLine
    if ($rootCmd -match '--user-data-dir(?:=|\s+)"?([^"\r\n]+)') {
        $normDataDir = Normalize-PathMatch $matches[1]
    }
}
if ([string]::IsNullOrEmpty($normDataDir)) {
    foreach ($tid in $treeIds) {
        $tcmd = [string]$procById[$tid].CommandLine
        if ($tcmd -match '--user-data-dir(?:=|\s+)"([^"]+)"' -or $tcmd -match '--user-data-dir(?:=|\s+)(\S+)') {
            $normDataDir = Normalize-PathMatch $matches[1]
            break
        }
    }
}
if ([string]::IsNullOrEmpty($normDataDir)) {
    $candidate = Join-Path $env:APPDATA "rusty_browser\webview_data"
    if (Test-Path $candidate) {
        $normDataDir = Normalize-PathMatch $candidate
    } else {
        $candidate2 = Join-Path $env:APPDATA "rusty_browser\WebView2"
        if (Test-Path $candidate2) {
            $normDataDir = Normalize-PathMatch $candidate2
        }
    }
}

# 2) Also attach any child/sibling spawned by WebView2 runtime under Rusty's exact --user-data-dir (and their valid descendants)
if (-not [string]::IsNullOrEmpty($normDataDir)) {
    foreach ($p in $allProcs) {
        if ($p.Name -ine "msedgewebview2.exe") { continue }
        $cmdNorm = Normalize-PathMatch ([string]$p.CommandLine)
        if ($cmdNorm.Contains("--user-data-dir") -and $cmdNorm.Contains($normDataDir)) {
            $id = [int]$p.ProcessId
            if ($treeIds.Add($id)) {
                $q2 = New-Object System.Collections.Generic.Queue[int]
                $q2.Enqueue($id)
                while ($q2.Count -gt 0) {
                    $c = $q2.Dequeue()
                    $cProc = $procById[$c]
                    if ($childrenByParent.ContainsKey($c)) {
                        foreach ($cid in $childrenByParent[$c]) {
                            if ($cid -ne 0 -and (Test-ValidChildProcess $cProc $procById[$cid]) -and $treeIds.Add($cid)) {
                                $q2.Enqueue($cid)
                            }
                        }
                    }
                }
            }
        }
    }
}

# Query live per-process Private Working Set, Working Set, and Private Bytes (Commit)
$perfRows = Get-CimInstance Win32_PerfFormattedData_PerfProc_Process |
    Where-Object { $_.IDProcess -gt 0 } |
    Select-Object IDProcess, Name, WorkingSetPrivate, WorkingSet, PrivateBytes

$perfByPid = @{}
foreach ($r in $perfRows) {
    $perfByPid[[int]$r.IDProcess] = $r
}

$rendererPids = @()
foreach ($id in $treeIds) {
    $proc = $procById[$id]
    if ($proc) {
        $cmdLower = if ($proc.CommandLine) { $proc.CommandLine.ToLowerInvariant() } else { "" }
        if ($cmdLower -match "--type=renderer") {
            $rendererPids += [PSCustomObject]@{
                PID = $id
                CreationDate = if ($proc.CreationDate) { [datetime]$proc.CreationDate } else { [datetime]::MaxValue }
            }
        }
    }
}
$rendererPids = @($rendererPids | Sort-Object CreationDate)
$earliestRendererPid = if ($rendererPids.Count -gt 0) { $rendererPids[0].PID } else { 0 }

$rows = @()
$sumPrivateWs = 0.0
$sumWs = 0.0
$sumCommit = 0.0
$hostPrivateWs = 0.0

foreach ($id in $treeIds) {
    $proc = $procById[$id]
    $perf = $perfByPid[$id]
    if (-not $proc -or -not $perf) { continue }

    $pwsMb = [Math]::Round(([double]$perf.WorkingSetPrivate) / 1MB, 1)
    $wsMb = [Math]::Round(([double]$perf.WorkingSet) / 1MB, 1)
    $commitMb = [Math]::Round(([double]$perf.PrivateBytes) / 1MB, 1)
    $isHost = ($id -eq $TargetPid)
    $role = Classify-RustyProcess $proc.Name ([string]$proc.CommandLine) $isHost $id $earliestRendererPid

    $sumPrivateWs += $pwsMb
    $sumWs += $wsMb
    $sumCommit += $commitMb
    if ($isHost) { $hostPrivateWs = $pwsMb }

    $rows += [PSCustomObject]@{
        Role          = $role
        Exe           = $proc.Name
        PID           = $id
        PPID          = [int]$proc.ParentProcessId
        PrivateWS_MB  = $pwsMb
        WorkingSet_MB = $wsMb
        Commit_MB     = $commitMb
        _SortOrder    = $(if ($isHost) { 0 } else { 1 })
    }
}

$rows = @($rows | Sort-Object _SortOrder, @{Expression="PrivateWS_MB"; Descending=$true})

Write-Host ""
Write-Host "=== Rusty Browser Process Tree Memory (Windows Perf Counters) ===" -ForegroundColor Cyan
Write-Host ("Root PID        : {0}" -f $TargetPid)
if (-not [string]::IsNullOrEmpty($normDataDir)) {
    Write-Host ("WebView DataDir : {0}" -f $normDataDir)
}
Write-Host ("Process Count   : {0}" -f $rows.Count)
Write-Host ""
$rows | Select-Object Role, Exe, PID, PPID, PrivateWS_MB, WorkingSet_MB, Commit_MB | Format-Table -AutoSize

Write-Host "── Top 5 Process Consumers ──────────────────────────────────────────────" -ForegroundColor Yellow
$rows | Sort-Object -Property PrivateWS_MB -Descending | Select-Object -First 5 Role, Exe, PID, PrivateWS_MB, WorkingSet_MB, Commit_MB | Format-Table -AutoSize

Write-Host ("TOTAL Private Working Set (Task Mgr 'Memory') : {0:N1} MB  (Host: {1:N1} MB, Children: {2:N1} MB)" -f $sumPrivateWs, $hostPrivateWs, ($sumPrivateWs - $hostPrivateWs)) -ForegroundColor Green
Write-Host ("TOTAL Working Set (incl. shared DLL/GPU pages): {0:N1} MB" -f $sumWs)
Write-Host ("TOTAL Private Commit                          : {0:N1} MB" -f $sumCommit)

# Check unrelated msedgewebview2.exe on system to show why matching by exe name alone over-counts
$otherWv = @($allProcs | Where-Object { $_.Name -ieq "msedgewebview2.exe" -and -not $treeIds.Contains([int]$_.ProcessId) })
$otherWvPws = 0.0
foreach ($o in $otherWv) {
    $op = $perfByPid[[int]$o.ProcessId]
    if ($op) { $otherWvPws += ([double]$op.WorkingSetPrivate) / 1MB }
}
Write-Host ""
Write-Host ("Excluded unrelated msedgewebview2.exe on PC  : {0} procs ({1:N1} MB Private WS NOT belonging to Rusty)" -f $otherWv.Count, $otherWvPws) -ForegroundColor Yellow

# Compare with Chrome's real process tree if running (same Private WS metric & CreationDate validation)
$chromeRootProcs = @($allProcs | Where-Object { $_.Name -ieq "chrome.exe" })
if ($chromeRootProcs.Count -gt 0) {
    $chromeTree = New-Object System.Collections.Generic.HashSet[int]
    $cq = New-Object System.Collections.Generic.Queue[int]
    foreach ($cp in $chromeRootProcs) {
        $cid = [int]$cp.ProcessId
        if ($cid -ne 0 -and -not $treeIds.Contains($cid) -and $chromeTree.Add($cid)) { $cq.Enqueue($cid) }
    }
    while ($cq.Count -gt 0) {
        $c = $cq.Dequeue()
        $cProc = $procById[$c]
        if ($childrenByParent.ContainsKey($c)) {
            foreach ($kid in $childrenByParent[$c]) {
                if ($kid -ne 0 -and -not $treeIds.Contains($kid) -and (Test-ValidChildProcess $cProc $procById[$kid]) -and $chromeTree.Add($kid)) {
                    $cq.Enqueue($kid)
                }
            }
        }
    }
    $chromePws = 0.0
    foreach ($cid in $chromeTree) {
        $cpPerf = $perfByPid[$cid]
        if ($cpPerf) { $chromePws += ([double]$cpPerf.WorkingSetPrivate) / 1MB }
    }
    $diffPct = if ($chromePws -gt 0.5) { (($chromePws - $sumPrivateWs) / $chromePws) * 100.0 } else { 0.0 }
    Write-Host ("Live Chrome Tree (Private Working Set)        : {0:N1} MB across {1} procs ({2:N1}% difference)" -f $chromePws, $chromeTree.Count, $diffPct) -ForegroundColor Cyan
} else {
    Write-Host "Live Chrome Tree                              : chrome.exe not currently running"
}

Write-Host ""
Write-Host "Task Manager Note:" -ForegroundColor DarkGray
Write-Host "  - Processes tab may show rusty_browser.exe as ~2-4 MB (host only) if msedgewebview2.exe children appear in another group." -ForegroundColor DarkGray
Write-Host "  - Open Task Manager -> Details tab -> right-click columns -> Select 'Memory (active private working set)' and match PIDs above." -ForegroundColor DarkGray
