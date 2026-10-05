$ErrorActionPreference = 'Stop'

Set-Location -Path 'C:\Users\giann\spectra-app'
Write-Host 'Running capacitor sync...'
npx cap sync android
if ($LASTEXITCODE -ne 0) {
  npm exec cap sync android
  if ($LASTEXITCODE -ne 0) { throw 'cap sync android failed' }
}

Set-Location -Path 'C:\Users\giann\spectra-app\android'
Write-Host 'Running gradle bundleRelease assembleRelease...'
.\gradlew.bat bundleRelease assembleRelease
if ($LASTEXITCODE -ne 0) { throw 'gradle build failed' }

$backupDir = 'C:\Users\giann\spectra-app\backups\release-1.3.84'
New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
Copy-Item 'C:\Users\giann\spectra-app\android\app\build\outputs\bundle\release\app-release.aab' "$backupDir\gps-1.3.84.aab" -Force
Copy-Item 'C:\Users\giann\spectra-app\android\app\build\outputs\apk\release\app-release.apk' "$backupDir\gps-1.3.84.apk" -Force

Get-ChildItem $backupDir | Select-Object Name, @{n='MB';e={[math]::Round($_.Length/1MB,2)}}
