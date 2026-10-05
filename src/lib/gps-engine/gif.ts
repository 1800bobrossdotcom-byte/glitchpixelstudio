// gps-engine / gif
//
// Main-thread entry point for GIF export. Encodes in a Worker when it can
// (the frame buffers are TRANSFERRED, so the caller's arrays are detached
// afterwards and the memory moves with them) and falls back to inline
// encoding — identical output — where Workers aren't available.

import { encodeGIF, trimToLoopPoint } from "./gif-encoder";
import type { GifJob, GifResult } from "./gif.worker";

export interface EncodeGifOptions {
  gw: number;
  gh: number;
  /** Captured RGBA frames. Treat as consumed after the call. */
  frames: Uint8ClampedArray[];
  /** GIF frame delay in centiseconds: one value, or one per captured frame. */
  delayCs: number | number[];
  dither: number;
  perfectLoop: boolean;
}

function encodeInline(o: EncodeGifOptions): Uint8Array {
  const list = o.perfectLoop ? trimToLoopPoint(o.frames, o.gw, o.gh) : o.frames;
  const delays = Array.isArray(o.delayCs) ? o.delayCs.slice(0, list.length) : o.delayCs;
  return encodeGIF(o.gw, o.gh, list, delays, o.dither);
}

export async function encodeGifAsync(o: EncodeGifOptions): Promise<Uint8Array> {
  if (typeof Worker === "undefined") return encodeInline(o);

  let worker: Worker;
  try {
    // The literal `new Worker(new URL(..., import.meta.url))` form is what
    // the bundler (webpack / Turbopack) recognises and emits a chunk for.
    worker = new Worker(new URL("./gif.worker.ts", import.meta.url), { type: "module" });
  } catch (e) {
    console.warn("[gps-engine] GIF worker unavailable, encoding inline:", e);
    return encodeInline(o);
  }

  // Only buffers that are exactly the frame (offset 0, full length) can be
  // transferred as-is; anything else is copied so the view stays correct.
  const buffers = o.frames.map((f) =>
    f.byteOffset === 0 && f.byteLength === f.buffer.byteLength
      ? (f.buffer as ArrayBuffer)
      : (f.slice().buffer as ArrayBuffer),
  );

  const result = await new Promise<GifResult>((resolve, reject) => {
    worker.onmessage = (ev: MessageEvent<GifResult>) => resolve(ev.data);
    worker.onerror = (ev) => reject(new Error(ev.message || "GIF worker error"));
    worker.onmessageerror = () => reject(new Error("GIF worker message error"));
    const job: GifJob = { gw: o.gw, gh: o.gh, frames: buffers, delayCs: o.delayCs, dither: o.dither, perfectLoop: o.perfectLoop };
    worker.postMessage(job, buffers);
  }).finally(() => worker.terminate());

  if (!result.ok) throw new Error(result.error);
  return new Uint8Array(result.gif);
}
