"use client";
// (Capacitor mirror — no next/link)
import { useRef, useState, useEffect, useCallback, useMemo, useContext, createContext } from "react";
import type { Dispatch, SetStateAction } from "react";
import { Capacitor } from "@capacitor/core";
import { Filesystem, Directory, Encoding } from "@capacitor/filesystem";
import { Media } from "@capacitor-community/media";
import { Share } from "@capacitor/share";

// ═══════════════════════════════════════════════════════════
//  GPS — WebGL computational vision engine
//  12 camera shader modes · glitch · datamosh · sort · kaleidoscope
//  animated boot screen
// ═══════════════════════════════════════════════════════════

// ── Mode definitions ────────────────────────────────────────
// Stripped to the two flagship effects. Other shader branches remain in
// FRAG_SRC for compatibility with persisted presets / sessions but are not
// exposed in the UI.
const MODES = [
  { id: 7, short: "PXL",  label: "Pixel Sort" },
  { id: 9, short: "MOSH", label: "Datamosh"  },
] as const;
type ModeId = 0|1|2|3|4|5|6|7|8|9|10|11|12|13|14|15|16|17|18|19|20|21|22|23|24|25|26;
const GPS_APP_ICON = "/spectra/gps_logo.png";
const GPS_WORDMARK = "/spectra/gps_logo_text.png";
// Back-compat alias so legacy splash/boot/intro code that referenced the
// old SPECTRA_* constants still resolves to the GPS launcher art.
const SPECTRA_APP_ICON = GPS_APP_ICON;
void GPS_WORDMARK; // currently unused — wordmark is rendered as text

// ── Pixel generator ────────────────────────────────────────────────────
// Procedurally draws a tile-based texture into an offscreen canvas, fed
// into the shader as a source. Designed to react beautifully when chained
// through pixel-sort + datamosh.

// Per-style visual identity for the style picker buttons
const GEN_STYLE_META: Record<string, { font: string; color: string; bg: string; glow: string; italic?: boolean }> = {
  BAYER:   { font:"var(--font-nunito,'Nunito',sans-serif)",          color:"#7FFF00", bg:"linear-gradient(135deg,#001a00,#003300)",   glow:"#7FFF00" },
  HALFT:   { font:"var(--font-nunito,'Nunito',sans-serif)", color:"#F5E6C8", bg:"linear-gradient(135deg,#1a1208,#2e1f08)",   glow:"#F5E6C8" },
  MOSAIC:  { font:"var(--font-nunito,'Nunito',sans-serif)",                 color:"#FFB347", bg:"linear-gradient(135deg,#1a0d00,#301800)",   glow:"#FFB347" },
  VORON:   { font:"var(--font-nunito,'Nunito',sans-serif)",  color:"#FF69B4", bg:"linear-gradient(135deg,#1a0010,#2e0020)",   glow:"#FF69B4", italic:true },
  GRID:    { font:"var(--font-nunito,'Nunito',sans-serif)",          color:"#00FFFF", bg:"linear-gradient(135deg,#001a1a,#002828)",   glow:"#00FFFF" },
  STRIP:   { font:"var(--font-nunito,'Nunito',sans-serif)",        color:"#20E8D4", bg:"linear-gradient(135deg,#001518,#002220)",   glow:"#20E8D4" },
  CHECK:   { font:"var(--font-nunito,'Nunito',sans-serif)", color:"#C8C8C8", bg:"linear-gradient(135deg,#0f0f0f,#1e1e1e)",   glow:"#CCCCCC" },
  PLASMA:  { font:"var(--font-nunito,'Nunito',sans-serif)",                    color:"#FF1493", bg:"linear-gradient(135deg,#1a0015,#320020)",   glow:"#FF1493", italic:true },
  WAVES:   { font:"var(--font-nunito,'Nunito',sans-serif)",        color:"#4FC3F7", bg:"linear-gradient(135deg,#000e1a,#001428)",   glow:"#4FC3F7", italic:true },
  RINGS:   { font:"var(--font-nunito,'Nunito',sans-serif)",                    color:"#FFD700", bg:"linear-gradient(135deg,#1a1400,#2a2000)",   glow:"#FFD700" },
  DOTS:    { font:"var(--font-nunito,'Nunito',sans-serif)",                 color:"#CE93D8", bg:"linear-gradient(135deg,#120018,#1e0028)",   glow:"#CE93D8" },
  ASCII:   { font:"var(--font-nunito,'Nunito',sans-serif)",          color:"#39FF14", bg:"linear-gradient(135deg,#001000,#002000)",   glow:"#39FF14" },
  BRICK:   { font:"var(--font-nunito,'Nunito',sans-serif)",                color:"#FF6B35", bg:"linear-gradient(135deg,#1a0800,#2e1000)",   glow:"#FF6B35" },
  HEX:     { font:"var(--font-nunito,'Nunito',sans-serif)",                 color:"#FFC107", bg:"linear-gradient(135deg,#1a1200,#2a1c00)",   glow:"#FFC107" },
  ISO:     { font:"var(--font-nunito,'Nunito',sans-serif)",          color:"#82B1FF", bg:"linear-gradient(135deg,#000e2a,#001640)",   glow:"#82B1FF" },
  RGBSP:   { font:"var(--font-nunito,'Nunito',sans-serif)",          color:"#FF4444", bg:"linear-gradient(135deg,#1a0000,#250010)",   glow:"#FF0000" },
  NOISE:   { font:"var(--font-nunito,'Nunito',sans-serif)",          color:"#9E9E9E", bg:"linear-gradient(135deg,#0a0a0a,#161616)",   glow:"#AAAAAA" },
  WORM:    { font:"var(--font-nunito,'Nunito',sans-serif)",                    color:"#76FF03", bg:"linear-gradient(135deg,#071200,#0e2000)",   glow:"#76FF03", italic:true },
  SHARDS:  { font:"var(--font-nunito,'Nunito',sans-serif)",                color:"#80DEEA", bg:"linear-gradient(135deg,#001418,#001e22)",   glow:"#80DEEA" },
  STAIR:   { font:"var(--font-nunito,'Nunito',sans-serif)",                 color:"#B39DDB", bg:"linear-gradient(135deg,#0d0018,#180028)",   glow:"#B39DDB" },
  CIRCS:   { font:"var(--font-nunito,'Nunito',sans-serif)",                    color:"#FFAB40", bg:"linear-gradient(135deg,#1a0d00,#2e1800)",   glow:"#FFAB40" },
  CROSS:   { font:"var(--font-nunito,'Nunito',sans-serif)",                 color:"#EF5350", bg:"linear-gradient(135deg,#1a0000,#280000)",   glow:"#EF5350" },
  WEAVE:   { font:"var(--font-nunito,'Nunito',sans-serif)",        color:"#A1887F", bg:"linear-gradient(135deg,#100a08,#1e1410)",   glow:"#A1887F" },
  DIAMOND: { font:"var(--font-nunito,'Nunito',sans-serif)",                 color:"#29B6F6", bg:"linear-gradient(135deg,#000e18,#001428)",   glow:"#29B6F6" },
  GLITCH:  { font:"var(--font-nunito,'Nunito',sans-serif)",          color:"#E040FB", bg:"linear-gradient(135deg,#14001a,#200028)",   glow:"#E040FB" },
  TRUCH:   { font:"var(--font-nunito,'Nunito',sans-serif)",                color:"#FF8F00", bg:"linear-gradient(135deg,#1a0d00,#2a1500)",   glow:"#FF8F00" },
  BAY8:    { font:"var(--font-nunito,'Nunito',sans-serif)",          color:"#00BCD4", bg:"linear-gradient(135deg,#001618,#002228)",   glow:"#00BCD4" },
  STACK:   { font:"var(--font-nunito,'Nunito',sans-serif)",        color:"#F9A825", bg:"linear-gradient(135deg,#1a1000,#2a1c00)",   glow:"#F9A825" },
  FLOWL:   { font:"var(--font-nunito,'Nunito',sans-serif)",                    color:"#66BB6A", bg:"linear-gradient(135deg,#001200,#001e00)",   glow:"#66BB6A", italic:true },
  RIBON:   { font:"var(--font-nunito,'Nunito',sans-serif)",        color:"#F48FB1", bg:"linear-gradient(135deg,#1a0012,#280018)",   glow:"#F48FB1", italic:true },
  ORBIT:   { font:"var(--font-nunito,'Nunito',sans-serif)",                    color:"#CE93D8", bg:"linear-gradient(135deg,#0e0018,#180028)",   glow:"#CE93D8" },
  PLIFE:   { font:"var(--font-nunito,'Nunito',sans-serif)",          color:"#69FF47", bg:"linear-gradient(135deg,#001800,#003000)",   glow:"#69FF47" },
  DLAUN:   { font:"var(--font-nunito,'Nunito',sans-serif)",          color:"#18FFFF", bg:"linear-gradient(135deg,#001818,#003030)",   glow:"#18FFFF" },
  BOIDS:   { font:"var(--font-nunito,'Nunito',sans-serif)",          color:"#FFAB00", bg:"linear-gradient(135deg,#1a1000,#2e2000)",   glow:"#FFAB00" },
  REACT:   { font:"var(--font-nunito,'Nunito',sans-serif)",          color:"#FF1744", bg:"linear-gradient(135deg,#1a0000,#300000)",   glow:"#FF1744" },
  LSYST:   { font:"var(--font-nunito,'Nunito',sans-serif)",          color:"#00E676", bg:"linear-gradient(135deg,#001200,#003000)",   glow:"#00E676" },
  // ── SDF / raymarched 3D fields (hg_sdf-inspired) ───────────────
  // CPU sphere-tracer that unions primitives with smooth-min and feeds
  // the resulting depth/normal field through the existing pixel palette
  // — lets the rest of the pipeline (sort, mosh, scatter) operate on
  // genuine 3D-shaded pixels instead of flat 2D fields.
  SDF3D:   { font:"var(--font-nunito,'Nunito',sans-serif)",          color:"#9D7CFF", bg:"linear-gradient(135deg,#0a0024,#180048)",   glow:"#B8A2FF" },
  SDLAT:   { font:"var(--font-nunito,'Nunito',sans-serif)",          color:"#7CFFD9", bg:"linear-gradient(135deg,#001a14,#003028)",   glow:"#A2FFE8" },
  SDTOR:   { font:"var(--font-nunito,'Nunito',sans-serif)",                    color:"#FF7AC6", bg:"linear-gradient(135deg,#1a0014,#28001e)",   glow:"#FFA2D8", italic:true },
  SDFRC:   { font:"var(--font-nunito,'Nunito',sans-serif)",                color:"#FFD166", bg:"linear-gradient(135deg,#1a1000,#2a1c00)",   glow:"#FFE38A" },
};

type GenStyleId =
  | "BAYER" | "HALFT" | "MOSAIC" | "VORON" | "GRID"
  | "STRIP" | "CHECK" | "PLASMA" | "WAVES" | "RINGS"
  | "DOTS" | "ASCII" | "BRICK" | "HEX" | "ISO"
  | "RGBSP" | "NOISE" | "WORM" | "SHARDS" | "STAIR"
  | "CIRCS" | "CROSS" | "WEAVE" | "DIAMOND" | "GLITCH"
  | "TRUCH" | "BAY8" | "STACK" | "FLOWL" | "RIBON" | "ORBIT"
  | "PLIFE" | "DLAUN" | "BOIDS" | "REACT" | "LSYST"
  | "SDF3D" | "SDLAT" | "SDTOR" | "SDFRC";

type GenParams = {
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
};

// fast deterministic hash → [0,1)
function _h2(x: number, y: number, s: number): number {
  let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  h = h ^ (h >>> 16);
  return ((h >>> 0) % 100000) / 100000;
}
function _hsl(h: number, s: number, l: number, ctx: CanvasRenderingContext2D): string {
  // wrap hue
  const hh = ((h % 1) + 1) % 1;
  return `hsl(${(hh * 360).toFixed(1)} ${(s * 100).toFixed(1)}% ${(l * 100).toFixed(1)}%)`;
  void ctx;
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
const _gsc = new WeakMap<HTMLCanvasElement, _GenStateCache>();
function _gscGet(c: HTMLCanvasElement): _GenStateCache {
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

function drawPixelGenerator(canvas: HTMLCanvasElement, p: GenParams): void {
  const W = canvas.width, H = canvas.height;
  if (W < 4 || H < 4) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const seed = (p.seed | 0) || 1;
  // Pure-pixel renderer. Every style is rasterised into a tiny ImageData
  // then scaled up with imageSmoothingEnabled = false. No paths, no arcs,
  // no rectangles drawn over the field — only colored pixels in a grid.
  const cells = Math.max(8, Math.min(220, Math.round(p.resolution)));
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
  ctx.restore();
}

// ── Per-mode parameter schemas (rack architecture) ──────────
// Each mode declares 1–8 numeric/enum params occupying explicit slots in the
// shader uniform `uModeParams[8]`. Slot 0 is conventionally `amount` and is
// also mirrored into the legacy `uGain` uniform for back-compat with code
// paths that have not yet migrated.
type NumParamDef = {
  id: string; label: string; kind: "num";
  min: number; max: number; step: number; default: number;
  slot: number; unit?: string;
};
type EnumParamDef = {
  id: string; label: string; kind: "enum";
  options: readonly string[]; default: number; slot: number;
};
type ParamDef = NumParamDef | EnumParamDef;

const AMOUNT: NumParamDef = { id: "amount", label: "AMOUNT", kind: "num", min: 0, max: 1, step: 0.01, default: 0.5, slot: 0 };
const MIX:    NumParamDef = { id: "mix",    label: "MIX",    kind: "num", min: 0, max: 1, step: 0.01, default: 1.0, slot: 1 };

const MODE_SCHEMAS: Record<ModeId, readonly ParamDef[]> = {
  0: [AMOUNT, MIX],
  1: [
    AMOUNT,
    { id: "gamma",       label: "GAMMA",   kind: "num", min: 0.2, max: 3.0,  step: 0.01, default: 1.0,   slot: 1 },
    { id: "floor",       label: "FLOOR",   kind: "num", min: 0.0, max: 0.5,  step: 0.01, default: 0.015, slot: 2 },
    { id: "ceiling",     label: "CEIL",    kind: "num", min: 0.5, max: 1.0,  step: 0.01, default: 0.85,  slot: 3 },
    { id: "persistence", label: "PERSIST", kind: "num", min: 0.0, max: 0.95, step: 0.01, default: 0.5,   slot: 4 },
  ],
  2: [
    AMOUNT,
    { id: "gamma",       label: "GAMMA",   kind: "num", min: 0.2, max: 3.0,  step: 0.01, default: 1.0,  slot: 1 },
    { id: "floor",       label: "FLOOR",   kind: "num", min: 0.0, max: 0.5,  step: 0.01, default: 0.01, slot: 2 },
    { id: "ceiling",     label: "CEIL",    kind: "num", min: 0.5, max: 1.0,  step: 0.01, default: 0.9,  slot: 3 },
    { id: "persistence", label: "PERSIST", kind: "num", min: 0.0, max: 0.95, step: 0.01, default: 0.4,  slot: 4 },
  ],
  3: [
    AMOUNT,
    { id: "edgeGain",  label: "EDGE",   kind: "num", min: 0.5, max: 6.0, step: 0.05, default: 2.5,  slot: 1 },
    { id: "tint",      label: "TINT",   kind: "num", min: 0.0, max: 1.0, step: 0.01, default: 0.33, slot: 2 },
    { id: "threshold", label: "THRESH", kind: "num", min: 0.0, max: 1.0, step: 0.01, default: 0.0,  slot: 3 },
  ],
  4: [AMOUNT, MIX],
  5: [
    AMOUNT,
    { id: "cellSize", label: "CELL",  kind: "num", min: 2.0, max: 20.0, step: 0.5,  default: 7.5,  slot: 1 },
    { id: "ink",      label: "INK",   kind: "num", min: 0.0, max: 1.0,  step: 0.01, default: 1.0,  slot: 2 },
    { id: "paper",    label: "PAPER", kind: "num", min: 0.5, max: 1.0,  step: 0.01, default: 0.95, slot: 3 },
  ],
  6: [
    AMOUNT,
    { id: "cellSize", label: "CELL",  kind: "num", min: 2.0, max: 18.0, step: 0.5,  default: 8.0, slot: 1 },
    { id: "angle",    label: "ANGLE", kind: "num", min: 0.0, max: 1.0,  step: 0.01, default: 0.0, slot: 2 },
    { id: "ink",      label: "INK",   kind: "num", min: 0.0, max: 1.0,  step: 0.01, default: 1.0, slot: 3 },
  ],
  7: [
    AMOUNT,
    { id: "sortKey",        label: "KEY",    kind: "enum", options: ["LUM","HUE","SAT","R","G","B"], default: 0, slot: 1 },
    { id: "lowerThreshold", label: "LOWER",  kind: "num",  min: 0.0, max: 1.0, step: 0.01, default: 0.05, slot: 2 },
    { id: "upperThreshold", label: "UPPER",  kind: "num",  min: 0.0, max: 1.0, step: 0.01, default: 0.85, slot: 3 },
    { id: "direction",      label: "DIR",    kind: "enum", options: ["H","V","DIAG"], default: 0, slot: 4 },
    { id: "segmentLength",  label: "SEG",    kind: "num",  min: 0.0, max: 1.0, step: 0.01, default: 1.0, slot: 5 },
    { id: "noise",          label: "NOISE",  kind: "num",  min: 0.0, max: 1.0, step: 0.01, default: 0.0, slot: 6 },
    { id: "sinusoidal",     label: "WOBBLE", kind: "num",  min: 0.0, max: 1.0, step: 0.01, default: 0.0, slot: 7 },
  ],
  8: [
    AMOUNT,
    { id: "waveIntensity", label: "WAVE",   kind: "num", min: 0.0, max: 1.0, step: 0.01, default: 0.6, slot: 1 },
    { id: "chromaSpread",  label: "CHROMA", kind: "num", min: 0.0, max: 1.0, step: 0.01, default: 0.5, slot: 2 },
    { id: "burstRate",     label: "BURST",  kind: "num", min: 0.0, max: 1.0, step: 0.01, default: 0.5, slot: 3 },
    { id: "noiseAmount",   label: "NOISE",  kind: "num", min: 0.0, max: 1.0, step: 0.01, default: 0.4, slot: 4 },
  ],
  // 9 DATAMOSH — WebGL approximation; real datamoshing requires AVI/MPEG
  // bytestream editing. This shader emulates the *visual* effect only.
  9: [
    AMOUNT,
    { id: "iFrameKill",        label: "I-KILL", kind: "num", min: 0.0, max: 1.0, step: 0.01, default: 0.7,  slot: 1 },
    { id: "motionProp",        label: "MOTION", kind: "num", min: 0.0, max: 1.0, step: 0.01, default: 0.5,  slot: 2 },
    { id: "colorBleed",        label: "BLEED",  kind: "num", min: 0.0, max: 1.0, step: 0.01, default: 0.6,  slot: 3 },
    { id: "moshMaskThreshold", label: "MASK",   kind: "num", min: 0.0, max: 1.0, step: 0.01, default: 0.05, slot: 4 },
    { id: "compressionGlitch", label: "CODEC",  kind: "num", min: 0.0, max: 1.0, step: 0.01, default: 0.0,  slot: 5 },
  ],
  10: [
    AMOUNT,
    { id: "segments",   label: "SEG",  kind: "num", min: 2.0, max: 16.0, step: 1.0,  default: 6.0, slot: 1 },
    { id: "rotation",   label: "ROT",  kind: "num", min: -1.0, max: 1.0, step: 0.01, default: 0.0, slot: 2 },
    { id: "flowAmount", label: "FLOW", kind: "num", min: 0.0, max: 1.0,  step: 0.01, default: 0.5, slot: 3 },
  ],
  11: [
    AMOUNT,
    { id: "levels", label: "LEVELS", kind: "num", min: 2.0, max: 24.0, step: 1.0,  default: 8.0, slot: 1 },
    { id: "warp",   label: "WARP",   kind: "num", min: 0.0, max: 1.0,  step: 0.01, default: 0.5, slot: 2 },
  ],
  12: [AMOUNT, MIX],
  13: [
    AMOUNT,
    { id: "decay",          label: "DECAY", kind: "num", min: 0.0, max: 1.0,  step: 0.01, default: 0.5, slot: 1 },
    { id: "displaceAmount", label: "DISP",  kind: "num", min: 0.0, max: 1.0,  step: 0.01, default: 0.3, slot: 2 },
    { id: "hueRot",         label: "HUE/F", kind: "num", min: -1.0, max: 1.0, step: 0.01, default: 0.0, slot: 3 },
  ],
  14: [AMOUNT, MIX],
  15: [AMOUNT, MIX],
  16: [AMOUNT, MIX],
  17: [AMOUNT, MIX],
  18: [AMOUNT, MIX],
  19: [AMOUNT, MIX],
  20: [
    AMOUNT,
    { id: "levels",      label: "LEVELS", kind: "num",  min: 2.0, max: 8.0, step: 1.0, default: 2.0, slot: 1 },
    { id: "paletteMode", label: "PAL",    kind: "enum", options: ["DUAL","XOR","HUE"], default: 0, slot: 2 },
  ],
  21: [AMOUNT, MIX],
  // 22–26 use only the composite `fxA` value internally; richer schemas
  // can be added later when their shader branches are migrated to read
  // from uModeParams. Until then, expose AMOUNT only.
  22: [AMOUNT],
  23: [AMOUNT],
  24: [AMOUNT],
  25: [AMOUNT],
  26: [AMOUNT],
};

// ── Per-mode preset patches ─────────────────────────────────
type ModePreset = { name: string; values: Record<string, number> };
const MODE_PRESETS: Partial<Record<ModeId, readonly ModePreset[]>> = {
  1: [
    { name: "STANDARD",  values: { amount: 0.5, gamma: 1.0, floor: 0.015, ceiling: 0.85, persistence: 0.5 } },
    { name: "MOONLIGHT", values: { amount: 0.7, gamma: 1.6, floor: 0.04,  ceiling: 0.7,  persistence: 0.7 } },
    { name: "GHOST",     values: { amount: 0.8, gamma: 0.7, floor: 0.01,  ceiling: 0.95, persistence: 0.85 } },
  ],
  2: [
    { name: "STANDARD", values: { amount: 0.5, gamma: 1.0, floor: 0.01, ceiling: 0.9, persistence: 0.4 } },
    { name: "FLIR",     values: { amount: 0.7, gamma: 1.4, floor: 0.05, ceiling: 0.8, persistence: 0.6 } },
    { name: "MAGMA",    values: { amount: 0.9, gamma: 0.6, floor: 0.0,  ceiling: 1.0, persistence: 0.2 } },
  ],
  7: [
    { name: "STANDARD",        values: { amount: 0.5, sortKey: 0, lowerThreshold: 0.05, upperThreshold: 0.85, direction: 0, segmentLength: 1.0, noise: 0.0, sinusoidal: 0.0 } },
    { name: "HIGHLIGHT STREAK", values: { amount: 0.8, sortKey: 0, lowerThreshold: 0.6, upperThreshold: 1.0, direction: 0, segmentLength: 0.6, noise: 0.05, sinusoidal: 0.0 } },
    { name: "HUE CASCADE",     values: { amount: 0.9, sortKey: 1, lowerThreshold: 0.0, upperThreshold: 1.0, direction: 1, segmentLength: 0.4, noise: 0.0, sinusoidal: 0.0 } },
    { name: "WOBBLE GHOST",    values: { amount: 0.7, sortKey: 0, lowerThreshold: 0.1, upperThreshold: 0.9, direction: 2, segmentLength: 0.8, noise: 0.2, sinusoidal: 0.7 } },
    { name: "DEEP FRIED",      values: { amount: 1.0, sortKey: 2, lowerThreshold: 0.0, upperThreshold: 1.0, direction: 0, segmentLength: 0.2, noise: 1.0, sinusoidal: 0.0 } },
  ],
  8: [
    { name: "STANDARD", values: { amount: 0.5, waveIntensity: 0.6, chromaSpread: 0.5, burstRate: 0.5, noiseAmount: 0.4 } },
    { name: "VHS",      values: { amount: 0.4, waveIntensity: 0.3, chromaSpread: 0.8, burstRate: 0.2, noiseAmount: 0.6 } },
    { name: "STORM",    values: { amount: 1.0, waveIntensity: 1.0, chromaSpread: 1.0, burstRate: 1.0, noiseAmount: 0.8 } },
  ],
  9: [
    { name: "STANDARD",    values: { amount: 0.7, iFrameKill: 0.7, motionProp: 0.5, colorBleed: 0.6, moshMaskThreshold: 0.05, compressionGlitch: 0.0 } },
    { name: "SMEAR",       values: { amount: 0.8, iFrameKill: 1.0, motionProp: 0.9, colorBleed: 0.3, moshMaskThreshold: 0.02, compressionGlitch: 0.0 } },
    { name: "CODEC DEATH", values: { amount: 1.0, iFrameKill: 0.9, motionProp: 0.7, colorBleed: 1.0, moshMaskThreshold: 0.0,  compressionGlitch: 1.0 } },
    { name: "SOFT BLEED",  values: { amount: 0.5, iFrameKill: 0.4, motionProp: 0.3, colorBleed: 0.8, moshMaskThreshold: 0.15, compressionGlitch: 0.0 } },
  ],
  10: [
    { name: "STANDARD", values: { amount: 0.5, segments: 6.0,  rotation: 0.0,  flowAmount: 0.5 } },
    { name: "MANDALA",  values: { amount: 0.7, segments: 12.0, rotation: 0.1,  flowAmount: 0.7 } },
    { name: "PRISM",    values: { amount: 0.9, segments: 3.0,  rotation: -0.3, flowAmount: 1.0 } },
  ],
  13: [
    { name: "STANDARD", values: { amount: 0.5, decay: 0.5, displaceAmount: 0.3, hueRot: 0.0 } },
    { name: "TRAILS",   values: { amount: 0.8, decay: 0.9, displaceAmount: 0.1, hueRot: 0.0 } },
    { name: "SPIRAL",   values: { amount: 0.9, decay: 0.7, displaceAmount: 1.0, hueRot: 0.3 } },
  ],
};

// Numeric defaults, indexed by param id, for a single mode.
function defaultsForMode(id: ModeId): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of MODE_SCHEMAS[id]) out[p.id] = p.default;
  return out;
}
function defaultsForAllModes(): Record<ModeId, Record<string, number>> {
  const out = {} as Record<ModeId, Record<string, number>>;
  for (const m of MODES) out[m.id] = defaultsForMode(m.id);
  return out;
}
// Pack a mode's params into a Float32Array(8) for the uModeParams uniform.
function packParams(id: ModeId, values: Record<string, number>): Float32Array {
  const out = new Float32Array(8);
  for (const p of MODE_SCHEMAS[id]) {
    if (p.slot >= 0 && p.slot < 8) out[p.slot] = values[p.id] ?? p.default;
  }
  return out;
}

// localStorage key for the per-mode rack values (Phase 2 persistence wiring).
const RACK_KEY = "GPS:rack:v1";

// ── WebGL shaders ────────────────────────────────────────────
const VERT_SRC = `
attribute vec2 aPosition;
varying vec2 vUv;
void main() {
  vUv = aPosition * 0.5 + 0.5;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}`;

const FRAG_SRC = `
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
      // v1.2.71 — wider 9-tap box at 2.5px + mid-tap ring at 1.25px
      // for an even softer roto edge with a few extra pixels of outward
      // coverage. The model still hugs the body too tightly when limbs
      // move fast — the mid-ring fills the half-pixel gap between the
      // outer 2.5px taps and the centre, so the smoothstep below has a
      // smoother gradient to feather across, and the silhouette grows
      // ~3 px outward instead of 1.
      vec2 px  = vec2(2.5)  / max(uResolution, vec2(1.0));
      vec2 pxm = vec2(1.25) / max(uResolution, vec2(1.0));
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
  // v1.2.59 \u2014 mode 4 (HILBERT) bypasses this scanline body and is
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
    float stride = mix(1.0, 16.0, clamp(uSortSegment, 0.0, 1.0)) * (0.6 + uSortAmt * 1.4);
    step1 *= stride;
    // 8..64 sample run, scaled by SortAmt and Segment so dialing the
    // amount up creates LONGER streaks (not bigger displacements).
    // GLSL ES 1.00 requires constant loop bounds, so we use 64 hard
    // and gate work with float compare (NO break on dynamic value).
    float runMaxF = mix(8.0, 64.0, clamp(uSortSegment, 0.0, 1.0)) * (0.4 + uSortAmt * 1.6);
    runMaxF = clamp(runMaxF, 4.0, 64.0);
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
    float modWave = sin(lineCoord * 28.0 + uTime * 1.4)
                  + sin(lineCoord * 47.0 + uTime * 0.9) * 0.4;
    float modShift = modWave * uSortRandom * 0.22;
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
    if (uSortWobble > 0.001) {
      // Luma noise: per-frame pixel-level brightness jitter.
      float lumaJitter = (rand(uv + vec2(0.0, floor(uTime * 24.0) * 0.137)) - 0.5)
                        * uSortWobble * 0.12;
      sortedCol = clamp(sortedCol + lumaJitter, 0.0, 1.0);
      // Luma modulation: oscillating brightness bands (VHS luma carrier).
      float lumaMod = sin(uv.y * 565.0 + uTime * 3.8) * uSortWobble * 0.04;
      sortedCol = clamp(sortedCol + lumaMod, 0.0, 1.0);
      // Tape errors: sporadic horizontal corruption bands.
      float tapeRow = floor(uv.y * uResolution.y / 5.0);
      float tapeNoise = rand(vec2(tapeRow * 0.0031, floor(uTime * 5.0) * 0.017));
      float tapeThresh = 1.0 - uSortWobble * 0.18;
      float tapeWeight = clamp((tapeNoise - tapeThresh) / max(uSortWobble * 0.18, 0.001), 0.0, 1.0);
      float shiftX = tapeWeight * uSortWobble * 0.22;
      vec3 tapeSmp = texture2D(uCamera, clamp(uv + vec2(shiftX, 0.0), 0.0, 1.0)).rgb;
      sortedCol = mix(sortedCol, tapeSmp, tapeWeight * 0.65);
    }
    // In-band pixels are FULLY replaced with the sorted colour. uSortAmt
    // only gates whether the sort fires at all (and feeds the streak-length
    // math above). Previously sortBlend was uSortAmt * mask * inBand so
    // at the default knob value (~0.65) you only saw a 65% mix of the
    // sorted pixels on top of the originals, which read as a translucent
    // overlay instead of a real pixel sort.
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
  // 2. Scanline tear/glitch
  if (uScanTear * mask > 0.001) {
    float band = step(0.5, fract(uv.y * uResolution.y * (0.2 + uScanTear * mask * 2.0) + uTime * 2.0));
    uv.x += band * (rand(vec2(uv.y, uTime)) - 0.5) * uScanTear * mask * 0.12;
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
  if (uLiquid * mask > 0.001) {
    float t = uTime * 0.4;
    float s = uLiquid * mask * 0.07;
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
      vec2 contraryPush = -vDir * core * 0.18 * (0.5 + contraryK * 1.5);
      vec2 followShove  =  vDir * halo * 0.10 * (1.0 - contraryK);
      totalDisp += contraryPush + followShove;
    }
    uv = clamp(uv + totalDisp * uDisrupt * mask, 0.001, 0.999);
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
    float sortGate = smoothstep(0.0, 0.30, uSortMix * mask);
    color.rgb = mix(color.rgb, sorted, sortGate);
  }

  // 5. Datamosh blend (blend with prev frame)
  if (uDatamosh * mask > 0.001) {
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
    vec2 jumpOff = vec2(
      (hash(jump * 1.73 + floor(uv.y * 120.0)) - 0.5),
      (hash(jump * 2.11 + floor(uv.x * 90.0)) - 0.5)
    ) * dm * (0.07 + uMoshDistort * 0.11);
    vec2 jUv = clamp(uv + jumpOff, 0.001, 0.999);
    vec3 jumpPrev = texture2D(uPrevFrame, jUv).rgb;
    color.rgb = mix(color.rgb, jumpPrev, clamp(dm * (0.45 + motionCarry * 0.5), 0.0, 0.96));

    float sep = dm * (0.012 + bleed * 0.05);
    float rr = texture2D(uPrevFrame, clamp(jUv + vec2(sep, 0.0), 0.001, 0.999)).r;
    float gg = texture2D(uPrevFrame, jUv).g;
    float bb = texture2D(uPrevFrame, clamp(jUv - vec2(sep, 0.0), 0.001, 0.999)).b;
    color.rgb = mix(color.rgb, vec3(rr, gg, bb), clamp(dm * (0.22 + bleed * 0.75), 0.0, 0.9));

    if (dm > 0.8) {
      float extra = max(0.0, dm - 1.0);
      vec2 smearOff = vec2(sin(uTime * 1.3 + uv.y * 10.0), cos(uTime * 0.9 + uv.x * 8.0)) * extra * 0.16;
      vec3 smearPrev = texture2D(uPrevFrame, clamp(uv + smearOff, 0.001, 0.999)).rgb;
      color.rgb = mix(color.rgb, smearPrev, clamp(extra * (0.35 + motionCarry * 0.8), 0.0, 0.95));
    }
  }
  // 6. Chroma crash (extreme chroma separation)
  if (uChrash * mask > 0.001) {
    float caa = uChrash * mask * 0.07;
    float origR = color.r;
    float origG = color.g;
    float origB = color.b;
    float shiftR = texture2D(uCamera, clamp(uv + vec2(caa * 2.0,  caa * 0.4), 0.001, 0.999)).r;
    float shiftG = texture2D(uCamera, clamp(uv + vec2(0.0,        caa      ), 0.001, 0.999)).g;
    float shiftB = texture2D(uCamera, clamp(uv - vec2(caa * 2.0,  caa * 0.4), 0.001, 0.999)).b;
    color.rgb = mix(vec3(origR, origG, origB), vec3(shiftR, shiftG, shiftB), uChrash * mask);
  }
  // 8. Feedback tunnel (zoom+rotate prev-frame loop)
  if (uFeedback * mask > 0.001) {
    vec2 center = vec2(0.5);
    vec2 d = uv - center;
    float angle = uFeedback * mask * 0.06;
    float zm = 1.0 - uFeedback * mask * 0.04;
    float cs = cos(angle), sn = sin(angle);
    vec2 rotated = vec2(d.x * cs - d.y * sn, d.x * sn + d.y * cs);
    vec2 fbUv = clamp(center + rotated * zm, 0.001, 0.999);
    vec3 fbColor = texture2D(uPrevFrame, fbUv).rgb;
    color.rgb = mix(color.rgb, fbColor * vec3(0.97, 0.98, 1.02), uFeedback * mask);
  }
  // 9. Contour lines (iso-luminance neon overlay)
  if (uContour * mask > 0.001) {
    float l = lum(color.rgb);
    float bands = 5.0 + uContour * mask * 20.0;
    float wrapped = fract(l * bands);
    float edge = 1.0 - smoothstep(0.0, 0.12, min(wrapped, 1.0 - wrapped));
    vec3 lineColor = hsl2rgb(l * 0.6 + uTime * 0.03, 1.0, 0.6);
    color.rgb = mix(color.rgb, lineColor, edge * uContour * mask);
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
    color.rgb = mix(color.rgb, cellColor * fill, uAscii * mask);
  }
  // 11. Venetian blind (time-sliced horizontal band shuffle)
  if (uVenetian * mask > 0.001) {
    float bandCount = 6.0 + uVenetian * mask * 18.0;
    float bandIdx = floor(uv.y * bandCount);
    float t2 = uTime * (0.8 + uVenetian * mask * 1.5);
    float phase = fract(bandIdx * 0.618 + t2 * 0.15);
    float xShift = sin(bandIdx * 2.1 + t2) * uVenetian * mask * 0.14;
    vec2 bandUv = clamp(vec2(uv.x + xShift, uv.y), 0.001, 0.999);
    float blend = smoothstep(0.4, 0.6, phase);
    vec3 bandColor = mix(color.rgb, texture2D(uPrevFrame, bandUv).rgb, blend);
    color.rgb = mix(color.rgb, bandColor, uVenetian * mask);
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
    color.rgb = mix(color.rgb, glyphCol, uGlyph * mask);
  }
  // 14. CPU REAL PIXEL SORT — (block moved above DATAMOSH in v1.2.69 for
  // unified sort+mosh signal; see the relocated uSortMix * mask block
  // right before the DATAMOSH stage above.)
  // 15. HILBERT WALK SMEAR — folded into PIXEL SORT as MODE=4 (v1.2.59).
  // Pseudo-Hilbert quarter-turn walk: locality-preserving max-luma
  // propagation, no axis-aligned banding. Strength = uSortAmt.
  if (uSortAmt * mask > 0.001 && uSortMode > 3.5) {
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
    color.rgb = mix(color.rgb, best, uSortAmt * mask);
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
    color.rgb = mix(color.rgb, reactCol, uReact * mask);
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
    color.rgb = mix(color.rgb, best, uVoroSort * mask);
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
    float oR = sin(vUv.y * 47.0 + uTime * 1.7) * uRgbR * 0.08;
    float oG = sin(vUv.y * 73.0 + uTime * 1.1 + 1.7) * uRgbG * 0.08;
    float oB = sin(vUv.y * 31.0 + uTime * 0.6 + 3.1) * uRgbB * 0.08;
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
    float thresh = 1.0 - clamp(uHSync, 0.0, 1.0) * 0.45;
    if (roll > thresh) {
      float jump = (rand(vec2(row * 0.029, seed * 0.041)) - 0.5) * uHSync * 0.5;
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
  gl_FragColor = vec4(clamp(post, 0.0, 1.0), 1.0);
}
`;

// ── Custom Spectra logo (header chip) ──────────────────────
// Uses the canonical app icon so the header brand matches the splash and
// the Capacitor mobile app icon. `chromaShift` retained for back-compat
// (unused; the splash now applies its own RGB-split treatment directly).
function SpectraLogo({ size = 32, chromaShift = 2 }: { size?: number; chromaShift?: number }) {
  void chromaShift;
  const radius = Math.max(6, Math.round(size * 0.22));
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={SPECTRA_APP_ICON}
      alt="Spectra"
      width={size}
      height={size}
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        objectFit: "cover",
        boxShadow: "0 0 14px rgba(180,35,255,0.45)",
      }}
    />
  );
}

// ── Boot / load screen ───────────────────────────────────────
// Designed around the SPECTRA app icon: the icon sits centered, framed by
// concentric chromatic rings whose conic gradient sweeps to indicate load.
// The icon itself does a chromatic-aberration "settle" — RGB channels
// converge to perfect alignment as progress hits 100.
function BootScreen({ progress, done, onSkip }: { progress: number; done: boolean; onSkip: () => void }) {
  const chroma = (1 - progress / 100) * 9; // px split per channel
  const status = progress < 22 ? "SYS.INIT" : progress < 52 ? "SHADER.COMPILE" : progress < 84 ? "GL.PIPELINE" : "VISION.READY";
  const sweepDeg = (progress / 100) * 360;
  const ringScale = 0.92 + (progress / 100) * 0.10;
  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center"
      style={{
        background: "radial-gradient(circle at 50% 50%, #1820FF 0%, #000CFB 45%, #000470 100%)",
        opacity: done ? 0 : 1,
        pointerEvents: done ? "none" : "all",
        transition: "opacity 0.7s ease",
      }}
    >
      <style>{`
        @keyframes bootSpin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
        @keyframes bootSpinR { from{transform:rotate(0deg)} to{transform:rotate(-360deg)} }
        @keyframes bootBlink { 0%,80%,100%{opacity:.18} 90%{opacity:.6} }
        @keyframes bootPulse { 0%,100%{opacity:.35} 50%{opacity:.85} }
        @keyframes bootFadeIn { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:translateY(0)} }
        @keyframes bootIconBreathe { 0%,100%{filter:drop-shadow(0 0 24px rgba(211,75,255,.45))} 50%{filter:drop-shadow(0 0 38px rgba(255,160,255,.7))} }
      `}</style>

      {/* Subtle scanlines texture */}
      <div style={{
        position:"absolute", inset:0, pointerEvents:"none",
        backgroundImage:"repeating-linear-gradient(0deg,transparent,transparent 3px,rgba(176,20,240,.02) 3px,rgba(176,20,240,.02) 4px)",
      }}/>

      {/* Corner TL */}
      <div style={{position:"absolute",top:20,left:20,fontFamily:"'Courier New',monospace",fontSize:9,letterSpacing:"2px",color:"rgba(231,174,255,.35)",lineHeight:1.9,animation:"bootBlink 3.5s ease infinite"}}>
        SPECTRA OS · BUILD {process.env.NEXT_PUBLIC_BUILD_SHA || "dev"}<br/>GL_ES 1.0 · WEBGL<br/>PROC: REALTIME
      </div>
      {/* Corner TR */}
      <div style={{position:"absolute",top:20,right:20,fontFamily:"'Courier New',monospace",fontSize:9,letterSpacing:"2px",color:"rgba(231,174,255,.35)",lineHeight:1.9,textAlign:"right",animation:"bootBlink 3.5s ease infinite 1.4s"}}>
        PIPELINE: ACTIVE<br/>FX: MULTI-LAYER<br/>AUDIO: REACTIVE
      </div>
      {/* Corner BL */}
      <div style={{position:"absolute",bottom:20,left:20,fontFamily:"'Courier New',monospace",fontSize:9,letterSpacing:"2px",color:"rgba(231,174,255,.24)"}}>
        BOOT/{progress.toFixed(0).padStart(3,"0")}
      </div>
      {/* Corner BR */}
      <div style={{position:"absolute",bottom:20,right:20,fontFamily:"'Courier New',monospace",fontSize:9,letterSpacing:"2px",color:"rgba(231,174,255,.24)",textAlign:"right"}}>
        {new Date().getFullYear()} LOVEBEING
      </div>

      {/* Icon stage — concentric rings + the actual app icon */}
      <div style={{
        position:"relative", width:260, height:260, marginBottom:36,
        display:"flex", alignItems:"center", justifyContent:"center",
        animation:"bootFadeIn .9s ease both",
        transform:`scale(${ringScale})`, transition:"transform .25s ease",
      }}>
        {/* Outer chromatic sweep ring (progress indicator) */}
        <div style={{
          position:"absolute", inset:0, borderRadius:"50%",
          padding:2,
          background:`conic-gradient(from -90deg,
            rgba(255,30,200,.95) 0deg,
            rgba(120,90,255,.95) ${sweepDeg * 0.33}deg,
            rgba(40,220,255,.95) ${sweepDeg * 0.66}deg,
            rgba(255,255,255,.95) ${sweepDeg}deg,
            rgba(255,30,200,.05) ${sweepDeg + 0.5}deg,
            rgba(255,30,200,.05) 360deg)`,
          WebkitMask:"radial-gradient(circle, transparent 60%, #000 60%, #000 100%)",
          mask:"radial-gradient(circle, transparent 60%, #000 60%, #000 100%)",
          filter:"drop-shadow(0 0 18px rgba(211,75,255,.55))",
        }}/>
        {/* Slow rotating outer rim (always-on motion) */}
        <div style={{
          position:"absolute", inset:-8, borderRadius:"50%",
          border:"1px dashed rgba(231,174,255,.18)",
          animation:"bootSpin 18s linear infinite",
        }}/>
        {/* Counter-rotating inner ring */}
        <div style={{
          position:"absolute", inset:14, borderRadius:"50%",
          border:"1px solid rgba(120,40,200,.35)",
          animation:"bootSpinR 11s linear infinite",
        }}/>
        {/* Tick marks (12 around) */}
        {Array.from({length:12}).map((_,i)=>(
          <div key={i} style={{
            position:"absolute", left:"50%", top:"50%", width:2, height:6,
            background:"rgba(231,174,255,.45)",
            transform:`translate(-50%,-50%) rotate(${i*30}deg) translateY(-118px)`,
            opacity: i*30 <= sweepDeg ? 0.85 : 0.18,
            transition:"opacity .25s ease",
          }}/>
        ))}

        {/* The SPECTRA app icon, with chromatic-aberration that settles to 0 */}
        <div style={{
          position:"relative", width:160, height:160,
          animation:"bootIconBreathe 2.6s ease-in-out infinite",
        }}>
          {/* Red channel offset */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={SPECTRA_APP_ICON} alt="" aria-hidden width={160} height={160} style={{
            position:"absolute", inset:0, width:160, height:160, borderRadius:36,
            mixBlendMode:"screen", opacity:0.85,
            filter:"drop-shadow(0 0 0 transparent)",
            transform:`translate(${chroma}px,0)`,
            // Tint to red via hue-rotate trick on a lightly desaturated copy.
          }}/>
          {/* Blue channel offset */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={SPECTRA_APP_ICON} alt="" aria-hidden width={160} height={160} style={{
            position:"absolute", inset:0, width:160, height:160, borderRadius:36,
            mixBlendMode:"screen", opacity:0.85,
            transform:`translate(${-chroma}px,0)`,
          }}/>
          {/* Crisp center icon */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={SPECTRA_APP_ICON} alt="SPECTRA" width={160} height={160} style={{
            position:"absolute", inset:0, width:160, height:160, borderRadius:36,
            opacity: 0.6 + (progress/100)*0.4,
          }}/>
        </div>
      </div>

      {/* Wordmark — appears as load nears completion */}
      {/* v1.2.66 — rebrand artifact fix: was "SPECTRA". The app is now
          Glitch Pixel Studio (GPS); the splash wordmark should match.
          Smaller font + tighter spacing because GPS is short. */}
      <div style={{
        fontFamily:"'Courier New',monospace", fontSize:32, letterSpacing:"22px",
        color:"#F0E6FF", textTransform:"uppercase", marginBottom:10,
        textShadow:"0 0 24px rgba(211,75,255,.55)",
        animation:"bootFadeIn .8s ease .15s both",
        paddingLeft:22, // optical compensation for letter-spacing on last char
      }}>
        GPS
      </div>

      {/* Tagline */}
      <div style={{
        fontFamily:"'Courier New',monospace", fontSize:9, letterSpacing:"5px",
        color:"rgba(231,174,255,.5)", marginBottom:18, textTransform:"uppercase",
        animation:"bootFadeIn .8s ease .3s both",
      }}>
        computational vision engine
      </div>

      {/* Status label */}
      <div style={{
        fontFamily:"'Courier New',monospace", fontSize:10, letterSpacing:"4px",
        color:"rgba(231,174,255,.64)", animation:"bootPulse 1.5s ease infinite",
      }}>
        {status}
      </div>

      {/* Visible linear progress bar — confirms the loader is alive */}
      <div style={{
        marginTop: 22, width: 220, height: 6,
        background: "rgba(231,174,255,0.12)",
        borderRadius: 3, overflow: "hidden",
        boxShadow: "inset 0 0 6px rgba(0,0,0,0.6)",
      }}>
        <div style={{
          width: `${Math.min(100, Math.max(0, progress))}%`,
          height: "100%",
          background: "linear-gradient(90deg, rgba(255,30,200,0.95), rgba(120,90,255,0.95), rgba(40,220,255,0.95))",
          boxShadow: "0 0 8px rgba(211,75,255,0.7)",
          transition: "width 0.12s linear",
        }}/>
      </div>
      <div style={{
        marginTop: 8, fontFamily:"'Courier New',monospace", fontSize: 10,
        letterSpacing: "3px", color: "rgba(231,174,255,0.7)",
      }}>
        {Math.floor(progress).toString().padStart(3,"0")} / 100
      </div>

      {/* Tap-to-skip — appears after a short delay so users aren't stuck */}
      {progress >= 25 && (
        <button
          onClick={onSkip}
          style={{
            marginTop: 18,
            background: "transparent",
            border: "1px solid rgba(231,174,255,0.45)",
            color: "rgba(231,174,255,0.85)",
            fontFamily: "'Courier New',monospace",
            fontSize: 10, letterSpacing: "3px",
            padding: "6px 14px", borderRadius: 4,
            cursor: "pointer",
          }}
        >TAP TO ENTER ▶</button>
      )}
    </div>
  );
}



// ── Draw overlay helpers ─────────────────────────────────────
interface DrawPoint { x: number; y: number; pressure: number }
interface DrawStroke { points: DrawPoint[]; color: string; width: number; opacity: number; brush?: string }
interface SpectraPreset {
  name: string;
  mode: ModeId;
  gain: number;
  brightness: number;
  contrast: number;
  saturation: number;
  hueShift: number;
  scanlines: number;
  zoom: number;
  speed: number;
  sortAmt: number;
  scanTear: number;
  blockGlitch: number;
  datamosh: number;
  moshHard?: boolean;
  chrash: number;
  liquid: number;
  feedback: number;
  contour: number;
  ascii: number;
  venetian: number;
  sortKey: number;
  sortLow: number;
  sortHigh: number;
  sortMode?: number; // 0 LINE, 1 SPIRAL, 2 BLOCK, 3 SLICE, 4 HILBERT (older presets predate this field)
  sortSegment: number;
  sortRandom: number;
  sortWobble: number;
  moshIFrame: number;
  moshMotion: number;
  moshBleed: number;
  moshMap: number;
  moshDistort: number;
  kaleido?: number;
  disrupt?: number;
  disruptCount?: number;
  disruptSize?: number;
  disruptContrary?: number;
  tile?: number;
  invertSym?: number;
  droste?: number;
  spiral?: number;
  yantra?: number;
  mandala?: number;
  rosette?: number;
  starfold?: number;
  hexfold?: number;
  // Phase 1B (rack port): optional per-mode parameter snapshots. Older saved
  // presets predate the rack and will simply omit this field.
  paramsByMode?: Record<number, Record<string, number>>;
}

type ExportProfile = "native" | "vertical" | "square" | "widescreen";
type SessionStateV1 = {
  mode: ModeId;
  gain: number;
  brightness: number;
  contrast: number;
  saturation: number;
  hueShift: number;
  scanlines: number;
  zoom: number;
  speed: number;
  sortAmt: number;
  scanTear: number;
  blockGlitch: number;
  datamosh: number;
  moshHard: boolean;
  chrash: number;
  liquid: number;
  feedback: number;
  contour: number;
  ascii: number;
  venetian: number;
  sortKey: number;
  sortLow: number;
  sortHigh: number;
  sortMode?: number;
  sortSegment: number;
  sortRandom: number;
  sortWobble: number;
  moshIFrame: number;
  moshMotion: number;
  moshBleed: number;
  moshMap: number;
  moshDistort: number;
  kaleido?: number;
  disrupt?: number;
  disruptCount?: number;
  disruptSize?: number;
  disruptContrary?: number;
  tile?: number;
  invertSym?: number;
  droste?: number;
  spiral?: number;
  yantra?: number;
  mandala?: number;
  rosette?: number;
  starfold?: number;
  hexfold?: number;
  exportFormat: "gif" | "video";
  exportQuality: "standard" | "high" | "ultra";
  exportProfile: ExportProfile;
  openSections: string[];
  // Phase 1B (rack port): optional rack snapshot for session restore.
  paramsByMode?: Record<number, Record<string, number>>;
};

const PRESETS_KEY = "spectra-presets-v1";
const QUICK_SLOTS_KEY = "spectra-quick-slots-v1";
const SESSION_KEY = "spectra-session-v1";



// ── WebGL helpers ────────────────────────────────────────────
function compileShader(gl: WebGLRenderingContext, type: number, src: string): WebGLShader | null {
  const s = gl.createShader(type);
  if (!s) return null;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    console.error("Shader error:", gl.getShaderInfoLog(s));
    gl.deleteShader(s);
    return null;
  }
  return s;
}

// ══════════════════════════════════════════════════════════════
//  SPECTRA INTRO  — pixels storm in from offscreen and resolve
//  into the actual SPECTRA app icon, then crossfade to a clean
//  logo render before fading away.
// ══════════════════════════════════════════════════════════════
function SpectraIntro({ onDone }: { onDone: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [phase, setPhase] = useState<"forming" | "resolved" | "out" | "gone">("forming");
  const [iconReady, setIconReady] = useState(false);

  // Phase timing:
  //   0    – 1600ms  forming   (pixels fly in & ease into icon shape)
  //   1600 – 2600ms  resolved  (clean icon shows, wordmark fades in)
  //   2600 – 3300ms  out       (whole overlay fades to transparent)
  //   3300+          gone      (unmounts)
  // CRITICAL: keep onDone in a ref so phase timers don't reset every time
  // the parent re-renders (the boot ticker re-renders ~12×/sec, which used
  // to clear+restart these setTimeouts on every tick → intro never finished).
  const onDoneRef = useRef(onDone);
  useEffect(() => { onDoneRef.current = onDone; }, [onDone]);
  useEffect(() => {
    const t1 = setTimeout(() => setPhase("resolved"), 1600);
    const t2 = setTimeout(() => setPhase("out"), 2600);
    const t3 = setTimeout(() => { setPhase("gone"); onDoneRef.current(); }, 3300);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, []);

  useEffect(() => {
    const cv = canvasRef.current; if (!cv) return;
    const ctx = cv.getContext("2d"); if (!ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const resize = () => {
      cv.width  = Math.floor(window.innerWidth  * dpr);
      cv.height = Math.floor(window.innerHeight * dpr);
    };
    resize();
    window.addEventListener("resize", resize);

    let raf = 0;
    let cancelled = false;

    // Load the real app icon and sample it into a grid of cells.
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = SPECTRA_APP_ICON;

    img.onload = () => {
      if (cancelled) return;
      setIconReady(true);

      // Sample the icon into a fixed-resolution offscreen canvas.
      const SAMPLE = 192;
      const off = document.createElement("canvas");
      off.width = SAMPLE; off.height = SAMPLE;
      const octx = off.getContext("2d")!;
      octx.drawImage(img, 0, 0, SAMPLE, SAMPLE);
      const data = octx.getImageData(0, 0, SAMPLE, SAMPLE).data;

      // Layout the icon centered on screen.
      const W = window.innerWidth, H = window.innerHeight;
      const iconLogical = Math.min(W, H) * 0.42;
      const ox = (W - iconLogical) / 2;
      const oy = (H - iconLogical) / 2;
      const CELL = Math.max(4, Math.round(iconLogical / 64));
      const grid = Math.floor(iconLogical / CELL);

      type Cell = {
        tx: number; ty: number;          // target px (logical)
        sx: number; sy: number;          // start px (logical, offscreen)
        r: number; g: number; b: number; // sampled color
        delay: number;                   // ms before this cell starts
      };
      const cells: Cell[] = [];

      for (let gy = 0; gy < grid; gy++) {
        for (let gx = 0; gx < grid; gx++) {
          const u = (gx + 0.5) / grid;
          const v = (gy + 0.5) / grid;
          const sxi = Math.min(SAMPLE - 1, Math.floor(u * SAMPLE));
          const syi = Math.min(SAMPLE - 1, Math.floor(v * SAMPLE));
          const idx = (syi * SAMPLE + sxi) * 4;
          const r = data[idx], g = data[idx + 1], b = data[idx + 2], a = data[idx + 3];
          if (a < 24) continue;
          // Skip near-black background pixels so we don't draw a square outline.
          if (r + g + b < 18) continue;

          // Random offscreen start position, biased to outside the viewport.
          const angle = Math.random() * Math.PI * 2;
          const dist = Math.max(W, H) * (0.7 + Math.random() * 0.6);
          const cxScreen = W / 2;
          const cyScreen = H / 2;
          cells.push({
            tx: ox + gx * CELL,
            ty: oy + gy * CELL,
            sx: cxScreen + Math.cos(angle) * dist,
            sy: cyScreen + Math.sin(angle) * dist,
            r, g, b,
            delay: Math.random() * 700,
          });
        }
      }

      // Pre-render a clean copy of the icon for the resolved/crossfade pass.
      const iconCanvas = document.createElement("canvas");
      iconCanvas.width = Math.round(iconLogical * dpr);
      iconCanvas.height = Math.round(iconLogical * dpr);
      const ictx = iconCanvas.getContext("2d")!;
      ictx.imageSmoothingEnabled = true;
      ictx.imageSmoothingQuality = "high";
      ictx.drawImage(img, 0, 0, iconCanvas.width, iconCanvas.height);

      const startedAt = performance.now();
      const FORM_DUR = 1600; // ms — keep in sync with phase timer above

      const tick = () => {
        const now = performance.now();
        const t = now - startedAt;
        ctx.clearRect(0, 0, cv.width, cv.height);

        // Global progress for the resolve crossfade (0 -> 1 by FORM_DUR).
        const resolveK = Math.max(0, Math.min(1, (t - (FORM_DUR - 350)) / 350));

        // 1) Pixel storm: each cell flies from start -> target with cubic ease.
        if (resolveK < 1) {
          for (const c of cells) {
            const age = t - c.delay;
            if (age < 0) continue;
            const k = Math.max(0, Math.min(1, age / 900));
            const eased = 1 - Math.pow(1 - k, 3);
            const x = c.sx + (c.tx - c.sx) * eased;
            const y = c.sy + (c.ty - c.sy) * eased;
            const sz = CELL * (0.55 + 0.45 * eased);
            const alpha = (1 - resolveK) * (0.4 + 0.6 * eased);
            ctx.fillStyle = `rgba(${c.r},${c.g},${c.b},${alpha.toFixed(3)})`;
            ctx.shadowColor = `rgba(${c.r},${c.g},${c.b},${(0.5 * eased * (1 - resolveK)).toFixed(3)})`;
            ctx.shadowBlur = 10 * eased * dpr * (1 - resolveK);
            ctx.fillRect(
              (x + (CELL - sz) / 2) * dpr,
              (y + (CELL - sz) / 2) * dpr,
              sz * dpr,
              sz * dpr,
            );
          }
          ctx.shadowBlur = 0;
        }

        // 2) Crossfade in the clean icon as cells settle.
        if (resolveK > 0) {
          ctx.globalAlpha = resolveK;
          ctx.drawImage(iconCanvas, ox * dpr, oy * dpr, iconLogical * dpr, iconLogical * dpr);
          ctx.globalAlpha = 1;
        }

        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    };

    img.onerror = () => {
      // Fallback: show a magenta gradient circle so we never get stuck on black.
      setIconReady(true);
      const W = window.innerWidth, H = window.innerHeight;
      const r = Math.min(W, H) * 0.18;
      const grad = ctx.createRadialGradient(W * dpr / 2, H * dpr / 2, 0, W * dpr / 2, H * dpr / 2, r * dpr);
      grad.addColorStop(0, "#e7aeff");
      grad.addColorStop(1, "rgba(176,20,240,0)");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, cv.width, cv.height);
    };

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);

  if (phase === "gone") return null;
  const opacity = phase === "out" ? 0 : 1;
  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 9999,
        background: "#000CFB",
        display: "flex", alignItems: "center", justifyContent: "center",
        opacity,
        transition: "opacity 700ms ease-out",
        pointerEvents: phase === "out" ? "none" : "auto",
      }}
    >
      <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block" }}/>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
//  BUG REPORT MODAL
// ══════════════════════════════════════════════════════════════
function BugReportModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  if (!open) return null;

  const submit = () => {
    const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
    const url = typeof window !== "undefined" ? window.location.href : "";
    const subj = encodeURIComponent(`[SPECTRA bug] ${subject || "(no subject)"}`);
    const fullBody = `${body}\n\n----\nURL: ${url}\nUA:  ${ua}\nDate: ${new Date().toISOString()}`;
    const mailto = `mailto:1800bobrossdotcom@gmail.com?subject=${subj}&body=${encodeURIComponent(fullBody)}`;
    window.location.href = mailto;
    onClose();
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 10000,
        background: "rgba(0,0,0,0.85)",
        backdropFilter: "blur(6px)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 20, fontFamily: "'Courier New',monospace",
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: "min(520px, 100%)",
          background: "linear-gradient(180deg,#1a0028 0%,#0a0014 100%)",
          border: "1px solid rgba(176,20,240,0.55)",
          borderRadius: 12,
          boxShadow: "0 0 40px rgba(176,20,240,0.35), inset 0 1px 0 rgba(255,255,255,0.06)",
          padding: 20,
          color: "#fff",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div style={{ fontSize: 12, letterSpacing: "3px", color: "rgba(231,174,255,0.95)" }}>REPORT A BUG</div>
          <button
            onClick={onClose}
            style={{
              background: "transparent", border: "1px solid rgba(255,255,255,0.2)",
              color: "#fff", borderRadius: 6, width: 28, height: 28, cursor: "pointer", fontSize: 14,
            }}
            aria-label="Close"
          >×</button>
        </div>
        <div style={{ fontSize: 10, color: "rgba(255,255,255,0.55)", marginBottom: 10, letterSpacing: "1px" }}>
          Sends an email to <span style={{ color: "rgba(231,174,255,0.95)" }}>1800bobrossdotcom@gmail.com</span> with what you describe plus your browser info.
        </div>
        <input
          value={subject}
          onChange={e => setSubject(e.target.value)}
          placeholder="Short summary…"
          style={{
            width: "100%", marginBottom: 8,
            padding: "10px 12px", borderRadius: 6,
            background: "#000", color: "#fff",
            border: "1px solid rgba(176,20,240,0.4)",
            fontFamily: "inherit", fontSize: 12, outline: "none",
          }}
        />
        <textarea
          value={body}
          onChange={e => setBody(e.target.value)}
          placeholder="What happened? What were you doing? What did you expect?"
          rows={7}
          style={{
            width: "100%", marginBottom: 12,
            padding: "10px 12px", borderRadius: 6,
            background: "#000", color: "#fff",
            border: "1px solid rgba(176,20,240,0.4)",
            fontFamily: "inherit", fontSize: 12, outline: "none", resize: "vertical",
          }}
        />
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button
            onClick={onClose}
            style={{
              padding: "8px 14px", borderRadius: 6, cursor: "pointer", fontSize: 11, letterSpacing: "1.5px",
              background: "transparent", color: "rgba(255,255,255,0.7)",
              border: "1px solid rgba(255,255,255,0.2)", fontFamily: "inherit",
            }}
          >CANCEL</button>
          <button
            onClick={submit}
            style={{
              padding: "8px 14px", borderRadius: 6, cursor: "pointer", fontSize: 11, letterSpacing: "1.5px",
              background: "linear-gradient(180deg,#3A0852,#1A0224)",
              color: "#fff",
              border: "1px solid rgba(231,174,255,0.7)",
              boxShadow: "0 0 14px rgba(176,20,240,0.4)",
              fontFamily: "inherit",
            }}
          >SEND →</button>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
//  saveBlobToDevice — cross-platform save
//  Web: triggers <a download>. Capacitor (Android/iOS): writes the
//  blob to the cache directory and pops the native share sheet so the
//  user can route it to Photos / Files / a chat app. Without this the
//  on-device download anchor is silently ignored on the WebView.
// ══════════════════════════════════════════════════════════════
//  ENTITLEMENT MODEL — paid one-time vs. studio subscription.
//
//  There is NO free tier. The app requires a $3.99 one-time purchase
//  ("paid") OR a $6.90/mo subscription ("studio") to be unlocked.
//
//  GRACE PERIOD: every install gets 3 minutes of CUMULATIVE usage time
//  (counted only while the app is foregrounded) before the lock screen
//  appears. The remaining grace ms is persisted to localStorage so closing
//  and re-opening the app does not reset it.
//
//  Until billing is wired (next release), entitlement can be unlocked
//  manually with the dev codes:
//    "4200" → paid (lifetime)
//    "6900" → studio (subscription)
//    "0000" → reset to locked
//  Tap the version label 5 times on the lock screen to reveal the input.
// ══════════════════════════════════════════════════════════════
export type Entitlement = "paid" | "studio" | null;

export const APP_VERSION = "1.2.66";

// v1.2.51 — extended to 30 minutes for paid-tier QA / debugging passes.
const GRACE_TOTAL_MS = 30 * 60 * 1000; // 30 minutes (testing)
const ENT_KEY = "gps.entitlement";
// v1.2.51 — bumped key so devices that were capped at the old 3-minute
// total (or already burned through it) get a fresh 30-minute seed on
// first launch of this build instead of inheriting a near-zero balance.
const GRACE_KEY = "gps.graceRemainingMs.v2";
const GRACE_INSTALL_KEY = "gps.graceInstallTs.v2";

function loadEntitlement(): Entitlement {
  try {
    const v = localStorage.getItem(ENT_KEY);
    if (v === "paid" || v === "studio") return v;
  } catch { /* ignore */ }
  return null;
}
function saveEntitlement(ent: Entitlement) {
  try {
    if (ent === null) localStorage.removeItem(ENT_KEY);
    else localStorage.setItem(ENT_KEY, ent);
  } catch { /* ignore */ }
}
function loadGraceRemaining(): number {
  try {
    const raw = localStorage.getItem(GRACE_KEY);
    if (raw === null) {
      // First launch — seed full grace and stamp install time.
      localStorage.setItem(GRACE_KEY, String(GRACE_TOTAL_MS));
      localStorage.setItem(GRACE_INSTALL_KEY, String(Date.now()));
      return GRACE_TOTAL_MS;
    }
    const n = parseInt(raw, 10);
    if (!Number.isFinite(n) || n < 0) return 0;
    return Math.min(n, GRACE_TOTAL_MS);
  } catch { return GRACE_TOTAL_MS; }
}
function saveGraceRemaining(ms: number) {
  try { localStorage.setItem(GRACE_KEY, String(Math.max(0, ms | 0))); } catch { /* ignore */ }
}

export const TIER_FEATURES = {
  paid: [
    "All 14 visual modes (NIGHT, THERMAL, EDGE, MELT, MIRROR …)",
    "PXL · MOSH · BOTH layer modes + full PIXEL SORT rack",
    "RUPTURE · H-SYNC RGBNDR rack",
    "FX SETTINGS: full DISRUPT / KALEIDO controls",
    "Generator (incommensurate-flow synth source)",
    "DRAW mode — paint where FX appear",
    "FACE FX — face detection, FACE-ONLY / BG-ONLY, face-reactive MELT",
    "Audio reactivity (mic → bass / treble / beat)",
    "Presets: save · load · export · quick-slots",
    "Unlimited recording length, photo + GIF + video export",
    "No watermark · saves to Documents/Spectra/",
    "Lifetime updates to the core app",
  ],
  studio: [
    "Everything in PAID, plus rolling bonus panels:",
    "AUDIO REACT XL — per-knob LFO/envelope routing",
    "SHADER LAB — paste custom GLSL passes",
    "CLOUD PRESETS — sync + public gallery",
    "AI STYLE — on-device style transfer",
    "MULTI-CAM — overlay two camera feeds",
    "MIDI IN — bind hardware controllers to knobs",
    "TIMELINE — keyframe automation lane",
    "EXPORT XL — 4K · ProRes · alpha exports",
  ],
} as const;
// ══════════════════════════════════════════════════════════════
async function saveBlobToDevice(blob: Blob, filename: string): Promise<void> {
  const isNative = (() => {
    try { return Capacitor.isNativePlatform?.() === true; } catch { return false; }
  })();

  if (!isNative) {
    // Browser path — anchor click.
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      try { document.body.removeChild(a); } catch {}
      URL.revokeObjectURL(url);
    }, 1000);
    return;
  }

  // Capacitor path — base64 → cache file → Share sheet.
  const base64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const result = String(reader.result || "");
      // result is "data:<mime>;base64,<payload>"
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.readAsDataURL(blob);
  });

  const written = await Filesystem.writeFile({
    path: filename,
    data: base64,
    directory: Directory.Cache,
    recursive: true,
  });
  void written;

  // ── PRIMARY: MediaStore via @capacitor-community/media. This is the
  // ONLY way on Android 11+ scoped storage to get a file into the real
  // gallery (Photos / Google Photos / Files) without legacy
  // WRITE_EXTERNAL_STORAGE. We hand it the cache file URI and the
  // plugin uses MediaStore.Images / MediaStore.Video to insert it
  // into the user's camera roll under the GlitchPixelStudio album.
  const isVideo = /\.(mp4|webm|mov)$/i.test(filename);
  const cacheUri = written?.uri ?? "";
  const baseName = filename.replace(/\.[^.]+$/, "");
  let savedTo: string | null = null;
  if (cacheUri) {
    try {
      const resp = isVideo
        ? await Media.saveVideo({ path: cacheUri, albumIdentifier: "GlitchPixelStudio", fileName: baseName })
        : await Media.savePhoto({ path: cacheUri, albumIdentifier: "GlitchPixelStudio", fileName: baseName });
      savedTo = resp?.filePath ?? `Gallery / GlitchPixelStudio / ${filename}`;
    } catch (mediaErr) {
      // Album probably doesn't exist yet — create it then retry once.
      try {
        await Media.createAlbum({ name: "GlitchPixelStudio" });
        const resp2 = isVideo
          ? await Media.saveVideo({ path: cacheUri, albumIdentifier: "GlitchPixelStudio", fileName: baseName })
          : await Media.savePhoto({ path: cacheUri, albumIdentifier: "GlitchPixelStudio", fileName: baseName });
        savedTo = resp2?.filePath ?? `Gallery / GlitchPixelStudio / ${filename}`;
      } catch (mediaErr2) {
        void mediaErr; void mediaErr2;
      }
    }
  }

  // ── FALLBACK: legacy Filesystem writes to DCIM/Movies/Pictures/
  // Documents. Only relevant on devices/old API levels where the
  // MediaStore plugin failed (e.g. permission denied, very old build).
  if (!savedTo) {
    const galleryFolder = isVideo
      ? `Movies/GlitchPixelStudio/${filename}`
      : `DCIM/GlitchPixelStudio/${filename}`;
    try {
      await Filesystem.writeFile({
        path: galleryFolder,
        data: base64,
        directory: Directory.ExternalStorage,
        recursive: true,
      });
      savedTo = galleryFolder;
    } catch (err) {
      void err;
      try {
        await Filesystem.writeFile({
          path: `Pictures/GlitchPixelStudio/${filename}`,
          data: base64,
          directory: Directory.ExternalStorage,
          recursive: true,
        });
        savedTo = `Pictures/GlitchPixelStudio/${filename}`;
      } catch (err2) {
        void err2;
        try {
          await Filesystem.writeFile({
            path: `GlitchPixelStudio/${filename}`,
            data: base64,
            directory: Directory.Documents,
            recursive: true,
          });
          savedTo = `Documents/GlitchPixelStudio/${filename}`;
        } catch (err3) { void err3; }
      }
    }
  }
  // Fire a transient browser-style notification via console + window
  // event the UI can pick up to show a toast. Toast handler is in the
  // main component.
  try {
    window.dispatchEvent(new CustomEvent("gps-saved", {
      detail: { filename, path: savedTo ?? "phone storage" },
    }));
  } catch { /* noop */ }
}

// ══════════════════════════════════════════════════════════════
//  MAIN COMPONENT
// ══════════════════════════════════════════════════════════════
export default function SpectraAfter() {
    // ── Mask for touch-interactive FX
    const maskCanvasRef = useRef<HTMLCanvasElement>(null);
    const maskTextureRef = useRef<WebGLTexture|null>(null);
    // ── Face FX person-segmentation mask (R-channel WebGL texture).
    const faceTextureRef = useRef<WebGLTexture|null>(null);
    const faceMaskCanvasRef = useRef<HTMLCanvasElement|null>(null);

    // ── Audio-reactive FX
    const audioLevelRef = useRef(0);
    // Frequency-domain reactivity (bass / treble) and beat impulse.
    const audioBassRef   = useRef(0);
    const audioTrebleRef = useRef(0);
    const audioBeatRef   = useRef(0); // rising-edge bass impulse, decays each frame
    const audioBassAvgRef = useRef(0); // long-term bass average for beat detection
    const audioFreqArrayRef: React.MutableRefObject<Uint8Array | null> = useRef<Uint8Array | null>(null);
    const audioStreamRef = useRef<MediaStream|null>(null);
    const audioAnalyserRef = useRef<AnalyserNode|null>(null);
    const audioDataArrayRef: React.MutableRefObject<Uint8Array | null> = useRef<Uint8Array | null>(null);
    const [audioActive, setAudioActive] = useState(false);
  // ── Boot state
  const [bootProgress, setBootProgress] = useState(0);
  const [bootDone, setBootDone] = useState(false);
  // v1.2.83 — JS-driven landscape detection. Earlier attempts to
  // reflow via CSS media queries had inconsistent results across the
  // various WebView builds Capacitor ships, so we observe the
  // viewport directly and apply layout via inline className/style.
  const [isLandscape, setIsLandscape] = useState(false);
  useEffect(() => {
    const update = () => {
      if (typeof window === "undefined") return;
      setIsLandscape(window.innerWidth > window.innerHeight && window.innerHeight < 600);
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
    };
  }, []);
  // ── First-load intro + bug report modal
  const [introVisible, setIntroVisible] = useState(true);
  const [bugOpen, setBugOpen] = useState(false);
  // ── Processing overlay (GIF/video encode + save). null = hidden.
  const [processingStatus, setProcessingStatus] = useState<{ label: string; pct?: number } | null>(null);
  // ── Saved-to-phone toast. Listens to the "gps-saved" CustomEvent
  // dispatched from saveBlobToDevice and shows a transient banner so
  // the user knows the file landed on their phone (no Share sheet).
  const [savedToast, setSavedToast] = useState<{ filename: string; path: string } | null>(null);
  // ── Accordion state for the glass-mode panel: only one SynthPanel
  // open at a time, default all collapsed so the bottom 1/4 of the
  // screen can show the full panel list as title strips.
  // v1.2.81 — default to opening the PIXEL GENERATOR panel so users
  // immediately see/feel the procedural texture controls instead of
  // landing on a quiet pixel-sort screen and wondering if anything works.
  const [openPanelTitle, setOpenPanelTitle] = useState<string | null>(null);
  const accordionCtx = useMemo(
    () => ({ openTitle: openPanelTitle, setOpenTitle: setOpenPanelTitle }),
    [openPanelTitle]
  );
  useEffect(() => {
    const onSaved = (e: Event) => {
      const ce = e as CustomEvent<{ filename: string; path: string }>;
      setSavedToast(ce.detail);
      window.setTimeout(() => setSavedToast(null), 3200);
    };
    window.addEventListener("gps-saved", onSaved as EventListener);
    return () => window.removeEventListener("gps-saved", onSaved as EventListener);
  }, []);

  // ── Source
  const [cameraActive, setCameraActive] = useState(false);
  // v1.2.46: boot facing the user — combined with FACE FX = BG and a
  // little SORT amount, the app shows its mask + glitch effect on the
  // viewer's first frame so the value prop is immediately visible.
  const [cameraFacing, setCameraFacing] = useState<"environment"|"user">("user");
  const [sourceError, setSourceError] = useState<string|null>(null);
  const [shaderError, setShaderError] = useState<string|null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream|null>(null);
  const startCameraInFlightRef = useRef(false);
  // v1.2.74 — explicit user intent for the camera being on. Set true at
  // the top of startCamera(), set false in stopCamera(). Replaces the old
  // sourceMode === "camera" intent check which broke GEN+CAM.
  const cameraIntentRef = useRef(false);

  // ── Upload source (image / gif / short video) — feeds the same texture path
  type SourceMode = "camera" | "upload" | "generator";
  // Boot policy: start in CAMERA mode so the live image is the default canvas.
  // v1.2.82 — default sourceMode = "generator" so first launch lands
  // in GEN+CAM (the auto-start-camera effect below fires because
  // faceFxMode defaults to "BG", which kicks the segmenter and the
  // person-over-source composite). User opens the app and immediately
  // sees the procedural FX wrapping their selfie.
  const [sourceMode, setSourceMode] = useState<SourceMode>("generator");
  const [uploadName, setUploadName] = useState<string | null>(null);
  const [uploadKind, setUploadKind] = useState<"image" | "video" | null>(null);
  // v1.2.98 — ref default must match state default. Was "camera", which
  // caused the very first render() to take the camera branch (and skip
  // the GEN+CAM composite) before the sync useEffect could catch up.
  const sourceModeRef = useRef<SourceMode>("generator");
  const uploadImgRef = useRef<HTMLImageElement | null>(null);
  const uploadVideoRef = useRef<HTMLVideoElement | null>(null);
  const uploadObjectUrlRef = useRef<string | null>(null);
  const sourceFileInputRef = useRef<HTMLInputElement>(null);

  // ── Pixel generator (procedural texture source) — feeds shader → pxl/mosh
  const GEN_STYLES = [
    "BAYER", "HALFT", "MOSAIC", "VORON", "GRID",
    "STRIP", "CHECK", "PLASMA", "WAVES", "RINGS",
    "DOTS", "ASCII", "BRICK", "HEX", "ISO",
    "RGBSP", "NOISE", "WORM", "SHARDS", "STAIR",
    "CIRCS", "CROSS", "WEAVE", "DIAMOND", "GLITCH",
    "TRUCH", "BAY8", "STACK", "FLOWL", "RIBON", "ORBIT",
    "PLIFE", "DLAUN", "BOIDS", "REACT", "LSYST",
  ] as const;
  type GenStyle = typeof GEN_STYLES[number];

  // ── Family / variant matrix — mirrors STYLE_SPECS inside drawPixelGenerator.
  // Lets the FAMILY/VARIANT knobs in the rack drive genStyle without exposing
  // a 36-button preset grid. Empty slots fall back to slot 0 of that family.
  const FAMILY_NAMES = [
    "AUTOMATA","REACT-DIFF","FLOW-WAVE","DITHER","FRACTAL",
    "PIXSORT","FLOWFLD","VORONOI","TRUCHET","GLITCH",
  ] as const;
  const STYLE_BY_FV: ReadonlyArray<ReadonlyArray<GenStyle>> = [
    ["PLIFE",  "WAVES", "CHECK",  "LSYST"],
    ["REACT",  "MOSAIC","PLASMA", "REACT"],
    ["RIBON",  "ORBIT", "STAIR",  "STACK"],
    ["BAYER",  "BAY8",  "BRICK",  "STRIP"],
    ["RINGS",  "CIRCS", "SHARDS", "CROSS"],
    ["WEAVE",  "WEAVE", "FLOWL",  "RGBSP"],
    ["BOIDS",  "WORM",  "NOISE",  "DIAMOND"],
    ["VORON",  "DOTS",  "HALFT",  "HEX"],
    ["TRUCH",  "GRID",  "ISO",    "TRUCH"],
    ["GLITCH", "GLITCH","ASCII",  "GLITCH"],
  ];
  const FV_BY_STYLE: Record<string, [number, number]> = {
    PLIFE:[0,0], WAVES:[0,1], CHECK:[0,2], LSYST:[0,3],
    REACT:[1,0], MOSAIC:[1,1], PLASMA:[1,2],
    RIBON:[2,0], ORBIT:[2,1], STAIR:[2,2], STACK:[2,3],
    BAYER:[3,0], BAY8:[3,1], BRICK:[3,2], STRIP:[3,3],
    RINGS:[4,0], CIRCS:[4,1], SHARDS:[4,2], CROSS:[4,3],
    WEAVE:[5,1], FLOWL:[5,2], RGBSP:[5,3],
    BOIDS:[6,0], WORM:[6,1], NOISE:[6,2], DIAMOND:[6,3],
    VORON:[7,0], DOTS:[7,1], HALFT:[7,2], HEX:[7,3],
    TRUCH:[8,0], GRID:[8,1], ISO:[8,2],
    GLITCH:[9,0], ASCII:[9,2],
  };

  // Color palettes for the generator. MONO is pure grayscale (true monochrome).
  // CUSTOM hands control back to the HUE/SPREAD/SAT knobs.
  const GEN_PALETTES = {
    MONO:    { hue: 0.00, spread: 0.00, sat: 0.00, cycle: false }, // grayscale
    WARM:    { hue: 0.05, spread: 0.12, sat: 0.88, cycle: true  },
    COOL:    { hue: 0.55, spread: 0.12, sat: 0.88, cycle: true  },
    PINK:    { hue: 0.92, spread: 0.10, sat: 0.95, cycle: true  },
    ACID:    { hue: 0.30, spread: 0.18, sat: 1.00, cycle: true  },
    RAINBOW: { hue: 0.00, spread: 1.00, sat: 0.95, cycle: true  },
    CUSTOM:  { hue: -1,   spread: -1,   sat: -1,   cycle: false }, // sentinel: use knobs
  } as const;
  type GenPalette = keyof typeof GEN_PALETTES;
  const GEN_PALETTE_KEYS = ["MONO","WARM","COOL","PINK","ACID","RAINBOW","CUSTOM"] as const;
  const [genPalette, setGenPalette] = useState<GenPalette>("MONO");
  const [genAutoCycle, setGenAutoCycle] = useState(false);
  const genPaletteRef = useRef<GenPalette>("MONO");
  const genAutoCycleRef = useRef(false);
  const genHueCycleRef = useRef(0); // 0..1 slow drift counter
  // Heavily smoothed motion shadows used by the generator so evolution is
  // continuous and never resets/snaps frame-to-frame. Raw motion refs stay
  // untouched for other consumers.
  const genDriveSmoothRef = useRef(0);
  const genTiltXSmoothRef = useRef(0);
  const genTiltYSmoothRef = useRef(0);
  const genPushSmoothRef  = useRef(0);
  // Persistent organic offsets — slow LFOs that keep the pattern wandering
  // even when the device is perfectly still.
  const genFlowXRef = useRef(0);
  const genFlowYRef = useRef(0);
  const [genStyle, setGenStyle] = useState<GenStyle>("BAYER");
  const [genResolution, setGenResolution] = useState(48);     // base cell density (8..160)
  const [genDensity, setGenDensity] = useState(0.55);         // shape fill (0..1)
  const [genScale, setGenScale] = useState(1.0);              // pattern scale (0.25..4)
  const [genSpeed, setGenSpeed] = useState(0.6);              // animation speed (0..3)
  const [genHue, setGenHue] = useState(0.78);                 // base hue rotation (0..1)
  const [genHueSpread, setGenHueSpread] = useState(0.35);     // palette spread (0..1)
  const [genSat, setGenSat] = useState(0.85);                 // saturation (0..1)
  const [genContrastG, setGenContrastG] = useState(0.7);      // contrast (0..1)
  const [genWarp, setGenWarp] = useState(0.25);               // domain warp (0..1)
  const [genJitter, setGenJitter] = useState(0.15);           // per-cell jitter (0..1)
  const [genSeed, setGenSeed] = useState(7);                  // integer seed (0..999)
  const [genInvert, setGenInvert] = useState(false);
  // Per-layer datamosh blend movement (edits the selected layer; broadcasts when MASTER).
  const [genMoshX, setGenMoshX] = useState(0);                // -1..1
  const [genMoshY, setGenMoshY] = useState(0);                // -1..1
  const [genScatter, setGenScatter] = useState(0);            // 0..1 sustained
  const [genScatterMode, setGenScatterMode] = useState(0);    // 0..3 SHIFT/BURST/SHRED/FREEZE
  // ── AUTOMATE (generator only): drifts the gen knobs over time toward
  //    fresh random targets, like an LFO on every dial.
  const [automateOn, setAutomateOn] = useState(false);
  const [automateRate, setAutomateRate] = useState(0.45);     // 0..1 (slow..fast)
  const [automateStyles, setAutomateStyles] = useState(false); // also rotate gen STYLE
  const [automateBlend, setAutomateBlend] = useState(false);   // also rotate pixel BLEND
  // ── LOW POWER: caps render to ~30fps by skipping every other RAF tick.
  //    Phones run noticeably cooler with this on, especially in PXL/MOSH.
  const [lowPowerOn, setLowPowerOn] = useState(false);
  const lowPowerRef = useRef(false);
  const lowPowerSkipRef = useRef(false);
  useEffect(() => { lowPowerRef.current = lowPowerOn; }, [lowPowerOn]);
  // v1.2.55 — BATTERY-AWARE auto low-power. Independent of the user's
  // manual LOW POWER toggle so we don't overwrite their preference.
  // The render skip-frame check honours either flag.
  const batteryLowRef = useRef(false);
  // v1.2.55 — ADAPTIVE RENDER RESOLUTION. When the rolling frametime
  // average crosses ~22 ms (sustained <45 fps) we drop the canvas DPR
  // multiplier to 0.75x to recover headroom; when it sits below ~14 ms
  // (>70 fps) for two solid seconds we restore 1.0x. The resize()
  // callback multiplies dpr by this value when sizing the GL canvas
  // and FBO textures, so flipping the scale + calling resize() is the
  // entire mechanism.
  const renderScaleRef = useRef(1.0);
  const frametimeAvgRef = useRef(16.7);
  const lastFrameTsRef = useRef(0);
  const fastFrameStreakRef = useRef(0);
  // v1.2.55 — UNIFORM SHADOW CACHE. ~60 uniform writes happen every
  // render. Most are slider/ref values that don't change frame-to-frame.
  // We diff against this Map keyed by WebGLUniformLocation and skip the
  // gl.uniform* call when the value is unchanged. For float vectors we
  // pack components into a delimited string for a cheap equality check.
  const uniCacheRef = useRef(new Map<WebGLUniformLocation, number | string>());

  // v1.2.57 — Phase 4 GFX. Track per-texture sized state so we can use
  // texSubImage2D for the steady-state per-frame uploads (camera + mask)
  // instead of texImage2D, which avoids a driver-side reallocation +
  // texture-completeness check on every frame. We re-seed with
  // texImage2D only when the source dimensions change (rare).
  const cameraTexSizedRef = useRef({ w: 0, h: 0 });
  const maskTexSizedRef = useRef({ w: 0, h: 0 });
  // v1.2.57 — alternate audio analyser updates so the FFT + RMS loop
  // runs at ~30 Hz instead of 60 Hz. Audio energy doesn't change
  // meaningfully faster than that and the cached gate is what the
  // shader sees. Frees CPU on the render thread.
  const audioFrameToggleRef = useRef(0);

  // v1.2.55 — BATTERY-AWARE FRAMERATE CAP. When the device is below 20%
  // and not actively charging, flip batteryLowRef on so the render loop's
  // skip-frame check halves the framerate. Listens for both level and
  // charging changes so plugging in instantly restores full speed. The
  // BatteryManager API is unavailable in some Capacitor WebView versions
  // and on iOS Safari — we silently skip when getBattery isn't a function.
  useEffect(() => {
    if (typeof navigator === "undefined") return;
    type BatteryManager = {
      level: number;
      charging: boolean;
      addEventListener: (ev: string, cb: () => void) => void;
      removeEventListener: (ev: string, cb: () => void) => void;
    };
    const navAny = navigator as unknown as { getBattery?: () => Promise<BatteryManager> };
    if (typeof navAny.getBattery !== "function") return;
    let bm: BatteryManager | null = null;
    let cancelled = false;
    const update = () => {
      if (!bm) return;
      batteryLowRef.current = bm.level < 0.2 && !bm.charging;
    };
    navAny.getBattery!().then(b => {
      if (cancelled) return;
      bm = b;
      update();
      bm.addEventListener("levelchange", update);
      bm.addEventListener("chargingchange", update);
    }).catch(() => { /* unsupported, no-op */ });
    return () => {
      cancelled = true;
      if (bm) {
        bm.removeEventListener("levelchange", update);
        bm.removeEventListener("chargingchange", update);
      }
      batteryLowRef.current = false;
    };
  }, []);

  // ── NEON MODE: glass / transparent panels + tilt parallax.
  //    Off by default — opt-in display tweak. Auto-disables tilt parallax
  //    while recording or in LOW POWER to keep captures and battery clean.
  // Glass mode is the default — full-screen FX with translucent panel overlay.
  // Glass/neon mode is now permanent — the toggle button was removed in
  // v1.2.45 since glass-bottom-boat is the only intended look. Keep the
  // boolean as a const so existing className/effect branches continue to
  // work without rippling changes through the file.
  const neonMode = true;
  const tiltRootRef = useRef<HTMLDivElement>(null);
  // ── FACE FX cycle: universal mask that gates ALL FX inside or
  //    outside an AI-segmented person. Uses MediaPipe Tasks Vision
  //    (selfie segmenter) for true per-pixel rotoscoping. Falls back
  //    to a centered selfie-cam oval if the model can't load (e.g. no
  //    network on first run before assets are cached).
  //    OFF  → no face-driven masking
  //    FACE → only the person/face area receives FX, background stays clean
  //    BG   → only the background receives FX, person stays clean
  type FaceFxMode = "OFF" | "FACE" | "BG";
  // v1.2.83: default to FACE so FX wrap the SUBJECT (foreground person)
  // — the user wanted to see procedural FX painting THEIR body, not the
  // wall behind them. Background segmentation hid the effect.
  const [faceFxMode, setFaceFxMode] = useState<FaceFxMode>("FACE");
  // v1.2.53 — ref mirror so the camera-acquire path can re-check the
  // user's current intent after each await without re-binding the closure.
  const faceFxModeRef = useRef<FaceFxMode>("FACE");
  useEffect(() => { faceFxModeRef.current = faceFxMode; }, [faceFxMode]);
  const [faceFxToast, setFaceFxToast] = useState<string | null>(null);
  const faceFxRef = useRef<{ active: boolean; invert: boolean; texValid: boolean; cx: number; cy: number; r: number; }>({
    active: false, invert: false, texValid: false, cx: 0.5, cy: 0.42, r: 0.28,
  });
  const cycleFaceFx = useCallback(() => {
    setFaceFxMode(m => {
      const next: FaceFxMode = m === "OFF" ? "FACE" : m === "FACE" ? "BG" : "OFF";
      setFaceFxToast(
        next === "OFF" ? "FACE FX · OFF"
        : next === "FACE" ? "FACE FX · PERSON-ONLY (AI roto)"
        : "FACE FX · BG-ONLY (AI roto)"
      );
      window.setTimeout(() => setFaceFxToast(null), 2200);
      return next;
    });
  }, []);
  // ── TIER info modal toggle (read-only feature matrix).
  const [tierInfoOpen, setTierInfoOpen] = useState(false);

  // ── Entitlement + grace period.
  // entitlement: null = locked, "paid" = lifetime, "studio" = subscriber.
  // graceRemaining: ms of free usage left (counts down only while app open).
  // locked: derived — true when no entitlement AND no grace remaining.
  const [entitlement, setEntitlement] = useState<Entitlement>(() =>
    (typeof window !== "undefined" ? loadEntitlement() : null));
  const [graceRemaining, setGraceRemaining] = useState<number>(() =>
    (typeof window !== "undefined" ? loadGraceRemaining() : GRACE_TOTAL_MS));
  const [unlockInputVisible, setUnlockInputVisible] = useState(false);
  const [unlockCode, setUnlockCode] = useState("");
  const versionTapsRef = useRef(0);
  const versionTapTimerRef = useRef<number | null>(null);
  const locked = entitlement === null && graceRemaining <= 0;

  // Tick the grace counter once per second while foregrounded and unlocked.
  // Pauses automatically when the tab/app is hidden (visibilitychange).
  // Effect deps intentionally exclude graceRemaining — we use the functional
  // setState form so the interval doesn't have to be torn down each tick.
  useEffect(() => {
    if (entitlement !== null) return; // unlocked → no tick needed
    let last = Date.now();
    let stopped = false;
    const tick = () => {
      if (stopped) return;
      if (typeof document !== "undefined" && document.visibilityState !== "visible") {
        last = Date.now();
        return;
      }
      const now = Date.now();
      const dt = now - last;
      last = now;
      setGraceRemaining(prev => {
        const next = Math.max(0, prev - dt);
        saveGraceRemaining(next);
        return next;
      });
    };
    const id = window.setInterval(tick, 1000);
    const onVis = () => { last = Date.now(); };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      stopped = true;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [entitlement]);

  // ── NEON MODE tilt parallax: read DeviceOrientation and write CSS vars.
  // Heavily smoothed so panels glide instead of jitter. Auto-disabled when
  // recording or in low-power. Permission prompt is iOS-only; on Android the
  // listener attaches directly.
  useEffect(() => {
    if (!neonMode) {
      // Reset CSS vars when neon mode is off so panels sit flat.
      const r = tiltRootRef.current;
      if (r) { r.style.setProperty("--tilt-x", "0deg"); r.style.setProperty("--tilt-y", "0deg"); r.style.setProperty("--tilt-tx", "0px"); r.style.setProperty("--tilt-ty", "0px"); }
      return;
    }
    let smoothG = 0; // gamma (left/right tilt, -90..90)
    let smoothB = 0; // beta  (front/back tilt, -180..180)
    let raf = 0;
    let lastG = 0, lastB = 0;
    const onOrient = (e: DeviceOrientationEvent) => {
      const g = typeof e.gamma === "number" ? e.gamma : 0;
      const b = typeof e.beta === "number" ? e.beta : 0;
      // Clamp beta to ±45 for sane parallax.
      lastG = Math.max(-45, Math.min(45, g));
      lastB = Math.max(-45, Math.min(45, b - 30)); // subtract resting hold angle
    };
    const loop = () => {
      // Pause parallax while recording or in low power — the FX should
      // stay clean and the device shouldn't waste cycles.
      const paused = lowPowerRef.current || (typeof document !== "undefined" && (document as Document & { fullscreenElement?: Element | null }).fullscreenElement != null);
      const targetG = paused ? 0 : lastG;
      const targetB = paused ? 0 : lastB;
      // Smooth: ~0.08 per frame ≈ 12-frame ramp.
      smoothG += (targetG - smoothG) * 0.08;
      smoothB += (targetB - smoothB) * 0.08;
      const r = tiltRootRef.current;
      if (r) {
        // Cap visual rotation to ~2°, translation to ~6px.
        const rotY = (smoothG / 45) * 2; // degrees
        const rotX = -(smoothB / 45) * 2;
        const tx = -(smoothG / 45) * 6;  // px (opposite direction = parallax)
        const ty = (smoothB / 45) * 6;
        r.style.setProperty("--tilt-x", `${rotX.toFixed(2)}deg`);
        r.style.setProperty("--tilt-y", `${rotY.toFixed(2)}deg`);
        r.style.setProperty("--tilt-tx", `${tx.toFixed(2)}px`);
        r.style.setProperty("--tilt-ty", `${ty.toFixed(2)}px`);
      }
      raf = window.requestAnimationFrame(loop);
    };
    // iOS 13+ requires explicit permission. On Android the call returns
    // undefined and the listener attaches normally.
    type DOEvtCtor = typeof DeviceOrientationEvent & { requestPermission?: () => Promise<"granted"|"denied"> };
    const doe = (typeof DeviceOrientationEvent !== "undefined" ? DeviceOrientationEvent : null) as DOEvtCtor | null;
    const attach = () => {
      window.addEventListener("deviceorientation", onOrient, { passive: true });
      raf = window.requestAnimationFrame(loop);
    };
    if (doe && typeof doe.requestPermission === "function") {
      doe.requestPermission().then(s => { if (s === "granted") attach(); }).catch(() => { /* denied */ });
    } else {
      attach();
    }
    return () => {
      window.removeEventListener("deviceorientation", onOrient);
      if (raf) window.cancelAnimationFrame(raf);
    };
  }, [neonMode]);

  // ── FACE FX segmentation loop (MediaPipe Tasks Vision · Selfie
  //    Segmenter). Runs at ~10 Hz and uploads a single-channel mask
  //    canvas to the WebGL face texture. The shader then samples this
  //    texture as the universal FX mask. Centered-oval fallback kicks
  //    in if the model fails to load.
  useEffect(() => {
    if (faceFxMode === "OFF") {
      faceFxRef.current.active = false;
      faceFxRef.current.texValid = false;
      return;
    }
    faceFxRef.current.active = true;
    // v1.2.47: BG label means "FX paints background, person stays clean".
    // Empirically the SelfieSegmenter category mask we get from
    // MediaPipe Tasks Vision (LITE asset) yields fm=1 inside the
    // PERSON, so to paint the BACKGROUND we want shader to compute
    // (1 - fm). The shader does that when uFaceInvert == 1, so BG
    // → invert = true. (v1.2.46 had this same line but also flipped
    // the JS polarity, double-inverting back to wrong; now reverted.)
    faceFxRef.current.invert = faceFxMode === "BG";

    let cancelled = false;
    let timer: number | null = null;
    type SegmentationMask = {
      getAsUint8Array?: () => Uint8Array;
      getAsFloat32Array?: () => Float32Array;
      width: number; height: number;
      close?: () => void;
    };
    type Segmenter = {
      segmentForVideo: (src: HTMLVideoElement, ts: number, cb: (r: { categoryMask?: SegmentationMask; confidenceMasks?: SegmentationMask[] }) => void) => void;
      close?: () => void;
    };
    let segmenter: Segmenter | null = null;

    // Lazy mask canvas + a 2D ctx for upload-to-WebGL.
    if (!faceMaskCanvasRef.current) {
      const c = document.createElement("canvas");
      c.width = 256; c.height = 144; // 16:9 lo-res — plenty for a soft roto edge
      faceMaskCanvasRef.current = c;
    }
    const maskCanvas = faceMaskCanvasRef.current;
    const maskCtx = maskCanvas.getContext("2d", { willReadFrequently: true })!;

    // v1.2.56 — Phase 3 segmenter perf. Hoist per-tick allocations:
    // the previous code allocated a new Uint8ClampedArray (~147 KB at
    // 256x144x4) plus a fresh <canvas> + ImageData every ~100 ms,
    // generating ~1.5 MB/s of GC pressure on the segmenter loop.
    // We now reuse one ImageData (which owns its rgba buffer) plus
    // one persistent scratch canvas. Both are rebuilt only when the
    // segmenter's mask geometry changes (rare).
    let scratchImg: ImageData | null = null;
    const scratchCanvas = document.createElement("canvas");
    const scratchCtx = scratchCanvas.getContext("2d")!;
    let scratchW = 0, scratchH = 0;

    // v1.2.56 — Phase 3 ADAPTIVE SEGMENTER CADENCE. Read the render
    // loop's rolling frametime EWMA: when the GPU is loafing (<14 ms,
    // >70 fps) we step up to ~20 Hz for crisp roto edges; when the
    // device is straining (>22 ms, <45 fps) we drop to ~10 Hz so the
    // segmenter stops competing with the shader for the GPU. Default
    // remains ~15 Hz. v1.2.75 — doubled cadence across all bands so
    // the figure mask keeps up with fast dance moves (was 6/10/12 Hz).
    const _segCadenceMs = () => {
      const f = frametimeAvgRef.current;
      if (f > 22) return 100; // ~10 Hz when busy (was 6)
      if (f < 14) return 50;  // ~20 Hz when idle (was 12)
      return 67;              // ~15 Hz default (was 10)
    };

    const initAndRun = async () => {
      try {
        const mp = await import("@mediapipe/tasks-vision");
        if (cancelled) return;
        const fileset = await mp.FilesetResolver.forVisionTasks("/mediapipe");
        if (cancelled) return;
        segmenter = await mp.ImageSegmenter.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: "/mediapipe/selfie_segmenter.tflite", delegate: "GPU" },
          runningMode: "VIDEO",
          outputCategoryMask: true,
          outputConfidenceMasks: false,
        }) as unknown as Segmenter;
      } catch (err) {
        try { console.warn("[GPS] FaceFx: segmenter init failed, using oval fallback", err); } catch { /* noop */ }
        segmenter = null;
      }

      const tick = () => {
        if (cancelled) return;
        const v = videoRef.current;
        if (segmenter && v && v.videoWidth > 0 && v.readyState >= 2) {
          try {
            segmenter.segmentForVideo(v, performance.now(), (result) => {
              const cat = result.categoryMask;
              if (!cat) return;
              // v1.2.47: MediaPipe Tasks Vision SelfieSegmenter category
              // mask outputs category 0 = background, non-zero = person.
              // Keep person = 255 so the shader's `fm` reads 1 INSIDE
              // the person, and the BG/FACE mapping is handled by the
              // single `uFaceInvert` flag set above. (v1.2.46 flipped
              // this and double-inverted; reverted here.)
              const u8: Uint8Array | null = cat.getAsUint8Array ? cat.getAsUint8Array() : null;
              const f32: Float32Array | null = !u8 && cat.getAsFloat32Array ? cat.getAsFloat32Array() : null;
              const mw = cat.width, mh = cat.height;
              if (!u8 && !f32) { try { cat.close?.(); } catch { /* noop */ } return; }
              // v1.2.56 — reuse scratch ImageData + canvas across ticks.
              // We back the rgba buffer with the ImageData itself so there's
              // exactly one allocation owned per mask geometry. ImageData
              // dimensions are immutable, so when the segmenter switches
              // mask size we just rebuild it (rare event).
              if (!scratchImg || scratchW !== mw || scratchH !== mh) {
                scratchImg = new ImageData(mw, mh);
                scratchCanvas.width = mw;
                scratchCanvas.height = mh;
                scratchW = mw; scratchH = mh;
              }
              const rgba = scratchImg.data;
              if (u8) {
                for (let i = 0, j = 0; i < u8.length; i++, j += 4) {
                  const m = u8[i] > 0 ? 255 : 0;
                  // v1.2.51 — alpha = mask too, so faceMaskCanvas is
                  // also usable as an alpha matte for 2D-canvas
                  // compositing (source-in / destination-in) when we
                  // cut the camera-person out for the gen/upload
                  // composite path. Shader still reads .r so behavior
                  // there is unchanged.
                  rgba[j] = m; rgba[j+1] = m; rgba[j+2] = m; rgba[j+3] = m;
                }
              } else if (f32) {
                for (let i = 0, j = 0; i < f32.length; i++, j += 4) {
                  const m = Math.round(Math.min(1, Math.max(0, f32[i])) * 255);
                  rgba[j] = m; rgba[j+1] = m; rgba[j+2] = m; rgba[j+3] = m;
                }
              }
              try { cat.close?.(); } catch { /* noop */ }
              scratchCtx.putImageData(scratchImg, 0, 0);

              // v1.2.52 — CRITICAL: clear the mask canvas before each draw.
              // In v1.2.51 we made mask alpha equal to the mask value (so the
              // canvas could double as an alpha matte for the gen/upload
              // composite). That made the background pixels transparent in
              // tmp, which means the default `source-over` drawImage no
              // longer overwrites prior-frame pixels in the destination —
              // the mask was monotonically accumulating into the union of
              // every person position ever seen. That manifested as a frozen,
              // ever-growing silhouette in the gen+cam composite, and as a
              // broken roto after switching back to camera mode (the bloated
              // mask covered most of the frame). Clearing every tick forces
              // the mask to reflect ONLY the current segmenter output.
      // v1.2.70 — MASK MOTION BLUR + EXPANSION. v1.2.75 — cut the
      // prior-frame retention from 45% to 18% so the mask follows fast
      // limb motion without smearing into a trailing skirt that visibly
      // lagged the dancer. Combined with the doubled segmenter cadence
      // (15 Hz default vs. 10 Hz before), the perceived tracking lag
      // drops from ~150 ms to ~70 ms while still bridging segmenter
      // ticks softly.
      maskCtx.globalCompositeOperation = "source-over";
      maskCtx.fillStyle = "rgba(0,0,0,0.82)";
      maskCtx.fillRect(0, 0, maskCanvas.width, maskCanvas.height);
      maskCtx.globalCompositeOperation = "lighter";
      const _dW = maskCanvas.width, _dH = maskCanvas.height;
      // 1.2.71 — Two-pixel-radius ring dilation (12 offsets, 1px and
      // 2px) for a few more pixels of border expansion. Combined with
      // the wider shader-side feather, this guarantees full coverage
      // around the face/body during motion.
      const _ringOff: Array<[number, number]> = [
        [-1, 0], [1, 0], [0, -1], [0, 1],
        [-1, -1], [1, -1], [-1, 1], [1, 1],
        [-2, 0], [2, 0], [0, -2], [0, 2],
      ];
      for (const [ox, oy] of _ringOff) {
        maskCtx.drawImage(scratchCanvas, ox, oy, _dW, _dH);
      }
      // Final centered draw at full strength so the core mask wins.
      maskCtx.drawImage(scratchCanvas, 0, 0, _dW, _dH);
      maskCtx.globalCompositeOperation = "source-over";
              // Upload to WebGL face texture.
              const gl = glRef.current;
              const tex = faceTextureRef.current;
              if (gl && tex) {
                gl.activeTexture(gl.TEXTURE4);
                gl.bindTexture(gl.TEXTURE_2D, tex);
                // Camera tex is uploaded WITHOUT FLIP_Y, so to match
                // the camera's vertical orientation the mask must
                // also be uploaded WITHOUT FLIP_Y. Previously this was
                // flipped, which pushed the person's head off the top
                // of the mask and chopped the upper third of the roto.
                gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, maskCanvas);
                faceFxRef.current.texValid = true;
              }
            });
          } catch (err) {
            try { console.warn("[GPS] FaceFx: segmentForVideo failed", err); } catch { /* noop */ }
          }
        } else {
          // No segmenter / no video yet — drift to centered oval.
          faceFxRef.current.texValid = false;
          faceFxRef.current.cx += (0.5  - faceFxRef.current.cx) * 0.1;
          faceFxRef.current.cy += (0.42 - faceFxRef.current.cy) * 0.1;
          faceFxRef.current.r  += (0.28 - faceFxRef.current.r ) * 0.1;
        }
        timer = window.setTimeout(tick, segmenter ? _segCadenceMs() : 250);
      };
      tick();
    };
    initAndRun();
    return () => {
      cancelled = true;
      if (timer != null) window.clearTimeout(timer);
      try { segmenter?.close?.(); } catch { /* noop */ }
    };
  }, [faceFxMode]);

  // Apply unlock code (dev path; replaced by Play Billing in next release).
  const applyUnlockCode = useCallback((code: string) => {
    const trimmed = code.trim();
    if (trimmed === "4200") { saveEntitlement("paid"); setEntitlement("paid"); setUnlockInputVisible(false); setUnlockCode(""); return; }
    if (trimmed === "6900") { saveEntitlement("studio"); setEntitlement("studio"); setUnlockInputVisible(false); setUnlockCode(""); return; }
    if (trimmed === "0000") { saveEntitlement(null); setEntitlement(null); setUnlockCode(""); return; }
    // Wrong code — clear input but stay open.
    setUnlockCode("");
  }, []);
  const onVersionTap = useCallback(() => {
    versionTapsRef.current += 1;
    if (versionTapTimerRef.current !== null) window.clearTimeout(versionTapTimerRef.current);
    versionTapTimerRef.current = window.setTimeout(() => { versionTapsRef.current = 0; }, 1500);
    if (versionTapsRef.current >= 5) {
      versionTapsRef.current = 0;
      setUnlockInputVisible(true);
    }
  }, []);

  const genStyleRef = useRef<GenStyle>("BAYER");
  const genResolutionRef = useRef(48);
  const genDensityRef = useRef(0.55);
  const genScaleRef = useRef(1.0);
  const genSpeedRef = useRef(0.6);
  const genHueRef = useRef(0.78);
  const genHueSpreadRef = useRef(0.35);
  const genSatRef = useRef(0.85);
  const genContrastGRef = useRef(0.7);
  const genWarpRef = useRef(0.25);
  const genJitterRef = useRef(0.15);
  const genSeedRef = useRef(7);
  const genInvertRef = useRef(false);
  const genMoshXRef = useRef(0);
  const genMoshYRef = useRef(0);
  const genScatterRef = useRef(0);
  const genScatterModeRef = useRef(0);
  // Transient per-layer scatter pulses (decay each frame, layered on top
  // of the sustained `scatter` knob). Index 0..3 = layer; pulses fired by
  // the SHIFT/BURST/SHRED/FREEZE buttons (or all 4 if MASTER selected).
  const scatterPulsesRef = useRef<{amt:number; mode:number}[]>(
    [{amt:0,mode:0},{amt:0,mode:0},{amt:0,mode:0},{amt:0,mode:0}]
  );
  // ── Multi-layer pixel generators (1..4 styles fused into a SINGLE pixel
  // image, not stacked overlays). Each layer has its OWN full parameter
  // set so the layer-tab UI can edit them independently. The MASTER tab
  // broadcasts every edit to all 4 layers at once.
  // v1.2.66 — extended blend mode set. The first 8 (AVG..MUL) are the
  // legacy custom per-pixel blends used by the multi-layer fuse path
  // (with inter-layer pixel-displacement coupling). The new entries
  // (NORMAL..LUMI) are Canvas2D globalCompositeOperation blends applied
  // in the single-layer path or as a final flatten step in multi-layer.
  // Matches the standard Photoshop / After Effects blend mode menu so
  // the generator panel exposes the full painter's vocabulary.
  type GenBlend =
    | "AVG" | "MAX" | "MIN" | "XOR" | "ADD" | "SUB" | "DIFF" | "MUL"
    | "NORMAL" | "DARKEN" | "MULTIPLY" | "COLORBURN"
    | "LIGHTEN" | "SCREEN" | "COLORDODGE"
    | "OVERLAY" | "SOFTLIGHT" | "HARDLIGHT"
    | "DIFFERENCE" | "EXCLUSION"
    | "HUE" | "SATURATION" | "COLOR" | "LUMI";
  const GEN_BLEND_KEYS = [
    "AVG","MAX","MIN","XOR","ADD","SUB","DIFF","MUL",
    "NORMAL","DARKEN","MULTIPLY","COLORBURN",
    "LIGHTEN","SCREEN","COLORDODGE",
    "OVERLAY","SOFTLIGHT","HARDLIGHT",
    "DIFFERENCE","EXCLUSION",
    "HUE","SATURATION","COLOR","LUMI",
  ] as const;
  // Map blend key → Canvas2D globalCompositeOperation. Used by the
  // single-layer blend path and the multi-layer flatten step.
  const GEN_BLEND_OP: Record<string, GlobalCompositeOperation> = {
    MAX: "lighten", MIN: "darken", XOR: "xor",
    ADD: "lighter", SUB: "difference", DIFF: "difference", MUL: "multiply",
    NORMAL: "source-over",
    DARKEN: "darken", MULTIPLY: "multiply", COLORBURN: "color-burn",
    LIGHTEN: "lighten", SCREEN: "screen", COLORDODGE: "color-dodge",
    OVERLAY: "overlay", SOFTLIGHT: "soft-light", HARDLIGHT: "hard-light",
    DIFFERENCE: "difference", EXCLUSION: "exclusion",
    HUE: "hue", SATURATION: "saturation", COLOR: "color", LUMI: "luminosity",
  };
  type GenLayer = {
    style: GenStyle; enabled: boolean;
    density: number; scale: number; speed: number;
    hue: number; hueSpread: number; sat: number;
    contrast: number; warp: number; jitter: number;
    seed: number; invert: boolean;
    // Per-layer datamosh blend movement controls.
    moshX: number;     // -1..1 sustained X-axis displacement bias
    moshY: number;     // -1..1 sustained Y-axis displacement bias
    scatter: number;   // 0..1  sustained scatter intensity (knob)
    scatterMode: number; // 0 SHIFT | 1 BURST | 2 SHRED | 3 FREEZE
  };
  const makeLayerDefaults = (style: GenStyle, seed: number): GenLayer => ({
    style, enabled: false,
    density: 0.55, scale: 1.0, speed: 0.6,
    hue: 0.78, hueSpread: 0.35, sat: 0.85,
    contrast: 0.7, warp: 0.25, jitter: 0.15,
    seed, invert: false,
    moshX: 0, moshY: 0, scatter: 0, scatterMode: 0,
  });
  const [genLayers, setGenLayers] = useState<GenLayer[]>([
    { ...makeLayerDefaults("BAYER", 7),  enabled: true  },
    { ...makeLayerDefaults("PLIFE", 23), enabled: false },
    { ...makeLayerDefaults("RINGS", 41), enabled: false },
    { ...makeLayerDefaults("WAVES", 89), enabled: false },
  ]);
  // selectedLayer: 0..3 = layer index, 4 = MASTER (broadcasts to all)
  const [selectedLayer, setSelectedLayer] = useState<number>(0);
  const selectedLayerRef = useRef(selectedLayer);
  useEffect(() => { selectedLayerRef.current = selectedLayer; }, [selectedLayer]);
  const [genBlend, setGenBlend] = useState<GenBlend>("AVG");
  const genLayersRef = useRef<GenLayer[]>(genLayers);
  const genBlendRef  = useRef<GenBlend>("AVG");
  const genLayerCanvasesRef = useRef<HTMLCanvasElement[]>([]);
  const genCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const genCompositeCanvasRef = useRef<HTMLCanvasElement | null>(null);
  // v1.2.51 — person-on-source composite canvases. faceComposeCanvasRef
  // is the final RGBA frame uploaded to WebGL (gen/upload as background +
  // camera-person on top); faceComposePersonRef is a scratch canvas used
  // to mask the camera frame down to the person silhouette before stamping.
  const faceComposeCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const faceComposePersonRef = useRef<HTMLCanvasElement | null>(null);
  const genTimeRef = useRef(0);
  const motionSampleCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const motionPrevLumaRef = useRef<Uint8ClampedArray | null>(null);
  const motionEnergyRef = useRef(0);
  const motionFrameRef = useRef(0);
  const accelEnergyRef = useRef(0);
  const accelTiltXRef = useRef(0);
  const accelTiltYRef = useRef(0);
  const accelPushRef = useRef(0);

  // ── Mode / controls
  // v1.2.65 — auto-launch default: PIXEL SORT (mode 7) so the boot lands
  // straight into glitch with the camera + FACE FX = BG silhouette already
  // armed. Combined with sortMix default of 0.65 below this is instant
  // proof-of-work the moment the app opens.
  const [mode, setMode] = useState<ModeId>(7);
  const [gain, setGain] = useState(0.5);
  const [comboLayers, setComboLayers] = useState<{mode:ModeId;gain:number}[]>([{mode:7,gain:1},{mode:9,gain:1}]);
  const [comboMode, setComboMode] = useState(true);

  // ── Per-mode rack params (Phase 1B). Persisted under RACK_KEY.
  const [paramsByMode, setParamsByMode] = useState<Record<ModeId, Record<string, number>>>(() => defaultsForAllModes());

  // ── Post-process settings
  const [brightness, setBrightness] = useState(1.0);
  const [contrast, setContrast] = useState(1.0);
  const [saturation, setSaturation] = useState(1.0);
  const [hueShift, setHueShift] = useState(0.0);
  const [scanlines, setScanlines] = useState(0.0);
  const [zoom, setZoom] = useState(0.0);
  const [speed, setSpeed] = useState(1.0);


  // ── Glitch FX settings (multi-layer)
  // v1.2.46: seed pixel-sort at 0.5 so the boot screen instantly shows
  // the signature glitch on whatever the camera sees (combined with
  // user-facing camera + FACE FX = BG, the person stays clean and the
  // background gets sorted).
  const [sortAmt, setSortAmt] = useState(0.5);
  const [scanTear, setScanTear] = useState(0.0);
  const [blockGlitch, setBlockGlitch] = useState(0.0);
  const [datamosh, setDatamosh] = useState(0.0);
  const [moshHard, setMoshHard] = useState(false);
  const [chrash, setChrash] = useState(0.0);
  const [liquid, setLiquid] = useState(0.0);
  // v1.2.58 — Asendorf / Gysin homage rack (v1.2.59: streak/hilbert removed)
  const [glyph, setGlyph] = useState(0.0);
  // v1.2.85 — sortMix defaults to 0 so first paint is pure GEN+CAM
  // (procedural generator pattern composited with camera segmentation),
  // not pixel-sort distortion. The auto-bump useEffect at ~6636 still
  // raises sortMix back to 0.65 the moment the user toggles into PXL.
  const [sortMix, setSortMix] = useState(0.0);
  const [reactD, setReactD] = useState(0.0);
  const [voroSort, setVoroSort] = useState(0.0);
  const [feedback, setFeedback] = useState(0.0);
  const [contour, setContour] = useState(0.0);
  const [ascii, setAscii] = useState(0.0);
  const [venetian, setVenetian] = useState(0.0);
  const [kaleido, setKaleido] = useState(0.0);
  // v1.2.60 — 9 sister UV warps that combo with KALEIDO. Each is an independent
  // mask-gated UV warp; chained sequentially after KALEIDO so any combination
  // produces a unique radial pattern. Defaults to 0 (off).
  const [tile, setTile] = useState(0.0);
  const [invertSym, setInvertSym] = useState(0.0);
  const [droste, setDroste] = useState(0.0);
  const [spiral, setSpiral] = useState(0.0);
  const [yantra, setYantra] = useState(0.0);
  const [mandala, setMandala] = useState(0.0);
  const [rosette, setRosette] = useState(0.0);
  const [starfold, setStarfold] = useState(0.0);
  const [hexfold, setHexfold] = useState(0.0);
  const [disrupt, setDisrupt] = useState(0.0);
  const [disruptCount, setDisruptCount] = useState(0.4);
  const [disruptSize, setDisruptSize] = useState(0.4);
  const [disruptContrary, setDisruptContrary] = useState(1.0);
  // v1.2.74 — 0 BLOB, 1 RING, 2 HEX, 3 CROSS, 4 STRIPE, 5 SPIRAL
  const [disruptShape, setDisruptShape] = useState(0);
  const [sortKey, setSortKey] = useState(0);
  const [sortLow, setSortLow] = useState(0.35);
  const [sortHigh, setSortHigh] = useState(0.92);
  const [sortMode, setSortMode] = useState(0); // 0 LINE, 1 SPIRAL, 2 BLOCK, 3 SLICE, 4 HILBERT
  const [sortSegment, setSortSegment] = useState(0.35);
  const [sortRandom, setSortRandom] = useState(0.18);
  const [sortWobble, setSortWobble] = useState(0.12);
  // satyarth/Akascape pixelsort-style extensions
  const [sortInterval, setSortInterval] = useState(0); // 0 BAND,1 BRIGHT,2 DARK,3 RAND,4 WAVE,5 EDGE,6 NONE
  const [sortAngle, setSortAngle] = useState(0);       // 0 HORZ,1 VERT,2 DIAG↗,3 DIAG↘
  // RGBNDR (ohss/RGBNDR-inspired analog VGA channel-bender)
  const [rgbR, setRgbR] = useState(0);
  const [rgbG, setRgbG] = useState(0);
  const [rgbB, setRgbB] = useState(0);
  const [rgbBars, setRgbBars] = useState(0);
  const [rgbSwap, setRgbSwap] = useState(0); // 0 RGB,1 GBR,2 BRG,3 BGR,4 RBG,5 GRB
  // RUPTURE/HSYNC — _rupture_-style composite-signal destruction. RUPTURE
  // is a single combo knob driving dropout + chroma crash + sync burst;
  // HSYNC is a per-row tear-and-shift slip emulation.
  const [rupture, setRupture] = useState(0);
  const [hsync, setHsync] = useState(0);
  const [moshIFrame, setMoshIFrame] = useState(0.7);
  const [moshMotion, setMoshMotion] = useState(0.55);
  const [moshBleed, setMoshBleed] = useState(0.45);
  const [moshMap, setMoshMap] = useState(0.0);
  const [moshDistort, setMoshDistort] = useState(0.5);

  // ── Draw overlay
  const [drawActive, setDrawActive] = useState(false);
  const [strokes, setStrokes] = useState<DrawStroke[]>([]);
  const [brushColor, setBrushColor] = useState("#ff00ff");
  const [brushSize, setBrushSize] = useState(8);
  const [brushOpacity, setBrushOpacity] = useState(0.85);
  const [colorCycle, setColorCycle] = useState(false);
  const [colorCycleSpeed, setColorCycleSpeed] = useState(0.8);
  const currentStrokeRef = useRef<DrawStroke|null>(null);
  const drawCanvasRef = useRef<HTMLCanvasElement>(null);
  // v1.2.77 — scratch canvas for compositing the user's brush strokes
  // into the source frame so glitch FX corrupt them. See render loop.
  const drawComposeCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const colorCycleHueRef = useRef(300);
  const [brushType, setBrushType] = useState<"round"|"spray"|"neon"|"wide">("round");
  const brushColorRef = useRef("#ff00ff");
  const colorCycleRef = useRef(false);
  const brushTypeRef = useRef<string>("round");

  // ─── PIXEL DRAWER ──────────────────────────────────────────────────
  // A "living collage" overlay: every stroke spawns colored pixel cells
  // that drift, glitch their hue, occasionally spawn neighbors, and
  // slowly decay. Independent of the FX-mask draw above (which is just
  // a region selector). Renders into its own absolutely-positioned
  // canvas above the WebGL canvas with mix-blend-mode: screen so the
  // pixels glow over whatever the FX pipeline is producing.
  type PxCell = {
    x: number; y: number;        // 0..1 normalized
    vx: number; vy: number;      // velocity in normalized units / sec
    age: number; life: number;   // seconds
    hue: number; sat: number; val: number;
    size: number;                // px
    seed: number;
  };
  const [pixelDrawerActive, setPixelDrawerActive] = useState(false);
  const [pxSize, setPxSize] = useState(0.4);     // base cell size 0..1 → 2..14 px
  const [pxGlitch, setPxGlitch] = useState(0.55); // hue jitter & teleport
  const [pxGrow, setPxGrow] = useState(0.35);    // neighbor-spawn probability
  const [pxDecay, setPxDecay] = useState(0.35);  // life shrink
  const [pxSpeed, setPxSpeed] = useState(0.45);  // drift velocity
  const pxSizeRef    = useRef(0.4);
  const pxGlitchRef  = useRef(0.55);
  const pxGrowRef    = useRef(0.35);
  const pxDecayRef   = useRef(0.35);
  const pxSpeedRef   = useRef(0.45);
  const pxActiveRef  = useRef(false);
  const pxCellsRef   = useRef<PxCell[]>([]);
  const pxCanvasRef  = useRef<HTMLCanvasElement>(null);
  const pxLastSpawnRef = useRef<{x:number;y:number;t:number}|null>(null);
  useEffect(()=>{ pxSizeRef.current   = pxSize;   },[pxSize]);
  useEffect(()=>{ pxGlitchRef.current = pxGlitch; },[pxGlitch]);
  useEffect(()=>{ pxGrowRef.current   = pxGrow;   },[pxGrow]);
  useEffect(()=>{ pxDecayRef.current  = pxDecay;  },[pxDecay]);
  useEffect(()=>{ pxSpeedRef.current  = pxSpeed;  },[pxSpeed]);
  useEffect(()=>{ pxActiveRef.current = pixelDrawerActive; },[pixelDrawerActive]);
  const pxResetAll = useCallback(() => {
    pxCellsRef.current = [];
    pxLastSpawnRef.current = null;
    setPxSize(0.4); setPxGlitch(0.55); setPxGrow(0.35);
    setPxDecay(0.35); setPxSpeed(0.45);
    const c = pxCanvasRef.current;
    if (c) { const cx = c.getContext("2d"); if (cx) cx.clearRect(0,0,c.width,c.height); }
  }, []);
  const pxClearCells = useCallback(() => {
    pxCellsRef.current = [];
    pxLastSpawnRef.current = null;
    const c = pxCanvasRef.current;
    if (c) { const cx = c.getContext("2d"); if (cx) cx.clearRect(0,0,c.width,c.height); }
  }, []);

  // Spawn cells along a pointer path (called from pixel-drawer canvas
  // onPointerDown / onPointerMove). Density scales with distance so fast
  // strokes don't become dotted.
  const pxSpawnAt = useCallback((nx: number, ny: number) => {
    const sizeBase = 2 + pxSizeRef.current * 12;
    const glitch = pxGlitchRef.current;
    const baseHueRaw = brushColorRef.current;
    // Convert hex → HSL hue (cheap parse, fallback magenta).
    let baseHue = 300;
    if (baseHueRaw.startsWith("#") && baseHueRaw.length === 7) {
      const r = parseInt(baseHueRaw.slice(1,3),16)/255;
      const g = parseInt(baseHueRaw.slice(3,5),16)/255;
      const b = parseInt(baseHueRaw.slice(5,7),16)/255;
      const mx = Math.max(r,g,b), mn = Math.min(r,g,b), d = mx-mn;
      let h = 0;
      if (d > 1e-4) {
        if (mx === r) h = ((g-b)/d) % 6;
        else if (mx === g) h = (b-r)/d + 2;
        else h = (r-g)/d + 4;
      }
      baseHue = (h * 60 + 360) % 360;
    }
    const burst = 1 + Math.floor(2 + glitch * 4);
    for (let i = 0; i < burst; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * 0.012 * (0.5 + glitch);
      pxCellsRef.current.push({
        x: nx + Math.cos(a) * r,
        y: ny + Math.sin(a) * r,
        vx: (Math.random() - 0.5) * 0.04 * pxSpeedRef.current,
        vy: (Math.random() - 0.5) * 0.04 * pxSpeedRef.current,
        age: 0,
        life: 1.5 + Math.random() * (4 - pxDecayRef.current * 3),
        hue: (baseHue + (Math.random() - 0.5) * 80 * glitch + 360) % 360,
        sat: 70 + Math.random() * 30,
        val: 55 + Math.random() * 35,
        size: sizeBase * (0.6 + Math.random() * 0.9),
        seed: Math.random() * 1000,
      });
    }
    // Cap at 4000 cells to protect mobile fillrate.
    if (pxCellsRef.current.length > 4000) {
      pxCellsRef.current.splice(0, pxCellsRef.current.length - 4000);
    }
  }, []);

  // Animation loop: drift + glitch + spawn + decay + render. Runs while
  // active OR while cells still exist (so a final stroke fades out
  // gracefully when the user toggles off).
  useEffect(() => {
    let rafId = 0;
    let prevT = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - prevT) / 1000);
      prevT = now;
      const c = pxCanvasRef.current;
      if (!c) { rafId = requestAnimationFrame(tick); return; }
      const cx = c.getContext("2d");
      if (!cx) { rafId = requestAnimationFrame(tick); return; }
      // Sync size to parent (FX canvas).
      const parent = c.parentElement;
      if (parent) {
        const w = parent.clientWidth, h = parent.clientHeight;
        if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
      }
      // Trail clear: low-alpha black wipe → cells leave fading streaks.
      // The stronger DECAY, the faster the trail clears.
      cx.globalCompositeOperation = "source-over";
      cx.fillStyle = `rgba(0,0,0,${0.04 + pxDecayRef.current * 0.18})`;
      cx.fillRect(0, 0, c.width, c.height);
      cx.globalCompositeOperation = "lighter";

      const cells = pxCellsRef.current;
      const W = c.width, H = c.height;
      const glitch = pxGlitchRef.current;
      const grow = pxGrowRef.current;
      const speed = pxSpeedRef.current;
      const newSpawns: PxCell[] = [];
      for (let i = cells.length - 1; i >= 0; i--) {
        const p = cells[i];
        p.age += dt;
        if (p.age >= p.life) { cells.splice(i, 1); continue; }
        // Drift + glitch teleport.
        p.x += p.vx * dt * (0.5 + speed);
        p.y += p.vy * dt * (0.5 + speed);
        if (Math.random() < glitch * 0.04) {
          p.x += (Math.random() - 0.5) * 0.05 * glitch;
          p.y += (Math.random() - 0.5) * 0.05 * glitch;
        }
        // Wrap edges so cells don't pile up at borders.
        if (p.x < 0) p.x += 1; else if (p.x > 1) p.x -= 1;
        if (p.y < 0) p.y += 1; else if (p.y > 1) p.y -= 1;
        // Color glitch.
        p.hue = (p.hue + (Math.random() - 0.5) * 60 * glitch * dt * 5 + 360) % 360;
        // Spawn neighbor (cellular generation).
        if (Math.random() < grow * dt * 6 && cells.length + newSpawns.length < 4000) {
          newSpawns.push({
            x: p.x + (Math.random() - 0.5) * 0.02,
            y: p.y + (Math.random() - 0.5) * 0.02,
            vx: p.vx + (Math.random() - 0.5) * 0.02,
            vy: p.vy + (Math.random() - 0.5) * 0.02,
            age: 0,
            life: p.life * (0.5 + Math.random() * 0.6),
            hue: (p.hue + (Math.random() - 0.5) * 30) % 360,
            sat: p.sat,
            val: p.val * (0.7 + Math.random() * 0.4),
            size: p.size * (0.6 + Math.random() * 0.7),
            seed: Math.random() * 1000,
          });
        }
        // Render — chunky pixel rect, fade out by age.
        const t = 1 - p.age / p.life;
        const alpha = Math.min(1, t * 1.4);
        cx.fillStyle = `hsla(${p.hue.toFixed(0)},${p.sat.toFixed(0)}%,${p.val.toFixed(0)}%,${alpha.toFixed(3)})`;
        const px = p.x * W, py = p.y * H;
        const sz = Math.max(1, p.size);
        cx.fillRect(px - sz/2, py - sz/2, sz, sz);
      }
      if (newSpawns.length) cells.push(...newSpawns);
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(rafId); };
  }, []);
  // Glitch!-style draw: pop last stroke. setStrokes lives in state above.
  const undoStroke = useCallback(() => {
    setStrokes(prev => prev.slice(0, -1));
  }, []);
  const clearStrokes = useCallback(() => {
    currentStrokeRef.current = null;
    setStrokes([]);
  }, []);
  // DRAW is currently only safe over static image uploads (live camera + generator
  // share the live render path with the FX mask, which the draw overlay corrupts).
  // v1.2.78 — DRAW feature disabled (user request: kept conflicting with
  // upload pipeline + obscured glitch FX). All draw-related state, refs,
  // pointer handlers and the bake-in compositor remain in the file but
  // gated off by this single flag, so they're unreachable from the UI.
  // Re-enable by removing the literal `false` and restoring the original
  // condition: sourceMode === "upload" && (uploadKind === "image" || uploadKind === "video")
  const drawAvailable = false;
  // Auto-bail out of DRAW the moment the source stops being an image upload.
  useEffect(() => {
    if (!drawAvailable && drawActive) {
      setDrawActive(false);
      currentStrokeRef.current = null;
      setStrokes([]);
    }
  }, [drawAvailable, drawActive]);
  // Reserved setters (color cycle UI may return later)
  void setColorCycle; void setColorCycleSpeed;

  // ── DRAW crash safety net ───────────────────────────────────────────────
  // If anything inside the draw paint path throws, instead of letting the
  // Next.js error overlay swallow the whole app we (a) capture the message,
  // (b) surface it as an on-screen banner, and (c) hard-disable DRAW so the
  // user can keep using the rest of the app without reloading.
  const [drawCrash, setDrawCrash] = useState<string | null>(null);
  const reportDrawCrash = useCallback((where: string, err: unknown) => {
    const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    // eslint-disable-next-line no-console
    console.error(`[DRAW crash @ ${where}]`, err);
    setDrawCrash(`${where} — ${msg}`);
    setDrawActive(false);
    currentStrokeRef.current = null;
  }, []);
  // Catch *any* unhandled error/promise rejection while DRAW is active and
  // surface it instead of crashing the React tree.
  useEffect(() => {
    const onErr = (ev: ErrorEvent) => {
      if (drawActive) {
        ev.preventDefault?.();
        reportDrawCrash("window.error", ev.error || ev.message);
      }
    };
    const onRej = (ev: PromiseRejectionEvent) => {
      if (drawActive) {
        ev.preventDefault?.();
        reportDrawCrash("unhandledrejection", ev.reason);
      }
    };
    window.addEventListener("error", onErr);
    window.addEventListener("unhandledrejection", onRej);
    return () => {
      window.removeEventListener("error", onErr);
      window.removeEventListener("unhandledrejection", onRej);
    };
  }, [drawActive, reportDrawCrash]);

  // ── Export
  const [recording, setRecording] = useState(false);
  // v1.2.76 — UI HIDE / IMMERSIVE toggle. When true, top bar + controls
  // pane collapse and the canvas fills the screen. Also calls Capacitor
  // StatusBar.hide() and the standard Fullscreen API so the device
  // chrome (status bar + nav bar) actually goes away on Android, not
  // just the in-app chrome. The float-over-canvas eye button restores.
  const [uiHidden, setUiHidden] = useState(false);
  const [fps, setFps] = useState(0);
  const [exportFormat, setExportFormat] = useState<"gif" | "video">("gif");
  const [exportQuality, setExportQuality] = useState<"standard" | "high" | "ultra">("high");
  const [exportProfile, setExportProfile] = useState<ExportProfile>("native");
  // User-selectable canonical recording rate. Applied to both GIF and video
  // so the encoded output's frame timing matches what the recorder pulls.
  // GIF format spec stores delay in 1/100 sec, browsers minimum-clamp to
  // 2cs (= 50fps), so a "60fps GIF" actually plays at 50fps regardless.
  // We expose 60 anyway for video; the GIF path clamps to 50 internally.
  const [recordFps, setRecordFps] = useState<24 | 30 | 60>(30);
  const recordFpsRef = useRef(recordFps);
  useEffect(() => { recordFpsRef.current = recordFps; }, [recordFps]);
  // Max recording duration. Default 30s — long enough for a meaningful
  // generative loop, short enough to keep GIF file sizes manageable.
  // User can dial up to 60s in the EXPORT panel.
  const [recordMaxSec, setRecordMaxSec] = useState<5 | 15 | 30 | 60>(30);
  const recordMaxSecRef = useRef(recordMaxSec);
  useEffect(() => { recordMaxSecRef.current = recordMaxSec; }, [recordMaxSec]);
  // Whether to auto-trim GIFs to the nearest perfect loop point. When off,
  // the recording is exported full-length with no end-trim.
  const [perfectLoop, setPerfectLoop] = useState(true);
  const perfectLoopRef = useRef(true);
  useEffect(() => { perfectLoopRef.current = perfectLoop; }, [perfectLoop]);
  // Audio-react drive: how much the analyser RMS modulates the per-layer
  // mosh + scatter knobs in real time. 0 = audio button purely visual via
  // shader uAudio; 1 = full-range mosh swing on every beat.
  const [audioReactAmt, setAudioReactAmt] = useState(0.0);
  const audioReactAmtRef = useRef(0.0);
  useEffect(() => { audioReactAmtRef.current = audioReactAmt; }, [audioReactAmt]);
  // Cross-feed: feed the camera signal into generators (and vice versa)
  // so the generator can pixel-sort/mosh the camera, and the camera can
  // be moshed by what the generator is doing.
  const [crossFeed, setCrossFeed] = useState(false);
  const crossFeedRef = useRef(false);
  useEffect(() => { crossFeedRef.current = crossFeed; }, [crossFeed]);
  const [recordingHint, setRecordingHint] = useState<string | null>(null);
  // v1.2.71 — HANDS-FREE record: floating top-of-screen button so a solo
  // dancer can always reach it without scrolling. Tapping starts a 3-2-1
  // count-IN overlay (so they can step into frame), then auto-records for
  // a fixed 60 s, with the last 3 s shown as a 3-2-1 count-OUT overlay so
  // they know to hold the pose. handsFreeCountdown encodes both phases:
  //   { phase: "in",  n: 3|2|1 } — pre-record countdown
  //   { phase: "rec", n: <secs remaining> } — live recording (mid-shoot)
  //   { phase: "out", n: 3|2|1 } — final 3 s of recording (count-out)
  //   null = idle.
  type HandsFreeState = { phase: "in" | "rec" | "out"; n: number } | null;
  const HANDS_FREE_SEC = 60;
  const [handsFreeCountdown, setHandsFreeCountdown] = useState<HandsFreeState>(null);
  const handsFreeTimerRef = useRef<number | null>(null);
  const [abSnapshot, setAbSnapshot] = useState<SpectraPreset | null>(null);
  const [cameraRequesting, setCameraRequesting] = useState(false);

  // ── WebGL refs
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const glRef = useRef<WebGLRenderingContext|null>(null);
  const programRef = useRef<WebGLProgram|null>(null);
  // Phase 2b: ping-pong FBOs for multi-layer combo composite
  const fboARef = useRef<WebGLFramebuffer|null>(null);
  const fboBRef = useRef<WebGLFramebuffer|null>(null);
  const fboTexARef = useRef<WebGLTexture|null>(null);
  const fboTexBRef = useRef<WebGLTexture|null>(null);
  const uniformsRef = useRef<Record<string,WebGLUniformLocation|null>>({});
  const textures = useRef<WebGLTexture[]>([]);
  const frameIdxRef = useRef(0);
  const firstFrameRef = useRef(true);
  const rafRef = useRef<number>(0);
  const timeRef = useRef(0);
  const fpsFrames = useRef(0);
  const fpsTime = useRef(performance.now());
  const touchRef = useRef({ x: 0.5, y: 0.5, active: false });

  // GIF recording
  const gifFrames = useRef<Uint8ClampedArray[]>([]);
  const gifSizeRef = useRef<{ w: number; h: number } | null>(null);
  const gifFpsRef = useRef(10);
  const gifDelayCsRef = useRef(10);
  const gifDitherRef = useRef(2.0);
  const gifStartTime = useRef(0);
  const gifInterval = useRef<ReturnType<typeof setInterval>|null>(null);
  const gifTimeoutRef = useRef<number | null>(null);
  const videoRecorderRef = useRef<MediaRecorder | null>(null);
  const videoChunksRef = useRef<BlobPart[]>([]);
  const videoComposeCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const videoComposeRafRef = useRef<number>(0);
  const recordingRef = useRef(false);
  const recordingHintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Hard upper bound. The user-selectable recordMaxSec lives in
  // recordMaxSecRef; this constant is the absolute ceiling enforced
  // everywhere so a stuck recorder never balloons memory.
  const MAX_RECORD_MS = 60_000;

  // Gesture detection (hold = video GIF)
  const holdTimerRef = useRef<ReturnType<typeof setTimeout>|null>(null);
  const holdFiredRef = useRef(false);
  const projectFileInputRef = useRef<HTMLInputElement>(null);
  const [flashVisible, setFlashVisible] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);
  const [pullArmed, setPullArmed] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const pullStartYRef = useRef<number|null>(null);

  // ── 2.5D slot-machine wheel for SynthPanel racks ──────────────────
  // On every scroll/resize, walk all `.sp-rack` cards in the panel
  // container and apply a perspective-aware transform based on the
  // rack's distance from the visible center. The card nearest the
  // center stays flat & fully opaque; siblings tilt back along X,
  // shrink, and fade — giving the whole list the feel of a slot reel.
  useEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    let raf = 0;
    const apply = () => {
      raf = 0;
      const cRect = el.getBoundingClientRect();
      const cy = cRect.top + cRect.height / 2;
      const racks = el.querySelectorAll<HTMLElement>(".sp-rack");
      racks.forEach((r) => {
        const rRect = r.getBoundingClientRect();
        const itemCy = rRect.top + rRect.height / 2;
        // Normalised distance from center: 0 at center, ±1 at edges.
        const norm = Math.max(-2.0, Math.min(2.0, (itemCy - cy) / (cRect.height * 0.42)));
        const a = Math.abs(norm);
        // Heavier perspective so off-center racks recede dramatically and
        // their visual footprint shrinks — the wheel saves vertical space
        // by trading it for z-depth.
        const rotX = -norm * 38;            // slot-reel tilt
        const transY = -norm * 4;           // tiny vertical lift
        const transZ = -a * 220;            // recede away (deep z)
        const scale = Math.max(0.55, 1 - a * 0.32);
        const opacity = 1 - a * 0.55;
        r.style.transform = `translate3d(0, ${transY}px, ${transZ}px) rotateX(${rotX}deg) scale(${scale})`;
        r.style.opacity = String(Math.max(0.22, opacity));
        r.style.transformOrigin = "center center";
        r.style.willChange = "transform, opacity";
      });
    };
    const schedule = () => { if (!raf) raf = requestAnimationFrame(apply); };
    apply();
    el.addEventListener("scroll", schedule, { passive: true });
    const ro = new ResizeObserver(schedule);
    ro.observe(el);
    // Re-run when the rack count or open-panel changes (children mutate).
    const mo = new MutationObserver(schedule);
    mo.observe(el, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
    return () => {
      el.removeEventListener("scroll", schedule);
      ro.disconnect();
      mo.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);
  const [presetName, setPresetName] = useState("");
  const [presets, setPresets] = useState<SpectraPreset[]>([]);
  const [quickSlots, setQuickSlots] = useState<Array<string | null>>(() => Array.from({ length: 8 }, () => null));
  // Stable refs for gesture callbacks (set after functions are declared)
  const startRecordingRef = useRef<() => void>(() => {});
  const stopRecordingRef = useRef<() => void>(() => {});
  const captureStillRef = useRef<() => void>(() => {});
  const getExportMaxDim = useCallback((quality: "standard" | "high" | "ultra") => {
    if (quality === "standard") return 960;
    if (quality === "ultra") return 1600;
    return 1280;
  }, []);

  const getGifProfile = useCallback((quality: "standard" | "high" | "ultra") => {
    if (quality === "standard") return { maxDim: 640, fps: 8, dither: 1.4 };
    if (quality === "ultra") return { maxDim: 1400, fps: 14, dither: 2.6 };
    return { maxDim: 960, fps: 10, dither: 2.0 };
  }, []);

  const getProfileAspect = useCallback((profile: ExportProfile, srcW: number, srcH: number) => {
    if (profile === "vertical") return 9 / 16;
    if (profile === "square") return 1;
    if (profile === "widescreen") return 16 / 9;
    return Math.max(0.0001, srcW / Math.max(1, srcH));
  }, []);

  const getExportDimensions = useCallback((srcW: number, srcH: number, profile: ExportProfile, maxDim: number) => {
    const aspect = getProfileAspect(profile, srcW, srcH);
    const landscape = aspect >= 1;
    let w = 0;
    let h = 0;
    if (landscape) {
      w = maxDim;
      h = Math.max(2, Math.round(w / aspect));
    } else {
      h = maxDim;
      w = Math.max(2, Math.round(h * aspect));
    }
    return { w, h };
  }, [getProfileAspect]);

  const drawCover = useCallback((ctx: CanvasRenderingContext2D, src: CanvasImageSource, srcW: number, srcH: number, dstW: number, dstH: number) => {
    const srcAspect = srcW / Math.max(1, srcH);
    const dstAspect = dstW / Math.max(1, dstH);
    let sx = 0, sy = 0, sw = srcW, sh = srcH;
    if (srcAspect > dstAspect) {
      sw = srcH * dstAspect;
      sx = (srcW - sw) * 0.5;
    } else {
      sh = srcW / dstAspect;
      sy = (srcH - sh) * 0.5;
    }
    ctx.drawImage(src, sx, sy, sw, sh, 0, 0, dstW, dstH);
  }, []);

  // Compose ONE export frame to match what the user sees on screen:
  //   1) WebGL output (cover-fit)
  //   2) DOM scanlines overlay (subtle magenta repeating-linear-gradient)
  //   3) Draw layer with `hard-light` blend (matches mixBlendMode in JSX)
  //   4) Inset 1px magenta border (matches the 10px-inset border in JSX)
  // This eliminates the previous "export looks different from preview" gap
  // where the draw strokes were composited as plain `source-over` and the
  // overlay framing was missing entirely.
  const composeFrame = useCallback((ctx: CanvasRenderingContext2D, dstW: number, dstH: number) => {
    const src = canvasRef.current;
    if (!src) return;
    // 1) main WebGL output
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    drawCover(ctx, src, src.width, src.height, dstW, dstH);
    // 2) scanlines overlay (matches CSS at line ~6483)
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "rgba(176,20,240,0.018)";
    const lineStep = Math.max(2, Math.round(dstH / 540) + 2);
    for (let y = 0; y < dstH; y += lineStep) {
      ctx.fillRect(0, y, dstW, 1);
    }
    // 3) draw layer with hard-light blend (matches mixBlendMode in JSX)
    const dc = drawCanvasRef.current;
    if (dc && dc.width > 0 && dc.height > 0) {
      ctx.globalCompositeOperation = "hard-light";
      ctx.globalAlpha = 1;
      drawCover(ctx, dc, dc.width, dc.height, dstW, dstH);
      ctx.globalCompositeOperation = "source-over";
    }
    // 4) inset border (matches the 10px-inset 1px magenta border)
    const inset = Math.max(4, Math.round(Math.min(dstW, dstH) * 0.012));
    ctx.globalAlpha = 1;
    ctx.strokeStyle = "rgba(176,20,240,0.26)";
    ctx.lineWidth = 1;
    ctx.strokeRect(inset + 0.5, inset + 0.5, dstW - inset * 2 - 1, dstH - inset * 2 - 1);
  }, [drawCover]);

  const getRecordingHintText = useCallback((format: "gif" | "video", quality: "standard" | "high" | "ultra", profile: ExportProfile) => {
    const profileLabel = profile === "native" ? "NATIVE" : profile === "vertical" ? "9:16" : profile === "square" ? "1:1" : "16:9";
    if (format === "gif") {
      const p = getGifProfile(quality);
      return `GIF ${quality.toUpperCase()} • ${profileLabel} • ${p.maxDim} • ${p.fps}FPS`;
    }
    const maxDim = getExportMaxDim(quality);
    return `VIDEO ${quality.toUpperCase()} • ${profileLabel} • ${maxDim}`;
  }, [getExportMaxDim, getGifProfile]);

  // ── Boot animation ────────────────────────────────────────
  useEffect(() => {
    let p = 0;
    const iv = setInterval(() => {
      p += Math.random() * 18 + 5;
      if (p >= 100) { p = 100; clearInterval(iv); setTimeout(() => setBootDone(true), 400); }
      setBootProgress(Math.min(100, p));
    }, 80);
    // Watchdog: force-complete after 4s no matter what so the splash
    // can never hang indefinitely on a stalled state update.
    const watchdog = window.setTimeout(() => {
      clearInterval(iv);
      setBootProgress(100);
      setBootDone(true);
      try { console.warn("[GPS] boot watchdog fired — force-completing splash"); } catch { /* noop */ }
    }, 4000);
    return () => { clearInterval(iv); window.clearTimeout(watchdog); };
  }, []);

  // Surface JS exceptions / unhandled promise rejections to a small
  // on-screen overlay so silent crashes don't leave users staring at a
  // blank or stuck loading screen.
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  useEffect(() => {
    const onErr = (e: ErrorEvent) => {
      const msg = (e?.error && (e.error.stack || e.error.message)) || e.message || "unknown error";
      setRuntimeError(String(msg).slice(0, 800));
    };
    const onRej = (e: PromiseRejectionEvent) => {
      const r = e?.reason;
      const msg = (r && (r.stack || r.message)) || String(r) || "unhandled rejection";
      setRuntimeError(String(msg).slice(0, 800));
    };
    window.addEventListener("error", onErr);
    window.addEventListener("unhandledrejection", onRej);
    return () => {
      window.removeEventListener("error", onErr);
      window.removeEventListener("unhandledrejection", onRej);
    };
  }, []);

  // ── WebGL init ───────────────────────────────────────────
  const initGL = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return false;
    const gl = canvas.getContext("webgl", {
      premultipliedAlpha: false,
      preserveDrawingBuffer: true,
      antialias: false,
      alpha: false,
    }) as WebGLRenderingContext | null;
    if (!gl) { setShaderError("WebGL not supported on this device."); return false; }
    glRef.current = gl;

    const vs = compileShader(gl, gl.VERTEX_SHADER, VERT_SRC);
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, FRAG_SRC);
    if (!vs || !fs) { setShaderError("Shader compile error — see console for details."); return false; }

    const prog = gl.createProgram()!;
    gl.attachShader(prog, vs); gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      const msg = gl.getProgramInfoLog(prog) || "unknown";
      console.error("GL link error:", msg);
      setShaderError("GL link error: " + msg);
      return false;
    }
    gl.useProgram(prog);
    programRef.current = prog;

    const names = ["uCamera","uPrevFrame","uMode","uTime","uResolution","uVideoSize",
      "uGain","uMirror","uTouch","uTouchActive","uAudio","uABass","uATreb","uABeat",
      "uBrightness","uContrast","uSaturation","uHueShift","uScanlines","uZoom",
      "uSortAmt","uScanTear","uBlockGlitch","uDatamosh","uChrash","uMask",
      "uLiquid","uFeedback","uContour","uAscii","uVenetian",
      "uKaleido","uDisrupt","uDisruptCount","uDisruptSize","uDisruptContrary","uDisruptShape",
      "uTile","uInvert","uDroste","uSpiral","uYantra","uMandala","uRosette","uStarfold","uHexfold",
      "uSortKey","uSortLow","uSortHigh","uSortSegment","uSortRandom","uSortWobble","uSortMode",
      "uSortInterval","uSortAngle",
      "uRgbR","uRgbG","uRgbB","uRgbBars","uRgbSwap",
      "uRupture","uHSync",
      "uMoshIFrame","uMoshMotion","uMoshBleed","uMoshMap","uMoshDistort",
      "uFaceActive","uFaceCenter","uFaceRadius","uFaceInvert",
      "uFaceTex","uFaceTexValid","uFaceFeather",
      "uGlyph","uSortMix","uReact","uVoroSort","uGlyphAtlas","uSortTex",
      "uModeParams[0]"];
      // Mask texture for touch FX
      const maskTex = gl.createTexture();
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, maskTex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 256, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      maskTextureRef.current = maskTex;
      // Face FX person-segmentation texture (R channel = mask). Bound
      // permanently to TEXTURE4 so we can lazy-update it from the
      // MediaPipe segmentation loop without disturbing other slots.
      const faceTex = gl.createTexture();
      gl.activeTexture(gl.TEXTURE4);
      gl.bindTexture(gl.TEXTURE_2D, faceTex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0,0,0,255]));
      faceTextureRef.current = faceTex;
    const u: Record<string,WebGLUniformLocation|null> = {};
    names.forEach(n => { u[n] = gl.getUniformLocation(prog, n); });
    u.uModeParams = u["uModeParams[0]"];
    uniformsRef.current = u;

    const quad = new Float32Array([-1,-1, 1,-1, -1,1, 1,1]);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(prog, "aPosition");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    // Two camera textures (ping-pong prev frame)
    for (let i = 0; i < 2; i++) {
      const tex = gl.createTexture()!;
      gl.activeTexture(gl.TEXTURE0 + i);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      // Initialize with 1×1 black so the texture is complete before camera starts
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0,0,0,255]));
      textures.current.push(tex);
    }

    // v1.2.58 — TEXTURE5: CPU pixel-sort result texture (uploaded from JS
    // every Nth frame after running the real Asendorf algorithm on a
    // 256x144 downscale). Init 1x1 black so it's complete before first run.
    {
      const sTex = gl.createTexture();
      gl.activeTexture(gl.TEXTURE5);
      gl.bindTexture(gl.TEXTURE_2D, sTex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      // v1.2.68 — NEAREST sampling on the CPU sort texture. The CPU
      // Asendorf sort runs at 256x144; LINEAR upscaled it into a soft
      // blur the moment REALSORT was the only knob engaged. NEAREST
      // preserves the crisp per-row sort pixels people expect.
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0,0,0,255]));
      cpuSortTexRef.current = sTex;
    }

    // v1.2.58 — TEXTURE6: Gysin glyph atlas, generated once at boot from
    // a brightness ramp drawn into a 256x256 2D canvas (4x4 grid, 64px
    // per glyph). The atlas is grayscale; the shader uses .r as alpha.
    {
      const gTex = gl.createTexture();
      gl.activeTexture(gl.TEXTURE6);
      gl.bindTexture(gl.TEXTURE_2D, gTex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      // Build the 4x4 atlas: 16 ramp glyphs from sparse → dense.
      // Order: lightest first (index 0 = ' ') so cellL×16 maps darkest→densest naturally.
      const ATLAS = 256, CELL = 64;
      const ramp = [" ", ".", ",", ":", ";", "+", "=", "o", "x", "%", "$", "#", "@", "W", "M", "\u00d1"];
      const ac = document.createElement("canvas");
      ac.width = ATLAS; ac.height = ATLAS;
      const actx = ac.getContext("2d");
      if (actx) {
        actx.fillStyle = "#000";
        actx.fillRect(0, 0, ATLAS, ATLAS);
        actx.fillStyle = "#fff";
        actx.font = `${Math.floor(CELL * 0.85)}px ui-monospace, Menlo, Consolas, monospace`;
        actx.textAlign = "center";
        actx.textBaseline = "middle";
        for (let i = 0; i < 16; i++) {
          const cx = (i % 4) * CELL + CELL / 2;
          const cy = Math.floor(i / 4) * CELL + CELL / 2;
          actx.fillText(ramp[i], cx, cy);
        }
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, ac);
      } else {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0,0,0,255]));
      }
      glyphAtlasTexRef.current = gTex;
    }

    // v1.2.58 — bind the new sampler units once (no need to re-set per frame)
    if (u.uSortTex) gl.uniform1i(u.uSortTex, 5);
    if (u.uGlyphAtlas) gl.uniform1i(u.uGlyphAtlas, 6);

    // Phase 2b: ping-pong FBOs for multi-layer combo composite
    const makeFboTex = () => {
      const t = gl.createTexture()!;
      gl.activeTexture(gl.TEXTURE3);
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0,0,0,255]));
      return t;
    };
    const ta = makeFboTex();
    const tb = makeFboTex();
    const fa = gl.createFramebuffer();
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fa);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, ta, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tb, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    fboARef.current = fa;
    fboBRef.current = fb;
    fboTexARef.current = ta;
    fboTexBRef.current = tb;
    return true;
  }, []);

  // ── Resize handler ────────────────────────────────────────
  const resize = useCallback(() => {
    const canvas = canvasRef.current;
    const gl = glRef.current;
    if (!canvas || !gl) return;
    // v1.2.55 — multiply DPR by renderScaleRef so adaptive resolution
    // can shrink the GL canvas under sustained load (1.0 default,
    // 0.75 when the rolling frametime crosses ~22 ms). The DOM canvas
    // CSS size is unchanged — only the backing store shrinks — so the
    // browser scales the smaller framebuffer up at composite time.
    const baseDpr = Math.min(window.devicePixelRatio || 1, 2);
    const dpr = baseDpr * (renderScaleRef.current || 1);
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    gl.viewport(0, 0, canvas.width, canvas.height);
    // Texture sizes changed — the uniform shadow cache holds a stale
    // uResolution; clear it so the next render re-uploads.
    uniCacheRef.current.clear();
    // Keep temporal feedback textures sized to the framebuffer to avoid copy errors.
    textures.current.forEach((tex, i) => {
      gl.activeTexture(gl.TEXTURE0 + i);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, canvas.width, canvas.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    });
    // Phase 2b: resize FBO color textures to match canvas
    [fboTexARef.current, fboTexBRef.current].forEach(tex => {
      if (!tex) return;
      gl.activeTexture(gl.TEXTURE3);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, canvas.width, canvas.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    });
    // Sync draw overlay canvas
    const dc = drawCanvasRef.current;
    if (dc) { dc.width = canvas.width; dc.height = canvas.height; }
  }, []);

  // ── Render loop ───────────────────────────────────────────
  const modeRef = useRef(mode);
  const gainRef = useRef(gain);
  const comboLayersRef = useRef(comboLayers);
  const paramsByModeRef = useRef(paramsByMode);
  const brightnessRef = useRef(brightness);
  const contrastRef = useRef(contrast);
  const saturationRef = useRef(saturation);
  const hueShiftRef = useRef(hueShift);
  const scanlinesRef = useRef(scanlines);
  const zoomRef = useRef(zoom);
  const speedRef = useRef(speed);
  const cameraActiveRef = useRef(false);
  const cameraFacingRef = useRef<"environment"|"user">("environment");
  const sortAmtRef = useRef(sortAmt);
  const scanTearRef = useRef(scanTear);
  const blockGlitchRef = useRef(blockGlitch);
  const datamoshRef = useRef(datamosh);
  const moshHardRef = useRef(moshHard);
  const chrashRef = useRef(chrash);
  const liquidRef = useRef(liquid);
  const glyphRef = useRef(glyph);
  const sortMixRef = useRef(sortMix);
  const reactDRef = useRef(reactD);
  const voroSortRef = useRef(voroSort);
  // v1.2.58 — CPU pixel-sort scratch + Gysin glyph atlas
  const cpuSortDownCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const cpuSortOutCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const cpuSortTexRef = useRef<WebGLTexture | null>(null);
  const cpuSortTickRef = useRef(0);
  const glyphAtlasTexRef = useRef<WebGLTexture | null>(null);
  const feedbackRef = useRef(feedback);
  const contourRef = useRef(contour);
  const asciiRef = useRef(ascii);
  const venetianRef = useRef(venetian);
  const kaleidoRef = useRef(kaleido);
  const tileRef = useRef(tile);
  const invertSymRef = useRef(invertSym);
  const drosteRef = useRef(droste);
  const spiralRef = useRef(spiral);
  const yantraRef = useRef(yantra);
  const mandalaRef = useRef(mandala);
  const rosetteRef = useRef(rosette);
  const starfoldRef = useRef(starfold);
  const hexfoldRef = useRef(hexfold);
  const disruptRef = useRef(disrupt);
  const disruptCountRef = useRef(disruptCount);
  const disruptSizeRef = useRef(disruptSize);
  const disruptContraryRef = useRef(disruptContrary);
  const disruptShapeRef = useRef(disruptShape);
  const sortKeyRef = useRef(sortKey);
  const sortLowRef = useRef(sortLow);
  const sortHighRef = useRef(sortHigh);
  const sortModeRef = useRef(sortMode);
  const sortSegmentRef = useRef(sortSegment);
  const sortRandomRef = useRef(sortRandom);
  const sortWobbleRef = useRef(sortWobble);
  const sortIntervalRef = useRef(sortInterval);
  const sortAngleRef = useRef(sortAngle);
  const rgbRRef = useRef(rgbR);
  const rgbGRef = useRef(rgbG);
  const rgbBRef = useRef(rgbB);
  const rgbBarsRef = useRef(rgbBars);
  const rgbSwapRef = useRef(rgbSwap);
  const ruptureRef = useRef(rupture);
  const hsyncRef = useRef(hsync);
  const moshIFrameRef = useRef(moshIFrame);
  const moshMotionRef = useRef(moshMotion);
  const moshBleedRef = useRef(moshBleed);
  const moshMapRef = useRef(moshMap);
  const moshDistortRef = useRef(moshDistort);
  useEffect(()=>{ modeRef.current=mode; },[mode]);
  useEffect(()=>{ gainRef.current=gain; },[gain]);
  useEffect(()=>{ comboLayersRef.current=comboLayers; },[comboLayers]);
  const comboModeRef = useRef(comboMode);
  useEffect(()=>{ comboModeRef.current=comboMode; },[comboMode]);
  useEffect(()=>{ paramsByModeRef.current=paramsByMode; },[paramsByMode]);
  useEffect(()=>{ brightnessRef.current=brightness; },[brightness]);
  useEffect(()=>{ contrastRef.current=contrast; },[contrast]);
  useEffect(()=>{ saturationRef.current=saturation; },[saturation]);
  useEffect(()=>{ hueShiftRef.current=hueShift; },[hueShift]);
  useEffect(()=>{ scanlinesRef.current=scanlines; },[scanlines]);
  useEffect(()=>{ zoomRef.current=zoom; },[zoom]);
  useEffect(()=>{ speedRef.current=speed; },[speed]);
  useEffect(()=>{ cameraActiveRef.current=cameraActive; },[cameraActive]);
  useEffect(()=>{ cameraFacingRef.current=cameraFacing; },[cameraFacing]);
  useEffect(()=>{ sourceModeRef.current=sourceMode; },[sourceMode]);
  useEffect(()=>{ genStyleRef.current=genStyle; },[genStyle]);
  useEffect(()=>{ genPaletteRef.current=genPalette; },[genPalette]);
  // v1.2.69 — UNIVERSAL PALETTE: the COLOR rack palette buttons used to
  // only affect generator output (palKey was only read inside the
  // sourceMode === "generator" branch). User reported "universal palette
  // is not working" because in CAMERA / UPLOAD mode tapping WARM / COOL /
  // PINK / ACID / RAINBOW did nothing visible. Map each named palette to
  // a hueShift + saturation pair so the master COLOR palette tints EVERY
  // source uniformly. MONO desaturates. CUSTOM is a no-op so the user's
  // own HUE/SAT knob values stay intact. One-shot per palette change.
  useEffect(() => {
    type PalRecipe = { hueShift: number; saturation: number };
    const recipe: Partial<Record<GenPalette, PalRecipe>> = {
      MONO:    { hueShift:  0.00, saturation: 0.0 },
      WARM:    { hueShift:  0.06, saturation: 1.35 },
      COOL:    { hueShift: -0.18, saturation: 1.35 },
      PINK:    { hueShift:  0.32, saturation: 1.55 },
      ACID:    { hueShift:  0.22, saturation: 1.75 },
      RAINBOW: { hueShift:  0.00, saturation: 1.85 },
    };
    const r = recipe[genPalette];
    if (!r) return; // CUSTOM: leave user's HUE / SAT knobs alone
    setHueShift(r.hueShift);
    setSaturation(r.saturation);
  }, [genPalette]);
  useEffect(()=>{ genAutoCycleRef.current=genAutoCycle; },[genAutoCycle]);
  useEffect(()=>{ genResolutionRef.current=genResolution; },[genResolution]);
  useEffect(()=>{ genDensityRef.current=genDensity; },[genDensity]);
  useEffect(()=>{ genScaleRef.current=genScale; },[genScale]);
  useEffect(()=>{ genSpeedRef.current=genSpeed; },[genSpeed]);
  useEffect(()=>{ genHueRef.current=genHue; },[genHue]);
  useEffect(()=>{ genHueSpreadRef.current=genHueSpread; },[genHueSpread]);
  useEffect(()=>{ genSatRef.current=genSat; },[genSat]);
  useEffect(()=>{ genContrastGRef.current=genContrastG; },[genContrastG]);
  useEffect(()=>{ genWarpRef.current=genWarp; },[genWarp]);
  useEffect(()=>{ genJitterRef.current=genJitter; },[genJitter]);
  useEffect(()=>{ genSeedRef.current=genSeed; },[genSeed]);
  useEffect(()=>{ genInvertRef.current=genInvert; },[genInvert]);
  useEffect(()=>{ genMoshXRef.current=genMoshX; },[genMoshX]);
  useEffect(()=>{ genMoshYRef.current=genMoshY; },[genMoshY]);
  useEffect(()=>{ genScatterRef.current=genScatter; },[genScatter]);
  useEffect(()=>{ genScatterModeRef.current=genScatterMode; },[genScatterMode]);
  useEffect(()=>{ genLayersRef.current=genLayers; },[genLayers]);

  // ── Layer ↔ edit-buffer sync ──────────────────────────────────────
  // When the selected layer changes, hydrate the global edit-buffer state
  // (genStyle, genDensity, ...) from that layer so the knobs/style grid
  // display its values. When the user then changes any knob, the edit
  // pushes back into that layer (or broadcasts to ALL layers if MASTER).
  //
  // v1.3.3 — REMOVED the hydration gate (timing-based counter). Bug: when
  // hydration set values that already matched the edit-buffer (e.g. layer
  // L1 scale=1.0, default scale=1.0 → no state change → writeback never
  // fires → counter stays >0 → next real edit gets swallowed). SCALE was
  // most affected because L1 default == global default.
  //
  // The new approach: writeback effect does a value-equality check
  // against the current layer. If no field differs, it no-ops. This
  // breaks the ping-pong without any timing dependency.
  useEffect(() => {
    const idx = selectedLayer;
    if (idx >= 0 && idx <= 3) {
      // CRITICAL: read FRESH layer values from the ref. Closing over
      // `genLayers` (the dep-less render snapshot) caused the classic
      // ping-pong bug: edits made on MASTER would broadcast, then tapping
      // a layer tab restored stale pre-broadcast values, which writeback
      // then patched back into the layer.
      const L = genLayersRef.current[idx];
      if (!L) return;
      setGenStyle(L.style);
      setGenDensity(L.density);
      setGenScale(L.scale);
      setGenSpeed(L.speed);
      setGenHue(L.hue);
      setGenHueSpread(L.hueSpread);
      setGenSat(L.sat);
      setGenContrastG(L.contrast);
      setGenWarp(L.warp);
      setGenJitter(L.jitter);
      setGenSeed(L.seed);
      setGenInvert(L.invert);
      setGenMoshX(L.moshX);
      setGenMoshY(L.moshY);
      setGenScatter(L.scatter);
      setGenScatterMode(L.scatterMode);
    }
    // MASTER (idx === 4): keep edit-buffer as-is; edits broadcast to all.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLayer]);

  // Writeback effect: any global edit-buffer change → patch into layer(s).
  // Value-equality short-circuit prevents hydration from bouncing back as
  // a write (replaces the old timing-counter gate).
  useEffect(() => {
    const idx = selectedLayerRef.current;
    if (idx >= 0 && idx <= 3) {
      const L = genLayersRef.current[idx];
      if (L
        && L.style === genStyle && L.density === genDensity && L.scale === genScale
        && L.speed === genSpeed && L.hue === genHue && L.hueSpread === genHueSpread
        && L.sat === genSat && L.contrast === genContrastG && L.warp === genWarp
        && L.jitter === genJitter && L.seed === genSeed && L.invert === genInvert
        && L.moshX === genMoshX && L.moshY === genMoshY
        && L.scatter === genScatter && L.scatterMode === genScatterMode) {
        return; // no diff — likely the hydration bounce. Skip.
      }
    }
    setGenLayers(prev => {
      const patch = (L: GenLayer): GenLayer => ({
        ...L,
        style: genStyle, density: genDensity, scale: genScale,
        speed: genSpeed, hue: genHue, hueSpread: genHueSpread, sat: genSat,
        contrast: genContrastG, warp: genWarp, jitter: genJitter,
        seed: genSeed, invert: genInvert,
        moshX: genMoshX, moshY: genMoshY,
        scatter: genScatter, scatterMode: genScatterMode,
      });
      if (idx === 4) return prev.map(patch);
      if (idx >= 0 && idx <= 3) return prev.map((L, i) => i === idx ? patch(L) : L);
      return prev;
    });
  }, [genStyle, genDensity, genScale, genSpeed, genHue, genHueSpread,
      genSat, genContrastG, genWarp, genJitter, genSeed, genInvert,
      genMoshX, genMoshY, genScatter, genScatterMode]);
  useEffect(()=>{ genBlendRef.current=genBlend; },[genBlend]);
  useEffect(()=>{ sortAmtRef.current=sortAmt; },[sortAmt]);
  useEffect(()=>{ scanTearRef.current=scanTear; },[scanTear]);
  useEffect(()=>{ blockGlitchRef.current=blockGlitch; },[blockGlitch]);
  useEffect(()=>{ datamoshRef.current=datamosh; },[datamosh]);
  useEffect(()=>{ moshHardRef.current=moshHard; },[moshHard]);
  useEffect(()=>{ chrashRef.current=chrash; },[chrash]);
  useEffect(()=>{ liquidRef.current=liquid; },[liquid]);
  useEffect(()=>{ glyphRef.current=glyph; },[glyph]);
  useEffect(()=>{ sortMixRef.current=sortMix; },[sortMix]);
  useEffect(()=>{ reactDRef.current=reactD; },[reactD]);
  useEffect(()=>{ voroSortRef.current=voroSort; },[voroSort]);
  useEffect(()=>{ feedbackRef.current=feedback; },[feedback]);
  useEffect(()=>{ contourRef.current=contour; },[contour]);
  useEffect(()=>{ asciiRef.current=ascii; },[ascii]);
  useEffect(()=>{ venetianRef.current=venetian; },[venetian]);
  useEffect(()=>{ kaleidoRef.current=kaleido; },[kaleido]);
  useEffect(()=>{ tileRef.current=tile; },[tile]);
  useEffect(()=>{ invertSymRef.current=invertSym; },[invertSym]);
  useEffect(()=>{ drosteRef.current=droste; },[droste]);
  useEffect(()=>{ spiralRef.current=spiral; },[spiral]);
  useEffect(()=>{ yantraRef.current=yantra; },[yantra]);
  useEffect(()=>{ mandalaRef.current=mandala; },[mandala]);
  useEffect(()=>{ rosetteRef.current=rosette; },[rosette]);
  useEffect(()=>{ starfoldRef.current=starfold; },[starfold]);
  useEffect(()=>{ hexfoldRef.current=hexfold; },[hexfold]);
  useEffect(()=>{ disruptRef.current=disrupt; },[disrupt]);
  useEffect(()=>{ disruptCountRef.current=disruptCount; },[disruptCount]);
  useEffect(()=>{ disruptSizeRef.current=disruptSize; },[disruptSize]);
  useEffect(()=>{ disruptContraryRef.current=disruptContrary; },[disruptContrary]);
  useEffect(()=>{ disruptShapeRef.current=disruptShape; },[disruptShape]);
  useEffect(()=>{ sortKeyRef.current=sortKey; },[sortKey]);
  useEffect(()=>{ sortLowRef.current=sortLow; },[sortLow]);
  useEffect(()=>{ sortHighRef.current=sortHigh; },[sortHigh]);
  useEffect(()=>{ sortModeRef.current=sortMode; },[sortMode]);
  useEffect(()=>{ sortSegmentRef.current=sortSegment; },[sortSegment]);
  useEffect(()=>{ sortRandomRef.current=sortRandom; },[sortRandom]);
  useEffect(()=>{ sortWobbleRef.current=sortWobble; },[sortWobble]);
  useEffect(()=>{ sortIntervalRef.current=sortInterval; },[sortInterval]);
  useEffect(()=>{ sortAngleRef.current=sortAngle; },[sortAngle]);
  useEffect(()=>{ rgbRRef.current=rgbR; },[rgbR]);
  useEffect(()=>{ rgbGRef.current=rgbG; },[rgbG]);
  useEffect(()=>{ rgbBRef.current=rgbB; },[rgbB]);
  useEffect(()=>{ rgbBarsRef.current=rgbBars; },[rgbBars]);
  useEffect(()=>{ rgbSwapRef.current=rgbSwap; },[rgbSwap]);
  useEffect(()=>{ ruptureRef.current=rupture; },[rupture]);
  useEffect(()=>{ hsyncRef.current=hsync; },[hsync]);
  // Auto-bump REALSORT (sortMix) + AMOUNT (sortAmt) ONCE when the user
  // first enters PIXEL SORT mode in this session, so the rack knobs
  // produce a visible result without having to crank the master from
  // zero first. v1.2.66 — bug fix: previously this useEffect listened
  // to [mode, sortMix] and re-fired every time the user dragged REALSORT
  // below 0.05, snapping it back to 0.65 — which felt like the app was
  // "restarting" itself. Now we use a one-shot ref so once the user has
  // touched the rack we leave their values alone, including 0. Also
  // bump AMOUNT to 0.5 so the LOW/HIGH/SEGMENT/NOISE/WOBBLE/MODE/
  // INTERVAL/ANGLE knobs (all gated on uSortAmt) actually do something
  // out of the box — previously REALSORT got bumped but AMOUNT stayed
  // at 0 so all the sub-knobs looked dead.
  // v1.2.85 — start "done" so the auto-bump does NOT fire on cold boot
  // (we want sortMix to stay at 0 so first paint shows pure GEN+CAM, not
  // the sort distortion). User toggling away from PXL and back will reset
  // this ref via the cleanup branch below.
  const pxlEntryDoneRef = useRef(true);
  useEffect(() => {
    if (mode !== 7) { pxlEntryDoneRef.current = false; return; }
    if (pxlEntryDoneRef.current) return;
    pxlEntryDoneRef.current = true;
    if (sortMix < 0.05) setSortMix(0.65);
    if (sortAmt < 0.05) setSortAmt(0.5);
  }, [mode, sortMix, sortAmt]);
  // \u2500\u2500 AUTOMATE: drift generator knobs on an LFO interval. Generator-only.
  useEffect(() => {
    if (!automateOn) return;
    if (sourceMode !== "generator") return;
    const periodMs = Math.max(120, 1400 - automateRate * 1250);
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      const r = () => Math.random();
      // Gentle nudge: blend current toward random target by 18% each tick.
      const lerp = (cur: number, tgt: number) => cur + (tgt - cur) * 0.18;
      setGenDensity(p => lerp(p, 0.15 + r() * 0.8));
      setGenScale(p   => lerp(p, 0.4  + r() * 2.6));
      setGenSpeed(p   => lerp(p, 0.2  + r() * 1.6));
      setGenHue(p     => (p + 0.05 + r() * 0.08) % 1);
      setGenHueSpread(p => lerp(p, 0.1 + r() * 0.7));
      setGenSat(p     => lerp(p, 0.45 + r() * 0.55));
      setGenContrastG(p => lerp(p, 0.3 + r() * 0.65));
      setGenWarp(p    => lerp(p, r() * 0.85));
      setGenJitter(p  => lerp(p, r() * 0.7));
      // Occasional flips, on a slower cadence than the knob drift.
      if (automateStyles && r() < 0.18) {
        const styles = GEN_STYLES as readonly string[];
        setGenStyle(styles[Math.floor(r() * styles.length)] as GenStyle);
      }
      if (automateBlend && r() < 0.12) {
        setGenBlend(GEN_BLEND_KEYS[Math.floor(r() * GEN_BLEND_KEYS.length)]);
      }
    };
    tick();
    const id = window.setInterval(tick, periodMs);
    return () => { cancelled = true; window.clearInterval(id); };
  }, [automateOn, automateRate, automateStyles, automateBlend, sourceMode]);
  useEffect(()=>{ moshIFrameRef.current=moshIFrame; },[moshIFrame]);
  useEffect(()=>{ moshMotionRef.current=moshMotion; },[moshMotion]);
  useEffect(()=>{ moshBleedRef.current=moshBleed; },[moshBleed]);
  useEffect(()=>{ moshMapRef.current=moshMap; },[moshMap]);
  useEffect(()=>{ moshDistortRef.current=moshDistort; },[moshDistort]);
  useEffect(()=>{ brushColorRef.current=brushColor; },[brushColor]);
  useEffect(()=>{ colorCycleRef.current=colorCycle; },[colorCycle]);
  useEffect(()=>{ brushTypeRef.current=brushType; },[brushType]);

  // ── Collapsible panel sections ────────────────────────────
  const [openSections, setOpenSections] = useState<Set<string>>(() => new Set<string>(["modes", "user"]));
  const toggleSection = (key: string) => setOpenSections(prev => {
    const s = new Set(prev); if (s.has(key)) s.delete(key); else s.add(key); return s;
  });

  const render = useCallback(() => {
    // v1.2.54: Pause the entire shader pipeline when the tab/app is hidden.
    // The Capacitor WebView fires `visibilitychange` -> hidden when the app
    // backgrounds, so this saves significant battery + heat without needing
    // an explicit @capacitor/app dependency. We do NOT re-arm the rAF here;
    // a `visibilitychange` listener attached in the lifecycle useEffect
    // restarts the loop when the app foregrounds again.
    if (typeof document !== "undefined" && document.visibilityState !== "visible") {
      // Drop our handle so the visibility listener can reliably restart.
      rafRef.current = 0;
      return;
    }
    // LOW POWER: drop every other frame to halve GPU/CPU load + heat.
    // We still re-arm the RAF so input + state stays responsive.
    // v1.2.55 — also honour the battery-auto flag so an automatic
    // low-battery condition halves framerate even if the user hasn't
    // toggled the manual switch.
    if (lowPowerRef.current || batteryLowRef.current) {
      lowPowerSkipRef.current = !lowPowerSkipRef.current;
      if (lowPowerSkipRef.current) {
        rafRef.current = requestAnimationFrame(render);
        return;
      }
    }
    // Upload mask canvas to mask texture
    const gl = glRef.current;
    const maskTex = maskTextureRef.current;
    const maskCanvas = maskCanvasRef.current;
    if (gl && maskTex && maskCanvas && maskCanvas.width > 0 && maskCanvas.height > 0) {
      try {
        gl.activeTexture(gl.TEXTURE2);
        gl.bindTexture(gl.TEXTURE_2D, maskTex);
        // v1.2.57 — texSubImage2D fast path for the mask too. Re-seed
        // with texImage2D only when the mask canvas is resized (rare
        // — only when the user changes mask brush mode or layout).
        const mw = maskCanvas.width, mh = maskCanvas.height;
        if (mw !== maskTexSizedRef.current.w || mh !== maskTexSizedRef.current.h) {
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, maskCanvas);
          maskTexSizedRef.current = { w: mw, h: mh };
        } else {
          gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, maskCanvas);
        }
      } catch (err) {
        // Some Android WebGL drivers reject canvas-source LUMINANCE uploads.
        // Fall back to disabling the mask path so the FX shader keeps running.
        // eslint-disable-next-line no-console
        console.warn("[mask upload] disabled after error", err);
        touchRef.current.active = false;
      }
    }

    // --- Audio analyser: update audioLevelRef ---
    // v1.2.57 — Run the FFT + RMS pass every other frame (~30 Hz at
    // 60 fps render). Audio energy doesn't change meaningfully faster
    // than that and the cached refs are what the shader sees, so the
    // visual reactivity is identical while CPU drops measurably.
    audioFrameToggleRef.current ^= 1;
    const _doAudio = audioFrameToggleRef.current === 0;
    if (_doAudio && audioAnalyserRef.current && audioDataArrayRef.current) {
      // @ts-expect-error: TypeScript type mismatch, runtime is correct
      audioAnalyserRef.current.getByteTimeDomainData(audioDataArrayRef.current);
      // Compute RMS (root mean square) for audio level
      let sum = 0;
      for (let i = 0; i < audioDataArrayRef.current.length; i++) {
        const v = (audioDataArrayRef.current[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / audioDataArrayRef.current.length);
      // Clamp and smooth
      audioLevelRef.current = audioLevelRef.current * 0.85 + Math.min(1, rms * 2.5) * 0.15;

      // Frequency-domain bass/treble (lazy-allocate matching freq buffer).
      const an = audioAnalyserRef.current;
      const bins = an.frequencyBinCount;
      let freq = audioFreqArrayRef.current;
      if (!freq || freq.length !== bins) {
        freq = new Uint8Array(bins);
        audioFreqArrayRef.current = freq;
      }
      // @ts-expect-error: TypeScript type mismatch, runtime is correct
      an.getByteFrequencyData(freq);
      const bassEnd = Math.max(2, Math.floor(bins * 0.06));   // ~ <250Hz
      const trebStart = Math.floor(bins * 0.45);
      let bSum = 0, tSum = 0;
      for (let i = 0; i < bassEnd; i++) bSum += freq[i];
      for (let i = trebStart; i < bins; i++) tSum += freq[i];
      const bassNorm = (bSum / (bassEnd * 255)) || 0;
      const trebNorm = (tSum / ((bins - trebStart) * 255)) || 0;
      audioBassRef.current   = audioBassRef.current   * 0.78 + bassNorm * 0.22;
      audioTrebleRef.current = audioTrebleRef.current * 0.78 + trebNorm * 0.22;
      // Long-term bass average for beat detection.
      audioBassAvgRef.current = audioBassAvgRef.current * 0.97 + audioBassRef.current * 0.03;
      const beatGap = audioBassRef.current - audioBassAvgRef.current * 1.35;
      // Beat ref: instant rise on threshold cross, slow decay.
      const beatTarget = beatGap > 0 ? Math.min(1, beatGap * 4) : 0;
      if (beatTarget > audioBeatRef.current) audioBeatRef.current = beatTarget;
      else audioBeatRef.current *= 0.90;
    } else if (!audioAnalyserRef.current) {
      // Decay everything when audio is off so generator returns to ambient.
      // (We only enter this branch when audio is genuinely off — not on
      // the half-rate skip frames, which leave the cached refs intact.)
      audioLevelRef.current  *= 0.92;
      audioBassRef.current   *= 0.92;
      audioTrebleRef.current *= 0.92;
      audioBeatRef.current   *= 0.88;
    }

    rafRef.current = requestAnimationFrame(render);
    if (!gl) return;
    timeRef.current += 0.016 * speedRef.current;

    const video = videoRef.current;
    const srcMode = sourceModeRef.current;

    // Lightweight camera motion detector (frame-difference on a tiny luma buffer)
    // to drive generator evolution from real movement in view.
    if (cameraActiveRef.current && video && video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0) {
      motionFrameRef.current++;
      if ((motionFrameRef.current % 3) === 0) {
        let mc = motionSampleCanvasRef.current;
        if (!mc) { mc = document.createElement("canvas"); motionSampleCanvasRef.current = mc; }
        const MW = 64;
        const MH = 36;
        if (mc.width !== MW || mc.height !== MH) { mc.width = MW; mc.height = MH; }
        const mctx = mc.getContext("2d", { willReadFrequently: true });
        if (mctx) {
          mctx.drawImage(video, 0, 0, MW, MH);
          const px = mctx.getImageData(0, 0, MW, MH).data;
          const luma = new Uint8ClampedArray(MW * MH);
          for (let i = 0, p = 0; i < luma.length; i++, p += 4) {
            luma[i] = (px[p] * 0.299 + px[p + 1] * 0.587 + px[p + 2] * 0.114) | 0;
          }
          const prev = motionPrevLumaRef.current;
          if (prev) {
            let sum = 0;
            for (let i = 0; i < luma.length; i += 2) sum += Math.abs(luma[i] - prev[i]);
            const norm = Math.min(1, sum / ((luma.length / 2) * 28));
            motionEnergyRef.current = motionEnergyRef.current * 0.84 + norm * 0.16;
          }
          motionPrevLumaRef.current = luma;
        }
      }
    } else {
      motionEnergyRef.current *= 0.92;
    }

    let texSource: TexImageSource | null = null;
    let srcW = 0;
    let srcH = 0;
    if (srcMode === "upload") {
      const upV = uploadVideoRef.current;
      const upI = uploadImgRef.current;
      if (upV && upV.readyState >= 2 && upV.videoWidth > 0) {
        texSource = upV; srcW = upV.videoWidth; srcH = upV.videoHeight;
      } else if (upI && upI.complete && upI.naturalWidth > 0) {
        texSource = upI; srcW = upI.naturalWidth; srcH = upI.naturalHeight;
      }
      // v1.2.77 — BAKE DRAW STROKES INTO THE SOURCE so the shader
      // glitch / pixel-sort / datamosh FX warp the strokes too.
      // Previously the draw canvas was a screen-blend overlay sitting
      // above the WebGL output (opacity 0.32) so paintwork looked
      // washed out and never picked up the corruption FX. Now we
      // composite onto a scratch canvas and feed THAT to the shader.
      const dc = drawCanvasRef.current;
      if (texSource && drawActive && drawAvailable && dc && dc.width > 0 && dc.height > 0 && srcW > 0 && srcH > 0) {
        let dcc = drawComposeCanvasRef.current;
        if (!dcc) { dcc = document.createElement("canvas"); drawComposeCanvasRef.current = dcc; }
        if (dcc.width !== srcW || dcc.height !== srcH) { dcc.width = srcW; dcc.height = srcH; }
        const dctx = dcc.getContext("2d");
        if (dctx) {
          dctx.globalCompositeOperation = "source-over";
          dctx.globalAlpha = 1;
          dctx.clearRect(0, 0, srcW, srcH);
          dctx.drawImage(texSource as CanvasImageSource, 0, 0, srcW, srcH);
          // Strokes burned in at ~85% so the underlying photo still
          // reads through; the shader's downstream FX then mutate them.
          dctx.globalAlpha = 0.85;
          dctx.drawImage(dc, 0, 0, srcW, srcH);
          dctx.globalAlpha = 1;
          texSource = dcc;
        }
      }
    } else if (srcMode === "generator") {
      // Lazily allocate generator canvas at output resolution.
      const targetW = canvasRef.current?.width || 720;
      const targetH = canvasRef.current?.height || 720;
      let gc = genCanvasRef.current;
      if (!gc) { gc = document.createElement("canvas"); genCanvasRef.current = gc; }
      if (gc.width !== targetW || gc.height !== targetH) {
        gc.width = targetW; gc.height = targetH;
      }
      // Generator is reactive in flat-source mode: accelerometer + camera-frame
      // motion gently MODULATE evolution (additive only, heavily low-passed).
      // Color comes from the active palette; CUSTOM falls back to HUE/SPREAD/SAT
      // knobs. Auto-cycle slowly drifts the base hue when the palette permits.
      const accelE = accelEnergyRef.current;
      const camE   = motionEnergyRef.current;
      const pushRaw  = accelPushRef.current;
      const tiltXraw = accelTiltXRef.current;
      const tiltYraw = accelTiltYRef.current;
      // Audio reactivity — RMS, bass and beat fold into the same drive bus.
      const audioLvl  = audioLevelRef.current;
      const audioBass = audioBassRef.current;
      const audioTreb = audioTrebleRef.current;
      const audioBeat = audioBeatRef.current;
      // Combined "is anything happening on the mic right now?" signal —
      // used as a global multiplier so the generator is OBVIOUSLY alive
      // when the user enables the mic. Without this, the per-param
      // audio terms below are too small to be visible against ambient
      // tilt/cam motion.
      const audioAny = Math.min(1, Math.max(audioLvl * 1.4, audioBass * 1.6, audioTreb * 1.3, audioBeat));
      const driveRaw = Math.min(1,
        accelE * 0.85
        + camE * 0.55
        + audioLvl * 1.10
        + audioBass * 0.85
        + audioBeat * 0.40
      );

      // Heavy one-pole low-pass — slow lerp toward target so values never
      // snap. Tilt is smoothed AGGRESSIVELY (k=0.025) so accelerometer
      // micro-jitter doesn't translate into a perceptible loopy wobble in
      // the generator field. Push smooths fast-up / slow-down so taps
      // feel like soft pulses.
      // Audio drives this bus — use a faster attack when the new target
      // is louder so beats actually punch through, but keep the slow
      // decay so the field doesn't strobe.
      const driveK = driveRaw > genDriveSmoothRef.current ? 0.18 : 0.04;
      genDriveSmoothRef.current += (driveRaw - genDriveSmoothRef.current) * driveK;
      genTiltXSmoothRef.current += (tiltXraw - genTiltXSmoothRef.current) * 0.025;
      genTiltYSmoothRef.current += (tiltYraw - genTiltYSmoothRef.current) * 0.025;
      // Push channel = physical impulse + audio beat (additive, fast-up/slow-down).
      const pushTarget = Math.min(1, pushRaw + audioBeat * 1.20);
      const pushK = pushTarget > genPushSmoothRef.current ? 0.30 : 0.04;
      genPushSmoothRef.current += (pushTarget - genPushSmoothRef.current) * pushK;
      const drive = genDriveSmoothRef.current;
      const tiltX = genTiltXSmoothRef.current;
      const tiltY = genTiltYSmoothRef.current;
      const push  = genPushSmoothRef.current;

      // Organic ambient flow — sum of THREE incommensurate sines per
      // axis (irrational frequency ratios) so the curve never closes a
      // loop within any practical session length. Amplitudes sum to ~0.18
      // so the field is always perceptibly drifting even with zero tilt,
      // but the motion stays fluid (no high-frequency wobble) and
      // evolves — successive seconds never repeat the previous second.
      genFlowXRef.current += 0.0011;
      genFlowYRef.current += 0.00083;
      const fxA = genFlowXRef.current;
      const fyA = genFlowYRef.current;
      const flowX = Math.sin(fxA)              * 0.090
                  + Math.sin(fxA * 1.6180 + 1.7) * 0.055
                  + Math.sin(fxA * 0.4142 + 4.1) * 0.040;
      const flowY = Math.cos(fyA)              * 0.090
                  + Math.cos(fyA * 1.4142 + 2.3) * 0.055
                  + Math.cos(fyA * 0.6180 + 5.2) * 0.040;

      // Time only ever moves forward, monotonically at a constant
      // wall-clock rate (≈60fps step). Per-layer speed scaling happens
      // INSIDE drawPixelGenerator via p.speed — doing it here too would
      // square the slider (move 0.6 → 0.36, move 2 → 4). Motion adds a
      // bounded boost on top so beats and tilt still kick the cadence.
      const baseStep = 0.016;
      const motionStep = baseStep * drive * 0.45;
      // Audio explicitly speeds up the evolution clock — bass moves the
      // field faster, treble adds a small jitter step so high-frequency
      // content (hi-hats, claps) shows up as crisper detail churn.
      const audioStep  = baseStep * (audioBass * 1.20 + audioLvl * 0.45 + audioTreb * 0.25 + audioBeat * 0.65);
      const ambientDrift = 0.0011 + ((genSeedRef.current % 101) / 101) * 0.0019;
      genTimeRef.current += baseStep + motionStep + audioStep + ambientDrift;

      const palKey = genPaletteRef.current;
      const pal = GEN_PALETTES[palKey];
      // Slow auto cycle (~ one full hue revolution every ~28s when active).
      // Only meaningful for non-CUSTOM palettes — in CUSTOM the per-layer
      // hue knob is the source of truth, so don't burn cycles drifting a
      // value that nothing reads.
      if (genAutoCycleRef.current && pal.cycle && palKey !== "CUSTOM") {
        genHueCycleRef.current = (genHueCycleRef.current + 0.0006) % 1;
      }
      let palHue: number;
      let palSpread: number;
      let palSat: number;
      if (palKey === "CUSTOM") {
        palHue = genHueRef.current;
        palSpread = genHueSpreadRef.current;
        palSat = genSatRef.current;
      } else {
        palHue = (pal.hue + genHueCycleRef.current) % 1;
        palSpread = pal.spread;
        palSat = pal.sat;
      }

      // Build the list of active layers (full per-layer param objects).
      // Always at least one — fall back to the legacy global edit-buffer.
      // We keep the ORIGINAL layer index alongside each entry so the
      // per-layer scatter pulse buffer can be looked up correctly.
      const layerDefs = genLayersRef.current;
      const activeIndexed: { L: GenLayer; idx: number }[] = layerDefs
        .map((L, idx) => ({ L, idx }))
        .filter(x => x.L.enabled);
      if (activeIndexed.length === 0) {
        activeIndexed.push({ idx: 0, L: {
          style: genStyleRef.current, enabled: true,
          density: genDensityRef.current, scale: genScaleRef.current,
          speed: genSpeedRef.current, hue: genHueRef.current,
          hueSpread: genHueSpreadRef.current, sat: genSatRef.current,
          contrast: genContrastGRef.current, warp: genWarpRef.current,
          jitter: genJitterRef.current, seed: genSeedRef.current,
          invert: genInvertRef.current,
          moshX: genMoshXRef.current, moshY: genMoshYRef.current,
          scatter: genScatterRef.current, scatterMode: genScatterModeRef.current,
        }});
      }

      // Decay every layer's transient scatter pulse this frame (~400ms half-life).
      const pulses = scatterPulsesRef.current;
      for (let i = 0; i < pulses.length; i++) {
        if (pulses[i].amt > 0.0008) pulses[i].amt *= 0.93;
        else pulses[i].amt = 0;
      }

      const baseEnv = {
        resolution: genResolutionRef.current,
        time: genTimeRef.current,
        // Audio nudges the motion field too — bass pushes laterally,
        // treble adds a small wiggle so the pattern visibly breathes
        // with the mic input.
        motionX: tiltX * 0.7 + flowX + audioBass * 0.18 - audioTreb * 0.10,
        motionY: tiltY * 0.7 + flowY + audioBeat * 0.22,
        depthPush: Math.min(1, push * 0.6 + audioBeat * 0.55 + audioAny * 0.20),
      };
      // Map a layer's own params into a full GenParams record, plus the
      // shared environment + motion-driven boosts (jitter, warp, density).
      // The per-layer mosh axes + scatter knob are passed straight through
      // so each layer's pixel-blend movement stays specific to itself.
      const paramsForLayer = (L: GenLayer, idx: number) => {
        const pulse = (idx >= 0 && idx < 4) ? pulses[idx].amt : 0;
        const pulseMode = (idx >= 0 && idx < 4) ? pulses[idx].mode : L.scatterMode;
        // Knob mode wins when sustained scatter is non-trivial; otherwise
        // a momentary pulse picks its own mode (set when the button fired).
        const useMode = (L.scatter > 0.02) ? L.scatterMode : pulseMode;
        return {
          ...baseEnv,
          style: L.style,
          density: Math.min(1, L.density + drive * 0.06 + audioBass * 0.10),
          scale: L.scale,
          // Per-layer speed * global gen speed — multiplied ONCE here, not
          // again in the time accumulator (see baseStep comment above).
          speed: L.speed * Math.max(0.001, genSpeedRef.current),
          // Palette routing: in CUSTOM, per-layer hue/spread/sat win.
          // For any named palette, the palette overrides per-layer values
          // — otherwise the palette dropdown looks broken (knob still
          // shows L.hue but global palette claims to be different).
          hue: palKey === "CUSTOM" ? L.hue : palHue,
          hueSpread: palKey === "CUSTOM" ? L.hueSpread : palSpread,
          sat: palKey === "CUSTOM" ? L.sat : palSat,
          contrast: L.contrast,
          warp: Math.min(1, L.warp + drive * 0.10),
          jitter: Math.min(1, L.jitter + push * 0.10 + audioTreb * 0.18),
          seed: L.seed,
          invert: L.invert,
          moshX: L.moshX,
          moshY: L.moshY,
          scatter: L.scatter,
          scatterMode: useMode,
          scatterPulse: pulse,
        };
      };

      if (activeIndexed.length === 1) {
        const e0 = activeIndexed[0];
        const blendMode = genBlendRef.current;
        const gctx2 = gc.getContext("2d");
        if (blendMode === "AVG" || !gctx2) {
          drawPixelGenerator(gc, paramsForLayer(e0.L, e0.idx));
        } else {
          // Single-layer blend: composite the new frame against the
          // previous frame using a canvas blend op so the BLEND buttons
          // (MAX/MIN/XOR/ADD/SUB/DIFF/MUL) actually do something visible
          // even with one generator layer.
          type FbHost = HTMLCanvasElement & { _gscFbCv?: HTMLCanvasElement };
          const host = gc as FbHost;
          let fb = host._gscFbCv;
          if (!fb || fb.width !== gc.width || fb.height !== gc.height) {
            fb = document.createElement("canvas");
            fb.width = gc.width; fb.height = gc.height;
            host._gscFbCv = fb;
          }
          const fbCtx = fb.getContext("2d");
          if (fbCtx) fbCtx.drawImage(gc, 0, 0); // capture previous frame
          drawPixelGenerator(gc, paramsForLayer(e0.L, e0.idx));
          // v1.2.66 — use the extended GEN_BLEND_OP map (16+ Photoshop
          // style blend modes via Canvas2D globalCompositeOperation).
          const op = GEN_BLEND_OP[blendMode] ?? "source-over";
          const prevAlpha = gctx2.globalAlpha;
          gctx2.globalCompositeOperation = op;
          // v1.2.65 — full alpha so BLEND ops fully transform the source
          // instead of ghost-blending. Per the "no opacity layers, hit
          // source" mandate.
          gctx2.globalAlpha = 1.0;
          gctx2.drawImage(fb, 0, 0);
          gctx2.globalAlpha = prevAlpha;
          gctx2.globalCompositeOperation = "source-over";
        }
      } else {
        // Multi-layer: render each style to its own SMALL offscreen canvas
        // (1/3 of gc), then FUSE per-pixel and upscale to gc. Per-pixel
        // coupling at full resolution is too slow on phones; the texture
        // is already pixel-scaled so the resolution loss is invisible.
        const fuseW = Math.max(64, Math.min(360, Math.round(gc.width  / 3)));
        const fuseH = Math.max(64, Math.min(360, Math.round(gc.height / 3)));
        const layerCanvases = genLayerCanvasesRef.current;
        for (let i = 0; i < activeIndexed.length; i++) {
          let lc = layerCanvases[i];
          if (!lc) { lc = document.createElement("canvas"); layerCanvases[i] = lc; }
          if (lc.width !== fuseW || lc.height !== fuseH) {
            lc.width = fuseW; lc.height = fuseH;
          }
          const e = activeIndexed[i];
          drawPixelGenerator(lc, paramsForLayer(e.L, e.idx));
        }
        // Trim cache so unused canvases are released for GC.
        if (layerCanvases.length > activeIndexed.length) {
          layerCanvases.length = activeIndexed.length;
        }
        const gctx = gc.getContext("2d");
        if (gctx) {
          // Read pixels from each layer at the FUSE (small) resolution.
          const W2 = fuseW, H2 = fuseH;
          const layerImages: ImageData[] = [];
          for (let i = 0; i < layerCanvases.length; i++) {
            const lctx = layerCanvases[i].getContext("2d");
            if (!lctx) continue;
            layerImages.push(lctx.getImageData(0, 0, W2, H2));
          }
          if (layerImages.length > 0) {
            const out = gctx.createImageData(W2, H2);
            const od = out.data;
            const N = layerImages.length;
            const blendModeRaw = genBlendRef.current;
            // v1.2.66 — multi-layer per-pixel fuse only knows the
            // legacy 8 blend modes (they include inter-layer pixel
            // displacement coupling). For the new Photoshop-style
            // modes (NORMAL/DARKEN/MULTIPLY/COLORBURN/etc.) we route
            // the per-pixel fuse through AVG (so coupling still
            // happens) and then apply the chosen Canvas blend as a
            // post flatten step further down. This keeps motion alive
            // for the new modes while still showing the painter blend.
            const LEGACY_FUSE = new Set(["AVG","MAX","MIN","XOR","ADD","SUB","DIFF","MUL"]);
            const blendMode = LEGACY_FUSE.has(blendModeRaw) ? blendModeRaw : "AVG";
            // Precompute references for tight inner loop.
            const datas: Uint8ClampedArray[] = layerImages.map(im => im.data);

            // ── Inter-layer coupling ──────────────────────────────────
            // Each layer's pixels get displaced by the *gradient* of the
            // NEXT layer's luminance — so brighter regions in layer (i+1)
            // push layer i's pixels away from them, and vice versa. The
            // result is pixels that visibly bounce/flow off each other
            // rather than sitting at the same coordinate. A small feedback
            // buffer also retains a fraction of the previous fused frame
            // so motion has true momentum across frames.
            const lum: Uint8Array[] = new Array(N);
            for (let i = 0; i < N; i++) {
              const d = datas[i];
              const L = new Uint8Array(W2 * H2);
              for (let q = 0, j = 0; q < d.length; q += 4, j++) {
                // Rec.601 luma, fast int.
                L[j] = (d[q] * 77 + d[q+1] * 150 + d[q+2] * 29) >> 8;
              }
              lum[i] = L;
            }
            // Coupling strength scales with how many layers are active.
            const COUP = Math.min(8, 2 + N * 1.5);

            // Persistent feedback buffer (previous fused frame).
            const fb = (gc as HTMLCanvasElement & { _gscFb?: Uint8Array })._gscFb;
            const FB = (fb && fb.length === od.length) ? fb : new Uint8Array(od.length);
            (gc as HTMLCanvasElement & { _gscFb?: Uint8Array })._gscFb = FB;
            const FB_MIX = 0.18; // 0..1 fraction of previous frame retained

            for (let y = 0; y < H2; y++) {
              const rowOff = y * W2;
              for (let x = 0; x < W2; x++) {
                const idx = rowOff + x;
                let r = 0, g = 0, b = 0;

                // Per-layer displaced sample indices.
                // dx_i, dy_i derived from gradient of lum[(i+1)%N] at (x,y).
                // sobel-ish 3-tap: Lx = L[x+1] - L[x-1], Ly = L[y+1] - L[y-1].
                // Then sample layer i at (x - Lx*coup, y - Ly*coup) so bright
                // areas in the partner layer REPEL this layer (push pixels
                // outward) — visible "bounce off" behaviour.
                if (blendMode === "AVG") {
                  for (let i = 0; i < N; i++) {
                    const partner = lum[(i + 1) % N];
                    const xm = x > 0 ? x - 1 : x;
                    const xp = x < W2 - 1 ? x + 1 : x;
                    const ym = y > 0 ? y - 1 : y;
                    const yp = y < H2 - 1 ? y + 1 : y;
                    const Lx = (partner[rowOff + xp] - partner[rowOff + xm]) / 255;
                    const Ly = (partner[yp * W2 + x] - partner[ym * W2 + x]) / 255;
                    let sx = x - (Lx * COUP) | 0;
                    let sy = y - (Ly * COUP) | 0;
                    if (sx < 0) sx = 0; else if (sx >= W2) sx = W2 - 1;
                    if (sy < 0) sy = 0; else if (sy >= H2) sy = H2 - 1;
                    const sp = (sy * W2 + sx) << 2;
                    const d = datas[i];
                    r += d[sp]; g += d[sp+1]; b += d[sp+2];
                  }
                  r = (r / N) | 0; g = (g / N) | 0; b = (b / N) | 0;
                } else if (blendMode === "MAX") {
                  for (let i = 0; i < N; i++) {
                    const partner = lum[(i + 1) % N];
                    const xm = x > 0 ? x - 1 : x, xp = x < W2 - 1 ? x + 1 : x;
                    const ym = y > 0 ? y - 1 : y, yp = y < H2 - 1 ? y + 1 : y;
                    const Lx = (partner[rowOff + xp] - partner[rowOff + xm]) / 255;
                    const Ly = (partner[yp * W2 + x] - partner[ym * W2 + x]) / 255;
                    let sx = x - (Lx * COUP) | 0, sy = y - (Ly * COUP) | 0;
                    if (sx < 0) sx = 0; else if (sx >= W2) sx = W2 - 1;
                    if (sy < 0) sy = 0; else if (sy >= H2) sy = H2 - 1;
                    const sp = (sy * W2 + sx) << 2;
                    const d = datas[i];
                    if (d[sp]   > r) r = d[sp];
                    if (d[sp+1] > g) g = d[sp+1];
                    if (d[sp+2] > b) b = d[sp+2];
                  }
                } else if (blendMode === "MIN") {
                  r = 255; g = 255; b = 255;
                  for (let i = 0; i < N; i++) {
                    const partner = lum[(i + 1) % N];
                    const xm = x > 0 ? x - 1 : x, xp = x < W2 - 1 ? x + 1 : x;
                    const ym = y > 0 ? y - 1 : y, yp = y < H2 - 1 ? y + 1 : y;
                    const Lx = (partner[rowOff + xp] - partner[rowOff + xm]) / 255;
                    const Ly = (partner[yp * W2 + x] - partner[ym * W2 + x]) / 255;
                    let sx = x - (Lx * COUP) | 0, sy = y - (Ly * COUP) | 0;
                    if (sx < 0) sx = 0; else if (sx >= W2) sx = W2 - 1;
                    if (sy < 0) sy = 0; else if (sy >= H2) sy = H2 - 1;
                    const sp = (sy * W2 + sx) << 2;
                    const d = datas[i];
                    if (d[sp]   < r) r = d[sp];
                    if (d[sp+1] < g) g = d[sp+1];
                    if (d[sp+2] < b) b = d[sp+2];
                  }
                } else if (blendMode === "XOR") {
                  // XOR uses raw (no displacement) to keep the bit-pattern crisp.
                  const p = idx << 2;
                  r = datas[0][p];   g = datas[0][p+1]; b = datas[0][p+2];
                  for (let i = 1; i < N; i++) {
                    const d = datas[i];
                    r ^= d[p]; g ^= d[p+1]; b ^= d[p+2];
                  }
                } else if (blendMode === "ADD") {
                  for (let i = 0; i < N; i++) {
                    const partner = lum[(i + 1) % N];
                    const xm = x > 0 ? x - 1 : x, xp = x < W2 - 1 ? x + 1 : x;
                    const ym = y > 0 ? y - 1 : y, yp = y < H2 - 1 ? y + 1 : y;
                    const Lx = (partner[rowOff + xp] - partner[rowOff + xm]) / 255;
                    const Ly = (partner[yp * W2 + x] - partner[ym * W2 + x]) / 255;
                    let sx = x - (Lx * COUP) | 0, sy = y - (Ly * COUP) | 0;
                    if (sx < 0) sx = 0; else if (sx >= W2) sx = W2 - 1;
                    if (sy < 0) sy = 0; else if (sy >= H2) sy = H2 - 1;
                    const sp = (sy * W2 + sx) << 2;
                    const d = datas[i];
                    r += d[sp]; g += d[sp+1]; b += d[sp+2];
                  }
                  if (r > 255) r = 255; if (g > 255) g = 255; if (b > 255) b = 255;
                } else if (blendMode === "SUB") {
                  const p0 = idx << 2;
                  r = datas[0][p0]; g = datas[0][p0+1]; b = datas[0][p0+2];
                  for (let i = 1; i < N; i++) {
                    const partner = lum[(i + 1) % N];
                    const xm = x > 0 ? x - 1 : x, xp = x < W2 - 1 ? x + 1 : x;
                    const ym = y > 0 ? y - 1 : y, yp = y < H2 - 1 ? y + 1 : y;
                    const Lx = (partner[rowOff + xp] - partner[rowOff + xm]) / 255;
                    const Ly = (partner[yp * W2 + x] - partner[ym * W2 + x]) / 255;
                    let sx = x - (Lx * COUP) | 0, sy = y - (Ly * COUP) | 0;
                    if (sx < 0) sx = 0; else if (sx >= W2) sx = W2 - 1;
                    if (sy < 0) sy = 0; else if (sy >= H2) sy = H2 - 1;
                    const sp = (sy * W2 + sx) << 2;
                    const d = datas[i];
                    r -= d[sp]; g -= d[sp+1]; b -= d[sp+2];
                  }
                  if (r < 0) r = 0; if (g < 0) g = 0; if (b < 0) b = 0;
                } else if (blendMode === "DIFF") {
                  const p0 = idx << 2;
                  r = datas[0][p0]; g = datas[0][p0+1]; b = datas[0][p0+2];
                  for (let i = 1; i < N; i++) {
                    const partner = lum[(i + 1) % N];
                    const xm = x > 0 ? x - 1 : x, xp = x < W2 - 1 ? x + 1 : x;
                    const ym = y > 0 ? y - 1 : y, yp = y < H2 - 1 ? y + 1 : y;
                    const Lx = (partner[rowOff + xp] - partner[rowOff + xm]) / 255;
                    const Ly = (partner[yp * W2 + x] - partner[ym * W2 + x]) / 255;
                    let sx = x - (Lx * COUP) | 0, sy = y - (Ly * COUP) | 0;
                    if (sx < 0) sx = 0; else if (sx >= W2) sx = W2 - 1;
                    if (sy < 0) sy = 0; else if (sy >= H2) sy = H2 - 1;
                    const sp = (sy * W2 + sx) << 2;
                    const d = datas[i];
                    const dr = r - d[sp];   r = dr < 0 ? -dr : dr;
                    const dg = g - d[sp+1]; g = dg < 0 ? -dg : dg;
                    const db = b - d[sp+2]; b = db < 0 ? -db : db;
                  }
                } else { // MUL
                  const p0 = idx << 2;
                  r = datas[0][p0]; g = datas[0][p0+1]; b = datas[0][p0+2];
                  for (let i = 1; i < N; i++) {
                    const partner = lum[(i + 1) % N];
                    const xm = x > 0 ? x - 1 : x, xp = x < W2 - 1 ? x + 1 : x;
                    const ym = y > 0 ? y - 1 : y, yp = y < H2 - 1 ? y + 1 : y;
                    const Lx = (partner[rowOff + xp] - partner[rowOff + xm]) / 255;
                    const Ly = (partner[yp * W2 + x] - partner[ym * W2 + x]) / 255;
                    let sx = x - (Lx * COUP) | 0, sy = y - (Ly * COUP) | 0;
                    if (sx < 0) sx = 0; else if (sx >= W2) sx = W2 - 1;
                    if (sy < 0) sy = 0; else if (sy >= H2) sy = H2 - 1;
                    const sp = (sy * W2 + sx) << 2;
                    const d = datas[i];
                    r = (r * d[sp])   / 255;
                    g = (g * d[sp+1]) / 255;
                    b = (b * d[sp+2]) / 255;
                  }
                  r |= 0; g |= 0; b |= 0;
                }

                // Feedback: blend in fraction of previous fused frame for
                // momentum so trails actually flow instead of restarting.
                const op = idx << 2;
                r = (r * (1 - FB_MIX) + FB[op]   * FB_MIX) | 0;
                g = (g * (1 - FB_MIX) + FB[op+1] * FB_MIX) | 0;
                b = (b * (1 - FB_MIX) + FB[op+2] * FB_MIX) | 0;
                od[op] = r; od[op+1] = g; od[op+2] = b; od[op+3] = 255;
                FB[op] = r; FB[op+1] = g; FB[op+2] = b; FB[op+3] = 255;
              }
            }
            // Push fused pixels through a small intermediate canvas, then
            // upscale (nearest-neighbour) into gc so we keep the chunky
            // pixel look at full output res.
            const gcExt = gc as HTMLCanvasElement & { _gscFuse?: HTMLCanvasElement };
            let fuseCanvas = gcExt._gscFuse;
            if (!fuseCanvas) { fuseCanvas = document.createElement("canvas"); gcExt._gscFuse = fuseCanvas; }
            if (fuseCanvas.width !== W2 || fuseCanvas.height !== H2) {
              fuseCanvas.width = W2; fuseCanvas.height = H2;
            }
            const fctx = fuseCanvas.getContext("2d");
            if (fctx) {
              fctx.putImageData(out, 0, 0);
              (gctx as CanvasRenderingContext2D & { imageSmoothingEnabled: boolean }).imageSmoothingEnabled = false;
              // v1.2.66 — for the new Photoshop-style blend modes
              // (NORMAL/DARKEN/MULTIPLY/COLORBURN/etc.) we apply the
              // chosen Canvas2D blend as a post-flatten between the
              // previously rendered gc frame and the new fused frame.
              // Legacy modes (AVG/MAX/MIN/etc.) keep the original
              // simple clear+draw path so coupling drives the look.
              if (!LEGACY_FUSE.has(blendModeRaw)) {
                const gcExt2 = gc as HTMLCanvasElement & { _gscFlatPrev?: HTMLCanvasElement };
                let prevC = gcExt2._gscFlatPrev;
                if (!prevC || prevC.width !== gc.width || prevC.height !== gc.height) {
                  prevC = document.createElement("canvas");
                  prevC.width = gc.width; prevC.height = gc.height;
                  gcExt2._gscFlatPrev = prevC;
                }
                const pCtx = prevC.getContext("2d");
                if (pCtx) {
                  pCtx.globalCompositeOperation = "source-over";
                  pCtx.globalAlpha = 1;
                  pCtx.drawImage(gc, 0, 0);
                }
                gctx.clearRect(0, 0, gc.width, gc.height);
                gctx.globalCompositeOperation = "source-over";
                gctx.globalAlpha = 1;
                gctx.drawImage(fuseCanvas, 0, 0, gc.width, gc.height);
                const op = GEN_BLEND_OP[blendModeRaw] ?? "source-over";
                gctx.globalCompositeOperation = op;
                gctx.globalAlpha = 1;
                gctx.drawImage(prevC, 0, 0);
                gctx.globalCompositeOperation = "source-over";
              } else {
                gctx.clearRect(0, 0, gc.width, gc.height);
                gctx.drawImage(fuseCanvas, 0, 0, gc.width, gc.height);
              }
            }
          }
        }
      }

      // Layer modes were removed — both PXL (pixel-sort) and MOSH (datamosh)
      // are always armed and live. The per-effect AMOUNT/INTENS knobs gate
      // whether they actually contribute (zero == bypass). The triple-armed
      // camera-drive composite (generator displaces + overlays the camera)
      // only kicks in when the user has actually dialed in BOTH effects —
      // otherwise the camera passes through clean (no rainbow/invert ghost).
      const armedLayers = comboLayersRef.current;
      void armedLayers;
      // v1.2.64 — PXL is armed when REALSORT (master) is up. AMOUNT alone
      // no longer arms the rack since it now multiplies through sortMix.
      const pxlArmed = (sortMixRef.current ?? 0) > 0.02;
      const moshArmed = (datamoshRef.current ?? 0) > 0.02;
      const tripleArmedCameraDrive = pxlArmed && moshArmed;

      // Generator mode keeps camera alive and composites both when camera frames exist.
      // Skip the heavy displacement + generator-overlay pass entirely when the
      // user hasn't dialed in any blend FX — otherwise the default BLEND view
      // shows a permanent rainbow + inverted ghost over the camera.
      const blendEngaged = pxlArmed || moshArmed;
      if (cameraActiveRef.current && video && video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0 && blendEngaged) {
        let cc = genCompositeCanvasRef.current;
        if (!cc) { cc = document.createElement("canvas"); genCompositeCanvasRef.current = cc; }
        if (cc.width !== targetW || cc.height !== targetH) {
          cc.width = targetW; cc.height = targetH;
        }
        const cctx = cc.getContext("2d");
        if (cctx) {
          cctx.globalCompositeOperation = "source-over";
          cctx.globalAlpha = 1;
          cctx.clearRect(0, 0, cc.width, cc.height);
          cctx.drawImage(video, 0, 0, cc.width, cc.height);
          // ── Generator-as-displacement-map ──────────────────────────
          // Sample the generator at low res, treat its colour channels as
          // (dx, dy) offsets, and re-sample the camera at the displaced
          // coordinate. The result is camera pixels that VISIBLY MOVE
          // wherever the generator pattern is bright/coloured. After this
          // pass we still apply the chosen blend on top so the generator
          // is visible AND drives motion.
          {
            const dW = Math.min(360, Math.max(120, (cc.width  / 4) | 0));
            const dH = Math.min(360, Math.max(120, (cc.height / 4) | 0));
            const ccExt = cc as HTMLCanvasElement & {
              _dispGen?: HTMLCanvasElement;
              _dispVid?: HTMLCanvasElement;
              _dispOut?: HTMLCanvasElement;
            };
            if (!ccExt._dispGen) ccExt._dispGen = document.createElement("canvas");
            if (!ccExt._dispVid) ccExt._dispVid = document.createElement("canvas");
            if (!ccExt._dispOut) ccExt._dispOut = document.createElement("canvas");
            const dG = ccExt._dispGen!, dV = ccExt._dispVid!, dO = ccExt._dispOut!;
            if (dG.width !== dW || dG.height !== dH) { dG.width = dW; dG.height = dH; }
            if (dV.width !== dW || dV.height !== dH) { dV.width = dW; dV.height = dH; }
            if (dO.width !== dW || dO.height !== dH) { dO.width = dW; dO.height = dH; }
            const gCtx = dG.getContext("2d", { willReadFrequently: true });
            const vCtx = dV.getContext("2d", { willReadFrequently: true });
            const oCtx = dO.getContext("2d");
            if (gCtx && vCtx && oCtx) {
              gCtx.drawImage(gc, 0, 0, dW, dH);
              vCtx.drawImage(video, 0, 0, dW, dH);
              const gImg = gCtx.getImageData(0, 0, dW, dH);
              const vImg = vCtx.getImageData(0, 0, dW, dH);
              const out = oCtx.createImageData(dW, dH);
              const gD = gImg.data, vD = vImg.data, oD = out.data;
              // Displacement strength: scaled to canvas + responsive to gen luma.
              const amp = Math.min(dW, dH) * (tripleArmedCameraDrive ? 0.16 : 0.10);
              for (let y = 0; y < dH; y++) {
                for (let x = 0; x < dW; x++) {
                  const i = (y * dW + x) << 2;
                  // Use red channel for X-offset, green for Y-offset.
                  const dx = ((gD[i]   / 255) - 0.5) * 2 * amp;
                  const dy = ((gD[i+1] / 255) - 0.5) * 2 * amp;
                  let sx = (x + dx) | 0;
                  let sy = (y + dy) | 0;
                  if (sx < 0) sx = 0; else if (sx >= dW) sx = dW - 1;
                  if (sy < 0) sy = 0; else if (sy >= dH) sy = dH - 1;
                  const j = (sy * dW + sx) << 2;
                  oD[i  ] = vD[j];
                  oD[i+1] = vD[j+1];
                  oD[i+2] = vD[j+2];
                  oD[i+3] = 255;
                }
              }
              oCtx.putImageData(out, 0, 0);
              cctx.clearRect(0, 0, cc.width, cc.height);
              (cctx as CanvasRenderingContext2D & { imageSmoothingEnabled: boolean }).imageSmoothingEnabled = true;
              cctx.drawImage(dO, 0, 0, cc.width, cc.height);
            }
          }
          if (tripleArmedCameraDrive) {
            // Triple-armed mode: keep motion anchored to camera while generator drives texture.
            cctx.globalCompositeOperation = "soft-light";
            cctx.globalAlpha = 0.64;
            cctx.drawImage(gc, 0, 0, cc.width, cc.height);
            cctx.globalCompositeOperation = "overlay";
            cctx.globalAlpha = 0.36;
            cctx.drawImage(gc, 0, 0, cc.width, cc.height);
            cctx.globalCompositeOperation = "source-over";
            cctx.globalAlpha = 0.24;
            cctx.drawImage(video, 0, 0, cc.width, cc.height);
          } else {
            cctx.globalCompositeOperation = "hard-light";
            cctx.globalAlpha = 0.92;
            cctx.drawImage(gc, 0, 0, cc.width, cc.height);
          }
          cctx.globalCompositeOperation = "source-over";
          cctx.globalAlpha = 1;
          texSource = cc; srcW = cc.width; srcH = cc.height;
        } else {
          texSource = gc; srcW = gc.width; srcH = gc.height;
        }
      } else if (cameraActiveRef.current && video && video.readyState >= 2 && video.videoWidth > 0) {
        // v1.2.80 — GEN+CAM with NO FX armed.
        //  • If the face segmenter is ready (faceFx active + texValid),
        //    set texSource = pure generator. The PERSON-OVER-SOURCE
        //    composite block below will then stamp the camera person on
        //    top, giving us "BG = generator FX, FG = real subject".
        //  • If the segmenter isn't ready yet (cold boot, no model),
        //    fall back to the always-on 55/45 + screen composite so the
        //    user still sees BOTH layers and never gets a black screen.
        if (faceFxRef.current.active && faceFxRef.current.texValid) {
          // v1.2.86 — when FACE mode is armed (invert=false), the
          // intent is "person covered in generator pattern", so we
          // hand the composite block below the camera frame as the
          // base and let it stamp the GENERATOR clipped to the
          // person mask on top. When BG mode is armed (invert=true),
          // we keep the original "generator background + clean
          // person on top" path.
          if (faceFxRef.current.invert) {
            texSource = gc; srcW = gc.width; srcH = gc.height;
          } else {
            texSource = video; srcW = video.videoWidth; srcH = video.videoHeight;
          }
        } else {
          let cc = genCompositeCanvasRef.current;
          if (!cc) { cc = document.createElement("canvas"); genCompositeCanvasRef.current = cc; }
          if (cc.width !== targetW || cc.height !== targetH) {
            cc.width = targetW; cc.height = targetH;
          }
          const cctx = cc.getContext("2d");
          if (cctx) {
            cctx.globalCompositeOperation = "source-over";
            cctx.globalAlpha = 1;
            cctx.clearRect(0, 0, cc.width, cc.height);
            cctx.drawImage(video, 0, 0, cc.width, cc.height);
            cctx.globalCompositeOperation = "source-over";
            cctx.globalAlpha = 0.55;
            cctx.drawImage(gc, 0, 0, cc.width, cc.height);
            cctx.globalCompositeOperation = "screen";
            cctx.globalAlpha = 0.45;
            cctx.drawImage(gc, 0, 0, cc.width, cc.height);
            cctx.globalCompositeOperation = "source-over";
            cctx.globalAlpha = 1;
            texSource = cc; srcW = cc.width; srcH = cc.height;
          } else {
            texSource = video; srcW = video.videoWidth; srcH = video.videoHeight;
          }
        }
      } else {
        texSource = gc; srcW = gc.width; srcH = gc.height;
      }
    } else if (cameraActiveRef.current && video && video.readyState >= 2) {
      texSource = video; srcW = video.videoWidth; srcH = video.videoHeight;
    }

    // v1.2.51 — PERSON-OVER-SOURCE COMPOSITE.
    // When the user is on a non-camera source (generator / upload) AND face
    // FX is engaged, the camera + segmenter run continuously underneath. We
    // cut the person out of the camera frame and stamp them on top of the
    // current texSource so the user appears INSIDE the procedural / uploaded
    // background. The FG (FACE) vs BG knob continues to control which side
    // the FX rack paints on, via the existing uFaceInvert plumbing in the
    // shader — here we only handle the source layering. If the segmenter
    // mask isn't ready yet (texValid=false) we skip the composite this
    // frame and fall back to the un-composited source.
    // v1.2.98 — split the gate. If face FX is armed and the camera is
    // live but the segmenter mask isn't ready yet (texValid=false, e.g.
    // first seconds while MediaPipe wasm loads, or init failed), draw a
    // visible camera fallback under the generator so the user always
    // sees that GEN+CAM is doing something. Without this, a slow / failed
    // segmenter init silently leaves you on pure generator.
    if (
      texSource &&
      srcMode !== "camera" &&
      faceFxRef.current.active &&
      !faceFxRef.current.texValid &&
      cameraActiveRef.current &&
      video && video.readyState >= 2 && video.videoWidth > 0
    ) {
      const W = (texSource as { width?: number }).width ?? srcW;
      const H = (texSource as { height?: number }).height ?? srcH;
      if (W > 0 && H > 0) {
        let out = faceComposeCanvasRef.current;
        if (!out) { out = document.createElement("canvas"); faceComposeCanvasRef.current = out; }
        if (out.width !== W || out.height !== H) { out.width = W; out.height = H; }
        const octx = out.getContext("2d");
        if (octx) {
          octx.globalCompositeOperation = "source-over";
          octx.globalAlpha = 1;
          octx.clearRect(0, 0, W, H);
          octx.drawImage(video, 0, 0, W, H);
          octx.globalCompositeOperation = "hard-light";
          octx.globalAlpha = 0.55;
          octx.drawImage(texSource as CanvasImageSource, 0, 0, W, H);
          octx.globalCompositeOperation = "source-over";
          octx.globalAlpha = 1;
          texSource = out; srcW = W; srcH = H;
        }
      }
    }

    if (
      texSource &&
      srcMode !== "camera" &&
      faceFxRef.current.active &&
      faceFxRef.current.texValid &&
      cameraActiveRef.current &&
      video && video.readyState >= 2 && video.videoWidth > 0
    ) {
      const maskCanvas = faceMaskCanvasRef.current;
      if (maskCanvas) {
        const W = srcW | 0;
        const H = srcH | 0;
        if (W > 0 && H > 0) {
          // Scratch: video-clipped-to-person.
          let person = faceComposePersonRef.current;
          if (!person) { person = document.createElement("canvas"); faceComposePersonRef.current = person; }
          if (person.width !== W || person.height !== H) { person.width = W; person.height = H; }
          const pctx = person.getContext("2d");
          // Output: source + person on top.
          let out = faceComposeCanvasRef.current;
          if (!out) { out = document.createElement("canvas"); faceComposeCanvasRef.current = out; }
          if (out.width !== W || out.height !== H) { out.width = W; out.height = H; }
          const octx = out.getContext("2d");
          if (pctx && octx) {
            // v1.2.86 — branch on FACE vs BG.
            //   BG (invert=true): scratch = video clipped to person,
            //     stamped over generator background. (clean person)
            //   FACE (invert=false): scratch = generator clipped to
            //     person, stamped over the live camera frame so the
            //     subject appears wearing the procedural pattern
            //     while their surroundings stay real.
            const stampSource: CanvasImageSource = faceFxRef.current.invert
              ? (video as CanvasImageSource)
              : (genCanvasRef.current as CanvasImageSource);
            // 1. Fill scratch with the chosen layer.
            pctx.globalCompositeOperation = "source-over";
            pctx.globalAlpha = 1;
            pctx.clearRect(0, 0, W, H);
            pctx.drawImage(stampSource, 0, 0, W, H);
            // 2. Knock out non-person pixels by intersecting with the mask
            //    alpha (mask alpha was set to mask value in v1.2.51).
            pctx.globalCompositeOperation = "destination-in";
            pctx.drawImage(maskCanvas, 0, 0, W, H);
            pctx.globalCompositeOperation = "source-over";
            // 3. Compose: source first, person on top.
            octx.globalCompositeOperation = "source-over";
            octx.globalAlpha = 1;
            octx.clearRect(0, 0, W, H);
            octx.drawImage(texSource as CanvasImageSource, 0, 0, W, H);
            octx.drawImage(person, 0, 0, W, H);
            texSource = out;
          }
        }
      }
    }

    const hasVideo = !!texSource;
    const u = uniformsRef.current;
    const canvas = canvasRef.current!;
    const curTex = textures.current[frameIdxRef.current];
    const prevTex = textures.current[1 - frameIdxRef.current];

    if (hasVideo && texSource) {
      // v1.2.57 — texSubImage2D fast path. Seed both ping-pong slots
      // with texImage2D on the first frame (or whenever the source
      // dimensions change), then switch to texSubImage2D for the
      // steady-state uploads — saves a driver-side reallocation +
      // texture-completeness check per frame.
      type Sized = { videoWidth?: number; videoHeight?: number; width?: number; height?: number };
      const ts = texSource as unknown as Sized;
      const sw = ts.videoWidth ?? ts.width ?? 0;
      const sh = ts.videoHeight ?? ts.height ?? 0;
      const sizeChanged = sw !== cameraTexSizedRef.current.w || sh !== cameraTexSizedRef.current.h;
      if (firstFrameRef.current || sizeChanged) {
        for (let i = 0; i < 2; i++) {
          gl.activeTexture(gl.TEXTURE0 + i);
          gl.bindTexture(gl.TEXTURE_2D, textures.current[i]);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, texSource);
        }
        firstFrameRef.current = false;
        cameraTexSizedRef.current = { w: sw, h: sh };
      } else {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, curTex);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, texSource);
      }
    }

    // v1.2.58 — CPU PIXEL SORT tick (real Asendorf 2010 algorithm).
    // Throttled to ~20 Hz on a 256x144 downscale (~37k pixels). Uses a
    // packed Uint32 view of the ImageData for typed-array .sort() which
    // is numeric — sorts each above-threshold run in place by 32-bit RGBA
    // value (the Asendorf 'absolute rgb' key). The sorted canvas is
    // uploaded to TEXTURE5 / uSortTex; the shader's uSortMix block blends.
    if (sortMixRef.current > 0.001 && hasVideo && texSource && cpuSortTexRef.current) {
      cpuSortTickRef.current = (cpuSortTickRef.current + 1) % 3;
      if (cpuSortTickRef.current === 0) {
        try {
          const SW = 256, SH = 144;
          let dc = cpuSortDownCanvasRef.current;
          let oc = cpuSortOutCanvasRef.current;
          if (!dc) { dc = document.createElement("canvas"); dc.width = SW; dc.height = SH; cpuSortDownCanvasRef.current = dc; }
          if (!oc) { oc = document.createElement("canvas"); oc.width = SW; oc.height = SH; cpuSortOutCanvasRef.current = oc; }
          const dctx = dc.getContext("2d", { willReadFrequently: true });
          const octx = oc.getContext("2d");
          if (dctx && octx) {
            dctx.drawImage(texSource as CanvasImageSource, 0, 0, SW, SH);
            const img = dctx.getImageData(0, 0, SW, SH);
            const px32 = new Uint32Array(img.data.buffer);
            // v1.2.61 — sort key is LUMA packed into the high byte so the
            // numeric .sort() reorders the run by brightness (classic
            // Asendorf look), not by raw blue-dominant RGBA32. We build a
            // parallel Uint32 (luma<<24 | runIndex) key array, sort it,
            // then scatter the original pixels into a scratch in key order.
            // Threshold maps the slider so higher uSortMix = lower threshold
            // = more pixels caught in runs (more visible sort). Range 60..200.
            const thr = Math.max(20, Math.min(220, Math.floor(200 - sortMixRef.current * 140)));
            // Hoisted scratch buffers — reused across every run in every
            // row of the frame to avoid per-run GC churn.
            const keysAll = new Uint32Array(SW);
            const scratch = new Uint32Array(SW);
            for (let y = 0; y < SH; y++) {
              const rowOff = y * SW;
              let x = 0;
              while (x < SW) {
                // skip below-threshold
                while (x < SW) {
                  const p = px32[rowOff + x];
                  const r = p & 0xff, g = (p >>> 8) & 0xff, b = (p >>> 16) & 0xff;
                  const L = (r * 76 + g * 150 + b * 29) >>> 8;
                  if (L > thr) break;
                  x++;
                }
                const start = x;
                // walk above-threshold
                while (x < SW) {
                  const p = px32[rowOff + x];
                  const r = p & 0xff, g = (p >>> 8) & 0xff, b = (p >>> 16) & 0xff;
                  const L = (r * 76 + g * 150 + b * 29) >>> 8;
                  if (L < thr) break;
                  x++;
                }
                const len = x - start;
                if (len > 1) {
                  // Build (luma<<24 | localIndex) keys into a sub-view of
                  // the hoisted buffers, sort numerically, scatter pixels
                  // in luma order back into px32. Local index in the low
                  // 24 bits ensures unique keys (stable enough order).
                  const keys = keysAll.subarray(0, len);
                  for (let i = 0; i < len; i++) {
                    const p = px32[rowOff + start + i];
                    const r = p & 0xff, g = (p >>> 8) & 0xff, b = (p >>> 16) & 0xff;
                    const L = (r * 76 + g * 150 + b * 29) >>> 8;
                    keys[i] = (L << 24) | i;
                  }
                  keys.sort();
                  for (let i = 0; i < len; i++) scratch[i] = px32[rowOff + start + (keys[i] & 0xffffff)];
                  for (let i = 0; i < len; i++) px32[rowOff + start + i] = scratch[i];
                }
              }
            }
            octx.putImageData(img, 0, 0);
            gl.activeTexture(gl.TEXTURE5);
            gl.bindTexture(gl.TEXTURE_2D, cpuSortTexRef.current);
            // v1.2.61 — match the global UNPACK_FLIP_Y_WEBGL=false set at
            // GL init. Previously we forced flip=1 here which made the
            // sorted tex render upside-down relative to the camera tex,
            // so the REALSORT knob looked like it just inverted the frame.
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, oc);
          }
        } catch { /* CPU sort tick is best-effort; ignore failures */ }
      }
    }

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, prevTex);

    // v1.2.55 — UNIFORM SHADOW CACHE helpers. We close over `gl` and the
    // module-level cache map; the helpers diff the proposed value against
    // the last-uploaded value and skip the GL call when unchanged. Float
    // vectors get a packed string key (cheap to compare). Net: roughly
    // 30–40 of the ~60 per-frame uniform calls become no-ops on idle
    // frames, and even on busy frames the constant-valued ones
    // (uVideoSize, uMirror, uFaceFeather, texture-unit ints) skip
    // immediately. Cleared by resize() so a backing-store change forces
    // a re-upload.
    const _uc = uniCacheRef.current;
    const setF1 = (loc: WebGLUniformLocation | null, v: number) => {
      if (!loc) return;
      if (_uc.get(loc) === v) return;
      _uc.set(loc, v);
      gl.uniform1f(loc, v);
    };
    const setF2 = (loc: WebGLUniformLocation | null, a: number, b: number) => {
      if (!loc) return;
      const k = a + "," + b;
      if (_uc.get(loc) === k) return;
      _uc.set(loc, k);
      gl.uniform2f(loc, a, b);
    };
    const setI1 = (loc: WebGLUniformLocation | null, v: number) => {
      if (!loc) return;
      if (_uc.get(loc) === v) return;
      _uc.set(loc, v);
      gl.uniform1i(loc, v);
    };
    // Float arrays (uModeParams) change every frame in normal use — skip
    // the cache for these and just upload directly. Diffing 8 floats per
    // frame is more work than the upload itself.
    const setFv = (loc: WebGLUniformLocation | null, arr: Float32Array | number[]) => {
      if (!loc) return;
      gl.uniform1fv(loc, arr);
    };

    setF1(u.uTime, timeRef.current);
    setF2(u.uResolution, canvas.width, canvas.height);
    setF2(u.uVideoSize, hasVideo ? srcW : canvas.width, hasVideo ? srcH : canvas.height);
    setF1(u.uMirror, cameraActiveRef.current && cameraFacingRef.current === "user" ? 1.0 : 0.0);
    setF2(u.uTouch, touchRef.current.x, touchRef.current.y);
    setF1(u.uTouchActive, touchRef.current.active ? 1.0 : 0.0);
    setF1(u.uAudio, audioLevelRef.current || 0.0);
    // v1.2.74 — band-split audio uniforms so the shader can react to
    // BASS / TREB / BEAT independently (datamosh kicks on beat, sort
    // pulses on bass, chrash sparks on treble).
    setF1(u.uABass, audioBassRef.current || 0.0);
    setF1(u.uATreb, audioTrebleRef.current || 0.0);
    setF1(u.uABeat, audioBeatRef.current || 0.0);
    setF1(u.uBrightness, brightnessRef.current);
    setF1(u.uContrast, contrastRef.current);
    setF1(u.uSaturation, saturationRef.current);
    setF1(u.uHueShift, hueShiftRef.current);
    setF1(u.uScanlines, scanlinesRef.current);
    setF1(u.uZoom, zoomRef.current);
    // v1.2.53 — universal audio reactivity for the two camera-source FX
    // racks (PIXEL SORT + DATAMOSH). Generator already has a deep audio
    // routing built into its evolution loop above; this brings the FX
    // racks up to parity so the mic mod actually does something across
    // ALL three feature areas the user expects ("sort, mosh, generator").
    // We add a punch term so even a knob set to 0 produces a glimmer on
    // a loud beat (instant demo of audio-react), then a multiplicative
    // gain on top of the user's knob value so what they dialed in pulses.
    const _aBass  = audioBassRef.current;
    const _aBeat  = audioBeatRef.current;
    const _aLvl   = audioLevelRef.current;
    const _aGate  = Math.min(1.0, _aBass * 1.4 + _aBeat * 0.9 + _aLvl * 0.5);
    const _sortBase = sortAmtRef.current;
    const _sortAudio = Math.min(1.0, _sortBase * (1 + _aGate * 0.7) + _aGate * 0.18);
    // v1.2.68 — DECOUPLE the shader sort knobs from REALSORT. Previously
    // every shader knob (AMOUNT/LOW/HIGH/SEGMENT/NOISE/WOBBLE/TEAR/MODE/
    // INTERVAL/ANGLE) was multiplied by sortMix, so when REALSORT was at
    // 0 the sub-knobs felt completely dead — turning AMOUNT did literally
    // nothing. Now REALSORT only controls the CPU Asendorf cross-fade
    // (uSortMix); AMOUNT directly drives the shader sort uniform so each
    // sub-knob produces a visible, independent change.
    setF1(u.uSortAmt, _sortAudio);
    setF1(u.uScanTear, scanTearRef.current);
    setF1(u.uBlockGlitch, blockGlitchRef.current);
    // Datamosh INTENS slider is 0..2. Old mapping used a pow(0.72) curve
    // plus an aggressive HARD multiplier that clipped at 5.0 around the
    // slider midpoint — the top half of the knob did nothing visible.
    // Linear map keeps the full slider range live in both modes.
    const dmBase = Math.max(0, datamoshRef.current);
    let dmMapped = moshHardRef.current
      ? dmBase * 2.5 + 0.25  // HARD: 0.25 .. 5.25 across the full slider
      : dmBase * 1.6;        // SOFT: 0    .. 3.2  across the full slider
    // v1.2.53 — audio modulation of the datamosh rack. Pulses the
    // mapped intensity on bass/beat so the rack visibly reacts to a
    // mic stream even when the slider is partway down. Capped at the
    // HARD ceiling so we don't push past what the shader was tuned for.
    dmMapped = Math.min(5.5, dmMapped * (1 + _aGate * 0.55) + _aGate * 0.22);
    setF1(u.uDatamosh, dmMapped);
    setF1(u.uChrash, chrashRef.current);
    setF1(u.uLiquid, liquidRef.current);
    // v1.2.58 — Asendorf / Gysin homage rack uniform writes (v1.2.59: streak/hilbert removed)
    setF1(u.uGlyph, glyphRef.current);
    setF1(u.uSortMix, sortMixRef.current);
    setF1(u.uReact, reactDRef.current);
    setF1(u.uVoroSort, voroSortRef.current);
    setF1(u.uFeedback, feedbackRef.current);
    setF1(u.uContour, contourRef.current);
    setF1(u.uAscii, asciiRef.current);
    setF1(u.uVenetian, venetianRef.current);
    setF1(u.uKaleido, kaleidoRef.current);
    setF1(u.uTile, tileRef.current);
    setF1(u.uInvert, invertSymRef.current);
    setF1(u.uDroste, drosteRef.current);
    setF1(u.uSpiral, spiralRef.current);
    setF1(u.uYantra, yantraRef.current);
    setF1(u.uMandala, mandalaRef.current);
    setF1(u.uRosette, rosetteRef.current);
    setF1(u.uStarfold, starfoldRef.current);
    setF1(u.uHexfold, hexfoldRef.current);
    setF1(u.uDisrupt, disruptRef.current);
    setF1(u.uDisruptCount, disruptCountRef.current);
    setF1(u.uDisruptSize, disruptSizeRef.current);
    setF1(u.uDisruptContrary, disruptContraryRef.current);
    setF1(u.uDisruptShape, disruptShapeRef.current);
    setF1(u.uSortKey, sortKeyRef.current);
    setF1(u.uSortLow, sortLowRef.current);
    setF1(u.uSortHigh, sortHighRef.current);
    setF1(u.uSortMode, sortModeRef.current);
    setF1(u.uSortSegment, sortSegmentRef.current);
    setF1(u.uSortRandom, sortRandomRef.current);
    setF1(u.uSortWobble, sortWobbleRef.current);
    setF1(u.uSortInterval, sortIntervalRef.current);
    setF1(u.uSortAngle, sortAngleRef.current);
    setF1(u.uRgbR, rgbRRef.current);
    setF1(u.uRgbG, rgbGRef.current);
    setF1(u.uRgbB, rgbBRef.current);
    setF1(u.uRgbBars, rgbBarsRef.current);
    setF1(u.uRgbSwap, rgbSwapRef.current);
    setF1(u.uRupture, ruptureRef.current);
    setF1(u.uHSync, hsyncRef.current);
    setF1(u.uMoshIFrame, moshIFrameRef.current);
    setF1(u.uMoshMotion, moshMotionRef.current);
    setF1(u.uMoshBleed, moshBleedRef.current);
    setF1(u.uMoshMap, moshMapRef.current);
    setF1(u.uMoshDistort, moshDistortRef.current);
    // Face FX universal mask uniforms (driven by faceFxMode + segmentation loop).
    setF1(u.uFaceActive, faceFxRef.current.active ? 1.0 : 0.0);
    setF1(u.uFaceTexValid, faceFxRef.current.texValid ? 1.0 : 0.0);
    setF2(u.uFaceCenter, faceFxRef.current.cx, faceFxRef.current.cy);
    setF1(u.uFaceRadius, faceFxRef.current.r);
    setF1(u.uFaceInvert, faceFxRef.current.invert ? 1.0 : 0.0);
    setF1(u.uFaceFeather, 0.06);
    if (faceTextureRef.current) {
      gl.activeTexture(gl.TEXTURE4);
      gl.bindTexture(gl.TEXTURE_2D, faceTextureRef.current);
      setI1(u.uFaceTex, 4);
    }

    // Phase 2a: per-mode rack params (slot 0=AMOUNT, 1=MIX, 2..7 mode-specific)
    {
      const modeId = modeRef.current as ModeId;
      const packed = packParams(modeId, paramsByModeRef.current[modeId] ?? defaultsForMode(modeId));
      if (u.uModeParams) setFv(u.uModeParams, packed);
    }

    setI1(u.uCamera, 0);
    setI1(u.uPrevFrame, 1);
    setI1(u.uMask, 2);

    // Phase 2b: real multi-layer composite via ping-pong FBOs.
    // When combo mode is on with armed layers, render each layer's mode/params
    // in sequence: layer 0 reads camera, subsequent layers read the previous
    // layer's output. The last layer renders directly to the canvas.
    const layers = comboLayersRef.current;
    // Drive each layer's gain from its corresponding knob ref so the rack
    // is silent (no displacement, no recolor) until the user dials in a value.
    // Without this, defaults of gain=1 push MOSH to full intensity over the
    // camera and produce the unwanted rainbow / inverted ghost on boot.
    const liveLayers = layers.map((L) => {
      let g = L.gain;
      if (L.mode === 7)      g = sortAmtRef.current  ?? 0;
      else if (L.mode === 9) g = datamoshRef.current ?? 0;
      return { mode: L.mode, gain: g };
    });
    const anyArmed = liveLayers.some((L) => (L.gain ?? 0) > 0.02);
    // FX SETTINGS picker (modeRef) is the GLOBAL override. Whenever the user
    // selects a non-NORMAL visual mode (NIGHT/THERMAL/EDGE/CMYK/etc.) it must
    // win over the PXL+MOSH combo rack so the chosen look is what's on screen.
    const fxOverride = (modeRef.current ?? 0) !== 0;
    const useCombo = comboModeRef.current && liveLayers.length > 0 && anyArmed && !fxOverride
      && fboARef.current !== null && fboBRef.current !== null
      && fboTexARef.current !== null && fboTexBRef.current !== null;
    if (useCombo) {
      // UNIFIED SIGNAL PASS: instead of ping-ponging PXL → MOSH as two
      // discrete framebuffer hops (which made each FX look like a
      // separate translucent layer stacked on top of the previous one),
      // render a SINGLE shader invocation in mode 0 (NORMAL). The
      // pre-mode color stage of the shader already routes EVERY rack
      // uniform — uSortAmt (PIXEL SORT), uDatamosh (DATAMOSH), uRGBDrift,
      // uScanTear, uBlockGlitch, uLiquid, uKaleido, uDisrupt … — into
      // the same `color` value before the mode switch. Driving them all
      // at once in one pass means the pixel-sort streaks and datamosh
      // smear inform each other inside one signal instead of one being
      // baked into a texture that the next pass merely paints over.
      setI1(u.uMode, 0);
      setF1(u.uGain, gainRef.current);
      const packed0 = packParams(0 as ModeId, paramsByModeRef.current[0 as ModeId] ?? defaultsForMode(0 as ModeId));
      if (u.uModeParams) setFv(u.uModeParams, packed0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    } else {
      setI1(u.uMode, modeRef.current);
      setF1(u.uGain, gainRef.current);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    // Copy rendered framebuffer to previous frame texture for temporal feedback effects
    // v1.2.57 / v1.2.59 — Skip the full-canvas copy when no FX actually
    // samples uPrevFrame this frame. Only uDatamosh / uChrash now read
    // the previous-frame texture. When both are below their shader-side
    // thresholds the copy is wasted fillrate.
    const _needsPrevCopy =
      (datamoshRef.current > 0.02) ||
      (chrashRef.current > 0.001);
    if (_needsPrevCopy) {
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, prevTex);
      gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 0, 0, canvas.width, canvas.height);
    }

    frameIdxRef.current = 1 - frameIdxRef.current;

    // FPS
    fpsFrames.current++;
    const now = performance.now();
    // v1.2.55 — ADAPTIVE RESOLUTION. EWMA the inter-frame interval so
    // momentary jank doesn't trigger a downscale, and require a steady
    // two-second fast streak before restoring full res so we don't
    // ping-pong on the first frame after a downscale.
    if (lastFrameTsRef.current > 0) {
      const dt = now - lastFrameTsRef.current;
      // EWMA: 0.92 history weight → ~half-life of ~8 frames
      frametimeAvgRef.current = frametimeAvgRef.current * 0.92 + dt * 0.08;
      const avg = frametimeAvgRef.current;
      if (avg > 22 && renderScaleRef.current > 0.76) {
        // Sustained <45fps — shrink the GL canvas so the shader pushes
        // 0.75 × 0.75 = ~56% the pixels. Triggers a full FBO + texture
        // re-allocation via resize().
        renderScaleRef.current = 0.75;
        fastFrameStreakRef.current = 0;
        resize();
      } else if (avg < 14 && renderScaleRef.current < 1.0) {
        // Counting fast frames toward a recovery promotion. ~120 frames
        // at 60fps == 2s. Resets on every slow frame above.
        fastFrameStreakRef.current++;
        if (fastFrameStreakRef.current > 120) {
          renderScaleRef.current = 1.0;
          fastFrameStreakRef.current = 0;
          resize();
        }
      } else if (avg > 16) {
        // In the dead band but not great — keep streak from accumulating.
        fastFrameStreakRef.current = Math.max(0, fastFrameStreakRef.current - 1);
      }
    }
    lastFrameTsRef.current = now;
    if (now - fpsTime.current >= 1000) {
      setFps(fpsFrames.current);
      fpsFrames.current = 0;
      fpsTime.current = now;
    }
  }, []);
  // ── Audio input setup ──────────────────────────────────
  useEffect(() => {
    if (!audioActive) return;
    let audioCtx: AudioContext | null = null;
    let analyser: AnalyserNode | null = null;
    let dataArray: Uint8Array | null = null;
    let stream: MediaStream | null = null;
    let source: MediaStreamAudioSourceNode | null = null;

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
          video: false,
        });
        audioStreamRef.current = stream;
        audioCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
        // Android Chrome / Capacitor WebView starts contexts suspended until
        // an explicit user-gesture resume — without this the analyser reads
        // all-zeros and audio reactivity appears dead.
        if (audioCtx.state === "suspended") {
          try { await audioCtx.resume(); } catch { /* ignore */ }
        }
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = 1024;
        analyser.smoothingTimeConstant = 0.4;
        // Use correct Uint8Array type for Web Audio API
        dataArray = new Uint8Array(analyser.fftSize);
        source = audioCtx.createMediaStreamSource(stream);
        source.connect(analyser);
        audioAnalyserRef.current = analyser;
        audioDataArrayRef.current = dataArray;
        // Some devices flip the context back to suspended after the source
        // is connected. Poll once shortly after to nudge it back to running.
        setTimeout(() => {
          if (audioCtx && audioCtx.state === "suspended") {
            audioCtx.resume().catch(() => { /* ignore */ });
          }
        }, 250);
      } catch (err) {
        console.error("[audio] getUserMedia failed:", err);
        setAudioActive(false);
        audioAnalyserRef.current = null;
        audioDataArrayRef.current = null;
        audioStreamRef.current = null;
      }
    })();

    return () => {
      if (audioStreamRef.current) {
        audioStreamRef.current.getTracks().forEach(t => t.stop());
        audioStreamRef.current = null;
      }
      if (audioAnalyserRef.current) {
        audioAnalyserRef.current.disconnect();
        audioAnalyserRef.current = null;
      }
      if (audioCtx) {
        audioCtx.close();
      }
      audioDataArrayRef.current = null;
    };
  }, [audioActive]);

  // ── Draw overlay rendering ────────────────────────────────
  // The visible draw canvas is *not* a paint surface — it is a UI hint
  // showing where the FX mask is active. Painted regions appear as a soft
  // translucent white highlight with a subtle outline so the user can see
  // their selection without the canvas looking like a literal pen drawing.
  // The actual mask (full-opacity white into maskCanvas, used by the GLSL
  // sampler `uMask`) is built immediately below this block.
  const renderDrawOverlay = useCallback(() => {
    try {
    const dc = drawCanvasRef.current;
    if (!dc) return;
    if (dc.width === 0 || dc.height === 0) return;
    const ctx = dc.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, dc.width, dc.height);

    // Visible indicator: low-alpha white fill + thin outline. Width and
    // path geometry still come from the user's stroke, but colour/brush
    // styling is intentionally ignored — this is a region marker, not a
    // painted line. Keeps the UI from looking like a pen tool.
    const drawSingleStroke = (stroke: DrawStroke) => {
      if (stroke.points.length < 2) return;
      const w = stroke.width;
      ctx.save();
      ctx.lineCap = "round"; ctx.lineJoin = "round";

      // Soft translucent fill (the FX-active region).
      ctx.globalAlpha = 0.22 * (stroke.opacity ?? 1);
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.moveTo(stroke.points[0].x * dc.width, stroke.points[0].y * dc.height);
      for (let i = 1; i < stroke.points.length; i++) {
        const mx = (stroke.points[i-1].x + stroke.points[i].x) / 2 * dc.width;
        const my = (stroke.points[i-1].y + stroke.points[i].y) / 2 * dc.height;
        ctx.quadraticCurveTo(stroke.points[i-1].x*dc.width, stroke.points[i-1].y*dc.height, mx, my);
      }
      ctx.stroke();

      // Thin crisp outline so the boundary is readable on busy images.
      ctx.globalAlpha = 0.55 * (stroke.opacity ?? 1);
      ctx.strokeStyle = "rgba(231,174,255,0.9)";
      ctx.lineWidth = Math.max(1, w * 0.08);
      ctx.stroke();

      ctx.restore();
    };

    for (const stroke of strokes) { drawSingleStroke(stroke); }
    const cs = currentStrokeRef.current;
    if (cs && cs.points.length > 1) { drawSingleStroke(cs); }

    // --- Draw to mask canvas (grayscale, 0=off, 1=full FX) ---
    const maskCanvas = maskCanvasRef.current;
    if (!maskCanvas) return;
    const mctx = maskCanvas.getContext("2d");
    if (!mctx) return;
    mctx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
    mctx.save();
    mctx.lineCap = "round"; mctx.lineJoin = "round";
    // Draw all strokes as white, opacity = stroke.opacity
    const dcW = dc.width || 1;
    for (const stroke of strokes) {
      if (stroke.points.length < 2) continue;
      mctx.globalAlpha = stroke.opacity;
      mctx.strokeStyle = "#fff";
      mctx.lineWidth = Math.max(0.5, (stroke.width / dcW) * maskCanvas.width);
      mctx.beginPath();
      mctx.moveTo(stroke.points[0].x * maskCanvas.width, stroke.points[0].y * maskCanvas.height);
      for (let i = 1; i < stroke.points.length; i++) {
        const mx = (stroke.points[i-1].x + stroke.points[i].x) / 2 * maskCanvas.width;
        const my = (stroke.points[i-1].y + stroke.points[i].y) / 2 * maskCanvas.height;
        mctx.quadraticCurveTo(stroke.points[i-1].x*maskCanvas.width, stroke.points[i-1].y*maskCanvas.height, mx, my);
      }
      mctx.stroke();
    }
    if (cs && cs.points.length > 1) {
      mctx.globalAlpha = cs.opacity;
      mctx.strokeStyle = "#fff";
      mctx.lineWidth = Math.max(0.5, (cs.width / dcW) * maskCanvas.width);
      mctx.beginPath();
      mctx.moveTo(cs.points[0].x * maskCanvas.width, cs.points[0].y * maskCanvas.height);
      for (let i = 1; i < cs.points.length; i++) {
        const mx = (cs.points[i-1].x + cs.points[i].x) / 2 * maskCanvas.width;
        const my = (cs.points[i-1].y + cs.points[i].y) / 2 * maskCanvas.height;
        mctx.quadraticCurveTo(cs.points[i-1].x*maskCanvas.width, cs.points[i-1].y*maskCanvas.height, mx, my);
      }
      mctx.stroke();
    }
    mctx.restore();

    // While DRAW mode is on, the shader must always sample the mask — even
    // when it is empty — so masked FX (kaleido, mandala warps, etc.) only
    // appear inside painted regions. If we instead set this to false on an
    // empty mask, the shader falls back to mask=1.0 and every masked FX
    // floods the whole frame as a ghost background. Empty mask = no FX.
    touchRef.current.active = drawActive;
    } catch (err) {
      reportDrawCrash("renderDrawOverlay", err);
    }
  }, [drawActive, strokes, reportDrawCrash]);

  // Sync draw canvas size to the WebGL canvas size whenever DRAW turns on
  // (and on first activation after an image upload). The canvas had no width/
  // height attributes, so without this it stays at the 300x150 HTML default
  // until a window resize fires \u2014 and any lineWidth math like
  // (stroke.width / dc.width) becomes wildly off (or 0/Infinity), which can
  // throw inside Canvas2D on some Android WebView builds.
  useEffect(() => {
    if (!drawActive) return;
    const dc = drawCanvasRef.current;
    const c = canvasRef.current;
    if (!dc || !c) return;
    const w = c.width || dc.clientWidth || 720;
    const h = c.height || dc.clientHeight || 720;
    if (dc.width !== w) dc.width = w;
    if (dc.height !== h) dc.height = h;
    renderDrawOverlay();
  }, [drawActive, drawAvailable, renderDrawOverlay]);

  useEffect(() => {
    renderDrawOverlay();
  }, [strokes, renderDrawOverlay]);

  useEffect(() => {
    if (!drawActive) touchRef.current.active = false;
  }, [drawActive]);

  // ── Pointer handlers for draw overlay ────────────────────
  const getCanvasNorm = (e: React.PointerEvent, canvas: HTMLCanvasElement) => {
    const rect = canvas.getBoundingClientRect();
    return { x: (e.clientX - rect.left) / rect.width, y: (e.clientY - rect.top) / rect.height };
  };
  const onPointerDown = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawActive || !drawAvailable) {
      // Gesture only — do NOT touch touchRef so the shader FX flow is uninterrupted
      holdFiredRef.current = false;
      holdTimerRef.current = setTimeout(() => {
        holdFiredRef.current = true;
        startRecordingRef.current();
      }, 420);
      return;
    }
    try {
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* not supported on some Android WebViews */ }
      const pos = getCanvasNorm(e, e.currentTarget);
      currentStrokeRef.current = { points: [{ ...pos, pressure: 1 }], color: brushColorRef.current, width: brushSize, opacity: brushOpacity, brush: brushTypeRef.current };
      renderDrawOverlay();
    } catch (err) {
      reportDrawCrash("onPointerDown", err);
    }
  }, [drawActive, drawAvailable, brushSize, brushOpacity, renderDrawOverlay, reportDrawCrash]);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawActive || !drawAvailable) {
      return;
    }
    if (!currentStrokeRef.current) return;
    try {
      const pos = getCanvasNorm(e, e.currentTarget);
      const pts = currentStrokeRef.current.points;
      const last = pts.length > 0 ? pts[pts.length - 1] : null;
      if (!last) return;
      const speed = Math.hypot(pos.x - last.x, pos.y - last.y) * 500;
      const pressure = Math.max(0.25, Math.min(1.2, 1 - speed * 1.2));
      pts.push({ ...pos, pressure });
      currentStrokeRef.current.width = brushSize * pressure;
      if (colorCycleRef.current) currentStrokeRef.current.color = brushColorRef.current;
      renderDrawOverlay();
    } catch (err) {
      reportDrawCrash("onPointerMove", err);
    }
  }, [drawActive, drawAvailable, brushSize, renderDrawOverlay, reportDrawCrash]);

  const onPointerUp = useCallback(() => {
    if (!drawActive || !drawAvailable) {
      if (holdTimerRef.current) { clearTimeout(holdTimerRef.current); holdTimerRef.current = null; }
      if (holdFiredRef.current) {
        stopRecordingRef.current();
      }
      return;
    }
    try {
      const cs = currentStrokeRef.current;
      if (!cs) return;
      if (cs.points.length > 1) {
        setStrokes(prev => [...prev, cs]);
      }
      currentStrokeRef.current = null;
      renderDrawOverlay();
    } catch (err) {
      reportDrawCrash("onPointerUp", err);
    }
  }, [drawActive, drawAvailable, renderDrawOverlay, reportDrawCrash]);

  // ── Camera ────────────────────────────────────────────────
  // Request camera permissions on mobile (Capacitor)
  // v1.3.2 — STOPPED probing Capacitor.Plugins.Permissions before calling
  // getUserMedia. The probe was returning a stale "denied" state on some
  // devices (the Permissions plugin contract changed in Capacitor 7 and
  // the v1.2.98 "prompt → request" path could lock users out once they
  // tapped Deny on any prior build). Native WebView's getUserMedia
  // already raises its own runtime camera prompt, so just let it through
  // and surface real errors via the catch in startCamera.
  const requestCameraPermission = useCallback(async (): Promise<boolean> => {
    return true;
  }, []);

  const getCameraStream = useCallback(async (facing: "environment" | "user") => {
    const attempts: MediaStreamConstraints[] = [
      { video: { facingMode: { ideal: facing }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false },
      { video: { facingMode: facing }, audio: false },
      { video: true, audio: false },
    ];
    let lastErr: unknown = null;
    for (const constraints of attempts) {
      try {
        return await navigator.mediaDevices.getUserMedia(constraints);
      } catch (err) {
        lastErr = err;
        const name = (err as Error).name;
        if (name === "NotAllowedError" || name === "SecurityError" || name === "NotReadableError") {
          throw err;
        }
      }
    }
    throw lastErr ?? new Error("Unable to access camera stream.");
  }, []);

  const releaseCameraBinding = useCallback(async () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => {
        try { t.stop(); } catch {}
      });
      streamRef.current = null;
    }
    const video = videoRef.current;
    if (video) {
      try { video.pause(); } catch {}
      try { video.srcObject = null; } catch {}
      try { video.removeAttribute("src"); video.load(); } catch {}
    }
    await new Promise(resolve => setTimeout(resolve, 90));
  }, []);

  const startCamera = useCallback(async (forceRestart = false, facingOverride?: "environment" | "user") => {
    if (startCameraInFlightRef.current) return;
    startCameraInFlightRef.current = true;
    // v1.2.74 — explicit intent latch. The old intent re-check looked at
    // sourceMode === "camera", which BROKE GEN+CAM (which keeps sourceMode
    // = "generator" but turns the camera on) — startCamera bailed out
    // immediately and the camera never opened. We now set an intent flag
    // here and only honour cancellation if stopCamera() clears it.
    cameraIntentRef.current = true;
    setCameraRequesting(true);
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraActive(false);
        setSourceError("Camera API unavailable in this browser/context.");
        return;
      }
      const permGranted = await requestCameraPermission();
      if (!permGranted) {
        setCameraActive(false);
        setSourceError("Camera permission denied — allow in device settings.");
        return;
      }
      const facing = facingOverride ?? cameraFacing;
      if (!forceRestart && streamRef.current?.active && videoRef.current?.srcObject) {
        setCameraActive(true);
        setSourceError(null);
        return;
      }
      await releaseCameraBinding();
      // v1.2.53 \u2014 intent re-check. While we were awaiting permission /
      // releasing the previous binding, the user may have toggled OFF
      // both source=camera AND face FX. If so, bail out instead of
      // acquiring a stream nobody asked for (this was the source of the
      // \"camera won't come back\" stuck state when toggling fast \u2014 a
      // late-arriving stream would set cameraActive=true but no render
      // path was actually consuming it).
      if (!cameraIntentRef.current) {
        return;
      }
      const stream = await Promise.race([
        getCameraStream(facing),
        new Promise<never>((_, rej) =>
          setTimeout(() => rej(Object.assign(new Error("Camera start timed out — tap retry to try again."), { name: "TimeoutError" })), 12000)
        ),
      ]);
      // v1.2.53 \u2014 second intent check after stream resolves. If user
      // toggled away while getUserMedia was pending, stop the stream we
      // just got so we don't hold the device hostage.
      if (!cameraIntentRef.current) {
        try { stream.getTracks().forEach(t => t.stop()); } catch {}
        return;
      }
      streamRef.current = stream;
      const video = videoRef.current!;
      video.srcObject = stream;
      video.playsInline = true;
      video.muted = true;
      await video.play();
      firstFrameRef.current = true;
      setCameraActive(true);
      setSourceError(null);
    } catch (err) {
      const msg = (err as Error).name;
      if (msg === "NotReadableError") {
        try {
          await releaseCameraBinding();
          const retryFacing = facingOverride ?? cameraFacing;
          const retryStream = await getCameraStream(retryFacing);
          streamRef.current = retryStream;
          const video = videoRef.current!;
          video.srcObject = retryStream;
          video.playsInline = true;
          video.muted = true;
          await video.play();
          firstFrameRef.current = true;
          setCameraActive(true);
          setSourceError(null);
          return;
        } catch {}
      }
      setCameraActive(false);
      if (msg === "NotAllowedError" || msg === "SecurityError") setSourceError("Camera permission denied — allow in browser settings, then press retry.");
        else if (msg === "TimeoutError") setSourceError((err as Error).message);
      else if (msg === "NotReadableError") setSourceError("Camera is in use by another app/tab. Close it and press retry.");
      else if (msg === "NotFoundError") setSourceError("No camera found.");
      else setSourceError("Camera error — " + (err as Error).message);
    } finally {
      startCameraInFlightRef.current = false;
      setCameraRequesting(false);
    }
  }, [cameraFacing, getCameraStream, releaseCameraBinding, requestCameraPermission]);

  const stopCamera = useCallback(() => {
    cameraIntentRef.current = false;
    void releaseCameraBinding();
    setCameraActive(false);
  }, [releaseCameraBinding]);

  const flipCamera = useCallback(async () => {
    const next = cameraFacing === "environment" ? "user" : "environment";
    setCameraFacing(next);
    if (cameraActive) {
      await startCamera(true, next);
    }
  }, [cameraFacing, cameraActive, startCamera]);

  const hardResetCamera = useCallback(async () => {
    setSourceError(null);
    await releaseCameraBinding();
    const fallbackFacing = cameraFacing === "environment" ? "user" : "environment";
    await startCamera(true, fallbackFacing);
  }, [cameraFacing, releaseCameraBinding, startCamera]);

  // ── Upload source ─────────────────────────────────────────
  const clearUploadSource = useCallback(() => {
    if (uploadVideoRef.current) {
      try { uploadVideoRef.current.pause(); } catch {}
      uploadVideoRef.current.removeAttribute("src");
      try { uploadVideoRef.current.load(); } catch {}
      uploadVideoRef.current = null;
    }
    if (uploadImgRef.current) {
      uploadImgRef.current.src = "";
      uploadImgRef.current = null;
    }
    if (uploadObjectUrlRef.current) {
      try { URL.revokeObjectURL(uploadObjectUrlRef.current); } catch {}
      uploadObjectUrlRef.current = null;
    }
    setUploadName(null);
    setUploadKind(null);
  }, []);

  const handleUploadFile = useCallback((file: File) => {
    if (!file) return;
    setSourceError(null);
    clearUploadSource();
    const url = URL.createObjectURL(file);
    uploadObjectUrlRef.current = url;
    const isVideo = file.type.startsWith("video/");
    if (isVideo) {
      const v = document.createElement("video");
      v.src = url;
      v.loop = true;
      v.muted = true;
      v.playsInline = true;
      v.crossOrigin = "anonymous";
      v.addEventListener("loadeddata", () => { firstFrameRef.current = true; });
      v.play().catch(() => { /* user gesture not required since muted */ });
      uploadVideoRef.current = v;
      setUploadKind("video");
    } else {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.src = url;
      img.addEventListener("load", () => { firstFrameRef.current = true; });
      uploadImgRef.current = img;
      setUploadKind("image");
    }
    setUploadName(file.name);
    setSourceMode("upload");
    // Free the camera while we render an upload (prevents permission churn).
    if (cameraActiveRef.current) {
      void releaseCameraBinding();
      setCameraActive(false);
    }
  }, [clearUploadSource, releaseCameraBinding]);

  useEffect(() => {
    return () => { clearUploadSource(); };
  }, [clearUploadSource]);

  const resetSettings = useCallback(async () => {
    // Return to default single-pass "normal view" and clear FX triggers.
    setComboMode(true);
    setComboLayers([{mode:7,gain:1},{mode:9,gain:1}]);
    setMode(0);
    setGain(0.5);

    // ── Post-process knobs back to identity
    setBrightness(1.0);
    setContrast(1.0);
    setSaturation(1.0);
    setHueShift(0.0);
    setScanlines(0.0);
    setZoom(0.0);
    setSpeed(1.0);

    setSortAmt(0.0);
    setScanTear(0.0);
    setBlockGlitch(0.0);
    setDatamosh(0.0);
    setMoshHard(false);
    setChrash(0.0);
    setLiquid(0.0);
    setFeedback(0.0);
    setContour(0.0);
    setAscii(0.0);
    setVenetian(0.0);
    setKaleido(0.0);
    setDisrupt(0.0);
    setDisruptCount(0.4);
    setDisruptSize(0.4);
    setDisruptContrary(1.0);
    setTile(0.0);
    setInvertSym(0.0);
    setDroste(0.0);
    setSpiral(0.0);
    setYantra(0.0);
    setMandala(0.0);
    setRosette(0.0);
    setStarfold(0.0);
    setHexfold(0.0);
    setSortKey(0);
    setSortLow(0.35);
    setSortHigh(0.92);
    setSortMode(0);
    setSortSegment(0.35);
    setSortRandom(0.18);
    setSortWobble(0.12);
    setMoshIFrame(0.7);
    setMoshMotion(0.55);
    setMoshBleed(0.45);
    setMoshMap(0.0);
    setMoshDistort(0.5);

    // ── AUTOMATE off; rate to default
    setAutomateOn(false);
    setAutomateRate(0.45);
    setAutomateStyles(false);
    setAutomateBlend(false);

    // ── Generator knobs back to defaults
    setGenStyle("BAYER");
    setGenResolution(48);
    setGenDensity(0.55);
    setGenScale(1.0);
    setGenSpeed(0.6);
    setGenHue(0.78);
    setGenHueSpread(0.35);
    setGenSat(0.85);
    setGenContrastG(0.7);
    setGenWarp(0.25);
    setGenJitter(0.15);
    setGenSeed(7);
    setGenInvert(false);
    setGenMoshX(0);
    setGenMoshY(0);
    setGenScatter(0);
    setGenScatterMode(0);
    setGenBlend("AVG");
    setGenPalette("MONO");
    setGenAutoCycle(false);

    // ── Audio off (mic) so the camera goes back to fully passive
    setAudioActive(false);
    // ── Low-power off so reset = vanilla performance baseline
    setLowPowerOn(false);

    setParamsByMode(defaultsForAllModes());
    setSourceMode("camera");
    // v1.2.46: reset matches the new boot state — user-facing.
    setCameraFacing("user");
    setSourceError(null);
    clearUploadSource();
    touchRef.current.active = false;
    currentStrokeRef.current = null;
    setStrokes([]);
    setDrawActive(false);
    await startCamera(true, "user");
  }, [clearUploadSource, startCamera]);

  // ── GIF export ────────────────────────────────────────────
  // Find the back-half frame whose downsampled luma is closest to the
  // first frame, and return frames[0..bestIdx]. We compare on a fixed
  // 32×32 luma grid sampled by stride, so cost is O(N · 1024) — trivial
  // even for 200+ frames. Using SAD (sum of absolute differences) on luma
  // is robust against minor color drift and far cheaper than full-RGB
  // comparison. The first 50% of the recording is excluded from the
  // search so we never trim too aggressively (loops shorter than half
  // the recording usually look samey).
  function trimToLoopPoint(frames: Uint8ClampedArray[], gw: number, gh: number): Uint8ClampedArray[] {
    if (frames.length < 12) return frames;
    // Honour the EXPORT panel's PERFECT LOOP toggle. When off, the user
    // gets the entire recording at the requested duration with no trim.
    if (!perfectLoopRef.current) return frames;
    const G = 32;
    const sx = Math.max(1, Math.floor(gw / G));
    const sy = Math.max(1, Math.floor(gh / G));
    const luma = (f: Uint8ClampedArray): Uint8Array => {
      const out = new Uint8Array(G * G);
      let p = 0;
      for (let y = 0; y < G; y++) {
        const yy = Math.min(gh - 1, y * sy);
        for (let x = 0; x < G; x++) {
          const xx = Math.min(gw - 1, x * sx);
          const i = (yy * gw + xx) << 2;
          // Rec.601 luma, fast int (>>8 ≈ /256).
          out[p++] = (f[i] * 77 + f[i+1] * 150 + f[i+2] * 29) >> 8;
        }
      }
      return out;
    };
    const first = luma(frames[0]);
    // Restrict the search to the LAST ~22% of the recording so we trim
    // only a small near-loop tail, preserving the user's chosen length.
    const startSearch = Math.floor(frames.length * 0.78);
    let bestIdx = frames.length - 1;
    let bestSad = Infinity;
    for (let k = startSearch; k < frames.length; k++) {
      const cur = luma(frames[k]);
      let sad = 0;
      for (let q = 0; q < first.length; q++) {
        sad += Math.abs(first[q] - cur[q]);
      }
      if (sad < bestSad) { bestSad = sad; bestIdx = k; }
    }
    // bestIdx is the new last frame; drop everything after it. We keep
    // frame[bestIdx] (rather than dropping it too) because in GIF the
    // last frame's delay still elapses before the loop restarts, so the
    // output reads as: ... near-match → frame[0] → ... = perfect loop.
    return frames.slice(0, bestIdx + 1);
  }

  function encodeGIF(gw: number, gh: number, frames: Uint8ClampedArray[], delay: number, ditherStrength = 2.0): Uint8Array {
    const buf: number[] = [];
    const wb = (b:number) => buf.push(b & 0xFF);
    const w16 = (v:number) => { wb(v); wb(v>>8); };
    const ws = (s:string) => { for(let i=0;i<s.length;i++) wb(s.charCodeAt(i)); };
    const palette: number[] = [];
    // Higher-fidelity fixed palette: 8x8x4 RGB cube (256 colors)
    for (let ri = 0; ri < 8; ri++) {
      for (let gi = 0; gi < 8; gi++) {
        for (let bi = 0; bi < 4; bi++) {
          palette.push(
            Math.round((ri * 255) / 7),
            Math.round((gi * 255) / 7),
            Math.round((bi * 255) / 3),
          );
        }
      }
    }
    const bayer4 = [
      [0, 8, 2, 10],
      [12, 4, 14, 6],
      [3, 11, 1, 9],
      [15, 7, 13, 5],
    ];
    const quant = (r:number, g:number, b:number) => {
      const qr = Math.max(0, Math.min(7, Math.round((r * 7) / 255)));
      const qg = Math.max(0, Math.min(7, Math.round((g * 7) / 255)));
      const qb = Math.max(0, Math.min(3, Math.round((b * 3) / 255)));
      return qr * 32 + qg * 4 + qb;
    };
    function lzwEnc(px:Uint8Array){
      let cs=9,next=258,mx=512,bits=0,bc=0;
      const dict:Record<string,number>={},out:number[]=[];
      const emit=(code:number)=>{bits|=code<<bc;bc+=cs;while(bc>=8){out.push(bits&0xFF);bits>>=8;bc-=8;}};
      const reset=()=>{Object.keys(dict).forEach(k=>delete dict[k]);cs=9;next=258;mx=512;};
      emit(256); let pre=px[0];
      for(let i=1;i<px.length;i++){
        const suf=px[i],key=pre+","+suf;
        if(dict[key]!==undefined){pre=dict[key];}
        else{emit(pre);if(next<4096){dict[key]=next++;if(next>mx&&cs<12){cs++;mx<<=1;}}else{emit(256);reset();}pre=suf;}
      }
      emit(pre);emit(257);if(bc>0)out.push(bits&0xFF);return out;
    }
    ws("GIF89a");w16(gw);w16(gh);wb(0xF7);wb(0);wb(0);
    for(let p=0;p<palette.length;p++)wb(palette[p]);
    wb(0x21);wb(0xFF);wb(11);ws("NETSCAPE2.0");wb(3);wb(1);w16(0);wb(0);
    for(let f=0;f<frames.length;f++){
      const px=frames[f];
      wb(0x21);wb(0xF9);wb(4);wb(0);w16(delay);wb(0);wb(0);
      wb(0x2C);w16(0);w16(0);w16(gw);w16(gh);wb(0);
      const idx=new Uint8Array(gw*gh);
      for (let y = 0; y < gh; y++) {
        for (let x = 0; x < gw; x++) {
          const p = y * gw + x;
          const d = (bayer4[y & 3][x & 3] - 7.5) * ditherStrength;
          const r = Math.max(0, Math.min(255, px[p * 4] + d));
          const g = Math.max(0, Math.min(255, px[p * 4 + 1] + d));
          const b = Math.max(0, Math.min(255, px[p * 4 + 2] + d));
          idx[p] = quant(r, g, b);
        }
      }
      wb(8);
      const enc=lzwEnc(idx);let off=0;
      while(off<enc.length){const sz=Math.min(255,enc.length-off);wb(sz);for(let j=0;j<sz;j++)buf.push(enc[off+j]);off+=sz;}
      wb(0);
    }
    wb(0x3B);
    return new Uint8Array(buf);
  }

  // Snap a requested fps to the closest cadence GIF can actually play
  // back. GIF frame delays are stored in centiseconds (1cs = 10ms), so
  // valid playback rates are 100/Nfor integer N>=2 (i.e. 50, 33.3, 25,
  // 20, ...). If the encoded delay does not match the capture cadence,
  // the GIF visibly speeds up or slows down vs the live preview.
  const snapGifFps = (requested: number): { fps: number; delayCs: number } => {
    const delayCs = Math.max(2, Math.round(100 / requested));
    return { fps: 100 / delayCs, delayCs };
  };

  const captureFrame = useCallback(() => {
    const canvas = canvasRef.current;
    const gl = glRef.current;
    if (!canvas || !gl) return;
    const w = canvas.width, h = canvas.height;
    const maxDim = getGifProfile(exportQuality).maxDim;
    const { w: gw, h: gh } = getExportDimensions(w, h, exportProfile, maxDim);
    gifSizeRef.current = { w: gw, h: gh };
    const tmp = document.createElement("canvas");
    tmp.width = gw; tmp.height = gh;
    const ctx = tmp.getContext("2d")!;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    composeFrame(ctx, gw, gh);
    const elapsed = performance.now() - gifStartTime.current;
    gifFrames.current.push(ctx.getImageData(0, 0, gw, gh).data.slice() as unknown as Uint8ClampedArray);
    const recordCapMs = Math.min(MAX_RECORD_MS, recordMaxSecRef.current * 1000);
    if (elapsed >= recordCapMs && gifInterval.current) stopRecordingRef.current();
  }, [composeFrame, exportProfile, exportQuality, getExportDimensions, getGifProfile]);

  const startVideoRecording = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const w = canvas.width;
    const h = canvas.height;
    const maxDim = getExportMaxDim(exportQuality);
    const { w: vw, h: vh } = getExportDimensions(w, h, exportProfile, maxDim);

    const out = document.createElement("canvas");
    out.width = vw;
    out.height = vh;
    videoComposeCanvasRef.current = out;
    const ctx = out.getContext("2d");
    if (!ctx) return;

    // Throttle the compose draw to the requested record FPS instead of
    // running every rAF. The previous code did a `imageSmoothingQuality:
    // "high"` upscale + WebGL→CPU readback on every browser frame, which
    // tanked the live preview to ~4fps on integrated GPUs.
    const fpsAtStart = recordFpsRef.current;
    const targetMs = 1000 / fpsAtStart;
    // Manual-mode capture stream: passing 0 disables the browser's own
    // periodic sampling. We then call `videoTrack.requestFrame()` exactly
    // once after each composeFrame() draw, guaranteeing 1:1 correspondence
    // between rendered frames and recorded frames — no doubling, no drops.
    const stream = out.captureStream(0);
    const videoTrack = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack | undefined;
    let frameIndex = 0;
    const startTs = performance.now();
    const drawLoop = () => {
      const src = canvasRef.current;
      if (!src) return;
      const now = performance.now();
      const elapsed = now - gifStartTime.current;
      const recordCapMs = Math.min(MAX_RECORD_MS, recordMaxSecRef.current * 1000);
      if (elapsed >= recordCapMs) {
        stopRecordingRef.current();
        return;
      }
      // Self-correcting scheduler: emit frame N when its scheduled time
      // (startTs + N*targetMs) has arrived. Catches up if the page was
      // briefly throttled (background tab, GC pause) without drifting.
      const sinceStart = now - startTs;
      const wantFrame = Math.floor(sinceStart / targetMs);
      if (wantFrame >= frameIndex) {
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "medium";
        composeFrame(ctx, vw, vh);
        try { videoTrack?.requestFrame?.(); } catch { /* not all browsers */ }
        frameIndex = wantFrame + 1;
      }
      videoComposeRafRef.current = requestAnimationFrame(drawLoop);
    };
    // Mix in microphone audio if the user has it active. Without this the
    // exported video was always silent even when the live preview was
    // reacting to sound — making music videos impossible to render.
    const aStream = audioStreamRef.current;
    if (aStream) {
      try {
        for (const t of aStream.getAudioTracks()) stream.addTrack(t);
      } catch { /* ignore — stream still records video */ }
    }
    // Prefer MP4/H.264 when the WebView supports it (Android 13+ and
    // most modern Chromium builds do). Falls back to WebM/VP9/VP8 for
    // older devices. Saving as `.mp4` makes the file directly usable in
    // iOS Photos, social-media uploads, and most editors — .webm is
    // rejected by a lot of consumer pipelines.
    const mime = MediaRecorder.isTypeSupported("video/mp4;codecs=h264,aac")
      ? "video/mp4;codecs=h264,aac"
      : MediaRecorder.isTypeSupported("video/mp4;codecs=avc1,mp4a.40.2")
        ? "video/mp4;codecs=avc1,mp4a.40.2"
        : MediaRecorder.isTypeSupported("video/mp4")
          ? "video/mp4"
          : MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus")
            ? "video/webm;codecs=vp9,opus"
            : MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
              ? "video/webm;codecs=vp9"
              : MediaRecorder.isTypeSupported("video/webm;codecs=vp8,opus")
                ? "video/webm;codecs=vp8,opus"
                : MediaRecorder.isTypeSupported("video/webm;codecs=vp8")
                  ? "video/webm;codecs=vp8"
                  : "video/webm";

    const rec = new MediaRecorder(stream, { mimeType: mime });
    videoChunksRef.current = [];
    rec.ondataavailable = (ev) => {
      if (ev.data && ev.data.size > 0) videoChunksRef.current.push(ev.data);
    };
    rec.onstop = () => {
      cancelAnimationFrame(videoComposeRafRef.current);
      stream.getTracks().forEach(t => t.stop());
      videoComposeCanvasRef.current = null;
      const blob = new Blob(videoChunksRef.current, { type: rec.mimeType || "video/webm" });
      if (blob.size === 0) { setProcessingStatus(null); return; }
      // Derive extension from the actual mime so MP4 files end in .mp4
      // and WebM fallbacks end in .webm — keeps the system file picker /
      // gallery happy.
      const isMp4 = (rec.mimeType || "").toLowerCase().includes("mp4");
      const ext = isMp4 ? "mp4" : "webm";
      const filename = `gps-${(MODES.find(m => m.id === mode)?.short ?? "PXL").toLowerCase()}-${Date.now()}.${ext}`;
      setProcessingStatus({ label: "Saving video…" });
      saveBlobToDevice(blob, filename).finally(() => setProcessingStatus(null));
    };

    videoComposeRafRef.current = requestAnimationFrame(drawLoop);
    rec.start(200);
    videoRecorderRef.current = rec;
  }, [composeFrame, exportProfile, exportQuality, getExportDimensions, getExportMaxDim, mode]);

  const startRecording = useCallback(() => {
    if (recordingRef.current) return;
    gifFrames.current = [];
    gifSizeRef.current = null;
    gifStartTime.current = performance.now();
    recordingRef.current = true;
    setRecording(true);
    setRecordingHint(getRecordingHintText(exportFormat, exportQuality, exportProfile));
    if (recordingHintTimerRef.current) clearTimeout(recordingHintTimerRef.current);
    recordingHintTimerRef.current = setTimeout(() => setRecordingHint(null), 2000);
    if (exportFormat === "video") {
      startVideoRecording();
      return;
    }
    const gifProfile = getGifProfile(exportQuality);
    // Snap to a GIF-representable cadence so encoded delay == capture
    // delay (otherwise the export plays at a slightly different speed
    // than what was recorded — the classic "GIF feels off" bug).
    const { fps: snappedFps, delayCs } = snapGifFps(recordFpsRef.current);
    gifFpsRef.current = snappedFps;
    gifDelayCsRef.current = delayCs;
    gifDitherRef.current = gifProfile.dither;
    // Self-correcting setTimeout chain (instead of setInterval, which
    // clusters callbacks under load and drifts ±tens of ms per minute).
    const startTs = performance.now();
    const periodMs = delayCs * 10; // GIF’s own playback period in ms
    let n = 0;
    const tick = () => {
      if (!recordingRef.current) return;
      captureFrame();
      n++;
      const target = startTs + n * periodMs;
      const wait = Math.max(0, target - performance.now());
      gifTimeoutRef.current = window.setTimeout(tick, wait);
    };
    gifTimeoutRef.current = window.setTimeout(tick, 0);
  }, [captureFrame, exportFormat, exportProfile, exportQuality, getGifProfile, getRecordingHintText, startVideoRecording]);

  const stopRecording = useCallback(() => {
    if (!recordingRef.current) return;
    recordingRef.current = false;
    if (gifInterval.current) {
      clearInterval(gifInterval.current);
      gifInterval.current = null;
    }
    if (gifTimeoutRef.current) {
      clearTimeout(gifTimeoutRef.current);
      gifTimeoutRef.current = null;
    }
    setRecording(false);
    setRecordingHint(null);
    if (recordingHintTimerRef.current) {
      clearTimeout(recordingHintTimerRef.current);
      recordingHintTimerRef.current = null;
    }
    if (exportFormat === "video") {
      const rec = videoRecorderRef.current;
      videoRecorderRef.current = null;
      if (rec && rec.state !== "inactive") rec.stop();
      return;
    }
    const frames = gifFrames.current.slice();
    gifFrames.current = [];
    if (frames.length < 2) return;
    setProcessingStatus({ label: `Encoding GIF (${frames.length} frames)…` });
    setTimeout(() => {
      const size = gifSizeRef.current;
      if (!size) { setProcessingStatus(null); return; }
      const { w: gw, h: gh } = size;
      // ── Perfect-loop trim ──────────────────────────────────
      // Walk the back half of the recording, comparing each candidate
      // "end" frame against the FIRST frame using a downsampled luma SAD
      // (sum of absolute differences). The candidate with the lowest
      // delta becomes the new last frame, so frame[N-1] visually matches
      // frame[0]. For generative content this finds a near-perfect loop
      // point in almost every recording over ~2 seconds.
      const looped = trimToLoopPoint(frames, gw, gh);
      // GIF delay in centiseconds was already snapped at capture time so
      // encoded playback rate exactly matches recorded cadence (no more
      // "plays slightly faster than the live preview" bug).
      const delayCs = gifDelayCsRef.current;
      const data = encodeGIF(gw, gh, looped, delayCs, gifDitherRef.current);
      const blob = new Blob([data as unknown as BlobPart], { type: "image/gif" });
      const filename = `gps-${(MODES.find(m => m.id === mode)?.short ?? "PXL").toLowerCase()}-${Date.now()}.gif`;
      setProcessingStatus({ label: "Saving GIF…" });
      saveBlobToDevice(blob, filename).finally(() => setProcessingStatus(null));
    }, 50);
  }, [exportFormat, mode]);

  useEffect(() => {
    return () => {
      if (recordingHintTimerRef.current) clearTimeout(recordingHintTimerRef.current);
    };
  }, []);

  // v1.2.71 — hands-free record: 3-2-1 count-IN, auto-record for a fixed
  // 60 s with a per-second mid-shoot timer, last 3 s shown as a 3-2-1
  // count-OUT, then auto-stop. Tap again at any phase to cancel/stop.
  const startHandsFree = useCallback(() => {
    if (handsFreeTimerRef.current != null) {
      window.clearTimeout(handsFreeTimerRef.current);
      handsFreeTimerRef.current = null;
    }
    if (recordingRef.current) {
      stopRecordingRef.current();
      setHandsFreeCountdown(null);
      return;
    }
    if (handsFreeCountdown != null) {
      setHandsFreeCountdown(null);
      return;
    }
    // Force a 60 s take regardless of the EXPORT panel selection — dancers
    // need the runway and 60 s is the studio-tier ceiling already.
    setRecordMaxSec(60);
    recordMaxSecRef.current = 60;
    let n = 3;
    setHandsFreeCountdown({ phase: "in", n });
    const tickIn = () => {
      n -= 1;
      if (n <= 0) {
        startRecordingRef.current();
        let remaining = HANDS_FREE_SEC;
        setHandsFreeCountdown({ phase: "rec", n: remaining });
        const tickRec = () => {
          remaining -= 1;
          if (remaining <= 0) {
            stopRecordingRef.current();
            setHandsFreeCountdown(null);
            handsFreeTimerRef.current = null;
            return;
          }
          const phase: "rec" | "out" = remaining <= 3 ? "out" : "rec";
          setHandsFreeCountdown({ phase, n: remaining });
          handsFreeTimerRef.current = window.setTimeout(tickRec, 1000);
        };
        handsFreeTimerRef.current = window.setTimeout(tickRec, 1000);
      } else {
        setHandsFreeCountdown({ phase: "in", n });
        handsFreeTimerRef.current = window.setTimeout(tickIn, 1000);
      }
    };
    handsFreeTimerRef.current = window.setTimeout(tickIn, 1000);
  }, [handsFreeCountdown]);

  const captureStill = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // Source resolution: prefer the highest available true source.
    // - video: native videoWidth/videoHeight
    // - upload (video / image): natural dimensions
    // - generator: the generator canvas (rendered at output resolution)
    // Fall back to the live WebGL canvas backing store.
    const vid = videoRef.current;
    const upV = uploadVideoRef.current;
    const upI = uploadImgRef.current;
    const gen = genCanvasRef.current;
    const mode = sourceModeRef.current;
    let nativeW = canvas.width;
    let nativeH = canvas.height;
    if (mode === "camera" && vid && vid.videoWidth > 0) {
      nativeW = vid.videoWidth; nativeH = vid.videoHeight;
    } else if (mode === "upload" && upV && upV.videoWidth > 0) {
      nativeW = upV.videoWidth; nativeH = upV.videoHeight;
    } else if (mode === "upload" && upI && upI.naturalWidth > 0) {
      nativeW = upI.naturalWidth; nativeH = upI.naturalHeight;
    } else if (mode === "generator" && gen) {
      nativeW = gen.width; nativeH = gen.height;
    }

    // Apply EXPORT settings: quality (max dim) + profile (aspect).
    const maxDim = getExportMaxDim(exportQuality);
    const { w: outW, h: outH } = getExportDimensions(nativeW, nativeH, exportProfile, maxDim);

    const tmp = document.createElement("canvas");
    tmp.width = outW; tmp.height = outH;
    const ctx = tmp.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";

    // Composite the live shader output + overlays + draw layer (with the
    // same hard-light blend as the on-screen <canvas>) so the captured
    // still matches the preview pixel-for-pixel.
    composeFrame(ctx, outW, outH);

    // Flash feedback
    setFlashVisible(true);
    setTimeout(() => setFlashVisible(false), 150);

    const useJpeg = exportQuality === "standard";
    tmp.toBlob(blob => {
      if (!blob) return;
      const ext = useJpeg ? "jpg" : "png";
      const filename = `gps-${outW}x${outH}-${Date.now()}.${ext}`;
      setProcessingStatus({ label: "Saving photo…" });
      saveBlobToDevice(blob, filename).finally(() => setProcessingStatus(null));
    }, useJpeg ? "image/jpeg" : "image/png", useJpeg ? 0.92 : undefined);
  }, [composeFrame, exportProfile, exportQuality, getExportDimensions, getExportMaxDim]);

  // Assign gesture callback refs after functions are declared
  startRecordingRef.current = startRecording;
  stopRecordingRef.current = stopRecording;
  captureStillRef.current = captureStill;

  const buildPreset = useCallback((name: string): SpectraPreset => ({
    name,
    mode,
    gain,
    brightness,
    contrast,
    saturation,
    hueShift,
    scanlines,
    zoom,
    speed,
    sortAmt,
    scanTear,
    blockGlitch,
    datamosh,
    moshHard,
    chrash,
    liquid,
    feedback,
    contour,
    ascii,
    venetian,
    kaleido,
    disrupt,
    disruptCount,
    disruptSize,
    disruptContrary,
    tile,
    invertSym,
    droste,
    spiral,
    yantra,
    mandala,
    rosette,
    starfold,
    hexfold,
    sortKey,
    sortLow,
    sortHigh,
    sortMode,
    sortSegment,
    sortRandom,
    sortWobble,
    moshIFrame,
    moshMotion,
    moshBleed,
    moshMap,
    moshDistort,
    paramsByMode,
  }), [mode, gain, brightness, contrast, saturation, hueShift, scanlines, zoom, speed, sortAmt, scanTear, blockGlitch, datamosh, moshHard, chrash, liquid, feedback, contour, ascii, venetian, sortKey, sortLow, sortHigh, sortMode, sortSegment, sortRandom, sortWobble, moshIFrame, moshMotion, moshBleed, moshMap, moshDistort, paramsByMode, kaleido, disrupt, disruptCount, disruptSize, disruptContrary, tile, invertSym, droste, spiral, yantra, mandala, rosette, starfold, hexfold]);

  const applyPreset = useCallback((p: SpectraPreset) => {
    setMode(p.mode);
    setGain(p.gain);
    setBrightness(p.brightness);
    setContrast(p.contrast);
    setSaturation(p.saturation);
    setHueShift(p.hueShift);
    setScanlines(p.scanlines);
    setZoom(p.zoom);
    setSpeed(p.speed);
    setSortAmt(p.sortAmt);
    setScanTear(p.scanTear);
    setBlockGlitch(p.blockGlitch);
    setDatamosh(p.datamosh);
    setMoshHard(!!p.moshHard);
    setChrash(p.chrash);
    setLiquid(p.liquid);
    setFeedback(p.feedback);
    setContour(p.contour);
    setAscii(p.ascii);
    setVenetian(p.venetian);
    setKaleido(p.kaleido ?? 0.0);
    setDisrupt(p.disrupt ?? 0.0);
    setDisruptCount(p.disruptCount ?? 0.4);
    setDisruptSize(p.disruptSize ?? 0.4);
    setDisruptContrary(p.disruptContrary ?? 1.0);
    setTile(p.tile ?? 0.0);
    setInvertSym(p.invertSym ?? 0.0);
    setDroste(p.droste ?? 0.0);
    setSpiral(p.spiral ?? 0.0);
    setYantra(p.yantra ?? 0.0);
    setMandala(p.mandala ?? 0.0);
    setRosette(p.rosette ?? 0.0);
    setStarfold(p.starfold ?? 0.0);
    setHexfold(p.hexfold ?? 0.0);
    setSortKey(p.sortKey ?? 0);
    setSortLow(p.sortLow ?? 0.35);
    setSortHigh(p.sortHigh ?? 0.92);
    setSortMode(p.sortMode ?? 0);
    setSortSegment(p.sortSegment ?? 0.35);
    setSortRandom(p.sortRandom ?? 0.18);
    setSortWobble(p.sortWobble ?? 0.12);
    setMoshIFrame(p.moshIFrame ?? 0.7);
    setMoshMotion(p.moshMotion ?? 0.55);
    setMoshBleed(p.moshBleed ?? 0.45);
    setMoshMap(p.moshMap ?? 0.0);
    setMoshDistort(p.moshDistort ?? 0.5);
    if (p.paramsByMode && typeof p.paramsByMode === "object") {
      const merged = defaultsForAllModes();
      for (const m of MODES) {
        const stored = p.paramsByMode[m.id];
        if (stored && typeof stored === "object") {
          merged[m.id] = { ...merged[m.id], ...stored };
        }
      }
      setParamsByMode(merged);
    }
    setComboMode(true);
    setComboLayers([{mode:7,gain:1},{mode:9,gain:1}]);
  }, []);

  const savePreset = useCallback(() => {
    const name = presetName.trim();
    if (!name) return;
    setPresets(prev => {
      const next = [...prev.filter(p => p.name.toLowerCase() !== name.toLowerCase()), buildPreset(name)];
      localStorage.setItem(PRESETS_KEY, JSON.stringify(next));
      return next;
    });
    setPresetName("");
  }, [presetName, buildPreset]);

  const deletePreset = useCallback((name: string) => {
    setPresets(prev => {
      const next = prev.filter(p => p.name !== name);
      localStorage.setItem(PRESETS_KEY, JSON.stringify(next));
      return next;
    });
    setQuickSlots(prev => {
      const next = prev.map(v => v === name ? null : v);
      localStorage.setItem(QUICK_SLOTS_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const assignQuickSlot = useCallback((slotIndex: number, name: string) => {
    setQuickSlots(prev => {
      const next = [...prev];
      next[slotIndex] = name;
      localStorage.setItem(QUICK_SLOTS_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const autoAssignQuickSlot = useCallback((name: string) => {
    setQuickSlots(prev => {
      const next = [...prev];
      const existing = next.findIndex(v => v === name);
      if (existing >= 0) {
        localStorage.setItem(QUICK_SLOTS_KEY, JSON.stringify(next));
        return next;
      }
      const empty = next.findIndex(v => !v);
      next[empty >= 0 ? empty : 0] = name;
      localStorage.setItem(QUICK_SLOTS_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const filteredPresets = presets;

  const captureAB = useCallback(() => {
    setAbSnapshot(buildPreset("__ab__"));
  }, [buildPreset]);

  const applyAB = useCallback(() => {
    if (abSnapshot) applyPreset(abSnapshot);
  }, [abSnapshot, applyPreset]);
  void assignQuickSlot; void captureAB; void applyAB;

  const saveProject = useCallback(() => {
    const project = {
      version: "spectra-v1" as const,
      mode, gain, brightness, contrast, saturation, hueShift, scanlines, zoom, speed,
      sortAmt, scanTear, blockGlitch, datamosh, moshHard, chrash, liquid,
      feedback, contour, ascii, venetian,
      kaleido, disrupt, disruptCount, disruptSize, disruptContrary,
      tile, invertSym, droste, spiral, yantra, mandala, rosette, starfold, hexfold,
      sortKey, sortLow, sortHigh, sortMode, sortSegment, sortRandom, sortWobble,
      moshIFrame, moshMotion, moshBleed, moshMap, moshDistort,
      exportFormat, exportQuality, exportProfile,
      openSections: Array.from(openSections),
      paramsByMode,
      presets,
      quickSlots,
    };
    const json = JSON.stringify(project, null, 2);
    const filename = `gps-${Date.now()}.gps`;
    const isNative = (() => {
      try { return Capacitor.isNativePlatform?.() === true; } catch { return false; }
    })();
    if (isNative) {
      // v1.2.92 — native: write to Documents/GlitchPixelStudio/projects/
      // and pop the share sheet so the user can copy/email/move it.
      (async () => {
        try {
          const path = `GlitchPixelStudio/projects/${filename}`;
          const written = await Filesystem.writeFile({
            path,
            data: json,
            directory: Directory.Documents,
            recursive: true,
            encoding: Encoding.UTF8,
          });
          try {
            await Share.share({
              title: "GPS Project",
              text: filename,
              url: written.uri,
              dialogTitle: "Save / share GPS project",
            });
          } catch { /* user cancelled share — file is still written */ }
          try {
            window.dispatchEvent(new CustomEvent("gps-saved", {
              detail: { filename, path: `Documents/${path}` },
            }));
          } catch {}
        } catch (err) {
          void err;
          try {
            window.dispatchEvent(new CustomEvent("gps-saved", {
              detail: { filename, path: "save failed" },
            }));
          } catch {}
        }
      })();
      return;
    }
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [mode, gain, brightness, contrast, saturation, hueShift, scanlines, zoom, speed,
      sortAmt, scanTear, blockGlitch, datamosh, moshHard, chrash, liquid,
      feedback, contour, ascii, venetian, sortKey, sortLow, sortHigh,
      sortMode, sortSegment, sortRandom, sortWobble, moshIFrame, moshMotion,
      moshBleed, moshMap, moshDistort, exportFormat, exportQuality,
      exportProfile, openSections, paramsByMode, presets, quickSlots]);

  const loadProject = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const p: any = JSON.parse(ev.target?.result as string);
        if (!p || p.version !== "spectra-v1") return;
        applyPreset({
          name: "__load__",
          mode: (p.mode ?? 0) as ModeId,
          gain: p.gain ?? 0.5,
          brightness: p.brightness ?? 1.0,
          contrast: p.contrast ?? 1.0,
          saturation: p.saturation ?? 1.0,
          hueShift: p.hueShift ?? 0.0,
          scanlines: p.scanlines ?? 0.0,
          zoom: p.zoom ?? 0.0,
          speed: p.speed ?? 1.0,
          sortAmt: p.sortAmt ?? 0.0,
          scanTear: p.scanTear ?? 0.0,
          blockGlitch: p.blockGlitch ?? 0.0,
          datamosh: p.datamosh ?? 0.0,
          moshHard: !!p.moshHard,
          chrash: p.chrash ?? 0.0,
          liquid: p.liquid ?? 0.0,
          feedback: p.feedback ?? 0.0,
          contour: p.contour ?? 0.0,
          ascii: p.ascii ?? 0.0,
          venetian: p.venetian ?? 0.0,
          kaleido: p.kaleido ?? 0.0,
          disrupt: p.disrupt ?? 0.0,
          disruptCount: p.disruptCount ?? 0.4,
          disruptSize: p.disruptSize ?? 0.4,
          disruptContrary: p.disruptContrary ?? 1.0,
          tile: p.tile ?? 0.0,
          invertSym: p.invertSym ?? 0.0,
          droste: p.droste ?? 0.0,
          spiral: p.spiral ?? 0.0,
          yantra: p.yantra ?? 0.0,
          mandala: p.mandala ?? 0.0,
          rosette: p.rosette ?? 0.0,
          starfold: p.starfold ?? 0.0,
          hexfold: p.hexfold ?? 0.0,
          sortKey: p.sortKey ?? 0,
          sortLow: p.sortLow ?? 0.35,
          sortHigh: p.sortHigh ?? 0.92,
          sortMode: p.sortMode ?? 0,
          sortSegment: p.sortSegment ?? 0.35,
          sortRandom: p.sortRandom ?? 0.18,
          sortWobble: p.sortWobble ?? 0.12,
          moshIFrame: p.moshIFrame ?? 0.7,
          moshMotion: p.moshMotion ?? 0.55,
          moshBleed: p.moshBleed ?? 0.45,
          moshMap: p.moshMap ?? 0.0,
          moshDistort: p.moshDistort ?? 0.5,
          paramsByMode: (p.paramsByMode && typeof p.paramsByMode === "object") ? p.paramsByMode : undefined,
        });
        setExportFormat(p.exportFormat ?? "gif");
        setExportQuality(p.exportQuality ?? "high");
        setExportProfile(p.exportProfile ?? "native");
        if (Array.isArray(p.openSections)) setOpenSections(new Set<string>(p.openSections as string[]));
        if (Array.isArray(p.presets)) {
          setPresets(p.presets as SpectraPreset[]);
          localStorage.setItem(PRESETS_KEY, JSON.stringify(p.presets));
        }
        if (Array.isArray(p.quickSlots)) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const qs: Array<string | null> = Array.from({ length: 8 }, (_: any, i: number) =>
            typeof p.quickSlots[i] === "string" ? p.quickSlots[i] as string : null
          );
          setQuickSlots(qs);
          localStorage.setItem(QUICK_SLOTS_KEY, JSON.stringify(qs));
        }
      } catch {}
    };
    reader.readAsText(file);
  }, [applyPreset]);

  // ── Lifecycle ────────────────────────────────────────────
  useEffect(() => {
    if (!bootDone) return;
    const ok = initGL();
    if (!ok) return;
    resize();
    window.addEventListener("resize", resize);
    rafRef.current = requestAnimationFrame(render);
    // v1.2.54: when the app comes back to foreground, the render loop has
    // exited (it returns early on hidden). Kick it back off here.
    const onVisChange = () => {
      if (typeof document === "undefined") return;
      if (document.visibilityState === "visible" && !rafRef.current) {
        rafRef.current = requestAnimationFrame(render);
      }
    };
    document.addEventListener("visibilitychange", onVisChange);
    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", onVisChange);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bootDone]);

  // Auto-start camera when source mode wants the camera, OR when face FX
  // is engaged on a non-camera source (v1.2.51 composite path needs the
  // camera + segmenter running underneath gen/upload so the person can be
  // cut out and laid over the source).
  // v1.2.53: removed the cleanup that reset startCameraInFlightRef — it
  // allowed multiple in-flight startCamera() calls to stack when the user
  // toggled sourceMode/faceFxMode quickly, racing two getUserMedia()
  // requests against the same video element and leaving the camera in a
  // stuck state where the next manual retry was needed to recover. The
  // in-flight flag now naturally clears in startCamera()'s finally block.
  useEffect(() => {
    if (!bootDone) return;
    if (sourceMode === "camera" || faceFxMode !== "OFF") {
      void startCamera();
    } else if (cameraActive) {
      stopCamera();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bootDone, sourceMode, faceFxMode]);

  // v1.2.96 — Resume handler. When the user backgrounds the app and
  // returns (without a hard kill), Android may have torn down the camera
  // tracks even though our React state still says cameraActive=true. The
  // result was a frozen black/glitched preview until the user toggled CAM.
  // We now listen for both the WebView visibilitychange AND the Capacitor
  // App appStateChange event — on resume, if a camera is wanted but the
  // underlying MediaStream is no longer live, force-restart it.
  useEffect(() => {
    if (!bootDone) return;
    const wantsCamera = () =>
      sourceModeRef.current === "camera" || faceFxModeRef.current !== "OFF";
    const streamDead = () => {
      const s = streamRef.current;
      if (!s) return true;
      if (!s.active) return true;
      const tracks = s.getVideoTracks?.() ?? [];
      if (tracks.length === 0) return true;
      return tracks.every(t => t.readyState === "ended" || !t.enabled);
    };
    const recover = () => {
      if (!wantsCamera()) return;
      if (!streamDead()) return;
      // Force a clean re-acquire. startCamera handles in-flight gating.
      void startCamera(true);
    };
    const onVis = () => {
      if (typeof document === "undefined") return;
      if (document.visibilityState !== "visible") return;
      // Small delay so the WebView has a chance to settle on resume.
      setTimeout(recover, 120);
    };
    document.addEventListener("visibilitychange", onVis);
    let removeAppListener: (() => void) | null = null;
    (async () => {
      try {
        if (!Capacitor.isNativePlatform?.()) return;
        const { App } = await import("@capacitor/app");
        const handle = await App.addListener("appStateChange", (state: { isActive: boolean }) => {
          if (state?.isActive) setTimeout(recover, 120);
        });
        removeAppListener = () => { try { handle.remove(); } catch {} };
      } catch {
        // @capacitor/app not available — visibilitychange path still covers it.
      }
    })();
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      if (removeAppListener) removeAppListener();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bootDone]);

  useEffect(() => {
    const raw = localStorage.getItem(PRESETS_KEY);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as SpectraPreset[];
      if (Array.isArray(parsed)) setPresets(parsed);
    } catch {}
  }, []);

  useEffect(() => {
    const raw = localStorage.getItem(QUICK_SLOTS_KEY);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as Array<string | null>;
      if (Array.isArray(parsed)) {
        const fixed = Array.from({ length: 8 }, (_, i) => typeof parsed[i] === "string" ? parsed[i] : null);
        setQuickSlots(fixed);
      }
    } catch {}
  }, []);

  useEffect(() => {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return;
    try {
      const s = JSON.parse(raw) as SessionStateV1;
      if (!s || typeof s !== "object") return;
      // Spectra startup policy: boot into GEN + CAM with Face FX (FACE) every
      // time so PXL/MOSH and the FX rack always have a real composite to
      // chew on by default. v1.2.97 — previously this restore path forced
      // sourceMode="camera" with no faceFxMode reset, so a warm relaunch
      // dropped users into camera-only with no person rotoscope, even
      // though the cold-launch defaults were GEN+CAM+FACE. Now matches
      // the cold default exactly.
      setMode(0);
      setComboMode(true);
      setComboLayers([{mode:7,gain:1},{mode:9,gain:1}]);
      setSourceMode("generator");
      setFaceFxMode("FACE");
      setGenPalette("MONO");
      setGenAutoCycle(false);
      // v1.2.46: boot user-facing for the same reason as the state default.
      setCameraFacing("user");

      setGain(0.5);
      setBrightness(1.0);
      setContrast(1.0);
      setSaturation(1.0);
      setHueShift(0.0);
      setScanlines(0.0);
      setZoom(0.0);
      setSpeed(1.0);

      setSortAmt(0.0);
      setScanTear(0.0);
      setBlockGlitch(0.0);
      setDatamosh(0.0);
      setMoshHard(false);
      setChrash(0.0);
      setLiquid(0.0);
      setFeedback(0.0);
      setContour(0.0);
      setAscii(0.0);
      setVenetian(0.0);
      setKaleido(0.0);
      setDisrupt(0.0);
      setDisruptCount(0.4);
      setDisruptSize(0.4);
      setDisruptContrary(1.0);
      setTile(0.0);
      setInvertSym(0.0);
      setDroste(0.0);
      setSpiral(0.0);
      setYantra(0.0);
      setMandala(0.0);
      setRosette(0.0);
      setStarfold(0.0);
      setHexfold(0.0);
      setSortKey(0);
      setSortLow(0.35);
      setSortHigh(0.92);
      setSortMode(0);
      setSortSegment(0.35);
      setSortRandom(0.18);
      setSortWobble(0.12);
      setMoshIFrame(0.7);
      setMoshMotion(0.55);
      setMoshBleed(0.45);
      setMoshMap(0.0);
      setMoshDistort(0.5);
      setParamsByMode(defaultsForAllModes());

      setExportFormat(s.exportFormat ?? exportFormat);
      setExportQuality(s.exportQuality ?? exportQuality);
      setExportProfile(s.exportProfile ?? exportProfile);
      if (Array.isArray(s.openSections)) setOpenSections(new Set(s.openSections));
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const payload: SessionStateV1 = {
      mode,
      gain,
      brightness,
      contrast,
      saturation,
      hueShift,
      scanlines,
      zoom,
      speed,
      sortAmt,
      scanTear,
      blockGlitch,
      datamosh,
      moshHard,
      chrash,
      liquid,
      feedback,
      contour,
      ascii,
      venetian,
      kaleido,
      disrupt,
      disruptCount,
      disruptSize,
      disruptContrary,
      tile,
      invertSym,
      droste,
      spiral,
      yantra,
      mandala,
      rosette,
      starfold,
      hexfold,
      sortKey,
      sortLow,
      sortHigh,
      sortSegment,
      sortRandom,
      sortWobble,
      moshIFrame,
      moshMotion,
      moshBleed,
      moshMap,
      moshDistort,
      exportFormat,
      exportQuality,
      exportProfile,
      openSections: Array.from(openSections),
      paramsByMode,
    };
    localStorage.setItem(SESSION_KEY, JSON.stringify(payload));
  }, [
    mode, gain, brightness, contrast, saturation, hueShift, scanlines, zoom, speed,
    sortAmt, scanTear, blockGlitch, datamosh, moshHard, chrash, liquid,
    feedback, contour, ascii, venetian,
    kaleido, disrupt, disruptCount, disruptSize, disruptContrary,
    tile, invertSym, droste, spiral, yantra, mandala, rosette, starfold, hexfold,
    sortKey, sortLow, sortHigh,
    sortSegment, sortRandom, sortWobble, moshIFrame, moshMotion,
    moshBleed, moshMap, moshDistort, exportFormat, exportQuality,
    exportProfile, openSections,
    paramsByMode,
  ]);

  // ── Phase 1B: per-mode rack hydrate + debounced save ───────
  useEffect(() => {
    try {
      const raw = localStorage.getItem(RACK_KEY);
      if (!raw) return;
      const stored = JSON.parse(raw) as Record<string, Record<string, number>>;
      if (!stored || typeof stored !== "object") return;
      const merged = defaultsForAllModes();
      for (const m of MODES) {
        const entry = stored[String(m.id)];
        if (entry && typeof entry === "object") {
          merged[m.id] = { ...merged[m.id], ...entry };
        }
      }
      setParamsByMode(merged);
    } catch (err) {
      console.warn("[spectra] failed to load rack params", err);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      try {
        localStorage.setItem(RACK_KEY, JSON.stringify(paramsByMode));
      } catch (err) {
        console.warn("[spectra] failed to save rack params", err);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [paramsByMode]);

  // ── Phase 1B: rack helpers (kept minimal — only persistence still active) ─
  // Note: the rack UI (ModeRack/SliderRow) was removed when SpectraAfter was
  // stripped to PXL+MOSH+GEN. paramsByMode persistence stays for legacy save
  // files but the per-mode update helpers are no longer wired into the UI.

  const hslToHex = useCallback((h: number, s: number, l: number) => {
    const ss = s / 100;
    const ll = l / 100;
    const c = (1 - Math.abs(2 * ll - 1)) * ss;
    const x = c * (1 - Math.abs((h / 60) % 2 - 1));
    const m = ll - c / 2;
    let r = 0, g = 0, b = 0;
    if (h < 60) { r = c; g = x; b = 0; }
    else if (h < 120) { r = x; g = c; b = 0; }
    else if (h < 180) { r = 0; g = c; b = x; }
    else if (h < 240) { r = 0; g = x; b = c; }
    else if (h < 300) { r = x; g = 0; b = c; }
    else { r = c; g = 0; b = x; }
    const toHex = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, "0");
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  }, []);

  useEffect(() => {
    if (!drawActive || !colorCycle) return;
    const id = setInterval(() => {
      colorCycleHueRef.current = (colorCycleHueRef.current + Math.max(0.1, colorCycleSpeed) * 3.5) % 360;
      setBrushColor(hslToHex(Math.round(colorCycleHueRef.current), 100, 55));
    }, 33);
    return () => clearInterval(id);
  }, [drawActive, colorCycle, colorCycleSpeed, hslToHex]);

  // ── Device motion / accelerometer → accelEnergyRef ───────────────────────
  useEffect(() => {
    let active = true;
    let listening = false;
    let prevAx = 0, prevAy = 0, prevAz = 0;
    let requestMotion: (() => void) | null = null;

    const addMotionListener = () => {
      if (listening) return;
      listening = true;
      window.addEventListener("devicemotion", handleMotion, { passive: true });
    };

    function handleMotion(e: DeviceMotionEvent) {
      if (!active) return;
      const acc = e.accelerationIncludingGravity;
      if (!acc) return;
      const ax = acc.x ?? 0, ay = acc.y ?? 0, az = acc.z ?? 0;
      const rawDelta = (Math.abs(ax - prevAx) + Math.abs(ay - prevAy) + Math.abs(az - prevAz)) / 36;
      const delta = Math.min(1, Math.max(0, rawDelta - 0.04));
      accelEnergyRef.current = accelEnergyRef.current * 0.9 + delta * 0.1;
      accelTiltXRef.current = accelTiltXRef.current * 0.92 + Math.max(-1, Math.min(1, ax / 9.8)) * 0.08;
      accelTiltYRef.current = accelTiltYRef.current * 0.92 + Math.max(-1, Math.min(1, ay / 9.8)) * 0.08;
      accelPushRef.current = accelPushRef.current * 0.82 + delta * 0.18;
      prevAx = ax; prevAy = ay; prevAz = az;
    }

    // iOS 13+ requires a user-gesture permission request; bind it to first tap.
    const dme = DeviceMotionEvent as unknown as { requestPermission?: () => Promise<string> };
    if (typeof dme.requestPermission === "function") {
      requestMotion = () => {
        dme.requestPermission?.().then((state: string) => {
          if (state === "granted" && active) addMotionListener();
        }).catch(() => { /* permission denied – graceful no-op */ });
      };
      window.addEventListener("pointerdown", requestMotion, { once: true, passive: true });
    } else {
      addMotionListener();
    }

    return () => {
      active = false;
      window.removeEventListener("devicemotion", handleMotion);
      if (requestMotion) window.removeEventListener("pointerdown", requestMotion);
    };
  }, []);

  const layerArmed = (id: ModeId) => comboMode && comboLayers.some(l => l.mode === id);
  void layerArmed; // referenced indirectly via comboLayers in shader path



  // ── Render ───────────────────────────────────────────────
  // Layer modes were removed — both PXL and MOSH are always live and
  // combineable. The per-effect AMOUNT/INTENS knobs gate contribution.
  const showSortRack = true;
  const showMoshRack = true;
  void showSortRack; void showMoshRack;
  const modeLabel = MODES.find(m => m.id === mode)?.label ?? "NORMAL";
  const camStatus = cameraActive ? "active" : cameraRequesting ? "requesting" : sourceError ? "error" : "idle";
  const camStatusColor = camStatus === "active" ? "#52C97A" : camStatus === "requesting" ? "#E8A020" : camStatus === "error" ? "#E03D3D" : "rgba(200,180,220,0.35)";

  return (
    <div
      ref={tiltRootRef}
      className={"flex flex-col h-dvh overflow-hidden text-white" + (neonMode ? " neon-mode" : "") + (uiHidden ? " ui-hidden" : "")}
      style={{ fontFamily: "'Courier New', monospace", background: "#000" }}
    >
      <style>{`
        /* v1.2.76 — IMMERSIVE / HIDE-UI mode. */
        .ui-hidden .sp-panel-glass { display: none !important; }
        .ui-hidden .sp-canvas-pane { height: 100dvh !important; flex: 1 1 auto !important; }

        /* v1.2.76 — PHONE LANDSCAPE reflow (Tailwind lg: is desktop-only).
           v1.2.77 — widened: drop the 600px height clamp so taller phones
           (Pixel 8 Pro, foldables, etc.) also reflow on rotate. We still
           guard with max-width:1023px so we never fight the desktop lg: layout. */
        @media (orientation: landscape) and (max-height: 600px) {
          /* v1.2.81 \u2014 switched gate from (max-width:1023px) to
             (max-height:600px). On modern phones in landscape the CSS
             width can be 900\u20131180px which sometimes missed the old
             query; height in landscape is reliably <600px. This guarantees
             the reflow fires on every phone in landscape orientation,
             regardless of width. */
          .sp-body { flex-direction: row !important; }
          .landscape-row { flex-direction: row !important; }
          .sp-canvas-pane {
            flex: 1 1 0 !important;
            width: auto !important;
            height: 100% !important;
            min-height: 0 !important;
            min-width: 0 !important;
          }
          /* Inline style on inner wrapper pins aspectRatio:1/1 which would
             collapse the canvas to a square sized off the SHORT landscape
             height. Override so the canvas fills the entire pane. */
          .sp-canvas-pane > div {
            aspect-ratio: auto !important;
            width: 100% !important;
            height: 100% !important;
            max-width: 100% !important;
            max-height: 100% !important;
          }
          .sp-panel-glass {
            flex: 0 0 17rem !important;
            width: 17rem !important;
            height: 100% !important;
          }
        }

        /* ── 2.5D SLOT-MACHINE WHEEL FOR SYNTHPANELS ──
           The settings pane is the wheel container; each .sp-rack is a slot
           that gets perspective-tilted in JS based on distance from center.
           Scroll-snap pulls the nearest rack into the centered position. */
        .sp-panel-glass {
          perspective: 1100px;
          perspective-origin: 50% 50%;
          scroll-snap-type: y proximity;
          scroll-padding-top: 25%;
          scroll-padding-bottom: 25%;
          /* v1.2.62 — reserve room for the Android gesture-nav bar at the
             bottom of the device. Without this, the last controls in an
             open section (RECORD button, CAM HARD RESET, etc.) sit
             underneath the system gesture area and can't be tapped. */
          padding-bottom: max(env(safe-area-inset-bottom, 0px), 16px);
        }
        .sp-rack {
          scroll-snap-align: center;
          transition: transform 160ms cubic-bezier(.22,.9,.32,1.2),
                      opacity   160ms ease,
                      padding   180ms ease,
                      margin    180ms ease;
          transform-style: preserve-3d;
          backface-visibility: hidden;
        }
        /* Open rack pulls forward and stays flat so its content is fully
           usable while the wheel still tilts the neighbours away. */
        .sp-rack.sp-rack-open {
          transform: translate3d(0, 0, 0) rotateX(0deg) scale(1.03) !important;
          opacity: 1 !important;
          z-index: 2;
        }
        /* Pop-up animation: when an inner workspace mounts (rack opened),
           it grows from a flat slab into the full panel and fades in.
           When the rack closes, React unmounts the inner so the chassis
           collapses back via the transition above — the perceived
           "minimize" effect. */
        @keyframes sp-rack-pop {
          0%   { transform: translateY(-6px) scaleY(0.6); opacity: 0; filter: blur(2px); }
          60%  { transform: translateY(1px)  scaleY(1.02); opacity: 1; filter: blur(0); }
          100% { transform: translateY(0)    scaleY(1);    opacity: 1; filter: blur(0); }
        }
        .sp-rack-inner {
          transform-origin: top center;
          animation: sp-rack-pop 220ms cubic-bezier(.22,1.2,.36,1) both;
          will-change: transform, opacity;
        }
        /* Closed rack: chevron + title-only, very tight footprint. */
        .sp-rack.sp-rack-closed {
          opacity: 0.85;
        }
        /* ── NEON MODE — CHUNKY GLASS EVERYTHING + tilt parallax ──
           Strategy: keep the original flex layout (so nothing
           can escape the body region), but overlap the panel
           upward over the bottom of the camera with a negative
           margin so the backdrop-filter blur has actual pixels
           behind it to blur. Then turn EVERY button, tile, and
           panel surface into a chunky frosted-glass slab so the
           live FX bleed through the entire UI. */
        .neon-mode .sp-canvas-pane {
          height: 70dvh !important;
          transform: translate3d(calc(var(--tilt-tx, 0px) * -0.4), calc(var(--tilt-ty, 0px) * -0.4), 0);
          transition: transform 0.05s linear;
          will-change: transform;
        }
        /* GLASS-BOTTOM-BOAT: in NEON the camera/image fills the entire
           body region and the panel floats over the bottom as glass.
           This makes the FX read full-bleed under the controls. */
        .neon-mode .sp-body { position: relative !important; }
        .neon-mode .sp-canvas-pane {
          position: absolute !important;
          inset: 0 !important;
          height: auto !important;
          z-index: 0;
        }
        .neon-mode .sp-canvas-pane > div {
          aspect-ratio: auto !important;
          width: 100% !important;
          height: 100% !important;
          max-width: none !important;
          max-height: none !important;
        }
        .neon-mode .sp-panel-glass {
          margin-top: 0 !important;
          position: absolute !important;
          left: 0; right: 0;
          /* v1.2.62 — anchor above the Android gesture-nav bar so the
             EXPORT panel's RECORD button isn't swallowed by the system
             gesture area. Falls back to 0 on iOS/desktop where the env
             var is 0. */
          bottom: env(safe-area-inset-bottom, 0px);
          /* Carousel is capped to 1/4 of the viewport so the camera/FX
             always reads at ≥ 75% full. The wheel uses heavy z-depth
             (see .sp-rack transform in JS) so off-center racks recede
             instead of needing more vertical scroll real-estate. */
          max-height: 24dvh;
          overflow-y: auto;
          overscroll-behavior: contain;
          z-index: 5;
          /* v1.2.49 — full glass-bottom-boat: drop the panel tint to a
             whisper so the FX layer reads through almost unobstructed.
             The blur + tilt do the heavy visual lifting now. */
          background: linear-gradient(180deg, rgba(15,0,28,0.02) 0%, rgba(8,0,18,0.04) 38%, rgba(8,0,18,0.08) 100%) !important;
          backdrop-filter: blur(2.5px) saturate(1.25);
          -webkit-backdrop-filter: blur(2.5px) saturate(1.25);
          border-top: 1px solid rgba(231,174,255,0.35) !important;
          box-shadow:
            0 -10px 36px rgba(176,20,240,0.25),
            inset 0 1px 0 rgba(255,255,255,0.18),
            inset 0 -1px 0 rgba(0,0,0,0.4);
          transform: translate3d(var(--tilt-tx, 0px), calc(var(--tilt-ty, 0px) * 0.5), 0)
                     rotateX(var(--tilt-x, 0deg)) rotateY(var(--tilt-y, 0deg));
          transform-origin: 50% 0%;
          transform-style: preserve-3d;
          transition: background 0.3s ease, max-height 0.28s ease;
          will-change: transform;
        }
        .neon-mode .sp-panel-glass.glass-expanded {
          /* Open rack pops up to at most 38dvh so image is still ≥ 62%
             visible. Inner content scrolls inside that band. */
          max-height: 38dvh;
        }
        /* v1.2.49 — racks themselves were fully-opaque deep purple
           chassis (the biggest opacity offender); make them whisper
           glass too so the FX layer reads through every rack body and
           inner workspace. Inline gradient stays for the lg/dock layout
           where racks aren't in glass mode. */
        .neon-mode .sp-rack {
          background: linear-gradient(180deg,
            rgba(42,10,74,0.10) 0%,
            rgba(26,5,48,0.08) 60%,
            rgba(15,2,32,0.12) 100%) !important;
          backdrop-filter: blur(2px) saturate(1.15);
          -webkit-backdrop-filter: blur(2px) saturate(1.15);
          border: 1px solid rgba(231,174,255,0.18) !important;
          box-shadow:
            0 4px 14px rgba(0,0,0,0.35),
            inset 0 1px 0 rgba(255,255,255,0.05) !important;
        }
        .neon-mode .sp-rack-inner {
          background:
            repeating-linear-gradient(90deg, rgba(255,255,255,0.012) 0 1px, transparent 1px 3px),
            linear-gradient(180deg, rgba(28,28,34,0.08) 0%, rgba(20,20,26,0.06) 50%, rgba(14,14,20,0.10) 100%) !important;
          backdrop-filter: blur(1.5px) saturate(1.1);
          -webkit-backdrop-filter: blur(1.5px) saturate(1.1);
          border: 1px solid rgba(231,174,255,0.10) !important;
          box-shadow:
            inset 0 1px 2px rgba(0,0,0,0.35),
            inset 0 -1px 0 rgba(255,255,255,0.03) !important;
        }
        @media (min-width: 1024px) {
          .neon-mode .sp-canvas-pane {
            height: auto !important;
            margin-right: -10rem !important;
          }
          .neon-mode .sp-panel-glass {
            margin-top: 0 !important;
            border-top: none !important;
            border-left: 1px solid rgba(231,174,255,0.55) !important;
            box-shadow:
              -10px 0 36px rgba(176,20,240,0.25),
              inset 1px 0 0 rgba(255,255,255,0.18),
              inset -1px 0 0 rgba(0,0,0,0.4);
          }
        }
        /* CHUNKY GLASS BUTTONS — sp-btn (top nav + small) and sp-tile
           (preset/export pads). Override any inline backgrounds with
           a translucent purple/pink frost and stack inset bevels for
           that "thick poured glass" feel. */
        .neon-mode .sp-btn,
        .neon-mode .sp-tile,
        .neon-mode button.sp-btn,
        .neon-mode button.sp-tile {
          /* v1.2.49 — buttons go nearly clear; just bevel + border define them. */
          background: linear-gradient(180deg,
            rgba(80,30,120,0.04) 0%,
            rgba(20,5,40,0.02) 50%,
            rgba(8,0,18,0.04) 100%) !important;
          backdrop-filter: blur(1.5px) saturate(1.1);
          -webkit-backdrop-filter: blur(1.5px) saturate(1.1);
          border: 1px solid rgba(231,174,255,0.40) !important;
          border-radius: 6px !important;
          color: rgba(255,235,255,0.98) !important;
          box-shadow:
            inset 0 1px 0 rgba(255,255,255,0.45),
            inset 0 -2px 0 rgba(0,0,0,0.45),
            inset 0 0 18px rgba(176,20,240,0.22),
            0 4px 14px rgba(176,20,240,0.32),
            0 0 0 1px rgba(255,180,255,0.10) !important;
          /* Crisp halo around every glyph so text stays legible over
             whatever colors are pumping through behind it. */
          text-shadow:
            0 0 4px rgba(0,0,0,0.95),
            0 0 2px rgba(0,0,0,0.95),
            0 1px 0 rgba(0,0,0,0.85) !important;
          transition: transform 0.08s ease, box-shadow 0.18s ease, background 0.18s ease;
        }
        .neon-mode .sp-btn:hover,
        .neon-mode .sp-tile:hover {
          background: linear-gradient(180deg,
            rgba(120,40,170,0.18) 0%,
            rgba(40,15,75,0.10) 50%,
            rgba(20,0,40,0.18) 100%) !important;
          border-color: rgba(255,200,255,0.85) !important;
          box-shadow:
            inset 0 1px 0 rgba(255,255,255,0.42),
            inset 0 -2px 0 rgba(0,0,0,0.5),
            inset 0 0 32px rgba(255,80,255,0.28),
            0 6px 20px rgba(255,40,255,0.42),
            0 0 0 1px rgba(255,200,255,0.12) !important;
        }
        .neon-mode .sp-btn:active,
        .neon-mode .sp-tile:active,
        .neon-mode .sp-panel-glass button:active {
          /* v1.2.50 — hold-to-magnify: button pops to 1.35× while held
             instead of pressing down. Lifts above siblings + glows so
             the user knows exactly which control they have. */
          transform: scale(1.35);
          z-index: 50;
          position: relative;
          box-shadow:
            inset 0 1px 0 rgba(255,255,255,0.5),
            inset 0 -2px 0 rgba(0,0,0,0.5),
            0 10px 22px rgba(176,20,240,0.55),
            0 0 0 1px rgba(255,200,255,0.25) !important;
        }
        .neon-mode .sp-btn,
        .neon-mode .sp-tile,
        .neon-mode .sp-panel-glass button {
          transition: transform 160ms cubic-bezier(.2,.9,.25,1.1),
                      box-shadow 160ms ease,
                      background 160ms ease,
                      border-color 160ms ease;
          transform-origin: center center;
        }
        /* Beef text contrast against the live FX backdrop. */
        .neon-mode .sp-panel-glass button,
        .neon-mode .sp-panel-glass label,
        .neon-mode .sp-panel-glass span {
          text-shadow: 0 0 3px rgba(0,0,0,0.9), 0 1px 0 rgba(0,0,0,0.8);
        }
        /* CHUNKY GLASS — applies to EVERY button inside the rack panel,
           not just the explicitly-classed sp-btn / sp-tile pads. Most
           generator / mode / palette buttons have inline-style only,
           and we want them all to read as the same poured-glass slabs.
           These rules are last so !important wins over inline styles. */
        .neon-mode .sp-panel-glass button {
          /* v1.2.49 — in-rack buttons match the new whisper-glass tint. */
          background: linear-gradient(180deg,
            rgba(80,30,120,0.04) 0%,
            rgba(20,5,40,0.02) 50%,
            rgba(8,0,18,0.05) 100%) !important;
          backdrop-filter: blur(1.5px) saturate(1.1);
          -webkit-backdrop-filter: blur(1.5px) saturate(1.1);
          border: 1px solid rgba(231,174,255,0.35) !important;          border-radius: 6px !important;
          color: rgba(255,235,255,0.98) !important;
          box-shadow:
            inset 0 1px 0 rgba(255,255,255,0.40),
            inset 0 -2px 0 rgba(0,0,0,0.45),
            inset 0 0 18px rgba(176,20,240,0.22),
            0 4px 12px rgba(176,20,240,0.32) !important;
          text-shadow:
            0 0 4px rgba(0,0,0,0.95),
            0 0 2px rgba(0,0,0,0.95),
            0 1px 0 rgba(0,0,0,0.85) !important;
        }
        .neon-mode .sp-panel-glass button:hover {
          background: linear-gradient(180deg,
            rgba(120,40,170,0.18) 0%,
            rgba(40,15,75,0.10) 50%,
            rgba(20,0,40,0.20) 100%) !important;
          border-color: rgba(255,200,255,0.8) !important;
          box-shadow:
            inset 0 1px 0 rgba(255,255,255,0.45),
            inset 0 -2px 0 rgba(0,0,0,0.5),
            inset 0 0 30px rgba(255,80,255,0.28),
            0 6px 18px rgba(255,40,255,0.42) !important;
        }
        /* PHOTO button must float ABOVE the glass panel in NEON mode
           so the user can still snap a still while controls overlay
           the bottom of the canvas. Bumped to z-index 10. */
        .neon-mode .sp-photo-btn-neon {
          position: fixed !important;
          right: 12px !important;
          bottom: calc(28dvh + 12px) !important;
          z-index: 10 !important;
          transition: bottom 0.28s ease;
        }
        .neon-mode .sp-panel-glass.glass-expanded ~ * .sp-photo-btn-neon,
        body:has(.neon-mode .sp-panel-glass.glass-expanded) .sp-photo-btn-neon {
          bottom: calc(55dvh + 12px) !important;
        }
        /* SynthPanel borders + Knob caps in NEON mode also get a hint
           of glass so the rack chrome itself melts into the panel
           rather than staying opaque metal-textured slab. */
        .neon-mode .sp-panel-glass [style*="border"] {
          backdrop-filter: blur(4px);
          -webkit-backdrop-filter: blur(4px);
        }
        /* SynthPanel chassis + brushed-metal inner workspace go GLASS
           in NEON so the rack frames don't block the FX. The deep
           purple chassis becomes a translucent purple film and the
           brushed-metal interior becomes a subtle dark wash. */
        .neon-mode .sp-rack {
          background: linear-gradient(180deg,
            rgba(42,10,74,0.18) 0%,
            rgba(26,5,48,0.14) 60%,
            rgba(15,2,32,0.20) 100%) !important;
          backdrop-filter: blur(3px) saturate(1.25);
          -webkit-backdrop-filter: blur(3px) saturate(1.25);
          border: 1px solid rgba(231,174,255,0.28) !important;
          box-shadow:
            0 6px 18px rgba(176,20,240,0.20),
            inset 0 1px 0 rgba(255,255,255,0.10),
            inset 0 -2px 4px rgba(0,0,0,0.35) !important;
        }
        .neon-mode .sp-rack-inner {
          background: linear-gradient(180deg,
            rgba(28,28,34,0.22) 0%,
            rgba(20,20,26,0.16) 50%,
            rgba(14,14,20,0.24) 100%) !important;
          backdrop-filter: blur(2px);
          -webkit-backdrop-filter: blur(2px);
          box-shadow:
            inset 0 2px 4px rgba(0,0,0,0.40),
            inset 0 -1px 0 rgba(255,255,255,0.08) !important;
          border: 1px solid rgba(231,174,255,0.18) !important;
        }
        /* Sliders + range inputs get a glassy track too. */
        .neon-mode input[type="range"] {
          background: rgba(20,5,40,0.35) !important;
          border-radius: 6px;
          box-shadow:
            inset 0 1px 2px rgba(0,0,0,0.6),
            inset 0 -1px 0 rgba(255,255,255,0.08),
            0 0 0 1px rgba(231,174,255,0.35);
        }
        /* Top-nav NEON button glow when active (overrides chunky glass
           with a brighter pink). */
        .neon-mode .topnav-neon-on,
        .topnav-neon-on {
          color: rgba(255,200,255,1) !important;
          border-color: rgba(255,140,255,0.95) !important;
          box-shadow:
            inset 0 1px 0 rgba(255,255,255,0.5),
            inset 0 -2px 0 rgba(0,0,0,0.5),
            inset 0 0 36px rgba(255,80,255,0.45),
            0 0 18px rgba(255,80,255,0.7),
            0 0 4px rgba(255,180,255,0.6) inset !important;
          text-shadow: 0 0 8px rgba(255,80,255,0.95);
        }
      `}</style>
      {introVisible && <SpectraIntro onDone={() => setIntroVisible(false)} />}
      <BugReportModal open={bugOpen} onClose={() => setBugOpen(false)} />
      <BootScreen progress={bootProgress} done={bootDone} onSkip={() => { setBootProgress(100); setBootDone(true); }} />

      {/* Runtime error overlay — only shows if window.error or unhandled
          rejection fires. Lets us see crashes instead of a blank screen. */}
      {runtimeError && (
        <div
          style={{
            position: "fixed", left: 8, right: 8, bottom: 8, zIndex: 99999,
            background: "rgba(40,0,8,0.96)",
            border: "1px solid rgba(255,80,120,0.7)",
            color: "rgba(255,210,210,0.98)",
            fontFamily: "'Courier New',monospace", fontSize: 10,
            padding: 10, borderRadius: 4,
            maxHeight: "40vh", overflowY: "auto",
            boxShadow: "0 0 20px rgba(255,40,80,0.5)",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
            <strong style={{ letterSpacing: 2 }}>RUNTIME ERROR</strong>
            <button
              onClick={() => setRuntimeError(null)}
              style={{ background: "transparent", border: "1px solid rgba(255,210,210,0.5)", color: "inherit", padding: "2px 8px", cursor: "pointer", fontSize: 9 }}
            >DISMISS ✕</button>
          </div>
          <pre style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{runtimeError}</pre>
        </div>
      )}

      {/* v1.2.72 — HANDS-FREE floating button removed; lives back in the
          EXPORT panel next to RECORD. The big top pill obfuscated other
          UI controls, so we only keep the big-numeral overlay below. */}

      {/* v1.2.71 — HANDS-FREE big-numeral overlay. Three phases:
          IN (gold, 3-2-1 pre-record), REC (small persistent secs-left
          pill mid-shoot, no big numeral), OUT (red 3-2-1 final-3-secs
          warning so the dancer holds the pose). Pointer-transparent so
          the floating top button stays tappable for cancel. */}
      {handsFreeCountdown != null && (
        <div
          style={{
            position: "fixed", inset: 0, zIndex: 99999,
            display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "center",
            pointerEvents: "none",
            background: handsFreeCountdown.phase === "rec"
              ? "transparent"
              : (handsFreeCountdown.phase === "out"
                  ? "radial-gradient(circle at center, rgba(40,5,12,0.45) 0%, rgba(15,5,28,0.0) 60%)"
                  : "radial-gradient(circle at center, rgba(15,5,28,0.35) 0%, rgba(15,5,28,0.0) 60%)"),
          }}
        >
          {handsFreeCountdown.phase === "rec" ? (
            <div style={{
              position: "absolute", top: 96, left: "50%",
              transform: "translateX(-50%)",
              fontFamily: "'Courier New',monospace",
              fontSize: 16, letterSpacing: "3px",
              color: "rgba(255,210,210,0.95)",
              padding: "6px 14px",
              border: "1px solid rgba(255,80,120,0.8)",
              borderRadius: 4,
              background: "rgba(40,0,8,0.55)",
              textShadow: "0 0 8px rgba(255,80,120,0.9)",
              boxShadow: "0 0 14px rgba(255,40,80,0.55)",
            }}>● REC · {handsFreeCountdown.n}s LEFT</div>
          ) : (
            <>
              <div style={{
                fontFamily: "'Courier New',monospace",
                fontSize: 220, lineHeight: 1, fontWeight: 900,
                color: handsFreeCountdown.phase === "out"
                  ? "rgba(255,180,190,0.98)"
                  : "rgba(255,235,205,0.98)",
                letterSpacing: "8px",
                textShadow: handsFreeCountdown.phase === "out"
                  ? "0 0 40px rgba(255,40,80,0.95), 0 0 14px rgba(255,80,160,0.8)"
                  : "0 0 40px rgba(232,160,32,0.95), 0 0 14px rgba(255,80,160,0.7)",
                transform: "scale(1)",
                animation: "activeGlow 1s ease-in-out infinite",
              }}>{handsFreeCountdown.n}</div>
              <div style={{
                marginTop: 24,
                fontFamily: "'Courier New',monospace",
                fontSize: 12, letterSpacing: "3px",
                color: handsFreeCountdown.phase === "out"
                  ? "rgba(255,210,210,0.95)"
                  : "rgba(255,235,205,0.85)",
                textTransform: "uppercase",
              }}>{handsFreeCountdown.phase === "out"
                  ? "HOLD · STOPPING"
                  : `HANDS-FREE · RECORDS ${HANDS_FREE_SEC}s`}</div>
            </>
          )}
        </div>
      )}

      {/* FACE FX transient toast (placeholder until v1.3.0 shader lands). */}
      {faceFxToast && (
        <div
          style={{
            position: "fixed", left: "50%", top: 70, transform: "translateX(-50%)",
            zIndex: 99998,
            background: "rgba(15,5,28,0.92)",
            border: "1px solid rgba(255,210,140,0.65)",
            color: "rgba(255,235,205,0.98)",
            fontFamily: "'Courier New',monospace", fontSize: 11, letterSpacing: "1.6px",
            padding: "8px 14px", borderRadius: 4,
            boxShadow: "0 0 20px rgba(232,160,32,0.45)",
            pointerEvents: "none",
          }}
        >{faceFxToast}</div>
      )}

      {/* ── TIER info modal ── */}
      {tierInfoOpen && (
        <div
          onClick={() => setTierInfoOpen(false)}
          style={{
            position: "fixed", inset: 0, zIndex: 9997,
            background: "rgba(3,5,16,0.85)", backdropFilter: "blur(6px)",
            display: "flex", alignItems: "center", justifyContent: "center",
            padding: 16, fontFamily: "'Courier New',monospace",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              maxWidth: 520, width: "100%",
              background: "linear-gradient(180deg,#170824 0%,#080214 100%)",
              border: "1px solid rgba(255,210,140,0.45)",
              borderRadius: 8, padding: 18, color: "rgba(231,210,255,0.95)",
              boxShadow: "0 0 24px rgba(176,20,240,0.45), inset 0 0 12px rgba(0,0,0,0.7)",
              maxHeight: "85vh", overflowY: "auto",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div style={{ fontSize: 14, letterSpacing: "3px", color: "rgba(255,210,140,0.95)", textShadow: "0 0 8px rgba(232,160,32,0.7)" }}>
                GPS · PLANS
              </div>
              <button
                onClick={() => setTierInfoOpen(false)}
                style={{
                  fontFamily: "'Courier New',monospace", fontSize: 11,
                  background: "transparent", border: "1px solid rgba(231,174,255,0.4)",
                  color: "rgba(231,174,255,0.85)", padding: "4px 10px", borderRadius: 4,
                  cursor: "pointer", letterSpacing: "1.5px",
                }}
              >CLOSE ✕</button>
            </div>
            <div style={{ fontSize: 10, letterSpacing: "1.6px", color: "rgba(200,180,220,0.6)", marginBottom: 14 }}>
              Status: <span style={{ color: entitlement === "studio" ? "rgba(120,255,200,0.95)" : entitlement === "paid" ? "rgba(255,210,140,0.95)" : "rgba(231,174,255,0.95)" }}>
                {entitlement === "studio" ? "STUDIO subscriber" : entitlement === "paid" ? "PAID (lifetime)" : `LOCKED — ${Math.ceil(graceRemaining/1000)}s grace left`}
              </span>
            </div>

            <div style={{ marginBottom: 18 }}>
              <div style={{ fontSize: 11, letterSpacing: "2px", color: "rgba(255,210,140,0.95)", marginBottom: 8, textShadow: "0 0 6px rgba(232,160,32,0.55)" }}>GPS — $3.99 lifetime</div>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 11, lineHeight: 1.6, color: "rgba(255,235,205,0.92)" }}>
                {TIER_FEATURES.paid.map((f) => <li key={f}>{f}</li>)}
              </ul>
            </div>

            <div>
              <div style={{ fontSize: 11, letterSpacing: "2px", color: "rgba(120,255,200,0.95)", marginBottom: 8, textShadow: "0 0 6px rgba(40,200,140,0.45)" }}>GPS STUDIO — $6.90 / month</div>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 11, lineHeight: 1.6, color: "rgba(220,255,235,0.9)" }}>
                {TIER_FEATURES.studio.map((f) => <li key={f}>{f}</li>)}
              </ul>
            </div>

            <div style={{ marginTop: 18, fontSize: 9, letterSpacing: "1.4px", color: "rgba(200,180,220,0.55)", textTransform: "uppercase", lineHeight: 1.6 }}>
              In-app purchase wires up in the next update. For now, install
              gets a 30-minute cumulative grace period before the lock screen.
            </div>
          </div>
        </div>
      )}

      {/* ── LOCK SCREEN — shown when grace expires and no entitlement.
            Blocks all interaction with the app behind it. */}
      {locked && (
        <div
          style={{
            position: "fixed", inset: 0, zIndex: 9999,
            background: "linear-gradient(180deg,#070213 0%,#1a0530 60%,#03000c 100%)",
            display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
            padding: 24, fontFamily: "'Courier New',monospace", color: "rgba(231,210,255,0.95)",
            overflowY: "auto",
          }}
        >
          <div style={{ fontSize: 12, letterSpacing: "5px", color: "rgba(231,174,255,0.55)", marginBottom: 6 }}>GLITCH PHOTO STUDIO</div>
          <div style={{ fontSize: 28, letterSpacing: "6px", color: "rgba(255,210,140,0.98)", textShadow: "0 0 14px rgba(232,160,32,0.7)", marginBottom: 4 }}>LOCKED</div>
          <div style={{ fontSize: 10, letterSpacing: "1.6px", color: "rgba(200,180,220,0.6)", marginBottom: 22, textAlign: "center", maxWidth: 320 }}>
            Your 30-minute trial has ended. Unlock GPS to keep glitching.
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 10, width: "100%", maxWidth: 340 }}>
            <button
              onClick={() => {
                // Placeholder — real Play Billing wires in next release.
                alert("In-app purchase ships in the next update. For now, tap GPS v" + APP_VERSION + " 5 times to enter a dev unlock code.");
              }}
              style={{
                fontFamily: "'Courier New',monospace", fontSize: 14, letterSpacing: "3px",
                padding: "16px 18px", borderRadius: 6, cursor: "pointer",
                background: "linear-gradient(180deg,rgba(255,210,140,0.18),rgba(232,160,32,0.08))",
                border: "1px solid rgba(255,210,140,0.7)",
                color: "rgba(255,235,205,0.98)",
                textShadow: "0 0 6px rgba(232,160,32,0.55)",
              }}
            >BUY GPS — $3.99</button>
            <button
              onClick={() => {
                alert("Subscriptions ship in the next update. For now, tap GPS v" + APP_VERSION + " 5 times to enter a dev unlock code.");
              }}
              style={{
                fontFamily: "'Courier New',monospace", fontSize: 12, letterSpacing: "2.5px",
                padding: "12px 16px", borderRadius: 6, cursor: "pointer",
                background: "linear-gradient(180deg,rgba(120,255,200,0.14),rgba(40,200,140,0.06))",
                border: "1px solid rgba(120,255,200,0.55)",
                color: "rgba(220,255,235,0.95)",
              }}
            >SUBSCRIBE TO STUDIO — $6.90 / MO</button>
            <button
              onClick={() => alert("Restore Purchases will check the Play Store for prior entitlements once billing is wired up.")}
              style={{
                fontFamily: "'Courier New',monospace", fontSize: 11, letterSpacing: "2px",
                padding: "10px 14px", borderRadius: 6, cursor: "pointer",
                background: "transparent",
                border: "1px solid rgba(231,174,255,0.4)",
                color: "rgba(231,174,255,0.85)",
              }}
            >RESTORE PURCHASES</button>
            <button
              onClick={() => setTierInfoOpen(true)}
              style={{
                fontFamily: "'Courier New',monospace", fontSize: 10, letterSpacing: "1.8px",
                padding: "8px 12px", borderRadius: 6, cursor: "pointer",
                background: "transparent",
                border: "1px dashed rgba(200,180,220,0.3)",
                color: "rgba(200,180,220,0.7)",
              }}
            >SEE WHAT&apos;S INCLUDED</button>
          </div>

          {unlockInputVisible && (
            <div style={{ marginTop: 24, width: "100%", maxWidth: 340, display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ fontSize: 9, letterSpacing: "1.6px", color: "rgba(200,180,220,0.6)", textTransform: "uppercase" }}>Dev unlock code</div>
              <input
                value={unlockCode}
                onChange={(e) => setUnlockCode(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") applyUnlockCode(unlockCode); }}
                inputMode="numeric"
                autoFocus
                style={{
                  fontFamily: "'Courier New',monospace", fontSize: 16, letterSpacing: "4px",
                  padding: "10px 12px", borderRadius: 4,
                  background: "rgba(8,2,20,0.85)",
                  border: "1px solid rgba(231,174,255,0.5)",
                  color: "rgba(255,235,205,0.98)", outline: "none", textAlign: "center",
                }}
                placeholder="••••"
              />
              <button
                onClick={() => applyUnlockCode(unlockCode)}
                style={{
                  fontFamily: "'Courier New',monospace", fontSize: 11, letterSpacing: "2px",
                  padding: "8px 12px", borderRadius: 4, cursor: "pointer",
                  background: "rgba(231,174,255,0.12)",
                  border: "1px solid rgba(231,174,255,0.5)",
                  color: "rgba(231,210,255,0.95)",
                }}
              >APPLY</button>
            </div>
          )}

          <div
            onClick={onVersionTap}
            style={{
              marginTop: 28, fontSize: 9, letterSpacing: "1.4px",
              color: "rgba(200,180,220,0.45)", cursor: "pointer", userSelect: "none",
            }}
            title="tap 5 times for dev unlock"
          >GPS v{APP_VERSION}</div>
        </div>
      )}

      {/* ── Processing overlay (GIF/video encode + save) */}
      {processingStatus && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 9998,
          background: "rgba(3,5,16,0.78)",
          backdropFilter: "blur(4px)",
          display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center",
          fontFamily: "var(--font-nunito,'Nunito',sans-serif)",
          color: "#F4F6FF", letterSpacing: "1.2px",
          pointerEvents: "all",
        }}>
          <style>{`@keyframes gpsBufBar{0%{transform:translateX(-100%)}100%{transform:translateX(100%)}}`}</style>
          <div style={{
            fontWeight: 800, fontSize: 14, textTransform: "uppercase",
            color: "#6F7DFF", textShadow: "0 0 12px rgba(26,28,242,0.6)",
            marginBottom: 14,
          }}>{processingStatus.label}</div>
          <div style={{
            width: "min(70vw, 320px)", height: 8, borderRadius: 6,
            background: "rgba(111,125,255,0.15)",
            border: "1px solid rgba(111,125,255,0.4)",
            overflow: "hidden", position: "relative",
            boxShadow: "0 0 14px rgba(26,28,242,0.35)",
          }}>
            {typeof processingStatus.pct === "number" ? (
              <div style={{
                width: `${Math.max(0, Math.min(100, processingStatus.pct))}%`,
                height: "100%",
                background: "linear-gradient(90deg, #1A1CF2 0%, #6F7DFF 50%, #FF8500 100%)",
                transition: "width 200ms ease",
              }}/>
            ) : (
              <div style={{
                position: "absolute", top: 0, bottom: 0, width: "40%",
                background: "linear-gradient(90deg, transparent 0%, #6F7DFF 50%, transparent 100%)",
                animation: "gpsBufBar 1.1s linear infinite",
              }}/>
            )}
          </div>
          <div style={{
            marginTop: 10, fontSize: 10, color: "rgba(244,246,255,0.55)",
            letterSpacing: "2px",
          }}>GPS • don’t close the app</div>
        </div>
      )}

      {/* ── Saved-to-phone toast (no share sheet — file is already on disk) */}
      {savedToast && (
        <div style={{
          position: "fixed", top: 80, left: "50%", transform: "translateX(-50%)",
          zIndex: 9999,
          padding: "10px 18px",
          borderRadius: 10,
          background: "linear-gradient(180deg, rgba(14,26,62,0.96) 0%, rgba(10,20,48,0.96) 100%)",
          border: "1px solid rgba(111,125,255,0.7)",
          boxShadow: "0 6px 24px rgba(26,28,242,0.45), inset 0 1px 0 rgba(255,255,255,0.18)",
          color: "#F4F6FF",
          fontFamily: "var(--font-nunito,'Nunito',sans-serif)",
          fontWeight: 700,
          fontSize: 12,
          letterSpacing: "1.2px",
          textTransform: "uppercase",
          textAlign: "center",
          maxWidth: "min(86vw, 380px)",
          pointerEvents: "none",
        }}>
          <div style={{ color: "#6F7DFF", marginBottom: 3 }}>✓ Saved to phone</div>
          <div style={{ fontSize: 10, opacity: 0.78, letterSpacing: "0.8px", textTransform: "none", wordBreak: "break-all" }}>
            {savedToast.path}
          </div>
        </div>
      )}

      {/* Hidden video */}
      <video ref={videoRef} style={{ display: "none" }} playsInline muted autoPlay/>
      <input ref={projectFileInputRef} type="file" accept=".gps,.spectra,application/json" style={{ display: "none" }}
        onChange={e => { const f = e.target.files?.[0]; if (f) { loadProject(f); } e.target.value = ""; }}/>

      {/* ── Top bar (GPS — slim, navy gradient, electric-blue accent)
           v1.2.77 — SINGLE-ROW layout: brand pill on the left, action
           icons on the right. All buttons are now icon-first (square
           hit targets) with the wordmark collapsing on narrow phones
           so everything fits without wrapping to a second line.
           v1.2.76 — hidden when uiHidden is true (immersive view). */}
      {!uiHidden && (
      <div style={{
        background: "linear-gradient(180deg, #3A0852 0%, #1A0224 100%)",
        borderBottom: "1px solid rgba(231,174,255,0.45)",
        display: "flex", flexDirection: "row",
        alignItems: "center", justifyContent: "space-between",
        padding: "4px 8px", gap: 6,
        flexShrink: 0, zIndex: 20,
        boxShadow: "0 2px 12px rgba(0,0,0,0.85), 0 0 18px rgba(176,20,240,0.22)",
      }}>
        {/* Left — brand icon only (v1.2.78: wordmark removed; single-row nav was wrapping on phones) */}
        <div style={{ display: "flex", alignItems: "center", flex: "0 0 auto" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={GPS_APP_ICON} alt="Glitch Pixel Studio" width={36} height={36} style={{
            width: 36, height: 36, borderRadius: 8, objectFit: "cover",
            boxShadow: "0 0 12px rgba(26,28,242,0.55), 0 0 4px rgba(111,125,255,0.6) inset",
          }}/>
        </div>
        {/* Right — action icons, evenly spaced, never wrap */}
        <div style={{ display: "flex", gap: 4, alignItems: "center", justifyContent: "flex-end", flex: "0 0 auto" }}>
          <button
            className="sp-btn"
            onClick={() => {
              if (cameraActive) { void flipCamera(); }
              else { void startCamera(true); }
            }}
            style={{
              ...topBtnStyle,
              width: 44, height: 36, padding: 0, fontSize: 11, borderRadius: 9, letterSpacing: "0.4px",
              opacity: 1,
              color: cameraActive ? T.ochre : undefined,
              borderColor: cameraActive ? T.amber : undefined,
              boxShadow: cameraActive ? `${T.glow}, ${T.bevel}` : topBtnStyle.boxShadow,
            }}
            title={cameraActive ? `Camera ON — tap to FLIP (now ${cameraFacing === "environment" ? "REAR" : "FRONT"})` : "Tap to START camera"}
          >{cameraActive ? (cameraFacing === "user" ? "FLIP" : "FLIP") : "CAM"}</button>
          {/* v1.2.78 — DRAW button removed (feature disabled). */}
          <button
            className="sp-btn"
            onClick={() => setAudioActive(a => !a)}
            style={{
              ...topBtnStyle,
              width: 36, height: 36, padding: 0, fontSize: 14, borderRadius: 9, letterSpacing: 0,
              color: audioActive ? T.ochre : undefined,
              borderColor: audioActive ? T.amber : undefined,
              boxShadow: audioActive ? `${T.glow}, ${T.bevel}` : topBtnStyle.boxShadow,
            }}
            title="Audio-Reactive FX"
          >{audioActive ? "🔊" : "🔈"}</button>
          <button
            className="sp-btn"
            onClick={cycleFaceFx}
            style={{
              ...topBtnStyle,
              width: 36, height: 36, padding: 0, fontSize: 14, borderRadius: 9, letterSpacing: 0,
              color: faceFxMode === "OFF" ? undefined : T.ochre,
              borderColor: faceFxMode === "OFF" ? undefined : T.amber,
              boxShadow: faceFxMode === "OFF" ? topBtnStyle.boxShadow : `${T.glow}, ${T.bevel}`,
            }}
            title={`FACE FX — ${faceFxMode} (cycle OFF / FACE-ONLY / BG-ONLY)`}
          >{faceFxMode === "OFF" ? "👤" : faceFxMode === "FACE" ? "👤" : "▣"}</button>
          <button
            className="sp-btn"
            onClick={() => setBugOpen(true)}
            style={{
              ...topBtnStyle,
              width: 36, height: 36, padding: 0, fontSize: 14, borderRadius: 9, letterSpacing: 0,
            }}
            title="Report a bug"
          >🐛</button>
          {/* v1.2.73 — HANDS-FREE always-visible top-bar tile so it
              works regardless of whether EXPORT panel is open.
              v1.2.77 — tightened to icon + tiny number so it fits in one row. */}
          <button
            className="sp-btn"
            onClick={startHandsFree}
            style={{
              ...topBtnStyle,
              width: 46, height: 36, padding: 0, fontSize: 10, borderRadius: 9, letterSpacing: "0.4px",
              color: handsFreeCountdown != null ? T.ochre : undefined,
              borderColor: handsFreeCountdown != null ? T.amber : undefined,
              boxShadow: handsFreeCountdown != null ? `${T.glow}, ${T.bevel}` : topBtnStyle.boxShadow,
              ...(handsFreeCountdown != null ? { animation: "activeGlow 1s ease-in-out infinite" } : {}),
            }}
            title="HANDS-FREE: 3-2-1 then auto-record 60s, then auto-stop"
          >{handsFreeCountdown == null
              ? `⏱${HANDS_FREE_SEC}`
              : handsFreeCountdown.phase === "in"
                ? `${handsFreeCountdown.n}…`
                : `●${handsFreeCountdown.n}`}</button>
          {/* v1.2.73 — FULLSCREEN toggle. v1.2.76 — also hides the top
              bar + controls pane (immersive viewing) and uses Capacitor
              StatusBar to actually hide the Android system chrome. */}
          <button
            className="sp-btn"
            onClick={() => {
              const doc = document as Document & {
                webkitFullscreenElement?: Element | null;
                webkitExitFullscreen?: () => Promise<void>;
              };
              const el = document.documentElement as HTMLElement & {
                webkitRequestFullscreen?: () => Promise<void>;
              };
              const isFs = !!(document.fullscreenElement || doc.webkitFullscreenElement);
              if (isFs) {
                (document.exitFullscreen?.() || doc.webkitExitFullscreen?.())?.catch(() => {});
              } else {
                (el.requestFullscreen?.() || el.webkitRequestFullscreen?.())?.catch(() => {});
              }
              setUiHidden(v => {
                const next = !v;
                if (Capacitor.isNativePlatform()) {
                  import("@capacitor/status-bar").then(({ StatusBar }) => {
                    if (next) { StatusBar.hide().catch(() => {}); StatusBar.setOverlaysWebView({ overlay: true }).catch(() => {}); }
                    else { StatusBar.show().catch(() => {}); StatusBar.setOverlaysWebView({ overlay: false }).catch(() => {}); }
                  }).catch(() => {});
                }
                return next;
              });
            }}
            style={{
              ...topBtnStyle,
              width: 36, height: 36, padding: 0, fontSize: 16, borderRadius: 9, letterSpacing: 0,
            }}
            title="Fullscreen / hide UI to view work"
          >⛶</button>
          {/* v1.3.3 — CLOSE: hard-shutdown for Android. Stops camera/audio,
              clears the WebView, then asks Capacitor App to exit so the
              process is fully torn down (next launch is a cold start). */}
          <button
            className="sp-btn"
            onClick={() => {
              try { void stopCamera?.(); } catch {}
              try { setAudioActive(false); } catch {}
              try {
                if (streamRef.current) {
                  streamRef.current.getTracks().forEach(t => { try { t.stop(); } catch {} });
                  streamRef.current = null;
                }
              } catch {}
              if (Capacitor.isNativePlatform?.()) {
                import("@capacitor/app").then(({ App }) => {
                  App.exitApp().catch(() => {});
                }).catch(() => {});
              } else {
                try { window.close(); } catch {}
              }
            }}
            style={{
              ...topBtnStyle,
              width: 36, height: 36, padding: 0, fontSize: 14, borderRadius: 9, letterSpacing: 0,
              color: TE.red, borderColor: TE.red,
            }}
            title="CLOSE — hard-shutdown the app (releases camera; cold start next launch)"
          >✕</button>
        </div>
      </div>
      )}

      {/* ── TE gradient flourish strip (OP-1 knob color language) */}
      {!uiHidden && (
      <div style={{
        height: 3, flexShrink: 0,
        background: `linear-gradient(90deg, ${TE.blue} 0%, ${TE.green} 30%, ${TE.amber} 58%, ${TE.lilac} 78%, ${TE.red} 100%)`,
        opacity: 0.72,
      }}/>
      )}

      {/* ── Body: camera top, settings bottom (mobile); side-by-side (lg).
           v1.2.76 — also goes side-by-side on phones in landscape
           orientation so anamorphic shots get a real wide canvas. */}
      <div
        className="sp-body flex-1 min-h-0 flex overflow-hidden"
        style={{ flexDirection: isLandscape ? "row" : "column" }}
      >

        {/* Camera viewport — top half on mobile, left pane on desktop.
            When an accordion panel is open we shrink this pane so the
            open panel can occupy more vertical real estate. Other
            (collapsed) panels stay visible as headers. */}
        <div
          className="sp-canvas-pane relative bg-black overflow-hidden flex items-center justify-center"
          style={isLandscape
            ? { flex: "1 1 0", height: "100%", minWidth: 0, minHeight: 0 }
            : { flex: "none", height: openPanelTitle ? "26dvh" : "45dvh", transition: "height 220ms ease" }}
        >
          <div style={isLandscape
            ? { position: "relative", width: "100%", height: "100%" }
            : { position: "relative", aspectRatio: "1 / 1", height: "100%", maxHeight: "100%", maxWidth: "100%" }}
          >
            {/* Scanlines overlay */}
            <div style={{
              position: "absolute", inset: 0, zIndex: 2, pointerEvents: "none",
              backgroundImage: "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(176,20,240,0.018) 2px, rgba(176,20,240,0.018) 3px)",
            }}/>
            <div style={{ position: "absolute", inset: 10, border: "1px solid rgba(176,20,240,0.26)", zIndex: 2, pointerEvents: "none" }}/>

            <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block" }} />

            <button
              className={"sp-btn sp-photo-btn" + (neonMode ? " sp-photo-btn-neon" : "")}
              onPointerDown={(e) => {
                e.preventDefault();
                holdFiredRef.current = false;
                if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
                holdTimerRef.current = setTimeout(() => {
                  holdFiredRef.current = true;
                  startRecordingRef.current();
                }, 350);
              }}
              onPointerUp={(e) => {
                e.preventDefault();
                if (holdTimerRef.current) { clearTimeout(holdTimerRef.current); holdTimerRef.current = null; }
                if (holdFiredRef.current) {
                  // Hold released — stop the recording (gif/video).
                  stopRecordingRef.current();
                } else {
                  // Quick tap — still photo.
                  captureStill();
                }
              }}
              onPointerLeave={() => {
                if (holdTimerRef.current) { clearTimeout(holdTimerRef.current); holdTimerRef.current = null; }
                if (holdFiredRef.current) { stopRecordingRef.current(); holdFiredRef.current = false; }
              }}
              style={{
                ...topBtnStyle,
                position: "absolute",
                right: 10,
                bottom: 10,
                zIndex: 6,
                width: 66,
                height: 40,
                fontSize: 11,
                borderRadius: 10,
                letterSpacing: "0.8px",
                background: recording ? "rgba(224,61,61,0.85)" : (topBtnStyle.background as string | undefined),
                borderColor: recording ? "#E03D3D" : (topBtnStyle.borderColor as string | undefined),
                boxShadow: recording ? "0 0 18px rgba(224,61,61,0.85)" : topBtnStyle.boxShadow,
              }}
              title="Tap = photo · Hold = record GIF/video (release to stop)"
            >{recording ? "REC●" : "PHOTO"}</button>
            {/* v1.2.76 — inline hint so users discover the press-and-hold
                gesture without reading docs. Sits under the PHOTO button,
                fades when actively recording so it doesn't fight the REC pip. */}
            <div style={{
              position: "absolute", right: 10, bottom: 54, zIndex: 6,
              width: 66, textAlign: "center",
              fontFamily: "'Courier New',monospace",
              fontSize: 7.5, letterSpacing: "1px",
              color: "rgba(231,174,255,0.78)",
              textShadow: "0 0 4px rgba(0,0,0,0.85)",
              pointerEvents: "none",
              opacity: recording ? 0.0 : 0.92,
              transition: "opacity 180ms ease",
            }}>TAP · HOLD=REC</div>
            {/* v1.2.76 — floating eye toggle, always over the canvas, so
                even when the chrome is hidden the user can bring it back. */}
            <button
              onClick={() => {
                setUiHidden(v => {
                  const next = !v;
                  if (Capacitor.isNativePlatform()) {
                    import("@capacitor/status-bar").then(({ StatusBar }) => {
                      if (next) { StatusBar.hide().catch(() => {}); StatusBar.setOverlaysWebView({ overlay: true }).catch(() => {}); }
                      else { StatusBar.show().catch(() => {}); StatusBar.setOverlaysWebView({ overlay: false }).catch(() => {}); }
                    }).catch(() => {});
                  }
                  return next;
                });
              }}
              style={{
                /* v1.2.78 — bottom-left was getting buried under the
                   bottom toolbar / safe-area inset. Pin to fixed top-
                   right of the viewport with a very high zIndex so it
                   floats above EVERYTHING (nav, panels, recorder UI). */
                position: "fixed", right: 10, top: 56, zIndex: 9999,
                width: 44, height: 44, borderRadius: 10,
                background: uiHidden ? "rgba(231,174,255,0.32)" : "rgba(10,2,36,0.78)",
                border: "1px solid rgba(231,174,255,0.65)",
                color: "#F4F6FF", fontSize: 18,
                cursor: "pointer",
                boxShadow: "0 0 12px rgba(0,0,0,0.85)",
              }}
              title={uiHidden ? "Show UI" : "Hide UI · view canvas only"}
            >{uiHidden ? "▲" : "▽"}</button>


            <canvas
              ref={drawCanvasRef}
              style={{
                position: "absolute", inset: 0, width: "100%", height: "100%",
                cursor: drawActive && drawAvailable ? "crosshair" : "default", zIndex: 3,
                touchAction: "none",
                opacity: drawActive && drawAvailable ? 0.32 : 0,
                mixBlendMode: "screen",
                transition: "opacity 140ms ease",
              }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerLeave={onPointerUp}
            />
            {/* Hidden mask canvas for FX mask */}
            <canvas ref={maskCanvasRef} style={{ display: "none" }} width={256} height={256} />

            {/* v1.2.73 — PIXEL DRAWER overlay removed (the rack itself
                was also removed from the synth view). The pxCanvasRef is
                still allocated below as a hidden 1x1 stub so any code
                paths that touch it are no-ops. */}
            <canvas ref={pxCanvasRef} style={{ display: "none" }} width={1} height={1} />

            {/* ── Floating DRAW toolbar (Glitch! style) — only over static image uploads */}
            {drawActive && drawAvailable && (
              <div
                style={{
                  position: "absolute", left: 10, top: 10, zIndex: 7,
                  display: "flex", flexDirection: "column", gap: 6,
                  padding: "8px 10px",
                  background: "linear-gradient(180deg, rgba(14,26,62,0.92) 0%, rgba(10,20,48,0.88) 100%)",
                  border: "1px solid rgba(255,133,0,0.55)",
                  borderRadius: 8,
                  boxShadow: "0 0 14px rgba(255,133,0,0.35), inset 0 0 6px rgba(0,0,0,0.6)",
                  fontFamily: "'Courier New',monospace",
                  color: "#F4F6FF",
                  minWidth: 138, maxWidth: 170,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: 10, letterSpacing: "2px", color: "#FF8500" }}>✎ DRAW FX</span>
                  <button
                    onClick={() => setDrawActive(false)}
                    title="Close draw mode"
                    style={{
                      background: "transparent", border: "1px solid rgba(244,246,255,0.35)",
                      color: "#F4F6FF", fontSize: 9, padding: "1px 6px", borderRadius: 3,
                      cursor: "pointer", letterSpacing: "1px",
                    }}
                  >✕</button>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 8, letterSpacing: "1.4px", color: "rgba(244,246,255,0.6)", width: 28 }}>SIZE</span>
                  <input
                    type="range" min={3} max={80} step={1} value={brushSize}
                    onChange={e => setBrushSize(parseInt(e.target.value, 10))}
                    style={{ flex: 1, accentColor: "#FF8500" }}
                  />
                  <span style={{ fontSize: 9, color: "#FF8500", width: 18, textAlign: "right" }}>{brushSize}</span>
                </div>
                <div style={{ display: "flex", gap: 4 }}>
                  {(["round","wide","spray","neon"] as const).map(b => (
                    <button
                      key={b}
                      onClick={() => setBrushType(b)}
                      title={`Brush: ${b}`}
                      style={{
                        flex: 1, fontSize: 8, letterSpacing: "1px", padding: "3px 0",
                        background: brushType === b ? "rgba(255,133,0,0.22)" : "transparent",
                        border: `1px solid ${brushType === b ? "#FF8500" : "rgba(244,246,255,0.25)"}`,
                        color: brushType === b ? "#FF8500" : "rgba(244,246,255,0.85)",
                        cursor: "pointer", borderRadius: 3, textTransform: "uppercase",
                      }}
                    >{b}</button>
                  ))}
                </div>
                <div style={{ display: "flex", gap: 4 }}>
                  <button
                    onClick={undoStroke}
                    disabled={strokes.length === 0}
                    title="Undo last stroke"
                    style={{
                      flex: 1, fontSize: 9, letterSpacing: "1px", padding: "4px 0",
                      background: "transparent",
                      border: "1px solid rgba(111,125,255,0.5)",
                      color: strokes.length === 0 ? "rgba(244,246,255,0.3)" : "#6F7DFF",
                      cursor: strokes.length === 0 ? "not-allowed" : "pointer",
                      borderRadius: 3,
                    }}
                  >↶ UNDO</button>
                  <button
                    onClick={clearStrokes}
                    disabled={strokes.length === 0}
                    title="Clear all strokes"
                    style={{
                      flex: 1, fontSize: 9, letterSpacing: "1px", padding: "4px 0",
                      background: "transparent",
                      border: "1px solid rgba(255,77,77,0.55)",
                      color: strokes.length === 0 ? "rgba(244,246,255,0.3)" : "#FF4D4D",
                      cursor: strokes.length === 0 ? "not-allowed" : "pointer",
                      borderRadius: 3,
                    }}
                  >✕ CLEAR</button>
                </div>
                <div style={{ fontSize: 8, lineHeight: 1.35, letterSpacing: "0.6px", color: "rgba(244,246,255,0.55)", marginTop: 2 }}>
                  Paint where the glitch FX appear. Untouched areas stay clean cam.
                </div>
              </div>
            )}

            {/* DRAW crash banner — surfaces the actual error instead of a white screen */}
            {drawCrash && (
              <div style={{
                position: "absolute", top: 12, right: 12, zIndex: 50, maxWidth: 320,
                background: "rgba(36,8,8,0.94)", border: "1px solid #FF4D4D",
                borderRadius: 8, padding: "8px 10px", color: "#FFD0D0",
                fontFamily: "'Courier New',monospace", fontSize: 10, lineHeight: 1.4,
                boxShadow: "0 0 14px rgba(255,77,77,0.45)",
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                  <span style={{ fontWeight: 700, letterSpacing: 1.4, color: "#FF4D4D" }}>DRAW DISABLED</span>
                  <button
                    onClick={() => setDrawCrash(null)}
                    style={{ background: "transparent", border: "1px solid rgba(255,208,208,0.5)", color: "#FFD0D0", fontSize: 9, padding: "1px 6px", borderRadius: 3, cursor: "pointer" }}
                  >✕</button>
                </div>
                <div style={{ wordBreak: "break-word" }}>{drawCrash}</div>
                <div style={{ marginTop: 4, fontSize: 9, color: "rgba(255,208,208,0.7)" }}>
                  Rest of app is fine. Re-enable DRAW from the top bar to retry.
                </div>
              </div>
            )}

            {/* Flash feedback on capture */}
            {flashVisible && <div style={{ position: "absolute", inset: 0, background: "white", opacity: 0.6, zIndex: 10, pointerEvents: "none" }}/>}

            {/* HUD */}
            <div style={{ position: "absolute", top: 12, left: 12, zIndex: 4, pointerEvents: "none" }}>
              <div style={{ fontSize: 13, letterSpacing: "2px", color: "rgba(231,174,255,0.98)", textShadow: "0 0 12px rgba(176,20,240,0.7)", textTransform: "uppercase" }}>
                {modeLabel}
              </div>
              <div style={{ fontSize: 10, letterSpacing: "0.8px", color: "rgba(243,238,255,0.86)", marginTop: 2 }}>{fps} fps</div>
              <div style={{ fontSize: 9, letterSpacing: "1px", color: camStatusColor, marginTop: 2, display: "flex", alignItems: "center", gap: 3 }}>
                <span style={{ display: "inline-block", width: 5, height: 5, borderRadius: "50%", background: camStatusColor, flexShrink: 0 }}/>
                {camStatus.toUpperCase()}
              </div>
              {recording && <div style={{ fontSize: 11, letterSpacing: "1px", color: "#E86040", marginTop: 4, animation: "blink 0.8s infinite" }}>● RECORDING</div>}
              {recordingHint && (
                <div style={{
                  marginTop: 5,
                  fontSize: 10,
                  letterSpacing: "0.6px",
                  color: "rgba(240,222,180,0.92)",
                  background: "rgba(12,9,5,0.58)",
                  border: "1px solid rgba(176,20,240,0.42)",
                  borderRadius: 6,
                  padding: "3px 6px",
                  display: "inline-block",
                }}>
                  {recordingHint}
                </div>
              )}
            </div>

            {cameraRequesting && !cameraActive && !sourceError && (
              <div style={{
                position: "absolute", bottom: 12, left: "50%", transform: "translateX(-50%)",
                background: "rgba(80,50,10,0.12)", border: "1px solid rgba(232,160,32,0.3)",
                borderRadius: 10, padding: "6px 14px", fontSize: 11, letterSpacing: "1px",
                color: "#E8A020", zIndex: 5, maxWidth: "85%", textAlign: "center",
                pointerEvents: "none",
              }}>
                Allow camera access in your browser
              </div>
            )}
            {sourceError && (
              <div style={{
                position: "absolute", bottom: 12, left: "50%", transform: "translateX(-50%)",
                background: "rgba(192,90,42,0.15)", border: "1px solid rgba(192,90,42,0.4)",
                borderRadius: 10, padding: "6px 14px", fontSize: 11, letterSpacing: "1px",
                color: "#E86040", zIndex: 5, maxWidth: "85%", textAlign: "center",
              }}>
                {sourceError}
                <button onClick={() => { setSourceError(null); void startCamera(); }}
                  style={{ marginLeft: 8, color: "#E86040", background: "none", border: "none", cursor: "pointer", textDecoration: "underline", fontSize: 10 }}>
                  retry
                </button>
                <button onClick={() => { void hardResetCamera(); }}
                  style={{ marginLeft: 8, color: "#E86040", background: "none", border: "none", cursor: "pointer", textDecoration: "underline", fontSize: 10 }}>
                  hard reset
                </button>
              </div>
            )}
            {!recording && (
              <div style={{
                position: "absolute", bottom: 12, left: 12, zIndex: 4,
                background: "rgba(18,0,31,0.52)", border: "1px solid rgba(176,20,240,0.32)", borderRadius: 8,
                padding: "5px 8px", fontSize: 10, letterSpacing: "0.5px", color: "rgba(243,238,255,0.9)",
              }}>
                Hold screen to record {exportFormat.toUpperCase()}
              </div>
            )}
            {shaderError && (
              <div style={{
                position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)",
                background: "rgba(192,90,42,0.15)", border: "1px solid rgba(192,90,42,0.4)",
                borderRadius: 10, padding: "10px 16px", fontSize: 10, letterSpacing: "1px",
                color: "#E86040", zIndex: 5, maxWidth: "90%", textAlign: "center",
              }}>
                ⚠ {shaderError}
              </div>
            )}
          </div>
        </div>

        {/* Settings panel — bottom half on mobile (scrollable), right pane on desktop */}
        <div
          ref={panelRef}
          className={"sp-panel-glass flex-1 min-h-0 overflow-y-auto lg:w-[23rem] lg:flex-none" + (neonMode && openPanelTitle ? " glass-expanded" : "")}
          style={isLandscape
            ? { background: "linear-gradient(180deg,#0F001C 0%,#080012 100%)", borderTop: `1px solid rgba(61,10,92,0.9)`, position: "relative", flex: "0 0 17rem", width: "17rem", height: "100%" }
            : { background: "linear-gradient(180deg,#0F001C 0%,#080012 100%)", borderTop: `1px solid rgba(61,10,92,0.9)`, position: "relative" }}
          onPointerDown={(e) => {
            // v1.2.69 — ONLY arm the pull-to-reload gesture when the pointer
            // landed on the panel's own scroll surface, NOT on a child like a
            // knob, button, switch, or selector. Previously a downward knob
            // drag at scrollTop=0 would arm the gesture and reload the WebView
            // — which on Android Capacitor looked exactly like a hard crash
            // (camera/WebGL torn down, splash flash, knob settings reset). This
            // single guard fixes the user-reported "REALSORT crash", "datamosh
            // does nothing" (every test turn-down reloaded the app), and the
            // generic "any knob nulling out resets the app" bug.
            if (e.target !== e.currentTarget) return;
            if (!panelRef.current || panelRef.current.scrollTop > 0) return;
            pullStartYRef.current = e.clientY;
          }}
          onPointerMove={(e) => {
            if (pullStartYRef.current == null) return;
            if (!panelRef.current || panelRef.current.scrollTop > 0) return;
            const d = Math.max(0, Math.min(120, e.clientY - pullStartYRef.current));
            setPullDistance(d);
            setPullArmed(d > 82);
          }}
          onPointerUp={() => {
            const armed = pullArmed;
            pullStartYRef.current = null;
            setPullDistance(0);
            setPullArmed(false);
            if (armed) window.location.reload();
          }}
          onPointerCancel={() => {
            pullStartYRef.current = null;
            setPullDistance(0);
            setPullArmed(false);
          }}
        >
          {(neonMode ? (children: React.ReactNode) => (
            <SynthPanelAccordionContext.Provider value={accordionCtx}>{children}</SynthPanelAccordionContext.Provider>
          ) : (children: React.ReactNode) => <>{children}</>)(<>
          <div style={{
            height: pullDistance,
            opacity: pullDistance > 0 ? 1 : 0,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 10, letterSpacing: "1.2px", color: pullArmed ? "rgba(240,222,180,0.98)" : "rgba(232,160,32,0.78)",
            transition: "height 0.08s ease",
          }}>{pullArmed ? "RELEASE TO RELOAD" : "PULL DOWN TO QUICK RESET"}</div>

          {/* Hidden file input — used by SOURCE panel "LOAD MEDIA" */}
          <input
            ref={sourceFileInputRef}
            type="file"
            accept="image/*,video/*,image/gif"
            style={{ display: "none" }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleUploadFile(f);
              e.currentTarget.value = "";
            }}
          />

          <Section title="VISION MODE LAB" id="modes" open={openSections.has("modes")} onToggle={toggleSection}>

            {/* ── INPUT ───────────────────────────────────────────────
                v1.3.4 — split the old 4-way SOURCE picker into two
                INDEPENDENT rows so each button does ONE thing:
                  BASE: CAM | UPLD  → which feed underlies everything
                  GEN OVERLAY: OFF | FULL | SUBJECT | BG → where the
                    procedural generator paints (off = base only,
                    full = generator only, subject = on the person,
                    bg = on the background behind the person).
                The internal sourceMode/faceFxMode plumbing is
                unchanged; this UI just stops partitioning GEN as a
                separate "source" (which was the source of all the
                wonky button interactions). */}
            <SynthPanel
              title="INPUT"
              subtitle={(() => {
                const baseLbl = sourceMode === "upload" ? "UPLD" : "CAM";
                const genLbl =
                  sourceMode === "generator"
                    ? (cameraActive
                        ? (faceFxMode === "FACE" ? "GEN/SUBJECT" : faceFxMode === "BG" ? "GEN/BG" : "GEN+CAM")
                        : "GEN/FULL")
                    : "GEN OFF";
                return `${baseLbl} · ${genLbl}`;
              })()}
              accent="rgba(255,210,140,0.85)"
            >
              {/* Row 1 — BASE FEED */}
              <div style={{ fontSize: 8, letterSpacing: "1.4px", color: "rgba(255,210,140,0.7)", marginBottom: 4 }}>BASE</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 6, marginBottom: 8 }}>
                {(["camera","upload"] as const).map((sm) => {
                  const lbl = sm === "camera" ? "CAM" : "UPLD";
                  // Active = the renderer is actually consuming this feed.
                  // CAM is "active" whenever the camera is live (covers
                  // both pure CAM and any GEN-overlay-on-camera combo).
                  const active = sm === "camera" ? cameraActive : sourceMode === "upload";
                  return (
                    <button
                      key={sm}
                      onClick={() => {
                        if (sm === "camera") {
                          // Tap CAM:
                          //  - If currently UPLD: switch to plain CAM.
                          //  - If currently CAM (no GEN): toggle camera off.
                          //  - If GEN+CAM combo: turn the camera off but
                          //    leave generator running (GEN→FULL).
                          clearUploadSource();
                          if (sourceMode === "upload") {
                            setSourceMode("camera");
                            if (!cameraActive) void startCamera();
                          } else if (sourceMode === "camera") {
                            if (cameraActive) { stopCamera(); }
                            else { void startCamera(); }
                          } else {
                            // sourceMode === "generator"
                            if (cameraActive) {
                              stopCamera();
                            } else {
                              void startCamera();
                            }
                          }
                        } else {
                          // UPLD: open file picker; on pick, the file
                          // handler sets sourceMode="upload" and clears
                          // GEN. Don't pre-flip state in case user cancels.
                          sourceFileInputRef.current?.click();
                        }
                      }}
                      style={{
                        padding: "11px 4px",
                        fontSize: 11, letterSpacing: "1.4px", fontWeight: 700,
                        fontFamily: "'Trebuchet MS',sans-serif",
                        cursor: "pointer",
                        borderRadius: 5,
                        border: active ? "1px solid rgba(208,58,58,0.85)" : "1px solid rgba(0,0,0,0.72)",
                        color: active ? "rgba(255,168,150,1)" : "rgba(195,190,200,0.72)",
                        textShadow: active ? "0 0 8px rgba(255,84,84,0.7)" : "none",
                        background: active
                          ? "linear-gradient(180deg, #5A0E16 0%, #2A060A 100%)"
                          : "linear-gradient(180deg, #3A3A3E 0%, #1A1A1E 48%, #101014 100%)",
                        boxShadow: active
                          ? "inset 0 1px 1px rgba(255,220,220,0.18), inset 0 -2px 4px rgba(0,0,0,0.74), 0 0 10px rgba(255,62,62,0.45)"
                          : "inset 0 1px 1px rgba(255,255,255,0.08), inset 0 -2px 4px rgba(0,0,0,0.72)",
                      }}
                    >{lbl}</button>
                  );
                })}
              </div>

              {/* Row 2 — GEN OVERLAY (where the generator paints) */}
              <div style={{ fontSize: 8, letterSpacing: "1.4px", color: "rgba(255,210,140,0.7)", marginBottom: 4 }}>GEN OVERLAY</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 6, marginBottom: 8 }}>
                {(["off","full","subject","bg"] as const).map((g) => {
                  const lbl = g === "off" ? "OFF" : g === "full" ? "FULL" : g === "subject" ? "SUBJ" : "BG";
                  const active =
                    g === "off"     ? sourceMode !== "generator" :
                    g === "full"    ? (sourceMode === "generator" && !cameraActive) :
                    g === "subject" ? (sourceMode === "generator" && cameraActive && faceFxMode === "FACE") :
                                      (sourceMode === "generator" && cameraActive && faceFxMode === "BG");
                  return (
                    <button
                      key={g}
                      onClick={() => {
                        if (g === "off") {
                          // Drop back to plain BASE (camera or upload).
                          // Don't kill the camera unless face FX was also
                          // off — preserves the FACE-FX-on-camera path.
                          if (uploadName && sourceMode === "upload") {
                            setSourceMode("upload");
                          } else {
                            setSourceMode("camera");
                            if (!cameraActive) void startCamera();
                          }
                        } else if (g === "full") {
                          // Pure generator — stop camera if face FX is OFF
                          // (the segmenter doesn't need it). If FX is armed
                          // we keep the camera so the mask still has frames.
                          clearUploadSource();
                          setSourceMode("generator");
                          if (cameraActive && faceFxModeRef.current === "OFF") stopCamera();
                        } else if (g === "subject") {
                          // GEN painted on the person; real-world BG behind.
                          clearUploadSource();
                          setSourceMode("generator");
                          setFaceFxMode("FACE");
                          if (!cameraActive) void startCamera();
                        } else {
                          // GEN as the background; clean person on top.
                          clearUploadSource();
                          setSourceMode("generator");
                          setFaceFxMode("BG");
                          if (!cameraActive) void startCamera();
                        }
                      }}
                      style={{
                        padding: "11px 4px",
                        fontSize: 10, letterSpacing: "1.2px", fontWeight: 700,
                        fontFamily: "'Trebuchet MS',sans-serif",
                        cursor: "pointer",
                        borderRadius: 5,
                        border: active ? "1px solid rgba(199,101,255,0.9)" : "1px solid rgba(0,0,0,0.72)",
                        color: active ? "rgba(245,210,255,1)" : "rgba(195,190,200,0.72)",
                        textShadow: active ? "0 0 8px rgba(199,101,255,0.7)" : "none",
                        background: active
                          ? "linear-gradient(180deg, #3A0852 0%, #1A0224 100%)"
                          : "linear-gradient(180deg, #3A3A3E 0%, #1A1A1E 48%, #101014 100%)",
                        boxShadow: active
                          ? "inset 0 1px 1px rgba(255,220,255,0.18), inset 0 -2px 4px rgba(0,0,0,0.74), 0 0 10px rgba(199,101,255,0.4)"
                          : "inset 0 1px 1px rgba(255,255,255,0.08), inset 0 -2px 4px rgba(0,0,0,0.72)",
                      }}
                    >{lbl}</button>
                  );
                })}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 6, alignItems: "center" }}>
                <div style={{
                  fontSize: 9, fontFamily: "'Courier New',monospace",
                  letterSpacing: "0.8px",
                  color: "rgba(255,210,140,0.85)",
                  background: "linear-gradient(180deg, #0A0312 0%, #160726 100%)",
                  border: "1px solid rgba(0,0,0,0.6)",
                  padding: "6px 8px", borderRadius: 4,
                  boxShadow: "inset 0 1px 2px rgba(0,0,0,0.7)",
                  textShadow: "0 0 5px rgba(232,160,32,0.55)",
                  whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                }}>
                  {(() => {
                    const fxTag = comboMode ? " · PXL+MOSH" : mode === 7 ? " · PXL" : mode === 9 ? " · MOSH" : "";
                    if (sourceMode === "upload") return uploadName ? `▣ ${uploadKind === "video" ? "VID" : "IMG"} · ${uploadName}${fxTag}` : "▣ NO MEDIA LOADED";
                    if (sourceMode === "camera") return cameraActive ? `▣ CAMERA LIVE${fxTag}` : "▣ CAMERA OFFLINE";
                    return cameraActive ? `▣ GEN+CAM · ${genStyle}${fxTag}` : `▣ GEN · ${genStyle}${fxTag}`;
                  })()}
                </div>
                <button
                  onClick={() => sourceFileInputRef.current?.click()}
                  style={{
                    padding: "6px 10px", fontSize: 9, letterSpacing: "1.2px",
                    fontFamily: "'Courier New',monospace", fontWeight: 700,
                    cursor: "pointer", borderRadius: 5,
                    border: "1px solid rgba(0,0,0,0.7)",
                    color: "rgba(255,210,140,0.95)",
                    background: "linear-gradient(180deg, #3A0852 0%, #1A0224 100%)",
                    boxShadow: "inset 0 1px 1px rgba(255,255,255,0.12), inset 0 -2px 3px rgba(0,0,0,0.7)",
                    textShadow: "0 0 5px rgba(232,160,32,0.55)",
                  }}
                >LOAD…</button>
              </div>
                <div style={{ display: "flex", justifyContent: "center", marginTop: 8 }}>
                  <button
                    onClick={() => { void resetSettings(); }}
                    style={{
                      padding: "7px 12px", fontSize: 9, letterSpacing: "1.3px",
                      fontFamily: "'Courier New',monospace", fontWeight: 700,
                      cursor: "pointer", borderRadius: 5,
                      border: "1px solid rgba(0,0,0,0.72)",
                      color: "rgba(255,210,140,0.98)",
                      background: "linear-gradient(180deg, #4B1228 0%, #250915 100%)",
                      boxShadow: "inset 0 1px 1px rgba(255,255,255,0.12), inset 0 -2px 3px rgba(0,0,0,0.72)",
                      textShadow: "0 0 5px rgba(232,160,32,0.55)",
                    }}
                    title="Reset to normal view and clear triggers"
                  >RESET SETTINGS</button>
                </div>
            </SynthPanel>

            {/* ── PIXEL SORT RACK ───────────────────────────────────── */}
            <SynthPanel title="PIXEL SORT" subtitle="REALSORT MASTER · 9 CTRL" accent="rgba(174,255,231,0.95)">
              {/* v1.2.64 — REALSORT is the master amount for the entire rack.
                  AMOUNT and the other knobs scale within its envelope, so
                  REALSORT=0 fully bypasses everything and REALSORT=1
                  unleashes the true CPU Asendorf sort + the shader sort
                  combo at full strength. Lives on its own row at the top
                  so it reads as the headline control. */}
              <div style={{ display: "flex", justifyContent: "center", marginBottom: 10 }}>
                <Knob label="REALSORT" value={sortMix}     min={0} max={1}    step={0.01} defaultValue={0.0}  onChange={setSortMix}/>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 8, justifyItems: "center" }}>
                <Knob label="AMOUNT"  value={sortAmt}      min={0} max={1}    step={0.01} defaultValue={0.5}  onChange={setSortAmt}/>
                <Knob label="LOW"     value={sortLow}      min={0} max={1}    step={0.01} defaultValue={0.0}  onChange={setSortLow}/>
                <Knob label="HIGH"    value={sortHigh}     min={0} max={1}    step={0.01} defaultValue={1.0}  onChange={setSortHigh}/>
                <Knob label="SEGMENT" value={sortSegment}  min={0} max={1}    step={0.01} defaultValue={0.5}  onChange={setSortSegment}/>
                <Knob label="NOISE"   value={sortRandom}   min={0} max={1}    step={0.01} defaultValue={0.2}  onChange={setSortRandom}/>
                <Knob label="WOBBLE"  value={sortWobble}   min={0} max={1}    step={0.01} defaultValue={0.0}  onChange={setSortWobble}/>
                <Knob label="TEAR"    value={scanTear}     min={0} max={1}    step={0.01} defaultValue={0.0}  onChange={setScanTear}/>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 8, justifyItems: "center" }}>
                <SynthSelector label="MODE" options={["LINE","SPIRAL","BLOCK","SLICE","HILBERT"]} value={Math.round(sortMode)} onChange={(v) => setSortMode(v)}/>
                <SynthSelector label="INTERVAL" options={["BAND","BRIGHT","DARK","RAND","WAVE","EDGE","NONE"]} value={Math.round(sortInterval)} onChange={(v) => setSortInterval(v)}/>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 8, marginTop: 8, justifyItems: "center" }}>
                <SynthSelector label="ANGLE" options={["HORZ","VERT","DIAG↗","DIAG↘"]} value={Math.round(sortAngle)} onChange={(v) => setSortAngle(v)}/>
              </div>
              <div style={{ display: "flex", justifyContent: "center", marginTop: 10 }}>
                <button
                  className="sp-btn"
                  onClick={() => {
                    setSortAmt(0.5); setSortLow(0.0); setSortHigh(1.0); setSortSegment(0.5);
                    setSortRandom(0.2); setSortWobble(0.0); setScanTear(0.0);
                    setSortMode(0); setSortInterval(0); setSortAngle(0);
                    setSortMix(0.0);
                  }}
                  style={{ fontSize: 9, padding: "6px 12px", letterSpacing: "1.4px", color: "rgba(255,140,140,0.95)" }}
                  title="Reset every PIXEL SORT control to default"
                >HARD RESET</button>
              </div>
            </SynthPanel>

            {/* v1.2.73 — RGBNDR + PIXEL DRAWER racks removed per user
                request: cluttered the synth view, rarely yielded
                meaningful results in field testing. Underlying state +
                shader uniforms remain so saved presets still load. */}

            {/* ── DATAMOSH RACK ─────────────────────────────────────────── */}
            <SynthPanel title="DATAMOSH" subtitle="MOSH · 12 CTRL" accent="rgba(231,174,255,0.95)">
              <div style={{ display: "grid", gridTemplateColumns: "repeat(5,minmax(0,1fr))", gap: 8, justifyItems: "center" }}>
                <Knob label="INTENS"   value={datamosh}     min={0} max={2}  step={0.01} defaultValue={0.0}  onChange={setDatamosh}/>
                <Knob label="I-FRAME"  value={moshIFrame}   min={0} max={1}  step={0.01} defaultValue={0.0}  onChange={setMoshIFrame}/>
                <Knob label="MOTION"   value={moshMotion}   min={0} max={1}  step={0.01} defaultValue={0.0}  onChange={setMoshMotion}/>
                <Knob label="BLEED"    value={moshBleed}    min={0} max={1}  step={0.01} defaultValue={0.0}  onChange={setMoshBleed}/>
                <Knob label="MAP"      value={moshMap}      min={0} max={1}  step={0.01} defaultValue={0.0}  onChange={setMoshMap}/>
                <Knob label="COMPRES"  value={moshDistort}  min={0} max={1}  step={0.01} defaultValue={0.0}  onChange={setMoshDistort}/>
                <Knob label="CHRASH"   value={chrash}       min={0} max={1}  step={0.01} defaultValue={0.0}  onChange={setChrash}/>
                <Knob label="FEEDBK"   value={feedback}     min={0} max={1}  step={0.01} defaultValue={0.0}  onChange={setFeedback}/>
                <Knob label="BLOCK"    value={blockGlitch}  min={0} max={1}  step={0.01} defaultValue={0.0}  onChange={setBlockGlitch}/>
                <Knob label="LIQUID"   value={liquid}       min={0} max={1}  step={0.01} defaultValue={0.0}  onChange={setLiquid}/>
              </div>
              <div style={{ display: "flex", justifyContent: "center", marginTop: 12 }}>
                <SynthSwitch label="MOSH HARD" on={moshHard} onChange={setMoshHard} onLabel="HARD" offLabel="SOFT"/>
              </div>
              <div style={{ display: "flex", justifyContent: "center", marginTop: 10 }}>
                <button
                  className="sp-btn"
                  onClick={() => {
                    setDatamosh(0.0); setMoshIFrame(0.0); setMoshMotion(0.0); setMoshBleed(0.0);
                    setMoshMap(0.0); setMoshDistort(0.0); setChrash(0.0);
                    setFeedback(0.0); setBlockGlitch(0.0); setLiquid(0.0); setMoshHard(false);
                  }}
                  style={{ fontSize: 9, padding: "6px 12px", letterSpacing: "1.4px", color: "rgba(255,140,140,0.95)" }}
                  title="Reset every DATAMOSH control to default"
                >HARD RESET</button>
              </div>
            </SynthPanel>

            {/* ── v1.2.58 ASENDORF / GYSIN homage rack ──────────────────────────────────
                STREAK   = Asendorf threshold directional smear (shader-only)
                GLYPH    = Gysin (ertdfgcvb) ASCII glyph atlas grid
                REALSORT = real CPU Asendorf row-sort, 256x144 @ 20 Hz, sampled back
                REACT-D  = Gray-Scott reaction-diffusion mosh on prev-frame
                VOROSRT  = Voronoi cell quantizer, brightest tap per cell
                (v1.2.59: STREAK removed; HILBERT folded into PIXEL SORT MODE=4)
            */}
            <SynthPanel title="ASENDORF / GYSIN" subtitle="PIXEL HOMAGE · 4 CTRL" accent="rgba(174,255,231,0.95)">
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 8, justifyItems: "center" }}>
                <Knob label="GLYPH"    value={glyph}    min={0} max={1} step={0.01} defaultValue={0.0} onChange={setGlyph}/>
                <Knob label="REALSORT" value={sortMix}  min={0} max={1} step={0.01} defaultValue={0.0} onChange={setSortMix}/>
                <Knob label="REACT-D"  value={reactD}   min={0} max={1} step={0.01} defaultValue={0.0} onChange={setReactD}/>
                <Knob label="VOROSRT"  value={voroSort} min={0} max={1} step={0.01} defaultValue={0.0} onChange={setVoroSort}/>
              </div>
              <div style={{ display: "flex", justifyContent: "center", marginTop: 10 }}>
                <button
                  className="sp-btn"
                  onClick={() => {
                    setGlyph(0); setSortMix(0); setReactD(0); setVoroSort(0);
                  }}
                  style={{ fontSize: 9, padding: "6px 12px", letterSpacing: "1.4px", color: "rgba(255,140,140,0.95)" }}
                  title="Reset every ASENDORF / GYSIN control to default"
                >HARD RESET</button>
              </div>
            </SynthPanel>

            {/* ── PIXEL GENERATOR RACK ──────────────────────────────── */}
            <SynthPanel title="PIXEL GENERATOR" subtitle={`GEN · ${genStyle}`} accent="rgba(255,210,140,0.95)">
              {/* Layer selector tabs (L1..L4 + MASTER) ────────────
                  Tap a tab to select it — every knob, the style grid and
                  the INVERT/RANDOM controls below then edit THAT layer's
                  params. Selecting MASTER broadcasts every edit to ALL 4
                  layers simultaneously. The small "●/○" pill inside each
                  layer tab toggles whether the layer participates in the
                  fused output (independent of selection). */}
              <div style={{
                fontSize: 9, letterSpacing: "1.4px", color: "rgba(255,210,140,0.7)",
                textTransform: "uppercase", marginBottom: 4, paddingLeft: 2,
                display: "flex", justifyContent: "space-between", alignItems: "baseline",
              }}>
                <span>Layers · {genLayers.filter(l => l.enabled).length} active</span>
                <span style={{ fontSize: 8, opacity: 0.6 }}>
                  {selectedLayer === 4 ? "EDITING ALL" : `EDITING L${selectedLayer+1}`}
                </span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 4, marginBottom: 8 }}>
                {[0,1,2,3,4].map((i) => {
                  const isMaster = i === 4;
                  const layer = isMaster ? null : genLayers[i];
                  const accent = isMaster
                    ? "#f8f8f8"
                    : ["#1200FF","#ff7a3a","#3aff8e","#ff3aa3"][i];
                  const selected = selectedLayer === i;
                  const enabled = isMaster ? true : !!layer?.enabled;
                  const label = isMaster ? "MASTER" : `L${i+1}`;
                  return (
                    <div key={`tab${i}`} style={{
                      position: "relative",
                      display: "flex", flexDirection: "column",
                      borderRadius: 6,
                      border: selected ? `2px solid ${accent}` : `1px solid ${accent}55`,
                      background: selected
                        ? `linear-gradient(180deg, ${accent}33, #0a0a12)`
                        : "linear-gradient(180deg,#15151c,#0a0a12)",
                      boxShadow: selected
                        ? `0 0 14px ${accent}88, inset 0 0 0 1px ${accent}33`
                        : "inset 0 0 0 1px rgba(0,0,0,0.4)",
                      transition: "all 0.12s ease",
                      overflow: "hidden",
                    }}>
                      <button
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => { e.stopPropagation(); setSelectedLayer(i); }}
                        title={isMaster ? "MASTER — edits broadcast to all layers" : `Edit Layer ${i+1}'s params`}
                        style={{
                          flex: 1, padding: "12px 4px 6px",
                          fontSize: isMaster ? 10 : 12, fontWeight: 900, letterSpacing: "1.4px",
                          fontFamily: "'Courier New',monospace",
                          color: selected ? "#f8f8f8" : `${accent}dd`,
                          background: "transparent",
                          border: "none",
                          cursor: "pointer",
                          textShadow: selected ? `0 0 10px ${accent}` : "none",
                          minHeight: 56,
                        }}
                      >{label}</button>
                      {!isMaster && layer && (
                        <button
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={(e) => {
                            e.stopPropagation();
                            setGenLayers(prev => prev.map(
                              (l, idx) => idx === i ? { ...l, enabled: !l.enabled } : l
                            ));
                          }}
                          title={enabled ? "Layer ON — tap to mute" : "Layer OFF — tap to unmute"}
                          style={{
                            margin: 4, padding: "3px 0",
                            fontSize: 8, fontWeight: 800, letterSpacing: "0.8px",
                            border: enabled ? `1px solid ${accent}` : `1px dashed ${accent}66`,
                            color: enabled ? "#f8f8f8" : `${accent}aa`,
                            background: enabled ? `${accent}55` : `${accent}11`,
                            borderRadius: 3, cursor: "pointer",
                            fontFamily: "'Courier New',monospace",
                          }}
                        >{enabled ? "● ON" : "○ OFF"}</button>
                      )}
                      {isMaster && (
                        <div style={{
                          margin: 4, padding: "3px 0",
                          fontSize: 8, fontWeight: 800, letterSpacing: "0.8px",
                          color: "rgba(248,248,248,0.6)", textAlign: "center",
                          border: "1px dashed rgba(255,255,255,0.18)",
                          background: "transparent",
                          borderRadius: 3,
                          fontFamily: "'Courier New',monospace",
                        }}>BCAST</div>
                      )}
                    </div>
                  );
                })}
              </div>
              {/* Family / Variant / Blend live as compact knobs (no preset grid). */}
              <div style={{
                fontSize: 9, letterSpacing: "1.4px", color: "rgba(255,210,140,0.7)",
                textTransform: "uppercase", marginBottom: 4, paddingLeft: 2,
                display: "flex", justifyContent: "space-between",
              }}>
                <span>{FAMILY_NAMES[(FV_BY_STYLE[genStyle]?.[0] ?? 3)]} · {genStyle}</span>
                <span style={{ opacity: 0.6 }}>BLEND {genBlend}</span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(5,minmax(0,1fr))", gap: 6, justifyItems: "center", marginBottom: 10 }}>
                <Knob label="FAMILY"
                  value={FV_BY_STYLE[genStyle]?.[0] ?? 3} min={0} max={9} step={1} defaultValue={3}
                  onChange={(f) => {
                    const v = FV_BY_STYLE[genStyle]?.[1] ?? 0;
                    const row = STYLE_BY_FV[f] ?? STYLE_BY_FV[3];
                    setGenStyle((row[v] ?? row[0]) as GenStyle);
                  }}
                />
                <Knob label="VARIANT"
                  value={FV_BY_STYLE[genStyle]?.[1] ?? 0} min={0} max={3} step={1} defaultValue={0}
                  onChange={(v) => {
                    const f = FV_BY_STYLE[genStyle]?.[0] ?? 3;
                    const row = STYLE_BY_FV[f] ?? STYLE_BY_FV[3];
                    setGenStyle((row[v] ?? row[0]) as GenStyle);
                  }}
                />
                <Knob label="BLEND"
                  value={GEN_BLEND_KEYS.indexOf(genBlend)} min={0} max={GEN_BLEND_KEYS.length - 1} step={1} defaultValue={0}
                  onChange={(i) => setGenBlend(GEN_BLEND_KEYS[i] as GenBlend)}
                />
                <Knob label="RES"     value={genResolution} min={8} max={160} step={1}    defaultValue={48}   onChange={setGenResolution}/>
                <Knob label="SEED"    value={genSeed}       min={0} max={999} step={1}    defaultValue={7}    onChange={setGenSeed}/>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(5,minmax(0,1fr))", gap: 6, justifyItems: "center" }}>
                <Knob label="DENSITY" value={genDensity}    min={0}    max={1} step={0.01} defaultValue={0.55} onChange={setGenDensity}/>
                <Knob label="SCALE"   value={genScale}      min={0.25} max={4} step={0.01} defaultValue={1.0}  onChange={setGenScale}/>
                <Knob label="SPEED"   value={genSpeed}      min={0}    max={3} step={0.01} defaultValue={0.6}  onChange={setGenSpeed}/>
                <Knob label="WARP"    value={genWarp}       min={0}    max={1} step={0.01} defaultValue={0.25} onChange={setGenWarp}/>
                <Knob label="JITTER"  value={genJitter}     min={0}    max={1} step={0.01} defaultValue={0.15} onChange={setGenJitter}/>
              </div>
              <div style={{ display: "flex", justifyContent: "center", gap: 16, marginTop: 12 }}>
                <SynthSwitch label="INVERT" on={genInvert} onChange={setGenInvert} onLabel="ON" offLabel="OFF"/>
                <button
                  onClick={() => setGenSeed(Math.floor(Math.random() * 999))}
                  style={{
                    padding: "6px 12px", fontSize: 10, letterSpacing: "1.4px",
                    fontFamily: "'Courier New',monospace", fontWeight: 700,
                    cursor: "pointer", borderRadius: 5,
                    border: "1px solid rgba(0,0,0,0.7)",
                    color: "rgba(255,210,140,0.95)",
                    background: "linear-gradient(180deg, #3A0852 0%, #1A0224 100%)",
                    boxShadow: "inset 0 1px 1px rgba(255,255,255,0.12), inset 0 -2px 3px rgba(0,0,0,0.7)",
                    textShadow: "0 0 5px rgba(232,160,32,0.55)",
                    alignSelf: "center", height: 30,
                  }}
                >⟲ RANDOM</button>
              </div>
            </SynthPanel>

            {/* ── COLOR (master color bus — every color control lives here) ── */}
            <SynthPanel title="COLOR" subtitle={`PAL · ${genPalette}`} accent="rgba(255,180,255,0.95)">
              {/* Palette selector — moved from PIXEL GENERATOR */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 4, marginBottom: 8 }}>
                {GEN_PALETTE_KEYS.map((pk) => {
                  const active = genPalette === pk;
                  const sw = pk === "MONO"    ? "linear-gradient(135deg,#fff,#888,#222)"
                           : pk === "WARM"    ? "linear-gradient(135deg,#ffd27a,#ff7a3a,#a8003c)"
                           : pk === "COOL"    ? "linear-gradient(135deg,#7ad6ff,#3a78ff,#001ea8)"
                           : pk === "PINK"    ? "linear-gradient(135deg,#ffd2f0,#ff3aa3,#7a006a)"
                           : pk === "ACID"    ? "linear-gradient(135deg,#d6ff3a,#3aff8e,#0a8000)"
                           : pk === "RAINBOW" ? "linear-gradient(90deg,#ff3a3a,#ffd23a,#3aff7a,#3ad6ff,#7a3aff,#ff3ad6)"
                           :                    "linear-gradient(135deg,#3A0852,#1A0224)";
                  return (
                    <button
                      key={pk}
                      onClick={() => setGenPalette(pk)}
                      title={pk === "CUSTOM" ? "Use HUE / SPREAD / SAT knobs" : `${pk} palette`}
                      style={{
                        padding: "6px 2px 4px",
                        fontSize: 8, letterSpacing: "0.6px", fontWeight: 700,
                        fontFamily: "'Courier New',monospace",
                        cursor: "pointer", borderRadius: 4,
                        border: active ? "1px solid rgba(255,180,255,0.95)" : "1px solid rgba(0,0,0,0.7)",
                        color: active ? "#fff" : "rgba(255,180,255,0.7)",
                        background: active
                          ? "linear-gradient(180deg,#3A0852 0%,#1A0224 100%)"
                          : "linear-gradient(180deg,#1a1a1e 0%,#0a0a12 100%)",
                        boxShadow: active
                          ? "inset 0 1px 1px rgba(255,255,255,0.18), 0 0 8px rgba(255,180,255,0.4)"
                          : "inset 0 1px 1px rgba(255,255,255,0.05)",
                        textShadow: active ? "0 0 5px rgba(255,180,255,0.8)" : "none",
                        position: "relative", overflow: "hidden",
                      }}
                    >
                      <div style={{
                        height: 6, marginBottom: 3, borderRadius: 2, background: sw,
                        opacity: active ? 1 : 0.7,
                      }}/>
                      {pk}
                    </button>
                  );
                })}
              </div>
              {/* Generator color knobs (was in PIXEL GENERATOR) */}
              <div style={{ fontSize: 9, letterSpacing: "1.4px", color: "rgba(255,180,255,0.7)", textTransform: "uppercase", marginBottom: 4, paddingLeft: 2 }}>Generator Color</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 8, justifyItems: "center", marginBottom: 12 }}>
                <Knob label="HUE"     value={genHue}        min={0} max={1}    step={0.01} defaultValue={0.78} onChange={setGenHue}/>
                <Knob label="SPREAD"  value={genHueSpread}  min={0} max={1}    step={0.01} defaultValue={0.35} onChange={setGenHueSpread}/>
                <Knob label="SAT"     value={genSat}        min={0} max={1}    step={0.01} defaultValue={0.85} onChange={setGenSat}/>
                <Knob label="CTRST"   value={genContrastG}  min={0} max={1}    step={0.01} defaultValue={0.7}  onChange={setGenContrastG}/>
              </div>
              {/* Master tone/color (was in MASTER + PIXEL SORT) */}
              <div style={{ fontSize: 9, letterSpacing: "1.4px", color: "rgba(255,180,255,0.7)", textTransform: "uppercase", marginBottom: 4, paddingLeft: 2 }}>Master Color</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 8, justifyItems: "center", marginBottom: 12 }}>
                <Knob label="HUE"     value={hueShift}    min={-0.5} max={0.5} step={0.01} defaultValue={0.0} onChange={setHueShift}/>
                <Knob label="SAT"     value={saturation}  min={0} max={3}      step={0.01} defaultValue={1.0} onChange={setSaturation}/>
                <Knob label="BRIGHT"  value={brightness}  min={0.2} max={2.0}  step={0.01} defaultValue={1.0} onChange={setBrightness}/>
                <Knob label="CONT"    value={contrast}    min={0.2} max={3.0}  step={0.01} defaultValue={1.0} onChange={setContrast}/>
              </div>
              {/* Sort key (color channel that drives PIXEL SORT) */}
              <div style={{ display: "flex", justifyContent: "center" }}>
                <SynthSelector label="SORT KEY" options={["LUM","HUE","SAT","R","G","B","INTENS","MIN"]} value={Math.round(sortKey)} onChange={(v) => setSortKey(v)}/>
              </div>
            </SynthPanel>

            {/* ── FX SETTINGS ─────────────────────────────────────── */}
            <SynthPanel title="FX SETTINGS" subtitle="VISUAL MODE · WARP · 5 CTRL" accent="rgba(231,174,255,0.95)">
              {/* Full visual-mode picker (the classic NIGHT/THERMAL/EDGE/MOTION
                  /CMYK/etc. set). Selecting any of these overrides the LAYER
                  MODE PXL/MOSH selection so the entire shader pipeline runs
                  that effect instead. NORMAL clears the override. */}
              <div style={{
                display: "grid",
                gridTemplateColumns: "repeat(4,minmax(0,1fr))",
                gap: 4,
                marginBottom: 10,
              }}>
                {([
                  [0,"NORMAL"],[1,"NIGHT"],[2,"THERMAL"],[3,"EDGE"],
                  [4,"MOTION"],[5,"CMYK"],[6,"HALFT"],[11,"POSTER"],
                  [13,"FEEDBK"],[14,"BLKROT"],[19,"ACID"],[20,"DITHER"],
                  [22,"MELT"],[24,"MIRROR"],
                ] as [ModeId,string][]).map(([id, lbl]) => {
                  const on = mode === id;
                  return (
                    <button
                      key={`vm-${id}`}
                      onClick={() => { setMode(id); }}
                      style={{
                        padding: "7px 2px",
                        fontSize: 9,
                        letterSpacing: "1px",
                        fontWeight: 700,
                        fontFamily: "'Courier New',monospace",
                        cursor: "pointer", borderRadius: 4,
                        border: on ? "1px solid rgba(231,174,255,0.85)" : "1px solid rgba(0,0,0,0.72)",
                        color: on ? "rgba(255,220,255,1)" : "rgba(200,180,220,0.72)",
                        textShadow: on ? "0 0 6px rgba(231,174,255,0.7)" : "none",
                        background: on
                          ? "linear-gradient(180deg, #3a1a4d 0%, #1a0a25 100%)"
                          : "linear-gradient(180deg, #2a2a30 0%, #14141a 100%)",
                        boxShadow: on
                          ? "inset 0 1px 1px rgba(255,220,255,0.18), 0 0 8px rgba(231,174,255,0.35)"
                          : "inset 0 1px 1px rgba(255,255,255,0.06), inset 0 -2px 3px rgba(0,0,0,0.7)",
                      }}
                    >{lbl}</button>
                  );
                })}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 8, justifyItems: "center" }}>
                <Knob label="DISRUPT"  value={disrupt}         min={0} max={1} step={0.01} defaultValue={0.0} onChange={setDisrupt}/>
                <Knob label="COUNT"    value={disruptCount}    min={0} max={1} step={0.01} defaultValue={0.4} onChange={setDisruptCount}/>
                <Knob label="SIZE"     value={disruptSize}     min={0} max={1} step={0.01} defaultValue={0.4} onChange={setDisruptSize}/>
                <Knob label="CONTRARY" value={disruptContrary} min={0} max={1} step={0.01} defaultValue={1.0} onChange={setDisruptContrary}/>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 8, marginTop: 8, justifyItems: "center" }}>
                <SynthSelector label="SHAPE" options={["BLOB","RING","HEX","CROSS","STRIPE","SPIRAL"]} value={Math.round(disruptShape)} onChange={(v) => setDisruptShape(v)}/>
              </div>
              <div style={{ marginTop: 8, fontSize: 8, letterSpacing: "1px", color: "rgba(231,174,255,0.55)", textAlign: "center" }}>
                roving pixel-groups disrupt with contrary motion · 6 shapes
              </div>
            </SynthPanel>

            {/* ── v1.2.60 RADIAL FX rack ───────────────────────────────────────
                10 mask-gated UV warps chained sequentially. Order in shader:
                KALEIDO → TILE → INVERT → DROSTE → SPIRAL → YANTRA → MANDALA
                → ROSETTE → STARFOLD → HEXFOLD. Any combo produces a unique
                pattern because each warp feeds the next. Kaleido is the
                anchor; the 9 sisters were declared in v1.2.58 but never
                wired — wired in v1.2.60 as combo-friendly siblings. */}
            <SynthPanel title="RADIAL FX" subtitle="UV WARPS · 10 CTRL · COMBOS" accent="rgba(231,174,255,0.95)">
              <div style={{ display: "grid", gridTemplateColumns: "repeat(5,minmax(0,1fr))", gap: 8, justifyItems: "center" }}>
                <Knob label="KALEIDO"  value={kaleido}   min={0} max={1} step={0.01} defaultValue={0.0} onChange={setKaleido}/>
                <Knob label="TILE"     value={tile}      min={0} max={1} step={0.01} defaultValue={0.0} onChange={setTile}/>
                <Knob label="INVERT"   value={invertSym} min={0} max={1} step={0.01} defaultValue={0.0} onChange={setInvertSym}/>
                <Knob label="DROSTE"   value={droste}    min={0} max={1} step={0.01} defaultValue={0.0} onChange={setDroste}/>
                <Knob label="SPIRAL"   value={spiral}    min={0} max={1} step={0.01} defaultValue={0.0} onChange={setSpiral}/>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(5,minmax(0,1fr))", gap: 8, marginTop: 8, justifyItems: "center" }}>
                <Knob label="YANTRA"   value={yantra}    min={0} max={1} step={0.01} defaultValue={0.0} onChange={setYantra}/>
                <Knob label="MANDALA"  value={mandala}   min={0} max={1} step={0.01} defaultValue={0.0} onChange={setMandala}/>
                <Knob label="ROSETTE"  value={rosette}   min={0} max={1} step={0.01} defaultValue={0.0} onChange={setRosette}/>
                <Knob label="STARFOLD" value={starfold}  min={0} max={1} step={0.01} defaultValue={0.0} onChange={setStarfold}/>
                <Knob label="HEXFOLD"  value={hexfold}   min={0} max={1} step={0.01} defaultValue={0.0} onChange={setHexfold}/>
              </div>
              <div style={{ display: "flex", justifyContent: "center", marginTop: 10 }}>
                <button
                  className="sp-btn"
                  onClick={() => {
                    setKaleido(0); setTile(0); setInvertSym(0); setDroste(0); setSpiral(0);
                    setYantra(0); setMandala(0); setRosette(0); setStarfold(0); setHexfold(0);
                  }}
                  style={{ fontSize: 9, padding: "6px 12px", letterSpacing: "1.4px", color: "rgba(255,140,140,0.95)" }}
                  title="Reset every RADIAL FX control to 0"
                >HARD RESET</button>
              </div>
              <div style={{ marginTop: 8, fontSize: 8, letterSpacing: "1px", color: "rgba(231,174,255,0.55)", textAlign: "center" }}>
                chain any combo · each warp feeds the next · all mask-gated
              </div>
            </SynthPanel>

            {/* ── MASTER ─────────────────────────────────────────── */}
            <SynthPanel title="MASTER" subtitle="OUT BUS">
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 8, justifyItems: "center" }}>
                <Knob label="GAIN"   value={gain}       min={0} max={1}  step={0.01} defaultValue={0.5} onChange={setGain}/>
                <Knob label="SPEED"  value={speed}      min={0} max={4}  step={0.05} defaultValue={1.0} onChange={setSpeed}/>
                <Knob label="SCAN"   value={scanlines}  min={0} max={1}  step={0.01} defaultValue={0.0} onChange={setScanlines}/>
                <Knob label="ZOOM"   value={zoom}       min={0} max={2}  step={0.01} defaultValue={0.0} onChange={setZoom}/>
              </div>
            </SynthPanel>

          </Section>

          {false && <Section title="PRESETS" id="presets" open={openSections.has("presets")} onToggle={toggleSection}>
            <div style={{ padding: "8px 10px", display: "grid", gap: 6 }}>
              <div style={{ fontSize: 9, letterSpacing: "1.1px", color: "rgba(200,180,220,0.66)", textTransform: "uppercase" }}>Local presets only. No login required.</div>
              {/* Rainbow Quick-Slot Scroll Wheel — large touch targets, color-coded
                  per slot so favourites are recognisable at a glance and harder
                  to fat-finger. Scrolls vertically when the list overflows. */}
              <div style={{
                fontSize: 9, letterSpacing: "1.4px", color: "rgba(248,248,248,0.55)",
                textTransform: "uppercase", padding: "4px 2px 0",
              }}>Quick Slots · Rainbow Wheel</div>
              <div
                style={{
                  display: "grid", gridTemplateColumns: "1fr",
                  gap: 8, padding: 8, borderRadius: 10,
                  background: "linear-gradient(180deg,#08080d,#03030a)",
                  border: "1px solid rgba(18,0,255,0.35)",
                  boxShadow: "inset 0 0 12px rgba(18,0,255,0.18)",
                  maxHeight: 360, overflowY: "auto",
                  WebkitOverflowScrolling: "touch",
                  scrollSnapType: "y proximity",
                }}
              >
                {quickSlots.map((slotName, i) => {
                  const hue = (i / quickSlots.length) * 360;
                  const accent = `hsl(${hue},95%,55%)`;
                  const accentDim = `hsla(${hue},95%,55%,0.18)`;
                  const filled = !!slotName;
                  return (
                    <button
                      key={`slot-${i}`}
                      onClick={() => {
                        if (!slotName) return;
                        const p = presets.find(x => x.name === slotName);
                        if (p) applyPreset(p);
                      }}
                      title={slotName || `Empty slot S${i+1} — assign with ★ on a saved preset below`}
                      style={{
                        display: "flex", alignItems: "center", gap: 10,
                        padding: "14px 14px",
                        minHeight: 56,
                        border: filled ? `1px solid ${accent}` : "1px solid rgba(255,255,255,0.07)",
                        borderRadius: 8,
                        background: filled
                          ? `linear-gradient(90deg, ${accentDim}, transparent 75%), linear-gradient(180deg,#0a0a12,#05050b)`
                          : "linear-gradient(180deg,#0a0a12,#05050b)",
                        color: filled ? "#f8f8f8" : "rgba(248,248,248,0.4)",
                        fontFamily: "'Courier New',monospace",
                        fontSize: 12, letterSpacing: "1.2px", fontWeight: 700,
                        textAlign: "left",
                        cursor: filled ? "pointer" : "default",
                        boxShadow: filled
                          ? `0 0 14px ${accent}55, inset 0 0 0 0 transparent`
                          : "none",
                        scrollSnapAlign: "start",
                        textTransform: "uppercase",
                        position: "relative", overflow: "hidden",
                      }}
                    >
                      <div style={{
                        width: 8, height: 36, borderRadius: 4,
                        background: filled ? accent : "rgba(255,255,255,0.08)",
                        boxShadow: filled ? `0 0 10px ${accent}` : "none",
                        flexShrink: 0,
                      }}/>
                      <div style={{
                        fontSize: 10, opacity: 0.7,
                        color: filled ? "#f8f8f8" : "rgba(248,248,248,0.4)",
                        minWidth: 26,
                      }}>{`S${i+1}`}</div>
                      <div style={{
                        flex: 1, minWidth: 0,
                        whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                      }}>{slotName || "EMPTY"}</div>
                      {filled && (
                        <div style={{
                          fontSize: 16, lineHeight: 1, color: accent,
                          textShadow: `0 0 8px ${accent}`,
                        }}>▶</div>
                      )}
                    </button>
                  );
                })}
              </div>
              <input
                value={presetName}
                onChange={(e) => setPresetName(e.target.value)}
                placeholder="preset name"
                style={{
                  background: "#120E07", border: "1px solid rgba(61,48,32,0.9)", color: "rgba(240,222,180,0.9)",
                  borderRadius: 8, padding: "8px 10px", fontSize: 10, letterSpacing: "1px", textTransform: "uppercase",
                }}
              />
              <button className="sp-tile" onClick={savePreset} style={{ ...modeBtnStyle, width: "100%" }}>SAVE CURRENT AS PRESET</button>
              {filteredPresets.length > 0 && (
                <div style={{ fontSize: 9, letterSpacing: "1.5px", color: "rgba(200,180,220,0.5)", padding: "6px 2px 2px", textTransform: "uppercase" }}>SAVED PRESETS</div>
              )}
              {filteredPresets.map((p) => (
                <div key={p.name} style={{ display: "grid", gridTemplateColumns: "1fr auto auto auto", gap: 6 }}>
                  <button className="sp-tile" onClick={() => applyPreset(p)} style={{ ...modeBtnStyle, textAlign: "left", padding: "10px" }}>{p.name}</button>
                  <button className="sp-tile" onClick={() => autoAssignQuickSlot(p.name)} style={{ ...modeBtnStyle, minWidth: 44 }} title="Assign to quick slot">★</button>
                  <button className="sp-tile" onClick={() => setPresetName(p.name)} style={{ ...modeBtnStyle, minWidth: 44 }}>✎</button>
                  <button className="sp-tile" onClick={() => deletePreset(p.name)} style={{ ...modeBtnStyle, minWidth: 44 }}>✕</button>
                </div>
              ))}
            </div>
          </Section>}

          <Section title="EXPORT · CAMERA · PROJECT" id="user" open={openSections.has("user")} onToggle={toggleSection}>
            <div style={{ padding: "8px 10px", display: "grid", gap: 10 }}>
              <div style={{ fontSize: 9, letterSpacing: "1.4px", color: "rgba(231,174,255,0.55)", textTransform: "uppercase" }}>Format</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <button
                  className="sp-tile"
                  onClick={() => setExportFormat("gif")}
                  style={{ ...modeBtnStyle, ...(exportFormat === "gif" ? modeBtnActive : {}), minWidth: 80 }}
                >GIF</button>
                <button
                  className="sp-tile"
                  onClick={() => setExportFormat("video")}
                  style={{ ...modeBtnStyle, ...(exportFormat === "video" ? modeBtnActive : {}), minWidth: 80 }}
                >VIDEO</button>
              </div>

              <div style={{ fontSize: 9, letterSpacing: "1.4px", color: "rgba(231,174,255,0.55)", textTransform: "uppercase" }}>Quality</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <button className="sp-tile" onClick={() => setExportQuality("standard")} style={{ ...modeBtnStyle, ...(exportQuality === "standard" ? modeBtnActive : {}), minWidth: 70 }}>STD</button>
                <button className="sp-tile" onClick={() => setExportQuality("high")} style={{ ...modeBtnStyle, ...(exportQuality === "high" ? modeBtnActive : {}), minWidth: 70 }}>HIGH</button>
                <button className="sp-tile" onClick={() => setExportQuality("ultra")} style={{ ...modeBtnStyle, ...(exportQuality === "ultra" ? modeBtnActive : {}), minWidth: 70 }}>ULTRA</button>
              </div>

              <div style={{ fontSize: 9, letterSpacing: "1.4px", color: "rgba(231,174,255,0.55)", textTransform: "uppercase" }}>Aspect</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <button className="sp-tile" onClick={() => setExportProfile("native")} style={{ ...modeBtnStyle, ...(exportProfile === "native" ? modeBtnActive : {}), minWidth: 70 }}>NATIVE</button>
                <button className="sp-tile" onClick={() => setExportProfile("vertical")} style={{ ...modeBtnStyle, ...(exportProfile === "vertical" ? modeBtnActive : {}), minWidth: 70 }}>9:16</button>
                <button className="sp-tile" onClick={() => setExportProfile("square")} style={{ ...modeBtnStyle, ...(exportProfile === "square" ? modeBtnActive : {}), minWidth: 70 }}>1:1</button>
                <button className="sp-tile" onClick={() => setExportProfile("widescreen")} style={{ ...modeBtnStyle, ...(exportProfile === "widescreen" ? modeBtnActive : {}), minWidth: 70 }}>16:9</button>
              </div>

              <div style={{ fontSize: 9, letterSpacing: "1.4px", color: "rgba(231,174,255,0.55)", textTransform: "uppercase" }}>Frame Rate</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <button className="sp-tile" onClick={() => setRecordFps(24)} style={{ ...modeBtnStyle, ...(recordFps === 24 ? modeBtnActive : {}), minWidth: 70 }}>24 FPS</button>
                <button className="sp-tile" onClick={() => setRecordFps(30)} style={{ ...modeBtnStyle, ...(recordFps === 30 ? modeBtnActive : {}), minWidth: 70 }}>30 FPS</button>
                <button className="sp-tile" onClick={() => setRecordFps(60)} style={{ ...modeBtnStyle, ...(recordFps === 60 ? modeBtnActive : {}), minWidth: 70 }}>60 FPS</button>
              </div>

              <div style={{ fontSize: 9, letterSpacing: "1.4px", color: "rgba(231,174,255,0.55)", textTransform: "uppercase" }}>Length</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <button className="sp-tile" onClick={() => setRecordMaxSec(5)}  style={{ ...modeBtnStyle, ...(recordMaxSec === 5  ? modeBtnActive : {}), minWidth: 60 }}>5s</button>
                <button className="sp-tile" onClick={() => setRecordMaxSec(15)} style={{ ...modeBtnStyle, ...(recordMaxSec === 15 ? modeBtnActive : {}), minWidth: 60 }}>15s</button>
                <button className="sp-tile" onClick={() => setRecordMaxSec(30)} style={{ ...modeBtnStyle, ...(recordMaxSec === 30 ? modeBtnActive : {}), minWidth: 60 }}>30s</button>
                <button className="sp-tile" onClick={() => setRecordMaxSec(60)} style={{ ...modeBtnStyle, ...(recordMaxSec === 60 ? modeBtnActive : {}), minWidth: 60 }}>60s</button>
              </div>

              <div style={{ fontSize: 9, letterSpacing: "1.4px", color: "rgba(231,174,255,0.55)", textTransform: "uppercase" }}>Loop</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <button className="sp-tile" onClick={() => setPerfectLoop(true)}  style={{ ...modeBtnStyle, ...(perfectLoop  ? modeBtnActive : {}), minWidth: 90 }}>PERFECT LOOP</button>
                <button className="sp-tile" onClick={() => setPerfectLoop(false)} style={{ ...modeBtnStyle, ...(!perfectLoop ? modeBtnActive : {}), minWidth: 70 }}>FULL LEN</button>
              </div>

              <div style={{
                fontSize: 9, letterSpacing: "1px", color: "rgba(200,134,10,0.7)",
                padding: "6px 8px", borderRadius: 6,
                background: "rgba(20,2,32,0.55)",
                border: "1px solid rgba(83,16,120,0.4)",
              }}>
                {exportFormat === "gif"
                  ? `${exportQuality.toUpperCase()} GIF — ${getGifProfile(exportQuality).maxDim}px @ ${recordFps}fps · ${exportProfile === "native" ? "native aspect" : exportProfile === "vertical" ? "9:16" : exportProfile === "square" ? "1:1" : "16:9"} · ${recordMaxSec}s${perfectLoop ? " · loop" : ""}`
                  : `${exportQuality.toUpperCase()} VIDEO — ${getExportMaxDim(exportQuality)}px @ ${recordFps}fps · ${exportProfile === "native" ? "native aspect" : exportProfile === "vertical" ? "9:16" : exportProfile === "square" ? "1:1" : "16:9"} · ${recordMaxSec}s${audioActive ? " · 🔊 AUDIO" : ""}`
                }
              </div>
              {exportFormat === "video" && !audioActive && (
                <div style={{ fontSize: 8, letterSpacing: "1px", color: "rgba(200,180,220,0.55)", textAlign: "center", textTransform: "uppercase" }}>
                  Tap 🔈 in top bar to include microphone audio
                </div>
              )}

              <button
                className="sp-tile"
                onClick={() => { if (recording) stopRecordingRef.current(); else startRecordingRef.current(); }}
                style={{
                  ...modeBtnStyle,
                  ...(recording ? modeBtnActive : {}),
                  width: "100%", minHeight: 56, fontSize: 13, letterSpacing: "2px",
                  ...(recording ? { animation: "activeGlow 1s ease-in-out infinite" } : {}),
                }}
              >{recording ? "■ STOP RECORDING" : "● RECORD"}</button>
              {/* v1.2.72 — HANDS-FREE compact button: 3-2-1 count-IN, then
                  60 s auto-record, then 3-2-1 count-OUT, then auto-stop.
                  Tap again at any phase to cancel/stop. Lives next to
                  RECORD so it doesn't obscure other UI. */}
              <button
                className="sp-tile"
                onClick={startHandsFree}
                title="3-2-1 countdown, then auto-record 60 s, then auto-stop"
                style={{
                  ...modeBtnStyle,
                  ...(handsFreeCountdown != null ? modeBtnActive : {}),
                  width: "100%", minHeight: 36, fontSize: 10, letterSpacing: "1.5px",
                  ...(handsFreeCountdown != null ? { animation: "activeGlow 1s ease-in-out infinite" } : {}),
                }}
              >{handsFreeCountdown == null
                  ? `⏱ HANDS-FREE · ${HANDS_FREE_SEC}s`
                  : handsFreeCountdown.phase === "in"
                    ? `✕ CANCEL · ${handsFreeCountdown.n}…`
                    : handsFreeCountdown.phase === "out"
                      ? `✕ STOP · ${handsFreeCountdown.n}s`
                      : `✕ STOP · ${handsFreeCountdown.n}s LEFT`}</button>
              <div style={{ fontSize: 8, letterSpacing: "1px", color: "rgba(200,180,220,0.4)", textAlign: "center", textTransform: "uppercase" }}>
                Tip: hold canvas also records
              </div>

              <div style={{ height: 4 }}/>
              <div style={{ fontSize: 9, letterSpacing: "1.4px", color: "rgba(231,174,255,0.55)", textTransform: "uppercase" }}>Camera</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <button
                  className="sp-tile"
                  onClick={cameraActive ? stopCamera : () => { void startCamera(); }}
                  style={{ ...modeBtnStyle, ...(cameraActive ? modeBtnActive : {}), flex: 1, minWidth: 86 }}
                >{cameraActive ? "CAM ON" : "CAM OFF"}</button>
                <button
                  className="sp-tile"
                  onClick={() => { void hardResetCamera(); }}
                  style={{ ...modeBtnStyle, flex: 1, minWidth: 110 }}
                >HARD RESET CAM</button>
              </div>

              <div style={{ height: 4 }}/>
              <div style={{ fontSize: 9, letterSpacing: "1.4px", color: "rgba(231,174,255,0.55)", textTransform: "uppercase" }}>Project</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <button className="sp-tile" onClick={saveProject} style={{ ...modeBtnStyle, flex: 1, fontSize: 10 }}>SAVE PROJECT</button>
                <button className="sp-tile" onClick={() => projectFileInputRef.current?.click()} style={{ ...modeBtnStyle, flex: 1, fontSize: 10 }}>LOAD PROJECT</button>
              </div>

              {/* ── PERFORMANCE / TIER row */}
              <div style={{ height: 4 }}/>
              <div style={{ fontSize: 9, letterSpacing: "1.4px", color: "rgba(231,174,255,0.55)", textTransform: "uppercase" }}>Performance · Tier</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                <button
                  className="sp-tile"
                  onClick={() => setLowPowerOn(v => !v)}
                  title="Cap render to ~30fps to reduce battery + heat"
                  style={{
                    ...modeBtnStyle,
                    ...(lowPowerOn ? modeBtnActive : {}),
                    flex: 1, fontSize: 10, minWidth: 110,
                  }}
                >{lowPowerOn ? "❄ LOW POWER ON" : "❄ LOW POWER"}</button>
                <button
                  className="sp-tile"
                  onClick={() => setTierInfoOpen(true)}
                  title="View plans"
                  style={{
                    ...modeBtnStyle, flex: 1, fontSize: 10, minWidth: 110,
                    color: entitlement === "studio" ? "rgba(120,255,200,0.98)" : entitlement === "paid" ? "rgba(255,210,140,0.98)" : "rgba(231,174,255,0.95)",
                    textShadow: entitlement ? "0 0 6px rgba(232,160,32,0.7)" : "none",
                  }}
                >ℹ {entitlement === "studio" ? "STUDIO" : entitlement === "paid" ? "PAID" : `GRACE ${Math.ceil(graceRemaining/1000)}s`}</button>
              </div>
              <div style={{ fontSize: 8, letterSpacing: "1px", color: "rgba(200,180,220,0.5)", textAlign: "center", textTransform: "uppercase", marginTop: 2 }}>
                Phone running hot? Try LOW POWER. · Tap status badge to see plans.
              </div>
            </div>
          </Section>

          <div style={{ height: 28 }}/>
          </>)}
        </div>
      </div>

      <style>{`
        @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0.3} }
        @keyframes btnPress  { 0%{transform:scale(1) translateY(0)} 45%{transform:scale(0.90) translateY(2px)} 100%{transform:scale(1) translateY(0)} }
        @keyframes tilePress { 0%{transform:scale(1) translateY(0)} 40%{transform:scale(0.92) translateY(3px)} 100%{transform:scale(1) translateY(0)} }
        @keyframes activeGlow{ 0%,100%{box-shadow:0 0 10px 1px rgba(200,134,10,0.3),0 3px 10px rgba(0,0,0,0.5)} 50%{box-shadow:0 0 22px 5px rgba(232,160,32,0.55),0 3px 10px rgba(0,0,0,0.5)} }
        .sp-btn:active  { animation: btnPress  0.18s ease forwards !important; filter: brightness(1.25); }
        .sp-tile:active { animation: tilePress 0.15s ease forwards !important; filter: brightness(1.2); }
        input[type=range] { -webkit-appearance:none; appearance:none; height:12px; border-radius:7px; cursor:pointer; outline:none; }
        input[type=range]::-webkit-slider-thumb { -webkit-appearance:none; width:28px; height:28px; border-radius:50%; cursor:grab; background:#B014F0; border:3px solid #D34BFF; box-shadow:0 2px 10px rgba(0,0,0,0.7),0 0 10px rgba(176,20,240,0.5); transition:transform .1s,box-shadow .1s; }
        input[type=range]:active::-webkit-slider-thumb { transform:scale(1.28); box-shadow:0 0 18px 4px rgba(211,75,255,0.7); cursor:grabbing; }
        input[type=range]::-moz-range-thumb { width:26px; height:26px; border-radius:50%; border:3px solid #D34BFF; background:#B014F0; cursor:grab; }
        input[type=range]::-webkit-slider-runnable-track { border-radius:7px; }
      `}</style>
    </div>
  );
}

// ── Design tokens ───────────────────────────────────────────
const T = {
  bg0:        "#060009",                            // deep black violet
  bg1:        "#0F001C",                            // dark purple panel
  bg2:        "#1A0329",                            // raised violet surface
  bg3:        "#26063C",                            // highlight purple surface
  border:     "#3D0A5C",                            // purple border (muted)
  borderHi:   "#8A22CC",                            // active border
  amber:      "#A012D8",                            // primary accent (more restrained)
  ochre:      "#C840FF",                            // bright accent / text active
  cream:      "#EDE8F8",                            // main text (slightly warmer)
  creamDim:   "rgba(237,232,248,0.58)",
  creamFaint: "rgba(237,232,248,0.24)",
  terracotta: "#C05A2A",                            // record / warning
  moss:       "#4A7A4C",                            // camera on / success
  cyan:       "#B055F0",                            // cool HUD accent only
  shadow:     "0 4px 16px rgba(0,0,0,0.8)",
  bevel:      "inset 0 1px 0 rgba(255,255,255,0.06), inset 0 -1px 0 rgba(0,0,0,0.6)",
  glow:       "0 0 12px 2px rgba(160,18,216,0.38)",
  glowActive: "0 0 20px 4px rgba(200,64,255,0.48)",
};

// ── TE gradient hallmark colors (OP-1 knob language) ────────
const TE = {
  blue:   "#4B9EFF",   // OP-1 blue knob   → VISION / ANIMATION
  green:  "#52C97A",   // OP-1 green knob  → SIGNAL FX / DRAW
  amber:  "#E8A020",   // TX-6 orange pip  → FX INTENSITY / PRESETS / EXPORT
  red:    "#E03D3D",   // OP-1 red knob    → GLITCH / CAMERA
  lilac:  "#C765FF",   // Spectra accent   → IMAGE / USER SETTINGS
};

// Colored pip per section (OP-1 knob language applied to panel sections)
const SECTION_PIP: Record<string, string> = {
  modes:   TE.blue,
  glitch:  TE.red,
  signal:  TE.green,
  fx:      TE.amber,
  image:   TE.lilac,
  anim:    TE.blue,
  draw:    TE.green,
  presets: TE.amber,
  camera:  TE.red,
  export:  TE.green,
  user:    TE.lilac,
};

// Mode button positional gradient (OP-XY key gradient: cool indigo → warm violet)
// Kept for legacy preset import compatibility — no longer rendered in current UI.
function modeBtnPositionalStyle(index: number, total: number): React.CSSProperties {
  const t = index / Math.max(1, total - 1);
  const hue = Math.round(252 + t * 38);
  const l1  = Math.round(11 + t * 5);
  const l2  = Math.round(7  + t * 4);
  const bh  = Math.round(252 + t * 38);
  const bl  = Math.round(20 + t * 10);
  return {
    background: `linear-gradient(170deg, hsl(${hue},62%,${l1}%) 0%, hsl(${hue},58%,${l2}%) 60%, hsl(${hue},55%,${l1-1}%) 100%)`,
    borderColor: `hsl(${bh},52%,${bl}%)`,
  };
}
void modeBtnPositionalStyle;

// ── Shared styles ────────────────────────────────────────────
const topBtnStyle: React.CSSProperties = {
  background: `linear-gradient(175deg, ${T.bg3} 0%, ${T.bg1} 55%, ${T.bg2} 100%)`,
  border: `2px solid ${T.border}`,
  borderBottom: `4px solid #090705`,
  borderRadius: 12,
  color: T.cream,
  width: 48, height: 48,
  fontSize: 18,
  cursor: "pointer",
  display: "flex", alignItems: "center", justifyContent: "center",
  fontFamily: "inherit",
  boxShadow: `0 4px 12px rgba(0,0,0,0.7), ${T.bevel}`,
  transition: "all 0.1s ease",
  flexShrink: 0,
};

const modeBtnStyle: React.CSSProperties = {
  background: `linear-gradient(170deg, ${T.bg3} 0%, ${T.bg1} 55%, ${T.bg2} 100%)`,
  border: `1px solid ${T.border}`,
  borderBottom: `2px solid #090705`,
  borderRadius: 8,
  color: T.creamDim,
  // Slim chip footprint (was 12px/8px @ minHeight 54). Tiles still read
  // as press-targets (>=32px tall) but stack 40% denser so 4- and 5-col
  // grids no longer dominate the carousel y-axis.
  padding: "6px 6px",
  fontFamily: "'Courier New', monospace",
  fontSize: 9,
  letterSpacing: "1.2px",
  textTransform: "uppercase",
  cursor: "pointer",
  minWidth: 40, minHeight: 32,
  boxShadow: `0 2px 6px rgba(0,0,0,0.45), ${T.bevel}`,
  transition: "all 0.12s ease",
  lineHeight: 1.1,
};

const modeBtnActive: React.CSSProperties = {
  background: `linear-gradient(170deg, #2E2008 0%, #1A1205 55%, #251A07 100%)`,
  border: `1px solid ${T.amber}`,
  borderBottom: `2px solid #090705`,
  color: T.ochre,
  boxShadow: `${T.glowActive}, ${T.bevel}`,
  textShadow: `0 0 10px rgba(232,160,32,0.7)`,
};

// ── Section label helper ─────────────────────────────────────
function Section({ title, id, open, onToggle, children }: {
  title: string; id: string; open: boolean;
  onToggle: (id: string) => void; children: React.ReactNode;
}) {
  const pipColor = SECTION_PIP[id] ?? TE.lilac;
  return (
    <div style={{ borderBottom: "1px solid rgba(61,10,92,0.45)" }}>
      <button onClick={() => onToggle(id)} style={{
        width: "100%", display: "flex", alignItems: "center",
        background: open
          ? `linear-gradient(90deg, rgba(${hexToRgb(pipColor)},0.12) 0%, transparent 75%)`
          : "rgba(9,0,16,0.75)",
        border: "none", borderTop: `1px solid rgba(${hexToRgb(pipColor)},0.22)`,
        padding: "11px 12px", cursor: "pointer",
        fontFamily: "'Courier New',monospace",
        fontSize: 11, letterSpacing: "1.5px",
        color: open ? T.cream : T.creamDim,
        textTransform: "uppercase", textAlign: "left",
      }}>
        {/* TE-style colored pip (OP-1 knob language) */}
        <span style={{
          display: "inline-block", width: 7, height: 7,
          background: open ? pipColor : `rgba(${hexToRgb(pipColor)},0.45)`,
          borderRadius: 2,
          marginRight: 9, flexShrink: 0,
          boxShadow: open ? `0 0 6px 1px ${pipColor}` : "none",
          transition: "all 0.15s ease",
        }}/>
        <span style={{
          display: "inline-block", width: 10, fontSize: 9,
          color: open ? pipColor : T.creamFaint,
          transform: open ? "rotate(90deg)" : "none",
          transition: "transform 0.15s ease", lineHeight: 1, marginRight: 8, flexShrink: 0,
        }}>▶</span>
        {title}
      </button>
      {open && <div>{children}</div>}
    </div>
  );
}

// hex color → "r,g,b" for rgba()
function hexToRgb(hex: string): string {
  const n = parseInt(hex.replace("#", ""), 16);
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
}

// ── Slider helper ────────────────────────────────────────────
function SliderRow({
  label, value, min, max, step, onChange, index = 0,
}: {
  label: string; value: number; min: number; max: number; step: number;
  onChange: (v: number) => void; index?: number; compact?: boolean;
}) {
  const pct = Math.round(((value - min) / (max - min)) * 100);
  const isEven = index % 2 === 0;
  const displayVal = step >= 1 ? Math.round(value).toString() : value.toFixed(2);
  // Subtle scan-line texture: alternates row direction so two rows feel woven.
  const rowTexture = isEven
    ? "repeating-linear-gradient(0deg, rgba(255,255,255,0.018) 0 1px, transparent 1px 3px)"
    : "repeating-linear-gradient(0deg, rgba(0,0,0,0.16) 0 1px, transparent 1px 3px)";
  const rowBase = isEven
    ? "linear-gradient(180deg, rgba(48,12,72,0.46) 0%, rgba(28,6,48,0.58) 100%)"
    : "linear-gradient(180deg, rgba(22,4,36,0.62) 0%, rgba(12,2,22,0.72) 100%)";
  return (
    <div style={{
      display: "grid", gridTemplateColumns: "88px 1fr 54px",
      alignItems: "stretch",
      background: `${rowTexture}, ${rowBase}`,
      borderTop: isEven ? "1px solid rgba(255,255,255,0.04)" : "1px solid rgba(0,0,0,0.32)",
      borderBottom: "1px solid rgba(83,16,120,0.32)",
      boxShadow: "inset 0 1px 0 rgba(255,255,255,0.025), inset 0 -1px 0 rgba(0,0,0,0.34)",
      minHeight: 48,
    }}>
      <div style={{
        padding: "0 8px 0 12px", touchAction: "pan-y",
        display: "flex", alignItems: "center",
        fontSize: 10, letterSpacing: "0.8px", fontFamily: "'Courier New',monospace",
        color: isEven ? "rgba(243,238,255,0.94)" : "rgba(231,174,255,0.86)",
        userSelect: "none", cursor: "ns-resize",
        borderRight: "1px solid rgba(83,16,120,0.42)",
        textShadow: "0 1px 0 rgba(0,0,0,0.55), 0 -1px 0 rgba(255,255,255,0.04)",
        textTransform: "uppercase",
      }}>{label}</div>
      <div style={{
        padding: "0 10px", touchAction: "none",
        display: "flex", alignItems: "center",
        background: "linear-gradient(180deg, rgba(0,0,0,0.32) 0%, rgba(0,0,0,0.0) 35%, rgba(0,0,0,0.0) 65%, rgba(0,0,0,0.28) 100%)",
      }}>
        <input
          type="range" min={min} max={max} step={step} value={value}
          onChange={e => onChange(Number(e.target.value))}
          style={{
            width: "100%", cursor: "pointer", touchAction: "none",
            background: `linear-gradient(90deg, ${TE.blue} 0%, ${TE.lilac} ${pct}%, #15041F ${pct}%, #1C0630 100%)`,
            accentColor: T.ochre,
            borderRadius: 999,
            boxShadow: "inset 0 1px 2px rgba(0,0,0,0.55), inset 0 -1px 0 rgba(255,255,255,0.05)",
          }}
        />
      </div>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "flex-end",
        padding: "0 10px", fontSize: 11, fontFamily: "'Courier New',monospace",
        color: "rgba(255,210,140,0.95)", userSelect: "none",
        borderLeft: "1px solid rgba(0,0,0,0.45)",
        background: "linear-gradient(180deg, #0A0312 0%, #160726 50%, #0A0312 100%)",
        boxShadow: "inset 1px 0 0 rgba(83,16,120,0.35), inset 0 1px 2px rgba(0,0,0,0.7)",
        textShadow: "0 0 6px rgba(232,160,32,0.55), 0 0 1px rgba(255,210,140,0.85)",
        letterSpacing: "0.5px",
      }}>{displayVal}</div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────
// SynthSwitch — chunky 2-position toggle (brushed metal lever)
// ───────────────────────────────────────────────────────────────────────
function SynthSwitch({
  label, on, onChange, onLabel = "ON", offLabel = "OFF",
}: {
  label: string; on: boolean; onChange: (v: boolean) => void;
  onLabel?: string; offLabel?: string;
}) {
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center",
      gap: 4, userSelect: "none", padding: "2px 4px", minWidth: 60,
    }}>
      <div style={{
        fontSize: 8, letterSpacing: "1.4px", textTransform: "uppercase",
        color: "rgba(243,238,255,0.78)", fontFamily: "'Courier New',monospace",
        textShadow: "0 1px 0 rgba(0,0,0,0.7)",
        whiteSpace: "nowrap",
      }}>{label}</div>
      <div
        onClick={() => onChange(!on)}
        title={`${label}: ${on ? onLabel : offLabel}`}
        style={{
          position: "relative",
          width: 54, height: 30,
          borderRadius: 6,
          cursor: "pointer",
          background: "linear-gradient(180deg, #0E0E14 0%, #1C1C22 50%, #0A0A10 100%)",
          boxShadow: `
            inset 0 2px 4px rgba(0,0,0,0.85),
            inset 0 -1px 0 rgba(255,255,255,0.06),
            0 1px 0 rgba(255,255,255,0.04)
          `,
          border: "1px solid rgba(0,0,0,0.7)",
          padding: 2,
          display: "flex",
        }}
      >
        <div style={{
          width: "50%", height: "100%",
          marginLeft: on ? "50%" : "0%",
          transition: "margin-left 0.12s ease",
          borderRadius: 4,
          background: on
            ? "linear-gradient(180deg, #F4F4F8 0%, #BFBFC8 35%, #6E6E78 70%, #2C2C34 100%)"
            : "linear-gradient(180deg, #5A5A66 0%, #3A3A44 50%, #1E1E26 100%)",
          boxShadow: on
            ? "inset 0 1px 1px rgba(255,255,255,0.55), inset 0 -1px 2px rgba(0,0,0,0.6), 0 0 8px rgba(231,174,255,0.55), 0 1px 2px rgba(0,0,0,0.6)"
            : "inset 0 1px 1px rgba(255,255,255,0.18), inset 0 -1px 2px rgba(0,0,0,0.6), 0 1px 2px rgba(0,0,0,0.6)",
          // brushed metal grain
          backgroundImage: on
            ? "repeating-linear-gradient(90deg, rgba(255,255,255,0.04) 0 1px, transparent 1px 3px), linear-gradient(180deg, #F4F4F8 0%, #BFBFC8 35%, #6E6E78 70%, #2C2C34 100%)"
            : "repeating-linear-gradient(90deg, rgba(255,255,255,0.03) 0 1px, transparent 1px 3px), linear-gradient(180deg, #5A5A66 0%, #3A3A44 50%, #1E1E26 100%)",
        }}/>
      </div>
      <div style={{
        fontSize: 9, fontFamily: "'Courier New',monospace",
        letterSpacing: "0.5px",
        color: on ? "rgba(255,210,140,0.95)" : "rgba(180,140,90,0.55)",
        background: "linear-gradient(180deg, #0A0312 0%, #160726 100%)",
        border: "1px solid rgba(0,0,0,0.55)",
        padding: "1px 6px",
        borderRadius: 3,
        minWidth: 36,
        textAlign: "center",
        textShadow: on ? "0 0 5px rgba(232,160,32,0.6)" : "none",
        boxShadow: "inset 0 1px 2px rgba(0,0,0,0.6)",
      }}>{on ? onLabel : offLabel}</div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────
// SynthSelector — chunky multi-position rotary selector (enum)
// ───────────────────────────────────────────────────────────────────────
function SynthSelector({
  label, options, value, onChange,
}: {
  label: string; options: readonly string[]; value: number; onChange: (v: number) => void;
}) {
  const v = Math.max(0, Math.min(options.length - 1, value));
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center",
      gap: 4, userSelect: "none", padding: "2px 4px",
    }}>
      <div style={{
        fontSize: 8, letterSpacing: "1.4px", textTransform: "uppercase",
        color: "rgba(243,238,255,0.78)", fontFamily: "'Courier New',monospace",
        textShadow: "0 1px 0 rgba(0,0,0,0.7)",
        whiteSpace: "nowrap",
      }}>{label}</div>
      <div style={{
        display: "flex", flexWrap: "wrap", gap: 2,
        padding: 3,
        borderRadius: 6,
        background: "linear-gradient(180deg, #0E0E14 0%, #1C1C22 50%, #0A0A10 100%)",
        boxShadow: "inset 0 2px 4px rgba(0,0,0,0.85), 0 1px 0 rgba(255,255,255,0.04)",
        border: "1px solid rgba(0,0,0,0.7)",
        maxWidth: 120,
        justifyContent: "center",
      }}>
        {options.map((opt, i) => {
          const active = i === v;
          return (
            <button
              key={opt}
              onClick={() => onChange(i)}
              style={{
                padding: "3px 6px",
                fontSize: 8, letterSpacing: "0.8px",
                fontFamily: "'Courier New',monospace",
                fontWeight: active ? 700 : 500,
                cursor: "pointer",
                borderRadius: 3,
                border: "1px solid rgba(0,0,0,0.7)",
                color: active ? "rgba(255,210,140,1)" : "rgba(200,180,220,0.55)",
                textShadow: active ? "0 0 6px rgba(232,160,32,0.7)" : "none",
                background: active
                  ? "linear-gradient(180deg, #4A0F66 0%, #2A0540 100%)"
                  : "linear-gradient(180deg, #2A2A33 0%, #14141A 100%)",
                boxShadow: active
                  ? "inset 0 1px 1px rgba(255,255,255,0.18), inset 0 -1px 2px rgba(0,0,0,0.6), 0 0 6px rgba(176,20,240,0.5)"
                  : "inset 0 1px 1px rgba(255,255,255,0.05), inset 0 -1px 2px rgba(0,0,0,0.6)",
                minWidth: 28,
              }}
            >{opt}</button>
          );
        })}
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────
// SynthPanel — chunky brushed-metal chassis with screws + amber title strip
// ───────────────────────────────────────────────────────────────────────
// Accordion coordinator. When a SynthPanel is rendered inside a
// provider, only one panel is open at a time and tapping the title
// strip toggles it. Without a provider, all panels render expanded
// (legacy / desktop layout).
const SynthPanelAccordionContext = createContext<{
  openTitle: string | null;
  setOpenTitle: Dispatch<SetStateAction<string | null>>;
} | null>(null);

function SynthPanel({
  title, subtitle, accent, children,
}: {
  title: string; subtitle?: string; accent?: string; children: React.ReactNode;
}) {
  const accentColor = accent ?? "rgba(231,174,255,0.95)";
  // ── Accordion integration. If a parent has provided
  // SynthPanelAccordionContext (e.g. the glass-mode panel container),
  // this rack becomes collapsible: tapping the title strip toggles it
  // open as the single active panel and closes any sibling. Default
  // collapsed → user sees a tidy stack of title strips and only the
  // panel they want to fiddle with shows controls.
  const acc = useContext(SynthPanelAccordionContext);
  const collapsible = !!acc;
  const isOpen = collapsible ? acc!.openTitle === title : true;
  const onToggle = () => {
    if (!collapsible) return;
    acc!.setOpenTitle(prev => prev === title ? null : title);
  };
  const screw = (top?: string | number, left?: string | number, right?: string | number, bottom?: string | number) => (
    <div style={{
      position: "absolute",
      top, left: left as string | number | undefined, right: right as string | number | undefined, bottom: bottom as string | number | undefined,
      width: 10, height: 10,
      borderRadius: "50%",
      background: "radial-gradient(circle at 35% 30%, #C8C8D0 0%, #6E6E78 45%, #1E1E26 100%)",
      boxShadow: "inset 0 1px 1px rgba(255,255,255,0.4), inset 0 -1px 2px rgba(0,0,0,0.7), 0 1px 2px rgba(0,0,0,0.7)",
      pointerEvents: "none",
    }}>
      <div style={{
        position: "absolute", left: "50%", top: "20%", width: 1, height: "60%",
        marginLeft: -0.5, background: "rgba(0,0,0,0.65)", transform: "rotate(35deg)", transformOrigin: "center",
      }}/>
    </div>
  );
  return (
    <div className={"sp-rack" + (collapsible ? (isOpen ? " sp-rack-open" : " sp-rack-closed") : "")} style={{
      position: "relative",
      margin: collapsible ? "2px 5px" : "8px 10px 10px",
      padding: collapsible ? "2px 6px" : "8px 12px 12px",
      borderRadius: 10,
      // deep purple chassis
      background: `
        linear-gradient(180deg, #2A0A4A 0%, #1A0530 60%, #0F0220 100%)
      `,
      boxShadow: `
        0 6px 18px rgba(0,0,0,0.7),
        inset 0 1px 0 rgba(255,255,255,0.06),
        inset 0 -2px 4px rgba(0,0,0,0.55)
      `,
      border: "1px solid rgba(0,0,0,0.6)",
    }}>
      {screw(6, 6)}
      {screw(6, undefined, 6)}
      {screw(undefined, 6, undefined, 6)}
      {screw(undefined, undefined, 6, 6)}

      {/* Amber-LCD title strip — clickable when used inside the
          accordion, giving the rack a chevron to indicate state. */}
      <div
        onClick={onToggle}
        role={collapsible ? "button" : undefined}
        aria-expanded={collapsible ? isOpen : undefined}
        style={{
          margin: isOpen && !collapsible ? "0 0 8px" : (collapsible ? 0 : "0 0 8px"),
          padding: collapsible ? "2px 8px" : "3px 8px",
          borderRadius: 5,
          background: "linear-gradient(180deg, #0A0312 0%, #160726 100%)",
          border: "1px solid rgba(0,0,0,0.65)",
          boxShadow: "inset 0 1px 2px rgba(0,0,0,0.65), inset 0 -1px 0 rgba(255,255,255,0.04)",
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
          cursor: collapsible ? "pointer" : "default",
          userSelect: "none",
        }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, flex: 1 }}>
          {collapsible && (
            <span style={{
              fontSize: 10,
              color: "rgba(255,210,140,0.85)",
              transform: isOpen ? "rotate(90deg)" : "rotate(0deg)",
              transition: "transform 0.15s ease",
              display: "inline-block",
              width: 10,
            }}>▶</span>
          )}
          <div style={{
            fontSize: 10, letterSpacing: "2px", textTransform: "uppercase",
            fontFamily: "'Courier New',monospace", fontWeight: 700,
            color: "rgba(255,210,140,0.95)",
            textShadow: "0 0 6px rgba(232,160,32,0.7)",
          }}>{title}</div>
        </div>
        {subtitle && (
          <div style={{
            fontSize: 8, letterSpacing: "1.4px", textTransform: "uppercase",
            fontFamily: "'Courier New',monospace",
            color: accentColor,
            textShadow: `0 0 5px ${accentColor}`,
          }}>{subtitle}</div>
        )}
      </div>

      {/* Brushed-metal inner workspace — hidden when accordion-collapsed. */}
      {isOpen && (
      <div className="sp-rack-inner" style={{
        marginTop: 4,
        padding: "5px 5px 5px",
        borderRadius: 6,
        background: `
          repeating-linear-gradient(90deg, rgba(255,255,255,0.025) 0 1px, transparent 1px 3px),
          linear-gradient(180deg, #1C1C22 0%, #14141A 50%, #0E0E14 100%)
        `,
        boxShadow: "inset 0 2px 4px rgba(0,0,0,0.7), inset 0 -1px 0 rgba(255,255,255,0.05)",
        border: "1px solid rgba(0,0,0,0.7)",
      }}>
        {children}
      </div>
      )}
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────
// Knob — hardware-style rotary control. Drag vertically or scroll wheel.
// Double-click to reset to default. Range mapped across -135°..+135°.
// ───────────────────────────────────────────────────────────────────────
function Knob({
  label, value, min, max, step, defaultValue, onChange, size = 42,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  defaultValue: number;
  onChange: (v: number) => void;
  size?: number;
}) {
  const pct = (value - min) / Math.max(0.0001, max - min);
  const angle = -135 + pct * 270; // -135° to +135°
  const display = step >= 1 ? Math.round(value).toString() : value.toFixed(2);

  const startRef = useRef<{ y: number; v: number } | null>(null);
  const [held, setHeld] = useState(false);
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    startRef.current = { y: e.clientY, v: value };
    setHeld(true);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!startRef.current) return;
    const dy = startRef.current.y - e.clientY; // up = +
    const range = max - min;
    const fast = e.shiftKey ? 0.25 : 1;
    const delta = (dy / 140) * range * fast;
    let next = startRef.current.v + delta;
    next = Math.max(min, Math.min(max, next));
    if (step >= 1) next = Math.round(next);
    else next = Math.round(next / step) * step;
    onChange(next);
  };
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.releasePointerCapture(e.pointerId);
    startRef.current = null;
    setHeld(false);
  };
  const onWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    const range = max - min;
    const delta = (-Math.sign(e.deltaY)) * (e.shiftKey ? range * 0.005 : range * 0.025);
    let next = value + delta;
    next = Math.max(min, Math.min(max, next));
    if (step >= 1) next = Math.round(next);
    else next = Math.round(next / step) * step;
    onChange(next);
  };

  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center",
      gap: 4, userSelect: "none", padding: "2px 4px",
      // v1.2.50 — hold-to-magnify: while a knob is being dragged it
      // pops to 1.9× and lifts above siblings so the value/indicator
      // are huge and easy to read with a thumb. Snaps back on release.
      transform: held ? "scale(1.9)" : "scale(1)",
      transformOrigin: "center center",
      transition: "transform 180ms cubic-bezier(.2,.9,.25,1.1), filter 180ms ease",
      zIndex: held ? 50 : 1,
      position: "relative",
      filter: held ? "drop-shadow(0 8px 18px rgba(176,20,240,0.55))" : "none",
      willChange: "transform",
    }}>
      {/* Label above (engraved) */}
      <div style={{
        fontSize: 8, letterSpacing: "1.4px", textTransform: "uppercase",
        color: "rgba(243,238,255,0.78)", fontFamily: "'Courier New',monospace",
        textShadow: "0 1px 0 rgba(0,0,0,0.7), 0 -1px 0 rgba(255,255,255,0.05)",
        whiteSpace: "nowrap",
      }}>{label}</div>

      {/* Knob body */}
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
        onDoubleClick={() => onChange(defaultValue)}
        title={`${label}: ${display}  (drag · wheel · dbl-click resets)`}
        style={{
          position: "relative",
          width: size, height: size,
          cursor: "ns-resize",
          touchAction: "none",
          borderRadius: "50%",
          // Outer bezel ring (dark)
          background: `
            radial-gradient(circle at 50% 35%, #6A6A78 0%, #2A2A33 55%, #0E0E14 100%),
            conic-gradient(from -135deg, rgba(231,174,255,0.85) 0deg, rgba(231,174,255,0.85) ${pct * 270}deg, rgba(0,0,0,0.55) ${pct * 270}deg, rgba(0,0,0,0.55) 270deg, transparent 270deg)
          `,
          backgroundClip: "padding-box",
          boxShadow: `
            0 4px 8px rgba(0,0,0,0.7),
            inset 0 2px 2px rgba(255,255,255,0.18),
            inset 0 -2px 3px rgba(0,0,0,0.6),
            0 0 0 1px rgba(0,0,0,0.6)
          `,
        }}
      >
        {/* Active arc indicator (thin lilac ring filling clockwise) */}
        <svg
          width={size} height={size}
          viewBox="0 0 100 100"
          style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
        >
          {/* Track */}
          <path
            d="M 18.93 81.07 A 45 45 0 1 1 81.07 81.07"
            fill="none"
            stroke="rgba(0,0,0,0.55)"
            strokeWidth="3"
            strokeLinecap="round"
          />
          {/* Active fill */}
          <path
            d="M 18.93 81.07 A 45 45 0 1 1 81.07 81.07"
            fill="none"
            stroke="rgba(231,174,255,0.85)"
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray="212"
            strokeDashoffset={212 * (1 - pct)}
            style={{ filter: "drop-shadow(0 0 3px rgba(176,20,240,0.65))" }}
          />
        </svg>

        {/* Inner chrome cap with indicator line */}
        <div style={{
          position: "absolute",
          left: "16%", top: "16%", width: "68%", height: "68%",
          borderRadius: "50%",
          background: `
            radial-gradient(circle at 35% 25%, #F4F4F8 0%, #BFBFC8 25%, #6E6E78 60%, #2C2C34 100%)
          `,
          boxShadow: `
            inset 0 2px 3px rgba(255,255,255,0.45),
            inset 0 -2px 4px rgba(0,0,0,0.55),
            0 1px 2px rgba(0,0,0,0.6)
          `,
          transform: `rotate(${angle}deg)`,
          transition: "transform 0.04s linear",
        }}>
          {/* Indicator line */}
          <div style={{
            position: "absolute",
            left: "50%", top: "8%",
            width: 2, height: "32%",
            marginLeft: -1,
            background: "linear-gradient(180deg, #1A0224 0%, #3A0852 100%)",
            borderRadius: 1,
            boxShadow: "0 0 4px rgba(176,20,240,0.7), 0 1px 0 rgba(255,255,255,0.25)",
          }}/>
        </div>
      </div>

      {/* Value LCD readout */}
      <div style={{
        fontSize: 9, fontFamily: "'Courier New',monospace",
        letterSpacing: "0.5px",
        color: "rgba(255,210,140,0.95)",
        background: "linear-gradient(180deg, #0A0312 0%, #160726 100%)",
        border: "1px solid rgba(0,0,0,0.55)",
        borderTop: "1px solid rgba(255,255,255,0.05)",
        padding: "1px 6px",
        borderRadius: 3,
        minWidth: 36,
        textAlign: "center",
        textShadow: "0 0 5px rgba(232,160,32,0.55)",
        boxShadow: "inset 0 1px 2px rgba(0,0,0,0.6)",
      }}>{display}</div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────
// ModeRack — schema-driven per-mode parameter rack (Phase 1C)
// ───────────────────────────────────────────────────────────────────────
function ModeRack({
  modeId,
  values,
  onChange,
  onReset,
  onApplyPreset,
}: {
  modeId: ModeId;
  values: Record<string, number>;
  onChange: (key: string, val: number) => void;
  onReset: () => void;
  onApplyPreset: (preset: ModePreset) => void;
}) {
  const schema = MODE_SCHEMAS[modeId];
  const presets = MODE_PRESETS[modeId] ?? [];
  const modeMeta = MODES.find(m => m.id === modeId);
  const title = modeMeta ? `${modeMeta.short}` : `MODE ${modeId}`;
  const subtitle = modeMeta?.label ?? "";
  if (!schema || schema.length === 0) return null;
  const numKnobs = schema.filter(p => p.kind === "num");
  const enums = schema.filter(p => p.kind === "enum");
  return (
    <div style={{
      margin: "0 10px 12px",
      borderRadius: 12,
      overflow: "hidden",
      // Deep purple chassis (Minimoog Voyager purple) with raised metal trim.
      background: "linear-gradient(180deg, #2A0A4A 0%, #1A0530 100%)",
      border: "1px solid #0A0118",
      boxShadow: `
        0 6px 18px rgba(0,0,0,0.7),
        inset 0 1px 0 rgba(231,174,255,0.22),
        inset 0 -3px 6px rgba(0,0,0,0.5)
      `,
      padding: 4,
    }}>
      {/* Inner brushed metal panel */}
      <div style={{
        borderRadius: 8,
        overflow: "hidden",
        background: [
          "repeating-linear-gradient(90deg, rgba(255,255,255,0.025) 0 1px, transparent 1px 3px)",
          "linear-gradient(180deg, #1C1C22 0%, #0E0E14 100%)",
        ].join(", "),
        border: "1px solid rgba(0,0,0,0.7)",
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.05), inset 0 -1px 0 rgba(0,0,0,0.6)",
      }}>
        {/* Title strip */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "6px 10px",
          borderBottom: "1px solid rgba(0,0,0,0.6)",
          background: "linear-gradient(180deg, rgba(231,174,255,0.06) 0%, transparent 100%)",
        }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, minWidth: 0 }}>
            <span style={{
              fontSize: 11, letterSpacing: "2px",
              color: "rgba(255,210,140,0.95)",
              textTransform: "uppercase", fontWeight: "bold",
              textShadow: "0 1px 0 rgba(0,0,0,0.7), 0 0 8px rgba(232,160,32,0.3)",
            }}>{title}</span>
            <span style={{
              fontSize: 8, letterSpacing: "1.4px",
              color: "rgba(231,174,255,0.55)",
              textTransform: "uppercase",
              whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
            }}>{subtitle}</span>
          </div>
          <button
            onClick={onReset}
            title="Reset to defaults"
            style={{
              fontSize: 8, letterSpacing: "1px",
              padding: "3px 8px", cursor: "pointer",
              background: "linear-gradient(180deg, #4A4A55 0%, #1E1E26 100%)",
              color: "rgba(243,238,255,0.92)",
              border: "1px solid rgba(0,0,0,0.7)",
              borderTop: "1px solid rgba(255,255,255,0.15)",
              borderRadius: 4,
              boxShadow: "inset 0 1px 0 rgba(255,255,255,0.1), 0 1px 2px rgba(0,0,0,0.5)",
              textShadow: "0 1px 0 rgba(0,0,0,0.6)",
              textTransform: "uppercase",
            }}
          >↺ RESET</button>
        </div>

        {/* Preset chips (lit backlit pill buttons) */}
        {presets.length > 0 && (
          <div style={{
            padding: "6px 10px",
            display: "flex", flexWrap: "wrap", gap: 5,
            background: "linear-gradient(180deg, rgba(0,0,0,0.4) 0%, rgba(0,0,0,0.15) 100%)",
            borderBottom: "1px solid rgba(0,0,0,0.5)",
          }}>
            {presets.map((p) => (
              <button
                key={p.name}
                onClick={() => onApplyPreset(p)}
                title={`Preset: ${p.name}`}
                style={{
                  fontSize: 8, letterSpacing: "1px",
                  padding: "3px 9px", cursor: "pointer",
                  background: "linear-gradient(180deg, #3A3A45 0%, #16161C 100%)",
                  color: "rgba(255,210,140,0.92)",
                  border: "1px solid rgba(0,0,0,0.7)",
                  borderTop: "1px solid rgba(255,255,255,0.12)",
                  borderRadius: 10,
                  textTransform: "uppercase",
                  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.08), 0 1px 2px rgba(0,0,0,0.5)",
                  textShadow: "0 0 4px rgba(232,160,32,0.4), 0 1px 0 rgba(0,0,0,0.6)",
                }}
              >{p.name}</button>
            ))}
          </div>
        )}

        {/* Knob rail */}
        {numKnobs.length > 0 && (
          <div style={{
            display: "flex", flexWrap: "wrap",
            justifyContent: numKnobs.length <= 2 ? "flex-start" : "space-around",
            alignItems: "flex-start",
            gap: 10,
            padding: "12px 12px 14px",
            background: [
              "radial-gradient(ellipse at 50% 0%, rgba(231,174,255,0.05) 0%, transparent 60%)",
              "linear-gradient(180deg, #1A1A22 0%, #0A0A10 100%)",
            ].join(", "),
            borderBottom: enums.length > 0 ? "1px solid rgba(0,0,0,0.5)" : "none",
          }}>
            {numKnobs.map((p) => {
              if (p.kind !== "num") return null;
              return (
                <Knob
                  key={p.id}
                  label={p.label}
                  value={values[p.id] ?? p.default}
                  min={p.min}
                  max={p.max}
                  step={p.step}
                  defaultValue={p.default}
                  onChange={(v) => onChange(p.id, v)}
                />
              );
            })}
          </div>
        )}

        {/* Switch sections (enums as labeled segmented buttons) */}
        {enums.map((p) => {
          if (p.kind !== "enum") return null;
          const current = Math.round(values[p.id] ?? p.default);
          return (
            <div key={p.id} style={{
              padding: "8px 10px",
              background: "linear-gradient(180deg, #16161C 0%, #0A0A10 100%)",
              borderTop: "1px solid rgba(255,255,255,0.04)",
              borderBottom: "1px solid rgba(0,0,0,0.5)",
            }}>
              <div style={{
                fontSize: 8, letterSpacing: "1.4px",
                color: "rgba(243,238,255,0.7)",
                fontFamily: "'Courier New',monospace",
                textTransform: "uppercase",
                marginBottom: 5,
                textShadow: "0 1px 0 rgba(0,0,0,0.6)",
              }}>{p.label}</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                {p.options.map((opt, idx) => (
                  <button
                    key={`${p.id}-${idx}`}
                    onClick={() => onChange(p.id, idx)}
                    style={{
                      fontSize: 8, letterSpacing: "0.9px",
                      padding: "5px 10px", cursor: "pointer",
                      background: current === idx
                        ? "linear-gradient(180deg, rgba(255,210,140,0.55) 0%, rgba(200,134,10,0.4) 100%)"
                        : "linear-gradient(180deg, #2A2A33 0%, #0E0E14 100%)",
                      color: current === idx ? "#0A0118" : "rgba(231,174,255,0.85)",
                      border: "1px solid rgba(0,0,0,0.7)",
                      borderTop: current === idx
                        ? "1px solid rgba(255,255,255,0.3)"
                        : "1px solid rgba(255,255,255,0.1)",
                      borderRadius: 4,
                      textTransform: "uppercase",
                      boxShadow: current === idx
                        ? "0 0 10px rgba(232,160,32,0.5), inset 0 1px 0 rgba(255,255,255,0.3)"
                        : "inset 0 1px 0 rgba(255,255,255,0.06), 0 1px 2px rgba(0,0,0,0.5)",
                      textShadow: current === idx
                        ? "0 1px 0 rgba(255,255,255,0.3)"
                        : "0 1px 0 rgba(0,0,0,0.6)",
                      fontWeight: current === idx ? "bold" : "normal",
                    }}
                  >{opt}</button>
                ))}
              </div>
            </div>
          );
        })}

        {modeId === 9 && (
          <div style={{
            padding: "5px 10px",
            fontSize: 8, letterSpacing: "1px",
            color: "rgba(231,174,255,0.5)",
            textTransform: "uppercase",
            background: "rgba(0,0,0,0.35)",
          }}>
            Note: shader-only datamosh approximation.
          </div>
        )}
      </div>
    </div>
  );
}
// Legacy components — retained for backward compat with imported presets but
// no longer rendered in the stripped PXL+MOSH+GEN UI.
void SliderRow;
void ModeRack;


