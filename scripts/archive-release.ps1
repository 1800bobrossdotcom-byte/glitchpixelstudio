Set-Location 'C:\Users\giann\spectra-app'
New-Item -ItemType Directory -Force -Path 'backups\release-1.3.41' | Out-Null
Copy-Item 'android\app\build\outputs\apk\release\app-release.apk' 'backups\release-1.3.41\spectra-1.3.41.apk' -Force
Copy-Item 'android\app\build\outputs\bundle\release\app-release.aab' 'backups\release-1.3.41\spectra-1.3.41.aab' -Force
Get-ChildItem 'backups\release-1.3.41' | ForEach-Object { "{0}: {1:N2} MB" -f $_.Name, ($_.Length/1MB) }
