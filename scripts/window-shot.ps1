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
    [int]$TargetPid = 0,
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
    [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdcBlt, uint nFlags);
    [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
    public struct RECT { public int Left, Top, Right, Bottom; }
}
"@

# Exakter Titel schlaegt Teiltreffer. Ohne das gewinnt ein Browser-Tab, der
# den gesuchten Namen zufaellig im Titel fuehrt - genau so ist dieses Skript
# beim Installer-Test in einem Chrome-Fenster statt in der App gelandet.
# -TargetPid schlaegt Titel und Prozessname: zwei gleich betitelte Fenster (etwa
# Produktiv-App und Proof-Instanz nebeneinander) waeren sonst eine
# Glueckssache, und das Foto kaeme vom falschen Fenster.
$candidates = @(Get-Process | Where-Object { $_.MainWindowTitle -and $_.MainWindowTitle -like "*$Title*" })
if ($ProcessName) { $candidates = @($candidates | Where-Object { $_.ProcessName -eq $ProcessName }) }
$proc = $null
if ($TargetPid -gt 0) { $proc = @($candidates | Where-Object { $_.Id -eq $TargetPid }) | Select-Object -First 1 }
if (-not $proc) { $proc = $candidates | Where-Object { $_.MainWindowTitle -eq $Title } | Select-Object -First 1 }
if (-not $proc) { $proc = $candidates | Select-Object -First 1 }
if (-not $proc) {
    Write-Error "Kein Fenster mit Titel *$Title* gefunden. Offene Fenster: $((Get-Process | Where-Object MainWindowTitle | ForEach-Object MainWindowTitle) -join ' | ')"
}
$hwnd = $proc.MainWindowHandle

# 9 = SW_RESTORE: holt auch ein minimiertes Fenster zurück.
[WinShot]::ShowWindow($hwnd, 9) | Out-Null
# Ein harmloser Alt-Tastenschlag gibt diesem Prozess das Recht, ein fremdes
# Fenster nach vorn zu holen; ohne ihn verweigert Windows das aus einer
# Konsole im Hintergrund heraus (Foreground-Lock).
[WinShot]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero)
[WinShot]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)
[WinShot]::SetForegroundWindow($hwnd) | Out-Null
Start-Sleep -Milliseconds 400

$rect = New-Object WinShot+RECT
[WinShot]::GetWindowRect($hwnd, [ref]$rect) | Out-Null
$w = $rect.Right - $rect.Left; $h = $rect.Bottom - $rect.Top
if ($w -le 0 -or $h -le 0) { Write-Error "Fensterrechteck ist leer ($w x $h)." }

if ([WinShot]::GetForegroundWindow() -eq $hwnd) {
    $method = 'CopyFromScreen'
    $bmp = New-Object System.Drawing.Bitmap($w, $h)
    $gfx = [System.Drawing.Graphics]::FromImage($bmp)
    $gfx.CopyFromScreen($rect.Left, $rect.Top, 0, 0, $bmp.Size)
    $bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
    $gfx.Dispose(); $bmp.Dispose()
} else {
    # Der Vordergrund bleibt verwehrt: statt abzubrechen oder das falsche
    # Fenster zu fotografieren, rendert PrintWindow das Zielfenster direkt
    # (2 = PW_RENDERFULLCONTENT, sonst bleiben WebView2-Flaechen schwarz).
    $method = 'PrintWindow'
    $bmp = New-Object System.Drawing.Bitmap($w, $h)
    $gfx = [System.Drawing.Graphics]::FromImage($bmp)
    $hdc = $gfx.GetHdc()
    try {
        if (-not [WinShot]::PrintWindow($hwnd, $hdc, 2)) {
            Write-Error "PrintWindow auf '$($proc.MainWindowTitle)' fehlgeschlagen - kein Beleg statt falscher Beleg."
        }
    } finally {
        $gfx.ReleaseHdc($hdc)
    }
    $bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
    $gfx.Dispose(); $bmp.Dispose()
}
Write-Output "OK: '$($proc.MainWindowTitle)' ($w x $h, $method) -> $Out"
