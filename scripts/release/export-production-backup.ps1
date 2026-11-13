param(
  [Parameter(Mandatory=$true)][string]$BackupRoot,
  [Parameter(Mandatory=$true)][string]$KeyRoot,
  [string]$ExistingKeyFile
)
$ErrorActionPreference = 'Stop'
$projectRef = 'sabhxtwffxwwkzvmqdks'
$linkedRef = (Get-Content (Join-Path $PSScriptRoot '../../supabase/.temp/project-ref') -Raw).Trim()
if ($linkedRef -ne $projectRef) { throw 'The linked Supabase project is not the reviewed production target' }
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$backupRootFull = [IO.Path]::GetFullPath($BackupRoot)
$keyRootFull = [IO.Path]::GetFullPath($KeyRoot)
if ($backupRootFull.StartsWith($repoRoot, [StringComparison]::OrdinalIgnoreCase) -or
    $keyRootFull.StartsWith($repoRoot, [StringComparison]::OrdinalIgnoreCase) -or
    $backupRootFull -eq $keyRootFull) {
  throw 'Backup and key must be in separate folders outside the Git workspace'
}
New-Item -ItemType Directory -Path $backupRootFull,$keyRootFull -Force | Out-Null
$stamp = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ')
$base = "assessly-$projectRef-$stamp"
$scratch = [IO.Path]::GetFullPath((Join-Path $backupRootFull "work-$([guid]::NewGuid().ToString('N'))"))
if (-not $scratch.StartsWith($backupRootFull.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) {
  throw 'Scratch folder escaped the backup directory'
}
$encrypted = Join-Path $backupRootFull "$base.assessly.enc"
$key = if ($ExistingKeyFile) { [IO.Path]::GetFullPath($ExistingKeyFile) } else { Join-Path $keyRootFull "$base.key" }
if ($ExistingKeyFile -and ((-not (Test-Path -LiteralPath $key)) -or (Get-Item -LiteralPath $key).Length -ne 32)) { throw 'Existing recovery key is missing or invalid' }
$completed = $false
try {
  New-Item -ItemType Directory -Path $scratch | Out-Null
  $roles = Join-Path $scratch 'roles.sql'
  $schema = Join-Path $scratch 'schema.sql'
  $data = Join-Path $scratch 'data.sql'
  $historySchema = Join-Path $scratch 'history_schema.sql'
  $historyData = Join-Path $scratch 'history_data.sql'
  $authSchema = Join-Path $scratch 'auth_schema.sql'
  $storageSchema = Join-Path $scratch 'storage_schema.sql'
  & npx --no-install supabase db dump --remote --role-only --file $roles
  if ($LASTEXITCODE -ne 0) { throw 'Role export failed' }
  & npx --no-install supabase db dump --remote --file $schema
  if ($LASTEXITCODE -ne 0) { throw 'Schema export failed' }
  & npx --no-install supabase db dump --remote --data-only --use-copy -x storage.buckets_vectors -x storage.vector_indexes --file $data
  if ($LASTEXITCODE -ne 0) { throw 'Data export failed' }
  & npx --no-install supabase db dump --remote --schema supabase_migrations --file $historySchema
  if ($LASTEXITCODE -ne 0) { throw 'Migration-history schema export failed' }
  & npx --no-install supabase db dump --remote --schema supabase_migrations --data-only --use-copy --file $historyData
  if ($LASTEXITCODE -ne 0) { throw 'Migration-history data export failed' }
  & npx --no-install supabase db dump --remote --schema auth --file $authSchema
  if ($LASTEXITCODE -ne 0) { throw 'Managed Auth schema export failed' }
  & npx --no-install supabase db dump --remote --schema storage --file $storageSchema
  if ($LASTEXITCODE -ne 0) { throw 'Managed Storage schema export failed' }
  $names = @('roles.sql','schema.sql','data.sql','history_schema.sql','history_data.sql','auth_schema.sql','storage_schema.sql')
  foreach ($name in $names) { if ((Get-Item (Join-Path $scratch $name)).Length -eq 0) { throw "Empty export: $name" } }
  $manifest = [ordered]@{
    projectRef = $projectRef
    exportedAtUtc = (Get-Date).ToUniversalTime().ToString('o')
    sourceCommit = (git rev-parse HEAD).Trim()
    files = @($names | ForEach-Object { $item = Get-Item (Join-Path $scratch $_); [ordered]@{ name=$_.ToString(); bytes=$item.Length; sha256=(Get-FileHash $item.FullName -Algorithm SHA256).Hash } })
    limitation = 'Storage object bytes are not included; only database metadata is exported.'
  }
  $manifest | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $scratch 'manifest.json')
  $archive = Join-Path $scratch 'backup.tar'
  & tar -cf $archive -C $scratch roles.sql schema.sql data.sql history_schema.sql history_data.sql auth_schema.sql storage_schema.sql manifest.json
  if ($LASTEXITCODE -ne 0) { throw 'Archive creation failed' }
  if (-not $ExistingKeyFile) {
    & node (Join-Path $PSScriptRoot 'backup-crypto.mjs') generate-key $key
    if ($LASTEXITCODE -ne 0) { throw 'Recovery key creation failed' }
  }
  & node (Join-Path $PSScriptRoot 'backup-crypto.mjs') encrypt $archive $encrypted $key
  if ($LASTEXITCODE -ne 0) { throw 'Backup encryption failed' }
  $verified = Join-Path $scratch 'verified.tar'
  & node (Join-Path $PSScriptRoot 'backup-crypto.mjs') decrypt $encrypted $verified $key
  if ($LASTEXITCODE -ne 0 -or (Get-FileHash $archive).Hash -ne (Get-FileHash $verified).Hash) {
    throw 'Encrypted backup failed round-trip verification'
  }
  $completed = $true
  Write-Host "Encrypted database backup: $encrypted"
  Write-Host "Separate recovery key: $key"
  Write-Host "Encrypted SHA256: $((Get-FileHash $encrypted -Algorithm SHA256).Hash)"
  Write-Host 'Copy the encrypted backup and recovery key to separate off-site locations.'
  Write-Host 'Storage object bytes require a separate backup.'
} finally {
  if (Test-Path -LiteralPath $scratch) {
    if (-not $scratch.StartsWith($backupRootFull.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe scratch cleanup target' }
    Remove-Item -LiteralPath $scratch -Recurse -Force
  }
  if (-not $completed) {
    if (Test-Path -LiteralPath $encrypted) { Remove-Item -LiteralPath $encrypted -Force }
    if (-not $ExistingKeyFile -and (Test-Path -LiteralPath $key)) { Remove-Item -LiteralPath $key -Force }
  }
}
