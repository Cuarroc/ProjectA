# window-watch.ps1 — protokolliert neu auftauchende sichtbare Fenster.
# Zweck: herausfinden, welcher Prozess die aufblitzenden Konsolenfenster
# oeffnet, die beim Start bzw. bei der Benutzung von ProjectA zu sehen sind.
param(
  [int]$Seconds = 180,
  [string]$LogFile = "$env:TEMP\window-watch.log"
)

$seen = @{}
$start = Get-Date
Write-Output "=== window-watch gestartet $start ===" | Out-File $LogFile

while (((Get-Date) - $start).TotalSeconds -lt $Seconds) {
  Get-Process | Where-Object { $_.MainWindowHandle -ne 0 } | ForEach-Object {
    if (-not $seen.ContainsKey($_.Id)) {
      $seen[$_.Id] = $true
      $line = "{0:HH:mm:ss.fff} NEU pid={1} prozess={2} titel='{3}' pfad={4}" -f `
        (Get-Date), $_.Id, $_.ProcessName, $_.MainWindowTitle, `
        ($_.Path | Out-String).Trim()
      Write-Output $line | Out-File $LogFile -Append
    }
  }
  Start-Sleep -Milliseconds 400
}
Write-Output "=== window-watch beendet $(Get-Date) ===" | Out-File $LogFile -Append
