[CmdletBinding()]
param([ValidateSet('Open','Close')][string]$Action='Open')
$ErrorActionPreference='Stop'
$stateFile=Join-Path $env:TEMP 'campusgo-dashboard-tunnels.json'
$accessScript=Join-Path $PSScriptRoot 'dashboard-access.ps1'
function Close-RemoteTunnel([string]$sessionId) {
    # Windows PowerShell turns redirected native stderr into error records.
    $ErrorActionPreference='Continue'
    $termination=@(& aws.exe ssm terminate-session --session-id $sessionId --profile campusgo --region ap-southeast-1 --no-cli-pager 2>&1)
    if ($LASTEXITCODE -eq 0) { return $true }

    # Stopping the local plugin may already have ended the remote session.
    # Only accept an explicitly terminal status; empty history is not proof.
    $history=@(& aws.exe ssm describe-sessions --state History --filters "key=SessionId,value=$sessionId" --profile campusgo --region ap-southeast-1 --output json --no-cli-pager 2>&1)
    if ($LASTEXITCODE -eq 0) {
        try {
            $result=($history -join "`n") | ConvertFrom-Json -ErrorAction Stop
            if (@($result.Sessions | Where-Object { $_.SessionId -eq $sessionId -and $_.Status -in @('Terminated','Failed') }).Count -gt 0) {
                return $true
            }
        } catch { Write-Warning "Could not parse session history for ${sessionId}: $_" }
    } else { Write-Warning ($history -join "`n") }
    Write-Warning "Could not confirm cleanup for ${sessionId}: $($termination -join "`n")"
    return $false
}
function Get-TunnelShells {
    $filePattern='-File\s+"?' + [regex]::Escape($accessScript) + '"?\s+-Dashboard\s+(Grafana|RabbitMQ)(?:\s|$)'
    @(Get-CimInstance Win32_Process | Where-Object {
        $_.Name -eq 'powershell.exe' -and $_.CommandLine -match $filePattern
    })
}
function Stop-TunnelTree($rootProcess) {
    # Capture identity before stopping anything; do not kill a reused PID.
    $snapshot=@(Get-CimInstance Win32_Process)
    $tree=@($rootProcess)
    for ($index=0; $index -lt $tree.Count; $index++) {
        $parent=$tree[$index]
        $tree+=@($snapshot | Where-Object {
            $_.ParentProcessId -eq $parent.ProcessId -and
            $_.CreationDate -ge $parent.CreationDate -and
            $_.Name -in @('aws.exe','session-manager-plugin.exe','powershell.exe') -and
            $_.ProcessId -notin @($tree.ProcessId)
        })
    }
    for ($index=$tree.Count-1; $index -ge 0; $index--) {
        $tracked=$tree[$index]
        $current=Get-CimInstance Win32_Process -Filter "ProcessId=$($tracked.ProcessId)"
        if ($current -and $current.CreationDate -eq $tracked.CreationDate) {
            Stop-Process -Id $tracked.ProcessId -Force -ErrorAction SilentlyContinue
            Wait-Process -Id $tracked.ProcessId -Timeout 10 -ErrorAction SilentlyContinue
        }
    }
}
if ($Action -eq 'Close') {
    $shells=Get-TunnelShells
    $records=@()
    if (Test-Path -LiteralPath $stateFile) { $records=@(Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json) }
    # Stop descendants while their ancestry is still intact, then close AWS sessions.
    foreach ($shell in $shells) { Stop-TunnelTree $shell }
    $remoteFailed=$false
    try {
        foreach ($record in $records) {
            if (Test-Path -LiteralPath $record.output) {
                $session=Select-String -LiteralPath $record.output -Pattern 'Starting session with SessionId: (\S+)' | Select-Object -Last 1
                if ($session) {
                    if (-not (Close-RemoteTunnel $session.Matches[0].Groups[1].Value)) { $remoteFailed=$true }
                }
            }
        }
    } finally {
        # Remote termination alone may leave the Windows plugin listening locally.
        foreach ($shell in $shells) { Stop-TunnelTree $shell }
    }
    if ($remoteFailed) { throw 'Local tunnel processes stopped. Remote cleanup could not be confirmed. Check the AWS warnings above and run Close again. Saved state was retained.' }
    if (Test-Path -LiteralPath $stateFile) { Remove-Item -LiteralPath $stateFile }
    Write-Output 'Dashboard tunnels closed and local processes stopped.'
    return
}
if (Test-Path -LiteralPath $stateFile) { throw 'Saved tunnels exist. Run this script with -Action Close before reopening.' }
foreach ($port in @(3000,15672)) {
    $probe=[Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,$port)
    try { $probe.Start() }
    catch { throw "Local port $port is in use. Run ./scripts/aws/dashboards.ps1 -Action Close to clean up this script's tunnels. If it remains busy, stop the other application or use dashboard-access.ps1 -LocalPort with a different port." }
    finally { $probe.Stop() }
}
$records=@()
foreach ($dashboard in @('Grafana','RabbitMQ')) {
    $prefix=Join-Path $env:TEMP ('campusgo-tunnel-'+[guid]::NewGuid())
    $arguments=@('-NoProfile','-ExecutionPolicy','Bypass','-File',('"'+(Join-Path $PSScriptRoot 'dashboard-access.ps1')+'"'),'-Dashboard',$dashboard)
    $process=Start-Process powershell.exe -ArgumentList $arguments -WindowStyle Hidden -RedirectStandardOutput "$prefix.out" -RedirectStandardError "$prefix.err" -PassThru
    $records+=@{dashboard=$dashboard;pid=$process.Id;output="$prefix.out";error="$prefix.err"}
    ConvertTo-Json -InputObject @($records) | Set-Content -LiteralPath $stateFile -Encoding utf8
}
foreach ($record in $records) {
    $ready=$false
    for ($attempt=0; $attempt -lt 40; $attempt++) {
        if ((Test-Path -LiteralPath $record.output) -and (Select-String -LiteralPath $record.output -Pattern 'Port \d+ opened' -Quiet)) { $ready=$true; break }
        Start-Sleep -Seconds 1
    }
    if (-not $ready) { throw "Tunnel not ready. Check $($record.error) and $($record.output). Close saved sessions before retrying." }
}
Write-Output 'Grafana: http://localhost:3000'
Write-Output 'RabbitMQ: http://localhost:15672'
Write-Output 'Tunnels run in the background. Close them with: ./scripts/aws/dashboards.ps1 -Action Close'
