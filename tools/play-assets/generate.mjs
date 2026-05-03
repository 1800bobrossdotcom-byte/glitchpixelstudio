// Generate Play Store assets for SPECTRA from inline SVG.
//   - icon-512.png       : 512x512 app icon (square, no rounding — Play applies mask)
//   - feature-1024x500.png: store listing feature graphic (no text required)
// Run:  node tools/play-assets/generate.mjs
import sharp from "sharp";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, "out");
await mkdir(OUT, { recursive: true });

// ── ICON 512x512 ────────────────────────────────────────────────
// Concentric prismatic spectrum rings + an iris in the centre,
// chromatic-aberration "S" mark. Background near-black so the
// icon reads in both light and dark Play UI shells.
const iconSvg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <radialGradient id="bg" cx="50%" cy="50%" r="60%">
      <stop offset="0%"  stop-color="#0d0a1a"/>
      <stop offset="100%" stop-color="#000000"/>
    </radialGradient>
    <radialGradient id="iris" cx="50%" cy="50%" r="50%">
      <stop offset="0%"  stop-color="#ffffff" stop-opacity="0.95"/>
      <stop offset="40%" stop-color="#ff7ad9" stop-opacity="0.55"/>
      <stop offset="70%" stop-color="#5e3aff" stop-opacity="0.35"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="spec" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%"  stop-color="#ff2bd6"/>
      <stop offset="25%" stop-color="#ff7a3a"/>
      <stop offset="50%" stop-color="#f7ff36"/>
      <stop offset="75%" stop-color="#3aff8a"/>
      <stop offset="100%" stop-color="#3a8aff"/>
    </linearGradient>
    <filter id="blur" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="2"/>
    </filter>
  </defs>

  <!-- background -->
  <rect width="512" height="512" fill="url(#bg)"/>

  <!-- prismatic concentric rings -->
  <g fill="none" stroke-width="6" filter="url(#blur)" opacity="0.85">
    <circle cx="256" cy="256" r="220" stroke="#ff2bd6" opacity="0.55"/>
    <circle cx="256" cy="256" r="195" stroke="#ff7a3a" opacity="0.55"/>
    <circle cx="256" cy="256" r="170" stroke="#f7ff36" opacity="0.55"/>
    <circle cx="256" cy="256" r="145" stroke="#3aff8a" opacity="0.55"/>
    <circle cx="256" cy="256" r="120" stroke="#3a8aff" opacity="0.55"/>
  </g>

  <!-- bright iris -->
  <circle cx="256" cy="256" r="120" fill="url(#iris)"/>

  <!-- chromatic "S" mark (three offset copies for spectrum-shift effect) -->
  <g font-family="Helvetica, Arial, sans-serif" font-weight="900" font-size="240" text-anchor="middle">
    <text x="252" y="338" fill="#ff2bd6" opacity="0.75">S</text>
    <text x="260" y="338" fill="#3aff8a" opacity="0.75">S</text>
    <text x="256" y="338" fill="#ffffff">S</text>
  </g>
</svg>`;

await sharp(Buffer.from(iconSvg)).png().toFile(resolve(OUT, "icon-512.png"));
console.log("✓ icon-512.png");

// ── FEATURE GRAPHIC 1024x500 ────────────────────────────────────
// Wide cinema-aspect: large prismatic disc on the left, wordmark on the right.
// No critical content in the outer 24px (Play crops on some surfaces).
const featureSvg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 500">
  <defs>
    <radialGradient id="bg2" cx="35%" cy="50%" r="80%">
      <stop offset="0%"  stop-color="#1a0d2e"/>
      <stop offset="60%" stop-color="#05030c"/>
      <stop offset="100%" stop-color="#000000"/>
    </radialGradient>
    <radialGradient id="iris2" cx="50%" cy="50%" r="50%">
      <stop offset="0%"   stop-color="#ffffff" stop-opacity="0.95"/>
      <stop offset="35%"  stop-color="#ff7ad9" stop-opacity="0.55"/>
      <stop offset="70%"  stop-color="#5e3aff" stop-opacity="0.35"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="spec2" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%"   stop-color="#ff2bd6"/>
      <stop offset="20%"  stop-color="#ff7a3a"/>
      <stop offset="40%"  stop-color="#f7ff36"/>
      <stop offset="60%"  stop-color="#3aff8a"/>
      <stop offset="80%"  stop-color="#3a8aff"/>
      <stop offset="100%" stop-color="#bf3aff"/>
    </linearGradient>
    <filter id="blur2"><feGaussianBlur stdDeviation="2"/></filter>
  </defs>

  <rect width="1024" height="500" fill="url(#bg2)"/>

  <!-- subtle horizontal scanlines -->
  <g opacity="0.12" fill="#ffffff">
    ${Array.from({ length: 50 }, (_, i) => `<rect x="0" y="${i * 10}" width="1024" height="1"/>`).join("")}
  </g>

  <!-- prismatic disc on the left -->
  <g transform="translate(220,250)" filter="url(#blur2)">
    <circle r="170" fill="none" stroke="#ff2bd6" stroke-width="5" opacity="0.55"/>
    <circle r="148" fill="none" stroke="#ff7a3a" stroke-width="5" opacity="0.55"/>
    <circle r="126" fill="none" stroke="#f7ff36" stroke-width="5" opacity="0.55"/>
    <circle r="104" fill="none" stroke="#3aff8a" stroke-width="5" opacity="0.55"/>
    <circle r="82"  fill="none" stroke="#3a8aff" stroke-width="5" opacity="0.55"/>
    <circle r="66"  fill="url(#iris2)"/>
  </g>

  <!-- wordmark right -->
  <g font-family="Helvetica, Arial, sans-serif" font-weight="900" text-anchor="start">
    <text x="440" y="230" font-size="78" fill="#ff2bd6" opacity="0.7">SPECTRA</text>
    <text x="446" y="230" font-size="78" fill="#3aff8a" opacity="0.7">SPECTRA</text>
    <text x="443" y="230" font-size="78" fill="#ffffff">SPECTRA</text>
    <text x="443" y="268" font-size="18" letter-spacing="5" fill="url(#spec2)" opacity="0.95">WEBGL · VISION · INSTRUMENT</text>
    <text x="443" y="302" font-size="13" letter-spacing="2" fill="#ffffff" opacity="0.6">camera · audio · MIDI · mandala warps · 16 disruptors</text>
  </g>
</svg>`;

await sharp(Buffer.from(featureSvg)).png().toFile(resolve(OUT, "feature-1024x500.png"));
console.log("✓ feature-1024x500.png");

console.log(`\nAssets written to: ${OUT}`);
