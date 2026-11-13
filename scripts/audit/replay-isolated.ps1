param([Parameter(Mandatory=$true)][string]$Container, [switch]$TestsOnly)
$ErrorActionPreference='Stop'
if ($Container -notmatch '^assessly-audit-[a-f0-9]{32}$') { throw 'Disposable audit container required' }
$directory=Join-Path $PSScriptRoot '../../docs/audits/production-readiness/evidence'
function Sql([string]$statement, [string]$User='postgres') {
  $result=$statement | docker exec -i $Container psql -U $User -d postgres -X -q -A -t -v ON_ERROR_STOP=1 2>&1
  if ($LASTEXITCODE -ne 0) { throw ($result | Out-String) }
  return $result
}
$migrations=@(Get-ChildItem (Join-Path $PSScriptRoot '../../supabase/migrations') -Filter '*.sql' | Sort-Object Name)
if (-not $TestsOnly) {
if ((Sql "select count(*) from pg_tables where schemaname='public';") -ne '0') { throw 'Replay requires an empty public schema' }
# The managed image reserves superuser privileges for supabase_admin. Local
# migrations and fixture tests expect postgres to perform provider admin tasks.
Sql 'alter role postgres superuser;' 'supabase_admin' | Out-Null
Write-Host 'Preparing managed Auth and Storage schema in disposable database'
# The database image initializes Auth but not the Storage service tables. Copy
# only managed schema definitions, never application tables, policies or data.
$managed = docker exec supabase_db_summit-sat pg_dump -U postgres -d postgres --schema-only --schema=auth --schema=storage --no-owner --no-privileges
if ($LASTEXITCODE -ne 0) { throw 'Managed schema export failed' }
# Remove application trigger/policy definitions while retaining managed primary
# keys, indexes and foreign keys. pg_dump emits these CREATE statements whole.
$managedSql=[regex]::Replace(($managed -join "`n"),'(?ms)^CREATE (TRIGGER|POLICY)\b.*?;\n','')
Write-Host 'Replacing image-managed schemas'
Sql 'drop schema auth cascade; drop schema storage cascade;' 'supabase_admin' | Out-Null
Write-Host 'Restoring managed schema definitions'
Sql $managedSql 'supabase_admin' | Out-Null
Write-Host 'Granting disposable test roles'
Sql 'grant usage on schema auth,storage to anon,authenticated,service_role,postgres; grant all on all tables in schema auth,storage to postgres; grant all on all sequences in schema auth,storage to postgres; grant all on all tables in schema storage to authenticated,service_role;' 'supabase_admin' | Out-Null
# The first application migration defines Storage object policies as postgres.
# Image-managed tables are owned by supabase_admin in this isolated harness.
Sql 'alter table storage.objects owner to postgres;' 'supabase_admin' | Out-Null
Sql 'create extension if not exists pg_cron; create extension if not exists dblink; create extension if not exists pgtap with schema extensions;' 'supabase_admin' | Out-Null
foreach ($file in $migrations) {
  Write-Host "Applying $($file.Name)"
  Sql (Get-Content $file.FullName -Raw) | Out-Null
}
Sql ('set search_path=public,extensions; '+(Get-Content (Join-Path $PSScriptRoot '../../supabase/seed.sql') -Raw)) | Out-Null
}
# dblink requires password-authenticated TCP even in a network-isolated container.
docker exec $Container sh -c 'sed -i "1ihost all all 127.0.0.1/32 scram-sha-256" /etc/postgresql/pg_hba.conf'
if ($LASTEXITCODE -ne 0) { throw 'Cannot configure disposable loopback authentication' }
Sql "alter role postgres password 'postgres'; select pg_reload_conf();" 'supabase_admin' | Out-Null
$results=@()
foreach ($file in Get-ChildItem (Join-Path $PSScriptRoot '../../supabase/tests') -Filter '*.sql') {
  # dblink stays inside this isolated container; never connects to shared local DB.
  $query=(Get-Content $file.FullName -Raw).Replace('host=host.docker.internal port=54322','host=127.0.0.1 port=5432')
  $output=Sql $query
  $output | Set-Content (Join-Path $directory "replay-$($file.BaseName).tap")
  $passed=@($output | Where-Object { $_ -match '^ok \d+' }).Count
  $failed=@($output | Where-Object { $_ -match '^not ok|Looks like you' }).Count
  $plans=@($output | Where-Object { $_ -match '^1\.\.[0-9]+$' })
  if ($plans.Count -ne 1 -or [int]($plans[0].Substring(3)) -ne ($passed+$failed)) { throw "Missing/incomplete TAP plan in $($file.Name)" }
  $results += [pscustomobject]@{file=$file.Name;passed=$passed;failed=$failed}
}
@{date=(Get-Date).ToString('o');migrations=@($migrations.Name);tests=$results;image='public.ecr.aws/supabase/postgres:17.6.1.166';cpus=2;memoryGiB=2} | ConvertTo-Json -Depth 6 | Set-Content (Join-Path $directory 'fresh-replay.json')
$results | Format-Table
if (($results | Measure-Object failed -Sum).Sum -gt 0) { throw 'Database regressions failed after fresh replay' }
