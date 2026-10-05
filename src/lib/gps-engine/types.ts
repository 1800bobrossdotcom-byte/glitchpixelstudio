// gps-engine / types
//
// The contract between the framework-free renderer and whatever shell hosts
// it (the lovebeing web page, the Capacitor spectra-app). The engine owns
// rendering: textures, the half-float ping-pong, present + dither, the GPU
// sort, the frame scheduler. The SHELL owns the knob → uniform semantics
// (macros, presets, audio gates): it writes uniforms through a callback on
// every render(). EngineParams + applyFrameUniforms (uniforms.ts) are the
// lovebeing web shell's mapping, kept as a convenience; other shells bring
// their own block.

import type { UniformLocations, UniformWriter } from "./uniforms";

export type FeedbackSource =
  /** uPrevFrame = the previous *camera* frame. This is what shipped
   *  (the rendered-frame copy was being discarded). Use for exact parity. */
  | "camera"
  /** uPrevFrame = the previous *rendered* frame, kept in the half-float
   *  ping-pong. True temporal feedback; where RGBA16F precision pays off. */
  | "rendered";

export interface FaceParams {
  active: boolean;
  texValid: boolean;
  cx: number;
  cy: number;
  r: number;
  invert: boolean;
}

export interface TouchParams {
  x: number;
  y: number;
  active: boolean;
}

export interface AudioParams {
  /** RMS level → uAudio, and part of the sort/mosh audio gate. */
  level: number;
  bass: number;
  beat: number;
}

/** The lovebeing web shell's knob set (mirrors its refs, minus the "Ref"). */
export interface EngineParams {
  /** uMode (int). The shell decides the effective mode (incl. combo → 0). */
  mode: number;
  /** uGain */
  gain: number;
  /** uModeParams[8] — packed by the shell's packParams(mode, …). */
  modeParams: ArrayLike<number>;

  /** uMirror — camera active AND facing the user. */
  mirror: boolean;
  touch: TouchParams;
  audio: AudioParams;
  face: FaceParams;

  brightness: number;
  contrast: number;
  saturation: number;
  hueShift: number;
  scanlines: number;
  zoom: number;

  sortAmt: number;
  scanTear: number;
  blockGlitch: number;
  /** Datamosh INTENS slider, 0..2 (mapped in uniforms.ts). */
  datamosh: number;
  /** Datamosh HARD toggle — selects the intensity curve. */
  moshHard: boolean;
  chrash: number;
  liquid: number;
  glyph: number;
  /** REALSORT: cross-fade to the sort texture. */
  sortMix: number;
  reactD: number;
  voroSort: number;
  /** Zoom+rotate feedback tunnel rack (a knob, distinct from FeedbackSource). */
  feedback: number;
  contour: number;
  ascii: number;
  venetian: number;
  kaleido: number;
  tile: number;
  invertSym: number;
  droste: number;
  spiral: number;
  yantra: number;
  mandala: number;
  rosette: number;
  starfold: number;
  hexfold: number;
  disrupt: number;
  disruptCount: number;
  disruptSize: number;
  disruptContrary: number;
  sortKey: number;
  sortLow: number;
  sortHigh: number;
  sortMode: number;
  sortSegment: number;
  sortRandom: number;
  sortWobble: number;
  sortInterval: number;
  sortAngle: number;
  rgbR: number;
  rgbG: number;
  rgbB: number;
  rgbBars: number;
  rgbSwap: number;
  rupture: number;
  hsync: number;
  moshIFrame: number;
  moshMotion: number;
  moshBleed: number;
  moshMap: number;
  moshDistort: number;
}

/** Anything texImage2D accepts — video, image, canvas, bitmap. */
export type TexSource = TexImageSource;

export interface ViewportSpec {
  /** CSS-pixel size of the canvas element (from getBoundingClientRect). */
  cssWidth: number;
  cssHeight: number;
  /** window.devicePixelRatio (the engine clamps to 2, as shipped). */
  dpr: number;
  /** Adaptive-resolution multiplier, 1.0 = full. */
  scale: number;
}

