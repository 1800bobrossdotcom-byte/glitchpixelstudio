/**
 * Procedural pixel generation worker - v1.3.79
 *
 * Runs the full drawPixelGenerator on an OffscreenCanvas inside a Web Worker
 * so the main thread is never blocked by the per-frame raster work (typically
 * 5-15ms on mid-range Android). The generator source is shared verbatim with
 * the main thread via src/utils/pixelGenerator.ts; both targets accept either
 * an HTMLCanvasElement (main thread fallback) or an OffscreenCanvas (worker).
 *
 * Wire protocol
 * -------------
 * Inbound:  { id: string; params: GenParams; width: number; height: number }
 * Outbound: { id: string; data: Uint8ClampedArray; width: number; height: number }
 *           (data.buffer is transferred for zero-copy delivery)
 * On error: { id: string; error: string }
 */

import { drawPixelGenerator, type GenParams } from "../utils/pixelGenerator";

export type { GenParams };

interface WorkerMessage {
  id: string;
  params: GenParams;
  width: number;
  height: number;
}

// Single reusable OffscreenCanvas + 2D context, resized as requests come in.
// Recreating per frame would thrash GC; resizing in place is essentially free.
let scratch: OffscreenCanvas | null = null;
let scratchCtx: OffscreenCanvasRenderingContext2D | null = null;

function ensureScratch(w: number, h: number): OffscreenCanvasRenderingContext2D | null {
  if (!scratch || scratch.width !== w || scratch.height !== h) {
    scratch = new OffscreenCanvas(w, h);
    scratchCtx = scratch.getContext("2d") as OffscreenCanvasRenderingContext2D | null;
  }
  return scratchCtx;
}

self.addEventListener("message", (event: MessageEvent<WorkerMessage>) => {
  const { id, params, width, height } = event.data;
  try {
    const ctx = ensureScratch(width, height);
    if (!ctx || !scratch) {
      (self as unknown as Worker).postMessage({ id, error: "OffscreenCanvas 2D context unavailable" });
      return;
    }
    drawPixelGenerator(scratch, params);
    const imageData = ctx.getImageData(0, 0, width, height);
    const data = imageData.data;
    (self as unknown as Worker).postMessage(
      { id, data, width, height },
      [data.buffer]
    );
  } catch (err) {
    (self as unknown as Worker).postMessage({
      id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});
