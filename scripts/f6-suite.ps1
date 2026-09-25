# F6 20-run transport suite against a live OmniRoute, sequential only.
# Skips (exit 0) when /healthz is down. Heavy chat is opt-in (max 2).
# Product token, never gh auth token, never management token.
param(
    [switch]$Heavy
)

$ErrorActionPreference = "Stop"
$base = "http://127.0.0.1:20128"
$token = "projecta-local"
$repo = Split-Path -Parent $PSScriptRoot
$out = Join-Path $repo ".pa\probe_f6_suite.json"

function Invoke-Healthz {
    try {
        $resp = Invoke-WebRequest -Uri "$base/healthz" -Method GET -TimeoutSec 3 -UseBasicParsing
        return [int]$resp.StatusCode
    }
    catch {
        return 0
    }
}

$probe = Invoke-Healthz
if ($probe -ne 200) {
    Write-Output '{"skipped":true,"reason":"healthz down"}'
    exit 0
}

$runs = @()
for ($i = 1; $i -le 20; $i++) {
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    try {
        $resp = Invoke-WebRequest -Uri "$base/healthz" -Method GET -TimeoutSec 5 -UseBasicParsing
        $sw.Stop()
        $status = [int]$resp.StatusCode
        $runs += [pscustomobject]@{
            n      = $i
            status = $status
            ms     = $sw.ElapsedMilliseconds
            class  = if ($status -eq 200) { "ok" } else { "unclassified" }
        }
    }
    catch {
        $sw.Stop()
        $runs += [pscustomobject]@{
            n      = $i
            status = $null
            ms     = $sw.ElapsedMilliseconds
            class  = "unclassified"
            error  = $_.Exception.Message
        }
    }
}

$heavyRuns = @()
if ($Heavy) {
    $headers = @{
        "x-api-key"         = $token
        "anthropic-version" = "2023-06-01"
        "content-type"      = "application/json"
    }
    $user = "Was ist sieben mal sechs? Antworte nur mit der Zahl."
    foreach ($mode in @(
            @{ name = "cheap"; model = "auto/cheap" },
            @{ name = "reliable"; model = "auto/coding" }
        )) {
        $body = @{
            model      = $mode.model
            max_tokens = 32
            messages   = @(@{ role = "user"; content = $user })
        } | ConvertTo-Json -Compress
        $sw = [System.Diagnostics.Stopwatch]::StartNew()
        try {
            $resp = Invoke-WebRequest -Uri "$base/v1/messages" -Method POST -Headers $headers -Body $body -TimeoutSec 45 -UseBasicParsing -ContentType "application/json; charset=utf-8"
            $sw.Stop()
            $text = $resp.Content
            if ($text.Length -gt 400) { $text = $text.Substring(0, 400) }
            $heavyRuns += [pscustomobject]@{
                name   = $mode.name
                model  = $mode.model
                status = [int]$resp.StatusCode
                ms     = $sw.ElapsedMilliseconds
                body   = $text
            }
        }
        catch {
            $sw.Stop()
            $status = $null
            $bodyText = $null
            if ($_.Exception.Response) {
                $status = [int]$_.Exception.Response.StatusCode
            }
            $heavyRuns += [pscustomobject]@{
                name   = $mode.name
                model  = $mode.model
                status = $status
                ms     = $sw.ElapsedMilliseconds
                error  = $_.Exception.Message
            }
        }
    }
}

$unclassified = @($runs | Where-Object { $_.class -eq "unclassified" }).Count
$result = [ordered]@{
    skipped      = $false
    transportOk  = ($unclassified -eq 0 -and $runs.Count -eq 20)
    unclassified = $unclassified
    runs         = $runs
    heavy        = $heavyRuns
}
$json = $result | ConvertTo-Json -Depth 6 -Compress
[System.IO.File]::WriteAllText($out, $json)
Write-Output $json
if (-not $result.transportOk) {
    throw "F6 20-run suite had unclassified transport errors"
}
