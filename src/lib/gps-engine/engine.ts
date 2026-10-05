// gps-engine / engine
//
// The per-frame core lifted from the app shells' `render`, minus everything
// that is app logic. The shell produces the source (camera / upload /
// generator), feeds textures in (setSource / setMask / …) and writes its
// effect uniforms through render({ uniforms }); the engine does the rest:
//
// Frame = [effects pass → ping-pong.write (RGBA16F on WebGL2)]
//       + [present pass (+ ordered dither) → canvas]
//       + swap.
// uPrevFrame is the ping-pong read target ("rendered") or the other camera
// texture ("camera", the shipped behavior). No copyTexSubImage2D anywhere.

import {
  createGLContext,
  linkProgram,
  createTexture,
  createPingPong,
  createFullscreenQuad,
  type GL,
  type GLCaps,
  type PingPong,
} from "./gl-context";
import { VERT_SRC, FRAG_SRC, PRESENT_FRAG_SRC } from "./shaders";
import { createGpuSort, sortThreshold, type GpuSort } from "./gpu-sort";
import { resolveUniformLocations, bindSamplerUnits, UniformWriter, TEX_UNIT, type UniformLocations } from "./uniforms";
import type { EngineOptions, FeedbackSource, FrameInfo, RenderOptions, TexSource, ViewportSpec } from "./types";

/** Unit for the present pass's sampler, above the seven effects units. */
const PRESENT_UNIT = 7;

export interface Engine {
  readonly caps: GLCaps;
  /** True when feedback accumulates in RGBA16F (WebGL2 + float ext). */
  readonly halfFloatFeedback: boolean;
  /**
   * True when REALSORT runs on the GPU (WebGL2). The shell must then skip
   * its CPU Asendorf tick and setSortTexture — the engine sorts the current
   * source itself whenever render({ sortMix }) > 0.001.
   */
  readonly gpuSortActive: boolean;
  /**
   * ±0.5 LSB ordered dither in the present pass. Effective only on the
   * half-float path (WebGL2); on WebGL1 the output is already 8-bit and the
   * engine leaves it untouched. Default true.
   */
  outputDither: boolean;
  /** Backing-store size in device pixels (after resize). */
  readonly width: number;
  readonly height: number;
  feedbackSource: FeedbackSource;
  /** Every active uniform of the effects program, plus `uModeParams` for `uModeParams[0]`. */
  readonly uniforms: UniformLocations;

  /**
   * Camera / upload / generator frame. Re-uploaded on every render().
   * `width`/`height` are reported back to the shell as the source size;
   * texture reallocation is detected from the element's own
   * videoWidth/width, exactly as shipped.
   */
  setSource(src: TexSource | null, width: number, height: number): void;
  /** Force the next render to re-seed both camera textures (source swapped). */
  resetSource(): void;
  /** Touch-paint mask. Returns false if the driver rejected the upload. */
  setMask(src: TexSource, width: number, height: number): boolean;
  /** Person/face segmentation mask (R channel). Call from the seg loop. */
  setFaceMask(src: TexSource): void;
  /** CPU Asendorf sort result (NEAREST-filtered). WebGL1 fallback only. */
  setSortTexture(src: TexSource): void;
  /** 256×256 ASCII glyph atlas. Once. */
  setGlyphAtlas(src: TexSource): void;

  resize(view: ViewportSpec): { width: number; height: number };
  render(opts?: RenderOptions): void;
  dispose(): void;
}

export type CreateEngineResult =
  | { ok: true; engine: Engine }
  | { ok: false; error: string };

function black1x1(gl: GL, tex: WebGLTexture): void {
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
}