/** What the engine knows about this frame when the shell writes uniforms. */
export interface FrameInfo {
  canvasWidth: number;
  canvasHeight: number;
  /** Source dimensions when a source is bound; else undefined. */
  sourceWidth?: number;
  sourceHeight?: number;
}

export interface RenderOptions {
  /**
   * REALSORT amount. Gates the GPU sort (run when > 0.001) with the
   * CPU-identical threshold. Default 0.
   */
  sortMix?: number;
  /**
   * The shell's uniform block. Called with the effects program bound, after
   * textures are bound to their units; sampler uniforms are already set.
   * `u` has every active uniform of the program (plus `uModeParams` for
   * `uModeParams[0]`); `w` caches writes (setF1 / setF2 / setI1 / setFv).
   */
  uniforms?: (u: UniformLocations, w: UniformWriter, frame: FrameInfo) => void;
}

export interface EngineOptions {
  preferWebGL2?: boolean;
  /**
   * Effects shader sources (GLSL ES 1.00 — links on WebGL1 and WebGL2).
   * Default: the copies bundled in shaders.ts. The mobile app passes its
   * canonical src/shaders/scene.{vert,frag}.
   */
  shaders?: { vert: string; frag: string };
  /** Default "camera" (= shipped behavior). See FeedbackSource. */
  feedbackSource?: FeedbackSource;
  /**
   * Default true. Exports (composeFrame) drawImage the canvas outside the
   * render tick and need this. Can be dropped once exports read the FBO.
   */
  preserveDrawingBuffer?: boolean;
  /**
   * Run REALSORT (the Asendorf pixel sort) on the GPU when WebGL2 is
   * available. Default true. When off — or on WebGL1 — the shell's CPU
   * tick keeps feeding the sort texture via setSortTexture.
   */
  gpuSort?: boolean;
  /** Internal resolution of the GPU sort. width must be a power of two. Default 512×288. */
  sortSize?: { width: number; height: number };
  /**
   * Ordered output dither (±0.5 LSB) in the present pass, removing banding
   * when quantizing the half-float result to the 8-bit canvas. No effect on
   * WebGL1. Default true.
   */
  outputDither?: boolean;
}

/**
 * Every rack off, post-process at identity. Values match the lovebeing shell's
 * initial React state: gain 0.5, brightness/contrast/saturation 1.0
 * (multiplicative), everything else 0.
 */
export function neutralParams(): EngineParams {
  return {
    mode: 0,
    gain: 0.5,
    modeParams: new Float32Array(8),
    mirror: false,
    touch: { x: 0, y: 0, active: false },
    audio: { level: 0, bass: 0, beat: 0 },
    face: { active: false, texValid: false, cx: 0.5, cy: 0.5, r: 0, invert: false },
    brightness: 1.0,
    contrast: 1.0,
    saturation: 1.0,
    hueShift: 0,
    scanlines: 0,
    zoom: 0,
    sortAmt: 0, scanTear: 0, blockGlitch: 0, datamosh: 0, moshHard: false, chrash: 0, liquid: 0,
    glyph: 0, sortMix: 0, reactD: 0, voroSort: 0, feedback: 0, contour: 0, ascii: 0, venetian: 0,
    kaleido: 0, tile: 0, invertSym: 0, droste: 0, spiral: 0, yantra: 0, mandala: 0, rosette: 0,
    starfold: 0, hexfold: 0,
    disrupt: 0, disruptCount: 0, disruptSize: 0, disruptContrary: 0,
    sortKey: 0, sortLow: 0, sortHigh: 0, sortMode: 0, sortSegment: 0, sortRandom: 0, sortWobble: 0,
    sortInterval: 0, sortAngle: 0,
    rgbR: 0, rgbG: 0, rgbB: 0, rgbBars: 0, rgbSwap: 0,
    rupture: 0, hsync: 0,
    moshIFrame: 0, moshMotion: 0, moshBleed: 0, moshMap: 0, moshDistort: 0,
  };
}
