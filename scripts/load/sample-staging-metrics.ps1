param(
  [ValidateRange(1,30)][int]$Samples = 10,
  [ValidateRange(30,300)][int]$IntervalSeconds = 60
)
$ErrorActionPreference = 'Continue'
$ref = 'ranrlqfsihteuwxhisek'
if ((Get-Content 'supabase/.temp/project-ref' -Raw).Trim() -ne $ref) { throw 'Wrong Supabase project.' }
$keys = npx.cmd --yes supabase@2.65.5 projects api-keys --project-ref $ref -o json 2>$null | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) { throw 'Could not obtain staging metrics credentials.' }
$key = ($keys | Where-Object { $_.type -eq 'legacy' -and $_.name -eq 'service_role' } | Select-Object -First 1).api_key
if (-not $key) { throw 'Staging metrics credential missing.' }
$basic = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes('service_role:' + $key))
$url = "https://$ref.supabase.co/customer/v1/privileged/metrics"
$output = Join-Path 'test-results' ('staging-metrics-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.jsonl')

function Sum-Metric([string[]]$lines,[string]$name,[string]$mode = '') {
  $sum = 0.0
  foreach ($line in $lines) {
    if ($line -notmatch ('^' + [regex]::Escape($name) + '(\{|\s)')) { continue }
    if ($mode -and $line -notmatch ('mode="' + [regex]::Escape($mode) + '"')) { continue }
    if ($line -match '\s([0-9.eE+-]+)(?:\s|$)') { $sum += [double]::Parse($Matches[1],[cultureinfo]::InvariantCulture) }
  }
  return $sum
}

for ($i = 0; $i -lt $Samples; $i++) {
  try {
    $response = Invoke-WebRequest -Uri $url -Headers @{ Authorization = 'Basic ' + $basic } -UseBasicParsing
    $lines = $response.Content -split "`n"
    $row = [ordered]@{
      observedAt = (Get-Date).ToUniversalTime().ToString('o')
      cpuUserSeconds = Sum-Metric $lines 'node_cpu_seconds_total' 'user'
      cpuSystemSeconds = Sum-Metric $lines 'node_cpu_seconds_total' 'system'
      cpuIdleSeconds = Sum-Metric $lines 'node_cpu_seconds_total' 'idle'
      cpuIowaitSeconds = Sum-Metric $lines 'node_cpu_seconds_total' 'iowait'
      memoryAvailableBytes = Sum-Metric $lines 'node_memory_MemAvailable_bytes'
      memoryTotalBytes = Sum-Metric $lines 'node_memory_MemTotal_bytes'
      clientWaiting = Sum-Metric $lines 'pgbouncer_pools_client_waiting_connections'
      clientActive = Sum-Metric $lines 'pgbouncer_pools_client_active_connections'
      serverActive = Sum-Metric $lines 'pgbouncer_pools_server_active_connections'
      dbConnections = Sum-Metric $lines 'connection_stats_connection_count'
    }
    $row | ConvertTo-Json -Compress | Add-Content -LiteralPath $output
  } catch {
    @{ observedAt = (Get-Date).ToUniversalTime().ToString('o'); error = 'metrics_scrape_failed' } |
      ConvertTo-Json -Compress | Add-Content -LiteralPath $output
  }
  if ($i + 1 -lt $Samples) { Start-Sleep -Seconds $IntervalSeconds }
}
Write-Host "Staging metrics samples: $output"
