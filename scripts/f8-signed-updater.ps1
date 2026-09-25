# Signed updater channel proof. Never installs over production AppData.
# A local signed relaunch needs TAURI_SIGNING_PRIVATE_KEY (GitHub secret;
# never invent a new key pair). Without it this script proves the anonymous
# mirror contract (latest.json + signature field) and records that the
# relaunch was not signed. It does not download the installer: GitHub
# release redirects do not match a Range/HEAD probe (release.yml), and a
# full GET would still not be a relaunch.
param()

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$running = @(Get-Process projecta -ErrorAction SilentlyContinue)
if ($running.Count -gt 0) {
    throw "projecta already running (PIDs $($running.Id -join ',')); mutex is shared"
}

$manifestUrl = "https://github.com/Cuarroc/ProjectA-updates/releases/latest/download/latest.json"
$keyPresent = -not [string]::IsNullOrEmpty($env:TAURI_SIGNING_PRIVATE_KEY)

$repo = Split-Path -Parent $PSScriptRoot
$confPath = Join-Path $repo "src-tauri\tauri.conf.json"
if (-not (Test-Path -LiteralPath $confPath)) { throw "missing $confPath" }
$conf = Get-Content -LiteralPath $confPath -Raw | ConvertFrom-Json
$expectedVersion = [string]$conf.version
if ($expectedVersion -notmatch '^\d+\.\d+\.\d+$') { throw "tauri.conf.json version is not semver: $expectedVersion" }
$expectedUrl = "https://github.com/Cuarroc/ProjectA-updates/releases/download/v$expectedVersion/ProjectA_${expectedVersion}_x64-setup.exe"

$resp = Invoke-WebRequest -Uri $manifestUrl -UseBasicParsing
$raw = if ($resp.Content -is [byte[]]) {
    [System.Text.Encoding]::UTF8.GetString($resp.Content)
} else {
    [string]$resp.Content
}
$manifest = $raw | ConvertFrom-Json
$platform = $manifest.platforms.'windows-x86_64'
if (-not $platform) { throw "latest.json has no windows-x86_64 platform" }
$assetUrl = [string]$platform.url
$signature = [string]$platform.signature
$version = [string]$manifest.version
if ([string]::IsNullOrWhiteSpace($assetUrl)) { throw "latest.json asset url empty" }
if ([string]::IsNullOrWhiteSpace($signature)) { throw "latest.json signature empty" }
if ($version -ne $expectedVersion) {
    throw "stale latest.json version=$version expected=$expectedVersion (releases/latest can lag)"
}
if ($assetUrl -ne $expectedUrl) {
    throw "latest.json asset url=$assetUrl expected=$expectedUrl"
}

$result = [ordered]@{
    manifestUrl           = $manifestUrl
    manifestStatus        = [int]$resp.StatusCode
    version               = $version
    expectedVersion       = $expectedVersion
    versionMatch          = ($version -eq $expectedVersion)
    assetUrl              = $assetUrl
    assetUrlMatch         = ($assetUrl -eq $expectedUrl)
    signaturePresent      = -not [string]::IsNullOrWhiteSpace($signature)
    signatureChars        = $signature.Length
    usedAuthHeader        = $false
    signingKeyInEnv       = $keyPresent
    signedRelaunch        = $false
    unsignedRelaunchProxy = "scripts/f8-isolated-proof.ps1 -Mode relaunch"
    note                  = if ($keyPresent) {
        "key present; this script still does not install NSIS over production AppData"
    } else {
        "no TAURI_SIGNING_PRIVATE_KEY; cannot mint a signed installer locally (do not invent a key pair)"
    }
}

$ok = ($result.manifestStatus -eq 200) -and $result.signaturePresent -and $result.versionMatch -and $result.assetUrlMatch -and (-not $result.usedAuthHeader)
$json = $result | ConvertTo-Json -Compress
Write-Output $json
if (-not $ok) {
    throw "F8 signed updater channel proof failed: $json"
}
