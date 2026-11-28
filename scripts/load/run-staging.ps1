param(
  [ValidateRange(0,200)][int]$Students = 0,
  [ValidateRange(0,10)][int]$BrowserStudents = 0,
  [switch]$IncludeBlankAnswer
)
# Windows PowerShell 5 surfaces native CLI stderr notices as terminating errors
# when Stop is set, even when redirected. Check native exit codes explicitly.
$ErrorActionPreference = 'Continue'
$stagingRef = 'ranrlqfsihteuwxhisek'
$deployment = 'https://examination-platform-git-staging-zaab2.vercel.app/login'
$headerFile = Join-Path $env:TEMP ('assessly-preview-cookie-' + [guid]::NewGuid().ToString('N') + '.txt')
$envFile = Join-Path $env:TEMP ('assessly-preview-env-' + [guid]::NewGuid().ToString('N') + '.env')

try {
  if ((Get-Content 'supabase/.temp/project-ref' -Raw).Trim() -ne $stagingRef) {
    throw 'Supabase CLI is not linked to the staging project.'
  }
  npx.cmd --yes vercel env pull $envFile --environment preview --git-branch staging --yes 2>$null | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Could not verify staging Preview configuration.' }
  $previewUrl = Get-Content -LiteralPath $envFile |
    Where-Object { $_ -match '^NEXT_PUBLIC_SUPABASE_URL=' } | Select-Object -First 1
  if ($previewUrl -notmatch 'ranrlqfsihteuwxhisek\.supabase\.co' -or
      $previewUrl -match 'sabhxtwffxwwkzvmqdks') {
    throw 'Preview branch does not point to the staging Supabase project.'
  }
  Write-Host 'Verified staging Preview Supabase target.'

  $keysJson = npx.cmd --yes supabase@2.65.5 projects api-keys --project-ref $stagingRef -o json 2>$null
  if ($LASTEXITCODE -ne 0) { throw 'Could not read staging API keys.' }
  $keys = $keysJson | ConvertFrom-Json
  $anon = ($keys | Where-Object { $_.type -eq 'legacy' -and $_.name -eq 'anon' } | Select-Object -First 1).api_key
  $service = ($keys | Where-Object { $_.type -eq 'legacy' -and $_.name -eq 'service_role' } | Select-Object -First 1).api_key
  if (-not $anon -or -not $service) { throw 'Staging API keys were incomplete.' }

  npx.cmd --yes vercel curl $deployment -- --silent --dump-header $headerFile --output NUL --header 'x-vercel-set-bypass-cookie: true' 2>$null | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Could not obtain a temporary Preview protection cookie.' }
  $cookieHeader = Get-Content -LiteralPath $headerFile |
    Where-Object { $_ -match '^set-cookie:\s*_vercel_jwt=' } | Select-Object -First 1
  if ($cookieHeader -notmatch '^set-cookie:\s*(_vercel_jwt=[^;]+)') { throw 'Preview protection cookie was not returned.' }
  $env:STAGING_VERCEL_BYPASS_COOKIE = $Matches[1]
  $env:STAGING_ANON_KEY = $anon
  $env:STAGING_SERVICE_ROLE_KEY = $service

  if ($Students -eq 0) { return }

  $env:LOAD_BROWSER_STUDENTS = [string]$BrowserStudents
  $env:LOAD_USE_SECTION_ACTION = '1'
  $env:LOAD_INCLUDE_BLANK_ANSWER = if ($IncludeBlankAnswer) { '1' } else { '0' }
  $log = Join-Path 'test-results' ('staging-load-' + $Students + '-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.jsonl')
  node scripts/load/real-exam-staging.mjs $Students 2>&1 | Tee-Object -FilePath $log
  if ($LASTEXITCODE -ne 0) { throw "Staging load failed; inspect $log and cleanup output." }
  Write-Host "Staging load completed. Metrics: $log"
} finally {
  Remove-Item -LiteralPath $headerFile -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $envFile -ErrorAction SilentlyContinue
  Remove-Item Env:STAGING_VERCEL_BYPASS_COOKIE,Env:STAGING_ANON_KEY,Env:STAGING_SERVICE_ROLE_KEY,Env:LOAD_BROWSER_STUDENTS,Env:LOAD_USE_SECTION_ACTION,Env:LOAD_INCLUDE_BLANK_ANSWER -ErrorAction SilentlyContinue
}
