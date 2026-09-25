# Read-only MSI inventory gate. Never installs or executes packaged files.
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$Package,
    [Parameter(Mandatory)][ValidatePattern('^\d+\.\d+\.\d+$')][string]$ExpectedVersion,
    [switch]$RequireNativeResources
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$packagePath = (Resolve-Path -LiteralPath $Package).Path
if ([IO.Path]::GetExtension($packagePath) -ine '.msi') { throw 'Expected an MSI package' }
$before = (Get-FileHash -LiteralPath $packagePath -Algorithm SHA256).Hash
$installer = $null
$database = $null
$views = [Collections.Generic.List[object]]::new()
$cleanupErrors = [Collections.Generic.List[string]]::new()
function Release-PackageComObject($Object, [string]$Label) {
    if ($null -eq $Object) { return }
    try { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($Object) }
    catch { $cleanupErrors.Add($Label) }
}
try {
    $installer = New-Object -ComObject WindowsInstaller.Installer
    $database = $installer.OpenDatabase($packagePath, 0) # msiOpenDatabaseModeReadOnly
    $view = $database.OpenView('SELECT `Value` FROM `Property` WHERE `Property` = ''ProductVersion''')
    $views.Add($view)
    $view.Execute()
    $record = $view.Fetch()
    if ($null -eq $record) { throw 'MSI ProductVersion is absent' }
    try { $version = $record.StringData(1) }
    finally { Release-PackageComObject $record 'version record' }
    if ($version -cne $ExpectedVersion) { throw "MSI version $version differs from $ExpectedVersion" }

    $view = $database.OpenView('SELECT `File`.`FileName`, `File`.`FileSize`, `Component`.`Directory_` FROM `File`, `Component` WHERE `File`.`Component_` = `Component`.`Component`')
    $views.Add($view)
    $view.Execute()
    $files = [Collections.Generic.List[object]]::new()
    while ($null -ne ($record = $view.Fetch())) {
        try {
            $files.Add([pscustomobject]@{
                name = ($record.StringData(1) -split '\|')[-1]
                bytes = $record.IntegerData(2)
                directory = $record.StringData(3)
            })
        } finally { Release-PackageComObject $record 'file record' }
    }
    $requiredNames = @('projecta.exe', 'pa.exe', 'pa-capture-host.exe')
    if ($RequireNativeResources) { $requiredNames += @('pa-native-host.json', 'pa-native-host.json.sig') }
    $required = foreach ($name in $requiredNames) {
        $found = @($files | Where-Object { $_.name -ieq $name })
        if ($found.Count -ne 1 -or $found[0].bytes -le 0) {
            throw "MSI must contain exactly one nonempty $name"
        }
        $found[0]
    }
    if (@($required.directory | Select-Object -Unique).Count -ne 1) {
        throw 'Required native package files must install in the same directory'
    }
} finally {
    foreach ($view in $views) {
        try { $view.Close() }
        catch { $cleanupErrors.Add('view close') }
        finally { Release-PackageComObject $view 'view release' }
    }
    Release-PackageComObject $database 'database'
    Release-PackageComObject $installer 'installer'
}
# A validation exception remains the primary error. On success, cleanup errors
# still fail the gate after every reference has had its release attempted.
if ($cleanupErrors.Count -ne 0) { throw "MSI cleanup failed: $($cleanupErrors -join ', ')" }
$after = (Get-FileHash -LiteralPath $packagePath -Algorithm SHA256).Hash
if ($before -cne $after) { throw 'MSI changed during inventory inspection' }
[ordered]@{
    schemaVersion = 1
    observation = 'msi-file-table'
    observedAt = [DateTime]::UtcNow.ToString('o')
    package = $packagePath
    sha256 = $after.ToLowerInvariant()
    version = $version
    files = @($required)
    installed = $false
    payloadBytesVerified = $false
} | ConvertTo-Json -Depth 4
