/**
 * usePixelGenWorkerPool - v1.3.80
 *
 * One Web Worker per layer slot (max 4 active gen layers). Each slot owns its
 * own pixelGenWorker instance with its own internal OffscreenCanvas, so the
 * four layers in the multi-layer fuse path can race in parallel on separate
 * threads instead of serializing through a single worker.
 *
 * Frame N+1 is computed by the worker while the main thread fuses frame N
 * out of each slot's destination canvas (held from the previous result). The
 * first frame for each slot is primed synchronously by the caller via
 * drawPixelGenerator so the canvas is never blank.
 *
 * The pool is sized lazily — workers are only spawned when generate(slot, ...)
 * is first called for that slot. Slots are kept alive for the lifetime of the
 * hook because layer enable/disable churn is frequent and worker construction
 * is the expensive part.
 */

import { useEffect, useRef, useCallback } from "react";

interface GenerationResult {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

type AnyParams = Record<string, unknown>;

export function usePixelGenWorkerPool(maxSlots = 4) {
  const workersRef = useRef<(Worker | null)[]>([]);
  // Per-slot pending callback. Only one in-flight request per slot at a time —
  // callers must respect the busy flag they keep externally. A stale id check
  // protects against late-arriving frames after a resize.
  const pendingRef = useRef<({ id: string; cb: (r: GenerationResult) => void } | null)[]>([]);

  const ensureWorker = useCallback((slot: number): Worker | null => {
    if (slot < 0 || slot >= maxSlots) return null;
    const existing = workersRef.current[slot];
    if (existing) return existing;
    try {
      const w = new Worker(
        new URL("../workers/pixelGenWorker.ts", import.meta.url),
        { type: "module" }
      );
      w.onmessage = (event: MessageEvent<{ id: string; data?: ArrayBuffer; width?: number; height?: number; error?: string }>) => {
        const { id, data, width, height, error } = event.data;
        const slotEntry = pendingRef.current[slot];
        if (!slotEntry || slotEntry.id !== id) return; // stale (resize, etc.)
        pendingRef.current[slot] = null;
        if (error || !data || !width || !height) {
          slotEntry.cb({
            data: new Uint8ClampedArray((width || 0) * (height || 0) * 4),
            width: width || 0,
            height: height || 0,
          });
          return;
        }
        slotEntry.cb({
          data: new Uint8ClampedArray(data),
          width,
          height,
        });
      };
      w.onerror = (err) => {
        console.error("pixelGenWorker pool slot", slot, "error:", err.message);
      };
      workersRef.current[slot] = w;
      return w;
    } catch (err) {
      console.warn("Web Worker not supported, layer", slot, "stays on main thread");
      return null;
    }
  }, [maxSlots]);

  const generate = useCallback(
    (slot: number, params: AnyParams, width: number, height: number): Promise<GenerationResult> => {
      return new Promise((resolve) => {
        const w = ensureWorker(slot);
        if (!w) {
          resolve({ data: new Uint8ClampedArray(width * height * 4), width, height });
          return;
        }
        const id = Math.random().toString(36).slice(2);
        pendingRef.current[slot] = { id, cb: resolve };
        w.postMessage({ id, params, width, height });
      });
    },
    [ensureWorker]
  );

  useEffect(() => {
    return () => {
      for (const w of workersRef.current) {
        if (w) w.terminate();
      }
      workersRef.current = [];
      pendingRef.current = [];
    };
  }, []);

  return { generate };
}
