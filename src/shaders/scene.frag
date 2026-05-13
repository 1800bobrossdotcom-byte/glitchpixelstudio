#ifdef GL_FRAGMENT_PRECISION_HIGH
  precision highp float;
#else
  precision mediump float;
#endif

varying vec2 vUv;
uniform sampler2D uCamera;
uniform sampler2D uPrevFrame;
uniform int uMode;
uniform float uTime;
uniform vec2 uResolution;
uniform vec2 uVideoSize;
uniform float uGain;
uniform float uMirror;
uniform vec2 uTouch;
uniform float uTouchActive;
uniform float uAudio;
uniform float uABass;   // v1.2.74 — bass band (0..1)
uniform float uATreb;   // v1.2.74 — treble band (0..1)
uniform float uABeat;   // v1.2.74 — beat impulse (decays each frame)
uniform float uBrightness;
uniform float uContrast;
uniform float uSaturation;
uniform float uHueShift;
uniform float uScanlines;
uniform float uZoom;

// Glitch/Pixel Sorting/Datamosh FX
uniform float uSortAmt;      // pixel sort intensity
uniform float uScanTear;     // scanline tear/glitch
uniform float uBlockGlitch;  // block corruption
uniform float uDatamosh;     // datamosh blend
uniform float uChrash;       // chroma crash
uniform sampler2D uMask;     // touch FX mask
// Face FX universal mask: when uFaceActive, all FX intensity is
// multiplied by either the face/person mask or its inverse, so any
// effect (sort, RGB drift, melt, datamosh, ...) automatically respects
// it. uFaceTexValid switches between the AI segmentation texture
// (uFaceTex, R channel = person probability) and the centered-oval
// fallback driven by uFaceCenter / uFaceRadius.
uniform float uFaceActive;     // 0 off, 1 on
uniform float uFaceTexValid;   // 1 = use uFaceTex (AI mask), 0 = oval fallback
uniform sampler2D uFaceTex;    // R-channel person mask (0..1)
uniform vec2  uFaceCenter;     // uv center of fallback oval
uniform float uFaceRadius;     // uv radius of fallback oval
uniform float uFaceInvert;     // 0 = FX inside face/person, 1 = FX outside
uniform float uFaceFeather;    // soft edge width for AI mask
uniform float uFaceMaskRadius; // v1.3.29 — outer-ring tap distance in OUTPUT pixels.
                               //   Replaces the per-tick CPU separable max-filter on a
// v1.3.40 — UNIFIED FX QUALITY GOVERNOR. A single closed-loop scalar in
// [0.30 .. 1.00] driven on the JS side by a PID-style controller against
// the rolling frametime EWMA. Multiplied into mask once, immediately
// after the touch / face-FX gating, so every downstream FX gate (uX *
// mask > 0.001) and mix(color, fxOut, uX * mask) is uniformly softened
// under load and uniformly restored when load drops — instead of the
// pre-v1.3.40 binary skip-frame mechanism which manifested as visible
// stutter. At 1.0 nothing changes; at lower values every effects
// intensity is analog-scaled in lockstep so the picture never goes dead.
uniform float uFxQuality;
                               //   256x144 buffer (which cost ~10-20 ms/tick of JS time and
                               //   stalled the segmenter callback). Now the dilation runs
                               //   on the GPU as part of the fragment shader's existing
                               //   13-tap MAX kernel: scaling the ring radius scales the
                               //   silhouette outward in image space at zero JS cost, so
                               //   the mask follows fast subject motion frame-perfectly
                               //   (faraday-cam approach). Range: 2.5 (slider=0, baseline)
                               //   .. ~38 px (slider=1, full bloom).
// Novel Signal FX
uniform float uLiquid;       // curl-noise liquid warp
uniform float uFeedback;     // zoom+rotate feedback tunnel
uniform float uContour;      // iso-luminance neon contour lines
uniform float uAscii;        // cell-density ascii/block ramp
uniform float uVenetian;     // time-sliced venetian blind bands
uniform float uSortKey;      // 0 lum,1 hue,2 sat,3 r,4 g,5 b,6 intensity,7 min
uniform float uSortLow;      // lower sorting threshold
uniform float uSortHigh;     // upper sorting threshold
uniform float uSortSegment;  // segment size modulation
uniform float uSortRandom;   // modulation depth: sine-wave distorts lo/hi band per scan-line
uniform float uSortWobble;   // signal phasing: VHS luma-noise + tape-error bands on sorted pixels
uniform float uSortMode;     // 0 LINE, 1 SPIRAL, 2 BLOCK, 3 SLICE, 4 HILBERT
uniform float uSortInterval; // pixelsort-style interval gate: 0 BAND,1 BRIGHT,2 DARK,3 RAND,4 WAVE,5 EDGE,6 NONE
uniform float uSortAngle;    // scan direction: 0 HORZ,1 VERT,2 DIAG↗,3 DIAG↘
uniform float uRgbR;         // RGBNDR red-channel oscillator depth
uniform float uRgbG;         // RGBNDR green-channel oscillator depth
uniform float uRgbB;         // RGBNDR blue-channel oscillator depth
uniform float uRgbBars;      // RGBNDR SMPTE color-bar overlay strength
uniform float uRgbSwap;      // RGBNDR channel permutation: 0 RGB,1 GBR,2 BRG,3 BGR,4 RBG,5 GRB
uniform float uRupture;      // RUPTURE (cyberboy666/_rupture_-style analog destroy combo)
uniform float uHSync;        // H-sync slip: per-row horizontal tear-and-shift
uniform float uMoshIFrame;   // iframe suppression emulation
uniform float uDisruptShape; // v1.2.74 — 0 BLOB, 1 RING, 2 HEX, 3 CROSS, 4 STRIPE, 5 SPIRAL
uniform float uMoshMotion;   // motion vector carry / propagation
uniform float uMoshBleed;    // color texture bleed amount
uniform float uMoshMap;      // mask-weighted mosh mapping
uniform float uMoshDistort;  // compression distortion amount
uniform float uKaleido;          // 0..1 wedge fold (slices = 2..16)
uniform float uDisrupt;          // 0..1 master intensity for blob disruption
uniform float uDisruptCount;     // 0..1 → 1..16 roaming blobs (cap raised v2)
uniform float uDisruptSize;      // 0..1 → small..large blob radius
uniform float uDisruptContrary;  // 0=blobs drag pixels along, 1=push opposite (contrary)
// ── Mandala-class radial UV warps (9 sister modes to KALEIDO, all mask-gated)
uniform float uYantra;           // 6-fold sacred-geometry slicing (sharp edges)
uniform float uSpiral;           // logarithmic spiral warp
uniform float uTile;             // toroidal tessellation (1..6 tiles)
uniform float uMandala;          // concentric ring mirror with rotational offset
uniform float uRosette;          // r = cos(k*θ) rose-curve petal warp
uniform float uStarfold;         // N-pointed star polygon symmetry
uniform float uInvert;           // circle inversion (turn frame inside out)
uniform float uDroste;           // recursive log-zoom Droste effect
uniform float uHexfold;          // 12-fold hexagonal symmetry
// ── v1.2.58 — Asendorf / Gysin homage rack ─────────────────────────────
uniform sampler2D uGlyphAtlas;   // TEXTURE6 — 4x4 ASCII ramp atlas (Gysin/ertdfgcvb)
uniform sampler2D uSortTex;      // TEXTURE5 — CPU pixel-sort result (real Asendorf, throttled)
uniform float uGlyph;            // Gysin glyph-atlas grid render
uniform float uSortMix;          // CPU pixel-sort blend (driven by JS readback)
uniform float uReact;            // Gray-Scott reaction-diffusion mosh
uniform float uVoroSort;         // Voronoi luma-sorted cell quantizer
uniform float uModeParams[8]; // per-mode rack params (slot 0=AMOUNT, 1=MIX, 2..7 mode-specific)

// v1.3.61 — NOVEL CS FX (one new GPU primitive per artist family, batch 1).
// Each is a brand-new subroutine, NOT a remix of existing uniforms. Composes
// with everything above by operating on `post` at the very end of the chain.
uniform float uMenkmanFX;   // real DCT-block reconstruct (DC + first AC basis)
uniform float uMolnarFX;    // recursive golden-ratio Mondrian subdivision
uniform float uUcnvFX;      // Haar wavelet HF subband swap with prev frame
uniform float uGysinFX;     // Gabor-patch phosphene synthesis (Dream Machine)
uniform float uAsendorfFX;  // 2D vertical-band threshold sort
uniform float uJodiFX;      // bit-CA over RGB threshold (rule-based)
uniform float uArcangelFX;  // NES nametable scroll w/ fine-X register + 4-color quant
uniform float uPaikFX;      // magnetic dipole-field UV warp
uniform float uFentonFX;    // venetian-band SAD motion-vector swap

vec2 adjustUv(vec2 uv) {
  if (uMirror > 0.5) uv.x = 1.0 - uv.x;
  uv.y = 1.0 - uv.y;
  // Zoom
  if (uZoom > 0.001) {
    uv = (uv - 0.5) / (1.0 + uZoom) + 0.5;
  }
  float va = uVideoSize.x / uVideoSize.y;
  float ca = uResolution.x / uResolution.y;
  if (ca > va) {
    float s = va / ca;
    uv.y = uv.y * s + (1.0 - s) * 0.5;
  } else {
    float s = ca / va;
    uv.x = uv.x * s + (1.0 - s) * 0.5;
  }
  return uv;
}

