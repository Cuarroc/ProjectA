# HQ-v1 proof drill launcher (PowerShell 7); steps: docs/drills/hq-proof-drill.md
param(
    [Parameter(Mandatory)][ValidateSet("before", "after")][string]$Phase,
    [Parameter(Mandatory)][string]$Project,
    [string]$OutDir,
    [string]$Pa = "pa",
    [string]$AppVersion = "unknown",
    [string]$Before,
    [string]$Screenshots,
    [string[]]$Pr = @()
)
$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw "Node 24+ wird gebraucht (node nicht gefunden)" }

# Process list for the bundle (names only, no command lines).
$procFile = Join-Path ([IO.Path]::GetTempPath()) ("projecta-procs-" + [guid]::NewGuid().ToString("n") + ".txt")
Get-Process | Sort-Object ProcessName | Select-Object Id, ProcessName | Out-String | Set-Content $procFile

$argList = @("--phase", $Phase, "--project", $Project, "--pa", $Pa, "--process-list", $procFile, "--app-version", $AppVersion)
if ($OutDir) { $argList += @("--out", $OutDir) }
if ($Before) { $argList += @("--before", $Before) }
if ($Screenshots) { $argList += @("--screenshots", $Screenshots) }
foreach ($u in $Pr) { $argList += @("--pr", $u) }

& node (Join-Path $repo "scripts/drills/hq-proof-drill.mjs") @argList
$code = $LASTEXITCODE
Remove-Item $procFile -ErrorAction SilentlyContinue
exit $code
