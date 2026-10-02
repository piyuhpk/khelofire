# Builds the two shippable APKs from this repo.
#
#   .\scripts\build-apks.ps1 -Target user
#   .\scripts\build-apks.ps1 -Target admin
#   .\scripts\build-apks.ps1 -Target all
#
# The admin build gets its own applicationId (com.khelofire.admin) so it can sit
# on the same phone as the player app instead of replacing it. build.gradle is
# patched only for the duration of the admin build and restored afterwards, so
# the tracked android/ folder is never left dirty.
#
# Output: dist-apk\khelofire-user.apk and dist-apk\khelofire-admin.apk
param(
  [ValidateSet('user', 'admin', 'all')] [string]$Target = 'all',
  [switch]$SkipWeb
)

# Native tools (vite, gradle, cap) write normal progress to stderr, which
# PowerShell would otherwise promote to a terminating error. Keep the
# preference lenient and rely on explicit $LASTEXITCODE checks instead.
$ErrorActionPreference = 'Continue'
$root = Split-Path $PSScriptRoot -Parent
Push-Location $root

$sdk = if ($env:ANDROID_HOME) { $env:ANDROID_HOME }
       elseif ($env:ANDROID_SDK_ROOT) { $env:ANDROID_SDK_ROOT }
       else { Join-Path $env:LOCALAPPDATA 'Android\Sdk' }
if (-not (Test-Path $sdk)) { throw "Android SDK not found. Set ANDROID_HOME to your SDK path." }
$env:ANDROID_HOME = $sdk
$env:ANDROID_SDK_ROOT = $sdk
Write-Host "SDK: $sdk"

# Capacitor 8 compiles with source/target 21, so a JDK 17 on PATH fails with
# "invalid source release: 21". Find the newest JDK we have that is >= 21.
function Get-Major([string]$javaExe) {
  if (-not $javaExe) { return 0 }
  $raw = & $javaExe '-version' 2>&1 | Select-Object -First 1
  if ("$raw" -match 'version "(\d+)') { return [int]$Matches[1] }
  return 0
}
$jdkCandidates = @()
$regPaths = @('HKLM:\SOFTWARE\JavaSoft\JDK', 'HKLM:\SOFTWARE\JavaSoft\Java Development Kit')
foreach ($rp in $regPaths) {
  if (Test-Path $rp) {
    foreach ($k in Get-ChildItem $rp) {
      $jh = (Get-ItemProperty $k.PSPath).JavaHome
      if ($jh) { $jdkCandidates += $jh }
    }
  }
}
$jdkCandidates += @("$env:ProgramFiles\Java", 'D:\Program Files\Java', "$env:ProgramFiles\Microsoft", "$env:ProgramFiles\Eclipse Adoptium", "$env:ProgramFiles\Android") |
  ForEach-Object { if (Test-Path $_) { Get-ChildItem $_ -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -match '^jdk' } | ForEach-Object { $_.FullName } } }

$best = $null; $bestVer = 0
foreach ($c in ($jdkCandidates | Select-Object -Unique)) {
  $exe = Join-Path $c 'bin\java.exe'
  if (-not (Test-Path $exe)) { continue }
  $v = Get-Major $exe
  if ($v -ge 21 -and $v -gt $bestVer) { $bestVer = $v; $best = $c }
}
if ($best) {
  $env:JAVA_HOME = $best
  Write-Host "JDK : $best (v$bestVer)  <- required >= 21" -ForegroundColor Green
} else {
  Write-Warning "No JDK >= 21 found. Install Temurin/JDK 21 or set JAVA_HOME, otherwise gradle fails with 'invalid source release: 21'."
}

$outDir = Join-Path $root 'dist-apk'
New-Item -ItemType Directory -Path $outDir -Force | Out-Null

$gradlew  = Join-Path $root 'android\gradlew.bat'
$buildGradle = Join-Path $root 'android\app\build.gradle'
$strings    = Join-Path $root 'android\app\src\main\res\values\strings.xml'
$envFile    = Join-Path $root '.env'

# remember everything we touch so the tree is clean at the end
$bak = @{}
foreach ($f in @($buildGradle, $strings, $envFile)) { $bak[$f] = Get-Content -LiteralPath $f -Raw }

