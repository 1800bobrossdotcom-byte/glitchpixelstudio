# backup-before-edit.ps1
# Snapshot a file (or list of files) with a UTC timestamp .bak before any destructive edit.
# Usage:
#   .\tools\backup-before-edit.ps1 -Path src\components\SpectraApp.tsx
#   .\tools\backup-before-edit.ps1 -Path src\components\SpectraApp.tsx,android\app\build.gradle
#   .\tools\backup-before-edit.ps1 -Snapshot   # full snapshot of critical files into backups/

[CmdletBinding()]
param(
    [string[]] $Path,
    [switch]   $Snapshot,
    [string]   $Tag = ""
)

$ErrorActionPreference = "Stop"
$ts = (Get-Date).ToUniversalTime().ToString("yyyyMMdd-HHmmssZ")
$tagSuffix = if ($Tag) { "-$Tag" } else { "" }

function Backup-One($p) {
    if (-not (Test-Path $p)) {
        Write-Warning "Skip (not found): $p"
        return
    }
    $dest = "$p.bak.$ts$tagSuffix"
    Copy-Item -LiteralPath $p -Destination $dest -Force
    $size = (Get-Item $dest).Length
    Write-Host "  + $dest  ($size bytes)" -ForegroundColor Green
}

if ($Snapshot) {
    $dir = "backups\snapshot-$ts$tagSuffix"
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
    $critical = @(
        "src\components\SpectraApp.tsx",
        "android\app\build.gradle",
        "android\app\src\main\java\com\lovebeing\spectra\MainActivity.java",
        "android\app\src\main\AndroidManifest.xml",
        "package.json",
        "next.config.js",
        "capacitor.config.ts"
    )
    foreach ($f in $critical) {
        if (Test-Path $f) {
            $d = Join-Path $dir $f
            New-Item -ItemType Directory -Path (Split-Path $d) -Force | Out-Null
            Copy-Item -LiteralPath $f -Destination $d -Force
        }
    }
    # Manifest with hashes
    $manifestLines = @("# Snapshot manifest  $ts$tagSuffix", "")
    Get-ChildItem $dir -Recurse -File | ForEach-Object {
        $rel = $_.FullName.Substring((Resolve-Path $dir).Path.Length + 1)
        $sha = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash
        $manifestLines += ("{0,-60} {1,10} bytes  {2}" -f $rel, $_.Length, $sha)
    }
    $manifestPath = Join-Path $dir "MANIFEST.txt"
    Set-Content -LiteralPath $manifestPath -Value $manifestLines -Encoding UTF8
    Write-Host "Snapshot created: $dir" -ForegroundColor Cyan
    return
}

if (-not $Path -or $Path.Count -eq 0) {
    Write-Error "Provide -Path <file>[,<file>...] or -Snapshot."
    exit 1
}

Write-Host "Backing up $($Path.Count) file(s) with timestamp $ts$tagSuffix" -ForegroundColor Cyan
foreach ($p in $Path) { Backup-One $p }
