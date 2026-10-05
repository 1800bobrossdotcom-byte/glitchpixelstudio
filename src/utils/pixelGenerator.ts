// =============================================================================
//  pixelGenerator.ts - v1.3.79
//  Procedural pattern engine for Spectra. Pure-pixel renderer; every style is
//  rasterised into a tiny ImageData then nearest-neighbor scaled to fill the
//  target canvas. Lifted out of SpectraApp.tsx so it can ALSO run inside a
//  Web Worker via OffscreenCanvas (see src/workers/pixelGenWorker.ts).
// =============================================================================

/* eslint-disable @typescript-eslint/no-explicit-any */

// Polymorphic canvas types — function works in both the browser main thread
// (HTMLCanvasElement) and inside a Web Worker (OffscreenCanvas).
export type GenCanvas = HTMLCanvasElement | OffscreenCanvas;
export type GenCtx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export type GenStyleId =
  | "BAYER" | "HALFT" | "MOSAIC" | "VORON" | "GRID"
  | "STRIP" | "CHECK" | "PLASMA" | "WAVES" | "RINGS"
  | "DOTS" | "ASCII" | "BRICK" | "HEX" | "ISO"
  | "RGBSP" | "NOISE" | "WORM" | "SHARDS" | "STAIR"
  | "CIRCS" | "CROSS" | "WEAVE" | "DIAMOND" | "GLITCH"
  | "TRUCH" | "BAY8" | "STACK" | "FLOWL" | "RIBON" | "ORBIT"
  | "PLIFE" | "DLAUN" | "BOIDS" | "REACT" | "LSYST"
  | "SDF3D" | "SDLAT" | "SDTOR" | "SDFRC";

export type GenParams = {
  style: GenStyleId;
  resolution: number;     // base cells per shorter axis
  density: number;        // 0..1 fill weight
  scale: number;          // 0.25..4 pattern scale
  speed: number;          // 0..3 animation speed
  hue: number;            // 0..1 base hue
  hueSpread: number;      // 0..1 palette hue range
  sat: number;            // 0..1 saturation
  contrast: number;       // 0..1
  warp: number;           // 0..1 domain warp
  jitter: number;         // 0..1 per-cell randomness
  seed: number;           // integer
  invert: boolean;
  time: number;           // animation phase
  motionX: number;        // -1..1 accelerometer tilt / sway
  motionY: number;        // -1..1 accelerometer tilt / sway
  depthPush: number;      // 0..1 forward thrust / punch
  // ── Per-layer datamosh blend movement (optional, default 0) ──
  moshX?: number;         // -1..1 sustained X-axis pixel shear/displace
  moshY?: number;         // -1..1 sustained Y-axis pixel shear/displace
  scatter?: number;       // 0..1 sustained scatter intensity (knob)
  scatterMode?: number;   // 0=SHIFT row-shift, 1=BURST radial, 2=SHRED column tear, 3=FREEZE hold
  scatterPulse?: number;  // 0..1 transient pulse amount (decays per frame, on top of scatter)
  // ── v1.3.25 — TYPOGRAPHIC FINISHER (Gysin / Asendorf inspired) ──
  // 0 OFF, 1 CHARS (.:-=+*#%@ Gysin ramp), 2 BLOCKS (░▒▓█),
  // 3 BRAILLE (⠁⠃⠇⠧⠿⣿), 4 SHADES (▁▂▃▄▅▆▇█), 5 EDGES (─│╱╲ on edges only).
  glyphMode?: number;
};

// v1.3.25 — typographic finisher glyph ramps (light → dark).
const _GLYPH_RAMPS: ReadonlyArray<readonly string[]> = [
  [], // 0 OFF
  [" ", ".", ":", "-", "=", "+", "*", "#", "%", "@"],          // 1 CHARS
  [" ", "░", "▒", "▓", "█"],                                    // 2 BLOCKS
  [" ", "⠁", "⠃", "⠇", "⠧", "⠷", "⠿", "⣿"],                    // 3 BRAILLE
  [" ", "▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"],                // 4 SHADES
  ["─", "│", "╱", "╲"],                                          // 5 EDGES (4 directions)
];
const _GLYPH_LABELS = ["OFF","CHARS","BLOCKS","BRAILLE","SHADES","EDGES"] as const;

// fast deterministic hash → [0,1)
function _h2(x: number, y: number, s: number): number {
  let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  h = h ^ (h >>> 16);
  return ((h >>> 0) % 100000) / 100000;
}
function _hsl(h: number, s: number, l: number, _ctx?: GenCtx2D): string {
  // wrap hue
  const hh = ((h % 1) + 1) % 1;
  return `hsl(${(hh * 360).toFixed(1)} ${(s * 100).toFixed(1)}% ${(l * 100).toFixed(1)}%)`;
  void _ctx;
}

// ── Persistent generator state (keyed by canvas element) ─────────────────────
type _PLIFEState = { data: Float32Array; n: number; hash: number };
type _BOIDSState = { data: Float32Array; n: number; hash: number };
type _REACTState = { u: Float32Array; v: Float32Array; gw: number; gh: number; hash: number };
type _GenStateCache = {
  plife?: _PLIFEState;
  boids?: _BOIDSState;
  react?: _REACTState;
  evo?: number;
};
const _gsc = new WeakMap<GenCanvas, _GenStateCache>();
function _gscGet(c: GenCanvas): _GenStateCache {
  let s = _gsc.get(c); if (!s) { s = {}; _gsc.set(c, s); } return s;
}

// Bowyer-Watson Delaunay triangulation
// pts: interleaved Float32Array [x0,y0, x1,y1, ...], n = point count
// Returns flat array of vertex-index triples [a,b,c, ...]
function _bowyer(pts: Float32Array, n: number): number[] {
  if (n < 3) return [];
  let mnX = pts[0], mxX = pts[0], mnY = pts[1], mxY = pts[1];
  for (let i = 1; i < n; i++) {
    if (pts[i*2]   < mnX) mnX = pts[i*2];   if (pts[i*2]   > mxX) mxX = pts[i*2];
    if (pts[i*2+1] < mnY) mnY = pts[i*2+1]; if (pts[i*2+1] > mxY) mxY = pts[i*2+1];
  }
  const dM = Math.max(mxX - mnX, mxY - mnY) * 3 + 1;
  const mX = (mnX + mxX) / 2, mY = (mnY + mxY) / 2;
  const si0 = n, si1 = n + 1, si2 = n + 2;
  const allX = new Float32Array(n + 3); const allY = new Float32Array(n + 3);
  for (let i = 0; i < n; i++) { allX[i] = pts[i*2]; allY[i] = pts[i*2+1]; }
  allX[si0] = mX - 2*dM; allY[si0] = mY - dM;
  allX[si1] = mX;         allY[si1] = mY + 2*dM;
  allX[si2] = mX + 2*dM; allY[si2] = mY - dM;
  let tris: number[] = [si0, si1, si2];
  for (let pi = 0; pi < n; pi++) {
    const qx = allX[pi], qy = allY[pi];
    const bad: number[] = [];
    for (let ti = 0; ti < tris.length; ti += 3) {
      const a = tris[ti], b = tris[ti+1], c = tris[ti+2];
      const ax = allX[a], ay = allY[a], bx = allX[b], by = allY[b], cx = allX[c], cy = allY[c];
      const D = 2 * (ax*(by - cy) + bx*(cy - ay) + cx*(ay - by));
      if (Math.abs(D) < 1e-8) continue;
      const ux = ((ax*ax+ay*ay)*(by-cy) + (bx*bx+by*by)*(cy-ay) + (cx*cx+cy*cy)*(ay-by)) / D;
      const uy = ((ax*ax+ay*ay)*(cx-bx) + (bx*bx+by*by)*(ax-cx) + (cx*cx+cy*cy)*(bx-ax)) / D;
      const r2 = (ax-ux)*(ax-ux) + (ay-uy)*(ay-uy);
      if ((qx-ux)*(qx-ux) + (qy-uy)*(qy-uy) <= r2 + 1e-8) bad.push(ti);
    }
    const eCnt = new Map<number, number>();
    for (const ti of bad) {
      const a = tris[ti], b = tris[ti+1], c = tris[ti+2];
      for (const [e0, e1] of ([[a,b],[b,c],[c,a]] as [number,number][])) {
        const ek = e0 < e1 ? e0*1000 + e1 : e1*1000 + e0;
        eCnt.set(ek, (eCnt.get(ek) || 0) + 1);
      }
    }
    const badSet = new Set(bad);
    const nt: number[] = [];
    for (let ti = 0; ti < tris.length; ti += 3)
      if (!badSet.has(ti)) nt.push(tris[ti], tris[ti+1], tris[ti+2]);
    for (const [ek, cnt] of eCnt)
      if (cnt === 1) nt.push(Math.floor(ek / 1000), ek % 1000, pi);
    tris = nt;
  }
  const res: number[] = [];
  for (let ti = 0; ti < tris.length; ti += 3) {
    const a = tris[ti], b = tris[ti+1], c = tris[ti+2];
    if (a < n && b < n && c < n) res.push(a, b, c);
  }
  return res;
}

