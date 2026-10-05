// gps-engine / gl-context
//
// Framework-free WebGL foundation for the Glitch Pixel Studio renderer.
// No React, no window globals: everything the engine needs is passed in.
//
// - WebGL2 first, WebGL1 fallback (behavior-identical to the legacy path).
// - Feedback/ping-pong attachments are RGBA16F on WebGL2 when renderable,
//   which removes the 8-bit banding that accumulates in TRAILS / GHOST /
//   feedback / mosh. On WebGL1 they stay RGBA8, exactly as shipped today.
// - Shader helpers return errors instead of throwing or touching UI state.

export type GL = WebGL2RenderingContext | WebGLRenderingContext;

export interface GLCaps {
  isWebGL2: boolean;
  /** Half-float color attachments are renderable (banding-free feedback). */
  halfFloatRenderable: boolean;
  maxTextureSize: number;
  renderer: string;
}

export interface TexFormat {
  internal: number;
  format: number;
  type: number;
}

export interface GLContext {
  gl: GL;
  caps: GLCaps;
  /** Format used for feedback / ping-pong attachments. */
  feedbackFormat: TexFormat;
}

export interface GLContextOptions {
  /** Try WebGL2 before WebGL1. Default true. */
  preferWebGL2?: boolean;
  /**
   * Keep the drawing buffer between frames. The legacy renderer needs this
   * (it copies the canvas into prevFrame and reads it back for export), so it
   * defaults to true. Once prevFrame is sourced from the FBO this can be
   * dropped to remove an implicit per-frame copy.
   */
  preserveDrawingBuffer?: boolean;
}

// Mirrors the attributes the shipped app uses (SpectraAfter.tsx getContext).
const BASE_ATTRS: WebGLContextAttributes = {
  premultipliedAlpha: false,
  antialias: false,
  alpha: false,
};

export function createGLContext(
  canvas: HTMLCanvasElement | OffscreenCanvas,
  opts: GLContextOptions = {},
): GLContext | null {
  const attrs: WebGLContextAttributes = {
    ...BASE_ATTRS,
    preserveDrawingBuffer: opts.preserveDrawingBuffer ?? true,
  };

  let gl: GL | null = null;
  if (opts.preferWebGL2 ?? true) {
    gl = canvas.getContext("webgl2", attrs) as WebGL2RenderingContext | null;
  }
  if (!gl) gl = canvas.getContext("webgl", attrs) as WebGLRenderingContext | null;
  if (!gl) return null;

  const isWebGL2 = typeof WebGL2RenderingContext !== "undefined" && gl instanceof WebGL2RenderingContext;

  // RGBA16F is renderable on WebGL2 with either float-buffer extension, and
  // is linear-filterable by default in ES 3.0 (no *_linear ext needed).
  const halfFloatRenderable =
    isWebGL2 &&
    !!(gl.getExtension("EXT_color_buffer_float") || gl.getExtension("EXT_color_buffer_half_float"));

  const dbg = gl.getExtension("WEBGL_debug_renderer_info");
  const renderer = String(
    dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
  );

  const caps: GLCaps = {
    isWebGL2,
    halfFloatRenderable,
    maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE) as number,
    renderer,
  };

  const feedbackFormat: TexFormat = halfFloatRenderable
    ? {
        internal: (gl as WebGL2RenderingContext).RGBA16F,
        format: gl.RGBA,
        type: (gl as WebGL2RenderingContext).HALF_FLOAT,
      }
    : { internal: gl.RGBA, format: gl.RGBA, type: gl.UNSIGNED_BYTE };

  return { gl, caps, feedbackFormat };
}

/** RGBA8 — what every texture in the shipped app uses. Valid on both GL versions. */
export function rgba8(gl: GL): TexFormat {
  return { internal: gl.RGBA, format: gl.RGBA, type: gl.UNSIGNED_BYTE };
}

// ── Shaders ─────────────────────────────────────────────────────────────

export type ShaderResult =
  | { ok: true; program: WebGLProgram }
  | { ok: false; error: string };

export function compileShader(gl: GL, type: number, src: string): WebGLShader | string {
  const sh = gl.createShader(type);
  if (!sh) return "createShader failed";
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh) || "unknown shader compile error";
    gl.deleteShader(sh);
    return log;
  }
  return sh;
}

export function linkProgram(gl: GL, vertSrc: string, fragSrc: string): ShaderResult {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vertSrc);
  if (typeof vs === "string") return { ok: false, error: `vertex: ${vs}` };
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fragSrc);
  if (typeof fs === "string") {
    gl.deleteShader(vs);
    return { ok: false, error: `fragment: ${fs}` };
  }
  const program = gl.createProgram();
  if (!program) return { ok: false, error: "createProgram failed" };
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  // Shaders can be flagged for deletion once attached; they live with the program.
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program) || "unknown link error";
    gl.deleteProgram(program);
    return { ok: false, error: `link: ${log}` };
  }
  return { ok: true, program };
}

