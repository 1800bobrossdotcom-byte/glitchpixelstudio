$src = "C:\Users\giann\spectra-app\public\spectra\gps_logo.png"
Add-Type -AssemblyName System.Drawing
function Resize-Icon($outPath, $size) {
  $img = [System.Drawing.Image]::FromFile($src)
  $bmp = New-Object System.Drawing.Bitmap($size, $size)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.Clear([System.Drawing.Color]::Black)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $g.DrawImage($img, 0, 0, $size, $size)
  $bmp.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose(); $img.Dispose()
}
Resize-Icon "C:\Users\giann\spectra-app\android\app\src\main\res\mipmap-mdpi\ic_launcher.png" 48
Resize-Icon "C:\Users\giann\spectra-app\android\app\src\main\res\mipmap-mdpi\ic_launcher_round.png" 48
Resize-Icon "C:\Users\giann\spectra-app\android\app\src\main\res\mipmap-mdpi\ic_launcher_foreground.png" 108
Resize-Icon "C:\Users\giann\spectra-app\android\app\src\main\res\mipmap-hdpi\ic_launcher.png" 72
Resize-Icon "C:\Users\giann\spectra-app\android\app\src\main\res\mipmap-hdpi\ic_launcher_round.png" 72
Resize-Icon "C:\Users\giann\spectra-app\android\app\src\main\res\mipmap-hdpi\ic_launcher_foreground.png" 162
Resize-Icon "C:\Users\giann\spectra-app\android\app\src\main\res\mipmap-xhdpi\ic_launcher.png" 96
Resize-Icon "C:\Users\giann\spectra-app\android\app\src\main\res\mipmap-xhdpi\ic_launcher_round.png" 96
Resize-Icon "C:\Users\giann\spectra-app\android\app\src\main\res\mipmap-xhdpi\ic_launcher_foreground.png" 216
Resize-Icon "C:\Users\giann\spectra-app\android\app\src\main\res\mipmap-xxhdpi\ic_launcher.png" 144
Resize-Icon "C:\Users\giann\spectra-app\android\app\src\main\res\mipmap-xxhdpi\ic_launcher_round.png" 144
Resize-Icon "C:\Users\giann\spectra-app\android\app\src\main\res\mipmap-xxhdpi\ic_launcher_foreground.png" 324
Resize-Icon "C:\Users\giann\spectra-app\android\app\src\main\res\mipmap-xxxhdpi\ic_launcher.png" 192
Resize-Icon "C:\Users\giann\spectra-app\android\app\src\main\res\mipmap-xxxhdpi\ic_launcher_round.png" 192
Resize-Icon "C:\Users\giann\spectra-app\android\app\src\main\res\mipmap-xxxhdpi\ic_launcher_foreground.png" 432
Copy-Item $src "C:\Users\giann\spectra-app\src\app\icon.png" -Force
Copy-Item $src "C:\Users\giann\spectra-app\src\app\apple-icon.png" -Force
Write-Host "icons regenerated"
