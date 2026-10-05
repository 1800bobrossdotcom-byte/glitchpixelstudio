# Android Release + Landing Page Notes

These optimizations are intended for Android release artifacts (`.apk` and `.aab`) and for the production web landing page domain.

## Landing Page Domain

Production domain:
- `https://glitchpixelstudio.app`

This repo now includes:
- canonical metadata + OG base URL in `src/app/layout.tsx`
- robots in `src/app/robots.ts`
- sitemap in `src/app/sitemap.ts`
- static host domain file in `public/CNAME`

## Android Release Flow (Windows / PowerShell)

1. Build web assets and sync Capacitor:

```powershell
npm run build
npx cap sync android
```

2. Build release APK:

```powershell
Set-Location android
.\gradlew.bat assembleRelease
```

3. Build release AAB:

```powershell
Set-Location android
.\gradlew.bat bundleRelease
```

4. Output artifacts:
- APK: `android/app/build/outputs/apk/release/`
- AAB: `android/app/build/outputs/bundle/release/`

## Signing

Release signing is loaded from:
- `android/keystore.properties`

Ensure that file exists with valid release key credentials before store deployment.

## Important Scope Note

Performance work in this branch is intended to ship in Android release builds (`.apk`/`.aab`) and should be validated on physical Android hardware before store upload.