// ── Textures & framebuffers ─────────────────────────────────────────────

export interface TexOptions {
  filter?: number; // gl.LINEAR | gl.NEAREST
  wrap?: number; // gl.CLAMP_TO_EDGE | gl.REPEAT | gl.MIRRORED_REPEAT
}

export function createTexture(gl: GL, opts: TexOptions = {}): WebGLTexture {
  const t = gl.createTexture();
  if (!t) throw new Error("createTexture failed");
  const filter = opts.filter ?? gl.LINEAR;
  const wrap = opts.wrap ?? gl.CLAMP_TO_EDGE;
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
  return t;
}

/** Allocate (or reallocate) empty storage for a texture. */
export function allocTexture(gl: GL, tex: WebGLTexture, w: number, h: number, fmt: TexFormat): void {
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, fmt.internal, w, h, 0, fmt.format, fmt.type, null);
}

export interface RenderTarget {
  tex: WebGLTexture;
  fbo: WebGLFramebuffer;
  width: number;
  height: number;
}

/**
 * Create a render target. If the requested format doesn't produce a complete
 * framebuffer on this driver (rare, but seen on odd mobile GPUs), it falls
 * back to RGBA8 so rendering never breaks — you just lose the extra precision.
 */
export function createRenderTarget(
  gl: GL,
  w: number,
  h: number,
  fmt: TexFormat,
  opts: TexOptions = {},
): { target: RenderTarget; format: TexFormat } {
  const tryFormat = (f: TexFormat): RenderTarget | null => {
    const tex = createTexture(gl, opts);
    allocTexture(gl, tex, w, h, f);
    const fbo = gl.createFramebuffer();
    if (!fbo) throw new Error("createFramebuffer failed");
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    const complete = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (complete) return { tex, fbo, width: w, height: h };
    gl.deleteFramebuffer(fbo);
    gl.deleteTexture(tex);
    return null;
  };

  const first = tryFormat(fmt);
  if (first) return { target: first, format: fmt };
  const fallback = rgba8(gl);
  const second = tryFormat(fallback);
  if (!second) throw new Error("framebuffer incomplete even at RGBA8");
  return { target: second, format: fallback };
}

export function deleteRenderTarget(gl: GL, rt: RenderTarget): void {
  gl.deleteFramebuffer(rt.fbo);
  gl.deleteTexture(rt.tex);
}

/**
 * Two render targets used alternately: read the previous frame from `read`
 * while drawing into `write`, then `swap()`. This replaces the legacy
 * fa/fb pair + copyTexSubImage2D-from-canvas with an FBO-sourced prevFrame.
 */
export interface PingPong {
  readonly read: RenderTarget;
  readonly write: RenderTarget;
  /** Format actually in use (may be RGBA8 after a completeness fallback). */
  readonly format: TexFormat;
  swap(): void;
  resize(w: number, h: number): void;
  dispose(): void;
}

export function createPingPong(gl: GL, w: number, h: number, fmt: TexFormat, opts: TexOptions = {}): PingPong {
  let a = createRenderTarget(gl, w, h, fmt, opts);
  // Use whatever format A settled on so both halves match.
  let b = createRenderTarget(gl, w, h, a.format, opts);
  let read = a.target;
  let write = b.target;
  return {
    get read() { return read; },
    get write() { return write; },
    get format() { return a.format; },
    swap() { const t = read; read = write; write = t; },
    resize(nw, nh) {
      if (nw === a.target.width && nh === a.target.height) return;
      deleteRenderTarget(gl, a.target);
      deleteRenderTarget(gl, b.target);
      a = createRenderTarget(gl, nw, nh, a.format, opts);
      b = createRenderTarget(gl, nw, nh, a.format, opts);
      read = a.target;
      write = b.target;
    },
    dispose() {
      deleteRenderTarget(gl, a.target);
      deleteRenderTarget(gl, b.target);
    },
  };
}

// ── Fullscreen quad ─────────────────────────────────────────────────────

/**
 * A single triangle strip covering clip space. `attribLocation` is the
 * program's position attribute. Call `draw()` per pass.
 */
export function createFullscreenQuad(gl: GL, attribLocation: number): { draw(): void; dispose(): void } {
  const buf = gl.createBuffer();
  if (!buf) throw new Error("createBuffer failed");
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  return {
    draw() {
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.enableVertexAttribArray(attribLocation);
      gl.vertexAttribPointer(attribLocation, 2, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    },
    dispose() { gl.deleteBuffer(buf); },
  };
}
