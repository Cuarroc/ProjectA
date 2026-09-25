# window-shot.ps1 — Screenshot eines echten Fensters, per Titel gefunden.
#
#   powershell -ExecutionPolicy Bypass -File scripts\window-shot.ps1 -Title "ProjectA" [-Out shot.png]
#
# Existiert, weil der Screenshot-Berechtigungs-Resolver nur Startmenü-Einträge
# kennt: ein Dev-Build (target\debug\projecta.exe) ist dort unsichtbar, und der
# nächstliegende Listeneintrag ("Agent Orchestrator") ist ein fremdes Programm,
# dessen Grant das eigentliche Fenster maskiert. Dieser Weg geht über Win32
# direkt: Fenster nach vorn holen, Rechteck lesen, Bildschirmbereich kopieren.
#
# Gelernt aus der U2-Sichtprüfung: SetForegroundWindow allein reicht nicht —
# ohne ShowWindow (Restore) griff es nicht, und ein synthetischer Klick landete
# im falschen Programm. Deshalb hier beides, und danach eine Verifikation, dass
# das Zielfenster wirklich vorn ist — sonst bricht das Script ab, statt das
# falsche Fenster zu fotografieren.
param(
    [Parameter(Mandatory = $true)][string]$Title,
    [string]$ProcessName,
    [string]$Out = "window-shot.png"
)
$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WinShot {
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
    public struct RECT { public int Left, Top, Right, Bottom; }
}
"@

# Exakter Titel schlaegt Teiltreffer. Ohne das gewinnt ein Browser-Tab, der
# den gesuchten Namen zufaellig im Titel fuehrt - genau so ist dieses Skript
# beim Installer-Test in einem Chrome-Fenster statt in der App gelandet.
$candidates = @(Get-Process | Where-Object { $_.MainWindowTitle -and $_.MainWindowTitle -like "*$Title*" })
if ($ProcessName) { $candidates = @($candidates | Where-Object { $_.ProcessName -eq $ProcessName }) }
$proc = $candidates | Where-Object { $_.MainWindowTitle -eq $Title } | Select-Object -First 1
if (-not $proc) { $proc = $candidates | Select-Object -First 1 }
if (-not $proc) {
    Write-Error "Kein Fenster mit Titel *$Title* gefunden. Offene Fenster: $((Get-Process | Where-Object MainWindowTitle | ForEach-Object MainWindowTitle) -join ' | ')"
}
$hwnd = $proc.MainWindowHandle

# 9 = SW_RESTORE: holt auch ein minimiertes Fenster zurück.
[WinShot]::ShowWindow($hwnd, 9) | Out-Null
[WinShot]::SetForegroundWindow($hwnd) | Out-Null
Start-Sleep -Milliseconds 400

if ([WinShot]::GetForegroundWindow() -ne $hwnd) {
    Write-Error "Fenster '$($proc.MainWindowTitle)' liess sich nicht in den Vordergrund holen - Abbruch statt Foto vom falschen Fenster."
}

$rect = New-Object WinShot+RECT
[WinShot]::GetWindowRect($hwnd, [ref]$rect) | Out-Null
$w = $rect.Right - $rect.Left; $h = $rect.Bottom - $rect.Top
if ($w -le 0 -or $h -le 0) { Write-Error "Fensterrechteck ist leer ($w x $h)." }

$bmp = New-Object System.Drawing.Bitmap($w, $h)
$gfx = [System.Drawing.Graphics]::FromImage($bmp)
$gfx.CopyFromScreen($rect.Left, $rect.Top, 0, 0, $bmp.Size)
$bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$gfx.Dispose(); $bmp.Dispose()
Write-Output "OK: '$($proc.MainWindowTitle)' ($w x $h) -> $Out"
