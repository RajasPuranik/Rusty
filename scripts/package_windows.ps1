# Rusty Browser - Windows Distribution Packaging Script
# Compiles release binary and bundles it with WebView2Loader.dll, license, and verification tools.

param (
    [switch]$SkipBuild = $false
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir = Split-Path -Parent $ScriptDir
$DistDir = Join-Path $RootDir "dist"
$StageDir = Join-Path $DistDir "rusty_browser-windows-x64"
$ZipFile = Join-Path $DistDir "rusty_browser-windows-x64.zip"

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  RUSTY BROWSER - WINDOWS DISTRIBUTION PACKAGER" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan

if (-not $SkipBuild) {
    Write-Host "[1/5] Building release binary with Cargo..." -ForegroundColor Yellow
    Push-Location $RootDir
    cargo build --release
    Pop-Location
} else {
    Write-Host "[1/5] Skipping Cargo release build (-SkipBuild specified)" -ForegroundColor Gray
}

$ExePath = Join-Path $RootDir "target\release\rusty_browser.exe"
$LoaderCandidates = @(
    (Join-Path $RootDir "target\release\WebView2Loader.dll"),
    (Join-Path $RootDir "WebView2Loader.dll"),
    (Join-Path $RootDir "dist\WebView2Loader.dll")
)

$FoundLoader = $null
foreach ($cand in $LoaderCandidates) {
    if (Test-Path $cand) {
        $FoundLoader = $cand
        break
    }
}

if (-not (Test-Path $ExePath)) {
    throw "Release executable not found at: $ExePath. Run without -SkipBuild."
}

if (-not $FoundLoader) {
    throw "CRITICAL: WebView2Loader.dll not found in target/release, root, or dist! Windows execution requires this DLL."
}

Write-Host "[2/5] Creating distribution staging directory..." -ForegroundColor Yellow
if (Test-Path $StageDir) {
    Remove-Item -Recurse -Force $StageDir
}
New-Item -ItemType Directory -Force -Path $StageDir | Out-Null

Write-Host "[3/5] Bundling executable, WebView2Loader.dll, and documentation..." -ForegroundColor Yellow
Copy-Item $ExePath -Destination (Join-Path $StageDir "rusty_browser.exe")
Copy-Item $FoundLoader -Destination (Join-Path $StageDir "WebView2Loader.dll")

if (Test-Path (Join-Path $RootDir "README.md")) {
    Copy-Item (Join-Path $RootDir "README.md") -Destination (Join-Path $StageDir "README.md")
}
if (Test-Path (Join-Path $RootDir "LICENSE")) {
    Copy-Item (Join-Path $RootDir "LICENSE") -Destination (Join-Path $StageDir "LICENSE")
}
if (Test-Path (Join-Path $RootDir "verify_memory.ps1")) {
    Copy-Item (Join-Path $RootDir "verify_memory.ps1") -Destination (Join-Path $StageDir "verify_memory.ps1")
}

Write-Host "[4/5] Generating ZIP archive: $ZipFile..." -ForegroundColor Yellow
if (Test-Path $ZipFile) {
    Remove-Item -Force $ZipFile
}
Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::CreateFromDirectory($StageDir, $ZipFile)

Write-Host "[5/5] Verifying archive contents..." -ForegroundColor Yellow
$Archive = [System.IO.Compression.ZipFile]::OpenRead($ZipFile)
$Entries = $Archive.Entries | Select-Object -Property FullName, Length
$Archive.Dispose()

$Entries | Format-Table -AutoSize

$HasExe = $Entries | Where-Object { $_.FullName -eq "rusty_browser.exe" }
$HasLoader = $Entries | Where-Object { $_.FullName -eq "WebView2Loader.dll" }

if (-not $HasExe -or -not $HasLoader) {
    throw "Verification failed: Archive missing required binaries!"
}

Write-Host "============================================================" -ForegroundColor Green
Write-Host "  SUCCESS: Distribution package verified and ready!" -ForegroundColor Green
Write-Host "  Location: $ZipFile" -ForegroundColor Green
Write-Host "  Note: WebView2Loader.dll is bundled alongside rusty_browser.exe" -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Green
