# Prints {processes:[{pid,name,startedAt}], listeners:[{pid,port}]} as JSON (read-only, no command lines).
$procs = @(Get-Process | ForEach-Object { [pscustomobject]@{ pid = $_.Id; name = $_.ProcessName; startedAt = $(try { $_.StartTime.ToUniversalTime().ToString("o") } catch { $null }) } })
$ls = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | ForEach-Object { [pscustomobject]@{ pid = $_.OwningProcess; port = $_.LocalPort } })
[pscustomobject]@{ processes = $procs; listeners = $ls } | ConvertTo-Json -Depth 3 -Compress
