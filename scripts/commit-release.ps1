$msg = @"
v1.3.41 - extract GLSL to src/shaders/scene.{vert,frag} + ?raw imports

Pure refactor, zero behavior change. Shader sources move out of JS template
literals into standalone .vert/.frag files imported as raw strings via a
webpack asset/source rule (next.config.ts). Permanently retires the
recurring "backtick inside GLSL comment terminates the JS template literal"
build-break footgun (bit v1.3.33 + v1.3.40).

Changes:
- src/shaders/scene.vert (new, 134 bytes) - vertex shader body
- src/shaders/scene.frag (new, 87 KB) - fragment shader body, including the
  v1.3.40 unified FX quality governor uniform/doc-block, untouched
- src/components/SpectraApp.tsx: replaced the two const VERT_SRC=`...` /
  FRAG_SRC=`...` template-literal blocks (~1638 lines) with a 4-line
  marker comment + two import statements at the top of the file. File is
  now ~88 KB / ~1638 lines smaller.
- src/types/glsl.d.ts (new) - ambient module declarations for *.vert,
  *.frag, *.glsl raw imports
- next.config.ts - webpack rule loading .vert/.frag/.glsl as asset/source
- scripts/extract-shaders.cjs - one-shot extraction script (kept for
  documentation of the refactor)
- scripts/build-release.ps1, scripts/archive-release.ps1 - small helper
  scripts to make release builds reproducible
- android/app/build.gradle: versionCode 152 -> 153, versionName 1.3.40 -> 1.3.41

Build verification: npm run build green, gradle assembleRelease+bundleRelease
green, output APK 28.78 MB / AAB 27.67 MB - identical sizes to v1.3.40 since
the shader text now lives in webpack-emitted JS chunks instead of inline JS.

First step of the simplification roadmap; subsequent releases will collapse
legacy perf parallels into the unified governor (v1.3.42), introduce macro
knobs (v1.3.43), and consolidate FX into 24 generator families with a
universal apply()/uniform array (v1.4.0).
"@
Set-Location 'C:\Users\giann\spectra-app'
git add -A
$msg | Out-File -Encoding utf8 -NoNewline ".commit-msg.tmp"
git commit -F .commit-msg.tmp
Remove-Item .commit-msg.tmp -Force
git tag -a v1.3.41 -m "v1.3.41 - extract GLSL to scene.{vert,frag} + ?raw imports (pure refactor, kills backtick-in-shader-comment build-break class)"
git log --oneline -3
