// gps-engine / gpu-sort
//
// The "REALSORT" Asendorf pixel sort on the GPU (WebGL2 only). Reproduces
// the CPU algorithm from SpectraAfter.tsx exactly:
//   - per row, take maximal segments of pixels with luma >= thr;
//   - a run starts at the first pixel with luma > thr in a segment and
//     extends to the segment end (leading luma == thr pixels stay put);
//   - runs are sorted ascending by luma, stable by original x;
//   - everything else keeps its position.
//   luma = (r*76 + g*150 + b*29) >> 8 ;  thr = clamp(floor(200 - sortMix*140), 20, 220)
//
// Rows are independent, so the whole frame is sorted with W-wide
// row-parallel passes. W must be a power of two.
//
//   ingest                   RGBA8  src[x,y]   = sample(source)
//   init                     uint   seg | above<<1 | boundary<<2 | L<<3
//   scanA  x log2(W)         segmented OR of `above`  → member = seg && v
//   startB                   uint   member | L<<3 | groupStart<<11
//   scanB  x log2(W)         prefix sum of groupStart → groupId (bits 11+)
//   keys                     uint   groupId<<(XB+8) | (member ? L<<XB : 0) | x
//   bitonic x log2W(log2W+1)/2   sort keys per row
//   gather                   RGBA8  out[x] = src[key[x] & (W-1)]
//
// Non-members are singleton groups with increasing ids, so sorting the full
// row by key keeps them in place; `x` in the low bits makes the sort stable.
// 68 passes at 512x288 (~10 M fragments) — cheaper than the CPU's 256x144
// at 1/3 frame rate on the main thread, at twice the resolution, every frame.

import { createFullscreenQuad, createTexture, linkProgram, type GL } from "./gl-context";

const VS = `#version 300 es
in vec2 aPosition;
void main() { gl_Position = vec4(aPosition, 0.0, 1.0); }`;

const HEAD = `#version 300 es
precision highp float;
precision highp int;
precision highp usampler2D;
`;

const INGEST_FS = `${HEAD}
uniform sampler2D uSrc;
uniform vec2 uSize;
out vec4 o;
void main() { o = texture(uSrc, gl_FragCoord.xy / uSize); }`;

const LUMA = `
uint lumaAt(sampler2D s, int x, int y) {
  vec3 c = texelFetch(s, ivec2(x, y), 0).rgb;
  uvec3 p = uvec3(c * 255.0 + 0.5);
  return (p.r * 76u + p.g * 150u + p.b * 29u) >> 8u;
}`;

// seg | above<<1 | boundary<<2 | L<<3
const INIT_FS = `${HEAD}
uniform sampler2D uSrc;
uniform int uThr;
out uint o;
${LUMA}
void main() {
  int x = int(gl_FragCoord.x), y = int(gl_FragCoord.y);
  uint thr = uint(uThr);
  uint L = lumaAt(uSrc, x, y);
  bool seg = L >= thr;
  bool above = L > thr;
  // A segmented-scan boundary: non-segment pixels are their own segment;
  // a segment pixel is a boundary when it starts the segment.
  bool boundary = !seg || x == 0 || lumaAt(uSrc, x - 1, y) < thr;
  o = uint(seg) | (uint(above) << 1u) | (uint(boundary) << 2u) | (L << 3u);
}`;

// Hillis–Steele segmented inclusive OR-scan on bit 1, boundaries on bit 2.
const SCAN_A_FS = `${HEAD}
uniform usampler2D uState;
uniform int uOffset;
out uint o;
void main() {
  int x = int(gl_FragCoord.x), y = int(gl_FragCoord.y);
  uint s = texelFetch(uState, ivec2(x, y), 0).r;
  if (x >= uOffset && ((s >> 2u) & 1u) == 0u) {
    uint l = texelFetch(uState, ivec2(x - uOffset, y), 0).r;
    uint v = ((s >> 1u) & 1u) | ((l >> 1u) & 1u);
    uint f = (l >> 2u) & 1u;
    s = (s & ~6u) | (v << 1u) | (f << 2u);
  }
  o = s;
}`;

// member | L<<3 | groupStart<<11
const START_B_FS = `${HEAD}
uniform usampler2D uState;
out uint o;
bool memberOf(uint s) { return (s & 1u) == 1u && ((s >> 1u) & 1u) == 1u; }
void main() {
  int x = int(gl_FragCoord.x), y = int(gl_FragCoord.y);
  uint s = texelFetch(uState, ivec2(x, y), 0).r;
  bool m = memberOf(s);
  bool prev = x > 0 && memberOf(texelFetch(uState, ivec2(x - 1, y), 0).r);
  bool start = !m || !prev;
  o = uint(m) | (((s >> 3u) & 255u) << 3u) | (uint(start) << 11u);
}`;