export function createEngine(
  canvas: HTMLCanvasElement | OffscreenCanvas,
  opts: EngineOptions = {},
): CreateEngineResult {
  const ctx = createGLContext(canvas, {
    preferWebGL2: opts.preferWebGL2,
    preserveDrawingBuffer: opts.preserveDrawingBuffer,
  });
  if (!ctx) return { ok: false, error: "WebGL not supported on this device." };
  const { gl, caps } = ctx;

  // ── programs ───────────────────────────────────────────────────────
  const vertSrc = opts.shaders?.vert ?? VERT_SRC;
  const fragSrc = opts.shaders?.frag ?? FRAG_SRC;
  const fx = linkProgram(gl, vertSrc, fragSrc);
  if (!fx.ok) return { ok: false, error: `Shader compile error: ${fx.error}` };
  const present = linkProgram(gl, VERT_SRC, PRESENT_FRAG_SRC);
  if (!present.ok) {
    gl.deleteProgram(fx.program);
    return { ok: false, error: `Present shader error: ${present.error}` };
  }

  const u: UniformLocations = resolveUniformLocations(gl, fx.program);
  const writer = new UniformWriter(gl);
  gl.useProgram(fx.program);
  bindSamplerUnits(gl, u);
  const fxQuad = createFullscreenQuad(gl, gl.getAttribLocation(fx.program, "aPosition"));

  gl.useProgram(present.program);
  const presentTexLoc = gl.getUniformLocation(present.program, "uTex");
  if (presentTexLoc) gl.uniform1i(presentTexLoc, PRESENT_UNIT);
  const presentDitherLoc = gl.getUniformLocation(present.program, "uDither");
  const presentQuad = createFullscreenQuad(gl, gl.getAttribLocation(present.program, "aPosition"));

  // ── textures (all CLAMP_TO_EDGE + LINEAR, sort is NEAREST — as shipped) ──
  const cam: [WebGLTexture, WebGLTexture] = [createTexture(gl), createTexture(gl)];
  const maskTex = createTexture(gl);
  const faceTex = createTexture(gl);
  const sortTex = createTexture(gl, { filter: gl.NEAREST });
  const glyphTex = createTexture(gl);
  black1x1(gl, cam[0]);
  black1x1(gl, cam[1]);
  black1x1(gl, faceTex);
  black1x1(gl, sortTex);
  black1x1(gl, glyphTex);
  // Mask starts as an empty 256×256, matching the paint canvas size.
  gl.bindTexture(gl.TEXTURE_2D, maskTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 256, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  let maskW = 256;
  let maskH = 256;
  let faceW = 1;
  let faceH = 1;

  // ── GPU REALSORT (WebGL2 only; otherwise the shell's CPU tick feeds sortTex) ──
  let gpuSort: GpuSort | null = null;
  if (caps.isWebGL2 && (opts.gpuSort ?? true)) {
    const r = createGpuSort(gl as WebGL2RenderingContext, opts.sortSize?.width ?? 512, opts.sortSize?.height ?? 288);
    if (r.ok) gpuSort = r.sort;
    else console.warn("[gps-engine] GPU sort unavailable, using CPU path:", r.error);
  }

  // ── feedback ping-pong (the old fa/fb pair, now actually used) ──────
  let width = Math.max(1, canvas.width);
  let height = Math.max(1, canvas.height);
  const pp: PingPong = createPingPong(gl, width, height, ctx.feedbackFormat);
  const halfFloatFeedback = pp.format.type !== gl.UNSIGNED_BYTE;
  // Output dither only has something to work with when the source of the
  // present pass is wider than 8 bits.
  let outputDither = opts.outputDither ?? true;

  // ── per-frame state ────────────────────────────────────────────────
  let feedbackSource: FeedbackSource = opts.feedbackSource ?? "camera";
  let camIdx = 0;
  let source: TexSource | null = null;
  let srcW = 0;
  let srcH = 0;
  let firstFrame = true; // first upload goes to BOTH camera textures
  let sizedW = 0;
  let sizedH = 0;
  let disposed = false;

  const bind = (unit: number, tex: WebGLTexture) => {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
  };

  const engine: Engine = {
    caps,
    halfFloatFeedback,
    gpuSortActive: gpuSort !== null,
    uniforms: u,
    get width() { return width; },
    get height() { return height; },
    get feedbackSource() { return feedbackSource; },
    set feedbackSource(v) { feedbackSource = v; },
    get outputDither() { return outputDither; },
    set outputDither(v) { outputDither = v; },

    setSource(src, w, h) {
      source = src;
      srcW = w;
      srcH = h;
    },

    resetSource() {
      firstFrame = true;
    },

    setMask(src, w, h) {
      try {
        bind(TEX_UNIT.mask, maskTex);
        if (w !== maskW || h !== maskH) {
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
          maskW = w;
          maskH = h;
        } else {
          gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, src);
        }
        return true;
      } catch {
        return false; // shell disables touch FX on driver error
      }
    },

    setFaceMask(src) {
      bind(TEX_UNIT.face, faceTex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      // Seed with texImage2D when the mask geometry changes (rare), then
      // update in place — the mobile app's v1.3.30 fast path.
      const el = src as { videoWidth?: number; videoHeight?: number; width?: number; height?: number };
      const w = el.videoWidth ?? el.width ?? 0;
      const h = el.videoHeight ?? el.height ?? 0;
      if (w !== faceW || h !== faceH) {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
        faceW = w;
        faceH = h;
      } else {
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, src);
      }
    },

    setSortTexture(src) {
      bind(TEX_UNIT.sort, sortTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    },

    setGlyphAtlas(src) {
      bind(TEX_UNIT.glyphAtlas, glyphTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    },

    resize(view) {
      // DPR clamped to 2, then scaled by the adaptive multiplier (as shipped).
      const baseDpr = Math.min(view.dpr || 1, 2);
      const dpr = baseDpr * (view.scale || 1);
      width = Math.max(1, Math.round(view.cssWidth * dpr));
      height = Math.max(1, Math.round(view.cssHeight * dpr));
      canvas.width = width;
      canvas.height = height;
      writer.clear();
      pp.resize(width, height);
      return { width, height };
    },

    render(opts = {}) {
      if (disposed) return;

      // Camera upload: texImage2D seed on first frame / source-size change,
      // texSubImage2D steady state (as shipped).
      const cur = cam[camIdx];
      const other = cam[1 - camIdx];
      if (source) {
        const el = source as { videoWidth?: number; videoHeight?: number; width?: number; height?: number };
        const sw = el.videoWidth ?? el.width ?? 0;
        const sh = el.videoHeight ?? el.height ?? 0;
        const sizeChanged = sw !== sizedW || sh !== sizedH;
        if (firstFrame || sizeChanged) {
          for (let i = 0; i < 2; i++) {
            bind(i, cam[i]);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
          }
          firstFrame = false;
          sizedW = sw;
          sizedH = sh;
        } else {
          bind(TEX_UNIT.camera, cur);
          gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, source);
        }
      }

      // GPU REALSORT: sort the current source (same gate as the CPU tick).
      const sortMix = opts.sortMix ?? 0;
      if (gpuSort && source && sortMix > 0.001) gpuSort.run(cur, sortThreshold(sortMix));

      // Unit bindings for this frame.
      bind(TEX_UNIT.camera, cur);
      bind(TEX_UNIT.prevFrame, feedbackSource === "rendered" ? pp.read.tex : other);
      bind(TEX_UNIT.mask, maskTex);
      bind(TEX_UNIT.face, faceTex);
      bind(TEX_UNIT.sort, gpuSort ? gpuSort.output : sortTex);
      bind(TEX_UNIT.glyphAtlas, glyphTex);

      // Effects pass → ping-pong write target. The shell writes its uniforms
      // with the program bound.
      gl.useProgram(fx.program);
      const frame: FrameInfo = {
        canvasWidth: width,
        canvasHeight: height,
        sourceWidth: source ? srcW : undefined,
        sourceHeight: source ? srcH : undefined,
      };
      opts.uniforms?.(u, writer, frame);
      gl.bindFramebuffer(gl.FRAMEBUFFER, pp.write.fbo);
      gl.viewport(0, 0, width, height);
      fxQuad.draw();

      // Present pass → canvas.
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, width, height);
      gl.useProgram(present.program);
      if (presentDitherLoc) gl.uniform1f(presentDitherLoc, outputDither && halfFloatFeedback ? 1.0 : 0.0);
      bind(PRESENT_UNIT, pp.write.tex);
      presentQuad.draw();

      pp.swap();
      camIdx = 1 - camIdx;
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      gpuSort?.dispose();
      pp.dispose();
      fxQuad.dispose();
      presentQuad.dispose();
      for (const t of [cam[0], cam[1], maskTex, faceTex, sortTex, glyphTex]) gl.deleteTexture(t);
      gl.deleteProgram(fx.program);
      gl.deleteProgram(present.program);
    },
  };

  return { ok: true, engine };
}
