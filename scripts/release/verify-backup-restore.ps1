param(
  [Parameter(Mandatory=$true)][string]$EncryptedBackup,
  [Parameter(Mandatory=$true)][string]$KeyFile
)
$ErrorActionPreference = 'Stop'
$backup = (Resolve-Path -LiteralPath $EncryptedBackup).Path
$key = (Resolve-Path -LiteralPath $KeyFile).Path
$root = [IO.Path]::GetDirectoryName($backup)
$scratch = [IO.Path]::GetFullPath((Join-Path $root "restore-check-$([guid]::NewGuid().ToString('N'))"))
$container = 'assessly-audit-' + [guid]::NewGuid().ToString('N')
if (-not $scratch.StartsWith($root.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase) -or
    $container -notmatch '^assessly-audit-[a-f0-9]{32}$') { throw 'Unsafe disposable target' }
$started = $false
try {
  New-Item -ItemType Directory -Path $scratch | Out-Null
  $archive = Join-Path $scratch 'backup.tar'
  & node (Join-Path $PSScriptRoot 'backup-crypto.mjs') decrypt $backup $archive $key | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Backup authentication failed' }
  & tar -xf $archive -C $scratch
  if ($LASTEXITCODE -ne 0) { throw 'Backup archive extraction failed' }
  $manifest = Get-Content (Join-Path $scratch 'manifest.json') -Raw | ConvertFrom-Json
  foreach ($file in $manifest.files) {
    $path = Join-Path $scratch $file.name
    if (-not (Test-Path -LiteralPath $path) -or (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash -ne $file.sha256) {
      throw 'Backup manifest verification failed'
    }
  }
  docker run -d --name $container --network none --cpus 2 --memory 2g -e POSTGRES_PASSWORD=postgres public.ecr.aws/supabase/postgres:17.6.1.166 -c max_connections=100 -c shared_preload_libraries=pg_cron -c cron.database_name=postgres | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Disposable database could not start' }
  $started = $true
  $ready = $false
  for ($i=0; $i -lt 45; $i++) {
    docker exec $container psql -U postgres -d postgres -X -q -A -t -c 'select 1' *> $null
    if ($LASTEXITCODE -eq 0) { $ready = $true; break }
    Start-Sleep -Seconds 1
  }
  if (-not $ready) { throw 'Disposable database did not become ready' }
  Start-Sleep -Seconds 3
  'alter role postgres superuser;' | docker exec -i $container psql -U supabase_admin -d postgres -X -q -v ON_ERROR_STOP=1 *> (Join-Path $scratch 'restore.log')
  if ($LASTEXITCODE -ne 0) { throw 'Disposable role setup failed' }
  # Rebuild the managed schemas from the source project's schema snapshots.
  # The base Docker image can lag hosted Auth/Storage table definitions.
  if (-not (Test-Path (Join-Path $scratch 'auth_schema.sql')) -or
      -not (Test-Path (Join-Path $scratch 'storage_schema.sql'))) { throw 'Backup lacks managed schema snapshots' }
  $storageSql = Get-Content (Join-Path $scratch 'storage_schema.sql') -Raw
  $postPattern = '(?ms)^CREATE (?:POLICY|TRIGGER)\b.*?;\r?\n'
  $postSql = ([regex]::Matches($storageSql,$postPattern) | ForEach-Object { $_.Value }) -join "`n"
  [IO.File]::WriteAllText((Join-Path $scratch 'storage_core.sql'),[regex]::Replace($storageSql,$postPattern,''))
  [IO.File]::WriteAllText((Join-Path $scratch 'storage_post.sql'),$postSql)
  'drop schema auth cascade; drop schema storage cascade;' | docker exec -i $container psql -U supabase_admin -d postgres -X -q -v ON_ERROR_STOP=1 *>> (Join-Path $scratch 'restore.log')
  if ($LASTEXITCODE -ne 0) { throw 'Managed schema reset failed' }
  foreach ($name in @('roles.sql','auth_schema.sql','storage_core.sql','storage_post.sql','schema.sql','data.sql','history_schema.sql','history_data.sql')) {
    docker cp (Join-Path $scratch $name) "${container}:/tmp/$name" *> $null
    if ($LASTEXITCODE -ne 0) { throw "Could not copy $name into disposable database" }
  }
  foreach ($name in @('roles.sql','auth_schema.sql','storage_core.sql','schema.sql','storage_post.sql')) {
    docker exec $container psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 -f "/tmp/$name" *>> (Join-Path $scratch 'restore.log')
    if ($LASTEXITCODE -ne 0) { throw "Disposable restore failed at $name; plaintext log was removed" }
  }
  docker exec $container psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 -c 'set session_replication_role=replica' -f /tmp/data.sql *>> (Join-Path $scratch 'restore.log')
  if ($LASTEXITCODE -ne 0) { throw 'Disposable restore failed at data.sql; plaintext log was removed' }
  foreach ($name in @('history_schema.sql','history_data.sql')) {
    docker exec $container psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 -f "/tmp/$name" *>> (Join-Path $scratch 'restore.log')
    if ($LASTEXITCODE -ne 0) { throw "Disposable restore failed at $name; plaintext log was removed" }
  }
  $counts = docker exec $container psql -U postgres -d postgres -X -A -t -c 'select (select count(*) from public.profiles),(select count(*) from public.exams),(select count(*) from public.exam_attempts),(select count(*) from auth.users),(select count(*) from storage.objects),(select count(*) from supabase_migrations.schema_migrations);'
  if ($LASTEXITCODE -ne 0) { throw 'Restored row counts could not be checked' }
  Write-Host "Disposable database restore succeeded. Counts (profiles, exams, attempts, Auth users, Storage metadata, migrations): $counts"
} catch {
  $log = Join-Path $scratch 'restore.log'
  if (Test-Path -LiteralPath $log) {
    @(Get-Content -LiteralPath $log | Where-Object { $_ -match 'ERROR:' } | Select-Object -First 2) |
      ForEach-Object { Write-Warning (($_ -replace "'[^']*'", "'[redacted]'") -replace '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}', '[email]') }
  }
  throw
} finally {
  if ($started -and $container -match '^assessly-audit-[a-f0-9]{32}$') { docker rm -f $container *> $null }
  if (Test-Path -LiteralPath $scratch) {
    if (-not $scratch.StartsWith($root.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe scratch cleanup target' }
    Remove-Item -LiteralPath $scratch -Recurse -Force
  }
}
