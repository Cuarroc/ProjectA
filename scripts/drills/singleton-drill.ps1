# Singleton drill launcher (PowerShell 7); steps: docs/drills/singleton-drill.md
param(
    [string]$OutDir,
    [string]$AppDir = (Join-Path $env:APPDATA "com.projecta.app"),
    [string]$AppVersion = "unknown"
)
$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw "Node 24+ wird gebraucht (node nicht gefunden)" }
$argList = @("--app-dir", $AppDir, "--app-version", $AppVersion)
if ($OutDir) { $argList += @("--out", $OutDir) }
& node (Join-Path $repo "scripts/drills/singleton-drill.mjs") @argList
exit $LASTEXITCODE
