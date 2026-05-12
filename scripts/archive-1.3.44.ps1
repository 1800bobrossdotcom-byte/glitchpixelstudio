$ver = '1.3.44'
$dst = "C:\Users\giann\spectra-app\backups\release-$ver"
New-Item -ItemType Directory -Force -Path $dst | Out-Null
Copy-Item "C:\Users\giann\spectra-app\android\app\build\outputs\apk\release\app-release.apk" "$dst\spectra-$ver.apk"
Copy-Item "C:\Users\giann\spectra-app\android\app\build\outputs\bundle\release\app-release.aab" "$dst\spectra-$ver.aab"
Get-ChildItem $dst | Format-Table Name, @{Name='MB';Expression={[math]::Round($_.Length/1MB,2)}}
