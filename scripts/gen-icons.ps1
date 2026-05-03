# SPECTRA — generate Android + iOS icons & splash from a single 1024+ source PNG.
# Usage:  powershell -ExecutionPolicy Bypass -File scripts\gen-icons.ps1 -Source "C:\path\to\icon.png"

param(
    [Parameter(Mandatory = $true)] [string] $Source,
    [string] $Background = "#000000",   # behind the logo on legacy launcher + splash
    [double] $LegacyFill = 0.78,        # logo as fraction of legacy/round icon canvas (0..1)
    [double] $AdaptiveFill = 0.62       # logo as fraction of adaptive 108dp canvas (safe zone ≈ 66dp)
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

if (-not (Test-Path $Source)) { throw "Source not found: $Source" }
$src = [System.Drawing.Image]::FromFile((Resolve-Path $Source))
Write-Host "Source: $($src.Width) x $($src.Height) px"

$root = Split-Path -Parent (Split-Path -Parent $PSCommandPath)

function HexToColor([string]$hex) {
    $h = $hex.TrimStart('#')
    return [System.Drawing.Color]::FromArgb(
        [Convert]::ToInt32($h.Substring(0,2),16),
        [Convert]::ToInt32($h.Substring(2,2),16),
        [Convert]::ToInt32($h.Substring(4,2),16)
    )
}
$bg = HexToColor $Background

function Render-Icon([int]$canvas, [double]$fill, [bool]$transparent, [string]$out) {
    $bmp = New-Object System.Drawing.Bitmap($canvas, $canvas)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode  = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode      = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.PixelOffsetMode    = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    if ($transparent) {
        $g.Clear([System.Drawing.Color]::Transparent)
    } else {
        $g.Clear($bg)
    }
    $logoSize = [int]($canvas * $fill)
    $offset   = [int](($canvas - $logoSize) / 2)
    $rect = New-Object System.Drawing.Rectangle($offset, $offset, $logoSize, $logoSize)
    $g.DrawImage($src, $rect)
    $g.Dispose()
    New-Item -ItemType Directory -Path (Split-Path $out) -Force | Out-Null
    $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    Write-Host "  $out  ($canvas px)"
}

function Render-Splash([int]$w, [int]$h, [double]$fill, [string]$out) {
    $bmp = New-Object System.Drawing.Bitmap($w, $h)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode  = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode      = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.PixelOffsetMode    = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $g.Clear($bg)
    $logoSize = [int]([Math]::Min($w, $h) * $fill)
    $rect = New-Object System.Drawing.Rectangle(
        [int](($w - $logoSize) / 2),
        [int](($h - $logoSize) / 2),
        $logoSize, $logoSize
    )
    $g.DrawImage($src, $rect)
    $g.Dispose()
    New-Item -ItemType Directory -Path (Split-Path $out) -Force | Out-Null
    $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    Write-Host "  $out  ($w x $h)"
}

# ── Android legacy icons (square + round) on opaque background ─────────────
$densities = @{
    "mipmap-mdpi"    = 48
    "mipmap-hdpi"    = 72
    "mipmap-xhdpi"   = 96
    "mipmap-xxhdpi"  = 144
    "mipmap-xxxhdpi" = 192
}

Write-Host ""
Write-Host "── Android: legacy launcher icons (opaque) ──"
foreach ($d in $densities.Keys) {
    $px = $densities[$d]
    Render-Icon $px $LegacyFill $false "$root\android\app\src\main\res\$d\ic_launcher.png"
    Render-Icon $px $LegacyFill $false "$root\android\app\src\main\res\$d\ic_launcher_round.png"
}

# ── Android adaptive foreground (transparent, content in safe zone) ────────
Write-Host ""
Write-Host "── Android: adaptive icon foregrounds (transparent) ──"
$adaptive = @{
    "mipmap-mdpi"    = 108
    "mipmap-hdpi"    = 162
    "mipmap-xhdpi"   = 216
    "mipmap-xxhdpi"  = 324
    "mipmap-xxxhdpi" = 432
}
foreach ($d in $adaptive.Keys) {
    Render-Icon $adaptive[$d] $AdaptiveFill $true "$root\android\app\src\main\res\$d\ic_launcher_foreground.png"
}

# ── Android adaptive background colour → match $Background ─────────────────
$bgXml = "$root\android\app\src\main\res\values\ic_launcher_background.xml"
@"
<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">$Background</color>
</resources>
"@ | Set-Content -Path $bgXml -Encoding UTF8
Write-Host "  $bgXml  ($Background)"

# ── Android splash images (port + land at 5 densities) ─────────────────────
Write-Host ""
Write-Host "── Android: splash drawables ──"
$splashSizes = @{
    "drawable-port-mdpi"    = @(320,  480)
    "drawable-port-hdpi"    = @(480,  800)
    "drawable-port-xhdpi"   = @(720, 1280)
    "drawable-port-xxhdpi"  = @(1080, 1920)
    "drawable-port-xxxhdpi" = @(1440, 2560)
    "drawable-land-mdpi"    = @(480,  320)
    "drawable-land-hdpi"    = @(800,  480)
    "drawable-land-xhdpi"   = @(1280, 720)
    "drawable-land-xxhdpi"  = @(1920, 1080)
    "drawable-land-xxxhdpi" = @(2560, 1440)
}
foreach ($d in $splashSizes.Keys) {
    $wh = $splashSizes[$d]
    Render-Splash $wh[0] $wh[1] 0.40 "$root\android\app\src\main\res\$d\splash.png"
}
Render-Splash 1080 1920 0.40 "$root\android\app\src\main\res\drawable\splash.png"

# ── iOS App Icon (single 1024 marketing) ───────────────────────────────────
Write-Host ""
Write-Host "── iOS: AppIcon (1024) ──"
Render-Icon 1024 1.0 $false "$root\ios\App\App\Assets.xcassets\AppIcon.appiconset\AppIcon-512@2x.png"

# ── iOS splash (2732 universal × 3 scales) ─────────────────────────────────
Write-Host ""
Write-Host "── iOS: Splash (2732 universal) ──"
Render-Splash 2732 2732 0.40 "$root\ios\App\App\Assets.xcassets\Splash.imageset\splash-2732x2732.png"
Render-Splash 2732 2732 0.40 "$root\ios\App\App\Assets.xcassets\Splash.imageset\splash-2732x2732-1.png"
Render-Splash 2732 2732 0.40 "$root\ios\App\App\Assets.xcassets\Splash.imageset\splash-2732x2732-2.png"

# ── Public web icon (used by lovebeing /apps & PWA) ────────────────────────
Write-Host ""
Write-Host "── Web: public/spectra/icon-1024.png ──"
Render-Icon 1024 1.0 $false "$root\public\spectra\icon-1024.png"

$src.Dispose()
Write-Host ""
Write-Host "[OK] Done. Run 'npx cap sync' to refresh native projects."