export function drawPixelGenerator(canvas: GenCanvas, p: GenParams): void {
  const W = canvas.width, H = canvas.height;
  if (W < 4 || H < 4) return;
  // The two getContext('2d') overloads return distinct nominal types in TS
  // even though every API surface used below is shared. Cast to a single
  // alias so the rest of the function compiles unchanged.
  const ctx = (canvas as HTMLCanvasElement).getContext("2d") as GenCtx2D | null;
  if (!ctx) return;

  const seed = (p.seed | 0) || 1;
  // Pure-pixel renderer. Every style is rasterised into a tiny ImageData
  // then scaled up with imageSmoothingEnabled = false. No paths, no arcs,
  // no rectangles drawn over the field — only colored pixels in a grid.
  // v1.3.24 — SCALE knob now drives cell size (bigger SCALE = chunkier
  // pixels). Earlier the knob only modulated per-family noise zoom by
  // ~25 % and the user reported "nothing visible". Routing it through
  // the cell count makes the change instantly readable.
  const baseCells = Math.max(8, Math.min(220, Math.round(p.resolution)));
  const _scaleK = Math.max(0.25, Math.min(4, p.scale || 1));
  const cells = Math.max(8, Math.min(220, Math.round(baseCells / _scaleK)));
  const short = Math.min(W, H);
  const cell = Math.max(2, Math.floor(short / cells));
  const gw = Math.max(8, Math.ceil(W / cell));
  const gh = Math.max(8, Math.ceil(H / cell));

  // Style → algorithm family + variant + per-style modifiers. Each of the
  // 35 style names produces a visibly distinct look even when sharing a
  // family by nudging hue, scale, density, contrast, speed, etc.
  // Families: 0 Cellular Automata, 1 Reaction-Diffusion, 2 Geometric Flow,
  // 3 Pixel Patterns (dither), 4 Fractal Escape.
  const style = p.style;
  // [family, variant, hueShift, scaleMul, densityAdd, contrastAdd, speedMul, warpAdd]
  type StyleSpec = readonly [number, number, number, number, number, number, number, number];
  // Every style maps to a UNIQUE (family, variant) slot so no two look alike.
  // Hue/scale/density/contrast/speed/warp are then tuned per-style within the
  // slot to push the look further apart from any neighbour sharing a family.
  const STYLE_SPECS: Record<string, StyleSpec> = {
    // ── family 0 — Cellular Automata (4 distinct rule sets) ──────────
    PLIFE:   [0, 0,  0.00, 1.00,  0.00, 0.00, 1.00, 0.00], // Conway B3/S23
    WAVES:   [0, 1,  0.55, 1.20,  0.00, 0.00, 0.90, 0.00], // HighLife B36/S23 — wave-like blobs
    CHECK:   [0, 2,  0.00, 0.80,  0.00, 0.30, 1.10, 0.00], // Day&Night — high-contrast checker fields
    LSYST:   [0, 3,  0.78, 0.60,  0.10, 0.00, 1.40, 0.00], // Seeds — sparse twinkle
    // ── family 1 — Reaction-Diffusion (3 Gray-Scott presets) ─────────
    REACT:   [1, 0,  0.30, 1.00,  0.00, 0.00, 1.00, 0.00], // mitosis
    MOSAIC:  [1, 1,  0.08, 0.90,  0.10, 0.10, 0.80, 0.05], // coral
    PLASMA:  [1, 2,  0.92, 1.10, -0.05,-0.05, 1.20, 0.10], // u-skate (flowing plasma)
    // ── family 2 — Geometric flow waves (4 distinct wave maths) ──────
    RIBON:   [2, 0,  0.50, 1.10,  0.00, 0.00, 1.00, 0.10], // sin·cos product
    ORBIT:   [2, 1,  0.60, 0.95,  0.05,-0.05, 0.90, 0.30], // warp curl
    STAIR:   [2, 2,  0.72, 0.80, -0.10, 0.10, 0.85, 0.00], // polar rings
    STACK:   [2, 3,  0.84, 1.40,  0.05, 0.00, 0.75, 0.00], // mixed radial
    // ── family 3 — Pixel patterns / dither (4 distinct masks) ────────
    BAYER:   [3, 0,  0.32, 1.00,  0.00, 0.00, 1.00, 0.00], // Bayer8 dither (the canonical one)
    BAY8:    [3, 1,  0.20, 1.50, -0.05, 0.10, 0.85, 0.00], // chunky cell-Bayer (visibly bigger pixels)
    BRICK:   [3, 2,  0.05, 1.20,  0.00, 0.05, 0.70, 0.00], // brick mask
    STRIP:   [3, 3,  0.45, 1.30,  0.10, 0.00, 1.10, 0.00], // wobble stripe
    // ── family 4 — Fractal escape (Mandelbrot 0,1 / Julia 2,3) ───────
    RINGS:   [4, 0,  0.12, 1.30, -0.05, 0.05, 0.90, 0.05], // Mandelbrot — ringed escape
    CIRCS:   [4, 1,  0.50, 0.70,  0.00, 0.10, 1.20, 0.10], // Mandelbrot — zoomed circle clusters
    SHARDS:  [4, 2,  0.75, 1.00,  0.05, 0.10, 1.10, 0.20], // Julia A — shard-like
    CROSS:   [4, 3,  0.05, 1.50, -0.10, 0.00, 0.85, 0.30], // Julia B — cross-fractal
    // ── family 5 — Pixel sort (row / col / diag / alt-row) ───────────
    // (WORM lives on family 6 — see flow-field block — it was always meant to
    //  be a silky curl-noise trail, not a row-sort band.)
    WEAVE:   [5, 1,  0.40, 1.10,  0.00, 0.15, 0.95, 0.00], // col sort — vertical weave
    FLOWL:   [5, 2,  0.55, 0.90,  0.05, 0.05, 1.05, 0.10], // diag sort — flowing diag streaks
    RGBSP:   [5, 3,  0.85, 1.20, -0.05, 0.10, 1.10, 0.00], // alt-row sort — rgb-split feel
    // ── family 6 — Flow field particles (4 fade speeds) ──────────────
    WORM:    [6, 1,  0.04, 0.80,  0.10, 0.00, 0.85, 0.00], // restored — long-fade flow-field, wormy silky trails
    BOIDS:   [6, 0,  0.18, 1.00,  0.10, 0.05, 1.10, 0.00], // short fade — bursty
    DLAUN:   [6, 1,  0.40, 1.20,  0.00, 0.10, 0.85, 0.00], // very long fade — silky lines
    NOISE:   [6, 2,  0.66, 0.90,  0.05,-0.05, 0.95, 0.00], // medium fade — noisy field
    DIAMOND: [6, 3,  0.92, 0.80, -0.05, 0.10, 1.00, 0.00], // medium fade variant — diamond traces
    // ── family 7 — Voronoi / Worley (cell / F1 / F2 / hex) ───────────
    VORON:   [7, 0,  0.62, 1.00, -0.05, 0.05, 0.90,-0.05], // cell-color
    DOTS:    [7, 1,  0.88, 0.70, -0.10, 0.20, 0.95, 0.00], // F1 distance — dot blobs
    HALFT:   [7, 2,  0.10, 0.80,  0.00, 0.25, 0.90, 0.00], // F2-F1 edges — halftone-dot net
    HEX:     [7, 3,  0.30, 1.30,  0.00, 0.10, 0.95, 0.00], // hex-lattice sites
    // ── family 8 — Truchet tiles (diag / arcs / large / mixed) ───────
    TRUCH:   [8, 0,  0.55, 0.80,  0.05, 0.00, 1.15, 0.00], // diagonal truchet
    GRID:    [8, 1,  0.46, 1.00,  0.00, 0.10, 0.90, 0.00], // arc truchet — looks like circular grid
    ISO:     [8, 2,  0.20, 1.50,  0.05, 0.00, 1.00, 0.00], // large 2T diag — iso-ish
    // ── family 9 — Databend / glitch (full / RGB-split / blocks / shift)
    GLITCH:  [9, 0,  0.56, 1.20, -0.05, 0.20, 1.30, 0.20], // full glitch
    ASCII:   [9, 2,  0.34, 0.95,  0.00, 0.30, 1.05, 0.00], // block corruption only — ASCII-block mosaic feel
    // ── family 10 — SDF raymarched 3D (hg_sdf-inspired) ────────────
    // 0=union of primitives 1=lattice repetition 2=torus knot 3=fractal
    SDF3D:   [10, 0,  0.62, 1.00,  0.00, 0.10, 0.90, 0.00],
    SDLAT:   [10, 1,  0.45, 1.00,  0.00, 0.10, 0.85, 0.00],
    SDTOR:   [10, 2,  0.88, 1.00,  0.00, 0.10, 1.00, 0.00],
    SDFRC:   [10, 3,  0.10, 1.00,  0.00, 0.20, 0.80, 0.00],
  };
  const spec: StyleSpec = STYLE_SPECS[style] ?? [3, 0, 0, 1, 0, 0, 1, 0];
  const family = spec[0];
  const variant = spec[1];
  const styleHueShift = spec[2];
  const styleScaleMul = spec[3];
  const styleDensityAdd = spec[4];
  const styleContrastAdd = spec[5];
  const styleSpeedMul = spec[6];
  const styleWarpAdd = spec[7];

  // Persistent grid state per canvas (CA & reaction-diffusion).
  type GridState = {
    w: number; h: number; hash: number;
    a: Float32Array; b: Float32Array;
  };
  // Persistent particle system for flow-field family (curl-noise advected
  // particles deposit into a fading trail buffer — Nature-of-Code style).
  type FlowState = {
    px: Float32Array; py: Float32Array; ph: Float32Array; pa: Float32Array;
    n: number; trail: Float32Array; tw: number; th: number; hash: number;
  };
  // Persistent Voronoi sites for family 7 (drift each frame; F1/F2 fields).
  type SiteState = {
    sx: Float32Array; sy: Float32Array;
    svx: Float32Array; svy: Float32Array; sh: Float32Array;
    n: number; hash: number;
  };
  const gsc = _gscGet(canvas) as _GenStateCache & {
    grid?: GridState; off?: HTMLCanvasElement;
    flow?: FlowState; sites?: SiteState;
  };
  const stateHash = (family * 1000003) ^ (variant * 977) ^ (seed * 31) ^ (gw * 7919) ^ (gh * 6151);
  if (!gsc.grid || gsc.grid.w !== gw || gsc.grid.h !== gh || gsc.grid.hash !== stateHash) {
    const a = new Float32Array(gw * gh);
    const b = new Float32Array(gw * gh);
    for (let i = 0; i < a.length; i++) {
      const r = _h2(i, family * 17 + variant, seed);
      if (family === 0) {
        a[i] = r < 0.30 ? 1 : 0;
      } else if (family === 1) {
        a[i] = 1;
        b[i] = (r < 0.05) ? 1 : 0;
      } else {
        a[i] = r;
      }
    }
    gsc.grid = { w: gw, h: gh, hash: stateHash, a, b };
  }
  const grid = gsc.grid;

  const speed   = Math.max(0.001, p.speed * styleSpeedMul);
  const tAnim   = p.time * speed;
  // Per-layer mosh axes are added to global accelerometer motion. They drive
  // the same advX/advY plumbing the renderer already uses, so a layer with
  // moshX=+1 visibly drifts/shears right while neighbouring layers stay put.
  const mx      = (p.motionX || 0) + (p.moshX || 0);
  const my      = (p.motionY || 0) + (p.moshY || 0);
  const push    = Math.max(0, Math.min(1, p.depthPush || 0));
  const warp    = Math.max(0, Math.min(1, p.warp + styleWarpAdd));

  // ── Per-style directionality (organic / infinite flow) ──────────────
  // Direction is the SUM of multiple incommensurate sines so the angle
  // wanders without ever repeating, instead of rotating linearly. Each
  // style still gets its own phase from styleHueShift+variant+seed so
  // neighbouring layers diverge. advX/advY are also driven by multi-octave
  // LFOs so position drifts on a fluid path rather than a straight line.
  // An EVOLUTIONARY phase (period ~minutes) slow-modulates each base
  // phase, so the character of the motion itself drifts over time and a
  // 30-second clip never replays the same micropattern.
  const evoPh = tAnim * 0.0037 + variant * 0.91;
  const evo1 = Math.sin(evoPh)         * 1.7;
  const evo2 = Math.cos(evoPh * 0.618) * 1.3;
  const ph0 = styleHueShift * Math.PI * 4 + variant * 1.27 + (seed % 17) * 0.37 + evo1;
  const ph1 = ph0 * 1.618 + 1.91 + evo2;
  const ph2 = ph0 * 0.382 + 4.27 - evo1 * 0.6;
  const ph3 = ph0 * 2.414 + 2.55 + evo2 * 0.4;
  const dirAngle  = ph0
                  + Math.sin(tAnim * 0.063 + ph1) * 1.6
                  + Math.cos(tAnim * 0.029 + ph2) * 1.1
                  + Math.sin(tAnim * 0.011 + ph3) * 0.7;
  const dCos      = Math.cos(dirAngle);
  const dSin      = Math.sin(dirAngle);
  // Multi-octave drift for advection — never accumulates (no straight line).
  const driftAx = Math.sin(tAnim * 0.13 + ph1) * 6.0
                + Math.cos(tAnim * 0.071 + ph2) * 3.5
                + Math.sin(tAnim * 0.031 + ph3) * 2.0;
  const driftAy = Math.cos(tAnim * 0.117 + ph2) * 6.0
                + Math.sin(tAnim * 0.083 + ph3) * 3.5
                + Math.cos(tAnim * 0.027 + ph1) * 2.0;
  const advX      = dCos * 1.4 + driftAx + mx * 2.0;
  const advY      = dSin * 1.4 + driftAy + my * 2.0;
  // Curl phase wanders too — adds bend that rotates direction over time.
  const curlPh    = tAnim * 0.9 + styleHueShift * 6.28
                  + Math.sin(tAnim * 0.041 + ph2) * 2.3;
  const curlAmp   = 0.8 + warp * 2.0 + push * 0.6
                  + Math.abs(Math.sin(tAnim * 0.019 + ph3)) * 0.6;
  const jitter  = p.jitter;
  const density = Math.max(0, Math.min(1, p.density + styleDensityAdd));
  const scale   = Math.max(0.05, p.scale * styleScaleMul);
  const contrast = Math.max(0, Math.min(1, p.contrast + styleContrastAdd));
  const sat     = p.sat;
  const hue     = p.hue + styleHueShift;
  const spread  = p.hueSpread;
  void _hsl; void _bowyer;

  // ── Step Cellular Automata ───────────────────────────────────────────
  if (family === 0) {
    const src = grid.a, dst = grid.b;
    // 0=Conway B3/S23, 1=HighLife B36/S23, 2=Day&Night B3678/S34678, 3=Seeds B2/S
    const birthSets = [
      [false,false,false,true,false,false,false,false,false],
      [false,false,false,true,false,false,true,false,false],
      [false,false,false,true,false,false,true,true,true],
      [false,false,true,false,false,false,false,false,false],
    ];
    const survSets = [
      [false,false,true,true,false,false,false,false,false],
      [false,false,true,true,false,false,false,false,false],
      [false,false,false,true,true,false,true,true,true],
      [false,false,false,false,false,false,false,false,false],
    ];
    const birth = birthSets[variant];
    const surv  = survSets[variant];
    const mut = jitter * 0.0006;
    const tBin = (tAnim * 60) | 0;
    for (let y = 0; y < gh; y++) {
      const ym = (y - 1 + gh) % gh, yp = (y + 1) % gh;
      const rowY = y * gw, rowM = ym * gw, rowP = yp * gw;
      for (let x = 0; x < gw; x++) {
        const xm = (x - 1 + gw) % gw, xp = (x + 1) % gw;
        const n =
          (src[rowM+xm] + src[rowM+x] + src[rowM+xp] +
           src[rowY+xm]               + src[rowY+xp] +
           src[rowP+xm] + src[rowP+x] + src[rowP+xp]) | 0;
        const alive = src[rowY+x] > 0.5;
        let next = alive ? (surv[n] ? 1 : 0) : (birth[n] ? 1 : 0);
        if (mut > 0 && _h2(x, y, tBin) < mut) next = 1 - next;
        dst[rowY+x] = next;
      }
    }
    if (push > 0.05) {
      const N = (push * gw * gh * 0.012) | 0;
      for (let k = 0; k < N; k++) {
        const x = (_h2(k, 71, tBin) * gw) | 0;
        const y = (_h2(71, k, tBin) * gh) | 0;
        dst[y*gw+x] = 1;
      }
    }
    grid.a = dst; grid.b = src;
  }

  // ── Step Reaction-Diffusion (Gray-Scott) ─────────────────────────────
  if (family === 1) {
    const u = grid.a, v = grid.b;
    const presets = [
      { f: 0.0367, k: 0.0649 },
      { f: 0.0290, k: 0.0570 },
      { f: 0.0545, k: 0.0620 },
      { f: 0.0220, k: 0.0510 },
    ];
    const pr = presets[variant];
    const F = pr.f + warp * 0.004;
    const K = pr.k + spread * 0.003;
    const Du = 1.0, Dv = 0.5;
    const dt = 0.6 + speed * 0.4;
    const nu = new Float32Array(u.length);
    const nv = new Float32Array(v.length);
    for (let y = 0; y < gh; y++) {
      const ym = (y - 1 + gh) % gh, yp = (y + 1) % gh;
      const rowY = y * gw, rowM = ym * gw, rowP = yp * gw;
      for (let x = 0; x < gw; x++) {
        const xm = (x - 1 + gw) % gw, xp = (x + 1) % gw;
        const i = rowY + x;
        const lapU = u[rowM+x]+u[rowP+x]+u[rowY+xm]+u[rowY+xp] - 4*u[i];
        const lapV = v[rowM+x]+v[rowP+x]+v[rowY+xm]+v[rowY+xp] - 4*v[i];
        const uvv = u[i]*v[i]*v[i];
        nu[i] = u[i] + dt * (Du*lapU - uvv + F*(1-u[i]));
        nv[i] = v[i] + dt * (Dv*lapV + uvv - (F+K)*v[i]);
      }
    }
    for (let i = 0; i < u.length; i++) { u[i] = nu[i]; v[i] = nv[i]; }
    if (jitter > 0) {
      const tBin = (tAnim * 30) | 0;
      const N = (jitter * gw * gh * 0.001) | 0;
      for (let k = 0; k < N; k++) {
        const x = (_h2(k, 23, tBin) * gw) | 0;
        const y = (_h2(23, k, tBin) * gh) | 0;
        v[y*gw+x] = 1;
      }
    }
  }

  // ── ImageData buffer on small offscreen ──────────────────────────────
  let off = gsc.off;
  if (!off || off.width !== gw || off.height !== gh) {
    off = document.createElement("canvas");
    off.width = gw; off.height = gh;
    gsc.off = off;
  }
  const offCtx = off.getContext("2d");
  if (!offCtx) return;
  const img = offCtx.createImageData(gw, gh);
  const buf = new Uint32Array(img.data.buffer);

  // HSL → RGBA (little-endian 0xAABBGGRR for canvas ImageData).
  const hsl2rgba = (h0: number, s0: number, l0: number): number => {
    const hh = ((h0 % 1) + 1) % 1;
    const ss = Math.max(0, Math.min(1, s0));
    const ll = Math.max(0, Math.min(1, l0));
    const c = (1 - Math.abs(2*ll - 1)) * ss;
    const x = c * (1 - Math.abs(((hh*6) % 2) - 1));
    const m = ll - c/2;
    let r = 0, g = 0, b = 0;
    if (hh < 1/6)      { r = c; g = x; b = 0; }
    else if (hh < 2/6) { r = x; g = c; b = 0; }
    else if (hh < 3/6) { r = 0; g = c; b = x; }
    else if (hh < 4/6) { r = 0; g = x; b = c; }
    else if (hh < 5/6) { r = x; g = 0; b = c; }
    else               { r = c; g = 0; b = x; }
    const R = (((r+m)*255) | 0) & 0xff;
    const G = (((g+m)*255) | 0) & 0xff;
    const B = (((b+m)*255) | 0) & 0xff;
    return 0xff000000 | (B << 16) | (G << 8) | R;
  };

  // 256-entry value→RGBA palette LUT (rebuilt each frame).
  const lumLow = p.invert ? 0.92 : 0.06;
  const lumHi  = p.invert ? 0.06 : 0.92;
  const cKey = 0.4 + contrast * 1.4;
  const PAL = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    const vv = i / 255;
    const sig = 1 / (1 + Math.exp(-(vv - 0.5) * cKey * 6));
    const lum = lumLow + (lumHi - lumLow) * sig;
    const h = hue + (sig - 0.5) * spread;
    PAL[i] = hsl2rgba(h, sat, lum);
  }
  const palIdx = (v: number): number => {
    if (v <= 0) return 0;
    if (v >= 1) return 255;
    return (v * 255) | 0;
  };

  // ════════════════════════════════════════════════════════════════════
  // Per-STYLE unique kernels. Each named style has its OWN render path —
  // no two styles share a kernel. If the style isn't matched here, fall
  // through to the legacy family render (kept as a safety net only).
  // Common locals already in scope: gw,gh,buf,PAL,palIdx,hsl2rgba,
  // hue,sat,spread,contrast,density,scale,jitter,push,warp,advX,advY,
  // curlPh,curlAmp,tAnim,seed,mx,my.
  // ════════════════════════════════════════════════════════════════════
  let handled = false;
  {
    // Common base motion field used by many kernels (multi-octave drift).
    const sc = 0.06 + scale * 0.10;
    const ph = tAnim * 0.6;
    const fieldAt = (x: number, y: number) => {
      const xn = (x - gw/2) * sc + advX * 0.4;
      const yn = (y - gh/2) * sc + advY * 0.4;
      const wx = xn + Math.sin(yn * 0.7 + curlPh) * curlAmp * 0.5;
      const wy = yn + Math.cos(xn * 0.7 - curlPh * 0.6) * curlAmp * 0.5;
      const f = Math.sin(wx + ph) * 0.45
              + Math.cos(wy * 1.2 - ph * 0.7) * 0.30
              + Math.sin((wx + wy) * 0.6 + ph * 0.4) * 0.25;
      return Math.max(0, Math.min(1, f * 0.5 + 0.5));
    };
    const fillBg = (lum: number) => {
      const c = PAL[palIdx(lum)];
      for (let i = 0; i < buf.length; i++) buf[i] = c;
    };

    switch (style) {
      // ── BAYER : classic 8×8 ordered dither of the field ────────────
      case "BAYER": {
        const M8 = [
           0,32, 8,40, 2,34,10,42,
          48,16,56,24,50,18,58,26,
          12,44, 4,36,14,46, 6,38,
          60,28,52,20,62,30,54,22,
           3,35,11,43, 1,33, 9,41,
          51,19,59,27,49,17,57,25,
          15,47, 7,39,13,45, 5,37,
          63,31,55,23,61,29,53,21,
        ];
        for (let y = 0; y < gh; y++) {
          for (let x = 0; x < gw; x++) {
            const v = fieldAt(x, y);
            const t = (M8[(y & 7) * 8 + (x & 7)] + 0.5) / 64;
            buf[y*gw + x] = v > t ? PAL[255] : PAL[0];
          }
        }
        handled = true; break;
      }
      // ── BAY8 : chunky 4×4 ordered dither (visibly bigger pixels) ───
      case "BAY8": {
        const M4 = [ 0, 8, 2,10, 12, 4,14, 6, 3,11, 1, 9, 15, 7,13, 5 ];
        const cell = 3;
        for (let y = 0; y < gh; y++) {
          for (let x = 0; x < gw; x++) {
            const cx = (x / cell) | 0, cy = (y / cell) | 0;
            const v = fieldAt(cx * cell, cy * cell);
            const t = (M4[(cy & 3) * 4 + (cx & 3)] + 0.5) / 16;
            buf[y*gw + x] = v > t ? PAL[230] : PAL[20];
          }
        }
        handled = true; break;
      }
      // ── HALFT : CMY-rotated halftone dot screens (per-channel angle) ─
      case "HALFT": {
        const dotSize = Math.max(3, Math.round(4 + (1 - density) * 6));
        const angles = [Math.PI*0.083, Math.PI*0.417, Math.PI*0.25];
        const cosA = angles.map(a => Math.cos(a));
        const sinA = angles.map(a => Math.sin(a));
        for (let y = 0; y < gh; y++) {
          for (let x = 0; x < gw; x++) {
            const v = fieldAt(x, y);
            let R = 0, G = 0, B = 0;
            for (let c = 0; c < 3; c++) {
              const u =  cosA[c] * x + sinA[c] * y;
              const w = -sinA[c] * x + cosA[c] * y;
              const cx = (u % dotSize + dotSize) % dotSize - dotSize/2;
              const cy = (w % dotSize + dotSize) % dotSize - dotSize/2;
              const r2 = cx*cx + cy*cy;
              const radius = (1 - v) * dotSize * 0.55;
              const on = r2 < radius * radius ? 0 : 255;
              if (c === 0) R = on;
              else if (c === 1) G = on;
              else B = on;
            }
            buf[y*gw + x] = 0xff000000 | (B << 16) | (G << 8) | R;
          }
        }
        handled = true; break;
      }
      // ── MOSAIC : large drifting voronoi cells, hue per cell ────────
      case "MOSAIC": {
        const N = Math.max(8, Math.round(10 + density * 30));
        const sx = new Float32Array(N), sy = new Float32Array(N), sh = new Float32Array(N);
        for (let i = 0; i < N; i++) {
          sx[i] = (_h2(i, 1, seed) * gw + advX * (0.5 + (i % 3) * 0.2)) % gw;
          sy[i] = (_h2(i, 2, seed) * gh + advY * (0.4 + (i % 4) * 0.15)) % gh;
          if (sx[i] < 0) sx[i] += gw; if (sy[i] < 0) sy[i] += gh;
          sh[i] = _h2(i, 5, seed);
        }
        for (let y = 0; y < gh; y++) {
          for (let x = 0; x < gw; x++) {
            let best = 1e18, bi = 0;
            for (let i = 0; i < N; i++) {
              const dx = x - sx[i], dy = y - sy[i];
              const d = dx*dx + dy*dy;
              if (d < best) { best = d; bi = i; }
            }
            const h = ((hue + (sh[bi] - 0.5) * spread * 2) % 1 + 1) % 1;
            buf[y*gw + x] = hsl2rgba(h, sat, 0.35 + sh[bi] * 0.45);
          }
        }
        handled = true; break;
      }
      // ── VORON : small voronoi cells, distance shaded ───────────────
      case "VORON": {
        const N = Math.max(20, Math.round(40 + density * 100));
        const sx = new Float32Array(N), sy = new Float32Array(N), sh = new Float32Array(N);
        for (let i = 0; i < N; i++) {
          sx[i] = ((_h2(i, 1, seed) * gw + advX * 0.8) % gw + gw) % gw;
          sy[i] = ((_h2(i, 2, seed) * gh + advY * 0.8) % gh + gh) % gh;
          sh[i] = _h2(i, 5, seed);
        }
        for (let y = 0; y < gh; y++) {
          for (let x = 0; x < gw; x++) {
            let f1 = 1e18, bi = 0;
            for (let i = 0; i < N; i++) {
              const dx = x - sx[i], dy = y - sy[i];
              const d = dx*dx + dy*dy;
              if (d < f1) { f1 = d; bi = i; }
            }
            const v = 1 - Math.min(1, Math.sqrt(f1) / Math.max(gw, gh) * 4);
            const h = ((hue + (sh[bi] - 0.5) * spread) % 1 + 1) % 1;
            buf[y*gw + x] = hsl2rgba(h, sat, 0.15 + v * 0.7);
          }
        }
        handled = true; break;
      }
      // ── GRID : crisp orthogonal grid lines on dark, drifting ───────
      case "GRID": {
        const cellSz = Math.max(4, Math.round(6 + (1 - density) * 14));
        const lineW = Math.max(1, Math.round(cellSz * 0.18));
        fillBg(0.06);
        const ox = (advX * 1.5) | 0, oy = (advY * 1.5) | 0;
        for (let y = 0; y < gh; y++) {
          const yy = ((y + oy) % cellSz + cellSz) % cellSz;
          const onY = yy < lineW;
          for (let x = 0; x < gw; x++) {
            const xx = ((x + ox) % cellSz + cellSz) % cellSz;
            if (onY || xx < lineW) {
              const cx = ((x + ox) / cellSz) | 0, cy = ((y + oy) / cellSz) | 0;
              const h = ((hue + (cx * 0.07 + cy * 0.13 + tAnim * 0.05)) % 1 + 1) % 1;
              buf[y*gw + x] = hsl2rgba(h, sat, 0.7);
            }
          }
        }
        handled = true; break;
      }
      // ── STRIP : horizontal color stripes drifting at different rates
      case "STRIP": {
        const bandH = Math.max(2, Math.round(3 + (1 - density) * 8));
        for (let y = 0; y < gh; y++) {
          const band = (y / bandH) | 0;
          const drift = advX * (0.5 + (band % 5) * 0.2) + tAnim * (0.3 + (band % 7) * 0.1);
          const phase = band * 0.37 + tAnim * 0.2;
          const h = ((hue + Math.sin(phase) * spread + band * 0.05) % 1 + 1) % 1;
          for (let x = 0; x < gw; x++) {
            const v = 0.5 + 0.5 * Math.sin((x + drift) * 0.25 + phase);
            buf[y*gw + x] = hsl2rgba(h, sat, 0.25 + v * 0.55);
          }
        }
        handled = true; break;
      }
      // ── CHECK : large 2-color checkerboard, rotating hue pair ──────
      case "CHECK": {
        const sz = Math.max(4, Math.round(6 + (1 - density) * 12));
        const ox = (advX * 0.8) | 0, oy = (advY * 0.8) | 0;
        const h1 = ((hue + tAnim * 0.07) % 1 + 1) % 1;
        const h2 = ((hue + 0.5 + Math.sin(tAnim * 0.13) * spread) % 1 + 1) % 1;
        const c1 = hsl2rgba(h1, sat, 0.62);
        const c2 = hsl2rgba(h2, sat, 0.22);
        for (let y = 0; y < gh; y++) {
          const cy = (((y + oy) / sz) | 0);
          for (let x = 0; x < gw; x++) {
            const cx = (((x + ox) / sz) | 0);
            buf[y*gw + x] = ((cx ^ cy) & 1) ? c1 : c2;
          }
        }
        handled = true; break;
      }
      // ── PLASMA : classic demoscene plasma sin(x)+sin(y)+sin(d)+sin(t)
      case "PLASMA": {
        const k = 0.18 + scale * 0.25;
        const t = tAnim * 0.9;
        for (let y = 0; y < gh; y++) {
          for (let x = 0; x < gw; x++) {
            const xn = x * k + advX * 0.3, yn = y * k + advY * 0.3;
            const d = Math.sqrt((x - gw/2)*(x - gw/2) + (y - gh/2)*(y - gh/2)) * k;
            const v = (Math.sin(xn + t)
                    +  Math.sin(yn * 0.8 + t * 0.7)
                    +  Math.sin(d + t * 1.3)
                    +  Math.sin((xn + yn) * 0.5 + t * 0.5)) * 0.125 + 0.5;
            const h = ((hue + v * spread + t * 0.04) % 1 + 1) % 1;
            buf[y*gw + x] = hsl2rgba(h, sat, 0.30 + v * 0.55);
          }
        }
        handled = true; break;
      }
      // ── WAVES : radial water ripples from drifting source ──────────
      case "WAVES": {
        const cx = gw/2 + Math.sin(tAnim * 0.31) * gw * 0.3;
        const cy = gh/2 + Math.cos(tAnim * 0.27) * gh * 0.3;
        const cx2 = gw/2 - Math.cos(tAnim * 0.21) * gw * 0.25;
        const cy2 = gh/2 + Math.sin(tAnim * 0.19) * gh * 0.25;
        const k = 0.4 + scale * 0.3;
        for (let y = 0; y < gh; y++) {
          for (let x = 0; x < gw; x++) {
            const d1 = Math.sqrt((x - cx)*(x - cx) + (y - cy)*(y - cy));
            const d2 = Math.sqrt((x - cx2)*(x - cx2) + (y - cy2)*(y - cy2));
            const v = 0.5 + 0.25 * Math.sin(d1 * k - tAnim * 3) + 0.25 * Math.cos(d2 * k - tAnim * 2);
            buf[y*gw + x] = PAL[palIdx(v)];
          }
        }
        handled = true; break;
      }
      // ── RINGS : concentric pulsing rings ───────────────────────────
      case "RINGS": {
        const cx = gw/2 + advX * 0.5, cy = gh/2 + advY * 0.5;
        const ringW = Math.max(2, Math.round(3 + (1 - density) * 6));
        const t = tAnim * 2.5;
        for (let y = 0; y < gh; y++) {
          for (let x = 0; x < gw; x++) {
            const d = Math.sqrt((x - cx)*(x - cx) + (y - cy)*(y - cy));
            const r = ((d - t) % ringW + ringW) % ringW;
            const v = Math.abs(r / ringW - 0.5) * 2;
            const h = ((hue + d * 0.005) % 1 + 1) % 1;
            buf[y*gw + x] = hsl2rgba(h, sat, 0.20 + (1 - v) * 0.65);
          }
        }
        handled = true; break;
      }
      // ── DOTS : bright dot matrix at regular spacing ───────────────
      case "DOTS": {
        const sp = Math.max(3, Math.round(4 + (1 - density) * 8));
        const r = Math.max(1, sp * 0.35);
        fillBg(0.05);
        const ox = (advX * 0.9) | 0, oy = (advY * 0.9) | 0;
        for (let y = 0; y < gh; y++) {
          const cy = ((y + oy) % sp + sp) % sp - sp/2;
          for (let x = 0; x < gw; x++) {
            const cx = ((x + ox) % sp + sp) % sp - sp/2;
            const d2 = cx*cx + cy*cy;
            if (d2 < r*r) {
              const v = fieldAt(x, y);
              const h = ((hue + v * spread) % 1 + 1) % 1;
              buf[y*gw + x] = hsl2rgba(h, sat, 0.35 + v * 0.5);
            }
          }
        }
        handled = true; break;
      }
      // ── ASCII : character density blocks ───────────────────────────
      case "ASCII": {
        const charSz = 6;
        // 7 density bins → 7 5×5 glyph masks (low→high coverage).
        const glyphs = [
          [0,0,0,0,0, 0,0,0,0,0, 0,0,0,0,0, 0,0,0,0,0, 0,0,0,0,0],   // space
          [0,0,0,0,0, 0,0,0,0,0, 0,0,1,0,0, 0,0,0,0,0, 0,0,0,0,0],   // .
          [0,0,0,0,0, 0,1,0,1,0, 0,0,0,0,0, 0,1,0,1,0, 0,0,0,0,0],   // :
          [0,0,1,0,0, 0,1,1,1,0, 1,1,0,1,1, 0,1,1,1,0, 0,0,1,0,0],   // +
          [1,0,1,0,1, 0,1,0,1,0, 1,0,1,0,1, 0,1,0,1,0, 1,0,1,0,1],   // x
          [0,1,1,1,0, 1,1,0,1,1, 1,0,1,0,1, 1,1,0,1,1, 0,1,1,1,0],   // O
          [1,1,1,1,1, 1,1,1,1,1, 1,1,1,1,1, 1,1,1,1,1, 1,1,1,1,1],   // █
        ];
        for (let y = 0; y < gh; y++) {
          const cy = (y / charSz) | 0;
          const ly = (y - cy * charSz);
          if (ly >= 5) { for (let x = 0; x < gw; x++) buf[y*gw + x] = PAL[0]; continue; }
          for (let x = 0; x < gw; x++) {
            const cx = (x / charSz) | 0;
            const lx = (x - cx * charSz);
            if (lx >= 5) { buf[y*gw + x] = PAL[0]; continue; }
            const v = fieldAt(cx * charSz, cy * charSz);
            const bin = Math.min(6, (v * 7) | 0);
            const on = glyphs[bin][ly * 5 + lx];
            buf[y*gw + x] = on ? PAL[palIdx(0.4 + v * 0.55)] : PAL[0];
          }
        }
        handled = true; break;
      }
      // ── BRICK : staggered brick masonry with mortar gaps ───────────
      case "BRICK": {
        const bw = Math.max(4, Math.round(8 + (1 - density) * 10));
        const bh = Math.max(2, Math.round(bw * 0.45));
        const mortar = Math.max(1, Math.round(bw * 0.08));
        const ox = (advX * 1.2) | 0, oy = (advY * 1.2) | 0;
        const mortarC = PAL[palIdx(0.05)];
        for (let y = 0; y < gh; y++) {
          const yo = y + oy;
          const cy = (yo / bh) | 0;
          const ly = yo - cy * bh;
          const stagger = (cy & 1) ? bw / 2 : 0;
          for (let x = 0; x < gw; x++) {
            const xo = x + ox + stagger;
            const cx = (xo / bw) | 0;
            const lx = xo - cx * bw;
            if (ly < mortar || lx < mortar) {
              buf[y*gw + x] = mortarC;
            } else {
              const h = ((hue + ((cx * 17 + cy * 31) % 100) * 0.01 * spread) % 1 + 1) % 1;
              const v = 0.45 + ((cx ^ cy) & 7) / 7 * 0.35;
              buf[y*gw + x] = hsl2rgba(h, sat * 0.7, v);
            }
          }
        }
        handled = true; break;
      }
      // ── HEX : hexagonal tiling with hue per hex ────────────────────
      case "HEX": {
        const r = Math.max(3, Math.round(4 + (1 - density) * 8));
        const w = r * Math.sqrt(3);
        const h = r * 1.5;
        for (let y = 0; y < gh; y++) {
          const fy = (y + advY * 0.6) / h;
          const ry = Math.round(fy);
          for (let x = 0; x < gw; x++) {
            const fx = (x + advX * 0.6) / w - (ry & 1) * 0.5;
            const rx = Math.round(fx);
            // Approximate hex by axial distance
            const dx = (fx - rx);
            const dy = (fy - ry);
            const hh = ((hue + (rx * 0.13 + ry * 0.19 + tAnim * 0.04) * spread) % 1 + 1) % 1;
            const v = 1 - Math.min(1, Math.sqrt(dx*dx + dy*dy) * 1.3);
            buf[y*gw + x] = hsl2rgba(hh, sat, 0.20 + v * 0.55);
          }
        }
        handled = true; break;
      }
      // ── ISO : isometric cube grid ──────────────────────────────────
      case "ISO": {
        const sz = Math.max(6, Math.round(8 + (1 - density) * 10));
        const cosI = Math.cos(Math.PI / 6), sinI = Math.sin(Math.PI / 6);
        for (let y = 0; y < gh; y++) {
          for (let x = 0; x < gw; x++) {
            // Inverse-rotate to iso grid coords
            const u = (x + advX) * cosI + (y + advY) * sinI;
            const v = (x + advX) * cosI - (y + advY) * sinI;
            const cu = (u / sz) | 0, cv = (v / sz) | 0;
            const lu = u - cu * sz, lv = v - cv * sz;
            // 3 faces of cube based on which third of the cell
            let face = 0;
            if (lu < sz / 3) face = 0;
            else if (lu > sz * 2 / 3) face = 2;
            else face = 1;
            void lv;
            const lums = [0.30, 0.62, 0.85];
            const hh = ((hue + (cu * 0.11 + cv * 0.17) * spread) % 1 + 1) % 1;
            buf[y*gw + x] = hsl2rgba(hh, sat, lums[face]);
          }
        }
        handled = true; break;
      }
      // ── RGBSP : RGB-split bands ────────────────────────────────────
      case "RGBSP": {
        const sh = Math.max(2, Math.round(3 + warp * 12));
        for (let y = 0; y < gh; y++) {
          for (let x = 0; x < gw; x++) {
            const vR = fieldAt(x - sh, y);
            const vG = fieldAt(x, y);
            const vB = fieldAt(x + sh, y);
            const R = (vR * 255) | 0, G = (vG * 255) | 0, B = (vB * 255) | 0;
            buf[y*gw + x] = 0xff000000 | (B << 16) | (G << 8) | R;
          }
        }
        handled = true; break;
      }
      // ── NOISE : multi-octave value noise ───────────────────────────
      case "NOISE": {
        const t = tAnim * 0.7;
        for (let y = 0; y < gh; y++) {
          for (let x = 0; x < gw; x++) {
            const xn = (x + advX) * 0.05;
            const yn = (y + advY) * 0.05;
            const v = (
              Math.sin(xn * 2.1 + t) * 0.5 +
              Math.cos(yn * 1.9 - t * 0.7) * 0.25 +
              Math.sin((xn + yn) * 4.3 + t * 1.4) * 0.125 +
              Math.sin(xn * 8.7 - yn * 7.3 + t * 2.1) * 0.0625
            ) * 0.6 + 0.5;
            buf[y*gw + x] = PAL[palIdx(Math.max(0, Math.min(1, v)))];
          }
        }
        handled = true; break;
      }
      // ── WORM : thin sinuous wormy lines ────────────────────────────
      case "WORM": {
        fillBg(0.04);
        const N = Math.max(40, Math.round(60 + density * 200));
        for (let i = 0; i < N; i++) {
          const ph0 = i * 0.917 + seed * 0.13;
          let x = (_h2(i, 7, seed) * gw + advX * 2) % gw;
          let y = (_h2(i, 11, seed) * gh + advY * 2) % gh;
          if (x < 0) x += gw; if (y < 0) y += gh;
          const h0 = ((hue + (i % 19) * 0.05 * spread) % 1 + 1) % 1;
          const c = hsl2rgba(h0, sat, 0.6);
          const len = 30;
          for (let k = 0; k < len; k++) {
            const ang = Math.sin(tAnim * 0.5 + ph0 + k * 0.31) * 2 + Math.cos(k * 0.11 + ph0) * 1.5;
            x += Math.cos(ang); y += Math.sin(ang);
            const xi = ((x | 0) % gw + gw) % gw;
            const yi = ((y | 0) % gh + gh) % gh;
            buf[yi * gw + xi] = c;
          }
        }
        handled = true; break;
      }
      // ── SHARDS : angular crystalline shards (voronoi w/ F2-F1 edges)
      case "SHARDS": {
        const N = Math.max(15, Math.round(20 + density * 50));
        const sx = new Float32Array(N), sy = new Float32Array(N), sh = new Float32Array(N);
        for (let i = 0; i < N; i++) {
          sx[i] = ((_h2(i, 1, seed) * gw + advX * 0.6) % gw + gw) % gw;
          sy[i] = ((_h2(i, 2, seed) * gh + advY * 0.6) % gh + gh) % gh;
          sh[i] = _h2(i, 5, seed);
        }
        for (let y = 0; y < gh; y++) {
          for (let x = 0; x < gw; x++) {
            let f1 = 1e18, f2 = 1e18, bi = 0;
            for (let i = 0; i < N; i++) {
              const dx = x - sx[i], dy = y - sy[i];
              const d = Math.abs(dx) + Math.abs(dy); // Manhattan → angular shards
              if (d < f1) { f2 = f1; f1 = d; bi = i; }
              else if (d < f2) { f2 = d; }
            }
            const edge = f2 - f1;
            const hh = ((hue + sh[bi] * spread) % 1 + 1) % 1;
            const v = edge < 1.5 ? 0.0 : (0.3 + sh[bi] * 0.5);
            buf[y*gw + x] = hsl2rgba(hh, sat, v);
          }
        }
        handled = true; break;
      }
      // ── STAIR : stepped diagonal stairs ────────────────────────────
      case "STAIR": {
        const stepW = Math.max(3, Math.round(4 + (1 - density) * 6));
        const stepH = Math.max(2, Math.round(stepW * 0.5));
        for (let y = 0; y < gh; y++) {
          const sy = ((y + (advY | 0)) / stepH) | 0;
          for (let x = 0; x < gw; x++) {
            const sx = (((x + (advX | 0)) - sy * stepW) / stepW) | 0;
            const v = ((sx + sy) % 7) / 7;
            const hh = ((hue + v * spread + tAnim * 0.05) % 1 + 1) % 1;
            buf[y*gw + x] = hsl2rgba(hh, sat, 0.25 + v * 0.55);
          }
        }
        handled = true; break;
      }
      // ── CIRCS : overlapping concentric circle blobs ────────────────
      case "CIRCS": {
        const N = Math.max(6, Math.round(8 + density * 16));
        fillBg(0.05);
        for (let i = 0; i < N; i++) {
          const ph0 = i * 0.731 + seed * 0.17;
          const cx = gw/2 + Math.sin(tAnim * 0.3 + ph0) * gw * 0.4;
          const cy = gh/2 + Math.cos(tAnim * 0.27 + ph0 * 1.3) * gh * 0.4;
          const rmax = Math.min(gw, gh) * (0.15 + (i % 5) * 0.05);
          const hh = ((hue + i * 0.13 * spread) % 1 + 1) % 1;
          for (let y = Math.max(0, (cy - rmax) | 0); y < Math.min(gh, (cy + rmax) | 0); y++) {
            for (let x = Math.max(0, (cx - rmax) | 0); x < Math.min(gw, (cx + rmax) | 0); x++) {
              const d = Math.sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy));
              if (d > rmax) continue;
              const v = 1 - d / rmax;
              const idx = y*gw + x;
              const prev = buf[idx];
              const pR = prev & 0xff, pG = (prev >> 8) & 0xff, pB = (prev >> 16) & 0xff;
              const c = hsl2rgba(hh, sat, 0.3 + v * 0.5);
              const cR = c & 0xff, cG = (c >> 8) & 0xff, cB = (c >> 16) & 0xff;
              const a = v * 0.6;
              const nR = (pR * (1 - a) + cR * a) | 0;
              const nG = (pG * (1 - a) + cG * a) | 0;
              const nB = (pB * (1 - a) + cB * a) | 0;
              buf[idx] = 0xff000000 | (nB << 16) | (nG << 8) | nR;
            }
          }
        }
        handled = true; break;
      }
      // ── CROSS : grid of plus/cross shapes ──────────────────────────
      case "CROSS": {
        const sz = Math.max(5, Math.round(7 + (1 - density) * 10));
        const arm = Math.max(1, Math.round(sz * 0.18));
        fillBg(0.06);
        const ox = (advX * 0.8) | 0, oy = (advY * 0.8) | 0;
        for (let y = 0; y < gh; y++) {
          const cy = (((y + oy) / sz) | 0);
          const ly = (y + oy) - cy * sz - sz/2;
          for (let x = 0; x < gw; x++) {
            const cx = (((x + ox) / sz) | 0);
            const lx = (x + ox) - cx * sz - sz/2;
            const onH = Math.abs(ly) < arm && Math.abs(lx) < sz/2 - 1;
            const onV = Math.abs(lx) < arm && Math.abs(ly) < sz/2 - 1;
            if (onH || onV) {
              const hh = ((hue + (cx * 0.11 + cy * 0.07) * spread) % 1 + 1) % 1;
              buf[y*gw + x] = hsl2rgba(hh, sat, 0.65);
            }
          }
        }
        handled = true; break;
      }
      // ── WEAVE : basket weave horizontal/vertical bands ─────────────
      case "WEAVE": {
        const sz = Math.max(4, Math.round(6 + (1 - density) * 8));
        const ox = (advX * 0.5) | 0, oy = (advY * 0.5) | 0;
        for (let y = 0; y < gh; y++) {
          const cy = (((y + oy) / sz) | 0);
          const ly = (y + oy) - cy * sz;
          for (let x = 0; x < gw; x++) {
            const cx = (((x + ox) / sz) | 0);
            const lx = (x + ox) - cx * sz;
            const isH = ((cx + cy) & 1) === 0;
            const v = isH ? Math.abs(ly - sz/2) / sz : Math.abs(lx - sz/2) / sz;
            const hh = ((hue + (isH ? 0 : 0.5) * spread) % 1 + 1) % 1;
            buf[y*gw + x] = hsl2rgba(hh, sat, 0.25 + (1 - v * 2) * 0.55);
          }
        }
        handled = true; break;
      }
      // ── DIAMOND : diamond grid pattern ─────────────────────────────
      case "DIAMOND": {
        const sz = Math.max(4, Math.round(6 + (1 - density) * 10));
        for (let y = 0; y < gh; y++) {
          for (let x = 0; x < gw; x++) {
            const u = (x + advX * 0.7) + (y + advY * 0.7);
            const v = (x + advX * 0.7) - (y + advY * 0.7);
            const cu = (u / sz) | 0, cv = (v / sz) | 0;
            const lu = (u - cu * sz) / sz - 0.5;
            const lv = (v - cv * sz) / sz - 0.5;
            const d = Math.abs(lu) + Math.abs(lv);
            const hh = ((hue + (cu * 0.13 + cv * 0.17) * spread + tAnim * 0.05) % 1 + 1) % 1;
            const lum = d < 0.4 ? 0.7 : 0.15;
            buf[y*gw + x] = hsl2rgba(hh, sat, lum);
          }
        }
        handled = true; break;
      }
      // ── GLITCH : RGB-shift + row-displace artefacts ────────────────
      case "GLITCH": {
        for (let y = 0; y < gh; y++) {
          const tear = (Math.sin(y * 0.07 + tAnim * 5) > 0.85) ? ((Math.sin(y) * 8) | 0) : 0;
          for (let x = 0; x < gw; x++) {
            const xx = x + tear;
            const vR = fieldAt(xx - 4, y);
            const vG = fieldAt(xx, y);
            const vB = fieldAt(xx + 4, y);
            const R = (vR * 255) | 0, G = (vG * 255) | 0, B = (vB * 255) | 0;
            buf[y*gw + x] = 0xff000000 | (B << 16) | (G << 8) | R;
          }
        }
        // Random block drops
        const tBin = (tAnim * 30) | 0;
        const blocks = Math.max(2, Math.round(4 + jitter * 20));
        for (let k = 0; k < blocks; k++) {
          const bw = Math.max(2, ((_h2(k, 11, tBin) * gw * 0.3) | 0));
          const bh = Math.max(1, ((_h2(k, 13, tBin) * gh * 0.05) | 0));
          const sxB = (_h2(k, 17, tBin) * (gw - bw)) | 0;
          const syB = (_h2(k, 19, tBin) * (gh - bh)) | 0;
          const c = (k & 1) ? PAL[255] : PAL[0];
          for (let yy = 0; yy < bh; yy++) {
            const row = (syB + yy) * gw + sxB;
            for (let xx = 0; xx < bw; xx++) buf[row + xx] = c;
          }
        }
        handled = true; break;
      }
      // ── TRUCH : Truchet diagonal tiles ─────────────────────────────
      case "TRUCH": {
        const T = Math.max(4, Math.round(5 + (1 - density) * 8));
        const lineW = Math.max(1, T * 0.2);
        const fg = PAL[palIdx(0.85)];
        const bg = PAL[palIdx(0.08)];
        const tBin = (tAnim * 0.4) | 0;
        for (let y = 0; y < gh; y++) {
          const cy = (y / T) | 0, ly = y - cy * T;
          for (let x = 0; x < gw; x++) {
            const cx = (x / T) | 0, lx = x - cx * T;
            const r = (_h2(cx, cy, seed + tBin) * 2) | 0;
            const on = (r === 0)
              ? Math.abs(lx - ly) < lineW
              : Math.abs(lx + ly - (T - 1)) < lineW;
            buf[y*gw + x] = on ? fg : bg;
          }
        }
        handled = true; break;
      }
      // ── STACK : horizontal stacked bars varying width ──────────────
      case "STACK": {
        const baseH = Math.max(2, Math.round(3 + (1 - density) * 6));
        let y = 0;
        let row = 0;
        while (y < gh) {
          const h = Math.max(1, baseH + (((_h2(row, 7, seed) - 0.5) * baseH) | 0));
          const drift = advX * (0.4 + (row % 5) * 0.15);
          const hh = ((hue + row * 0.07 * spread + Math.sin(tAnim * 0.2 + row * 0.3) * spread * 0.3) % 1 + 1) % 1;
          for (let yy = 0; yy < h && y + yy < gh; yy++) {
            for (let x = 0; x < gw; x++) {
              const v = 0.4 + 0.4 * Math.sin((x + drift) * 0.18 + row * 0.5);
              buf[(y + yy) * gw + x] = hsl2rgba(hh, sat, v);
            }
          }
          y += h; row++;
        }
        handled = true; break;
      }
      // ── FLOWL : flowing curl-noise streamlines ─────────────────────
      case "FLOWL": {
        fillBg(0.03);
        const N = Math.max(50, Math.round(80 + density * 200));
        for (let i = 0; i < N; i++) {
          const ph0 = i * 1.13;
          let x = (_h2(i, 1, seed) * gw + advX) % gw;
          let y = (_h2(i, 2, seed) * gh + advY) % gh;
          if (x < 0) x += gw; if (y < 0) y += gh;
          const hh = ((hue + (i % 11) * 0.07 * spread) % 1 + 1) % 1;
          const c = hsl2rgba(hh, sat, 0.55);
          const len = 22;
          for (let k = 0; k < len; k++) {
            const xn = (x - gw/2) * 0.05, yn = (y - gh/2) * 0.05;
            const ang = Math.sin(xn + curlPh + ph0) + Math.cos(yn * 1.4 - curlPh + ph0);
            x += Math.cos(ang) * 1.1; y += Math.sin(ang) * 1.1;
            const xi = ((x | 0) % gw + gw) % gw;
            const yi = ((y | 0) % gh + gh) % gh;
            buf[yi * gw + xi] = c;
          }
        }
        handled = true; break;
      }
      // ── RIBON : sin-cos ribbon waves ───────────────────────────────
      case "RIBON": {
        const ribH = Math.max(3, Math.round(5 + (1 - density) * 8));
        const ribbons = Math.ceil(gh / ribH) + 1;
        fillBg(0.04);
        for (let r = 0; r < ribbons; r++) {
          const baseY = r * ribH;
          const hh = ((hue + r * 0.09 * spread) % 1 + 1) % 1;
          const c = hsl2rgba(hh, sat, 0.55);
          for (let x = 0; x < gw; x++) {
            const offset = Math.sin(x * 0.1 + tAnim * 1.2 + r * 0.7) * ribH * 0.8
                         + Math.cos(x * 0.05 + tAnim * 0.7 + r * 1.3) * ribH * 0.4;
            const y = baseY + offset;
            const yi = (y | 0);
            for (let dy = -1; dy <= 1; dy++) {
              const yy = yi + dy;
              if (yy >= 0 && yy < gh) buf[yy * gw + x] = c;
            }
          }
        }
        handled = true; break;
      }
      // ── ORBIT : orbital trails ─────────────────────────────────────
      case "ORBIT": {
        // Persist trail buffer in gsc
        const gscX = gsc as _GenStateCache & { orbit?: Float32Array; orbitLen?: number };
        if (!gscX.orbit || gscX.orbitLen !== buf.length) {
          gscX.orbit = new Float32Array(buf.length * 3);
          gscX.orbitLen = buf.length;
        }
        const tr = gscX.orbit!;
        for (let i = 0; i < tr.length; i++) tr[i] *= 0.92;
        const N = Math.max(8, Math.round(10 + density * 30));
        for (let i = 0; i < N; i++) {
          const ph0 = i * 0.731;
          const r0 = (i % 5 + 1) * 0.1 * Math.min(gw, gh);
          const cx = gw/2 + Math.sin(tAnim * 0.3 + ph0) * gw * 0.15;
          const cy = gh/2 + Math.cos(tAnim * 0.27 + ph0) * gh * 0.15;
          const a = tAnim * (0.5 + (i % 7) * 0.2) + ph0;
          const x = cx + Math.cos(a) * r0;
          const y = cy + Math.sin(a) * r0;
          const hh = ((hue + i * 0.13 * spread) % 1 + 1) % 1;
          const c = hsl2rgba(hh, sat, 0.6);
          const xi = (x | 0), yi = (y | 0);
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            const xx = xi + dx, yy = yi + dy;
            if (xx >= 0 && xx < gw && yy >= 0 && yy < gh) {
              const k = (yy * gw + xx) * 3;
              tr[k]   = Math.min(1, tr[k]   + (c & 0xff) / 255);
              tr[k+1] = Math.min(1, tr[k+1] + ((c >> 8) & 0xff) / 255);
              tr[k+2] = Math.min(1, tr[k+2] + ((c >> 16) & 0xff) / 255);
            }
          }
        }
        const bg = PAL[palIdx(0.04)];
        for (let i = 0; i < buf.length; i++) {
          const k = i * 3;
          if (tr[k] + tr[k+1] + tr[k+2] < 0.05) buf[i] = bg;
          else {
            const R = (Math.min(1, tr[k]) * 255) | 0;
            const G = (Math.min(1, tr[k+1]) * 255) | 0;
            const B = (Math.min(1, tr[k+2]) * 255) | 0;
            buf[i] = 0xff000000 | (B << 16) | (G << 8) | R;
          }
        }
        handled = true; break;
      }
      // PLIFE, REACT, BOIDS, DLAUN, LSYST fall through to family render
      // (Conway, Gray-Scott, particles, voronoi-edges, sparse CA — these
      // ARE genuinely distinct kernels living in families 0/1/6/7 already).
    }
  }

  // ── Render per family ────────────────────────────────────────────────
  if (handled) { /* per-style kernel already filled buf */ }
  else if (family === 0) {
    // CA: alive cells lit; neighborhood density hue-shifts via value range.
    const src = grid.a;
    const thresh = (1 - density) * 0.45;
    for (let y = 0; y < gh; y++) {
      const ym = (y - 1 + gh) % gh, yp = (y + 1) % gh;
      const rowY = y * gw, rowM = ym * gw, rowP = yp * gw;
      for (let x = 0; x < gw; x++) {
        const xm = (x - 1 + gw) % gw, xp = (x + 1) % gw;
        const v = src[rowY + x];
        const dens = (
          src[rowM+xm]+src[rowM+x]+src[rowM+xp]+
          src[rowY+xm]+v             +src[rowY+xp]+
          src[rowP+xm]+src[rowP+x]+src[rowP+xp]
        ) / 9;
        if (v > 0.5)        buf[rowY+x] = PAL[palIdx(0.70 + dens*0.30)];
        else if (dens > thresh) buf[rowY+x] = PAL[palIdx(0.05 + dens*0.25)];
        else                buf[rowY+x] = PAL[0];
      }
    }
  } else if (family === 1) {
    // Reaction-diffusion v field → continuous tones, density biases threshold.
    const v = grid.b;
    const k = 0.6 + density * 1.4;
    for (let i = 0; i < v.length; i++) {
      const vv = Math.max(0, Math.min(1, v[i] * k));
      buf[i] = PAL[palIdx(vv)];
    }
  } else if (family === 2) {
    // Geometric flow rendered as quantised dithered pixels.
    const sc = 0.05 + scale * 0.18;
    const ph = tAnim * 0.6;
    // Coarse turbulence: jitter the sample point by a hash that varies
    // per ~4x4 block AND per ~6 frames. Breaks the perfectly periodic
    // sin/cos field so flow lines wobble organically instead of looking
    // like a clean rotating wave. Scales with the user's jitter knob.
    const tBin = (tAnim * 10) | 0;
    const turb = 0.35 + jitter * 1.4;
    const bayer4 = [
       0, 8, 2,10,
      12, 4,14, 6,
       3,11, 1, 9,
      15, 7,13, 5,
    ];
    for (let y = 0; y < gh; y++) {
      const yBase = (y - gh/2) * sc + advY;
      for (let x = 0; x < gw; x++) {
        const xBase = (x - gw/2) * sc + advX;
        // Curl: perpendicular swirl that varies along both axes so paths
        // bend non-uniformly. Each style's curlPh ensures the bend pattern
        // differs between layers.
        const tx = (_h2(x >> 2, y >> 2, tBin) - 0.5) * turb;
        const ty = (_h2(x >> 2, y >> 2, tBin + 7919) - 0.5) * turb;
        const xn = xBase + Math.sin(yBase * 0.4 + curlPh) * curlAmp * 0.6 + tx;
        const yn = yBase + Math.cos(xBase * 0.4 - curlPh * 0.7) * curlAmp * 0.6 + ty;
        let f: number;
        if (variant === 0) {
          f = Math.sin(xn + ph) * Math.cos(yn - ph * 0.7) * 0.5 + 0.5;
        } else if (variant === 1) {
          const wx = Math.sin(yn * 1.3 + ph) * (1 + warp * 1.5);
          const wy = Math.cos(xn * 1.1 - ph * 0.8) * (1 + warp * 1.5);
          f = (Math.sin(xn + wx + ph) + Math.cos(yn + wy - ph * 0.5)) * 0.25 + 0.5;
        } else if (variant === 2) {
          const r = Math.sqrt(xn*xn + yn*yn);
          const a = Math.atan2(yn, xn);
          f = Math.sin(r * 1.2 - ph * 1.4 + a * 3) * 0.5 + 0.5;
        } else {
          const r = Math.sqrt(xn*xn + yn*yn);
          f = (Math.sin(r * 0.9 - ph) + Math.sin((xn+yn) * 0.5 + ph * 0.6)) * 0.25 + 0.5;
        }
        const dith = bayer4[(y & 3)*4 + (x & 3)] / 16;
        const lvl = Math.max(0, Math.min(1, f * (0.5 + density * 1.0)));
        const q = Math.max(0, Math.min(1, Math.floor(lvl * 6 + (dith - 0.5) * 0.5) / 6));
        buf[y*gw+x] = PAL[palIdx(q)];
      }
    }
    if (jitter > 0) {
      const tBin = (tAnim * 30) | 0;
      const N = (jitter * gw * gh * 0.018) | 0;
      for (let k = 0; k < N; k++) {
        const x = (_h2(k, 41, tBin) * gw) | 0;
        const y = (_h2(41, k, tBin) * gh) | 0;
        buf[y*gw+x] = PAL[255];
      }
    }
  } else if (family === 3) {
    // Pixel patterns (dither + structural masks). Pure 1-bit pixels.
    const bayer8 = [
       0,32, 8,40, 2,34,10,42,
      48,16,56,24,50,18,58,26,
      12,44, 4,36,14,46, 6,38,
      60,28,52,20,62,30,54,22,
       3,35,11,43, 1,33, 9,41,
      51,19,59,27,49,17,57,25,
      15,47, 7,39,13,45, 5,37,
      63,31,55,23,61,29,53,21,
    ];
    const sc = 0.04 + scale * 0.12;
    const ph = tAnim * 0.5;
    const stride = Math.max(2, Math.floor(2 + scale * 5));
    const brickRow = Math.max(2, Math.floor(3 + scale * 4));
    const brickStride = Math.max(2, Math.floor(6 + scale * 8));
    for (let y = 0; y < gh; y++) {
      const yBase = (y - gh/2) * sc + advY * 0.7;
      for (let x = 0; x < gw; x++) {
        const xBase = (x - gw/2) * sc + advX * 0.7;
        const xn = xBase + Math.sin(yBase * 0.5 + curlPh) * curlAmp * 0.4;
        const yn = yBase + Math.cos(xBase * 0.5 - curlPh * 0.6) * curlAmp * 0.4;
        const f =
          Math.sin(xn + ph) * 0.5 +
          Math.cos(yn - ph * 0.7) * 0.3 +
          Math.sin((xn + yn) * 0.6 + ph * 1.3) * 0.2 + 0.5;
        const lvl = Math.max(0, Math.min(1, f * (0.55 + density * 0.9)));
        let on = false;
        if (variant === 0) {
          on = lvl * 64 > bayer8[(y & 7)*8 + (x & 7)];
        } else if (variant === 1) {
          const cellOrder = bayer8[((y >> 1) & 7)*8 + ((x >> 1) & 7)] / 4 | 0;
          on = lvl * 16 > cellOrder;
        } else if (variant === 2) {
          const row = (y / brickRow) | 0;
          const offX = (row & 1) * Math.floor(brickStride / 2);
          const xs = (x + offX) % brickStride;
          on = xs < lvl * brickStride;
        } else {
          const wob = Math.floor(Math.sin(y * 0.2 + ph) * stride);
          on = ((((x + wob) % stride) + stride) % stride) < lvl * stride;
        }
        buf[y*gw+x] = on ? PAL[palIdx(0.85 + lvl*0.15)] : PAL[palIdx(0.05)];
      }
    }
  } else if (family === 4) {
    // Fractal: Mandelbrot or Julia escape, fully animated. Pure pixels.
    const julia = variant >= 2;
    const zoom = 1.6 / (1 + scale * 0.6) * (1 - push * 0.25);
    // Direction-driven cam drift: each style cruises through the fractal on
    // its own bearing instead of all sitting at the same focus.
    const camX = (julia ? 0 : -0.745) + mx * 0.05 + dCos * Math.sin(tAnim * 0.13) * 0.18;
    const camY = (julia ? 0 :  0.110) + my * 0.05 + dSin * Math.cos(tAnim * 0.11) * 0.18;
    const jcx = [-0.4, -0.7, -0.8, 0.355][variant];
    const jcy = [ 0.6,  0.27, 0.156, 0.355][variant];
    const maxIter = Math.max(20, Math.min(96, ((density * 32) + 28 + (push * 16)) | 0));
    const phase = tAnim * 0.4;
    const wiggle = warp * 0.05;
    for (let y = 0; y < gh; y++) {
      const fy = (y / gh - 0.5) * 3 * zoom;
      for (let x = 0; x < gw; x++) {
        const fx = (x / gw - 0.5) * 3 * zoom;
        let zx: number, zy: number, ccx: number, ccy: number;
        if (julia) {
          zx = fx + camX; zy = fy + camY;
          ccx = jcx + Math.sin(phase) * (0.04 + wiggle);
          ccy = jcy + Math.cos(phase) * (0.04 + wiggle);
        } else {
          zx = 0; zy = 0;
          ccx = fx + camX; ccy = fy + camY;
        }
        let i = 0;
        while (i < maxIter) {
          const x2 = zx * zx, y2 = zy * zy;
          if (x2 + y2 > 4) break;
          const nx = x2 - y2 + ccx;
          zy = 2 * zx * zy + ccy;
          zx = nx;
          i++;
        }
        const v = i / maxIter;
        // Smooth shimmer phase shift baked into value so palette swirls.
        const shifted = (v + Math.sin(phase + v * 6.28) * 0.03 * spread + 1) % 1;
        buf[y*gw+x] = PAL[palIdx(shifted)];
      }
    }
  } else if (family === 5) {
    // ── PIXEL SORT ─────────────────────────────────────────────────────
    // Inspired by satyarth/pixelsort + kimasendorf/ASDFPixelSort.
    // 1. Generate a base luminance field via curl-warped sine noise.
    // 2. Walk rows / cols / diagonals; sort segments where lum ∈ [lo,hi].
    const sc = 0.06 + scale * 0.14;
    const ph = tAnim * 0.4;
    const lo = Math.max(0, 0.25 - density * 0.20);
    const hi = Math.min(1, 0.85 + density * 0.10);
    const segMax = Math.max(4, Math.floor(Math.max(gw, gh) * (0.15 + (1 - density) * 0.6)));
    const base = new Float32Array(gw * gh);
    for (let y = 0; y < gh; y++) {
      const yBase = (y - gh/2) * sc + advY * 0.5;
      for (let x = 0; x < gw; x++) {
        const xBase = (x - gw/2) * sc + advX * 0.5;
        const xn = xBase + Math.sin(yBase * 0.4 + curlPh) * curlAmp * 0.5;
        const yn = yBase + Math.cos(xBase * 0.4 - curlPh * 0.7) * curlAmp * 0.5;
        const f = Math.sin(xn + ph) * 0.5
                + Math.cos(yn - ph * 0.6) * 0.3
                + Math.sin((xn + yn) * 0.5 + ph * 1.2) * 0.2 + 0.5;
        base[y*gw + x] = Math.max(0, Math.min(1, f));
      }
    }
    if (variant === 0 || variant === 3) {
      // Horizontal sort per row (variant 3 alternates direction).
      for (let y = 0; y < gh; y++) {
        const row = y * gw;
        let x = 0;
        while (x < gw) {
          while (x < gw && (base[row+x] < lo || base[row+x] > hi)) x++;
          const s = x;
          while (x < gw && base[row+x] >= lo && base[row+x] <= hi && (x - s) < segMax) x++;
          if (x - s > 2) {
            const slice = base.slice(row + s, row + x);
            slice.sort();
            if (variant === 3 && (y & 1)) slice.reverse();
            for (let k = 0; k < slice.length; k++) base[row + s + k] = slice[k];
          }
        }
      }
    } else if (variant === 1) {
      // Vertical sort per column.
      for (let x = 0; x < gw; x++) {
        let y = 0;
        while (y < gh) {
          while (y < gh && (base[y*gw+x] < lo || base[y*gw+x] > hi)) y++;
          const s = y;
          while (y < gh && base[y*gw+x] >= lo && base[y*gw+x] <= hi && (y - s) < segMax) y++;
          if (y - s > 2) {
            const slice = new Float32Array(y - s);
            for (let k = 0; k < slice.length; k++) slice[k] = base[(s+k)*gw + x];
            slice.sort();
            for (let k = 0; k < slice.length; k++) base[(s+k)*gw + x] = slice[k];
          }
        }
      }
    } else {
      // Diagonal sort (NW→SE; rows of constant x+y).
      const diag = gw + gh;
      for (let d = 0; d < diag; d++) {
        const xs = Math.max(0, d - gh + 1);
        const xe = Math.min(gw - 1, d);
        const len = xe - xs + 1;
        if (len < 4) continue;
        let i = 0;
        while (i < len) {
          while (i < len) {
            const xx = xs + i, yy = d - xx;
            if (base[yy*gw + xx] >= lo && base[yy*gw + xx] <= hi) break;
            i++;
          }
          const sStart = i;
          while (i < len && (i - sStart) < segMax) {
            const xx = xs + i, yy = d - xx;
            if (base[yy*gw + xx] < lo || base[yy*gw + xx] > hi) break;
            i++;
          }
          const segLen = i - sStart;
          if (segLen > 2) {
            const slice = new Float32Array(segLen);
            for (let k = 0; k < segLen; k++) {
              const xx = xs + sStart + k, yy = d - xx;
              slice[k] = base[yy*gw + xx];
            }
            slice.sort();
            for (let k = 0; k < segLen; k++) {
              const xx = xs + sStart + k, yy = d - xx;
              base[yy*gw + xx] = slice[k];
            }
          }
        }
      }
    }
    for (let i = 0; i < base.length; i++) buf[i] = PAL[palIdx(base[i])];
  } else if (family === 6) {
    // ── FLOW FIELD (curl-noise particles + fading trail) ───────────────
    // Inspired by Nature-of-Code flow-field examples and particle-life vibe.
    const N = Math.max(60, Math.min(900, Math.round(80 + density * 750)));
    const flowHash = (variant * 7919) ^ (seed * 31) ^ (N * 17);
    if (!gsc.flow || gsc.flow.n !== N || gsc.flow.tw !== gw || gsc.flow.th !== gh || gsc.flow.hash !== flowHash) {
      const px = new Float32Array(N), py = new Float32Array(N);
      const ph2 = new Float32Array(N), pa = new Float32Array(N);
      for (let i = 0; i < N; i++) {
        px[i] = _h2(i, 1, seed) * gw;
        py[i] = _h2(i, 2, seed) * gh;
        ph2[i] = _h2(i, 3, seed);
        pa[i] = 0.25 + _h2(i, 4, seed) * 0.6;
      }
      gsc.flow = { px, py, ph: ph2, pa, n: N, trail: new Float32Array(gw * gh * 4), tw: gw, th: gh, hash: flowHash };
    }
    const fs = gsc.flow!;
    const trail = fs.trail;
    // Fade per-variant (long trails → slower fade).
    const fade = [0.86, 0.945, 0.91, 0.88][variant] ?? 0.88;
    for (let i = 0; i < trail.length; i++) trail[i] *= fade;
    const sc = 0.04 + scale * 0.10;
    const ph = tAnim * 0.6;
    const stepLen = 0.6 + push * 1.4 + speed * 0.3;
    const tBin = (tAnim * 60) | 0;
    // Brownian turbulence: how much each particle's heading and stride
    // get randomly nudged per frame. Scaled by jitter so the user can
    // dial the chaos vs. determinism balance, with a small floor so
    // movement never collapses back to clean orbital sin/cos.
    const turbAng = 0.9 + jitter * 4.0;
    const turbStep = 0.4 + jitter * 1.8;
    for (let i = 0; i < N; i++) {
      let x = fs.px[i], y = fs.py[i];
      const xn = (x - gw/2) * sc, yn = (y - gh/2) * sc;
      const ang = Math.sin(xn + ph) + Math.cos(yn * 1.3 - ph * 0.7)
                + Math.sin((xn + yn) * 0.5 + curlPh) * curlAmp * 0.4
                + dirAngle * 0.3
                + (_h2(i, tBin, seed) - 0.5) * turbAng;
      const stride = stepLen * (0.55 + _h2(i, tBin + 1, seed) * turbStep);
      x += Math.cos(ang) * stride + mx * 0.4;
      y += Math.sin(ang) * stride + my * 0.4;
      if (x < 0) x += gw; else if (x >= gw) x -= gw;
      if (y < 0) y += gh; else if (y >= gh) y -= gh;
      // Random respawn (jitter raises death rate).
      if (_h2(i, tBin, seed) < 0.004 + jitter * 0.05) {
        x = _h2(i, 91, tBin) * gw;
        y = _h2(i, 73, tBin) * gh;
        fs.ph[i] = _h2(i, 57, tBin);
      }
      fs.px[i] = x; fs.py[i] = y;
      // Deposit color from palette using particle hue.
      const c = PAL[palIdx((fs.ph[i] + tAnim * 0.04) % 1)];
      const xi = x | 0, yi = y | 0;
      if (xi >= 0 && xi < gw && yi >= 0 && yi < gh) {
        const ti = (yi * gw + xi) * 4;
        const a = fs.pa[i];
        trail[ti  ] = Math.min(1, trail[ti  ] + ((c & 0xff) / 255) * a);
        trail[ti+1] = Math.min(1, trail[ti+1] + (((c >> 8) & 0xff) / 255) * a);
        trail[ti+2] = Math.min(1, trail[ti+2] + (((c >> 16) & 0xff) / 255) * a);
        trail[ti+3] = Math.min(1, trail[ti+3] + a * 0.35);
      }
    }
    const bgC = PAL[palIdx(0.04)];
    for (let i = 0; i < gw * gh; i++) {
      const t = i * 4;
      const a = trail[t+3];
      if (a < 0.012) { buf[i] = bgC; }
      else {
        const r = (Math.min(1, trail[t  ]) * 255) | 0;
        const g = (Math.min(1, trail[t+1]) * 255) | 0;
        const b = (Math.min(1, trail[t+2]) * 255) | 0;
        buf[i] = 0xff000000 | (b << 16) | (g << 8) | r;
      }
    }
  } else if (family === 7) {
    // ── VORONOI / WORLEY ───────────────────────────────────────────────
    // Drifting sites; per-pixel F1 (nearest) and F2 (second-nearest).
    // Variants: 0 cell-color, 1 F1 distance, 2 F2-F1 edges (Delaunay-like),
    //           3 hex-lattice site distribution.
    const N = Math.max(8, Math.min(140, Math.round(14 + density * 90)));
    const vHash = (variant * 4099) ^ (seed * 137) ^ (N * 29);
    if (!gsc.sites || gsc.sites.n !== N || gsc.sites.hash !== vHash) {
      const sx = new Float32Array(N), sy = new Float32Array(N);
      const svx = new Float32Array(N), svy = new Float32Array(N), sh = new Float32Array(N);
      if (variant === 3) {
        const cols = Math.max(2, Math.round(Math.sqrt(N * gw / gh)));
        const rows = Math.max(2, Math.ceil(N / cols));
        const cellW = gw / cols, cellH = gh / rows;
        for (let i = 0; i < N; i++) {
          const col = i % cols, row = (i / cols) | 0;
          sx[i] = (col + 0.5 + (row & 1) * 0.5) * cellW + (_h2(i, 8, seed) - 0.5) * cellW * 0.25;
          sy[i] = (row + 0.5) * cellH + (_h2(i, 9, seed) - 0.5) * cellH * 0.25;
          svx[i] = (_h2(i, 3, seed) - 0.5) * 0.2;
          svy[i] = (_h2(i, 4, seed) - 0.5) * 0.2;
          sh[i] = _h2(i, 5, seed);
        }
      } else {
        for (let i = 0; i < N; i++) {
          sx[i] = _h2(i, 1, seed) * gw;
          sy[i] = _h2(i, 2, seed) * gh;
          svx[i] = (_h2(i, 3, seed) - 0.5) * 0.5;
          svy[i] = (_h2(i, 4, seed) - 0.5) * 0.5;
          sh[i] = _h2(i, 5, seed);
        }
      }
      gsc.sites = { sx, sy, svx, svy, sh, n: N, hash: vHash };
    }
    const vs = gsc.sites!;
    const drift = 0.3 + warp * 1.3 + speed * 0.4;
    // Brownian site walk: instead of cos(tAnim)/sin(tAnim) (which produces
    // clean orbital drift), nudge each site's velocity by a hash-noise
    // force every frame and damp it. Floor the random force so cells keep
    // breathing even when warp/jitter are zero.
    const tBinV = (tAnim * 30) | 0;
    const force = 0.20 + jitter * 0.6;
    const damp = 0.94;
    for (let i = 0; i < vs.n; i++) {
      vs.svx[i] = vs.svx[i] * damp + (_h2(i, tBinV, seed) - 0.5) * force;
      vs.svy[i] = vs.svy[i] * damp + (_h2(i, tBinV + 9001, seed) - 0.5) * force;
      vs.sx[i] += vs.svx[i] * drift + mx * 0.4;
      vs.sy[i] += vs.svy[i] * drift + my * 0.4;
      if (vs.sx[i] < 0) vs.sx[i] += gw; else if (vs.sx[i] >= gw) vs.sx[i] -= gw;
      if (vs.sy[i] < 0) vs.sy[i] += gh; else if (vs.sy[i] >= gh) vs.sy[i] -= gh;
    }
    const N2 = vs.n;
    const sxA = vs.sx, syA = vs.sy, shA = vs.sh;
    const distNorm = 1 / (Math.max(gw, gh) * 0.35);
    for (let y = 0; y < gh; y++) {
      const row = y * gw;
      for (let x = 0; x < gw; x++) {
        let f1 = 1e18, f2 = 1e18, idx = 0;
        for (let i = 0; i < N2; i++) {
          const dx = x - sxA[i], dy = y - syA[i];
          const d = dx*dx + dy*dy;
          if (d < f1) { f2 = f1; f1 = d; idx = i; }
          else if (d < f2) { f2 = d; }
        }
        if (variant === 0 || variant === 3) {
          const f1n = Math.sqrt(f1) * distNorm;
          const v = 0.55 + (1 - Math.min(1, f1n)) * 0.45;
          const cellHue = ((hue + (shA[idx] - 0.5) * spread) % 1 + 1) % 1;
          const sig = 1 / (1 + Math.exp(-(v - 0.5) * cKey * 4));
          const lum = lumLow + (lumHi - lumLow) * sig;
          buf[row + x] = hsl2rgba(cellHue, sat, lum);
        } else if (variant === 1) {
          const v = Math.min(1, Math.sqrt(f1) * distNorm);
          buf[row + x] = PAL[palIdx(v)];
        } else {
          const edge = Math.sqrt(f2) - Math.sqrt(f1);
          const v = 1 - Math.min(1, edge / (Math.max(gw, gh) * 0.025));
          buf[row + x] = PAL[palIdx(v)];
        }
      }
    }
  } else if (family === 8) {
    // ── TRUCHET TILES ──────────────────────────────────────────────────
    // Each cell randomly oriented; variants choose tile pattern.
    const T = Math.max(3, Math.round(4 + scale * 8 + (1 - density) * 6));
    const tBin = ((tAnim * 0.3) | 0);
    const fgC = PAL[palIdx(0.92)];
    const bgC = PAL[palIdx(0.05)];
    const lineW = Math.max(1, T * 0.18);
    const T2 = T * 2;
    const lineW2 = Math.max(1, T2 * 0.14);
    for (let y = 0; y < gh; y++) {
      const cy = (y / T) | 0;
      const ly = y - cy * T;
      const cy2 = (y / T2) | 0;
      const ly2 = y - cy2 * T2;
      for (let x = 0; x < gw; x++) {
        const cx = (x / T) | 0;
        const lx = x - cx * T;
        const r = (_h2(cx, cy, seed + tBin) * 4) | 0;
        let on = false;
        if (variant === 0) {
          if (r & 1) on = Math.abs(lx - ly) < lineW;
          else       on = Math.abs(lx + ly - (T - 1)) < lineW;
        } else if (variant === 1) {
          // Two arcs from opposite corners.
          const ringR = T * 0.5;
          const corner = r & 3;
          const cx0 = (corner === 1 || corner === 2) ? T : 0;
          const cy0 = (corner === 2 || corner === 3) ? T : 0;
          const dx = lx - cx0, dy = ly - cy0;
          if (Math.abs(Math.sqrt(dx*dx + dy*dy) - ringR) < lineW) on = true;
          const ox = T - cx0, oy = T - cy0;
          const dox = lx - ox, doy = ly - oy;
          if (Math.abs(Math.sqrt(dox*dox + doy*doy) - ringR) < lineW) on = true;
        } else if (variant === 2) {
          // Larger 2T tiles with diagonal Truchet.
          const cx2 = (x / T2) | 0;
          const lx2 = x - cx2 * T2;
          const r2 = (_h2(cx2, cy2, seed + tBin) * 4) | 0;
          if (r2 & 1) on = Math.abs(lx2 - ly2) < lineW2;
          else        on = Math.abs(lx2 + ly2 - (T2 - 1)) < lineW2;
        } else {
          // Mixed: half cells diagonal, half quarter-arcs.
          if (r & 1) {
            on = Math.abs(lx - ly) < lineW;
          } else {
            const corner = (r >> 1) & 3;
            const cx0 = (corner === 1 || corner === 2) ? T : 0;
            const cy0 = (corner === 2 || corner === 3) ? T : 0;
            const dx = lx - cx0, dy = ly - cy0;
            on = Math.abs(Math.sqrt(dx*dx + dy*dy) - T * 0.5) < lineW;
          }
        }
        buf[y*gw + x] = on ? fgC : bgC;
      }
    }
  } else if (family === 9) {
    // ── DATABEND / GLITCH ──────────────────────────────────────────────
    // Inspired by snorpey/jpg-glitch, Datamosh-js, TotallyNotChase/glitch-this.
    // 1. Generate a base flow-noise field.
    // 2. Apply combinations of: row-shifts, RGB channel split, block
    //    corruption (copy random rect → random rect), scanline tear.
    const sc = 0.05 + scale * 0.15;
    const ph = tAnim * 0.5;
    for (let y = 0; y < gh; y++) {
      const yBase = (y - gh/2) * sc + advY * 0.5;
      const row = y * gw;
      for (let x = 0; x < gw; x++) {
        const xBase = (x - gw/2) * sc + advX * 0.5;
        const xn = xBase + Math.sin(yBase * 0.4 + curlPh) * curlAmp * 0.4;
        const yn = yBase + Math.cos(xBase * 0.4 - curlPh * 0.6) * curlAmp * 0.4;
        const f = Math.sin(xn + ph) * 0.5 + Math.cos(yn - ph * 0.7) * 0.3 + 0.5;
        buf[row + x] = PAL[palIdx(Math.max(0, Math.min(1, f)))];
      }
    }
    const tBin = (tAnim * 30) | 0;
    // Row-shift bands (variants 0, 3).
    if (variant === 0 || variant === 3) {
      const amp = Math.max(1, (gw * (0.05 + warp * 0.30)) | 0);
      const rowChunk = Math.max(2, Math.floor(2 + (1 - density) * 18));
      const tmpRow = new Uint32Array(gw);
      for (let y0 = 0; y0 < gh; y0 += rowChunk) {
        const offset = ((_h2(y0, 7, seed + tBin) - 0.5) * 2 * amp) | 0;
        if (offset === 0) continue;
        const off = ((offset % gw) + gw) % gw;
        for (let yy = 0; yy < rowChunk && y0 + yy < gh; yy++) {
          const row = (y0 + yy) * gw;
          for (let x = 0; x < gw; x++) tmpRow[x] = buf[row + x];
          for (let x = 0; x < gw; x++) buf[row + x] = tmpRow[(x + off) % gw];
        }
      }
    }
    // RGB channel split (variants 0, 1, 3).
    if (variant === 0 || variant === 1 || variant === 3) {
      const shiftR = Math.max(1, (gw * (0.02 + warp * 0.10)) | 0);
      const tmpR = new Uint32Array(gw);
      for (let y = 0; y < gh; y++) {
        const row = y * gw;
        for (let x = 0; x < gw; x++) tmpR[x] = buf[row + x];
        for (let x = 0; x < gw; x++) {
          const cR = tmpR[((x - shiftR) % gw + gw) % gw];
          const cG = tmpR[x];
          const cB = tmpR[(x + shiftR) % gw];
          const r = cR & 0xff;
          const g = (cG >> 8) & 0xff;
          const b = (cB >> 16) & 0xff;
          buf[row + x] = 0xff000000 | (b << 16) | (g << 8) | r;
        }
      }
    }
    // Block corruption (variants 0, 2): copy random rect → random rect.
    if (variant === 0 || variant === 2) {
      const blocks = Math.max(2, Math.round(8 + jitter * 36 + push * 12));
      for (let k = 0; k < blocks; k++) {
        const bw = Math.max(2, ((1 + _h2(k, 11, tBin) * gw * 0.28) | 0));
        const bh = Math.max(2, ((1 + _h2(k, 13, tBin) * gh * 0.10) | 0));
        const sx = Math.max(0, (_h2(k, 17, tBin) * (gw - bw)) | 0);
        const sy = Math.max(0, (_h2(k, 19, tBin) * (gh - bh)) | 0);
        const dx = Math.max(0, (_h2(k, 23, tBin) * (gw - bw)) | 0);
        const dy = Math.max(0, (_h2(k, 29, tBin) * (gh - bh)) | 0);
        for (let yy = 0; yy < bh; yy++) {
          const sRow = (sy + yy) * gw + sx;
          const dRow = (dy + yy) * gw + dx;
          for (let xx = 0; xx < bw; xx++) buf[dRow + xx] = buf[sRow + xx];
        }
      }
    }
    // Scanline tear (variant 3): drop dark lines at stride.
    if (variant === 3) {
      const stride = Math.max(2, Math.floor(3 + (1 - density) * 8));
      const cTear = PAL[palIdx(0.0)];
      for (let y = 0; y < gh; y += stride) {
        const row = y * gw;
        for (let x = 0; x < gw; x++) buf[row + x] = cTear;
      }
    }
  } else if (family === 10) {
    // ── SDF / RAYMARCHED 3D (inspired by hg_sdf) ──────────────────────
    // CPU sphere-tracer. Each pixel casts one ray; we evaluate a unioned
    // signed-distance field with smooth-min (the hg_sdf signature move).
    // Output is depth-shaded + normal-tinted, then quantised through the
    // same PAL LUT so it composes with sort/mosh/scatter exactly like
    // every other family. Resolution is the small (gw,gh) buffer so it
    // stays real-time even at 120×120 cells.
    const STEPS = 28;          // hard cap on sphere-trace iterations
    const FAR = 14.0;          // ray distance horizon
    const EPS = 0.0012;        // hit threshold (relative to FAR)
    const sm = 0.32;           // smooth-min radius
    // Camera orbit driven by tAnim + accelerometer tilt.
    const yaw   = tAnim * 0.35 + (p.motionX || 0) * 0.9;
    const pitch = Math.sin(tAnim * 0.21) * 0.25 + (p.motionY || 0) * 0.6;
    const camDist = 3.4 - push * 1.1;
    const cy = Math.cos(yaw), sy_ = Math.sin(yaw);
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    // ray basis vectors
    const fwdX = -sy_ * cp, fwdY = -sp,   fwdZ = -cy * cp;
    const rgtX =  cy,       rgtY =  0,    rgtZ = -sy_;
    const upX  =  sy_ * sp, upY  =  cp,   upZ  =  cy * sp;
    const camX = -fwdX * camDist, camY = -fwdY * camDist, camZ = -fwdZ * camDist;
    const aspect = gw / gh;
    const fov = 1.6 / (1.0 + scale * 0.6); // wider scale = wider lens
    const rotT = tAnim * 0.6;
    const cR = Math.cos(rotT), sR = Math.sin(rotT);

    // Signed-distance field. Variant picks the scene.
    const sdf = (x: number, y: number, z: number): number => {
      // Rotate point on Y axis so primitives spin even at zero motion.
      const rx = x * cR - z * sR;
      const rz = x * sR + z * cR;
      const ry = y;
      if (variant === 1) {
        // hg_sdf-style infinite lattice: pMod repetition with safety clamp.
        const cell = 1.6;
        const half = cell * 0.5;
        const px = ((rx + half) - Math.floor((rx + half) / cell) * cell) - half;
        const pyL = ((ry + half) - Math.floor((ry + half) / cell) * cell) - half;
        const pz = ((rz + half) - Math.floor((rz + half) / cell) * cell) - half;
        const r = 0.42 + Math.sin(tAnim * 0.8) * 0.08;
        return Math.sqrt(px*px + pyL*pyL + pz*pz) - r;
      }
      if (variant === 2) {
        // Torus + offset sphere knot.
        const R = 0.95, rr = 0.28 + Math.sin(tAnim * 1.2) * 0.06;
        const qx = Math.sqrt(rx*rx + rz*rz) - R;
        const dTorus = Math.sqrt(qx*qx + ry*ry) - rr;
        const sx = rx - 0.55 * Math.cos(tAnim * 0.9);
        const sz = rz - 0.55 * Math.sin(tAnim * 0.9);
        const dSph = Math.sqrt(sx*sx + ry*ry + sz*sz) - 0.36;
        const k = sm;
        const h = Math.max(0, Math.min(1, 0.5 + 0.5 * (dSph - dTorus) / k));
        return dSph * (1 - h) + dTorus * h - k * h * (1 - h);
      }
      if (variant === 3) {
        // Mandelbulb-lite (low power, few iterations — cheap).
        let zx = rx, zy = ry, zz = rz;
        let dr = 1.0;
        let r2 = 0;
        const POW = 6.0;
        for (let i = 0; i < 4; i++) {
          r2 = zx*zx + zy*zy + zz*zz;
          if (r2 > 4.0) break;
          const r = Math.sqrt(r2);
          const theta = Math.acos(zz / Math.max(1e-6, r)) * POW;
          const phi = Math.atan2(zy, zx) * POW;
          const rp = Math.pow(r, POW);
          dr = Math.pow(r, POW - 1) * POW * dr + 1;
          const sinT = Math.sin(theta);
          zx = rp * sinT * Math.cos(phi) + rx;
          zy = rp * sinT * Math.sin(phi) + ry;
          zz = rp * Math.cos(theta) + rz;
        }
        return 0.5 * Math.log(Math.max(1e-6, r2)) * Math.sqrt(r2) / dr;
      }
      // variant 0 — smooth union of sphere + box + torus.
      const dSph = Math.sqrt(rx*rx + ry*ry + rz*rz) - 0.62;
      const bx = Math.abs(rx) - 0.55, by = Math.abs(ry) - 0.55, bz = Math.abs(rz) - 0.55;
      const dx = Math.max(bx, 0), dy = Math.max(by, 0), dz = Math.max(bz, 0);
      const dBox = Math.sqrt(dx*dx + dy*dy + dz*dz)
        + Math.min(0, Math.max(bx, Math.max(by, bz))) - 0.05;
      const qx = Math.sqrt(rx*rx + rz*rz) - 0.85;
      const dTor = Math.sqrt(qx*qx + ry*ry) - 0.18;
      // smin twice (sphere⊕box, then ⊕torus).
      const k = sm;
      let h = Math.max(0, Math.min(1, 0.5 + 0.5 * (dBox - dSph) / k));
      let m = dSph * (1 - h) + dBox * h - k * h * (1 - h);
      h = Math.max(0, Math.min(1, 0.5 + 0.5 * (dTor - m) / k));
      m = m * (1 - h) + dTor * h - k * h * (1 - h);
      return m;
    };

    // Render.
    const lightX = 0.55, lightY = 0.7, lightZ = 0.45; // sun direction
    const lL = 1 / Math.sqrt(lightX*lightX + lightY*lightY + lightZ*lightZ);
    const lx = lightX * lL, ly = lightY * lL, lz = lightZ * lL;
    for (let py = 0; py < gh; py++) {
      const ny = -((py + 0.5) / gh - 0.5) * 2.0;
      for (let px = 0; px < gw; px++) {
        const nx = ((px + 0.5) / gw - 0.5) * 2.0 * aspect;
        // ray dir = normalize(fwd + rgt*nx*fov + up*ny*fov)
        let rdx = fwdX + rgtX * nx * fov + upX * ny * fov;
        let rdy = fwdY + rgtY * nx * fov + upY * ny * fov;
        let rdz = fwdZ + rgtZ * nx * fov + upZ * ny * fov;
        const rl = 1 / Math.sqrt(rdx*rdx + rdy*rdy + rdz*rdz);
        rdx *= rl; rdy *= rl; rdz *= rl;
        let t = 0;
        let hit = -1;
        for (let i = 0; i < STEPS; i++) {
          const x = camX + rdx * t, y = camY + rdy * t, z = camZ + rdz * t;
          const d = sdf(x, y, z);
          if (d < EPS) { hit = t; break; }
          if (t > FAR) break;
          t += d * 0.92; // safety factor (under-step) for fractal scenes
        }
        let v: number;
        if (hit < 0) {
          // sky — vertical gradient through the palette.
          v = 0.18 + ny * 0.18;
        } else {
          const hx = camX + rdx * hit, hy = camY + rdy * hit, hz = camZ + rdz * hit;
          // Cheap forward-diff normal.
          const e = 0.0025;
          const d0 = sdf(hx, hy, hz);
          const nxN = sdf(hx + e, hy, hz) - d0;
          const nyN = sdf(hx, hy + e, hz) - d0;
          const nzN = sdf(hx, hy, hz + e) - d0;
          const nL = 1 / Math.max(1e-6, Math.sqrt(nxN*nxN + nyN*nyN + nzN*nzN));
          const Nx = nxN * nL, Ny = nyN * nL, Nz = nzN * nL;
          const lambert = Math.max(0, Nx * lx + Ny * ly + Nz * lz);
          // depth fog blends to sky
          const fog = Math.max(0, Math.min(1, 1 - hit / FAR));
          // Drive palette by normal-Y (cool/warm) plus lambert intensity.
          v = (Ny * 0.5 + 0.5) * 0.55 + lambert * 0.45 * fog;
          v = Math.max(0, Math.min(1, v));
        }
        buf[py * gw + px] = PAL[palIdx(v)];
      }
    }
  }

  // ── Scatter / interruption post-process ─────────────────────────────
  // Per-layer datamosh blend MOVEMENT applied to the small pixel buffer
  // BEFORE the upscale. Total intensity = sustained scatter knob (0..1)
  // PLUS transient scatter pulse (decays externally each frame). Mode
  // selects the displacement style (button choice). Any non-zero amount
  // shears, blocks, tears, or freezes the layer's pixel field — these
  // are the buttons referenced by "datamoshing pixel blending movements
  // with x and y axis and scatter interruption movement buttons".
  const scatterAmt = Math.max(0, Math.min(1.5,
    (p.scatter || 0) + (p.scatterPulse || 0)));
  if (scatterAmt > 0.001) {
    const sMode = ((p.scatterMode || 0) | 0) % 4;
    const aPow = scatterAmt;
    const sBuf = new Uint32Array(buf.length);
    sBuf.set(buf);
    const tBin = (tAnim * 60) | 0;
    if (sMode === 0) {
      // SHIFT: per-row horizontal displacement (chunked, sin-amp).
      const chunk = Math.max(1, Math.floor(2 + (1 - aPow) * 6));
      const ampMax = Math.max(2, Math.floor(gw * 0.5 * aPow));
      for (let y = 0; y < gh; y++) {
        const band = (y / chunk) | 0;
        const bias = (p.moshX || 0);
        const shift = Math.floor(
          (Math.sin(tAnim * 1.7 + band * 1.27) * 0.6
           + (_h2(band, 13, seed + tBin) - 0.5) * 1.4
           + bias * 0.8) * ampMax
        );
        const row = y * gw;
        for (let x = 0; x < gw; x++) {
          let sx = x - shift;
          sx = ((sx % gw) + gw) % gw;
          buf[row + x] = sBuf[row + sx];
        }
      }
    } else if (sMode === 1) {
      // BURST: radial outward push (pixels fly away from center).
      const cx = gw / 2 + (p.moshX || 0) * gw * 0.3;
      const cy = gh / 2 + (p.moshY || 0) * gh * 0.3;
      const k = aPow * 0.65;
      for (let y = 0; y < gh; y++) {
        for (let x = 0; x < gw; x++) {
          const dx = x - cx, dy = y - cy;
          const d = Math.sqrt(dx*dx + dy*dy) + 0.001;
          const f = 1 - k * (1 - Math.min(1, d / Math.max(gw, gh) * 1.4));
          let sx = Math.round(cx + dx * f);
          let sy = Math.round(cy + dy * f);
          sx = ((sx % gw) + gw) % gw;
          sy = ((sy % gh) + gh) % gh;
          buf[y*gw + x] = sBuf[sy*gw + sx];
        }
      }
    } else if (sMode === 2) {
      // SHRED: per-column vertical tear (mirror of SHIFT on Y axis).
      const chunk = Math.max(1, Math.floor(2 + (1 - aPow) * 6));
      const ampMax = Math.max(2, Math.floor(gh * 0.5 * aPow));
      for (let x = 0; x < gw; x++) {
        const band = (x / chunk) | 0;
        const bias = (p.moshY || 0);
        const shift = Math.floor(
          (Math.cos(tAnim * 1.7 + band * 1.27) * 0.6
           + (_h2(band, 29, seed + tBin) - 0.5) * 1.4
           + bias * 0.8) * ampMax
        );
        for (let y = 0; y < gh; y++) {
          let sy = y - shift;
          sy = ((sy % gh) + gh) % gh;
          buf[y*gw + x] = sBuf[sy*gw + x];
        }
      }
    } else {
      // FREEZE: hold the previous frame, slow-mix the new one in.
      // Persist a frozen snapshot across frames on the canvas state cache.
      const fc = gsc as _GenStateCache & { freeze?: Uint32Array; freezeLen?: number };
      if (!fc.freeze || fc.freezeLen !== buf.length) {
        fc.freeze = new Uint32Array(buf.length);
        fc.freeze.set(buf);
        fc.freezeLen = buf.length;
      }
      const fz = fc.freeze;
      // Hold strength: aPow=1 => fully frozen, aPow=0 => no effect.
      // Mix new frame into snapshot at (1 - aPow) per frame.
      const keep = Math.min(1, aPow);
      for (let i = 0; i < buf.length; i++) {
        const a = fz[i], b = sBuf[i];
        // blend per channel (little-endian 0xAABBGGRR-ish via canvas)
        const ar = a & 0xff, ag = (a >>> 8) & 0xff, ab = (a >>> 16) & 0xff;
        const br = b & 0xff, bg = (b >>> 8) & 0xff, bb = (b >>> 16) & 0xff;
        const k = 1 - keep;
        const nr = (ar * keep + br * k) | 0;
        const ng = (ag * keep + bg * k) | 0;
        const nb = (ab * keep + bb * k) | 0;
        fz[i] = 0xff000000 | (nb << 16) | (ng << 8) | nr;
        buf[i] = fz[i];
      }
    }
  }

  offCtx.putImageData(img, 0, 0);
  ctx.save();
  // Disable smoothing so the upscaled grid stays crisply pixelated.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (ctx as any).imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, W, H);
  ctx.drawImage(off, 0, 0, W, H);
  // v1.3.25 — TYPOGRAPHIC FINISHER. When glyphMode > 0, overdraw the
  // upscaled output as monospaced glyphs sampled per cell from the
  // tiny grid. Inspired by Andreas Gysin (ertdfgcvb.xyz) and Kim
  // Asendorf typographic generative work. Glyph color = cell color,
  // background black so the typography reads.
  const _gm = (p.glyphMode || 0) | 0;
  if (_gm > 0 && _gm < _GLYPH_RAMPS.length) {
    const ramp = _GLYPH_RAMPS[_gm];
    if (ramp && ramp.length > 0) {
      const gridImg = offCtx.getImageData(0, 0, gw, gh);
      const gd = gridImg.data;
      const cellPx = Math.max(2, cell);
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, W, H);
      ctx.font = `bold ${Math.max(6, Math.floor(cellPx * 1.05))}px "Courier New", monospace`;
      ctx.textBaseline = "top";
      ctx.textAlign = "left";
      for (let y = 0; y < gh; y++) {
        for (let x = 0; x < gw; x++) {
          const k = (y * gw + x) * 4;
          const r = gd[k], gC = gd[k+1], b = gd[k+2];
          // Perceptual luma 0..1
          const lum = (0.2126 * r + 0.7152 * gC + 0.0722 * b) / 255;
          let glyph: string;
          if (_gm === 5) {
            // EDGES: sobel-ish gradient direction; only draw where strong edge.
            const kr = ((y) * gw + Math.min(gw-1, x+1)) * 4;
            const kl = ((y) * gw + Math.max(0, x-1)) * 4;
            const kd = (Math.min(gh-1, y+1) * gw + x) * 4;
            const ku = (Math.max(0, y-1) * gw + x) * 4;
            const lumAt = (kk: number) => (0.2126 * gd[kk] + 0.7152 * gd[kk+1] + 0.0722 * gd[kk+2]) / 255;
            const dx = lumAt(kr) - lumAt(kl);
            const dy = lumAt(kd) - lumAt(ku);
            const mag = Math.hypot(dx, dy);
            if (mag < 0.18) continue;
            const ang = Math.atan2(dy, dx);
            // Map angle to one of 4 glyphs.
            const a = ((ang + Math.PI) / Math.PI) * 2; // 0..4
            const aIdx = (Math.round(a) | 0) & 3;
            glyph = ramp[aIdx];
          } else {
            const idx = Math.min(ramp.length - 1, Math.max(0, Math.floor(lum * ramp.length)));
            glyph = ramp[idx];
          }
          if (glyph === " " || !glyph) continue;
          ctx.fillStyle = `rgb(${r},${gC},${b})`;
          ctx.fillText(glyph, x * cellPx, y * cellPx);
        }
      }
    }
  }
  ctx.restore();
}
