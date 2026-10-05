// gps-engine / scheduler
//
// The frame loop lifted from SpectraAfter.tsx: visibility gating (6591),
// low-power frame skipping (6601), rAF re-armed before the work (6691),
// and the v1.2.55 adaptive resolution + FPS counter (7789–7826). Every
// browser touchpoint is injectable so it runs identically in a Worker or
// a test.

export interface SchedulerHooks {
  /** Called once per rendered frame. */
  render: () => void;
  /**
   * Adaptive resolution changed. The shell measures the canvas and calls
   * engine.resize({ …, scale }) — synchronously, like the original.
   */
  onScaleChange: (scale: number) => void;
  onFps?: (fps: number) => void;
  /** Return true to drop every other frame (low-power / battery-low). */
  shouldSkipFrames?: () => boolean;
  /**
   * v1.2.55 adaptive resolution (0.75 under sustained >22 ms, back to 1.0
   * after ~2 s under 14 ms). Default true. The mobile app disabled it in
   * v1.3.42 in favour of its FX-quality governor — pass false there.
   */
  adaptiveResolution?: boolean;
  isVisible?: () => boolean;
  now?: () => number;
  raf?: (cb: () => void) => number;
  caf?: (id: number) => void;
}

export interface Scheduler {
  start(): void;
  stop(): void;
  /** Re-arm after the page becomes visible again (9168). */
  resume(): void;
  readonly running: boolean;
  readonly renderScale: number;
  readonly frameTimeMs: number;
}

// 7800 / 7807: sustained >22 ms → 0.75; sustained <14 ms for ~2 s → 1.0.
const SLOW_MS = 22;
const FAST_MS = 14;
const DEADBAND_MS = 16;
const DOWN_SCALE = 0.75;
const RECOVER_STREAK = 120;

export function createScheduler(hooks: SchedulerHooks): Scheduler {
  const now = hooks.now ?? (() => performance.now());
  const raf = hooks.raf ?? ((cb) => requestAnimationFrame(cb));
  const caf = hooks.caf ?? ((id) => cancelAnimationFrame(id));
  const isVisible = hooks.isVisible ?? (() => document.visibilityState === "visible");

  let rafId = 0;
  let running = false;
  let skipToggle = false;
  let renderScale = 1.0;
  let frametimeAvg = 16.7; // 4832: seeded at ~60 fps so the first second isn't skewed
  let fastStreak = 0;
  let lastTs = 0;
  let fpsFrames = 0;
  let fpsTime = 0;

  const tick = () => {
    rafId = 0;
    if (!running) return;
    if (!isVisible()) return; // 6591: park until resume()

    if (hooks.shouldSkipFrames?.()) {
      skipToggle = !skipToggle;
      if (skipToggle) { rafId = raf(tick); return; } // 6601: drop every other frame
    }

    rafId = raf(tick); // 6691: re-arm before the work
    hooks.render();

    // 7789–7826
    fpsFrames++;
    const t = now();
    if (lastTs > 0) {
      const dt = t - lastTs;
      frametimeAvg = frametimeAvg * 0.92 + dt * 0.08;
      const avg = frametimeAvg;
      if (hooks.adaptiveResolution === false) {
        // frame time still tracked (segmenter cadence reads it); scale stays 1.0
      } else if (avg > SLOW_MS && renderScale > 0.76) {
        renderScale = DOWN_SCALE;
        fastStreak = 0;
        hooks.onScaleChange(renderScale);
      } else if (avg < FAST_MS && renderScale < 1.0) {
        fastStreak++;
        if (fastStreak > RECOVER_STREAK) {
          renderScale = 1.0;
          fastStreak = 0;
          hooks.onScaleChange(renderScale);
        }
      } else if (avg > DEADBAND_MS) {
        fastStreak = Math.max(0, fastStreak - 1);
      }
    }
    lastTs = t;
    if (t - fpsTime >= 1000) {
      hooks.onFps?.(fpsFrames);
      fpsFrames = 0;
      fpsTime = t;
    }
  };

  return {
    start() {
      if (running) return;
      running = true;
      lastTs = 0;
      fpsTime = now();
      if (!rafId) rafId = raf(tick);
    },
    stop() {
      running = false;
      if (rafId) { caf(rafId); rafId = 0; }
    },
    resume() {
      if (running && !rafId) { lastTs = 0; rafId = raf(tick); }
    },
    get running() { return running; },
    get renderScale() { return renderScale; },
    get frameTimeMs() { return frametimeAvg; },
  };
}
