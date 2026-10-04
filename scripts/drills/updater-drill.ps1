# Updater drill launcher (PowerShell 7); steps: docs/drills/updater-drill.md
param(
    [Parameter(Mandatory)][ValidateSet("success", "cancel", "fail")][string]$Scenario,
    [string]$OutDir,
    [string]$AppDir = (Join-Path $env:APPDATA "com.projecta.app"),
    [string]$OldVersion = "unknown",
    [string]$NewVersion = "unknown",
    [string]$ObservedUi = "",
    [int]$TimeoutMin = 10
)
$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw "Node 24+ wird gebraucht (node nicht gefunden)" }

# Process list for the bundle (names only, no command lines).
$procFile = Join-Path ([IO.Path]::GetTempPath()) ("projecta-procs-" + [guid]::NewGuid().ToString("n") + ".txt")
Get-Process | Sort-Object ProcessName | Select-Object Id, ProcessName | Out-String | Set-Content $procFile

$argList = @("--app-dir", $AppDir, "--scenario", $Scenario, "--process-list", $procFile, "--old-version", $OldVersion,
    "--new-version", $NewVersion, "--observed-ui", $ObservedUi, "--timeout-min", $TimeoutMin)
if ($OutDir) { $argList += @("--out", $OutDir) }

& node (Join-Path $repo "scripts/drills/updater-drill.mjs") @argList
$code = $LASTEXITCODE
Remove-Item $procFile -ErrorAction SilentlyContinue
exit $code
