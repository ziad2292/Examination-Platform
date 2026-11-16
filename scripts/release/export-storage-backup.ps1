param(
  [Parameter(Mandatory=$true)][string]$BackupRoot,
  [Parameter(Mandatory=$true)][string]$KeyFile
)
$ErrorActionPreference = 'Stop'
$projectRef = 'sabhxtwffxwwkzvmqdks'
$linkedRef = (Get-Content (Join-Path $PSScriptRoot '../../supabase/.temp/project-ref') -Raw).Trim()
if ($linkedRef -ne $projectRef) { throw 'The linked Supabase project is not the reviewed production target' }
$backupRootFull = [IO.Path]::GetFullPath($BackupRoot)
$keyFull = [IO.Path]::GetFullPath($KeyFile)
if (-not (Test-Path -LiteralPath $keyFull) -or (Get-Item -LiteralPath $keyFull).Length -ne 32) { throw 'A separate 32-byte recovery key is required' }
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
if ($backupRootFull.StartsWith($repoRoot, [StringComparison]::OrdinalIgnoreCase)) { throw 'Storage backup must stay outside Git' }
$stamp = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ')
$base = "assessly-storage-$projectRef-$stamp"
$scratch = [IO.Path]::GetFullPath((Join-Path $backupRootFull "storage-work-$([guid]::NewGuid().ToString('N'))"))
if (-not $scratch.StartsWith($backupRootFull.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe scratch path' }
$archive = Join-Path $backupRootFull "$base.tar.tmp"
$verified = Join-Path $backupRootFull "$base.verify.tmp"
$encrypted = Join-Path $backupRootFull "$base.assessly.enc"
$completed = $false
try {
  New-Item -ItemType Directory -Path $scratch | Out-Null
  $listing = & npx --no-install supabase --experimental storage ls --remote --recursive ss:///question-images 2>$null
  if ($LASTEXITCODE -ne 0) { throw 'Could not list production question images' }
  $expectedPaths = @(($listing | Select-Object -Last 1 | ConvertFrom-Json).paths)
  if ($expectedPaths.Count -eq 0) { throw 'Question-image listing is empty; inspect before exporting' }
  Push-Location $scratch
  try {
    & npx --no-install supabase storage cp -r -j 8 ss:///question-images . --experimental --remote=$projectRef 2>&1 | Out-Null
  } finally {
    Pop-Location
  }
  if ($LASTEXITCODE -ne 0) { throw 'Question-image download failed' }
  # The CLI may create link metadata in the current directory. It is not a
  # Storage object and must not be included in the encrypted object archive.
  $cliTemp = [IO.Path]::GetFullPath((Join-Path $scratch 'supabase/.temp'))
  if (Test-Path -LiteralPath $cliTemp) {
    if (-not $cliTemp.StartsWith($scratch.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe CLI metadata cleanup target' }
    Remove-Item -LiteralPath $cliTemp -Recurse -Force
  }
  $files = @(Get-ChildItem -LiteralPath $scratch -Recurse -File)
  foreach ($path in $expectedPaths) {
    $relative = ([string]$path).TrimStart('/').Replace('/','\')
    $resolved = [IO.Path]::GetFullPath((Join-Path $scratch $relative))
    if (-not $resolved.StartsWith($scratch.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase) -or
        -not (Test-Path -LiteralPath $resolved -PathType Leaf)) {
      throw 'A listed question image was not downloaded'
    }
  }
  $manifest = [ordered]@{
    projectRef = $projectRef
    bucket = 'question-images'
    exportedAtUtc = (Get-Date).ToUniversalTime().ToString('o')
    count = $files.Count
    files = @($files | ForEach-Object { [ordered]@{ path=$_.FullName.Substring($scratch.Length+1).Replace('\','/'); bytes=$_.Length; sha256=(Get-FileHash $_.FullName -Algorithm SHA256).Hash } })
  }
  $manifest | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $scratch 'storage-manifest.json')
  & tar -cf $archive -C $scratch .
  if ($LASTEXITCODE -ne 0) { throw 'Storage archive failed' }
  & node (Join-Path $PSScriptRoot 'backup-crypto.mjs') encrypt $archive $encrypted $keyFull
  if ($LASTEXITCODE -ne 0) { throw 'Storage encryption failed' }
  & node (Join-Path $PSScriptRoot 'backup-crypto.mjs') decrypt $encrypted $verified $keyFull
  if ($LASTEXITCODE -ne 0 -or (Get-FileHash $archive).Hash -ne (Get-FileHash $verified).Hash) { throw 'Storage encrypted round-trip failed' }
  $completed = $true
  Write-Host "Encrypted storage backup: $encrypted"
  Write-Host "Question-image objects: $($files.Count)"
  Write-Host "Encrypted SHA256: $((Get-FileHash $encrypted -Algorithm SHA256).Hash)"
} finally {
  if (Test-Path -LiteralPath $scratch) {
    if (-not $scratch.StartsWith($backupRootFull.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe scratch cleanup target' }
    Remove-Item -LiteralPath $scratch -Recurse -Force
  }
  if (Test-Path -LiteralPath $archive) { Remove-Item -LiteralPath $archive -Force }
  if (Test-Path -LiteralPath $verified) { Remove-Item -LiteralPath $verified -Force }
  if (-not $completed -and (Test-Path -LiteralPath $encrypted)) { Remove-Item -LiteralPath $encrypted -Force }
}
