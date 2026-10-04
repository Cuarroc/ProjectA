# Bounded, reversible memory pressure (PowerShell 7). Allocates only this
# process's own memory, steps down through "limited" and "critical", holds each
# stage, and frees everything on exit, Ctrl+C or timeout (max 10 minutes).
param(
    [ValidateRange(60, 600)][int]$MaxSeconds = 600,
    [ValidateRange(20, 300)][int]$HoldSeconds = 60,
    [int[]]$StagesAvailableMiB = @(1500, 400)   # limited (<2048), critical (<512)
)
$ErrorActionPreference = "Stop"
$floorMiB = 256   # never squeeze the PC below this, whatever the stages say
$chunks = [System.Collections.Generic.List[byte[]]]::new()
$deadline = (Get-Date).AddSeconds($MaxSeconds)
function Get-AvailableMiB { [int]((Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory / 1024) }
try {
    foreach ($target in $StagesAvailableMiB) {
        $target = [Math]::Max($target, $floorMiB)
        Write-Host "Stufe: verfuegbar auf ca. $target MiB druecken"
        while ((Get-AvailableMiB) -gt $target -and (Get-Date) -lt $deadline) {
            $chunk = [byte[]]::new(64MB)
            for ($i = 0; $i -lt $chunk.Length; $i += 4096) { $chunk[$i] = 1 }   # touch pages so they are really resident
            $chunks.Add($chunk)
            Start-Sleep -Milliseconds 100
        }
        Write-Host ("Gehalten bei {0} MiB verfuegbar, {1} s" -f (Get-AvailableMiB), $HoldSeconds)
        $holdEnd = [Math]::Min((Get-Date).AddSeconds($HoldSeconds).Ticks, $deadline.Ticks)
        while ((Get-Date).Ticks -lt $holdEnd) { Start-Sleep -Seconds 1 }
    }
} finally {
    $chunks.Clear(); [GC]::Collect()
    Write-Host ("Speicher freigegeben, verfuegbar: {0} MiB" -f (Get-AvailableMiB))
}