// Hillis–Steele inclusive prefix sum of bits 11+.
const SCAN_B_FS = `${HEAD}
uniform usampler2D uState;
uniform int uOffset;
out uint o;
void main() {
  int x = int(gl_FragCoord.x), y = int(gl_FragCoord.y);
  uint s = texelFetch(uState, ivec2(x, y), 0).r;
  if (x >= uOffset) {
    uint l = texelFetch(uState, ivec2(x - uOffset, y), 0).r;
    s = (s & 2047u) | (((s >> 11u) + (l >> 11u)) << 11u);
  }
  o = s;
}`;

const KEYS_FS = `${HEAD}
uniform usampler2D uState;
uniform int uXBits;
out uint o;
void main() {
  int x = int(gl_FragCoord.x), y = int(gl_FragCoord.y);
  uint s = texelFetch(uState, ivec2(x, y), 0).r;
  uint xb = uint(uXBits);
  uint groupId = s >> 11u;
  uint L = (s >> 3u) & 255u;
  uint member = s & 1u;
  o = (groupId << (xb + 8u)) | (member == 1u ? (L << xb) : 0u) | uint(x);
}`;

const BITONIC_FS = `${HEAD}
uniform usampler2D uKeys;
uniform int uJ;
uniform int uK;
out uint o;
void main() {
  int x = int(gl_FragCoord.x), y = int(gl_FragCoord.y);
  int partner = x ^ uJ;
  uint a = texelFetch(uKeys, ivec2(x, y), 0).r;
  uint b = texelFetch(uKeys, ivec2(partner, y), 0).r;
  bool asc = (x & uK) == 0;
  bool lower = x < partner;
  o = (lower == asc) ? min(a, b) : max(a, b);
}`;

const GATHER_FS = `${HEAD}
uniform usampler2D uKeys;
uniform sampler2D uSrc;
uniform int uMask;
out vec4 o;
void main() {
  int x = int(gl_FragCoord.x), y = int(gl_FragCoord.y);
  uint key = texelFetch(uKeys, ivec2(x, y), 0).r;
  o = texelFetch(uSrc, ivec2(int(key) & uMask, y), 0);
}`;

export interface GpuSort {
  readonly width: number;
  readonly height: number;
  /** RGBA8 result, NEAREST-filtered — bind this as uSortTex. */
  readonly output: WebGLTexture;
  /** Sort `source` (any 2D texture) with the CPU-identical threshold. */
  run(source: WebGLTexture, thr: number): void;
  dispose(): void;
}

export type GpuSortResult = { ok: true; sort: GpuSort } | { ok: false; error: string };

type Prog = { program: WebGLProgram; u: Record<string, WebGLUniformLocation | null>; attrib: number };

/** thr exactly as the CPU path computes it from the REALSORT knob. */
export function sortThreshold(sortMix: number): number {
  return Math.max(20, Math.min(220, Math.floor(200 - sortMix * 140)));
}

