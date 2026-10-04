# RAM-pressure drill launcher (PowerShell 7); steps: docs/drills/capacity-drill.md
param(
    [Parameter(Mandatory)][string[]]$Project,
    [string]$OutDir,
    [string]$Pa = "pa",
    [string]$AppVersion = "unknown",
    [ValidateSet("on", "off")][string]$Continuous = "off",
    [ValidateRange(30, 600)][int]$Seconds = 600
)
$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw "Node 24+ wird gebraucht (node nicht gefunden)" }
$procFile = Join-Path ([IO.Path]::GetTempPath()) ("projecta-procs-" + [guid]::NewGuid().ToString("n") + ".txt")
Get-Process | Sort-Object ProcessName | Select-Object Id, ProcessName | Out-String | Set-Content $procFile
$argList = @("--pa", $Pa, "--process-list", $procFile, "--app-version", $AppVersion, "--continuous", $Continuous, "--seconds", $Seconds)
foreach ($p in $Project) { $argList += @("--project", $p) }
if ($OutDir) { $argList += @("--out", $OutDir) }
& node (Join-Path $repo "scripts/drills/capacity-drill.mjs") @argList
$code = $LASTEXITCODE
Remove-Item $procFile -ErrorAction SilentlyContinue
exit $code
