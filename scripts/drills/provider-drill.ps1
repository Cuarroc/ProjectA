# Provider drill launcher (PowerShell 7); steps: docs/drills/provider-drill.md
# Two phases around the ONE real run: -Phase Before (read-only), -Phase After (read-only + bundle).
param(
    [Parameter(Mandatory)][ValidateSet("Before", "After")][string]$Phase,
    [Parameter(Mandatory)][ValidateSet("claude", "codex", "opencode")][string]$Adapter,
    [Parameter(Mandatory)][string]$ProjectId,
    [string]$WorkDir = (Join-Path (Get-Location) "provider-drill-work"),
    [string]$OutDir,
    [string]$AppVersion = "unknown",
    [string]$SnapshotFile,
    [string]$SnapshotSource,
    [string]$SnapshotObservedAt
)
$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw "Node 24+ wird gebraucht (node nicht gefunden)" }
if (-not (Get-Command pa -ErrorAction SilentlyContinue)) { throw "Das Kommando pa wird gebraucht (nicht im PATH)" }
New-Item -ItemType Directory -Force $WorkDir | Out-Null
$file = Join-Path $WorkDir "runs-$($Adapter)-$($Phase.ToLower()).json"
# pa reads the descriptor itself; the token is never printed or copied here.
pa hq runs --project $ProjectId | Set-Content $file
if ($LASTEXITCODE -ne 0) { throw "pa hq runs ist fehlgeschlagen (läuft ProjectA?)" }
if ($Phase -eq "Before") { Write-Host "Vorher-Stand gespeichert: $file. Jetzt die eine Aufgabe in ProjectA starten."; exit 0 }

$procFile = Join-Path ([IO.Path]::GetTempPath()) ("projecta-procs-" + [guid]::NewGuid().ToString("n") + ".txt")
Get-Process | Sort-Object ProcessName | Select-Object Id, ProcessName | Out-String | Set-Content $procFile
$argList = @("--adapter", $Adapter, "--before", (Join-Path $WorkDir "runs-$($Adapter)-before.json"), "--after", $file,
    "--process-list", $procFile, "--app-version", $AppVersion)
if ($OutDir) { $argList += @("--out", $OutDir) }
if ($SnapshotFile) { $argList += @("--snapshot", $SnapshotFile) }
if ($SnapshotSource) { $argList += @("--snapshot-source", $SnapshotSource) }
if ($SnapshotObservedAt) { $argList += @("--snapshot-observed-at", $SnapshotObservedAt) }
& node (Join-Path $repo "scripts/drills/provider-drill.mjs") @argList
$code = $LASTEXITCODE
Remove-Item $procFile -ErrorAction SilentlyContinue
exit $code
