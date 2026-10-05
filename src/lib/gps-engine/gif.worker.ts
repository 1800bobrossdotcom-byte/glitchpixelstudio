// gps-engine / gif.worker
//
// Dedicated worker: receives the captured RGBA frames (buffers transferred,
// not copied), applies the perfect-loop trim, encodes, and transfers the GIF
// bytes back. Keeps the "Saving GIF" step off the main thread.

import { encodeGIF, trimToLoopPoint } from "./gif-encoder";

export interface GifJob {
  gw: number;
  gh: number;
  frames: ArrayBuffer[];
  /** GIF frame delay in centiseconds: one value, or one per frame. */
  delayCs: number | number[];
  dither: number;
  perfectLoop: boolean;
}

export type GifResult =
  | { ok: true; gif: ArrayBuffer; frameCount: number }
  | { ok: false; error: string };

// The DOM lib types `self` as a Window; narrow to what a worker actually has.
const scope = self as unknown as {
  onmessage: ((ev: MessageEvent<GifJob>) => void) | null;
  postMessage(message: GifResult, transfer?: Transferable[]): void;
};

scope.onmessage = (ev) => {
  try {
    const { gw, gh, frames, delayCs, dither, perfectLoop } = ev.data;
    let list: Uint8ClampedArray[] = frames.map((b) => new Uint8ClampedArray(b));
    if (perfectLoop) list = trimToLoopPoint(list, gw, gh);
    // Per-frame delays are trimmed in parallel with the frames.
    const delays = Array.isArray(delayCs) ? delayCs.slice(0, list.length) : delayCs;
    const out = encodeGIF(gw, gh, list, delays, dither);
    scope.postMessage({ ok: true, gif: out.buffer as ArrayBuffer, frameCount: list.length }, [out.buffer as ArrayBuffer]);
  } catch (e) {
    scope.postMessage({ ok: false, error: String((e as Error)?.message ?? e) });
  }
};
