# Isolated Golden Path subset. Never opens production app data.
# Creates a project through pa (POST /api/projects) against a scratch git repo,
# then tries a direct succeed-profile spawn (Sanierungsplan section 7 step 1, no orchestrator).
# Attention / review / merge stay UI-only.
param()

$ErrorActionPreference = "Stop"

$repo = Split-Path -Parent $PSScriptRoot
$exeSrc = Join-Path $repo "src-tauri\target\release\projecta.exe"
$paSrc = Join-Path $repo "src-tauri\target\release\pa.exe"
if (-not (Test-Path $exeSrc)) { throw "missing $exeSrc" }
if (-not (Test-Path $paSrc)) { throw "missing $paSrc" }

$running = @(Get-Process projecta -ErrorAction SilentlyContinue)
if ($running.Count -gt 0) {
    throw "projecta already running (PIDs $($running.Id -join ',')); mutex is shared"
}

$sandbox = Join-Path $env:TEMP ("projecta-f8-gp-" + [guid]::NewGuid().ToString("n"))
$appData = Join-Path $sandbox "appdata"
$bin = Join-Path $sandbox "bin"
$scratch = Join-Path $sandbox "scratch"
New-Item -ItemType Directory -Path $appData, $bin, $scratch | Out-Null

Copy-Item -LiteralPath $exeSrc -Destination (Join-Path $bin "projecta.exe")
Copy-Item -LiteralPath $paSrc -Destination (Join-Path $bin "pa.exe")

$succeed = Join-Path $bin "succeed.cmd"
$ask = Join-Path $bin "ask.cmd"
$fail = Join-Path $bin "provider_fail.cmd"
Set-Content -LiteralPath $succeed -Value "@echo succeed& exit /b 0" -Encoding ascii
Set-Content -LiteralPath $ask -Value "@echo ASK: which option?& exit /b 0" -Encoding ascii
Set-Content -LiteralPath $fail -Value "@echo provider_fail& exit /b 1" -Encoding ascii