function Restore-Repo {
  Write-Host "`n-- restoring patched files --" -ForegroundColor DarkGray
  foreach ($f in $bak.Keys) { Set-Content -LiteralPath $f -Value $bak[$f] -NoNewline }
  Write-Host "   android\app\build.gradle, strings.xml and .env are back to their original content." -ForegroundColor DarkGray
}

function Set-AdminAppId([bool]$on) {
  $g = Get-Content -LiteralPath $buildGradle -Raw
  $g = $g -replace 'applicationId "com\.khelofire\.(app|admin)"', ('applicationId "com.khelofire.' + $(if ($on) { 'admin' } else { 'app' }) + '"')
  Set-Content -LiteralPath $buildGradle -Value $g -NoNewline
  $s = Get-Content -LiteralPath $strings -Raw
  $name = if ($on) { 'KheloFire Admin' } else { 'KheloFire' }
  $s = $s -replace '<string name="app_name">[^<]*</string>', ('<string name="app_name">' + $name + '</string>')
  $s = $s -replace '<string name="title_activity_main">[^<]*</string>', ('<string name="title_activity_main">' + $name + '</string>')
  Set-Content -LiteralPath $strings -Value $s -NoNewline
}

function Set-AdminEnv([bool]$on) {
  $e = Get-Content -LiteralPath $envFile -Raw
  if ($on) {
    if ($e -match 'VITE_ADMIN_BUILD') { $e = $e -replace 'VITE_ADMIN_BUILD=.*', 'VITE_ADMIN_BUILD=true' }
    else { $e = $e.TrimEnd() + "`nVITE_ADMIN_BUILD=true`n" }
  } else {
    $e = $e -replace '(?m)^\s*VITE_ADMIN_BUILD=.*\r?\n', ''
  }
  Set-Content -LiteralPath $envFile -Value $e -NoNewline
}

function Build-One([string]$which) {
  $isAdmin = $which -eq 'admin'
  Write-Host "`n================ BUILD: $which ================" -ForegroundColor Cyan

  Set-AdminAppId $isAdmin
  Set-AdminEnv $isAdmin

  if (-not $SkipWeb) {
    Write-Host "building web bundle..." -ForegroundColor Gray
    & npm run build
    if ($LASTEXITCODE -ne 0) { throw "vite build failed" }
  }

  Write-Host "cap sync android..." -ForegroundColor Gray
  & npx cap sync android
  if ($LASTEXITCODE -ne 0) { throw "cap sync failed" }

  Write-Host "gradle assembleDebug..." -ForegroundColor Gray
  Push-Location (Join-Path $root 'android')
  & $gradlew assembleDebug --console=plain -q
  $rc = $LASTEXITCODE
  Pop-Location
  if ($rc -ne 0) { throw "gradle failed ($rc)" }

  $apk = Join-Path $root 'android\app\build\outputs\apk\debug\app-debug.apk'
  if (-not (Test-Path $apk)) { throw "APK not produced at $apk" }
  $dest = Join-Path $outDir "khelofire-$which.apk"
  Copy-Item -LiteralPath $apk -Destination $dest -Force

  $hash = (Get-FileHash -LiteralPath $dest -Algorithm SHA256).Hash
  $mb = [math]::Round((Get-Item $dest).Length / 1MB, 2)
  Write-Host "OK  $dest  ($mb MB)" -ForegroundColor Green
  Write-Host "    sha256 $hash" -ForegroundColor DarkGray
}

try {
  if ($Target -eq 'user' -or $Target -eq 'all') { Build-One 'user' }
  if ($Target -eq 'admin' -or $Target -eq 'all') { Build-One 'admin' }
} finally {
  Restore-Repo
  Pop-Location
}

Write-Host "`nDone. Install order: khelofire-user.apk, then khelofire-admin.apk." -ForegroundColor Cyan
Write-Host "These are DEBUG builds signed with the auto-generated debug key." -ForegroundColor Yellow
Write-Host "For Play Store / direct release you need your own keystore in android\app\build.gradle and assembleRelease." -ForegroundColor Yellow
