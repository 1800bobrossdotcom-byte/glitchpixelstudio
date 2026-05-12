Set-Location 'C:\Users\giann\spectra-app'
$ver = '1.3.42'
$dir = "backups\release-$ver"
New-Item -ItemType Directory -Force -Path $dir | Out-Null
Copy-Item 'android\app\build\outputs\apk\release\app-release.apk' "$dir\spectra-$ver.apk" -Force
Copy-Item 'android\app\build\outputs\bundle\release\app-release.aab' "$dir\spectra-$ver.aab" -Force
Get-ChildItem $dir | ForEach-Object { "{0}: {1:N2} MB" -f $_.Name, ($_.Length/1MB) }