export function createGpuSort(gl: WebGL2RenderingContext, width = 512, height = 288): GpuSortResult {
  if ((width & (width - 1)) !== 0) return { ok: false, error: "gpu-sort: width must be a power of two" };
  const xBits = Math.log2(width);

  const build = (fs: string, uniforms: string[]): Prog | string => {
    const r = linkProgram(gl, VS, fs);
    if (!r.ok) return r.error;
    const u: Record<string, WebGLUniformLocation | null> = {};
    for (const n of uniforms) u[n] = gl.getUniformLocation(r.program, n);
    return { program: r.program, u, attrib: gl.getAttribLocation(r.program, "aPosition") };
  };
  const progs: Prog[] = [];
  const mk = (fs: string, uniforms: string[]) => {
    const p = build(fs, uniforms);
    if (typeof p === "string") throw new Error(p);
    progs.push(p);
    return p;
  };

  let ingest: Prog, init: Prog, scanA: Prog, startB: Prog, scanB: Prog, keys: Prog, bitonic: Prog, gather: Prog;
  try {
    ingest = mk(INGEST_FS, ["uSrc", "uSize"]);
    init = mk(INIT_FS, ["uSrc", "uThr"]);
    scanA = mk(SCAN_A_FS, ["uState", "uOffset"]);
    startB = mk(START_B_FS, ["uState"]);
    scanB = mk(SCAN_B_FS, ["uState", "uOffset"]);
    keys = mk(KEYS_FS, ["uState", "uXBits"]);
    bitonic = mk(BITONIC_FS, ["uKeys", "uJ", "uK"]);
    gather = mk(GATHER_FS, ["uKeys", "uSrc", "uMask"]);
  } catch (e) {
    for (const p of progs) gl.deleteProgram(p.program);
    return { ok: false, error: `gpu-sort: ${String((e as Error).message || e)}` };
  }

  // Integer textures must be NEAREST.
  const uintTex = () => {
    const t = createTexture(gl as GL, { filter: gl.NEAREST });
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32UI, width, height, 0, gl.RED_INTEGER, gl.UNSIGNED_INT, null);
    return t;
  };
  const rgbaTex = () => {
    const t = createTexture(gl as GL, { filter: gl.NEAREST });
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    return t;
  };
  const fboFor = (t: WebGLTexture) => {
    const f = gl.createFramebuffer();
    if (!f) throw new Error("createFramebuffer failed");
    gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (!ok) throw new Error("gpu-sort: framebuffer incomplete");
    return f;
  };

  const src = rgbaTex();
  const out = rgbaTex();
  const stateA = uintTex();
  const stateB = uintTex();
  let fSrc: WebGLFramebuffer, fOut: WebGLFramebuffer, fA: WebGLFramebuffer, fB: WebGLFramebuffer;
  try {
    fSrc = fboFor(src); fOut = fboFor(out); fA = fboFor(stateA); fB = fboFor(stateB);
  } catch (e) {
    for (const p of progs) gl.deleteProgram(p.program);
    for (const t of [src, out, stateA, stateB]) gl.deleteTexture(t);
    return { ok: false, error: String((e as Error).message || e) };
  }

  // Dedicated units so the engine's 0–7 bindings are left alone.
  const U_SRC = 8, U_STATE = 9;

  // Programs may place aPosition at different locations; one quad per location.
  const quads = new Map<number, { draw(): void; dispose(): void }>();
  const quadFor = (attrib: number) => {
    let q = quads.get(attrib);
    if (!q) { q = createFullscreenQuad(gl as GL, attrib); quads.set(attrib, q); }
    return q;
  };

  /** Bind the program first so the uniform writes that follow land on it. */
  const bindProgram = (p: Prog) => { gl.useProgram(p.program); };
  const bindTex = (unit: number, t: WebGLTexture) => { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t); };
  const draw = (p: Prog, target: WebGLFramebuffer) => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, target);
    gl.viewport(0, 0, width, height);
    quadFor(p.attrib).draw();
  };

  const sort: GpuSort = {
    width,
    height,
    output: out,

    run(source, thr) {
      // ingest: source → src (W×H)
      bindProgram(ingest); bindTex(U_SRC, source);
      gl.uniform1i(ingest.u.uSrc, U_SRC); gl.uniform2f(ingest.u.uSize, width, height);
      draw(ingest, fSrc);

      // init → A
      bindProgram(init); bindTex(U_SRC, src);
      gl.uniform1i(init.u.uSrc, U_SRC); gl.uniform1i(init.u.uThr, thr | 0);
      draw(init, fA);

      // scan A (segmented OR): A ↔ B
      let read = stateA, readF = fA, write = stateB, writeF = fB;
      const swap = () => { [read, write] = [write, read]; [readF, writeF] = [writeF, readF]; };
      bindProgram(scanA); gl.uniform1i(scanA.u.uState, U_STATE);
      for (let d = 1; d < width; d <<= 1) {
        bindTex(U_STATE, read); gl.uniform1i(scanA.u.uOffset, d);
        draw(scanA, writeF); swap();
      }

      // start flags for the group scan
      bindProgram(startB); bindTex(U_STATE, read); gl.uniform1i(startB.u.uState, U_STATE);
      draw(startB, writeF); swap();

      // scan B (prefix sum)
      bindProgram(scanB); gl.uniform1i(scanB.u.uState, U_STATE);
      for (let d = 1; d < width; d <<= 1) {
        bindTex(U_STATE, read); gl.uniform1i(scanB.u.uOffset, d);
        draw(scanB, writeF); swap();
      }

      // keys
      bindProgram(keys); bindTex(U_STATE, read);
      gl.uniform1i(keys.u.uState, U_STATE); gl.uniform1i(keys.u.uXBits, xBits);
      draw(keys, writeF); swap();

      // bitonic sort
      bindProgram(bitonic); gl.uniform1i(bitonic.u.uKeys, U_STATE);
      for (let k = 2; k <= width; k <<= 1) {
        for (let j = k >> 1; j > 0; j >>= 1) {
          bindTex(U_STATE, read); gl.uniform1i(bitonic.u.uJ, j); gl.uniform1i(bitonic.u.uK, k);
          draw(bitonic, writeF); swap();
        }
      }

      // gather → out
      bindProgram(gather); bindTex(U_STATE, read); bindTex(U_SRC, src);
      gl.uniform1i(gather.u.uKeys, U_STATE); gl.uniform1i(gather.u.uSrc, U_SRC); gl.uniform1i(gather.u.uMask, width - 1);
      draw(gather, fOut);

      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    },

    dispose() {
      for (const p of progs) gl.deleteProgram(p.program);
      for (const t of [src, out, stateA, stateB]) gl.deleteTexture(t);
      for (const f of [fSrc, fOut, fA, fB]) gl.deleteFramebuffer(f);
      for (const q of quads.values()) q.dispose();
    },
  };
  return { ok: true, sort };
}