function ConvertTo-JsonPath([string]$p) { $p.Replace('\', '/') }
$agentsObj = @(
    @{ id = "succeed"; name = "Succeed"; command = (ConvertTo-JsonPath $succeed); args = @() }
    @{ id = "ask"; name = "Ask"; command = (ConvertTo-JsonPath $ask); args = @() }
    @{ id = "provider_fail"; name = "Provider fail"; command = (ConvertTo-JsonPath $fail); args = @() }
)
$json = $agentsObj | ConvertTo-Json -Compress
$utf8 = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText((Join-Path $bin "agents.json"), $json, $utf8)

Push-Location $scratch
try {
    git init -q
    git -c user.email=f8@example.test -c user.name=F8 commit --allow-empty -m "f8 golden path base" | Out-Null
}
finally {
    Pop-Location
}
$head = (git -C $scratch rev-parse HEAD).Trim()

$env:PROJECTA_APP_DATA = $appData
$exe = Join-Path $bin "projecta.exe"
$pa = Join-Path $bin "pa.exe"
$proc = Start-Process -FilePath $exe -PassThru
$desc = Join-Path $appData "projecta-api.json"
$deadline = (Get-Date).AddSeconds(60)
while (-not (Test-Path -LiteralPath $desc) -and (Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 250
}
if (-not (Test-Path -LiteralPath $desc)) {
    Get-Process projecta -ErrorAction SilentlyContinue | Stop-Process -Force
    throw "descriptor never appeared under $appData"
}

function Invoke-Pa {
    param([string[]]$PaArgs)
    $old = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        & $pa @PaArgs 2>&1 | Out-String
    }
    finally {
        $ErrorActionPreference = $old
    }
}

function Get-PaField {
    param([string]$Text, [string]$Label)
    if ($Text -match "(?m)^$Label\s+(\S+)") { return $Matches[1] }
    return $null
}

$env:PROJECTA_API_FILE = $desc
$diag1 = Invoke-Pa @("diagnosis")
$tree1 = Invoke-Pa @("tree")

$createOut = Invoke-Pa @("project", "create", "--name", "Golden", "--path", $scratch)
$projectId = Get-PaField -Text $createOut -Label "id"
$tree2 = Invoke-Pa @("tree")

$spawnOut = ""
$workerId = $null
if ($projectId) {
    $spawnOut = Invoke-Pa @(
        "worker", "spawn",
        "--project", $projectId,
        "--task", "direct worker without orchestrator",
        "--profile", "succeed"
    )
    $workerId = Get-PaField -Text $spawnOut -Label "id"
}
$treeSpawn = Invoke-Pa @("tree")

Get-Process projecta -ErrorAction SilentlyContinue | Stop-Process -Force
$gone = (Get-Date).AddSeconds(15)
while ((Get-Process projecta -ErrorAction SilentlyContinue) -and (Get-Date) -lt $gone) {
    Start-Sleep -Milliseconds 200
}

$beforeRestart = Get-Date
if (Test-Path -LiteralPath $desc) {
    Remove-Item -LiteralPath $desc -Force
}
$proc2 = Start-Process -FilePath $exe -PassThru
$deadline2 = (Get-Date).AddSeconds(60)
while ((-not (Test-Path -LiteralPath $desc) -or ((Get-Item -LiteralPath $desc).LastWriteTime -lt $beforeRestart)) -and (Get-Date) -lt $deadline2) {
    Start-Sleep -Milliseconds 250
}
if (-not (Test-Path -LiteralPath $desc) -or ((Get-Item -LiteralPath $desc).LastWriteTime -lt $beforeRestart)) {
    Get-Process projecta -ErrorAction SilentlyContinue | Stop-Process -Force
    throw "descriptor did not return after restart under $appData"
}
$diag2 = Invoke-Pa @("diagnosis")
$tree3 = Invoke-Pa @("tree")
$log = Join-Path $appData "logs\projecta.log"
$logText = if (Test-Path -LiteralPath $log) { Get-Content -LiteralPath $log -Raw } else { "" }

try {
    Get-Process projecta -ErrorAction SilentlyContinue | Stop-Process -Force
}
catch {}
Remove-Item Env:PROJECTA_APP_DATA -ErrorAction SilentlyContinue
Remove-Item Env:PROJECTA_API_FILE -ErrorAction SilentlyContinue

$createdOk = [bool]($projectId -and $projectId.StartsWith("pj-"))
$treeHasProject = ($tree2 -match "Golden") -and ($tree2 -notmatch "(?s)^no projects\s*$")
$persisted = ($tree3 -match "Golden") -and ($tree3 -notmatch "(?s)^no projects\s*$")
$spawnedOk = [bool]($workerId -and $workerId.StartsWith("wk-"))
$treeSpawnHasWorker = [bool]($workerId -and ($treeSpawn -match [regex]::Escape($workerId)))

$result = [ordered]@{
    sandbox          = $sandbox
    appData          = $appData
    scratchHead      = $head
    firstPid         = $proc.Id
    secondPid        = $proc2.Id
    descriptorOk     = (Test-Path -LiteralPath $desc)
    diagnosis1Ok     = ($diag1 -match "no panic marker" -or $diag1 -match "panic marker")
    diagnosis2Ok     = ($diag2 -match "no panic marker" -or $diag2 -match "panic marker")
    emptyTreeBefore  = ($tree1 -match "no projects")
    projectId        = $projectId
    createdOk        = $createdOk
    treeHasProject   = $treeHasProject
    persisted        = $persisted
    workerId         = $workerId
    spawnedOk        = $spawnedOk
    treeSpawnHasWorker = $treeSpawnHasWorker
    createOut        = $createOut.Trim()
    spawnOut         = $spawnOut.Trim()
    agentsJson       = (Test-Path -LiteralPath (Join-Path $bin "agents.json"))
    isolatedAppData  = $appData.StartsWith($sandbox)
    uiRemainder      = @(
        "Attention + review + merge",
        "conflict harness (Sanierungsplan section 7 steps 6-10)"
    )
}

$ok = $result.descriptorOk -and $result.diagnosis1Ok -and $result.diagnosis2Ok -and $result.emptyTreeBefore -and $result.createdOk -and $result.treeHasProject -and $result.persisted -and $result.spawnedOk -and $result.treeSpawnHasWorker -and ($result.secondPid -ne $result.firstPid) -and $result.isolatedAppData
$json = $result | ConvertTo-Json -Compress
Write-Output $json
if (-not $ok) {
    throw "F8 golden path subset failed: $json"
}
