# v1.3.32 knob orthogonality fix.
# Operates on src/components/SpectraApp.tsx in-place.
# - Moves the UV-warp FX chain (ScanTear..Disrupt) to run BEFORE the pixel-sort scan
#   so sort streaks track the warped scene -> Disrupt+Sort, Kaleido+Sort, etc compose visibly.
# - Caps sortBlend max at 0.92 so warps remain visible under sort.
# - Caps disrupt totalDisp magnitude so it can't ram uv to the clamp boundary.

$ErrorActionPreference = 'Stop'
$path = "src\components\SpectraApp.tsx"
$lines = [System.IO.File]::ReadAllLines((Resolve-Path $path))

# Line numbers (1-indexed) confirmed via prior search:
#   L2563 -> "  // 1. Pixel sorting" (sort block start)
#   L2762 -> "  }" closing the sort outer if (last line of sort block)
#   L2763 -> "  // 2. Scanline tear/glitch" (warp block start)
#   L2989 -> "  }" closing the disrupt if (last line of warp block)
# Convert to 0-indexed inclusive ranges.
$sortStart = 2563 - 1
$sortEnd   = 2762 - 1
$warpStart = 2763 - 1
$warpEnd   = 2989 - 1

if ($sortEnd -ge $warpStart) { throw "Range overlap; aborting." }
if ($lines[$sortStart] -notmatch "1\. Pixel sorting") { throw "sortStart anchor mismatch: $($lines[$sortStart])" }
if ($lines[$warpStart] -notmatch "2\. Scanline tear") { throw "warpStart anchor mismatch: $($lines[$warpStart])" }
if ($lines[$sortEnd]   -notmatch "^  \}\s*$") { throw "sortEnd anchor mismatch: $($lines[$sortEnd])" }
if ($lines[$warpEnd]   -notmatch "^  \}\s*$") { throw "warpEnd anchor mismatch: $($lines[$warpEnd])" }

$sortBlock = $lines[$sortStart..$sortEnd]
$warpBlock = $lines[$warpStart..$warpEnd]

# --- Apply caps inside sortBlock ---
# Cap sortBlend at 0.92 so warps remain visible under sort.
$sortNeedle = "    sortBlend = mask * smoothstep(0.0, 0.05, uSortAmt) * ((srcInBand || paintAll) ? 1.0 : 0.0);"
$sortReplace = "    // v1.3.32 \u2014 cap at 0.92 so any underlying UV-warp FX (kaleido/disrupt/droste/...) bleeds through the sort overlay; preserves classic streak look while keeping every other knob visibly active." + [Environment]::NewLine +
               "    sortBlend = mask * smoothstep(0.0, 0.05, uSortAmt) * ((srcInBand || paintAll) ? 0.92 : 0.0);"
$found = $false
for ($i = 0; $i -lt $sortBlock.Length; $i++) {
  if ($sortBlock[$i] -ceq $sortNeedle) {
    $sortBlock[$i] = $sortReplace
    $found = $true
    break
  }
}
if (-not $found) { throw "Could not locate sortBlend assignment to cap" }

# --- Apply caps inside warpBlock (disrupt totalDisp) ---
$disruptNeedle = "    uv = clamp(uv + totalDisp * uDisrupt * mask, 0.001, 0.999);"
$disruptReplace = "    // v1.3.32 \u2014 cap accumulated displacement so 8 max-size blobs can't ram uv to the clamp" + [Environment]::NewLine +
                  "    // boundary (which previously turned huge regions into flat edge-color and drowned out every" + [Environment]::NewLine +
                  "    // other FX). 0.45 keeps disrupt strong-feeling while leaving room for kaleido/droste/etc." + [Environment]::NewLine +
                  "    float dispLen = length(totalDisp);" + [Environment]::NewLine +
                  "    if (dispLen > 0.45) totalDisp *= 0.45 / dispLen;" + [Environment]::NewLine +
                  "    uv = clamp(uv + totalDisp * uDisrupt * mask, 0.001, 0.999);"
$found = $false
for ($i = 0; $i -lt $warpBlock.Length; $i++) {
  if ($warpBlock[$i] -ceq $disruptNeedle) {
    $warpBlock[$i] = $disruptReplace
    $found = $true
    break
  }
}
if (-not $found) { throw "Could not locate disrupt totalDisp clamp to cap" }

# --- Header comments for the swap ---
$warpHeader = @(
  "  // v1.3.32 \u2014 UV-WARP FX CHAIN MOVED HERE (was below pixel sort).",
  "  // Rationale: the pixel-sort scan further down samples uCamera at `uv`; if warps run AFTER",
  "  // sort, sort decides which pixels are 'in band' from the original scene and paints streaks",
  "  // at original positions, while the post-warp camera fetch shows a totally different scene",
  "  // -> sort and warps visually cancel each other (e.g. heavy DISRUPT made SORT invisible).",
  "  // Running warps FIRST means sort scans the SAME warped scene that the main fetch reads,",
  "  // so every warp knob composes correctly with sort and with each other."
)
$sortHeader = @(
  "  // v1.3.32 \u2014 PIXEL SORT MOVED HERE (now runs AFTER all UV warps above).",
  "  // sortedCol/sortBlend are computed at the FINAL warped uv so the streaks track whatever",
  "  // shape the warps produced. Sort is still applied (mixed) into the final color further down."
)

$before = $lines[0..($sortStart - 1)]
# In our anchors warps start IMMEDIATELY after sort ends (sortEnd+1 == warpStart),
# so there is NO between region. PowerShell range $a..$b counts down when $a > $b,
# which produced phantom duplicates last attempt — guard explicitly.
if (($sortEnd + 1) -lt $warpStart) {
  $between = $lines[($sortEnd + 1)..($warpStart - 1)]
} else {
  $between = @()
}
$after = $lines[($warpEnd + 1)..($lines.Length - 1)]

$newContent = New-Object 'System.Collections.Generic.List[string]'
$newContent.AddRange([string[]]$before)
$newContent.AddRange([string[]]$warpHeader)
$newContent.AddRange([string[]]$warpBlock)
$newContent.AddRange([string[]]$sortHeader)
$newContent.AddRange([string[]]$sortBlock)
if ($between.Length -gt 0) { $newContent.AddRange([string[]]$between) }
$newContent.AddRange([string[]]$after)

[System.IO.File]::WriteAllLines((Resolve-Path $path), $newContent.ToArray())

Write-Host "OK. New file size:"
(Get-Item $path).Length
Write-Host "Sort+warp swap applied. sortBlend cap + disrupt totalDisp cap applied."
