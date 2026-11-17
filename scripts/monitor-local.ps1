$ErrorActionPreference = 'Stop'
$runtimeDir = Join-Path $env:LOCALAPPDATA 'KAI981Monitor'
$logPath = Join-Path $runtimeDir 'status.json'
$lock = New-Object System.Threading.Mutex($false, 'Local\KAI981FunboxMonitor')
if (!$lock.WaitOne(0)) { $lock.Dispose(); exit 0 }
try {
    $phase='fetch'
    $observedAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    $pages = New-Object System.Collections.Generic.List[object]
    $complete = $false
    for ($page = 1; $page -le 20; $page++) {
        $url = "https://shop.funbox.com.tw/category_products/XI/KB?limit=18&page=$page&sort_by=sell_from-desc"
        $response = $null
        for ($attempt = 0; $attempt -lt 3; $attempt++) {
            try {
                $response = Invoke-WebRequest $url -UseBasicParsing -TimeoutSec 10 -Headers @{Accept='application/json'; Referer='https://shop.funbox.com.tw/categories/XI/KB'; 'Cache-Control'='no-cache'}
                break
            } catch {
                $httpCode = [int]$_.Exception.Response.StatusCode
                if ($attempt -eq 2 -or ($httpCode -ne 0 -and $httpCode -notin @(403,502,503,504))) { throw 'Source unavailable' }
                Start-Sleep -Seconds (1 + 2*$attempt)
            }
        }
        if ($response.Headers['Content-Type'] -notlike '*application/json*' -or $response.Content.Length -gt 2000000 -or !$response.Content.TrimStart().StartsWith('[')) { throw 'Invalid source format' }
        $rows = $response.Content | ConvertFrom-Json
        if ($rows.Count -gt 18) { throw 'Pagination changed' }
        $reduced = @($rows | ForEach-Object {
            $price = $_.price
            if ($null -eq $price -and $_.variants.Count -gt 0) { $price=$_.variants[0].price }
            @{id=$_.id; title=$_.title; url=$_.url; price=$price}
        })
        $pages.Add($reduced)
        if ($rows.Count -lt 18) { $complete=$true; break }
    }
    if (!$complete -or @($pages[0]).Count -eq 0) { throw 'Incomplete catalog' }
    $phase='sign'
    $payload = @{observedAt=$observedAt; pages=$pages.ToArray()} | ConvertTo-Json -Depth 8 -Compress
    $bytes = [Text.Encoding]::UTF8.GetBytes($payload)
    $secure = (Get-Content (Join-Path $runtimeDir 'relay-secret.dpapi') -Raw).Trim() | ConvertTo-SecureString
    $credential = New-Object System.Management.Automation.PSCredential('relay',$secure)
    $hmac = New-Object System.Security.Cryptography.HMACSHA256
    $hmac.Key = [Text.Encoding]::UTF8.GetBytes($credential.GetNetworkCredential().Password)
    $signature = [Convert]::ToBase64String($hmac.ComputeHash($bytes))
    $hmac.Dispose()
    $phase='send'
    $result = $null
    for ($attempt=0; $attempt -lt 3; $attempt++) {
        try {
            $result = Invoke-RestMethod 'https://kai981-km-bot.kai981-km-bot.workers.dev/internal/monitor/snapshot' -Method Post -Body $bytes -ContentType 'application/json; charset=utf-8' -Headers @{'x-monitor-signature'=$signature} -TimeoutSec 20
            break
        } catch {
            $relayHttpCode=[int]$_.Exception.Response.StatusCode
            if ($attempt -eq 2 -or $relayHttpCode -ne 409) { throw 'Relay rejected or unavailable' }
            Start-Sleep -Seconds 3
        }
    }
    if (!$result.ok) { throw 'Relay did not accept catalog' }
    @{ok=$true; observedAt=$observedAt; completedAt=[DateTimeOffset]::UtcNow.ToString('o'); products=$result.products} | ConvertTo-Json | Set-Content $logPath -Encoding UTF8
} catch {
    # No credentials, headers, signed payloads or raw HTTP errors in logs.
    @{ok=$false; completedAt=[DateTimeOffset]::UtcNow.ToString('o'); error='MONITOR_LOCAL_FAILED'; phase=$phase; http=$relayHttpCode; line=$_.InvocationInfo.ScriptLineNumber; exception=$_.Exception.GetType().Name} | ConvertTo-Json | Set-Content $logPath -Encoding UTF8
    exit 1
} finally {
    $lock.ReleaseMutex()
    $lock.Dispose()
}
