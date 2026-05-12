cd C:\Users\giann\spectra-app
$msg = @'
v1.3.43 — 4 macro knobs (INTENSITY / MOTION / COLOR / BREAK)

Non-destructive global FX mix layer. Per-knob sliders untouched; macros
multiply at uniform-bind time only, so behavior is byte-identical to
v1.3.42 when all four dials sit at 1.0.

Macro families (range [0, 1.5], default 1.0, double-click resets):
  INTENSITY -> structured FX amount
    sortMix, datamosh (post-map), glyph, react, voroSort, kaleido, tile,
    invertSym, droste, spiral, yantra, mandala, rosette, starfold,
    hexfold, liquid, contour, ascii, venetian, sortAmt
  MOTION    -> temporal animation
    sortWobble, moshIFrame, moshMotion, moshBleed
  COLOR     -> palette aggressiveness
    brightness/contrast/saturation lerped from neutral 1.0 toward user
    value (so macro=0 returns to neutral instead of black), hueShift
    scaled, scanlines (also gated by BREAK)
  BREAK     -> chaos / corruption
    chrash, feedback, blockGlitch, scanTear, sortRandom, disrupt, RGB
    drift (R/G/B/bars/swap), rupture, hsync, moshMap, moshDistort,
    scanlines

Implementation:
  - 4 useState + 4 useRef + 4 sync useEffect alongside lowPowerOn at L3417
  - macros resolved once per frame (_mI/_mM/_mC/_mB) at top of bind block
  - render-time multiplication only — no shader changes, no state mutation
  - resetSettings() now also resets all 4 macros to 1.0
  - new "MACROS · GLOBAL FX MIX" section above Performance · Tier with
    4 compact horizontal dials (INT/MOT/COL/BRK), value indicator goes
    amber when off neutral, double-click resets to 1.0, "reset" button
    snaps all four

Why this matters: gives casual users a 4-dial synth feel ("more chaos /
less color / freeze motion") without touching the 60+ per-knob sliders
power users rely on. Sets up v1.4.0 family-uniform consolidation —
multiplier point (single bind site) is now the only choke-point that
needs to learn about a uniform float fx[32] array.

versionCode 154 -> 155, versionName "1.3.42" -> "1.3.43"
'@
$tmpMsg = "$env:TEMP\spectra-1.3.43-commitmsg.txt"
Set-Content -Path $tmpMsg -Value $msg -Encoding utf8 -NoNewline
git add -A
git commit -F $tmpMsg
git tag -a v1.3.43 -m "v1.3.43 - 4 macro knobs (INT/MOT/COL/BRK), non-destructive global FX mix layer"
Remove-Item $tmpMsg
git log --oneline -1
