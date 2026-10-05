// gps-engine / uniforms
//
// The params → uniform mapping, lifted from SpectraAfter.tsx 7601–7720 and
// kept numerically identical (including the audio-gate curves added in
// v1.2.53 and the datamosh linear map from v1.2.68). This is a pure
// function of (params, frame) so the parity harness can pin it.

import type { GL } from "./gl-context";
import type { EngineParams } from "./types";

/** Verbatim from SpectraAfter.tsx 6074–6089 (order preserved). */
export const UNIFORM_NAMES = [
  "uCamera", "uPrevFrame", "uMode", "uTime", "uResolution", "uVideoSize",
  "uGain", "uMirror", "uTouch", "uTouchActive", "uAudio",
  "uBrightness", "uContrast", "uSaturation", "uHueShift", "uScanlines", "uZoom",
  "uSortAmt", "uScanTear", "uBlockGlitch", "uDatamosh", "uChrash", "uMask",
  "uLiquid", "uFeedback", "uContour", "uAscii", "uVenetian",
  "uKaleido", "uDisrupt", "uDisruptCount", "uDisruptSize", "uDisruptContrary",
  "uTile", "uInvert", "uDroste", "uSpiral", "uYantra", "uMandala", "uRosette", "uStarfold", "uHexfold",
  "uSortKey", "uSortLow", "uSortHigh", "uSortSegment", "uSortRandom", "uSortWobble", "uSortMode",
  "uSortInterval", "uSortAngle",
  "uRgbR", "uRgbG", "uRgbB", "uRgbBars", "uRgbSwap",
  "uRupture", "uHSync",
  "uMoshIFrame", "uMoshMotion", "uMoshBleed", "uMoshMap", "uMoshDistort",
  "uFaceActive", "uFaceCenter", "uFaceRadius", "uFaceInvert",
  "uFaceTex", "uFaceTexValid", "uFaceFeather",
  "uGlyph", "uSortMix", "uReact", "uVoroSort", "uGlyphAtlas", "uSortTex",
  "uModeParams[0]",
] as const;

export type UniformLocations = Record<string, WebGLUniformLocation | null>;

/**
 * Every active uniform of the linked program, keyed by name. Arrays report
 * as `name[0]`; an alias without the suffix is added (the shells address
 * `uModeParams` that way). Shader-agnostic: works for the web and mobile
 * shaders alike, whatever uniforms they declare.
 */
export function resolveUniformLocations(gl: GL, program: WebGLProgram): UniformLocations {
  const u: UniformLocations = {};
  const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS) as number;
  for (let i = 0; i < count; i++) {
    const info = gl.getActiveUniform(program, i);
    if (!info) continue;
    const loc = gl.getUniformLocation(program, info.name);
    u[info.name] = loc;
    if (info.name.endsWith("[0]")) u[info.name.slice(0, -3)] = loc;
  }
  return u;
}

/** Fixed texture-unit assignment (never changes after init). */
export const TEX_UNIT = {
  camera: 0,
  prevFrame: 1,
  mask: 2,
  fbo: 3,
  face: 4,
  sort: 5,
  glyphAtlas: 6,
} as const;

/**
 * Sampler uniforms are constant for the program's lifetime, so bind them
 * once. (The legacy loop re-sets three of them per frame through the same
 * cache, which made them no-ops anyway.)
 */
export function bindSamplerUnits(gl: GL, u: UniformLocations): void {
  const set = (name: string, unit: number) => { const l = u[name]; if (l) gl.uniform1i(l, unit); };
  set("uCamera", TEX_UNIT.camera);
  set("uPrevFrame", TEX_UNIT.prevFrame);
  set("uMask", TEX_UNIT.mask);
  set("uFaceTex", TEX_UNIT.face);
  set("uSortTex", TEX_UNIT.sort);
  set("uGlyphAtlas", TEX_UNIT.glyphAtlas);
}

