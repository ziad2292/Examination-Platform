param(
  [Parameter(Mandatory=$true)][string]$Since,
  [Parameter(Mandatory=$true)][string]$Until,
  [string]$Deployment = 'dpl_5LzumPYoTWPcWEfUtmWE11UhUcyn',
  [ValidateRange(1,10000)][int]$Limit = 1000
)
$ErrorActionPreference = 'Continue'
$raw = npx.cmd --yes vercel logs function-invocations --deployment $Deployment --since $Since --until $Until --json --limit $Limit 2>$null
if ($LASTEXITCODE -ne 0) { throw 'Could not read staging Vercel invocation logs.' }
$items = @($raw | Where-Object { $_ -match '^\{' } | ForEach-Object { $_ | ConvertFrom-Json } |
  Where-Object { $_.type -eq 'invocation' -and $_.data.clientUserAgent -like 'Assessly-staging-load-test*' } |
  ForEach-Object { $_.data })
function Percentile($values,[double]$fraction) {
  if (-not $values.Count) { return $null }
  $ordered = @($values | Sort-Object)
  return [math]::Round([double]$ordered[[math]::Min($ordered.Count-1,[math]::Ceiling($ordered.Count*$fraction)-1)],1)
}
$groups = @($items | Group-Object route,requestMethod | ForEach-Object {
  $rows = @($_.Group)
  [pscustomobject]@{
    route = $rows[0].route
    method = $rows[0].requestMethod
    requests = $rows.Count
    errors5xx = @($rows | Where-Object { $_.httpStatus -ge 500 }).Count
    timeouts = @($rows | Where-Object { $_.errorCode -match 'timeout' }).Count
    p50WallMs = Percentile @($rows | ForEach-Object { $_.functionDurationMs }) .5
    p95WallMs = Percentile @($rows | ForEach-Object { $_.functionDurationMs }) .95
    p99WallMs = Percentile @($rows | ForEach-Object { $_.functionDurationMs }) .99
    p95CpuMs = Percentile @($rows | ForEach-Object { $_.functionCpuTimeMs }) .95
    peakMemoryMb = ($rows | Measure-Object peakMemoryMb -Maximum).Maximum
    regions = @(($rows | Select-Object -ExpandProperty functionRegion -Unique))
  }
})
@{
  deployment = $Deployment
  since = $Since
  until = $Until
  matchedInvocations = $items.Count
  routes = $groups
} | ConvertTo-Json -Depth 5
