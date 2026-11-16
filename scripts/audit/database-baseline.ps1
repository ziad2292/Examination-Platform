param([string]$Label = 'before')
$ErrorActionPreference = 'Stop'
$container = 'supabase_db_summit-sat'
$database = 'assessly_audit_' + [guid]::NewGuid().ToString('N')
$directory = Join-Path $PSScriptRoot '../../docs/audits/production-readiness/evidence'
function Sql([string]$statement) {
  $result = $statement | docker exec -i $container psql -U postgres -d $database -X -q -A -t -v ON_ERROR_STOP=1 2>&1
  if ($LASTEXITCODE -ne 0) { throw ($result | Out-String) }
  return $result
}
try {
  docker exec $container createdb -U postgres $database
  if ($LASTEXITCODE -ne 0) { throw 'Cannot create disposable database' }
  $schema = docker exec $container pg_dump -U postgres -d postgres --schema-only --schema=public --schema=auth --schema=storage --schema=extensions --no-owner
  if ($LASTEXITCODE -ne 0) { throw 'Schema export failed' }
  Sql 'create schema if not exists extensions; create extension if not exists pgcrypto with schema extensions; create extension if not exists "uuid-ossp" with schema extensions; create extension if not exists pgtap with schema extensions;' | Out-Null
  Sql (($schema | Where-Object { $_ -notin @('CREATE SCHEMA extensions;', 'CREATE SCHEMA public;') -and $_ -notmatch '^ALTER DEFAULT PRIVILEGES' }) -join "`n") | Out-Null
  Sql ('set search_path=public,extensions; ' + (Get-Content (Join-Path $PSScriptRoot '../../supabase/seed.sql') -Raw)) | Out-Null
  Sql @'
insert into storage.buckets(id,name,public) values ('question-images','question-images',false);
insert into public.integrity_global_policy(settings) values ('{"threshold":3,"queue_limit":200,"stale_seconds":60,"retention_days":90,"delayed_seconds":30,"cooldown_seconds":10,"attention_seconds":2,"heartbeat_seconds":20}');
'@ | Out-Null
  $results = @()
  foreach ($file in Get-ChildItem (Join-Path $PSScriptRoot '../../supabase/tests') -Filter '*.sql') {
    $output = Sql (Get-Content $file.FullName -Raw)
    $output | Set-Content (Join-Path $directory "$Label-$($file.BaseName).tap")
    $passed = @($output | Where-Object { $_ -match '^ok \d+' }).Count
    $failed = @($output | Where-Object { $_ -match '^not ok|Looks like you' }).Count
    $results += [pscustomobject]@{file=$file.Name; passed=$passed; failed=$failed}
  }
  $results | ConvertTo-Json | Set-Content (Join-Path $directory "$Label-database.json")
  $results | Format-Table
  if (($results | Measure-Object failed -Sum).Sum -gt 0) { throw 'Database assertions failed' }
} finally {
  # Only this randomly named disposable database is removed. Shared local data is untouched.
  if ($database -match '^assessly_audit_[a-f0-9]{32}$') { docker exec $container dropdb -U postgres --if-exists $database }
}