/**
 * Write-through cache so unchanged uniforms cost nothing. Mirrors
 * uniCacheRef: cleared on resize, and uModeParams always uploads.
 */
export class UniformWriter {
  private cache = new Map<WebGLUniformLocation, number | string>();
  constructor(private gl: GL) {}

  clear(): void { this.cache.clear(); }

  f1(loc: WebGLUniformLocation | null, v: number): void {
    if (!loc || this.cache.get(loc) === v) return;
    this.cache.set(loc, v);
    this.gl.uniform1f(loc, v);
  }
  f2(loc: WebGLUniformLocation | null, x: number, y: number): void {
    if (!loc) return;
    const key = x + "," + y;
    if (this.cache.get(loc) === key) return;
    this.cache.set(loc, key);
    this.gl.uniform2f(loc, x, y);
  }
  i1(loc: WebGLUniformLocation | null, v: number): void {
    if (!loc || this.cache.get(loc) === v) return;
    this.cache.set(loc, v);
    this.gl.uniform1i(loc, v);
  }
  fv(loc: WebGLUniformLocation | null, arr: ArrayLike<number>): void {
    if (!loc) return;
    this.gl.uniform1fv(loc, arr as Float32List);
  }

  // The shells' uniform blocks were written against local helpers named
  // setF1 / setF2 / setI1 / setFv; expose the same names so those blocks
  // move into render({ uniforms }) verbatim.
  setF1 = (loc: WebGLUniformLocation | null, v: number): void => this.f1(loc, v);
  setF2 = (loc: WebGLUniformLocation | null, x: number, y: number): void => this.f2(loc, x, y);
  setI1 = (loc: WebGLUniformLocation | null, v: number): void => this.i1(loc, v);
  setFv = (loc: WebGLUniformLocation | null, arr: ArrayLike<number>): void => this.fv(loc, arr);
}

export interface FrameContext {
  time: number;
  canvasWidth: number;
  canvasHeight: number;
  /** Source dimensions when a video/image source is bound; else undefined. */
  sourceWidth?: number;
  sourceHeight?: number;
}

/** Face feather is a constant in the shipped app (7704). */
const FACE_FEATHER = 0.06;

/**
 * Apply every per-frame uniform. Numerically identical to the legacy block;
 * comments cite the original lines where a mapping is non-obvious.
 */
