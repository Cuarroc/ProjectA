# Template for the Windows command of every project Codex hook. It runs a
# bash hook script through Git Bash, never through the bare `bash` on PATH:
# on this machine (HOOK-WIN, 2026-10-07) bare `bash` resolves to the
# WindowsApps WSL launcher, which exits 1 without a WSL distribution, so every
# Codex hook that called it failed.
#
# scripts/lib/codex-hooks.mjs prepends `$Script = '<path>'` and passes the
# result as -EncodedCommand, so `.codex/hooks.json` depends on no file of the
# checkout it lives in except the hook script itself (old checkouts too).
#
# Contract (scripts/lib/codex-hooks.test.mjs):
# - Git Bash comes from PROJECTA_GIT_BASH when set, else from the standard Git
#   for Windows locations. PATH is never searched.
# - No Git Bash: one line on stderr and exit 127. The hook fails visibly; it
#   is not skipped.
# - stdin (the hook's JSON event) reaches the script unchanged: the child
#   inherits this process's stdin handle.
# - The child's exit status is returned unchanged; a failing hook never turns
#   into a success.
$ErrorActionPreference = 'Stop'
# Module auto-loading writes progress records; with stderr redirected (always,
# under Codex) PowerShell serializes them as CLIXML noise into the hook output.
$ProgressPreference = 'SilentlyContinue'
$candidates = @()
if ($env:PROJECTA_GIT_BASH) {
  $candidates = @($env:PROJECTA_GIT_BASH)
} else {
  foreach ($base in @($env:ProgramFiles, $env:ProgramW6432, (Join-Path ([string]$env:LOCALAPPDATA) 'Programs'))) {
    if ($base) { $candidates += (Join-Path $base 'Git\bin\bash.exe') }
  }
}
$bash = $candidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
if (-not $bash) {
  [Console]::Error.WriteLine("codex-git-bash-hook: Git Bash not found (checked: $($candidates -join '; ')); hook '$Script' cannot run.")
  exit 127
}
& $bash -- $Script
exit $LASTEXITCODE