float lum(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

float rand(vec2 co) {
  return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453);
}
float hash(float n) { return fract(sin(n) * 43758.5453123); }
float hash2(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

vec3 thermal(float t) {
  t = clamp(t, 0.0, 1.0);
  if (t < 0.14) return mix(vec3(0.0), vec3(0.0, 0.0, 0.36), t / 0.14);
  if (t < 0.28) return mix(vec3(0.0, 0.0, 0.36), vec3(0.45, 0.0, 0.55), (t - 0.14) / 0.14);
  if (t < 0.45) return mix(vec3(0.45, 0.0, 0.55), vec3(0.85, 0.1, 0.0), (t - 0.28) / 0.17);
  if (t < 0.65) return mix(vec3(0.85, 0.1, 0.0), vec3(1.0, 0.55, 0.0), (t - 0.45) / 0.20);
  if (t < 0.82) return mix(vec3(1.0, 0.55, 0.0), vec3(1.0, 1.0, 0.0), (t - 0.65) / 0.17);
  return mix(vec3(1.0, 1.0, 0.0), vec3(1.0, 1.0, 1.0), (t - 0.82) / 0.18);
}

vec3 hsl2rgb(float h, float s, float l) {
  vec3 rgb = clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
  return l + s * (rgb - 0.5) * (1.0 - abs(2.0 * l - 1.0));
}

float hueFromRgb(vec3 c) {
  float maxc = max(c.r, max(c.g, c.b));
  float minc = min(c.r, min(c.g, c.b));
  float d = maxc - minc;
  if (d < 0.0001) return 0.0;
  float h;
  if (maxc == c.r) h = mod((c.g - c.b) / d, 6.0);
  else if (maxc == c.g) h = ((c.b - c.r) / d) + 2.0;
  else h = ((c.r - c.g) / d) + 4.0;
  return h / 6.0;
}

float satFromRgb(vec3 c) {
  float maxc = max(c.r, max(c.g, c.b));
  float minc = min(c.r, min(c.g, c.b));
  if (maxc < 0.0001) return 0.0;
  return (maxc - minc) / maxc;
}

float sortMetric(vec3 c, float key) {
  if (key < 0.5) return lum(c);
  if (key < 1.5) return hueFromRgb(c);
  if (key < 2.5) return satFromRgb(c);
  if (key < 3.5) return c.r;
  if (key < 4.5) return c.g;
  if (key < 5.5) return c.b;
  if (key < 6.5) return clamp((c.r + c.g + c.b) / 3.0, 0.0, 1.0);
  return min(c.r, min(c.g, c.b));
}

void main() {
  vec2 uv = adjustUv(vUv);
  // --- Glitch/Pixel Sorting/Datamosh FX ---
  // When touch is inactive, apply FX globally (mask=1); when active, use painted mask
  float mask = uTouchActive > 0.5 ? texture2D(uMask, vUv).r : 1.0;
  // Universal Face FX gate: multiplies into mask so EVERY downstream
  // effect (sort, RGB drift, melt, datamosh, contour, ascii, ...) is
  // automatically restricted to the AI person mask (or its inverse).
  if (uFaceActive > 0.5) {
    float fm;
    if (uFaceTexValid > 0.5) {
      // True per-pixel mask from MediaPipe selfie segmentation.
      // The mask was captured from the un-mirrored video element, so
      // when the camera sample is mirrored (front cam, uMirror>0.5)
      // we must mirror the mask lookup too — otherwise the roto sits
      // on the OPPOSITE side of where the person actually appears.
      // v1.2.48: the camera texture is sampled via adjustUv() which
      // flips Y (uv.y = 1.0 - uv.y). The mask was being sampled with
      // raw vUv, leaving it Y-mirrored relative to the camera — so the
      // person's mask landed on the OPPOSITE vertical half of the
      // screen ("image upside down"). Match the camera's Y flip so the
      // roto sits exactly where the person is in the rendered frame.
      vec2 fUv = vec2(vUv.x, 1.0 - vUv.y);
      if (uMirror > 0.5) fUv.x = 1.0 - fUv.x;
      // v1.3.29 — faraday-style scalable GPU dilation. Outer-ring tap
      // distance is driven by uFaceMaskRadius (output pixels), so the
      // MASK EXPAND slider grows the silhouette purely on the GPU. Inner
      // ring sits at half radius to keep edges smooth without seam gaps.
      vec2 px  = vec2(uFaceMaskRadius)        / max(uResolution, vec2(1.0));
      vec2 pxm = vec2(uFaceMaskRadius * 0.5)  / max(uResolution, vec2(1.0));
      float p   = texture2D(uFaceTex, fUv).r;
      float p1  = texture2D(uFaceTex, fUv + vec2( px.x,  0.0)).r;
      float p2  = texture2D(uFaceTex, fUv + vec2(-px.x,  0.0)).r;
      float p3  = texture2D(uFaceTex, fUv + vec2( 0.0,  px.y)).r;
      float p4  = texture2D(uFaceTex, fUv + vec2( 0.0, -px.y)).r;
      float p5  = texture2D(uFaceTex, fUv + vec2( px.x,  px.y)).r;
      float p6  = texture2D(uFaceTex, fUv + vec2(-px.x,  px.y)).r;
      float p7  = texture2D(uFaceTex, fUv + vec2( px.x, -px.y)).r;
      float p8  = texture2D(uFaceTex, fUv + vec2(-px.x, -px.y)).r;
      float m1  = texture2D(uFaceTex, fUv + vec2( pxm.x,  0.0)).r;
      float m2  = texture2D(uFaceTex, fUv + vec2(-pxm.x,  0.0)).r;
      float m3  = texture2D(uFaceTex, fUv + vec2( 0.0,  pxm.y)).r;
      float m4  = texture2D(uFaceTex, fUv + vec2( 0.0, -pxm.y)).r;
      float avg = (p + p1 + p2 + p3 + p4 + p5 + p6 + p7 + p8 + m1 + m2 + m3 + m4) * (1.0 / 13.0);
      // Feathered threshold gives a controllable roto edge.
      // v1.2.71 — midpoint dropped further (0.42 → 0.36) so anything with
      // ~36% person-confidence counts as inside. Combined with the wider
      // tap kernel above and the canvas-side dilation in the segmenter
      // callback, the mask now covers the whole face/body with a few extra
      // pixels of margin so FX never reveal a bg gutter at the silhouette.
      float t = clamp(uFaceFeather, 0.005, 0.5);
      fm = smoothstep(0.36 - t, 0.36 + t, avg);
    } else {
      // Centered-oval fallback (no detector / no model loaded yet).
      float ar = uResolution.x / max(uResolution.y, 1.0);
      vec2 d = (vUv - uFaceCenter) * vec2(ar, 1.0) / max(uFaceRadius, 0.01);
      fm = 1.0 - smoothstep(0.65, 1.05, length(d));
    }
    mask *= mix(fm, 1.0 - fm, uFaceInvert);
  }
  // v1.3.40 — global FX quality governor multiplied into the universal
  // mask. Acts as a soft master-fade on every downstream FX gate /
  // mix(...) so sustained heavy load smoothly dims compounded effects
  // instead of the device locking up or the skip-frame logic stuttering.
  mask *= uFxQuality;
  // v1.3.32 — UV-WARP FX CHAIN MOVED HERE (was below pixel sort).
  // Rationale: the pixel-sort scan further down samples uCamera at uv; if warps run AFTER
  // sort, sort decides which pixels are 'in band' from the original scene and paints streaks
  // at original positions, while the post-warp camera fetch shows a totally different scene
  // -> sort and warps visually cancel each other (e.g. heavy DISRUPT made SORT invisible).
  // Running warps FIRST means sort scans the SAME warped scene that the main fetch reads,
  // so every warp knob composes correctly with sort and with each other.
  // 2. Scanline tear/glitch
  // v1.3.46 — phone bump: tear amplitude 0.12→0.22 so the knob produces an unmistakable
  // sideways shred at max value on a 6" portrait screen. Band frequency multiplier 2.0→3.5
  // so a fully-cranked knob also adds VISIBLY MORE bands (denser tear field, not just bigger).
  if (uScanTear * mask > 0.001) {
    float band = step(0.5, fract(uv.y * uResolution.y * (0.2 + uScanTear * mask * 3.5) + uTime * 2.0));
    uv.x += band * (rand(vec2(uv.y, uTime)) - 0.5) * uScanTear * mask * 0.22;
  }
  // 4. Block glitch (block corruption + JPEG-style DCT block paint at high values)
  if (uBlockGlitch * mask > 0.001) {
    float blockSize = 0.04 + uBlockGlitch * mask * 0.08;
    vec2 block = floor(uv / blockSize);
    float glitch = step(0.8, fract(sin(dot(block, vec2(12.9898, 78.233)) + uTime * 0.7) * 43758.5453));
    if (glitch > 0.5) {
      uv += vec2(rand(block + uTime) - 0.5, rand(block - uTime) - 0.5) * blockSize * 0.5 * uBlockGlitch * mask;
    }
    // DCT-style block corruption: above 0.5 the knob also flat-fills each
    // 8x8 cell with the mean of its 4 corners + centre and zeroes the high
    // frequencies, producing the unmistakable JPEG "smeared block" look.
    // Scales linearly from 0 at 0.5 to full strength at 1.0.
    float dctK = clamp((uBlockGlitch * mask - 0.5) * 2.0, 0.0, 1.0);
    if (dctK > 0.001) {
      vec2 cellOrigin = floor(uv / blockSize) * blockSize;
      vec3 c00 = texture2D(uCamera, clamp(cellOrigin + vec2(0.0,        0.0       ), 0.001, 0.999)).rgb;
      vec3 c10 = texture2D(uCamera, clamp(cellOrigin + vec2(blockSize,  0.0       ), 0.001, 0.999)).rgb;
      vec3 c01 = texture2D(uCamera, clamp(cellOrigin + vec2(0.0,        blockSize ), 0.001, 0.999)).rgb;
      vec3 c11 = texture2D(uCamera, clamp(cellOrigin + vec2(blockSize,  blockSize ), 0.001, 0.999)).rgb;
      vec3 cMid = texture2D(uCamera, clamp(cellOrigin + vec2(blockSize * 0.5, blockSize * 0.5), 0.001, 0.999)).rgb;
      vec3 dctMean = (c00 + c10 + c01 + c11 + cMid * 2.0) / 6.0;
      // Quantize to 3 bits per channel (8 levels) for hard JPEG banding.
      dctMean = floor(dctMean * 7.0 + 0.5) / 7.0;
      // Stash for downstream mix (after main fetch). We use color.a as a
      // smuggle channel — alpha is overwritten to 1.0 at every gl_FragColor
      // assignment so this is safe.
      // Apply directly to uv-domain by displacing toward block centre so
      // the post-fetch read picks up flat block colour without needing a
      // second uniform. This is intentional: at high knob values the
      // displacement collapses to zero (snap to cellOrigin+0.5*blockSize)
      // so the camera fetch lands on the block-mean point in texture
      // space — plus we mix in dctMean directly below in section 4'.
      vec2 toCenter = (cellOrigin + vec2(blockSize * 0.5)) - uv;
      uv = uv + toCenter * dctK * 0.85;
    }
  }
  // 4b. Liquid distort (curl-noise UV warp)
  // v1.3.46 — phone bump: warp magnitude 0.07→0.14 so LIQUID at max actually melts
  // the picture instead of producing a faint shimmer.
  if (uLiquid * mask > 0.001) {
    float t = uTime * 0.4;
    float s = uLiquid * mask * 0.14;
    vec2 p = uv * 3.5;
    float dx = sin(p.y * 2.1 + t * 1.3) * cos(p.x * 1.7 + t * 0.8)
             + sin(p.x * 3.2 + t * 0.6) * 0.4;
    float dy = cos(p.x * 1.9 + t * 1.1) * sin(p.y * 2.5 + t * 0.7)
             + cos(p.y * 3.0 + t * 0.5) * 0.4;
    uv = clamp(uv + vec2(dx, dy) * s, 0.001, 0.999);
  }
  // 4c. KALEIDO — fold UV into a radial wedge around screen centre.
  // Slice count grows with the knob (2..16). Pre-fetch warp so it
  // applies in EVERY mode, not just NORMAL. Respects touch mask for
  // parity with every other UV-warp FX.
  if (uKaleido * mask > 0.001) {
    float slices = 2.0 + clamp(uKaleido, 0.0, 1.0) * 14.0;
    // Aspect-correct so the wedge fold is geometrically round on portrait
    // phones — without this the kaleidoscope appears squashed and shifts
    // its visual centre away from screen-centre.
    float aspK = uResolution.x / max(uResolution.y, 1.0);
    vec2 dK = (uv - 0.5) * vec2(aspK, 1.0);
    float aK = atan(dK.y, dK.x);
    float rK = length(dK);
    float wedge = 6.2831853 / slices;
    aK = mod(aK, wedge);
    aK = abs(aK - wedge * 0.5);
    uv = clamp(vec2(0.5 + cos(aK) * rK / max(aspK, 0.0001), 0.5 + sin(aK) * rK), 0.001, 0.999);
  }
  // 4c.1 TILE — toroidal tessellation (1..6 tiles). Combos with KALEIDO:
  // tile FIRST, then kaleido folds the tessellated grid into a wedge.
  if (uTile * mask > 0.001) {
    float n = 1.0 + clamp(uTile, 0.0, 1.0) * 5.0;
    uv = fract((uv - 0.5) * n + 0.5);
  }
  // 4c.2 INVERT — circle inversion (turn frame inside-out around centre).
  if (uInvert * mask > 0.001) {
    vec2 dI = uv - 0.5;
    float rI2 = dot(dI, dI);
    if (rI2 > 0.0001) {
      float k = 0.05 + clamp(uInvert, 0.0, 1.0) * 0.20;
      vec2 invUv = 0.5 + dI * (k / rI2);
      uv = clamp(mix(uv, invUv, clamp(uInvert, 0.0, 1.0)), 0.001, 0.999);
    }
  }
  // 4c.3 DROSTE — log-polar recursive zoom (Escher print-shop drift).
  if (uDroste * mask > 0.001) {
    vec2 dD = uv - 0.5;
    float rD = length(dD);
    if (rD > 0.001) {
      float aD = atan(dD.y, dD.x);
      float zoom = exp(mod(log(rD) + uTime * 0.15 * uDroste, 1.0)) * 0.4;
      uv = clamp(0.5 + zoom * vec2(cos(aD), sin(aD)), 0.001, 0.999);
    }
  }
  // 4c.4 SPIRAL — logarithmic angular twist (vortex).
  if (uSpiral * mask > 0.001) {
    vec2 dS = uv - 0.5;
    float rS = length(dS);
    if (rS > 0.001) {
      float aS = atan(dS.y, dS.x) + log(rS) * uSpiral * 4.0;
      uv = clamp(0.5 + rS * vec2(cos(aS), sin(aS)), 0.001, 0.999);
    }
  }
  // 4c.5 YANTRA — 6-fold sacred-geometry sharp slicing (rotating, no mirror).
  if (uYantra * mask > 0.001) {
    float aspY = uResolution.x / max(uResolution.y, 1.0);
    vec2 dY = (uv - 0.5) * vec2(aspY, 1.0);
    float aY = atan(dY.y, dY.x) + uYantra * uTime * 0.3;
    float rY = length(dY);
    aY = mod(aY, 1.04719755);
    uv = clamp(vec2(0.5 + cos(aY) * rY / max(aspY, 0.0001), 0.5 + sin(aY) * rY), 0.001, 0.999);
  }
  // 4c.6 MANDALA — concentric ring mirror (onion banding).
  if (uMandala * mask > 0.001) {
    vec2 dM = uv - 0.5;
    float rM = length(dM);
    if (rM > 0.001) {
      float aM = atan(dM.y, dM.x);
      float rings = 2.0 + clamp(uMandala, 0.0, 1.0) * 8.0;
      float rR = abs(fract(rM * rings) - 0.5) * 2.0 / rings;
      uv = clamp(0.5 + rR * vec2(cos(aM), sin(aM)), 0.001, 0.999);
    }
  }
  // 4c.7 ROSETTE — rose-curve petal radial modulation r += k*cos(p*θ).
  if (uRosette * mask > 0.001) {
    vec2 dR = uv - 0.5;
    float aR = atan(dR.y, dR.x);
    float petals = 3.0 + floor(clamp(uRosette, 0.0, 1.0) * 9.0);
    float modR = 1.0 + cos(petals * aR) * uRosette * 0.4;
    uv = clamp(0.5 + dR * modR, 0.001, 0.999);
  }
  // 4c.8 STARFOLD — N-pointed star polygon symmetry (3..12 points).
  if (uStarfold * mask > 0.001) {
    float aspSt = uResolution.x / max(uResolution.y, 1.0);
    vec2 dSt = (uv - 0.5) * vec2(aspSt, 1.0);
    float rSt = length(dSt);
    float aSt = atan(dSt.y, dSt.x);
    float points = 3.0 + floor(clamp(uStarfold, 0.0, 1.0) * 9.0);
    float wSt = 6.2831853 / points;
    aSt = mod(aSt, wSt) - wSt * 0.5;
    float rMod = rSt * (1.0 + cos(aSt * points) * uStarfold * 0.3);
    uv = clamp(vec2(0.5 + cos(aSt) * rMod / max(aspSt, 0.0001), 0.5 + sin(aSt) * rMod), 0.001, 0.999);
  }
  // 4c.9 HEXFOLD — 12-fold hexagonal axial symmetry (snowflake).
  if (uHexfold * mask > 0.001) {
    float aspH = uResolution.x / max(uResolution.y, 1.0);
    vec2 dH = (uv - 0.5) * vec2(aspH, 1.0);
    float aH = atan(dH.y, dH.x);
    float rH = length(dH);
    aH = mod(aH, 0.523598776);
    aH = abs(aH - 0.261799388);
    uv = clamp(vec2(0.5 + cos(aH) * rH / max(aspH, 0.0001), 0.5 + sin(aH) * rH), 0.001, 0.999);
  }
  // 4d. DISRUPT — up to 8 roaming "pixel-grouping" blobs travel on a
  // hash-driven random walk. Inside each blob the UV gets pushed
  // OPPOSITE the blob's velocity ("contrary core") so the disrupted
  // region appears to move counter to the swarm. The surrounding halo
  // optionally follows the blob's direction (knob mixes between fully
  // contrary and fully drag-along).
  if (uDisrupt * mask > 0.001) {
    float nBlobs = floor(1.0 + clamp(uDisruptCount, 0.0, 1.0) * 7.0);
    float radius = 0.05 + clamp(uDisruptSize, 0.0, 1.0) * 0.30;
    float contraryK = clamp(uDisruptContrary, 0.0, 1.0);
    vec2 totalDisp = vec2(0.0);
    float tD = uTime;
    for (int i = 0; i < 8; i++) {
      if (float(i) >= nBlobs) break;
      float fi = float(i);
      float seed = fi * 17.31 + 3.7;
      // Two-frequency Lissajous-with-detune — path never closes a clean
      // orbit because the two axes have incommensurate frequencies and
      // each is a product of two different-period sin/cos terms.
      float pxA = sin(tD * 0.31 + seed) * cos(tD * 0.17 + seed * 1.7);
      float pyA = cos(tD * 0.27 + seed * 1.3) * sin(tD * 0.21 + seed * 0.9);
      vec2 c = vec2(0.5 + 0.42 * pxA, 0.5 + 0.42 * pyA);
      // Numerical velocity — tiny dt so direction is well-defined.
      float dtD = 0.08;
      float pxB = sin((tD - dtD) * 0.31 + seed) * cos((tD - dtD) * 0.17 + seed * 1.7);
      float pyB = cos((tD - dtD) * 0.27 + seed * 1.3) * sin((tD - dtD) * 0.21 + seed * 0.9);
      vec2 vel = vec2(pxA - pxB, pyA - pyB);
      float vlen = length(vel);
      vec2 vDir = vlen > 0.0001 ? vel / vlen : vec2(1.0, 0.0);
      vec2 dB = uv - c;
      float dist = length(dB);
      // v1.2.74 — DISRUPTER SHAPE selector. core/halo masks vary per shape.
      float shapeF = floor(clamp(uDisruptShape, 0.0, 5.0) + 0.5);
      float core = 1.0 - smoothstep(0.0, radius, dist);
      float halo = (1.0 - smoothstep(radius, radius * 2.5, dist)) * (1.0 - core);
      if (shapeF > 0.5 && shapeF < 1.5) {
        // RING — donut: core is a thin ring at radius*0.6.
        float r0 = radius * 0.55;
        float ringD = abs(dist - r0);
        core = 1.0 - smoothstep(0.0, radius * 0.18, ringD);
        halo = (1.0 - smoothstep(radius * 0.18, radius * 0.7, ringD)) * (1.0 - core);
      } else if (shapeF < 2.5) {
        // HEX — six-pointed flower mask.
        float aH = atan(dB.y, dB.x);
        float petals = abs(cos(aH * 3.0));
        float rH = radius * (0.6 + petals * 0.55);
        core = 1.0 - smoothstep(0.0, rH, dist);
        halo = (1.0 - smoothstep(rH, rH * 2.0, dist)) * (1.0 - core);
      } else if (shapeF < 3.5) {
        // CROSS — orthogonal bars through the centre.
        float bar = min(abs(dB.x), abs(dB.y));
        float armLen = max(abs(dB.x), abs(dB.y));
        core = (1.0 - smoothstep(0.0, radius * 0.18, bar)) * (1.0 - smoothstep(0.0, radius * 1.4, armLen));
        halo = (1.0 - smoothstep(radius * 0.18, radius * 0.45, bar)) * (1.0 - smoothstep(0.0, radius * 1.4, armLen)) * (1.0 - core);
      } else if (shapeF < 4.5) {
        // STRIPE — horizontal scanline strip across the row of c.
        float stripeD = abs(dB.y);
        core = (1.0 - smoothstep(0.0, radius * 0.18, stripeD)) * (1.0 - smoothstep(0.0, 0.55, abs(dB.x)));
        halo = (1.0 - smoothstep(radius * 0.18, radius * 0.45, stripeD)) * (1.0 - smoothstep(0.0, 0.55, abs(dB.x))) * (1.0 - core);
      } else if (shapeF >= 4.5) {
        // SPIRAL — angular swirl bands.
        float aS = atan(dB.y, dB.x);
        float swirl = sin(aS * 5.0 + dist * 28.0 - tD * 2.5);
        core = (1.0 - smoothstep(0.0, radius, dist)) * (0.5 + 0.5 * swirl);
        halo = (1.0 - smoothstep(radius, radius * 2.0, dist)) * (1.0 - core);
      }
      // v1.3.46 — phone bump: core push 0.18→0.30, halo shove 0.10→0.18 so DISRUPT
      // SIZE+COUNT at max produces dramatic counter-flow without needing the SORT to read.
      vec2 contraryPush = -vDir * core * 0.30 * (0.5 + contraryK * 1.5);
      vec2 followShove  =  vDir * halo * 0.18 * (1.0 - contraryK);
      totalDisp += contraryPush + followShove;
    }
    // v1.3.32 — cap accumulated displacement so 8 max-size blobs can't ram uv to the clamp
    // boundary (which previously turned huge regions into flat edge-color and drowned out every
    // other FX).
    // v1.3.46 — phone bump: cap 0.45→0.62 to give the new stronger per-blob push room to
    // breathe (the 0.45 ceiling was clipping at 4+ max-size blobs and capping the look).
    float dispLen = length(totalDisp);
    if (dispLen > 0.62) totalDisp *= 0.62 / dispLen;
    uv = clamp(uv + totalDisp * uDisrupt * mask, 0.001, 0.999);
  }
  // v1.3.32 — PIXEL SORT MOVED HERE (now runs AFTER all UV warps above).
  // sortedCol/sortBlend are computed at the FINAL warped uv so the streaks track whatever
  // shape the warps produced. Sort is still applied (mixed) into the final color further down.
  // 1. Pixel sorting — TRUE line-scan sort, not UV displacement.
  // For each pixel we scan back along the row (or column) up to runMax
  // taps; among samples whose metric is INSIDE the threshold band we
  // pick the one with the extremum metric and inherit its colour. This
  // makes contiguous "runs" of in-band pixels collapse to the brightest
  // / darkest pixel in the run — the classic ASDF / kim asendorf streak
  // look. Outside the band the original pixel passes through.
  //
  // The scan only computes a colour here; we apply it AFTER the main
  // color = texture2D(uCamera, uv) fetch so downstream UV-warp FX
  // (scan tear, RGB drift, block glitch, liquid) still get to act on
  // the original UV.
  vec3 sortedCol = vec3(0.0);
  float sortBlend = 0.0;
  // v1.2.59 — mode 4 (HILBERT) bypasses this scanline body and is
  // handled by the dedicated HILBERT block further below.
  if (uSortAmt * mask > 0.001 && uSortMode < 3.5) {
    float key = floor(clamp(uSortKey, 0.0, 7.0) + 0.5);
    float modeF = floor(clamp(uSortMode, 0.0, 3.0) + 0.5);
    float lo = min(uSortLow, uSortHigh);
    float hi = max(uSortLow, uSortHigh);
    // pixelsort-style scan angle (0 HORZ / 1 VERT / 2 DIAG↗ / 3 DIAG↘)
    float angF = floor(clamp(uSortAngle, 0.0, 3.0) + 0.5);
    bool sortVert = (angF > 0.5 && angF < 1.5);
    vec2 px = vec2(1.0 / uResolution.x, 1.0 / uResolution.y);
    vec2 step1;
    if (angF < 0.5)      step1 = vec2(px.x, 0.0);     // HORZ
    else if (angF < 1.5) step1 = vec2(0.0, px.y);     // VERT
    else if (angF < 2.5) step1 = vec2(px.x, px.y);    // DIAG ↗
    else                 step1 = vec2(px.x, -px.y);   // DIAG ↘
    // Stride scaling: SEGMENT knob now extends sample STRIDE so 64 taps
    // can cover up to ~1024 px of the source line, not just 64. Without
    // this the sort streaks are invisible on 1080p phone screens.
    // v1.3.45 — phone-only app. Pushed coefficients hard so AMOUNT and
    // SEGMENT both produce IMMEDIATELY obvious streak length changes
    // on a phone (300+ ppi). Stride ceiling 24→48 and amt mult
    // (0.6 + uSortAmt*2.0) → (1.0 + uSortAmt*4.0). At max segment+amt
    // a single tap can now traverse ~5x what it did pre-1.3.44.
    // v1.3.48 — phone bump TWO. v1.3.45 levels still felt weak after
    // boot defaults zeroed everything. Stride floor 2.0→12.0 (6x),
    // ceiling 48→96.0 (2x). Amt curve (1.0+uSortAmt*4.0) →
    // (2.5+uSortAmt*6.0). At AMOUNT=1 / SEGMENT=0 a single tap now
    // traverses ~4900 px — dramatic full-line streaks even with all
    // other sort knobs at null.
    float stride = mix(12.0, 96.0, clamp(uSortSegment, 0.0, 1.0)) * (2.5 + uSortAmt * 6.0);
    step1 *= stride;
    // 8..64 sample run, scaled by SortAmt and Segment so dialing the
    // amount up creates LONGER streaks (not bigger displacements).
    // GLSL ES 1.00 requires constant loop bounds, so we use 64 hard
    // and gate work with float compare (NO break on dynamic value).
    // v1.3.45 — base run 8→24 and amt curve (0.4+amt*1.6) → (0.7+amt*1.3)
    // so even at low AMOUNT the run is long enough to read on phone.
    // v1.3.48 — base run 24→40 so even at SEGMENT=0 we use 80%% of the
    // 64-sample loop ceiling. Clamp floor 12→20 (no anaemic short runs).
    float runMaxF = mix(40.0, 64.0, clamp(uSortSegment, 0.0, 1.0)) * (0.8 + uSortAmt * 1.2);
    runMaxF = clamp(runMaxF, 20.0, 64.0);
    // Per-line jitter so streak edges don't align to a fixed grid.
    float lineCoord = sortVert ? uv.x : uv.y;
    float lineId = floor(lineCoord * (sortVert ? uResolution.x : uResolution.y));
    // Subpixel jitter: every scan-line gets a fractional UV offset hashed
    // off lineId so streaks don't snap to the integer-pixel grid (looks
    // way crisper at hi-res). Asendorf-style alternating pick: even lines
    // grab the brightest in-band pixel, odd lines grab the darkest. The
    // resulting streak field has both light and dark runs interleaved
    // instead of one uniform highlight pass over the whole frame.
    float subpixJit = (hash(lineId * 0.137) - 0.5) * 0.85;
    float pickMaxLine = step(0.5, fract(lineId * 0.5 + hash(lineId * 0.029) * 0.3));
    // Boundary modulation (AE Pixel Sorter Modulation): two-frequency sine wave
    // distorts lo/hi thresholds per scan-line → organic wavy segment edges.
    // v1.3.45 — phone bump: depth 0.45→0.9 so NOISE at 1.0 fully sweeps the
    // band threshold, producing dramatic boundary wave instead of subtle drift.
    float modWave = sin(lineCoord * 28.0 + uTime * 1.4)
                  + sin(lineCoord * 47.0 + uTime * 0.9) * 0.4;
    float modShift = modWave * uSortRandom * 0.9;
    lo = clamp(lo + modShift, 0.0, 1.0);
    hi = clamp(hi + modShift * 0.6, lo + 0.01, 1.0);
    // Small scan-start offset tied to modulation (replaces pure random jitter).
    float jitter = modShift * 6.0 + subpixJit;
    // Per-line min/max selection (set above) drives the streak palette.
    float pickMax = pickMaxLine;

    // Per-mode sampling reference points (cheap, computed once).
    vec2 blockOrigin = floor(uv / (8.0 * px)) * (8.0 * px);
    vec2 spiralCenter = vec2(0.5, 0.5);
    vec2 toCenter = uv - spiralCenter;
    float spiralR = length(toCenter);
    float spiralA = atan(toCenter.y, toCenter.x);
    float spiralStep = 0.004 + uSortSegment * 0.025;

    vec3 srcCol = texture2D(uCamera, uv).rgb;
    float srcMet = sortMetric(srcCol, key);
    bool srcInBandRaw = srcMet >= lo && srcMet <= hi;
    // INTERVAL gate (satyarth/pixelsort-style): chooses which destination
    // pixels participate. 0 BAND keeps legacy behaviour; others override.
    float intF = floor(clamp(uSortInterval, 0.0, 6.0) + 0.5);
    float srcLuma = lum(srcCol);
    bool srcInBand = srcInBandRaw;
    if (intF > 0.5 && intF < 1.5)       srcInBand = srcLuma >= lo;                        // BRIGHT
    else if (intF < 2.5)                srcInBand = srcLuma <= hi;                        // DARK
    else if (intF < 3.5) {                                                                 // RANDOM
      float segW = mix(8.0, 64.0, clamp(uSortSegment, 0.0, 1.0));
      float bx = floor((sortVert ? uv.y : uv.x) * (sortVert ? uResolution.y : uResolution.x) / segW);
      float r = hash2(vec2(lineId * 0.07 + 0.13, bx + floor(uTime * 0.5)));
      srcInBand = r > clamp(1.0 - uSortRandom, 0.05, 0.95);
    }
    else if (intF < 4.5) {                                                                 // WAVES
      float w = sin(lineCoord * mix(20.0, 90.0, clamp(uSortSegment, 0.0, 1.0)) + uTime * 1.2);
      srcInBand = w > 0.0;
    }
    else if (intF < 5.5) {                                                                 // EDGES
      vec3 nx = texture2D(uCamera, clamp(uv + step1, 0.0, 1.0)).rgb;
      float edge = abs(lum(nx) - srcLuma);
      srcInBand = edge > mix(0.05, 0.45, 1.0 - clamp(uSortRandom, 0.0, 1.0));
    }
    else if (intF >= 5.5)               srcInBand = true;                                  // NONE

    vec3 bestCol = srcCol;
    float bestMet = pickMax > 0.5 ? -1.0 : 2.0;
    float runActive = 1.0;
    bool foundInBand = false;
    // Constant 64-sample scan (GLSL ES 1.00 safe). Sample-position
    // formula switches per uSortMode; the in-band/run-edge accounting
    // is shared.
    for (int s = 0; s < 64; s++) {
      float fs = float(s) + jitter;
      vec2 sUv;
      if (modeF < 0.5) {
        // LINE: scan backwards along row (or column).
        sUv = uv - step1 * fs;
      } else if (modeF < 1.5) {
        // SPIRAL: walk along same radial ring at varying angles.
        float ang = spiralA + (fs - 32.0) * spiralStep;
        sUv = spiralCenter + vec2(cos(ang), sin(ang)) * spiralR;
      } else if (modeF < 2.5) {
        // BLOCK: deterministic 8x8 block sweep, all 64 pixels.
        float bx = mod(float(s), 8.0);
        float by = floor(float(s) / 8.0);
        sUv = blockOrigin + vec2(bx, by) * px;
      } else {
        // SLICE: random pixels along the row/column (Jeff Thompson style).
        float r = hash2(vec2(lineId * 0.31, fs * 0.17 + floor(uTime * 0.7)));
        sUv = sortVert ? vec2(uv.x, r) : vec2(r, uv.y);
      }
      float inRange = step(float(s), runMaxF)
                    * step(0.0, sUv.x) * step(sUv.x, 1.0)
                    * step(0.0, sUv.y) * step(sUv.y, 1.0)
                    * runActive;
      vec2 fetchUv = clamp(sUv, 0.0, 1.0);
      vec3 sc = texture2D(uCamera, fetchUv).rgb;
      float m = sortMetric(sc, key);
      bool inBand = (m >= lo && m <= hi);
      if (inRange > 0.5 && inBand) {
        foundInBand = true;
        if (pickMax > 0.5 ? m > bestMet : m < bestMet) {
          bestMet = m; bestCol = sc;
        }
      } else if (inRange > 0.5 && foundInBand && modeF < 0.5) {
        // Crisp streak edge: stop accepting further samples (LINE only).
        runActive = 0.0;
      }
    }
    // BLOCK paints the whole 8x8 cell uniformly; LINE/SPIRAL/SLICE
    // only paint in-band pixels so out-of-band passes through.
    bool paintAll = (modeF >= 1.5 && modeF < 2.5);
    sortedCol = bestCol;
    // Signal phasing (AE Pixel Sorter Signal panel): luma noise, chroma
    // luma-modulation, and tape-error bands on the sorted pixels.
    // v1.3.45 — phone bump again: WOBBLE now reads as a real broken-VHS
    // signal at any value above ~0.2. Coefficients pushed to the edge of
    // tasteful so the knob has wide dynamic range on a small screen.
    if (uSortWobble > 0.001) {
      // Luma noise: per-frame pixel-level brightness jitter.
      float lumaJitter = (rand(uv + vec2(0.0, floor(uTime * 24.0) * 0.137)) - 0.5)
                        * uSortWobble * 0.55;
      sortedCol = clamp(sortedCol + lumaJitter, 0.0, 1.0);
      // Luma modulation: oscillating brightness bands (VHS luma carrier).
      float lumaMod = sin(uv.y * 565.0 + uTime * 3.8) * uSortWobble * 0.22;
      sortedCol = clamp(sortedCol + lumaMod, 0.0, 1.0);
      // Tape errors: sporadic horizontal corruption bands.
      // Threshold drops to 0.45 at WOBBLE=1 so bands cover ~half the frame.
      float tapeRow = floor(uv.y * uResolution.y / 5.0);
      float tapeNoise = rand(vec2(tapeRow * 0.0031, floor(uTime * 5.0) * 0.017));
      float tapeThresh = 1.0 - uSortWobble * 0.55;
      float tapeWeight = clamp((tapeNoise - tapeThresh) / max(uSortWobble * 0.55, 0.001), 0.0, 1.0);
      float shiftX = tapeWeight * uSortWobble * 0.75;
      vec3 tapeSmp = texture2D(uCamera, clamp(uv + vec2(shiftX, 0.0), 0.0, 1.0)).rgb;
      sortedCol = mix(sortedCol, tapeSmp, tapeWeight);
    }
    // In-band pixels are FULLY replaced with the sorted colour. uSortAmt
    // only gates whether the sort fires at all (and feeds the streak-length
    // math above). v1.3.35 — pure pixel-level chain: in-band = 1.0 replace,
    // not 0.92 mix. Each FX owns the pixel at full knob; the v1.3.32 cap
    // read as translucent layering rather than a real sort.
    sortBlend = mask * smoothstep(0.0, 0.05, uSortAmt) * ((srcInBand || paintAll) ? 1.0 : 0.0);

    // ── Hi-res pixel-art finishing pass on the sorted colour ──────────
    // Bayer 8x8 ordered dither + 4-bit-per-channel posterize. Only the
    // SORTED pixels get this treatment (sortBlend > 0); out-of-band
    // passthrough pixels stay full-bit so the camera detail behind the
    // streaks isn't quantized. The Bayer threshold is centred at 0 so
    // the dither doesn't shift overall brightness, only redistributes
    // quantization error across neighbouring pixels (true error-diffuse
    // approximation in a single pass).
    if (sortBlend > 0.001) {
      vec2 bp = mod(floor(uv * uResolution), 8.0);
      float bx = bp.x; float by = bp.y;
      // Standard 8x8 Bayer matrix, normalized to [0,1) then re-centred.
      float bayer = mod(
          bx * 1.0 + by * 8.0
        + floor(bx * 0.5) * 2.0 + floor(by * 0.5) * 16.0
        + floor(bx * 0.25) * 4.0 + floor(by * 0.25) * 32.0
      , 64.0) / 64.0;
      float dither = (bayer - 0.5) * (1.0 / 16.0); // ~±3% perturbation
      vec3 ditherC = sortedCol + dither;
      // 4-bit-per-channel posterize → 16 levels per channel = 4096 colours.
      // Combined with Bayer that bumps perceived gamut to ~32k via dither.
      vec3 quant = floor(clamp(ditherC, 0.0, 1.0) * 15.0 + 0.5) / 15.0;
      sortedCol = quant;
    }
  }
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
    gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }

  vec4 color = texture2D(uCamera, uv);

  // Apply the line-scan pixel sort computed up top. Doing this AFTER the
  // main fetch (rather than mutating uv) means the sort actually
  // REPLACES pixel colours instead of just sliding them around — which
  // is what makes it look like sort and not displacement.
  if (sortBlend > 0.001) {
    color.rgb = mix(color.rgb, sortedCol, clamp(sortBlend, 0.0, 1.0));
  }

  // 14. CPU REAL PIXEL SORT — per-row Asendorf threshold runs sorted by
  // packed RGBA value. Computed in JS at ~20 Hz on a 256x144 downscale,
  // uploaded to uSortTex; the shader just blends.
  // v1.2.69 — MOVED ABOVE the DATAMOSH block so the mosh stage operates
  // on the SORTED signal (color.rgb), not the raw camera. Combined with
  // the end-of-frame prev-frame copy capturing the final composite, this
  // creates a real cross-feed: sort artefacts inform mosh smear this frame,
  // and the moshed sort feeds back into next frame mosh taps. Result is
  // ONE blended master output, not two stacked ghost layers. The AI fg/bg
  // mask already gates both stages with the same mask value so the
  // person/scene split rips through the unified pixel signal.
  if (uSortMix * mask > 0.001) {
    vec3 sorted = texture2D(uSortTex, uv).rgb;
    // v1.3.35 — pure pixel-level chain.
    float sortGate = smoothstep(0.0, 0.30, uSortMix * mask);
    color.rgb = mix(color.rgb, sorted, sortGate);
  }

  // 5. Datamosh blend (blend with prev frame)
  if (uDatamosh * mask > 0.001) {
    // v1.3.35 — pure pixel-level chain. Datamosh's internal mixes operate on
    // the running color.rgb sequentially, so prior FX naturally pass through
    // the mv0..mv3 motion-vector taps and the jump/RGB-shift/smear stages.
    // No snapshot+cap wrapper.
    float sceneLuma = lum(color.rgb);
    vec2 px = vec2(1.0 / uResolution.x, 1.0 / uResolution.y);
    vec3 edgeX = texture2D(uCamera, clamp(uv + vec2(px.x, 0.0), 0.001, 0.999)).rgb - texture2D(uCamera, clamp(uv - vec2(px.x, 0.0), 0.001, 0.999)).rgb;
    vec3 edgeY = texture2D(uCamera, clamp(uv + vec2(0.0, px.y), 0.001, 0.999)).rgb - texture2D(uCamera, clamp(uv - vec2(0.0, px.y), 0.001, 0.999)).rgb;
    float sceneEdge = length(edgeX) + length(edgeY);
    float motionMap = clamp(length(color.rgb - texture2D(uPrevFrame, uv).rgb) * 2.2 + sceneEdge * 8.0, 0.0, 1.0);
    float tonalMap = smoothstep(0.18, 0.82, sceneLuma);
    float dmMap = mix(1.0, clamp(motionMap * 0.65 + tonalMap * 0.35, 0.0, 1.0), clamp(uMoshMap, 0.0, 1.0));
    float dmMask = mask * dmMap;
    // v1.2.74 — audio injection. Beat punches dm up so kicks visibly
    // explode datamosh; bass adds a slow swell so steady low end rides
    // with the beat.
    float dm = uDatamosh * dmMask * (0.65 + uMoshDistort * 0.85)
             + uABeat * dmMask * 0.55
             + uABass * dmMask * 0.18;
    // 4-tap motion-vector best-match: instead of grabbing prev[uv] flat,
    // sample prev at 4 small directional offsets and pick the one whose
    // colour is CLOSEST to the current pixel. That tap is the local
    // motion-vector estimate — reusing it as the "previous" carries
    // moving features along their actual flow line, which is what real
    // datamosh decoders do when an I-frame is dropped and B/P frames
    // re-apply motion vectors to the wrong reference. The result smears
    // along motion instead of the static cross-fade the old code did.
    vec2 mvStep = vec2(1.0 / uResolution.x, 1.0 / uResolution.y) * 4.0;
    vec3 mv0 = texture2D(uPrevFrame, clamp(uv + vec2( mvStep.x, 0.0), 0.001, 0.999)).rgb;
    vec3 mv1 = texture2D(uPrevFrame, clamp(uv + vec2(-mvStep.x, 0.0), 0.001, 0.999)).rgb;
    vec3 mv2 = texture2D(uPrevFrame, clamp(uv + vec2(0.0,  mvStep.y), 0.001, 0.999)).rgb;
    vec3 mv3 = texture2D(uPrevFrame, clamp(uv + vec2(0.0, -mvStep.y), 0.001, 0.999)).rgb;
    float d0 = length(color.rgb - mv0);
    float d1 = length(color.rgb - mv1);
    float d2 = length(color.rgb - mv2);
    float d3 = length(color.rgb - mv3);
    vec3 prev = mv0;
    float bestD = d0;
    if (d1 < bestD) { prev = mv1; bestD = d1; }
    if (d2 < bestD) { prev = mv2; bestD = d2; }
    if (d3 < bestD) { prev = mv3; bestD = d3; }
    float iframeHold = clamp(uMoshIFrame, 0.0, 1.0);
    float motionCarry = clamp(uMoshMotion, 0.0, 1.0);
    float bleed = clamp(uMoshBleed, 0.0, 1.0);
    // v1.2.66 — "hit source" mandate: the motion-vector mosh tap should
    // dominate the source frame (it IS the datamoshed image) instead
    // of ghost-blending at ~50%. Push the floor of moshBlend so even at
    // moderate INTENS the mosh visibly REPLACES the camera, and let
    // it ride to ~0.99 at full crank.
    float moshBlend = clamp(smoothstep(0.0, 0.45, dm) * (0.78 + iframeHold * 0.20), 0.0, 0.99);
    color.rgb = mix(color.rgb, prev, moshBlend);

    // v1.2.74 — pronounced I-FRAME drop: when iframeHold > 0, periodically
    // (every ~0.5 s) replace the current pixel with prev for a portion of
    // each cycle, simulating a missing keyframe in an MPEG stream.
    if (iframeHold > 0.001) {
      float ifPeriod = 0.55;
      float ifT = floor(uTime / ifPeriod);
      float ifHash = hash(ifT * 0.137 + 1.7);
      // hold-window length scales with knob; up to ~70%% of the cycle.
      float ifWin = iframeHold * 0.70;
      float ifPhase = fract(uTime / ifPeriod);
      float ifFire = step(1.0 - iframeHold, ifHash) * step(ifPhase, ifWin);
      // hard freeze toward prev with a slight chromatic ghost so it reads
      // as a glitch rather than a still image.
      vec3 ifPrev = texture2D(uPrevFrame, uv).rgb;
      color.rgb = mix(color.rgb, ifPrev, ifFire * 0.92);
    }

    float jump = floor(uTime * (4.0 + dm * (14.0 + uMoshDistort * 18.0)));
    // v1.3.46 — phone bump: macroblock jump 0.07/0.11 → 0.13/0.20 so DATAMOSH+DISTORT
    // at full knob produces real chunky MPEG-style displacement, not just micro-shudder.
    // v1.3.48 — phone bump TWO: macroblock jump 0.13/0.20 → 0.30/0.35 so
    // INTENS alone produces real chunky displacement before DISTORT/family
    // is even dialed.
    vec2 jumpOff = vec2(
      (hash(jump * 1.73 + floor(uv.y * 120.0)) - 0.5),
      (hash(jump * 2.11 + floor(uv.x * 90.0)) - 0.5)
    ) * dm * (0.30 + uMoshDistort * 0.35);
    vec2 jUv = clamp(uv + jumpOff, 0.001, 0.999);
    vec3 jumpPrev = texture2D(uPrevFrame, jUv).rgb;
    color.rgb = mix(color.rgb, jumpPrev, clamp(dm * (0.45 + motionCarry * 0.5), 0.0, 0.96));

    // v1.3.46 — phone bump: chroma sep 0.012/0.05 → 0.028/0.11 so MOSH BLEED at max
    // produces obvious channel separation alongside the bigger jumps above.
    // v1.3.48 — phone bump TWO: chroma sep 0.028/0.11 → 0.060/0.18 so
    // INTENS alone produces visible RGB rip before BLEED/family is dialed.
    float sep = dm * (0.060 + bleed * 0.18);
    float rr = texture2D(uPrevFrame, clamp(jUv + vec2(sep, 0.0), 0.001, 0.999)).r;
    float gg = texture2D(uPrevFrame, jUv).g;
    float bb = texture2D(uPrevFrame, clamp(jUv - vec2(sep, 0.0), 0.001, 0.999)).b;
    color.rgb = mix(color.rgb, vec3(rr, gg, bb), clamp(dm * (0.22 + bleed * 0.75), 0.0, 0.9));

    if (dm > 0.8) {
      // v1.3.46 — phone bump: extra-smear amplitude 0.16→0.26 so the supercharged
      // (audio-beat-driven) headroom past 1.0 produces dramatic motion-vector trails.
      // v1.3.48 — phone bump TWO: extra-smear amplitude 0.26→0.45.
      float extra = max(0.0, dm - 1.0);
      vec2 smearOff = vec2(sin(uTime * 1.3 + uv.y * 10.0), cos(uTime * 0.9 + uv.x * 8.0)) * extra * 0.45;
      vec3 smearPrev = texture2D(uPrevFrame, clamp(uv + smearOff, 0.001, 0.999)).rgb;
      color.rgb = mix(color.rgb, smearPrev, clamp(extra * (0.35 + motionCarry * 0.8), 0.0, 0.95));
    }
  }
  // 6. Chroma crash (extreme chroma separation)
  // v1.3.46 — phone bump: caa multiplier 0.07→0.14 so CHRASH at max knob smears
  // chroma across ~28%% of the frame instead of a subtle ~14%% — reads as real RGB rip.
  if (uChrash * mask > 0.001) {
    float caa = uChrash * mask * 0.14;
    float origR = color.r;
    float origG = color.g;
    float origB = color.b;
    float shiftR = texture2D(uCamera, clamp(uv + vec2(caa * 2.0,  caa * 0.4), 0.001, 0.999)).r;
    float shiftG = texture2D(uCamera, clamp(uv + vec2(0.0,        caa      ), 0.001, 0.999)).g;
    float shiftB = texture2D(uCamera, clamp(uv - vec2(caa * 2.0,  caa * 0.4), 0.001, 0.999)).b;
    // v1.3.35 — pure pixel-level chain: full replacement at max knob.
    // Source kept on color.rgb so chrash shifts the COMPOSITE (sort+warp+mosh)
    // rather than re-sampling the raw camera.
    color.rgb = mix(color.rgb, vec3(shiftR, shiftG, shiftB), clamp(uChrash * mask, 0.0, 1.0));
  }
  // 8. Feedback tunnel (zoom+rotate prev-frame loop)
  // v1.3.46 — phone bump: per-frame angle 0.06→0.11 + zoom 0.04→0.08 so FEEDBACK at max
  // produces a real spinning vortex tunnel inside one frame, not a slow drift over seconds.
  if (uFeedback * mask > 0.001) {
    vec2 center = vec2(0.5);
    vec2 d = uv - center;
    float angle = uFeedback * mask * 0.11;
    float zm = 1.0 - uFeedback * mask * 0.08;
    float cs = cos(angle), sn = sin(angle);
    vec2 rotated = vec2(d.x * cs - d.y * sn, d.x * sn + d.y * cs);
    vec2 fbUv = clamp(center + rotated * zm, 0.001, 0.999);
    vec3 fbColor = texture2D(uPrevFrame, fbUv).rgb;
    // v1.3.35 — pure pixel-level chain.
    color.rgb = mix(color.rgb, fbColor * vec3(0.97, 0.98, 1.02), clamp(uFeedback * mask, 0.0, 1.0));
  }
  // 9. Contour lines (iso-luminance neon overlay)
  // v1.3.46 — phone bump: edge width 0.12→0.20 so the neon contour LINES are fat
  // enough to actually be visible on phone (was a hairline at high pixel density).
  if (uContour * mask > 0.001) {
    float l = lum(color.rgb);
    float bands = 5.0 + uContour * mask * 20.0;
    float wrapped = fract(l * bands);
    float edge = 1.0 - smoothstep(0.0, 0.20, min(wrapped, 1.0 - wrapped));
    vec3 lineColor = hsl2rgb(l * 0.6 + uTime * 0.03, 1.0, 0.6);
    // v1.3.35 — pure pixel-level chain.
    color.rgb = mix(color.rgb, lineColor, clamp(edge * uContour * mask, 0.0, 1.0));
  }
  // 10. ASCII / block ramp (cell luminance density pattern)
  if (uAscii * mask > 0.001) {
    float cellSz = max(3.0, 16.0 - uAscii * mask * 13.0);
    vec2 cellCoord = floor(vUv * uResolution / cellSz);
    vec2 cellCenter = (cellCoord + 0.5) * cellSz / uResolution;
    vec2 cellUv = adjustUv(clamp(cellCenter, 0.001, 0.999));
    float avgLum = lum(texture2D(uCamera, clamp(cellUv, 0.001, 0.999)).rgb);
    vec3 cellColor = texture2D(uCamera, clamp(cellUv, 0.001, 0.999)).rgb;
    vec2 pCell = fract(vUv * uResolution / cellSz);
    float lev = avgLum * 5.0;
    float fill = 0.0;
    if (lev < 1.0) {
      fill = step(length(pCell - 0.5), 0.15);
    } else if (lev < 2.0) {
      fill = max(step(abs(pCell.x - 0.5), 0.12), step(abs(pCell.y - 0.5), 0.12));
    } else if (lev < 3.0) {
      fill = max(step(abs(pCell.x - 0.5), 0.22), step(abs(pCell.y - 0.5), 0.22));
    } else if (lev < 4.0) {
      float ex = step(0.08, pCell.x) * step(pCell.x, 0.92);
      float ey = step(0.08, pCell.y) * step(pCell.y, 0.92);
      fill = ex * ey;
    } else {
      fill = 1.0;
    }
    // v1.3.35 — pure pixel-level chain. ASCII grid quantizes the running
    // color (so prior FX colours show through inside lit glyphs) plus the
    // raw cell sample at half strength for cleaner glyph edges.
    color.rgb = mix(color.rgb, color.rgb * fill + cellColor * fill * 0.5, clamp(uAscii * mask, 0.0, 1.0));
  }
  // 11. Venetian blind (time-sliced horizontal band shuffle)
  // v1.3.46 — phone bump: per-band x-shift 0.14→0.24 so VENETIAN at max knob
  // visibly tears each blind sideways instead of nudging it.
  if (uVenetian * mask > 0.001) {
    float bandCount = 6.0 + uVenetian * mask * 18.0;
    float bandIdx = floor(uv.y * bandCount);
    float t2 = uTime * (0.8 + uVenetian * mask * 1.5);
    float phase = fract(bandIdx * 0.618 + t2 * 0.15);
    float xShift = sin(bandIdx * 2.1 + t2) * uVenetian * mask * 0.24;
    vec2 bandUv = clamp(vec2(uv.x + xShift, uv.y), 0.001, 0.999);
    float blend = smoothstep(0.4, 0.6, phase);
    vec3 bandColor = mix(color.rgb, texture2D(uPrevFrame, bandUv).rgb, blend);
    // v1.3.35 — pure pixel-level chain.
    color.rgb = mix(color.rgb, bandColor, clamp(uVenetian * mask, 0.0, 1.0));
  }
  // ── v1.2.58 ASENDORF / GYSIN homage block ─────────────────────────────
  // 13. GYSIN ASCII GLYPH GRID — 4x4 atlas of ramp characters (ertdfgcvb).
  // Each cell quantizes camera luma into one of 16 glyphs, atlas alpha
  // (R channel) modulates a colourised glyph; mixed back over the source.
  if (uGlyph * mask > 0.001) {
    float gridY = mix(40.0, 180.0, uGlyph);
    float gridX = floor(gridY * uResolution.x / max(uResolution.y, 1.0));
    vec2 grid = vec2(gridX, gridY);
    vec2 cellId = floor(uv * grid);
    vec2 cellCenter = (cellId + 0.5) / grid;
    vec2 inCell = fract(uv * grid);
    vec3 cellCol = texture2D(uCamera, clamp(cellCenter, 0.001, 0.999)).rgb;
    float cellL = lum(cellCol);
    float idx = floor(cellL * 15.999);
    vec2 atlasCell = vec2(mod(idx, 4.0), 3.0 - floor(idx / 4.0));
    vec2 atlasUv = (atlasCell + inCell) * 0.25;
    float gA = texture2D(uGlyphAtlas, atlasUv).r;
    vec3 glyphCol = vec3(gA) * (cellCol * 0.55 + vec3(cellL) * 0.55);
    // v1.3.35 — pure pixel-level chain.
    color.rgb = mix(color.rgb, glyphCol, clamp(uGlyph * mask, 0.0, 1.0));
  }
  // 14. CPU REAL PIXEL SORT — (block moved above DATAMOSH in v1.2.69 for
  // unified sort+mosh signal; see the relocated uSortMix * mask block
  // right before the DATAMOSH stage above.)
  // 15. HILBERT WALK SMEAR — folded into PIXEL SORT as MODE=4 (v1.2.59).
  // Pseudo-Hilbert quarter-turn walk: locality-preserving max-luma
  // propagation, no axis-aligned banding. Strength = uSortAmt.
  if (uSortAmt * mask > 0.001 && uSortMode > 3.5 && uSortMode < 4.5) {
    vec3 best = color.rgb;
    float bestL = lum(best);
    vec2 p = uv;
    vec2 hStep = 1.0 / uResolution * (2.0 + uSortAmt * 14.0);
    for (int i = 0; i < 12; i++) {
      float t = float(i);
      float a = floor(t * 0.5) * 1.5708 + mod(t, 2.0) * 1.5708;
      p = clamp(p + vec2(cos(a), sin(a)) * hStep, 0.001, 0.999);
      vec3 s = texture2D(uCamera, p).rgb;
      float sL = lum(s);
      if (sL > bestL) { bestL = sL; best = s; }
    }
    // v1.3.35 — pure pixel-level chain.
    color.rgb = mix(color.rgb, best, clamp(uSortAmt * mask, 0.0, 1.0));
  }
  // 15b. ASENDORF WALK — MODE=5 (v1.3.63). Port of the v1.3.61 ASENDORF
  // ARTIST FX algorithm into the pixel-sort panel, driven by ALL existing
  // sort knobs. Walks one pixel at a time in the scan direction (uSortAngle)
  // until the chosen metric (uSortKey) drops below an adaptive threshold,
  // tracking the brightest sample along the way. AMOUNT lowers the threshold
  // (longer runs); SEGMENT scales the max walk length; NOISE jitters the
  // threshold per scan-line; WOBBLE adds VHS luma carrier on the result.
  if (uSortAmt * mask > 0.001 && uSortMode > 4.5) {
    vec2 px = vec2(1.0 / uResolution.x, 1.0 / uResolution.y);
    float angA = floor(clamp(uSortAngle, 0.0, 3.0) + 0.5);
    vec2 step1A;
    if (angA < 0.5)      step1A = vec2(-px.x, 0.0);   // HORZ — walk back along row
    else if (angA < 1.5) step1A = vec2(0.0, -px.y);   // VERT — walk UP (classic Asendorf)
    else if (angA < 2.5) step1A = vec2(-px.x, -px.y); // DIAG ↙
    else                 step1A = vec2(-px.x,  px.y); // DIAG ↖
    float keyA = floor(clamp(uSortKey, 0.0, 7.0) + 0.5);
    // adaptive threshold: HIGH at AMOUNT=0 (very picky → short runs), LOW at
    // AMOUNT=1 (permissive → long runs). uSortLow/High give explicit control.
    float baseHi = max(uSortLow, uSortHigh);
    float threshA = mix(mix(0.55, baseHi, 0.4), 0.20, clamp(uSortAmt, 0.0, 1.0));
    // per-line jitter from NOISE
    float lineCoordA = (angA > 0.5 && angA < 1.5) ? uv.x : uv.y;
    float lineIdA = floor(lineCoordA * ((angA > 0.5 && angA < 1.5) ? uResolution.x : uResolution.y));
    threshA += (hash(lineIdA * 0.137) - 0.5) * uSortRandom * 0.35;
    threshA = clamp(threshA, 0.05, 0.95);
    // walk length: SEGMENT scales the loop ceiling 8..44
    float maxStepsA = 8.0 + clamp(uSortSegment, 0.0, 1.0) * 36.0 + uSortAmt * 12.0;
    vec3 srcColA = texture2D(uCamera, uv).rgb;
    vec3 brightestA = srcColA;
    float blumA = sortMetric(srcColA, keyA);
    bool hitA = false;
    for (int i = 1; i <= 44; i++) {
      if (float(i) > maxStepsA) break;
      vec2 sUv = clamp(uv + step1A * float(i), 0.001, 0.999);
      vec3 s = texture2D(uCamera, sUv).rgb;
      float sm = sortMetric(s, keyA);
      if (sm < threshA) break;
      if (sm > blumA) { brightestA = s; blumA = sm; hitA = true; }
    }
    vec3 sortedA = brightestA;
    // WOBBLE — VHS luma carrier on result (matches LINE-mode wobble)
    if (uSortWobble > 0.001) {
      float jit = (rand(uv + vec2(0.0, floor(uTime * 24.0) * 0.137)) - 0.5) * uSortWobble * 0.55;
      float modS = sin(uv.y * 565.0 + uTime * 3.8) * uSortWobble * 0.22;
      sortedA = clamp(sortedA + jit + modS, 0.0, 1.0);
    }
    // pixel-level replace: blend strength from AMOUNT * mask, only fires when
    // we actually walked at least one in-band step (hitA) so out-of-band
    // pixels passthrough cleanly.
    float blendA = mask * smoothstep(0.0, 0.05, uSortAmt) * (hitA ? 1.0 : 0.0);
    color.rgb = mix(color.rgb, sortedA, clamp(blendA, 0.0, 1.0));
  }
  // 16. REACTION-DIFFUSION MOSH — Gray-Scott PDE on the prev-frame R/G
  // channels (used as chemical concentrations U,V). Camera luma feeds V,
  // pattern V drives a channel-rotation moshing of the source.
  if (uReact * mask > 0.001) {
    vec2 px = 1.0 / uResolution;
    vec3 cC = texture2D(uPrevFrame, uv).rgb;
    vec3 cL = texture2D(uPrevFrame, uv - vec2(px.x, 0.0)).rgb;
    vec3 cR = texture2D(uPrevFrame, uv + vec2(px.x, 0.0)).rgb;
    vec3 cU = texture2D(uPrevFrame, uv - vec2(0.0, px.y)).rgb;
    vec3 cD = texture2D(uPrevFrame, uv + vec2(0.0, px.y)).rgb;
    vec2 UV = cC.rg;
    vec2 lap = (cL.rg + cR.rg + cU.rg + cD.rg - 4.0 * UV);
    float U = UV.x, V = UV.y;
    float reac = U * V * V;
    float du = 1.0 * lap.x - reac + 0.055 * (1.0 - U);
    float dv = 0.5 * lap.y + reac - 0.117 * V;
    vec2 newUV = clamp(UV + vec2(du, dv), 0.0, 1.0);
    newUV.y = mix(newUV.y, lum(color.rgb), 0.04);
    float vMask = newUV.y;
    vec3 reactCol = mix(color.rgb, color.gbr, vMask);
    // v1.3.35 — pure pixel-level chain.
    color.rgb = mix(color.rgb, reactCol, clamp(uReact * mask, 0.0, 1.0));
  }
  // 17. VORONOI LUMA-SORT CELLS — Worley-noise spatial partition; each
  // cell takes the brightest of 4 taps inside it as its representative.
  // Looks like organic colour blocks; a spatial cousin of Asendorf sort.
  if (uVoroSort * mask > 0.001) {
    float density = mix(30.0, 180.0, uVoroSort);
    vec2 G = uv * density;
    vec2 gid = floor(G);
    float bestD = 9999.0;
    vec2 bestSeed = gid + 0.5;
    for (int j = -1; j <= 1; j++) {
      for (int i = -1; i <= 1; i++) {
        vec2 nid = gid + vec2(float(i), float(j));
        vec2 jit = vec2(hash2(nid), hash2(nid + 13.7)) - 0.5;
        vec2 seedPx = nid + 0.5 + jit * 0.9;
        float d = length(G - seedPx);
        if (d < bestD) { bestD = d; bestSeed = seedPx; }
      }
    }
    vec2 cellUv = bestSeed / density;
    vec3 b0 = texture2D(uCamera, clamp(cellUv, 0.001, 0.999)).rgb;
    vec3 b1 = texture2D(uCamera, clamp(cellUv + vec2(0.005, 0.0), 0.001, 0.999)).rgb;
    vec3 b2 = texture2D(uCamera, clamp(cellUv - vec2(0.005, 0.0), 0.001, 0.999)).rgb;
    vec3 b3 = texture2D(uCamera, clamp(cellUv + vec2(0.0, 0.005), 0.001, 0.999)).rgb;
    vec3 best = b0; float bL = lum(b0);
    if (lum(b1) > bL) { bL = lum(b1); best = b1; }
    if (lum(b2) > bL) { bL = lum(b2); best = b2; }
    if (lum(b3) > bL) { bL = lum(b3); best = b3; }
    // v1.3.35 — pure pixel-level chain. At max knob Voronoi owns the pixel;
    // pull knob back to mix prior FX through (this is what the user wants:
    // no permanent opacity-layer feel, knob = real intensity).
    color.rgb = mix(color.rgb, best, clamp(uVoroSort * mask, 0.0, 1.0));
  }
  float g = 0.5 + uGain * 4.5;
  float fx = uGain;
  float ta = uTouchActive;
  vec2 touchPt = uTouch;
  float aa = uAudio;
  float fxA = min(fx + aa * 0.3 * fx, 1.0);

  // ── MODE 0: NORMAL ──────────────────────────────────────
  if (uMode == 0) {
    gl_FragColor = color;

  // ── MODE 1: NIGHT VISION ────────────────────────────────
  } else if (uMode == 1) {
    vec2 tx = 1.0 / uVideoSize;
    vec3 prev = texture2D(uPrevFrame, uv).rgb;
    vec3 acc = mix(color.rgb, prev, 0.5);
    vec3 n1 = texture2D(uCamera, uv + vec2(-tx.x, 0.0)).rgb;
    vec3 n2 = texture2D(uCamera, uv + vec2( tx.x, 0.0)).rgb;
    vec3 n3 = texture2D(uCamera, uv + vec2(0.0, -tx.y)).rgb;
    vec3 n4 = texture2D(uCamera, uv + vec2(0.0,  tx.y)).rgb;
    acc = acc * 0.5 + (n1 + n2 + n3 + n4) * 0.125;
    float l = lum(acc);
    l = pow(l, 1.0 / g);
    l = smoothstep(0.015, 0.85, l);
    vec3 nv = vec3(l * 0.15, l, l * 0.18);
    float noise = rand(uv * uResolution + uTime) * 0.025;
    nv += noise * vec3(0.08, 0.4, 0.08);
    float dist = length(vUv - 0.5) * 1.5;
    nv *= smoothstep(1.0, 0.3, dist);
    nv *= 0.95 + 0.05 * sin(vUv.y * uResolution.y * 1.5);
    gl_FragColor = vec4(nv, 1.0);

  // ── MODE 2: THERMAL ─────────────────────────────────────
  } else if (uMode == 2) {
    vec3 prev = texture2D(uPrevFrame, uv).rgb;
    vec3 acc = mix(color.rgb, prev, 0.4);
    float l = lum(acc);
    l = pow(l, 1.0 / g);
    l = smoothstep(0.01, 0.9, l);
    gl_FragColor = vec4(thermal(l), 1.0);

  // ── MODE 3: EDGE DETECT ─────────────────────────────────
  } else if (uMode == 3) {
    vec2 tx = 1.0 / uVideoSize;
    float invG = 1.0 / g;
    float tl = pow(lum(texture2D(uCamera, uv + vec2(-tx.x,  tx.y)).rgb), invG);
    float tc = pow(lum(texture2D(uCamera, uv + vec2( 0.0,   tx.y)).rgb), invG);
    float tr = pow(lum(texture2D(uCamera, uv + vec2( tx.x,  tx.y)).rgb), invG);
    float ml = pow(lum(texture2D(uCamera, uv + vec2(-tx.x,  0.0 )).rgb), invG);
    float mr = pow(lum(texture2D(uCamera, uv + vec2( tx.x,  0.0 )).rgb), invG);
    float bl = pow(lum(texture2D(uCamera, uv + vec2(-tx.x, -tx.y)).rgb), invG);
    float bc = pow(lum(texture2D(uCamera, uv + vec2( 0.0,  -tx.y)).rgb), invG);
    float br = pow(lum(texture2D(uCamera, uv + vec2( tx.x, -tx.y)).rgb), invG);
    float gx = -tl - 2.0*ml - bl + tr + 2.0*mr + br;
    float gy = -tl - 2.0*tc - tr + bl + 2.0*bc + br;
    float edge = sqrt(gx*gx + gy*gy) * 2.5;
    gl_FragColor = vec4(edge * 0.15, edge, edge * 0.2, 1.0);

  // ── MODE 4: MOTION ──────────────────────────────────────
  } else if (uMode == 4) {
    vec4 prev = texture2D(uPrevFrame, uv);
    float invG = 1.0 / g;
    vec3 curB = pow(color.rgb, vec3(invG));
    vec3 prevB = pow(prev.rgb, vec3(invG));
    vec3 diff = abs(curB - prevB);
    float motion = lum(diff) * 3.0;
    motion = smoothstep(0.02, 0.15, motion);
    vec3 mc = vec3(motion, motion * 0.4, motion * 0.1);
    gl_FragColor = vec4(curB * 0.15 + mc, 1.0);

  // ── MODE 5: CMYK DOTS ───────────────────────────────────
  } else if (uMode == 5) {
    float dotSz = mix(3.0, 12.0, uGain);
    float invG = 1.0 / (0.5 + uGain * 4.5);
    vec3 boosted = pow(color.rgb, vec3(invG));
    float cC = 1.0 - boosted.r; float cM = 1.0 - boosted.g; float cY = 1.0 - boosted.b;
    float cK = min(cC, min(cM, cY));
    cC = (cC - cK) / max(1.0 - cK, 0.001);
    cM = (cM - cK) / max(1.0 - cK, 0.001);
    cY = (cY - cK) / max(1.0 - cK, 0.001);
    float a15 = 0.2618; float a75 = 1.3090; float a0 = 0.0; float a45 = 0.7854;
    vec2 gpd = vUv * uResolution;
    vec2 pC = vec2(gpd.x*cos(a15)+gpd.y*sin(a15), -gpd.x*sin(a15)+gpd.y*cos(a15));
    vec2 pM = vec2(gpd.x*cos(a75)+gpd.y*sin(a75), -gpd.x*sin(a75)+gpd.y*cos(a75));
    vec2 pY = vec2(gpd.x*cos(a0)+gpd.y*sin(a0),   -gpd.x*sin(a0)+gpd.y*cos(a0));
    vec2 pK = vec2(gpd.x*cos(a45)+gpd.y*sin(a45), -gpd.x*sin(a45)+gpd.y*cos(a45));
    float dC = length(fract(pC/dotSz)-0.5)*2.0; float dM = length(fract(pM/dotSz)-0.5)*2.0;
    float dY = length(fract(pY/dotSz)-0.5)*2.0; float dK = length(fract(pK/dotSz)-0.5)*2.0;
    float hC = step(dC, cC); float hM = step(dM, cM); float hY = step(dY, cY); float hK = step(dK, cK);
    vec3 paper = vec3(0.95);
    vec3 inkC = vec3(0.0, 0.65, 0.85); vec3 inkM = vec3(0.85, 0.0, 0.55);
    vec3 inkY = vec3(1.0, 0.85, 0.0);  vec3 inkK = vec3(0.05);
    vec3 result = paper;
    result = mix(result, result * inkC, hC);
    result = mix(result, result * inkM, hM);
    result = mix(result, result * inkY, hY);
    result = mix(result, inkK, hK);
    gl_FragColor = vec4(result, 1.0);

  // ── MODE 6: HALFTONE ────────────────────────────────────
  } else if (uMode == 6) {
    float cellSize = 3.0 + (1.0 - fxA) * 13.0 + aa * 3.0;
    vec2 gridOffset = ta > 0.5 ? (touchPt - 0.5) * 20.0 : vec2(0.0);
    vec2 pixPos = vUv * uResolution + gridOffset;
    vec2 cellId = floor(pixPos / cellSize);
    vec2 cellCenter = (cellId + 0.5) * cellSize / uResolution;
    vec2 cellUv = adjustUv(cellCenter);
    vec3 cellColor = texture2D(uCamera, clamp(cellUv, 0.001, 0.999)).rgb;
    float dotR = lum(cellColor) * 0.5 * cellSize;
    vec2 pixInCell = mod(pixPos, cellSize) - cellSize * 0.5;
    if (length(pixInCell) < dotR) gl_FragColor = vec4(cellColor, 1.0);
    else gl_FragColor = vec4(vec3(0.02), 1.0);

  // ── MODE 7: PIXEL SORT ──────────────────────────────────
  // Pass through color so the FX-rack pixel-sort uniforms
  // (uSortAmt, uSortMode, uSortLow/High, uSortSegment, uSortKey,
  // uSortDirection, uSortWobble, uSortRandom) drive the look. The sort
  // blend is mixed into color upstream (see if (sortBlend > 0.001)),
  // so all PIXEL SORT rack knobs/modes (LINE/SPIRAL/BLOCK/SLICE) take
  // effect in this mode.
  } else if (uMode == 7) {
    gl_FragColor = vec4(color.rgb, 1.0);

  // ── MODE 8: GLITCH / SCRN ───────────────────────────────
  } else if (uMode == 8) {
    float intensity = 0.2 + fxA * 0.8;
    vec2 center = ta > 0.5 ? touchPt : vec2(0.5);
    float dist = distance(uv, center);
    float w1 = sin(uv.y * 50.0 + uTime * 3.0 + sin(uv.x * 20.0 + uTime)) * intensity * 0.03;
    float w2 = cos(uv.x * 40.0 + uTime * 2.3 + cos(uv.y * 30.0 + uTime * 1.3)) * intensity * 0.025;
    float w3 = sin(dist * 30.0 - uTime * 5.0) * intensity * 0.015;
    float burst = smoothstep(0.8, 1.0, sin(uTime * 1.7) * sin(uTime * 2.3 + 0.5));
    vec2 disp = vec2(w1 + w3, w2 + w3) * (1.0 + burst * 4.0);
    if (ta > 0.5) disp *= (1.0 + smoothstep(0.3, 0.0, dist) * 3.0);
    vec2 gUv = clamp(uv + disp, 0.001, 0.999);
    float ang = atan(uv.y - 0.5, uv.x - 0.5);
    float sp2 = intensity * 0.01 * (1.0 + sin(uTime * 2.0 + dist * 10.0) * 0.5);
    vec2 rOff = vec2(cos(ang + uTime * 0.5), sin(ang + uTime * 0.5)) * sp2;
    vec2 bOff = vec2(cos(ang - uTime * 0.7 + 2.0), sin(ang - uTime * 0.7 + 2.0)) * sp2;
    float rCh = texture2D(uCamera, clamp(gUv + rOff, 0.001, 0.999)).r;
    float gCh = texture2D(uCamera, gUv).g;
    float bCh = texture2D(uCamera, clamp(gUv + bOff, 0.001, 0.999)).b;
    vec3 scr = vec3(rCh, gCh, bCh);
    scr += (hash2(uv * 200.0 + uTime * 7.0) - 0.5) * 0.08 * intensity;
    gl_FragColor = vec4(clamp(scr, 0.0, 1.0), 1.0);

  // ── MODE 9: DATAMOSH ────────────────────────────────────
  } else if (uMode == 9) {
    float intensity = 0.3 + fxA * 0.7;
    vec3 curr = color.rgb;
    vec3 prev = texture2D(uPrevFrame, uv).rgb;
    vec3 diff = curr - prev;
    float motion = length(diff);
    vec2 displacement = diff.rg * intensity * 0.85;
    float wobX = sin(uv.y * 25.0 + uTime * 1.5 + sin(uv.x * 8.0 + uTime * 0.7)) * motion;
    float wobY = cos(uv.x * 25.0 + uTime * 1.1 + cos(uv.y * 8.0 + uTime * 0.9)) * motion;
    displacement += vec2(wobX, wobY) * intensity * 0.22;
    if (ta > 0.5) {
      float td = distance(uv, touchPt);
      displacement *= (1.0 + smoothstep(0.3, 0.0, td) * 4.0);
    }
    vec2 mUv = clamp(uv + displacement, 0.001, 0.999);
    vec3 mosh = texture2D(uPrevFrame, mUv).rgb;
    float blend = smoothstep(0.008, 0.08, motion) * intensity;
    mosh = mix(curr, mosh, clamp(blend, 0.0, 0.96));
    float spread = motion * intensity * 0.04;
    float mr = texture2D(uPrevFrame, clamp(mUv + vec2(spread, 0.0), 0.001, 0.999)).r;
    float mb = texture2D(uPrevFrame, clamp(mUv - vec2(spread, 0.0), 0.001, 0.999)).b;
    mosh.r = mix(mosh.r, mr, blend * 0.85);
    mosh.b = mix(mosh.b, mb, blend * 0.85);
    vec2 disp2 = vec2(sin(uTime * 2.1 + uv.x * 12.0), cos(uTime * 1.7 + uv.y * 9.0)) * intensity * 0.04;
    mosh.g = mix(mosh.g, texture2D(uPrevFrame, clamp(mUv + disp2, 0.001, 0.999)).g, blend * 0.5);
    gl_FragColor = vec4(clamp(mosh, 0.0, 1.0), 1.0);

  // ── MODE 10: KALEIDOSCOPE ───────────────────────────────
  // Aspect-corrected so the radial wedges form a true circle around the
  // screen centre on portrait phones (otherwise the kaleido pattern was
  // squashed into a vertical ellipse and pushed off-screen).
  } else if (uMode == 10) {
    float segments = 3.0 + uGain * 9.0;
    vec2 center = ta > 0.5 ? touchPt : vec2(0.5);
    float aspK = uResolution.x / max(uResolution.y, 1.0);
    // Aspect-correct in screen-pixel space so the wedge stays radially round.
    vec2 kUv = (uv - center) * vec2(aspK, 1.0);
    float angle = atan(kUv.y, kUv.x);
    float radius = length(kUv);
    angle += aa * 0.6;
    float segAngle = 6.28318530718 / segments;
    angle = mod(angle, segAngle);
    if (angle > segAngle * 0.5) angle = segAngle - angle;
    float flow = sin(radius * 15.0 + uTime * 2.0) * cos(angle * 3.0 + uTime) * uGain * 0.06;
    radius = radius * (1.0 + flow);
    angle += sin(radius * 20.0 - uTime * 1.5) * uGain * 0.04;
    // Undo aspect when projecting back to UV so the result re-centres.
    vec2 kalUv = clamp(vec2(cos(angle) / max(aspK, 0.0001), sin(angle)) * radius + center, 0.001, 0.999);
    float spread = 0.005 * uGain;
    float rCh = texture2D(uCamera, clamp(vec2(cos(angle+spread)/max(aspK,0.0001),sin(angle+spread))*radius+center,0.001,0.999)).r;
    float gCh = texture2D(uCamera, kalUv).g;
    float bCh = texture2D(uCamera, clamp(vec2(cos(angle-spread)/max(aspK,0.0001),sin(angle-spread))*radius+center,0.001,0.999)).b;
    gl_FragColor = vec4(clamp(vec3(rCh,gCh,bCh),0.0,1.0), 1.0);

  // ── MODE 11: POSTERIZE ──────────────────────────────────
  } else if (uMode == 11) {
    float intensity = 0.2 + fxA * 0.8;
    float baseLevels = 2.0 + (1.0 - uGain) * 22.0;
    float warpX = sin(uv.y * 30.0 + uTime * 1.5) * cos(uv.x * 15.0 + uTime * 0.8) * intensity * 0.015;
    float warpY = cos(uv.x * 25.0 + uTime * 1.2) * sin(uv.y * 20.0 + uTime * 1.7) * intensity * 0.012;
    vec2 wUv = clamp(uv + vec2(warpX, warpY), 0.001, 0.999);
    vec3 wc = texture2D(uCamera, wUv).rgb;
    vec2 ditherPos = mod(floor(vUv * uResolution), 2.0);
    float dither = (ditherPos.x * 2.0 + ditherPos.y) / 4.0 - 0.375;
    dither *= (1.0 / baseLevels) * intensity * 0.5;
    vec3 pc = wc + dither;
    float rLev = max(2.0, baseLevels + sin(uv.x * 20.0 + uTime) * intensity * 2.0);
    float gLev = max(2.0, baseLevels + cos(uv.y * 18.0 + uTime * 1.3) * intensity * 2.0);
    float bLev = max(2.0, baseLevels + sin((uv.x+uv.y)*15.0+uTime*0.9)*intensity*2.0);
    pc = vec3(floor(pc.r*rLev+0.5)/rLev, floor(pc.g*gLev+0.5)/gLev, floor(pc.b*bLev+0.5)/bLev);
    gl_FragColor = vec4(clamp(pc, 0.0, 1.0), 1.0);

  // ── MODE 12: CHROMASHIFT ───────────────────────────────────────────
  } else if (uMode == 12) {
    float spd = uGain * 0.8;
    float shift = (sin(uTime * spd) * 0.5 + 0.5) * fxA * 0.025 + 0.004;
    float rX = shift * cos(uTime * 0.7);
    float rY = shift * sin(uTime * 0.6 + 0.5);
    float gX = shift * 0.3 * sin(uTime * 0.5 + 1.3);
    float gY = shift * 0.3 * cos(uTime * 0.4 + 1.7);
    float bX = -shift * cos(uTime * 0.9 + 2.1);
    float bY = -shift * sin(uTime * 0.8 + 3.0);
    float rr = texture2D(uCamera, clamp(uv + vec2(rX, rY), 0.001, 0.999)).r;
    float gg = texture2D(uCamera, clamp(uv + vec2(gX, gY), 0.001, 0.999)).g;
    float bb = texture2D(uCamera, clamp(uv + vec2(bX, bY), 0.001, 0.999)).b;
    vec3 prevChsf = texture2D(uPrevFrame, uv).rgb;
    gl_FragColor = vec4(mix(vec3(rr, gg, bb), prevChsf, fxA * 0.15), 1.0);

  // ── MODE 13: FEEDBACK ──────────────────────────────────────────────
  } else if (uMode == 13) {
    float strF = 0.3 + fxA * 0.62;
    float angF = uTime * 0.15 * (1.0 + fxA);
    float zoomF = 0.992 + (1.0 - fxA) * 0.006;
    vec2 offF = vec2(sin(angF) * 0.003, cos(angF * 1.3) * 0.002) * (1.0 + fxA);
    vec2 fbUv = clamp((uv - 0.5) * zoomF + 0.5 + offF, 0.001, 0.999);
    vec3 feedBack = texture2D(uPrevFrame, fbUv).rgb;
    float fadeF = 0.90 + (1.0 - strF) * 0.08;
    vec3 resultF = mix(color.rgb * 0.8, feedBack * fadeF, strF);
    resultF += color.rgb * (1.0 - strF) * 0.3;
    gl_FragColor = vec4(clamp(resultF, 0.0, 1.0), 1.0);

  // ── MODE 14: BLOCKROT ─────────────────────────────────────────────
  } else if (uMode == 14) {
    float blockSz = mix(0.12, 0.025, uGain);
    vec2 blockId = floor(uv / blockSz);
    float seedB = hash2(blockId) * 6.2832;
    float tSliceB = floor(uTime * (0.5 + fxA * 1.5));
    float angleB = seedB + hash(tSliceB + hash2(blockId) * 100.0) * 6.2832 * fxA;
    vec2 centerB = (blockId + 0.5) * blockSz;
    vec2 offB = uv - centerB;
    float caB = cos(angleB), saB = sin(angleB);
    vec2 rotatedB = vec2(caB * offB.x - saB * offB.y, saB * offB.x + caB * offB.y);
    gl_FragColor = texture2D(uCamera, clamp(centerB + rotatedB, 0.001, 0.999));

  // ── MODE 15: CORRUPT ────────────────────────────────────────────────
  } else if (uMode == 15) {
    float intC = 0.25 + fxA * 0.75;
    float scanRowC = floor(uv.y * uResolution.y);
    float tSliceC = floor(uTime * (2.0 + fxA * 4.0));
    float isBand = step(1.0 - intC * 0.4, hash(scanRowC * 0.17 + tSliceC));
    float hShiftC = (hash(scanRowC * 1.3 + uTime * 3.0) - 0.5) * 0.5 * intC * isBand;
    vec2 cUvC = clamp(uv + vec2(hShiftC, 0.0), 0.001, 0.999);
    vec3 camCC = texture2D(uCamera, cUvC).rgb;
    float isNoise = step(0.88, hash(scanRowC * 0.3 + floor(uTime * 5.0))) * isBand;
    vec3 noiseCC = vec3(hash(scanRowC + uTime * 7.0), hash(scanRowC * 1.3 + uTime * 6.0) * 0.2, 0.0);
    gl_FragColor = vec4(mix(camCC, noiseCC, isNoise), 1.0);

  // ── MODE 16: SLICER ─────────────────────────────────────────────────
  } else if (uMode == 16) {
    float sliceCount = 4.0 + fxA * 20.0;
    float sliceId = floor(uv.y * sliceCount);
    float t = uTime * (0.5 + fxA * 2.0);
    float offset = sin(sliceId * 1.3 + t) * cos(sliceId * 0.7 - t * 0.6) * fxA * 0.3;
    offset *= (mod(sliceId, 2.0) > 0.5 ? 1.0 : -1.0);
    // Quantize offset at high gain for snap effect
    if (fxA > 0.5) {
      float snap = mix(1.0, 8.0, (fxA - 0.5) * 2.0);
      offset = floor(offset * snap) / snap;
    }
    float rr = texture2D(uCamera, clamp(uv + vec2(offset, 0.0), 0.001, 0.999)).r;
    float gg = texture2D(uCamera, clamp(uv + vec2(offset * 0.7, 0.0), 0.001, 0.999)).g;
    float bb = texture2D(uCamera, clamp(uv + vec2(offset * 1.3, 0.0), 0.001, 0.999)).b;
    gl_FragColor = vec4(rr, gg, bb, 1.0);

  // ── MODE 17: VORTEX ─────────────────────────────────────────────────
  } else if (uMode == 17) {
    vec2 center = ta > 0.5 ? touchPt : vec2(0.5);
    vec2 d = uv - center;
    float rV = length(d);
    float baseAng = rV > 0.0001 ? atan(d.y, d.x) : 0.0;
    float swirl = fxA * 6.28318 * (1.0 - smoothstep(0.0, 0.5, rV));
    swirl += sin(uTime * 0.5) * fxA * 2.0 * max(0.0, 1.0 - rV * 2.0);
    float spread = 0.008 * fxA;
    vec2 uvVG = center + vec2(cos(baseAng + swirl), sin(baseAng + swirl)) * rV;
    vec2 uvVR = center + vec2(cos(baseAng + swirl + spread), sin(baseAng + swirl + spread)) * rV;
    vec2 uvVB = center + vec2(cos(baseAng + swirl - spread), sin(baseAng + swirl - spread)) * rV;
    float rr = texture2D(uCamera, clamp(uvVR, 0.001, 0.999)).r;
    float gg = texture2D(uCamera, clamp(uvVG, 0.001, 0.999)).g;
    float bb = texture2D(uCamera, clamp(uvVB, 0.001, 0.999)).b;
    gl_FragColor = vec4(rr, gg, bb, 1.0);

  // ── MODE 18: PRISM ──────────────────────────────────────────────────
  } else if (uMode == 18) {
    vec2 tx = 1.0 / uVideoSize;
    float lR = lum(texture2D(uCamera, clamp(uv + vec2(tx.x, 0.0), 0.001, 0.999)).rgb);
    float lL = lum(texture2D(uCamera, clamp(uv - vec2(tx.x, 0.0), 0.001, 0.999)).rgb);
    float lU = lum(texture2D(uCamera, clamp(uv + vec2(0.0, tx.y), 0.001, 0.999)).rgb);
    float lD = lum(texture2D(uCamera, clamp(uv - vec2(0.0, tx.y), 0.001, 0.999)).rgb);
    vec2 grad = vec2(lR - lL, lU - lD);
    float gradMag = length(grad);
    float prismStr = fxA * 0.09 * gradMag * 18.0;
    float angP = (gradMag > 0.0001 ? atan(grad.y, grad.x) : 0.0) + uTime * 0.2;
    vec2 uvPR = clamp(uv + vec2(cos(angP) * prismStr * 1.4, sin(angP) * prismStr * 1.4), 0.001, 0.999);
    vec2 uvPG = clamp(uv + vec2(cos(angP + 0.55) * prismStr * 0.7, sin(angP + 0.55) * prismStr * 0.7), 0.001, 0.999);
    vec2 uvPB = clamp(uv + vec2(cos(angP + 1.1) * prismStr * 0.25, sin(angP + 1.1) * prismStr * 0.25), 0.001, 0.999);
    gl_FragColor = vec4(texture2D(uCamera, uvPR).r, texture2D(uCamera, uvPG).g, texture2D(uCamera, uvPB).b, 1.0);

  // ── MODE 19: ACID ───────────────────────────────────────────────────
  } else if (uMode == 19) {
    float tA = uTime * (0.3 + fxA * 0.4);
    float warp = fxA * 0.1;
    vec2 aUv = uv;
    aUv.x += sin(uv.y * 9.0 + tA * 1.7) * cos(uv.x * 5.0 + tA * 1.1) * warp;
    aUv.y += cos(uv.x * 7.0 + tA * 1.3) * sin(uv.y * 6.0 + tA * 0.9) * warp;
    aUv.x += sin(aUv.y * 14.0 + tA * 2.1) * warp * 0.4;
    vec3 ca = texture2D(uCamera, clamp(aUv, 0.001, 0.999)).rgb;
    float lumA = lum(ca);
    float hueRot = fxA * mod(lumA * 2.5 + uv.x * 0.7 + uv.y * 0.5 + tA * 0.4, 1.0);
    vec3 acid = hsl2rgb(hueRot, 0.9, 0.3 + lumA * 0.45);
    gl_FragColor = vec4(mix(ca, acid, fxA * 0.85), 1.0);

  // ── MODE 20: DITHER ─────────────────────────────────────────────────
  } else if (uMode == 20) {
    float cellSize = mix(2.0, 8.0, fxA);
    vec2 cell = floor(vUv * uResolution / cellSize);
    float tD = floor(uTime * (1.0 + fxA * 6.0));
    float thresh = hash2(cell + tD * 7.3);
    float xorPat = mod(cell.x + cell.y, 2.0);
    float lumD = lum(color.rgb);
    float ditherBit = step(thresh, lumD);
    float hue1 = mod(uTime * 0.08 + hash2(cell * 0.01), 1.0);
    vec3 colA = hsl2rgb(hue1, 0.95, 0.5);
    vec3 colB = hsl2rgb(mod(hue1 + 0.5, 1.0), 0.95, 0.5);
    vec3 dith = mix(colA, colB, mix(ditherBit, xorPat, fxA * 0.5));
    gl_FragColor = vec4(mix(color.rgb, dith, fxA * 0.9 + 0.1), 1.0);

  // ── MODE 21: STUTTER ────────────────────────────────────────────────
  } else if (uMode == 21) {
    float strips = 4.0 + fxA * 20.0;
    float stripId = floor(uv.x * strips);
    float tSt = floor(uTime * (1.0 + fxA * 5.0));
    float usePrev = step(0.5, hash(stripId * 1.7 + tSt * 3.1));
    float yOff = (hash(stripId * 2.3 + tSt * 1.7) - 0.5) * fxA * 0.15;
    vec2 stUv = clamp(uv + vec2(0.0, yOff), 0.001, 0.999);
    float xOff = (hash(stripId + tSt * 2.1) - 0.5) * fxA * 0.04;
    vec3 curr = texture2D(uCamera, stUv).rgb;
    vec3 prev = texture2D(uPrevFrame, stUv).rgb;
    float stR = texture2D(uCamera, clamp(stUv + vec2(xOff, 0.0), 0.001, 0.999)).r;
    vec3 stuttered = mix(curr, prev, usePrev);
    stuttered.r = mix(stuttered.r, stR, usePrev * fxA);
    gl_FragColor = vec4(stuttered, 1.0);

  // ── MODE 22: PIXEL MELT ─────────────────────────────────────────────
  } else if (uMode == 22) {
    float meltAmt = 0.15 + fxA * 0.85;
    float colBase = floor(uv.x * uResolution.x / 4.0) * 4.0 / uResolution.x;
    float topLum = lum(texture2D(uCamera, vec2(clamp(colBase, 0.001, 0.999), 0.08)).rgb);
    float meltSpeed = topLum * 0.5 + meltAmt * 0.5;
    float meltY = mod(uv.y + uTime * meltSpeed * 0.7, 1.0);
    float stretch = sin(uv.x * 18.0 + uTime * 0.9) * meltAmt * 0.04;
    vec2 mUvMelt = clamp(vec2(uv.x + stretch, meltY), 0.001, 0.999);
    float rShiftM = meltAmt * 0.018;
    float rrM = texture2D(uCamera, clamp(vec2(mUvMelt.x + rShiftM, mUvMelt.y), 0.001, 0.999)).r;
    float ggM = texture2D(uCamera, mUvMelt).g;
    float bbM = texture2D(uCamera, clamp(vec2(mUvMelt.x - rShiftM * 0.6, mUvMelt.y), 0.001, 0.999)).b;
    vec3 meltColor = vec3(rrM, ggM, bbM);
    vec3 prevMelt = texture2D(uPrevFrame, mUvMelt).rgb;
    gl_FragColor = vec4(mix(meltColor, prevMelt, meltAmt * 0.48), 1.0);

  // ── MODE 23: SIGNAL STATIC ──────────────────────────────────────────
  } else if (uMode == 23) {
    float intS = 0.25 + fxA * 0.75;
    float bandFreq = 10.0 + intS * 20.0;
    float tSliceS = floor(uTime * (2.0 + intS * 4.0));
    float bandY = floor(uv.y * bandFreq);
    float isDropout = step(0.62, hash(bandY * 1.7 + tSliceS));
    float hShiftS = (hash(bandY * 3.1 + tSliceS) - 0.5) * intS * 0.14;
    vec2 sUvS = clamp(uv + vec2(hShiftS, 0.0), 0.001, 0.999);
    vec3 camS = texture2D(uCamera, sUvS).rgb;
    float nrS = hash2(uv * uResolution + vec2(tSliceS * 7.0, 3.3));
    float ngS = hash2(uv * uResolution + vec2(13.0, tSliceS * 5.3));
    vec3 staticColor = vec3(nrS * 0.9, ngS * 0.08, 0.0);
    float speckleS = step(0.955, hash2(uv * uResolution * 1.5 + tSliceS * 17.0));
    vec3 resultS = mix(camS, staticColor, isDropout * intS);
    resultS = mix(resultS, vec3(0.85), speckleS * intS * 0.7);
    float scanS = sin(uv.y * uResolution.y * 1.5 + uTime * 12.0) * 0.035 * intS;
    gl_FragColor = vec4(clamp(resultS + scanS, 0.0, 1.0), 1.0);

  // ── MODE 24: MIRROR FOLD ────────────────────────────────────────────
  } else if (uMode == 24) {
    vec2 pMirr = uv;
    pMirr = abs(pMirr * 2.0 - 1.0) * 0.5;
    float fold2 = step(0.45, fxA);
    pMirr = mix(pMirr, abs(pMirr * 4.0 - 1.0) * 0.5, fold2);
    vec2 cMirr = pMirr - 0.5;
    float angMirr = uTime * 0.07 + fxA * 0.5;
    pMirr = vec2(cMirr.x * cos(angMirr) - cMirr.y * sin(angMirr),
                 cMirr.x * sin(angMirr) + cMirr.y * cos(angMirr)) + 0.5;
    pMirr = clamp(pMirr, 0.001, 0.999);
    float spMirr = fxA * 0.011;
    float rrMirr = texture2D(uCamera, clamp(pMirr + vec2(spMirr, spMirr * 0.5), 0.001, 0.999)).r;
    float ggMirr = texture2D(uCamera, pMirr).g;
    float bbMirr = texture2D(uCamera, clamp(pMirr - vec2(spMirr, spMirr * 0.5), 0.001, 0.999)).b;
    gl_FragColor = vec4(rrMirr, ggMirr, bbMirr, 1.0);

  // ── MODE 25: MOSH SQUASH ─────────────────────────────────────────────
  } else if (uMode == 25) {
    float intM = 0.25 + fxA * 0.75;
    vec2 blkSz = vec2(mix(0.14, 0.03, fxA), mix(0.10, 0.02, fxA));
    vec2 blkId = floor(uv / blkSz);
    vec2 blkCenter = (blkId + 0.5) * blkSz;

    float tStep = floor(uTime * (2.0 + intM * 7.0));
    float jumpGate = step(0.52, hash2(blkId * 1.31 + tStep * 0.37));
    float jumpX = (hash2(blkId * 2.17 + tStep * 1.13) - 0.5) * intM * 0.36;
    float jumpY = (hash2(blkId * 0.91 + tStep * 0.73) - 0.5) * intM * 0.24;
    vec2 jumpUv = clamp(uv + vec2(jumpX, jumpY) * jumpGate, 0.001, 0.999);

    vec3 currM = texture2D(uCamera, jumpUv).rgb;
    vec3 prevM = texture2D(uPrevFrame, jumpUv).rgb;
    float mtnM = length(currM - prevM);
    float hold = clamp(intM * (0.55 + mtnM * 2.2), 0.0, 0.98);
    vec3 moshM = mix(currM, prevM, hold);

    float shear = (hash2(blkId * 1.7 + tStep * 0.2) - 0.5) * intM * 0.08;
    vec2 rowUv = clamp(vec2(uv.x + shear, uv.y), 0.001, 0.999);
    float rM = texture2D(uPrevFrame, clamp(rowUv + vec2(intM * 0.03, 0.0), 0.001, 0.999)).r;
    float gM = texture2D(uPrevFrame, rowUv).g;
    float bM = texture2D(uPrevFrame, clamp(rowUv - vec2(intM * 0.026, 0.0), 0.001, 0.999)).b;
    vec3 splitM = vec3(rM, gM, bM);

    float blockEdge = smoothstep(0.48, 0.5, max(abs(fract(uv.x / blkSz.x) - 0.5), abs(fract(uv.y / blkSz.y) - 0.5)));
    vec3 outM = mix(moshM, splitM, clamp(intM * 0.65, 0.0, 0.9));
    outM *= (1.0 - blockEdge * intM * 0.18);
    gl_FragColor = vec4(clamp(outM, 0.0, 1.0), 1.0);

  // ── MODE 26: RIFT SORT ───────────────────────────────────────────────
  } else if (uMode == 26) {
    float intR = 0.2 + fxA * 0.8;
    float stripes = mix(7.0, 34.0, intR);
    float sId = floor(uv.y * stripes);
    float tR = floor(uTime * (1.5 + intR * 5.0));
    float dir = step(0.5, hash(sId * 2.3 + tR)) * 2.0 - 1.0;

    float shift = (hash(sId * 0.73 + tR * 1.7) - 0.5) * intR * 0.55;
    vec2 baseR = clamp(vec2(uv.x + shift * dir, uv.y), 0.001, 0.999);
    vec3 srcR = texture2D(uCamera, baseR).rgb;

    float crit = lum(srcR);
    float thresh = mix(0.2, 0.74, intR);
    float gate = step(thresh, crit) * (0.55 + intR * 0.45);

    float px = 1.0 / uResolution.x;
    vec3 bestHi = srcR;
    vec3 bestLo = srcR;
    float hi = crit;
    float lo = crit;
    for (int i = 1; i <= 9; i++) {
      float d = float(i) * (2.0 + intR * 8.0) * px * dir;
      vec2 su = clamp(baseR + vec2(d, 0.0), 0.001, 0.999);
      vec3 sc = texture2D(uCamera, su).rgb;
      float sl = lum(sc);
      if (sl > hi) { hi = sl; bestHi = sc; }
      if (sl < lo) { lo = sl; bestLo = sc; }
    }

    vec3 sorted = mix(bestLo, bestHi, step(0.5, hash(sId * 4.1 + tR * 0.7)));
    vec3 prevR = texture2D(uPrevFrame, baseR).rgb;
    vec3 rift = mix(srcR, sorted, gate);
    rift = mix(rift, prevR, clamp(intR * 0.35 + gate * 0.35, 0.0, 0.82));

    float tear = step(0.72, hash(sId * 5.9 + tR * 1.2)) * intR;
    vec2 tearUv = clamp(baseR + vec2((hash(sId * 1.9 + tR * 2.9) - 0.5) * 0.22 * tear, 0.0), 0.001, 0.999);
    vec3 tearC = texture2D(uPrevFrame, tearUv).rgb;
    gl_FragColor = vec4(clamp(mix(rift, tearC, tear * 0.75), 0.0, 1.0), 1.0);

  } else {
    gl_FragColor = color;
  }

  // ── RACK MIX (Phase 2c batches 1+2): wet/dry blend for modes whose ──
  // MODE_SCHEMAS expose MIX at slot 1: modes 4, 12, and 14–21.
  // Defaults to 1.0 (fully wet) so visual behavior matches pre-rack master.
  if (uMode == 4 || uMode == 12 || (uMode >= 14 && uMode <= 21)) {
    gl_FragColor.rgb = mix(color.rgb, gl_FragColor.rgb, clamp(uModeParams[1], 0.0, 1.0));
  }

  // ── POST-PROCESS: brightness / contrast / saturation / hue / scanlines ──
  vec3 post = gl_FragColor.rgb;
  // Brightness
  post = post + vec3(uBrightness - 1.0);
  // Contrast
  post = (post - 0.5) * uContrast + 0.5;
  // Saturation
  float lp = dot(post, vec3(0.299, 0.587, 0.114));
  post = mix(vec3(lp), post, uSaturation);
  // Hue shift
  if (abs(uHueShift) > 0.001) {
    float maxp = max(post.r, max(post.g, post.b));
    float minp = min(post.r, min(post.g, post.b));
    float dp = maxp - minp;
    if (dp > 0.001) {
      float hp = 0.0;
      if (maxp == post.r) hp = mod((post.g - post.b) / dp, 6.0);
      else if (maxp == post.g) hp = (post.b - post.r) / dp + 2.0;
      else hp = (post.r - post.g) / dp + 4.0;
      hp = mod(hp + uHueShift * 6.0, 6.0);
      float sp = dp / maxp;
      vec3 hrgb = clamp(abs(mod(hp + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
      post = maxp * mix(vec3(1.0), hrgb, sp);
    }
  }
  // Scanlines
  if (uScanlines > 0.001) {
    float scan = sin(vUv.y * uResolution.y * 3.14159) * 0.5 + 0.5;
    post *= 1.0 - uScanlines * 0.35 * (1.0 - scan);
  }
  // ── RGBNDR (analog VGA channel-bender, ohss/RGBNDR-inspired) ──────
  if (uRgbR > 0.001 || uRgbG > 0.001 || uRgbB > 0.001 || uRgbBars > 0.001 || uRgbSwap > 0.5) {
    // Per-channel oscillator-driven horizontal sample offset.
    // v1.3.46 — phone bump: per-channel sweep 0.08→0.14 so RGBNDR R/G/B knobs at
    // max produce a wide ~28%% screen sweep, reading as full analog channel-bend.
    float oR = sin(vUv.y * 47.0 + uTime * 1.7) * uRgbR * 0.14;
    float oG = sin(vUv.y * 73.0 + uTime * 1.1 + 1.7) * uRgbG * 0.14;
    float oB = sin(vUv.y * 31.0 + uTime * 0.6 + 3.1) * uRgbB * 0.14;
    float rCh = texture2D(uCamera, clamp(vec2(vUv.x + oR, vUv.y), 0.0, 1.0)).r;
    float gCh = texture2D(uCamera, clamp(vec2(vUv.x + oG, vUv.y), 0.0, 1.0)).g;
    float bCh = texture2D(uCamera, clamp(vec2(vUv.x + oB, vUv.y), 0.0, 1.0)).b;
    vec3 ben = vec3(rCh, gCh, bCh);
    // Channel swap (circuit-bent rewiring): 0 RGB / 1 GBR / 2 BRG / 3 BGR / 4 RBG / 5 GRB
    float swp = floor(clamp(uRgbSwap, 0.0, 5.0) + 0.5);
    if      (swp < 0.5) {}                  // RGB
    else if (swp < 1.5) ben = ben.gbr;
    else if (swp < 2.5) ben = ben.brg;
    else if (swp < 3.5) ben = ben.bgr;
    else if (swp < 4.5) ben = ben.rbg;
    else                ben = ben.grb;
    float maxAmt = max(uRgbR, max(uRgbG, max(uRgbB, swp > 0.5 ? 0.85 : 0.0)));
    post = mix(post, ben, clamp(maxAmt, 0.0, 1.0));
    // SMPTE color-bar overlay (top 2/3 = 7 primaries, bottom 1/3 = PLUGE).
    if (uRgbBars > 0.001) {
      vec3 bars;
      if (vUv.y > 0.33) {
        float b = floor(vUv.x * 8.0);
        if      (b < 0.5) bars = vec3(0.75);
        else if (b < 1.5) bars = vec3(0.75, 0.75, 0.0);
        else if (b < 2.5) bars = vec3(0.0, 0.75, 0.75);
        else if (b < 3.5) bars = vec3(0.0, 0.75, 0.0);
        else if (b < 4.5) bars = vec3(0.75, 0.0, 0.75);
        else if (b < 5.5) bars = vec3(0.75, 0.0, 0.0);
        else if (b < 6.5) bars = vec3(0.0, 0.0, 0.75);
        else              bars = vec3(0.0);
      } else {
        float b = floor(vUv.x * 4.0);
        if      (b < 0.5) bars = vec3(0.0, 0.13, 0.30);
        else if (b < 1.5) bars = vec3(1.0);
        else if (b < 2.5) bars = vec3(0.20, 0.0, 0.42);
        else              bars = vec3(0.07);
      }
      post = mix(post, bars, clamp(uRgbBars, 0.0, 1.0) * 0.75);
    }
  }
  // ── H-SYNC SLIP (per-row tear-and-shift, scanline-locked) ────────
  // Cheap-and-mean horizontal-sync emulation: each scanline picks a
  // hash-driven offset whose probability scales with the knob. Most rows
  // pass through; a few jump by up to ~25% of the screen width.
  if (uHSync > 0.001) {
    float row = floor(vUv.y * uResolution.y);
    float seed = floor(uTime * (3.0 + uHSync * 12.0));
    float roll = rand(vec2(row * 0.013, seed * 0.071));
    // v1.3.46 — phone bump: row-eligibility threshold 0.45→0.70 so at max H-SYNC
    // the majority of scanlines participate in the slip (was ~45%% of rows). Jump
    // amplitude 0.5→0.8 so each slipped row tears further — full broken-VHS look.
    float thresh = 1.0 - clamp(uHSync, 0.0, 1.0) * 0.70;
    if (roll > thresh) {
      float jump = (rand(vec2(row * 0.029, seed * 0.041)) - 0.5) * uHSync * 0.8;
      vec2 sUv = clamp(vec2(vUv.x + jump, vUv.y), 0.0, 1.0);
      vec3 slipped = texture2D(uCamera, sUv).rgb;
      post = mix(post, slipped, clamp(uHSync * 1.2, 0.0, 1.0));
    }
  }
  // ── RUPTURE (cyberboy666/_rupture_ destroy combo) ──────────────
  // Composite-signal-destruction emulation. One knob drives THREE
  // simultaneous failure modes, escalating with the value:
  //   - DROPOUT: random horizontal black bars (lost sync)
  //   - CHROMA CRASH: full-frame chroma corruption spikes
  //   - SYNC BURST: bursty vertical jumps that smear the frame
  if (uRupture > 0.001) {
    float r = clamp(uRupture, 0.0, 1.0);
    float t = floor(uTime * (8.0 + r * 24.0));
    // 1. Random black dropout bars
    float row = floor(vUv.y * uResolution.y / max(2.0, 8.0 - r * 6.0));
    float dropRoll = rand(vec2(row * 0.017, t * 0.031));
    float dropThresh = 1.0 - r * 0.18;
    if (dropRoll > dropThresh) {
      post = mix(post, vec3(0.0), clamp(r * 1.4, 0.0, 1.0));
    }
    // 2. Chroma crash — hash-driven per-frame channel scramble
    float crashRoll = rand(vec2(t * 0.13, 7.31));
    if (crashRoll > 1.0 - r * 0.55) {
      vec3 sc;
      sc.r = post.b * (0.4 + rand(vec2(t,1.0)) * 1.2);
      sc.g = post.r * (0.4 + rand(vec2(t,2.0)) * 1.2);
      sc.b = post.g * (0.4 + rand(vec2(t,3.0)) * 1.2);
      post = mix(post, sc, clamp(r, 0.0, 0.95));
    }
    // 3. Sync burst — vertical UV jump + horizontal smear of source
    float burstRoll = rand(vec2(t * 0.21, 11.7));
    if (burstRoll > 1.0 - r * 0.35) {
      float jy = (rand(vec2(t, 13.1)) - 0.5) * r * 0.18;
      float jx = (rand(vec2(t, 17.3)) - 0.5) * r * 0.14;
      vec2 bUv = clamp(vUv + vec2(jx, jy), 0.0, 1.0);
      vec3 burst = texture2D(uCamera, bUv).rgb;
      post = mix(post, burst, clamp(r * 1.1, 0.0, 1.0));
    }
  }
  // ── v1.3.63 NOVEL CS FX (artist-family batch 1) ───────────────────
  // v1.3.63: all blocks now use `uv` (mirrored/cropped) NOT `vUv`, and
  // operate on `post` as input so they STACK destructively at pixel level
  // instead of opacity-blending a fresh camera sample over the pipeline.
  // 1. MENKMAN — DCT-block quantize of POST. Samples 4 corners of an 8x8
  //    block from the live pipeline (via uv), reconstructs as DC + first
  //    AC X/Y basis with N-level quantization, then NUKES the current
  //    pixel's post toward that block-quant. Compounds with everything.
  if (uMenkmanFX > 0.001) {
    float bs = 8.0 / max(uResolution.y, 1.0);
    vec2 bUv = floor(uv / bs) * bs;
    vec2 fUv = clamp((uv - bUv) / bs, 0.0, 1.0);
    vec3 c0 = texture2D(uCamera, bUv).rgb;
    vec3 c1 = texture2D(uCamera, bUv + vec2(bs * 0.99, 0.0)).rgb;
    vec3 c2 = texture2D(uCamera, bUv + vec2(0.0, bs * 0.99)).rgb;
    vec3 c3 = texture2D(uCamera, bUv + vec2(bs * 0.99, bs * 0.99)).rgb;
    vec3 dc = (c0 + c1 + c2 + c3) * 0.25;
    vec3 acX = (c1 + c3) - (c0 + c2);
    vec3 acY = (c2 + c3) - (c0 + c1);
    float Q = mix(2.0, 24.0, clamp(uMenkmanFX, 0.0, 1.0));
    // quantize the LIVE post relative to block DC, not raw camera
    vec3 dcMix = mix(dc, post, 0.5);
    vec3 dcQ = floor(dcMix * Q + 0.5) / Q;
    float bx = cos(fUv.x * 3.14159);
    float by = cos(fUv.y * 3.14159);
    vec3 rec = dcQ + acX * bx * 0.30 + acY * by * 0.30;
    // multiplicative+additive corruption — stacks with everything
    vec3 corrupt = post * 0.4 + rec * 0.6 + (rec - post) * 0.5;
    post = mix(post, clamp(corrupt, 0.0, 1.0), clamp(uMenkmanFX, 0.0, 1.0));
  }
  // 2. MOLNÁR — recursive Mondrian BSP applied to POST. Each cell gets a
  //    hue-shift + brightness modulation derived from cell index, AND the
  //    grid lines are SUBTRACTED from post (black borders carve into
  //    image, not overlay). Pixel-level destruction of post, no replace.
  if (uMolnarFX > 0.001) {
    vec2 r0 = vec2(0.0);
    vec2 r1 = vec2(1.0);
    int depth = int(3.0 + uMolnarFX * 5.0);
    float cellId = 0.0;
    for (int i = 0; i < 8; i++) {
      if (i >= depth) break;
      vec2 c = (r0 + r1) * 0.5;
      float h = hash(float(i) * 7.13 + floor(c.x * 7.0) * 1.7 + floor(c.y * 7.0) * 2.3);
      float phiInv = 0.6180339887;
      float split = mix(phiInv, 1.0 - phiInv, h);
      vec2 sz = r1 - r0;
      if (sz.x > sz.y) {
        float sx = r0.x + sz.x * split;
        if (uv.x < sx) { r1.x = sx; cellId = cellId * 2.0; }
        else           { r0.x = sx; cellId = cellId * 2.0 + 1.0; }
      } else {
        float sy = r0.y + sz.y * split;
        if (uv.y < sy) { r1.y = sy; cellId = cellId * 2.0; }
        else           { r0.y = sy; cellId = cellId * 2.0 + 1.0; }
      }
    }
    // per-cell hue swap + brightness flip on POST (not camera)
    float ch = hash(cellId * 13.7);
    float cs = hash(cellId * 21.3);
    vec3 swiz;
    if      (ch < 0.25) swiz = post.rgb;
    else if (ch < 0.50) swiz = post.gbr;
    else if (ch < 0.75) swiz = post.brg;
    else                swiz = vec3(1.0) - post.rgb; // invert this cell
    swiz *= 0.6 + cs * 0.8;
    // black borders carved INTO post (subtractive)
    vec2 d = min(uv - r0, r1 - uv);
    float border = 1.0 - smoothstep(0.0, 0.004, min(d.x, d.y));
    swiz = mix(swiz, vec3(0.0), border * 0.95);
    post = mix(post, clamp(swiz, 0.0, 1.0), clamp(uMolnarFX, 0.0, 1.0));
  }
  // 3. UCNV — Haar HF subband swap. Compute post's local LF from
  //    neighborhood in uv-space; extract HF as (post - LF). Pull prev
  //    frame's HF; reassemble as post_LF + prev_HF. True subband
  //    corruption — operates on post's own frequency content.
  if (uUcnvFX > 0.001) {
    vec2 px = 1.0 / max(uResolution, vec2(1.0));
    vec3 lp = vec3(0.0);
    vec3 lpP = vec3(0.0);
    for (int dy = 0; dy < 3; dy++) {
      for (int dx = 0; dx < 3; dx++) {
        vec2 off = (vec2(float(dx), float(dy)) - 1.0) * px;
        lp  += texture2D(uCamera,    uv + off).rgb;
        lpP += texture2D(uPrevFrame, uv + off).rgb;
      }
    }
    lp /= 9.0; lpP /= 9.0;
    vec3 prv = texture2D(uPrevFrame, uv).rgb;
    vec3 prvHF = prv - lpP;
    // post's own LF base + previous frame's HF detail SHIFTED by 0.5px
    vec3 postLF = mix(post, lp, 0.5);
    vec3 swp = postLF + prvHF * (1.5 + uUcnvFX * 2.0);
    post = mix(post, clamp(swp, 0.0, 1.0), clamp(uUcnvFX, 0.0, 1.0));
  }
  // 4. GYSIN — Gabor-patch phosphene MULTIPLIED into post (not added as
  //    overlay). Each Gabor wavelet modulates post brightness AND hue,
  //    so the carrier directly distorts the image at pixel level.
  if (uGysinFX > 0.001) {
    vec3 g = vec3(0.0);
    for (int i = 0; i < 5; i++) {
      float fi = float(i);
      vec2 cp = vec2(hash(fi * 1.71 + 0.13), hash(fi * 2.31 + 0.27));
      cp += 0.12 * vec2(sin(uTime * 0.51 + fi * 1.3), cos(uTime * 0.73 + fi * 0.7));
      vec2 dd = uv - cp;
      float dist2 = dot(dd, dd);
      float env = exp(-dist2 * 35.0);
      float ang = fi * 1.2566;
      float carrier = sin((uv.x * 38.0) * cos(ang) + (uv.y * 38.0) * sin(ang) + uTime * 7.0 + fi);
      // each Gabor pushes a different channel
      vec3 chan = vec3(mod(fi, 3.0) < 0.5 ? 1.0 : 0.0,
                       mod(fi, 3.0) < 1.5 && mod(fi, 3.0) >= 0.5 ? 1.0 : 0.0,
                       mod(fi, 3.0) >= 1.5 ? 1.0 : 0.0);
      g += chan * env * carrier;
    }
    // multiplicative carrier — modulates post's own brightness/color
    vec3 mod_ = vec3(1.0) + g * (2.5 * uGysinFX);
    vec3 distorted = clamp(post * mod_, 0.0, 1.0);
    post = mix(post, distorted, clamp(uGysinFX, 0.0, 1.0));
  }
  // 5. ASENDORF — 2D vertical-band threshold sort applied to POST.
  //    Walk UP in uv-space until luma drops below adaptive threshold;
  //    keep brightest sample. Now operates on processed pipeline so it
  //    pixel-sorts whatever the previous FX did. Fixes inversion.
  if (uAsendorfFX > 0.001) {
    vec2 px = 1.0 / max(uResolution, vec2(1.0));
    float thresh = mix(0.55, 0.20, uAsendorfFX);
    vec3 brightest = post;
    float blum = lum(post);
    for (int i = 1; i <= 44; i++) {
      if (float(i) > 8.0 + uAsendorfFX * 36.0) break;
      vec3 s = texture2D(uCamera, uv - vec2(0.0, float(i) * px.y)).rgb;
      float sl = lum(s);
      if (sl < thresh) break;
      if (sl > blum) { brightest = s; blum = sl; }
    }
    // multiply post by brightest's color ratio for pixel-level corruption
    vec3 sortMul = mix(brightest, post * (brightest / max(post, vec3(0.05))), 0.5);
    post = mix(post, clamp(sortMul, 0.0, 1.0), clamp(uAsendorfFX, 0.0, 1.0));
  }
  // 6. JODI — bit cellular automaton on POST. Reads neighbors from prev
  //    frame in uv-space (mirrored), applies XOR rule, recombines with
  //    current post. Pixel-level destructive corruption.
  if (uJodiFX > 0.001) {
    vec2 px = 1.0 / max(uResolution, vec2(1.0));
    vec3 cN = texture2D(uPrevFrame, uv + vec2(0.0,  px.y)).rgb;
    vec3 cS = texture2D(uPrevFrame, uv - vec2(0.0,  px.y)).rgb;
    vec3 cE = texture2D(uPrevFrame, uv + vec2(px.x, 0.0)).rgb;
    vec3 cW = texture2D(uPrevFrame, uv - vec2(px.x, 0.0)).rgb;
    vec3 bN = step(0.5, cN); vec3 bS = step(0.5, cS);
    vec3 bE = step(0.5, cE); vec3 bW = step(0.5, cW);
    vec3 bC = step(0.5, post); // bit of CURRENT post, not prev
    vec3 sumN = bN + bS + bE + bW;
    vec3 hot = step(1.5, sumN);
    vec3 next = abs(bC - hot);
    // XOR the bit-result INTO post's own value (not replace)
    vec3 ca = abs(post - next * 0.5) + (post - bC) * 0.3;
    post = mix(post, clamp(ca, 0.0, 1.0), clamp(uJodiFX, 0.0, 1.0));
  }
  // 7. ARCANGEL — NES nametable scroll quantizes POST through tile
  //    palette. Tile lookup uses uv (mirrored). Quantization is on
  //    sampled tile's luma, then color is cross-multiplied with current
  //    post's hue so it stacks rather than overwrites.
  if (uArcangelFX > 0.001) {
    float tileSize = 8.0;
    vec2 res = max(uResolution, vec2(1.0));
    vec2 tilePix = floor(uv * res / tileSize);
    vec2 fineP = (uv * res - tilePix * tileSize) / tileSize;
    float fineX = fract(uTime * (0.3 + uArcangelFX * 1.5));
    vec2 srcTile = vec2(mod(tilePix.x + floor(uTime * 4.0), 32.0), tilePix.y);
    vec2 srcUv = (srcTile * tileSize + fineP * tileSize + vec2(fineX * tileSize, 0.0)) / res;
    srcUv = fract(srcUv);
    vec3 nes = texture2D(uCamera, srcUv).rgb;
    float lq = lum(nes);
    vec3 q;
    if      (lq < 0.25) q = vec3(0.05, 0.05, 0.10);
    else if (lq < 0.50) q = vec3(0.70, 0.20, 0.20);
    else if (lq < 0.75) q = vec3(0.20, 0.65, 0.30);
    else                q = vec3(0.95, 0.95, 0.85);
    // cross-multiply NES palette with current post (stacks visibly)
    vec3 nesMul = q * (0.4 + post * 1.6);
    post = mix(post, clamp(nesMul, 0.0, 1.0), clamp(uArcangelFX, 0.0, 1.0));
  }
  // 8. PAIK — magnetic dipole-field UV warp. Warp vector applied to
  //    uv-space sampling AND to post itself (chromatic separation).
  if (uPaikFX > 0.001) {
    vec2 dipole = vec2(0.5 + 0.32 * sin(uTime * 0.71), 0.5 + 0.32 * cos(uTime * 1.13));
    vec2 dd = uv - dipole;
    float r2 = dot(dd, dd) + 0.002;
    vec2 m = vec2(cos(uTime * 0.41), sin(uTime * 0.41));
    float dotDM = dot(dd, m);
    vec2 B = (3.0 * dotDM * dd - m * r2) / (r2 * r2 + 0.001);
    vec2 warp = clamp(B * 0.0018 * uPaikFX, vec2(-0.3), vec2(0.3));
    // chromatic dipole warp — RGB sampled at offset positions
    float wr = texture2D(uCamera, clamp(uv + warp * 1.2, 0.001, 0.999)).r;
    float wg = texture2D(uCamera, clamp(uv + warp * 0.8, 0.001, 0.999)).g;
    float wb = texture2D(uCamera, clamp(uv + warp * 0.4, 0.001, 0.999)).b;
    vec3 paik = vec3(wr, wg, wb);
    // multiplicative blend with post — magnet pulls colors out of pipeline
    vec3 magnetic = mix(paik, post * paik * 2.0, 0.4);
    post = mix(post, clamp(magnetic, 0.0, 1.0), clamp(uPaikFX, 0.0, 1.0));
  }
  // 9. FENTON — venetian-band SAD motion-vector swap. Search 5 horizontal
  //    offsets in prev frame (uv-space, mirrored); pick min SAD vs post.
  //    Replaces with motion-compensated history at pixel level.
  if (uFentonFX > 0.001) {
    vec2 px = 1.0 / max(uResolution, vec2(1.0));
    float bestSad = 1e9;
    vec3 bestC = post;
    for (int s = 0; s < 5; s++) {
      float sx = (float(s) - 2.0) * px.x * (4.0 + uFentonFX * 24.0);
      vec3 prv = texture2D(uPrevFrame, clamp(uv + vec2(sx, 0.0), 0.001, 0.999)).rgb;
      float sad = abs(post.r - prv.r) + abs(post.g - prv.g) + abs(post.b - prv.b);
      if (sad < bestSad) { bestSad = sad; bestC = prv; }
    }
    // additive ghost — best-match prev STACKS on post
    vec3 ghost = clamp(post + (bestC - post) * 1.4, 0.0, 1.0);
    post = mix(post, ghost, clamp(uFentonFX, 0.0, 1.0));
  }
  gl_FragColor = vec4(clamp(post, 0.0, 1.0), 1.0);
}