export function applyFrameUniforms(
  w: UniformWriter,
  u: UniformLocations,
  p: EngineParams,
  f: FrameContext,
): void {
  const hasSrc = f.sourceWidth !== undefined && f.sourceHeight !== undefined;

  w.f1(u.uTime, f.time);
  w.f2(u.uResolution, f.canvasWidth, f.canvasHeight);
  w.f2(u.uVideoSize, hasSrc ? f.sourceWidth! : f.canvasWidth, hasSrc ? f.sourceHeight! : f.canvasHeight);
  w.f1(u.uMirror, p.mirror ? 1.0 : 0.0);
  w.f2(u.uTouch, p.touch.x, p.touch.y);
  w.f1(u.uTouchActive, p.touch.active ? 1.0 : 0.0);
  w.f1(u.uAudio, p.audio.level || 0.0);
  w.f1(u.uBrightness, p.brightness);
  w.f1(u.uContrast, p.contrast);
  w.f1(u.uSaturation, p.saturation);
  w.f1(u.uHueShift, p.hueShift);
  w.f1(u.uScanlines, p.scanlines);
  w.f1(u.uZoom, p.zoom);

  // v1.2.53 audio gate for the PIXEL SORT + DATAMOSH racks (7622–7627).
  const aGate = Math.min(1.0, p.audio.bass * 1.4 + p.audio.beat * 0.9 + p.audio.level * 0.5);
  const sortAudio = Math.min(1.0, p.sortAmt * (1 + aGate * 0.7) + aGate * 0.18);
  w.f1(u.uSortAmt, sortAudio);
  w.f1(u.uScanTear, p.scanTear);
  w.f1(u.uBlockGlitch, p.blockGlitch);

  // v1.2.68 linear datamosh map (7642–7650). HARD: 0.25..5.25, SOFT: 0..3.2,
  // then audio-pulsed and capped at the HARD ceiling.
  const dmBase = Math.max(0, p.datamosh);
  let dmMapped = p.moshHard ? dmBase * 2.5 + 0.25 : dmBase * 1.6;
  dmMapped = Math.min(5.5, dmMapped * (1 + aGate * 0.55) + aGate * 0.22);
  w.f1(u.uDatamosh, dmMapped);
  w.f1(u.uChrash, p.chrash);
  w.f1(u.uLiquid, p.liquid);

  w.f1(u.uGlyph, p.glyph);
  w.f1(u.uSortMix, p.sortMix);
  w.f1(u.uReact, p.reactD);
  w.f1(u.uVoroSort, p.voroSort);
  w.f1(u.uFeedback, p.feedback);
  w.f1(u.uContour, p.contour);
  w.f1(u.uAscii, p.ascii);
  w.f1(u.uVenetian, p.venetian);
  w.f1(u.uKaleido, p.kaleido);
  w.f1(u.uTile, p.tile);
  w.f1(u.uInvert, p.invertSym);
  w.f1(u.uDroste, p.droste);
  w.f1(u.uSpiral, p.spiral);
  w.f1(u.uYantra, p.yantra);
  w.f1(u.uMandala, p.mandala);
  w.f1(u.uRosette, p.rosette);
  w.f1(u.uStarfold, p.starfold);
  w.f1(u.uHexfold, p.hexfold);
  w.f1(u.uDisrupt, p.disrupt);
  w.f1(u.uDisruptCount, p.disruptCount);
  w.f1(u.uDisruptSize, p.disruptSize);
  w.f1(u.uDisruptContrary, p.disruptContrary);
  w.f1(u.uSortKey, p.sortKey);
  w.f1(u.uSortLow, p.sortLow);
  w.f1(u.uSortHigh, p.sortHigh);
  w.f1(u.uSortMode, p.sortMode);
  w.f1(u.uSortSegment, p.sortSegment);
  w.f1(u.uSortRandom, p.sortRandom);
  w.f1(u.uSortWobble, p.sortWobble);
  w.f1(u.uSortInterval, p.sortInterval);
  w.f1(u.uSortAngle, p.sortAngle);
  w.f1(u.uRgbR, p.rgbR);
  w.f1(u.uRgbG, p.rgbG);
  w.f1(u.uRgbB, p.rgbB);
  w.f1(u.uRgbBars, p.rgbBars);
  w.f1(u.uRgbSwap, p.rgbSwap);
  w.f1(u.uRupture, p.rupture);
  w.f1(u.uHSync, p.hsync);
  w.f1(u.uMoshIFrame, p.moshIFrame);
  w.f1(u.uMoshMotion, p.moshMotion);
  w.f1(u.uMoshBleed, p.moshBleed);
  w.f1(u.uMoshMap, p.moshMap);
  w.f1(u.uMoshDistort, p.moshDistort);

  w.f1(u.uFaceActive, p.face.active ? 1.0 : 0.0);
  w.f1(u.uFaceTexValid, p.face.texValid ? 1.0 : 0.0);
  w.f2(u.uFaceCenter, p.face.cx, p.face.cy);
  w.f1(u.uFaceRadius, p.face.r);
  w.f1(u.uFaceInvert, p.face.invert ? 1.0 : 0.0);
  w.f1(u.uFaceFeather, FACE_FEATHER);

  // Per-mode rack params: always uploaded (7715).
  w.fv(u.uModeParams, p.modeParams);

  w.i1(u.uMode, p.mode);
  w.f1(u.uGain, p.gain);
}
