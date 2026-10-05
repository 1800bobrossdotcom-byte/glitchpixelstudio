// gps-engine — framework-free renderer for Glitch Pixel Studio.
// Shared by the web page and the mobile (Capacitor) shell.

export { createEngine, type Engine, type CreateEngineResult } from "./engine";
export { createScheduler, type Scheduler, type SchedulerHooks } from "./scheduler";
export { createGpuSort, sortThreshold, type GpuSort } from "./gpu-sort";
export { encodeGifAsync, type EncodeGifOptions } from "./gif";
export { encodeGIF, trimToLoopPoint } from "./gif-encoder";
export {
  neutralParams,
  type EngineParams,
  type EngineOptions,
  type RenderOptions,
  type FrameInfo,
  type FeedbackSource,
  type FaceParams,
  type TouchParams,
  type AudioParams,
  type ViewportSpec,
  type TexSource,
} from "./types";
export { TEX_UNIT, UNIFORM_NAMES, applyFrameUniforms, UniformWriter, type UniformLocations, type FrameContext } from "./uniforms";
export { VERT_SRC, FRAG_SRC, PRESENT_FRAG_SRC } from "./shaders";
export type { GLCaps } from "./gl-context";
