# Isolated F8 two-process + panic + simultaneous + relaunch proof.
# Does not open %APPDATA%\com.projecta.app. Refuses if a ProjectA process
# already holds the bundle-id mutex.
param(
    [ValidateSet("sequential", "simultaneous", "relaunch", "all")]
    [string]$Mode = "all"
)

$ErrorActionPreference = "Stop"

$repo = Split-Path -Parent $PSScriptRoot
$exe = Join-Path $repo "src-tauri\target\release\projecta.exe"
if (-not (Test-Path $exe)) {
    throw "missing $exe - cargo build --release (CARGO_BUILD_JOBS=2) first"
}

function Assert-NoProjectA {
    $running = @(Get-Process projecta -ErrorAction SilentlyContinue)
    if ($running.Count -gt 0) {
        throw "projecta already running (PIDs $($running.Id -join ',')); mutex is shared"
    }
}

function New-IsolatedDir {
    $iso = Join-Path $env:TEMP ("projecta-f8-" + [guid]::NewGuid().ToString("n"))
    New-Item -ItemType Directory -Path $iso | Out-Null
    $panicText = "PANIC: f8 isolated proof"
    Set-Content -LiteralPath (Join-Path $iso ".panic-last") -Value $panicText -NoNewline
    return $iso
}

function Stop-ProjectA {
    Get-Process projecta -ErrorAction SilentlyContinue | Stop-Process -Force
    $deadline = (Get-Date).AddSeconds(15)
    while ((Get-Process projecta -ErrorAction SilentlyContinue) -and (Get-Date) -lt $deadline) {
        Start-Sleep -Milliseconds 200
    }
}

function Wait-Descriptor([string]$iso, [int]$seconds = 60) {
    $desc = Join-Path $iso "projecta-api.json"
    $deadline = (Get-Date).AddSeconds($seconds)
    while (-not (Test-Path -LiteralPath $desc) -and (Get-Date) -lt $deadline) {
        Start-Sleep -Milliseconds 250
    }
    if (-not (Test-Path -LiteralPath $desc)) {
        Stop-ProjectA
        throw "descriptor never appeared under $iso"
    }
    return $desc
}

function Invoke-Sequential {
    Assert-NoProjectA
    $iso = New-IsolatedDir
    $env:PROJECTA_APP_DATA = $iso
    $first = Start-Process -FilePath $exe -PassThru
    $desc = Wait-Descriptor $iso
    $beforeTime = (Get-Item -LiteralPath $desc).LastWriteTimeUtc
    $beforeHash = (Get-FileHash -LiteralPath $desc -Algorithm SHA256).Hash

    Start-Process -FilePath $exe | Out-Null
    Start-Sleep -Seconds 3

    $pids = @(Get-Process projecta -ErrorAction SilentlyContinue)
    $afterTime = (Get-Item -LiteralPath $desc).LastWriteTimeUtc
    $afterHash = (Get-FileHash -LiteralPath $desc -Algorithm SHA256).Hash
    $log = Join-Path $iso "logs\projecta.log"
    $logText = if (Test-Path -LiteralPath $log) { Get-Content -LiteralPath $log -Raw } else { "" }
    $previous = Join-Path $iso ".panic-previous"
    $current = Join-Path $iso ".panic-last"

    $result = [ordered]@{
        mode               = "sequential"
        isolatedDir        = $iso
        exe                = $exe
        firstPid           = $first.Id
        processCount       = $pids.Count
        pids               = @($pids.Id)
        descriptorHashOk   = ($beforeHash -eq $afterHash)
        descriptorMtimeOk  = ($beforeTime -eq $afterTime)
        secondInstanceLog  = ($logText -match "second instance turned away")
        panicRotated       = ((Test-Path -LiteralPath $previous) -and -not (Test-Path -LiteralPath $current))
    }
    $ok = $result.processCount -eq 1 -and $result.descriptorHashOk -and $result.descriptorMtimeOk -and $result.secondInstanceLog -and $result.panicRotated
    Stop-ProjectA
    Remove-Item Env:PROJECTA_APP_DATA -ErrorAction SilentlyContinue
    if (-not $ok) {
        throw "F8 sequential proof failed: $($result | ConvertTo-Json -Compress)"
    }
    return $result
}

function Invoke-Simultaneous {
    Assert-NoProjectA
    $iso = New-IsolatedDir
    $env:PROJECTA_APP_DATA = $iso
    $p1 = Start-Process -FilePath $exe -PassThru
    $p2 = Start-Process -FilePath $exe -PassThru
    $desc = Wait-Descriptor $iso
    Start-Sleep -Seconds 4
    $pids = @(Get-Process projecta -ErrorAction SilentlyContinue)
    $log = Join-Path $iso "logs\projecta.log"
    $logText = if (Test-Path -LiteralPath $log) { Get-Content -LiteralPath $log -Raw } else { "" }
    $result = [ordered]@{
        mode              = "simultaneous"
        isolatedDir       = $iso
        startedPids       = @($p1.Id, $p2.Id)
        processCount      = $pids.Count
        pids              = @($pids.Id)
        secondInstanceLog = ($logText -match "second instance turned away")
        upstreamSlip      = ($pids.Count -gt 1)
    }
    Stop-ProjectA
    Remove-Item Env:PROJECTA_APP_DATA -ErrorAction SilentlyContinue
    if ($result.processCount -ne 1) {
        throw "F8 simultaneous proof failed (processCount=$($result.processCount)): $($result | ConvertTo-Json -Compress)"
    }
    return $result
}

function Invoke-Relaunch {
    Assert-NoProjectA
    $iso = New-IsolatedDir
    $env:PROJECTA_APP_DATA = $iso
    $first = Start-Process -FilePath $exe -PassThru
    $desc = Wait-Descriptor $iso
    $firstPid = $first.Id
    Stop-Process -Id $firstPid -Force -ErrorAction SilentlyContinue
    $goneDeadline = (Get-Date).AddSeconds(15)
    while ((Get-Process -Id $firstPid -ErrorAction SilentlyContinue) -and (Get-Date) -lt $goneDeadline) {
        Start-Sleep -Milliseconds 200
    }
    Assert-NoProjectA
    $second = Start-Process -FilePath $exe -PassThru
    $null = Wait-Descriptor $iso
    Start-Sleep -Seconds 2
    $pids = @(Get-Process projecta -ErrorAction SilentlyContinue)
    $result = [ordered]@{
        mode         = "relaunch"
        isolatedDir  = $iso
        firstPid     = $firstPid
        secondPid    = $second.Id
        processCount = $pids.Count
        pids         = @($pids.Id)
        newPid       = ($second.Id -ne $firstPid)
        mutexHeld    = ($pids.Count -eq 1)
    }
    $ok = $result.processCount -eq 1 -and $result.newPid
    Stop-ProjectA
    Remove-Item Env:PROJECTA_APP_DATA -ErrorAction SilentlyContinue
    if (-not $ok) {
        throw "F8 relaunch proof failed: $($result | ConvertTo-Json -Compress)"
    }
    return $result
}

$results = @()
switch ($Mode) {
    "sequential" { $results += Invoke-Sequential }
    "simultaneous" { $results += Invoke-Simultaneous }
    "relaunch" { $results += Invoke-Relaunch }
    "all" {
        $results += Invoke-Sequential
        $results += Invoke-Relaunch
        $results += Invoke-Simultaneous
    }
}

$json = $results | ConvertTo-Json -Compress
Write-Output $json
