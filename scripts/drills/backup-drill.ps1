# Backup drill launcher (PowerShell 7); steps: docs/drills/backup-drill.md
param(
    [string]$OutDir,
    [string]$AppDir = (Join-Path $env:APPDATA "com.projecta.app"),
    [string]$AppVersion = "unknown",
    [switch]$AllowRunning
)
$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw "Node 24+ wird gebraucht (node nicht gefunden)" }

# Process list for the bundle (names only, no command lines).
$procFile = Join-Path ([IO.Path]::GetTempPath()) ("projecta-procs-" + [guid]::NewGuid().ToString("n") + ".txt")
Get-Process | Sort-Object ProcessName | Select-Object Id, ProcessName | Out-String | Set-Content $procFile

$argList = @("--app-dir", $AppDir, "--process-list", $procFile, "--app-version", $AppVersion)
if ($OutDir) { $argList += @("--out", $OutDir) }
if ($AllowRunning) { $argList += "--allow-running" }

& node (Join-Path $repo "scripts/drills/backup-drill.mjs") @argList
$code = $LASTEXITCODE
Remove-Item $procFile -ErrorAction SilentlyContinue
exit $code
