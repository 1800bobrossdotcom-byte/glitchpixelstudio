$msg = @"
v1.3.42 - collapse legacy perf parallels into unified governor

Cleanup of v1.3.40's transitional dual-track perf code. Behavior is
materially the same under sustained load (governor still drives
fxQuality + renderScale from the frametime EWMA), but the code path
is now SINGLE: every perf knob in the app reads from one closed loop.

Changes in src/components/SpectraApp.tsx:

(1) Deleted dead refs:
    - thermalThrottleRef (decl + 4-line self-update; zero readers
      outside its own block - confirmed by grep across the file)
    - thermalSlowStreakRef + thermalCoolStreakRef (only used to
      ratchet the discrete renderScale ladder, which is now gone)
    - lowPowerSkipRef (only used by the binary skip-frame branch
      that's deleted in change 3)

(2) Discrete renderScale ladder {1.00, 0.85, 0.70, 0.55} + the
    180/300-frame slow/cool streak counters that drove it -> single
    continuous expression:
        renderScale = round((0.55 + 0.45 * fxQuality) * 20) / 20
    Snapped to nearest 0.05 so resize() (re-allocates GL canvas +
    FBOs + camera/mask textures) only fires when the bucket changes,
    not every frame. Cold-start grace pins to 1.0 for first ~300
    frames, same as before. Net: 10 unique scale values across the
    quality range vs 4 in the ladder, so transitions are perceptually
    smoother and there's no "step" feel under marginal load.

(3) Manual LOW POWER + battery-low binary skip-every-other-RAF
    branch (in render()) -> hard 0.5 ceiling on fxQuality inside
    Stage 1 of the governor. Routes through the universal shader
    mask (uFxQuality halves all FX intensity) AND through the
    continuous renderScale (drops to ~0.78 = ~60% of pixels).
    Net thermal/battery savings approximately match the old skip
    but the picture stays alive instead of stuttering at 30fps.

(4) Updated the governor doc-block to reflect the collapsed design.

Net: 88 lines -> 38 lines for the governor body in render(). Three
ref decls + their wiring removed. Zero new state, zero new branches
in hot paths. Same APK/AAB sizes as v1.3.41 (28.78 / 27.67 MB) -
confirms the collapse compiled to comparable JS.

Build: npm run build green (5.4s, 96.5 kB / 199 kB First Load JS).
Gradle assembleRelease + bundleRelease green (BUILD SUCCESSFUL in 5s).

This is step 2 of the simplification roadmap. Next:
- v1.3.43: 4 macro knobs (INTENSITY/MOTION/COLOR/BREAK)
- v1.4.0:  24-family pixel-generator consolidation, universal apply()
           macro, uniform float fx[32] array, family LUT for variant
           morphing
"@
Set-Location 'C:\Users\giann\spectra-app'
git add -A
$msg | Out-File -Encoding utf8 -NoNewline ".commit-msg.tmp"
git commit -F .commit-msg.tmp
Remove-Item .commit-msg.tmp -Force
git tag -a v1.3.42 -m "v1.3.42 - collapse legacy perf parallels into unified governor (continuous renderScale, lowPower folds into fxQuality ceiling, dead thermalThrottleRef/streak refs deleted)"
git log --oneline -3
